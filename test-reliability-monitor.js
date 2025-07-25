#!/usr/bin/env node

/**
 * Quick test script for the ReliabilityMonitor
 * Validates that the reliability monitoring and alerting system works correctly
 */

const { ReliabilityMonitor } = require('./src/utils/reliabilityMonitor');

async function testReliabilityMonitor() {
    console.log('🧪 Testing Reliability Monitor...\n');
    
    // Create monitor with test configuration
    const monitor = new ReliabilityMonitor({
        failureRateThreshold: 0.2, // 20% threshold for testing
        timeoutThreshold: 5 * 1000, // 5 seconds
        circuitBreakerAlerts: true,
        enableDashboardExport: true,
        exportPath: './test-reliability-dashboard.json',
        metricsInterval: 2000, // 2 seconds
        alertCooldown: 3000 // 3 seconds
    });
    
    let alertCount = 0;
    let eventCount = 0;
    
    // Track alerts and events
    monitor.on('alert', (alert) => {
        alertCount++;
        console.log(`🚨 Alert ${alertCount}: ${alert.type} [${alert.severity}]`);
    });
    
    monitor.on('event', (event) => {
        eventCount++;
        if (event.type !== 'operation_start' && event.type !== 'operation_success') {
            console.log(`📊 Event ${eventCount}: ${event.type}`);
        }
    });
    
    // Start monitoring
    monitor.start();
    console.log('✅ Reliability monitor started');
    
    // Test 1: Normal operations
    console.log('\n1️⃣ Testing normal operations...');
    for (let i = 0; i < 5; i++) {
        monitor.recordEvent('operation_start', { component: 'test-service' });
        monitor.recordEvent('operation_success', { component: 'test-service', duration: 100 });
    }
    
    // Test 2: Timeout event
    console.log('\n2️⃣ Testing timeout detection...');
    monitor.recordEvent('timeout', {
        component: 'slow-service',
        duration: 7000, // Above 5s threshold
        threshold: 5000
    });
    
    // Test 3: Excessive failures
    console.log('\n3️⃣ Testing excessive failure detection...');
    for (let i = 0; i < 2; i++) {
        monitor.recordEvent('operation_start', { component: 'failing-service' });
        monitor.recordEvent('operation_failure', { component: 'failing-service', error: 'Test failure' });
    }
    monitor.recordEvent('excessive_failures', {
        component: 'failing-service',
        rate: 0.5, // 50% failure rate
        threshold: 0.2
    });
    
    // Test 4: Circuit breaker events
    console.log('\n4️⃣ Testing circuit breaker events...');
    monitor.recordEvent('circuit_breaker_open', {
        circuitBreaker: 'test-breaker',
        component: 'api-service',
        failures: 5
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // Test 5: Recovery
    console.log('\n5️⃣ Testing recovery events...');
    const startTime = Date.now() - 6000; // 6 seconds ago
    monitor.recordEvent('recovery', {
        component: 'api-service',
        startTime,
        recoveryType: 'automatic'
    });
    
    // Wait for final processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check status
    const status = monitor.getStatus();
    console.log('\n📊 Final Test Results:');
    console.log(`   - Total Events: ${eventCount}`);
    console.log(`   - Total Alerts: ${alertCount}`);
    console.log(`   - Total Operations: ${status.metrics.summary.totalOperations}`);
    console.log(`   - Total Failures: ${status.metrics.summary.totalFailures}`);
    console.log(`   - Total Timeouts: ${status.metrics.summary.totalTimeouts}`);
    console.log(`   - Failure Rate: ${(status.metrics.summary.currentFailureRate * 100).toFixed(1)}%`);
    console.log(`   - Components Tracked: ${status.metrics.components.length}`);
    console.log(`   - Circuit Breakers: ${status.metrics.circuitBreakers.length}`);
    console.log(`   - Active Alerts: ${status.metrics.activeAlerts.length}`);
    
    // Export dashboard data
    const dashboardData = monitor.exportDashboardData();
    console.log(`\n📁 Dashboard data exported: ${dashboardData ? 'Success' : 'Failed'}`);
    
    // Stop monitoring
    monitor.stop();
    console.log('\n✅ Reliability monitor stopped');
    
    // Validate test results
    let testsPassed = 0;
    let testsTotal = 5;
    
    if (alertCount >= 3) {
        console.log('✅ Alert generation: PASS');
        testsPassed++;
    } else {
        console.log('❌ Alert generation: FAIL (expected >= 3 alerts)');
    }
    
    if (status.metrics.summary.totalOperations >= 7) {
        console.log('✅ Operation tracking: PASS');
        testsPassed++;
    } else {
        console.log('❌ Operation tracking: FAIL');
    }
    
    if (status.metrics.summary.totalFailures >= 2) {
        console.log('✅ Failure tracking: PASS');
        testsPassed++;
    } else {
        console.log('❌ Failure tracking: FAIL');
    }
    
    if (status.metrics.summary.totalTimeouts >= 1) {
        console.log('✅ Timeout tracking: PASS');
        testsPassed++;
    } else {
        console.log('❌ Timeout tracking: FAIL');
    }
    
    if (status.metrics.components.length >= 3) {
        console.log('✅ Component tracking: PASS');
        testsPassed++;
    } else {
        console.log('❌ Component tracking: FAIL');
    }
    
    console.log(`\n🎯 Test Summary: ${testsPassed}/${testsTotal} tests passed`);
    
    if (testsPassed === testsTotal) {
        console.log('🎉 All tests passed! Reliability Monitor is working correctly.');
        return true;
    } else {
        console.log('⚠️ Some tests failed. Check the implementation.');
        return false;
    }
}

// Run the test
if (require.main === module) {
    testReliabilityMonitor()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Test failed with error:', error);
            process.exit(1);
        });
}

module.exports = { testReliabilityMonitor };