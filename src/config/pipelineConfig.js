/**
 * Centralized Pipeline Configuration
 * 
 * This class provides a single source of truth for all pipeline configuration,
 * including worker concurrency limits, database settings, performance thresholds,
 * and comprehensive timeout management.
 * 
 * Key Features:
 * - Hard concurrency limits to prevent system overload
 * - Dynamic worker allocation based on system resources
 * - Environment-specific configurations
 * - Configuration validation and error handling
 * - Comprehensive timeout configuration management
 */

const { TimeoutConfig } = require('./timeoutConfig');

class PipelineConfig {
    constructor(options = {}) {
        // Environment detection
        this.environment = options.environment || process.env.NODE_ENV || 'development';
        
        // Initialize timeout configuration
        this.timeouts = this._initializeTimeoutConfig(options.timeouts);
        
        // ===== HARD LIMITS =====
        // These are absolute maximums that should NEVER be exceeded
        this.ABSOLUTE_MAX_CONCURRENCY = 150; // System-wide hard limit
        this.TOTAL_WORKER_CONCURRENCY = 100;  // Worker-specific hard limit
        
        // ===== WORKER CONCURRENCY LIMITS =====
        const forcedConcurrency = this._parseAndValidateForcedConcurrency(process.env.FORCE_MAX_CONCURRENCY);
        
        if (forcedConcurrency > 0) {
            this.workerLimits = this._distributeForcedConcurrency(forcedConcurrency);
            this.TOTAL_WORKER_CONCURRENCY = forcedConcurrency;
        } else {
            // Use reasonable defaults instead of 100 per worker type
            const defaultTotal = 100; // Reasonable default limit
            this.workerLimits = {
                'file-analysis': parseInt(process.env.MAX_FILE_ANALYSIS_WORKERS) || 15,
                'relationship-resolution': parseInt(process.env.MAX_RELATIONSHIP_WORKERS) || 15,
                'directory-resolution': parseInt(process.env.MAX_DIRECTORY_RESOLUTION_WORKERS) || 10,
                'directory-aggregation': parseInt(process.env.MAX_DIRECTORY_WORKERS) || 10,
                'validation': parseInt(process.env.MAX_VALIDATION_WORKERS) || 15,
                'reconciliation': parseInt(process.env.MAX_RECONCILIATION_WORKERS) || 15,
                'graph-ingestion': parseInt(process.env.MAX_GRAPH_WORKERS) || 20
            };
            
            // Ensure total doesn't exceed reasonable default
            const currentTotal = Object.values(this.workerLimits).reduce((sum, limit) => sum + limit, 0);
            if (currentTotal > defaultTotal) {
                console.warn(`⚠️  Total worker allocation (${currentTotal}) exceeds recommended limit (${defaultTotal}). Using defaults.`);
                this.workerLimits = this._getDefaultWorkerLimits();
            }
            
            this.TOTAL_WORKER_CONCURRENCY = Object.values(this.workerLimits).reduce((sum, limit) => sum + limit, 0);
        }
        
        if (forcedConcurrency > 0) {
            this._validateWorkerLimits();
        }
        
        // ===== PERFORMANCE THRESHOLDS =====
        this.performance = {
            cpuThreshold: parseInt(process.env.CPU_THRESHOLD) || 90,
            memoryThreshold: parseInt(process.env.MEMORY_THRESHOLD) || 85,
            diskThreshold: 95,
            // No maxExecutionTime - allow unlimited time for large codebases
            
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
                attempts: 2, // Reduced from 3 to 2 for faster failure handling
                backoff: {
                    type: 'exponential',
                    delay: 3000, // Increased from 2000 to 3000 for better spacing
                },
            },
            concurrency: {
                'file-analysis-queue': this.workerLimits['file-analysis'],
                'relationship-resolution-queue': this.workerLimits['relationship-resolution'],
                'directory-resolution-queue': this.workerLimits['directory-resolution'],
                'directory-aggregation-queue': this.workerLimits['directory-aggregation'],
                'validation-queue': this.workerLimits['validation'],
                'reconciliation-queue': this.workerLimits['reconciliation'],
                'graph-ingestion-queue': this.workerLimits['graph-ingestion']
            },
            staleJobCleanupInterval: 5 * 60 * 1000, // 5 minutes
            maxJobAge: 30 * 60 * 1000, // 30 minutes
            
            cleanup: {
                periodicCleanupInterval: 10 * 60 * 1000,
                maxJobAge: 24 * 60 * 60 * 1000,
                maxFailedJobRetention: 100,
                maxCompletedJobRetention: 50,
                batchSize: 100
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
        
        this.triangulation = {
            enabled: process.env.TRIANGULATION_ENABLED !== 'false',
            confidenceThreshold: 0.45,
            concurrency: 2,
            processingTimeout: 300000,
            maxBatchSize: 20
        };
        
        this.monitoring = {
            enabled: true,
            logLevel: process.env.LOG_LEVEL || 'info',
            maxWaitTimeMs: this.timeouts.get('pipeline', 'maxWait'),
            checkIntervalMs: this.timeouts.get('pipeline', 'checkInterval'),
            maxFailureRate: parseFloat(process.env.PIPELINE_MAX_FAILURE_RATE) || 0.1,
            requiredIdleChecks: parseInt(process.env.PIPELINE_REQUIRED_IDLE_CHECKS) || 3,
            shutdownTimeouts: {
                outboxPublisher: this.timeouts.get('worker', 'shutdown'),
                triangulatedAnalysisQueue: this.timeouts.get('queue', 'cleanup'),
                workers: this.timeouts.get('worker', 'shutdown'),
                workerPoolManager: this.timeouts.get('worker', 'shutdown') + 5000, // Slightly longer for manager
                queueManager: this.timeouts.get('queue', 'connection'),
                neo4jDriver: this.timeouts.get('database', 'connection'),
                databaseOperations: this.timeouts.get('database', 'shutdown')
            }
        };
        
        // ===== ENVIRONMENT-SPECIFIC OVERRIDES =====
        this._applyEnvironmentOverrides();
        
        this.benchmarks = {
            expected: {
                nodes: 417,
                relationships: 1876
            },
            performance: {
                maxMemoryUsage: 1024 * 1024 * 1024,
                maxErrorRate: 0.05
            }
        };
        
        // Validate final configuration
        this._validateConfiguration();
    }
    
    /**
     * Initialize timeout configuration based on environment
     */
    _initializeTimeoutConfig(timeoutOptions = {}) {
        switch (this.environment) {
            case 'test':
                return TimeoutConfig.createForTesting();
            case 'debug':
                return TimeoutConfig.createForDebugging();
            default:
                return TimeoutConfig.create(timeoutOptions);
        }
    }
    
    /**
     * Parse and validate FORCE_MAX_CONCURRENCY environment variable
     */
    _parseAndValidateForcedConcurrency(envValue) {
        if (!envValue || typeof envValue !== 'string') {
            return 0; // No forced concurrency
        }
        
        const parsed = parseInt(envValue);
        
        // Check for invalid values
        if (isNaN(parsed) || parsed <= 0) {
            console.warn(`⚠️  Invalid FORCE_MAX_CONCURRENCY value: "${envValue}". Using adaptive scaling instead.`);
            return 0;
        }
        
        // Warn if exceeding absolute maximum
        if (parsed > this.ABSOLUTE_MAX_CONCURRENCY) {
            console.warn(`⚠️  FORCE_MAX_CONCURRENCY (${parsed}) exceeds absolute maximum (${this.ABSOLUTE_MAX_CONCURRENCY}). Capping to maximum.`);
            return this.ABSOLUTE_MAX_CONCURRENCY;
        }
        
        return parsed;
    }
    
    /**
     * Distribute forced concurrency across worker types with priority
     */
    _distributeForcedConcurrency(totalConcurrency) {
        const workerTypes = [
            'file-analysis',
            'relationship-resolution', 
            'directory-resolution',
            'directory-aggregation',
            'validation',
            'reconciliation',
            'graph-ingestion'
        ];
        
        // If total concurrency is less than number of worker types,
        // allocate to highest priority workers only
        if (totalConcurrency < workerTypes.length) {
            const priorities = [
                'file-analysis',        // Highest priority - core functionality
                'validation',           // Second priority - data integrity
                'relationship-resolution', // Third priority - core relationships
                'reconciliation',       // Fourth priority - data consistency
                'directory-resolution', // Fifth priority - organization
                'directory-aggregation', // Sixth priority - summaries
                'graph-ingestion'       // Seventh priority - output
            ];
            
            const allocation = {};
            // Initialize all to 0
            workerTypes.forEach(type => allocation[type] = 0);
            
            // Allocate to highest priority workers first
            for (let i = 0; i < totalConcurrency && i < priorities.length; i++) {
                allocation[priorities[i]] = 1;
            }
            
            console.log(`🔧 Low concurrency mode: Allocated ${totalConcurrency} workers to highest priority types:`, 
                Object.entries(allocation).filter(([_, count]) => count > 0).map(([type, count]) => `${type}:${count}`).join(', ')
            );
            
            return allocation;
        }
        
        // For higher concurrency, distribute evenly with remainder to high-priority workers
        const basePerWorker = Math.floor(totalConcurrency / workerTypes.length);
        const remainder = totalConcurrency % workerTypes.length;
        
        const allocation = {
            'file-analysis': basePerWorker + (remainder > 0 ? 1 : 0),
            'relationship-resolution': basePerWorker + (remainder > 1 ? 1 : 0),
            'directory-resolution': basePerWorker + (remainder > 2 ? 1 : 0),
            'directory-aggregation': basePerWorker + (remainder > 3 ? 1 : 0),
            'validation': basePerWorker + (remainder > 4 ? 1 : 0),
            'reconciliation': basePerWorker + (remainder > 5 ? 1 : 0),
            'graph-ingestion': basePerWorker + (remainder > 6 ? 1 : 0)
        };
        
        console.log(`🔧 Distributed ${totalConcurrency} workers across ${workerTypes.length} types:`, 
            Object.entries(allocation).map(([type, count]) => `${type}:${count}`).join(', ')
        );
        
        return allocation;
    }
    
    /**
     * Get default worker limits for safe fallback
     */
    _getDefaultWorkerLimits() {
        return {
            'file-analysis': 15,        // Core file processing
            'relationship-resolution': 15, // Core relationship processing  
            'directory-resolution': 10, // Directory organization
            'directory-aggregation': 10, // Summary generation
            'validation': 15,           // Data validation
            'reconciliation': 15,       // Data consistency
            'graph-ingestion': 20       // Graph output (can be higher)
        };
    }
    
    /**
     * Validates that worker limits don't exceed total concurrency
     */
    _validateWorkerLimits() {
        const totalWorkers = Object.values(this.workerLimits).reduce((sum, limit) => sum + limit, 0);
        
        // When using FORCE_MAX_CONCURRENCY, we distribute the total across worker types
        const forcedConcurrency = parseInt(process.env.FORCE_MAX_CONCURRENCY);
        if (forcedConcurrency > 0) {
            return;
        }
        
        if (totalWorkers > this.TOTAL_WORKER_CONCURRENCY) {
            throw new Error(
                `Worker limits total ${totalWorkers} exceeds maximum ${this.TOTAL_WORKER_CONCURRENCY}. ` +
                `Current limits: ${JSON.stringify(this.workerLimits)}`
            );
        }
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
                    'relationship-resolution': 2,
                    'directory-resolution': 2,
                    'directory-aggregation': 2,
                    'validation': 2,
                    'reconciliation': 2,
                    'graph-ingestion': 1
                };
                // No maxExecutionTime limits for test environment
                this.performance.apiRateLimit = 25; // Lower rate limit for tests
                this.monitoring.logLevel = 'error';
                // Update monitoring with test timeout values
                this.monitoring.maxWaitTimeMs = this.timeouts.get('pipeline', 'maxWait');
                this.monitoring.checkIntervalMs = this.timeouts.get('pipeline', 'checkInterval');
                this.monitoring.requiredIdleChecks = 2; // 2 checks for tests
                break;
                
            case 'debug':
                this.workerLimits = {
                    'file-analysis': 2,
                    'relationship-resolution': 1,
                    'directory-resolution': 1,
                    'directory-aggregation': 1,
                    'validation': 1,
                    'reconciliation': 1,
                    'graph-ingestion': 1
                };
                // No maxExecutionTime limits for debug environment
                this.monitoring.logLevel = 'debug';
                // Update monitoring with debug timeout values
                this.monitoring.maxWaitTimeMs = this.timeouts.get('pipeline', 'maxWait');
                this.monitoring.checkIntervalMs = this.timeouts.get('pipeline', 'checkInterval');
                this.monitoring.requiredIdleChecks = 2; // 2 checks for debug
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
        
        // Validate monitoring timeout values
        if (this.monitoring.maxWaitTimeMs < 60000 || this.monitoring.maxWaitTimeMs > 7200000) { // 1 minute to 2 hours
            errors.push('Pipeline max wait time must be between 1 minute (60000ms) and 2 hours (7200000ms)');
        }
        
        if (this.monitoring.checkIntervalMs < 1000 || this.monitoring.checkIntervalMs > 60000) { // 1 second to 1 minute
            errors.push('Pipeline check interval must be between 1 second (1000ms) and 1 minute (60000ms)');
        }
        
        if (this.monitoring.maxFailureRate < 0 || this.monitoring.maxFailureRate > 1) {
            errors.push('Pipeline max failure rate must be between 0 and 1 (0% to 100%)');
        }
        
        if (this.monitoring.requiredIdleChecks < 1 || this.monitoring.requiredIdleChecks > 10) {
            errors.push('Pipeline required idle checks must be between 1 and 10');
        }
        
        // Validate shutdown timeout values
        if (this.monitoring.shutdownTimeouts) {
            Object.entries(this.monitoring.shutdownTimeouts).forEach(([component, timeout]) => {
                if (timeout < 1000 || timeout > 120000) { // 1 second to 2 minutes
                    errors.push(`Shutdown timeout for ${component} must be between 1 second (1000ms) and 2 minutes (120000ms)`);
                }
            });
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
        
    }
    
    /**
     * Get worker concurrency limit for a specific worker type
     */
    getWorkerLimit(workerType) {
        // Return the actual configured limit, don't default to 1 for unallocated workers
        return this.workerLimits[workerType] || 0;
    }
    
    /**
     * Get queue concurrency limit for a specific queue
     */
    getQueueConcurrency(queueName) {
        // Queue concurrency should match worker limits, not default to 1
        return this.queues.concurrency[queueName] || 0;
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
                // No maxExecutionTime - unlimited processing time
            },
            databasePaths: {
                sqlite: this.database.sqlite.path,
                neo4j: this.database.neo4j.uri
            },
            monitoring: {
                logLevel: this.monitoring.logLevel,
                enabled: this.monitoring.enabled,
                maxWaitTimeMs: this.monitoring.maxWaitTimeMs,
                checkIntervalMs: this.monitoring.checkIntervalMs,
                maxFailureRate: this.monitoring.maxFailureRate,
                requiredIdleChecks: this.monitoring.requiredIdleChecks,
                shutdownTimeouts: this.monitoring.shutdownTimeouts
            },
            timeouts: this.timeouts.getSummary()
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
        } catch (error) {
            // Rollback on validation failure
            this.workerLimits[workerType] = oldLimit;
            throw error;
        }
    }
    
    /**
     * Get timeout value for a specific category and type
     */
    getTimeout(category, timeoutType) {
        return this.timeouts.get(category, timeoutType);
    }
    
    /**
     * Update timeout value at runtime
     */
    updateTimeout(category, timeoutType, value) {
        this.timeouts.set(category, timeoutType, value);
        
        // Update related monitoring configuration if applicable
        if (category === 'pipeline') {
            if (timeoutType === 'maxWait') {
                this.monitoring.maxWaitTimeMs = value;
            } else if (timeoutType === 'checkInterval') {
                this.monitoring.checkIntervalMs = value;
            }
        }
        
        // Update shutdown timeouts if worker or queue timeouts changed
        if (category === 'worker' || category === 'queue' || category === 'database') {
            this._updateShutdownTimeouts();
        }
    }
    
    /**
     * Update shutdown timeouts based on current timeout configuration
     */
    _updateShutdownTimeouts() {
        this.monitoring.shutdownTimeouts = {
            outboxPublisher: this.timeouts.get('worker', 'shutdown'),
            triangulatedAnalysisQueue: this.timeouts.get('queue', 'cleanup'),
            workers: this.timeouts.get('worker', 'shutdown'),
            workerPoolManager: this.timeouts.get('worker', 'shutdown') + 5000, // Slightly longer for manager
            queueManager: this.timeouts.get('queue', 'connection'),
            neo4jDriver: this.timeouts.get('database', 'connection'),
            databaseOperations: this.timeouts.get('database', 'shutdown')
        };
    }
    
    /**
     * Get all timeouts for a specific category
     */
    getTimeoutCategory(category) {
        return this.timeouts.getCategory(category);
    }
    
    /**
     * Reset timeouts to defaults
     */
    resetTimeouts() {
        this.timeouts.resetToDefaults();
        
        // Update dependent configurations
        this.monitoring.maxWaitTimeMs = this.timeouts.get('pipeline', 'maxWait');
        this.monitoring.checkIntervalMs = this.timeouts.get('pipeline', 'checkInterval');
        this._updateShutdownTimeouts();
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