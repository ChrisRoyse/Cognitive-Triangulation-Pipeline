const CheckpointManager = require('../../src/services/CheckpointManager');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const DirectoryAggregationWorker = require('../../src/workers/directoryAggregationWorker');
const DirectoryResolutionWorker = require('../../src/workers/directoryResolutionWorker');
const RelationshipResolutionWorker = require('../../src/workers/relationshipResolutionWorker');
const QueueManager = require('../../src/services/QueueManager');
const DBManager = require('../../src/services/DBManager');
const CacheClient = require('../../src/cache/CacheClient');
const LLMClient = require('../../src/llm/deepseekClient');
const { getLogger } = require('../../src/config/logging');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Mock the logger
jest.mock('../../src/config/logging', () => ({
    getLogger: jest.fn(),
    createPerformanceLogger: jest.fn()
}));

describe('CheckpointManager - Pipeline Integration Tests', () => {
    let checkpointManager;
    let dbManager;
    let cacheClient;
    let queueManager;
    let llmClient;
    let fileAnalysisWorker;
    let mockLogger;
    let testDir;
    let runId;

    beforeAll(async () => {
        // Setup test directory
        testDir = path.join(__dirname, `test-checkpoint-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });
        
        // Initialize real dependencies
        dbManager = new DBManager(':memory:'); // In-memory for tests
        await dbManager.initDB();
        
        cacheClient = new CacheClient({ mock: true }); // Mock mode for tests
        await cacheClient.connect();
        
        queueManager = new QueueManager({ mock: true });
        await queueManager.initialize();
        
        llmClient = {
            query: jest.fn().mockResolvedValue(JSON.stringify({
                pois: [
                    { name: 'TestClass', type: 'ClassDefinition', start_line: 1, end_line: 10 },
                    { name: 'testFunction', type: 'FunctionDefinition', start_line: 12, end_line: 20 }
                ]
            }))
        };
    });

    beforeEach(() => {
        runId = uuidv4();
        
        // Mock logger
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
        
        checkpointManager = new CheckpointManager(dbManager, cacheClient);
        
        // Initialize workers with checkpoint integration
        fileAnalysisWorker = new FileAnalysisWorker(
            queueManager,
            dbManager,
            cacheClient,
            llmClient,
            null,
            { processOnly: true, checkpointManager }
        );
    });

    afterAll(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
        await dbManager.close();
        await cacheClient.disconnect();
    });

    describe('File Analysis Checkpoint Integration', () => {
        test('should create FILE_LOADED checkpoint when file is processed', async () => {
            const testFile = path.join(testDir, 'test.js');
            await fs.writeFile(testFile, 'class TestClass { test() {} }');
            
            // Patch worker to use checkpoint manager
            fileAnalysisWorker.checkpointManager = checkpointManager;
            fileAnalysisWorker.process = async function(job) {
                const { filePath, runId, jobId } = job.data;
                
                // Create FILE_LOADED checkpoint
                const fileCheckpoint = await this.checkpointManager.createCheckpoint({
                    runId,
                    stage: 'FILE_LOADED',
                    entityId: filePath,
                    metadata: {
                        filePath,
                        fileSize: (await fs.stat(filePath)).size,
                        jobId
                    }
                });
                
                // Original processing logic
                const originalProcess = FileAnalysisWorker.prototype.process.bind(this);
                const result = await originalProcess(job);
                
                // Validate checkpoint
                const validationResult = await this.checkpointManager.validateCheckpoint(fileCheckpoint);
                
                // Update checkpoint status
                await this.checkpointManager.updateCheckpoint(fileCheckpoint.id, {
                    status: validationResult.valid ? 'COMPLETED' : 'FAILED',
                    completedAt: new Date(),
                    validationResult
                });
                
                return result;
            }.bind(fileAnalysisWorker);
            
            // Process file
            const job = {
                id: 'job-123',
                data: {
                    filePath: testFile,
                    runId,
                    jobId: 'job-123'
                }
            };
            
            await fileAnalysisWorker.process(job);
            
            // Verify checkpoint was created and validated
            const checkpoints = await checkpointManager.getCheckpointsByRunAndStage(runId, 'FILE_LOADED');
            expect(checkpoints).toHaveLength(1);
            expect(checkpoints[0]).toMatchObject({
                stage: 'FILE_LOADED',
                status: 'COMPLETED',
                entityId: testFile,
                metadata: expect.objectContaining({
                    filePath: testFile,
                    fileSize: expect.any(Number)
                })
            });
        });

        test('should create ENTITIES_EXTRACTED checkpoint after LLM analysis', async () => {
            const testFile = path.join(testDir, 'test2.js');
            await fs.writeFile(testFile, 'class TestClass { test() {} }');
            
            // Enhanced LLM response
            llmClient.query.mockResolvedValueOnce(JSON.stringify({
                pois: [
                    { name: 'TestClass', type: 'ClassDefinition', start_line: 1, end_line: 10 },
                    { name: 'testMethod', type: 'FunctionDefinition', start_line: 3, end_line: 8 },
                    { name: 'helper', type: 'FunctionDefinition', start_line: 12, end_line: 15 }
                ]
            }));
            
            // Patch worker to create entities checkpoint
            fileAnalysisWorker.checkpointManager = checkpointManager;
            const originalParseResponse = fileAnalysisWorker.parseResponse.bind(fileAnalysisWorker);
            
            fileAnalysisWorker.parseResponse = function(response) {
                const pois = originalParseResponse(response);
                
                // Create checkpoint asynchronously after parsing
                setImmediate(async () => {
                    if (pois.length > 0 && this.currentJobData) {
                        const checkpoint = await this.checkpointManager.createCheckpoint({
                            runId: this.currentJobData.runId,
                            stage: 'ENTITIES_EXTRACTED',
                            entityId: this.currentJobData.filePath,
                            metadata: {
                                entityCount: pois.length,
                                entities: pois,
                                jobId: this.currentJobData.jobId
                            }
                        });
                        
                        const validationResult = await this.checkpointManager.validateCheckpoint(checkpoint);
                        await this.checkpointManager.updateCheckpoint(checkpoint.id, {
                            status: validationResult.valid ? 'COMPLETED' : 'FAILED',
                            completedAt: new Date(),
                            validationResult
                        });
                    }
                });
                
                return pois;
            }.bind(fileAnalysisWorker);
            
            // Store job data for checkpoint creation
            const originalProcess = fileAnalysisWorker.process.bind(fileAnalysisWorker);
            fileAnalysisWorker.process = async function(job) {
                this.currentJobData = job.data;
                const result = await originalProcess(job);
                delete this.currentJobData;
                return result;
            }.bind(fileAnalysisWorker);
            
            const job = {
                id: 'job-456',
                data: {
                    filePath: testFile,
                    runId,
                    jobId: 'job-456'
                }
            };
            
            await fileAnalysisWorker.process(job);
            
            // Wait for async checkpoint creation
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify entities checkpoint
            const checkpoints = await checkpointManager.getCheckpointsByRunAndStage(runId, 'ENTITIES_EXTRACTED');
            expect(checkpoints).toHaveLength(1);
            expect(checkpoints[0]).toMatchObject({
                stage: 'ENTITIES_EXTRACTED',
                status: 'COMPLETED',
                metadata: expect.objectContaining({
                    entityCount: 3,
                    entities: expect.arrayContaining([
                        expect.objectContaining({ name: 'TestClass' })
                    ])
                })
            });
        });
    });

    describe('Relationship Resolution Checkpoint Integration', () => {
        test('should create RELATIONSHIPS_BUILT checkpoint', async () => {
            const relationshipWorker = new RelationshipResolutionWorker(
                queueManager,
                dbManager,
                llmClient,
                null,
                { processOnly: true }
            );
            
            relationshipWorker.checkpointManager = checkpointManager;
            
            // Mock LLM response for relationships
            llmClient.query.mockResolvedValueOnce(JSON.stringify({
                relationships: [
                    {
                        id: 'rel-1',
                        from: 'poi-1',
                        to: 'poi-2',
                        type: 'CALLS',
                        evidence: 'Function calls another function'
                    },
                    {
                        id: 'rel-2',
                        from: 'poi-1',
                        to: 'poi-3',
                        type: 'IMPORTS',
                        evidence: 'Function imports module'
                    }
                ]
            }));
            
            // Patch worker to create checkpoint
            const originalParseResponse = relationshipWorker.parseResponse.bind(relationshipWorker);
            relationshipWorker.currentJobPath = 'test.js'; // Set for error handling
            
            relationshipWorker.parseResponse = function(response) {
                const relationships = originalParseResponse(response);
                
                // Create checkpoint asynchronously
                if (this.currentJobData) {
                    setImmediate(async () => {
                        const checkpoint = await this.checkpointManager.createCheckpoint({
                            runId: this.currentJobData.runId,
                            stage: 'RELATIONSHIPS_BUILT',
                            entityId: this.currentJobData.filePath,
                            metadata: {
                                relationshipCount: relationships.length,
                                relationships,
                                primaryPoiId: this.currentJobData.primaryPoi.id,
                                jobId: this.currentJobData.jobId
                            }
                        });
                        
                        const validationResult = await this.checkpointManager.validateCheckpoint(checkpoint);
                        await this.checkpointManager.updateCheckpoint(checkpoint.id, {
                            status: validationResult.valid ? 'COMPLETED' : 'FAILED',
                            completedAt: new Date(),
                            validationResult
                        });
                    });
                }
                
                return relationships;
            }.bind(relationshipWorker);
            
            // Store job data for checkpoint
            const originalProcess = relationshipWorker.process.bind(relationshipWorker);
            relationshipWorker.process = async function(job) {
                this.currentJobData = job.data;
                const result = await originalProcess(job);
                delete this.currentJobData;
                return result;
            }.bind(relationshipWorker);
            
            const job = {
                id: 'job-789',
                data: {
                    filePath: 'test.js',
                    primaryPoi: { id: 'poi-1', name: 'testFunction' },
                    contextualPois: [
                        { id: 'poi-2', name: 'helperFunction' },
                        { id: 'poi-3', name: 'utilModule' }
                    ],
                    runId,
                    jobId: 'job-789'
                }
            };
            
            await relationshipWorker.process(job);
            
            // Wait for async checkpoint
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify relationships checkpoint
            const checkpoints = await checkpointManager.getCheckpointsByRunAndStage(runId, 'RELATIONSHIPS_BUILT');
            expect(checkpoints).toHaveLength(1);
            expect(checkpoints[0]).toMatchObject({
                stage: 'RELATIONSHIPS_BUILT',
                status: 'COMPLETED',
                metadata: expect.objectContaining({
                    relationshipCount: 2,
                    relationships: expect.arrayContaining([
                        expect.objectContaining({ type: 'CALLS' }),
                        expect.objectContaining({ type: 'IMPORTS' })
                    ])
                })
            });
        });
    });

    describe('Pipeline Complete Checkpoint', () => {
        test('should validate complete pipeline against benchmarks', async () => {
            // Create a pipeline complete checkpoint
            const checkpoint = await checkpointManager.createCheckpoint({
                runId,
                stage: 'PIPELINE_COMPLETE',
                entityId: runId,
                metadata: {
                    totalNodes: 320,
                    totalRelationships: 1650,
                    totalFiles: 45,
                    duration: 55000
                }
            });
            
            // Validate against benchmarks
            const validationResult = await checkpointManager.validateCheckpoint(checkpoint);
            
            expect(validationResult).toMatchObject({
                valid: true,
                validations: {
                    nodesBenchmarkMet: true,
                    relationshipsBenchmarkMet: true,
                    performanceBenchmarkMet: true
                },
                benchmarks: {
                    requiredNodes: 300,
                    requiredRelationships: 1600,
                    actualNodes: 320,
                    actualRelationships: 1650
                }
            });
            
            // Update checkpoint
            await checkpointManager.updateCheckpoint(checkpoint.id, {
                status: 'COMPLETED',
                completedAt: new Date(),
                validationResult
            });
            
            // Get run summary
            const summary = await checkpointManager.getRunSummary(runId);
            expect(summary).toMatchObject({
                runId,
                stages: expect.objectContaining({
                    PIPELINE_COMPLETE: expect.objectContaining({
                        completed: 1,
                        failed: 0,
                        successRate: 1.0
                    })
                })
            });
        });

        test('should fail validation when benchmarks not met', async () => {
            const checkpoint = await checkpointManager.createCheckpoint({
                runId,
                stage: 'PIPELINE_COMPLETE',
                entityId: runId,
                metadata: {
                    totalNodes: 250, // Below 300
                    totalRelationships: 1400, // Below 1600
                    totalFiles: 40,
                    duration: 65000 // Above 60 seconds
                }
            });
            
            const validationResult = await checkpointManager.validateCheckpoint(checkpoint);
            
            expect(validationResult.valid).toBe(false);
            expect(validationResult.errors).toEqual(expect.arrayContaining([
                expect.stringContaining('Nodes benchmark not met'),
                expect.stringContaining('Relationships benchmark not met'),
                expect.stringContaining('Performance benchmark not met')
            ]));
        });
    });

    describe('Rollback and Recovery', () => {
        test('should rollback failed pipeline stages', async () => {
            // Create successful checkpoints
            const checkpoint1 = await checkpointManager.createCheckpoint({
                runId,
                stage: 'FILE_LOADED',
                entityId: 'file1.js'
            });
            await checkpointManager.updateCheckpoint(checkpoint1.id, {
                status: 'COMPLETED',
                completedAt: new Date()
            });
            
            const checkpoint2 = await checkpointManager.createCheckpoint({
                runId,
                stage: 'ENTITIES_EXTRACTED',
                entityId: 'file1.js'
            });
            await checkpointManager.updateCheckpoint(checkpoint2.id, {
                status: 'COMPLETED',
                completedAt: new Date()
            });
            
            // Create failed checkpoint
            const checkpoint3 = await checkpointManager.createCheckpoint({
                runId,
                stage: 'RELATIONSHIPS_BUILT',
                entityId: 'file1.js'
            });
            await checkpointManager.updateCheckpoint(checkpoint3.id, {
                status: 'FAILED',
                failedAt: new Date(),
                error: 'LLM API error'
            });
            
            // Rollback to last successful checkpoint
            const rollbackResult = await checkpointManager.rollbackToCheckpoint(
                checkpoint2.id,
                runId
            );
            
            expect(rollbackResult).toMatchObject({
                rolledBackTo: checkpoint2.id,
                invalidatedCheckpoints: [checkpoint3.id],
                nextStage: 'RELATIONSHIPS_BUILT'
            });
            
            // Verify checkpoint was invalidated
            const invalidated = await checkpointManager.getCheckpoint(checkpoint3.id);
            expect(invalidated.status).toBe('INVALIDATED');
        });
    });

    describe('Performance Overhead', () => {
        test('should maintain low checkpoint overhead', async () => {
            // Create multiple checkpoints to simulate pipeline
            const stages = ['FILE_LOADED', 'ENTITIES_EXTRACTED', 'RELATIONSHIPS_BUILT'];
            
            for (let i = 0; i < 10; i++) {
                for (const stage of stages) {
                    const checkpoint = await checkpointManager.createCheckpoint({
                        runId,
                        stage,
                        entityId: `file${i}.js`
                    });
                    
                    // Simulate processing time
                    await new Promise(resolve => setTimeout(resolve, 10));
                    
                    await checkpointManager.updateCheckpoint(checkpoint.id, {
                        status: 'COMPLETED',
                        completedAt: new Date()
                    });
                }
            }
            
            const overhead = await checkpointManager.calculateOverhead(runId);
            
            // Overhead should be less than 5%
            expect(overhead.overheadPercentage).toBeLessThan(5);
            expect(overhead.totalCheckpointTime).toBeGreaterThan(0);
            expect(overhead.totalPipelineTime).toBeGreaterThan(0);
        });
    });

    describe('Checkpoint Cleanup', () => {
        test('should clean up old checkpoints', async () => {
            // Create old checkpoint
            const oldCheckpoint = await checkpointManager.createCheckpoint({
                runId: 'old-run',
                stage: 'FILE_LOADED',
                entityId: 'old-file.js'
            });
            
            // Manually update created_at to be old
            const db = dbManager.getDb();
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 10);
            
            db.prepare('UPDATE checkpoints SET created_at = ? WHERE id = ?')
                .run(oldDate.toISOString(), oldCheckpoint.id);
            
            // Clean up checkpoints older than 7 days
            const result = await checkpointManager.cleanupOldCheckpoints(7);
            
            expect(result.deletedCount).toBe(1);
            
            // Verify checkpoint was deleted
            const deleted = await checkpointManager.getCheckpoint(oldCheckpoint.id);
            expect(deleted).toBeNull();
        });
    });
});