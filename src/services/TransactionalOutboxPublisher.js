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
        const globalRelationshipEvents = events.filter(e => e.event_type === 'global-relationship-analysis-finding');
        const directoryEvents = events.filter(e => e.event_type === 'directory-analysis-finding');
        const otherEvents = events.filter(e => 
            e.event_type !== 'file-analysis-finding' && 
            e.event_type !== 'relationship-analysis-finding' &&
            e.event_type !== 'global-relationship-analysis-finding' &&
            e.event_type !== 'directory-analysis-finding'
        );

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
        
        // Force flush POI inserts before processing other events
        await this.batchWriter.flush();
        
        // Process directory events after POI events
        for (const event of directoryEvents) {
            try {
                await this._handleDirectoryAnalysisFinding(event);
                statusUpdates.push({ id: event.id, status: 'PUBLISHED' });
            } catch (error) {
                console.error(`[TransactionalOutboxPublisher] Failed to publish directory event ${event.id}:`, error);
                statusUpdates.push({ id: event.id, status: 'FAILED' });
            }
        }
        
        // Process relationship events AFTER POIs are in database
        if (relationshipEvents.length > 0) {
            await this._handleBatchedRelationshipFindings(relationshipEvents);
        }
        
        // Process global relationship events AFTER intra-file relationships
        if (globalRelationshipEvents.length > 0) {
            await this._handleBatchedGlobalRelationshipFindings(globalRelationshipEvents);
        }
        
        // Check if we should trigger global cross-file analysis
        await this._checkAndTriggerGlobalAnalysis();
        
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
            // Flush status updates to mark events as processed
            await this.batchWriter.flush();
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
                try {
                    // Validate required POI fields
                    if (!poi.name || typeof poi.name !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid POI missing name, skipping:`, poi);
                        continue;
                    }
                    
                    if (!poi.type || typeof poi.type !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid POI missing type, skipping:`, poi);
                        continue;
                    }

                    // Validate and provide defaults for new required fields
                    let description = poi.description;
                    if (!description || typeof description !== 'string') {
                        description = poi.name; // Use name as fallback
                        console.warn(`[TransactionalOutboxPublisher] POI ${poi.name} missing description, using name as fallback`);
                    }

                    let isExported = poi.isExported || poi.is_exported;
                    if (typeof isExported !== 'boolean') {
                        isExported = false; // Default to false
                        if (isExported !== undefined) {
                            console.warn(`[TransactionalOutboxPublisher] POI ${poi.name} has invalid is_exported value, defaulting to false`);
                        }
                    }

                    // Generate a unique hash for each POI
                    const hash = crypto.createHash('md5');
                    hash.update(filePath);
                    hash.update(poi.name);
                    hash.update(poi.type);
                    hash.update(String(poi.startLine || poi.start_line || 0));
                    const poiHash = hash.digest('hex');
                    
                    // Get or create file_id for this file path
                    const db = this.dbManager.getDb();
                    let fileRecord = db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath);
                    if (!fileRecord) {
                        const insertResult = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run(filePath, 'processed');
                        fileRecord = { id: insertResult.lastInsertRowid };
                    }

                    if (!fileRecord || !fileRecord.id) {
                        throw new Error(`Failed to get or create file record for ${filePath}`);
                    }
                    
                    this.batchWriter.addPoiInsert({
                        fileId: fileRecord.id,
                        filePath: filePath,
                        name: poi.name.trim(),
                        type: poi.type.toLowerCase(),
                        startLine: poi.startLine || poi.start_line || 1,
                        endLine: poi.endLine || poi.end_line || (poi.startLine || poi.start_line || 1),
                        description: description.trim(),
                        isExported: isExported,
                        semanticId: poi.semantic_id || null,
                        llmOutput: JSON.stringify(poi),
                        hash: poiHash,
                        runId: runId
                    });
                } catch (error) {
                    console.error(`[TransactionalOutboxPublisher] Error processing POI ${poi.name || 'unknown'}:`, error);
                    // Continue processing other POIs instead of failing the entire batch
                }
            }
            
            // Flush POIs to database first
            await this.batchWriter.flush();
            
            // Query the inserted POIs to get their database IDs and semantic IDs
            const db = this.dbManager.getDb();
            const insertedPois = db.prepare(`
                SELECT id, name, type, start_line, end_line, description, is_exported, semantic_id, hash
                FROM pois 
                WHERE file_path = ? AND run_id = ?
            `).all(filePath, runId);
            
            if (insertedPois.length === 0) {
                console.warn(`[TransactionalOutboxPublisher] No POIs found in database after insertion for ${filePath}`);
                return;
            }
            
            // Create relationship resolution jobs with proper database IDs
            const queue = this.queueManager.getQueue('relationship-resolution-queue');
            for (const primaryPoi of insertedPois) {
                const jobPayload = {
                    type: 'relationship-analysis-poi',
                    source: 'TransactionalOutboxPublisher',
                    jobId: `poi-${primaryPoi.id}`,
                    runId: runId,
                    filePath: filePath,
                    primaryPoi: primaryPoi,
                    contextualPois: insertedPois.filter(p => p.id !== primaryPoi.id)
                };
                await queue.add(jobPayload.type, jobPayload);
            }
        }
    }

    async _handleDirectoryAnalysisFinding(event) {
        const payload = JSON.parse(event.payload);
        const { runId, directoryPath, summary } = payload;

        if (!directoryPath || !summary) {
            console.warn(`[TransactionalOutboxPublisher] Invalid directory analysis finding missing required fields:`, payload);
            return;
        }

        console.log(`[TransactionalOutboxPublisher] Writing directory summary for ${directoryPath}`);
        
        // Write directory summary directly to database using batch writer
        this.batchWriter.addDirectoryInsert(runId, directoryPath, summary);
        
        // Flush to ensure directory summary is written
        await this.batchWriter.flush();
        
        console.log(`[TransactionalOutboxPublisher] Successfully wrote directory summary for ${directoryPath}`);
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
                    // Validate required relationship fields
                    if (!relationship.from || typeof relationship.from !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid relationship missing 'from' field, skipping:`, relationship);
                        continue;
                    }
                    
                    if (!relationship.to || typeof relationship.to !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid relationship missing 'to' field, skipping:`, relationship);
                        continue;
                    }
                    
                    if (!relationship.type || typeof relationship.type !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid relationship missing type, skipping:`, relationship);
                        continue;
                    }

                    // Validate and provide defaults for new required fields
                    let confidence = relationship.confidence;
                    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                        confidence = 0.8; // Default confidence
                        if (relationship.confidence !== undefined) {
                            console.warn(`[TransactionalOutboxPublisher] Invalid confidence ${relationship.confidence} for relationship ${relationship.from} -> ${relationship.to}, using default 0.8`);
                        }
                    }

                    let reason = relationship.reason;
                    if (!reason || typeof reason !== 'string') {
                        reason = `${relationship.type} relationship detected`; // Default reason
                        console.warn(`[TransactionalOutboxPublisher] Missing reason for relationship ${relationship.from} -> ${relationship.to}, using default`);
                    }

                    // Find source and target POI IDs using semantic IDs first, then fallback to names
                    let sourcePoi = db.prepare('SELECT id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(relationship.from, runId);
                    if (!sourcePoi) {
                        sourcePoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(relationship.from, runId);
                    }
                    
                    let targetPoi = db.prepare('SELECT id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(relationship.to, runId);
                    if (!targetPoi) {
                        targetPoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(relationship.to, runId);
                    }
                    
                    if (sourcePoi && targetPoi) {
                        // Insert relationship with POI IDs
                        this.batchWriter.addRelationshipInsert({
                            sourcePoiId: sourcePoi.id,
                            targetPoiId: targetPoi.id,
                            type: relationship.type.toUpperCase(),
                            filePath: relationship.filePath || relationship.file_path || '',
                            status: 'PENDING', // Will be updated to VALIDATED by ReconciliationWorker
                            confidence: confidence,
                            reason: reason.trim(),
                            runId: runId
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
            case 'global-relationship-analysis-finding':
            case 'directory-analysis-finding':
                return null;
            default:
                console.warn(`[TransactionalOutboxPublisher] No queue configured for event type: ${eventType}`);
                return null;
        }
    }

    /**
     * Handle global relationship analysis findings
     */
    async _handleBatchedGlobalRelationshipFindings(events) {
        const db = this.dbManager.getDb();
        const queue = this.queueManager.getQueue('analysis-findings-queue');
        let allRelationships = [];
        let runId = null;

        for (const event of events) {
            const payload = JSON.parse(event.payload);
            if (!runId) runId = payload.runId;
            if (payload.relationships) {
                // Mark cross-file relationships with metadata
                const crossFileRelationships = payload.relationships.map(rel => ({
                    ...rel,
                    cross_file: true,
                    analysis_type: 'global'
                }));
                allRelationships.push(...crossFileRelationships);
            }
        }

        if (allRelationships.length > 0) {
            console.log(`[TransactionalOutboxPublisher] Writing ${allRelationships.length} cross-file relationships to database`);
            
            // Write cross-file relationships directly to database using batch writer
            for (const relationship of allRelationships) {
                try {
                    // Validate required relationship fields
                    if (!relationship.from || typeof relationship.from !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid cross-file relationship missing 'from' field, skipping:`, relationship);
                        continue;
                    }
                    
                    if (!relationship.to || typeof relationship.to !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid cross-file relationship missing 'to' field, skipping:`, relationship);
                        continue;
                    }
                    
                    if (!relationship.type || typeof relationship.type !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid cross-file relationship missing type, skipping:`, relationship);
                        continue;
                    }

                    let confidence = relationship.confidence;
                    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                        confidence = 0.8; // Default confidence
                        if (relationship.confidence !== undefined) {
                            console.warn(`[TransactionalOutboxPublisher] Invalid confidence ${relationship.confidence} for cross-file relationship ${relationship.from} -> ${relationship.to}, using default 0.8`);
                        }
                    }

                    let reason = relationship.reason;
                    if (!reason || typeof reason !== 'string') {
                        reason = `${relationship.type} cross-file relationship detected`;
                        console.warn(`[TransactionalOutboxPublisher] Missing reason for cross-file relationship ${relationship.from} -> ${relationship.to}, using default`);
                    }

                    // Find source and target POI IDs using semantic IDs first, then fallback to names
                    let sourcePoi = db.prepare('SELECT id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(relationship.from, runId);
                    if (!sourcePoi) {
                        sourcePoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(relationship.from, runId);
                    }
                    
                    let targetPoi = db.prepare('SELECT id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(relationship.to, runId);
                    if (!targetPoi) {
                        targetPoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(relationship.to, runId);
                    }
                    
                    if (sourcePoi && targetPoi) {
                        // Insert cross-file relationship with POI IDs
                        this.batchWriter.addRelationshipInsert({
                            sourcePoiId: sourcePoi.id,
                            targetPoiId: targetPoi.id,
                            type: relationship.type.toUpperCase(),
                            filePath: relationship.from_file || relationship.to_file || '',
                            status: 'CROSS_FILE_VALIDATED', // Special status for cross-file relationships
                            confidence: confidence,
                            reason: reason.trim(),
                            runId: runId
                        });
                        
                        console.log(`[TransactionalOutboxPublisher] Queued cross-file relationship ${relationship.from} -> ${relationship.to} (IDs: ${sourcePoi.id} -> ${targetPoi.id})`);
                    } else {
                        console.warn(`[TransactionalOutboxPublisher] Could not resolve POI IDs for cross-file relationship ${relationship.from} -> ${relationship.to}`);
                        if (!sourcePoi) console.warn(`  Source POI '${relationship.from}' not found`);
                        if (!targetPoi) console.warn(`  Target POI '${relationship.to}' not found`);
                    }
                } catch (error) {
                    console.error(`[TransactionalOutboxPublisher] Error processing cross-file relationship ${relationship.from} -> ${relationship.to}:`, error.message);
                }
            }
            
            // Use batch writer for status updates
            const publishedUpdates = events.map(e => ({ id: e.id, status: 'PUBLISHED' }));
            this.batchWriter.addOutboxUpdatesBatch(publishedUpdates);
            
            console.log(`[TransactionalOutboxPublisher] Published cross-file relationships and queued ${events.length} events for status update.`);
        }
    }

    /**
     * Check if we should trigger global cross-file analysis
     * This runs after all file analysis and intra-file relationships are processed
     */
    async _checkAndTriggerGlobalAnalysis() {
        const db = this.dbManager.getDb();
        
        // Get all active runs that have completed file analysis but haven't had global analysis
        const activeRuns = db.prepare(`
            SELECT DISTINCT run_id, COUNT(DISTINCT file_path) as file_count
            FROM pois 
            WHERE run_id IS NOT NULL
            GROUP BY run_id
            HAVING file_count > 1
        `).all();
        
        for (const runInfo of activeRuns) {
            const runId = runInfo.run_id;
            const fileCount = runInfo.file_count;
            
            // Check if global analysis has already been triggered for this run
            const existingGlobalAnalysis = db.prepare(`
                SELECT COUNT(*) as count 
                FROM outbox 
                WHERE event_type = 'global-relationship-analysis-finding' 
                  AND payload LIKE ?
            `).get(`%"runId":"${runId}"%`).count;
            
            // Check if we have any pending file analysis for this run
            const pendingFileAnalysis = db.prepare(`
                SELECT COUNT(*) as count 
                FROM outbox 
                WHERE event_type = 'file-analysis-finding' 
                  AND status = 'PENDING'
                  AND payload LIKE ?
            `).get(`%"runId":"${runId}"%`).count;
            
            // Check if we have any pending relationship analysis for this run
            const pendingRelationshipAnalysis = db.prepare(`
                SELECT COUNT(*) as count 
                FROM outbox 
                WHERE event_type = 'relationship-analysis-finding' 
                  AND status = 'PENDING'
                  AND payload LIKE ?
            `).get(`%"runId":"${runId}"%`).count;
            
            // Trigger global analysis if:
            // 1. No existing global analysis for this run
            // 2. No pending file or relationship analysis
            // 3. Multiple files in the run (cross-file analysis only makes sense with multiple files)
            if (existingGlobalAnalysis === 0 && 
                pendingFileAnalysis === 0 && 
                pendingRelationshipAnalysis === 0 && 
                fileCount > 1) {
                
                console.log(`[TransactionalOutboxPublisher] Triggering global cross-file analysis for run ${runId} with ${fileCount} files`);
                await this._triggerGlobalAnalysisForRun(runId);
            }
        }
    }

    /**
     * Trigger global cross-file analysis for a specific run
     */
    async _triggerGlobalAnalysisForRun(runId) {
        const db = this.dbManager.getDb();
        
        // Get all unique directories for this run
        const directories = db.prepare(`
            SELECT DISTINCT 
                CASE 
                    WHEN file_path LIKE '%/%' THEN SUBSTR(file_path, 1, LENGTH(file_path) - LENGTH(SUBSTR(file_path, INSTR(file_path, '/', -1) + 1)))
                    WHEN file_path LIKE '%\\%' THEN SUBSTR(file_path, 1, LENGTH(file_path) - LENGTH(SUBSTR(file_path, INSTR(file_path, '\\', -1) + 1)))
                    ELSE '.'
                END as directory_path
            FROM pois 
            WHERE run_id = ?
        `).all(runId);
        
        const globalAnalysisQueue = this.queueManager.getQueue('global-relationship-analysis-queue');
        
        // Create global analysis jobs for each directory
        let batchNumber = 1;
        const totalBatches = directories.length;
        
        for (const dir of directories) {
            const directoryPath = dir.directory_path || '.';
            
            const jobPayload = {
                type: 'global-relationship-analysis',
                source: 'TransactionalOutboxPublisher',
                jobId: `global-${runId}-${batchNumber}`,
                runId: runId,
                directoryPath: directoryPath,
                batchNumber: batchNumber,
                totalBatches: totalBatches
            };
            
            await globalAnalysisQueue.add(jobPayload.type, jobPayload);
            console.log(`[TransactionalOutboxPublisher] Created global analysis job ${batchNumber}/${totalBatches} for directory: ${directoryPath}`);
            
            batchNumber++;
        }
        
        console.log(`[TransactionalOutboxPublisher] Created ${totalBatches} global analysis jobs for run ${runId}`);
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