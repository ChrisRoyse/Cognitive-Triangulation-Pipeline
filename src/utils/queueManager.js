const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../../config/index.js');

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
    this.connection = new IORedis(config.REDIS_URL);
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.connection.once('ready', () => {
        this.isConnected = true;
        resolve();
      });
      this.connection.once('error', reject);
    });
  }

  getQueue(queueName) {
    if (!ALLOWED_QUEUES.has(queueName)) {
      throw new Error(`Disallowed queue name: ${queueName}. Allowed queues: ${Array.from(ALLOWED_QUEUES).join(', ')}`);
    }

    if (this.activeQueues.has(queueName)) {
      return this.activeQueues.get(queueName);
    }

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

  async createWorker(queueName, processor, options = {}) {
    const workerConnection = new IORedis(config.REDIS_URL);
    
    const workerConfig = {
      connection: workerConnection,
      concurrency: options.concurrency || 1,
      ...options,
    };

    const worker = new Worker(queueName, processor, workerConfig);
    this.workers.push(worker);
    
    return worker;
  }

  async closeConnections() {
    console.log('Closing all connections...');

    // Close workers
    const workerClosePromises = this.workers.map(async (worker) => {
      try {
        await worker.close();
      } catch (error) {
        console.error('Error closing worker:', error);
      }
    });

    // Close active queues
    const queueClosePromises = Array.from(this.activeQueues.values()).map(async (queue) => {
      try {
        await queue.close();
      } catch (error) {
        console.error('Error closing queue:', error);
      }
    });

    // Wait for all workers and queues to close
    await Promise.allSettled([...workerClosePromises, ...queueClosePromises]);

    // Close the primary connection
    if (this.connection) {
      try {
        await this.connection.quit();
      } catch (error) {
        console.error('Error closing primary connection:', error);
      }
    }

    // Clear tracking arrays
    this.activeQueues.clear();
    this.workers = [];
    this.isConnected = false;
    
    console.log('All connections closed.');
  }

  async clearAllQueues() {
    console.log('Clearing all Redis queues...');
    const clearPromises = [];
    
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
    console.log('All Redis queues cleared successfully.');
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