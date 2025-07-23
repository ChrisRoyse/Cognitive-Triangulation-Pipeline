const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../../config/index.js');
const { QueueCleanupManager } = require('./queueCleanupManager.js');
const { PipelineConfig } = require('../config/pipelineConfig.js');

const FAILED_JOBS_QUEUE_NAME = 'failed-jobs';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
};

const ALLOWED_QUEUES = new Set((config.QUEUE_NAMES || []).concat([FAILED_JOBS_QUEUE_NAME]));

class QueueManager {
  constructor() {
    this.workers = [];
    this.activeQueues = new Map();
    this.connection = null;
    this.isConnected = false;
    this.cleanupManager = null;
    this.pipelineConfig = null;

    this.connection = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    this.connection.on('connect', () => {
      this.isConnected = true;
      console.log('Successfully connected to Redis.');
      this._initializeCleanupManager();
    });

    this.connection.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.connection.on('end', () => {
      this.isConnected = false;
      console.log('Redis connection closed.');
    });
  }

  async connect() {
    if (this.isConnected) {
      return Promise.resolve();
    }
    // The 'ready' event indicates the connection is established and ready for commands.
    return new Promise((resolve, reject) => {
      this.connection.once('ready', resolve);
      this.connection.once('error', reject);
    });
  }

  getQueue(queueName) {
    if (!ALLOWED_QUEUES.has(queueName)) {
        console.error(`Disallowed queue name requested: ${queueName}`);
        return null;
    }

    if (this.activeQueues.has(queueName)) {
      return this.activeQueues.get(queueName);
    }

    console.log(`Creating new queue instance for: ${queueName}`);

    const newQueue = new Queue(queueName, {
      connection: this.connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });

    if (queueName !== FAILED_JOBS_QUEUE_NAME) {
      newQueue.on('failed', async (job, error) => {
        console.log(`Job ${job.id} in queue ${queueName} failed permanently. Forwarding to DLQ. Error: ${error.message}`);
        const dlq = this.getQueue(FAILED_JOBS_QUEUE_NAME);
        await dlq.add(job.name, job.data);
      });
    }

    this.activeQueues.set(queueName, newQueue);
    return newQueue;
  }

  createWorker(queueName, processor, options = {}) {
    const workerConfig = {
      connection: this.connection,
      stalledInterval: 30000,
      lockDuration: 1800000,
      ...options,
    };

    const worker = new Worker(queueName, processor, workerConfig);
    this.workers.push(worker);
    return worker;
  }

  async closeConnections() {
    console.log('Closing all active queues, workers, and the main Redis connection...');

    // Stop cleanup manager first
    if (this.cleanupManager) {
      try {
        await this.cleanupManager.stop();
        console.log('✅ Cleanup manager stopped');
      } catch (error) {
        console.error('❌ Error stopping cleanup manager:', error);
      }
    }

    const closePromises = [
      ...Array.from(this.activeQueues.values()).map(q => q.close()),
      ...this.workers.map(w => w.close()),
    ];

    await Promise.allSettled(closePromises);

    if (this.connection) {
      await this.connection.quit();
    }

    this.activeQueues.clear();
    this.workers = [];
    this.cleanupManager = null;
    console.log('All connections have been closed.');
  }

  async clearAllQueues() {
    console.log('🗑️ Clearing all Redis queues...');
    const clearPromises = [];
    // Ensure config.QUEUE_NAMES is an array before iterating
    const queueNames = Array.isArray(config.QUEUE_NAMES) ? config.QUEUE_NAMES : [];
    for (const queueName of queueNames) {
      const queue = this.getQueue(queueName);
      if (queue) {
        clearPromises.push(queue.obliterate({ force: true }));
      }
    }

    // Also clear the failed jobs queue if it's not in the main list
    if (!queueNames.includes(FAILED_JOBS_QUEUE_NAME)) {
        const dlq = this.getQueue(FAILED_JOBS_QUEUE_NAME);
        if (dlq) {
            clearPromises.push(dlq.obliterate({ force: true }));
        }
    }

    await Promise.allSettled(clearPromises);
    console.log('✅ All Redis queues cleared successfully.');
  }

  async getJobCounts() {
    const jobCounts = {
        active: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
    };
    for (const queue of this.activeQueues.values()) {
        const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
        jobCounts.active += counts.active;
        jobCounts.waiting += counts.waiting;
        jobCounts.completed += counts.completed;
        jobCounts.failed += counts.failed;
        jobCounts.delayed += counts.delayed;
    }
    return jobCounts;
  }

  // ========== CLEANUP MANAGER INTEGRATION ==========

  /**
   * Initialize the cleanup manager with pipeline configuration
   */
  _initializeCleanupManager() {
    try {
      if (!this.pipelineConfig) {
        this.pipelineConfig = new PipelineConfig();
      }

      const cleanupConfig = this.pipelineConfig.getCleanupConfig();
      this.cleanupManager = new QueueCleanupManager(this, cleanupConfig);

      // Start the cleanup manager automatically
      this.cleanupManager.start().catch(error => {
        console.error('❌ Failed to start cleanup manager:', error);
      });

      console.log('✅ Queue cleanup manager initialized and started');
    } catch (error) {
      console.error('❌ Failed to initialize cleanup manager:', error);
    }
  }

  /**
   * Get the cleanup manager instance
   */
  getCleanupManager() {
    return this.cleanupManager;
  }

  /**
   * Clean stale jobs from all queues
   */
  async cleanStaleJobs(queueName = null, maxAge = null) {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized');
      return { processed: 0, cleaned: 0, errors: 1 };
    }

    return await this.cleanupManager.cleanStaleJobs(queueName, maxAge);
  }

  /**
   * Clean failed jobs from all queues
   */
  async cleanFailedJobs(queueName = null, retentionCount = null) {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized');
      return { processed: 0, cleaned: 0, errors: 1 };
    }

    return await this.cleanupManager.cleanFailedJobs(queueName, retentionCount);
  }

  /**
   * Clean completed jobs from all queues
   */
  async cleanCompletedJobs(queueName = null, retentionCount = null) {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized');
      return { processed: 0, cleaned: 0, errors: 1 };
    }

    return await this.cleanupManager.cleanCompletedJobs(queueName, retentionCount);
  }

  /**
   * Clear stuck jobs that are blocking workers
   */
  async clearStuckJobs(queueName = null) {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized');
      return { processed: 0, cleaned: 0, errors: 1 };
    }

    return await this.cleanupManager.clearStuckJobs(queueName);
  }

  /**
   * Get queue health status
   */
  async getQueueHealth(queueName = null) {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized');
      return { overall: 'unknown', error: 'Cleanup manager not available' };
    }

    return await this.cleanupManager.getQueueHealth(queueName);
  }

  /**
   * Get cleanup metrics
   */
  getCleanupMetrics() {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized');
      return { error: 'Cleanup manager not available' };
    }

    return this.cleanupManager.getMetrics();
  }

  /**
   * Emergency cleanup - clear all queues (requires confirmation)
   */
  async emergencyCleanup(confirmation = false) {
    if (!this.cleanupManager) {
      console.warn('⚠️  Cleanup manager not initialized, falling back to basic clear');
      return await this.clearAllQueues();
    }

    return await this.cleanupManager.clearAllQueues(confirmation);
  }
}

// To maintain a single instance throughout the application, we export a singleton.
let queueManagerInstance;
const getInstance = () => {
    if (!queueManagerInstance) {
        queueManagerInstance = new QueueManager();
    }
    return queueManagerInstance;
}

module.exports = {
    getInstance,
    // Exporting the class for testing purposes
    QueueManagerForTest: QueueManager,
};