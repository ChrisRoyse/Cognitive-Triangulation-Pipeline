const { Queue } = require('bullmq');
const { createClient } = require('redis');

async function checkPrioritizedJobs() {
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
        
        // Get job counts
        const counts = await queue.getJobCounts();
        console.log('Job counts:', counts);
        
        // Try to get jobs in different states
        const waiting = await queue.getWaiting(0, 10);
        const prioritized = await queue.getJobs(['prioritized'], 0, 10);
        
        console.log(`\nWaiting jobs: ${waiting.length}`);
        console.log(`Prioritized jobs: ${prioritized.length}`);
        
        if (prioritized.length > 0) {
            console.log('\n=== PRIORITIZED JOBS (first 5) ===');
            prioritized.slice(0, 5).forEach((job, i) => {
                console.log(`\n${i+1}. Job ID: ${job.id}`);
                console.log(`   Name: ${job.name}`);
                console.log(`   Priority: ${job.opts.priority}`);
                console.log(`   File: ${job.data.name} (${job.data.path})`);
                console.log(`   Language: ${job.data.language}`);
            });
            
            console.log('\n✅ Jobs are successfully queued and waiting to be processed!');
            console.log('The FileDiscovery agent has done its job correctly.');
            console.log(`Total ${counts.prioritized} files are ready for the next pipeline stage.`);
        }
        
        await queue.close();
        await redis.disconnect();
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkPrioritizedJobs();