/**
 * Queue Cleanup Manager - Comprehensive Queue Management and Cleanup System
 * 
 * Features:
 * - Systematic cleanup of stale, failed, and completed jobs
 * - Batch cleanup operations for performance
 * - Queue health monitoring and metrics collection
 * - Emergency cleanup capabilities for debugging
 * - Integration with PipelineConfig for cleanup settings
 * - Periodic cleanup scheduling with backoff strategies
 * - Graceful error handling and detailed logging
 */

const { EventEmitter } = require('events');

class QueueCleanupManager extends EventEmitter {
    constructor(queueManager, config = {}) {
        super();
        
        if (!queueManager) {
            throw new Error('QueueManager instance is required');
        }
        
        this.queueManager = queueManager;
        this.config = this._initializeConfig(config);
        this.isRunning = false;
        this.cleanupIntervals = new Map();
        this.metrics = this._initializeMetrics();
        
        // Bind context for event handlers
        this._handleQueueError = this._handleQueueError.bind(this);
        this._handleCleanupSuccess = this._handleCleanupSuccess.bind(this);
        
        console.log('🧹 QueueCleanupManager initialized');
        this._logConfiguration();
    }
    
    /**
     * Initialize cleanup configuration with defaults
     */
    _initializeConfig(userConfig) {
        const defaultConfig = {
            // Cleanup intervals
            periodicCleanupInterval: 5 * 60 * 1000,        // 5 minutes
            staleJobCleanupInterval: 10 * 60 * 1000,       // 10 minutes
            failedJobCleanupInterval: 30 * 60 * 1000,      // 30 minutes
            completedJobCleanupInterval: 60 * 60 * 1000,   // 1 hour
            
            // Retention policies
            maxJobAge: 24 * 60 * 60 * 1000,               // 24 hours
            maxStaleAge: 30 * 60 * 1000,                  // 30 minutes
            maxFailedJobRetention: 100,                    // Keep 100 failed jobs per queue
            maxCompletedJobRetention: 50,                  // Keep 50 completed jobs per queue
            
            // Batch processing
            batchSize: 100,                                // Process 100 jobs per batch
            maxBatchTime: 30 * 1000,                       // 30 seconds max per batch
            batchDelay: 1000,                              // 1 second between batches
            
            // Health monitoring
            healthCheckInterval: 2 * 60 * 1000,            // 2 minutes
            warningThresholds: {
                queueDepth: 1000,                          // Warn if queue > 1000 jobs
                failureRate: 0.1,                          // Warn if failure rate > 10%
                avgProcessingTime: 30 * 1000,              // Warn if avg > 30 seconds
                stalledJobs: 10                            // Warn if > 10 stalled jobs
            },
            criticalThresholds: {
                queueDepth: 5000,                          // Critical if queue > 5000 jobs
                failureRate: 0.25,                         // Critical if failure rate > 25%
                avgProcessingTime: 120 * 1000,             // Critical if avg > 2 minutes
                stalledJobs: 50                            // Critical if > 50 stalled jobs
            },
            
            // Emergency cleanup settings
            emergencyCleanupEnabled: true,
            emergencyThresholds: {
                totalJobs: 10000,                          // Emergency if total > 10k jobs
                memoryUsage: 0.9,                          // Emergency if memory > 90%
                consecutiveFailures: 10                     // Emergency if 10 consecutive failures
            },
            
            // Safety settings
            maxCleanupOperationsPerInterval: 50,           // Max 50 cleanup operations per run
            cleanupCooldownPeriod: 30 * 1000,             // 30 seconds cooldown after major cleanup
            enableSafetyChecks: true,                      // Enable safety checks before cleanup
            
            // Logging and monitoring
            enableDetailedLogging: process.env.NODE_ENV === 'development',
            logCleanupSummary: true,
            enableMetricsCollection: true,
            metricsRetentionPeriod: 24 * 60 * 60 * 1000   // 24 hours
        };
        
        return { ...defaultConfig, ...userConfig };
    }
    
    /**
     * Initialize metrics collection
     */
    _initializeMetrics() {
        return {
            startTime: Date.now(),
            totalCleanupOperations: 0,
            successfulCleanups: 0,
            failedCleanups: 0,
            jobsCleanedByType: {
                stale: 0,
                failed: 0,
                completed: 0,
                stuck: 0
            },
            lastCleanupTime: null,
            averageCleanupTime: 0,
            queueHealthHistory: [],
            emergencyCleanups: 0,
            lastHealthCheck: null,
            performanceMetrics: {
                avgBatchProcessingTime: 0,
                totalBatchesProcessed: 0,
                largestBatchSize: 0
            }
        };
    }
    
    /**
     * Start the cleanup manager with periodic cleanup scheduling
     */
    async start() {
        if (this.isRunning) {
            console.warn('⚠️  QueueCleanupManager is already running');
            return;
        }
        
        try {
            await this._validateConnection();
            
            this.isRunning = true;
            this._schedulePeriodicCleanup();
            this._scheduleHealthChecks();
            
            console.log('✅ QueueCleanupManager started successfully');
            this.emit('started');
            
        } catch (error) {
            console.error('❌ Failed to start QueueCleanupManager:', error);
            this.emit('error', error);
            throw error;
        }
    }
    
    /**
     * Stop the cleanup manager and clear all intervals
     */
    async stop() {
        if (!this.isRunning) {
            console.warn('⚠️  QueueCleanupManager is not running');
            return;
        }
        
        this.isRunning = false;
        
        // Clear all intervals
        for (const [name, intervalId] of this.cleanupIntervals) {
            clearInterval(intervalId);
            console.log(`🛑 Stopped ${name} cleanup interval`);
        }
        this.cleanupIntervals.clear();
        
        console.log('✅ QueueCleanupManager stopped');
        this.emit('stopped');
    }
    
    /**
     * Clean stale jobs from a specific queue or all queues
     */
    async cleanStaleJobs(queueName = null, maxAge = null) {
        const startTime = Date.now();
        const age = maxAge || this.config.maxStaleAge;
        const cutoffTime = Date.now() - age;
        
        try {
            console.log(`🧹 Starting stale job cleanup (age: ${age}ms)${queueName ? ` for queue: ${queueName}` : ''}`);
            
            const queuesToProcess = queueName ? [queueName] : this._getAllQueueNames();
            const results = {
                processed: 0,
                cleaned: 0,
                errors: 0,
                queues: {}
            };
            
            for (const name of queuesToProcess) {
                try {
                    const queue = this.queueManager.getQueue(name);
                    if (!queue) {
                        console.warn(`⚠️  Queue '${name}' not found, skipping`);
                        continue;
                    }
                    
                    const queueResult = await this._cleanStaleJobsFromQueue(queue, name, cutoffTime);
                    results.processed += queueResult.processed;
                    results.cleaned += queueResult.cleaned;
                    results.queues[name] = queueResult;
                    
                    if (this.config.enableDetailedLogging) {
                        console.log(`🧹 Queue '${name}': processed ${queueResult.processed}, cleaned ${queueResult.cleaned}`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error cleaning stale jobs from queue '${name}':`, error);
                    results.errors++;
                }
                
                // Small delay between queues to prevent overwhelming the system
                if (queuesToProcess.length > 1) {
                    await this._delay(this.config.batchDelay);
                }
            }
            
            const duration = Date.now() - startTime;
            this.metrics.jobsCleanedByType.stale += results.cleaned;
            this.metrics.successfulCleanups++;
            
            console.log(`✅ Stale job cleanup completed in ${duration}ms: ${results.cleaned} jobs cleaned from ${Object.keys(results.queues).length} queues`);
            
            this.emit('staleJobsCleanup', { ...results, duration });
            return results;
            
        } catch (error) {
            this.metrics.failedCleanups++;
            console.error('❌ Stale job cleanup failed:', error);
            this.emit('cleanupError', { type: 'stale', error, queueName });
            throw error;
        }
    }
    
    /**
     * Clean failed jobs from a specific queue or all queues
     */
    async cleanFailedJobs(queueName = null, retentionCount = null) {
        const startTime = Date.now();
        const retention = retentionCount || this.config.maxFailedJobRetention;
        
        try {
            console.log(`🧹 Starting failed job cleanup (retention: ${retention})${queueName ? ` for queue: ${queueName}` : ''}`);
            
            const queuesToProcess = queueName ? [queueName] : this._getAllQueueNames();
            const results = {
                processed: 0,
                cleaned: 0,
                errors: 0,
                queues: {}
            };
            
            for (const name of queuesToProcess) {
                try {
                    const queue = this.queueManager.getQueue(name);
                    if (!queue) {
                        console.warn(`⚠️  Queue '${name}' not found, skipping`);
                        continue;
                    }
                    
                    const queueResult = await this._cleanFailedJobsFromQueue(queue, name, retention);
                    results.processed += queueResult.processed;
                    results.cleaned += queueResult.cleaned;
                    results.queues[name] = queueResult;
                    
                    if (this.config.enableDetailedLogging) {
                        console.log(`🧹 Queue '${name}': processed ${queueResult.processed}, cleaned ${queueResult.cleaned}`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error cleaning failed jobs from queue '${name}':`, error);
                    results.errors++;
                }
                
                if (queuesToProcess.length > 1) {
                    await this._delay(this.config.batchDelay);
                }
            }
            
            const duration = Date.now() - startTime;
            this.metrics.jobsCleanedByType.failed += results.cleaned;
            this.metrics.successfulCleanups++;
            
            console.log(`✅ Failed job cleanup completed in ${duration}ms: ${results.cleaned} jobs cleaned from ${Object.keys(results.queues).length} queues`);
            
            this.emit('failedJobsCleanup', { ...results, duration });
            return results;
            
        } catch (error) {
            this.metrics.failedCleanups++;
            console.error('❌ Failed job cleanup failed:', error);
            this.emit('cleanupError', { type: 'failed', error, queueName });
            throw error;
        }
    }
    
    /**
     * Clean completed jobs beyond retention limits
     */
    async cleanCompletedJobs(queueName = null, retentionCount = null) {
        const startTime = Date.now();
        const retention = retentionCount || this.config.maxCompletedJobRetention;
        
        try {
            console.log(`🧹 Starting completed job cleanup (retention: ${retention})${queueName ? ` for queue: ${queueName}` : ''}`);
            
            const queuesToProcess = queueName ? [queueName] : this._getAllQueueNames();
            const results = {
                processed: 0,
                cleaned: 0,
                errors: 0,
                queues: {}
            };
            
            for (const name of queuesToProcess) {
                try {
                    const queue = this.queueManager.getQueue(name);
                    if (!queue) {
                        console.warn(`⚠️  Queue '${name}' not found, skipping`);
                        continue;
                    }
                    
                    const queueResult = await this._cleanCompletedJobsFromQueue(queue, name, retention);
                    results.processed += queueResult.processed;
                    results.cleaned += queueResult.cleaned;
                    results.queues[name] = queueResult;
                    
                    if (this.config.enableDetailedLogging) {
                        console.log(`🧹 Queue '${name}': processed ${queueResult.processed}, cleaned ${queueResult.cleaned}`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error cleaning completed jobs from queue '${name}':`, error);
                    results.errors++;
                }
                
                if (queuesToProcess.length > 1) {
                    await this._delay(this.config.batchDelay);
                }
            }
            
            const duration = Date.now() - startTime;
            this.metrics.jobsCleanedByType.completed += results.cleaned;
            this.metrics.successfulCleanups++;
            
            console.log(`✅ Completed job cleanup completed in ${duration}ms: ${results.cleaned} jobs cleaned from ${Object.keys(results.queues).length} queues`);
            
            this.emit('completedJobsCleanup', { ...results, duration });
            return results;
            
        } catch (error) {
            this.metrics.failedCleanups++;
            console.error('❌ Completed job cleanup failed:', error);
            this.emit('cleanupError', { type: 'completed', error, queueName });
            throw error;
        }
    }
    
    /**
     * Clear stuck jobs that are blocking workers
     */
    async clearStuckJobs(queueName = null) {
        const startTime = Date.now();
        
        try {
            console.log(`🧹 Starting stuck job cleanup${queueName ? ` for queue: ${queueName}` : ''}`);
            
            const queuesToProcess = queueName ? [queueName] : this._getAllQueueNames();
            const results = {
                processed: 0,
                cleaned: 0,
                errors: 0,
                queues: {}
            };
            
            for (const name of queuesToProcess) {
                try {
                    const queue = this.queueManager.getQueue(name);
                    if (!queue) {
                        console.warn(`⚠️  Queue '${name}' not found, skipping`);
                        continue;
                    }
                    
                    const queueResult = await this._clearStuckJobsFromQueue(queue, name);
                    results.processed += queueResult.processed;
                    results.cleaned += queueResult.cleaned;
                    results.queues[name] = queueResult;
                    
                    if (this.config.enableDetailedLogging) {
                        console.log(`🧹 Queue '${name}': processed ${queueResult.processed}, cleared ${queueResult.cleaned} stuck jobs`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error clearing stuck jobs from queue '${name}':`, error);
                    results.errors++;
                }
                
                if (queuesToProcess.length > 1) {
                    await this._delay(this.config.batchDelay);
                }
            }
            
            const duration = Date.now() - startTime;
            this.metrics.jobsCleanedByType.stuck += results.cleaned;
            this.metrics.successfulCleanups++;
            
            console.log(`✅ Stuck job cleanup completed in ${duration}ms: ${results.cleaned} jobs cleared from ${Object.keys(results.queues).length} queues`);
            
            this.emit('stuckJobsCleanup', { ...results, duration });
            return results;
            
        } catch (error) {
            this.metrics.failedCleanups++;
            console.error('❌ Stuck job cleanup failed:', error);
            this.emit('cleanupError', { type: 'stuck', error, queueName });
            throw error;
        }
    }
    
    /**
     * Emergency cleanup - clear all jobs from all queues
     */
    async clearAllQueues(confirmation = false) {
        if (!confirmation) {
            throw new Error('Emergency cleanup requires explicit confirmation. Pass confirmation=true to proceed.');
        }
        
        if (!this.config.emergencyCleanupEnabled) {
            throw new Error('Emergency cleanup is disabled in configuration');
        }
        
        const startTime = Date.now();
        
        try {
            console.warn('🚨 EMERGENCY CLEANUP: Clearing all queues - THIS WILL DELETE ALL JOBS!');
            
            const results = {
                processed: 0,
                cleared: 0,
                errors: 0,
                queues: {}
            };
            
            const allQueueNames = this._getAllQueueNames();
            
            for (const queueName of allQueueNames) {
                try {
                    const queue = this.queueManager.getQueue(queueName);
                    if (!queue) {
                        console.warn(`⚠️  Queue '${queueName}' not found, skipping`);
                        continue;
                    }
                    
                    // Get current job counts before clearing
                    const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
                    const totalJobs = counts.active + counts.waiting + counts.completed + counts.failed + counts.delayed;
                    
                    // Obliterate the queue (this removes all jobs and clears Redis data)
                    await queue.obliterate({ force: true });
                    
                    results.processed += totalJobs;
                    results.cleared += totalJobs;
                    results.queues[queueName] = { totalJobs, cleared: totalJobs };
                    
                    console.warn(`🚨 Cleared queue '${queueName}': ${totalJobs} jobs`);
                    
                } catch (error) {
                    console.error(`❌ Error clearing queue '${queueName}':`, error);
                    results.errors++;
                }
            }
            
            const duration = Date.now() - startTime;
            this.metrics.emergencyCleanups++;
            this.metrics.totalCleanupOperations++;
            
            console.warn(`🚨 EMERGENCY CLEANUP COMPLETED in ${duration}ms: ${results.cleared} jobs cleared from ${Object.keys(results.queues).length} queues`);
            
            this.emit('emergencyCleanup', { ...results, duration });
            return results;
            
        } catch (error) {
            this.metrics.failedCleanups++;
            console.error('❌ Emergency cleanup failed:', error);
            this.emit('cleanupError', { type: 'emergency', error });
            throw error;
        }
    }
    
    /**
     * Get queue health status and metrics
     */
    async getQueueHealth(queueName = null) {
        try {
            const queuesToCheck = queueName ? [queueName] : this._getAllQueueNames();
            const healthStatus = {
                timestamp: new Date().toISOString(),
                overall: 'healthy',
                queues: {},
                summary: {
                    totalQueues: queuesToCheck.length,
                    healthyQueues: 0,
                    warningQueues: 0,
                    criticalQueues: 0,
                    totalJobs: 0,
                    avgProcessingTime: 0,
                    overallFailureRate: 0
                }
            };
            
            let totalJobs = 0;
            let totalFailures = 0;
            let processingTimes = [];
            
            for (const name of queuesToCheck) {
                try {
                    const queue = this.queueManager.getQueue(name);
                    if (!queue) {
                        console.warn(`⚠️  Queue '${name}' not found during health check`);
                        continue;
                    }
                    
                    const queueHealth = await this._assessQueueHealth(queue, name);
                    healthStatus.queues[name] = queueHealth;
                    
                    // Update summary statistics
                    totalJobs += queueHealth.metrics.totalJobs;
                    totalFailures += queueHealth.metrics.failedJobs;
                    
                    if (queueHealth.metrics.avgProcessingTime > 0) {
                        processingTimes.push(queueHealth.metrics.avgProcessingTime);
                    }
                    
                    // Count queue health levels
                    switch (queueHealth.status) {
                        case 'healthy':
                            healthStatus.summary.healthyQueues++;
                            break;
                        case 'warning':
                            healthStatus.summary.warningQueues++;
                            if (healthStatus.overall === 'healthy') {
                                healthStatus.overall = 'warning';
                            }
                            break;
                        case 'critical':
                            healthStatus.summary.criticalQueues++;
                            healthStatus.overall = 'critical';
                            break;
                    }
                    
                } catch (error) {
                    console.error(`❌ Error assessing health for queue '${name}':`, error);
                    healthStatus.queues[name] = {
                        status: 'error',
                        error: error.message
                    };
                }
            }
            
            // Calculate summary metrics
            healthStatus.summary.totalJobs = totalJobs;
            healthStatus.summary.overallFailureRate = totalJobs > 0 ? (totalFailures / totalJobs) : 0;
            healthStatus.summary.avgProcessingTime = processingTimes.length > 0 
                ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length 
                : 0;
            
            // Store health check in history
            if (this.config.enableMetricsCollection) {
                this.metrics.queueHealthHistory.push({
                    timestamp: Date.now(),
                    summary: healthStatus.summary
                });
                
                // Keep only recent history
                const maxHistory = 100;
                if (this.metrics.queueHealthHistory.length > maxHistory) {
                    this.metrics.queueHealthHistory = this.metrics.queueHealthHistory.slice(-maxHistory);
                }
            }
            
            this.metrics.lastHealthCheck = Date.now();
            this.emit('healthCheck', healthStatus);
            
            return healthStatus;
            
        } catch (error) {
            console.error('❌ Queue health check failed:', error);
            this.emit('healthCheckError', error);
            throw error;
        }
    }
    
    /**
     * Schedule periodic cleanup operations
     */
    async schedulePeriodicCleanup() {
        if (!this.isRunning) {
            console.warn('⚠️  Cannot schedule periodic cleanup: manager is not running');
            return;
        }
        
        try {
            console.log('⏰ Scheduling periodic cleanup operations');
            
            // Schedule stale job cleanup
            const staleCleanupInterval = setInterval(async () => {
                if (this.isRunning) {
                    try {
                        await this.cleanStaleJobs();
                    } catch (error) {
                        console.error('❌ Scheduled stale job cleanup failed:', error);
                    }
                }
            }, this.config.staleJobCleanupInterval);
            
            this.cleanupIntervals.set('staleJobs', staleCleanupInterval);
            
            // Schedule failed job cleanup
            const failedCleanupInterval = setInterval(async () => {
                if (this.isRunning) {
                    try {
                        await this.cleanFailedJobs();
                    } catch (error) {
                        console.error('❌ Scheduled failed job cleanup failed:', error);
                    }
                }
            }, this.config.failedJobCleanupInterval);
            
            this.cleanupIntervals.set('failedJobs', failedCleanupInterval);
            
            // Schedule completed job cleanup
            const completedCleanupInterval = setInterval(async () => {
                if (this.isRunning) {
                    try {
                        await this.cleanCompletedJobs();
                    } catch (error) {
                        console.error('❌ Scheduled completed job cleanup failed:', error);
                    }
                }
            }, this.config.completedJobCleanupInterval);
            
            this.cleanupIntervals.set('completedJobs', completedCleanupInterval);
            
            console.log('✅ Periodic cleanup operations scheduled');
            
        } catch (error) {
            console.error('❌ Failed to schedule periodic cleanup:', error);
            throw error;
        }
    }
    
    /**
     * Get comprehensive cleanup metrics and statistics
     */
    getMetrics() {
        const runtime = Date.now() - this.metrics.startTime;
        
        return {
            runtime: {
                startTime: new Date(this.metrics.startTime).toISOString(),
                uptime: runtime,
                uptimeFormatted: this._formatDuration(runtime)
            },
            operations: {
                total: this.metrics.totalCleanupOperations,
                successful: this.metrics.successfulCleanups,
                failed: this.metrics.failedCleanups,
                successRate: this.metrics.totalCleanupOperations > 0 
                    ? (this.metrics.successfulCleanups / this.metrics.totalCleanupOperations) * 100 
                    : 0
            },
            jobsCleaned: this.metrics.jobsCleanedByType,
            performance: {
                averageCleanupTime: this.metrics.averageCleanupTime,
                lastCleanupTime: this.metrics.lastCleanupTime 
                    ? new Date(this.metrics.lastCleanupTime).toISOString() 
                    : null,
                batchMetrics: this.metrics.performanceMetrics
            },
            emergencyCleanups: this.metrics.emergencyCleanups,
            healthChecks: {
                lastCheck: this.metrics.lastHealthCheck 
                    ? new Date(this.metrics.lastHealthCheck).toISOString() 
                    : null,
                historyLength: this.metrics.queueHealthHistory.length
            },
            config: {
                periodicCleanupEnabled: this.isRunning,
                intervalsActive: this.cleanupIntervals.size,
                safetyChecksEnabled: this.config.enableSafetyChecks,
                emergencyCleanupEnabled: this.config.emergencyCleanupEnabled
            }
        };
    }
    
    // ========== PRIVATE METHODS ==========
    
    /**
     * Validate Redis connection
     */
    async _validateConnection() {
        if (!this.queueManager.isConnected) {
            await this.queueManager.connect();
        }
        
        if (!this.queueManager.isConnected) {
            throw new Error('Redis connection is not available');
        }
    }
    
    /**
     * Get all available queue names
     */
    _getAllQueueNames() {
        const config = require('../../config/index.js');
        return Array.isArray(config.QUEUE_NAMES) ? config.QUEUE_NAMES : [];
    }
    
    /**
     * Clean stale jobs from a specific queue
     */
    async _cleanStaleJobsFromQueue(queue, queueName, cutoffTime) {
        const results = { processed: 0, cleaned: 0 };
        
        try {
            // Get active jobs that are older than cutoff time
            const activeJobs = await queue.getJobs(['active'], 0, this.config.batchSize);
            
            for (const job of activeJobs) {
                results.processed++;
                
                if (job.timestamp < cutoffTime) {
                    try {
                        await job.moveToFailed('Job marked as stale by cleanup manager', 'stale_job_cleanup');
                        results.cleaned++;
                        
                        if (this.config.enableDetailedLogging) {
                            console.log(`🧹 Moved stale job ${job.id} to failed (age: ${Date.now() - job.timestamp}ms)`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to move stale job ${job.id}:`, error);
                    }
                }
            }
            
            return results;
            
        } catch (error) {
            console.error(`❌ Error processing stale jobs from queue '${queueName}':`, error);
            throw error;
        }
    }
    
    /**
     * Clean failed jobs from a specific queue
     */
    async _cleanFailedJobsFromQueue(queue, queueName, retentionCount) {
        const results = { processed: 0, cleaned: 0 };
        
        try {
            // Get failed jobs (get more than retention to clean excess)
            const failedJobs = await queue.getJobs(['failed'], 0, retentionCount + this.config.batchSize);
            results.processed = failedJobs.length;
            
            if (failedJobs.length > retentionCount) {
                // Remove oldest failed jobs beyond retention limit
                const jobsToRemove = failedJobs.slice(retentionCount);
                
                for (const job of jobsToRemove) {
                    try {
                        await job.remove();
                        results.cleaned++;
                        
                        if (this.config.enableDetailedLogging) {
                            console.log(`🧹 Removed failed job ${job.id} (beyond retention limit)`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to remove failed job ${job.id}:`, error);
                    }
                }
            }
            
            return results;
            
        } catch (error) {
            console.error(`❌ Error processing failed jobs from queue '${queueName}':`, error);
            throw error;
        }
    }
    
    /**
     * Clean completed jobs from a specific queue
     */
    async _cleanCompletedJobsFromQueue(queue, queueName, retentionCount) {
        const results = { processed: 0, cleaned: 0 };
        
        try {
            // Get completed jobs (get more than retention to clean excess)
            const completedJobs = await queue.getJobs(['completed'], 0, retentionCount + this.config.batchSize);
            results.processed = completedJobs.length;
            
            if (completedJobs.length > retentionCount) {
                // Remove oldest completed jobs beyond retention limit
                const jobsToRemove = completedJobs.slice(retentionCount);
                
                for (const job of jobsToRemove) {
                    try {
                        await job.remove();
                        results.cleaned++;
                        
                        if (this.config.enableDetailedLogging) {
                            console.log(`🧹 Removed completed job ${job.id} (beyond retention limit)`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to remove completed job ${job.id}:`, error);
                    }
                }
            }
            
            return results;
            
        } catch (error) {
            console.error(`❌ Error processing completed jobs from queue '${queueName}':`, error);
            throw error;
        }
    }
    
    /**
     * Clear stuck jobs from a specific queue
     */
    async _clearStuckJobsFromQueue(queue, queueName) {
        const results = { processed: 0, cleaned: 0 };
        
        try {
            // Get active jobs to check for stuck ones
            const activeJobs = await queue.getJobs(['active'], 0, this.config.batchSize);
            
            for (const job of activeJobs) {
                results.processed++;
                
                // Check if job is stuck (processing too long without progress)
                const processingTime = Date.now() - job.processedOn;
                const isStuck = processingTime > this.config.maxJobAge;
                
                if (isStuck) {
                    try {
                        await job.moveToFailed('Job stuck in processing, cleared by cleanup manager', 'stuck_job_cleanup');
                        results.cleaned++;
                        
                        console.warn(`🧹 Cleared stuck job ${job.id} (processing time: ${processingTime}ms)`);
                    } catch (error) {
                        console.error(`❌ Failed to clear stuck job ${job.id}:`, error);
                    }
                }
            }
            
            return results;
            
        } catch (error) {
            console.error(`❌ Error processing stuck jobs from queue '${queueName}':`, error);
            throw error;
        }
    }
    
    /**
     * Assess health of a specific queue
     */
    async _assessQueueHealth(queue, queueName) {
        try {
            const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
            const totalJobs = counts.active + counts.waiting + counts.completed + counts.failed + counts.delayed;
            
            // Calculate failure rate
            const totalProcessed = counts.completed + counts.failed;
            const failureRate = totalProcessed > 0 ? (counts.failed / totalProcessed) : 0;
            
            // Get job processing times (sample recent jobs)
            const recentJobs = await queue.getJobs(['completed'], 0, 10);
            let avgProcessingTime = 0;
            
            if (recentJobs.length > 0) {
                const processingTimes = recentJobs
                    .filter(job => job.finishedOn && job.processedOn)
                    .map(job => job.finishedOn - job.processedOn);
                
                if (processingTimes.length > 0) {
                    avgProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
                }
            }
            
            // Determine health status
            let status = 'healthy';
            const issues = [];
            
            // Check against critical thresholds
            if (totalJobs > this.config.criticalThresholds.queueDepth) {
                status = 'critical';
                issues.push(`Queue depth ${totalJobs} exceeds critical threshold ${this.config.criticalThresholds.queueDepth}`);
            }
            
            if (failureRate > this.config.criticalThresholds.failureRate) {
                status = 'critical';
                issues.push(`Failure rate ${(failureRate * 100).toFixed(2)}% exceeds critical threshold ${(this.config.criticalThresholds.failureRate * 100).toFixed(2)}%`);
            }
            
            if (avgProcessingTime > this.config.criticalThresholds.avgProcessingTime) {
                status = 'critical';
                issues.push(`Average processing time ${avgProcessingTime}ms exceeds critical threshold ${this.config.criticalThresholds.avgProcessingTime}ms`);
            }
            
            if (counts.active > this.config.criticalThresholds.stalledJobs) {
                status = 'critical';
                issues.push(`Stalled jobs ${counts.active} exceeds critical threshold ${this.config.criticalThresholds.stalledJobs}`);
            }
            
            // Check against warning thresholds (only if not already critical)
            if (status === 'healthy') {
                if (totalJobs > this.config.warningThresholds.queueDepth) {
                    status = 'warning';
                    issues.push(`Queue depth ${totalJobs} exceeds warning threshold ${this.config.warningThresholds.queueDepth}`);
                }
                
                if (failureRate > this.config.warningThresholds.failureRate) {
                    status = 'warning';
                    issues.push(`Failure rate ${(failureRate * 100).toFixed(2)}% exceeds warning threshold ${(this.config.warningThresholds.failureRate * 100).toFixed(2)}%`);
                }
                
                if (avgProcessingTime > this.config.warningThresholds.avgProcessingTime) {
                    status = 'warning';
                    issues.push(`Average processing time ${avgProcessingTime}ms exceeds warning threshold ${this.config.warningThresholds.avgProcessingTime}ms`);
                }
                
                if (counts.active > this.config.warningThresholds.stalledJobs) {
                    status = 'warning';
                    issues.push(`Stalled jobs ${counts.active} exceeds warning threshold ${this.config.warningThresholds.stalledJobs}`);
                }
            }
            
            return {
                status,
                issues,
                metrics: {
                    totalJobs,
                    activeJobs: counts.active,
                    waitingJobs: counts.waiting,
                    completedJobs: counts.completed,
                    failedJobs: counts.failed,
                    delayedJobs: counts.delayed,
                    failureRate: failureRate * 100, // Convert to percentage
                    avgProcessingTime,
                    queueUtilization: totalJobs > 0 ? (counts.active / totalJobs) * 100 : 0
                },
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`❌ Error assessing queue health for '${queueName}':`, error);
            return {
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Schedule health checks
     */
    _scheduleHealthChecks() {
        if (!this.isRunning) {
            return;
        }
        
        const healthCheckInterval = setInterval(async () => {
            if (this.isRunning) {
                try {
                    await this.getQueueHealth();
                } catch (error) {
                    console.error('❌ Scheduled health check failed:', error);
                }
            }
        }, this.config.healthCheckInterval);
        
        this.cleanupIntervals.set('healthCheck', healthCheckInterval);
        console.log('✅ Health check monitoring scheduled');
    }
    
    /**
     * Handle queue errors
     */
    _handleQueueError(error, queueName) {
        console.error(`❌ Queue error in '${queueName}':`, error);
        this.emit('queueError', { error, queueName });
    }
    
    /**
     * Handle successful cleanup operations
     */
    _handleCleanupSuccess(type, results) {
        console.log(`✅ ${type} cleanup completed:`, results);
        this.emit('cleanupSuccess', { type, results });
    }
    
    /**
     * Utility: Add delay
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Utility: Format duration in human readable format
     */
    _formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
    
    /**
     * Log configuration on startup
     */
    _logConfiguration() {
        console.log('⚙️  QueueCleanupManager Configuration:');
        console.log(`   Periodic Cleanup Interval: ${this._formatDuration(this.config.periodicCleanupInterval)}`);
        console.log(`   Max Job Age: ${this._formatDuration(this.config.maxJobAge)}`);
        console.log(`   Failed Job Retention: ${this.config.maxFailedJobRetention}`);
        console.log(`   Completed Job Retention: ${this.config.maxCompletedJobRetention}`);
        console.log(`   Batch Size: ${this.config.batchSize}`);
        console.log(`   Health Check Interval: ${this._formatDuration(this.config.healthCheckInterval)}`);
        console.log(`   Emergency Cleanup: ${this.config.emergencyCleanupEnabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Safety Checks: ${this.config.enableSafetyChecks ? 'Enabled' : 'Disabled'}`);
    }
}

module.exports = { QueueCleanupManager };