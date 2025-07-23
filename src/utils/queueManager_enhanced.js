const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config/secure');

/**
 * Enhanced Queue Manager with production-ready features:
 * - Automatic reconnection with exponential backoff
 * - Circuit breaker pattern
 * - Connection pooling
 * - Health monitoring
 * - Graceful shutdown
 * - Dead letter queue handling
 */
class EnhancedQueueManager {
    constructor() {
        this.connection = null;
        this.queues = new Map();
        this.workers = new Map();
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.maxReconnectDelay = 30000; // Max 30 seconds
        this.circuitBreakerOpen = false;
        this.lastFailureTime = null;
        this.circuitBreakerTimeout = 60000; // 1 minute
        this.stats = {
            connections: 0,
            reconnections: 0,
            failures: 0,
            jobsProcessed: 0,
            jobsFailed: 0,
            startTime: new Date()
        };
    }

    async connect() {
        if (this.isConnected && this.connection) {
            return this.connection;
        }

        try {
            console.log('🔗 Connecting to Redis...');
            
            const redisConfig = {
                ...config.database.redis,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: false,
                connectTimeout: 10000,
                commandTimeout: 5000,
                family: 4,
                keepAlive: 30000,
                // Connection pool settings
                maxListeners: 20
            };

            this.connection = new IORedis(redisConfig);
            
            // Set up event handlers
            this.setupEventHandlers();
            
            // Wait for connection
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Redis connection timeout'));
                }, 15000);

                this.connection.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                this.connection.once('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.circuitBreakerOpen = false;
            this.stats.connections++;
            
            console.log('✅ Redis connected successfully');
            return this.connection;
            
        } catch (error) {
            console.error('❌ Failed to connect to Redis:', error);
            this.isConnected = false;
            throw error;
        }
    }

    setupEventHandlers() {
        if (!this.connection) return;

        this.connection.on('connect', () => {
            console.log('📡 Redis connection established');
        });

        this.connection.on('ready', () => {
            console.log('✅ Redis ready for commands');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.circuitBreakerOpen = false;
        });

        this.connection.on('error', (error) => {
            console.error('❌ Redis connection error:', error.message);
            this.isConnected = false;
            this.stats.failures++;
            this.handleConnectionError(error);
        });

        this.connection.on('close', () => {
            console.log('🔌 Redis connection closed');
            this.isConnected = false;
        });

        this.connection.on('reconnecting', () => {
            console.log('🔄 Redis reconnecting...');
            this.stats.reconnections++;
        });

        this.connection.on('end', () => {
            console.log('🔚 Redis connection ended');
            this.isConnected = false;
            if (!this.shuttingDown) {
                this.scheduleReconnection();
            }
        });
    }

    handleConnectionError(error) {
        this.lastFailureTime = Date.now();
        
        // Open circuit breaker on persistent failures
        if (this.reconnectAttempts >= 3) {
            this.circuitBreakerOpen = true;
            console.warn('⚠️  Circuit breaker opened due to Redis failures');
        }

        if (!this.shuttingDown) {
            this.scheduleReconnection();
        }
    }

    scheduleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached. Manual intervention required.');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

        setTimeout(async () => {
            try {
                await this.connect();
            } catch (error) {
                console.error('❌ Reconnection failed:', error.message);
                this.scheduleReconnection();
            }
        }, delay);
    }

    // Circuit breaker check
    isCircuitBreakerOpen() {
        if (!this.circuitBreakerOpen) return false;
        
        // Check if we should try to close the circuit breaker
        if (Date.now() - this.lastFailureTime > this.circuitBreakerTimeout) {
            this.circuitBreakerOpen = false;
            console.log('🔄 Circuit breaker half-open, attempting recovery');
            return false;
        }
        
        return true;
    }

    async ensureConnected() {
        if (this.isCircuitBreakerOpen()) {
            throw new Error('Circuit breaker is open - Redis unavailable');
        }

        if (!this.isConnected || !this.connection) {
            await this.connect();
        }

        return this.connection;
    }

    getQueue(queueName) {
        if (this.queues.has(queueName)) {
            return this.queues.get(queueName);
        }

        try {
            const queue = new Queue(queueName, {
                connection: this.connection,
                defaultJobOptions: config.queues.defaultJobOptions
            });

            this.queues.set(queueName, queue);
            console.log(`📋 Queue '${queueName}' created`);
            return queue;
        } catch (error) {
            console.error(`❌ Failed to create queue '${queueName}':`, error);
            throw error;
        }
    }

    createWorker(queueName, processor, options = {}) {
        const workerKey = `${queueName}-worker`;
        
        if (this.workers.has(workerKey)) {
            console.warn(`⚠️  Worker for queue '${queueName}' already exists`);
            return this.workers.get(workerKey);
        }

        try {
            const workerOptions = {
                connection: this.connection,
                ...config.queues.workerOptions,
                ...options
            };

            const worker = new Worker(queueName, async (job) => {
                try {
                    this.stats.jobsProcessed++;
                    return await processor(job);
                } catch (error) {
                    this.stats.jobsFailed++;
                    console.error(`❌ Job failed in queue '${queueName}':`, error);
                    throw error;
                }
            }, workerOptions);

            // Set up worker event handlers
            this.setupWorkerEventHandlers(worker, queueName);

            this.workers.set(workerKey, worker);
            console.log(`👷 Worker for queue '${queueName}' created with concurrency ${workerOptions.concurrency}`);
            
            return worker;
        } catch (error) {
            console.error(`❌ Failed to create worker for queue '${queueName}':`, error);
            throw error;
        }
    }

    setupWorkerEventHandlers(worker, queueName) {
        worker.on('completed', (job) => {
            console.log(`✅ Job ${job.id} completed in queue '${queueName}'`);
        });

        worker.on('failed', (job, err) => {
            console.error(`❌ Job ${job?.id} failed in queue '${queueName}':`, err.message);
            
            // Handle dead letter queue
            if (job && job.attemptsMade >= job.opts.attempts) {
                this.handleDeadLetter(queueName, job, err);
            }
        });

        worker.on('error', (err) => {
            console.error(`❌ Worker error in queue '${queueName}':`, err);
        });

        worker.on('stalled', (jobId) => {
            console.warn(`⚠️  Job ${jobId} stalled in queue '${queueName}'`);
        });
    }

    async handleDeadLetter(queueName, job, error) {
        try {
            const dlqName = `${queueName}-dead-letter`;
            const dlq = this.getQueue(dlqName);
            
            await dlq.add('dead-letter', {
                originalQueue: queueName,
                originalJobId: job.id,
                originalData: job.data,
                error: error.message,
                stackTrace: error.stack,
                failedAt: new Date().toISOString(),
                attemptsMade: job.attemptsMade
            });
            
            console.log(`📫 Job ${job.id} moved to dead letter queue: ${dlqName}`);
        } catch (dlqError) {
            console.error('❌ Failed to handle dead letter:', dlqError);
        }
    }

    async addJob(queueName, jobName, data, options = {}) {
        try {
            await this.ensureConnected();
            const queue = this.getQueue(queueName);
            
            const job = await queue.add(jobName, data, {
                ...config.queues.defaultJobOptions,
                ...options
            });
            
            console.log(`➕ Job ${job.id} added to queue '${queueName}'`);
            return job;
        } catch (error) {
            console.error(`❌ Failed to add job to queue '${queueName}':`, error);
            throw error;
        }
    }

    async addBulk(queueName, jobs) {
        try {
            await this.ensureConnected();
            const queue = this.getQueue(queueName);
            
            const bulkJobs = jobs.map(job => ({
                name: job.name,
                data: job.data,
                opts: {
                    ...config.queues.defaultJobOptions,
                    ...job.options
                }
            }));
            
            const addedJobs = await queue.addBulk(bulkJobs);
            console.log(`➕ ${addedJobs.length} jobs added to queue '${queueName}'`);
            return addedJobs;
        } catch (error) {
            console.error(`❌ Failed to add bulk jobs to queue '${queueName}':`, error);
            throw error;
        }
    }

    async getJobCounts(queueName = null) {
        try {
            await this.ensureConnected();
            
            if (queueName) {
                const queue = this.getQueue(queueName);
                return await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
            }
            
            // Get counts for all queues
            const allCounts = {};
            for (const [name, queue] of this.queues) {
                allCounts[name] = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
            }
            
            // Calculate totals
            const totals = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
            Object.values(allCounts).forEach(counts => {
                Object.keys(totals).forEach(key => {
                    totals[key] += counts[key] || 0;
                });
            });
            
            return { individual: allCounts, totals };
        } catch (error) {
            console.error('❌ Failed to get job counts:', error);
            throw error;
        }
    }

    async healthCheck() {
        try {
            if (!this.connection) {
                return { healthy: false, reason: 'No connection' };
            }

            // Test basic Redis operations
            const testKey = 'health-check-' + Date.now();
            await this.connection.set(testKey, 'ok', 'EX', 10);
            const result = await this.connection.get(testKey);
            await this.connection.del(testKey);

            if (result !== 'ok') {
                return { healthy: false, reason: 'Redis test failed' };
            }

            return {
                healthy: true,
                connected: this.isConnected,
                circuitBreaker: this.circuitBreakerOpen ? 'OPEN' : 'CLOSED',
                stats: this.getStats(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                reason: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    getStats() {
        const uptime = new Date() - this.stats.startTime;
        
        return {
            ...this.stats,
            uptime: Math.floor(uptime / 1000), // seconds
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            circuitBreakerOpen: this.circuitBreakerOpen,
            queuesCount: this.queues.size,
            workersCount: this.workers.size
        };
    }

    async pause(queueName) {
        try {
            const queue = this.getQueue(queueName);
            await queue.pause();
            console.log(`⏸️  Queue '${queueName}' paused`);
        } catch (error) {
            console.error(`❌ Failed to pause queue '${queueName}':`, error);
            throw error;
        }
    }

    async resume(queueName) {
        try {
            const queue = this.getQueue(queueName);
            await queue.resume();
            console.log(`▶️  Queue '${queueName}' resumed`);
        } catch (error) {
            console.error(`❌ Failed to resume queue '${queueName}':`, error);
            throw error;
        }
    }

    async clean(queueName, gracePeriod = 3600000, type = 'completed') {
        try {
            const queue = this.getQueue(queueName);
            const jobs = await queue.clean(gracePeriod, type);
            console.log(`🧹 Cleaned ${jobs.length} ${type} jobs from queue '${queueName}'`);
            return jobs;
        } catch (error) {
            console.error(`❌ Failed to clean queue '${queueName}':`, error);
            throw error;
        }
    }

    async closeConnections() {
        console.log('🔄 Closing queue manager connections...');
        this.shuttingDown = true;

        try {
            // Close all workers first
            const workerPromises = Array.from(this.workers.values()).map(async (worker) => {
                try {
                    await worker.close();
                } catch (error) {
                    console.error('❌ Error closing worker:', error);
                }
            });
            await Promise.allSettled(workerPromises);
            console.log('✅ All workers closed');

            // Close all queues
            const queuePromises = Array.from(this.queues.values()).map(async (queue) => {
                try {
                    await queue.close();
                } catch (error) {
                    console.error('❌ Error closing queue:', error);
                }
            });
            await Promise.allSettled(queuePromises);
            console.log('✅ All queues closed');

            // Close Redis connection
            if (this.connection) {
                try {
                    await this.connection.quit();
                } catch (error) {
                    // Force close if quit fails
                    this.connection.disconnect();
                }
            }
            
            this.isConnected = false;
            this.connection = null;
            this.queues.clear();
            this.workers.clear();
            
            console.log('✅ Queue manager connections closed');
        } catch (error) {
            console.error('❌ Error during queue manager shutdown:', error);
        }
    }
}

// Singleton instance
let instance = null;

function getInstance() {
    if (!instance) {
        instance = new EnhancedQueueManager();
    }
    return instance;
}

module.exports = { EnhancedQueueManager, getInstance };