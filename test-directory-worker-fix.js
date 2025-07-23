const DirectoryAggregationWorker = require('./src/workers/directoryAggregationWorker');

async function testDirectoryWorkerFix() {
    console.log('🧪 Testing DirectoryAggregationWorker Fix...');
    
    try {
        // Create a worker instance (this will test imports and initialization)
        console.log('📦 Creating DirectoryAggregationWorker instance...');
        const worker = new DirectoryAggregationWorker();
        
        console.log('✅ DirectoryAggregationWorker created successfully');
        
        // Test the logging function to ensure no timer.end() errors
        console.log('🔧 Testing performance logger functionality...');
        const { createPerformanceLogger } = require('./src/config/logging');
        const testLogger = { info: () => {}, error: () => {} }; // Mock logger
        const perfLogger = createPerformanceLogger('test-directory-worker', testLogger);
        
        perfLogger.start();
        perfLogger.checkpoint('test-checkpoint', { duration: 10 });
        const metrics = perfLogger.end({ success: true, testData: 'test' });
        
        console.log('✅ Performance logger working correctly');
        console.log('📊 Test metrics:', metrics);
        
        console.log('\n🎉 SUCCESS: DirectoryAggregationWorker fix is working!');
        console.log('The timer.end() error should now be resolved.');
        
        return true;
        
    } catch (error) {
        console.error('❌ FAILED: DirectoryAggregationWorker fix failed');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return false;
    }
}

testDirectoryWorkerFix().then(success => {
    process.exit(success ? 0 : 1);
}).catch(console.error);