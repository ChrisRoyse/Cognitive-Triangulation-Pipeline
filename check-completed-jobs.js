const { Queue } = require('bullmq');
const { createClient } = require('redis');

async function checkCompletedJobs() {
    const redis = createClient({
        host: 'localhost',
        port: 6379,
        db: 3
    });
    
    try {
        await redis.connect();
        
        const queue = new Queue('codebase-analysis-discovered-files-test', {
            connection: { host: 'localhost', port: 6379, db: 3 }
        });
        
        // Get all job counts
        const counts = await queue.getJobCounts();
        console.log('Job counts:', counts);
        
        // Get completed jobs
        const completed = await queue.getCompleted(0, 10);
        console.log(`\nCompleted jobs: ${completed.length}`);
        
        if (completed.length > 0) {
            console.log('\n=== COMPLETED JOBS ===');
            completed.forEach((job, i) => {
                console.log(`\n${i+1}. Job ID: ${job.id}`);
                console.log(`   Name: ${job.name}`);
                console.log(`   Finished: ${job.finishedOn}`);
                console.log(`   Data: ${JSON.stringify(job.data).substring(0, 100)}...`);
            });
        }
        
        // Check for workers
        const workers = await queue.getWorkers();
        console.log(`\nActive workers: ${workers.length}`);
        
        await queue.close();
        await redis.disconnect();
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkCompletedJobs();