const { PipelineError } = require('./PipelineError');
const { getLogger } = require('../config/logging');
const fs = require('fs').promises;
const path = require('path');

/**
 * Centralized error reporting and metrics collection service
 */
class ErrorReporter {
    constructor(options = {}) {
        this.logger = getLogger('ErrorReporter');
        this.metricsPath = options.metricsPath || './data/error-metrics.json';
        this.reportPath = options.reportPath || './data/error-reports';
        this.correlationMap = new Map(); // Track error correlations
        this.errorMetrics = {
            totalErrors: 0,
            errorsByType: {},
            errorsByCategory: {},
            errorsBySeverity: {},
            errorsByWorker: {},
            correlationChains: [],
            timeWindows: {
                last5min: [],
                last15min: [],
                lastHour: [],
                last24hours: []
            }
        };
        
        // Ensure directories exist
        this._ensureDirectories();
        
        // Cleanup old metrics periodically
        this._startMetricsCleanup();
    }

    /**
     * Report an error with comprehensive logging and metrics collection
     */
    async reportError(error, additionalContext = {}) {
        let pipelineError;
        
        // Convert to PipelineError if not already
        if (!(error instanceof PipelineError)) {
            pipelineError = new PipelineError({
                type: additionalContext.type || 'UNKNOWN_ERROR',
                message: error.message,
                code: error.code,
                originalError: error,
                ...additionalContext
            });
        } else {
            pipelineError = error;
            // Add any additional context
            if (Object.keys(additionalContext).length > 0) {
                pipelineError.addContext(additionalContext);
            }
        }

        // Update correlation tracking
        this._updateCorrelationTracking(pipelineError);
        
        // Update metrics
        this._updateMetrics(pipelineError);
        
        // Log the error with structured format
        this._logError(pipelineError);
        
        // Save detailed report for critical errors
        if (pipelineError.metrics.severity === 'CRITICAL' || 
            pipelineError.metrics.requiresImmedateAttention) {
            await this._saveDetailedReport(pipelineError);
        }
        
        // Persist metrics
        await this._persistMetrics();
        
        return pipelineError;
    }

    /**
     * Create error correlation between related operations
     */
    correlateErrors(parentErrorId, childError) {
        if (this.correlationMap.has(parentErrorId)) {
            const parentError = this.correlationMap.get(parentErrorId);
            childError.correlateWith(parentError);
        }
        
        this.correlationMap.set(childError.correlationId, childError);
        return childError;
    }

    /**
     * Get error metrics summary
     */
    getMetricsSummary() {
        const now = Date.now();
        const summary = {
            total: this.errorMetrics.totalErrors,
            byCategory: { ...this.errorMetrics.errorsByCategory },
            bySeverity: { ...this.errorMetrics.errorsBySeverity },
            byType: { ...this.errorMetrics.errorsByType },
            byWorker: { ...this.errorMetrics.errorsByWorker },
            recentActivity: {
                last5min: this._getRecentErrorCount(5 * 60 * 1000),
                last15min: this._getRecentErrorCount(15 * 60 * 1000),
                lastHour: this._getRecentErrorCount(60 * 60 * 1000),
                last24hours: this._getRecentErrorCount(24 * 60 * 60 * 1000)
            },
            correlationChains: this.errorMetrics.correlationChains.length,
            timestamp: new Date().toISOString()
        };

        // Calculate error rates
        const timeWindows = [
            { name: 'last5min', duration: 5 * 60 * 1000 },
            { name: 'last15min', duration: 15 * 60 * 1000 },
            { name: 'lastHour', duration: 60 * 60 * 1000 },
            { name: 'last24hours', duration: 24 * 60 * 60 * 1000 }
        ];

        summary.errorRates = {};
        timeWindows.forEach(window => {
            const count = summary.recentActivity[window.name];
            const ratePerMinute = count / (window.duration / 60000);
            summary.errorRates[window.name] = {
                count,
                ratePerMinute: parseFloat(ratePerMinute.toFixed(2))
            };
        });

        return summary;
    }

    /**
     * Get detailed error analysis
     */
    getDetailedAnalysis() {
        const summary = this.getMetricsSummary();
        const analysis = {
            ...summary,
            healthStatus: this._assessSystemHealth(),
            topErrorTypes: this._getTopErrorTypes(5),
            problematicWorkers: this._getProblematicWorkers(),
            criticalCorrelations: this._getCriticalCorrelations(),
            recommendations: this._generateRecommendations()
        };

        return analysis;
    }

    /**
     * Update correlation tracking
     */
    _updateCorrelationTracking(error) {
        this.correlationMap.set(error.correlationId, error);
        
        // Track correlation chains
        if (error.context.errorChain && error.context.errorChain.length > 0) {
            const chain = {
                rootCorrelationId: error.context.errorChain[0].correlationId,
                correlationId: error.correlationId,
                chainLength: error.context.errorChain.length + 1,
                timestamp: error.timestamp,
                severity: error.metrics.severity
            };
            
            this.errorMetrics.correlationChains.push(chain);
            
            // Keep only recent chains (last 24 hours)
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            this.errorMetrics.correlationChains = this.errorMetrics.correlationChains
                .filter(c => new Date(c.timestamp).getTime() > cutoff);
        }
    }

    /**
     * Update error metrics
     */
    _updateMetrics(error) {
        const now = Date.now();
        
        this.errorMetrics.totalErrors++;
        
        // Track by type
        const type = error.type;
        this.errorMetrics.errorsByType[type] = (this.errorMetrics.errorsByType[type] || 0) + 1;
        
        // Track by category
        const category = error.metrics.category;
        this.errorMetrics.errorsByCategory[category] = (this.errorMetrics.errorsByCategory[category] || 0) + 1;
        
        // Track by severity
        const severity = error.metrics.severity;
        this.errorMetrics.errorsBySeverity[severity] = (this.errorMetrics.errorsBySeverity[severity] || 0) + 1;
        
        // Track by worker
        const workerType = error.context.workerType;
        if (workerType) {
            this.errorMetrics.errorsByWorker[workerType] = (this.errorMetrics.errorsByWorker[workerType] || 0) + 1;
        }
        
        // Add to time windows
        const errorRecord = {
            timestamp: now,
            type: error.type,
            category: error.metrics.category,
            severity: error.metrics.severity,
            correlationId: error.correlationId,
            workerId: error.context.workerId,
            workerType: error.context.workerType
        };
        
        Object.keys(this.errorMetrics.timeWindows).forEach(window => {
            this.errorMetrics.timeWindows[window].push(errorRecord);
        });
        
        // Clean old records
        this._cleanOldMetrics();
    }

    /**
     * Log error with structured format
     */
    _logError(error) {
        const logObject = error.toLogObject();
        const actionSuggestions = error.getActionSuggestions();
        
        // Choose log level based on severity
        const logLevel = this._getLogLevel(error.metrics.severity);
        
        this.logger[logLevel]('Pipeline error reported', {
            ...logObject,
            actionSuggestions,
            eventType: 'error-report'
        });
        
        // Also log to console for immediate visibility of critical errors
        if (error.metrics.severity === 'CRITICAL' || error.metrics.requiresImmedateAttention) {
            console.error('🚨 CRITICAL PIPELINE ERROR:', {
                message: error.message,
                type: error.type,
                correlationId: error.correlationId,
                workerId: error.context.workerId,
                jobId: error.context.jobId,
                actionSuggestions: actionSuggestions.slice(0, 3) // Show top 3 suggestions
            });
        }
    }

    /**
     * Save detailed error report for critical errors
     */
    async _saveDetailedReport(error) {
        try {
            const reportData = {
                error: error.toLogObject(),
                metrics: error.toMetricsObject(),
                actionSuggestions: error.getActionSuggestions(),
                systemSnapshot: await this._captureSystemSnapshot(),
                correlatedErrors: this._getCorrelatedErrors(error.correlationId),
                timestamp: new Date().toISOString()
            };
            
            const filename = `error-report-${error.correlationId}-${Date.now()}.json`;
            const reportFile = path.join(this.reportPath, filename);
            
            await fs.writeFile(reportFile, JSON.stringify(reportData, null, 2));
            
            this.logger.info('Detailed error report saved', {
                reportFile,
                correlationId: error.correlationId,
                errorType: error.type
            });
        } catch (reportError) {
            this.logger.error('Failed to save detailed error report', {
                error: reportError.message,
                correlationId: error.correlationId
            });
        }
    }

    /**
     * Get recent error count for a time window
     */
    _getRecentErrorCount(windowMs) {
        const cutoff = Date.now() - windowMs;
        return this.errorMetrics.timeWindows.last24hours
            .filter(record => record.timestamp > cutoff).length;
    }

    /**
     * Clean old metrics data
     */
    _cleanOldMetrics() {
        const now = Date.now();
        const windows = {
            last5min: 5 * 60 * 1000,
            last15min: 15 * 60 * 1000,
            lastHour: 60 * 60 * 1000,
            last24hours: 24 * 60 * 60 * 1000
        };
        
        Object.entries(windows).forEach(([window, duration]) => {
            const cutoff = now - duration;
            this.errorMetrics.timeWindows[window] = this.errorMetrics.timeWindows[window]
                .filter(record => record.timestamp > cutoff);
        });
    }

    /**
     * Assess overall system health based on error patterns
     */
    _assessSystemHealth() {
        const recent5min = this._getRecentErrorCount(5 * 60 * 1000);
        const recent15min = this._getRecentErrorCount(15 * 60 * 1000);
        const recentHour = this._getRecentErrorCount(60 * 60 * 1000);
        
        const criticalErrors = this.errorMetrics.errorsBySeverity.CRITICAL || 0;
        const highErrors = this.errorMetrics.errorsBySeverity.HIGH || 0;
        
        // Determine health status
        if (criticalErrors > 0 || recent5min > 10) {
            return {
                status: 'CRITICAL',
                reason: 'Critical errors detected or high error rate in last 5 minutes',
                errorRate5min: recent5min,
                criticalErrors
            };
        } else if (highErrors > 5 || recent15min > 20) {
            return {
                status: 'DEGRADED',
                reason: 'Multiple high-severity errors or elevated error rate',
                errorRate15min: recent15min,
                highErrors
            };
        } else if (recent15min > 5) {
            return {
                status: 'WARNING',
                reason: 'Moderate error rate detected',
                errorRate15min: recent15min
            };
        } else {
            return {
                status: 'HEALTHY',
                reason: 'Error rates within normal limits',
                errorRateHour: recentHour
            };
        }
    }

    /**
     * Get top error types by frequency
     */
    _getTopErrorTypes(limit = 5) {
        return Object.entries(this.errorMetrics.errorsByType)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([type, count]) => ({ type, count }));
    }

    /**
     * Identify problematic workers
     */
    _getProblematicWorkers() {
        const workerErrors = Object.entries(this.errorMetrics.errorsByWorker)
            .sort(([, a], [, b]) => b - a)
            .filter(([, count]) => count > 3); // Workers with more than 3 errors
        
        return workerErrors.map(([workerType, errorCount]) => ({
            workerType,
            errorCount,
            errorRate: errorCount / this.errorMetrics.totalErrors
        }));
    }

    /**
     * Get critical correlation chains
     */
    _getCriticalCorrelations() {
        return this.errorMetrics.correlationChains
            .filter(chain => chain.severity === 'CRITICAL' || chain.chainLength > 3)
            .sort((a, b) => b.chainLength - a.chainLength)
            .slice(0, 10);
    }

    /**
     * Generate system recommendations based on error patterns
     */
    _generateRecommendations() {
        const recommendations = [];
        const health = this._assessSystemHealth();
        const topErrors = this._getTopErrorTypes(3);
        const problematicWorkers = this._getProblematicWorkers();
        
        // Health-based recommendations
        if (health.status === 'CRITICAL') {
            recommendations.push({
                priority: 'CRITICAL',
                category: 'IMMEDIATE_ACTION',
                message: 'System requires immediate attention due to critical errors',
                actions: [
                    'Stop pipeline execution and investigate critical errors',
                    'Check service connectivity and system resources',
                    'Review error correlation chains for root cause analysis'
                ]
            });
        }
        
        // Error pattern recommendations
        if (topErrors.length > 0) {
            const topError = topErrors[0];
            if (topError.type.includes('TIMEOUT')) {
                recommendations.push({
                    priority: 'HIGH',
                    category: 'PERFORMANCE',
                    message: 'High timeout error rate detected',
                    actions: [
                        'Increase timeout values for slow operations',
                        'Check system performance and resource availability',
                        'Consider reducing concurrency to lower system load'
                    ]
                });
            }
            
            if (topError.type.includes('API') || topError.type.includes('RATE_LIMIT')) {
                recommendations.push({
                    priority: 'HIGH',
                    category: 'API_MANAGEMENT',
                    message: 'API-related errors are frequent',
                    actions: [
                        'Implement exponential backoff for API calls',
                        'Review API rate limits and quotas',
                        'Consider reducing API concurrency'
                    ]
                });
            }
        }
        
        // Worker-specific recommendations
        if (problematicWorkers.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'WORKER_HEALTH',
                message: `${problematicWorkers.length} workers showing high error rates`,
                actions: [
                    'Review worker configuration and resource allocation',
                    'Check for worker-specific issues and bottlenecks',
                    'Consider restarting problematic workers'
                ],
                details: problematicWorkers
            });
        }
        
        return recommendations;
    }

    /**
     * Capture system snapshot for error reports
     */
    async _captureSystemSnapshot() {
        try {
            const process = require('process');
            const os = require('os');
            
            return {
                timestamp: new Date().toISOString(),
                process: {
                    pid: process.pid,
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage()
                },
                system: {
                    loadAvg: os.loadavg(),
                    freeMemory: os.freemem(),
                    totalMemory: os.totalmem(),
                    uptime: os.uptime()
                }
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Get correlated errors for a correlation ID
     */
    _getCorrelatedErrors(correlationId) {
        const correlated = [];
        
        for (const [id, error] of this.correlationMap.entries()) {
            if (error.context.parentCorrelationId === correlationId ||
                error.context.errorChain?.some(e => e.correlationId === correlationId)) {
                correlated.push({
                    correlationId: id,
                    type: error.type,
                    timestamp: error.timestamp,
                    severity: error.metrics.severity
                });
            }
        }
        
        return correlated;
    }

    /**
     * Get appropriate log level for error severity
     */
    _getLogLevel(severity) {
        switch (severity) {
            case 'CRITICAL': return 'error';
            case 'HIGH': return 'error';
            case 'MEDIUM': return 'warn';
            case 'LOW': return 'info';
            default: return 'warn';
        }
    }

    /**
     * Ensure required directories exist
     */
    async _ensureDirectories() {
        try {
            await fs.mkdir(path.dirname(this.metricsPath), { recursive: true });
            await fs.mkdir(this.reportPath, { recursive: true });
        } catch (error) {
            this.logger.warn('Failed to create error reporting directories', {
                error: error.message
            });
        }
    }

    /**
     * Persist metrics to disk
     */
    async _persistMetrics() {
        try {
            const metricsData = {
                ...this.errorMetrics,
                lastUpdated: new Date().toISOString()
            };
            
            await fs.writeFile(this.metricsPath, JSON.stringify(metricsData, null, 2));
        } catch (error) {
            this.logger.warn('Failed to persist error metrics', {
                error: error.message
            });
        }
    }

    /**
     * Start periodic metrics cleanup
     */
    _startMetricsCleanup() {
        // Clean up old data every hour
        setInterval(() => {
            this._cleanOldMetrics();
            
            // Clean old correlation map entries (keep last 24 hours)
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            for (const [id, error] of this.correlationMap.entries()) {
                if (new Date(error.timestamp).getTime() < cutoff) {
                    this.correlationMap.delete(id);
                }
            }
        }, 60 * 60 * 1000); // Every hour
    }

    /**
     * Stop the error reporter and cleanup
     */
    async stop() {
        await this._persistMetrics();
        this.logger.info('ErrorReporter stopped and metrics persisted');
    }
}

module.exports = { ErrorReporter };