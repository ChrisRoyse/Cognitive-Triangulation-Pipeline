#!/usr/bin/env node

/**
 * Monitoring Integration for Data Consistency Production Deployment
 * 
 * Provides comprehensive monitoring, alerting, and dashboard capabilities:
 * - Real-time data consistency health metrics
 * - Integrity violation detection and alerting
 * - Performance monitoring for validation processes
 * - Dashboard creation for deployment status
 * - Integration with existing monitoring infrastructure
 * - Automated escalation and recovery triggers
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');

class MonitoringIntegration extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            // Core Configuration
            environment: options.environment || process.env.NODE_ENV || 'production',
            dbPath: options.dbPath || config.SQLITE_DB_PATH,
            
            // Monitoring Configuration
            metricsCollection: {
                interval: options.metricsInterval || 30000, // 30 seconds
                retention: options.metricsRetention || 24 * 60 * 60 * 1000, // 24 hours
                batchSize: options.metricsBatchSize || 100
            },
            
            // Health Check Configuration
            healthChecks: {
                interval: options.healthCheckInterval || 60000, // 1 minute
                timeout: options.healthCheckTimeout || 10000, // 10 seconds
                criticalThreshold: options.criticalThreshold || 3, // consecutive failures
                warningThreshold: options.warningThreshold || 2
            },
            
            // Alert Configuration
            alerts: {
                enabled: options.alertsEnabled !== false,
                emailEnabled: options.emailAlertsEnabled || false,
                slackEnabled: options.slackAlertsEnabled || false,
                webhookUrl: options.webhookUrl || process.env.MONITORING_WEBHOOK_URL,
                cooldownPeriod: options.alertCooldown || 300000, // 5 minutes
                escalationTime: options.escalationTime || 900000 // 15 minutes
            },
            
            // Performance Thresholds
            thresholds: {
                dataConsistency: {
                    maxOrphanedRelationships: options.maxOrphanedRels || 0,
                    maxInconsistentConfidence: options.maxInconsistentConf || 5,
                    maxMissingEvidence: options.maxMissingEvidence || 10,
                    maxDuplicateSemanticIds: options.maxDuplicateIds || 5
                },
                performance: {
                    maxValidationTime: options.maxValidationTime || 60000, // 1 minute
                    maxQueryTime: options.maxQueryTime || 5000, // 5 seconds
                    maxMemoryUsage: options.maxMemoryUsage || 512 * 1024 * 1024, // 512MB
                    maxCpuUsage: options.maxCpuUsage || 80 // 80%
                },
                database: {
                    maxConnections: options.maxConnections || 50,
                    maxLockWaitTime: options.maxLockWaitTime || 10000, // 10 seconds
                    maxTransactionTime: options.maxTransactionTime || 30000 // 30 seconds
                }
            },
            
            // Dashboard Configuration
            dashboard: {
                enabled: options.dashboardEnabled !== false,
                updateInterval: options.dashboardUpdateInterval || 5000, // 5 seconds
                historyLength: options.dashboardHistoryLength || 100,
                exportPath: options.dashboardExportPath || './monitoring-dashboard.html'
            },
            
            ...options
        };
        
        this.state = {
            monitoring: false,
            startTime: Date.now(),
            metrics: {
                dataConsistency: {},
                performance: {},
                health: {},
                alerts: []
            },
            alertHistory: [],
            healthStatus: 'UNKNOWN',
            lastHealthCheck: null,
            consecutiveFailures: 0,
            dashboardData: []
        };
        
        this.timers = {
            metricsCollection: null,
            healthCheck: null,
            dashboardUpdate: null,
            alertCleanup: null
        };
        
        this.alertCooldowns = new Map();
        
        console.log('📊 Monitoring Integration initialized');
    }

    /**
     * Start comprehensive monitoring
     */
    async startMonitoring() {
        if (this.state.monitoring) {
            console.log('⚠️  Monitoring already running');
            return;
        }
        
        this.state.monitoring = true;
        this.state.startTime = Date.now();
        
        console.log('🚀 Starting comprehensive monitoring...');
        
        try {
            // Initialize monitoring components
            await this.initializeMetricsCollection();
            await this.initializeHealthChecks();
            await this.initializeDashboard();
            await this.initializeAlertSystem();
            
            // Start monitoring loops
            this.startMetricsCollection();
            this.startHealthChecks();
            this.startDashboardUpdates();
            this.startAlertCleanup();
            
            this.emit('monitoring:started', {
                timestamp: Date.now(),
                environment: this.config.environment
            });
            
            console.log('✅ Monitoring started successfully');
            
        } catch (error) {
            console.error('❌ Failed to start monitoring:', error.message);
            this.state.monitoring = false;
            throw error;
        }
    }

    /**
     * Stop monitoring and cleanup
     */
    async stopMonitoring() {
        if (!this.state.monitoring) {
            return;
        }
        
        console.log('🛑 Stopping monitoring...');
        
        this.state.monitoring = false;
        
        // Clear all timers
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
        
        // Export final dashboard
        if (this.config.dashboard.enabled) {
            await this.exportDashboard();
        }
        
        // Generate monitoring report
        await this.generateMonitoringReport();
        
        this.emit('monitoring:stopped', {
            timestamp: Date.now(),
            duration: Date.now() - this.state.startTime
        });
        
        console.log('✅ Monitoring stopped');
    }

    /**
     * Initialize metrics collection system
     */
    async initializeMetricsCollection() {
        console.log('📈 Initializing metrics collection...');
        
        // Validate database connectivity
        await this.validateDatabaseConnection();
        
        // Initialize metrics storage
        this.state.metrics = {
            dataConsistency: {
                orphanedRelationships: 0,
                inconsistentConfidence: 0,
                missingEvidence: 0,
                duplicateSemanticIds: 0,
                validatedRelationships: 0,
                totalRelationships: 0,
                lastCheck: null
            },
            performance: {
                validationTime: 0,
                averageQueryTime: 0,
                memoryUsage: 0,
                cpuUsage: 0,
                lastCheck: null
            },
            health: {
                status: 'UNKNOWN',
                uptime: 0,
                lastHealthCheck: null,
                consecutiveFailures: 0,
                lastError: null
            },
            alerts: []
        };
        
        console.log('✅ Metrics collection initialized');
    }

    /**
     * Start metrics collection loop
     */
    startMetricsCollection() {
        this.timers.metricsCollection = setInterval(async () => {
            try {
                await this.collectDataConsistencyMetrics();
                await this.collectPerformanceMetrics();
                await this.checkThresholds();
                
                this.emit('metrics:collected', {
                    timestamp: Date.now(),
                    metrics: this.state.metrics
                });
                
            } catch (error) {
                console.error('❌ Error collecting metrics:', error.message);
                this.addAlert('METRICS_COLLECTION_ERROR', 'CRITICAL', error.message);
            }
        }, this.config.metricsCollection.interval);
    }

    /**
     * Collect data consistency metrics
     */
    async collectDataConsistencyMetrics() {
        if (!fs.existsSync(this.config.dbPath)) {
            this.state.metrics.dataConsistency.lastCheck = Date.now();
            return;
        }
        
        const db = new Database(this.config.dbPath);
        
        try {
            // Count orphaned relationships
            const orphanedRels = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND (sp.id IS NULL OR tp.id IS NULL)
            `).get();
            
            this.state.metrics.dataConsistency.orphanedRelationships = orphanedRels.count;
            
            // Count relationships with confidence but no evidence
            const inconsistentConfidence = db.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships r 
                LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                WHERE r.confidence > 0 AND re.id IS NULL
            `).get();
            
            this.state.metrics.dataConsistency.inconsistentConfidence = inconsistentConfidence.count;
            
            // Count missing evidence
            const missingEvidence = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE status = 'VALIDATED' AND (evidence IS NULL OR evidence = '')
            `).get();
            
            this.state.metrics.dataConsistency.missingEvidence = missingEvidence.count;
            
            // Count duplicate semantic IDs
            const duplicateIds = db.prepare(`
                SELECT COUNT(*) as duplicate_groups
                FROM (
                    SELECT semantic_id, COUNT(*) as count
                    FROM pois 
                    WHERE semantic_id IS NOT NULL AND semantic_id != ''
                    GROUP BY semantic_id 
                    HAVING COUNT(*) > 1
                )
            `).get();
            
            this.state.metrics.dataConsistency.duplicateSemanticIds = duplicateIds.duplicate_groups || 0;
            
            // Count total and validated relationships
            const relationshipCounts = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'VALIDATED' THEN 1 ELSE 0 END) as validated
                FROM relationships
            `).get();
            
            this.state.metrics.dataConsistency.totalRelationships = relationshipCounts.total || 0;
            this.state.metrics.dataConsistency.validatedRelationships = relationshipCounts.validated || 0;
            
            this.state.metrics.dataConsistency.lastCheck = Date.now();
            
        } finally {
            db.close();
        }
    }

    /**
     * Collect performance metrics
     */
    async collectPerformanceMetrics() {
        const startTime = Date.now();
        
        // Measure validation performance
        try {
            await this.performSampleValidation();
            this.state.metrics.performance.validationTime = Date.now() - startTime;
        } catch (error) {
            this.state.metrics.performance.validationTime = -1; // Error indicator
        }
        
        // Collect system metrics
        const memUsage = process.memoryUsage();
        this.state.metrics.performance.memoryUsage = memUsage.heapUsed;
        
        // Estimate CPU usage (simplified)
        const cpuUsage = process.cpuUsage();
        this.state.metrics.performance.cpuUsage = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
        
        this.state.metrics.performance.lastCheck = Date.now();
    }

    /**
     * Perform sample validation for performance measurement
     */
    async performSampleValidation() {
        if (!fs.existsSync(this.config.dbPath)) {
            return;
        }
        
        const db = new Database(this.config.dbPath);
        
        try {
            // Simple validation query
            const queryStart = Date.now();
            db.prepare('SELECT COUNT(*) FROM relationships WHERE status = ?').get('VALIDATED');
            this.state.metrics.performance.averageQueryTime = Date.now() - queryStart;
        } finally {
            db.close();
        }
    }

    /**
     * Check metrics against thresholds and generate alerts
     */
    async checkThresholds() {
        const { thresholds } = this.config;
        const { dataConsistency, performance } = this.state.metrics;
        
        // Data consistency threshold checks
        if (dataConsistency.orphanedRelationships > thresholds.dataConsistency.maxOrphanedRelationships) {
            this.addAlert(
                'ORPHANED_RELATIONSHIPS',
                'CRITICAL',
                `Found ${dataConsistency.orphanedRelationships} orphaned relationships (max: ${thresholds.dataConsistency.maxOrphanedRelationships})`
            );
        }
        
        if (dataConsistency.inconsistentConfidence > thresholds.dataConsistency.maxInconsistentConfidence) {
            this.addAlert(
                'INCONSISTENT_CONFIDENCE',
                'HIGH',
                `Found ${dataConsistency.inconsistentConfidence} relationships with confidence but no evidence (max: ${thresholds.dataConsistency.maxInconsistentConfidence})`
            );
        }
        
        if (dataConsistency.missingEvidence > thresholds.dataConsistency.maxMissingEvidence) {
            this.addAlert(
                'MISSING_EVIDENCE',
                'MEDIUM',
                `Found ${dataConsistency.missingEvidence} validated relationships without evidence (max: ${thresholds.dataConsistency.maxMissingEvidence})`
            );
        }
        
        if (dataConsistency.duplicateSemanticIds > thresholds.dataConsistency.maxDuplicateSemanticIds) {
            this.addAlert(
                'DUPLICATE_SEMANTIC_IDS',
                'MEDIUM',
                `Found ${dataConsistency.duplicateSemanticIds} groups of duplicate semantic IDs (max: ${thresholds.dataConsistency.maxDuplicateSemanticIds})`
            );
        }
        
        // Performance threshold checks
        if (performance.validationTime > thresholds.performance.maxValidationTime) {
            this.addAlert(
                'SLOW_VALIDATION',
                'HIGH',
                `Validation took ${performance.validationTime}ms (max: ${thresholds.performance.maxValidationTime}ms)`
            );
        }
        
        if (performance.averageQueryTime > thresholds.performance.maxQueryTime) {
            this.addAlert(
                'SLOW_QUERIES',
                'MEDIUM',
                `Average query time ${performance.averageQueryTime}ms (max: ${thresholds.performance.maxQueryTime}ms)`
            );
        }
        
        if (performance.memoryUsage > thresholds.performance.maxMemoryUsage) {
            this.addAlert(
                'HIGH_MEMORY_USAGE',
                'HIGH',
                `Memory usage ${Math.round(performance.memoryUsage / 1024 / 1024)}MB (max: ${Math.round(thresholds.performance.maxMemoryUsage / 1024 / 1024)}MB)`
            );
        }
    }

    /**
     * Add alert with cooldown management
     */
    addAlert(type, severity, message) {
        const now = Date.now();
        const cooldownKey = `${type}_${severity}`;
        
        // Check cooldown
        if (this.alertCooldowns.has(cooldownKey)) {
            const lastAlert = this.alertCooldowns.get(cooldownKey);
            if (now - lastAlert < this.config.alerts.cooldownPeriod) {
                return; // Skip alert due to cooldown
            }
        }
        
        const alert = {
            id: this.generateAlertId(),
            type,
            severity,
            message,
            timestamp: now,
            environment: this.config.environment,
            acknowledged: false,
            resolved: false
        };
        
        this.state.metrics.alerts.push(alert);
        this.state.alertHistory.push(alert);
        this.alertCooldowns.set(cooldownKey, now);
        
        console.log(`🚨 ${severity} Alert: ${type} - ${message}`);
        
        this.emit('alert:triggered', alert);
        
        // Send external alerts if configured
        if (this.config.alerts.enabled) {
            this.sendExternalAlert(alert);
        }
    }

    /**
     * Send external alert notifications
     */
    async sendExternalAlert(alert) {
        try {
            if (this.config.alerts.webhookUrl) {
                await this.sendWebhookAlert(alert);
            }
            
            // Add other notification methods here (email, Slack, etc.)
            
        } catch (error) {
            console.error('❌ Failed to send external alert:', error.message);
        }
    }

    /**
     * Send webhook alert
     */
    async sendWebhookAlert(alert) {
        const https = require('https');
        const url = require('url');
        
        const webhookUrl = new URL(this.config.alerts.webhookUrl);
        const payload = JSON.stringify({
            alert_type: alert.type,
            severity: alert.severity,
            message: alert.message,
            timestamp: new Date(alert.timestamp).toISOString(),
            environment: alert.environment,
            deployment_monitoring: true
        });
        
        const options = {
            hostname: webhookUrl.hostname,
            port: webhookUrl.port || 443,
            path: webhookUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                } else {
                    reject(new Error(`Webhook request failed with status ${res.statusCode}`));
                }
            });
            
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }

    /**
     * Initialize health check system
     */
    async initializeHealthChecks() {
        console.log('🏥 Initializing health checks...');
        
        this.state.healthStatus = 'INITIALIZING';
        this.state.consecutiveFailures = 0;
        
        console.log('✅ Health checks initialized');
    }

    /**
     * Start health check loop
     */
    startHealthChecks() {
        this.timers.healthCheck = setInterval(async () => {
            try {
                await this.performHealthCheck();
            } catch (error) {
                console.error('❌ Health check error:', error.message);
                this.handleHealthCheckFailure(error);
            }
        }, this.config.healthChecks.interval);
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck() {
        const healthCheckStart = Date.now();
        let healthStatus = 'HEALTHY';
        const issues = [];
        
        try {
            // Database connectivity check
            await this.checkDatabaseHealth();
            
            // Data consistency health check
            const consistencyIssues = await this.checkDataConsistencyHealth();
            if (consistencyIssues.length > 0) {
                issues.push(...consistencyIssues);
                if (consistencyIssues.some(issue => issue.severity === 'CRITICAL')) {
                    healthStatus = 'CRITICAL';
                } else if (healthStatus === 'HEALTHY') {
                    healthStatus = 'WARNING';
                }
            }
            
            // Performance health check
            const performanceIssues = await this.checkPerformanceHealth();
            if (performanceIssues.length > 0) {
                issues.push(...performanceIssues);
                if (performanceIssues.some(issue => issue.severity === 'CRITICAL')) {
                    healthStatus = 'CRITICAL';
                } else if (healthStatus === 'HEALTHY') {
                    healthStatus = 'WARNING';
                }
            }
            
            // Update health state
            this.state.healthStatus = healthStatus;
            this.state.lastHealthCheck = Date.now();
            this.state.consecutiveFailures = 0;
            
            this.state.metrics.health = {
                status: healthStatus,
                uptime: Date.now() - this.state.startTime,
                lastHealthCheck: this.state.lastHealthCheck,
                consecutiveFailures: this.state.consecutiveFailures,
                issues: issues,
                checkDuration: Date.now() - healthCheckStart
            };
            
            this.emit('health:checked', this.state.metrics.health);
            
            if (healthStatus !== 'HEALTHY') {
                console.log(`⚠️  Health status: ${healthStatus} (${issues.length} issues)`);
            }
            
        } catch (error) {
            this.handleHealthCheckFailure(error);
        }
    }

    /**
     * Handle health check failure
     */
    handleHealthCheckFailure(error) {
        this.state.consecutiveFailures++;
        this.state.healthStatus = 'CRITICAL';
        this.state.lastHealthCheck = Date.now();
        
        this.state.metrics.health.lastError = error.message;
        this.state.metrics.health.consecutiveFailures = this.state.consecutiveFailures;
        
        if (this.state.consecutiveFailures >= this.config.healthChecks.criticalThreshold) {
            this.addAlert(
                'HEALTH_CHECK_FAILURE',
                'CRITICAL',
                `${this.state.consecutiveFailures} consecutive health check failures: ${error.message}`
            );
        }
        
        this.emit('health:failure', {
            consecutiveFailures: this.state.consecutiveFailures,
            error: error.message
        });
    }

    /**
     * Check database health
     */
    async checkDatabaseHealth() {
        if (!fs.existsSync(this.config.dbPath)) {
            throw new Error('Database file does not exist');
        }
        
        const db = new Database(this.config.dbPath);
        
        try {
            // Basic connectivity test
            db.prepare('SELECT 1').get();
            
            // Integrity check
            const integrityResult = db.pragma('integrity_check');
            if (integrityResult[0] && integrityResult[0].integrity_check !== 'ok') {
                throw new Error('Database integrity check failed');
            }
            
        } finally {
            db.close();
        }
    }

    /**
     * Check data consistency health
     */
    async checkDataConsistencyHealth() {
        const issues = [];
        const { dataConsistency } = this.state.metrics;
        const { thresholds } = this.config;
        
        if (dataConsistency.orphanedRelationships > 0) {
            issues.push({
                type: 'ORPHANED_RELATIONSHIPS',
                severity: dataConsistency.orphanedRelationships > thresholds.dataConsistency.maxOrphanedRelationships ? 'CRITICAL' : 'WARNING',
                count: dataConsistency.orphanedRelationships
            });
        }
        
        if (dataConsistency.inconsistentConfidence > thresholds.dataConsistency.maxInconsistentConfidence) {
            issues.push({
                type: 'INCONSISTENT_CONFIDENCE',
                severity: 'HIGH',
                count: dataConsistency.inconsistentConfidence
            });
        }
        
        return issues;
    }

    /**
     * Check performance health
     */
    async checkPerformanceHealth() {
        const issues = [];
        const { performance } = this.state.metrics;
        const { thresholds } = this.config;
        
        if (performance.validationTime > thresholds.performance.maxValidationTime) {
            issues.push({
                type: 'SLOW_VALIDATION',
                severity: 'HIGH',
                value: performance.validationTime
            });
        }
        
        if (performance.memoryUsage > thresholds.performance.maxMemoryUsage) {
            issues.push({
                type: 'HIGH_MEMORY_USAGE',
                severity: 'CRITICAL',
                value: performance.memoryUsage
            });
        }
        
        return issues;
    }

    /**
     * Initialize dashboard system
     */
    async initializeDashboard() {
        if (!this.config.dashboard.enabled) {
            return;
        }
        
        console.log('📊 Initializing dashboard...');
        
        this.state.dashboardData = [];
        
        console.log('✅ Dashboard initialized');
    }

    /**
     * Start dashboard updates
     */
    startDashboardUpdates() {
        if (!this.config.dashboard.enabled) {
            return;
        }
        
        this.timers.dashboardUpdate = setInterval(() => {
            this.updateDashboard();
        }, this.config.dashboard.updateInterval);
    }

    /**
     * Update dashboard data
     */
    updateDashboard() {
        const dashboardEntry = {
            timestamp: Date.now(),
            health: this.state.healthStatus,
            metrics: { ...this.state.metrics },
            uptime: Date.now() - this.state.startTime,
            activeAlerts: this.state.metrics.alerts.filter(alert => !alert.resolved).length
        };
        
        this.state.dashboardData.push(dashboardEntry);
        
        // Maintain history length
        if (this.state.dashboardData.length > this.config.dashboard.historyLength) {
            this.state.dashboardData.shift();
        }
        
        this.emit('dashboard:updated', dashboardEntry);
    }

    /**
     * Export dashboard to HTML
     */
    async exportDashboard() {
        if (!this.config.dashboard.enabled) {
            return;
        }
        
        const html = this.generateDashboardHTML();
        fs.writeFileSync(this.config.dashboard.exportPath, html);
        
        console.log(`📊 Dashboard exported to: ${this.config.dashboard.exportPath}`);
    }

    /**
     * Generate dashboard HTML
     */
    generateDashboardHTML() {
        const latestData = this.state.dashboardData[this.state.dashboardData.length - 1] || {};
        const alertsData = this.state.alertHistory.slice(-20); // Last 20 alerts
        
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Data Consistency Monitoring Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .dashboard { max-width: 1200px; margin: 0 auto; }
        .header { background: #333; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .status-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .status-healthy { border-left: 5px solid #4CAF50; }
        .status-warning { border-left: 5px solid #FF9800; }
        .status-critical { border-left: 5px solid #F44336; }
        .metric-value { font-size: 2em; font-weight: bold; margin: 10px 0; }
        .metric-label { color: #666; font-size: 0.9em; }
        .alerts-section { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .alert-item { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .alert-critical { background: #ffebee; border-left: 4px solid #f44336; }
        .alert-high { background: #fff3e0; border-left: 4px solid #ff9800; }
        .alert-medium { background: #e8f5e8; border-left: 4px solid #4caf50; }
        .timestamp { color: #999; font-size: 0.8em; }
        .footer { text-align: center; margin-top: 20px; color: #666; }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🚀 Data Consistency Monitoring Dashboard</h1>
            <p>Environment: ${this.config.environment} | Updated: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="status-grid">
            <div class="status-card status-${this.state.healthStatus.toLowerCase()}">
                <div class="metric-label">Overall Health</div>
                <div class="metric-value">${this.state.healthStatus}</div>
                <div class="timestamp">Last Check: ${latestData.timestamp ? new Date(latestData.timestamp).toLocaleString() : 'Never'}</div>
            </div>
            
            <div class="status-card">
                <div class="metric-label">Orphaned Relationships</div>
                <div class="metric-value">${latestData.metrics?.dataConsistency?.orphanedRelationships || 0}</div>
                <div class="timestamp">Critical threshold: ${this.config.thresholds.dataConsistency.maxOrphanedRelationships}</div>
            </div>
            
            <div class="status-card">
                <div class="metric-label">Inconsistent Confidence</div>
                <div class="metric-value">${latestData.metrics?.dataConsistency?.inconsistentConfidence || 0}</div>
                <div class="timestamp">Max threshold: ${this.config.thresholds.dataConsistency.maxInconsistentConfidence}</div>
            </div>
            
            <div class="status-card">
                <div class="metric-label">Validation Time</div>
                <div class="metric-value">${latestData.metrics?.performance?.validationTime || 0}ms</div>
                <div class="timestamp">Max threshold: ${this.config.thresholds.performance.maxValidationTime}ms</div>
            </div>
            
            <div class="status-card">
                <div class="metric-label">Memory Usage</div>
                <div class="metric-value">${Math.round((latestData.metrics?.performance?.memoryUsage || 0) / 1024 / 1024)}MB</div>
                <div class="timestamp">Max threshold: ${Math.round(this.config.thresholds.performance.maxMemoryUsage / 1024 / 1024)}MB</div>
            </div>
            
            <div class="status-card">
                <div class="metric-label">Active Alerts</div>
                <div class="metric-value">${latestData.activeAlerts || 0}</div>
                <div class="timestamp">Total alerts: ${this.state.alertHistory.length}</div>
            </div>
        </div>
        
        <div class="alerts-section">
            <h3>🚨 Recent Alerts</h3>
            ${alertsData.length === 0 ? '<p>No alerts recorded</p>' : 
                alertsData.map(alert => `
                    <div class="alert-item alert-${alert.severity.toLowerCase()}">
                        <strong>${alert.type}</strong> (${alert.severity})
                        <br>${alert.message}
                        <div class="timestamp">${new Date(alert.timestamp).toLocaleString()}</div>
                    </div>
                `).join('')
            }
        </div>
        
        <div class="footer">
            <p>Monitoring started: ${new Date(this.state.startTime).toLocaleString()}</p>
            <p>Uptime: ${Math.round((Date.now() - this.state.startTime) / 1000 / 60)} minutes</p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Start alert cleanup loop
     */
    startAlertCleanup() {
        this.timers.alertCleanup = setInterval(() => {
            this.cleanupOldAlerts();
        }, 60000); // Every minute
    }

    /**
     * Cleanup old alerts
     */
    cleanupOldAlerts() {
        const now = Date.now();
        const maxAge = this.config.metricsCollection.retention;
        
        // Remove old alerts from active list
        this.state.metrics.alerts = this.state.metrics.alerts.filter(alert => {
            return (now - alert.timestamp) < maxAge;
        });
        
        // Keep alert history but limit size
        if (this.state.alertHistory.length > 1000) {
            this.state.alertHistory = this.state.alertHistory.slice(-500);
        }
    }

    /**
     * Validate database connection
     */
    async validateDatabaseConnection() {
        if (!fs.existsSync(this.config.dbPath)) {
            throw new Error('Database file does not exist');
        }
        
        const db = new Database(this.config.dbPath);
        
        try {
            db.prepare('SELECT 1').get();
        } finally {
            db.close();
        }
    }

    /**
     * Generate monitoring report
     */
    async generateMonitoringReport() {
        const report = {
            monitoringSession: {
                startTime: this.state.startTime,
                endTime: Date.now(),
                duration: Date.now() - this.state.startTime,
                environment: this.config.environment
            },
            finalMetrics: this.state.metrics,
            alertSummary: {
                totalAlerts: this.state.alertHistory.length,
                criticalAlerts: this.state.alertHistory.filter(a => a.severity === 'CRITICAL').length,
                highAlerts: this.state.alertHistory.filter(a => a.severity === 'HIGH').length,
                mediumAlerts: this.state.alertHistory.filter(a => a.severity === 'MEDIUM').length
            },
            healthSummary: {
                finalStatus: this.state.healthStatus,
                maxConsecutiveFailures: Math.max(...this.state.dashboardData.map(d => d.metrics?.health?.consecutiveFailures || 0)),
                avgValidationTime: this.calculateAverageValidationTime()
            },
            recommendations: this.generateRecommendations()
        };
        
        const reportPath = `monitoring-report-${Date.now()}.json`;
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`📄 Monitoring report generated: ${reportPath}`);
        
        return report;
    }

    /**
     * Calculate average validation time
     */
    calculateAverageValidationTime() {
        const validTimes = this.state.dashboardData
            .map(d => d.metrics?.performance?.validationTime)
            .filter(t => t && t > 0);
        
        if (validTimes.length === 0) return 0;
        
        return Math.round(validTimes.reduce((sum, time) => sum + time, 0) / validTimes.length);
    }

    /**
     * Generate recommendations based on monitoring data
     */
    generateRecommendations() {
        const recommendations = [];
        const { metrics } = this.state;
        
        if (metrics.dataConsistency.orphanedRelationships > 0) {
            recommendations.push('Address orphaned relationships to maintain data integrity');
        }
        
        if (metrics.dataConsistency.inconsistentConfidence > 5) {
            recommendations.push('Review confidence scoring logic and evidence collection');
        }
        
        if (this.state.alertHistory.filter(a => a.severity === 'CRITICAL').length > 0) {
            recommendations.push('Investigate and resolve critical alerts to prevent system degradation');
        }
        
        if (metrics.performance.validationTime > 30000) {
            recommendations.push('Consider optimizing validation queries for better performance');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('System monitoring shows healthy operation, continue current practices');
        }
        
        return recommendations;
    }

    /**
     * Generate unique alert ID
     */
    generateAlertId() {
        return `alert-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
}

// CLI interface
if (require.main === module) {
    const monitoring = new MonitoringIntegration();
    
    // Set up event listeners
    monitoring.on('monitoring:started', () => {
        console.log('📊 Monitoring system started');
    });
    
    monitoring.on('alert:triggered', (alert) => {
        console.log(`🚨 Alert: ${alert.severity} - ${alert.type}: ${alert.message}`);
    });
    
    monitoring.on('health:failure', (data) => {
        console.log(`⚠️  Health check failure: ${data.consecutiveFailures} consecutive failures`);
    });
    
    // Start monitoring
    monitoring.startMonitoring()
        .then(() => {
            console.log('✅ Monitoring integration started successfully');
            
            // Handle graceful shutdown
            process.on('SIGINT', async () => {
                console.log('\n🛑 Shutting down monitoring...');
                await monitoring.stopMonitoring();
                process.exit(0);
            });
        })
        .catch((error) => {
            console.error('❌ Failed to start monitoring:', error.message);
            process.exit(1);
        });
}

module.exports = MonitoringIntegration;