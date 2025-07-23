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
        
        console.log(`⚙️  WorkerPoolConfig initialized for ${environment} environment`);
        this.logConfiguration();
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
        // HARD LIMIT: Never exceed 150 concurrent agents
        const ABSOLUTE_MAX_CONCURRENCY = 150;
        
        // Check for forced override first
        const forcedConcurrency = process.env.FORCE_MAX_CONCURRENCY;
        if (forcedConcurrency) {
            const forced = parseInt(forcedConcurrency);
            if (!isNaN(forced) && forced > 0) {
                const capped = Math.min(forced, ABSOLUTE_MAX_CONCURRENCY);
                if (forced > ABSOLUTE_MAX_CONCURRENCY) {
                    console.warn(`⚠️  Requested concurrency ${forced} exceeds hard limit of ${ABSOLUTE_MAX_CONCURRENCY}. Using ${ABSOLUTE_MAX_CONCURRENCY}.`);
                }
                console.log(`⚙️  Using forced max global concurrency: ${capped}`);
                return {
                    maxGlobalConcurrency: capped,
                    minWorkerConcurrency: 1,
                    maxWorkerConcurrency: Math.min(Math.ceil(capped / 2), 75), // Allow up to half but cap at 75
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
            maxGlobalConcurrency: Math.min(Math.max(maxGlobalConcurrency, 5), ABSOLUTE_MAX_CONCURRENCY),
            minWorkerConcurrency: 1,
            maxWorkerConcurrency: this.environment === 'production' ? 25 : 50,
            
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
                baseConcurrency: Math.floor((this.environment === 'production' ? 3 : 5) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 15 : 20) * maxScale), 40),
                minConcurrency: 1,
                jobTimeout: 180000, // 3 minutes for LLM calls
                retryAttempts: 2,
                retryDelay: 10000,
                priority: 10, // Highest priority
                description: 'Analyzes source code files using LLM'
            },
            
            'llm-analysis': {
                ...baseConfig,
                baseConcurrency: Math.floor((this.environment === 'production' ? 2 : 3) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 10 : 15) * maxScale), 30),
                minConcurrency: 1,
                jobTimeout: 240000, // 4 minutes for complex LLM analysis
                retryAttempts: 2,
                retryDelay: 15000,
                priority: 10, // Highest priority
                description: 'Performs deep LLM analysis tasks'
            },
            
            'validation': {
                ...baseConfig,
                baseConcurrency: Math.floor((this.environment === 'production' ? 6 : 8) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 20 : 30) * maxScale), 50),
                minConcurrency: 2,
                jobTimeout: 60000, // 1 minute for validation
                retryAttempts: 3,
                retryDelay: 3000,
                priority: 9,
                description: 'Validates analysis results and data consistency'
            },
            
            'graph-ingestion': {
                ...baseConfig,
                baseConcurrency: Math.floor((this.environment === 'production' ? 4 : 6) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 15 : 25) * maxScale), 40),
                minConcurrency: 1,
                jobTimeout: 120000, // 2 minutes for graph operations
                retryAttempts: 3,
                retryDelay: 5000,
                priority: 8,
                description: 'Ingests data into knowledge graph'
            },
            
            'directory-aggregation': {
                ...baseConfig,
                baseConcurrency: Math.floor((this.environment === 'production' ? 3 : 4) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 12 : 20) * maxScale), 30),
                minConcurrency: 1,
                jobTimeout: 90000, // 1.5 minutes
                retryAttempts: 2,
                retryDelay: 5000,
                priority: 7,
                description: 'Aggregates analysis results by directory'
            },
            
            'relationship-resolution': {
                ...baseConfig,
                baseConcurrency: Math.floor((this.environment === 'production' ? 3 : 4) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 12 : 20) * maxScale), 30),
                minConcurrency: 1,
                jobTimeout: 150000, // 2.5 minutes
                retryAttempts: 2,
                retryDelay: 7000,
                priority: 6,
                description: 'Resolves relationships between code elements'
            },
            
            'global-resolution': {
                ...baseConfig,
                baseConcurrency: Math.floor((this.environment === 'production' ? 2 : 3) * baseScale),
                maxConcurrency: Math.min(Math.floor((this.environment === 'production' ? 8 : 15) * maxScale), 25),
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
        // Adjust based on environment and expected API limits
        const rateLimitMultiplier = this.environment === 'production' ? 0.8 : 1.0;
        
        return {
            default: {
                requests: Math.floor(10 * rateLimitMultiplier),
                window: 1000
            },
            
            'file-analysis': {
                requests: Math.floor(6 * rateLimitMultiplier), // Conservative for DeepSeek
                window: 1000,
                burst: Math.floor(12 * rateLimitMultiplier),
                burstWindow: 5000
            },
            
            'llm-analysis': {
                requests: Math.floor(4 * rateLimitMultiplier), // Most conservative
                window: 1000,
                burst: Math.floor(8 * rateLimitMultiplier),
                burstWindow: 5000
            },
            
            'validation': {
                requests: Math.floor(15 * rateLimitMultiplier),
                window: 1000,
                burst: Math.floor(25 * rateLimitMultiplier),
                burstWindow: 5000
            },
            
            'graph-ingestion': {
                requests: Math.floor(12 * rateLimitMultiplier),
                window: 1000,
                burst: Math.floor(20 * rateLimitMultiplier),
                burstWindow: 5000
            },
            
            'directory-aggregation': {
                requests: Math.floor(10 * rateLimitMultiplier),
                window: 1000
            },
            
            'relationship-resolution': {
                requests: Math.floor(8 * rateLimitMultiplier),
                window: 1000
            },
            
            'global-resolution': {
                requests: Math.floor(6 * rateLimitMultiplier),
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
                failureThreshold: 3, // Lower threshold for LLM failures
                resetTimeout: 90000 // Longer reset for API issues
            },
            
            'llm-analysis': {
                ...baseConfig,
                failureThreshold: 3,
                resetTimeout: 120000 // Longest reset for complex LLM issues
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
                failureThreshold: 4,
                resetTimeout: 60000
            },
            
            'global-resolution': {
                ...baseConfig,
                failureThreshold: 3,
                resetTimeout: 90000
            }
        };
    }

    /**
     * Get monitoring configuration
     */
    getMonitoringConfig() {
        return {
            enabled: true,
            
            // System monitoring
            systemMonitoring: {
                enabled: true,
                interval: 5000, // 5 seconds
                reportInterval: 60000, // 1 minute
                historySize: 120, // 2 hours at 1-minute intervals
                
                // Thresholds
                cpuWarningThreshold: this.environment === 'production' ? 70 : 75,
                cpuCriticalThreshold: this.environment === 'production' ? 85 : 90,
                memoryWarningThreshold: this.environment === 'production' ? 75 : 80,
                memoryCriticalThreshold: this.environment === 'production' ? 90 : 95,
                
                // Predictive scaling
                enablePredictiveScaling: this.environment === 'production',
                predictionHorizon: 300000, // 5 minutes
                trendWindowSize: 20
            },
            
            // Worker monitoring
            workerMonitoring: {
                enabled: true,
                metricsInterval: 30000, // 30 seconds
                healthCheckInterval: 60000, // 1 minute
                alertThresholds: {
                    errorRate: 15, // % of failed jobs
                    avgResponseTime: 120000, // 2 minutes
                    queueBacklog: 100 // jobs waiting
                }
            },
            
            // Performance tracking
            performanceTracking: {
                enabled: true,
                trackingInterval: 10000, // 10 seconds
                metricsRetention: 86400000, // 24 hours
                slowJobThreshold: 60000 // 1 minute
            }
        };
    }

    /**
     * Get health check configuration
     */
    getHealthCheckConfig() {
        return {
            enabled: true,
            
            // Global health check
            global: {
                interval: 30000, // 30 seconds
                timeout: 5000, // 5 seconds
                retries: 3,
                retryDelay: 1000
            },
            
            // Worker health checks
            workers: {
                interval: 60000, // 1 minute
                timeout: 10000, // 10 seconds
                failureThreshold: 3, // consecutive failures
                recoveryThreshold: 2 // consecutive successes
            },
            
            // Dependency health checks
            dependencies: {
                enabled: true,
                interval: 120000, // 2 minutes
                checks: [
                    'database',
                    'cache',
                    'llm_api',
                    'queue_manager'
                ]
            },
            
            // Alert configuration
            alerts: {
                enabled: true,
                channels: ['console', 'log'], // Could extend to email, slack, etc.
                cooldown: 300000, // 5 minutes between similar alerts
                escalation: {
                    enabled: this.environment === 'production',
                    threshold: 3, // escalate after 3 consecutive failures
                    interval: 600000 // 10 minutes
                }
            }
        };
    }

    /**
     * Get scaling configuration
     */
    getScalingConfig() {
        return {
            enabled: true,
            
            // Scaling policies
            policies: {
                cpu: {
                    enabled: true,
                    scaleUpThreshold: 75,
                    scaleDownThreshold:30,
                    cooldown: 60000, // 1 minute
                    maxScaleUp: 2.0, // 2x max increase
                    maxScaleDown: 0.5 // 50% max decrease
                },
                
                memory: {
                    enabled: true,
                    scaleUpThreshold: 80,
                    scaleDownThreshold: 40,
                    cooldown: 90000, // 1.5 minutes
                    maxScaleUp: 1.5, // 1.5x max increase  
                    maxScaleDown: 0.6 // 60% max decrease
                },
                
                queue: {
                    enabled: true,
                    scaleUpThreshold: 50, // jobs in queue
                    scaleDownThreshold: 5,
                    cooldown: 30000, // 30 seconds
                    maxScaleUp: 3.0, // 3x max increase
                    maxScaleDown: 0.3 // 30% max decrease
                },
                
                error: {
                    enabled: true,
                    errorRateThreshold: 20, // % of failed jobs
                    scaleDownFactor: 0.7, // Scale down to 70%
                    cooldown: 120000 // 2 minutes
                }
            },
            
            // Scaling limits
            limits: {
                minConcurrencyGlobal: 3,
                maxConcurrencyGlobal: this.config?.global?.maxGlobalConcurrency || 50,
                minConcurrencyPerWorker: 1,
                maxConcurrencyPerWorker: this.config?.global?.maxWorkerConcurrency || 25
            },
            
            // Advanced scaling
            advanced: {
                predictiveScaling: this.environment === 'production',
                loadBalancing: true,
                priorityBasedScaling: true,
                resourceAwareScaling: true
            }
        };
    }

    /**
     * Get configuration for a specific worker type
     */
    getWorkerConfig(workerType) {
        const workerConfig = this.config.workers[workerType];
        if (!workerConfig) {
            console.warn(`⚠️  No specific configuration found for worker type '${workerType}', using defaults`);
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
        
        console.log(`⚙️  Configuration updated: ${path} = ${value} (was: ${oldValue})`);
        
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
            console.error('❌ Configuration validation failed:');
            issues.forEach(issue => console.error(`   - ${issue}`));
            return false;
        }
        
        console.log('✅ Configuration validation passed');
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
                console.log('✅ Configuration loaded successfully');
                return true;
            } else {
                console.error('❌ Loaded configuration is invalid');
                return false;
            }
        } catch (error) {
            console.error('❌ Failed to load configuration:', error.message);
            return false;
        }
    }

    /**
     * Log current configuration
     */
    logConfiguration() {
        console.log('⚙️  Worker Pool Configuration Summary:');
        console.log(`   Environment: ${this.environment}`);
        console.log(`   System: ${this.systemInfo.cpuCores} cores, ${this.systemInfo.totalMemoryGB}GB RAM`);
        console.log(`   Max Global Concurrency: ${this.config.global.maxGlobalConcurrency}`);
        console.log(`   Worker Types: ${Object.keys(this.config.workers).length}`);
        console.log(`   Rate Limits: ${Object.keys(this.config.rateLimits).length} configured`);
        console.log(`   Circuit Breakers: ${Object.keys(this.config.circuitBreakers).length} configured`);
        console.log(`   Monitoring: ${this.config.monitoring.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Health Checks: ${this.config.healthChecks.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Auto Scaling: ${this.config.scaling.enabled ? 'Enabled' : 'Disabled'}`);
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