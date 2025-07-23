const { v4: uuidv4 } = require('uuid');
const { getLogger } = require('../config/logging');
const fs = require('fs').promises;

/**
 * CheckpointManager handles pipeline checkpoints and validation
 * Tracks progress through pipeline stages and ensures data integrity
 */
class CheckpointManager {
    constructor(dbManager, cacheClient) {
        this.dbManager = dbManager;
        this.cacheClient = cacheClient;
        this.logger = getLogger('CheckpointManager');
        
        // Define valid checkpoint stages
        this.STAGES = {
            FILE_LOADED: 'FILE_LOADED',
            ENTITIES_EXTRACTED: 'ENTITIES_EXTRACTED',
            RELATIONSHIPS_BUILT: 'RELATIONSHIPS_BUILT',
            NEO4J_STORED: 'NEO4J_STORED',
            PIPELINE_COMPLETE: 'PIPELINE_COMPLETE'
        };
        
        // Define checkpoint statuses
        this.STATUSES = {
            PENDING: 'PENDING',
            COMPLETED: 'COMPLETED',
            FAILED: 'FAILED',
            INVALIDATED: 'INVALIDATED'
        };
        
        // Define benchmarks
        this.BENCHMARKS = {
            MIN_NODES: 300,
            MIN_RELATIONSHIPS: 1600,
            MAX_DURATION_MS: 60000 // 60 seconds
        };
        
        // Initialize database schema
        this.initializeSchema();
    }
    
    /**
     * Initialize checkpoint table in database
     */
    initializeSchema() {
        try {
            const db = this.dbManager.getDb();
            
            // For testing with mocked database
            if (!db.exec) {
                this.logger.info('Database exec not available, skipping schema initialization');
                return;
            }
            
            db.exec(`
                CREATE TABLE IF NOT EXISTS checkpoints (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    metadata TEXT,
                    validation_result TEXT,
                    error TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    failed_at DATETIME,
                    UNIQUE(run_id, stage, entity_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id);
                CREATE INDEX IF NOT EXISTS idx_checkpoints_stage ON checkpoints(stage);
                CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON checkpoints(status);
                CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at);
            `);
        } catch (error) {
            this.logger.warn('Failed to initialize checkpoint schema', { error });
        }
    }
    
    /**
     * Create a new checkpoint
     */
    async createCheckpoint({ runId, stage, entityId, metadata = {} }) {
        const timer = this.logger.startTimer('create-checkpoint');
        
        // Validate inputs
        if (!this.STAGES[stage]) {
            throw new Error(`Invalid checkpoint stage: ${stage}`);
        }
        
        if (!runId) {
            throw new Error('Missing required field: runId');
        }
        
        if (!entityId) {
            throw new Error('Missing required field: entityId');
        }
        
        const checkpoint = {
            id: uuidv4(),
            runId,
            stage,
            entityId,
            status: this.STATUSES.PENDING,
            metadata,
            createdAt: new Date()
        };
        
        try {
            // Store in database
            const db = this.dbManager.getDb();
            const stmt = db.prepare(`
                INSERT INTO checkpoints (
                    id, run_id, stage, entity_id, status, metadata, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run(
                checkpoint.id,
                checkpoint.runId,
                checkpoint.stage,
                checkpoint.entityId,
                checkpoint.status,
                JSON.stringify(checkpoint.metadata),
                checkpoint.createdAt.toISOString()
            );
            
            // Cache for fast retrieval
            await this.cacheCheckpoint(checkpoint);
            
            const metrics = timer.end();
            this.logger.info('Checkpoint created', {
                checkpointId: checkpoint.id,
                stage: checkpoint.stage,
                entityId: checkpoint.entityId,
                duration: checkpoint.metadata.duration || metrics.duration
            });
            
            return checkpoint;
            
        } catch (error) {
            timer.end();
            this.logger.error('Failed to create checkpoint', {
                error,
                stage,
                entityId
            });
            throw error;
        }
    }
    
    /**
     * Validate a checkpoint based on its stage
     */
    async validateCheckpoint(checkpoint) {
        const timer = this.logger.startTimer('validate-checkpoint');
        
        try {
            let validationResult;
            
            switch (checkpoint.stage) {
                case this.STAGES.FILE_LOADED:
                    validationResult = await this.validateFileLoaded(checkpoint);
                    break;
                    
                case this.STAGES.ENTITIES_EXTRACTED:
                    validationResult = await this.validateEntitiesExtracted(checkpoint);
                    break;
                    
                case this.STAGES.RELATIONSHIPS_BUILT:
                    validationResult = await this.validateRelationshipsBuilt(checkpoint);
                    break;
                    
                case this.STAGES.NEO4J_STORED:
                    validationResult = await this.validateNeo4jStored(checkpoint);
                    break;
                    
                case this.STAGES.PIPELINE_COMPLETE:
                    validationResult = await this.validatePipelineComplete(checkpoint);
                    break;
                    
                default:
                    throw new Error(`Unknown checkpoint stage: ${checkpoint.stage}`);
            }
            
            timer.end();
            return validationResult;
            
        } catch (error) {
            timer.end();
            this.logger.error('Checkpoint validation failed', {
                error,
                checkpointId: checkpoint.id,
                stage: checkpoint.stage
            });
            
            return {
                valid: false,
                stage: checkpoint.stage,
                error: error.message
            };
        }
    }
    
    /**
     * Validate FILE_LOADED checkpoint
     */
    async validateFileLoaded(checkpoint) {
        const validations = {
            fileExists: true,
            fileReadable: true,
            fileSizeValid: true
        };
        
        const { filePath, fileSize } = checkpoint.metadata || {};
        
        if (filePath) {
            try {
                await fs.access(filePath, fs.constants.R_OK);
            } catch {
                validations.fileExists = false;
                validations.fileReadable = false;
            }
        }
        
        if (fileSize && fileSize === 0) {
            validations.fileSizeValid = false;
        }
        
        const valid = Object.values(validations).every(v => v === true);
        
        return {
            valid,
            stage: checkpoint.stage,
            validations
        };
    }
    
    /**
     * Validate ENTITIES_EXTRACTED checkpoint
     */
    async validateEntitiesExtracted(checkpoint) {
        const { entityCount, entities } = checkpoint.metadata || {};
        
        const validations = {
            hasEntities: entityCount > 0,
            entityStructureValid: true,
            minimumEntitiesFound: entityCount >= 1
        };
        
        if (entities && Array.isArray(entities)) {
            validations.entityStructureValid = entities.every(entity => 
                entity.id && entity.type && entity.name
            );
        }
        
        const valid = Object.values(validations).every(v => v === true);
        
        return {
            valid,
            stage: checkpoint.stage,
            validations
        };
    }
    
    /**
     * Validate RELATIONSHIPS_BUILT checkpoint
     */
    async validateRelationshipsBuilt(checkpoint) {
        const { relationshipCount, relationships } = checkpoint.metadata || {};
        
        const validTypes = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'USES'];
        
        const validations = {
            hasRelationships: relationshipCount > 0,
            relationshipStructureValid: true,
            relationshipTypesValid: true
        };
        
        if (relationships && Array.isArray(relationships)) {
            validations.relationshipStructureValid = relationships.every(rel => 
                rel.from && rel.to && rel.type
            );
            
            validations.relationshipTypesValid = relationships.every(rel =>
                validTypes.includes(rel.type)
            );
        }
        
        const valid = Object.values(validations).every(v => v === true);
        
        return {
            valid,
            stage: checkpoint.stage,
            validations
        };
    }
    
    /**
     * Validate NEO4J_STORED checkpoint
     */
    async validateNeo4jStored(checkpoint) {
        const { nodesCreated, relationshipsCreated } = checkpoint.metadata || {};
        
        const validations = {
            storageSuccessful: true,
            nodeCountValid: nodesCreated > 0,
            relationshipCountValid: relationshipsCreated > 0
        };
        
        const valid = Object.values(validations).every(v => v === true);
        
        return {
            valid,
            stage: checkpoint.stage,
            validations
        };
    }
    
    /**
     * Validate PIPELINE_COMPLETE checkpoint against benchmarks
     */
    async validatePipelineComplete(checkpoint) {
        const { totalNodes, totalRelationships, duration } = checkpoint.metadata || {};
        
        const validations = {
            nodesBenchmarkMet: totalNodes >= this.BENCHMARKS.MIN_NODES,
            relationshipsBenchmarkMet: totalRelationships >= this.BENCHMARKS.MIN_RELATIONSHIPS,
            performanceBenchmarkMet: duration <= this.BENCHMARKS.MAX_DURATION_MS
        };
        
        const errors = [];
        
        if (!validations.nodesBenchmarkMet) {
            errors.push(`Nodes benchmark not met: ${totalNodes} < ${this.BENCHMARKS.MIN_NODES}`);
        }
        
        if (!validations.relationshipsBenchmarkMet) {
            errors.push(`Relationships benchmark not met: ${totalRelationships} < ${this.BENCHMARKS.MIN_RELATIONSHIPS}`);
        }
        
        if (!validations.performanceBenchmarkMet) {
            errors.push(`Performance benchmark not met: ${duration}ms > ${this.BENCHMARKS.MAX_DURATION_MS}ms`);
        }
        
        const valid = Object.values(validations).every(v => v === true);
        
        const result = {
            valid,
            stage: checkpoint.stage,
            validations,
            benchmarks: {
                requiredNodes: this.BENCHMARKS.MIN_NODES,
                requiredRelationships: this.BENCHMARKS.MIN_RELATIONSHIPS,
                actualNodes: totalNodes,
                actualRelationships: totalRelationships
            }
        };
        
        if (errors.length > 0) {
            result.errors = errors;
        }
        
        return result;
    }
    
    /**
     * Update checkpoint status and metadata
     */
    async updateCheckpoint(checkpointId, updates) {
        const timer = this.logger.startTimer('update-checkpoint');
        
        try {
            const db = this.dbManager.getDb();
            const fields = [];
            const values = [];
            
            if (updates.status) {
                fields.push('status = ?');
                values.push(updates.status);
            }
            
            if (updates.completedAt) {
                fields.push('completed_at = ?');
                values.push(updates.completedAt.toISOString());
            }
            
            if (updates.failedAt) {
                fields.push('failed_at = ?');
                values.push(updates.failedAt.toISOString());
            }
            
            if (updates.error) {
                fields.push('error = ?');
                values.push(updates.error);
            }
            
            if (updates.validationResult) {
                fields.push('validation_result = ?');
                values.push(JSON.stringify(updates.validationResult));
            }
            
            values.push(checkpointId);
            
            const stmt = db.prepare(`
                UPDATE checkpoints
                SET ${fields.join(', ')}
                WHERE id = ?
            `);
            
            stmt.run(...values);
            
            // Update cache
            const checkpoint = await this.getCheckpointFromDb(checkpointId);
            if (checkpoint) {
                await this.cacheCheckpoint(checkpoint);
            }
            
            timer.end();
            
            return {
                id: checkpointId,
                ...updates
            };
            
        } catch (error) {
            timer.end();
            this.logger.error('Failed to update checkpoint', {
                error,
                checkpointId,
                updates
            });
            throw error;
        }
    }
    
    /**
     * Get checkpoint by ID
     */
    async getCheckpoint(checkpointId) {
        // Try cache first
        const cacheKey = `checkpoint:${checkpointId}`;
        const cached = await this.cacheClient.get(cacheKey);
        
        if (cached) {
            return JSON.parse(cached);
        }
        
        // Fallback to database
        return await this.getCheckpointFromDb(checkpointId);
    }
    
    /**
     * Get checkpoint from database
     */
    async getCheckpointFromDb(checkpointId) {
        const db = this.dbManager.getDb();
        const stmt = db.prepare('SELECT * FROM checkpoints WHERE id = ?');
        const row = stmt.get(checkpointId);
        
        if (!row) {
            return null;
        }
        
        return this.parseCheckpointRow(row);
    }
    
    /**
     * Get checkpoints by run ID and stage
     */
    async getCheckpointsByRunAndStage(runId, stage) {
        const db = this.dbManager.getDb();
        const stmt = db.prepare('SELECT * FROM checkpoints WHERE run_id = ? AND stage = ?');
        const rows = stmt.all(runId, stage);
        
        return rows.map(row => this.parseCheckpointRow(row));
    }
    
    /**
     * Get latest checkpoint for an entity
     */
    async getLatestCheckpoint(runId, entityId) {
        const db = this.dbManager.getDb();
        const stmt = db.prepare(`
            SELECT * FROM checkpoints 
            WHERE run_id = ? AND entity_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `);
        
        const row = stmt.get(runId, entityId);
        return row ? this.parseCheckpointRow(row) : null;
    }
    
    /**
     * Rollback to a specific checkpoint
     */
    async rollbackToCheckpoint(checkpointId, runId) {
        const timer = this.logger.startTimer('rollback-checkpoint');
        
        try {
            // Get the checkpoint to rollback to
            const targetCheckpoint = await this.getCheckpoint(checkpointId);
            if (!targetCheckpoint) {
                throw new Error(`Checkpoint not found: ${checkpointId}`);
            }
            
            // Get all checkpoints created after this one
            const db = this.dbManager.getDb();
            const stmt = db.prepare(`
                SELECT * FROM checkpoints 
                WHERE run_id = ? AND created_at > ?
                ORDER BY created_at ASC
            `);
            
            const rows = stmt.all(runId, targetCheckpoint.created_at || new Date().toISOString());
            const invalidatedCheckpoints = rows.map(row => this.parseCheckpointRow(row));
            
            // Invalidate newer checkpoints
            const invalidateStmt = db.prepare(
                'UPDATE checkpoints SET status = ? WHERE id = ?'
            );
            
            for (const checkpoint of invalidatedCheckpoints) {
                invalidateStmt.run(this.STATUSES.INVALIDATED, checkpoint.id);
                await this.cacheClient.del(`checkpoint:${checkpoint.id}`);
            }
            
            // Determine next stage
            const stageOrder = Object.values(this.STAGES);
            const currentIndex = stageOrder.indexOf(targetCheckpoint.stage);
            const nextStage = stageOrder[currentIndex + 1] || null;
            
            timer.end();
            
            return {
                rolledBackTo: checkpointId,
                invalidatedCheckpoints: invalidatedCheckpoints.map(c => c.id),
                nextStage
            };
            
        } catch (error) {
            timer.end();
            this.logger.error('Failed to rollback checkpoint', {
                error,
                checkpointId,
                runId
            });
            throw error;
        }
    }
    
    /**
     * Calculate checkpoint overhead
     */
    async calculateOverhead(runId) {
        const db = this.dbManager.getDb();
        
        // Get total checkpoint time
        const checkpointStmt = db.prepare(`
            SELECT SUM(
                CASE 
                    WHEN completed_at IS NOT NULL 
                    THEN CAST((julianday(completed_at) - julianday(created_at)) * 86400000 AS INTEGER)
                    ELSE 0
                END
            ) as total_checkpoint_time
            FROM checkpoints
            WHERE run_id = ?
        `);
        
        const checkpointResult = checkpointStmt.get(runId);
        const totalCheckpointTime = checkpointResult?.total_checkpoint_time || 0;
        
        // Get total pipeline time
        const pipelineStmt = db.prepare(`
            SELECT 
                MIN(created_at) as start_time,
                MAX(COALESCE(completed_at, failed_at, created_at)) as end_time
            FROM checkpoints
            WHERE run_id = ?
        `);
        
        const pipelineResult = pipelineStmt.get(runId);
        let totalPipelineTime = 0;
        
        if (pipelineResult?.start_time && pipelineResult?.end_time) {
            const start = new Date(pipelineResult.start_time);
            const end = new Date(pipelineResult.end_time);
            totalPipelineTime = end - start;
        }
        
        const overheadPercentage = totalPipelineTime > 0 
            ? (totalCheckpointTime / totalPipelineTime) * 100 
            : 0;
        
        return {
            totalCheckpointTime,
            totalPipelineTime,
            overheadPercentage
        };
    }
    
    /**
     * Clean up old checkpoints
     */
    async cleanupOldCheckpoints(daysToKeep = 7) {
        const db = this.dbManager.getDb();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const stmt = db.prepare(`
            DELETE FROM checkpoints 
            WHERE created_at < ?
        `);
        
        const result = stmt.run(cutoffDate.toISOString());
        
        return {
            deletedCount: result.changes,
            olderThan: daysToKeep
        };
    }
    
    /**
     * Clean up checkpoints for a specific run
     */
    async cleanupRunCheckpoints(runId) {
        const db = this.dbManager.getDb();
        
        // Get all checkpoint IDs first
        const selectStmt = db.prepare('SELECT id FROM checkpoints WHERE run_id = ?');
        const checkpoints = selectStmt.all(runId);
        
        // Clear cache
        for (const checkpoint of checkpoints) {
            await this.cacheClient.del(`checkpoint:${checkpoint.id}`);
        }
        
        // Delete from database
        const deleteStmt = db.prepare('DELETE FROM checkpoints WHERE run_id = ?');
        deleteStmt.run(runId);
    }
    
    /**
     * Create multiple checkpoints in batch
     */
    async createBatchCheckpoints(checkpointData) {
        const results = [];
        
        for (const data of checkpointData) {
            try {
                const checkpoint = await this.createCheckpoint(data);
                results.push(checkpoint);
            } catch (error) {
                this.logger.error('Failed to create checkpoint in batch', {
                    error,
                    data
                });
                results.push({
                    error: error.message,
                    data
                });
            }
        }
        
        return results;
    }
    
    /**
     * Validate multiple checkpoints in batch
     */
    async validateBatchCheckpoints(checkpoints) {
        const results = [];
        
        for (const checkpoint of checkpoints) {
            const validationResult = await this.validateCheckpoint(checkpoint);
            results.push({
                checkpointId: checkpoint.id,
                ...validationResult
            });
        }
        
        return results;
    }
    
    /**
     * Create checkpoint from worker context
     */
    async createFromWorkerContext(context) {
        const { jobId, runId, stage, entityId, ...metadata } = context;
        
        return await this.createCheckpoint({
            runId,
            stage,
            entityId,
            metadata: {
                jobId,
                ...metadata
            }
        });
    }
    
    /**
     * Get run summary with checkpoint statistics
     */
    async getRunSummary(runId) {
        const db = this.dbManager.getDb();
        
        const stmt = db.prepare(`
            SELECT 
                stage,
                status,
                COUNT(*) as count
            FROM checkpoints
            WHERE run_id = ?
            GROUP BY stage, status
        `);
        
        const rows = stmt.all(runId);
        
        const stages = {};
        let totalCompleted = 0;
        let totalCheckpoints = 0;
        
        for (const row of rows) {
            if (!stages[row.stage]) {
                stages[row.stage] = {
                    completed: 0,
                    failed: 0,
                    pending: 0,
                    total: 0
                };
            }
            
            if (row.status === this.STATUSES.COMPLETED) {
                stages[row.stage].completed = row.count;
                totalCompleted += row.count;
            } else if (row.status === this.STATUSES.FAILED) {
                stages[row.stage].failed = row.count;
            } else if (row.status === this.STATUSES.PENDING) {
                stages[row.stage].pending = row.count;
            }
            
            stages[row.stage].total += row.count;
            totalCheckpoints += row.count;
        }
        
        // Calculate success rates
        for (const stage of Object.values(stages)) {
            stage.successRate = stage.total > 0 
                ? stage.completed / stage.total 
                : 0;
        }
        
        const overallProgress = totalCheckpoints > 0 
            ? totalCompleted / totalCheckpoints 
            : 0;
        
        return {
            runId,
            stages,
            overallProgress,
            totalCheckpoints,
            totalCompleted
        };
    }
    
    /**
     * Cache checkpoint data
     */
    async cacheCheckpoint(checkpoint) {
        const cacheKey = `checkpoint:${checkpoint.id}`;
        const pipeline = this.cacheClient.pipeline();
        
        pipeline.set(cacheKey, JSON.stringify(checkpoint));
        pipeline.expire(cacheKey, 3600); // 1 hour TTL
        
        await pipeline.exec();
    }
    
    /**
     * Parse checkpoint row from database
     */
    parseCheckpointRow(row) {
        return {
            id: row.id,
            runId: row.run_id,
            stage: row.stage,
            entityId: row.entity_id,
            status: row.status,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
            validationResult: row.validation_result ? JSON.parse(row.validation_result) : null,
            error: row.error,
            createdAt: row.created_at ? new Date(row.created_at) : null,
            completedAt: row.completed_at ? new Date(row.completed_at) : null,
            failedAt: row.failed_at ? new Date(row.failed_at) : null
        };
    }
}

module.exports = CheckpointManager;