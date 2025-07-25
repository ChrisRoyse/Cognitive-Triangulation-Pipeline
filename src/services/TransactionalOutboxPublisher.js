const { DatabaseManager } = require('../utils/sqliteDb');
const QueueManager = require('../utils/queueManager');
const BatchedDatabaseWriter = require('../utils/batchedDatabaseWriter');
const TriangulatedAnalysisQueue = require('./triangulation/TriangulatedAnalysisQueue');
const ConfidenceScorer = require('./ConfidenceScorer');
const { getModeConfig, shouldUseParallelMode } = require('../config/triangulationConfig');
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
        
        // Initialize triangulated analysis system with configuration options
        this.confidenceScorer = new ConfidenceScorer(batchOptions.confidenceOptions || {});
        
        // Get triangulation configuration
        const useParallel = shouldUseParallelMode();
        const modeConfig = getModeConfig(useParallel ? 'parallel' : 'sequential');
        
        this.triangulatedAnalysisQueue = new TriangulatedAnalysisQueue(
            dbManager, 
            queueManager, 
            null, // No cache client - using database instead
            {
                ...batchOptions.triangulationOptions,
                coordinationMode: modeConfig.mode,
                enableAdvancedOrchestration: modeConfig.mode === 'parallel',
                maxParallelAgents: modeConfig.maxParallelAgents,
                concurrency: modeConfig.queueSettings.concurrency,
                confidenceThreshold: modeConfig.confidenceScoring.triangulationTriggerThreshold,
                orchestratorOptions: modeConfig.mode === 'parallel' ? {
                    enableParallelCoordination: true,
                    enableAdvancedConsensus: modeConfig.enableAdvancedConsensus,
                    enableRealTimeMonitoring: modeConfig.enableRealTimeMonitoring,
                    maxConcurrentSessions: modeConfig.maxConcurrentSessions,
                    sessionTimeout: modeConfig.sessionTimeout,
                    adaptiveOptimization: modeConfig.adaptiveOptimization,
                    cacheResults: modeConfig.enableCaching
                } : {}
            }
        );
        
        console.log(`[TransactionalOutboxPublisher] Triangulation configured: Mode=${modeConfig.mode}, Agents=${modeConfig.maxParallelAgents || 3}`);
        
        // Set up event listeners for monitoring
        this.batchWriter.on('batchProcessed', (info) => {
            console.log(`[TransactionalOutboxPublisher] Batch processed: ${info.totalItems} items in ${info.processingTimeMs}ms`);
        });
        
        this.batchWriter.on('batchError', (info) => {
            console.error(`[TransactionalOutboxPublisher] Batch error:`, info.error);
        });
    }

    async start() {
        console.log('🚀 [TransactionalOutboxPublisher] Starting publisher...');
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        
        // Start triangulated analysis queue
        await this.triangulatedAnalysisQueue.start();
        
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
        
        // Stop triangulated analysis queue
        await this.triangulatedAnalysisQueue.stop();
        
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
        const confidenceEscalationEvents = events.filter(e => e.event_type === 'relationship-confidence-escalation');
        const otherEvents = events.filter(e => 
            e.event_type !== 'file-analysis-finding' && 
            e.event_type !== 'relationship-analysis-finding' &&
            e.event_type !== 'global-relationship-analysis-finding' &&
            e.event_type !== 'directory-analysis-finding' &&
            e.event_type !== 'relationship-confidence-escalation'
        );

        // Process POI events FIRST to populate the database
        const statusUpdates = [];
        
        for (const event of poiEvents) {
            try {
                await this._handleFileAnalysisFinding(event);
                statusUpdates.push({ id: event.id, status: 'PUBLISHED' });
            } catch (error) {
                console.error(`[TransactionalOutboxPublisher] Failed to publish POI event:`, {
                    eventId: event.id,
                    eventType: event.event_type,
                    error: error.message,
                    errorType: error.name,
                    payload: event.payload ? JSON.parse(event.payload).filePath : 'unknown',
                    action: 'Check database connectivity and POI data validity. Review logs for specific validation errors.',
                    stack: error.stack
                });
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
                console.error(`[TransactionalOutboxPublisher] Failed to publish directory event:`, {
                    eventId: event.id,
                    eventType: event.event_type,
                    error: error.message,
                    errorType: error.name,
                    directoryPath: event.payload ? JSON.parse(event.payload).directoryPath : 'unknown',
                    action: 'Verify directory analysis data structure and database write permissions.',
                    stack: error.stack
                });
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
        
        // Process confidence escalation events
        if (confidenceEscalationEvents.length > 0) {
            await this._handleConfidenceEscalationEvents(confidenceEscalationEvents);
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
                console.error(`[TransactionalOutboxPublisher] Failed to publish event to queue:`, {
                    eventId: event.id,
                    eventType: event.event_type,
                    targetQueue: queueName || 'none',
                    error: error.message,
                    errorType: error.name,
                    payloadSize: event.payload ? event.payload.length : 0,
                    action: `Check queue connectivity and payload validity. Queue: ${queueName}, Event type: ${event.event_type}`,
                    stack: error.stack
                });
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
                        console.warn(`[TransactionalOutboxPublisher] Invalid POI structure - missing or invalid 'name' field:`, {
                            filePath,
                            poiId: poi.id || 'no-id',
                            poiType: poi.type || 'unknown',
                            providedName: poi.name,
                            nameType: typeof poi.name,
                            action: 'Ensure LLM response includes valid "name" field (string) for all POIs',
                            poiSnapshot: JSON.stringify(poi).substring(0, 200)
                        });
                        continue;
                    }
                    
                    if (!poi.type || typeof poi.type !== 'string') {
                        console.warn(`[TransactionalOutboxPublisher] Invalid POI structure - missing or invalid 'type' field:`, {
                            filePath,
                            poiId: poi.id || 'no-id',
                            poiName: poi.name,
                            providedType: poi.type,
                            typeType: typeof poi.type,
                            validTypes: 'ClassDefinition, FunctionDefinition, VariableDeclaration, ImportStatement',
                            action: 'Ensure LLM response includes valid "type" field from allowed values',
                            poiSnapshot: JSON.stringify(poi).substring(0, 200)
                        });
                        continue;
                    }

                    // Validate and provide defaults for new required fields
                    let description = poi.description;
                    if (!description || typeof description !== 'string') {
                        description = poi.name; // Use name as fallback
                        console.warn(`[TransactionalOutboxPublisher] POI ${poi.name} missing description, using name as fallback`);
                    }

                    let isExported = poi.is_exported !== undefined ? poi.is_exported : poi.isExported;
                    if (typeof isExported !== 'boolean') {
                        isExported = false; // Default to false  
                        if (poi.is_exported !== undefined || poi.isExported !== undefined) {
                            console.warn(`[TransactionalOutboxPublisher] POI ${poi.name} has invalid is_exported/isExported value, defaulting to false`);
                        }
                    }

                    // Generate a unique hash for each POI
                    const hash = crypto.createHash('md5');
                    hash.update(filePath);
                    hash.update(poi.name);
                    hash.update(poi.type);
                    hash.update(String(poi.start_line || poi.startLine || 0));
                    const poiHash = hash.digest('hex');
                    
                    // Get or create file_id for this file path
                    const db = this.dbManager.getDb();
                    let fileRecord = db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath);
                    if (!fileRecord) {
                        const insertResult = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run(filePath, 'processed');
                        fileRecord = { id: insertResult.lastInsertRowid };
                    }

                    if (!fileRecord || !fileRecord.id) {
                        throw new Error(`[TransactionalOutboxPublisher] Failed to get or create file record. FilePath: ${filePath}, RunId: ${runId}. Check database connectivity and 'files' table structure.`);
                    }
                    
                    this.batchWriter.addPoiInsert({
                        fileId: fileRecord.id,
                        filePath: filePath,
                        name: poi.name.trim(),
                        type: poi.type.toLowerCase(),
                        startLine: poi.start_line || poi.startLine || 1,
                        endLine: poi.end_line || poi.endLine || poi.start_line || poi.startLine || 1,
                        description: description.trim(),
                        isExported: isExported,
                        semanticId: poi.semantic_id || poi.semanticId || null,
                        llmOutput: JSON.stringify(poi),
                        hash: poiHash,
                        runId: runId
                    });
                } catch (error) {
                    console.error(`[TransactionalOutboxPublisher] Error processing individual POI:`, {
                        poiName: poi.name || 'unknown',
                        poiType: poi.type || 'unknown',
                        filePath,
                        runId,
                        error: error.message,
                        errorType: error.name,
                        errorCode: error.code,
                        action: 'Check database schema, constraints, and data types. Verify POI data meets all requirements.',
                        poiData: {
                            hasSemanticId: !!(poi.semantic_id || poi.semanticId),
                            hasDescription: !!poi.description,
                            isExported: poi.is_exported !== undefined ? poi.is_exported : poi.isExported,
                            startLine: poi.start_line || poi.startLine,
                            endLine: poi.end_line || poi.endLine
                        },
                        stack: error.stack
                    });
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
            
            // Create relationship resolution jobs - batch POIs by file for efficiency
            const queue = this.queueManager.getQueue('relationship-resolution-queue');
            
            // Instead of one job per POI, create batched jobs to reduce total job count
            const batchSize = Math.min(5, insertedPois.length); // Max 5 POIs per job
            for (let i = 0; i < insertedPois.length; i += batchSize) {
                const batch = insertedPois.slice(i, i + batchSize);
                const jobPayload = {
                    type: 'relationship-analysis-batch',
                    source: 'TransactionalOutboxPublisher',
                    jobId: `batch-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}-${i}`,
                    runId: runId,
                    filePath: filePath,
                    poisBatch: batch,
                    allPois: insertedPois // Provide full context for relationships
                };
                await queue.add(jobPayload.type, jobPayload);
            }
        }
    }

    async _handleDirectoryAnalysisFinding(event) {
        const payload = JSON.parse(event.payload);
        const { runId, directoryPath, summary } = payload;

        if (!runId || !directoryPath) {
            console.warn(`[TransactionalOutboxPublisher] Invalid directory analysis finding missing required fields:`, {
                runId: runId || 'undefined',
                directoryPath: directoryPath || 'undefined',
                summary: summary ? 'present' : 'undefined',
                payload
            });
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
                            filePath: relationship.filePath || relationship.file_path || relationship.filepath || '',
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
            
            // Flush relationships to database before creating validation jobs
            await this.batchWriter.flush();
            console.log(`[TransactionalOutboxPublisher] Flushed relationships to database`);
            
            // Perform confidence scoring and trigger triangulated analysis for low-confidence relationships
            await this._performConfidenceScoringAndTriangulation(runId);
            
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

            // Store expected evidence counts in database instead of Redis
            const relationshipCounts = {};
            for (const item of batchedPayload) {
                relationshipCounts[item.relationshipHash] = (relationshipCounts[item.relationshipHash] || 0) + 1;
            }

            // Store expected counts in database
            await this._storeRelationshipEvidenceCounts(runId, relationshipCounts);
            
            console.log(`[TransactionalOutboxPublisher] Set expected counts for ${Object.keys(relationshipCounts).length} unique relationships in database`);

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
            case 'relationship-confidence-escalation':
                // Handle confidence escalation events
                return 'triangulated-analysis-queue';
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
                            filePath: relationship.from_file || relationship.fromFile || relationship.to_file || relationship.toFile || '',
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
     * Handle confidence escalation events from relationship resolution worker
     */
    async _handleConfidenceEscalationEvents(events) {
        console.log(`[TransactionalOutboxPublisher] Processing ${events.length} confidence escalation events`);
        
        const db = this.dbManager.getDb();
        const lowConfidenceRelationships = [];
        let runId = null;
        
        for (const event of events) {
            try {
                const payload = JSON.parse(event.payload);
                if (!runId) runId = payload.runId;
                
                // Get the relationship details from database
                const relationship = db.prepare(`
                    SELECT r.id, r.confidence, r.reason
                    FROM relationships r
                    WHERE r.id = ?
                `).get(payload.relationshipId);
                
                if (relationship) {
                    lowConfidenceRelationships.push({
                        id: relationship.id,
                        confidence: payload.confidence || relationship.confidence,
                        confidenceLevel: payload.confidenceLevel || 'LOW',
                        escalationReason: payload.escalationReason || 'manual_escalation'
                    });
                }
                
                // Mark event as processed
                db.prepare('UPDATE outbox SET status = ? WHERE id = ?').run('PUBLISHED', event.id);
                
            } catch (error) {
                console.error(`[TransactionalOutboxPublisher] Failed to process confidence escalation event:`, error);
                db.prepare('UPDATE outbox SET status = ? WHERE id = ?').run('FAILED', event.id);
            }
        }
        
        // Trigger triangulated analysis for all escalated relationships
        if (lowConfidenceRelationships.length > 0 && runId) {
            console.log(`[TransactionalOutboxPublisher] Triggering triangulated analysis for ${lowConfidenceRelationships.length} escalated relationships`);
            await this.triangulatedAnalysisQueue.triggerTriangulatedAnalysis(lowConfidenceRelationships, runId, 'high');
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
        
        // Get all unique file paths for this run, then extract directories in JavaScript
        const filePaths = db.prepare(`
            SELECT DISTINCT file_path
            FROM pois 
            WHERE run_id = ?
        `).all(runId);
        
        // Extract unique directories using JavaScript
        const uniqueDirectories = new Set();
        for (const row of filePaths) {
            const filePath = row.file_path;
            const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
            const directoryPath = lastSlash >= 0 ? filePath.substring(0, lastSlash) : '.';
            uniqueDirectories.add(directoryPath);
        }
        
        const directories = Array.from(uniqueDirectories).map(dir => ({ directory_path: dir }));
        
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
    
    /**
     * Perform confidence scoring and trigger triangulated analysis for low-confidence relationships
     * Part of the hybrid cognitive triangulation architecture
     */
    async _performConfidenceScoringAndTriangulation(runId) {
        try {
            console.log(`[TransactionalOutboxPublisher] Starting confidence scoring and triangulation for run ${runId}`);
            
            const db = this.dbManager.getDb();
            
            // Get relationships that need confidence scoring (status = PENDING)
            const relationships = db.prepare(`
                SELECT r.id, r.source_poi_id, r.target_poi_id, r.type, r.file_path, 
                       r.confidence, r.reason, r.run_id,
                       sp.name as source_name, sp.semantic_id as source_semantic_id,
                       tp.name as target_name, tp.semantic_id as target_semantic_id
                FROM relationships r
                JOIN pois sp ON r.source_poi_id = sp.id
                JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.run_id = ? AND r.status = 'PENDING'
                ORDER BY r.confidence ASC
            `).all(runId);
            
            if (relationships.length === 0) {
                console.log(`[TransactionalOutboxPublisher] No relationships to score for run ${runId}`);
                return;
            }
            
            console.log(`[TransactionalOutboxPublisher] Scoring ${relationships.length} relationships for confidence`);
            
            const lowConfidenceRelationships = [];
            const batchUpdates = [];
            
            for (const relationship of relationships) {
                try {
                    // Prepare relationship data for confidence scoring
                    const relationshipData = {
                        from: relationship.source_semantic_id || relationship.source_name,
                        to: relationship.target_semantic_id || relationship.target_name,
                        type: relationship.type,
                        filePath: relationship.file_path,
                        reason: relationship.reason
                    };
                    
                    // Calculate confidence score using ConfidenceScorer
                    const confidenceResult = this.confidenceScorer.calculateConfidence(relationshipData, []);
                    
                    const newConfidence = confidenceResult.finalConfidence;
                    const confidenceLevel = confidenceResult.confidenceLevel;
                    
                    // Update relationship with new confidence score
                    batchUpdates.push({
                        id: relationship.id,
                        confidence: newConfidence,
                        status: confidenceLevel === 'HIGH' || confidenceLevel === 'MEDIUM' ? 'VALIDATED' : 'PENDING'
                    });
                    
                    // Check if relationship needs triangulated analysis
                    if (confidenceResult.escalationNeeded || newConfidence < 0.45) {
                        lowConfidenceRelationships.push({
                            id: relationship.id,
                            confidence: newConfidence,
                            confidenceLevel: confidenceLevel,
                            escalationReason: confidenceResult.escalationNeeded ? 'confidence_scorer_escalation' : 'low_confidence_threshold'
                        });
                        
                        console.log(`[TransactionalOutboxPublisher] Relationship ${relationship.source_name} -> ${relationship.target_name} needs triangulation - Confidence: ${newConfidence.toFixed(3)} (${confidenceLevel})`);
                    }
                    
                } catch (error) {
                    console.error(`[TransactionalOutboxPublisher] Failed to score confidence for relationship ${relationship.id}:`, error);
                    
                    // Mark as low confidence for triangulation due to scoring error
                    batchUpdates.push({
                        id: relationship.id,
                        confidence: 0.1,
                        status: 'PENDING'
                    });
                    
                    lowConfidenceRelationships.push({
                        id: relationship.id,
                        confidence: 0.1,
                        confidenceLevel: 'ERROR',
                        escalationReason: 'confidence_scoring_error'
                    });
                }
            }
            
            // Batch update relationship confidences
            if (batchUpdates.length > 0) {
                const updateStmt = db.prepare(`
                    UPDATE relationships 
                    SET confidence = ?, status = ?
                    WHERE id = ?
                `);
                
                const transaction = db.transaction(() => {
                    for (const update of batchUpdates) {
                        updateStmt.run(update.confidence, update.status, update.id);
                    }
                });
                
                transaction();
                console.log(`[TransactionalOutboxPublisher] Updated confidence scores for ${batchUpdates.length} relationships`);
            }
            
            // Trigger triangulated analysis for low-confidence relationships
            if (lowConfidenceRelationships.length > 0) {
                console.log(`[TransactionalOutboxPublisher] Triggering triangulated analysis for ${lowConfidenceRelationships.length} low-confidence relationships`);
                
                // Categorize relationships by confidence level for prioritization
                const urgentRelationships = lowConfidenceRelationships.filter(r => r.confidence < 0.2);
                const highPriorityRelationships = lowConfidenceRelationships.filter(r => r.confidence >= 0.2 && r.confidence < 0.35);
                const normalPriorityRelationships = lowConfidenceRelationships.filter(r => r.confidence >= 0.35);
                
                // Trigger analysis with appropriate priorities
                if (urgentRelationships.length > 0) {
                    await this.triangulatedAnalysisQueue.triggerTriangulatedAnalysis(urgentRelationships, runId, 'urgent');
                }
                
                if (highPriorityRelationships.length > 0) {
                    await this.triangulatedAnalysisQueue.triggerTriangulatedAnalysis(highPriorityRelationships, runId, 'high');
                }
                
                if (normalPriorityRelationships.length > 0) {
                    await this.triangulatedAnalysisQueue.triggerTriangulatedAnalysis(normalPriorityRelationships, runId, 'normal');
                }
                
                console.log(`[TransactionalOutboxPublisher] Triangulated analysis triggered: ${urgentRelationships.length} urgent, ${highPriorityRelationships.length} high, ${normalPriorityRelationships.length} normal priority`);
            } else {
                console.log(`[TransactionalOutboxPublisher] No relationships require triangulated analysis for run ${runId}`);
            }
            
        } catch (error) {
            console.error(`[TransactionalOutboxPublisher] Failed to perform confidence scoring and triangulation for run ${runId}:`, error);
        }
    }
    
    /**
     * Store relationship evidence counts in database
     * Replaces Redis rel_map functionality
     */
    async _storeRelationshipEvidenceCounts(runId, relationshipCounts) {
        const db = this.dbManager.getDb();
        
        // Create table if it doesn't exist
        db.exec(`
            CREATE TABLE IF NOT EXISTS relationship_evidence_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                relationship_hash TEXT NOT NULL,
                expected_count INTEGER NOT NULL,
                actual_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(run_id, relationship_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_run_id ON relationship_evidence_tracking(run_id);
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_hash ON relationship_evidence_tracking(relationship_hash);
        `);
        
        // Prepare statements for upsert
        const upsertStmt = db.prepare(`
            INSERT INTO relationship_evidence_tracking (run_id, relationship_hash, expected_count)
            VALUES (?, ?, ?)
            ON CONFLICT(run_id, relationship_hash) 
            DO UPDATE SET 
                expected_count = expected_count + excluded.expected_count,
                updated_at = CURRENT_TIMESTAMP
        `);
        
        // Use transaction for atomic updates
        const transaction = db.transaction(() => {
            for (const [hash, count] of Object.entries(relationshipCounts)) {
                upsertStmt.run(runId, hash, count);
            }
        });
        
        transaction();
    }
    
    /**
     * Get relationship evidence tracking data from database
     * Replaces Redis rel_map reads
     */
    async _getRelationshipEvidenceTracking(runId) {
        const db = this.dbManager.getDb();
        
        const tracking = db.prepare(`
            SELECT relationship_hash, expected_count, actual_count
            FROM relationship_evidence_tracking
            WHERE run_id = ?
        `).all(runId);
        
        // Convert to map format for compatibility
        const trackingMap = {};
        for (const row of tracking) {
            trackingMap[row.relationship_hash] = {
                expected: row.expected_count,
                actual: row.actual_count
            };
        }
        
        return trackingMap;
    }
    
    /**
     * Update actual count for relationship evidence
     */
    async _updateRelationshipEvidenceActualCount(runId, relationshipHash, increment = 1) {
        const db = this.dbManager.getDb();
        
        db.prepare(`
            UPDATE relationship_evidence_tracking 
            SET actual_count = actual_count + ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ? AND relationship_hash = ?
        `).run(increment, runId, relationshipHash);
    }

    /**
     * Get triangulated analysis statistics
     */
    async getTriangulatedAnalysisStats() {
        try {
            const triangulationStats = await this.triangulatedAnalysisQueue.getStats();
            
            // Get database statistics for triangulated analysis
            const db = this.dbManager.getDb();
            
            const sessionStats = db.prepare(`
                SELECT 
                    status,
                    COUNT(*) as count
                FROM triangulated_analysis_sessions
                GROUP BY status
            `).all();
            
            const consensusStats = db.prepare(`
                SELECT 
                    final_decision,
                    COUNT(*) as count,
                    AVG(weighted_consensus) as avg_consensus
                FROM consensus_decisions
                GROUP BY final_decision
            `).all();
            
            return {
                triangulationQueue: triangulationStats,
                sessions: sessionStats.reduce((acc, stat) => {
                    acc[stat.status] = stat.count;
                    return acc;
                }, {}),
                decisions: consensusStats.reduce((acc, stat) => {
                    acc[stat.final_decision] = {
                        count: stat.count,
                        averageConsensus: stat.avg_consensus
                    };
                    return acc;
                }, {}),
                confidenceScorer: this.confidenceScorer.getHealthStatus ? this.confidenceScorer.getHealthStatus() : 'not_available'
            };
            
        } catch (error) {
            console.error('[TransactionalOutboxPublisher] Failed to get triangulated analysis stats:', error);
            return { error: error.message };
        }
    }
}

module.exports = TransactionalOutboxPublisher;