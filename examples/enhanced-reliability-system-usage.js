/**
 * Enhanced Reliability System Usage Example
 * 
 * This example demonstrates how to integrate the ReliabilityMonitor
 * with the main pipeline to track health improvements and get real-time
 * reliability metrics with configurable alerts.
 */

const { CognitiveTriangulationPipeline } = require('../src/main');
const { ReliabilityMonitor } = require('../src/utils/reliabilityMonitor');
const { WorkerPoolManager } = require('../src/utils/workerPoolManager');

/**
 * Example of integrating reliability monitoring with the main pipeline
 */
async function runPipelineWithReliabilityMonitoring(targetDirectory) {
    console.log('🚀 Starting pipeline with enhanced reliability monitoring...\n');
    
    // Create pipeline instance (reliability monitor is initialized automatically)
    const pipeline = new CognitiveTriangulationPipeline(targetDirectory);
    
    // Set up advanced reliability monitoring event handlers
    setupReliabilityEventHandlers(pipeline.reliabilityMonitor);
    
    try {
        // Run the pipeline with full reliability tracking
        await pipeline.run();
        
        // Get final reliability report
        const reliabilityReport = generateReliabilityReport(pipeline.reliabilityMonitor);
        console.log('\n📊 Final Reliability Report:');
        console.log(reliabilityReport);
        
        return reliabilityReport;
        
    } catch (error) {
        console.error('❌ Pipeline failed:', error);
        
        // Get failure analysis from reliability monitor
        const failureAnalysis = analyzeFailure(pipeline.reliabilityMonitor, error);
        console.log('\n🔍 Failure Analysis:');
        console.log(failureAnalysis);
        
        throw error;
    }
}

/**
 * Set up comprehensive event handlers for reliability monitoring
 */
function setupReliabilityEventHandlers(reliabilityMonitor) {
    // High priority alerts
    reliabilityMonitor.on('alert', (alert) => {
        switch (alert.severity) {
            case 'HIGH':
                console.log(`🚨 HIGH PRIORITY ALERT: ${alert.type}`);
                console.log(`   📋 Details:`, alert.data);
                console.log(`   ⏰ Time: ${new Date(alert.timestamp).toISOString()}`);
                
                // Take immediate action for high priority alerts
                handleHighPriorityAlert(alert, reliabilityMonitor);
                break;
                
            case 'MEDIUM':
                console.log(`⚠️  MEDIUM PRIORITY ALERT: ${alert.type}`);
                console.log(`   📋 Details:`, alert.data);
                break;
                
            case 'LOW':
                console.log(`ℹ️  INFO ALERT: ${alert.type}`);
                console.log(`   📋 Details:`, alert.data);
                break;
        }
    });
    
    // Track significant reliability events
    reliabilityMonitor.on('event', (event) => {
        switch (event.type) {
            case 'timeout':
                console.log(`⏰ Timeout detected: ${event.data.component} (${event.data.duration}ms)`);
                break;
                
            case 'operation_failure':
                console.log(`❌ Operation failed: ${event.data.component} - ${event.data.error}`);
                break;
                
            case 'circuit_breaker_open':
                console.log(`🔗 Circuit breaker opened: ${event.data.circuitBreaker}`);
                break;
                
            case 'circuit_breaker_close':
                console.log(`✅ Circuit breaker recovered: ${event.data.circuitBreaker}`);
                break;
                
            case 'recovery':
                const recoveryTime = event.timestamp - event.data.startTime;
                console.log(`🔄 Recovery completed: ${event.data.component} (${recoveryTime}ms)`);
                break;
        }
    });
    
    // Track dashboard exports
    reliabilityMonitor.on('dashboardExport', (data) => {
        console.log(`📁 Reliability dashboard updated: ${data.summary.totalOperations} total operations`);
        
        // Log any concerning trends
        if (data.summary.currentFailureRate > 0.05) {
            console.log(`⚠️  High failure rate detected: ${(data.summary.currentFailureRate * 100).toFixed(1)}%`);
        }
        
        if (data.summary.avgRecoveryTime > 30000) {
            console.log(`⚠️  Slow recovery times detected: ${(data.summary.avgRecoveryTime / 1000).toFixed(1)}s average`);
        }
    });
    
    // Track monitor lifecycle
    reliabilityMonitor.on('started', () => {
        console.log('📊 Reliability monitoring started');
    });
    
    reliabilityMonitor.on('stopped', () => {
        console.log('📊 Reliability monitoring stopped');
    });
}

/**
 * Handle high priority alerts with immediate action
 */
function handleHighPriorityAlert(alert, reliabilityMonitor) {
    switch (alert.type) {
        case 'failure_rate_threshold_exceeded':
            console.log('🚨 TAKING ACTION: Failure rate exceeded threshold');
            console.log('   - Reducing worker concurrency to prevent cascade failures');
            console.log('   - Enabling defensive mode');
            // In a real system, you would implement actual remediation
            break;
            
        case 'excessive_failures':
            console.log('🚨 TAKING ACTION: Excessive failures detected');
            console.log('   - Investigating component health');
            console.log('   - Potentially restarting failing components');
            break;
            
        case 'critical_recovery_time':
            console.log('🚨 TAKING ACTION: Critical recovery time detected');
            console.log('   - Escalating to operations team');
            console.log('   - Initiating emergency recovery procedures');
            break;
            
        default:
            console.log('🚨 ALERT: Monitoring for escalation');
    }
}

/**
 * Generate comprehensive reliability report
 */
function generateReliabilityReport(reliabilityMonitor) {
    const status = reliabilityMonitor.getStatus();
    const uptime = Date.now() - status.metrics.summary.uptime;
    
    const report = {
        timestamp: new Date().toISOString(),
        uptime: {
            milliseconds: uptime,
            seconds: Math.round(uptime / 1000),
            minutes: Math.round(uptime / 60000),
            hours: Math.round(uptime / 3600000)
        },
        overall: {
            totalOperations: status.metrics.summary.totalOperations,
            totalFailures: status.metrics.summary.totalFailures,
            totalTimeouts: status.metrics.summary.totalTimeouts,
            totalRecoveries: status.metrics.summary.totalRecoveries,
            currentFailureRate: (status.metrics.summary.currentFailureRate * 100).toFixed(2) + '%',
            avgRecoveryTime: status.metrics.summary.avgRecoveryTime + 'ms',
            lastIncident: status.metrics.summary.lastIncidentTime 
                ? new Date(status.metrics.summary.lastIncidentTime).toISOString() 
                : 'None'
        },
        healthScore: calculateHealthScore(status),
        components: status.metrics.components.map(component => ({
            name: component.name,
            status: component.failureRate > 0.1 ? 'DEGRADED' : 'HEALTHY',
            metrics: {
                successfulOperations: component.successfulOperations,
                failedOperations: component.failedOperations,
                failureRate: (component.failureRate * 100).toFixed(2) + '%',
                avgProcessingTime: component.avgProcessingTime + 'ms',
                lastActivity: new Date(component.lastActivity).toISOString()
            }
        })),
        circuitBreakers: status.metrics.circuitBreakers.map(cb => ({
            name: cb.name,
            state: cb.state,
            opens: cb.opens,
            closes: cb.closes,
            reliability: cb.opens === 0 ? 'EXCELLENT' : cb.opens < 3 ? 'GOOD' : 'NEEDS_ATTENTION'
        })),
        alerts: {
            total: status.metrics.activeAlerts.length,
            high: status.metrics.activeAlerts.filter(a => a.severity === 'HIGH').length,
            medium: status.metrics.activeAlerts.filter(a => a.severity === 'MEDIUM').length,
            low: status.metrics.activeAlerts.filter(a => a.severity === 'LOW').length,
            recent: status.metrics.activeAlerts.slice(0, 5)
        }
    };
    
    return report;
}

/**
 * Calculate overall system health score (0-100)
 */
function calculateHealthScore(status) {
    let score = 100;
    
    // Deduct points for failure rate
    const failureRate = status.metrics.summary.currentFailureRate;
    if (failureRate > 0) {
        score -= Math.min(50, failureRate * 500); // Max 50 point deduction
    }
    
    // Deduct points for timeouts
    if (status.metrics.summary.totalTimeouts > 0 && status.metrics.summary.totalOperations > 0) {
        const timeoutRate = status.metrics.summary.totalTimeouts / status.metrics.summary.totalOperations;
        score -= Math.min(30, timeoutRate * 300); // Max 30 point deduction
    }
    
    // Deduct points for slow recovery
    if (status.metrics.summary.avgRecoveryTime > 30000) {
        score -= Math.min(20, (status.metrics.summary.avgRecoveryTime / 1000 - 30) * 2);
    }
    
    // Deduct points for active high-priority alerts
    const highAlerts = status.metrics.activeAlerts.filter(a => a.severity === 'HIGH').length;
    score -= highAlerts * 10; // 10 points per high priority alert
    
    return Math.max(0, Math.round(score));
}

/**
 * Analyze failure using reliability monitoring data
 */
function analyzeFailure(reliabilityMonitor, error) {
    const status = reliabilityMonitor.getStatus();
    
    const analysis = {
        timestamp: new Date().toISOString(),
        errorDetails: {
            message: error.message,
            type: error.name,
            code: error.code,
            phase: error.context?.phase || 'unknown'
        },
        systemState: {
            totalOperations: status.metrics.summary.totalOperations,
            failureRate: (status.metrics.summary.currentFailureRate * 100).toFixed(2) + '%',
            recentEvents: status.metrics.recentEvents?.slice(0, 10) || [],
            activeAlerts: status.metrics.activeAlerts
        },
        componentHealth: status.metrics.components.map(component => ({
            name: component.name,
            status: component.failureRate > 0.1 ? 'UNHEALTHY' : 'HEALTHY',
            failureRate: (component.failureRate * 100).toFixed(2) + '%',
            lastActivity: new Date(component.lastActivity).toISOString()
        })),
        recommendations: generateFailureRecommendations(status, error)
    };
    
    return analysis;
}

/**
 * Generate recommendations based on failure analysis
 */
function generateFailureRecommendations(status, error) {
    const recommendations = [];
    
    // Check for high failure rates
    if (status.metrics.summary.currentFailureRate > 0.1) {
        recommendations.push({
            priority: 'HIGH',
            action: 'Investigate and fix components with high failure rates',
            details: 'System failure rate is above 10% threshold'
        });
    }
    
    // Check for timeout issues
    if (status.metrics.summary.totalTimeouts > 0) {
        recommendations.push({
            priority: 'MEDIUM',
            action: 'Review timeout configurations and system performance',
            details: `${status.metrics.summary.totalTimeouts} timeout events detected`
        });
    }
    
    // Check for circuit breaker issues
    const openBreakers = status.metrics.circuitBreakers.filter(cb => cb.state === 'OPEN');
    if (openBreakers.length > 0) {
        recommendations.push({
            priority: 'HIGH',
            action: 'Investigate and fix issues causing circuit breaker trips',
            details: `${openBreakers.length} circuit breakers are open`
        });
    }
    
    // Error-specific recommendations
    if (error.code === 'PIPELINE_TIMEOUT') {
        recommendations.push({
            priority: 'HIGH',
            action: 'Increase pipeline timeout or optimize processing speed',
            details: 'Pipeline exceeded maximum wait time'
        });
    }
    
    if (error.code === 'EXCESSIVE_FAILURES') {
        recommendations.push({
            priority: 'CRITICAL',
            action: 'Immediate system health investigation required',
            details: 'Failure rate exceeded safety thresholds'
        });
    }
    
    return recommendations;
}

/**
 * Example usage with real pipeline configuration
 */
async function exampleUsage() {
    console.log('📚 Reliability Monitoring Integration Example\n');
    
    // Example 1: Custom reliability configuration
    console.log('1️⃣ Example: Custom reliability configuration');
    
    const customMonitor = new ReliabilityMonitor({
        failureRateThreshold: 0.05, // 5% threshold
        timeoutThreshold: 60 * 1000, // 60 seconds
        circuitBreakerAlerts: true,
        slowRecoveryThreshold: 10 * 1000, // 10 seconds
        criticalRecoveryThreshold: 30 * 1000, // 30 seconds
        enableDashboardExport: true,
        exportPath: './data/custom-reliability-dashboard.json'
    });
    
    console.log('   Custom monitor configured with strict thresholds');
    console.log(`   - Failure rate threshold: 5%`);
    console.log(`   - Timeout threshold: 60 seconds`);
    console.log(`   - Dashboard export: enabled\n`);
    
    // Example 2: Integration with worker pool manager
    console.log('2️⃣ Example: Worker Pool Manager integration');
    
    const workerPool = new WorkerPoolManager({
        environment: 'development',
        maxGlobalConcurrency: 20
    });
    
    customMonitor.setWorkerPoolManager(workerPool);
    console.log('   Reliability monitor integrated with worker pool manager');
    console.log('   - Automatic worker metrics collection enabled');
    console.log('   - Circuit breaker monitoring enabled\n');
    
    // Example 3: Event tracking
    console.log('3️⃣ Example: Manual event tracking');
    
    customMonitor.start();
    
    // Simulate some events
    customMonitor.recordEvent('operation_start', { component: 'example-worker' });
    customMonitor.recordEvent('operation_success', { component: 'example-worker', duration: 150 });
    
    customMonitor.recordEvent('circuit_breaker_open', {
        circuitBreaker: 'example-breaker',
        component: 'example-service',
        failures: 5
    });
    
    // Get status
    const status = customMonitor.getStatus();
    console.log(`   Current status: ${status.metrics.summary.totalOperations} operations tracked`);
    console.log(`   Components: ${status.metrics.components.length} tracked`);
    console.log(`   Circuit breakers: ${status.metrics.circuitBreakers.length} tracked\n`);
    
    // Cleanup
    customMonitor.stop();
    await workerPool.shutdown();
    
    console.log('✅ Example completed successfully!');
}

// Export functions for use in other modules
module.exports = {
    runPipelineWithReliabilityMonitoring,
    setupReliabilityEventHandlers,
    generateReliabilityReport,
    calculateHealthScore,
    analyzeFailure,
    exampleUsage
};

// Run example if called directly
if (require.main === module) {
    exampleUsage().catch(console.error);
}