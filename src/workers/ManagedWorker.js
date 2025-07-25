/**
 * Managed Worker Base Class
 * 
 * Enhanced worker implementation that integrates with WorkerPoolManager
 * for intelligent concurrency control, rate limiting, and fault tolerance.
 */

const { Worker } = require('bullmq');
const { EventEmitter } = require('events');
const { getLogger } = require('../config/logging');

class ManagedWorker extends EventEmitter {
    constructor(queueName, workerPoolManager, options = {}) {
        super();
        
        if (!workerPoolManager) {
            throw new Error(`ManagedWorker requires a WorkerPoolManager instance. Got: ${typeof workerPoolManager}`);
        }
        
        this.queueName = queueName;
        this.workerPoolManager = workerPoolManager;
        this.workerType = options.workerType || queueName.replace('-queue', '');
        
        // Initialize logger
        this.logger = getLogger('ManagedWorker', { workerType: this.workerType });
        
        // Configuration
        this.config = {
            // Worker identification
            workerId: options.workerId || `${this.workerType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            
            // Concurrency settings
            baseConcurrency: options.baseConcurrency || 5,
            maxConcurrency: options.maxConcurrency || 50,
            minConcurrency: options.minConcurrency || 1,
            
            // Rate limiting removed - only global 100 agent limit matters
            // rateLimitRequests: options.rateLimitRequests || 10,
            // rateLimitWindow: options.rateLimitWindow || 1000,
            
            // Circuit breaker settings
            failureThreshold: options.failureThreshold || 5,
            resetTimeout: options.resetTimeout || 60000,
            
            // No jobTimeout - allow unlimited time for large codebases
            retryAttempts: options.retryAttempts || 2, // Reduced from 3 to 2 for alignment
            retryDelay: options.retryDelay || 3000, // Reduced from 5000 to 3000 for faster retries
            
            // Health monitoring
            enableHealthCheck: options.enableHealthCheck !== false,
            healthCheckInterval: options.healthCheckInterval || 30000,
            
            // Metrics
            enableMetrics: options.enableMetrics !== false,
            metricsReportInterval: options.metricsReportInterval || 60000,
            
            ...options
        };
        
        // State
        this.isInitialized = false;
        this.isShuttingDown = false;
        this.worker = null;
        this.activeJobs = new Map();
        
        // Metrics
        this.metrics = {
            startTime: Date.now(),
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            retriedJobs: 0,
            avgProcessingTime: 0,
            lastJobTime: null,
            processingTimes: [],
            errors: [],
            lastHealthCheck: null
        };
        
        // Timers with atomic management
        this.timers = {
            healthCheck: null,
            metrics: null,
            // Atomic timer operations
            set(name, timerId) {
                if (this[name] === null) {
                    this[name] = timerId;
                    return true;
                }
                return false; // Timer already set
            },
            clear(name) {
                const timerId = this[name];
                if (timerId !== null) {
                    clearInterval(timerId);
                    this[name] = null;
                    return true;
                }
                return false; // No timer to clear
            },
            clearAll() {
                const toClean = [];
                // Atomically collect all timers
                Object.keys(this).forEach(key => {
                    if (key !== 'set' && key !== 'clear' && key !== 'clearAll' && this[key] !== null) {
                        toClean.push({name: key, id: this[key]});
                        this[key] = null;
                    }
                });
                // Clear them outside the critical section
                toClean.forEach(timer => clearInterval(timer.id));
                return toClean.length;
            }
        };
        
        this.logger.info('ManagedWorker created', {
            workerId: this.config.workerId,
            baseConcurrency: this.config.baseConcurrency,
            maxConcurrency: this.config.maxConcurrency
        });
    }

    /**
     * Initialize the worker
     */
    async initialize(connection, processingFunction) {
        if (this.isInitialized) {
            throw new Error(`Worker '${this.workerType}' is already initialized`);
        }
        
        try {
            // Register with WorkerPoolManager
            this.workerInfo = this.workerPoolManager.registerWorker(this.workerType, {
                maxConcurrency: this.config.maxConcurrency,
                minConcurrency: this.config.minConcurrency,
                failureThreshold: this.config.failureThreshold,
                resetTimeout: this.config.resetTimeout
                // Rate limiting removed - only global 100 agent limit matters
                // rateLimitRequests: this.config.rateLimitRequests,
                // rateLimitWindow: this.config.rateLimitWindow
            });
            
            // Create BullMQ worker with managed concurrency
            // Create a new connection to avoid "write after end" errors
            const config = require('../../config');
            const IORedis = require('ioredis');
            const workerConnection = new IORedis(config.REDIS_URL, {
                maxRetriesPerRequest: null,
                enableReadyCheck: true,
                connectionName: `worker-${this.workerType}-${this.config.workerId}`,
                lazyConnect: true, // Don't connect immediately
            });
            
            // Store connection for cleanup
            this.workerConnection = workerConnection;
            
            // Ensure connection is ready before creating worker
            await workerConnection.connect();
            
            this.worker = new Worker(this.queueName, this.createManagedProcessor(processingFunction), {
                connection: workerConnection,
                concurrency: this.workerInfo.concurrency,
                removeOnComplete: {
                    count: 100,
                    age: 3600 // 1 hour
                },
                removeOnFail: {
                    count: 50,
                    age: 86400 // 24 hours
                },
                settings: {
                    stalledInterval: 30000,
                    maxStalledCount: 1
                }
            });
            
            // Setup event handlers
            this.setupEventHandlers();
            
            // Start monitoring
            if (this.config.enableHealthCheck) {
                this.startHealthMonitoring();
            }
            
            if (this.config.enableMetrics) {
                this.startMetricsReporting();
            }
            
            this.isInitialized = true;
            
            console.log(`✅ ManagedWorker '${this.workerType}' initialized with concurrency: ${this.workerInfo.concurrency}`);
            this.emit('initialized', this.workerInfo);
            
        } catch (error) {
            console.error(`❌ Failed to initialize worker '${this.workerType}':`, error);
            throw error;
        }
    }

    /**
     * Create managed job processor that integrates with WorkerPoolManager
     */
    createManagedProcessor(originalProcessor) {
        return async (job) => {
            const jobId = job.id;
            const startTime = Date.now();
            let slot = null;
            
            try {
                // Request job slot from WorkerPoolManager
                slot = await this.workerPoolManager.requestJobSlot(this.workerType, job.data);
                
                // Track active job
                this.activeJobs.set(jobId, {
                    slot,
                    startTime,
                    data: job.data,
                    attempts: job.attemptsMade + 1
                });
                
                this.metrics.totalJobs++;
                this.emit('jobStarted', { jobId, workerType: this.workerType, data: job.data });
                
                console.log(`🔄 [${this.workerType}] Processing job ${jobId} (attempt ${job.attemptsMade + 1})`);
                
                // Execute original processor without timeout (unlimited time for large codebases)
                const result = await originalProcessor(job);
                
                // Success
                const processingTime = Date.now() - startTime;
                this.handleJobSuccess(jobId, processingTime, result);
                
                return result;
                
            } catch (error) {
                // Failure
                const processingTime = Date.now() - startTime;
                this.handleJobFailure(jobId, processingTime, error, job.attemptsMade);
                
                throw error;
                
            } finally {
                // Always release slot and cleanup
                if (slot) {
                    const processingTime = Date.now() - startTime;
                    const success = !this.activeJobs.get(jobId)?.failed;
                    this.workerPoolManager.releaseJobSlot(this.workerType, success, processingTime);
                }
                
                this.activeJobs.delete(jobId);
            }
        };
    }

    /**
     * Execute function with timeout (race condition safe)
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise(async (resolve, reject) => {
            let timeoutCleared = false;
            
            const timeoutId = setTimeout(() => {
                if (!timeoutCleared) {
                    timeoutCleared = true;
                    reject(new Error(`Job timeout after ${timeout}ms`));
                }
            }, timeout);
            
            const clearTimeoutSafe = () => {
                if (!timeoutCleared) {
                    timeoutCleared = true;
                    clearTimeout(timeoutId);
                }
            };
            
            try {
                const result = await fn();
                clearTimeoutSafe();
                resolve(result);
            } catch (error) {
                clearTimeoutSafe();
                reject(error);
            }
        });
    }

    /**
     * Handle successful job completion
     */
    handleJobSuccess(jobId, processingTime, result) {
        this.metrics.completedJobs++;
        this.metrics.lastJobTime = Date.now();
        this.updateProcessingTimeMetrics(processingTime);
        
        console.log(`✅ [${this.workerType}] Job ${jobId} completed in ${processingTime}ms`);
        
        this.emit('jobCompleted', {
            jobId,
            workerType: this.workerType,
            processingTime,
            result
        });
    }

    /**
     * Handle job failure
     */
    handleJobFailure(jobId, processingTime, error, attemptsMade) {
        this.metrics.failedJobs++;
        this.metrics.lastJobTime = Date.now();
        this.updateProcessingTimeMetrics(processingTime);
        
        // Track error
        this.metrics.errors.push({
            timestamp: Date.now(),
            jobId,
            error: error.message,
            attempt: attemptsMade + 1,
            processingTime
        });
        
        // Keep only last 50 errors
        if (this.metrics.errors.length > 50) {
            this.metrics.errors.shift();
        }
        
        console.error(`❌ [${this.workerType}] Job ${jobId} failed in ${processingTime}ms:`, error.message);
        
        this.emit('jobFailed', {
            jobId,
            workerType: this.workerType,
            processingTime,
            error: error.message,
            attempt: attemptsMade + 1
        });
        
        // Mark job as failed for cleanup
        const activeJob = this.activeJobs.get(jobId);
        if (activeJob) {
            activeJob.failed = true;
        }
    }

    /**
     * Update processing time metrics
     */
    updateProcessingTimeMetrics(processingTime) {
        this.metrics.processingTimes.push(processingTime);
        
        // Keep only last 100 processing times
        if (this.metrics.processingTimes.length > 100) {
            this.metrics.processingTimes.shift();
        }
        
        // Update average
        this.metrics.avgProcessingTime = this.metrics.processingTimes.reduce((sum, time) => sum + time, 0) / this.metrics.processingTimes.length;
    }

    /**
     * Setup worker event handlers
     */
    setupEventHandlers() {
        this.worker.on('completed', (job) => {
            console.log(`✅ [${this.workerType}] BullMQ job ${job.id} completed`);
        });
        
        this.worker.on('failed', (job, err) => {
            console.error(`❌ [${this.workerType}] BullMQ job ${job?.id} failed:`, err.message);
        });
        
        this.worker.on('error', (err) => {
            console.error(`❌ [${this.workerType}] Worker error:`, err);
            this.emit('error', err);
        });
        
        this.worker.on('stalled', (jobId) => {
            console.warn(`⚠️  [${this.workerType}] Job ${jobId} stalled`);
            this.emit('stalled', jobId);
        });
        
        // Listen to WorkerPoolManager events
        this.workerPoolManager.on('workerScaled', (event) => {
            if (event.worker === this.workerType) {
                this.handleConcurrencyChange(event.newConcurrency, event.reason);
            }
        });
        
        this.workerPoolManager.on('circuitBreakerStateChange', (event) => {
            if (event.workerType === this.workerType) {
                this.handleCircuitBreakerChange(event.oldState, event.newState);
            }
        });
    }

    /**
     * Handle concurrency changes from WorkerPoolManager
     */
    handleConcurrencyChange(newConcurrency, reason) {
        if (this.worker && this.worker.opts.concurrency !== newConcurrency) {
            this.logger.info('Worker pool concurrency changed', {
                eventType: 'worker-pool-event',
                workerType: this.workerType,
                newConcurrency,
                oldConcurrency: this.worker.opts.concurrency,
                reason
            });
            
            // BullMQ doesn't support dynamic concurrency changes, so we log it
            // In a production system, you might restart the worker with new concurrency
            this.emit('concurrencyChanged', {
                oldConcurrency: this.worker.opts.concurrency,
                newConcurrency,
                reason
            });
        }
    }

    /**
     * Handle circuit breaker state changes
     */
    handleCircuitBreakerChange(oldState, newState) {
        console.log(`🔀 [${this.workerType}] Circuit breaker: ${oldState} → ${newState}`);
        
        this.emit('circuitBreakerChanged', {
            workerType: this.workerType,
            oldState,
            newState
        });
        
        if (newState === 'OPEN') {
            console.warn(`🚨 [${this.workerType}] Circuit breaker opened - jobs will be rejected`);
        } else if (newState === 'CLOSED') {
            console.log(`✅ [${this.workerType}] Circuit breaker closed - normal operation resumed`);
        }
    }

    /**
     * Start health monitoring (race condition safe)
     */
    startHealthMonitoring() {
        const timerId = setInterval(async () => {
            try {
                const health = await this.performHealthCheck();
                this.metrics.lastHealthCheck = Date.now();
                
                if (!health.healthy) {
                    console.warn(`⚠️  [${this.workerType}] Health check failed:`, health.issues);
                    this.emit('unhealthy', health);
                }
                
            } catch (error) {
                console.error(`❌ [${this.workerType}] Health check error:`, error);
            }
        }, this.config.healthCheckInterval);
        
        if (this.timers.set('healthCheck', timerId)) {
            console.log(`🏥 [${this.workerType}] Health monitoring started`);
        } else {
            clearInterval(timerId);
            console.warn(`⚠️  [${this.workerType}] Health monitoring already running`);
        }
    }

    /**
     * Perform health check
     */
    async performHealthCheck() {
        const issues = [];
        
        // Check if worker is operational
        if (!this.worker || this.isShuttingDown) {
            issues.push('Worker not operational');
        }
        
        // Check error rate
        const totalJobs = this.metrics.completedJobs + this.metrics.failedJobs;
        const errorRate = totalJobs > 0 ? (this.metrics.failedJobs / totalJobs) * 100 : 0;
        
        if (errorRate > 20) {
            issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
        }
        
        // Check processing time
        // No job timeout limits - allow unlimited processing time
        
        // No stalled job detection - jobs can take unlimited time
        
        return {
            healthy: issues.length === 0,
            issues,
            metrics: this.getMetrics(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Start metrics reporting (race condition safe)
     */
    startMetricsReporting() {
        const timerId = setInterval(() => {
            const metrics = this.getMetrics();
            
            console.log(`📊 [${this.workerType}] Metrics - Jobs: ${metrics.totalJobs}, Success Rate: ${metrics.successRate.toFixed(1)}%, Avg Time: ${metrics.avgProcessingTime.toFixed(0)}ms`);
            
            this.emit('metrics', metrics);
        }, this.config.metricsReportInterval);
        
        if (this.timers.set('metrics', timerId)) {
            console.log(`📊 [${this.workerType}] Metrics reporting started`);
        } else {
            clearInterval(timerId);
            console.warn(`⚠️  [${this.workerType}] Metrics reporting already running`);
        }
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        const totalJobs = this.metrics.completedJobs + this.metrics.failedJobs;
        const successRate = totalJobs > 0 ? (this.metrics.completedJobs / totalJobs) * 100 : 0;
        const uptime = Date.now() - this.metrics.startTime;
        
        return {
            workerType: this.workerType,
            workerId: this.config.workerId,
            uptime,
            totalJobs: this.metrics.totalJobs,
            completedJobs: this.metrics.completedJobs,
            failedJobs: this.metrics.failedJobs,
            activeJobs: this.activeJobs.size,
            successRate,
            avgProcessingTime: this.metrics.avgProcessingTime,
            throughput: totalJobs > 0 ? (totalJobs / (uptime / 1000)) : 0, // jobs per second
            lastJobTime: this.metrics.lastJobTime,
            recentErrors: this.metrics.errors.slice(-5), // Last 5 errors
            concurrency: this.workerInfo?.concurrency || 0,
            circuitBreakerState: this.workerInfo?.circuitBreaker?.state || 'UNKNOWN'
        };
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            workerType: this.workerType,
            workerId: this.config.workerId,
            isInitialized: this.isInitialized,
            isShuttingDown: this.isShuttingDown,
            queueName: this.queueName,
            config: this.config,
            metrics: this.getMetrics(),
            workerInfo: this.workerInfo
        };
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        if (this.isShuttingDown) {
            console.log(`🔄 [${this.workerType}] Shutdown already in progress`);
            return;
        }
        
        this.isShuttingDown = true;
        console.log(`🛑 [${this.workerType}] Starting graceful shutdown...`);
        
        try {
            // Stop timers atomically
            const clearedTimers = this.timers.clearAll();
            if (clearedTimers > 0) {
                console.log(`🛑 [${this.workerType}] Cleaned up ${clearedTimers} timers`);
            }
            
            // Wait for active jobs to complete (with timeout)
            const shutdownTimeout = 30000; // 30 seconds
            const startTime = Date.now();
            
            while (this.activeJobs.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
                console.log(`⏳ [${this.workerType}] Waiting for ${this.activeJobs.size} active jobs to complete...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Close BullMQ worker
            if (this.worker) {
                await this.worker.close();
                this.worker = null;
            }
            
            // Close the dedicated worker connection
            if (this.workerConnection) {
                await this.workerConnection.disconnect();
                this.workerConnection = null;
            }
            
            // Final metrics report
            const finalMetrics = this.getMetrics();
            console.log(`📊 [${this.workerType}] Final metrics:`, finalMetrics);
            
            console.log(`✅ [${this.workerType}] Graceful shutdown completed`);
            this.emit('shutdown', finalMetrics);
            
        } catch (error) {
            console.error(`❌ [${this.workerType}] Error during shutdown:`, error);
            throw error;
        }
    }

    /**
     * Force close worker (emergency)
     */
    async forceClose() {
        console.warn(`🚨 [${this.workerType}] Force closing worker`);
        
        this.isShuttingDown = true;
        
        // Clear timers atomically
        const clearedTimers = this.timers.clearAll();
        if (clearedTimers > 0) {
            console.log(`🔥 [${this.workerType}] Force cleared ${clearedTimers} timers`);
        }
        
        // Force close worker
        if (this.worker) {
            await this.worker.close(true); // Force close
        }
        
        // Clear active jobs
        this.activeJobs.clear();
        
        console.log(`🔥 [${this.workerType}] Force close completed`);
        this.emit('forceClose');
    }
}

module.exports = { ManagedWorker };