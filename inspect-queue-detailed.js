const { Queue } = require('bullmq');
const { createClient } = require('redis');

async function inspectQueue() {
    const redis = createClient({
        host: 'localhost',
        port: 6379,
        db: 3
    });
    
    try {
        await redis.connect();
        console.log('Connected to Redis db 3\n');
        
        // Check all keys
        const allKeys = await redis.keys('*');
        console.log(`Total keys in Redis: ${allKeys.length}`);
        
        // Check for our queue
        const queueName = 'codebase-analysis-discovered-files-test';
        const queueKeys = allKeys.filter(key => key.includes(queueName));
        console.log(`\nKeys for queue '${queueName}': ${queueKeys.length}`);
        queueKeys.forEach(key => console.log(`  - ${key}`));
        
        // Check BullMQ queue
        const queue = new Queue(queueName, {
            connection: { host: 'localhost', port: 6379, db: 3 }
        });
        
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();
        const delayed = await queue.getDelayed();
        
        console.log('\n=== QUEUE STATUS ===');
        console.log(`Waiting: ${waiting.length}`);
        console.log(`Active: ${active.length}`);
        console.log(`Completed: ${completed.length}`);
        console.log(`Failed: ${failed.length}`);
        console.log(`Delayed: ${delayed.length}`);
        
        if (waiting.length > 0) {
            console.log('\n=== WAITING JOBS (first 5) ===');
            waiting.slice(0, 5).forEach((job, i) => {
                console.log(`\n${i+1}. Job ID: ${job.id}`);
                console.log(`   Name: ${job.name}`);
                console.log(`   Priority: ${job.opts.priority}`);
                console.log(`   Data:`, JSON.stringify(job.data, null, 2).split('\n').slice(0, 10).join('\n'));
            });
        }
        
        // Check all BullMQ keys
        const bullKeys = allKeys.filter(key => key.startsWith('bull:'));
        console.log(`\n=== ALL BULLMQ KEYS (${bullKeys.length}) ===`);
        bullKeys.slice(0, 20).forEach(key => console.log(`  - ${key}`));
        
        await queue.close();
        await redis.disconnect();
    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }
}

inspectQueue();