const { DatabaseManager } = require('../utils/sqliteDb');
const QueueManager = require('../utils/queueManager');
const BatchedDatabaseWriter = require('../utils/batchedDatabaseWriter');
const crypto = require('crypto');

class TransactionalOutboxPublisher {
    constructor(dbManager, queueManager, batchOptions = {}) {
        this.dbManager = dbManager;
        this.queueManager = queueManager;
        this.pollingInterval = 1000; // 1 second
        this.intervalId = null;
        this.isPolling = false;
        
        // Initialize the batched database writer
        this.batchWriter = new BatchedDatabaseWriter(dbManager, {
            batchSize: batchOptions.batchSize || 100,
            flushInterval: batchOptions.flushInterval || 500, // 500ms for outbox processing
            maxRetries: batchOptions.maxRetries || 3,
            enableStats: batchOptions.enableStats !== false
        });
        
        // Set up event listeners for monitoring
        this.batchWriter.on('batchProcessed', (info) => {
            console.log(`[TransactionalOutboxPublisher] Batch processed: ${info.totalItems} items in ${info.processingTimeMs}ms`);
        });
        
        this.batchWriter.on('batchError', (info) => {
            console.error(`[TransactionalOutboxPublisher] Batch error:`, info.error);
        });
    }

    start() {
        console.log('🚀 [TransactionalOutboxPublisher] Starting publisher...');
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.intervalId = setInterval(() => this.pollAndPublish(), this.pollingInterval);
    }

    async stop() {
        console.log('🛑 [TransactionalOutboxPublisher] Stopping publisher...');
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        // Wait for the current polling cycle to finish if it's running
        while (this.isPolling) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Gracefully shut down the batch writer
        await this.batchWriter.shutdown();
    }

    async pollAndPublish() {
        if (this.isPolling) {
            return;
        }
        this.isPolling = true;

        const db = this.dbManager.getDb();
        const events = db.prepare("SELECT * FROM outbox WHERE status = 'PENDING' LIMIT 100").all(); // Increased limit

        if (events.length === 0) {
            this.isPolling = false;
            return;
        }

        console.log(`[TransactionalOutboxPublisher] Found ${events.length} pending events.`);

        const poiEvents = events.filter(e => e.event_type === 'file-analysis-finding');
        const relationshipEvents = events.filter(e => e.event_type === 'relationship-analysis-finding');
        const otherEvents = events.filter(e => e.event_type !== 'file-analysis-finding' && e.event_type !== 'relationship-analysis-finding');

        // Process POI events FIRST to populate the database
        const statusUpdates = [];
        
        for (const event of poiEvents) {
            try {
                await this._handleFileAnalysisFinding(event);
                statusUpdates.push({ id: event.id, status: 'PUBLISHED' });
            } catch (error) {
                console.error(`[TransactionalOutboxPublisher] Failed to publish POI event ${event.id}:`, error);
                statusUpdates.push({ id: event.id, status: 'FAILED' });
            }
        }
        
        // Force flush POI inserts before processing relationships
        await this.batchWriter.flush();
        
        // Process relationship events AFTER POIs are in database
        if (relationshipEvents.length > 0) {
            await this._handleBatchedRelationshipFindings(relationshipEvents);
        }
        
        // Process any other events
        for (const event of otherEvents) {
            try {
                const queueName = this.getQueueForEvent(event.event_type);
                if (queueName) {
                    const queue = this.queueManager.getQueue(queueName);
                    const payload = JSON.parse(event.payload);
                    await queue.add(payload.type, payload);
                    console.log(`[TransactionalOutboxPublisher] Published event ${event.id} to queue ${queueName}`);
                } else {
                    console.log(`[TransactionalOutboxPublisher] No downstream queue for event type ${event.event_type}, marking as processed.`);
                }
                statusUpdates.push({ id: event.id, status: 'PUBLISHED' });
            } catch (error) {
                console.error(`[TransactionalOutboxPublisher] Failed to publish event ${event.id}:`, error);
                statusUpdates.push({ id: event.id, status: 'FAILED' });
            }
        }
        
        // Batch process all status updates
        if (statusUpdates.length > 0) {
            this.batchWriter.addOutboxUpdatesBatch(statusUpdates);
        }
        this.isPolling = false;
    }

    async _handleFileAnalysisFinding(event) {
        const payload = JSON.parse(event.payload);
        const { pois, filePath, runId } = payload;

        if (pois && pois.length > 0) {
            console.log(`[TransactionalOutboxPublisher] Writing ${pois.length} POIs to database for file ${filePath}`);
            
            // Write POIs directly to database using batch writer
            for (const poi of pois) {
                // Generate a unique hash for each POI
                const hash = crypto.createHash('md5');
                hash.update(filePath);
                hash.update(poi.name);
                hash.update(poi.type);
                hash.update(String(poi.startLine || poi.start_line || 0));
                const poiHash = hash.digest('hex');
                
                this.batchWriter.addPoiInsert({
                    filePath: filePath,
                    name: poi.name,
                    type: poi.type,
                    startLine: poi.startLine || poi.start_line,
                    endLine: poi.endLine || poi.end_line,
                    llmOutput: JSON.stringify(poi),
                    hash: poiHash,
                    runId: runId
                });
            }
            
            // Also create relationship resolution jobs (keep existing queue logic)
            const queue = this.queueManager.getQueue('relationship-resolution-queue');
            for (const primaryPoi of pois) {
                const jobPayload = {
                    type: 'relationship-analysis-poi',
                    source: 'TransactionalOutboxPublisher',
                    jobId: `poi-${primaryPoi.id}`,
                    runId: runId,
                    filePath: filePath,
                    primaryPoi: primaryPoi,
                    contextualPois: pois.filter(p => p.id !== primaryPoi.id)
                };
                await queue.add(jobPayload.type, jobPayload);
            }
        }
    }

    async _handleBatchedRelationshipFindings(events) {
        const db = this.dbManager.getDb();
        const queue = this.queueManager.getQueue('analysis-findings-queue');
        let allRelationships = [];
        let runId = null;

        for (const event of events) {
            const payload = JSON.parse(event.payload);
            if (!runId) runId = payload.runId;
            if (payload.relationships) {
                allRelationships.push(...payload.relationships);
            }
        }

        if (allRelationships.length > 0) {
            console.log(`[TransactionalOutboxPublisher] Writing ${allRelationships.length} relationships to database and creating validation batch.`);
            
            // Write relationships directly to database using batch writer
            // Resolve POI names to actual POI IDs from the database
            const db = this.dbManager.getDb();
            
            for (const relationship of allRelationships) {
                try {
                    // Find source POI ID
                    const sourcePoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(relationship.from, runId);
                    const targetPoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(relationship.to, runId);
                    
                    if (sourcePoi && targetPoi) {
                        // Insert relationship with POI IDs
                        this.batchWriter.addRelationshipInsert({
                            sourcePoiId: sourcePoi.id,
                            targetPoiId: targetPoi.id,
                            type: relationship.type,
                            filePath: relationship.filePath || relationship.file_path,
                            status: 'PENDING', // Will be updated to VALIDATED by ReconciliationWorker
                            confidenceScore: relationship.confidence || 0.8
                        });
                        
                        console.log(`[TransactionalOutboxPublisher] Queued relationship ${relationship.from} -> ${relationship.to} (IDs: ${sourcePoi.id} -> ${targetPoi.id})`);
                    } else {
                        console.warn(`[TransactionalOutboxPublisher] Could not resolve POI IDs for relationship ${relationship.from} -> ${relationship.to}`);
                        if (!sourcePoi) console.warn(`  Source POI '${relationship.from}' not found`);
                        if (!targetPoi) console.warn(`  Target POI '${relationship.to}' not found`);
                    }
                } catch (error) {
                    console.error(`[TransactionalOutboxPublisher] Error processing relationship ${relationship.from} -> ${relationship.to}:`, error.message);
                }
            }
            
            const batchedPayload = allRelationships.map(relationship => {
                const hash = crypto.createHash('md5');
                hash.update(relationship.from);
                hash.update(relationship.to);
                hash.update(relationship.type);
                const relationshipHash = hash.digest('hex');

                return {
                    relationshipHash: relationshipHash,
                    evidencePayload: relationship,
                };
            });

            try {
                await queue.add('validate-relationships-batch', {
                    runId: runId,
                    relationships: batchedPayload
                });

                // Use batch writer for status updates
                const publishedUpdates = events.map(e => ({ id: e.id, status: 'PUBLISHED' }));
                this.batchWriter.addOutboxUpdatesBatch(publishedUpdates);
                
                console.log(`[TransactionalOutboxPublisher] Published super-batch and queued ${events.length} events for status update.`);

            } catch (error) {
                console.error(`[TransactionalOutboxPublisher] Failed to publish super-batch:`, error);
                
                // Use batch writer for failed status updates
                const failedUpdates = events.map(e => ({ id: e.id, status: 'FAILED' }));
                this.batchWriter.addOutboxUpdatesBatch(failedUpdates);
            }
        }
    }

    getQueueForEvent(eventType) {
        switch (eventType) {
            case 'file-analysis-finding':
            case 'relationship-analysis-finding':
            case 'directory-analysis-finding':
                return null;
            default:
                console.warn(`[TransactionalOutboxPublisher] No queue configured for event type: ${eventType}`);
                return null;
        }
    }
    
    /**
     * Get batch writer statistics and current outbox status
     */
    async getStats() {
        const db = this.dbManager.getDb();
        const batchStats = this.batchWriter.getStats();
        
        // Get current outbox counts
        const pendingCount = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE status = 'PENDING'").get().count;
        const publishedCount = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE status = 'PUBLISHED'").get().count;
        const failedCount = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE status = 'FAILED'").get().count;
        
        // Get WAL statistics
        const walStats = this.batchWriter.getWALStats();
        
        return {
            outbox: {
                pending: pendingCount,
                published: publishedCount,
                failed: failedCount,
                total: pendingCount + publishedCount + failedCount
            },
            batchWriter: batchStats,
            wal: walStats,
            isPolling: this.isPolling,
            pollingInterval: this.pollingInterval
        };
    }
    
    /**
     * Force flush all pending batches
     */
    async flushBatches() {
        console.log('[TransactionalOutboxPublisher] Forcing batch flush...');
        await this.batchWriter.flush();
    }
    
    /**
     * Perform WAL checkpoint to optimize database performance
     */
    checkpointWAL() {
        return this.batchWriter.checkpointWAL();
    }
}

module.exports = TransactionalOutboxPublisher;