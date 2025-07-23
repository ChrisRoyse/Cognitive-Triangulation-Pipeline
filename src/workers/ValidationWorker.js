const { Worker } = require('bullmq');
const { ManagedWorker } = require('./ManagedWorker');

class ValidationWorker {
    constructor(queueManager, dbManager, cacheClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.cacheClient = cacheClient;
        this.workerPoolManager = workerPoolManager;
        this.reconciliationQueue = this.queueManager.getQueue('reconciliation-queue');

        // Define the Lua script for atomic evidence counting and checking
        this.cacheClient.defineCommand('checkAndFetchReadyRelationships', {
            numberOfKeys: 1,
            lua: `
                local runId = KEYS[1]
                local relationships = ARGV
                local readyForReconciliation = {}
                
                for i=1, #relationships do
                    local relHash = relationships[i]
                    local evidenceCountKey = "evidence_count:" .. runId .. ":" .. relHash
                    local currentCount = redis.call("INCR", evidenceCountKey)
                    
                    local relMapKey = "run:" .. runId .. ":rel_map"
                    local expectedCountStr = redis.call("HGET", relMapKey, relHash)
                    
                    if expectedCountStr then
                        local expectedCount = tonumber(expectedCountStr)
                        if currentCount >= expectedCount then
                            table.insert(readyForReconciliation, relHash)
                        end
                    end
                end
                
                return readyForReconciliation
            `,
        });

        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('analysis-findings-queue', workerPoolManager, {
                    workerType: 'validation',
                    baseConcurrency: 5, // Can handle more validation tasks
                    maxConcurrency: 20,
                    minConcurrency: 1,
                    rateLimitRequests: 15, // Higher rate for validation
                    rateLimitWindow: 1000,
                    failureThreshold: 5,
                    resetTimeout: 60000,
                    jobTimeout: 120000, // 2 minutes for validation
                    retryAttempts: 3,
                    retryDelay: 8000,
                    ...options
                });
                
                // Don't initialize here - let it be initialized explicitly
                console.log('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('analysis-findings-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: 1, // Concurrency is now handled by batching, not multiple workers
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
        const redis = this.cacheClient;

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

        // 2. Use the Lua script to atomically update counts and get a list of ready relationships
        const relationshipHashes = relationships.map(r => r.relationshipHash);
        const readyHashes = await redis.checkAndFetchReadyRelationships(runId, ...relationshipHashes);

        // 3. Enqueue the ready relationships for reconciliation in a single bulk operation
        if (readyHashes && readyHashes.length > 0) {
            console.log(`[ValidationWorker] Found ${readyHashes.length} relationships ready for reconciliation.`);
            const reconciliationJobs = readyHashes.map(hash => ({
                name: 'reconcile-relationship',
                data: { runId, relationshipHash: hash },
            }));
            await this.reconciliationQueue.addBulk(reconciliationJobs);
        }
    }
}

module.exports = ValidationWorker;