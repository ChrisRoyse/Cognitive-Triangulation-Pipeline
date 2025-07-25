/**
 * Reliability Monitoring Example
 * 
 * This example demonstrates how to use the ReliabilityMonitor
 * to track system health and receive alerts about reliability issues.
 */

const { ReliabilityMonitor } = require('../src/utils/reliabilityMonitor');
const { WorkerPoolManager } = require('../src/utils/workerPoolManager');

// Example function that demonstrates reliability monitoring
async function demonstrateReliabilityMonitoring() {
    console.log('🔍 Starting Reliability Monitoring Example');
    
    // Initialize reliability monitor with custom configuration
    const reliabilityMonitor = new ReliabilityMonitor({
        failureRateThreshold: 0.15, // 15% failure rate threshold (higher for demo)
        timeoutThreshold: 10 * 1000, // 10 seconds timeout threshold (lower for demo)
        circuitBreakerAlerts: true,
        slowRecoveryThreshold: 3 * 1000, // 3 seconds (lower for demo)
        criticalRecoveryThreshold: 8 * 1000, // 8 seconds (lower for demo)
        enableDashboardExport: true,
        exportPath: './data/reliability-dashboard-demo.json',
        metricsInterval: 5000, // 5 seconds (faster for demo)
        alertCooldown: 10 * 1000 // 10 seconds cooldown (shorter for demo)
    });
    
    // Set up event listeners
    reliabilityMonitor.on('alert', (alert) => {
        console.log(`🚨 RELIABILITY ALERT [${alert.severity}]: ${alert.type}`);
        console.log(`   Data:`, alert.data);
        console.log(`   Time: ${new Date(alert.timestamp).toISOString()}`);
    });
    
    reliabilityMonitor.on('event', (event) => {
        if (event.type !== 'operation_start' && event.type !== 'operation_success') {
            console.log(`📊 Reliability Event: ${event.type}`, event.data);
        }
    });
    
    reliabilityMonitor.on('dashboardExport', (data) => {
        console.log(`📁 Dashboard data exported to: ${reliabilityMonitor.config.exportPath}`);
        console.log(`   Summary: ${data.summary.totalOperations} ops, ${(data.summary.currentFailureRate * 100).toFixed(1)}% failure rate`);
    });
    
    // Start monitoring
    reliabilityMonitor.start();
    
    // Simulate various reliability scenarios
    console.log('\n🎭 Simulating various reliability scenarios...\n');
    
    // Scenario 1: Normal operations
    console.log('📈 Scenario 1: Normal operations');
    await simulateNormalOperations(reliabilityMonitor);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Scenario 2: Timeout events
    console.log('\n⏰ Scenario 2: Timeout events');
    await simulateTimeoutEvents(reliabilityMonitor);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Scenario 3: Excessive failures
    console.log('\n❌ Scenario 3: Excessive failures');
    await simulateExcessiveFailures(reliabilityMonitor);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Scenario 4: Circuit breaker events
    console.log('\n🔗 Scenario 4: Circuit breaker events');
    await simulateCircuitBreakerEvents(reliabilityMonitor);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Scenario 5: Recovery events
    console.log('\n🔄 Scenario 5: Recovery events');
    await simulateRecoveryEvents(reliabilityMonitor);
    
    // Wait a bit to see final metrics
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Show final status
    console.log('\n📊 Final Reliability Status:');
    const status = reliabilityMonitor.getStatus();
    console.log('   System Metrics:');
    console.log(`     - Total Operations: ${status.metrics.summary.totalOperations}`);
    console.log(`     - Total Failures: ${status.metrics.summary.totalFailures}`);
    console.log(`     - Total Timeouts: ${status.metrics.summary.totalTimeouts}`);
    console.log(`     - Current Failure Rate: ${(status.metrics.summary.currentFailureRate * 100).toFixed(1)}%`);
    console.log(`     - Avg Recovery Time: ${status.metrics.summary.avgRecoveryTime}ms`);
    console.log(`     - Uptime: ${Math.round(status.uptime / 1000)}s`);
    
    console.log('\n   Component Metrics:');
    status.metrics.components.forEach(component => {
        console.log(`     - ${component.name}:`);
        console.log(`       Success: ${component.successfulOperations}, Failed: ${component.failedOperations}`);
        console.log(`       Failure Rate: ${(component.failureRate * 100).toFixed(1)}%`);
        console.log(`       Avg Processing Time: ${component.avgProcessingTime}ms`);
    });
    
    console.log('\n   Circuit Breaker Metrics:');
    status.metrics.circuitBreakers.forEach(cb => {
        console.log(`     - ${cb.name}: ${cb.state} (Opens: ${cb.opens}, Closes: ${cb.closes})`);
    });
    
    console.log('\n   Active Alerts:');
    if (status.metrics.activeAlerts.length === 0) {
        console.log('     - No active alerts');
    } else {
        status.metrics.activeAlerts.forEach(alert => {
            console.log(`     - ${alert.type} (${alert.severity}) - ${new Date(alert.lastTriggered).toISOString()}`);
        });
    }
    
    // Export final dashboard
    const dashboardData = reliabilityMonitor.exportDashboardData();
    console.log(`\n📁 Final dashboard exported to: ${reliabilityMonitor.config.exportPath}`);
    
    // Stop monitoring
    reliabilityMonitor.stop();
    console.log('\n✅ Reliability monitoring example completed!');
}

// Simulate normal operations
async function simulateNormalOperations(monitor) {
    for (let i = 0; i < 10; i++) {
        monitor.recordEvent('operation_start', {
            component: 'example-service',
            operationId: `op-${i}`
        });
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        
        monitor.recordEvent('operation_success', {
            component: 'example-service',
            operationId: `op-${i}`,
            duration: 100 + Math.random() * 200
        });
    }
}

// Simulate timeout events
async function simulateTimeoutEvents(monitor) {
    for (let i = 0; i < 3; i++) {
        monitor.recordEvent('timeout', {
            component: 'slow-service',
            duration: 12000 + Math.random() * 5000, // Over the 10s threshold
            operationId: `slow-op-${i}`
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

// Simulate excessive failures
async function simulateExcessiveFailures(monitor) {
    // Start some operations
    for (let i = 0; i < 5; i++) {
        monitor.recordEvent('operation_start', {
            component: 'failing-service',
            operationId: `fail-op-${i}`
        });
    }
    
    // Fail most of them
    for (let i = 0; i < 4; i++) {
        monitor.recordEvent('operation_failure', {
            component: 'failing-service',
            operationId: `fail-op-${i}`,
            error: 'Simulated failure',
            duration: 1000
        });
        
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Success for one
    monitor.recordEvent('operation_success', {
        component: 'failing-service',
        operationId: 'fail-op-4',
        duration: 800
    });
    
    // This should trigger an excessive failures alert
    monitor.recordEvent('excessive_failures', {
        component: 'failing-service',
        rate: 0.8, // 80% failure rate
        threshold: 0.15
    });
}

// Simulate circuit breaker events
async function simulateCircuitBreakerEvents(monitor) {
    // Circuit breaker opens
    monitor.recordEvent('circuit_breaker_open', {
        circuitBreaker: 'external-api-breaker',
        component: 'external-api',
        failures: 5,
        threshold: 5
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Circuit breaker closes after recovery
    monitor.recordEvent('circuit_breaker_close', {
        circuitBreaker: 'external-api-breaker',
        component: 'external-api',
        timeOpen: 3000
    });
}

// Simulate recovery events
async function simulateRecoveryEvents(monitor) {
    const startTime = Date.now();
    
    // Fast recovery
    await new Promise(resolve => setTimeout(resolve, 2000));
    monitor.recordEvent('recovery', {
        component: 'fast-recovery-service',
        startTime,
        recoveryType: 'automatic'
    });
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Slow recovery (should trigger alert)
    const slowStartTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
    monitor.recordEvent('recovery', {
        component: 'slow-recovery-service',
        startTime: slowStartTime,
        recoveryType: 'manual'
    });
}

// Integration example with WorkerPoolManager
async function demonstrateIntegrationWithWorkerPoolManager() {
    console.log('\n🔗 Demonstrating integration with WorkerPoolManager');
    
    const reliabilityMonitor = new ReliabilityMonitor({
        failureRateThreshold: 0.1,
        circuitBreakerAlerts: true
    });
    
    const workerPoolManager = new WorkerPoolManager({
        environment: 'development',
        maxGlobalConcurrency: 10
    });
    
    // Integrate reliability monitor with worker pool manager
    reliabilityMonitor.setWorkerPoolManager(workerPoolManager);
    
    // Start monitoring
    reliabilityMonitor.start();
    
    // Register some workers
    workerPoolManager.registerWorker('test-worker', { maxConcurrency: 5 });
    
    // Wait a bit for metrics collection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Show collected metrics
    const status = reliabilityMonitor.getStatus();
    console.log('   Integrated Metrics:', {
        components: status.metrics.components.size,
        circuitBreakers: status.metrics.circuitBreakers.size,
        totalOperations: status.metrics.summary.totalOperations
    });
    
    // Cleanup
    reliabilityMonitor.stop();
    await workerPoolManager.shutdown();
    
    console.log('   Integration example completed!');
}

// Run the example
async function main() {
    try {
        await demonstrateReliabilityMonitoring();
        await demonstrateIntegrationWithWorkerPoolManager();
    } catch (error) {
        console.error('❌ Example failed:', error);
        process.exit(1);
    }
}

// Only run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = {
    demonstrateReliabilityMonitoring,
    demonstrateIntegrationWithWorkerPoolManager
};