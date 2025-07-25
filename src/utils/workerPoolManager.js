/**
 * Simple Worker Pool Manager
 * Manages basic worker concurrency without complex monitoring or scaling
 */

const { EventEmitter } = require('events');

class WorkerPoolManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Simple configuration
        this.config = {
            maxConcurrency: options.maxConcurrency || 100,
            minWorkerConcurrency: 1,
            maxWorkerConcurrency: 50
        };
        
        // Simple state tracking
        this.workers = new Map(); // worker type -> { concurrency, activeJobs }
        this.currentConcurrency = 0;
        
        console.log(`⚙️ WorkerPoolManager initialized with max concurrency: ${this.config.maxConcurrency}`);
    }

    /**
     * Register a worker with the pool manager
     */
    registerWorker(workerType, options = {}) {
        const workerInfo = {
            type: workerType,
            concurrency: options.concurrency || 5,
            maxConcurrency: options.maxConcurrency || this.config.maxWorkerConcurrency,
            activeJobs: 0
        };
        
        this.workers.set(workerType, workerInfo);
        this.updateCurrentConcurrency();
        
        console.log(`✅ Registered worker: ${workerType} (concurrency: ${workerInfo.concurrency})`);
        return workerInfo;
    }

    /**
     * Get optimal concurrency for a worker
     */
    getWorkerConcurrency(workerType) {
        const worker = this.workers.get(workerType);
        return worker ? worker.concurrency : this.config.minWorkerConcurrency;
    }

    /**
     * Request permission to process a job
     */
    async requestJobSlot(workerType, jobData = {}) {
        const worker = this.workers.get(workerType);
        if (!worker) {
            throw new Error(`Worker type '${workerType}' not registered`);
        }
        
        // Check global concurrency limit
        if (this.currentConcurrency >= this.config.maxConcurrency) {
            throw new Error('Maximum concurrency limit reached');
        }
        
        // Check worker-specific concurrency
        if (worker.activeJobs >= worker.concurrency) {
            throw new Error(`Worker '${workerType}' concurrency limit reached`);
        }
        
        // Allocate slot
        worker.activeJobs++;
        this.currentConcurrency++;
        
        return {
            workerType,
            slotId: `${workerType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            concurrency: worker.concurrency
        };
    }

    /**
     * Release a job slot
     */
    async releaseJobSlot(workerType, success = true) {
        const worker = this.workers.get(workerType);
        if (!worker) {
            console.warn(`⚠️ Attempted to release slot for unknown worker: ${workerType}`);
            return;
        }
        
        // Update counters
        worker.activeJobs = Math.max(0, worker.activeJobs - 1);
        this.currentConcurrency = Math.max(0, this.currentConcurrency - 1);
    }

    /**
     * Execute operation with worker pool management
     */
    async executeWithManagement(workerType, operation, jobData = {}) {
        let slot = null;
        
        try {
            // Request slot
            slot = await this.requestJobSlot(workerType, jobData);
            
            // Execute operation
            const result = await operation();
            
            // Success
            await this.releaseJobSlot(workerType, true);
            
            return result;
            
        } catch (error) {
            // Failure
            if (slot) {
                await this.releaseJobSlot(workerType, false);
            }
            
            throw error;
        }
    }

    /**
     * Update current total concurrency
     */
    updateCurrentConcurrency() {
        this.currentConcurrency = Array.from(this.workers.values())
            .reduce((total, worker) => total + worker.activeJobs, 0);
    }

    /**
     * Scale workers (simple version)
     */
    async scaleWorkers(workerType, targetCount) {
        const worker = this.workers.get(workerType);
        if (!worker) {
            throw new Error(`Worker type '${workerType}' not registered`);
        }

        const oldConcurrency = worker.concurrency;
        worker.concurrency = Math.min(targetCount, worker.maxConcurrency);
        
        if (worker.concurrency !== oldConcurrency) {
            console.log(`🔄 Scaled '${workerType}': ${oldConcurrency} → ${worker.concurrency}`);
        }
        
        return worker.concurrency;
    }

    /**
     * Get current status
     */
    getStatus() {
        const workers = {};
        for (const [type, worker] of this.workers) {
            workers[type] = {
                type: worker.type,
                concurrency: worker.concurrency,
                activeJobs: worker.activeJobs,
                utilization: worker.concurrency > 0 ? (worker.activeJobs / worker.concurrency) * 100 : 0
            };
        }
        
        return {
            globalConcurrency: {
                current: this.currentConcurrency,
                max: this.config.maxConcurrency,
                utilization: (this.currentConcurrency / this.config.maxConcurrency) * 100
            },
            workers
        };
    }

    /**
     * Get comprehensive status
     */
    getStatus() {
        const workers = {};
        for (const [type, worker] of this.workers) {
            workers[type] = {
                type: worker.type,
                priority: worker.priority,
                concurrency: worker.concurrency,
                activeJobs: worker.activeJobs,
                completedJobs: worker.completedJobs,
                failedJobs: worker.failedJobs,
                utilization: worker.concurrency > 0 ? (worker.activeJobs / worker.concurrency) * 100 : 0,
                metrics: worker.metrics,
                circuitBreakerState: worker.circuitBreaker.state,
                lastActivity: worker.lastActivity
            };
        }
        
        return {
            globalConcurrency: {
                current: this.currentConcurrency,
                max: this.config.maxGlobalConcurrency,
                utilization: (this.currentConcurrency / this.config.maxGlobalConcurrency) * 100
            },
            workers,
            metrics: {
                ...this.metrics,
                uptime: Date.now() - this.metrics.startTime,
                successRate: this.metrics.totalRequests > 0 
                    ? ((this.metrics.completedRequests / this.metrics.totalRequests) * 100)
                    : 0
            },
            config: this.config
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const status = this.getStatus();
            const circuitBreakerHealth = await registry.healthCheckAll();
            
            // Check for unhealthy conditions
            const unhealthyWorkers = Object.values(status.workers)
                .filter(w => w.circuitBreakerState === 'OPEN' || w.metrics.errorRate > 50);
            
            const isHealthy = unhealthyWorkers.length === 0 && 
                           circuitBreakerHealth.healthy &&
                           status.globalConcurrency.utilization < 95;
            
            return {
                healthy: isHealthy,
                status,
                circuitBreakers: circuitBreakerHealth,
                unhealthyWorkers: unhealthyWorkers.map(w => w.type),
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
     * Graceful shutdown
     */
    async shutdown() {
        console.log('🛑 Shutting down WorkerPoolManager...');
        
        // Stop monitoring
        if (this.resourceMonitor) {
            clearInterval(this.resourceMonitor);
            this.resourceMonitor = null;
        }
        
        // Wait for active jobs to complete (with timeout)
        const timeout = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.currentConcurrency > 0 && (Date.now() - startTime) < timeout) {
            console.log(`⏳ Waiting for ${this.currentConcurrency} active jobs to complete...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Force close circuit breakers
        registry.resetAll();
        
        console.log('✅ WorkerPoolManager shutdown complete');
        this.emit('shutdown');
    }

    /**
     * Log configuration on startup
     */
    logConfiguration() {
        console.log('⚙️  WorkerPoolManager Configuration:');
        console.log(`   Environment: ${this.config.environment}`);
        console.log(`   Max Global Concurrency: ${this.config.maxGlobalConcurrency}`);
        console.log(`   CPU Threshold: ${this.config.cpuThreshold}%`);
        console.log(`   Memory Threshold: ${this.config.memoryThreshold}%`);
        console.log(`   Rate Limits: ${Object.keys(this.config.rateLimits).length} configured`);
        console.log(`   Worker Priorities: ${Object.keys(this.config.workerPriorities).length} configured`);
    }
    
    /**
     * Set global concurrency manager
     */
    setGlobalConcurrencyManager(manager) {
        this.globalConcurrencyManager = manager;
        console.log('🔗 Global concurrency manager integrated');
    }
    
    /**
     * Set circuit breaker manager
     */
    setCircuitBreakerManager(manager) {
        this.circuitBreakerManager = manager;
        console.log('🔗 Circuit breaker manager integrated');
        
        // Subscribe to circuit breaker events
        if (manager) {
            manager.on('stateChange', ({ serviceName, oldState, newState }) => {
                this.handleCircuitBreakerStateChange(serviceName, oldState, newState);
            });
            
            manager.on('protectiveMode', ({ activated }) => {
                if (activated) {
                    console.warn('🛡️  Entering protective mode - reducing concurrency');
                    this.reduceAllWorkerConcurrency(0.5);
                } else {
                    console.log('✅ Exiting protective mode - restoring concurrency');
                    this.restoreWorkerConcurrency();
                }
            });
        }
    }
    
    /**
     * Get adjusted concurrency based on circuit breaker state
     */
    getAdjustedConcurrency(workerType) {
        const worker = this.workers.get(workerType);
        if (!worker) return this.config.minWorkerConcurrency;
        
        let concurrency = worker.concurrency;
        
        // Reduce if circuit breaker manager indicates issues
        if (this.circuitBreakerManager && this.circuitBreakerManager.isInProtectiveMode()) {
            concurrency = Math.floor(concurrency * 0.5);
        }
        
        return Math.max(this.config.minWorkerConcurrency, concurrency);
    }
    
    /**
     * Check if in protective mode
     */
    isInProtectiveMode() {
        return this.circuitBreakerManager && this.circuitBreakerManager.isInProtectiveMode();
    }
    
    /**
     * Reduce all worker concurrency
     */
    reduceAllWorkerConcurrency(factor = 0.5) {
        for (const worker of this.workers.values()) {
            const originalConcurrency = worker.concurrency;
            worker.concurrency = Math.max(
                worker.minConcurrency,
                Math.floor(worker.concurrency * factor)
            );
            
            if (worker.concurrency < originalConcurrency) {
                console.log(`📉 Reduced ${worker.type} concurrency: ${originalConcurrency} → ${worker.concurrency}`);
            }
        }
    }
    
    /**
     * Restore worker concurrency to normal levels
     */
    restoreWorkerConcurrency() {
        for (const worker of this.workers.values()) {
            const targetConcurrency = this.calculateInitialConcurrency(worker.type, worker.priority);
            
            if (targetConcurrency > worker.concurrency) {
                worker.concurrency = targetConcurrency;
                console.log(`📈 Restored ${worker.type} concurrency to ${worker.concurrency}`);
            }
        }
    }

    /**
     * Wait for an available slot instead of throwing an error
     */
    async waitForAvailableSlot(workerType, jobData, maxWaitTime = 90000) { // Reduced to 90 seconds
        const startWait = Date.now();
        let checkInterval = 100; // Start with 100ms, will increase with exponential backoff
        
        while (Date.now() - startWait < maxWaitTime) {
            const worker = this.workers.get(workerType);
            if (!worker) {
                throw new Error(`Unknown worker type: ${workerType}`);
            }
            
            // Check if slot is now available
            if (worker.activeJobs < worker.concurrency) {
                // Recursively call requestJobSlot now that space is available
                return await this.requestJobSlot(workerType, jobData);
            }
            
            // Exponential backoff: increase wait time gradually to reduce CPU usage
            checkInterval = Math.min(checkInterval * 1.1, 2000); // Cap at 2 seconds
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        // If we've waited too long, fall back to throwing error
        throw new Error(`Timeout waiting for available slot for worker '${workerType}' after ${maxWaitTime}ms`);
    }

    /**
     * Start slot cleanup process to detect and recover leaked slots
     */
    startSlotCleanup() {
        if (this.slotCleanupInterval) {
            clearInterval(this.slotCleanupInterval);
        }
        
        this.slotCleanupInterval = setInterval(() => {
            this.cleanupStalledSlots();
        }, 60000); // Check every minute
        
        // Track the interval for cleanup
        this.trackInterval(this.slotCleanupInterval, { name: 'slotCleanup' });
        
        console.log('🔧 Started slot cleanup monitoring');
    }
    
    /**
     * Clean up stalled slots that may have leaked
     */
    cleanupStalledSlots() {
        let totalCleaned = 0;
        
        for (const [workerType, worker] of this.workers.entries()) {
            // If activeJobs is significantly higher than it should be, reset it
            const expectedMax = worker.concurrency;
            
            if (worker.activeJobs > expectedMax) {
                const cleaned = worker.activeJobs - expectedMax;
                console.warn(`🔧 Cleaning ${cleaned} stalled slots for worker '${workerType}' (had ${worker.activeJobs}, max is ${expectedMax})`);
                
                worker.activeJobs = Math.max(0, expectedMax);
                this.currentConcurrency = Math.max(0, this.currentConcurrency - cleaned);
                this.metrics.activeRequests = Math.max(0, this.metrics.activeRequests - cleaned);
                
                totalCleaned += cleaned;
            }
            
            // Also check for workers with negative activeJobs (shouldn't happen but safety check)
            if (worker.activeJobs < 0) {
                console.warn(`🔧 Fixing negative activeJobs count for worker '${workerType}': ${worker.activeJobs} -> 0`);
                worker.activeJobs = 0;
            }
        }
        
        if (totalCleaned > 0) {
            console.log(`🔧 Slot cleanup completed: recovered ${totalCleaned} stalled slots`);
            this.emit('slotsRecovered', { count: totalCleaned });
        }
    }

    /**
     * Reset all circuit breakers (useful after fixing underlying issues)
     */
    resetAllCircuitBreakers(reason = 'Manual reset after fixing underlying issues') {
        console.log(`🔄 Resetting all circuit breakers: ${reason}`);
        let resetCount = 0;
        
        for (const [workerType, worker] of this.workers.entries()) {
            if (worker.circuitBreaker) {
                const oldState = worker.circuitBreaker.state;
                worker.circuitBreaker.reset();
                
                if (oldState !== 'CLOSED') {
                    console.log(`✅ Reset circuit breaker for '${workerType}': ${oldState} → CLOSED`);
                    resetCount++;
                }
            }
        }
        
        console.log(`🔄 Circuit breaker reset complete: ${resetCount} breakers were reset`);
        this.emit('circuitBreakersReset', { count: resetCount, reason });
        
        return resetCount;
    }

    /**
     * Get circuit breaker status for all workers
     */
    getCircuitBreakerStatus() {
        const status = {};
        
        for (const [workerType, worker] of this.workers.entries()) {
            if (worker.circuitBreaker) {
                const breakerStatus = worker.circuitBreaker.getStatus();
                status[workerType] = {
                    state: breakerStatus.state,
                    failures: breakerStatus.failures,
                    successes: breakerStatus.successes,
                    nextAttempt: breakerStatus.nextAttempt,
                    recoveryAttempts: breakerStatus.recoveryAttempts,
                    maxRecoveryAttempts: breakerStatus.maxRecoveryAttempts,
                    gradualRecoveryInProgress: breakerStatus.gradualRecoveryInProgress,
                    timeToNextAttempt: breakerStatus.timeToNextAttempt,
                    lastStateChange: breakerStatus.lastStateChange,
                    stats: breakerStatus.stats,
                    resetTimeout: worker.circuitBreaker.resetTimeout
                };
            }
        }
        
        return status;
    }

    /**
     * Manually trigger circuit breaker recovery for specific workers or all workers
     */
    async triggerCircuitBreakerRecovery(workerTypes = null) {
        const { registry } = require('./circuitBreaker');
        
        try {
            if (workerTypes && Array.isArray(workerTypes)) {
                // Recovery for specific workers
                const results = [];
                for (const workerType of workerTypes) {
                    const worker = this.workers.get(workerType);
                    if (worker && worker.circuitBreaker) {
                        if (worker.circuitBreaker.state === 'OPEN') {
                            console.log(`🔄 Triggering recovery for circuit breaker '${workerType}'...`);
                            worker.circuitBreaker.allowRequest(); // This will trigger recovery attempt if timeout passed
                            results.push({ name: workerType, status: 'attempted', state: worker.circuitBreaker.state });
                        } else {
                            results.push({ name: workerType, status: 'not_needed', state: worker.circuitBreaker.state });
                        }
                    } else {
                        results.push({ name: workerType, status: 'not_found' });
                    }
                }
                return { success: true, results };
            } else {
                // Global recovery using registry
                return await registry.attemptGlobalRecovery();
            }
        } catch (error) {
            console.error('❌ Error triggering circuit breaker recovery:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get health status of all circuit breakers
     */
    async getCircuitBreakerHealth() {
        const { registry } = require('./circuitBreaker');
        
        try {
            return await registry.healthCheckAll();
        } catch (error) {
            console.error('❌ Error checking circuit breaker health:', error);
            return { healthy: false, error: error.message };
        }
    }

    /**
     * Track a worker instance for process monitoring
     */
    trackWorkerInstance(workerType, workerInstance, pid = null) {
        if (this.processMonitor) {
            const existingWorker = this.processMonitor.trackedWorkers.get(workerType);
            if (existingWorker) {
                existingWorker.workerInstance = workerInstance;
                existingWorker.pid = pid;
            }
            
            // Track any associated process
            if (pid && typeof pid === 'number') {
                this.processMonitor.trackProcess(pid, {
                    name: `${workerType}-process`,
                    type: 'worker_process',
                    workerId: workerType,
                    command: workerInstance.constructor?.name || 'unknown'
                });
            }
        }
        
        console.log(`🔧 Tracked worker instance: ${workerType}${pid ? ` (PID: ${pid})` : ''}`);
    }
    
    /**
     * Track a timer or interval for cleanup
     */
    trackTimer(timerId, timerInfo = {}) {
        if (this.processMonitor) {
            return this.processMonitor.trackTimer(timerId, timerInfo);
        }
        return timerId;
    }
    
    trackInterval(intervalId, intervalInfo = {}) {
        if (this.processMonitor) {
            return this.processMonitor.trackInterval(intervalId, intervalInfo);
        }
        return intervalId;
    }
    
    /**
     * Untrack a worker when it shuts down
     */
    untrackWorker(workerType) {
        if (this.processMonitor) {
            this.processMonitor.untrackWorker(workerType);
        }
        console.log(`🔧 Untracked worker: ${workerType}`);
    }
    
    /**
     * Get process monitoring status
     */
    getProcessMonitorStatus() {
        return this.processMonitor ? this.processMonitor.getStatus() : null;
    }
    
    /**
     * Verify clean shutdown - check for zombie processes
     */
    async verifyCleanShutdown() {
        if (this.processMonitor) {
            return await this.processMonitor.verifyCleanShutdown();
        }
        return { clean: true, zombies: [], orphanedTimers: [] };
    }
    
    /**
     * Force kill any zombie processes
     */
    async forceKillZombies() {
        if (this.processMonitor) {
            return await this.processMonitor.forceKillZombies();
        }
        return { success: true, killed: [], failed: [] };
    }
    
    /**
     * Enhanced shutdown with zombie process detection and cleanup
     */
    async shutdown() {
        console.log('🛑 Shutting down WorkerPoolManager with process monitoring...');
        
        // Track cleanup intervals as timers for monitoring
        const intervals = [this.resourceMonitor, this.adaptiveScaler, this.slotCleanupInterval].filter(Boolean);
        intervals.forEach(interval => {
            if (this.processMonitor) {
                this.processMonitor.trackInterval(interval, { name: 'workerPoolCleanup' });
            }
        });
        
        // Stop monitoring
        if (this.resourceMonitor) {
            clearInterval(this.resourceMonitor);
            this.resourceMonitor = null;
        }
        
        if (this.adaptiveScaler) {
            clearInterval(this.adaptiveScaler);
            this.adaptiveScaler = null;
        }
        
        if (this.slotCleanupInterval) {
            clearInterval(this.slotCleanupInterval);
            this.slotCleanupInterval = null;
        }
        
        // Wait for active jobs to complete (with timeout)
        const timeout = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.currentConcurrency > 0 && (Date.now() - startTime) < timeout) {
            console.log(`⏳ Waiting for ${this.currentConcurrency} active jobs to complete...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Untrack all workers
        for (const workerType of this.workers.keys()) {
            this.untrackWorker(workerType);
        }
        
        // Force close circuit breakers
        registry.resetAll();
        
        // Use ProcessMonitor for graceful shutdown verification
        if (this.processMonitor) {
            try {
                const verification = await this.verifyCleanShutdown();
                
                if (!verification.clean) {
                    console.warn(`⚠️ Found ${verification.zombies.length} zombie processes during WorkerPoolManager shutdown`);
                    const killResult = await this.forceKillZombies();
                    
                    if (killResult.failed.length > 0) {
                        console.error(`❌ Failed to kill ${killResult.failed.length} zombie processes`);
                        console.error('Zombie processes that could not be killed:', killResult.failed);
                    } else {
                        console.log(`✅ Successfully cleaned up ${killResult.killed.length} zombie processes`);
                    }
                }
                
                // Shutdown the process monitor itself
                await this.processMonitor.shutdown();
                
            } catch (error) {
                console.error('❌ Error during zombie process cleanup:', error.message);
                throw error;
            }
        }
        
        console.log('✅ WorkerPoolManager shutdown complete');
        this.emit('shutdown');
    }
}

module.exports = { WorkerPoolManager };