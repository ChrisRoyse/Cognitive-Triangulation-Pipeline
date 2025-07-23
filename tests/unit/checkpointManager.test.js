const CheckpointManager = require('../../src/services/CheckpointManager');
const { getLogger } = require('../../src/config/logging');

// Mock the logger
jest.mock('../../src/config/logging', () => ({
    getLogger: jest.fn()
}));

describe('CheckpointManager - Unit Tests', () => {
    let checkpointManager;
    let dbManager;
    let cacheClient;
    let mockLogger;
    let mockDb;
    let mockStmt;

    beforeEach(() => {
        // Mock logger
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            child: jest.fn(() => mockLogger),
            startTimer: jest.fn(() => ({
                end: jest.fn(() => ({ duration: 100 }))
            }))
        };
        getLogger.mockReturnValue(mockLogger);

        // Mock database
        mockStmt = {
            run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
            get: jest.fn(),
            all: jest.fn()
        };
        
        mockDb = {
            prepare: jest.fn().mockReturnValue(mockStmt)
        };
        
        dbManager = {
            getDb: jest.fn().mockReturnValue(mockDb)
        };

        // Mock cache client
        cacheClient = {
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn().mockResolvedValue(null),
            del: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            pipeline: jest.fn(() => ({
                set: jest.fn(),
                expire: jest.fn(),
                exec: jest.fn().mockResolvedValue([['OK'], [1]])
            }))
        };

        checkpointManager = new CheckpointManager(dbManager, cacheClient);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Checkpoint Creation', () => {
        test('should create a new checkpoint with valid data', async () => {
            const checkpoint = await checkpointManager.createCheckpoint({
                runId: 'test-run-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123',
                metadata: { filePath: '/test/file.js', size: 1024 }
            });

            expect(checkpoint).toMatchObject({
                id: expect.any(String),
                runId: 'test-run-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123',
                status: 'PENDING',
                metadata: { filePath: '/test/file.js', size: 1024 },
                createdAt: expect.any(Date)
            });

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO checkpoints')
            );
            expect(mockStmt.run).toHaveBeenCalled();
        });

        test('should reject invalid checkpoint stages', async () => {
            await expect(
                checkpointManager.createCheckpoint({
                    runId: 'test-run-123',
                    stage: 'INVALID_STAGE',
                    entityId: 'file-123'
                })
            ).rejects.toThrow('Invalid checkpoint stage: INVALID_STAGE');
        });

        test('should require all mandatory fields', async () => {
            await expect(
                checkpointManager.createCheckpoint({
                    runId: 'test-run-123',
                    stage: 'FILE_LOADED'
                    // Missing entityId
                })
            ).rejects.toThrow('Missing required field: entityId');
        });

        test('should cache checkpoint data for fast retrieval', async () => {
            const checkpoint = await checkpointManager.createCheckpoint({
                runId: 'test-run-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123'
            });

            expect(cacheClient.pipeline).toHaveBeenCalled();
            const pipeline = cacheClient.pipeline();
            expect(pipeline.set).toHaveBeenCalled();
            expect(pipeline.expire).toHaveBeenCalledWith(
                expect.any(String),
                3600 // 1 hour TTL
            );
        });
    });

    describe('Checkpoint Validation', () => {
        test('should validate FILE_LOADED checkpoint', async () => {
            const result = await checkpointManager.validateCheckpoint({
                id: 'checkpoint-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123',
                metadata: { filePath: '/test/file.js', fileSize: 1024 }
            });

            expect(result).toMatchObject({
                valid: true,
                stage: 'FILE_LOADED',
                validations: {
                    fileExists: true,
                    fileReadable: true,
                    fileSizeValid: true
                }
            });
        });

        test('should validate ENTITIES_EXTRACTED checkpoint', async () => {
            const result = await checkpointManager.validateCheckpoint({
                id: 'checkpoint-123',
                stage: 'ENTITIES_EXTRACTED',
                entityId: 'file-123',
                metadata: {
                    entityCount: 15,
                    entities: [
                        { id: 'e1', type: 'Class', name: 'TestClass' },
                        { id: 'e2', type: 'Function', name: 'testFunction' }
                    ]
                }
            });

            expect(result).toMatchObject({
                valid: true,
                stage: 'ENTITIES_EXTRACTED',
                validations: {
                    hasEntities: true,
                    entityStructureValid: true,
                    minimumEntitiesFound: true
                }
            });
        });

        test('should validate RELATIONSHIPS_BUILT checkpoint', async () => {
            const result = await checkpointManager.validateCheckpoint({
                id: 'checkpoint-123',
                stage: 'RELATIONSHIPS_BUILT',
                entityId: 'file-123',
                metadata: {
                    relationshipCount: 25,
                    relationships: [
                        { from: 'e1', to: 'e2', type: 'CALLS' },
                        { from: 'e2', to: 'e3', type: 'IMPORTS' }
                    ]
                }
            });

            expect(result).toMatchObject({
                valid: true,
                stage: 'RELATIONSHIPS_BUILT',
                validations: {
                    hasRelationships: true,
                    relationshipStructureValid: true,
                    relationshipTypesValid: true
                }
            });
        });

        test('should validate NEO4J_STORED checkpoint', async () => {
            const result = await checkpointManager.validateCheckpoint({
                id: 'checkpoint-123',
                stage: 'NEO4J_STORED',
                entityId: 'batch-123',
                metadata: {
                    nodesCreated: 50,
                    relationshipsCreated: 100,
                    neo4jTransactionId: 'tx-123'
                }
            });

            expect(result).toMatchObject({
                valid: true,
                stage: 'NEO4J_STORED',
                validations: {
                    storageSuccessful: true,
                    nodeCountValid: true,
                    relationshipCountValid: true
                }
            });
        });

        test('should validate PIPELINE_COMPLETE checkpoint against benchmarks', async () => {
            const result = await checkpointManager.validateCheckpoint({
                id: 'checkpoint-123',
                stage: 'PIPELINE_COMPLETE',
                entityId: 'run-123',
                metadata: {
                    totalNodes: 350,
                    totalRelationships: 1800,
                    totalFiles: 50,
                    duration: 45000
                }
            });

            expect(result).toMatchObject({
                valid: true,
                stage: 'PIPELINE_COMPLETE',
                validations: {
                    nodesBenchmarkMet: true,
                    relationshipsBenchmarkMet: true,
                    performanceBenchmarkMet: true
                },
                benchmarks: {
                    requiredNodes: 300,
                    requiredRelationships: 1600,
                    actualNodes: 350,
                    actualRelationships: 1800
                }
            });
        });

        test('should fail validation when benchmarks not met', async () => {
            const result = await checkpointManager.validateCheckpoint({
                id: 'checkpoint-123',
                stage: 'PIPELINE_COMPLETE',
                entityId: 'run-123',
                metadata: {
                    totalNodes: 250, // Below 300
                    totalRelationships: 1400, // Below 1600
                    totalFiles: 50,
                    duration: 120000 // Above 60 seconds
                }
            });

            expect(result).toMatchObject({
                valid: false,
                stage: 'PIPELINE_COMPLETE',
                validations: {
                    nodesBenchmarkMet: false,
                    relationshipsBenchmarkMet: false,
                    performanceBenchmarkMet: false
                },
                errors: expect.arrayContaining([
                    expect.stringContaining('Nodes benchmark not met'),
                    expect.stringContaining('Relationships benchmark not met'),
                    expect.stringContaining('Performance benchmark not met')
                ])
            });
        });
    });

    describe('Checkpoint Updates', () => {
        test('should update checkpoint status to COMPLETED', async () => {
            const updated = await checkpointManager.updateCheckpoint(
                'checkpoint-123',
                {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    validationResult: { valid: true }
                }
            );

            expect(updated).toMatchObject({
                id: 'checkpoint-123',
                status: 'COMPLETED',
                completedAt: expect.any(Date),
                validationResult: { valid: true }
            });

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE checkpoints')
            );
        });

        test('should update checkpoint status to FAILED with error', async () => {
            const error = new Error('Validation failed');
            const updated = await checkpointManager.updateCheckpoint(
                'checkpoint-123',
                {
                    status: 'FAILED',
                    error: error.message,
                    failedAt: new Date()
                }
            );

            expect(updated).toMatchObject({
                id: 'checkpoint-123',
                status: 'FAILED',
                error: 'Validation failed',
                failedAt: expect.any(Date)
            });
        });

        test('should update cache when checkpoint is updated', async () => {
            await checkpointManager.updateCheckpoint(
                'checkpoint-123',
                { status: 'COMPLETED' }
            );

            expect(cacheClient.pipeline).toHaveBeenCalled();
        });
    });

    describe('Checkpoint Queries', () => {
        test('should get checkpoint by ID from cache first', async () => {
            const cachedData = JSON.stringify({
                id: 'checkpoint-123',
                stage: 'FILE_LOADED',
                status: 'COMPLETED'
            });
            cacheClient.get.mockResolvedValueOnce(cachedData);

            const checkpoint = await checkpointManager.getCheckpoint('checkpoint-123');

            expect(cacheClient.get).toHaveBeenCalledWith('checkpoint:checkpoint-123');
            expect(checkpoint).toMatchObject({
                id: 'checkpoint-123',
                stage: 'FILE_LOADED',
                status: 'COMPLETED'
            });
            expect(mockDb.prepare).not.toHaveBeenCalled();
        });

        test('should get checkpoint from database if not in cache', async () => {
            cacheClient.get.mockResolvedValueOnce(null);
            mockStmt.get.mockReturnValueOnce({
                id: 'checkpoint-123',
                stage: 'FILE_LOADED',
                status: 'COMPLETED',
                metadata: '{"filePath":"/test/file.js"}'
            });

            const checkpoint = await checkpointManager.getCheckpoint('checkpoint-123');

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM checkpoints WHERE id = ?')
            );
            expect(checkpoint).toMatchObject({
                id: 'checkpoint-123',
                stage: 'FILE_LOADED',
                status: 'COMPLETED',
                metadata: { filePath: '/test/file.js' }
            });
        });

        test('should get checkpoints by run ID and stage', async () => {
            mockStmt.all.mockReturnValueOnce([
                {
                    id: 'checkpoint-1',
                    stage: 'FILE_LOADED',
                    status: 'COMPLETED',
                    metadata: '{}'
                },
                {
                    id: 'checkpoint-2',
                    stage: 'FILE_LOADED',
                    status: 'FAILED',
                    metadata: '{}'
                }
            ]);

            const checkpoints = await checkpointManager.getCheckpointsByRunAndStage(
                'run-123',
                'FILE_LOADED'
            );

            expect(checkpoints).toHaveLength(2);
            expect(checkpoints[0]).toMatchObject({
                id: 'checkpoint-1',
                status: 'COMPLETED'
            });
            expect(checkpoints[1]).toMatchObject({
                id: 'checkpoint-2',
                status: 'FAILED'
            });
        });

        test('should get latest checkpoint for entity', async () => {
            mockStmt.get.mockReturnValueOnce({
                id: 'checkpoint-latest',
                stage: 'ENTITIES_EXTRACTED',
                status: 'COMPLETED',
                metadata: '{}'
            });

            const checkpoint = await checkpointManager.getLatestCheckpoint(
                'run-123',
                'file-123'
            );

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY created_at DESC LIMIT 1')
            );
            expect(checkpoint).toMatchObject({
                id: 'checkpoint-latest',
                stage: 'ENTITIES_EXTRACTED'
            });
        });
    });

    describe('Rollback Functionality', () => {
        test('should rollback to previous checkpoint', async () => {
            // Mock getting checkpoints after failed one
            mockStmt.all.mockReturnValueOnce([
                {
                    id: 'checkpoint-3',
                    stage: 'RELATIONSHIPS_BUILT',
                    status: 'COMPLETED',
                    created_at: '2024-01-01T03:00:00Z',
                    metadata: '{}'
                },
                {
                    id: 'checkpoint-4',
                    stage: 'NEO4J_STORED',
                    status: 'FAILED',
                    created_at: '2024-01-01T04:00:00Z',
                    metadata: '{}'
                }
            ]);

            const result = await checkpointManager.rollbackToCheckpoint(
                'checkpoint-2',
                'run-123'
            );

            expect(result).toMatchObject({
                rolledBackTo: 'checkpoint-2',
                invalidatedCheckpoints: ['checkpoint-3', 'checkpoint-4'],
                nextStage: 'RELATIONSHIPS_BUILT'
            });

            // Verify invalidated checkpoints were updated
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE checkpoints SET status = ?')
            );
        });

        test('should clear cache for invalidated checkpoints', async () => {
            mockStmt.all.mockReturnValueOnce([
                { id: 'checkpoint-3', metadata: '{}' }
            ]);

            await checkpointManager.rollbackToCheckpoint('checkpoint-2', 'run-123');

            expect(cacheClient.del).toHaveBeenCalledWith('checkpoint:checkpoint-3');
        });
    });

    describe('Performance Tracking', () => {
        test('should track checkpoint performance metrics', async () => {
            const checkpoint = await checkpointManager.createCheckpoint({
                runId: 'test-run-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123',
                metadata: {
                    startTime: Date.now() - 1000,
                    endTime: Date.now(),
                    duration: 1000
                }
            });

            expect(checkpoint.metadata).toMatchObject({
                duration: 1000
            });

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Checkpoint created'),
                expect.objectContaining({
                    stage: 'FILE_LOADED',
                    duration: 1000
                })
            );
        });

        test('should calculate overhead percentage', async () => {
            const overhead = await checkpointManager.calculateOverhead('run-123');

            expect(overhead).toMatchObject({
                totalCheckpointTime: expect.any(Number),
                totalPipelineTime: expect.any(Number),
                overheadPercentage: expect.any(Number)
            });

            expect(overhead.overheadPercentage).toBeLessThan(5); // Less than 5% overhead
        });
    });

    describe('Cleanup Operations', () => {
        test('should clean up old checkpoints', async () => {
            mockStmt.run.mockReturnValueOnce({ changes: 10 });

            const result = await checkpointManager.cleanupOldCheckpoints(7); // 7 days

            expect(result).toEqual({
                deletedCount: 10,
                olderThan: 7
            });

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM checkpoints WHERE created_at < ?')
            );
        });

        test('should clean up checkpoints for a specific run', async () => {
            mockStmt.all.mockReturnValueOnce([
                { id: 'checkpoint-1' },
                { id: 'checkpoint-2' }
            ]);

            await checkpointManager.cleanupRunCheckpoints('run-123');

            expect(cacheClient.del).toHaveBeenCalledWith('checkpoint:checkpoint-1');
            expect(cacheClient.del).toHaveBeenCalledWith('checkpoint:checkpoint-2');
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM checkpoints WHERE run_id = ?')
            );
        });
    });

    describe('Batch Operations', () => {
        test('should create multiple checkpoints in batch', async () => {
            const checkpoints = [
                {
                    runId: 'run-123',
                    stage: 'FILE_LOADED',
                    entityId: 'file-1'
                },
                {
                    runId: 'run-123',
                    stage: 'FILE_LOADED',
                    entityId: 'file-2'
                }
            ];

            const results = await checkpointManager.createBatchCheckpoints(checkpoints);

            expect(results).toHaveLength(2);
            expect(results[0]).toMatchObject({
                stage: 'FILE_LOADED',
                entityId: 'file-1'
            });
            expect(results[1]).toMatchObject({
                stage: 'FILE_LOADED',
                entityId: 'file-2'
            });
        });

        test('should validate multiple checkpoints in batch', async () => {
            const checkpoints = [
                {
                    id: 'checkpoint-1',
                    stage: 'FILE_LOADED',
                    metadata: { filePath: '/test/file1.js' }
                },
                {
                    id: 'checkpoint-2',
                    stage: 'ENTITIES_EXTRACTED',
                    metadata: { entityCount: 10 }
                }
            ];

            const results = await checkpointManager.validateBatchCheckpoints(checkpoints);

            expect(results).toHaveLength(2);
            expect(results[0]).toMatchObject({
                checkpointId: 'checkpoint-1',
                valid: true
            });
            expect(results[1]).toMatchObject({
                checkpointId: 'checkpoint-2',
                valid: true
            });
        });
    });

    describe('Integration Points', () => {
        test('should integrate with worker context', async () => {
            const workerContext = {
                jobId: 'job-123',
                runId: 'run-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123'
            };

            const checkpoint = await checkpointManager.createFromWorkerContext(workerContext);

            expect(checkpoint).toMatchObject({
                runId: 'run-123',
                stage: 'FILE_LOADED',
                entityId: 'file-123',
                metadata: expect.objectContaining({
                    jobId: 'job-123'
                })
            });
        });

        test('should provide checkpoint status summary', async () => {
            mockStmt.all.mockReturnValueOnce([
                { stage: 'FILE_LOADED', status: 'COMPLETED', count: 10 },
                { stage: 'FILE_LOADED', status: 'FAILED', count: 2 },
                { stage: 'ENTITIES_EXTRACTED', status: 'COMPLETED', count: 8 }
            ]);

            const summary = await checkpointManager.getRunSummary('run-123');

            expect(summary).toMatchObject({
                runId: 'run-123',
                stages: {
                    FILE_LOADED: {
                        completed: 10,
                        failed: 2,
                        total: 12,
                        successRate: expect.closeTo(0.833, 2)
                    },
                    ENTITIES_EXTRACTED: {
                        completed: 8,
                        failed: 0,
                        total: 8,
                        successRate: 1.0
                    }
                },
                overallProgress: expect.any(Number)
            });
        });
    });
});