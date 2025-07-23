const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const DatabaseManager = require('../../src/utils/sqliteDb');
const CacheManager = require('../../src/utils/cacheManager');
const QueueManager = require('../../src/utils/queueManager');
const CheckpointManager = require('../../src/services/CheckpointManager');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const DirectoryAggregationWorker = require('../../src/workers/directoryAggregationWorker');
const RelationshipResolutionWorker = require('../../src/workers/relationshipResolutionWorker');
const { getLogger } = require('../../src/config/logging');

// Mock the logger
jest.mock('../../src/config/logging', () => ({
    getLogger: jest.fn(),
    createPerformanceLogger: jest.fn()
}));

describe('Checkpoint Pipeline E2E Test', () => {
    let dbManager;
    let cacheClient;
    let queueManager;
    let checkpointManager;
    let llmClient;
    let testDir;
    let runId;
    let mockLogger;

    beforeAll(async () => {
        // Setup test directory
        testDir = path.join(__dirname, `test-checkpoint-e2e-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });
        
        // Initialize real components
        dbManager = new DatabaseManager(path.join(testDir, 'test.db'));
        await dbManager.initializeDb();
        
        // Create a simple mock cache client for testing
        const cache = new Map();
        cacheClient = {
            get: async (key) => cache.get(key),
            set: async (key, value) => { cache.set(key, value); return 'OK'; },
            del: async (key) => { cache.delete(key); return 1; },
            setex: async (key, ttl, value) => { cache.set(key, value); return 'OK'; },
            expire: async (key, ttl) => 1,
            pipeline: () => ({
                set: jest.fn(),
                expire: jest.fn(),
                exec: jest.fn().mockResolvedValue([['OK'], [1]])
            }),
            connect: async () => {},
            disconnect: async () => {},
            close: async () => {}
        };
        
        queueManager = new QueueManager({ mock: true });
        await queueManager.initialize();
        
        // Setup mock logger
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            child: jest.fn(() => mockLogger),
            startTimer: jest.fn(() => ({
                end: jest.fn(() => ({ duration: 100 }))
            })),
            logMetrics: jest.fn(),
            logApiCall: jest.fn(),
            logDatabaseOperation: jest.fn()
        };
        getLogger.mockReturnValue(mockLogger);
        
        // Mock performance logger
        require('../../src/config/logging').createPerformanceLogger = jest.fn(() => ({
            start: jest.fn(),
            end: jest.fn(() => ({ duration: 100, memoryUsage: 50, cpuUsage: 30 }))
        }));
        
        // Initialize checkpoint manager
        checkpointManager = new CheckpointManager(dbManager, cacheClient);
        
        // Mock LLM client
        llmClient = {
            query: jest.fn()
        };
    });

    afterAll(async () => {
        await dbManager.close();
        await cacheClient.close();
        await fs.rm(testDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        runId = uuidv4();
        jest.clearAllMocks();
    });

    test('should process complete pipeline with checkpoints', async () => {
        // Create test files
        const testFile1 = path.join(testDir, 'component.js');
        await fs.writeFile(testFile1, `
            import { utils } from './utils';
            import React from 'react';
            
            export class MyComponent extends React.Component {
                constructor(props) {
                    super(props);
                    this.state = { count: 0 };
                }
                
                increment() {
                    this.setState({ count: this.state.count + 1 });
                    utils.log('Incremented');
                }
                
                render() {
                    return <div>{this.state.count}</div>;
                }
            }
            
            export function useCounter() {
                const [count, setCount] = React.useState(0);
                return { count, increment: () => setCount(count + 1) };
            }
        `);
        
        const testFile2 = path.join(testDir, 'utils.js');
        await fs.writeFile(testFile2, `
            export const utils = {
                log: (message) => console.log('[Utils]', message),
                format: (value) => String(value).padStart(2, '0'),
                calculate: (a, b) => a + b
            };
            
            export function helper() {
                return utils.format(42);
            }
        `);
        
        // Phase 1: File Analysis with Checkpoints
        const fileAnalysisWorker = new FileAnalysisWorker(
            queueManager,
            dbManager,
            cacheClient,
            llmClient,
            null,
            { processOnly: true }
        );
        
        // Mock LLM responses for file analysis
        llmClient.query
            .mockResolvedValueOnce(JSON.stringify({
                pois: [
                    { id: 'poi-1', name: 'MyComponent', type: 'ClassDefinition', start_line: 5, end_line: 18 },
                    { id: 'poi-2', name: 'constructor', type: 'FunctionDefinition', start_line: 6, end_line: 9 },
                    { id: 'poi-3', name: 'increment', type: 'FunctionDefinition', start_line: 11, end_line: 14 },
                    { id: 'poi-4', name: 'render', type: 'FunctionDefinition', start_line: 16, end_line: 18 },
                    { id: 'poi-5', name: 'useCounter', type: 'FunctionDefinition', start_line: 21, end_line: 24 },
                    { id: 'poi-6', name: 'utils', type: 'ImportStatement', start_line: 1, end_line: 1 },
                    { id: 'poi-7', name: 'React', type: 'ImportStatement', start_line: 2, end_line: 2 }
                ]
            }))
            .mockResolvedValueOnce(JSON.stringify({
                pois: [
                    { id: 'poi-8', name: 'utils', type: 'VariableDeclaration', start_line: 1, end_line: 5 },
                    { id: 'poi-9', name: 'helper', type: 'FunctionDefinition', start_line: 7, end_line: 9 }
                ]
            }));
        
        // Process files
        for (const file of [testFile1, testFile2]) {
            const fileCheckpoint = await checkpointManager.createCheckpoint({
                runId,
                stage: 'FILE_LOADED',
                entityId: file,
                metadata: {
                    filePath: file,
                    fileSize: (await fs.stat(file)).size
                }
            });
            
            const job = {
                id: uuidv4(),
                data: {
                    filePath: file,
                    runId,
                    jobId: uuidv4()
                }
            };
            
            const pois = await fileAnalysisWorker.process(job);
            
            // Validate and complete FILE_LOADED checkpoint
            const fileValidation = await checkpointManager.validateCheckpoint(fileCheckpoint);
            expect(fileValidation.valid).toBe(true);
            
            await checkpointManager.updateCheckpoint(fileCheckpoint.id, {
                status: 'COMPLETED',
                completedAt: new Date(),
                validationResult: fileValidation
            });
            
            // Create ENTITIES_EXTRACTED checkpoint
            const entitiesCheckpoint = await checkpointManager.createCheckpoint({
                runId,
                stage: 'ENTITIES_EXTRACTED',
                entityId: file,
                metadata: {
                    entityCount: pois.length,
                    entities: pois
                }
            });
            
            const entitiesValidation = await checkpointManager.validateCheckpoint(entitiesCheckpoint);
            expect(entitiesValidation.valid).toBe(true);
            
            await checkpointManager.updateCheckpoint(entitiesCheckpoint.id, {
                status: 'COMPLETED',
                completedAt: new Date(),
                validationResult: entitiesValidation
            });
        }
        
        // Phase 2: Relationship Resolution with Checkpoints
        const relationshipWorker = new RelationshipResolutionWorker(
            queueManager,
            dbManager,
            llmClient,
            null,
            { processOnly: true }
        );
        
        // Mock LLM responses for relationships
        llmClient.query
            .mockResolvedValueOnce(JSON.stringify({
                relationships: [
                    {
                        id: 'rel-1',
                        from: 'poi-3', // increment function
                        to: 'poi-8',    // utils object
                        type: 'USES',
                        evidence: 'increment() calls utils.log()'
                    }
                ]
            }))
            .mockResolvedValueOnce(JSON.stringify({
                relationships: [
                    {
                        id: 'rel-2',
                        from: 'poi-1', // MyComponent class
                        to: 'poi-7',   // React import
                        type: 'EXTENDS',
                        evidence: 'MyComponent extends React.Component'
                    }
                ]
            }));
        
        // Process relationships for key POIs
        const relationshipCheckpoints = [];
        const primaryPois = [
            { poi: { id: 'poi-3', name: 'increment' }, contextPois: [{ id: 'poi-8', name: 'utils' }] },
            { poi: { id: 'poi-1', name: 'MyComponent' }, contextPois: [{ id: 'poi-7', name: 'React' }] }
        ];
        
        for (const { poi, contextPois } of primaryPois) {
            const job = {
                id: uuidv4(),
                data: {
                    filePath: testFile1,
                    primaryPoi: poi,
                    contextualPois: contextPois,
                    runId,
                    jobId: uuidv4()
                }
            };
            
            const relationships = await relationshipWorker.process(job);
            
            // Create RELATIONSHIPS_BUILT checkpoint
            const relCheckpoint = await checkpointManager.createCheckpoint({
                runId,
                stage: 'RELATIONSHIPS_BUILT',
                entityId: `${testFile1}:${poi.id}`,
                metadata: {
                    relationshipCount: relationships?.length || 0,
                    relationships: relationships || []
                }
            });
            
            const relValidation = await checkpointManager.validateCheckpoint(relCheckpoint);
            expect(relValidation.valid).toBe(true);
            
            await checkpointManager.updateCheckpoint(relCheckpoint.id, {
                status: 'COMPLETED',
                completedAt: new Date(),
                validationResult: relValidation
            });
            
            relationshipCheckpoints.push(relCheckpoint);
        }
        
        // Phase 3: Simulate Neo4j Storage
        const neo4jCheckpoint = await checkpointManager.createCheckpoint({
            runId,
            stage: 'NEO4J_STORED',
            entityId: `batch-${runId}`,
            metadata: {
                nodesCreated: 9,  // Total POIs
                relationshipsCreated: 2, // Total relationships
                neo4jTransactionId: `tx-${uuidv4()}`
            }
        });
        
        const neo4jValidation = await checkpointManager.validateCheckpoint(neo4jCheckpoint);
        expect(neo4jValidation.valid).toBe(true);
        
        await checkpointManager.updateCheckpoint(neo4jCheckpoint.id, {
            status: 'COMPLETED',
            completedAt: new Date(),
            validationResult: neo4jValidation
        });
        
        // Phase 4: Pipeline Complete Checkpoint
        const summary = await checkpointManager.getRunSummary(runId);
        
        const completeCheckpoint = await checkpointManager.createCheckpoint({
            runId,
            stage: 'PIPELINE_COMPLETE',
            entityId: runId,
            metadata: {
                totalNodes: 9,
                totalRelationships: 2,
                totalFiles: 2,
                duration: 5000, // 5 seconds
                summary
            }
        });
        
        // This should fail benchmarks (not enough nodes/relationships)
        const completeValidation = await checkpointManager.validateCheckpoint(completeCheckpoint);
        expect(completeValidation.valid).toBe(false);
        expect(completeValidation.errors).toContain('Nodes benchmark not met: 9 < 300');
        expect(completeValidation.errors).toContain('Relationships benchmark not met: 2 < 1600');
        
        // Verify checkpoint summary
        const finalSummary = await checkpointManager.getRunSummary(runId);
        expect(finalSummary.stages).toMatchObject({
            FILE_LOADED: {
                completed: 2,
                failed: 0,
                successRate: 1.0
            },
            ENTITIES_EXTRACTED: {
                completed: 2,
                failed: 0,
                successRate: 1.0
            },
            RELATIONSHIPS_BUILT: {
                completed: 2,
                failed: 0,
                successRate: 1.0
            },
            NEO4J_STORED: {
                completed: 1,
                failed: 0,
                successRate: 1.0
            }
        });
        
        // Test rollback functionality
        const rollbackResult = await checkpointManager.rollbackToCheckpoint(
            neo4jCheckpoint.id,
            runId
        );
        
        expect(rollbackResult.invalidatedCheckpoints).toContain(completeCheckpoint.id);
        expect(rollbackResult.nextStage).toBe('PIPELINE_COMPLETE');
        
        // Verify performance overhead
        const overhead = await checkpointManager.calculateOverhead(runId);
        expect(overhead.overheadPercentage).toBeLessThan(5);
    });
    
    test('should handle checkpoint failures and recovery', async () => {
        const testFile = path.join(testDir, 'error-test.js');
        await fs.writeFile(testFile, 'function test() { return error; }');
        
        // Create initial checkpoint
        const fileCheckpoint = await checkpointManager.createCheckpoint({
            runId,
            stage: 'FILE_LOADED',
            entityId: testFile,
            metadata: { filePath: testFile }
        });
        
        // Simulate processing failure
        llmClient.query.mockRejectedValueOnce(new Error('LLM API error'));
        
        const fileAnalysisWorker = new FileAnalysisWorker(
            queueManager,
            dbManager,
            cacheClient,
            llmClient,
            null,
            { processOnly: true }
        );
        
        const job = {
            id: uuidv4(),
            data: {
                filePath: testFile,
                runId,
                jobId: uuidv4()
            }
        };
        
        // Process should fail
        await expect(fileAnalysisWorker.process(job)).rejects.toThrow('LLM API error');
        
        // Update checkpoint as failed
        await checkpointManager.updateCheckpoint(fileCheckpoint.id, {
            status: 'FAILED',
            failedAt: new Date(),
            error: 'LLM API error'
        });
        
        // Verify checkpoint status
        const failedCheckpoint = await checkpointManager.getCheckpoint(fileCheckpoint.id);
        expect(failedCheckpoint.status).toBe('FAILED');
        expect(failedCheckpoint.error).toBe('LLM API error');
        
        // Test recovery - retry with fixed mock
        llmClient.query.mockResolvedValueOnce(JSON.stringify({
            pois: [{ id: 'poi-1', name: 'test', type: 'FunctionDefinition', start_line: 1, end_line: 1 }]
        }));
        
        // Create new checkpoint for retry
        const retryCheckpoint = await checkpointManager.createCheckpoint({
            runId,
            stage: 'FILE_LOADED',
            entityId: testFile,
            metadata: { filePath: testFile, retryAttempt: 1 }
        });
        
        // Retry should succeed
        const result = await fileAnalysisWorker.process(job);
        expect(result).toHaveLength(1);
        
        // Update retry checkpoint
        await checkpointManager.updateCheckpoint(retryCheckpoint.id, {
            status: 'COMPLETED',
            completedAt: new Date()
        });
        
        // Verify recovery
        const summary = await checkpointManager.getRunSummary(runId);
        expect(summary.stages.FILE_LOADED).toMatchObject({
            completed: 1,
            failed: 1,
            total: 2
        });
    });
});