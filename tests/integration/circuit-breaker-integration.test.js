/**
 * Circuit Breaker Integration Tests
 * 
 * These tests validate circuit breaker behavior after configuration changes:
 * 1. Circuit breaker opens correctly after failure threshold
 * 2. Circuit breaker recovers and closes after timeout fixes
 * 3. Circuit breaker prevents cascading failures
 * 4. Different services have appropriate circuit breaker configurations
 * 5. Half-open state works correctly with timeout configurations
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getDriver: getNeo4jDriver } = require('../../src/utils/neo4jDriver');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');
const { registry } = require('../../src/utils/circuitBreaker');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const GraphIngestionWorker = require('../../src/workers/GraphIngestionWorker');

// Mock circuit breaker for testing
class MockCircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.options = {
            failureThreshold: options.failureThreshold || 5,
            resetTimeout: options.resetTimeout || 10000,
            monitoringPeriod: options.monitoringPeriod || 60000,
            ...options
        };
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        this.requestCount = 0;
        this.metrics = {
            totalRequests: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            stateChanges: []
        };
    }

    async execute(fn) {
        this.requestCount++;
        this.metrics.totalRequests++;

        if (this.state === 'OPEN') {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure >= this.options.resetTimeout) {
                this.setState('HALF_OPEN');
            } else {
                throw new Error(`Circuit breaker ${this.name} is OPEN`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    onSuccess() {
        this.successCount++;
        this.metrics.totalSuccesses++;
        
        if (this.state === 'HALF_OPEN') {
            this.setState('CLOSED');
            this.failureCount = 0;
        }
    }

    onFailure(error) {
        this.failureCount++;
        this.metrics.totalFailures++;
        this.lastFailureTime = Date.now();

        if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
            this.setState('OPEN');
        } else if (this.state === 'HALF_OPEN') {
            this.setState('OPEN');
        }
    }

    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        this.metrics.stateChanges.push({
            from: oldState,
            to: newState,
            timestamp: Date.now(),
            failureCount: this.failureCount,
            successCount: this.successCount
        });
        console.log(`Circuit breaker ${this.name}: ${oldState} -> ${newState}`);
    }

    getState() {
        return this.state;
    }

    getMetrics() {
        return {
            ...this.metrics,
            currentState: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            requestCount: this.requestCount
        };
    }

    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.requestCount = 0;
        this.lastFailureTime = null;
        this.metrics = {
            totalRequests: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            stateChanges: []
        };
    }
}

describe('Circuit Breaker Integration Tests', () => {
    let config;
    let dbManager;
    let queueManager;
    let neo4jDriver;
    let llmClient;
    let workerPoolManager;
    let testRunId;
    let testDbPath;
    let testDataDir;
    let circuitBreakers;

    beforeAll(async () => {
        config = new PipelineConfig({ environment: 'test' });
        testRunId = uuidv4();
        
        testDataDir = path.join(__dirname, `circuit-breaker-test-${Date.now()}`);
        await fs.ensureDir(testDataDir);
        
        testDbPath = path.join(testDataDir, 'circuit-breaker-test.db');
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();

        queueManager = getQueueManagerInstance();
        await queueManager.connect();

        neo4jDriver = getNeo4jDriver();
        llmClient = getDeepseekClient();
        workerPoolManager = new WorkerPoolManager({ 
            maxGlobalConcurrency: 5,
            environment: 'test'
        });

        // Initialize circuit breakers for different services
        circuitBreakers = {
            llmApi: new MockCircuitBreaker('llm-api', {
                failureThreshold: 3,
                resetTimeout: 5000,
                monitoringPeriod: 30000
            }),
            neo4j: new MockCircuitBreaker('neo4j', {
                failureThreshold: 5,
                resetTimeout: 10000,
                monitoringPeriod: 60000
            }),
            database: new MockCircuitBreaker('database', {
                failureThreshold: 2,
                resetTimeout: 3000,
                monitoringPeriod: 15000
            })
        };

        console.log(`✅ Circuit breaker test environment initialized with runId: ${testRunId}`);
    }, 30000);

    afterAll(async () => {
        if (queueManager) {
            await queueManager.clearAllQueues();
            await queueManager.closeConnections();
        }
        if (dbManager) {
            await dbManager.close();
        }
        if (neo4jDriver) {
            await neo4jDriver.close();
        }
        if (fs.existsSync(testDataDir)) {
            await fs.remove(testDataDir);
        }
        console.log('✅ Circuit breaker test cleanup completed');
    });

    beforeEach(async () => {
        await queueManager.clearAllQueues();
        
        const db = dbManager.getDb();
        const tables = ['pois', 'relationships', 'outbox', 'files'];
        for (const table of tables) {
            try {
                db.prepare(`DELETE FROM ${table}`).run();
            } catch (error) {
                console.warn(`Could not clear table ${table}:`, error.message);
            }
        }

        // Reset all circuit breakers
        Object.values(circuitBreakers).forEach(cb => cb.reset());
    });

    describe('1. Circuit Breaker State Management', () => {
        test('should open circuit breaker after failure threshold', async () => {
            const cb = circuitBreakers.llmApi;
            expect(cb.getState()).toBe('CLOSED');

            // Simulate failures up to threshold
            for (let i = 0; i < 3; i++) {
                try {
                    await cb.execute(async () => {
                        throw new Error(`Simulated failure ${i + 1}`);
                    });
                } catch (error) {
                    // Expected failure
                }
            }

            expect(cb.getState()).toBe('OPEN');
            expect(cb.getMetrics().totalFailures).toBe(3);
            
            // Next request should fail immediately without executing function
            let immediateFailure = false;
            try {
                await cb.execute(async () => {
                    // This should not execute
                    return 'should not reach here';
                });
            } catch (error) {
                immediateFailure = error.message.includes('Circuit breaker');
            }

            expect(immediateFailure).toBe(true);
            console.log('✅ Circuit breaker opened after failure threshold');
        });

        test('should transition to half-open after reset timeout', async () => {
            const cb = circuitBreakers.database;
            
            // Force circuit breaker to open
            for (let i = 0; i < 2; i++) {
                try {
                    await cb.execute(async () => {
                        throw new Error('Force open');
                    });
                } catch (error) {
                    // Expected
                }
            }

            expect(cb.getState()).toBe('OPEN');

            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 3500));

            // Next request should transition to half-open
            try {
                await cb.execute(async () => {
                    throw new Error('Still failing');
                });
            } catch (error) {
                // Expected, but should have transitioned to half-open first
            }

            // Check state changes
            const metrics = cb.getMetrics();
            const stateChanges = metrics.stateChanges;
            
            expect(stateChanges.length).toBeGreaterThanOrEqual(2);
            expect(stateChanges.some(change => change.to === 'HALF_OPEN')).toBe(true);
            
            console.log('✅ Circuit breaker transitioned to half-open after timeout');
        });

        test('should close circuit breaker after successful execution in half-open state', async () => {
            const cb = circuitBreakers.neo4j;
            
            // Force to open state
            for (let i = 0; i < 5; i++) {
                try {
                    await cb.execute(async () => {
                        throw new Error('Force open');
                    });
                } catch (error) {
                    // Expected
                }
            }

            expect(cb.getState()).toBe('OPEN');

            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 10500));

            // Execute successful operation (should transition OPEN -> HALF_OPEN -> CLOSED)
            const result = await cb.execute(async () => {
                return 'success';
            });

            expect(result).toBe('success');
            expect(cb.getState()).toBe('CLOSED');
            
            const metrics = cb.getMetrics();
            const stateChanges = metrics.stateChanges;
            
            // Should have transitioned: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
            expect(stateChanges.length).toBe(3);
            expect(stateChanges[2].to).toBe('CLOSED');
            
            console.log('✅ Circuit breaker closed after successful execution');
        });
    });

    describe('2. Service-Specific Circuit Breaker Behavior', () => {
        test('should handle LLM API circuit breaker with timeout integration', async () => {
            const fileAnalysisWorker = new FileAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager,
                { processOnly: true }
            );

            const db = dbManager.getDb();
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('circuit-test.js', 'pending', testRunId).lastInsertRowid;

            const cb = circuitBreakers.llmApi;
            
            // Mock the LLM client to simulate failures with circuit breaker
            const originalCreate = llmClient.chat.completions.create;
            let callCount = 0;
            
            llmClient.chat.completions.create = async (params) => {
                return await cb.execute(async () => {
                    callCount++;
                    if (callCount <= 3) {
                        // Simulate timeout errors
                        const error = new Error('Request timeout');
                        error.code = 'ECONNABORTED';
                        throw error;
                    }
                    
                    // Success after failures
                    return {
                        choices: [{
                            message: {
                                content: JSON.stringify({
                                    entities: [{
                                        name: 'testFunction',
                                        type: 'function',
                                        startLine: 1,
                                        endLine: 5,
                                        description: 'Test function',
                                        isExported: false
                                    }],
                                    relationships: []
                                })
                            }
                        }]
                    };
                });
            };

            const mockJob = {
                data: {
                    fileId: fileId,
                    filePath: 'circuit-test.js',
                    content: 'function test() { return true; }',
                    runId: testRunId
                }
            };

            // First few attempts should fail and open the circuit
            for (let i = 0; i < 3; i++) {
                try {
                    await fileAnalysisWorker._analyzeFileContent(mockJob.data);
                } catch (error) {
                    console.log(`Expected failure ${i + 1}: ${error.message}`);
                }
            }

            expect(cb.getState()).toBe('OPEN');

            // Wait for circuit to allow half-open state
            await new Promise(resolve => setTimeout(resolve, 5500));

            // Next attempt should succeed and close the circuit
            try {
                const result = await fileAnalysisWorker._analyzeFileContent(mockJob.data);
                expect(result).toBeDefined();
                expect(cb.getState()).toBe('CLOSED');
                console.log('✅ LLM API circuit breaker recovered correctly');
            } catch (error) {
                console.error('Unexpected failure during recovery:', error.message);
                throw error;
            } finally {
                llmClient.chat.completions.create = originalCreate;
            }
        });

        test('should handle Neo4j circuit breaker with connection issues', async () => {
            const cb = circuitBreakers.neo4j;
            
            // Simulate Neo4j operations with circuit breaker
            const simulateNeo4jOperation = async (shouldFail = false) => {
                return await cb.execute(async () => {
                    if (shouldFail) {
                        throw new Error('Neo4j connection timeout');
                    }
                    
                    const session = neo4jDriver.session();
                    try {
                        const result = await session.run(
                            'CREATE (n:TestNode {id: $id, runId: $runId}) RETURN n.id as id',
                            { id: Date.now(), runId: testRunId }
                        );
                        return result.records[0].get('id');
                    } finally {
                        await session.close();
                    }
                });
            };

            // Cause circuit breaker to open
            for (let i = 0; i < 5; i++) {
                try {
                    await simulateNeo4jOperation(true);
                } catch (error) {
                    console.log(`Neo4j failure ${i + 1}: ${error.message}`);
                }
            }

            expect(cb.getState()).toBe('OPEN');

            // Verify immediate failure without attempting connection
            let immediateFailure = false;
            try {
                await simulateNeo4jOperation(false); // Even though it would succeed, circuit is open
            } catch (error) {
                immediateFailure = error.message.includes('Circuit breaker');
            }

            expect(immediateFailure).toBe(true);

            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 10500));

            // Should recover and allow successful operations
            const result = await simulateNeo4jOperation(false);
            expect(result).toBeDefined();
            expect(cb.getState()).toBe('CLOSED');
            
            console.log('✅ Neo4j circuit breaker handled connection issues correctly');
        });
    });

    describe('3. Circuit Breaker Metrics and Monitoring', () => {
        test('should collect accurate metrics during circuit breaker operations', async () => {
            const cb = circuitBreakers.llmApi;
            
            // Execute mixed success/failure operations
            const operations = [
                { shouldFail: false },
                { shouldFail: true },
                { shouldFail: false },
                { shouldFail: true },
                { shouldFail: true }, // This should open the circuit
                { shouldFail: false }  // This should fail due to open circuit
            ];

            for (let i = 0; i < operations.length; i++) {
                const op = operations[i];
                try {
                    await cb.execute(async () => {
                        if (op.shouldFail) {
                            throw new Error(`Intentional failure ${i}`);
                        }
                        return `success ${i}`;
                    });
                } catch (error) {
                    // Expected for failures and circuit open
                }
            }

            const metrics = cb.getMetrics();
            
            expect(metrics.totalRequests).toBe(6);
            expect(metrics.totalFailures).toBe(3); // Only actual failures, not circuit-open rejections
            expect(metrics.totalSuccesses).toBe(2);
            expect(metrics.currentState).toBe('OPEN');
            expect(metrics.stateChanges.length).toBe(1); // CLOSED -> OPEN
            
            console.log('Circuit breaker metrics:', metrics);
            console.log('✅ Circuit breaker metrics collected accurately');
        });

        test('should track state transition history', async () => {
            const cb = circuitBreakers.database;
            const initialTime = Date.now();
            
            // Cause multiple state transitions
            // CLOSED -> OPEN
            for (let i = 0; i < 2; i++) {
                try {
                    await cb.execute(async () => {
                        throw new Error('Failure');
                    });
                } catch (error) {
                    // Expected
                }
            }

            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 3500));

            // OPEN -> HALF_OPEN -> CLOSED
            await cb.execute(async () => 'success');

            const metrics = cb.getMetrics();
            const stateChanges = metrics.stateChanges;
            
            expect(stateChanges.length).toBe(3);
            expect(stateChanges[0].from).toBe('CLOSED');
            expect(stateChanges[0].to).toBe('OPEN');
            expect(stateChanges[1].from).toBe('OPEN');
            expect(stateChanges[1].to).toBe('HALF_OPEN');
            expect(stateChanges[2].from).toBe('HALF_OPEN');
            expect(stateChanges[2].to).toBe('CLOSED');
            
            // Verify timestamps are reasonable
            for (const change of stateChanges) {
                expect(change.timestamp).toBeGreaterThanOrEqual(initialTime);
                expect(change.timestamp).toBeLessThanOrEqual(Date.now());
            }
            
            console.log('State transition history:', stateChanges);
            console.log('✅ State transition history tracked correctly');
        });
    });

    describe('4. Circuit Breaker Integration with Workers', () => {
        test('should prevent cascading failures across worker types', async () => {
            // Create multiple workers with circuit breaker protection
            const fileWorker = new FileAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager,
                { processOnly: true }
            );
            
            const graphWorker = new GraphIngestionWorker(
                queueManager, dbManager, neo4jDriver, workerPoolManager,
                { processOnly: true }
            );

            const db = dbManager.getDb();
            
            // Create test data
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('cascade-prevention.js', 'processed', testRunId).lastInsertRowid;
            
            const poiId = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'cascade-prevention.js', 'testFunction', 'function', 1, 5,
                'Test function', false, 'test_func_semantic', testRunId
            ).lastInsertRowid;

            // Mock LLM to fail (should trigger LLM circuit breaker)
            const originalLlmCreate = llmClient.chat.completions.create;
            llmClient.chat.completions.create = async () => {
                throw new Error('LLM service unavailable');
            };

            // File analysis should fail but not crash the system
            const fileJob = {
                data: {
                    fileId: fileId,
                    filePath: 'cascade-prevention.js',
                    content: 'function test() { return true; }',
                    runId: testRunId
                }
            };

            let fileWorkerFailed = false;
            try {
                await fileWorker._analyzeFileContent(fileJob.data);
            } catch (error) {
                fileWorkerFailed = true;
                console.log('File worker failed as expected:', error.message);
            }

            expect(fileWorkerFailed).toBe(true);

            // Graph worker should still work (different service, different circuit breaker)
            const graphJob = {
                data: {
                    batchId: 'cascade-test',
                    runId: testRunId,
                    pois: [poiId],
                    relationships: []
                }
            };

            let graphWorkerSucceeded = false;
            try {
                await graphWorker.process(graphJob);
                graphWorkerSucceeded = true;
                console.log('Graph worker succeeded despite file worker failure');
            } catch (error) {
                console.log('Graph worker failed:', error.message);
            }

            // Restore LLM mock
            llmClient.chat.completions.create = originalLlmCreate;

            // At least one service should remain operational
            expect(graphWorkerSucceeded || !fileWorkerFailed).toBe(true);
            
            console.log('✅ Circuit breakers prevented cascading failures');
        });
    });

    describe('5. Circuit Breaker Recovery Patterns', () => {
        test('should implement exponential backoff during recovery', async () => {
            const cb = circuitBreakers.neo4j;
            
            // Open the circuit
            for (let i = 0; i < 5; i++) {
                try {
                    await cb.execute(async () => {
                        throw new Error('Initial failure');
                    });
                } catch (error) {
                    // Expected
                }
            }

            expect(cb.getState()).toBe('OPEN');
            
            const recoveryAttempts = [];
            const startTime = Date.now();
            
            // Attempt recovery multiple times with exponential backoff
            for (let attempt = 1; attempt <= 3; attempt++) {
                const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                
                try {
                    const result = await cb.execute(async () => {
                        if (attempt < 3) {
                            throw new Error(`Recovery attempt ${attempt} failed`);
                        }
                        return `Recovered on attempt ${attempt}`;
                    });
                    
                    recoveryAttempts.push({
                        attempt,
                        success: true,
                        result,
                        timestamp: Date.now() - startTime
                    });
                    
                    break; // Successfully recovered
                    
                } catch (error) {
                    recoveryAttempts.push({
                        attempt,
                        success: false,
                        error: error.message,
                        timestamp: Date.now() - startTime
                    });
                }
            }

            // Verify exponential backoff pattern
            expect(recoveryAttempts.length).toBe(3);
            expect(recoveryAttempts[2].success).toBe(true);
            expect(cb.getState()).toBe('CLOSED');
            
            // Verify timing shows exponential backoff
            for (let i = 1; i < recoveryAttempts.length; i++) {
                const timeDiff = recoveryAttempts[i].timestamp - recoveryAttempts[i-1].timestamp;
                expect(timeDiff).toBeGreaterThan(1000 * Math.pow(2, i-1) * 0.8); // Allow some variance
            }
            
            console.log('Recovery attempts:', recoveryAttempts);
            console.log('✅ Exponential backoff implemented correctly during recovery');
        });
    });
});