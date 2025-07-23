const { getLogger } = require('../config/logging');

/**
 * CheckpointAwareWorker - Base class that integrates checkpoint management into workers
 * Provides automatic checkpoint creation, validation, and recovery
 */
class CheckpointAwareWorker {
    constructor(workerType, checkpointManager, options = {}) {
        this.workerType = workerType;
        this.checkpointManager = checkpointManager;
        this.logger = getLogger(`CheckpointAware-${workerType}`);
        
        // Define stage mappings for different worker types
        this.stageMapping = {
            'file-analysis': {
                pre: 'FILE_LOADED',
                post: 'ENTITIES_EXTRACTED'
            },
            'directory-aggregation': {
                pre: null, // No pre-checkpoint
                post: null  // No post-checkpoint, just aggregation
            },
            'directory-resolution': {
                pre: null,
                post: null  // Directory summaries don't need checkpoints
            },
            'relationship-resolution': {
                pre: 'ENTITIES_EXTRACTED', // Requires entities
                post: 'RELATIONSHIPS_BUILT'
            },
            'neo4j-import': {
                pre: 'RELATIONSHIPS_BUILT', // Requires relationships
                post: 'NEO4J_STORED'
            },
            'pipeline-complete': {
                pre: 'NEO4J_STORED',
                post: 'PIPELINE_COMPLETE'
            }
        };
        
        this.options = {
            enableCheckpoints: true,
            validateBefore: true,
            validateAfter: true,
            retryOnFailure: true,
            maxRetries: 3,
            ...options
        };
    }
    
    /**
     * Wrap a worker's process method with checkpoint management
     */
    wrapProcess(originalProcess) {
        return async (job) => {
            const { runId, jobId } = job.data;
            const entityId = this.getEntityId(job);
            const stages = this.stageMapping[this.workerType] || {};
            
            const timer = this.logger.startTimer(`${this.workerType}-with-checkpoints`);
            
            try {
                // Pre-processing checkpoint validation
                if (this.options.validateBefore && stages.pre) {
                    await this.validatePrerequisites(runId, entityId, stages.pre);
                }
                
                // Create pre-processing checkpoint if defined
                let preCheckpoint;
                if (this.options.enableCheckpoints && stages.pre) {
                    preCheckpoint = await this.createCheckpoint(
                        runId,
                        stages.pre,
                        entityId,
                        { jobId, ...this.extractPreMetadata(job) }
                    );
                }
                
                // Execute original process
                let result;
                let error;
                let retryCount = 0;
                
                while (retryCount <= this.options.maxRetries) {
                    try {
                        result = await originalProcess.call(this, job);
                        break;
                    } catch (e) {
                        error = e;
                        retryCount++;
                        
                        if (retryCount > this.options.maxRetries || !this.options.retryOnFailure) {
                            throw e;
                        }
                        
                        this.logger.warn('Process failed, retrying', {
                            workerType: this.workerType,
                            jobId,
                            retryCount,
                            error: e.message
                        });
                        
                        // Exponential backoff
                        await new Promise(resolve => 
                            setTimeout(resolve, Math.pow(2, retryCount) * 1000)
                        );
                    }
                }
                
                // Update pre-checkpoint to completed
                if (preCheckpoint) {
                    const validationResult = await this.validateCheckpoint(preCheckpoint);
                    await this.updateCheckpoint(preCheckpoint.id, {
                        status: validationResult.valid ? 'COMPLETED' : 'FAILED',
                        completedAt: new Date(),
                        validationResult
                    });
                }
                
                // Create post-processing checkpoint if defined
                if (this.options.enableCheckpoints && stages.post) {
                    const postCheckpoint = await this.createCheckpoint(
                        runId,
                        stages.post,
                        entityId,
                        { 
                            jobId, 
                            ...this.extractPostMetadata(job, result),
                            processingTime: timer.end().duration
                        }
                    );
                    
                    // Validate post-checkpoint
                    if (this.options.validateAfter) {
                        const validationResult = await this.validateCheckpoint(postCheckpoint);
                        await this.updateCheckpoint(postCheckpoint.id, {
                            status: validationResult.valid ? 'COMPLETED' : 'FAILED',
                            completedAt: new Date(),
                            validationResult
                        });
                        
                        if (!validationResult.valid) {
                            this.logger.error('Post-processing validation failed', {
                                checkpointId: postCheckpoint.id,
                                validationResult
                            });
                        }
                    }
                }
                
                // Check if this completes the pipeline
                if (stages.post === 'NEO4J_STORED') {
                    await this.checkPipelineComplete(runId);
                }
                
                return result;
                
            } catch (error) {
                timer.end();
                
                // Mark any pending checkpoints as failed
                if (preCheckpoint && preCheckpoint.status === 'PENDING') {
                    await this.updateCheckpoint(preCheckpoint.id, {
                        status: 'FAILED',
                        failedAt: new Date(),
                        error: error.message
                    });
                }
                
                // Log checkpoint failure context
                this.logger.error('Worker process failed with checkpoints', {
                    error,
                    workerType: this.workerType,
                    jobId,
                    runId,
                    entityId
                });
                
                throw error;
            }
        };
    }
    
    /**
     * Get entity ID from job data based on worker type
     */
    getEntityId(job) {
        const { filePath, directoryPath, entityId, primaryPoi, runId } = job.data;
        
        switch (this.workerType) {
            case 'file-analysis':
                return filePath;
            case 'directory-aggregation':
            case 'directory-resolution':
                return directoryPath;
            case 'relationship-resolution':
                return primaryPoi ? `${filePath}:${primaryPoi.id}` : filePath;
            case 'neo4j-import':
                return entityId || `batch-${job.id}`;
            case 'pipeline-complete':
                return runId;
            default:
                return job.id;
        }
    }
    
    /**
     * Extract metadata before processing
     */
    extractPreMetadata(job) {
        const { filePath, directoryPath } = job.data;
        
        switch (this.workerType) {
            case 'file-analysis':
                return { filePath };
            case 'relationship-resolution':
                return { 
                    filePath,
                    primaryPoiId: job.data.primaryPoi?.id,
                    contextualPoisCount: job.data.contextualPois?.length || 0
                };
            default:
                return {};
        }
    }
    
    /**
     * Extract metadata after processing
     */
    extractPostMetadata(job, result) {
        switch (this.workerType) {
            case 'file-analysis':
                return {
                    entityCount: result?.length || 0,
                    entities: result
                };
            case 'relationship-resolution':
                return {
                    relationshipCount: result?.length || 0,
                    relationships: result
                };
            case 'neo4j-import':
                return {
                    nodesCreated: result?.nodesCreated || 0,
                    relationshipsCreated: result?.relationshipsCreated || 0,
                    neo4jTransactionId: result?.transactionId
                };
            default:
                return {};
        }
    }
    
    /**
     * Validate prerequisites before processing
     */
    async validatePrerequisites(runId, entityId, requiredStage) {
        const latestCheckpoint = await this.checkpointManager.getLatestCheckpoint(
            runId,
            entityId
        );
        
        if (!latestCheckpoint || latestCheckpoint.stage !== requiredStage) {
            throw new Error(
                `Missing prerequisite checkpoint: ${requiredStage} for entity ${entityId}`
            );
        }
        
        if (latestCheckpoint.status !== 'COMPLETED') {
            throw new Error(
                `Prerequisite checkpoint not completed: ${requiredStage} for entity ${entityId}`
            );
        }
    }
    
    /**
     * Check if pipeline is complete and create final checkpoint
     */
    async checkPipelineComplete(runId) {
        try {
            // Get pipeline statistics
            const summary = await this.checkpointManager.getRunSummary(runId);
            
            // Calculate totals from Neo4j stored checkpoints
            const neo4jCheckpoints = await this.checkpointManager.getCheckpointsByRunAndStage(
                runId,
                'NEO4J_STORED'
            );
            
            let totalNodes = 0;
            let totalRelationships = 0;
            
            for (const checkpoint of neo4jCheckpoints) {
                if (checkpoint.status === 'COMPLETED' && checkpoint.metadata) {
                    totalNodes += checkpoint.metadata.nodesCreated || 0;
                    totalRelationships += checkpoint.metadata.relationshipsCreated || 0;
                }
            }
            
            // Get pipeline start time
            const firstCheckpoint = await this.getFirstCheckpoint(runId);
            const duration = firstCheckpoint 
                ? Date.now() - new Date(firstCheckpoint.createdAt).getTime()
                : 0;
            
            // Create pipeline complete checkpoint
            const completeCheckpoint = await this.createCheckpoint(
                runId,
                'PIPELINE_COMPLETE',
                runId,
                {
                    totalNodes,
                    totalRelationships,
                    totalFiles: summary.stages.FILE_LOADED?.total || 0,
                    duration,
                    summary
                }
            );
            
            // Validate against benchmarks
            const validationResult = await this.validateCheckpoint(completeCheckpoint);
            
            await this.updateCheckpoint(completeCheckpoint.id, {
                status: validationResult.valid ? 'COMPLETED' : 'FAILED',
                completedAt: new Date(),
                validationResult
            });
            
            this.logger.info('Pipeline complete checkpoint created', {
                runId,
                valid: validationResult.valid,
                totalNodes,
                totalRelationships,
                duration
            });
            
        } catch (error) {
            this.logger.error('Failed to create pipeline complete checkpoint', {
                error,
                runId
            });
        }
    }
    
    /**
     * Get first checkpoint for a run
     */
    async getFirstCheckpoint(runId) {
        const db = this.checkpointManager.dbManager.getDb();
        const stmt = db.prepare(`
            SELECT * FROM checkpoints 
            WHERE run_id = ?
            ORDER BY created_at ASC
            LIMIT 1
        `);
        
        const row = stmt.get(runId);
        return row ? this.checkpointManager.parseCheckpointRow(row) : null;
    }
    
    // Delegate methods to checkpoint manager
    async createCheckpoint(...args) {
        return this.checkpointManager.createCheckpoint(...args);
    }
    
    async validateCheckpoint(...args) {
        return this.checkpointManager.validateCheckpoint(...args);
    }
    
    async updateCheckpoint(...args) {
        return this.checkpointManager.updateCheckpoint(...args);
    }
    
    /**
     * Create a checkpoint-aware worker factory
     */
    static createWorker(WorkerClass, workerType, checkpointManager, ...constructorArgs) {
        const worker = new WorkerClass(...constructorArgs);
        const checkpointAware = new CheckpointAwareWorker(workerType, checkpointManager);
        
        // Wrap the process method
        if (worker.process) {
            const originalProcess = worker.process.bind(worker);
            worker.process = checkpointAware.wrapProcess(originalProcess).bind(worker);
        }
        
        // Add checkpoint manager reference
        worker.checkpointManager = checkpointManager;
        
        return worker;
    }
}

module.exports = CheckpointAwareWorker;