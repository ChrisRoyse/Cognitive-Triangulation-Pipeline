/**
 * Circuit Breaker Implementation
 * 
 * Implements the circuit breaker pattern to prevent cascade failures:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Service is down, fail fast without making requests
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 * 
 * Features:
 * - Configurable failure thresholds
 * - Exponential backoff for recovery attempts  
 * - Health check integration
 * - Metrics and monitoring
 * - Event callbacks for state changes
 */

class CircuitBreaker {
    constructor(options = {}) {
        // Configuration
        this.name = options.name || 'default';
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2; // Successes needed to close from half-open
        this.timeout = options.timeout || 60000; // 1 minute default
        this.monitor = options.monitor || this.defaultMonitor.bind(this);
        this.resetTimeout = options.resetTimeout || 60000;
        this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;
        
        // State
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = 0;
        this.halfOpenCalls = 0;
        
        // Statistics
        this.stats = {
            requests: 0,
            successes: 0,
            failures: 0,
            rejected: 0,
            stateChanges: 0,
            lastFailure: null,
            lastSuccess: null,
            stateHistory: []
        };
        
        // Event callbacks
        this.onStateChange = options.onStateChange || (() => {});
        this.onFailure = options.onFailure || (() => {});
        this.onSuccess = options.onSuccess || (() => {});
        
        console.log(`🔒 Circuit breaker '${this.name}' initialized`);
    }

    /**
     * Execute operation with circuit breaker protection
     */
    async execute(operation, fallback = null) {
        return new Promise(async (resolve, reject) => {
            // Check if circuit breaker allows execution
            if (!this.allowRequest()) {
                this.stats.rejected++;
                const error = new Error(`Circuit breaker '${this.name}' is OPEN`);
                error.code = 'CIRCUIT_BREAKER_OPEN';
                
                if (fallback && typeof fallback === 'function') {
                    try {
                        const fallbackResult = await fallback();
                        resolve(fallbackResult);
                        return;
                    } catch (fallbackError) {
                        reject(fallbackError);
                        return;
                    }
                }
                
                reject(error);
                return;
            }

            this.stats.requests++;
            const startTime = Date.now();

            try {
                // Execute the operation
                const result = await operation();
                
                // Record success
                const duration = Date.now() - startTime;
                this.onSuccessInternal(duration);
                
                resolve(result);
            } catch (error) {
                // Record failure
                const duration = Date.now() - startTime;
                this.onFailureInternal(error, duration);
                
                reject(error);
            }
        });
    }

    /**
     * Check if request should be allowed through
     */
    allowRequest() {
        const now = Date.now();

        switch (this.state) {
            case 'CLOSED':
                return true;
                
            case 'OPEN':
                if (now >= this.nextAttempt) {
                    this.setState('HALF_OPEN');
                    return true;
                }
                return false;
                
            case 'HALF_OPEN':
                return this.halfOpenCalls < this.halfOpenMaxCalls;
                
            default:
                return false;
        }
    }

    /**
     * Handle successful operation
     */
    onSuccessInternal(duration) {
        this.stats.successes++;
        this.stats.lastSuccess = new Date();
        this.failures = 0; // Reset failure count
        
        if (this.state === 'HALF_OPEN') {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this.setState('CLOSED');
            }
        }
        
        // Call external success callback
        this.onSuccess(duration);
        
        // Monitor for success pattern
        this.monitor('success', { duration });
    }

    /**
     * Handle failed operation
     */
    onFailureInternal(error, duration) {
        this.stats.failures++;
        this.stats.lastFailure = new Date();
        this.failures++;
        
        if (this.state === 'HALF_OPEN') {
            // Failed during recovery, go back to OPEN
            this.setState('OPEN');
        } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
            // Too many failures, open the circuit
            this.setState('OPEN');
        }
        
        // Call external failure callback
        this.onFailure(error, duration);
        
        // Monitor for failure pattern
        this.monitor('failure', { error, duration });
    }

    /**
     * Change circuit breaker state
     */
    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        this.stats.stateChanges++;
        
        // Record state change in history
        this.stats.stateHistory.push({
            from: oldState,
            to: newState,
            timestamp: new Date(),
            failures: this.failures,
            successes: this.successes
        });
        
        // Keep only last 10 state changes
        if (this.stats.stateHistory.length > 10) {
            this.stats.stateHistory.shift();
        }

        switch (newState) {
            case 'OPEN':
                this.nextAttempt = Date.now() + this.resetTimeout;
                this.halfOpenCalls = 0;
                this.successes = 0;
                console.warn(`⚠️  Circuit breaker '${this.name}' OPENED (${this.failures} failures)`);
                break;
                
            case 'HALF_OPEN':
                this.halfOpenCalls = 0;
                this.successes = 0;
                console.log(`🔄 Circuit breaker '${this.name}' HALF-OPEN (testing recovery)`);
                break;
                
            case 'CLOSED':
                this.failures = 0;
                this.successes = 0;
                this.halfOpenCalls = 0;
                console.log(`✅ Circuit breaker '${this.name}' CLOSED (recovered)`);
                break;
        }
        
        // Call external state change callback
        this.onStateChange(oldState, newState);
    }

    /**
     * Force circuit breaker to open (manual intervention)
     */
    forceOpen(reason = 'Manual intervention') {
        console.warn(`🚨 Circuit breaker '${this.name}' manually opened: ${reason}`);
        this.setState('OPEN');
    }

    /**
     * Force circuit breaker to close (manual intervention)
     */
    forceClose(reason = 'Manual intervention') {
        console.log(`🔄 Circuit breaker '${this.name}' manually closed: ${reason}`);
        this.failures = 0;
        this.setState('CLOSED');
    }

    /**
     * Reset circuit breaker to initial state
     */
    reset() {
        this.failures = 0;
        this.successes = 0;
        this.halfOpenCalls = 0;
        this.nextAttempt = 0;
        this.setState('CLOSED');
        console.log(`🔄 Circuit breaker '${this.name}' reset`);
    }
    
    /**
     * Get current state
     */
    getState() {
        return this.state;
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            nextAttempt: this.nextAttempt,
            halfOpenCalls: this.halfOpenCalls,
            isOpen: this.state === 'OPEN',
            isHalfOpen: this.state === 'HALF_OPEN',
            isClosed: this.state === 'CLOSED',
            stats: {
                ...this.stats,
                uptime: Date.now() - (this.stats.stateHistory[0]?.timestamp || Date.now()),
                successRate: this.stats.requests > 0 ? (this.stats.successes / this.stats.requests) * 100 : 0
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const status = this.getStatus();
            
            return {
                healthy: status.state !== 'OPEN',
                state: status.state,
                failures: status.failures,
                successRate: status.stats.successRate,
                lastFailure: status.stats.lastFailure,
                lastSuccess: status.stats.lastSuccess,
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
     * Default monitor function (can be overridden)
     */
    defaultMonitor(event, data) {
        // Basic logging and monitoring
        if (event === 'failure' && this.failures > this.failureThreshold * 0.8) {
            console.warn(`⚠️  Circuit breaker '${this.name}' approaching failure threshold (${this.failures}/${this.failureThreshold})`);
        }
    }

    /**
     * Export metrics for monitoring systems
     */
    getMetrics() {
        const status = this.getStatus();
        
        return {
            circuit_breaker_state: status.state,
            circuit_breaker_failures: status.failures,
            circuit_breaker_successes: status.successes,
            circuit_breaker_requests_total: status.stats.requests,
            circuit_breaker_requests_rejected: status.stats.rejected,
            circuit_breaker_success_rate: status.stats.successRate,
            circuit_breaker_state_changes: status.stats.stateChanges
        };
    }
}

/**
 * Circuit Breaker Registry
 * Manages multiple circuit breakers and provides centralized monitoring
 */
class CircuitBreakerRegistry {
    constructor() {
        this.breakers = new Map();
    }

    /**
     * Create or get a circuit breaker
     */
    get(name, options = {}) {
        if (!this.breakers.has(name)) {
            const breaker = new CircuitBreaker({ ...options, name });
            this.breakers.set(name, breaker);
        }
        return this.breakers.get(name);
    }

    /**
     * Remove a circuit breaker
     */
    remove(name) {
        return this.breakers.delete(name);
    }

    /**
     * Get all circuit breakers
     */
    getAll() {
        return Array.from(this.breakers.values());
    }

    /**
     * Get status of all circuit breakers
     */
    getAllStatus() {
        const status = {};
        for (const [name, breaker] of this.breakers) {
            status[name] = breaker.getStatus();
        }
        return status;
    }

    /**
     * Health check for all circuit breakers
     */
    async healthCheckAll() {
        const checks = {};
        
        for (const [name, breaker] of this.breakers) {
            checks[name] = await breaker.healthCheck();
        }
        
        const allHealthy = Object.values(checks).every(check => check.healthy);
        
        return {
            healthy: allHealthy,
            breakers: checks,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Force all circuit breakers to reset
     */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
        console.log('🔄 All circuit breakers reset');
    }

    /**
     * Get aggregated metrics
     */
    getMetrics() {
        const metrics = {};
        
        for (const [name, breaker] of this.breakers) {
            const breakerMetrics = breaker.getMetrics();
            for (const [key, value] of Object.entries(breakerMetrics)) {
                metrics[`${name}_${key}`] = value;
            }
        }
        
        return metrics;
    }
}

// Global registry instance
const registry = new CircuitBreakerRegistry();

module.exports = {
    CircuitBreaker,
    CircuitBreakerRegistry,
    registry
};