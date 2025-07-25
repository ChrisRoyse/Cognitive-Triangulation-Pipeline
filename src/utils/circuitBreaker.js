const fs = require('fs');
const path = require('path');

class CircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'default';
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000;
        
        // Atomic state management
        this._state = 'CLOSED';
        this._failures = 0;
        this._nextAttempt = 0;
        this._stateMutex = false;
        
        // State transition lock methods
        this._lockState = () => {
            if (this._stateMutex) return false;
            this._stateMutex = true;
            return true;
        };
        
        this._unlockState = () => {
            this._stateMutex = false;
        };
        
        // Atomic state access properties
        Object.defineProperty(this, 'state', {
            get() { return this._state; },
            set(value) {
                if (!this._stateMutex) {
                    // Allow direct read but warn about unsafe writes
                    console.warn(`⚠️ [CircuitBreaker:${this.name}] Unsafe state modification outside lock`);
                }
                this._state = value;
            }
        });
        
        Object.defineProperty(this, 'failures', {
            get() { return this._failures; },
            set(value) {
                if (!this._stateMutex) {
                    console.warn(`⚠️ [CircuitBreaker:${this.name}] Unsafe failures modification outside lock`);
                }
                this._failures = value;
            }
        });
        
        Object.defineProperty(this, 'nextAttempt', {
            get() { return this._nextAttempt; },
            set(value) {
                if (!this._stateMutex) {
                    console.warn(`⚠️ [CircuitBreaker:${this.name}] Unsafe nextAttempt modification outside lock`);
                }
                this._nextAttempt = value;
            }
        });
        
        // Enhanced recovery properties
        this.baseRetryDelay = options.baseRetryDelay || 2000; // Start with 2 seconds
        this.maxRetryDelay = options.maxRetryDelay || 300000; // Cap at 5 minutes
        this.retryMultiplier = options.retryMultiplier || 2;
        this.currentRetryDelay = this.baseRetryDelay;
        this.recoveryAttempts = 0;
        this.lastRecoveryAttempt = 0;
        this.partialRecoveryThreshold = options.partialRecoveryThreshold || 0.5; // 50% success rate for full recovery
        this.partialRecoveryWindow = options.partialRecoveryWindow || 10; // Track last 10 attempts
        this.recoveryTestRequests = [];
        this.persistStatePath = options.persistStatePath || null;
        this.healthCheckFunction = options.healthCheckFunction || null;
        
        // Load persisted state if available
        this.loadPersistedState();
    }

    async execute(operation) {
        if (!this.allowRequest()) {
            const timeToNext = Math.max(0, this.nextAttempt - Date.now());
            throw new Error(`Circuit breaker is OPEN, next attempt in ${Math.round(timeToNext/1000)}s`);
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    allowRequest() {
        // Fast path for CLOSED state (most common case)
        if (this._state === 'CLOSED') return true;
        
        // For state transitions, acquire lock
        if (this._lockState()) {
            try {
                if (this.state === 'CLOSED') return true;
                
                if (this.state === 'OPEN') {
                    if (this.shouldAttemptRecovery()) {
                        return this.attemptGradualRecovery();
                    }
                    return false;
                }
                
                return this.state === 'HALF_OPEN';
            } finally {
                this._unlockState();
            }
        } else {
            // If we can't acquire lock, be conservative
            return this._state === 'CLOSED' || this._state === 'HALF_OPEN';
        }
    }

    shouldAttemptRecovery() {
        const now = Date.now();
        
        // Check if enough time has passed since last recovery attempt
        if (now < this.nextAttempt) {
            return false;
        }
        
        // Implement exponential backoff for recovery attempts
        const timeSinceLastAttempt = now - this.lastRecoveryAttempt;
        return timeSinceLastAttempt >= this.currentRetryDelay;
    }

    attemptGradualRecovery() {
        // Must be called within a lock
        if (!this._stateMutex) {
            console.warn(`⚠️ [CircuitBreaker:${this.name}] attemptGradualRecovery called outside lock`);
            return false;
        }
        
        const now = Date.now();
        this.lastRecoveryAttempt = now;
        this.recoveryAttempts++;
        
        // Transition to HALF_OPEN for testing
        this.state = 'HALF_OPEN';
        
        // Calculate next retry delay with exponential backoff
        this.currentRetryDelay = Math.min(
            this.currentRetryDelay * this.retryMultiplier,
            this.maxRetryDelay
        );
        
        // Set next attempt time based on exponential backoff
        this.nextAttempt = now + this.currentRetryDelay;
        
        this.persistState();
        
        console.log(`🔄 [CircuitBreaker:${this.name}] Attempting gradual recovery (attempt ${this.recoveryAttempts}, next backoff: ${Math.round(this.currentRetryDelay/1000)}s)`);
        
        return true;
    }

    async performHealthCheck() {
        if (!this.healthCheckFunction) {
            return true; // No health check defined, assume healthy
        }
        
        try {
            return await this.healthCheckFunction();
        } catch (error) {
            console.warn(`⚠️ [CircuitBreaker:${this.name}] Health check failed:`, error.message);
            return false;
        }
    }

    onSuccess() {
        if (this._lockState()) {
            try {
                // Track success for partial recovery analysis
                if (this.state === 'HALF_OPEN') {
                    this.recoveryTestRequests.push({ success: true, timestamp: Date.now() });
                    this.trimRecoveryWindow();
                    
                    // Check if we have enough successful requests to fully recover
                    if (this.shouldFullyRecover()) {
                        this.state = 'CLOSED';
                        this.resetRecoveryState();
                        console.log(`✅ [CircuitBreaker:${this.name}] Full recovery achieved after ${this.recoveryAttempts} attempts`);
                    } else {
                        console.log(`🔄 [CircuitBreaker:${this.name}] Partial recovery progress: ${this.getSuccessRate()}% success rate`);
                    }
                } else {
                    this.failures = 0;
                }
                
                this.persistState();
            } finally {
                this._unlockState();
            }
        }
    }

    onFailure() {
        if (this._lockState()) {
            try {
                this.failures++;
                
                // Track failure for partial recovery analysis
                if (this.state === 'HALF_OPEN') {
                    this.recoveryTestRequests.push({ success: false, timestamp: Date.now() });
                    this.trimRecoveryWindow();
                    
                    // If we fail during recovery, go back to OPEN with updated backoff
                    this.state = 'OPEN';
                    console.log(`❌ [CircuitBreaker:${this.name}] Recovery attempt failed, returning to OPEN state`);
                }
                
                if (this.failures >= this.failureThreshold && this.state !== 'OPEN') {
                    this.state = 'OPEN';
                    this.nextAttempt = Date.now() + this.resetTimeout;
                    this.resetRecoveryState();
                    console.log(`🚫 [CircuitBreaker:${this.name}] Circuit breaker opened after ${this.failures} failures`);
                }
                
                this.persistState();
            } finally {
                this._unlockState();
            }
        }
    }

    shouldFullyRecover() {
        if (this.recoveryTestRequests.length < 3) {
            return false; // Need at least 3 test requests
        }
        
        const successRate = this.getSuccessRate();
        return successRate >= this.partialRecoveryThreshold;
    }

    getSuccessRate() {
        if (this.recoveryTestRequests.length === 0) return 0;
        
        const successCount = this.recoveryTestRequests.filter(req => req.success).length;
        return (successCount / this.recoveryTestRequests.length) * 100;
    }

    trimRecoveryWindow() {
        // Keep only the most recent requests within the window
        if (this.recoveryTestRequests.length > this.partialRecoveryWindow) {
            this.recoveryTestRequests = this.recoveryTestRequests.slice(-this.partialRecoveryWindow);
        }
    }

    resetRecoveryState() {
        this.failures = 0;
        this.recoveryAttempts = 0;
        this.currentRetryDelay = this.baseRetryDelay;
        this.recoveryTestRequests = [];
        this.lastRecoveryAttempt = 0;
        this.nextAttempt = 0;
    }

    persistState() {
        if (!this.persistStatePath) return;
        
        try {
            const state = {
                name: this.name,
                state: this.state,
                failures: this.failures,
                nextAttempt: this.nextAttempt,
                recoveryAttempts: this.recoveryAttempts,
                currentRetryDelay: this.currentRetryDelay,
                lastRecoveryAttempt: this.lastRecoveryAttempt,
                recoveryTestRequests: this.recoveryTestRequests,
                timestamp: Date.now()
            };
            
            fs.writeFileSync(this.persistStatePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.warn(`⚠️ [CircuitBreaker:${this.name}] Failed to persist state:`, error.message);
        }
    }

    loadPersistedState() {
        if (!this.persistStatePath || !fs.existsSync(this.persistStatePath)) {
            return;
        }
        
        try {
            const stateData = fs.readFileSync(this.persistStatePath, 'utf8');
            const state = JSON.parse(stateData);
            
            // Only load state if it's for the same circuit breaker and recent
            if (state.name === this.name && (Date.now() - state.timestamp) < 3600000) { // 1 hour max age
                this.state = state.state || 'CLOSED';
                this.failures = state.failures || 0;
                this.nextAttempt = state.nextAttempt || 0;
                this.recoveryAttempts = state.recoveryAttempts || 0;
                this.currentRetryDelay = state.currentRetryDelay || this.baseRetryDelay;
                this.lastRecoveryAttempt = state.lastRecoveryAttempt || 0;
                this.recoveryTestRequests = state.recoveryTestRequests || [];
                
                console.log(`🔄 [CircuitBreaker:${this.name}] Loaded persisted state: ${this.state} (failures: ${this.failures}, attempts: ${this.recoveryAttempts})`);
            }
        } catch (error) {
            console.warn(`⚠️ [CircuitBreaker:${this.name}] Failed to load persisted state:`, error.message);
        }
    }

    getState() { 
        return this._state; 
    }
    
    getStatus() {
        // Safe atomic read of status
        return {
            name: this.name,
            state: this._state,
            failures: this._failures,
            nextAttempt: this._nextAttempt,
            recoveryAttempts: this.recoveryAttempts,
            currentRetryDelay: this.currentRetryDelay,
            successRate: this.getSuccessRate(),
            timeToNextAttempt: Math.max(0, this._nextAttempt - Date.now())
        };
    }
    
    reset() {
        if (this._lockState()) {
            try {
                this.resetRecoveryState();
                this.state = 'CLOSED';
                this.failures = 0;
                this.nextAttempt = 0;
                this.persistState();
            } finally {
                this._unlockState();
            }
        }
    }
}

class CircuitBreakerRegistry {
    constructor(options = {}) {
        this.breakers = new Map();
        this.defaultOptions = {
            failureThreshold: 5,
            resetTimeout: 60000,
            baseRetryDelay: 2000,
            maxRetryDelay: 300000,
            retryMultiplier: 2,
            partialRecoveryThreshold: 0.5,
            partialRecoveryWindow: 10,
            persistStatePath: options.persistStatePath || './data/circuit-breaker-state',
            ...options
        };
        
        // Ensure persistence directory exists
        this.ensurePersistenceDirectory();
    }

    ensurePersistenceDirectory() {
        if (this.defaultOptions.persistStatePath) {
            try {
                const dir = path.dirname(this.defaultOptions.persistStatePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            } catch (error) {
                console.warn('⚠️ [CircuitBreakerRegistry] Failed to create persistence directory:', error.message);
            }
        }
    }

    get(name, options = {}) {
        if (!this.breakers.has(name)) {
            const breakerOptions = {
                ...this.defaultOptions,
                ...options,
                name,
                persistStatePath: this.defaultOptions.persistStatePath ? 
                    `${this.defaultOptions.persistStatePath}-${name}.json` : null
            };
            
            this.breakers.set(name, new CircuitBreaker(breakerOptions));
            console.log(`🔧 [CircuitBreakerRegistry] Created circuit breaker: ${name}`);
        }
        
        return this.breakers.get(name);
    }

    getAll() {
        return Array.from(this.breakers.values());
    }

    resetAll() {
        console.log(`🔄 [CircuitBreakerRegistry] Resetting ${this.breakers.size} circuit breakers`);
        this.breakers.forEach(breaker => breaker.reset());
    }

    async attemptGlobalRecovery() {
        console.log('🔄 [CircuitBreakerRegistry] Starting global circuit breaker recovery...');
        
        const results = [];
        const openBreakers = Array.from(this.breakers.values()).filter(b => b.state === 'OPEN');
        
        if (openBreakers.length === 0) {
            return {
                success: true,
                attempted: 0,
                waiting: 0,
                total: 0,
                results: []
            };
        }
        
        console.log(`🔍 [CircuitBreakerRegistry] Found ${openBreakers.length} open circuit breakers to recover`);
        
        let attempted = 0;
        let waiting = 0;
        
        for (const breaker of openBreakers) {
            try {
                // Perform health check if available
                const isHealthy = await breaker.performHealthCheck();
                
                if (!isHealthy) {
                    const timeToNext = Math.max(0, breaker.nextAttempt - Date.now());
                    results.push({
                        name: breaker.name,
                        status: 'health_check_failed',
                        timeToNext: Math.round(timeToNext / 1000) + 's',
                        error: 'Health check failed'
                    });
                    waiting++;
                    continue;
                }
                
                if (breaker.shouldAttemptRecovery()) {
                    const success = breaker.attemptGradualRecovery();
                    if (success) {
                        results.push({
                            name: breaker.name,
                            status: 'attempted',
                            state: breaker.state,
                            recoveryAttempts: breaker.recoveryAttempts
                        });
                        attempted++;
                    } else {
                        results.push({
                            name: breaker.name,
                            status: 'failed',
                            error: 'Recovery attempt failed'
                        });
                    }
                } else {
                    const timeToNext = Math.max(0, breaker.nextAttempt - Date.now());
                    results.push({
                        name: breaker.name,
                        status: 'waiting',
                        timeToNext: Math.round(timeToNext / 1000) + 's'
                    });
                    waiting++;
                }
            } catch (error) {
                console.error(`❌ [CircuitBreakerRegistry] Error during recovery of ${breaker.name}:`, error.message);
                results.push({
                    name: breaker.name,
                    status: 'failed',
                    error: error.message
                });
            }
        }
        
        const success = attempted > 0 || waiting === openBreakers.length;
        
        console.log(`🔄 [CircuitBreakerRegistry] Global recovery completed: ${attempted} attempted, ${waiting} waiting, ${openBreakers.length} total`);
        
        return {
            success,
            attempted,
            waiting,
            total: openBreakers.length,
            results
        };
    }

    async healthCheckAll() {
        const allBreakers = Array.from(this.breakers.values());
        const results = [];
        
        if (allBreakers.length === 0) {
            return {
                healthy: true,
                totalBreakers: 0,
                healthyBreakers: 0,
                unhealthyBreakers: 0,
                results: []
            };
        }
        
        let healthyCount = 0;
        let unhealthyCount = 0;
        
        for (const breaker of allBreakers) {
            try {
                const isHealthy = await breaker.performHealthCheck();
                const status = breaker.getStatus();
                
                // Calculate failure rate over time
                const recentFailures = breaker.recoveryTestRequests
                    .filter(req => !req.success && (Date.now() - req.timestamp) < 300000) // Last 5 minutes
                    .length;
                const totalRecent = breaker.recoveryTestRequests
                    .filter(req => (Date.now() - req.timestamp) < 300000)
                    .length;
                
                const averageFailureRate = totalRecent > 0 ? (recentFailures / totalRecent) * 100 : 0;
                
                const healthy = breaker.state === 'CLOSED' && isHealthy && averageFailureRate < 50;
                
                results.push({
                    name: breaker.name,
                    healthy,
                    state: breaker.state,
                    failures: breaker.failures,
                    recoveryAttempts: breaker.recoveryAttempts,
                    averageFailureRate,
                    healthCheckPassed: isHealthy
                });
                
                if (healthy) {
                    healthyCount++;
                } else {
                    unhealthyCount++;
                }
            } catch (error) {
                console.error(`❌ [CircuitBreakerRegistry] Health check error for ${breaker.name}:`, error.message);
                results.push({
                    name: breaker.name,
                    healthy: false,
                    error: error.message
                });
                unhealthyCount++;
            }
        }
        
        const overallHealthy = unhealthyCount === 0;
        
        return {
            healthy: overallHealthy,
            totalBreakers: allBreakers.length,
            healthyBreakers: healthyCount,
            unhealthyBreakers: unhealthyCount,
            results
        };
    }

    getStatus() {
        const breakerStatuses = Array.from(this.breakers.entries()).map(([name, breaker]) => ({
            name,
            ...breaker.getStatus()
        }));
        
        const openCount = breakerStatuses.filter(s => s.state === 'OPEN').length;
        const halfOpenCount = breakerStatuses.filter(s => s.state === 'HALF_OPEN').length;
        const closedCount = breakerStatuses.filter(s => s.state === 'CLOSED').length;
        
        return {
            totalBreakers: this.breakers.size,
            openBreakers: openCount,
            halfOpenBreakers: halfOpenCount,
            closedBreakers: closedCount,
            breakers: breakerStatuses
        };
    }

    remove(name) {
        const removed = this.breakers.delete(name);
        if (removed) {
            console.log(`🗑️ [CircuitBreakerRegistry] Removed circuit breaker: ${name}`);
        }
        return removed;
    }

    clear() {
        const count = this.breakers.size;
        this.breakers.clear();
        console.log(`🗑️ [CircuitBreakerRegistry] Cleared ${count} circuit breakers`);
    }
}

// Create a singleton registry instance
const registry = new CircuitBreakerRegistry();

module.exports = { CircuitBreaker, CircuitBreakerRegistry, registry };