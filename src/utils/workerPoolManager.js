/**
 * Worker Pool Manager - Intelligent Concurrency Control System
 * 
 * Features:
 * - Adaptive concurrency based on system resources
 * - Rate limiting for API calls per worker type
 * - Circuit breaker integration for fault tolerance
 * - Worker prioritization and load balancing
 * - Health monitoring and metrics collection
 * - Resource-aware scaling
 */

const os = require('os');
const { EventEmitter } = require('events');
const { registry } = require('./circuitBreaker');

class WorkerPoolManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Set environment first
        const environment = options.environment || process.env.NODE_ENV || 'development';
        
        // HARD LIMIT: Never exceed 150 concurrent agents
        const ABSOLUTE_MAX_CONCURRENCY = 150;
        
        // Get high performance mode flag early
        const highPerformanceMode = process.env.HIGH_PERFORMANCE_MODE === 'true';
        
        // Configuration
        this.config = {
            // Environment-specific settings (set first)
            environment,
            
            // Global concurrency limits - HARD CAPPED at 150
            maxGlobalConcurrency: Math.min(
                options.maxGlobalConcurrency || this.calculateMaxConcurrency(environment),
                ABSOLUTE_MAX_CONCURRENCY
            ),
            minWorkerConcurrency: options.minWorkerConcurrency || 1,
            maxWorkerConcurrency: options.maxWorkerConcurrency || 75, // Increased to support 150 agents
            
            // Resource monitoring
            cpuThreshold: options.cpuThreshold || parseInt(process.env.CPU_THRESHOLD) || 80, // CPU % threshold
            memoryThreshold: options.memoryThreshold || parseInt(process.env.MEMORY_THRESHOLD) || 85, // Memory % threshold
            
            // High performance mode
            highPerformanceMode: highPerformanceMode,
            disableResourceScaling: process.env.DISABLE_RESOURCE_SCALING === 'true',
            
            // Adaptive scaling
            scaleUpFactor: options.scaleUpFactor || 1.5,
            scaleDownFactor: options.scaleDownFactor || 0.7,
            adaptiveInterval: options.adaptiveInterval || 30000, // 30 seconds
            
            // Rate limiting (per worker type) - More permissive for better throughput
            rateLimits: {
                default: { requests: highPerformanceMode ? 30 : 15, window: 1000 }, // Double in high perf mode
                'file-analysis': { requests: highPerformanceMode ? 25 : 12, window: 1000 }, // Increased for 150 agents
                'llm-analysis': { requests: highPerformanceMode ? 20 : 8, window: 1000 }, // Increased but still respect API
                'validation': { requests: highPerformanceMode ? 40 : 20, window: 1000 }, // Can handle more
                'graph-ingestion': { requests: highPerformanceMode ? 30 : 15, window: 1000 },
                ...options.rateLimits
            },
            
            // Worker priorities (higher = more important)
            workerPriorities: {
                'file-analysis': 10,
                'validation': 9,
                'graph-ingestion': 8,
                'directory-aggregation': 7,
                'relationship-resolution': 6,
                'global-resolution': 5,
                ...options.workerPriorities
            }
        };
        
        // State management
        this.workers = new Map(); // worker type -> worker info
        this.currentConcurrency = 0;
        this.rateLimiters = new Map(); // worker type -> rate limiter
        this.metrics = {
            startTime: Date.now(),
            totalRequests: 0,
            activeRequests: 0,
            completedRequests: 0,
            failedRequests: 0,
            throttledRequests: 0,
            resourceScalings: 0,
            lastResourceCheck: Date.now()
        };
        
        // Resource monitoring
        this.resourceMonitor = null;
        this.lastCpuUsage = process.cpuUsage();
        this.lastMemoryUsage = process.memoryUsage();
        
        // Initialize subsystems
        this.initializeRateLimiters();
        this.startResourceMonitoring();
        this.startAdaptiveScaling();
        
        console.log(`🎯 WorkerPoolManager initialized (max global concurrency: ${this.config.maxGlobalConcurrency})`);
        this.logConfiguration();
    }

    /**
     * Calculate maximum concurrency based on system resources
     */
    calculateMaxConcurrency(environment) {
        // HARD LIMIT: Never exceed 150
        const ABSOLUTE_MAX = 150;
        
        // Check for forced override first
        const forcedConcurrency = process.env.FORCE_MAX_CONCURRENCY;
        if (forcedConcurrency) {
            const forced = parseInt(forcedConcurrency);
            if (!isNaN(forced) && forced > 0) {
                const capped = Math.min(forced, ABSOLUTE_MAX);
                if (forced > ABSOLUTE_MAX) {
                    console.warn(`⚠️  Requested concurrency ${forced} exceeds hard limit of ${ABSOLUTE_MAX}. Using ${ABSOLUTE_MAX}.`);
                }
                console.log(`🎯 Using forced max global concurrency: ${capped} (from FORCE_MAX_CONCURRENCY)`);
                return capped;
            }
        }
        
        const cpuCount = os.cpus().length;
        const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);
        
        // More generous base calculation: 3x CPU cores + memory factor
        let maxConcurrency = Math.floor(cpuCount * 3 + totalMemoryGB / 1.5);
        
        // Environment adjustments - more generous across the board
        switch (environment) {
            case 'production':
                maxConcurrency = Math.floor(maxConcurrency * 0.9); // Less conservative
                break;
            case 'development':
                maxConcurrency = Math.floor(maxConcurrency * 1.5); // More aggressive
                break;
            case 'test':
                maxConcurrency = Math.min(maxConcurrency, 20); // Higher limit for testing
                break;
        }
        
        // Higher minimums to prevent blocking
        const minimum = environment === 'test' ? 10 : 15;
        const result = Math.min(Math.max(maxConcurrency, minimum), ABSOLUTE_MAX);
        
        console.log(`🎯 Calculated max global concurrency: ${result} (CPU: ${cpuCount}, Memory: ${totalMemoryGB.toFixed(1)}GB, Environment: ${environment})`);
        return result;
    }

    /**
     * Register a worker with the pool manager
     */
    registerWorker(workerType, options = {}) {
        const priority = this.config.workerPriorities[workerType] || 5;
        const initialConcurrency = this.calculateInitialConcurrency(workerType, priority);
        
        const workerInfo = {
            type: workerType,
            priority,
            concurrency: initialConcurrency,
            maxConcurrency: options.maxConcurrency || this.config.maxWorkerConcurrency,
            minConcurrency: options.minConcurrency || this.config.minWorkerConcurrency,
            activeJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            lastActivity: Date.now(),
            circuitBreaker: registry.get(`worker-${workerType}`, {
                failureThreshold: options.failureThreshold || 5,
                resetTimeout: options.resetTimeout || 60000,
                onStateChange: (oldState, newState) => {
                    this.handleCircuitBreakerStateChange(workerType, oldState, newState);
                }
            }),
            rateLimiter: this.rateLimiters.get(workerType),
            metrics: {
                avgProcessingTime: 0,
                throughput: 0,
                errorRate: 0,
                lastCalculated: Date.now()
            }
        };
        
        this.workers.set(workerType, workerInfo);
        this.updateCurrentConcurrency();
        
        console.log(`📝 Registered worker '${workerType}' (concurrency: ${initialConcurrency}, priority: ${priority})`);
        this.emit('workerRegistered', workerInfo);
        
        return workerInfo;
    }

    /**
     * Get optimal concurrency for a worker
     */
    getWorkerConcurrency(workerType) {
        const worker = this.workers.get(workerType);
        if (!worker) {
            console.warn(`⚠️  Unknown worker type: ${workerType}`);
            return this.config.minWorkerConcurrency;
        }
        
        return worker.concurrency;
    }

    /**
     * Request permission to process a job
     */
    async requestJobSlot(workerType, jobData = {}) {
        const worker = this.workers.get(workerType);
        if (!worker) {
            throw new Error(`Worker type '${workerType}' not registered`);
        }
        
        // HARD CHECK: Never exceed 150 concurrent agents
        if (this.currentConcurrency >= 150) {
            this.metrics.throttledRequests++;
            console.error(`🚫 HARD LIMIT: Cannot exceed 150 concurrent agents. Current: ${this.currentConcurrency}`);
            throw new Error('Maximum concurrent agent limit (150) reached');
        }
        
        // Check global concurrency limit with buffer
        if (this.currentConcurrency >= this.config.maxGlobalConcurrency) {
            this.metrics.throttledRequests++;
            console.warn(`⚠️  Global concurrency limit reached: ${this.currentConcurrency}/${this.config.maxGlobalConcurrency}`);
            throw new Error('Global concurrency limit reached');
        }
        
        // Check worker-specific concurrency with logging for debugging
        if (worker.activeJobs >= worker.concurrency) {
            this.metrics.throttledRequests++;
            console.warn(`⚠️  Worker '${workerType}' concurrency limit reached: ${worker.activeJobs}/${worker.concurrency}`);
            throw new Error(`Worker '${workerType}' concurrency limit reached`);
        }
        
        // Check rate limiting with more permissive logic
        if (!this.checkRateLimit(workerType)) {
            this.metrics.throttledRequests++;
            console.warn(`⚠️  Rate limit exceeded for worker '${workerType}'`);
            // Don't throw immediately, allow a small buffer for burst requests
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
            
            // Try again after brief delay
            if (!this.checkRateLimit(workerType)) {
                throw new Error(`Rate limit exceeded for worker '${workerType}'`);
            }
        }
        
        // Check circuit breaker
        if (worker.circuitBreaker.state === 'OPEN') {
            this.metrics.throttledRequests++;
            throw new Error(`Circuit breaker open for worker '${workerType}'`);
        }
        
        // Allocate slot
        worker.activeJobs++;
        this.currentConcurrency++;
        this.metrics.activeRequests++;
        this.metrics.totalRequests++;
        worker.lastActivity = Date.now();
        
        return {
            workerType,
            slotId: `${workerType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            concurrency: worker.concurrency,
            priority: worker.priority
        };
    }

    /**
     * Release a job slot
     */
    releaseJobSlot(workerType, success = true, processingTime = 0) {
        const worker = this.workers.get(workerType);
        if (!worker) {
            console.warn(`⚠️  Attempted to release slot for unknown worker: ${workerType}`);
            return;
        }
        
        // Update counters
        worker.activeJobs = Math.max(0, worker.activeJobs - 1);
        this.currentConcurrency = Math.max(0, this.currentConcurrency - 1);
        this.metrics.activeRequests = Math.max(0, this.metrics.activeRequests - 1);
        
        if (success) {
            worker.completedJobs++;
            this.metrics.completedRequests++;
        } else {
            worker.failedJobs++;
            this.metrics.failedRequests++;
        }
        
        // Update metrics
        this.updateWorkerMetrics(worker, processingTime, success);
        worker.lastActivity = Date.now();
    }

    /**
     * Execute operation with worker pool management
     */
    async executeWithManagement(workerType, operation, jobData = {}) {
        let slot = null;
        const startTime = Date.now();
        
        try {
            // Request slot
            slot = await this.requestJobSlot(workerType, jobData);
            
            // Execute with circuit breaker protection
            const worker = this.workers.get(workerType);
            const result = await worker.circuitBreaker.execute(operation);
            
            // Success
            const processingTime = Date.now() - startTime;
            this.releaseJobSlot(workerType, true, processingTime);
            
            return result;
            
        } catch (error) {
            // Failure
            const processingTime = Date.now() - startTime;
            if (slot) {
                this.releaseJobSlot(workerType, false, processingTime);
            }
            
            throw error;
        }
    }

    /**
     * Initialize rate limiters for all worker types
     */
    initializeRateLimiters() {
        for (const [workerType, limits] of Object.entries(this.config.rateLimits)) {
            this.rateLimiters.set(workerType, this.createRateLimiter(limits));
        }
        
        console.log(`⏱️  Initialized ${this.rateLimiters.size} rate limiters`);
    }

    /**
     * Create a token bucket rate limiter with burst capacity
     */
    createRateLimiter(config) {
        return {
            tokens: config.requests,
            maxTokens: config.requests,
            burstCapacity: Math.ceil(config.requests * 1.5), // Allow 50% burst
            refillRate: config.requests / (config.window / 1000),
            lastRefill: Date.now(),
            
            consume() {
                this.refill();
                if (this.tokens >= 1) {
                    this.tokens--;
                    return true;
                }
                // Allow burst if we haven't consumed too much recently
                if (this.tokens >= 0.5) { // Allow partial token consumption for burst
                    this.tokens -= 0.5;
                    return true;
                }
                return false;
            },
            
            refill() {
                const now = Date.now();
                const timePassed = (now - this.lastRefill) / 1000;
                const tokensToAdd = timePassed * this.refillRate;
                
                // Allow burst capacity but cap at burst limit
                this.tokens = Math.min(this.burstCapacity, this.tokens + tokensToAdd);
                this.lastRefill = now;
            },
            
            getAvailableTokens() {
                this.refill();
                return this.tokens;
            }
        };
    }

    /**
     * Check rate limiting for a worker type
     */
    checkRateLimit(workerType) {
        const rateLimiter = this.rateLimiters.get(workerType) || this.rateLimiters.get('default');
        return rateLimiter ? rateLimiter.consume() : true;
    }

    /**
     * Calculate initial concurrency for a worker
     */
    calculateInitialConcurrency(workerType, priority) {
        const baselineMap = {
            'file-analysis': 8,    // Increased baseline for file analysis
            'llm-analysis': 5,     // More reasonable for LLM calls
            'validation': 10,      // Can handle more
            'graph-ingestion': 8,
            'directory-aggregation': 6,
            'relationship-resolution': 6,
            'global-resolution': 5
        };
        
        const baseline = baselineMap[workerType] || 8; // Increased default
        
        // More aggressive concurrency calculation
        const priorityMultiplier = Math.max(0.8, priority / 10); // Higher minimum
        const resourceMultiplier = Math.min(2.0, this.config.maxGlobalConcurrency / 15); // More aggressive
        
        const calculated = Math.floor(baseline * priorityMultiplier * resourceMultiplier);
        const result = Math.max(
            this.config.minWorkerConcurrency,
            Math.min(calculated, this.config.maxWorkerConcurrency)
        );
        
        console.log(`🔧 [${workerType}] Calculated initial concurrency: ${result} (baseline: ${baseline}, priority: ${priority}, multipliers: ${priorityMultiplier.toFixed(2)}x${resourceMultiplier.toFixed(2)})`);
        return result;
    }

    /**
     * Update current total concurrency
     */
    updateCurrentConcurrency() {
        this.currentConcurrency = Array.from(this.workers.values())
            .reduce((total, worker) => total + worker.activeJobs, 0);
    }

    /**
     * Start resource monitoring
     */
    startResourceMonitoring() {
        this.resourceMonitor = setInterval(() => {
            this.checkSystemResources();
        }, 10000); // Check every 10 seconds
        
        console.log('📊 Resource monitoring started');
    }

    /**
     * Check system resources and trigger scaling if needed
     */
    checkSystemResources() {
        try {
            const cpuUsage = this.getCpuUsage();
            const memoryUsage = this.getMemoryUsage();
            
            this.metrics.lastResourceCheck = Date.now();
            
            // Log resource usage periodically
            if (Date.now() % 60000 < 10000) { // Every minute
                console.log(`📊 Resources - CPU: ${cpuUsage.toFixed(1)}%, Memory: ${memoryUsage.toFixed(1)}%`);
            }
            
            // Check for resource pressure
            const resourcePressure = this.calculateResourcePressure(cpuUsage, memoryUsage);
            
            if (resourcePressure > 0.8) {
                this.handleHighResourceUsage(cpuUsage, memoryUsage);
            } else if (resourcePressure < 0.3) {
                this.handleLowResourceUsage(cpuUsage, memoryUsage);
            }
            
            this.emit('resourceCheck', { cpuUsage, memoryUsage, resourcePressure });
            
        } catch (error) {
            console.error('❌ Error checking system resources:', error);
        }
    }

    /**
     * Get current CPU usage percentage
     */
    getCpuUsage() {
        const currentCpuUsage = process.cpuUsage();
        const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
        const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
        const totalDiff = userDiff + systemDiff;
        
        this.lastCpuUsage = currentCpuUsage;
        
        // Convert to percentage (rough approximation)
        return Math.min(100, (totalDiff / 1000000) * os.cpus().length);
    }

    /**
     * Get current memory usage percentage
     */
    getMemoryUsage() {
        const memoryUsage = process.memoryUsage();
        const totalMemory = os.totalmem();
        
        return (memoryUsage.rss / totalMemory) * 100;
    }

    /**
     * Calculate overall resource pressure (0-1 scale)
     */
    calculateResourcePressure(cpuUsage, memoryUsage) {
        const cpuPressure = cpuUsage / 100;
        const memoryPressure = memoryUsage / 100;
        
        // Weighted average (CPU weighted higher)
        return (cpuPressure * 0.7) + (memoryPressure * 0.3);
    }

    /**
     * Handle high resource usage by scaling down
     */
    handleHighResourceUsage(cpuUsage, memoryUsage) {
        // Skip scaling down if disabled or in high performance mode
        if (this.config.disableResourceScaling || this.config.highPerformanceMode) {
            console.log(`⚠️  High resource usage detected (CPU: ${cpuUsage.toFixed(1)}%, Memory: ${memoryUsage.toFixed(1)}%) but scaling is disabled`);
            return;
        }
        
        console.warn(`⚠️  High resource usage detected - CPU: ${cpuUsage.toFixed(1)}%, Memory: ${memoryUsage.toFixed(1)}%`);
        
        // Scale down concurrency for all workers
        for (const worker of this.workers.values()) {
            const newConcurrency = Math.max(
                worker.minConcurrency,
                Math.floor(worker.concurrency * this.config.scaleDownFactor)
            );
            
            if (newConcurrency < worker.concurrency) {
                worker.concurrency = newConcurrency;
                console.log(`📉 Scaled down '${worker.type}' concurrency to ${newConcurrency}`);
            }
        }
        
        this.metrics.resourceScalings++;
        this.emit('resourceScaling', { direction: 'down', cpuUsage, memoryUsage });
    }

    /**
     * Handle low resource usage by scaling up
     */
    handleLowResourceUsage(cpuUsage, memoryUsage) {
        // HARD CHECK: Never scale beyond 150 agents
        if (this.currentConcurrency >= 150 * 0.9) { // 135 agents
            console.log(`🚫 Near hard limit of 150 agents. Not scaling up.`);
            return;
        }
        
        if (this.currentConcurrency >= this.config.maxGlobalConcurrency * 0.8) {
            return; // Don't scale up if we're near global limit
        }
        
        // Scale up high-priority workers first
        const sortedWorkers = Array.from(this.workers.values())
            .sort((a, b) => b.priority - a.priority);
        
        for (const worker of sortedWorkers) {
            // HARD CHECK: Stop scaling if approaching 150 limit
            if (this.currentConcurrency >= 135) { // 90% of 150
                console.log(`🚫 Stopping scale up - approaching hard limit of 150 agents`);
                break;
            }
            
            if (this.currentConcurrency >= this.config.maxGlobalConcurrency * 0.8) {
                break;
            }
            
            const newConcurrency = Math.min(
                worker.maxConcurrency,
                Math.floor(worker.concurrency * this.config.scaleUpFactor)
            );
            
            if (newConcurrency > worker.concurrency) {
                worker.concurrency = newConcurrency;
                console.log(`📈 Scaled up '${worker.type}' concurrency to ${newConcurrency}`);
            }
        }
        
        this.updateCurrentConcurrency();
        this.metrics.resourceScalings++;
        this.emit('resourceScaling', { direction: 'up', cpuUsage, memoryUsage });
    }

    /**
     * Start adaptive scaling based on worker performance
     */
    startAdaptiveScaling() {
        setInterval(() => {
            this.performAdaptiveScaling();
        }, this.config.adaptiveInterval);
        
        console.log(`🔄 Adaptive scaling started (interval: ${this.config.adaptiveInterval}ms)`);
    }

    /**
     * Perform adaptive scaling based on worker metrics
     */
    performAdaptiveScaling() {
        for (const worker of this.workers.values()) {
            this.updateWorkerMetrics(worker);
            
            const shouldScale = this.shouldScaleWorker(worker);
            if (shouldScale.scale) {
                this.scaleWorker(worker, shouldScale.direction, shouldScale.reason);
            }
        }
    }

    /**
     * Update worker performance metrics
     */
    updateWorkerMetrics(worker, processingTime = null, success = true) {
        const now = Date.now();
        const timeDiff = now - worker.metrics.lastCalculated;
        
        if (timeDiff < 5000) return; // Don't update too frequently
        
        // Calculate throughput (jobs per second)
        const totalJobs = worker.completedJobs + worker.failedJobs;
        const timeWindow = (now - (worker.metrics.lastCalculated || now - 60000)) / 1000;
        worker.metrics.throughput = totalJobs / Math.max(timeWindow, 1);
        
        // Calculate error rate
        worker.metrics.errorRate = totalJobs > 0 ? (worker.failedJobs / totalJobs) * 100 : 0;
        
        // Update average processing time
        if (processingTime !== null) {
            worker.metrics.avgProcessingTime = worker.metrics.avgProcessingTime === 0
                ? processingTime
                : (worker.metrics.avgProcessingTime * 0.8) + (processingTime * 0.2);
        }
        
        worker.metrics.lastCalculated = now;
    }

    /**
     * Determine if a worker should be scaled
     */
    shouldScaleWorker(worker) {
        const utilization = worker.activeJobs / worker.concurrency;
        const errorRate = worker.metrics.errorRate;
        const avgResponseTime = worker.metrics.avgProcessingTime;
        
        // Scale up conditions
        if (utilization > 0.8 && errorRate < 5 && avgResponseTime < 30000) {
            return { scale: true, direction: 'up', reason: 'High utilization, low errors' };
        }
        
        // Scale down conditions
        if (utilization < 0.2 && worker.concurrency > worker.minConcurrency) {
            return { scale: true, direction: 'down', reason: 'Low utilization' };
        }
        
        if (errorRate > 20) {
            return { scale: true, direction: 'down', reason: 'High error rate' };
        }
        
        if (avgResponseTime > 60000) {
            return { scale: true, direction: 'down', reason: 'High response time' };
        }
        
        return { scale: false };
    }

    /**
     * Scale a worker up or down
     */
    scaleWorker(worker, direction, reason) {
        const oldConcurrency = worker.concurrency;
        
        if (direction === 'up') {
            worker.concurrency = Math.min(
                worker.maxConcurrency,
                Math.floor(worker.concurrency * 1.2)
            );
        } else {
            worker.concurrency = Math.max(
                worker.minConcurrency,
                Math.floor(worker.concurrency * 0.8)
            );
        }
        
        if (worker.concurrency !== oldConcurrency) {
            console.log(`🔄 Scaled ${direction} '${worker.type}': ${oldConcurrency} → ${worker.concurrency} (${reason})`);
            this.emit('workerScaled', { worker: worker.type, direction, oldConcurrency, newConcurrency: worker.concurrency, reason });
        }
    }

    /**
     * Handle circuit breaker state changes
     */
    handleCircuitBreakerStateChange(workerType, oldState, newState) {
        console.log(`🔀 Circuit breaker '${workerType}': ${oldState} → ${newState}`);
        
        if (newState === 'OPEN') {
            // Scale down when circuit opens
            const worker = this.workers.get(workerType);
            if (worker) {
                worker.concurrency = Math.max(worker.minConcurrency, Math.floor(worker.concurrency * 0.5));
                console.log(`📉 Emergency scale down '${workerType}' concurrency to ${worker.concurrency}`);
            }
        }
        
        this.emit('circuitBreakerStateChange', { workerType, oldState, newState });
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
}

module.exports = { WorkerPoolManager };