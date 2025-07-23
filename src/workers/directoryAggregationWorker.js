const { Worker } = require('bullmq');
const { ManagedWorker } = require('./ManagedWorker');
const { getLogger } = require('../config/logging');

class DirectoryAggregationWorker {
    constructor(queueManager, cacheClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.cacheClient = cacheClient;
        this.workerPoolManager = workerPoolManager;
        this.directoryResolutionQueue = this.queueManager.getQueue('directory-resolution-queue');
        
        // Initialize logger
        this.logger = getLogger('DirectoryAggregationWorker');
        
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
                
                this.logger.info('DirectoryAggregationWorker configured', {
                    maxConcurrency: this.managedWorker.config.maxConcurrency,
                    baseConcurrency: this.managedWorker.config.baseConcurrency
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
            
            // Setup event handlers
            this.managedWorker.on('jobCompleted', (event) => {
                this.logger.logQueueEvent('completed', 'directory-aggregation-queue', event.jobId, {
                    processingTime: event.processingTime
                });
            });
            
            this.managedWorker.on('jobFailed', (event) => {
                this.logger.error('Job failed', new Error(event.error), {
                    jobId: event.jobId,
                    queueName: 'directory-aggregation-queue'
                });
            });
            
            this.managedWorker.on('concurrencyChanged', (event) => {
                this.logger.logWorkerPoolEvent('concurrency-changed', 'directory-aggregation', event.newConcurrency, {
                    oldConcurrency: event.oldConcurrency,
                    reason: event.reason
                });
            });
            
            this.logger.info('DirectoryAggregationWorker initialized with managed concurrency');
        } catch (error) {
            this.logger.error('Failed to initialize DirectoryAggregationWorker', error);
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
        
        // Create child logger with correlation ID
        const jobLogger = this.logger.child(job.id);
        
        // Create performance logger for this job
        const { createPerformanceLogger } = require('../config/logging');
        const perfLogger = createPerformanceLogger(`directory-aggregation-${job.id}`, jobLogger);
        perfLogger.start();
        
        jobLogger.info('Processing directory aggregation job', {
            directoryPath,
            runId,
            fileJobId,
            jobId: job.id
        });

        try {
            const directoryFilesKey = `run:${runId}:dir:${directoryPath}:files`;
            const processedFilesKey = `run:${runId}:dir:${directoryPath}:processed`;

            // Atomically mark the file as processed and check if all files are done
            const cacheStart = Date.now();
            const pipeline = this.cacheClient.pipeline();
            pipeline.sadd(processedFilesKey, fileJobId);
            pipeline.scard(directoryFilesKey);
            pipeline.scard(processedFilesKey);
            const [, totalFiles, processedFiles] = await pipeline.exec();
            perfLogger.checkpoint('cache-operations', { duration: Date.now() - cacheStart });

            jobLogger.info('Directory aggregation progress', {
                directoryPath,
                totalFiles: totalFiles[1],
                processedFiles: processedFiles[1],
                isComplete: totalFiles[1] === processedFiles[1]
            });

            if (totalFiles[1] === processedFiles[1]) {
                jobLogger.info('All files in directory processed, enqueuing for resolution', {
                    directoryPath,
                    totalFiles: totalFiles[1]
                });
                
                const resolutionJob = await this.directoryResolutionQueue.add('analyze-directory', {
                    directoryPath,
                    runId,
                });
                
                jobLogger.info('Directory resolution job enqueued', {
                    directoryPath,
                    resolutionJobId: resolutionJob.id,
                    parentJobId: job.id
                });
            }
            
            const metrics = perfLogger.end({
                totalFiles: totalFiles[1],
                processedFiles: processedFiles[1],
                allFilesProcessed: totalFiles[1] === processedFiles[1]
            });
            
            // Log performance metrics
            jobLogger.info('Directory aggregation metrics', {
                duration: metrics.duration,
                memoryDelta: metrics.memoryDelta,
                totalFiles: totalFiles[1],
                processedFiles: processedFiles[1]
            });
            
        } catch (error) {
            perfLogger.end({ success: false, error: error.message });
            jobLogger.error('Error processing directory aggregation job', error, {
                directoryPath,
                runId,
                fileJobId,
                jobId: job.id
            });
            
            // Add contextual information to error
            error.context = {
                directoryPath,
                runId,
                fileJobId,
                jobId: job.id,
                workerType: 'directory-aggregation'
            };
            
            throw error;
        }
    }
}

module.exports = DirectoryAggregationWorker;