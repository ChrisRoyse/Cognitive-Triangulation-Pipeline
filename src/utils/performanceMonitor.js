const { getLogger, getSystemMetrics } = require('../config/logging');
const os = require('os');

/**
 * Performance Monitoring Utility
 * 
 * Provides comprehensive performance monitoring and metric collection
 * that integrates with the centralized logging system.
 */

class PerformanceMonitor {
    constructor(serviceName = 'Pipeline') {
        this.logger = getLogger('PerformanceMonitor', { service: serviceName });
        this.metrics = new Map();
        this.intervals = new Map();
        this.thresholds = {
            memory: {
                heapUsedPercent: 80,
                rssGrowthRate: 50 // MB per minute
            },
            cpu: {
                averagePercent: 70,
                sustained: 300000 // 5 minutes
            },
            eventLoop: {
                delay: 100 // ms
            }
        };
    }

    /**
     * Start monitoring system performance
     */
    startMonitoring(intervalMs = 30000) {
        // System metrics collection
        const systemInterval = setInterval(() => {
            this.collectSystemMetrics();
        }, intervalMs);
        this.intervals.set('system', systemInterval);

        // Event loop monitoring
        this.monitorEventLoop();

        // Memory leak detection
        const memoryInterval = setInterval(() => {
            this.checkMemoryLeaks();
        }, 60000); // Every minute
        this.intervals.set('memory', memoryInterval);

        this.logger.info('Performance monitoring started', {
            systemInterval: intervalMs,
            thresholds: this.thresholds
        });
    }

    /**
     * Stop all monitoring
     */
    stopMonitoring() {
        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
        }
        this.intervals.clear();
        this.logger.info('Performance monitoring stopped');
    }

    /**
     * Collect and log system metrics
     */
    collectSystemMetrics() {
        const metrics = getSystemMetrics();
        
        // Calculate additional metrics
        const cpuUsage = process.cpuUsage();
        const totalCpuTime = cpuUsage.user + cpuUsage.system;
        const cpuPercent = (totalCpuTime / 1000000) / os.cpus().length * 100;
        
        metrics.cpu.percent = cpuPercent;
        metrics.memory.heapUsedPercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;

        // Store for trend analysis
        this.storeMetric('system', metrics);

        // Log metrics
        this.logger.logMetrics(metrics);

        // Check thresholds
        this.checkThresholds(metrics);

        return metrics;
    }

    /**
     * Monitor event loop delay
     */
    monitorEventLoop() {
        let lastCheck = Date.now();
        
        const checkInterval = setInterval(() => {
            const now = Date.now();
            const delay = now - lastCheck - 1000; // Expected vs actual
            
            if (delay > this.thresholds.eventLoop.delay) {
                this.logger.warn('Event loop delay detected', {
                    delay,
                    threshold: this.thresholds.eventLoop.delay
                });
            }
            
            lastCheck = now;
        }, 1000);
        
        this.intervals.set('eventLoop', checkInterval);
    }

    /**
     * Check for potential memory leaks
     */
    checkMemoryLeaks() {
        const history = this.getMetricHistory('system', 10);
        if (history.length < 2) return;

        const oldestMemory = history[0].memory.rss;
        const currentMemory = history[history.length - 1].memory.rss;
        const timeDiff = history[history.length - 1].timestamp - history[0].timestamp;
        const growthRate = ((currentMemory - oldestMemory) / timeDiff) * 60000; // MB per minute

        if (growthRate > this.thresholds.memory.rssGrowthRate) {
            this.logger.error('Potential memory leak detected', null, {
                growthRate: `${growthRate.toFixed(2)} MB/min`,
                threshold: `${this.thresholds.memory.rssGrowthRate} MB/min`,
                currentRSS: currentMemory,
                timeWindow: `${(timeDiff / 60000).toFixed(2)} minutes`
            });
        }
    }

    /**
     * Check if metrics exceed thresholds
     */
    checkThresholds(metrics) {
        // Memory threshold
        if (metrics.memory.heapUsedPercent > this.thresholds.memory.heapUsedPercent) {
            this.logger.warn('High memory usage detected', {
                heapUsedPercent: metrics.memory.heapUsedPercent.toFixed(2),
                threshold: this.thresholds.memory.heapUsedPercent,
                heapUsed: `${metrics.memory.heapUsed} MB`,
                heapTotal: `${metrics.memory.heapTotal} MB`
            });
        }

        // CPU threshold with sustained check
        if (metrics.cpu.percent > this.thresholds.cpu.averagePercent) {
            const highCpuStart = this.metrics.get('highCpuStart');
            if (!highCpuStart) {
                this.metrics.set('highCpuStart', Date.now());
            } else {
                const duration = Date.now() - highCpuStart;
                if (duration > this.thresholds.cpu.sustained) {
                    this.logger.error('Sustained high CPU usage', null, {
                        cpuPercent: metrics.cpu.percent.toFixed(2),
                        duration: `${(duration / 60000).toFixed(2)} minutes`,
                        threshold: this.thresholds.cpu.averagePercent
                    });
                }
            }
        } else {
            this.metrics.delete('highCpuStart');
        }
    }

    /**
     * Track custom operation performance
     */
    trackOperation(operationName, metadata = {}) {
        const startTime = Date.now();
        const startMemory = process.memoryUsage();
        const startCpu = process.cpuUsage();

        return {
            end: (success = true, additionalMetadata = {}) => {
                const duration = Date.now() - startTime;
                const endMemory = process.memoryUsage();
                const endCpu = process.cpuUsage(startCpu);

                const metrics = {
                    operation: operationName,
                    duration,
                    success,
                    memory: {
                        delta: endMemory.heapUsed - startMemory.heapUsed,
                        final: endMemory.heapUsed
                    },
                    cpu: {
                        user: endCpu.user / 1000, // Convert to ms
                        system: endCpu.system / 1000
                    },
                    ...metadata,
                    ...additionalMetadata
                };

                this.storeMetric(`operation:${operationName}`, metrics);
                
                this.logger.info('Operation completed', metrics);

                return metrics;
            }
        };
    }

    /**
     * Store metric for historical analysis
     */
    storeMetric(category, data) {
        const key = `metrics:${category}`;
        if (!this.metrics.has(key)) {
            this.metrics.set(key, []);
        }

        const history = this.metrics.get(key);
        history.push({
            ...data,
            timestamp: Date.now()
        });

        // Keep only last 100 entries
        if (history.length > 100) {
            history.shift();
        }
    }

    /**
     * Get metric history
     */
    getMetricHistory(category, limit = 10) {
        const key = `metrics:${category}`;
        const history = this.metrics.get(key) || [];
        return history.slice(-limit);
    }

    /**
     * Generate performance report
     */
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            system: this.getMetricHistory('system', 1)[0] || {},
            operations: {}
        };

        // Aggregate operation metrics
        for (const [key, history] of this.metrics) {
            if (key.startsWith('metrics:operation:')) {
                const operationName = key.replace('metrics:operation:', '');
                const metrics = history.filter(m => m.timestamp > Date.now() - 3600000); // Last hour
                
                if (metrics.length > 0) {
                    report.operations[operationName] = {
                        count: metrics.length,
                        successRate: (metrics.filter(m => m.success).length / metrics.length) * 100,
                        avgDuration: metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length,
                        maxDuration: Math.max(...metrics.map(m => m.duration)),
                        minDuration: Math.min(...metrics.map(m => m.duration))
                    };
                }
            }
        }

        this.logger.info('Performance report generated', report);
        return report;
    }
}

// Export singleton instance and class
let monitorInstance = null;

function getPerformanceMonitor(serviceName) {
    if (!monitorInstance) {
        monitorInstance = new PerformanceMonitor(serviceName);
    }
    return monitorInstance;
}

module.exports = {
    PerformanceMonitor,
    getPerformanceMonitor
};