
/**
 * Performance-optimized configuration for data consistency operations
 */
module.exports = {
    validation: {
        // Cache configuration
        cacheSize: 10000,
        cacheTtlMs: 300000, // 5 minutes
        
        // Batch processing
        batchSize: 5000,
        enableParallelValidation: true,
        
        // Streaming for large datasets
        enableStreaming: true,
        streamingThreshold: 10000,
        streamingBatchSize: 1000,
        
        // Worker configuration
        maxWorkers: require('os').cpus().length,
        workerTimeoutMs: 30000,
        
        // Performance thresholds
        maxValidationTimeMs: 1000, // 1 second max for validation
        maxMemoryUsageMB: 100,
        
        // Auto-optimization
        enableAutoOptimization: true,
        performanceLogging: true
    },
    
    database: {
        // Query optimization
        enableQueryCache: true,
        preparedStatementCache: true,
        
        // Transaction optimization
        batchTransactionSize: 1000,
        enableWALMode: true,
        
        // Index management
        autoCreateIndexes: true,
        indexMaintenanceInterval: 3600000, // 1 hour
        
        // Connection pooling
        maxConnections: 10,
        connectionTimeoutMs: 5000
    },
    
    memory: {
        // Memory management
        enableMemoryOptimization: true,
        maxHeapUsagePercent: 80,
        gcThreshold: 100 * 1024 * 1024, // 100MB
        
        // Buffer management
        enableBufferPooling: true,
        maxBufferSize: 50 * 1024 * 1024, // 50MB
        
        // Streaming thresholds
        streamingMemoryThreshold: 200 * 1024 * 1024 // 200MB
    },
    
    monitoring: {
        enablePerformanceMonitoring: true,
        metricsCollectionInterval: 30000, // 30 seconds
        performanceReportInterval: 300000, // 5 minutes
        
        alertThresholds: {
            validationTimeMs: 2000,
            memoryUsageMB: 500,
            cacheHitRate: 50 // minimum 50% cache hit rate
        }
    }
};
