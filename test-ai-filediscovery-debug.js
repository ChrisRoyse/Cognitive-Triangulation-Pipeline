const FileDiscoveryAgent = require('./src/agents/FileDiscovery');
const path = require('path');
const { Queue } = require('bullmq');

async function testAIFileDiscoveryWithDebug() {
    console.log('Testing AI-powered FileDiscovery Agent with debugging...\n');
    
    const agent = new FileDiscoveryAgent({
        redisConfig: {
            host: 'localhost',
            port: 6379,
            db: 3 // Use different test database
        }
    });
    
    try {
        // Initialize agent
        console.log('=== Initializing Agent ===');
        await agent.initialize();
        console.log('✅ Agent initialized\n');
        
        // Run discovery
        console.log('=== Running File Discovery ===');
        const testDirectory = path.join(__dirname, 'polyglotapp');
        const result = await agent.discoverAndQueueFiles(testDirectory);
        
        console.log('\n=== Discovery Results ===');
        console.log(`Files queued: ${result.queuedFiles}`);
        console.log(`Core files found: ${result.coreFiles}`);
        
        // IMMEDIATELY check the queue
        console.log('\n=== IMMEDIATE QUEUE CHECK ===');
        const queue = new Queue('codebase-analysis-discovered-files', {
            connection: { host: 'localhost', port: 6379, db: 3 }
        });
        
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        
        console.log(`Waiting jobs: ${waiting.length}`);
        console.log(`Active jobs: ${active.length}`);
        console.log(`Completed jobs: ${completed.length}`);
        
        if (waiting.length > 0) {
            console.log('\n=== WAITING JOBS ===');
            waiting.slice(0, 5).forEach((job, i) => {
                console.log(`${i+1}. ${job.data.name} (${job.data.path})`);
                console.log(`   Language: ${job.data.language}, Priority: ${job.opts.priority}`);
            });
        }
        
        // Check Redis keys directly
        const { createClient } = require('redis');
        const redis = createClient({
            host: 'localhost',
            port: 6379,
            db: 3
        });
        await redis.connect();
        
        const keys = await redis.keys('*');
        console.log(`\n=== REDIS KEYS (${keys.length}) ===`);
        keys.slice(0, 10).forEach(key => console.log(`  - ${key}`));
        
        await redis.disconnect();
        await queue.close();
        await agent.cleanup();
        
        console.log('\n✅ Test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

testAIFileDiscoveryWithDebug();