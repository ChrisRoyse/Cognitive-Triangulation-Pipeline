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
                    INSERT OR IGNORE INTO pois (file_path, name, type, start_line, end_line, llm_output, hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `),
                
                // Relationship operations
                insertRelationship: this.db.prepare(`
                    INSERT OR IGNORE INTO relationships (source_poi_id, target_poi_id, type, file_path, status, confidence_score)
                    VALUES (?, ?, ?, ?, ?, ?)
                `),
                updateRelationship: this.db.prepare(`
                    UPDATE relationships SET status = ?, confidence_score = ? WHERE id = ?
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
            console.error('[BatchedDatabaseWriter] Failed to prepare statements:', error);
            throw error;
        }
    }
    
    /**
     * Add an outbox status update to the batch
     */
    addOutboxUpdate(id, status) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        this.batches.outboxUpdates.push({ id, status });
        this._checkAndFlush('outboxUpdates');
    }
    
    /**
     * Add multiple outbox updates to the batch
     */
    addOutboxUpdatesBatch(updates) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        this.batches.outboxUpdates.push(...updates);
        this._checkAndFlush('outboxUpdates');
    }
    
    /**
     * Add a POI insert to the batch
     */
    addPoiInsert(poi) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        this.batches.poiInserts.push(poi);
        this._checkAndFlush('poiInserts');
    }
    
    /**
     * Add a relationship insert to the batch
     */
    addRelationshipInsert(relationship) {
        if (this.isShuttingDown) {
            throw new Error('BatchedDatabaseWriter is shutting down');
        }
        
        this.batches.relationshipInserts.push(relationship);
        this._checkAndFlush('relationshipInserts');
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
        
        this.batches.directoryInserts.push({ runId, directoryPath, summaryText });
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
            console.error('[BatchedDatabaseWriter] Batch processing failed:', error);
            this.emit('batchError', { error, batchTypes, totalItems });
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
                        poi.filePath, poi.name, poi.type, poi.startLine, 
                        poi.endLine, poi.llmOutput, poi.hash
                    );
                }
                break;
                
            case 'relationshipInserts':
                for (const rel of items) {
                    this.statements.insertRelationship.run(
                        rel.sourcePoiId, rel.targetPoiId, rel.type, 
                        rel.filePath, rel.status, rel.confidenceScore
                    );
                }
                break;
                
            case 'relationshipUpdates':
                for (const { id, status, confidenceScore } of items) {
                    this.statements.updateRelationship.run(status, confidenceScore, id);
                }
                break;
                
            case 'directoryInserts':
                for (const { runId, directoryPath, summaryText } of items) {
                    this.statements.insertDirectorySummary.run(runId, directoryPath, summaryText);
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
     * WAL mode optimization - checkpoint the WAL file
     */
    checkpointWAL() {
        try {
            const result = this.db.pragma('wal_checkpoint(RESTART)');
            console.log('[BatchedDatabaseWriter] WAL checkpoint completed:', result);
            return result;
        } catch (error) {
            console.error('[BatchedDatabaseWriter] WAL checkpoint failed:', error);
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
            console.error('[BatchedDatabaseWriter] Failed to get WAL stats:', error);
            return null;
        }
    }
}

module.exports = BatchedDatabaseWriter;