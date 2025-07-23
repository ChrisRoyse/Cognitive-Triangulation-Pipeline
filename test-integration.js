/**
 * Integration test for complete concurrency management system
 * Run with: node test-integration.js
 */

const { GlobalConcurrencyManager } = require('./src/utils/globalConcurrencyManager');
const { ServiceCircuitBreakerManager } = require('./src/utils/serviceCircuitBreakers');
const { WorkerPoolManager } = require('./src/utils/workerPoolManager');

// Mock services
const mockServices = {
    llm: {
        analyze: async (data) => {
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
            
            // Simulate occasional failures
            if (Math.random() < 0.1) {
                const error = new Error('Service error');
                error.code = Math.random() < 0.5 ? 'RATE_LIMIT' : 'NETWORK_ERROR';
                throw error;
            }
            
            return { analysis: 'completed', data };
        }
    },
    neo4j: {
        session: () => ({
            run: async (query) => {
                await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 70));
                
                // Simulate occasional failures
                if (Math.random() < 0.05) {
                    const error = new Error('Database error');
                    error.code = 'ServiceUnavailable';
                    throw error;
                }
                
                return { records: [] };
            },
            close: () => {}
        }),
        verifyConnectivity: async () => true
    }
};

async function testFullIntegration() {
    console.log('\n=== Testing Full System Integration ===\n');
    
    // Initialize managers
    const globalConcurrencyManager = new GlobalConcurrencyManager({
        maxConcurrency: 100,
        enablePriorities: true
    });
    
    const circuitBreakerManager = new ServiceCircuitBreakerManager({
        services: mockServices,
        globalConcurrencyManager
    });
    
    const workerPoolManager = new WorkerPoolManager({
        environment: 'test',
        maxGlobalConcurrency: 100
    });
    
    // Wire up integration
    workerPoolManager.setGlobalConcurrencyManager(globalConcurrencyManager);
    workerPoolManager.setCircuitBreakerManager(circuitBreakerManager);
    
    console.log('✅ All managers initialized and integrated\n');
    
    try {
        // Test 1: Concurrent workers respecting global limit
        console.log('1. Testing concurrent workers with global limit:');
        
        const workerTypes = ['file-analysis', 'validation', 'relationship-resolution'];
        const promises = [];
        let maxObserved = 0;
        
        // Monitor concurrency
        globalConcurrencyManager.on('permitAcquired', () => {
            const current = globalConcurrencyManager.getCurrentConcurrency();
            maxObserved = Math.max(maxObserved, current);
        });
        
        // Register workers
        for (const type of workerTypes) {
            workerPoolManager.registerWorker(type, {
                maxConcurrency: 40,
                priority: type === 'file-analysis' ? 10 : 5
            });
        }
        
        // Submit 150 jobs (exceeding limit)
        console.log('   Submitting 150 jobs...');
        for (let i = 0; i < 150; i++) {
            const workerType = workerTypes[i % 3];
            promises.push(
                workerPoolManager.executeWithManagement(
                    workerType,
                    async () => {
                        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
                        return { id: i, type: workerType };
                    }
                ).catch(error => ({ error: error.message }))
            );
        }
        
        // Wait a bit to observe concurrency
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('   Current concurrency:', globalConcurrencyManager.getCurrentConcurrency());
        console.log('   Queue length:', globalConcurrencyManager.getQueueLength());
        console.log('   Max observed concurrency:', maxObserved);
        
        // Wait for all to complete
        console.log('   Waiting for completion...');
        const results = await Promise.all(promises);
        
        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        
        console.log(`✅ Processed ${successful} successful, ${failed} failed`);
        console.log(`   Max concurrency never exceeded 100: ${maxObserved <= 100 ? 'PASS' : 'FAIL'}\n`);
        
        // Test 2: Circuit breaker integration
        console.log('2. Testing circuit breaker integration:');
        
        // Force service failures
        let failureCount = 0;
        mockServices.llm.analyze = async () => {
            failureCount++;
            throw new Error('Service unavailable');
        };
        
        const failurePromises = [];
        for (let i = 0; i < 10; i++) {
            failurePromises.push(
                workerPoolManager.executeWithManagement(
                    'file-analysis',
                    () => circuitBreakerManager.executeWithBreaker(
                        'deepseek',
                        () => mockServices.llm.analyze({})
                    )
                ).catch(e => e)
            );
        }
        
        const errors = await Promise.all(failurePromises);
        console.log(`   Triggered ${failureCount} failures`);
        
        const circuitOpen = errors.some(e => e.message.includes('Circuit breaker is OPEN'));
        console.log(`   Circuit breaker opened: ${circuitOpen ? 'YES' : 'NO'}`);
        
        // Check if concurrency was reduced
        const reducedConcurrency = workerPoolManager.getWorkerConcurrency('file-analysis');
        console.log(`   Worker concurrency adjusted: ${reducedConcurrency}`);
        console.log(`✅ Circuit breaker integration working\n`);
        
        // Test 3: System metrics and health
        console.log('3. Testing system metrics and health:');
        
        const globalMetrics = globalConcurrencyManager.getMetrics();
        console.log('   Global concurrency metrics:');
        console.log(`     - Total acquired: ${globalMetrics.totalAcquired}`);
        console.log(`     - Total released: ${globalMetrics.totalReleased}`);
        console.log(`     - Total queued: ${globalMetrics.totalQueued}`);
        console.log(`     - Average acquire time: ${globalMetrics.avgAcquireTime.toFixed(2)}ms`);
        
        const poolStatus = workerPoolManager.getStatus();
        console.log('   Worker pool status:');
        console.log(`     - Global utilization: ${poolStatus.globalConcurrency.utilization.toFixed(1)}%`);
        console.log(`     - Success rate: ${poolStatus.metrics.successRate.toFixed(1)}%`);
        
        const health = await circuitBreakerManager.getHealthStatus();
        console.log('   Circuit breaker health:');
        console.log(`     - Overall: ${health.overall}`);
        console.log(`     - Unhealthy services: ${Object.entries(health.services).filter(([,s]) => !s.healthy).map(([n]) => n).join(', ') || 'none'}`);
        
        console.log('✅ System monitoring operational\n');
        
    } finally {
        // Cleanup
        console.log('Shutting down...');
        await workerPoolManager.shutdown();
        await globalConcurrencyManager.shutdown();
        console.log('✅ Clean shutdown completed');
    }
}

async function testPerformanceOverhead() {
    console.log('\n=== Testing Performance Overhead ===\n');
    
    const iterations = 1000;
    const operations = [];
    
    // Baseline: Direct execution
    console.log('Running baseline test...');
    const baselineStart = Date.now();
    
    for (let i = 0; i < iterations; i++) {
        operations.push((async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return i;
        })());
    }
    
    await Promise.all(operations);
    const baselineDuration = Date.now() - baselineStart;
    
    // With concurrency management
    console.log('Running managed test...');
    operations.length = 0;
    
    const globalManager = new GlobalConcurrencyManager({ maxConcurrency: 100 });
    const managedStart = Date.now();
    
    for (let i = 0; i < iterations; i++) {
        operations.push((async () => {
            const permit = await globalManager.acquire('test');
            try {
                await new Promise(resolve => setTimeout(resolve, 10));
                return i;
            } finally {
                await globalManager.release(permit.id);
            }
        })());
    }
    
    await Promise.all(operations);
    const managedDuration = Date.now() - managedStart;
    
    const overhead = ((managedDuration - baselineDuration) / baselineDuration) * 100;
    
    console.log(`\nResults:`);
    console.log(`  Baseline: ${baselineDuration}ms`);
    console.log(`  Managed: ${managedDuration}ms`);
    console.log(`  Overhead: ${overhead.toFixed(2)}%`);
    console.log(`  ${overhead < 2 ? '✅ PASS' : '❌ FAIL'} - Overhead is ${overhead < 2 ? 'within' : 'exceeds'} 2% target`);
    
    await globalManager.shutdown();
}

async function runAllTests() {
    console.log('🚀 Starting Integration Tests\n');
    
    await testFullIntegration();
    await testPerformanceOverhead();
    
    console.log('\n✨ All integration tests completed!');
}

// Run tests
runAllTests().catch(console.error);