#!/usr/bin/env node

const IORedis = require('ioredis');
const config = require('./config/index.js');

async function debugActiveJobs() {
    console.log('=== ACTIVE JOBS DEBUG ===\n');
    
    const redis = new IORedis(config.REDIS_URL);
    
    try {
        // Check active jobs in relationship resolution queue
        console.log('Active jobs in relationship-resolution-queue:');
        const activeJobs = await redis.lrange('bull:relationship-resolution-queue:active', 0, 4); // Get first 5
        
        console.log(`Found ${activeJobs.length} active job IDs (showing first 5)`);
        
        for (const jobId of activeJobs) {
            console.log(`\nJob ID: ${jobId}`);
            
            // Get job details
            const jobKey = `bull:relationship-resolution-queue:${jobId}`;
            const jobData = await redis.hgetall(jobKey);
            
            console.log('Job details:');
            console.log(`  - name: ${jobData.name}`);
            console.log(`  - timestamp: ${jobData.timestamp}`);
            console.log(`  - processedOn: ${jobData.processedOn || 'Not processed'}`);
            console.log(`  - finishedOn: ${jobData.finishedOn || 'Not finished'}`);
            console.log(`  - failedReason: ${jobData.failedReason || 'No failure reason'}`);
            
            // Try to parse data payload
            try {
                const data = JSON.parse(jobData.data);
                console.log(`  - type: ${data.type}`);
                console.log(`  - source: ${data.source}`);
                console.log(`  - filePath: ${data.filePath}`);
                console.log(`  - primaryPoi: ${data.primaryPoi ? data.primaryPoi.name : 'N/A'}`);
                console.log(`  - contextualPois: ${data.contextualPois ? data.contextualPois.length : 0}`);
            } catch (e) {
                console.log(`  - data parse error: ${e.message}`);
                console.log(`  - raw data: ${jobData.data?.substring(0, 100)}...`);
            }
        }
        
        // Check job counts for other states
        console.log('\n=== QUEUE STATE SUMMARY ===');
        const waiting = await redis.llen('bull:relationship-resolution-queue:waiting') || 0;
        const active = await redis.llen('bull:relationship-resolution-queue:active') || 0;
        const completed = await redis.zcard('bull:relationship-resolution-queue:completed') || 0;
        const failed = await redis.zcard('bull:relationship-resolution-queue:failed') || 0;
        
        console.log(`Waiting: ${waiting}`);
        console.log(`Active: ${active}`);  
        console.log(`Completed: ${completed}`);
        console.log(`Failed: ${failed}`);
        
        // Check if any jobs have failed
        if (failed > 0) {
            console.log('\n=== FAILED JOBS ===');
            const failedJobs = await redis.zrange('bull:relationship-resolution-queue:failed', 0, 2); // Get first 3
            
            for (const jobId of failedJobs) {
                const jobKey = `bull:relationship-resolution-queue:${jobId}`;
                const jobData = await redis.hgetall(jobKey);
                console.log(`\nFailed Job ID: ${jobId}`);
                console.log(`  - failedReason: ${jobData.failedReason || 'No reason given'}`);
                console.log(`  - finishedOn: ${jobData.finishedOn || 'Not finished'}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error during debug:', error.message);
        console.error(error.stack);
    } finally {
        await redis.quit();
    }
}

debugActiveJobs().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});