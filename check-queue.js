const { Queue } = require('bullmq');
const { createClient } = require('redis');

async function checkQueue() {
    const redis = createClient({
        host: 'localhost',
        port: 6379,
        db: 3
    });
    
    try {
        await redis.connect();
        const queue = new Queue('codebase-analysis-discovered-files', {
            connection: { host: 'localhost', port: 6379, db: 3 }
        });
        
        const waiting = await queue.getWaiting();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();
        
        console.log('=== QUEUE INSPECTION ===');
        console.log(`Waiting jobs: ${waiting.length}`);
        console.log(`Completed jobs: ${completed.length}`);
        console.log(`Failed jobs: ${failed.length}`);
        
        if (waiting.length > 0) {
            console.log('\n=== WAITING JOBS ===');
            waiting.forEach((job, i) => {
                console.log(`${i+1}. ${job.data.name} (${job.data.path})`);
                console.log(`   Language: ${job.data.language}, Priority: ${job.opts.priority}`);
            });
        }
        
        if (completed.length > 0) {
            console.log('\n=== COMPLETED JOBS (first 10) ===');
            completed.slice(0, 10).forEach((job, i) => {
                console.log(`${i+1}. ${job.data.name} (${job.data.path})`);
                console.log(`   Language: ${job.data.language}, Priority: ${job.opts.priority}`);
            });
        }
        
        if (failed.length > 0) {
            console.log('\n=== FAILED JOBS ===');
            failed.forEach((job, i) => {
                console.log(`${i+1}. ${job.data.name} (${job.data.path})`);
                console.log(`   Error: ${job.failedReason}`);
            });
        }
        
        await queue.close();
        await redis.disconnect();
    } catch (error) {
        console.error('Error checking queue:', error.message);
    }
}

checkQueue();