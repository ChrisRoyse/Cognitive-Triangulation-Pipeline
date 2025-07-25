class PerformanceMonitor {
    constructor() {
        this.monitors = new Map();
        this.snapshots = new Map();
    }
    
    startMonitoring(monitorId) {
        const monitor = {
            id: monitorId,
            startTime: Date.now(),
            startMemory: process.memoryUsage(),
            startCpuUsage: process.cpuUsage(),
            memorySnapshots: [],
            cpuSnapshots: []
        };
        
        this.monitors.set(monitorId, monitor);
        
        // Take periodic snapshots
        monitor.intervalId = setInterval(() => {
            this.takeSnapshot(monitorId);
        }, 1000); // Every second
        
        return monitor;
    }
    
    stopMonitoring(monitorId) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor) return null;
        
        clearInterval(monitor.intervalId);
        
        const endTime = Date.now();
        const endMemory = process.memoryUsage();
        const endCpuUsage = process.cpuUsage(monitor.startCpuUsage);
        
        const metrics = {
            duration: endTime - monitor.startTime,
            peakMemoryUsage: this.calculatePeakMemory(monitor),
            avgMemoryUsage: this.calculateAvgMemory(monitor),
            totalCpuTime: endCpuUsage.user + endCpuUsage.system,
            cpuUtilization: this.calculateCpuUtilization(monitor, endCpuUsage),
            memoryGrowth: endMemory.heapUsed - monitor.startMemory.heapUsed,
            gcPressure: this.calculateGcPressure(monitor)
        };
        
        this.snapshots.set(monitorId, monitor.memorySnapshots);
        this.monitors.delete(monitorId);
        
        return metrics;
    }
    
    takeSnapshot(monitorId) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor) return;
        
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        monitor.memorySnapshots.push({
            timestamp: Date.now(),
            heapUsed: memoryUsage.heapUsed,
            heapTotal: memoryUsage.heapTotal,
            external: memoryUsage.external,
            rss: memoryUsage.rss
        });
        
        monitor.cpuSnapshots.push({
            timestamp: Date.now(),
            user: cpuUsage.user,
            system: cpuUsage.system
        });
        
        // Keep only last 300 snapshots (5 minutes at 1/sec)
        if (monitor.memorySnapshots.length > 300) {
            monitor.memorySnapshots.shift();
            monitor.cpuSnapshots.shift();
        }
    }
    
    calculatePeakMemory(monitor) {
        if (monitor.memorySnapshots.length === 0) {
            return monitor.startMemory.heapUsed;
        }
        
        return Math.max(
            monitor.startMemory.heapUsed,
            ...monitor.memorySnapshots.map(s => s.heapUsed)
        );
    }
    
    calculateAvgMemory(monitor) {
        if (monitor.memorySnapshots.length === 0) {
            return monitor.startMemory.heapUsed;
        }
        
        const totalMemory = monitor.memorySnapshots.reduce(
            (sum, s) => sum + s.heapUsed, 
            monitor.startMemory.heapUsed
        );
        
        return totalMemory / (monitor.memorySnapshots.length + 1);
    }
    
    calculateCpuUtilization(monitor, totalCpuUsage) {
        const elapsedTime = Date.now() - monitor.startTime;
        const cpuTime = totalCpuUsage.user + totalCpuUsage.system;
        
        // CPU utilization as percentage
        return (cpuTime / 1000 / elapsedTime) * 100;
    }
    
    calculateGcPressure(monitor) {
        if (monitor.memorySnapshots.length < 2) return 0;
        
        let gcEvents = 0;
        let previousHeap = monitor.memorySnapshots[0].heapUsed;
        
        for (let i = 1; i < monitor.memorySnapshots.length; i++) {
            const currentHeap = monitor.memorySnapshots[i].heapUsed;
            
            // Detect potential GC event (significant heap reduction)
            if (currentHeap < previousHeap * 0.8) {
                gcEvents++;
            }
            
            previousHeap = currentHeap;
        }
        
        // GC events per minute
        const durationMinutes = (Date.now() - monitor.startTime) / 60000;
        return gcEvents / durationMinutes;
    }
    
    getMemorySnapshots(monitorId) {
        return this.snapshots.get(monitorId) || [];
    }
    
    getPeakMemory(monitorId) {
        const snapshots = this.getMemorySnapshots(monitorId);
        if (snapshots.length === 0) return 0;
        
        return Math.max(...snapshots.map(s => s.heapUsed));
    }
    
    getMemoryProfile(monitorId) {
        const snapshots = this.getMemorySnapshots(monitorId);
        if (snapshots.length === 0) return null;
        
        const profile = {
            samples: snapshots.length,
            peak: Math.max(...snapshots.map(s => s.heapUsed)),
            min: Math.min(...snapshots.map(s => s.heapUsed)),
            avg: snapshots.reduce((sum, s) => sum + s.heapUsed, 0) / snapshots.length,
            trend: this.calculateMemoryTrend(snapshots),
            volatility: this.calculateMemoryVolatility(snapshots)
        };
        
        return profile;
    }
    
    calculateMemoryTrend(snapshots) {
        if (snapshots.length < 2) return 'stable';
        
        const firstQuarter = snapshots.slice(0, Math.floor(snapshots.length / 4));
        const lastQuarter = snapshots.slice(-Math.floor(snapshots.length / 4));
        
        const avgFirst = firstQuarter.reduce((sum, s) => sum + s.heapUsed, 0) / firstQuarter.length;
        const avgLast = lastQuarter.reduce((sum, s) => sum + s.heapUsed, 0) / lastQuarter.length;
        
        const changePercent = ((avgLast - avgFirst) / avgFirst) * 100;
        
        if (changePercent > 10) return 'increasing';
        if (changePercent < -10) return 'decreasing';
        return 'stable';
    }
    
    calculateMemoryVolatility(snapshots) {
        if (snapshots.length < 2) return 0;
        
        const values = snapshots.map(s => s.heapUsed);
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        
        return Math.sqrt(variance) / mean; // Coefficient of variation
    }
}

module.exports = { PerformanceMonitor };