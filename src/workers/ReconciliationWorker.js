const { Worker } = require('bullmq');
const ConfidenceScoringService = require('../services/cognitive_triangulation/ConfidenceScoringService');
const { ManagedWorker } = require('./ManagedWorker');

class ReconciliationWorker {
    constructor(queueManager, dbManager, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.workerPoolManager = workerPoolManager;
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('reconciliation-queue', workerPoolManager, {
                    workerType: 'reconciliation',
                    baseConcurrency: 8, // Good concurrency for reconciliation
                    maxConcurrency: 25,
                    minConcurrency: 2,
                    rateLimitRequests: 20, // Higher rate for reconciliation processing
                    rateLimitWindow: 1000,
                    failureThreshold: 5,
                    resetTimeout: 60000,
                    jobTimeout: 180000, // 3 minutes for reconciliation
                    retryAttempts: 3,
                    retryDelay: 8000,
                    ...options
                });
                
                // Initialize the managed worker
                this.initializeWorker();
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('reconciliation-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: 5
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
            
            console.log('✅ ReconciliationWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize ReconciliationWorker:', error);
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
        const { runId, relationshipHash } = job.data;
        console.log(`[ReconciliationWorker] Reconciling relationship ${relationshipHash}`);

        // 1. Fetch all evidence
        const db = this.dbManager.getDb();
        const evidenceRows = db.prepare(
            'SELECT evidence_payload FROM relationship_evidence WHERE run_id = ? AND relationship_hash = ?'
        ).all(runId, relationshipHash);

        const evidence = evidenceRows.map(row => JSON.parse(row.evidence_payload));

        // 2. Calculate confidence score
        const { finalScore, hasConflict } = ConfidenceScoringService.calculateFinalScore(evidence);

        // 3. Write final relationship
        if (finalScore > 0.5) { // Confidence threshold
            const finalRelationship = evidence[0]; // Assuming the base relationship data is in the first evidence
            db.prepare(
                `INSERT INTO relationships (from_node_id, to_node_id, type, resolution_level)
                 VALUES (?, ?, ?, ?)`
            ).run(
                finalRelationship.from,
                finalRelationship.to,
                finalRelationship.type,
                'file'
            );
            console.log(`[ReconciliationWorker] Validated relationship ${relationshipHash} with score ${finalScore}`);
        } else {
            console.log(`[ReconciliationWorker] Discarded relationship ${relationshipHash} with score ${finalScore}`);
        }
    }
}

module.exports = ReconciliationWorker;