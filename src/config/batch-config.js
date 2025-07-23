/**
 * Configuration for BatchedDatabaseWriter and optimized database operations
 */

const batchConfig = {
    // BatchedDatabaseWriter configuration
    batchWriter: {
        // Default batch size for database operations
        batchSize: process.env.DB_BATCH_SIZE ? parseInt(process.env.DB_BATCH_SIZE) : 100,
        
        // Automatic flush interval in milliseconds
        flushInterval: process.env.DB_FLUSH_INTERVAL ? parseInt(process.env.DB_FLUSH_INTERVAL) : 1000,
        
        // Maximum number of retries for failed batches
        maxRetries: process.env.DB_MAX_RETRIES ? parseInt(process.env.DB_MAX_RETRIES) : 3,
        
        // Delay between retries in milliseconds
        retryDelay: process.env.DB_RETRY_DELAY ? parseInt(process.env.DB_RETRY_DELAY) : 500,
        
        // Enable performance statistics
        enableStats: process.env.DB_ENABLE_STATS !== 'false',
        
        // WAL checkpoint interval (0 to disable automatic checkpoints)
        walCheckpointInterval: process.env.DB_WAL_CHECKPOINT_INTERVAL ? parseInt(process.env.DB_WAL_CHECKPOINT_INTERVAL) : 30000, // 30 seconds
    },
    
    // TransactionalOutboxPublisher configuration
    outboxPublisher: {
        // Polling interval for checking new events
        pollingInterval: process.env.OUTBOX_POLLING_INTERVAL ? parseInt(process.env.OUTBOX_POLLING_INTERVAL) : 1000,
        
        // Number of events to process per polling cycle
        batchSize: process.env.OUTBOX_BATCH_SIZE ? parseInt(process.env.OUTBOX_BATCH_SIZE) : 200,
        
        // Flush interval for batched database writes (should be faster than polling)
        flushInterval: process.env.OUTBOX_FLUSH_INTERVAL ? parseInt(process.env.OUTBOX_FLUSH_INTERVAL) : 500,
        
        // Enable relationship finding super-batching
        enableSuperBatching: process.env.OUTBOX_ENABLE_SUPER_BATCHING !== 'false',
        
        // Maximum size for relationship super-batches
        superBatchSize: process.env.OUTBOX_SUPER_BATCH_SIZE ? parseInt(process.env.OUTBOX_SUPER_BATCH_SIZE) : 1000,
    },
    
    // Database optimization settings
    database: {
        // WAL mode settings
        wal: {
            // Auto-checkpoint after this many pages
            autoCheckpointPages: process.env.DB_WAL_AUTO_CHECKPOINT ? parseInt(process.env.DB_WAL_AUTO_CHECKPOINT) : 1000,
            
            // Maximum WAL file size before forcing checkpoint (in MB)
            maxWalSizeMB: process.env.DB_MAX_WAL_SIZE_MB ? parseInt(process.env.DB_MAX_WAL_SIZE_MB) : 100,
        },
        
        // Performance tuning
        performance: {
            // Cache size in pages (4KB each by default)
            cacheSize: process.env.DB_CACHE_SIZE ? parseInt(process.env.DB_CACHE_SIZE) : 10000, // ~40MB
            
            // Memory-mapped I/O size in bytes
            mmapSize: process.env.DB_MMAP_SIZE ? parseInt(process.env.DB_MMAP_SIZE) : 268435456, // 256MB
            
            // Synchronous mode for performance vs safety trade-off
            synchronous: process.env.DB_SYNCHRONOUS || 'NORMAL', // FULL, NORMAL, OFF
            
            // Busy timeout in milliseconds
            busyTimeout: process.env.DB_BUSY_TIMEOUT ? parseInt(process.env.DB_BUSY_TIMEOUT) : 10000,
        },
        
        // Maintenance settings
        maintenance: {
            // Auto-optimize interval in milliseconds (0 to disable)
            optimizeInterval: process.env.DB_OPTIMIZE_INTERVAL ? parseInt(process.env.DB_OPTIMIZE_INTERVAL) : 3600000, // 1 hour
            
            // Auto-vacuum mode
            autoVacuum: process.env.DB_AUTO_VACUUM || 'INCREMENTAL', // NONE, FULL, INCREMENTAL
            
            // Analyze tables interval in milliseconds (0 to disable)
            analyzeInterval: process.env.DB_ANALYZE_INTERVAL ? parseInt(process.env.DB_ANALYZE_INTERVAL) : 1800000, // 30 minutes
        },
    },
    
    // Monitoring and alerting
    monitoring: {
        // Log batch statistics every N batches (0 to disable)
        logStatsEvery: process.env.BATCH_LOG_STATS_EVERY ? parseInt(process.env.BATCH_LOG_STATS_EVERY) : 100,
        
        // Alert when pending items exceed this threshold
        pendingItemsAlert: process.env.BATCH_PENDING_ALERT ? parseInt(process.env.BATCH_PENDING_ALERT) : 1000,
        
        // Alert when batch processing time exceeds this (milliseconds)
        processingTimeAlert: process.env.BATCH_PROCESSING_TIME_ALERT ? parseInt(process.env.BATCH_PROCESSING_TIME_ALERT) : 5000,
        
        // Alert when error rate exceeds this percentage
        errorRateAlert: process.env.BATCH_ERROR_RATE_ALERT ? parseFloat(process.env.BATCH_ERROR_RATE_ALERT) : 5.0,
    }
};

/**
 * Get environment-specific configuration overrides
 */
function getEnvironmentConfig() {
    const env = process.env.NODE_ENV || 'development';
    
    const envConfigs = {
        development: {
            batchWriter: {
                batchSize: 10, // Smaller batches for development
                flushInterval: 500,
                enableStats: true,
            },
            outboxPublisher: {
                pollingInterval: 2000, // Slower polling for development
                flushInterval: 250,
            }
        },
        
        test: {
            batchWriter: {
                batchSize: 5, // Very small batches for testing
                flushInterval: 100,
                enableStats: false, // Reduce noise in tests
            },
            outboxPublisher: {
                pollingInterval: 100,
                flushInterval: 50,
            }
        },
        
        production: {
            batchWriter: {
                batchSize: 500, // Larger batches for production
                flushInterval: 1000,
                enableStats: true,
            },
            outboxPublisher: {
                pollingInterval: 1000,
                flushInterval: 500,
                superBatchSize: 2000, // Larger super-batches
            },
            monitoring: {
                logStatsEvery: 200,
                pendingItemsAlert: 5000,
            }
        }
    };
    
    return envConfigs[env] || {};
}

/**
 * Merge base config with environment-specific overrides
 */
function getConfig() {
    const envConfig = getEnvironmentConfig();
    return mergeDeep(batchConfig, envConfig);
}

/**
 * Deep merge utility function
 */
function mergeDeep(target, source) {
    const result = { ...target };
    
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = mergeDeep(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    
    return result;
}

/**
 * Validate configuration values
 */
function validateConfig(config) {
    const errors = [];
    
    // Validate batch sizes
    if (config.batchWriter.batchSize < 1) {
        errors.push('batchWriter.batchSize must be >= 1');
    }
    
    if (config.batchWriter.flushInterval < 50) {
        errors.push('batchWriter.flushInterval must be >= 50ms');
    }
    
    if (config.outboxPublisher.batchSize < 1) {
        errors.push('outboxPublisher.batchSize must be >= 1');
    }
    
    // Validate flush interval is less than polling interval
    if (config.outboxPublisher.flushInterval >= config.outboxPublisher.pollingInterval) {
        errors.push('outboxPublisher.flushInterval should be less than pollingInterval');
    }
    
    if (errors.length > 0) {
        throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
    
    return true;
}

module.exports = {
    getConfig,
    validateConfig,
    batchConfig,
    getEnvironmentConfig
};