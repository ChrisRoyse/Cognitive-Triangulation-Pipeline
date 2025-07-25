const FileDiscoveryAgent = require('./src/agents/FileDiscovery');
const path = require('path');

async function testPolyglotOnly() {
    console.log('Testing AI FileDiscovery Agent - Polyglot Test Only...\n');
    
    const agent = new FileDiscoveryAgent({
        queueName: 'test-polyglot-processing',
        redisConfig: {
            host: 'localhost',
            port: 6379,
            db: 4 // Use different test database
        }
    });
    
    try {
        // Initialize agent
        console.log('=== Initializing Agent ===');
        await agent.initialize();
        console.log('✅ Agent initialized successfully\n');
        
        // Test on polyglot-test directory
        console.log('=== AI Discovery on Polyglot Test Directory ===');
        const testDirectory = path.join(__dirname, 'polyglot-test');
        console.log(`Target directory: ${testDirectory}\n`);
        
        const result = await agent.discoverAndQueueFiles(testDirectory);
        
        console.log('=== Discovery Results ===');
        console.log(`✅ Success: ${result.success}`);
        console.log(`📁 Total files found: ${result.totalFiles}`);
        console.log(`🎯 Core files identified: ${result.coreFiles}`);
        console.log(`⏳ Files queued: ${result.queuedFiles}`);
        console.log(`🔤 Detected languages: ${result.detectedLanguages.join(', ')}`);
        console.log(`📋 Project type: ${result.projectType}`);
        
        console.log('\n=== Core Files Discovered ===');
        if (result.files && result.files.length > 0) {
            result.files.forEach((file, index) => {
                console.log(`${index + 1}. ${path.relative(__dirname, file.path)}`);
                console.log(`   Language: ${file.language} | Priority: ${file.priority} | Extension: ${file.extension}`);
            });
        } else {
            console.log('❌ No core files were identified');
        }
        
        // Show queue contents
        console.log('\n=== Queue Status ===');
        const queueJobs = await agent.queue.getWaiting();
        console.log(`Jobs in queue: ${queueJobs.length}`);
        
        if (queueJobs.length > 0) {
            console.log('\nQueued files:');
            queueJobs.forEach((job, index) => {
                console.log(`  ${index + 1}. ${job.data.name} (${job.data.language}) - Priority: ${job.opts.priority}`);
            });
        }
        
        // Processing stats
        console.log('\n=== Processing Statistics ===');
        const stats = agent.getStats();
        console.log(`⏱️  Processing time: ${stats.durationMs}ms`);
        console.log(`🚀 Processing rate: ${stats.processingRate}`);
        console.log(`📊 Efficiency: ${stats.filesQueued}/${stats.totalFilesFound} files processed`);
        
        // Validate results
        console.log('\n=== Result Validation ===');
        if (result.success && result.queuedFiles > 0) {
            console.log('✅ Test PASSED - Files discovered and queued successfully');
            
            // Expected files for polyglot-test
            const expectedFileTypes = ['js', 'py', 'java', 'sql'];
            const foundFileTypes = [...new Set(result.files.map(f => f.extension.replace('.', '')))];
            
            console.log(`Expected file types: ${expectedFileTypes.join(', ')}`);
            console.log(`Found file types: ${foundFileTypes.join(', ')}`);
            
            const hasAllTypes = expectedFileTypes.every(type => foundFileTypes.includes(type));
            if (hasAllTypes) {
                console.log('✅ All expected file types found');
            } else {
                console.log('⚠️  Some expected file types missing');
            }
        } else {
            console.log('❌ Test FAILED - No files discovered or queued');
        }
        
        console.log('\n🎉 Polyglot FileDiscovery test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await agent.cleanup();
        console.log('\n🧹 Agent cleanup completed');
    }
}

testPolyglotOnly();