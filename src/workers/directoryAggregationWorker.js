const { Worker } = require('bullmq');
const { ManagedWorker } = require('./ManagedWorker');
const { getLogger } = require('../config/logging');
const { PipelineConfig } = require('../config/pipelineConfig');

class DirectoryAggregationWorker {
    constructor(queueManager, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.workerPoolManager = workerPoolManager;
        this.directoryResolutionQueue = this.queueManager.getQueue('directory-resolution-queue');
        
        // Initialize logger
        this.logger = getLogger('DirectoryAggregationWorker');
        
        // Use centralized configuration
        this.config = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = this.config.getWorkerLimit('directory-aggregation');
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('directory-aggregation-queue', workerPoolManager, {
                    workerType: 'directory-aggregation',
                    baseConcurrency: Math.min(5, workerLimit), // Good for quick aggregation tasks
                    maxConcurrency: workerLimit,
                    minConcurrency: 2,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: 15, // Can handle more requests
                    // rateLimitWindow: 1000,
                    failureThreshold: 10, // Increased from 5 to be less aggressive
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
                
                // Don't initialize here - let it be initialized explicitly
                console.log('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('directory-aggregation-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: workerLimit // Use centralized config
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
                this.logger.info('Job completed', {
                    eventType: 'queue-event',
                    queueName: 'directory-aggregation-queue',
                    jobId: event.jobId,
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
                this.logger.info('Worker pool concurrency changed', {
                    eventType: 'worker-pool-event',
                    workerType: 'directory-aggregation',
                    newConcurrency: event.newConcurrency,
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

            // Simple directory completion tracking without Redis caching
            // For no-cache pipeline, just trigger directory resolution immediately
            perfLogger.checkpoint('directory-check', { duration: 1 });

            jobLogger.info('Directory aggregation progress', {
                directoryPath,
                fileJobId: fileJobId,
                message: 'File completed - triggering directory resolution'
            });

            // Always trigger directory resolution for no-cache pipeline
            jobLogger.info('Triggering directory resolution', {
                directoryPath
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
            
            const metrics = perfLogger.end({
                directoryPath,
                fileJobId,
                triggerResolution: true
            });
            
            // Log performance metrics - simplified for no-cache pipeline
            jobLogger.info('Directory aggregation metrics', {
                duration: metrics.duration,
                memoryDelta: metrics.memoryDelta,
                directoryPath,
                fileJobId
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