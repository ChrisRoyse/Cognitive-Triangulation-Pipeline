const { Worker } = require('bullmq');
const { ManagedWorker } = require('./ManagedWorker');

class DirectoryAggregationWorker {
    constructor(queueManager, cacheClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.cacheClient = cacheClient;
        this.workerPoolManager = workerPoolManager;
        this.directoryResolutionQueue = this.queueManager.getQueue('directory-resolution-queue');
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('directory-aggregation-queue', workerPoolManager, {
                    workerType: 'directory-aggregation',
                    baseConcurrency: 10, // Good for quick aggregation tasks
                    maxConcurrency: 30,
                    minConcurrency: 2,
                    rateLimitRequests: 15, // Can handle more requests
                    rateLimitWindow: 1000,
                    failureThreshold: 5,
                    resetTimeout: 60000,
                    jobTimeout: 60000, // 1 minute for aggregation
                    retryAttempts: 3,
                    retryDelay: 5000,
                    ...options
                });
                
                // Initialize the managed worker
                this.initializeWorker();
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('directory-aggregation-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: 10,
                });
            }
        }
    }

    async initializeWorker() {
        try {
            await this.managedWorker.initialize(
                this.queueManager.connection,
                this.process.bind(this)
            );
            
            console.log('✅ DirectoryAggregationWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize DirectoryAggregationWorker:', error);
            throw error;
        }
    }

    async close() {
        if (this.managedWorker) {
            await this.managedWorker.shutdown();
        } else if (this.worker) {
            await this.worker.close();
        }
    }

    async process(job) {
        const { directoryPath, runId, fileJobId } = job.data;
        console.log(`[DirectoryAggregationWorker] Processing job for directory: ${directoryPath}`);

        const directoryFilesKey = `run:${runId}:dir:${directoryPath}:files`;
        const processedFilesKey = `run:${runId}:dir:${directoryPath}:processed`;

        // Atomically mark the file as processed and check if all files are done
        const pipeline = this.cacheClient.pipeline();
        pipeline.sadd(processedFilesKey, fileJobId);
        pipeline.scard(directoryFilesKey);
        pipeline.scard(processedFilesKey);
        const [, totalFiles, processedFiles] = await pipeline.exec();

        if (totalFiles[1] === processedFiles[1]) {
            console.log(`[DirectoryAggregationWorker] All files in ${directoryPath} processed. Enqueuing for resolution.`);
            await this.directoryResolutionQueue.add('analyze-directory', {
                directoryPath,
                runId,
            });
        }
    }
}

module.exports = DirectoryAggregationWorker;