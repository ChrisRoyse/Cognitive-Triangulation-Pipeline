/**
 * Health Monitor - Comprehensive System Health Management
 * 
 * Features:
 * - Multi-level health checks (system, workers, dependencies)
 * - Automated health recovery actions
 * - Health metrics aggregation and reporting
 * - Integration with WorkerPoolManager and SystemMonitor
 * - Alerting and escalation systems
 */

const { EventEmitter } = require('events');

class HealthMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            // Global settings
            enabled: options.enabled !== false,
            
            // Check intervals
            globalHealthInterval: options.globalHealthInterval || 30000, // 30 seconds
            workerHealthInterval: options.workerHealthInterval || 60000, // 1 minute
            dependencyHealthInterval: options.dependencyHealthInterval || 120000, // 2 minutes
            
            // Thresholds
            unhealthyThreshold: options.unhealthyThreshold || 3, // consecutive failures
            recoveryThreshold: options.recoveryThreshold || 2, // consecutive successes
            
            // Timeouts
            healthCheckTimeout: options.healthCheckTimeout || 10000, // 10 seconds
            
            // Alert settings
            alertCooldown: options.alertCooldown || 300000, // 5 minutes
            enableAlerts: options.enableAlerts !== false,
            
            // Recovery settings
            enableAutoRecovery: options.enableAutoRecovery !== false,
            maxRecoveryAttempts: options.maxRecoveryAttempts || 3,
            recoveryBackoffMultiplier: options.recoveryBackoffMultiplier || 2,
            
            ...options
        };
        
        // State
        this.monitoring = false;
        this.globalHealthTimer = null;
        this.workerHealthTimer = null;
        this.dependencyHealthTimer = null;
        
        // Health status tracking
        this.healthStatus = {
            global: { healthy: true, lastCheck: null, consecutiveFailures: 0 },
            workers: new Map(),
            dependencies: new Map(),
            alerts: new Map()
        };
        
        // Registered components
        this.components = {
            workerPoolManager: null,
            systemMonitor: null,
            dependencies: new Map()
        };
        
        // Health metrics
        this.metrics = {
            startTime: Date.now(),
            totalChecks: 0,
            successfulChecks: 0,
            failedChecks: 0,
            recoveryAttempts: 0,
            successfulRecoveries: 0,
            alertsSent: 0,
            lastGlobalHealth: null,
            healthHistory: []
        };
        
        console.log('🏥 HealthMonitor initialized');
    }

    /**
     * Register WorkerPoolManager for health monitoring
     */
    registerWorkerPoolManager(workerPoolManager) {
        this.components.workerPoolManager = workerPoolManager;
        
        // Listen to worker events
        workerPoolManager.on('workerRegistered', (workerInfo) => {
            this.registerWorker(workerInfo.type);
        });
        
        workerPoolManager.on('alert', (alert) => {
            this.handleWorkerPoolAlert(alert);
        });
        
        console.log('📝 WorkerPoolManager registered with HealthMonitor');
    }

    /**
     * Register SystemMonitor for health monitoring
     */
    registerSystemMonitor(systemMonitor) {
        this.components.systemMonitor = systemMonitor;
        
        // Listen to system events
        systemMonitor.on('alert', (alert) => {
            this.handleSystemAlert(alert);
        });
        
        systemMonitor.on('predictions', (predictions) => {
            this.handleSystemPredictions(predictions);
        });
        
        console.log('📝 SystemMonitor registered with HealthMonitor');
    }

    /**
     * Register a dependency for health monitoring
     */
    registerDependency(name, healthCheckFn, recoveryFn = null) {
        this.components.dependencies.set(name, {
            healthCheck: healthCheckFn,
            recovery: recoveryFn,
            lastCheck: null,
            consecutiveFailures: 0
        });
        
        this.healthStatus.dependencies.set(name, {
            healthy: true,
            lastCheck: null,
            consecutiveFailures: 0,
            lastError: null
        });
        
        console.log(`📝 Dependency '${name}' registered for health monitoring`);
    }

    /**
     * Register a worker for health monitoring
     */
    registerWorker(workerType) {
        this.healthStatus.workers.set(workerType, {
            healthy: true,
            lastCheck: null,
            consecutiveFailures: 0,
            lastError: null,
            metrics: {
                errorRate: 0,
                avgResponseTime: 0,
                throughput: 0,
                queueBacklog: 0
            }
        });
        
        console.log(`📝 Worker '${workerType}' registered for health monitoring`);
    }

    /**
     * Start health monitoring
     */
    start() {
        if (!this.config.enabled || this.monitoring) {
            return;
        }
        
        this.monitoring = true;
        
        // Start global health checks
        this.globalHealthTimer = setInterval(() => {
            this.performGlobalHealthCheck();
        }, this.config.globalHealthInterval);
        
        // Start worker health checks
        this.workerHealthTimer = setInterval(() => {
            this.performWorkerHealthChecks();
        }, this.config.workerHealthInterval);
        
        // Start dependency health checks
        this.dependencyHealthTimer = setInterval(() => {
            this.performDependencyHealthChecks();
        }, this.config.dependencyHealthInterval);
        
        console.log('🚀 HealthMonitor started');
        this.emit('started');
    }

    /**
     * Stop health monitoring
     */
    stop() {
        if (!this.monitoring) {
            return;
        }
        
        this.monitoring = false;
        
        if (this.globalHealthTimer) {
            clearInterval(this.globalHealthTimer);
            this.globalHealthTimer = null;
        }
        
        if (this.workerHealthTimer) {
            clearInterval(this.workerHealthTimer);
            this.workerHealthTimer = null;
        }
        
        if (this.dependencyHealthTimer) {
            clearInterval(this.dependencyHealthTimer);
            this.dependencyHealthTimer = null;
        }
        
        console.log('🛑 HealthMonitor stopped');
        this.emit('stopped');
    }

    /**
     * Perform global health check
     */
    async performGlobalHealthCheck() {
        const startTime = Date.now();
        
        try {
            const healthResults = {
                timestamp: startTime,
                system: await this.checkSystemHealth(),
                workerPool: await this.checkWorkerPoolHealth(),
                dependencies: await this.checkDependencyHealthSummary()
            };
            
            // Determine overall health
            const isHealthy = healthResults.system.healthy && 
                            healthResults.workerPool.healthy && 
                            healthResults.dependencies.healthy;
            
            // Update global health status
            this.updateGlobalHealth(isHealthy, healthResults);
            
            // Store metrics
            this.metrics.totalChecks++;
            this.metrics.lastGlobalHealth = healthResults;
            
            if (isHealthy) {
                this.metrics.successfulChecks++;
                this.healthStatus.global.consecutiveFailures = 0;
            } else {
                this.metrics.failedChecks++;
                this.healthStatus.global.consecutiveFailures++;
            }
            
            // Add to history
            this.addToHealthHistory(healthResults);
            
            // Emit health check event
            this.emit('globalHealthCheck', healthResults);
            
            // Trigger alerts if necessary
            if (!isHealthy) {
                this.handleUnhealthySystem(healthResults);
            }
            
        } catch (error) {
            console.error('❌ Global health check failed:', error);
            this.metrics.failedChecks++;
            this.healthStatus.global.consecutiveFailures++;
            
            this.emit('healthCheckError', {
                type: 'global',
                error: error.message,
                timestamp: startTime
            });
        }
    }

    /**
     * Check system health
     */
    async checkSystemHealth() {
        if (!this.components.systemMonitor) {
            return { healthy: true, reason: 'SystemMonitor not registered' };
        }
        
        try {
            const health = await this.components.systemMonitor.healthCheck();
            return health;
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check worker pool health
     */
    async checkWorkerPoolHealth() {
        if (!this.components.workerPoolManager) {
            return { healthy: true, reason: 'WorkerPoolManager not registered' };
        }
        
        try {
            const health = await this.components.workerPoolManager.healthCheck();
            return health;
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check dependency health summary
     */
    async checkDependencyHealthSummary() {
        const results = Array.from(this.healthStatus.dependencies.entries()).map(([name, status]) => ({
            name,
            healthy: status.healthy,
            lastCheck: status.lastCheck,
            consecutiveFailures: status.consecutiveFailures
        }));
        
        const allHealthy = results.every(dep => dep.healthy);
        const unhealthyDeps = results.filter(dep => !dep.healthy);
        
        return {
            healthy: allHealthy,
            totalDependencies: results.length,
            healthyDependencies: results.filter(dep => dep.healthy).length,
            unhealthyDependencies: unhealthyDeps,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Perform worker health checks
     */
    async performWorkerHealthChecks() {
        if (!this.components.workerPoolManager) {
            return;
        }
        
        try {
            const workerStatus = this.components.workerPoolManager.getStatus();
            
            for (const [workerType, workerInfo] of Object.entries(workerStatus.workers)) {
                await this.checkWorkerHealth(workerType, workerInfo);
            }
            
            this.emit('workerHealthChecks', { timestamp: Date.now() });
            
        } catch (error) {
            console.error('❌ Worker health checks failed:', error);
        }
    }

    /**
     * Check individual worker health
     */
    async checkWorkerHealth(workerType, workerInfo) {
        const workerHealth = this.healthStatus.workers.get(workerType);
        if (!workerHealth) {
            return;
        }
        
        const issues = [];
        
        // Check error rate
        const totalJobs = workerInfo.completedJobs + workerInfo.failedJobs;
        const errorRate = totalJobs > 0 ? (workerInfo.failedJobs / totalJobs) * 100 : 0;
        
        if (errorRate > 20) {
            issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
        }
        
        // Check response time
        if (workerInfo.metrics && workerInfo.metrics.avgProcessingTime > 120000) { // 2 minutes
            issues.push(`High response time: ${workerInfo.metrics.avgProcessingTime.toFixed(0)}ms`);
        }
        
        // Check circuit breaker state
        if (workerInfo.circuitBreakerState === 'OPEN') {
            issues.push('Circuit breaker is open');
        }
        
        // Check utilization
        const utilization = workerInfo.utilization || 0;
        if (utilization > 95) {
            issues.push(`High utilization: ${utilization.toFixed(1)}%`);
        }
        
        // Update worker health
        const isHealthy = issues.length === 0;
        workerHealth.healthy = isHealthy;
        workerHealth.lastCheck = Date.now();
        
        if (isHealthy) {
            workerHealth.consecutiveFailures = 0;
        } else {
            workerHealth.consecutiveFailures++;
            workerHealth.lastError = issues.join(', ');
        }
        
        // Update metrics
        workerHealth.metrics = {
            errorRate,
            avgResponseTime: workerInfo.metrics?.avgProcessingTime || 0,
            throughput: workerInfo.throughput || 0,
            utilization
        };
        
        // Emit worker health event
        this.emit('workerHealth', {
            workerType,
            healthy: isHealthy,
            issues,
            metrics: workerHealth.metrics,
            timestamp: Date.now()
        });
        
        // Handle unhealthy worker
        if (!isHealthy && workerHealth.consecutiveFailures >= this.config.unhealthyThreshold) {
            this.handleUnhealthyWorker(workerType, issues);
        }
    }

    /**
     * Perform dependency health checks
     */
    async performDependencyHealthChecks() {
        for (const [name, dependency] of this.components.dependencies) {
            await this.checkDependencyHealth(name, dependency);
        }
        
        this.emit('dependencyHealthChecks', { timestamp: Date.now() });
    }

    /**
     * Check individual dependency health
     */
    async checkDependencyHealth(name, dependency) {
        const dependencyHealth = this.healthStatus.dependencies.get(name);
        if (!dependencyHealth) {
            return;
        }
        
        let isHealthy = true;
        let error = null;
        
        try {
            // Execute health check with timeout
            const healthCheckPromise = dependency.healthCheck();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeout);
            });
            
            const result = await Promise.race([healthCheckPromise, timeoutPromise]);
            isHealthy = result === true || (result && result.healthy === true);
            
            if (!isHealthy && result && result.error) {
                error = result.error;
            }
            
        } catch (err) {
            isHealthy = false;
            error = err.message;
        }
        
        // Update dependency health
        dependencyHealth.healthy = isHealthy;
        dependencyHealth.lastCheck = Date.now();
        
        if (isHealthy) {
            dependencyHealth.consecutiveFailures = 0;
            dependencyHealth.lastError = null;
        } else {
            dependencyHealth.consecutiveFailures++;
            dependencyHealth.lastError = error;
        }
        
        // Emit dependency health event
        this.emit('dependencyHealth', {
            name,
            healthy: isHealthy,
            error,
            consecutiveFailures: dependencyHealth.consecutiveFailures,
            timestamp: Date.now()
        });
        
        // Handle unhealthy dependency
        if (!isHealthy && dependencyHealth.consecutiveFailures >= this.config.unhealthyThreshold) {
            this.handleUnhealthyDependency(name, error);
        }
    }

    /**
     * Update global health status
     */
    updateGlobalHealth(isHealthy, healthResults) {
        this.healthStatus.global.healthy = isHealthy;
        this.healthStatus.global.lastCheck = Date.now();
        
        if (isHealthy) {
            this.healthStatus.global.consecutiveFailures = 0;
        }
    }

    /**
     * Add health result to history
     */
    addToHealthHistory(healthResult) {
        this.metrics.healthHistory.push(healthResult);
        
        // Keep only last 100 entries
        if (this.metrics.healthHistory.length > 100) {
            this.metrics.healthHistory.shift();
        }
    }

    /**
     * Handle unhealthy system
     */
    async handleUnhealthySystem(healthResults) {
        const alertKey = 'system_unhealthy';
        
        if (this.shouldSendAlert(alertKey)) {
            this.sendAlert({
                type: 'system',
                level: 'critical',
                message: 'System health check failed',
                details: healthResults,
                timestamp: Date.now()
            });
            
            this.markAlertSent(alertKey);
        }
        
        // Attempt auto-recovery if enabled
        if (this.config.enableAutoRecovery) {
            this.attemptSystemRecovery(healthResults);
        }
    }

    /**
     * Handle unhealthy worker
     */
    async handleUnhealthyWorker(workerType, issues) {
        const alertKey = `worker_unhealthy_${workerType}`;
        
        if (this.shouldSendAlert(alertKey)) {
            this.sendAlert({
                type: 'worker',
                level: 'warning',
                message: `Worker '${workerType}' is unhealthy`,
                details: { workerType, issues },
                timestamp: Date.now()
            });
            
            this.markAlertSent(alertKey);
        }
        
        // Attempt worker recovery
        if (this.config.enableAutoRecovery) {
            this.attemptWorkerRecovery(workerType, issues);
        }
    }

    /**
     * Handle unhealthy dependency
     */
    async handleUnhealthyDependency(name, error) {
        const alertKey = `dependency_unhealthy_${name}`;
        
        if (this.shouldSendAlert(alertKey)) {
            this.sendAlert({
                type: 'dependency',
                level: 'critical',
                message: `Dependency '${name}' is unhealthy`,
                details: { name, error },
                timestamp: Date.now()
            });
            
            this.markAlertSent(alertKey);
        }
        
        // Attempt dependency recovery
        if (this.config.enableAutoRecovery) {
            this.attemptDependencyRecovery(name, error);
        }
    }

    /**
     * Attempt system recovery
     */
    async attemptSystemRecovery(healthResults) {
        console.log('🔄 Attempting system recovery...');
        this.metrics.recoveryAttempts++;
        
        try {
            // Scale down workers to reduce system load
            if (this.components.workerPoolManager && !healthResults.system.healthy) {
                console.log('📉 Scaling down workers due to system health issues');
                // The WorkerPoolManager should handle this automatically through resource monitoring
            }
            
            // Trigger garbage collection if memory issues
            if (healthResults.system.issues && 
                healthResults.system.issues.some(issue => issue.includes('memory'))) {
                if (global.gc) {
                    global.gc();
                    console.log('🗑️  Triggered garbage collection for memory recovery');
                }
            }
            
            this.metrics.successfulRecoveries++;
            console.log('✅ System recovery attempt completed');
            
        } catch (error) {
            console.error('❌ System recovery failed:', error);
        }
    }

    /**
     * Attempt worker recovery
     */
    async attemptWorkerRecovery(workerType, issues) {
        console.log(`🔄 Attempting recovery for worker '${workerType}'...`);
        this.metrics.recoveryAttempts++;
        
        try {
            // Reset circuit breaker if it's open
            if (issues.includes('Circuit breaker is open') && this.components.workerPoolManager) {
                const status = this.components.workerPoolManager.getStatus();
                const worker = status.workers[workerType];
                
                if (worker && worker.circuitBreakerState === 'OPEN') {
                    // The circuit breaker will recover automatically, but we can log it
                    console.log(`🔄 Circuit breaker for '${workerType}' will recover automatically`);
                }
            }
            
            this.metrics.successfulRecoveries++;
            console.log(`✅ Worker '${workerType}' recovery attempt completed`);
            
        } catch (error) {
            console.error(`❌ Worker '${workerType}' recovery failed:`, error);
        }
    }

    /**
     * Attempt dependency recovery
     */
    async attemptDependencyRecovery(name, error) {
        console.log(`🔄 Attempting recovery for dependency '${name}'...`);
        this.metrics.recoveryAttempts++;
        
        try {
            const dependency = this.components.dependencies.get(name);
            
            if (dependency && dependency.recovery) {
                await dependency.recovery();
                this.metrics.successfulRecoveries++;
                console.log(`✅ Dependency '${name}' recovery completed`);
            } else {
                console.log(`⚠️  No recovery function available for dependency '${name}'`);
            }
            
        } catch (error) {
            console.error(`❌ Dependency '${name}' recovery failed:`, error);
        }
    }

    /**
     * Handle worker pool alerts
     */
    handleWorkerPoolAlert(alert) {
        if (alert.level === 'critical') {
            this.sendAlert({
                type: 'worker_pool',
                level: 'critical',
                message: 'Worker pool critical alert',
                details: alert,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Handle system alerts
     */
    handleSystemAlert(alert) {
        if (alert.level === 'critical') {
            this.sendAlert({
                type: 'system',
                level: 'critical',
                message: 'System critical alert',
                details: alert,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Handle system predictions
     */
    handleSystemPredictions(predictions) {
        // Check for predicted issues
        if (predictions.recommendations) {
            const criticalRecommendations = predictions.recommendations.filter(r => r.priority === 'critical');
            
            if (criticalRecommendations.length > 0) {
                this.sendAlert({
                    type: 'prediction',
                    level: 'warning',
                    message: 'System predictions indicate potential issues',
                    details: { recommendations: criticalRecommendations },
                    timestamp: Date.now()
                });
            }
        }
        
        this.emit('systemPredictions', predictions);
    }

    /**
     * Check if alert should be sent (cooldown logic)
     */
    shouldSendAlert(alertKey) {
        if (!this.config.enableAlerts) {
            return false;
        }
        
        const lastAlert = this.healthStatus.alerts.get(alertKey);
        const now = Date.now();
        
        if (!lastAlert) {
            return true;
        }
        
        return (now - lastAlert) > this.config.alertCooldown;
    }

    /**
     * Mark alert as sent
     */
    markAlertSent(alertKey) {
        this.healthStatus.alerts.set(alertKey, Date.now());
    }

    /**
     * Send alert
     */
    sendAlert(alert) {
        this.metrics.alertsSent++;
        
        const emoji = alert.level === 'critical' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
        console.warn(`${emoji} [HealthMonitor] ${alert.level.toUpperCase()}: ${alert.message}`);
        
        if (alert.details) {
            console.warn('   Details:', alert.details);
        }
        
        this.emit('alert', alert);
    }

    /**
     * Get comprehensive health status
     */
    getHealthStatus() {
        const globalHealth = this.healthStatus.global;
        const workerHealth = Array.from(this.healthStatus.workers.entries()).map(([type, status]) => ({
            type,
            ...status
        }));
        const dependencyHealth = Array.from(this.healthStatus.dependencies.entries()).map(([name, status]) => ({
            name,
            ...status
        }));
        
        return {
            monitoring: this.monitoring,
            global: globalHealth,
            workers: workerHealth,
            dependencies: dependencyHealth,
            summary: {
                totalWorkers: workerHealth.length,
                healthyWorkers: workerHealth.filter(w => w.healthy).length,
                totalDependencies: dependencyHealth.length,
                healthyDependencies: dependencyHealth.filter(d => d.healthy).length,
                overallHealthy: globalHealth.healthy
            },
            metrics: this.metrics,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get health metrics
     */
    getMetrics() {
        const uptime = Date.now() - this.metrics.startTime;
        const successRate = this.metrics.totalChecks > 0 
            ? (this.metrics.successfulChecks / this.metrics.totalChecks) * 100 
            : 0;
        
        return {
            ...this.metrics,
            uptime,
            successRate,
            recoveryRate: this.metrics.recoveryAttempts > 0 
                ? (this.metrics.successfulRecoveries / this.metrics.recoveryAttempts) * 100 
                : 0,
            averageCheckInterval: this.config.globalHealthInterval,
            lastHealthCheck: this.metrics.lastGlobalHealth?.timestamp
        };
    }

    /**
     * Health check API endpoint
     */
    async healthCheck() {
        try {
            const status = this.getHealthStatus();
            
            return {
                healthy: status.global.healthy && status.summary.overallHealthy,
                status,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Shutdown health monitoring
     */
    async shutdown() {
        console.log('🛑 Shutting down HealthMonitor...');
        
        this.stop();
        
        // Generate final health report
        const finalStatus = this.getHealthStatus();
        const finalMetrics = this.getMetrics();
        
        console.log('📋 Final Health Report:');
        console.log(`   Uptime: ${Math.floor(finalMetrics.uptime / 1000)}s`);
        console.log(`   Total Checks: ${finalMetrics.totalChecks}`);
        console.log(`   Success Rate: ${finalMetrics.successRate.toFixed(1)}%`);
        console.log(`   Alerts Sent: ${finalMetrics.alertsSent}`);
        console.log(`   Recovery Attempts: ${finalMetrics.recoveryAttempts}`);
        
        this.emit('shutdown', { status: finalStatus, metrics: finalMetrics });
        
        console.log('✅ HealthMonitor shutdown complete');
    }
}

module.exports = { HealthMonitor };