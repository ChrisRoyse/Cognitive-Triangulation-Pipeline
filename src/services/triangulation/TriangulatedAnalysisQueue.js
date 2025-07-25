const { v4: uuidv4 } = require('uuid');
const { Queue, Worker } = require('bullmq');
const ConfidenceScorer = require('../ConfidenceScorer');

/**
 * TriangulatedAnalysisQueue - Simplified analysis queue for low-confidence relationships
 * Handles basic confidence re-scoring without complex parallel agents
 */
class TriangulatedAnalysisQueue {
    constructor(dbManager, queueManager, cacheClient, options = {}) {
        this.queueId = uuidv4();
        this.dbManager = dbManager;
        this.queueManager = queueManager;
        
        // Simplified configuration
        this.config = {
            queueName: 'triangulated-analysis-queue',
            concurrency: options.concurrency || 2,
            maxRetries: options.maxRetries || 2,
            confidenceThreshold: options.confidenceThreshold || 0.4,
            processingTimeout: options.processingTimeout || 30000 // 30 seconds
        };
        
        // Simple confidence scorer
        this.confidenceScorer = new ConfidenceScorer();
        
        // Initialize queue and worker
        this.queue = null;
        this.worker = null;
        this.isStarted = false;
        
        // Simple statistics tracking
        this.stats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0
        };
        
        console.log(`[TriangulatedAnalysisQueue] Initialized simplified queue with threshold ${this.config.confidenceThreshold}`);
    }

    /**
     * Start the triangulated analysis queue and worker
     */
    async start() {
        if (this.isStarted) {
            console.warn('[TriangulatedAnalysisQueue] Queue already started');
            return;
        }
        
        try {
            // Initialize queue
            this.queue = this.queueManager.getQueue(this.config.queueName);
            
            // Create worker with simple job processor
            this.worker = this.queueManager.createWorker(
                this.config.queueName,
                this.processSimpleAnalysis.bind(this),
                {
                    concurrency: this.config.concurrency
                }
            );
            
            this.isStarted = true;
            console.log(`[TriangulatedAnalysisQueue] Started simplified queue with ${this.config.concurrency} workers`);
            
        } catch (error) {
            console.error('[TriangulatedAnalysisQueue] Failed to start:', error);
            throw error;
        }
    }

    /**
     * Stop the triangulated analysis queue
     */
    async stop() {
        if (!this.isStarted) {
            return;
        }
        
        console.log('[TriangulatedAnalysisQueue] Stopping simplified queue...');
        
        try {
            if (this.worker) {
                await this.worker.close();
                this.worker = null;
            }
            
            this.isStarted = false;
            console.log('[TriangulatedAnalysisQueue] Stopped successfully');
            
        } catch (error) {
            console.error('[TriangulatedAnalysisQueue] Error during shutdown:', error);
        }
    }

    /**
     * Simple analysis processor - just recalculates confidence
     */
    async processSimpleAnalysis(job) {
        const startTime = Date.now();
        this.stats.totalProcessed++;

        try {
            const { relationshipId, runId } = job.data;
            
            // Get relationship from database  
            const db = this.dbManager.getDb();
            const relationship = db.prepare('SELECT * FROM relationships WHERE id = ?').get(relationshipId);
            
            if (!relationship) {
                throw new Error(`Relationship ${relationshipId} not found`);
            }

            // Recalculate confidence with simple scorer
            const confidenceResult = this.confidenceScorer.calculateConfidence(relationship);
            
            // Update relationship with new confidence
            db.prepare(`
                UPDATE relationships 
                SET confidence_score = ?, confidence_level = ?
                WHERE id = ?
            `).run(confidenceResult.finalConfidence, confidenceResult.confidenceLevel, relationshipId);

            this.stats.successful++;
            
            return {
                relationshipId,
                originalConfidence: relationship.confidence_score,
                newConfidence: confidenceResult.finalConfidence,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            this.stats.failed++;
            console.error('[TriangulatedAnalysisQueue] Job failed:', error);
            throw error;
        }
    }

    /**
     * Get simple statistics
     */
    async getStats() {
        return {
            config: this.config,
            stats: this.stats,
            isStarted: this.isStarted
        };
    }
}

module.exports = TriangulatedAnalysisQueue;