#!/usr/bin/env node

const Redis = require('ioredis');
const { getInstance } = require('./src/utils/queueManager');
require('dotenv').config();

async function checkRedisQueues() {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const queueManager = getInstance();
    
    try {
        console.log('🔍 Checking Redis Queue Status\n');

        const queueNames = [
            'file-analysis-queue',
            'directory-aggregation-queue',
            'directory-resolution-queue',
            'relationship-resolution-queue',
            'reconciliation-queue',
            'analysis-findings-queue',
            'global-resolution-queue',
            'relationship-validated-queue',
            'llm-analysis-queue',
            'graph-ingestion-queue',
            'failed-jobs'
        ];

        for (const queueName of queueNames) {
            const queue = queueManager.getQueue(queueName);
            const counts = await queue.getJobCounts();
            
            console.log(`📊 ${queueName}:`);
            console.log(`   Active: ${counts.active}`);
            console.log(`   Waiting: ${counts.waiting}`);
            console.log(`   Completed: ${counts.completed}`);
            console.log(`   Failed: ${counts.failed}`);
            console.log(`   Delayed: ${counts.delayed}`);
            console.log(`   Paused: ${counts.paused}`);
            
            if (counts.failed > 0) {
                console.log(`   ⚠️  Has failed jobs!`);
                const failedJobs = await queue.getFailed(0, 5);
                failedJobs.forEach((job, index) => {
                    console.log(`   Failed Job ${index + 1}: ${job.failedReason}`);
                });
            }
            console.log('');
        }

        // Check for any keys related to the pipeline
        const keys = await redis.keys('bull:*');
        console.log(`\n📦 Total Redis Keys: ${keys.length}`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await queueManager.closeConnections();
        await redis.quit();
    }
}

checkRedisQueues().catch(console.error);