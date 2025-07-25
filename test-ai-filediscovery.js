const FileDiscoveryAgent = require('./src/agents/FileDiscovery');
const path = require('path');

async function testAIFileDiscovery() {
    console.log('Testing AI-powered FileDiscovery Agent...\n');
    
    const agent = new FileDiscoveryAgent({
        redisConfig: {
            host: 'localhost',
            port: 6379,
            db: 3 // Use different test database
        }
    });
    
    try {
        // Test 1: Initialize agent
        console.log('=== Test 1: Initialize Agent ===');
        await agent.initialize();
        console.log('✅ Agent initialized successfully\n');
        
        // Test 2: Test on polyglotapp directory
        console.log('=== Test 2: AI Discovery on Polyglot App ===');
        const testDirectory = path.join(__dirname, 'polyglotapp');
        
        const result = await agent.discoverAndQueueFiles(testDirectory);
        
        console.log('Discovery Results:');
        console.log(`- Success: ${result.success}`);
        console.log(`- Total files found: ${result.totalFiles}`);
        console.log(`- Core files identified: ${result.coreFiles}`);
        console.log(`- Files queued: ${result.queuedFiles}`);
        console.log(`- Detected languages: ${result.detectedLanguages.join(', ')}`);
        console.log(`- Project type: ${result.projectType}`);
        
        console.log('\nCore files discovered:');
        result.files.forEach(file => {
            console.log(`  - ${path.relative(__dirname, file.path)} (${file.language}, priority: ${file.priority})`);
        });
        
        // Show queue contents
        console.log('\n=== Queue Contents ===');
        const queueJobs = await agent.queue.getWaiting();
        console.log(`Jobs in queue: ${queueJobs.length}`);
        queueJobs.slice(0, 5).forEach((job, index) => {
            console.log(`  ${index + 1}. ${job.data.name} (${job.data.language}) - Priority: ${job.opts.priority}`);
        });
        if (queueJobs.length > 5) {
            console.log(`  ... and ${queueJobs.length - 5} more`);
        }
        
        // Test 4: Check processing stats
        console.log('\n=== Test 4: Processing Statistics ===');
        const stats = agent.getStats();
        console.log('Performance Stats:');
        console.log(`- Processing time: ${stats.durationMs}ms`);
        console.log(`- Processing rate: ${stats.processingRate}`);
        console.log(`- Files found: ${stats.totalFilesFound}`);
        console.log(`- Core files: ${stats.coreFilesIdentified}`);
        console.log(`- Files queued: ${stats.filesQueued}`);
        
        // Test 5: Check queue status
        console.log('\n=== Test 5: Queue Status ===');
        try {
            const queueStats = {
                waiting: await agent.queue.getWaiting(),
                completed: await agent.queue.getCompleted(),
                failed: await agent.queue.getFailed()
            };
            
            console.log(`Queue Status:`);
            console.log(`- Waiting jobs: ${queueStats.waiting.length}`);
            console.log(`- Completed jobs: ${queueStats.completed.length}`);
            console.log(`- Failed jobs: ${queueStats.failed.length}`);
            
        } catch (queueError) {
            console.log('Queue status check skipped - Redis may not be available');
        }
        
        console.log('\n✅ AI FileDiscovery Agent testing completed successfully!');
        
    } catch (error) {
        console.error('❌ AI FileDiscovery Agent test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await agent.cleanup();
        console.log('Agent cleanup completed');
    }
}

// Test security boundary
async function testSecurityBoundary() {
    console.log('\n=== Security Test: Path Traversal Protection ===');
    
    const agent = new FileDiscoveryAgent();
    
    try {
        await agent.discoverAndQueueFiles('../../../etc'); // Attempt path traversal
        console.log('❌ Security test failed - should have been blocked');
    } catch (error) {
        console.log('✅ Security test passed - path traversal blocked:', error.message);
    }
}

// Run all tests
async function runAllTests() {
    await testAIFileDiscovery();
    await testSecurityBoundary();
}

runAllTests();