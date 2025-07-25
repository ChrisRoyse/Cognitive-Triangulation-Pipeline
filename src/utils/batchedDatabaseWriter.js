const EventEmitter = require('events');

/**
 * BatchedDatabaseWriter - Efficient batch processing for database operations
 * 
 * Features:
 * - Configurable batch sizes and flush intervals
 * - Transaction-based batch writes for consistency
 * - WAL mode optimization for SQLite
 * - Comprehensive error handling and retry logic
 * - Monitoring and statistics
 * - Graceful shutdown with pending batch processing
 */
class BatchedDatabaseWriter extends EventEmitter {
    constructor(dbManager, options = {}) {
        super();
        
        this.dbManager = dbManager;
        this.db = dbManager.getDb();
        
        // Configuration
        this.config = {
            batchSize: options.batchSize || 100,
            flushInterval: options.flushInterval || 1000, // 1 second
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 500,
            enableStats: options.enableStats !== false
        };
        
        // Batch queues for different operations
        this.batches = {
            outboxUpdates: [],
            poiInserts: [],
            relationshipInserts: [],
            relationshipUpdates: [],
            directoryInserts: [],
            evidenceInserts: []
        };
        
        // Prepared statements for efficient batch operations
        this.statements = this._prepareStatements();
        
        // Statistics
        this.stats = {
            totalBatchesProcessed: 0,
            totalItemsProcessed: 0,
            totalErrors: 0,
            averageBatchSize: 0,
            lastFlushTime: null,
            processingTimeMs: 0
        };
        
        // Internal state
        this.flushTimer = null;
        this.isShuttingDown = false;
        this.processingPromise = null;
        
        this._startFlushTimer();
        
        console.log(`[BatchedDatabaseWriter] Initialized with batch size: ${this.config.batchSize}, flush interval: ${this.config.flushInterval}ms`);
    }
    
    /**
     * Prepare all database statements for batch operations
     */
    _prepareStatements() {
        try {
            return {
                // Outbox operations
                updateOutboxStatus: this.db.prepare("UPDATE outbox SET status = ? WHERE id = ?"),
                updateOutboxBatch: this.db.prepare("UPDATE outbox SET status = ? WHERE id = ?"),
                
                // POI operations
                insertPoi: this.db.prepare(`
                    INSERT OR IGNORE INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, llm_output, hash, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `),
                
                // Relationship operations
                insertRelationship: this.db.prepare(`
                    INSERT OR IGNORE INTO relationships (source_poi_id, target_poi_id, type, file_path, status, confidence, reason, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `),
                updateRelationship: this.db.prepare(`
                    UPDATE relationships SET status = ?, confidence = ?, reason = ? WHERE id = ?
                `),
                
                // Directory operations
                insertDirectorySummary: this.db.prepare(`
                    INSERT OR REPLACE INTO directory_summaries (run_id, directory_path, summary_text)
                    VALUES (?, ?, ?)
                `),
                
                // Evidence operations
                insertEvidence: this.db.prepare(`
                    INSERT INTO relationship_evidence (relationship_id, run_id, evidence_payload)
                    VALUES (?, ?, ?)
                `)
            };
        } catch (error) {
            const errorMsg = '[BatchedDatabaseWriter] Failed to prepare database statements';
            console.error(errorMsg, {
                error: error.message,
                errorType: error.name,
                errorCode: error.code,
                action: 'Check database schema matches expected table structure. Verify all required tables exist.',
                requiredTables: ['outbox', 'pois', 'relationships', 'directory_summaries', 'relationship_evidence'],
                stack: error.stack
            });
            throw new Error(`${errorMsg}: ${error.message}`);
        }
    }
    
    /**
     * Add an outbox status update to the batch
     */
    addOutboxUpdate(id, status) {
        if (this.isShuttingDown) {
            throw new Error('[BatchedDatabaseWriter] Cannot add outbox update - writer is shutting down. Ensure proper shutdown sequence.');
        }
        
        this.batches.outboxUpdates.push({ id, status });
        this._checkAndFlush('outboxUpdates');
    }
    
    /**
     * Add multiple outbox updates to the batch
     */
    addOutboxUpdatesBatch(updates) {
        if (this.isShuttingDown) {
            throw new Error(`[BatchedDatabaseWriter] Cannot add ${updates.length} outbox updates - writer is shutting down. Ensure proper shutdown sequence.`);
        }
        
        this.batches.outboxUpdates.push(...updates);
        this._checkAndFlush('outboxUpdates');
    }
    
    /**
     * Add a POI insert to the batch
     */
    addPoiInsert(poi) {
        if (this.isShuttingDown) {
            throw new Error(`[BatchedDatabaseWriter] Cannot add POI insert for '${poi.name || 'unknown'}' - writer is shutting down. File: ${poi.filePath}`);
        }
        
        this.batches.poiInserts.push(poi);
        this._checkAndFlush('poiInserts');
    }
    
    /**
     * Add a relationship insert to the batch
     */
    addRelationshipInsert(relationship) {
        if (this.isShuttingDown) {
            throw new Error(`[BatchedDatabaseWriter] Cannot add relationship insert (${relationship.sourcePoiId || '?'} -> ${relationship.targetPoiId || '?'}) - writer is shutting down.`);
        }
        
        // Validate relationship before adding to batch
        try {
            if (!relationship.sourcePoiId || !relationship.targetPoiId) {
                console.error('[BatchedDatabaseWriter] Invalid relationship - missing POI IDs:', {
                    sourcePoiId: relationship.sourcePoiId || 'missing',
                    targetPoiId: relationship.targetPoiId || 'missing',
                    type: relationship.type,
                    filePath: relationship.filePath,
                    action: 'Ensure POIs are resolved to database IDs before creating relationships',
                    relationship: JSON.stringify(relationship).substring(0, 200)
                });
                return;
            }
            
            if (!relationship.type || typeof relationship.type !== 'string') {
                console.error('[BatchedDatabaseWriter] Invalid relationship - missing or invalid type:', {
                    sourcePoiId: relationship.sourcePoiId,
                    targetPoiId: relationship.targetPoiId,
                    providedType: relationship.type,
                    typeType: typeof relationship.type,
                    validTypes: 'CALLS, USES, IMPORTS, EXTENDS, IMPLEMENTS, etc.',
                    action: 'Ensure relationship type is a non-empty string',
                    relationship: JSON.stringify(relationship).substring(0, 200)
                });
                return;
            }

            // Validate and provide defaults for new required fields
            let confidence = relationship.confidence;
            if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                confidence = 0.8; // Default confidence
                if (relationship.confidence !== undefined) {
                    console.warn(`[BatchedDatabaseWriter] Invalid confidence ${relationship.confidence} for relationship ${relationship.sourcePoiId} -> ${relationship.targetPoiId}, using default 0.8`);
                }
            }

            let reason = relationship.reason;
            if (!reason || typeof reason !== 'string') {
                reason = `${relationship.type} relationship detected`; // Default reason
                if (relationship.reason !== undefined) {
                    console.warn(`[BatchedDatabaseWriter] Invalid reason for relationship ${relationship.sourcePoiId} -> ${relationship.targetPoiId}, using default`);
                }
            }

            // Create validated relationship object
            const validatedRelationship = {
                ...relationship,
                type: relationship.type.toUpperCase(),
                confidence: confidence,
                reason: reason.trim(),
                status: relationship.status || 'PENDING',
                filePath: relationship.filePath || ''
            };

            this.batches.relationshipInserts.push(validatedRelationship);
            this._checkAndFlush('relationshipInserts');
        } catch (error) {
            console.error('[BatchedDatabaseWriter] Error validating relationship:', error, relationship);
        }
    }
    
    /**
     * Add a relationship update to the batch
     */
    addRelationshipUpdate(id, status, confidenceScore) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        this.batches.relationshipUpdates.push({ id, status, confidenceScore });
        this._checkAndFlush('relationshipUpdates');
    }
    
    /**
     * Add a directory summary insert to the batch
     */
    addDirectoryInsert(runId, directoryPath, summaryText) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        // Validate required parameters
        if (!runId || !directoryPath) {
            console.error('[BatchedDatabaseWriter] addDirectoryInsert called with missing parameters:', {
                runId: runId || 'undefined',
                directoryPath: directoryPath || 'undefined',
                summaryText: summaryText ? 'present' : 'undefined'
            });
            throw new Error(`Missing required parameters: runId=${runId}, directoryPath=${directoryPath}`);
        }
        
        this.batches.directoryInserts.push({ runId, directoryPath, summaryText: summaryText || '' });
        this._checkAndFlush('directoryInserts');
    }
    
    /**
     * Add relationship evidence to the batch
     */
    addEvidenceInsert(relationshipId, runId, evidencePayload) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        this.batches.evidenceInserts.push({ relationshipId, runId, evidencePayload });
        this._checkAndFlush('evidenceInserts');
    }
    
    /**
     * Check if a batch needs to be flushed based on size
     */
    _checkAndFlush(batchType) {
        if (this.batches[batchType].length >= this.config.batchSize) {
            setImmediate(() => this._flushBatch(batchType));
        }
    }
    
    /**
     * Start the automatic flush timer
     */
    _startFlushTimer() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        
        this.flushTimer = setInterval(() => {
            this._flushAllBatches();
        }, this.config.flushInterval);
    }
    
    /**
     * Flush all non-empty batches
     */
    async _flushAllBatches() {
        if (this.processingPromise) {
            return; // Already processing
        }
        
        const batchTypes = Object.keys(this.batches).filter(type => this.batches[type].length > 0);
        
        if (batchTypes.length === 0) {
            return;
        }
        
        this.processingPromise = this._processBatches(batchTypes);
        await this.processingPromise;
        this.processingPromise = null;
    }
    
    /**
     * Flush a specific batch type
     */
    async _flushBatch(batchType) {
        if (this.batches[batchType].length === 0) {
            return;
        }
        
        await this._processBatches([batchType]);
    }
    
    /**
     * Process multiple batch types in a single transaction
     */
    async _processBatches(batchTypes) {
        const startTime = Date.now();
        let totalItems = 0;
        
        try {
            // Create snapshots of batches and clear them
            const batchSnapshots = {};
            for (const batchType of batchTypes) {
                batchSnapshots[batchType] = [...this.batches[batchType]];
                this.batches[batchType] = [];
                totalItems += batchSnapshots[batchType].length;
            }
            
            if (totalItems === 0) {
                return;
            }
            
            console.log(`[BatchedDatabaseWriter] Processing ${totalItems} items across ${batchTypes.length} batch types`);
            
            // Execute all batch operations in a single transaction
            const transaction = this.db.transaction(() => {
                for (const batchType of batchTypes) {
                    this._executeBatch(batchType, batchSnapshots[batchType]);
                }
            });
            
            // Execute with retry logic
            await this._executeWithRetry(transaction);
            
            // Update statistics
            if (this.config.enableStats) {
                this._updateStats(totalItems, Date.now() - startTime);
            }
            
            this.emit('batchProcessed', {
                batchTypes,
                totalItems,
                processingTimeMs: Date.now() - startTime
            });
            
        } catch (error) {
            this.stats.totalErrors++;
            const errorContext = {
                error: error.message,
                errorType: error.name,
                errorCode: error.code,
                batchTypes,
                totalItems,
                processingTimeMs: Date.now() - startTime,
                action: this._getErrorActionSuggestion(error),
                dbPath: this.dbManager.dbPath,
                isTransactionError: error.message?.includes('transaction'),
                stack: error.stack
            };
            
            console.error('[BatchedDatabaseWriter] Batch processing failed:', errorContext);
            this.emit('batchError', errorContext);
            
            // Add context to thrown error
            error.batchContext = errorContext;
            throw error;
        }
    }
    
    /**
     * Execute a specific batch operation
     */
    _executeBatch(batchType, items) {
        switch (batchType) {
            case 'outboxUpdates':
                for (const { id, status } of items) {
                    this.statements.updateOutboxStatus.run(status, id);
                }
                break;
                
            case 'poiInserts':
                for (const poi of items) {
                    this.statements.insertPoi.run(
                        poi.fileId, poi.filePath, poi.name, poi.type, poi.startLine, 
                        poi.endLine, poi.description, poi.isExported ? 1 : 0, poi.semanticId, poi.llmOutput, poi.hash, poi.runId
                    );
                }
                break;
                
            case 'relationshipInserts':
                for (const rel of items) {
                    this.statements.insertRelationship.run(
                        rel.sourcePoiId, rel.targetPoiId, rel.type, 
                        rel.filePath, rel.status, rel.confidence, rel.reason, rel.runId
                    );
                }
                break;
                
            case 'relationshipUpdates':
                for (const { id, status, confidence, reason } of items) {
                    this.statements.updateRelationship.run(status, confidence, reason, id);
                }
                break;
                
            case 'directoryInserts':
                for (const item of items) {
                    const { runId, directoryPath, summaryText } = item;
                    
                    // Validate required parameters
                    if (!runId || !directoryPath) {
                        console.error('[BatchedDatabaseWriter] Missing required parameters for directory insert:', {
                            runId: runId || 'undefined',
                            directoryPath: directoryPath || 'undefined',
                            summaryText: summaryText ? 'present' : 'undefined',
                            item
                        });
                        continue; // Skip this item
                    }
                    
                    // Use empty string as default for summaryText if not provided
                    const summary = summaryText || '';
                    
                    this.statements.insertDirectorySummary.run(runId, directoryPath, summary);
                }
                break;
                
            case 'evidenceInserts':
                for (const { relationshipId, runId, evidencePayload } of items) {
                    this.statements.insertEvidence.run(relationshipId, runId, evidencePayload);
                }
                break;
                
            default:
                throw new Error(`Unknown batch type: ${batchType}`);
        }
    }
    
    /**
     * Execute a function with retry logic
     */
    async _executeWithRetry(fn, attempt = 1) {
        try {
            return fn();
        } catch (error) {
            if (attempt >= this.config.maxRetries) {
                throw error;
            }
            
            console.warn(`[BatchedDatabaseWriter] Attempt ${attempt} failed, retrying in ${this.config.retryDelay}ms:`, error.message);
            
            await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
            return this._executeWithRetry(fn, attempt + 1);
        }
    }
    
    /**
     * Update performance statistics
     */
    _updateStats(itemCount, processingTimeMs) {
        this.stats.totalBatchesProcessed++;
        this.stats.totalItemsProcessed += itemCount;
        this.stats.lastFlushTime = new Date();
        this.stats.processingTimeMs += processingTimeMs;
        
        // Calculate average batch size
        this.stats.averageBatchSize = this.stats.totalItemsProcessed / this.stats.totalBatchesProcessed;
    }
    
    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            pendingItems: Object.values(this.batches).reduce((sum, batch) => sum + batch.length, 0),
            config: this.config
        };
    }
    
    /**
     * Force flush all pending batches
     */
    async flush() {
        console.log('[BatchedDatabaseWriter] Forcing flush of all pending batches');
        await this._flushAllBatches();
    }
    
    /**
     * Graceful shutdown - flush all pending batches and stop timer
     */
    async shutdown() {
        console.log('[BatchedDatabaseWriter] Shutting down gracefully...');
        this.isShuttingDown = true;
        
        // Stop the flush timer
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        
        // Wait for any ongoing processing to complete
        if (this.processingPromise) {
            await this.processingPromise;
        }
        
        // Flush any remaining batches
        await this._flushAllBatches();
        
        console.log('[BatchedDatabaseWriter] Shutdown complete');
        this.emit('shutdown');
    }
    
    /**
     * Get error action suggestion based on error type
     */
    _getErrorActionSuggestion(error) {
        if (error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked')) {
            return 'Database is locked. Check for long-running transactions or concurrent write operations. Consider increasing busy timeout.';
        }
        if (error.code === 'SQLITE_CONSTRAINT' || error.message?.includes('constraint')) {
            return 'Database constraint violation. Check unique constraints, foreign keys, and data validity.';
        }
        if (error.code === 'SQLITE_CORRUPT' || error.message?.includes('corrupt')) {
            return 'Database corruption detected. Run integrity check and consider restoring from backup.';
        }
        if (error.code === 'SQLITE_FULL' || error.message?.includes('disk full')) {
            return 'Disk full error. Check available disk space and clean up if necessary.';
        }
        if (error.message?.includes('no such table')) {
            return 'Missing database table. Run database initialization or migrations.';
        }
        if (error.message?.includes('no such column')) {
            return 'Missing database column. Check schema version and run pending migrations.';
        }
        if (error.message?.includes('transaction')) {
            return 'Transaction error. Check for nested transactions or transaction state issues.';
        }
        return 'Review error details and database logs. Ensure database schema is up to date.';
    }
    
    /**
     * WAL mode optimization - checkpoint the WAL file
     */
    checkpointWAL() {
        try {
            const result = this.db.pragma('wal_checkpoint(RESTART)');
            console.log('[BatchedDatabaseWriter] WAL checkpoint completed:', result);
            return result;
        } catch (error) {
            console.error('[BatchedDatabaseWriter] WAL checkpoint failed:', {
                error: error.message,
                errorCode: error.code,
                action: 'Check database is not in exclusive lock mode. Ensure no active write transactions.',
                suggestion: 'Try again after current transactions complete',
                stack: error.stack
            });
            throw error;
        }
    }
    
    /**
     * Get WAL file size and other WAL statistics
     */
    getWALStats() {
        try {
            const walInfo = this.db.pragma('wal_checkpoint');
            const pageCount = this.db.pragma('page_count');
            const walMode = this.db.pragma('journal_mode');
            
            return {
                walMode,
                pageCount,
                walInfo
            };
        } catch (error) {
            console.error('[BatchedDatabaseWriter] Failed to get WAL stats:', {
                error: error.message,
                errorCode: error.code,
                action: 'Non-critical error. WAL stats unavailable but processing can continue.',
                stack: error.stack
            });
            return null;
        }
    }
}

module.exports = BatchedDatabaseWriter;