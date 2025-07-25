
const ValidationCache = require('./ValidationCache');

/**
 * High-performance batch validation with caching and optimization
 */
class OptimizedBatchValidator {
    constructor(db, options = {}) {
        this.db = db;
        this.batchSize = options.batchSize || 5000;
        this.cache = new ValidationCache(options.cacheSize, options.cacheTtl);
        this.enableParallel = options.enableParallel || false;
        
        // Pre-compile prepared statements for performance
        this.preparedStatements = this.initializePreparedStatements();
    }

    initializePreparedStatements() {
        return {
            orphanedCheck: this.db.prepare(`
                SELECT r.id, 'ORPHANED_POI' as error_type
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND (sp.id IS NULL OR tp.id IS NULL)
                LIMIT ?
            `),
            
            confidenceCheck: this.db.prepare(`
                SELECT id, 'INVALID_CONFIDENCE' as error_type
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (confidence IS NULL OR confidence <= 0 OR confidence > 1)
                LIMIT ?
            `),
            
            typeCheck: this.db.prepare(`
                SELECT id, 'MISSING_TYPE' as error_type
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (type IS NULL OR type = '')
                LIMIT ?
            `),
            
            batchUpdate: this.db.prepare(`
                UPDATE relationships 
                SET status = 'FAILED', confidence = 0.0
                WHERE id = ?
            `)
        };
    }

    async validateInBatches() {
        console.log('[BatchValidator] Starting optimized batch validation...');
        
        const results = {
            totalProcessed: 0,
            errorsFound: 0,
            cacheHits: 0,
            executionTimeMs: 0
        };
        
        const startTime = Date.now();
        
        try {
            // Check cache first
            const cacheKey = this.cache.generateKey('batch_validation', { 
                timestamp: Math.floor(Date.now() / 300000) // 5-minute buckets
            });
            
            const cachedResult = this.cache.get(cacheKey);
            if (cachedResult) {
                console.log('[BatchValidator] Using cached validation results');
                results.cacheHits = 1;
                return cachedResult;
            }
            
            // Run validation checks in parallel for better performance
            const validationPromises = [
                this.runOrphanedCheck(),
                this.runConfidenceCheck(),
                this.runTypeCheck()
            ];
            
            const validationResults = await Promise.all(validationPromises);
            
            // Collect all errors
            const allErrors = validationResults.flat();
            results.errorsFound = allErrors.length;
            results.totalProcessed = this.getTotalRelationshipCount();
            
            // Apply fixes in batches
            if (allErrors.length > 0) {
                await this.applyFixesInBatches(allErrors);
            }
            
            results.executionTimeMs = Date.now() - startTime;
            
            // Cache results
            this.cache.set(cacheKey, results);
            
            console.log(`[BatchValidator] Completed in ${results.executionTimeMs}ms`);
            return results;
            
        } catch (error) {
            console.error('[BatchValidator] Batch validation failed:', error);
            throw error;
        }
    }

    async runOrphanedCheck() {
        const errors = [];
        let offset = 0;
        
        while (true) {
            const batch = this.preparedStatements.orphanedCheck.all(this.batchSize);
            if (batch.length === 0) break;
            
            errors.push(...batch);
            offset += this.batchSize;
            
            if (batch.length < this.batchSize) break;
        }
        
        return errors;
    }

    async runConfidenceCheck() {
        const errors = [];
        let offset = 0;
        
        while (true) {
            const batch = this.preparedStatements.confidenceCheck.all(this.batchSize);
            if (batch.length === 0) break;
            
            errors.push(...batch);
            offset += this.batchSize;
            
            if (batch.length < this.batchSize) break;
        }
        
        return errors;
    }

    async runTypeCheck() {
        const errors = [];
        let offset = 0;
        
        while (true) {
            const batch = this.preparedStatements.typeCheck.all(this.batchSize);
            if (batch.length === 0) break;
            
            errors.push(...batch);
            offset += this.batchSize;
            
            if (batch.length < this.batchSize) break;
        }
        
        return errors;
    }

    async applyFixesInBatches(errors) {
        console.log(`[BatchValidator] Applying fixes to ${errors.length} relationships...`);
        
        const transaction = this.db.transaction((errorBatch) => {
            for (const error of errorBatch) {
                this.preparedStatements.batchUpdate.run(error.id);
            }
        });
        
        // Process in chunks to avoid transaction size limits
        const chunkSize = 1000;
        for (let i = 0; i < errors.length; i += chunkSize) {
            const chunk = errors.slice(i, i + chunkSize);
            transaction(chunk);
        }
    }

    getTotalRelationshipCount() {
        return this.db.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get().count;
    }

    getCacheStats() {
        return this.cache.getStats();
    }
}

module.exports = OptimizedBatchValidator;
