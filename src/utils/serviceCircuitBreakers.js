/**
 * Service-Specific Circuit Breakers
 * 
 * Implements specialized circuit breakers for each external service:
 * - DeepSeek API: Handles rate limits, timeouts, auth errors
 * - Neo4j Database: Handles connection issues, deadlocks, pool exhaustion
 * - Redis Cache: Handles connection issues, memory limits
 * 
 * Each circuit breaker is tailored to the specific failure patterns
 * and recovery strategies of its service.
 */

const { CircuitBreaker } = require('./circuitBreaker');
const { EventEmitter } = require('events');

/**
 * DeepSeek API Circuit Breaker
 * Specialized for LLM API interactions
 */
class DeepSeekCircuitBreaker extends CircuitBreaker {
    constructor(options = {}) {
        super({
            name: options.name || 'deepseek-api',
            failureThreshold: options.failureThreshold || 5,
            successThreshold: options.successThreshold || 3,
            timeout: options.timeout || 60000,
            resetTimeout: options.resetTimeout || 30000,
            ...options
        });
        
        this.requestTimeout = options.requestTimeout || 10000;
        this.service = options.service;
        this.rateLimitBackoff = 0;
        this.permanentError = false;
        this.cacheFallback = null;
        this.degradedFunction = null;
        this.degradedMode = false;
        
        // Track API-specific metrics
        this.apiMetrics = {
            rateLimitHits: 0,
            timeouts: 0,
            authErrors: 0,
            lastRateLimitReset: Date.now()
        };
    }
    
    /**
     * Execute with API-specific handling
     */
    async execute(operation, options = {}) {
        // Check rate limit backoff
        if (this.rateLimitBackoff > Date.now()) {
            const error = new Error('Rate limit in effect');
            error.code = 'RATE_LIMIT';
            error.retryAfter = this.rateLimitBackoff - Date.now();
            
            if (options.useFallback && this.cacheFallback) {
                return this.cacheFallback();
            }
            
            throw error;
        }
        
        // Check permanent errors (like auth)
        if (this.permanentError) {
            const error = new Error('Permanent error - check configuration');
            error.code = 'PERMANENT_ERROR';
            throw error;
        }
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                this.apiMetrics.timeouts++;
                reject(new Error('Request timeout'));
            }, this.requestTimeout);
        });
        
        try {
            const result = await Promise.race([
                super.execute(operation),
                timeoutPromise
            ]);
            
            return result;
        } catch (error) {
            // Handle specific error types
            if (error.code === 'RATE_LIMIT') {
                this.handleRateLimit(error);
                
                if (options.useFallback && this.cacheFallback) {
                    return this.cacheFallback();
                }
            } else if (error.code === 'AUTH_ERROR') {
                this.handleAuthError(error);
            } else if (error.code === 'CIRCUIT_BREAKER_OPEN' && options.allowDegraded && this.degradedFunction) {
                return this.degradedFunction();
            }
            
            throw error;
        }
    }
    
    /**
     * Handle rate limit errors
     */
    handleRateLimit(error) {
        this.apiMetrics.rateLimitHits++;
        
        // Don't count rate limits as circuit breaker failures
        this.failures = Math.max(0, this.failures - 1);
        
        // Set backoff
        const retryAfter = error.retryAfter || 60000;
        this.rateLimitBackoff = Date.now() + retryAfter;
        
        console.log(`⏱️  Rate limit hit for ${this.name}, backing off for ${retryAfter}ms`);
    }
    
    /**
     * Handle authentication errors
     */
    handleAuthError(error) {
        this.apiMetrics.authErrors++;
        this.permanentError = true;
        
        // Don't count auth errors as circuit breaker failures
        this.failures = 0;
        
        console.error(`🔐 Authentication error for ${this.name} - manual intervention required`);
    }
    
    /**
     * Override failure handler to check for specific errors
     */
    onFailureInternal(error, duration) {
        // Don't count certain errors as failures
        const nonFailureErrors = ['RATE_LIMIT', 'AUTH_ERROR', 'CANCELLED'];
        
        if (error.code && nonFailureErrors.includes(error.code)) {
            return;
        }
        
        super.onFailureInternal(error, duration);
    }
    
    /**
     * Get rate limit backoff time
     */
    getRateLimitBackoff() {
        return Math.max(0, this.rateLimitBackoff - Date.now());
    }
    
    /**
     * Check if permanent error
     */
    isPermanentError() {
        return this.permanentError;
    }
    
    /**
     * Set cache fallback function
     */
    setCacheFallback(fallbackFn) {
        this.cacheFallback = fallbackFn;
    }
    
    /**
     * Set degraded mode function
     */
    setDegradedFunction(degradedFn) {
        this.degradedFunction = degradedFn;
    }
    
    /**
     * Enable/disable degraded mode
     */
    setDegradedMode(enabled) {
        this.degradedMode = enabled;
    }
    
    /**
     * Get next retry time with exponential backoff
     */
    getNextRetryTime() {
        const baseDelay = this.resetTimeout;
        const attempts = this.stats.stateChanges;
        return baseDelay * Math.pow(2, Math.min(attempts, 5)); // Cap at 32x
    }
    
    /**
     * Attempt reset with backoff
     */
    attemptReset() {
        if (this.state === 'OPEN') {
            this.setState('HALF_OPEN');
        }
    }
}

/**
 * Neo4j Database Circuit Breaker
 * Specialized for database interactions
 */
class Neo4jCircuitBreaker extends CircuitBreaker {
    constructor(options = {}) {
        super({
            name: options.name || 'neo4j-database',
            failureThreshold: options.failureThreshold || 3,
            successThreshold: options.successThreshold || 2,
            timeout: options.timeout || 120000,
            resetTimeout: options.resetTimeout || 60000,
            ...options
        });
        
        this.connectionTimeout = options.connectionTimeout || 5000;
        this.client = options.client;
        this.shouldBackoffFlag = false;
        
        // Track database-specific metrics
        this.dbMetrics = {
            connectionFailures: 0,
            poolExhausted: 0,
            deadlocks: 0,
            transientErrors: 0,
            slowQueries: 0,
            queryTimes: []
        };
    }
    
    /**
     * Execute with database-specific handling
     */
    async execute(operation, options = {}) {
        const maxRetries = options.maxRetries || 0;
        let lastError;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const startTime = Date.now();
                const result = await super.execute(operation);
                const duration = Date.now() - startTime;
                
                // Track query performance
                this.trackQueryPerformance(duration);
                
                return result;
            } catch (error) {
                lastError = error;
                
                // Handle specific Neo4j errors
                if (this.isTransientError(error)) {
                    this.dbMetrics.transientErrors++;
                    
                    if (attempt < maxRetries) {
                        // Exponential backoff for retries
                        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                } else if (this.isPoolExhaustedError(error)) {
                    this.handlePoolExhaustion(error);
                } else if (this.isDeadlockError(error)) {
                    this.handleDeadlock(error);
                }
                
                throw error;
            }
        }
        
        throw lastError;
    }
    
    /**
     * Check if error is transient (retryable)
     */
    isTransientError(error) {
        const transientCodes = [
            'Neo.TransientError.General.Unknown',
            'Neo.TransientError.Transaction.Terminated',
            'Neo.TransientError.Transaction.LockClient',
            'Neo.TransientError.Network.CommunicationError'
        ];
        
        return error.code && transientCodes.some(code => error.code.startsWith(code));
    }
    
    /**
     * Check if pool exhausted error
     */
    isPoolExhaustedError(error) {
        return error.code === 'Neo.ClientError.Pool.ExhaustedPool';
    }
    
    /**
     * Check if deadlock error
     */
    isDeadlockError(error) {
        return error.code === 'Neo.TransientError.Transaction.DeadlockDetected';
    }
    
    /**
     * Handle pool exhaustion
     */
    handlePoolExhaustion(error) {
        this.dbMetrics.poolExhausted++;
        this.shouldBackoffFlag = true;
        
        // Don't immediately open circuit for pool exhaustion
        this.failures = Math.max(0, this.failures - 1);
        
        console.warn(`⚠️  Connection pool exhausted for ${this.name}`);
    }
    
    /**
     * Handle deadlock
     */
    handleDeadlock(error) {
        this.dbMetrics.deadlocks++;
        
        // Don't count deadlocks as circuit breaker failures
        this.failures = Math.max(0, this.failures - 1);
        
        console.warn(`🔒 Deadlock detected for ${this.name}`);
    }
    
    /**
     * Track query performance
     */
    trackQueryPerformance(duration) {
        this.dbMetrics.queryTimes.push(duration);
        
        // Keep last 100 query times
        if (this.dbMetrics.queryTimes.length > 100) {
            this.dbMetrics.queryTimes.shift();
        }
        
        // Track slow queries (> 5 seconds)
        if (duration > 5000) {
            this.dbMetrics.slowQueries++;
        }
    }
    
    /**
     * Perform health check
     */
    async performHealthCheck() {
        if (!this.client || !this.client.verifyConnectivity) {
            return { healthy: false, error: 'No client configured' };
        }
        
        try {
            await this.client.verifyConnectivity();
            return { healthy: true };
        } catch (error) {
            return { healthy: false, error: error.message };
        }
    }
    
    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        const queryTimes = this.dbMetrics.queryTimes;
        const avgQueryTime = queryTimes.length > 0
            ? queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length
            : 0;
        
        return {
            avgQueryTime,
            slowQueries: this.dbMetrics.slowQueries,
            deadlocks: this.dbMetrics.deadlocks,
            poolExhausted: this.dbMetrics.poolExhausted,
            transientErrors: this.dbMetrics.transientErrors
        };
    }
    
    /**
     * Check if should backoff
     */
    shouldBackoff() {
        return this.shouldBackoffFlag;
    }
    
    /**
     * Get transient error count
     */
    getTransientErrorCount() {
        return this.dbMetrics.transientErrors;
    }
}

/**
 * Redis Cache Circuit Breaker
 * Specialized for cache interactions
 */
class RedisCircuitBreaker extends CircuitBreaker {
    constructor(options = {}) {
        super({
            name: options.name || 'redis-cache',
            failureThreshold: options.failureThreshold || 5,
            successThreshold: options.successThreshold || 2,
            timeout: options.timeout || 30000,
            resetTimeout: options.resetTimeout || 20000,
            ...options
        });
        
        this.client = options.client;
        this.fallbackToNoCache = options.fallbackToNoCache !== false;
        
        // Track cache-specific metrics
        this.cacheMetrics = {
            connectionFailures: 0,
            timeouts: 0,
            memoryErrors: 0,
            fallbacks: 0
        };
    }
    
    /**
     * Execute with cache-specific handling
     */
    async execute(operation, options = {}) {
        try {
            return await super.execute(operation);
        } catch (error) {
            // For cache, we can often fallback to no-cache operation
            if (this.fallbackToNoCache && options.allowFallback !== false) {
                this.cacheMetrics.fallbacks++;
                console.log(`📦 Cache unavailable, proceeding without cache`);
                return null; // Indicate cache miss
            }
            
            throw error;
        }
    }
    
    /**
     * Override to handle cache-specific errors
     */
    onFailureInternal(error, duration) {
        // Track specific error types
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            this.cacheMetrics.connectionFailures++;
        } else if (error.message && error.message.includes('OOM')) {
            this.cacheMetrics.memoryErrors++;
        } else if (error.code === 'ETIMEDOUT') {
            this.cacheMetrics.timeouts++;
        }
        
        super.onFailureInternal(error, duration);
    }
}

/**
 * Service Circuit Breaker Manager
 * Coordinates circuit breakers across all services
 */
class ServiceCircuitBreakerManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.services = options.services || {};
        this.globalConcurrencyManager = options.globalConcurrencyManager;
        this.breakers = new Map();
        this.protectiveMode = false;
        this.systemMetrics = {
            cpuUsage: 0,
            memoryUsage: 0,
            activeConnections: 0
        };
        
        // Initialize default circuit breakers
        this.initializeDefaultBreakers();
        
        console.log('🔌 ServiceCircuitBreakerManager initialized');
    }
    
    /**
     * Initialize default circuit breakers
     */
    initializeDefaultBreakers() {
        // DeepSeek API
        if (this.services.llm) {
            this.registerService('deepseek', this.services.llm, {
                failureThreshold: 5,
                requestTimeout: 10000,
                service: this.services.llm
            }, DeepSeekCircuitBreaker);
        }
        
        // Neo4j Database
        if (this.services.neo4j) {
            this.registerService('neo4j', this.services.neo4j, {
                failureThreshold: 3,
                connectionTimeout: 5000,
                client: this.services.neo4j
            }, Neo4jCircuitBreaker);
        }
        
        // Redis Cache
        if (this.services.redis) {
            this.registerService('redis', this.services.redis, {
                failureThreshold: 5,
                client: this.services.redis,
                fallbackToNoCache: true
            }, RedisCircuitBreaker);
        }
    }
    
    /**
     * Register a service with circuit breaker
     */
    registerService(name, service, options = {}, BreakerClass = CircuitBreaker) {
        const breaker = new BreakerClass({
            name,
            ...options,
            onStateChange: (oldState, newState) => {
                this.handleStateChange(name, oldState, newState);
            }
        });
        
        this.breakers.set(name, {
            service,
            breaker,
            dependencies: options.dependencies || []
        });
        
        console.log(`📝 Registered circuit breaker for ${name}`);
    }
    
    /**
     * Execute operation with circuit breaker
     */
    async executeWithBreaker(serviceName, operation, options = {}) {
        const serviceInfo = this.breakers.get(serviceName);
        
        if (!serviceInfo) {
            throw new Error(`Unknown service: ${serviceName}`);
        }
        
        // Check if service is protected
        if (this.isServiceProtected(serviceName)) {
            const limit = this.getConcurrencyLimit(serviceName);
            console.warn(`⚠️  Service ${serviceName} is in protective mode (limit: ${limit})`);
        }
        
        // Acquire global permit if integrated
        let permit = null;
        if (this.globalConcurrencyManager) {
            permit = await this.globalConcurrencyManager.acquire(serviceName, {
                timeout: options.timeout || 30000
            });
        }
        
        try {
            return await serviceInfo.breaker.execute(operation, options);
        } finally {
            if (permit) {
                await this.globalConcurrencyManager.release(permit.id);
            }
        }
    }
    
    /**
     * Handle circuit breaker state changes
     */
    handleStateChange(serviceName, oldState, newState) {
        console.log(`🔀 Circuit breaker ${serviceName}: ${oldState} → ${newState}`);
        
        if (newState === 'OPEN') {
            this.checkForCascadingFailures();
        }
        
        this.emit('stateChange', { serviceName, oldState, newState });
    }
    
    /**
     * Check for cascading failures
     */
    checkForCascadingFailures() {
        const openBreakers = [];
        
        for (const [name, info] of this.breakers) {
            if (info.breaker.getState() === 'OPEN') {
                openBreakers.push(name);
            }
        }
        
        if (openBreakers.length >= 2) {
            this.activateProtectiveMode();
        }
    }
    
    /**
     * Activate protective mode
     */
    activateProtectiveMode() {
        this.protectiveMode = true;
        console.warn('🛡️  Protective mode activated - reducing thresholds');
        
        // Adjust all circuit breaker thresholds
        for (const [name, info] of this.breakers) {
            const breaker = info.breaker;
            if (breaker.getState() === 'CLOSED') {
                // Reduce failure threshold for healthy services
                breaker.failureThreshold = Math.max(1, Math.floor(breaker.failureThreshold * 0.5));
            }
        }
        
        this.emit('protectiveMode', { activated: true });
    }
    
    /**
     * Get circuit breaker
     */
    getCircuitBreaker(serviceName) {
        const info = this.breakers.get(serviceName);
        return info ? info.breaker : null;
    }
    
    /**
     * Check if in protective mode
     */
    isInProtectiveMode() {
        return this.protectiveMode;
    }
    
    /**
     * Check if service is protected
     */
    isServiceProtected(serviceName) {
        const info = this.breakers.get(serviceName);
        if (!info) return false;
        
        // Check if any dependencies have open circuits
        for (const dep of info.dependencies) {
            const depInfo = this.breakers.get(dep);
            if (depInfo && depInfo.breaker.getState() === 'OPEN') {
                return true;
            }
        }
        
        return this.protectiveMode;
    }
    
    /**
     * Get adjusted concurrency limit
     */
    getConcurrencyLimit(serviceName) {
        let baseLimit = 50;
        
        if (this.protectiveMode) {
            baseLimit = Math.floor(baseLimit * 0.5);
        }
        
        // Further reduce based on system metrics
        if (this.systemMetrics.cpuUsage > 80) {
            baseLimit = Math.floor(baseLimit * 0.7);
        }
        
        if (this.systemMetrics.memoryUsage > 85) {
            baseLimit = Math.floor(baseLimit * 0.7);
        }
        
        return Math.max(1, baseLimit);
    }
    
    /**
     * Get adjusted concurrency limit for a service
     */
    getAdjustedConcurrencyLimit(serviceName) {
        return this.getConcurrencyLimit(serviceName);
    }
    
    /**
     * Update system metrics
     */
    updateSystemMetrics(metrics) {
        this.systemMetrics = { ...this.systemMetrics, ...metrics };
        
        // Check if we should exit protective mode
        if (this.protectiveMode && 
            this.systemMetrics.cpuUsage < 60 &&
            this.systemMetrics.memoryUsage < 70) {
            
            const allHealthy = Array.from(this.breakers.values())
                .every(info => info.breaker.getState() !== 'OPEN');
            
            if (allHealthy) {
                this.deactivateProtectiveMode();
            }
        }
    }
    
    /**
     * Deactivate protective mode
     */
    deactivateProtectiveMode() {
        this.protectiveMode = false;
        console.log('✅ Protective mode deactivated');
        
        // Reset thresholds
        this.initializeDefaultBreakers();
        
        this.emit('protectiveMode', { activated: false });
    }
    
    /**
     * Get health status
     */
    async getHealthStatus() {
        const services = {};
        
        for (const [name, info] of this.breakers) {
            const breaker = info.breaker;
            const health = await breaker.healthCheck();
            
            services[name] = {
                ...health,
                state: breaker.getState(),
                metrics: breaker.getMetrics()
            };
        }
        
        const unhealthyCount = Object.values(services).filter(s => !s.healthy).length;
        
        return {
            overall: unhealthyCount === 0 ? 'healthy' : 
                     unhealthyCount < this.breakers.size / 2 ? 'degraded' : 'unhealthy',
            services,
            protectiveMode: this.protectiveMode,
            recommendations: this.getHealthRecommendations(services),
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Get health recommendations
     */
    getHealthRecommendations(services) {
        const recommendations = [];
        
        for (const [name, health] of Object.entries(services)) {
            if (health.state === 'OPEN') {
                recommendations.push(`Service ${name} is down - check logs and connectivity`);
            } else if (health.successRate < 90) {
                recommendations.push(`Service ${name} has low success rate (${health.successRate.toFixed(1)}%)`);
            }
        }
        
        if (this.protectiveMode) {
            recommendations.push('System in protective mode - investigate root cause of failures');
        }
        
        return recommendations;
    }
    
    /**
     * Detect unhealthy patterns
     */
    detectUnhealthyPatterns() {
        const patterns = [];
        
        // Check for intermittent failures
        for (const [name, info] of this.breakers) {
            const metrics = info.breaker.getMetrics();
            const successRate = metrics.circuit_breaker_success_rate;
            
            if (successRate > 60 && successRate < 90) {
                patterns.push('intermittent_failures');
                break;
            }
        }
        
        // Check for degraded performance
        if (this.systemMetrics.cpuUsage > 70 || this.systemMetrics.memoryUsage > 80) {
            patterns.push('degraded_performance');
        }
        
        // Check for cascading failures
        const openCount = Array.from(this.breakers.values())
            .filter(info => info.breaker.getState() === 'OPEN').length;
        
        if (openCount > 1) {
            patterns.push('cascading_failures');
        }
        
        return patterns;
    }
    
    /**
     * Get adapted configuration based on system state
     */
    getAdaptedConfiguration() {
        const config = {
            deepseek: { failureThreshold: 5, resetTimeout: 30000 },
            neo4j: { failureThreshold: 3, resetTimeout: 60000 },
            redis: { failureThreshold: 5, resetTimeout: 20000 },
            concurrencyReduction: 0
        };
        
        // Adapt based on system load
        if (this.systemMetrics.cpuUsage > 80) {
            config.deepseek.failureThreshold = 7;
            config.neo4j.resetTimeout = 90000;
            config.concurrencyReduction += 20;
        }
        
        if (this.systemMetrics.memoryUsage > 85) {
            config.deepseek.failureThreshold = 8;
            config.redis.failureThreshold = 7;
            config.concurrencyReduction += 30;
        }
        
        return config;
    }
    
    /**
     * Get backoff time for a service
     */
    getBackoffTime(serviceName) {
        const info = this.breakers.get(serviceName);
        if (!info) return 0;
        
        const breaker = info.breaker;
        if (breaker.getRateLimitBackoff) {
            return breaker.getRateLimitBackoff();
        }
        
        return 0;
    }
}

module.exports = {
    DeepSeekCircuitBreaker,
    Neo4jCircuitBreaker,
    RedisCircuitBreaker,
    ServiceCircuitBreakerManager
};