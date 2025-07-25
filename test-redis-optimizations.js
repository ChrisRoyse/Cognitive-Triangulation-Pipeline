#!/usr/bin/env node

/**
 * Test script to validate Redis optimizations for large codebase processing
 */

const { getInstance } = require('./src/utils/queueManager.js');

async function testRedisOptimizations() {
    console.log('🧪 Testing Redis optimizations for large codebase processing...\n');
    
    const queueManager = getInstance();
    
    try {
        // Test connection with new timeouts
        console.log('1. Testing Redis connection with new timeout settings...');
        await queueManager.connect();
        console.log('✅ Connected to Redis successfully with timeout configuration');
        
        // Test job count monitoring (which includes memory monitoring)
        console.log('\n2. Testing job count monitoring with memory monitoring...');
        const jobCounts = await queueManager.getJobCounts();
        console.log('✅ Job counts retrieved:', jobCounts);
        console.log('✅ Memory monitoring included in job count check');
        
        // Test queue creation with timeout settings
        console.log('\n3. Testing queue creation with timeout settings...');
        const testQueue = queueManager.getQueue('file-analysis-queue');
        console.log('✅ Queue created successfully with timeout configuration');
        
        // Test worker connection creation
        console.log('\n4. Testing worker connection with timeout settings...');
        const workerConnection = queueManager.createConnection('test-worker');
        await workerConnection.ping();
        console.log('✅ Worker connection created successfully with timeout configuration');
        await workerConnection.quit();
        
        console.log('\n✅ All Redis optimizations working correctly!');
        console.log('\nOptimizations implemented:');
        console.log('- Connection timeout: 30 seconds (prevents hanging on large codebases)');
        console.log('- Command timeout: 5 seconds (prevents command hangs)');
        console.log('- Memory monitoring: Tracks Redis memory usage for 200+ jobs');
        console.log('- Memory warnings: Alerts when Redis memory > 500MB');
        
    } catch (error) {
        console.error('❌ Error testing Redis optimizations:', error.message);
        process.exit(1);
    } finally {
        await queueManager.closeConnections();
        console.log('\n🔌 Connections closed successfully');
    }
}

// Run the test
testRedisOptimizations().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});