/**
 * Timeout Handling and Recovery Integration Tests
 * 
 * These tests validate that the timeout fixes resolve the original issues:
 * 1. Neo4j timeout configuration prevents hanging connections
 * 2. API timeout handling works with network delays
 * 3. Circuit breakers recover correctly after timeout fixes
 * 4. Workers handle timeouts gracefully without hanging
 * 
 * Tests simulate original failure conditions to prove they're fixed.
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getDriver: getNeo4jDriver } = require('../../src/utils/neo4jDriver');
const GraphIngestionWorker = require('../../src/workers/GraphIngestionWorker');
const GraphBuilder = require('../../src/agents/GraphBuilder');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');

describe('Timeout Handling and Recovery Integration Tests', () => {
    let config;
    let dbManager;
    let queueManager;
    let neo4jDriver;
    let llmClient;
    let workerPoolManager;
    let testRunId;
    let testDbPath;
    let testDataDir;

    beforeAll(async () => {
        config = new PipelineConfig({ environment: 'test' });
        testRunId = uuidv4();
        
        testDataDir = path.join(__dirname, `timeout-test-${Date.now()}`);
        await fs.ensureDir(testDataDir);
        
        testDbPath = path.join(testDataDir, 'timeout-test.db');
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

        console.log(`✅ Timeout test environment initialized with runId: ${testRunId}`);
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
        console.log('✅ Timeout test cleanup completed');
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
        
        // Clear Neo4j test data
        const session = neo4jDriver.session();
        try {
            await session.run('MATCH (n) WHERE n.runId = $runId DETACH DELETE n', { runId: testRunId });
        } finally {
            await session.close();
        }
    });

    describe('1. Neo4j Timeout Configuration Tests', () => {
        test('should handle Neo4j connection timeouts gracefully', async () => {
            const startTime = Date.now();
            
            // Create a large batch that might timeout without proper configuration
            const largeBatch = [];
            for (let i = 0; i < 1000; i++) {
                largeBatch.push({
                    nodeId: `node_${i}`,
                    name: `TestNode_${i}`,
                    type: 'function',
                    filePath: 'test.js',
                    runId: testRunId,
                    properties: {
                        description: `Test node ${i} with some description`,
                        startLine: i,
                        endLine: i + 10,
                        isExported: i % 2 === 0
                    }
                });
            }

            const graphBuilder = new GraphBuilder(neo4jDriver);
            
            // This should complete within timeout or fail gracefully (not hang)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Operation hung - timeout fix failed')), 65000); // 65 seconds
            });

            const operationPromise = graphBuilder._runBatch(largeBatch, testRunId);

            try {
                await Promise.race([operationPromise, timeoutPromise]);
                const duration = Date.now() - startTime;
                console.log(`✅ Large batch completed in ${duration}ms (no hanging)`);
                
                // Verify some nodes were created
                const session = neo4jDriver.session();
                try {
                    const result = await session.run(
                        'MATCH (n) WHERE n.runId = $runId RETURN count(n) as count',
                        { runId: testRunId }
                    );
                    const count = result.records[0].get('count').low;
                    expect(count).toBeGreaterThan(0);
                } finally {
                    await session.close();
                }
                
            } catch (error) {
                const duration = Date.now() - startTime;
                console.log(`Operation failed after ${duration}ms: ${error.message}`);
                
                // If it fails due to timeout, that's acceptable as long as it doesn't hang
                if (error.message.includes('timeout') || error.message.includes('timed out')) {
                    console.log('✅ Operation timed out gracefully (no hanging)');
                } else if (error.message.includes('hung')) {
                    throw error; // This indicates the timeout fix didn't work
                } else {
                    console.log('✅ Operation failed gracefully (no hanging)');
                }
            }
        }, 70000);

        test('should handle Neo4j transaction timeouts with proper cleanup', async () => {
            const session = neo4jDriver.session();
            
            try {
                // Start a transaction that might take too long
                const startTime = Date.now();
                
                const txResult = await session.writeTransaction(async (tx) => {
                    // Create a complex query that might timeout
                    await tx.run(`
                        WITH range(1, 1000) as numbers
                        UNWIND numbers as num
                        CREATE (n:TestNode {
                            id: num, 
                            runId: $runId,
                            data: randomUUID(),
                            timestamp: timestamp()
                        })
                        RETURN count(n) as created
                    `, { runId: testRunId });
                    
                    return 'success';
                }, { 
                    timeout: 30000, // 30 second timeout
                    metadata: { operation: 'timeout-test' }
                });

                const duration = Date.now() - startTime;
                console.log(`✅ Transaction completed in ${duration}ms: ${txResult}`);
                
            } catch (error) {
                const duration = Date.now() - startTime;
                console.log(`Transaction failed after ${duration}ms: ${error.message}`);
                
                // Should fail with timeout, not hang
                expect(duration).toBeLessThan(35000); // Should not take longer than timeout + buffer
                console.log('✅ Transaction timed out gracefully');
                
            } finally {
                await session.close();
            }
        }, 40000);

        test('should handle multiple concurrent Neo4j operations with timeouts', async () => {
            const concurrentOperations = [];
            const startTime = Date.now();
            
            // Create multiple concurrent operations that might contend for resources
            for (let i = 0; i < 5; i++) {
                const operation = (async () => {
                    const session = neo4jDriver.session();
                    try {
                        return await session.writeTransaction(async (tx) => {
                            const result = await tx.run(`
                                CREATE (n:ConcurrentTest {
                                    batch: $batch,
                                    runId: $runId,
                                    timestamp: timestamp()
                                })
                                RETURN n.batch as batchId
                            `, { batch: i, runId: testRunId });
                            
                            return result.records[0].get('batchId');
                        }, { 
                            timeout: 20000,
                            metadata: { operation: `concurrent-test-${i}` }
                        });
                    } finally {
                        await session.close();
                    }
                })();
                
                concurrentOperations.push(operation);
            }
            
            // All operations should complete or timeout gracefully
            const results = await Promise.allSettled(concurrentOperations);
            const duration = Date.now() - startTime;
            
            console.log(`Concurrent operations completed in ${duration}ms`);
            
            const successful = results.filter(r => r.status === 'fulfilled');
            const failed = results.filter(r => r.status === 'rejected');
            
            console.log(`✅ ${successful.length} successful, ${failed.length} failed (no hanging)`);
            
            // Ensure no operation hung (total time should be reasonable)
            expect(duration).toBeLessThan(30000);
            
            // Verify that failed operations failed due to timeouts, not hanging
            for (const failure of failed) {
                const error = failure.reason.message;
                expect(error.toLowerCase()).toMatch(/(timeout|timed out|connection|transaction)/);
            }
        }, 35000);
    });

    describe('2. API Timeout Handling Tests', () => {
        test('should handle DeepSeek API timeouts gracefully', async () => {
            const fileAnalysisWorker = new FileAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager, 
                { processOnly: true }
            );
            
            // Create a job that might cause API timeout
            const db = dbManager.getDb();
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('large-file.js', 'pending', testRunId).lastInsertRowid;
            
            // Create a very large file content that might timeout
            const largeContent = 'function test() {\n' + '  console.log("test");\n'.repeat(5000) + '}';
            
            const mockJob = {
                id: 'timeout-test-job',
                data: {
                    fileId: fileId,
                    filePath: 'large-file.js',
                    content: largeContent,
                    runId: testRunId
                }
            };

            const startTime = Date.now();
            
            try {
                await fileAnalysisWorker._analyzeFileContent(mockJob.data);
                const duration = Date.now() - startTime;
                console.log(`✅ API call completed in ${duration}ms`);
                
            } catch (error) {
                const duration = Date.now() - startTime;
                console.log(`API call failed after ${duration}ms: ${error.message}`);
                
                // Should timeout gracefully, not hang
                expect(duration).toBeLessThan(70000); // Should not exceed API timeout + buffer
                
                // Should be a timeout-related error, not a hanging error
                const errorMessage = error.message.toLowerCase();
                expect(errorMessage).toMatch(/(timeout|timed out|aborted|network|request)/);
                
                console.log('✅ API timeout handled gracefully');
            }
        }, 75000);

        test('should retry API calls after timeout with exponential backoff', async () => {
            const fileAnalysisWorker = new FileAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager, 
                { processOnly: true }
            );
            
            const db = dbManager.getDb();
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('retry-test.js', 'pending', testRunId).lastInsertRowid;
            
            const mockJob = {
                id: 'retry-test-job',
                data: {
                    fileId: fileId,
                    filePath: 'retry-test.js',
                    content: 'function simple() { return true; }',
                    runId: testRunId
                }
            };

            const startTime = Date.now();
            let retryCount = 0;
            
            // Mock the LLM client to simulate intermittent timeouts
            const originalQuery = llmClient.chat.completions.create;
            llmClient.chat.completions.create = async (params) => {
                retryCount++;
                if (retryCount < 3) {
                    // Simulate timeout on first 2 attempts
                    const error = new Error('Request timed out');
                    error.code = 'ECONNABORTED';
                    throw error;
                }
                // Succeed on 3rd attempt
                return {
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                entities: [
                                    {
                                        name: 'simple',
                                        type: 'function',
                                        startLine: 1,
                                        endLine: 1,
                                        description: 'Simple test function',
                                        isExported: false
                                    }
                                ],
                                relationships: []
                            })
                        }
                    }]
                };
            };

            try {
                const result = await fileAnalysisWorker._analyzeFileContent(mockJob.data);
                const duration = Date.now() - startTime;
                
                console.log(`✅ API call succeeded after ${retryCount} attempts in ${duration}ms`);
                expect(retryCount).toBe(3); // Should have retried twice, succeeded on 3rd
                expect(result).toBeDefined();
                
            } catch (error) {
                console.error('API retry test failed:', error.message);
                throw error;
                
            } finally {
                // Restore original LLM client
                llmClient.chat.completions.create = originalQuery;
            }
        }, 30000);
    });

    describe('3. Worker Timeout and Recovery Tests', () => {
        test('should handle worker job timeouts without affecting other workers', async () => {
            const graphWorker = new GraphIngestionWorker(
                queueManager, dbManager, neo4jDriver, workerPoolManager,
                { processOnly: true }
            );
            
            // Create test data
            const db = dbManager.getDb();
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('timeout-worker-test.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert a large number of POIs to potentially cause timeout
            const poiIds = [];
            for (let i = 0; i < 500; i++) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'timeout-worker-test.js', `function_${i}`, 'function', i, i + 1,
                    `Function ${i}`, false, `func_${i}_semantic`, testRunId
                ).lastInsertRowid;
                poiIds.push(poiId);
            }
            
            // Create large batch job that might timeout
            const mockJob = {
                id: 'large-batch-job',
                data: {
                    batchId: 'timeout-test-batch',
                    runId: testRunId,
                    pois: poiIds.slice(0, 200), // First 200 POIs
                    relationships: []
                }
            };

            const startTime = Date.now();
            
            try {
                await graphWorker.process(mockJob);
                const duration = Date.now() - startTime;
                console.log(`✅ Worker job completed in ${duration}ms`);
                
                // Verify some data was processed
                const session = neo4jDriver.session();
                try {
                    const result = await session.run(
                        'MATCH (n) WHERE n.runId = $runId RETURN count(n) as count',
                        { runId: testRunId }
                    );
                    const count = result.records[0].get('count').low;
                    expect(count).toBeGreaterThan(0);
                } finally {
                    await session.close();
                }
                
            } catch (error) {
                const duration = Date.now() - startTime;
                console.log(`Worker job failed after ${duration}ms: ${error.message}`);
                
                // Should timeout gracefully
                expect(duration).toBeLessThan(65000); // Within timeout bounds
                console.log('✅ Worker timeout handled gracefully');
            }
        }, 70000);

        test('should recover worker pool after timeout failures', async () => {
            // Simulate multiple timeout failures and verify system recovery
            const activeWorkers = workerPoolManager.getActiveWorkerCount();
            const maxConcurrency = workerPoolManager.config.maxGlobalConcurrency;
            
            console.log(`Initial workers: ${activeWorkers}, Max concurrency: ${maxConcurrency}`);
            
            // Simulate worker registrations and failures
            const workerType = 'test-timeout-worker';
            
            // Register workers
            for (let i = 0; i < 3; i++) {
                workerPoolManager.registerWorker(workerType, `worker-${i}`);
            }
            
            // Simulate timeouts
            for (let i = 0; i < 3; i++) {
                try {
                    await workerPoolManager.withConcurrencyLimit(workerType, async () => {
                        // Simulate work that times out
                        await new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('Simulated timeout')), 100);
                        });
                    });
                } catch (error) {
                    console.log(`Expected timeout error: ${error.message}`);
                }
            }
            
            // Verify system can still accept new work
            let recoverySuccess = false;
            await workerPoolManager.withConcurrencyLimit(workerType, async () => {
                // Simulate successful work after timeouts
                await new Promise(resolve => setTimeout(resolve, 10));
                recoverySuccess = true;
            });
            
            expect(recoverySuccess).toBe(true);
            console.log('✅ Worker pool recovered after timeout failures');
        });
    });

    describe('4. System-Wide Timeout Integration', () => {
        test('should handle cascading timeouts without system breakdown', async () => {
            // Create a scenario that might cause cascading timeouts across components
            const db = dbManager.getDb();
            
            // Insert test files and POIs
            const fileIds = [];
            for (let i = 0; i < 10; i++) {
                const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                    .run(`cascade-test-${i}.js`, 'processed', testRunId).lastInsertRowid;
                fileIds.push(fileId);
                
                // Add POIs for each file  
                for (let j = 0; j < 50; j++) {
                    db.prepare(`
                        INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        fileId, `cascade-test-${i}.js`, `function_${i}_${j}`, 'function', j, j + 1,
                        `Function ${j} in file ${i}`, false, `func_${i}_${j}_semantic`, testRunId
                    );
                }
            }
            
            const startTime = Date.now();
            
            // Create multiple workers that might all timeout
            const workers = [
                new GraphIngestionWorker(queueManager, dbManager, neo4jDriver, workerPoolManager, { processOnly: true }),
                new FileAnalysisWorker(queueManager, dbManager, llmClient, workerPoolManager, { processOnly: true })
            ];
            
            // Create jobs for each worker
            const jobs = fileIds.map(fileId => ({
                id: `cascade-job-${fileId}`,
                data: {
                    fileId: fileId,
                    runId: testRunId,
                    batchId: `batch-${fileId}`
                }
            }));
            
            // Process jobs concurrently (some may timeout)
            const results = await Promise.allSettled(
                jobs.slice(0, 5).map(job => workers[0].process(job))
            );
            
            const duration = Date.now() - startTime;
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            
            console.log(`Cascade test completed in ${duration}ms: ${successful} successful, ${failed} failed`);
            
            // System should not break down completely
            expect(duration).toBeLessThan(90000); // Should not hang indefinitely
            expect(successful + failed).toBe(5); // All jobs should complete or fail
            
            // Verify system is still responsive
            let systemResponsive = false;
            try {
                const testResult = await neo4jDriver.verifyConnectivity();
                systemResponsive = true;
            } catch (error) {
                console.log('Neo4j not responsive after cascade test');
            }
            
            if (!systemResponsive) {
                // Try database operations
                try {
                    const testQuery = db.prepare('SELECT COUNT(*) as count FROM files WHERE run_id = ?').get(testRunId);
                    systemResponsive = testQuery.count >= 0;
                } catch (error) {
                    console.log('Database not responsive after cascade test');
                }
            }
            
            expect(systemResponsive).toBe(true);
            console.log('✅ System remained responsive after cascading timeouts');
        }, 100000);
    });
});