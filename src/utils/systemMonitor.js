/**
 * System Monitor - Advanced Resource Monitoring and Performance Analytics
 * 
 * Features:
 * - Real-time CPU, memory, and I/O monitoring
 * - Performance trend analysis
 * - Resource pressure detection
 * - Predictive scaling recommendations
 * - Integration with WorkerPoolManager
 */

const os = require('os');
const { EventEmitter } = require('events');

class SystemMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            // Monitoring intervals
            monitoringInterval: options.monitoringInterval || 5000, // 5 seconds
            reportingInterval: options.reportingInterval || 60000,  // 1 minute
            
            // Thresholds
            cpuWarningThreshold: options.cpuWarningThreshold || 70,
            cpuCriticalThreshold: options.cpuCriticalThreshold || 85,
            memoryWarningThreshold: options.memoryWarningThreshold || 75,
            memoryCriticalThreshold: options.memoryCriticalThreshold || 90,
            
            // History settings
            historySize: options.historySize || 100, // Keep last 100 measurements
            
            // Trend analysis
            trendWindowSize: options.trendWindowSize || 20, // Use last 20 measurements for trends
            
            // Predictive scaling
            enablePredictiveScaling: options.enablePredictiveScaling !== false,
            predictionHorizon: options.predictionHorizon || 300000, // 5 minutes
            
            ...options
        };
        
        // State
        this.monitoring = false;
        this.monitoringTimer = null;
        this.reportingTimer = null;
        
        // Historical data
        this.cpuHistory = [];
        this.memoryHistory = [];
        this.loadHistory = [];
        this.eventHistory = [];
        
        // Performance metrics
        this.metrics = {
            startTime: Date.now(),
            measurementCount: 0,
            lastMeasurement: null,
            alerts: {
                cpu: { count: 0, lastAlert: null },
                memory: { count: 0, lastAlert: null },
                load: { count: 0, lastAlert: null }
            },
            trends: {
                cpu: { direction: 'stable', confidence: 0 },
                memory: { direction: 'stable', confidence: 0 },
                load: { direction: 'stable', confidence: 0 }
            }
        };
        
        // System baseline
        this.systemInfo = this.getSystemInfo();
        this.baseline = null;
        
        console.log('📊 SystemMonitor initialized');
        this.logSystemInfo();
    }

    /**
     * Start system monitoring
     */
    start() {
        if (this.monitoring) {
            console.warn('⚠️  SystemMonitor already monitoring');
            return;
        }
        
        this.monitoring = true;
        
        // Establish baseline
        this.establishBaseline();
        
        // Start monitoring loop
        this.monitoringTimer = setInterval(() => {
            this.collectMetrics();
        }, this.config.monitoringInterval);
        
        // Start reporting loop
        this.reportingTimer = setInterval(() => {
            this.generateReport();
        }, this.config.reportingInterval);
        
        console.log('🚀 SystemMonitor started');
        this.emit('started');
    }

    /**
     * Stop system monitoring
     */
    stop() {
        if (!this.monitoring) {
            return;
        }
        
        this.monitoring = false;
        
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
        }
        
        if (this.reportingTimer) {
            clearInterval(this.reportingTimer);
            this.reportingTimer = null;
        }
        
        console.log('🛑 SystemMonitor stopped');
        this.emit('stopped');
    }

    /**
     * Establish performance baseline
     */
    async establishBaseline() {
        console.log('📏 Establishing performance baseline...');
        
        const samples = [];
        for (let i = 0; i < 10; i++) {
            const sample = await this.takeMeasurement();
            samples.push(sample);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        this.baseline = {
            cpu: this.calculateAverage(samples.map(s => s.cpu.usage)),
            memory: this.calculateAverage(samples.map(s => s.memory.heapUsedPercent)),
            load: this.calculateAverage(samples.map(s => s.system.loadAvg1)),
            timestamp: Date.now()
        };
        
        console.log(`📏 Baseline established - CPU: ${this.baseline.cpu.toFixed(1)}%, Memory: ${this.baseline.memory.toFixed(1)}%, Load: ${this.baseline.load.toFixed(2)}`);
    }

    /**
     * Collect system metrics
     */
    async collectMetrics() {
        try {
            const measurement = await this.takeMeasurement();
            
            // Store in history
            this.addToHistory(this.cpuHistory, { timestamp: measurement.timestamp, value: measurement.cpu.usage });
            this.addToHistory(this.memoryHistory, { timestamp: measurement.timestamp, value: measurement.memory.heapUsedPercent });
            this.addToHistory(this.loadHistory, { timestamp: measurement.timestamp, value: measurement.system.loadAvg1 });
            
            // Update metrics
            this.metrics.measurementCount++;
            this.metrics.lastMeasurement = measurement;
            
            // Analyze trends
            this.analyzeTrends();
            
            // Check thresholds
            this.checkThresholds(measurement);
            
            // Generate predictions if enabled
            if (this.config.enablePredictiveScaling) {
                this.generatePredictions();
            }
            
            // Emit measurement event
            this.emit('measurement', measurement);
            
            return measurement;
            
        } catch (error) {
            console.error('❌ Error collecting metrics:', error);
            this.emit('error', error);
        }
    }

    /**
     * Take a single measurement
     */
    async takeMeasurement() {
        const timestamp = Date.now();
        
        return {
            timestamp,
            cpu: await this.getCpuMetrics(),
            memory: this.getMemoryMetrics(),
            system: this.getSystemMetrics(),
            process: this.getProcessMetrics()
        };
    }

    /**
     * Get CPU metrics with improved accuracy
     */
    async getCpuMetrics() {
        const startTime = process.hrtime.bigint();
        const startUsage = process.cpuUsage();
        
        // Wait for a measurement period
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const endTime = process.hrtime.bigint();
        const endUsage = process.cpuUsage(startUsage);
        
        const elapsedTime = Number(endTime - startTime) / 1e6; // Convert to milliseconds
        const userTime = endUsage.user / 1000; // Convert to milliseconds
        const systemTime = endUsage.system / 1000;
        
        const usage = Math.min(100, ((userTime + systemTime) / elapsedTime) * 100);
        
        return {
            usage: isNaN(usage) ? 0 : usage,
            user: userTime,
            system: systemTime,
            cores: os.cpus().length,
            loadAverage: os.loadavg(),
            efficiency: this.calculateCpuEfficiency(usage)
        };
    }

    /**
     * Calculate CPU efficiency based on load vs cores
     */
    calculateCpuEfficiency(usage) {
        const cores = os.cpus().length;
        const loadAvg1 = os.loadavg()[0];
        
        // Efficiency is how well we're using available cores
        const optimalLoad = cores * 0.8; // 80% of cores is considered optimal
        const efficiency = Math.max(0, Math.min(100, (optimalLoad / loadAvg1) * 100));
        
        return isNaN(efficiency) ? 100 : efficiency;
    }

    /**
     * Get comprehensive memory metrics
     */
    getMemoryMetrics() {
        const memUsage = process.memoryUsage();
        const systemMemory = {
            total: os.totalmem(),
            free: os.freemem(),
            used: os.totalmem() - os.freemem()
        };
        
        // Calculate memory pressure
        const heapPressure = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        const systemPressure = (systemMemory.used / systemMemory.total) * 100;
        const processPressure = (memUsage.rss / systemMemory.total) * 100;
        
        return {
            // Process memory
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            heapUsedPercent: heapPressure,
            external: memUsage.external,
            rss: memUsage.rss,
            arrayBuffers: memUsage.arrayBuffers,
            
            // System memory
            systemTotal: systemMemory.total,
            systemFree: systemMemory.free,
            systemUsed: systemMemory.used,
            systemUsedPercent: systemPressure,
            
            // Pressure indicators
            pressureScore: (heapPressure * 0.5) + (systemPressure * 0.3) + (processPressure * 0.2),
            fragmentationRatio: this.calculateFragmentation(memUsage),
            growthRate: this.calculateMemoryGrowthRate()
        };
    }

    /**
     * Calculate memory fragmentation ratio
     */
    calculateFragmentation(memUsage) {
        if (memUsage.heapTotal === 0) return 0;
        
        // Fragmentation is unused heap space
        const unusedHeap = memUsage.heapTotal - memUsage.heapUsed;
        return (unusedHeap / memUsage.heapTotal) * 100;
    }

    /**
     * Calculate memory growth rate
     */
    calculateMemoryGrowthRate() {
        if (this.memoryHistory.length < 2) return 0;
        
        const recent = this.memoryHistory.slice(-10); // Last 10 measurements
        if (recent.length < 2) return 0;
        
        const first = recent[0].value;
        const last = recent[recent.length - 1].value;
        const timeSpan = recent[recent.length - 1].timestamp - recent[0].timestamp;
        
        // Growth rate per minute
        return ((last - first) / timeSpan) * 60000;
    }

    /**
     * Get system-level metrics
     */
    getSystemMetrics() {
        const loadAvg = os.loadavg();
        
        return {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            uptime: os.uptime(),
            loadAvg1: loadAvg[0],
            loadAvg5: loadAvg[1],
            loadAvg15: loadAvg[2],
            loadPressure: this.calculateLoadPressure(loadAvg[0]),
            cpuCount: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem()
        };
    }

    /**
     * Calculate load pressure based on CPU cores
     */
    calculateLoadPressure(load1) {
        const cores = os.cpus().length;
        return Math.min(100, (load1 / cores) * 100);
    }

    /**
     * Get process-specific metrics
     */
    getProcessMetrics() {
        return {
            pid: process.pid,
            uptime: process.uptime(),
            version: process.version,
            platform: process.platform,
            arch: process.arch,
            activeHandles: process._getActiveHandles ? process._getActiveHandles().length : 0,
            activeRequests: process._getActiveRequests ? process._getActiveRequests().length : 0,
            eventLoopDelay: this.measureEventLoopDelay()
        };
    }

    /**
     * Measure event loop delay
     */
    measureEventLoopDelay() {
        const start = process.hrtime.bigint();
        setImmediate(() => {
            const delay = Number(process.hrtime.bigint() - start) / 1e6; // Convert to milliseconds
            this.lastEventLoopDelay = delay;
        });
        
        return this.lastEventLoopDelay || 0;
    }

    /**
     * Add measurement to history with size limit
     */
    addToHistory(history, measurement) {
        history.push(measurement);
        if (history.length > this.config.historySize) {
            history.shift();
        }
    }

    /**
     * Analyze performance trends
     */
    analyzeTrends() {
        this.metrics.trends.cpu = this.analyzeTrend(this.cpuHistory, 'CPU');
        this.metrics.trends.memory = this.analyzeTrend(this.memoryHistory, 'Memory');
        this.metrics.trends.load = this.analyzeTrend(this.loadHistory, 'Load');
    }

    /**
     * Analyze trend for a specific metric
     */
    analyzeTrend(history, metricName) {
        if (history.length < this.config.trendWindowSize) {
            return { direction: 'insufficient_data', confidence: 0 };
        }
        
        const recent = history.slice(-this.config.trendWindowSize);
        const values = recent.map(item => item.value);
        
        // Calculate linear regression
        const n = values.length;
        const sumX = n * (n - 1) / 2; // Sum of indices
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, idx) => sum + (idx * val), 0);
        const sumX2 = n * (n - 1) * (2 * n - 1) / 6; // Sum of squares
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const correlation = this.calculateCorrelation(values);
        
        // Determine trend direction
        let direction = 'stable';
        if (Math.abs(slope) > 0.1) { // Threshold for significant change
            direction = slope > 0 ? 'increasing' : 'decreasing';
        }
        
        // Confidence based on correlation strength
        const confidence = Math.abs(correlation) * 100;
        
        return { direction, confidence, slope, correlation };
    }

    /**
     * Calculate correlation coefficient
     */
    calculateCorrelation(values) {
        const n = values.length;
        const indices = Array.from({ length: n }, (_, i) => i);
        
        const meanX = indices.reduce((sum, val) => sum + val, 0) / n;
        const meanY = values.reduce((sum, val) => sum + val, 0) / n;
        
        const numerator = indices.reduce((sum, x, i) => {
            return sum + (x - meanX) * (values[i] - meanY);
        }, 0);
        
        const denomX = Math.sqrt(indices.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0));
        const denomY = Math.sqrt(values.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0));
        
        return denomX * denomY === 0 ? 0 : numerator / (denomX * denomY);
    }

    /**
     * Check thresholds and trigger alerts
     */
    checkThresholds(measurement) {
        const now = Date.now();
        
        // CPU threshold checks
        this.checkCpuThresholds(measurement.cpu, now);
        
        // Memory threshold checks
        this.checkMemoryThresholds(measurement.memory, now);
        
        // Load threshold checks
        this.checkLoadThresholds(measurement.system, now);
    }

    /**
     * Check CPU thresholds
     */
    checkCpuThresholds(cpu, timestamp) {
        if (cpu.usage >= this.config.cpuCriticalThreshold) {
            this.triggerAlert('cpu', 'critical', cpu.usage, timestamp, {
                cores: cpu.cores,
                loadAvg: cpu.loadAverage[0],
                efficiency: cpu.efficiency
            });
        } else if (cpu.usage >= this.config.cpuWarningThreshold) {
            this.triggerAlert('cpu', 'warning', cpu.usage, timestamp, {
                cores: cpu.cores,
                loadAvg: cpu.loadAverage[0],
                efficiency: cpu.efficiency
            });
        }
    }

    /**
     * Check memory thresholds
     */
    checkMemoryThresholds(memory, timestamp) {
        if (memory.heapUsedPercent >= this.config.memoryCriticalThreshold) {
            this.triggerAlert('memory', 'critical', memory.heapUsedPercent, timestamp, {
                heapUsed: memory.heapUsed,
                systemUsed: memory.systemUsedPercent,
                pressureScore: memory.pressureScore,
                growthRate: memory.growthRate
            });
        } else if (memory.heapUsedPercent >= this.config.memoryWarningThreshold) {
            this.triggerAlert('memory', 'warning', memory.heapUsedPercent, timestamp, {
                heapUsed: memory.heapUsed,
                systemUsed: memory.systemUsedPercent,
                pressureScore: memory.pressureScore,
                growthRate: memory.growthRate
            });
        }
    }

    /**
     * Check load thresholds
     */
    checkLoadThresholds(system, timestamp) {
        if (system.loadPressure >= 90) {
            this.triggerAlert('load', 'critical', system.loadPressure, timestamp, {
                loadAvg1: system.loadAvg1,
                loadAvg5: system.loadAvg5,
                cpuCount: system.cpuCount
            });
        } else if (system.loadPressure >= 70) {
            this.triggerAlert('load', 'warning', system.loadPressure, timestamp, {
                loadAvg1: system.loadAvg1,
                loadAvg5: system.loadAvg5,
                cpuCount: system.cpuCount
            });
        }
    }

    /**
     * Trigger an alert with metadata
     */
    triggerAlert(type, level, value, timestamp, metadata = {}) {
        const alert = {
            type,
            level,
            value,
            timestamp,
            metadata,
            id: `${type}-${level}-${timestamp}`
        };
        
        // Update metrics
        this.metrics.alerts[type].count++;
        this.metrics.alerts[type].lastAlert = timestamp;
        
        // Add to event history
        this.addToHistory(this.eventHistory, alert);
        
        // Log alert
        const emoji = level === 'critical' ? '🚨' : '⚠️';
        console.warn(`${emoji} ${type.toUpperCase()} ${level}: ${value.toFixed(1)}%`, metadata);
        
        // Emit alert event
        this.emit('alert', alert);
        
        return alert;
    }

    /**
     * Generate scaling predictions
     */
    generatePredictions() {
        if (this.cpuHistory.length < this.config.trendWindowSize) {
            return null;
        }
        
        const predictions = {
            timestamp: Date.now(),
            horizon: this.config.predictionHorizon,
            cpu: this.predictMetric(this.cpuHistory, 'cpu'),
            memory: this.predictMetric(this.memoryHistory, 'memory'),
            load: this.predictMetric(this.loadHistory, 'load')
        };
        
        // Generate recommendations based on predictions
        predictions.recommendations = this.generateRecommendations(predictions);
        
        this.emit('predictions', predictions);
        
        return predictions;
    }

    /**
     * Predict future value of a metric
     */
    predictMetric(history, metricType) {
        const recent = history.slice(-this.config.trendWindowSize);
        const trend = this.analyzeTrend(history, metricType);
        
        if (trend.confidence < 50) {
            return {
                predicted: recent[recent.length - 1].value,
                confidence: 'low',
                trend: trend.direction
            };
        }
        
        // Simple linear extrapolation
        const timeSteps = this.config.predictionHorizon / this.config.monitoringInterval;
        const currentValue = recent[recent.length - 1].value;
        const predictedValue = currentValue + (trend.slope * timeSteps);
        
        return {
            predicted: Math.max(0, Math.min(100, predictedValue)),
            confidence: trend.confidence > 75 ? 'high' : 'medium',
            trend: trend.direction,
            current: currentValue,
            change: predictedValue - currentValue
        };
    }

    /**
     * Generate scaling recommendations
     */
    generateRecommendations(predictions) {
        const recommendations = [];
        
        // CPU recommendations
        if (predictions.cpu.predicted > this.config.cpuCriticalThreshold && predictions.cpu.confidence !== 'low') {
            recommendations.push({
                type: 'cpu',
                priority: 'high',
                action: 'scale_down',
                reason: `CPU predicted to reach ${predictions.cpu.predicted.toFixed(1)}% in ${this.config.predictionHorizon / 60000} minutes`,
                confidence: predictions.cpu.confidence
            });
        } else if (predictions.cpu.predicted < 30 && predictions.cpu.trend === 'decreasing') {
            recommendations.push({
                type: 'cpu',
                priority: 'low',
                action: 'scale_up',
                reason: `CPU utilization predicted to be low (${predictions.cpu.predicted.toFixed(1)}%)`,
                confidence: predictions.cpu.confidence
            });
        }
        
        // Memory recommendations
        if (predictions.memory.predicted > this.config.memoryCriticalThreshold && predictions.memory.confidence !== 'low') {
            recommendations.push({
                type: 'memory',
                priority: 'critical',
                action: 'scale_down_and_gc',
                reason: `Memory predicted to reach ${predictions.memory.predicted.toFixed(1)}% in ${this.config.predictionHorizon / 60000} minutes`,
                confidence: predictions.memory.confidence
            });
        }
        
        // Load recommendations
        if (predictions.load.predicted > 90 && predictions.load.confidence !== 'low') {
            recommendations.push({
                type: 'load',
                priority: 'high',
                action: 'reduce_concurrency',
                reason: `System load predicted to reach ${predictions.load.predicted.toFixed(1)}%`,
                confidence: predictions.load.confidence
            });
        }
        
        return recommendations;
    }

    /**
     * Generate comprehensive report
     */
    generateReport() {
        const report = this.getReport();
        
        console.log('📊 SystemMonitor Report:');
        console.log(`   CPU: ${report.current.cpu.usage.toFixed(1)}% (avg: ${report.averages.cpu.toFixed(1)}%, trend: ${report.trends.cpu.direction})`);
        console.log(`   Memory: ${report.current.memory.heapUsedPercent.toFixed(1)}% (avg: ${report.averages.memory.toFixed(1)}%, trend: ${report.trends.memory.direction})`);
        console.log(`   Load: ${report.current.system.loadPressure.toFixed(1)}% (${report.current.system.loadAvg1.toFixed(2)} load)`);
        console.log(`   Alerts: CPU(${report.alerts.cpu}), Memory(${report.alerts.memory}), Load(${report.alerts.load})`);
        
        this.emit('report', report);
        
        return report;
    }

    /**
     * Get comprehensive status report
     */
    getReport() {
        const now = Date.now();
        const uptime = now - this.metrics.startTime;
        
        return {
            timestamp: now,
            uptime,
            monitoring: this.monitoring,
            measurements: this.metrics.measurementCount,
            current: this.metrics.lastMeasurement,
            baseline: this.baseline,
            averages: this.calculateAverages(),
            peaks: this.calculatePeaks(),
            trends: this.metrics.trends,
            alerts: {
                cpu: this.metrics.alerts.cpu.count,
                memory: this.metrics.alerts.memory.count,
                load: this.metrics.alerts.load.count
            },
            systemInfo: this.systemInfo,
            predictions: this.config.enablePredictiveScaling ? this.generatePredictions() : null
        };
    }

    /**
     * Calculate metric averages
     */
    calculateAverages() {
        return {
            cpu: this.calculateAverage(this.cpuHistory.map(item => item.value)),
            memory: this.calculateAverage(this.memoryHistory.map(item => item.value)),
            load: this.calculateAverage(this.loadHistory.map(item => item.value))
        };
    }

    /**
     * Calculate metric peaks
     */
    calculatePeaks() {
        return {
            cpu: this.cpuHistory.length > 0 ? Math.max(...this.cpuHistory.map(item => item.value)) : 0,
            memory: this.memoryHistory.length > 0 ? Math.max(...this.memoryHistory.map(item => item.value)) : 0,
            load: this.loadHistory.length > 0 ? Math.max(...this.loadHistory.map(item => item.value)) : 0
        };
    }

    /**
     * Calculate average of array
     */
    calculateAverage(values) {
        return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
    }

    /**
     * Get system information
     */
    getSystemInfo() {
        const cpus = os.cpus();
        
        return {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            cpuModel: cpus[0]?.model || 'Unknown',
            cpuCores: cpus.length,
            totalMemoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 100) / 100,
            startTime: this.metrics.startTime
        };
    }

    /**
     * Log system information
     */
    logSystemInfo() {
        console.log('🖥️  System Information:');
        console.log(`   Platform: ${this.systemInfo.platform} (${this.systemInfo.arch})`);
        console.log(`   CPU: ${this.systemInfo.cpuModel} (${this.systemInfo.cpuCores} cores)`);
        console.log(`   Memory: ${this.systemInfo.totalMemoryGB}GB total`);
        console.log(`   Node.js: ${this.systemInfo.nodeVersion}`);
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const current = this.metrics.lastMeasurement;
            
            if (!current) {
                return {
                    healthy: false,
                    reason: 'No measurements available',
                    timestamp: new Date().toISOString()
                };
            }
            
            const issues = [];
            
            if (current.cpu.usage > this.config.cpuCriticalThreshold) {
                issues.push(`High CPU: ${current.cpu.usage.toFixed(1)}%`);
            }
            
            if (current.memory.heapUsedPercent > this.config.memoryCriticalThreshold) {
                issues.push(`High memory: ${current.memory.heapUsedPercent.toFixed(1)}%`);
            }
            
            if (current.system.loadPressure > 90) {
                issues.push(`High load: ${current.system.loadPressure.toFixed(1)}%`);
            }
            
            return {
                healthy: issues.length === 0,
                issues,
                monitoring: this.monitoring,
                uptime: Date.now() - this.metrics.startTime,
                measurements: this.metrics.measurementCount,
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
     * Shutdown monitoring
     */
    async shutdown() {
        console.log('🛑 Shutting down SystemMonitor...');
        
        this.stop();
        
        // Generate final report
        const finalReport = this.getReport();
        console.log('📋 Final System Report:', {
            uptime: finalReport.uptime,
            measurements: finalReport.measurements,
            averages: finalReport.averages,
            peaks: finalReport.peaks,
            alerts: finalReport.alerts
        });
        
        this.emit('shutdown', finalReport);
        
        console.log('✅ SystemMonitor shutdown complete');
    }
}

module.exports = { SystemMonitor };