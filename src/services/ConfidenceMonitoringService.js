const { v4: uuidv4 } = require('uuid');
const { getPerformanceMonitor } = require('../utils/performanceMonitor');
const { getLogger } = require('../config/logging');

/**
 * Production Confidence Monitoring Service
 * 
 * Provides real-time monitoring, metrics collection, and alerting
 * for confidence scoring performance and accuracy.
 */
class ConfidenceMonitoringService {
    constructor(options = {}) {
        this.serviceName = 'ConfidenceMonitoring';
        this.logger = getLogger(this.serviceName);
        this.performanceMonitor = getPerformanceMonitor(this.serviceName);
        
        // Monitoring configuration
        this.config = {
            // Alert thresholds
            alertThresholds: {
                lowConfidenceRate: options.lowConfidenceRate || 0.30,          // >30% low confidence relationships
                escalationRate: options.escalationRate || 0.15,               // >15% escalation rate
                confidenceDropRate: options.confidenceDropRate || 0.25,       // >25% confidence drop
                processingTimeoutMs: options.processingTimeoutMs || 120000,    // 2 minutes
                errorRate: options.errorRate || 0.05                          // >5% error rate
            },
            
            // Metrics collection intervals
            intervals: {
                realTimeMetrics: options.realTimeInterval || 30000,           // 30 seconds
                aggregationInterval: options.aggregationInterval || 300000,    // 5 minutes
                reportingInterval: options.reportingInterval || 900000         // 15 minutes
            },
            
            // Data retention
            retention: {
                realtimeData: options.realtimeRetention || 3600000,           // 1 hour
                aggregatedData: options.aggregatedRetention || 86400000,       // 24 hours
                alertHistory: options.alertRetention || 604800000             // 7 days
            }
        };

        // Monitoring state
        this.metrics = {
            realtime: new Map(),
            aggregated: new Map(),
            alerts: new Map(),
            trends: new Map()
        };

        // Active monitoring intervals
        this.intervals = new Map();
        
        // Alert subscriptions
        this.alertSubscribers = new Set();
        
        console.log('[ConfidenceMonitoringService] Initialized with config:', this.config);
    }

    /**
     * Start monitoring confidence scoring performance
     */
    startMonitoring() {
        console.log('[ConfidenceMonitoringService] Starting confidence monitoring...');
        
        // Real-time metrics collection
        const realTimeInterval = setInterval(() => {
            this.collectRealtimeMetrics();
        }, this.config.intervals.realTimeMetrics);
        this.intervals.set('realtime', realTimeInterval);

        // Aggregated metrics calculation
        const aggregationInterval = setInterval(() => {
            this.calculateAggregatedMetrics();
        }, this.config.intervals.aggregationInterval);
        this.intervals.set('aggregation', aggregationInterval);

        // Periodic reporting
        const reportingInterval = setInterval(() => {
            this.generatePerformanceReport();
        }, this.config.intervals.reportingInterval);
        this.intervals.set('reporting', reportingInterval);

        // Data cleanup
        const cleanupInterval = setInterval(() => {
            this.cleanupOldData();
        }, 600000); // Every 10 minutes
        this.intervals.set('cleanup', cleanupInterval);

        this.logger.info('Confidence monitoring started', {
            intervals: Object.fromEntries(Object.entries(this.config.intervals).map(([k, v]) => [k, `${v}ms`])),
            thresholds: this.config.alertThresholds
        });
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        console.log('[ConfidenceMonitoringService] Stopping confidence monitoring...');
        
        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
        }
        this.intervals.clear();
        
        this.logger.info('Confidence monitoring stopped');
    }

    /**
     * Record confidence scoring event
     */
    recordConfidenceEvent(eventData) {
        const eventId = uuidv4();
        const timestamp = Date.now();
        
        const event = {
            eventId,
            timestamp,
            filePath: eventData.filePath,
            relationshipId: eventData.relationshipId,
            confidenceScore: eventData.confidenceScore,
            confidenceLevel: eventData.confidenceLevel,
            factorScores: eventData.factorScores,
            escalated: eventData.escalated || false,
            processingTimeMs: eventData.processingTimeMs,
            enhancedAnalysis: eventData.enhancedAnalysis || false,
            errors: eventData.errors || []
        };

        // Store in real-time metrics
        this.storeRealtimeEvent(event);
        
        // Check for immediate alerts
        this.checkImmediateAlerts(event);
        
        // Update trend data
        this.updateTrendData(event);

        console.log(`[ConfidenceMonitoringService] Recorded confidence event ${eventId}: score=${event.confidenceScore.toFixed(3)}, level=${event.confidenceLevel}`);
        
        return eventId;
    }

    /**
     * Record enhanced analysis event
     */
    recordEnhancedAnalysisEvent(eventData) {
        const eventId = this.recordConfidenceEvent({
            ...eventData,
            enhancedAnalysis: true
        });

        // Track enhancement effectiveness
        if (eventData.originalScore && eventData.enhancedScore) {
            const improvement = eventData.enhancedScore - eventData.originalScore;
            this.recordEnhancementImprovement(eventData.focusArea, improvement, eventData.processingTimeMs);
        }

        return eventId;
    }

    /**
     * Collect real-time metrics
     */
    collectRealtimeMetrics() {
        const now = Date.now();
        const windowStart = now - this.config.intervals.realTimeMetrics;
        
        // Get events in the current window
        const recentEvents = this.getEventsInWindow(windowStart, now);
        
        if (recentEvents.length === 0) {
            return;
        }

        const metrics = {
            timestamp: now,
            windowSizeMs: this.config.intervals.realTimeMetrics,
            totalEvents: recentEvents.length,
            confidenceDistribution: this.calculateConfidenceDistribution(recentEvents),
            escalationMetrics: this.calculateEscalationMetrics(recentEvents),
            performanceMetrics: this.calculatePerformanceMetrics(recentEvents),
            errorMetrics: this.calculateErrorMetrics(recentEvents),
            enhancementMetrics: this.calculateEnhancementMetrics(recentEvents)
        };

        // Store metrics
        this.metrics.realtime.set(now, metrics);
        
        // Check thresholds and trigger alerts
        this.checkMetricThresholds(metrics);
        
        // Log metrics
        this.logger.logMetrics(metrics);
    }

    /**
     * Calculate aggregated metrics over longer time periods
     */
    calculateAggregatedMetrics() {
        const now = Date.now();
        const windows = [
            { name: '5min', duration: 300000 },
            { name: '15min', duration: 900000 },
            { name: '1hour', duration: 3600000 }
        ];

        for (const window of windows) {
            const windowStart = now - window.duration;
            const events = this.getEventsInWindow(windowStart, now);
            
            if (events.length === 0) continue;

            const aggregated = {
                timestamp: now,
                window: window.name,
                duration: window.duration,
                totalEvents: events.length,
                averageConfidence: this.calculateAverageConfidence(events),
                confidenceHistogram: this.calculateConfidenceHistogram(events),
                escalationAnalysis: this.calculateEscalationAnalysis(events),
                performanceTrends: this.calculatePerformanceTrends(events),
                factorAnalysis: this.calculateFactorAnalysis(events),
                enhancementEffectiveness: this.calculateEnhancementEffectiveness(events)
            };

            this.metrics.aggregated.set(`${window.name}_${now}`, aggregated);
        }
    }

    /**
     * Check immediate alerts for single events
     */
    checkImmediateAlerts(event) {
        const alerts = [];

        // Very low confidence alert
        if (event.confidenceScore < 0.2) {
            alerts.push({
                type: 'VERY_LOW_CONFIDENCE',
                severity: 'HIGH',
                message: `Extremely low confidence score: ${event.confidenceScore.toFixed(3)}`,
                eventId: event.eventId,
                filePath: event.filePath
            });
        }

        // Processing timeout alert
        if (event.processingTimeMs > this.config.alertThresholds.processingTimeoutMs) {
            alerts.push({
                type: 'PROCESSING_TIMEOUT',
                severity: 'MEDIUM',
                message: `Processing timeout: ${event.processingTimeMs}ms > ${this.config.alertThresholds.processingTimeoutMs}ms`,
                eventId: event.eventId,
                processingTime: event.processingTimeMs
            });
        }

        // Error alert
        if (event.errors.length > 0) {
            alerts.push({
                type: 'CONFIDENCE_ERROR',
                severity: 'HIGH',
                message: `Confidence scoring errors: ${event.errors.length} errors`,
                eventId: event.eventId,
                errors: event.errors
            });
        }

        // Trigger alerts
        for (const alert of alerts) {
            this.triggerAlert(alert);
        }
    }

    /**
     * Check metric thresholds and trigger alerts
     */
    checkMetricThresholds(metrics) {
        const alerts = [];

        // Low confidence rate alert
        const lowConfidenceRate = metrics.confidenceDistribution.low / metrics.totalEvents;
        if (lowConfidenceRate > this.config.alertThresholds.lowConfidenceRate) {
            alerts.push({
                type: 'HIGH_LOW_CONFIDENCE_RATE',
                severity: 'MEDIUM',
                message: `High low-confidence rate: ${(lowConfidenceRate * 100).toFixed(1)}% > ${(this.config.alertThresholds.lowConfidenceRate * 100).toFixed(1)}%`,
                metrics: { lowConfidenceRate, totalEvents: metrics.totalEvents }
            });
        }

        // Escalation rate alert
        if (metrics.escalationMetrics.escalationRate > this.config.alertThresholds.escalationRate) {
            alerts.push({
                type: 'HIGH_ESCALATION_RATE',
                severity: 'MEDIUM',
                message: `High escalation rate: ${(metrics.escalationMetrics.escalationRate * 100).toFixed(1)}% > ${(this.config.alertThresholds.escalationRate * 100).toFixed(1)}%`,
                metrics: { escalationRate: metrics.escalationMetrics.escalationRate }
            });
        }

        // Error rate alert
        if (metrics.errorMetrics.errorRate > this.config.alertThresholds.errorRate) {
            alerts.push({
                type: 'HIGH_ERROR_RATE',
                severity: 'HIGH',
                message: `High error rate: ${(metrics.errorMetrics.errorRate * 100).toFixed(1)}% > ${(this.config.alertThresholds.errorRate * 100).toFixed(1)}%`,
                metrics: { errorRate: metrics.errorMetrics.errorRate }
            });
        }

        // Trigger alerts
        for (const alert of alerts) {
            this.triggerAlert(alert);
        }
    }

    /**
     * Generate comprehensive performance report
     */
    generatePerformanceReport() {
        const now = Date.now();
        const reportWindow = 900000; // 15 minutes
        const events = this.getEventsInWindow(now - reportWindow, now);

        if (events.length === 0) {
            this.logger.info('No confidence events in reporting window', { windowMs: reportWindow });
            return;
        }

        const report = {
            timestamp: new Date().toISOString(),
            reportWindow: `${reportWindow / 60000} minutes`,
            summary: {
                totalEvents: events.length,
                averageConfidence: this.calculateAverageConfidence(events),
                totalEscalations: events.filter(e => e.escalated).length,
                totalEnhancements: events.filter(e => e.enhancedAnalysis).length,
                totalErrors: events.reduce((sum, e) => sum + e.errors.length, 0)
            },
            confidenceAnalysis: {
                distribution: this.calculateConfidenceDistribution(events),
                histogram: this.calculateConfidenceHistogram(events),
                trends: this.calculateConfidenceTrends(events)
            },
            performanceAnalysis: {
                averageProcessingTime: this.calculateAverageProcessingTime(events),
                processingTimeDistribution: this.calculateProcessingTimeDistribution(events),
                throughput: events.length / (reportWindow / 60000) // events per minute
            },
            enhancementAnalysis: this.calculateDetailedEnhancementAnalysis(events),
            alertSummary: this.getAlertSummary(now - reportWindow, now),
            recommendations: this.generateRecommendations(events)
        };

        this.logger.info('Confidence monitoring report generated', report);
        
        // Notify subscribers
        this.notifyReportSubscribers(report);
        
        return report;
    }

    /**
     * Subscribe to alerts
     */
    subscribeToAlerts(callback) {
        this.alertSubscribers.add(callback);
        console.log(`[ConfidenceMonitoringService] New alert subscriber added (total: ${this.alertSubscribers.size})`);
    }

    /**
     * Unsubscribe from alerts
     */
    unsubscribeFromAlerts(callback) {
        this.alertSubscribers.delete(callback);
        console.log(`[ConfidenceMonitoringService] Alert subscriber removed (total: ${this.alertSubscribers.size})`);
    }

    /**
     * Get current monitoring dashboard data
     */
    getDashboardData() {
        const now = Date.now();
        const last15Min = this.getEventsInWindow(now - 900000, now);
        const lastHour = this.getEventsInWindow(now - 3600000, now);

        return {
            timestamp: new Date().toISOString(),
            realtime: {
                last15Minutes: {
                    totalEvents: last15Min.length,
                    averageConfidence: this.calculateAverageConfidence(last15Min),
                    escalationRate: last15Min.filter(e => e.escalated).length / Math.max(last15Min.length, 1),
                    errorRate: last15Min.reduce((sum, e) => sum + e.errors.length, 0) / Math.max(last15Min.length, 1)
                }
            },
            trends: {
                lastHour: {
                    confidenceTrend: this.calculateConfidenceTrend(lastHour),
                    escalationTrend: this.calculateEscalationTrend(lastHour),
                    performanceTrend: this.calculatePerformanceTrend(lastHour)
                }
            },
            activeAlerts: this.getActiveAlerts(),
            systemHealth: this.calculateSystemHealth(last15Min)
        };
    }

    // Helper methods for calculations and analysis

    storeRealtimeEvent(event) {
        const key = `event_${event.timestamp}_${event.eventId}`;
        this.metrics.realtime.set(key, event);
    }

    getEventsInWindow(startTime, endTime) {
        const events = [];
        for (const [key, event] of this.metrics.realtime) {
            if (key.startsWith('event_') && event.timestamp >= startTime && event.timestamp <= endTime) {
                events.push(event);
            }
        }
        return events.sort((a, b) => a.timestamp - b.timestamp);
    }

    calculateConfidenceDistribution(events) {
        const distribution = { high: 0, medium: 0, low: 0, veryLow: 0 };
        
        for (const event of events) {
            if (event.confidenceScore >= 0.85) distribution.high++;
            else if (event.confidenceScore >= 0.65) distribution.medium++;
            else if (event.confidenceScore >= 0.45) distribution.low++;
            else distribution.veryLow++;
        }
        
        return distribution;
    }

    calculateEscalationMetrics(events) {
        const escalated = events.filter(e => e.escalated);
        return {
            totalEscalations: escalated.length,
            escalationRate: escalated.length / Math.max(events.length, 1),
            escalationReasons: this.groupEscalationReasons(escalated)
        };
    }

    groupEscalationReasons(escalatedEvents) {
        const reasons = {};
        
        escalatedEvents.forEach(event => {
            const level = event.level || 'UNKNOWN';
            if (!reasons[level]) {
                reasons[level] = 0;
            }
            reasons[level]++;
        });
        
        return reasons;
    }

    calculatePerformanceMetrics(events) {
        const processingTimes = events.map(e => e.processingTimeMs).filter(t => t != null);
        
        if (processingTimes.length === 0) {
            return { average: 0, min: 0, max: 0, p95: 0 };
        }
        
        const sorted = processingTimes.sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        
        return {
            average: processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length,
            min: Math.min(...processingTimes),
            max: Math.max(...processingTimes),
            p95: sorted[p95Index] || sorted[sorted.length - 1]
        };
    }

    calculateErrorMetrics(events) {
        const totalErrors = events.reduce((sum, e) => sum + e.errors.length, 0);
        const eventsWithErrors = events.filter(e => e.errors.length > 0);
        
        return {
            totalErrors,
            errorRate: totalErrors / Math.max(events.length, 1),
            eventsWithErrors: eventsWithErrors.length,
            errorTypes: this.groupErrorTypes(events)
        };
    }

    calculateEnhancementMetrics(events) {
        const enhanced = events.filter(e => e.enhancedAnalysis);
        return {
            totalEnhancements: enhanced.length,
            enhancementRate: enhanced.length / Math.max(events.length, 1),
            averageImprovement: this.calculateAverageImprovement(enhanced)
        };
    }

    triggerAlert(alert) {
        const alertId = uuidv4();
        const alertWithId = {
            ...alert,
            alertId,
            timestamp: new Date().toISOString(),
            acknowledged: false
        };

        this.metrics.alerts.set(alertId, alertWithId);
        
        this.logger.warn(`CONFIDENCE ALERT: ${alert.type}`, alert);
        
        // Notify subscribers
        for (const callback of this.alertSubscribers) {
            try {
                callback(alertWithId);
            } catch (error) {
                this.logger.error('Error notifying alert subscriber', error);
            }
        }
    }

    updateTrendData(event) {
        const trendKey = `trend_${Math.floor(event.timestamp / 60000) * 60000}`; // 1-minute buckets
        
        if (!this.metrics.trends.has(trendKey)) {
            this.metrics.trends.set(trendKey, {
                timestamp: Math.floor(event.timestamp / 60000) * 60000,
                events: [],
                summary: null
            });
        }
        
        this.metrics.trends.get(trendKey).events.push(event);
    }

    recordEnhancementImprovement(focusArea, improvement, processingTime) {
        const key = `enhancement_${focusArea}`;
        if (!this.metrics.realtime.has(key)) {
            this.metrics.realtime.set(key, []);
        }
        
        this.metrics.realtime.get(key).push({
            improvement,
            processingTime,
            timestamp: Date.now()
        });
    }

    cleanupOldData() {
        const now = Date.now();
        
        // Clean realtime data
        for (const [key, data] of this.metrics.realtime) {
            if (key.startsWith('event_') && data.timestamp < now - this.config.retention.realtimeData) {
                this.metrics.realtime.delete(key);
            }
        }
        
        // Clean aggregated data
        for (const [key, data] of this.metrics.aggregated) {
            if (data.timestamp < now - this.config.retention.aggregatedData) {
                this.metrics.aggregated.delete(key);
            }
        }
        
        // Clean alert data
        for (const [key, alert] of this.metrics.alerts) {
            if (new Date(alert.timestamp).getTime() < now - this.config.retention.alertHistory) {
                this.metrics.alerts.delete(key);
            }
        }
    }

    // Additional helper methods...
    calculateAverageConfidence(events) {
        if (events.length === 0) return 0;
        return events.reduce((sum, e) => sum + e.confidenceScore, 0) / events.length;
    }

    generateRecommendations(events) {
        const recommendations = [];
        
        const lowConfidenceRate = events.filter(e => e.confidenceScore < 0.5).length / events.length;
        if (lowConfidenceRate > 0.3) {
            recommendations.push({
                type: 'HIGH_LOW_CONFIDENCE',
                priority: 'HIGH', 
                message: 'Consider adjusting confidence scoring weights or thresholds',
                data: { lowConfidenceRate }
            });
        }
        
        const avgProcessingTime = this.calculateAverageProcessingTime(events);
        if (avgProcessingTime > 5000) {
            recommendations.push({
                type: 'SLOW_PROCESSING',
                priority: 'MEDIUM',
                message: 'Consider optimizing confidence scoring performance',
                data: { avgProcessingTime }
            });
        }
        
        return recommendations;
    }

    calculateAverageProcessingTime(events) {
        const times = events.map(e => e.processingTimeMs).filter(t => t != null);
        if (times.length === 0) return 0;
        return times.reduce((a, b) => a + b, 0) / times.length;
    }

    getActiveAlerts() {
        const activeAlerts = [];
        for (const [id, alert] of this.metrics.alerts) {
            if (!alert.acknowledged) {
                activeAlerts.push(alert);
            }
        }
        return activeAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    calculateSystemHealth(events) {
        if (events.length === 0) return { status: 'UNKNOWN', score: 0 };
        
        const errorRate = this.calculateErrorMetrics(events).errorRate;
        const lowConfidenceRate = events.filter(e => e.confidenceScore < 0.5).length / events.length;
        const escalationRate = events.filter(e => e.escalated).length / events.length;
        
        const healthScore = 1 - (errorRate * 0.5 + lowConfidenceRate * 0.3 + escalationRate * 0.2);
        
        let status = 'HEALTHY';
        if (healthScore < 0.7) status = 'DEGRADED';
        if (healthScore < 0.5) status = 'UNHEALTHY';
        
        return { status, score: Math.max(0, healthScore) };
    }

    notifyReportSubscribers(report) {
        // This could integrate with external monitoring systems
        console.log('[ConfidenceMonitoringService] Performance report available');
    }
}

module.exports = ConfidenceMonitoringService;