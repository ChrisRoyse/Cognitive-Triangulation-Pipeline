
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

/**
 * Asynchronous validation coordinator
 */
class AsyncValidationCoordinator {
    constructor(db, options = {}) {
        this.db = db;
        this.maxWorkers = options.maxWorkers || require('os').cpus().length;
        this.workers = [];
        this.pendingTasks = [];
        this.activeTasks = new Map();
        this.results = [];
    }

    async validateAsync(relationshipIds) {
        return new Promise((resolve, reject) => {
            if (!isMainThread) {
                reject(new Error('AsyncValidationCoordinator must run in main thread'));
                return;
            }

            const chunks = this.chunkArray(relationshipIds, Math.ceil(relationshipIds.length / this.maxWorkers));
            let completedWorkers = 0;
            const results = [];

            for (let i = 0; i < chunks.length; i++) {
                const worker = new Worker(__filename, {
                    workerData: {
                        chunk: chunks[i],
                        workerId: i,
                        dbPath: this.db.name
                    }
                });

                worker.on('message', (result) => {
                    results.push(result);
                    completedWorkers++;
                    
                    if (completedWorkers === chunks.length) {
                        const mergedResults = this.mergeResults(results);
                        resolve(mergedResults);
                    }
                });

                worker.on('error', (error) => {
                    reject(error);
                });

                this.workers.push(worker);
            }
        });
    }

    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    mergeResults(results) {
        return {
            totalProcessed: results.reduce((sum, r) => sum + r.processed, 0),
            totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
            executionTimeMs: Math.max(...results.map(r => r.executionTimeMs)),
            details: results
        };
    }

    async cleanup() {
        for (const worker of this.workers) {
            await worker.terminate();
        }
        this.workers = [];
    }
}

// Worker thread code
if (!isMainThread) {
    const Database = require('better-sqlite3');
    const { chunk, workerId, dbPath } = workerData;
    
    async function processChunk() {
        const db = new Database(dbPath);
        const startTime = Date.now();
        let processed = 0;
        let errors = 0;
        
        try {
            const stmt = db.prepare(`
                SELECT r.*, sp.id as source_exists, tp.id as target_exists
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.id IN (${chunk.map(() => '?').join(',')})
            `);
            
            const results = stmt.all(...chunk);
            
            for (const row of results) {
                processed++;
                
                // Validation logic
                if (!row.source_exists || !row.target_exists || 
                    !row.confidence || row.confidence <= 0 || row.confidence > 1 ||
                    !row.type || row.type.trim() === '') {
                    errors++;
                }
            }
            
            parentPort.postMessage({
                workerId,
                processed,
                errors,
                executionTimeMs: Date.now() - startTime
            });
            
        } catch (error) {
            parentPort.postMessage({
                workerId,
                error: error.message,
                processed,
                errors
            });
        } finally {
            db.close();
        }
    }
    
    processChunk();
}

module.exports = AsyncValidationCoordinator;
