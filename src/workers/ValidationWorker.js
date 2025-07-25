const { Worker } = require('bullmq');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');

class ValidationWorker {
    constructor(queueManager, dbManager, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.workerPoolManager = workerPoolManager;
        this.reconciliationQueue = this.queueManager.getQueue('reconciliation-queue');
        
        // Use centralized configuration
        this.config = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = this.config.getWorkerLimit('validation');

        // Note: ValidationWorker Redis coordination disabled for no-cache pipeline

        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('analysis-findings-queue', workerPoolManager, {
                    workerType: 'validation',
                    baseConcurrency: Math.min(5, workerLimit), // Can handle more validation tasks
                    maxConcurrency: workerLimit,
                    minConcurrency: 1,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: 15, // Higher rate for validation
                    // rateLimitWindow: 1000,
                    failureThreshold: 10, // Increased from 5 to be less aggressive
                    resetTimeout: 60000,
                    jobTimeout: 150000, // 2.5 minutes for validation (aligned with ManagedWorker default)
                    retryAttempts: 2, // Reduced from 3 to 2 for alignment
                    retryDelay: 3000, // Reduced from 8000 to 3000 for faster retries
                    ...options
                });
                
                // Don't initialize here - let it be initialized explicitly
                console.log('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('analysis-findings-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: workerLimit // Use centralized config
                });
            }
        }
    }

    async initializeWorker() {
        try {
            await this.managedWorker.initialize(
                this.queueManager.connection,
                this.process.bind(this)
            );
            
            console.log('✅ ValidationWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize ValidationWorker:', error);
            throw error;
        }
    }

    async close() {
        if (this.managedWorker) {
            await this.managedWorker.shutdown();
        } else if (this.worker) {
            await this.worker.close();
        }
    }

    async process(job) {
        if (job.name === 'validate-relationships-batch') {
            await this.processBatch(job);
        } else {
            console.warn(`[ValidationWorker] Received legacy job format: ${job.name}. Skipping.`);
        }
    }

    async processBatch(job) {
        const { runId, relationships } = job.data;
        if (!relationships || relationships.length === 0) {
            return;
        }

        console.log(`[ValidationWorker] Processing batch of ${relationships.length} findings for run ${runId}`);

        const db = this.dbManager.getDb();
        // const redis = this.cacheClient; // Disabled for no-cache pipeline

        // 1. Batch insert all evidence into SQLite in a single transaction
        const insert = db.prepare('INSERT INTO relationship_evidence (run_id, relationship_hash, evidence_payload) VALUES (?, ?, ?)');
        const insertMany = db.transaction((items) => {
            for (const item of items) {
                insert.run(runId, item.relationshipHash, JSON.stringify(item.evidencePayload));
            }
        });

        try {
            insertMany(relationships);
            console.log(`[ValidationWorker] Successfully inserted ${relationships.length} evidence records.`);
        } catch (error) {
            console.error(`[ValidationWorker] Error during batch insert for run ${runId}:`, error);
            // Depending on requirements, you might want to add error handling here,
            // like moving the job to a failed queue.
            return;
        }

        // 2. No-cache pipeline: directly mark all relationships as ready for reconciliation
        // Since we're not using Redis caching, we can directly process all relationships
        const relationshipHashes = relationships.map(r => r.relationshipHash);
        
        console.log(`[ValidationWorker] No-cache mode: Directly processing ${relationshipHashes.length} relationships for reconciliation.`);
        
        // 3. Enqueue all relationships for reconciliation in a single bulk operation
        if (relationshipHashes && relationshipHashes.length > 0) {
            const reconciliationJobs = relationshipHashes.map(hash => ({
                name: 'reconcile-relationship',
                data: { runId, relationshipHash: hash },
            }));
            
            try {
                await this.reconciliationQueue.addBulk(reconciliationJobs);
                console.log(`[ValidationWorker] Successfully enqueued ${reconciliationJobs.length} relationships for reconciliation.`);
            } catch (error) {
                console.error(`[ValidationWorker] Failed to enqueue ${reconciliationJobs.length} jobs:`, error);
                
                // Add retry logic with exponential backoff
                let lastError = error;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        console.log(`[ValidationWorker] Retry attempt ${attempt}/3 for ${reconciliationJobs.length} jobs`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                        await this.reconciliationQueue.addBulk(reconciliationJobs);
                        console.log(`[ValidationWorker] Retry ${attempt} successful - enqueued ${reconciliationJobs.length} jobs`);
                        break;
                    } catch (retryError) {
                        lastError = retryError;
                        console.warn(`[ValidationWorker] Retry attempt ${attempt} failed:`, retryError.message);
                        if (attempt === 3) {
                            console.error(`[ValidationWorker] All retries failed for ${reconciliationJobs.length} jobs. Final error:`, retryError);
                            // Re-throw to trigger job retry at the worker level
                            throw new Error(`Failed to enqueue reconciliation jobs after 3 attempts: ${retryError.message}`);
                        }
                    }
                }
            }
        }
    }
}

module.exports = ValidationWorker;