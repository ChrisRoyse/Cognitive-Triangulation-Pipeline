/**
 * Queue Cleanup System Integration Example
 * 
 * This example demonstrates how to use the comprehensive queue cleanup system
 * with the existing pipeline infrastructure.
 */

const { getInstance: getQueueManager } = require('../src/utils/queueManager.js');
const { PipelineConfig } = require('../src/config/pipelineConfig.js');

async function demonstrateQueueCleanup() {
    console.log('🧹 Queue Cleanup System Demonstration\n');

    try {
        // Initialize the pipeline configuration
        const config = new PipelineConfig();
        console.log('✅ Pipeline configuration loaded');

        // Get the queue manager instance (it will automatically initialize cleanup)
        const queueManager = getQueueManager();
        await queueManager.connect();
        console.log('✅ Queue manager connected with cleanup system\n');

        // Wait a moment for cleanup manager to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 1. Check initial queue health
        console.log('1️⃣ Checking initial queue health...');
        const initialHealth = await queueManager.getQueueHealth();
        console.log(`   Overall Status: ${initialHealth.overall}`);
        console.log(`   Total Queues: ${initialHealth.summary.totalQueues}`);
        console.log(`   Total Jobs: ${initialHealth.summary.totalJobs}\n`);

        // 2. Get cleanup configuration
        console.log('2️⃣ Current cleanup configuration:');
        const cleanupConfig = config.getCleanupConfig();
        console.log(`   Stale job cleanup interval: ${formatDuration(cleanupConfig.staleJobCleanupInterval)}`);
        console.log(`   Failed job retention: ${cleanupConfig.maxFailedJobRetention} jobs`);
        console.log(`   Completed job retention: ${cleanupConfig.maxCompletedJobRetention} jobs`);
        console.log(`   Max job age: ${formatDuration(cleanupConfig.maxJobAge)}\n`);

        // 3. Manual cleanup operations
        console.log('3️⃣ Performing manual cleanup operations...');
        
        // Clean stale jobs
        console.log('   Cleaning stale jobs...');
        const staleResult = await queueManager.cleanStaleJobs();
        console.log(`   ✅ Cleaned ${staleResult.cleaned} stale jobs from ${Object.keys(staleResult.queues).length} queues`);

        // Clean failed jobs
        console.log('   Cleaning excess failed jobs...');
        const failedResult = await queueManager.cleanFailedJobs();
        console.log(`   ✅ Cleaned ${failedResult.cleaned} failed jobs from ${Object.keys(failedResult.queues).length} queues`);

        // Clean completed jobs
        console.log('   Cleaning excess completed jobs...');
        const completedResult = await queueManager.cleanCompletedJobs();
        console.log(`   ✅ Cleaned ${completedResult.cleaned} completed jobs from ${Object.keys(completedResult.queues).length} queues`);

        // Clear stuck jobs
        console.log('   Clearing stuck jobs...');
        const stuckResult = await queueManager.clearStuckJobs();
        console.log(`   ✅ Cleared ${stuckResult.cleaned} stuck jobs from ${Object.keys(stuckResult.queues).length} queues\n`);

        // 4. Get cleanup metrics
        console.log('4️⃣ Cleanup system metrics:');
        const metrics = queueManager.getCleanupMetrics();
        console.log(`   Total operations: ${metrics.operations.total}`);
        console.log(`   Success rate: ${metrics.operations.successRate.toFixed(2)}%`);
        console.log(`   Jobs cleaned - Stale: ${metrics.jobsCleaned.stale}, Failed: ${metrics.jobsCleaned.failed}, Completed: ${metrics.jobsCleaned.completed}`);
        console.log(`   System uptime: ${metrics.runtime.uptimeFormatted}\n`);

        // 5. Queue-specific operations
        console.log('5️⃣ Queue-specific cleanup example...');
        const targetQueue = 'file-analysis-queue';
        console.log(`   Targeting queue: ${targetQueue}`);
        
        const queueHealth = await queueManager.getQueueHealth(targetQueue);
        if (queueHealth.queues[targetQueue]) {
            const health = queueHealth.queues[targetQueue];
            console.log(`   Queue status: ${health.status}`);
            console.log(`   Active jobs: ${health.metrics.activeJobs}`);
            console.log(`   Failed jobs: ${health.metrics.failedJobs}`);
            console.log(`   Failure rate: ${health.metrics.failureRate.toFixed(2)}%`);
        }

        // Clean only this queue
        const queueCleanupResult = await queueManager.cleanStaleJobs(targetQueue);
        console.log(`   ✅ Queue-specific cleanup: ${queueCleanupResult.cleaned} jobs cleaned\n`);

        // 6. Demonstrate error handling
        console.log('6️⃣ Error handling demonstration...');
        try {
            // This should work fine
            await queueManager.cleanStaleJobs('non-existent-queue');
            console.log('   ✅ Handled non-existent queue gracefully\n');
        } catch (error) {
            console.log(`   ✅ Error handled: ${error.message}\n`);
        }

        // 7. Final health check
        console.log('7️⃣ Final queue health check...');
        const finalHealth = await queueManager.getQueueHealth();
        console.log(`   Overall Status: ${finalHealth.overall}`);
        console.log(`   Total Jobs: ${finalHealth.summary.totalJobs}`);
        console.log(`   Overall Failure Rate: ${(finalHealth.summary.overallFailureRate * 100).toFixed(2)}%\n`);

        console.log('✅ Queue cleanup demonstration completed successfully!');

        // 8. Show how periodic cleanup works
        console.log('\n8️⃣ Periodic cleanup information:');
        console.log('   The cleanup system automatically runs periodic cleanup based on configuration:');
        console.log(`   - Stale jobs: every ${formatDuration(cleanupConfig.staleJobCleanupInterval)}`);
        console.log(`   - Failed jobs: every ${formatDuration(cleanupConfig.failedJobCleanupInterval)}`);
        console.log(`   - Completed jobs: every ${formatDuration(cleanupConfig.completedJobCleanupInterval)}`);
        console.log(`   - Health checks: every ${formatDuration(cleanupConfig.healthCheckInterval)}`);
        console.log('   These run automatically in the background without manual intervention.\n');

        // 9. Emergency cleanup (commented out for safety)
        console.log('9️⃣ Emergency cleanup capability:');
        console.log('   For debugging purposes, you can clear all queues with:');
        console.log('   await queueManager.emergencyCleanup(true) // DANGEROUS: Deletes all jobs!');
        console.log('   This is disabled by default and requires explicit confirmation.\n');

        console.log('🎯 Integration Points:');
        console.log('   - QueueManager automatically initializes cleanup on connection');
        console.log('   - PipelineConfig provides centralized cleanup configuration');
        console.log('   - Cleanup runs independently without affecting job processing');
        console.log('   - All operations are logged and monitored for observability');
        console.log('   - CLI tool available for manual operations and debugging');

    } catch (error) {
        console.error('❌ Demonstration failed:', error);
    } finally {
        // Clean up
        const queueManager = getQueueManager();
        await queueManager.closeConnections();
        console.log('\n🛑 Cleanup system demonstration completed and connections closed.');
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// Run the demonstration if this file is executed directly
if (require.main === module) {
    demonstrateQueueCleanup().catch(console.error);
}

module.exports = { demonstrateQueueCleanup };