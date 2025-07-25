/**
 * Worker Pool Configuration
 * 
 * Centralized configuration for the worker pool management system.
 * Includes environment-specific settings and intelligent defaults.
 */

const os = require('os');

class WorkerPoolConfig {
    constructor(environment = process.env.NODE_ENV || 'development') {
        this.environment = environment;
        this.systemInfo = this.getSystemInfo();
        
        // Base configuration
        this.config = {
            // Environment
            environment,
            
            // Global settings
            global: this.getGlobalConfig(),
            
            // Worker-specific configurations
            workers: this.getWorkerConfigs(),
            
            // Rate limiting configurations
            rateLimits: this.getRateLimitConfigs(),
            
            // Circuit breaker configurations
            circuitBreakers: this.getCircuitBreakerConfigs(),
            
            // Resource monitoring
            monitoring: this.getMonitoringConfig(),
            
            // Health check settings
            healthChecks: this.getHealthCheckConfig(),
            
            // Scaling policies
            scaling: this.getScalingConfig()
        };
        
    }

    /**
     * Get system information for configuration decisions
     */
    getSystemInfo() {
        const cpus = os.cpus();
        const totalMemoryGB = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 100) / 100;
        
        return {
            cpuCores: cpus.length,
            cpuModel: cpus[0]?.model || 'Unknown',
            totalMemoryGB,
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version
        };
    }

    /**
     * Get global configuration
     */
    getGlobalConfig() {
        // HARD LIMIT: 100 total concurrent LLM API calls across ALL workers
        const ABSOLUTE_MAX_CONCURRENCY = 100;
        
        // Check for forced override first
        const forcedConcurrency = process.env.FORCE_MAX_CONCURRENCY;
        if (forcedConcurrency) {
            const forced = parseInt(forcedConcurrency);
            if (!isNaN(forced) && forced > 0) {
                const capped = Math.min(forced, ABSOLUTE_MAX_CONCURRENCY);
                if (forced > ABSOLUTE_MAX_CONCURRENCY) {
                    console.warn(`Requested concurrency ${forced} exceeds hard limit of ${ABSOLUTE_MAX_CONCURRENCY}. Using ${ABSOLUTE_MAX_CONCURRENCY}.`);
                }
                return {
                    maxGlobalConcurrency: capped,
                    minWorkerConcurrency: 1,
                    maxWorkerConcurrency: Math.floor(capped / 7), // Divide by 7 worker types for max per worker
                    cpuThreshold: parseInt(process.env.CPU_THRESHOLD) || 90,
                    memoryThreshold: parseInt(process.env.MEMORY_THRESHOLD) || 90,
                    scaleUpFactor: 1.3,
                    scaleDownFactor: 0.7,
                    adaptiveInterval: 30000,
                    shutdownTimeout: 30000,
                    gracefulShutdownWaitTime: 5000
                };
            }
        }
        
        // Calculate max concurrency based on system resources
        const baselineConcurrency = this.systemInfo.cpuCores * 2;
        const memoryFactor = Math.min(2, this.systemInfo.totalMemoryGB / 4);
        let maxGlobalConcurrency = Math.floor(baselineConcurrency * memoryFactor);
        
        // Environment-specific adjustments
        switch (this.environment) {
            case 'production':
                maxGlobalConcurrency = Math.floor(maxGlobalConcurrency * 0.8); // Conservative
                break;
            case 'development':
                maxGlobalConcurrency = Math.floor(maxGlobalConcurrency * 1.2); // More aggressive
                break;
            case 'test':
                maxGlobalConcurrency = Math.min(maxGlobalConcurrency, 10); // Limited for testing
                break;
        }
        
        return {
            maxGlobalConcurrency: ABSOLUTE_MAX_CONCURRENCY, // 100 total across all workers
            minWorkerConcurrency: 1,
            maxWorkerConcurrency: 50, // Max per worker type when distributing 100 total across all worker types
            
            // Resource thresholds
            cpuThreshold: this.environment === 'production' ? 75 : 80,
            memoryThreshold: this.environment === 'production' ? 80 : 85,
            
            // Scaling factors
            scaleUpFactor: 1.3,
            scaleDownFactor: 0.7,
            adaptiveInterval: 30000, // 30 seconds
            
            // Shutdown settings
            shutdownTimeout: 30000, // 30 seconds
            gracefulShutdownWaitTime: 5000 // 5 seconds between checks
        };
    }

    /**
     * Get worker-specific configurations
     */
    getWorkerConfigs() {
        const baseConfig = {
            jobTimeout: 300000, // 5 minutes
            retryAttempts: 2,
            retryDelay: 5000,
            enableHealthCheck: true,
            healthCheckInterval: 30000,
            enableMetrics: true,
            metricsReportInterval: 60000
        };
        
        // Check if we're in high performance mode
        const highPerf = process.env.HIGH_PERFORMANCE_MODE === 'true';
        const forcedMax = parseInt(process.env.FORCE_MAX_CONCURRENCY) || 0;
        
        // Scale factors for high performance mode
        const baseScale = highPerf ? 3 : 1;
        const maxScale = highPerf ? 2.5 : 1;
        
        return {
            'file-analysis': {
                ...baseConfig,
                baseConcurrency: 8,
                maxConcurrency: 40, // Part of total 100 limit
                minConcurrency: 1,
                jobTimeout: 180000, // 3 minutes for LLM calls
                retryAttempts: 2,
                retryDelay: 10000,
                priority: 10, // Highest priority
                description: 'Analyzes source code files using LLM'
            },
            
            'llm-analysis': {
                ...baseConfig,
                baseConcurrency: 6,
                maxConcurrency: 30, // Part of total 100 limit
                minConcurrency: 1,
                jobTimeout: 240000, // 4 minutes for complex LLM analysis
                retryAttempts: 2,
                retryDelay: 15000,
                priority: 10, // Highest priority
                description: 'Performs deep LLM analysis tasks'
            },
            
            'validation': {
                ...baseConfig,
                baseConcurrency: 4,
                maxConcurrency: 15, // Part of total 100 limit
                minConcurrency: 2,
                jobTimeout: 60000, // 1 minute for validation
                retryAttempts: 3,
                retryDelay: 3000,
                priority: 9,
                description: 'Validates analysis results and data consistency'
            },
            
            'graph-ingestion': {
                ...baseConfig,
                baseConcurrency: 2,
                maxConcurrency: 5, // Part of total 100 limit  
                minConcurrency: 1,
                jobTimeout: 120000, // 2 minutes for graph operations
                retryAttempts: 3,
                retryDelay: 5000,
                priority: 8,
                description: 'Ingests data into knowledge graph'
            },
            
            'directory-aggregation': {
                ...baseConfig,
                baseConcurrency: 2,
                maxConcurrency: 5, // Part of total 100 limit
                minConcurrency: 1,
                jobTimeout: 90000, // 1.5 minutes
                retryAttempts: 2,
                retryDelay: 5000,
                priority: 7,
                description: 'Aggregates analysis results by directory'
            },
            
            'relationship-resolution': {
                ...baseConfig,
                baseConcurrency: 3,
                maxConcurrency: 10, // Part of total 100 limit
                minConcurrency: 1,
                jobTimeout: 150000, // 2.5 minutes
                retryAttempts: 2,
                retryDelay: 7000,
                priority: 6,
                description: 'Resolves relationships between code elements'
            },
            
            'global-resolution': {
                ...baseConfig,
                baseConcurrency: 2,
                maxConcurrency: 5, // Part of total 100 limit
                minConcurrency: 1,
                jobTimeout: 200000, // 3.3 minutes
                retryAttempts: 2,
                retryDelay: 10000,
                priority: 5,
                description: 'Performs global resolution and optimization'
            }
        };
    }

    /**
     * Get rate limiting configurations
     */
    getRateLimitConfigs() {
        // Rate limiting effectively disabled - set to very high values
        // Only the global 100 agent limit matters
        
        return {
            default: {
                requests: 1000, // Very high - effectively no limit
                window: 1000
            },
            
            'file-analysis': {
                requests: 1000, // Very high - effectively no limit
                window: 1000,
                burst: 2000,
                burstWindow: 5000
            },
            
            'llm-analysis': {
                requests: 1000, // Very high - effectively no limit
                window: 1000,
                burst: 2000,
                burstWindow: 5000
            },
            
            'validation': {
                requests: 1000, // Very high - effectively no limit
                window: 1000,
                burst: 2000,
                burstWindow: 5000
            },
            
            'graph-ingestion': {
                requests: 1000, // Very high - effectively no limit
                window: 1000,
                burst: 2000,
                burstWindow: 5000
            },
            
            'directory-aggregation': {
                requests: 1000, // Very high - effectively no limit
                window: 1000
            },
            
            'relationship-resolution': {
                requests: 1000, // Very high - effectively no limit
                window: 1000
            },
            
            'global-resolution': {
                requests: 1000, // Very high - effectively no limit
                window: 1000
            }
        };
    }

    /**
     * Get circuit breaker configurations
     */
    getCircuitBreakerConfigs() {
        const baseConfig = {
            successThreshold: 2,
            halfOpenMaxCalls: 3,
            monitor: true
        };
        
        return {
            default: {
                ...baseConfig,
                failureThreshold: 5,
                resetTimeout: 60000
            },
            
            'file-analysis': {
                ...baseConfig,
                failureThreshold: 10, // Increased from 3 to be less aggressive
                resetTimeout: 30000 // Reduced from 90000 for faster recovery
            },
            
            'llm-analysis': {
                ...baseConfig,
                failureThreshold: 10, // Increased from 3 to be less aggressive
                resetTimeout: 30000 // Reduced from 120000 for faster recovery
            },
            
            'validation': {
                ...baseConfig,
                failureThreshold: 5,
                resetTimeout: 45000
            },
            
            'graph-ingestion': {
                ...baseConfig,
                failureThreshold: 4,
                resetTimeout: 60000
            },
            
            'directory-aggregation': {
                ...baseConfig,
                failureThreshold: 4,
                resetTimeout: 45000
            },
            
            'relationship-resolution': {
                ...baseConfig,
                failureThreshold: 10, // Increased from 4 to be less aggressive
                resetTimeout: 30000 // Reduced from 60000 for faster recovery
            },
            
            'global-resolution': {
                ...baseConfig,
                failureThreshold: 10, // Increased from 3 to be less aggressive
                resetTimeout: 30000 // Reduced from 90000 for faster recovery
            }
        };
    }

    getMonitoringConfig() {
        return {
            enabled: true,
            systemMonitoring: {
                enabled: false
            },
            workerMonitoring: {
                enabled: false
            },
            performanceTracking: {
                enabled: false
            }
        };
    }

    getHealthCheckConfig() {
        return {
            enabled: true,
            global: {
                interval: 60000,
                timeout: 5000
            },
            workers: {
                interval: 120000,
                timeout: 10000
            }
        };
    }

    getScalingConfig() {
        return {
            enabled: true,
            limits: {
                minConcurrencyGlobal: 3,
                maxConcurrencyGlobal: this.config?.global?.maxGlobalConcurrency || 100,
                minConcurrencyPerWorker: 1,
                maxConcurrencyPerWorker: this.config?.global?.maxWorkerConcurrency || 50
            }
        };
    }

    /**
     * Get configuration for a specific worker type
     */
    getWorkerConfig(workerType) {
        const workerConfig = this.config.workers[workerType];
        if (!workerConfig) {
            return this.config.workers.default || {};
        }
        
        return {
            ...workerConfig,
            rateLimits: this.config.rateLimits[workerType] || this.config.rateLimits.default,
            circuitBreaker: this.config.circuitBreakers[workerType] || this.config.circuitBreakers.default
        };
    }

    /**
     * Get rate limit configuration for a worker type
     */
    getRateLimitConfig(workerType) {
        return this.config.rateLimits[workerType] || this.config.rateLimits.default;
    }

    /**
     * Get circuit breaker configuration for a worker type
     */
    getCircuitBreakerConfig(workerType) {
        return this.config.circuitBreakers[workerType] || this.config.circuitBreakers.default;
    }

    /**
     * Update configuration at runtime
     */
    updateConfig(path, value) {
        const pathParts = path.split('.');
        let current = this.config;
        
        for (let i = 0; i < pathParts.length - 1; i++) {
            if (!current[pathParts[i]]) {
                current[pathParts[i]] = {};
            }
            current = current[pathParts[i]];
        }
        
        const oldValue = current[pathParts[pathParts.length - 1]];
        current[pathParts[pathParts.length - 1]] = value;
        
        
        return { path, oldValue, newValue: value };
    }

    /**
     * Validate configuration
     */
    validateConfig() {
        const issues = [];
        
        // Validate global settings
        if (this.config.global.maxGlobalConcurrency < this.config.global.minWorkerConcurrency) {
            issues.push('maxGlobalConcurrency must be >= minWorkerConcurrency');
        }
        
        // Validate worker configurations
        for (const [workerType, config] of Object.entries(this.config.workers)) {
            if (config.maxConcurrency < config.minConcurrency) {
                issues.push(`${workerType}: maxConcurrency must be >= minConcurrency`);
            }
            
            if (config.baseConcurrency > config.maxConcurrency) {
                issues.push(`${workerType}: baseConcurrency must be <= maxConcurrency`);
            }
        }
        
        // Validate rate limits
        for (const [workerType, config] of Object.entries(this.config.rateLimits)) {
            if (config.requests <= 0 || config.window <= 0) {
                issues.push(`${workerType}: rate limit requests and window must be > 0`);
            }
        }
        
        if (issues.length > 0) {
            console.error('Configuration validation failed:');
            issues.forEach(issue => console.error(`   - ${issue}`));
            return false;
        }
        
        return true;
    }

    /**
     * Export configuration to JSON
     */
    exportConfig() {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * Load configuration from JSON
     */
    loadConfig(configJson) {
        try {
            const loadedConfig = JSON.parse(configJson);
            this.config = { ...this.config, ...loadedConfig };
            
            if (this.validateConfig()) {
                return true;
            } else {
                console.error('Loaded configuration is invalid');
                return false;
            }
        } catch (error) {
            console.error('Failed to load configuration:', error.message);
            return false;
        }
    }


    /**
     * Get complete configuration
     */
    getConfig() {
        return this.config;
    }
}

// Export singleton instance
module.exports = { WorkerPoolConfig };