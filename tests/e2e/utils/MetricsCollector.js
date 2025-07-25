class MetricsCollector {
    constructor(runId) {
        this.runId = runId;
        this.metrics = {
            stages: [],
            analysisModes: {},
            accuracy: {},
            performance: {},
            escalations: 0,
            totalAnalyses: 0
        };
    }
    
    recordStageCompletion(stage) {
        this.metrics.stages.push({
            name: stage.name,
            duration: stage.duration,
            timestamp: new Date(),
            success: stage.success || true
        });
    }
    
    recordAnalysisMode(mode) {
        this.metrics.analysisModes[mode.type] = (this.metrics.analysisModes[mode.type] || 0) + 1;
        this.metrics.totalAnalyses++;
        
        if (mode.confidence < 0.4) {
            this.metrics.escalations++;
        }
    }
    
    recordAccuracyMetrics(metrics) {
        this.metrics.accuracy = {
            ...this.metrics.accuracy,
            ...metrics,
            timestamp: new Date()
        };
    }
    
    recordPipelineRun(runData) {
        this.metrics.performance = {
            totalDuration: runData.duration,
            stagesCompleted: runData.stages.length,
            peakMemory: runData.performance.peakMemoryUsage,
            avgMemory: runData.performance.avgMemoryUsage,
            cpuUtilization: runData.performance.cpuUtilization
        };
    }
    
    getEscalationRate() {
        return this.metrics.totalAnalyses > 0 
            ? this.metrics.escalations / this.metrics.totalAnalyses 
            : 0;
    }
    
    getAllMetrics() {
        return {
            ...this.metrics,
            escalationRate: this.getEscalationRate(),
            avgStageTime: this.calculateAvgStageTime(),
            modeDistribution: this.getModeDistribution()
        };
    }
    
    calculateAvgStageTime() {
        if (this.metrics.stages.length === 0) return 0;
        const totalTime = this.metrics.stages.reduce((sum, s) => sum + (s.duration || 0), 0);
        return totalTime / this.metrics.stages.length;
    }
    
    getModeDistribution() {
        const total = Object.values(this.metrics.analysisModes).reduce((sum, count) => sum + count, 0);
        const distribution = {};
        
        for (const [mode, count] of Object.entries(this.metrics.analysisModes)) {
            distribution[mode] = {
                count,
                percentage: total > 0 ? (count / total) * 100 : 0
            };
        }
        
        return distribution;
    }
}

module.exports = { MetricsCollector };