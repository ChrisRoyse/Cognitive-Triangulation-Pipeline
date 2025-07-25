const { Worker } = require('bullmq');
const ConfidenceScoringService = require('../services/cognitive_triangulation/ConfidenceScoringService');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');

class ReconciliationWorker {
    constructor(queueManager, dbManager, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.workerPoolManager = workerPoolManager;
        
        // Use centralized configuration
        this.config = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = this.config.getWorkerLimit('reconciliation');
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('reconciliation-queue', workerPoolManager, {
                    workerType: 'reconciliation',
                    baseConcurrency: Math.min(5, workerLimit), // Good concurrency for reconciliation
                    maxConcurrency: workerLimit,
                    minConcurrency: 2,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: 20, // Higher rate for reconciliation processing
                    // rateLimitWindow: 1000,
                    failureThreshold: 10, // Increased from 5 to be less aggressive
                    resetTimeout: 60000,
                    jobTimeout: 180000, // 3 minutes for reconciliation
                    retryAttempts: 3,
                    retryDelay: 8000,
                    ...options
                });
                
                // Don't initialize here - let it be initialized explicitly
                console.log('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('reconciliation-queue', this.process.bind(this), {
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

        // 3. Update existing relationship status to VALIDATED
        if (finalScore > 0.5) { // Confidence threshold
            // Update existing relationships to VALIDATED status
            const updateResult = db.prepare(
                `UPDATE relationships 
                 SET status = 'VALIDATED', confidence = ?
                 WHERE id IN (
                     SELECT DISTINCT re.relationship_id 
                     FROM relationship_evidence re 
                     WHERE re.relationship_hash = ?
                 )`
            ).run(finalScore, relationshipHash);
            
            if (updateResult.changes > 0) {
                console.log(`[ReconciliationWorker] Validated ${updateResult.changes} relationship(s) ${relationshipHash} with score ${finalScore}`);
            } else {
                console.log(`[ReconciliationWorker] No relationships found to validate for hash ${relationshipHash}`);
            }
        } else {
            // Mark relationships as DISCARDED for low confidence
            const discardResult = db.prepare(
                `UPDATE relationships 
                 SET status = 'DISCARDED', confidence = ?
                 WHERE id IN (
                     SELECT DISTINCT re.relationship_id 
                     FROM relationship_evidence re 
                     WHERE re.relationship_hash = ?
                 )`
            ).run(finalScore, relationshipHash);
            
            console.log(`[ReconciliationWorker] Discarded ${discardResult.changes} relationship(s) ${relationshipHash} with score ${finalScore}`);
        }
    }
}

module.exports = ReconciliationWorker;