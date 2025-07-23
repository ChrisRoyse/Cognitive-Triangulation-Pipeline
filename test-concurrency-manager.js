/**
 * Standalone test for Global Concurrency Manager
 * Run with: node test-concurrency-manager.js
 */

const { GlobalConcurrencyManager } = require('./src/utils/globalConcurrencyManager');

async function testBasicOperations() {
    console.log('\n=== Testing Basic Operations ===');
    const manager = new GlobalConcurrencyManager({ maxConcurrency: 10 });
    
    try {
        // Test acquire and release
        const permit = await manager.acquire('test-worker');
        console.log('✅ Acquired permit:', permit.id);
        console.log('   Current concurrency:', manager.getCurrentConcurrency());
        
        await manager.release(permit.id);
        console.log('✅ Released permit');
        console.log('   Current concurrency:', manager.getCurrentConcurrency());
        
        // Test multiple acquisitions
        const permits = [];
        for (let i = 0; i < 5; i++) {
            permits.push(await manager.acquire(`worker-${i}`));
        }
        console.log(`✅ Acquired ${permits.length} permits`);
        console.log('   Current concurrency:', manager.getCurrentConcurrency());
        
        // Release all
        for (const p of permits) {
            await manager.release(p.id);
        }
        console.log('✅ Released all permits');
        
        await manager.shutdown();
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function testHardLimit() {
    console.log('\n=== Testing Hard Limit Enforcement ===');
    const manager = new GlobalConcurrencyManager({ maxConcurrency: 5 });
    
    try {
        // Fill to capacity
        const permits = [];
        for (let i = 0; i < 5; i++) {
            permits.push(await manager.acquire(`worker-${i}`));
        }
        console.log('✅ Acquired maximum permits (5/5)');
        
        // Try to acquire one more (should timeout)
        console.log('   Attempting to exceed limit...');
        try {
            await manager.acquire('overflow', { timeout: 1000 });
            console.error('❌ Should have timed out!');
        } catch (error) {
            console.log('✅ Correctly rejected overflow request:', error.message);
        }
        
        // Release one and try again
        await manager.release(permits[0].id);
        const newPermit = await manager.acquire('overflow', { timeout: 1000 });
        console.log('✅ Successfully acquired after release');
        
        // Cleanup
        await manager.release(newPermit.id);
        for (const p of permits.slice(1)) {
            await manager.release(p.id);
        }
        
        await manager.shutdown();
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function testPriorities() {
    console.log('\n=== Testing Priority-Based Allocation ===');
    const manager = new GlobalConcurrencyManager({ 
        maxConcurrency: 3,
        enablePriorities: true 
    });
    
    try {
        // Set priorities
        manager.setWorkerPriority('critical', 10);
        manager.setWorkerPriority('normal', 5);
        manager.setWorkerPriority('low', 1);
        
        // Fill to capacity
        const permits = [];
        for (let i = 0; i < 3; i++) {
            permits.push(await manager.acquire('low'));
        }
        console.log('✅ Filled capacity with low priority workers');
        
        // Queue different priorities
        const promises = [
            manager.acquire('critical').then(p => ({ type: 'critical', permit: p })),
            manager.acquire('normal').then(p => ({ type: 'normal', permit: p })),
            manager.acquire('low').then(p => ({ type: 'low', permit: p }))
        ];
        
        console.log('   Queued requests with different priorities');
        console.log('   Queue length:', manager.getQueueLength());
        
        // Release permits to see priority order
        for (const p of permits) {
            await manager.release(p.id);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const results = await Promise.all(promises);
        console.log('✅ Acquisition order:', results.map(r => r.type));
        
        // Cleanup
        for (const r of results) {
            await manager.release(r.permit.id);
        }
        
        await manager.shutdown();
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function testMetrics() {
    console.log('\n=== Testing Metrics and Monitoring ===');
    const manager = new GlobalConcurrencyManager({ maxConcurrency: 50 });
    
    try {
        // Generate some activity
        const permits = [];
        for (let i = 0; i < 25; i++) {
            permits.push(await manager.acquire(`worker-${i % 5}`));
        }
        
        // Release half
        for (let i = 0; i < 12; i++) {
            await manager.release(permits[i].id);
        }
        
        const metrics = manager.getMetrics();
        console.log('✅ Metrics collected:');
        console.log('   Current concurrency:', metrics.currentConcurrency);
        console.log('   Max concurrency:', metrics.maxConcurrency);
        console.log('   Utilization:', metrics.utilization.toFixed(1) + '%');
        console.log('   Total acquired:', metrics.totalAcquired);
        console.log('   Total released:', metrics.totalReleased);
        console.log('   Average acquire time:', metrics.avgAcquireTime.toFixed(2) + 'ms');
        
        const workerStats = manager.getWorkerStats();
        console.log('✅ Worker statistics:');
        for (const [type, stats] of Object.entries(workerStats)) {
            if (type !== 'total') {
                console.log(`   ${type}: ${stats.active} active, ${stats.completed} completed`);
            }
        }
        
        // Cleanup
        for (const p of permits.slice(12)) {
            await manager.release(p.id);
        }
        
        await manager.shutdown();
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function runAllTests() {
    console.log('🚀 Starting Global Concurrency Manager Tests\n');
    
    await testBasicOperations();
    await testHardLimit();
    await testPriorities();
    await testMetrics();
    
    console.log('\n✨ All tests completed!');
}

// Run tests
runAllTests().catch(console.error);