#!/usr/bin/env node

/**
 * Queue Cleanup CLI Tool
 * 
 * Provides command-line interface for managing queue cleanup operations.
 * Supports all cleanup operations with detailed reporting and safety checks.
 */

const { QueueCleanupManager } = require('./queueCleanupManager.js');
const { getInstance: getQueueManager } = require('./queueManager.js');
const { PipelineConfig } = require('../config/pipelineConfig.js');

class QueueCleanupCLI {
    constructor() {
        this.queueManager = null;
        this.cleanupManager = null;
        this.config = null;
    }

    async initialize() {
        try {
            console.log('🔧 Initializing Queue Cleanup CLI...');
            
            // Initialize dependencies
            this.config = new PipelineConfig();
            this.queueManager = getQueueManager();
            await this.queueManager.connect();
            
            // Wait for cleanup manager to be initialized
            await this._waitForCleanupManager();
            
            console.log('✅ Queue Cleanup CLI initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize CLI:', error);
            process.exit(1);
        }
    }

    async _waitForCleanupManager() {
        const maxWait = 10000; // 10 seconds
        const startTime = Date.now();
        
        while (!this.queueManager.getCleanupManager() && (Date.now() - startTime) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.cleanupManager = this.queueManager.getCleanupManager();
        
        if (!this.cleanupManager) {
            throw new Error('Cleanup manager not available after waiting');
        }
    }

    async runCommand(command, options = {}) {
        try {
            console.log(`\n🧹 Executing: ${command}`);
            console.log('⏰ Started at:', new Date().toISOString());
            
            const startTime = Date.now();
            let result;

            switch (command) {
                case 'clean-stale':
                    result = await this._cleanStaleJobs(options);
                    break;
                    
                case 'clean-failed':
                    result = await this._cleanFailedJobs(options);
                    break;
                    
                case 'clean-completed':
                    result = await this._cleanCompletedJobs(options);
                    break;
                    
                case 'clear-stuck':
                    result = await this._clearStuckJobs(options);
                    break;
                    
                case 'health-check':
                    result = await this._healthCheck(options);
                    break;
                    
                case 'metrics':
                    result = await this._getMetrics(options);
                    break;
                    
                case 'emergency-cleanup':
                    result = await this._emergencyCleanup(options);
                    break;
                    
                case 'schedule-info':
                    result = await this._getScheduleInfo(options);
                    break;
                    
                case 'full-cleanup':
                    result = await this._fullCleanup(options);
                    break;
                    
                default:
                    throw new Error(`Unknown command: ${command}`);
            }

            const duration = Date.now() - startTime;
            console.log(`\n✅ Command completed in ${duration}ms`);
            console.log('⏰ Finished at:', new Date().toISOString());
            
            return result;
            
        } catch (error) {
            console.error(`\n❌ Command failed:`, error);
            throw error;
        }
    }

    async _cleanStaleJobs(options) {
        const { queue, maxAge } = options;
        const result = await this.cleanupManager.cleanStaleJobs(queue, maxAge);
        
        console.log('\n📊 Stale Jobs Cleanup Results:');
        console.log(`   Processed: ${result.processed} jobs`);
        console.log(`   Cleaned: ${result.cleaned} jobs`);
        console.log(`   Errors: ${result.errors}`);
        console.log(`   Queues affected: ${Object.keys(result.queues).length}`);
        
        if (options.detailed) {
            console.log('\n📋 Per-queue breakdown:');
            for (const [queueName, queueResult] of Object.entries(result.queues)) {
                console.log(`   ${queueName}: processed ${queueResult.processed}, cleaned ${queueResult.cleaned}`);
            }
        }
        
        return result;
    }

    async _cleanFailedJobs(options) {
        const { queue, retention } = options;
        const result = await this.cleanupManager.cleanFailedJobs(queue, retention);
        
        console.log('\n📊 Failed Jobs Cleanup Results:');
        console.log(`   Processed: ${result.processed} jobs`);
        console.log(`   Cleaned: ${result.cleaned} jobs`);
        console.log(`   Errors: ${result.errors}`);
        console.log(`   Queues affected: ${Object.keys(result.queues).length}`);
        
        if (options.detailed) {
            console.log('\n📋 Per-queue breakdown:');
            for (const [queueName, queueResult] of Object.entries(result.queues)) {
                console.log(`   ${queueName}: processed ${queueResult.processed}, cleaned ${queueResult.cleaned}`);
            }
        }
        
        return result;
    }

    async _cleanCompletedJobs(options) {
        const { queue, retention } = options;
        const result = await this.cleanupManager.cleanCompletedJobs(queue, retention);
        
        console.log('\n📊 Completed Jobs Cleanup Results:');
        console.log(`   Processed: ${result.processed} jobs`);
        console.log(`   Cleaned: ${result.cleaned} jobs`);
        console.log(`   Errors: ${result.errors}`);
        console.log(`   Queues affected: ${Object.keys(result.queues).length}`);
        
        if (options.detailed) {
            console.log('\n📋 Per-queue breakdown:');
            for (const [queueName, queueResult] of Object.entries(result.queues)) {
                console.log(`   ${queueName}: processed ${queueResult.processed}, cleaned ${queueResult.cleaned}`);
            }
        }
        
        return result;
    }

    async _clearStuckJobs(options) {
        const { queue } = options;
        const result = await this.cleanupManager.clearStuckJobs(queue);
        
        console.log('\n📊 Stuck Jobs Cleanup Results:');
        console.log(`   Processed: ${result.processed} jobs`);
        console.log(`   Cleared: ${result.cleaned} jobs`);
        console.log(`   Errors: ${result.errors}`);
        console.log(`   Queues affected: ${Object.keys(result.queues).length}`);
        
        if (options.detailed) {
            console.log('\n📋 Per-queue breakdown:');
            for (const [queueName, queueResult] of Object.entries(result.queues)) {
                console.log(`   ${queueName}: processed ${queueResult.processed}, cleared ${queueResult.cleared}`);
            }
        }
        
        return result;
    }

    async _healthCheck(options) {
        const { queue } = options;
        const result = await this.cleanupManager.getQueueHealth(queue);
        
        console.log(`\n🏥 Queue Health Report (${result.timestamp}):`);
        console.log(`   Overall Status: ${this._getStatusEmoji(result.overall)} ${result.overall.toUpperCase()}`);
        console.log(`   Total Queues: ${result.summary.totalQueues}`);
        console.log(`   Healthy: ${result.summary.healthyQueues} | Warning: ${result.summary.warningQueues} | Critical: ${result.summary.criticalQueues}`);
        console.log(`   Total Jobs: ${result.summary.totalJobs}`);
        console.log(`   Overall Failure Rate: ${(result.summary.overallFailureRate * 100).toFixed(2)}%`);
        console.log(`   Average Processing Time: ${result.summary.avgProcessingTime.toFixed(0)}ms`);
        
        if (options.detailed) {
            console.log('\n📋 Per-queue health status:');
            for (const [queueName, queueHealth] of Object.entries(result.queues)) {
                if (queueHealth.status === 'error') {
                    console.log(`   ${queueName}: ❌ ERROR - ${queueHealth.error}`);
                } else {
                    console.log(`   ${queueName}: ${this._getStatusEmoji(queueHealth.status)} ${queueHealth.status.toUpperCase()}`);
                    console.log(`     Jobs: Active(${queueHealth.metrics.activeJobs}) Waiting(${queueHealth.metrics.waitingJobs}) Failed(${queueHealth.metrics.failedJobs})`);
                    console.log(`     Failure Rate: ${queueHealth.metrics.failureRate.toFixed(2)}% | Avg Processing: ${queueHealth.metrics.avgProcessingTime.toFixed(0)}ms`);
                    
                    if (queueHealth.issues && queueHealth.issues.length > 0) {
                        console.log(`     Issues: ${queueHealth.issues.join(', ')}`);
                    }
                }
            }
        }
        
        return result;
    }

    async _getMetrics(options) {
        const metrics = this.cleanupManager.getMetrics();
        
        console.log('\n📈 Cleanup Manager Metrics:');
        console.log(`   Uptime: ${metrics.runtime.uptimeFormatted}`);
        console.log(`   Total Operations: ${metrics.operations.total}`);
        console.log(`   Success Rate: ${metrics.operations.successRate.toFixed(2)}%`);
        console.log(`   Emergency Cleanups: ${metrics.emergencyCleanups}`);
        
        console.log('\n🧹 Jobs Cleaned by Type:');
        console.log(`   Stale: ${metrics.jobsCleaned.stale}`);
        console.log(`   Failed: ${metrics.jobsCleaned.failed}`);
        console.log(`   Completed: ${metrics.jobsCleaned.completed}`);
        console.log(`   Stuck: ${metrics.jobsCleaned.stuck}`);
        
        console.log('\n⚡ Performance:');
        console.log(`   Average Cleanup Time: ${metrics.performance.averageCleanupTime.toFixed(0)}ms`);
        console.log(`   Last Cleanup: ${metrics.performance.lastCleanupTime || 'Never'}`);
        console.log(`   Last Health Check: ${metrics.healthChecks.lastCheck || 'Never'}`);
        
        console.log('\n⚙️  Configuration:');
        console.log(`   Periodic Cleanup: ${metrics.config.periodicCleanupEnabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Active Intervals: ${metrics.config.intervalsActive}`);
        console.log(`   Safety Checks: ${metrics.config.safetyChecksEnabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Emergency Cleanup: ${metrics.config.emergencyCleanupEnabled ? 'Enabled' : 'Disabled'}`);
        
        return metrics;
    }

    async _emergencyCleanup(options) {
        const { confirm } = options;
        
        if (!confirm) {
            console.log('\n🚨 EMERGENCY CLEANUP WARNING:');
            console.log('   This will DELETE ALL JOBS from ALL QUEUES!');
            console.log('   This action is IRREVERSIBLE!');
            console.log('   Use --confirm flag to proceed.');
            return { cancelled: true };
        }
        
        console.log('\n🚨 EMERGENCY CLEANUP INITIATED - ALL JOBS WILL BE DELETED!');
        console.log('   Starting in 3 seconds...');
        
        for (let i = 3; i > 0; i--) {
            console.log(`   ${i}...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        const result = await this.cleanupManager.clearAllQueues(true);
        
        console.log('\n🚨 Emergency Cleanup Results:');
        console.log(`   Total Jobs Cleared: ${result.cleared}`);
        console.log(`   Queues Processed: ${Object.keys(result.queues).length}`);
        console.log(`   Errors: ${result.errors}`);
        
        if (options.detailed) {
            console.log('\n📋 Per-queue breakdown:');
            for (const [queueName, queueResult] of Object.entries(result.queues)) {
                console.log(`   ${queueName}: ${queueResult.cleared} jobs cleared`);
            }
        }
        
        return result;
    }

    async _getScheduleInfo(options) {
        const config = this.config.getCleanupConfig();
        
        console.log('\n⏰ Cleanup Schedule Information:');
        console.log(`   Periodic Cleanup: ${this._formatDuration(config.periodicCleanupInterval)}`);
        console.log(`   Stale Job Cleanup: ${this._formatDuration(config.staleJobCleanupInterval)}`);
        console.log(`   Failed Job Cleanup: ${this._formatDuration(config.failedJobCleanupInterval)}`);
        console.log(`   Completed Job Cleanup: ${this._formatDuration(config.completedJobCleanupInterval)}`);
        console.log(`   Health Checks: ${this._formatDuration(config.healthCheckInterval)}`);
        
        console.log('\n📋 Retention Policies:');
        console.log(`   Max Job Age: ${this._formatDuration(config.maxJobAge)}`);
        console.log(`   Max Stale Age: ${this._formatDuration(config.maxStaleAge)}`);
        console.log(`   Failed Job Retention: ${config.maxFailedJobRetention} jobs`);
        console.log(`   Completed Job Retention: ${config.maxCompletedJobRetention} jobs`);
        
        console.log('\n⚙️  Batch Processing:');
        console.log(`   Batch Size: ${config.batchSize} jobs`);
        console.log(`   Max Batch Time: ${this._formatDuration(config.maxBatchTime)}`);
        console.log(`   Batch Delay: ${this._formatDuration(config.batchDelay)}`);
        
        return config;
    }

    async _fullCleanup(options) {
        console.log('\n🧹 Performing Full Cleanup (all types)...');
        
        const results = {
            stale: null,
            failed: null,
            completed: null,
            stuck: null
        };
        
        try {
            console.log('\n1️⃣ Cleaning stale jobs...');
            results.stale = await this.cleanupManager.cleanStaleJobs();
            console.log(`   ✅ Stale cleanup: ${results.stale.cleaned} jobs cleaned`);
        } catch (error) {
            console.error(`   ❌ Stale cleanup failed: ${error.message}`);
        }
        
        try {
            console.log('\n2️⃣ Cleaning failed jobs...');
            results.failed = await this.cleanupManager.cleanFailedJobs();
            console.log(`   ✅ Failed cleanup: ${results.failed.cleaned} jobs cleaned`);
        } catch (error) {
            console.error(`   ❌ Failed cleanup failed: ${error.message}`);
        }
        
        try {
            console.log('\n3️⃣ Cleaning completed jobs...');
            results.completed = await this.cleanupManager.cleanCompletedJobs();
            console.log(`   ✅ Completed cleanup: ${results.completed.cleaned} jobs cleaned`);
        } catch (error) {
            console.error(`   ❌ Completed cleanup failed: ${error.message}`);
        }
        
        try {
            console.log('\n4️⃣ Clearing stuck jobs...');
            results.stuck = await this.cleanupManager.clearStuckJobs();
            console.log(`   ✅ Stuck cleanup: ${results.stuck.cleaned} jobs cleared`);
        } catch (error) {
            console.error(`   ❌ Stuck cleanup failed: ${error.message}`);
        }
        
        const totalCleaned = Object.values(results)
            .filter(r => r !== null)
            .reduce((sum, r) => sum + r.cleaned, 0);
        
        console.log(`\n✅ Full cleanup completed: ${totalCleaned} total jobs cleaned`);
        
        return results;
    }

    _getStatusEmoji(status) {
        switch (status) {
            case 'healthy': return '✅';
            case 'warning': return '⚠️';
            case 'critical': return '🚨';
            case 'error': return '❌';
            default: return '❓';
        }
    }

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

    async cleanup() {
        if (this.queueManager) {
            await this.queueManager.closeConnections();
        }
    }
}

// CLI Command Line Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (!command) {
        console.log(`
🧹 Queue Cleanup CLI Tool

Usage: node queueCleanupCLI.js <command> [options]

Commands:
  clean-stale      Clean stale jobs from queues
  clean-failed     Clean failed jobs beyond retention limit
  clean-completed  Clean completed jobs beyond retention limit
  clear-stuck      Clear jobs stuck in processing
  health-check     Get queue health status
  metrics          Show cleanup manager metrics
  emergency-cleanup Clear ALL jobs from ALL queues (requires --confirm)
  schedule-info    Show cleanup schedule configuration
  full-cleanup     Run all cleanup operations

Options:
  --queue <name>   Target specific queue (default: all queues)
  --max-age <ms>   Max age for stale job cleanup
  --retention <n>  Retention count for failed/completed cleanup
  --detailed       Show detailed per-queue breakdown
  --confirm        Confirm dangerous operations

Examples:
  node queueCleanupCLI.js health-check --detailed
  node queueCleanupCLI.js clean-stale --queue file-analysis-queue
  node queueCleanupCLI.js clean-failed --retention 50
  node queueCleanupCLI.js emergency-cleanup --confirm
        `);
        process.exit(0);
    }
    
    const cli = new QueueCleanupCLI();
    
    try {
        await cli.initialize();
        
        // Parse options
        const options = {};
        for (let i = 1; i < args.length; i += 2) {
            const key = args[i];
            const value = args[i + 1];
            
            if (key === '--detailed' || key === '--confirm') {
                options[key.substring(2)] = true;
                i--; // No value for flags
            } else if (key.startsWith('--')) {
                options[key.substring(2)] = value;
            }
        }
        
        // Convert numeric options
        if (options['max-age']) options.maxAge = parseInt(options['max-age']);
        if (options.retention) options.retention = parseInt(options.retention);
        
        await cli.runCommand(command, options);
        
    } catch (error) {
        console.error('❌ CLI execution failed:', error);
        process.exit(1);
    } finally {
        await cli.cleanup();
        process.exit(0);
    }
}

// Run CLI if this file is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { QueueCleanupCLI };