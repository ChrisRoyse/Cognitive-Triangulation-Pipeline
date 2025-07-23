/**
 * Centralized Pipeline Configuration
 * 
 * This class provides a single source of truth for all pipeline configuration,
 * including worker concurrency limits, database settings, and performance thresholds.
 * 
 * Key Features:
 * - Hard concurrency limits to prevent system overload
 * - Dynamic worker allocation based on system resources
 * - Environment-specific configurations
 * - Configuration validation and error handling
 */

class PipelineConfig {
    constructor(options = {}) {
        // Environment detection
        this.environment = options.environment || process.env.NODE_ENV || 'development';
        
        // ===== HARD LIMITS =====
        // These are absolute maximums that should NEVER be exceeded
        this.ABSOLUTE_MAX_CONCURRENCY = 150; // System-wide hard limit
        this.TOTAL_WORKER_CONCURRENCY = 100;  // Worker-specific hard limit
        
        // ===== WORKER CONCURRENCY LIMITS =====
        // Carefully calibrated to total exactly 100 workers
        this.workerLimits = {
            'file-analysis': 40,           // Most CPU intensive
            'relationship-resolution': 30,  // Memory intensive + LLM calls
            'directory-aggregation': 10,    // I/O intensive
            'validation': 15,               // CPU + memory intensive
            'graph-ingestion': 5           // Database + network intensive
        };
        
        // Validate that worker limits don't exceed total
        this._validateWorkerLimits();
        
        // ===== PERFORMANCE THRESHOLDS =====
        this.performance = {
            cpuThreshold: parseInt(process.env.CPU_THRESHOLD) || 90,
            memoryThreshold: parseInt(process.env.MEMORY_THRESHOLD) || 85,
            diskThreshold: 95,
            maxExecutionTime: 30 * 60 * 1000, // 30 minutes max
            
            // Batch processing limits
            maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE) || 25,
            batchProcessingInterval: parseInt(process.env.BATCH_PROCESSING_INTERVAL) || 5000,
            
            // API rate limiting
            apiRateLimit: parseInt(process.env.API_RATE_LIMIT) || 50,
            apiRetryAttempts: 3,
            apiRetryDelay: 1000,
            
            // Cache settings
            cacheEnabled: process.env.CACHE_ENABLED !== 'false',
            cacheTTL: parseInt(process.env.CACHE_TTL) || 86400,
            cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000
        };
        
        // ===== DATABASE CONFIGURATION =====
        this.database = {
            sqlite: {
                path: process.env.SQLITE_DB_PATH || './data/database.db',
                batchSize: parseInt(process.env.DB_BATCH_SIZE) || 100,
                batchFlushInterval: parseInt(process.env.DB_BATCH_FLUSH_INTERVAL) || 1000,
                retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS) || 3,
                walCheckpointInterval: parseInt(process.env.WAL_CHECKPOINT_INTERVAL) || 30000,
                pragmas: {
                    journal_mode: 'WAL',
                    synchronous: 'NORMAL',
                    cache_size: -64000,  // 64MB cache
                    temp_store: 'MEMORY',
                    mmap_size: 268435456 // 256MB
                }
            },
            neo4j: {
                uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
                user: process.env.NEO4J_USER || 'neo4j',
                password: process.env.NEO4J_PASSWORD || '',
                database: process.env.NEO4J_DATABASE || 'neo4j',
                maxConnectionPoolSize: 50,
                connectionTimeout: 30000,
                maxTransactionRetryTime: 30000
            },
            redis: {
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                password: process.env.REDIS_PASSWORD,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                maxLoadingTimeout: 60000
            }
        };
        
        // ===== QUEUE CONFIGURATION =====
        this.queues = {
            defaultJobOptions: {
                removeOnComplete: 100,
                removeOnFail: 50,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
            },
            concurrency: {
                'file-analysis-queue': this.workerLimits['file-analysis'],
                'relationship-resolution-queue': this.workerLimits['relationship-resolution'],
                'directory-aggregation-queue': this.workerLimits['directory-aggregation'],
                'validation-queue': this.workerLimits['validation'],
                'graph-ingestion-queue': this.workerLimits['graph-ingestion']
            },
            staleJobCleanupInterval: 5 * 60 * 1000, // 5 minutes
            maxJobAge: 30 * 60 * 1000, // 30 minutes
            
            // ===== QUEUE CLEANUP CONFIGURATION =====
            cleanup: {
                // Cleanup intervals
                periodicCleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 5 * 60 * 1000,        // 5 minutes
                staleJobCleanupInterval: parseInt(process.env.STALE_CLEANUP_INTERVAL) || 10 * 60 * 1000, // 10 minutes
                failedJobCleanupInterval: parseInt(process.env.FAILED_CLEANUP_INTERVAL) || 30 * 60 * 1000, // 30 minutes
                completedJobCleanupInterval: parseInt(process.env.COMPLETED_CLEANUP_INTERVAL) || 60 * 60 * 1000, // 1 hour
                
                // Retention policies
                maxJobAge: parseInt(process.env.MAX_JOB_AGE) || 24 * 60 * 60 * 1000,          // 24 hours
                maxStaleAge: parseInt(process.env.MAX_STALE_AGE) || 30 * 60 * 1000,           // 30 minutes
                maxFailedJobRetention: parseInt(process.env.MAX_FAILED_RETENTION) || 100,      // Keep 100 failed jobs
                maxCompletedJobRetention: parseInt(process.env.MAX_COMPLETED_RETENTION) || 50, // Keep 50 completed jobs
                
                // Batch processing
                batchSize: parseInt(process.env.CLEANUP_BATCH_SIZE) || 100,                    // Process 100 jobs per batch
                maxBatchTime: parseInt(process.env.MAX_BATCH_TIME) || 30 * 1000,              // 30 seconds max per batch
                batchDelay: parseInt(process.env.BATCH_DELAY) || 1000,                        // 1 second between batches
                
                // Health monitoring
                healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 2 * 60 * 1000, // 2 minutes
                warningThresholds: {
                    queueDepth: parseInt(process.env.WARNING_QUEUE_DEPTH) || 1000,            // Warn if queue > 1000 jobs
                    failureRate: parseFloat(process.env.WARNING_FAILURE_RATE) || 0.1,         // Warn if failure rate > 10%
                    avgProcessingTime: parseInt(process.env.WARNING_PROCESSING_TIME) || 30000, // Warn if avg > 30 seconds
                    stalledJobs: parseInt(process.env.WARNING_STALLED_JOBS) || 10             // Warn if > 10 stalled jobs
                },
                criticalThresholds: {
                    queueDepth: parseInt(process.env.CRITICAL_QUEUE_DEPTH) || 5000,           // Critical if queue > 5000 jobs
                    failureRate: parseFloat(process.env.CRITICAL_FAILURE_RATE) || 0.25,       // Critical if failure rate > 25%
                    avgProcessingTime: parseInt(process.env.CRITICAL_PROCESSING_TIME) || 120000, // Critical if avg > 2 minutes
                    stalledJobs: parseInt(process.env.CRITICAL_STALLED_JOBS) || 50            // Critical if > 50 stalled jobs
                },
                
                // Emergency cleanup settings
                emergencyCleanupEnabled: process.env.EMERGENCY_CLEANUP_ENABLED !== 'false',
                emergencyThresholds: {
                    totalJobs: parseInt(process.env.EMERGENCY_TOTAL_JOBS) || 10000,           // Emergency if total > 10k jobs
                    memoryUsage: parseFloat(process.env.EMERGENCY_MEMORY_USAGE) || 0.9,       // Emergency if memory > 90%
                    consecutiveFailures: parseInt(process.env.EMERGENCY_CONSECUTIVE_FAILURES) || 10 // Emergency if 10 consecutive failures
                },
                
                // Safety settings
                maxCleanupOperationsPerInterval: parseInt(process.env.MAX_CLEANUP_OPS) || 50, // Max 50 cleanup operations per run
                cleanupCooldownPeriod: parseInt(process.env.CLEANUP_COOLDOWN) || 30 * 1000,  // 30 seconds cooldown
                enableSafetyChecks: process.env.DISABLE_CLEANUP_SAFETY !== 'true',           // Enable safety checks by default
                
                // Logging and monitoring
                enableDetailedLogging: process.env.DETAILED_CLEANUP_LOGGING === 'true' || this.environment === 'development',
                logCleanupSummary: process.env.LOG_CLEANUP_SUMMARY !== 'false',
                enableMetricsCollection: process.env.DISABLE_CLEANUP_METRICS !== 'true',
                metricsRetentionPeriod: parseInt(process.env.METRICS_RETENTION) || 24 * 60 * 60 * 1000 // 24 hours
            }
        };
        
        // ===== LLM CONFIGURATION =====
        this.llm = {
            provider: 'deepseek',
            model: 'deepseek-coder',
            apiKey: process.env.DEEPSEEK_API_KEY,
            maxTokens: 4000,
            temperature: 0.1,
            maxRetries: 3,
            timeout: 60000,
            rateLimit: {
                requestsPerSecond: 25,
                burstLimit: 50
            }
        };
        
        // ===== MONITORING CONFIGURATION =====
        this.monitoring = {
            enabled: true,
            logLevel: process.env.LOG_LEVEL || 'info',
            metricsInterval: 30000, // 30 seconds
            healthCheckInterval: 60000, // 1 minute
            alertThresholds: {
                errorRate: 0.05, // 5% error rate threshold
                averageProcessingTime: 30000, // 30 seconds
                queueDepth: 1000,
                memoryUsage: 0.9 // 90% memory usage
            }
        };
        
        // ===== ENVIRONMENT-SPECIFIC OVERRIDES =====
        this._applyEnvironmentOverrides();
        
        // ===== BENCHMARK REQUIREMENTS =====
        this.benchmarks = {
            minimum: {
                nodes: 300,
                relationships: 1600,
                relationshipRatio: 4.0
            },
            expected: {
                nodes: 417,
                relationships: 1876,
                relationshipRatio: 4.5
            },
            performance: {
                maxExecutionTime: this.performance.maxExecutionTime,
                maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
                maxErrorRate: 0.05 // 5%
            },
            grading: {
                A: 0.95, // 95%+ of expected
                B: 0.90, // 90%+ of expected
                C: 0.85, // 85%+ of expected
                D: 0.80  // 80%+ of expected
            }
        };
        
        // Validate final configuration
        this._validateConfiguration();
    }
    
    /**
     * Validates that worker limits don't exceed total concurrency
     */
    _validateWorkerLimits() {
        const totalWorkers = Object.values(this.workerLimits).reduce((sum, limit) => sum + limit, 0);
        
        if (totalWorkers > this.TOTAL_WORKER_CONCURRENCY) {
            throw new Error(
                `Worker limits total ${totalWorkers} exceeds maximum ${this.TOTAL_WORKER_CONCURRENCY}. ` +
                `Current limits: ${JSON.stringify(this.workerLimits)}`
            );
        }
        
        console.log(`✅ Worker limits validated: ${totalWorkers}/${this.TOTAL_WORKER_CONCURRENCY} workers allocated`);
    }
    
    /**
     * Apply environment-specific configuration overrides
     */
    _applyEnvironmentOverrides() {
        switch (this.environment) {
            case 'production':
                this.performance.cpuThreshold = 95;
                this.performance.memoryThreshold = 90;
                this.monitoring.logLevel = 'warn';
                this.performance.apiRateLimit = 50;
                break;
                
            case 'development':
                this.performance.cpuThreshold = 70;
                this.performance.memoryThreshold = 70;
                this.monitoring.logLevel = 'debug';
                this.performance.apiRateLimit = 25;
                break;
                
            case 'test':
                this.workerLimits = {
                    'file-analysis': 5,
                    'relationship-resolution': 3,
                    'directory-aggregation': 2,
                    'validation': 2,
                    'graph-ingestion': 1
                };
                this.performance.maxExecutionTime = 5 * 60 * 1000; // 5 minutes for tests
                this.performance.apiRateLimit = 25; // Lower rate limit for tests
                this.monitoring.logLevel = 'error';
                break;
                
            case 'debug':
                this.workerLimits = {
                    'file-analysis': 2,
                    'relationship-resolution': 1,
                    'directory-aggregation': 1,
                    'validation': 1,
                    'graph-ingestion': 1
                };
                this.performance.maxExecutionTime = 2 * 60 * 1000; // 2 minutes for debugging
                this.monitoring.logLevel = 'debug';
                break;
        }
        
        // Re-validate after environment overrides
        if (this.environment === 'test' || this.environment === 'debug') {
            this.TOTAL_WORKER_CONCURRENCY = Object.values(this.workerLimits).reduce((sum, limit) => sum + limit, 0);
        }
    }
    
    /**
     * Validates the entire configuration for consistency and correctness
     */
    _validateConfiguration() {
        const errors = [];
        
        // Validate required environment variables
        if (!this.llm.apiKey) {
            errors.push('DEEPSEEK_API_KEY is required');
        }
        
        // Validate database paths
        if (!this.database.sqlite.path) {
            errors.push('SQLITE_DB_PATH is required');
        }
        
        // Validate Neo4j configuration
        if (!this.database.neo4j.uri) {
            errors.push('NEO4J_URI is required');
        }
        
        // Validate performance thresholds
        if (this.performance.cpuThreshold < 50 || this.performance.cpuThreshold > 100) {
            errors.push('CPU threshold must be between 50-100%');
        }
        
        if (this.performance.memoryThreshold < 50 || this.performance.memoryThreshold > 100) {
            errors.push('Memory threshold must be between 50-100%');
        }
        
        // Validate batch sizes (allow larger sizes for file processing)
        if (this.performance.maxBatchSize < 1 || this.performance.maxBatchSize > 100000) {
            errors.push('Batch size must be between 1-100000');
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
        
        console.log(`✅ Pipeline configuration validated for ${this.environment} environment`);
    }
    
    /**
     * Get worker concurrency limit for a specific worker type
     */
    getWorkerLimit(workerType) {
        return this.workerLimits[workerType] || 1;
    }
    
    /**
     * Get queue concurrency limit for a specific queue
     */
    getQueueConcurrency(queueName) {
        return this.queues.concurrency[queueName] || 1;
    }
    
    /**
     * Get queue cleanup configuration
     */
    getCleanupConfig() {
        return this.queues.cleanup;
    }
    
    /**
     * Get database configuration for a specific database type
     */
    getDatabaseConfig(dbType) {
        return this.database[dbType] || null;
    }
    
    /**
     * Check if a performance threshold has been exceeded
     */
    isThresholdExceeded(metric, value) {
        switch (metric) {
            case 'cpu':
                return value > this.performance.cpuThreshold;
            case 'memory':
                return value > this.performance.memoryThreshold;
            case 'disk':
                return value > this.performance.diskThreshold;
            default:
                return false;
        }
    }
    
    /**
     * Get benchmark requirements
     */
    getBenchmarkRequirements() {
        return this.benchmarks;
    }
    
    /**
     * Calculate performance grade based on results
     */
    calculateGrade(results) {
        const { nodes, relationships } = results;
        const { expected } = this.benchmarks;
        
        const nodeScore = nodes / expected.nodes;
        const relationshipScore = relationships / expected.relationships;
        const overallScore = (nodeScore + relationshipScore) / 2;
        
        if (overallScore >= this.benchmarks.grading.A) return 'A';
        if (overallScore >= this.benchmarks.grading.B) return 'B';
        if (overallScore >= this.benchmarks.grading.C) return 'C';
        if (overallScore >= this.benchmarks.grading.D) return 'D';
        return 'F';
    }
    
    /**
     * Get configuration summary for logging
     */
    getSummary() {
        return {
            environment: this.environment,
            totalWorkerConcurrency: this.TOTAL_WORKER_CONCURRENCY,
            workerLimits: this.workerLimits,
            performanceThresholds: {
                cpu: this.performance.cpuThreshold,
                memory: this.performance.memoryThreshold,
                maxExecutionTime: this.performance.maxExecutionTime
            },
            databasePaths: {
                sqlite: this.database.sqlite.path,
                neo4j: this.database.neo4j.uri
            },
            monitoring: {
                logLevel: this.monitoring.logLevel,
                enabled: this.monitoring.enabled
            }
        };
    }
    
    /**
     * Update configuration at runtime (for dynamic adjustments)
     */
    updateWorkerLimit(workerType, newLimit) {
        if (!this.workerLimits.hasOwnProperty(workerType)) {
            throw new Error(`Unknown worker type: ${workerType}`);
        }
        
        const oldLimit = this.workerLimits[workerType];
        this.workerLimits[workerType] = newLimit;
        
        try {
            this._validateWorkerLimits();
            console.log(`✅ Updated ${workerType} limit: ${oldLimit} → ${newLimit}`);
        } catch (error) {
            // Rollback on validation failure
            this.workerLimits[workerType] = oldLimit;
            throw error;
        }
    }
    
    /**
     * Create a configuration instance based on current environment
     */
    static createDefault() {
        return new PipelineConfig();
    }
    
    /**
     * Create a test configuration with minimal resources
     */
    static createForTesting() {
        return new PipelineConfig({ environment: 'test' });
    }
    
    /**
     * Create a debug configuration with extensive logging
     */
    static createForDebugging() {
        return new PipelineConfig({ environment: 'debug' });
    }
}

module.exports = { PipelineConfig };