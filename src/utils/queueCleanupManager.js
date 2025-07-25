/**
 * Simple Queue Cleanup Manager
 * Basic cleanup for development workloads
 */

class QueueCleanupManager {
    constructor(queueManager, config = {}) {
        this.queueManager = queueManager;
        this.config = {
            cleanupInterval: config.cleanupInterval || 30 * 60 * 1000, // 30 minutes
            maxJobAge: config.maxJobAge || 24 * 60 * 60 * 1000, // 24 hours
            maxFailedJobs: config.maxFailedJobs || 100,
            ...config
        };
        this.isRunning = false;
        this.cleanupTimer = null;
    }
    
    async start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.scheduleCleanup();
    }
    
    async stop() {
        this.isRunning = false;
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    
    scheduleCleanup() {
        this.cleanupTimer = setInterval(async () => {
            if (this.isRunning) {
                await this.cleanup();
            }
        }, this.config.cleanupInterval);
    }
    
    async cleanup() {
        try {
            const queueNames = this.getQueueNames();
            
            for (const queueName of queueNames) {
                const queue = this.queueManager.getQueue(queueName);
                if (!queue) continue;
                
                // Clean old failed jobs
                const failedJobs = await queue.getJobs(['failed'], 0, this.config.maxFailedJobs + 50);
                if (failedJobs.length > this.config.maxFailedJobs) {
                    const toRemove = failedJobs.slice(this.config.maxFailedJobs);
                    for (const job of toRemove) {
                        await job.remove();
                    }
                }
                
                // Clean old completed jobs
                const cutoffTime = Date.now() - this.config.maxJobAge;
                const completedJobs = await queue.getJobs(['completed'], 0, 100);
                for (const job of completedJobs) {
                    if (job.timestamp < cutoffTime) {
                        await job.remove();
                    }
                }
            }
        } catch (error) {
            console.error('Queue cleanup failed:', error);
        }
    }
    
    getQueueNames() {
        try {
            const config = require('../../config/index.js');
            return Array.isArray(config.QUEUE_NAMES) ? config.QUEUE_NAMES : [];
        } catch {
            return [];
        }
    }
    
    async clearAllQueues() {
        const queueNames = this.getQueueNames();
        
        for (const queueName of queueNames) {
            const queue = this.queueManager.getQueue(queueName);
            if (queue) {
                await queue.obliterate({ force: true });
            }
        }
    }
}

module.exports = { QueueCleanupManager };