
const { Transform } = require('stream');

/**
 * Memory-efficient streaming processor for large validation queries
 */
class StreamingValidationProcessor extends Transform {
    constructor(options = {}) {
        super({ objectMode: true });
        this.batchSize = options.batchSize || 1000;
        this.currentBatch = [];
        this.processedCount = 0;
        this.errorCount = 0;
    }

    _transform(record, encoding, callback) {
        this.currentBatch.push(record);
        
        if (this.currentBatch.length >= this.batchSize) {
            this.processBatch()
                .then(() => callback())
                .catch(callback);
        } else {
            callback();
        }
    }

    _flush(callback) {
        if (this.currentBatch.length > 0) {
            this.processBatch()
                .then(() => callback())
                .catch(callback);
        } else {
            callback();
        }
    }

    async processBatch() {
        const batch = this.currentBatch;
        this.currentBatch = [];
        
        try {
            const validationResults = await this.validateBatch(batch);
            
            for (const result of validationResults) {
                this.push(result);
            }
            
            this.processedCount += batch.length;
        } catch (error) {
            this.errorCount += batch.length;
            this.emit('error', error);
        }
    }

    async validateBatch(batch) {
        // Perform validation on batch
        return batch.map(record => ({
            ...record,
            isValid: this.validateRecord(record),
            validatedAt: new Date().toISOString()
        }));
    }

    validateRecord(record) {
        // Basic validation logic
        return record.source_poi_id && 
               record.target_poi_id && 
               record.confidence > 0 && 
               record.confidence <= 1 &&
               record.type && 
               record.type.trim() !== '';
    }

    getStats() {
        return {
            processed: this.processedCount,
            errors: this.errorCount,
            batches: Math.ceil(this.processedCount / this.batchSize)
        };
    }
}

module.exports = StreamingValidationProcessor;
