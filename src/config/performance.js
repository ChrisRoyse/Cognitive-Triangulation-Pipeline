const os = require('os');

/**
 * Performance-optimized configuration for BullMQ workers
 * Based on system resources and the performance analysis from newdirection.md
 */

// Get system information
const cpuCount = os.cpus().length;
const totalMemory = os.totalmem();
const availableMemory = os.freemem();

// Calculate optimal concurrency based on CPU cores
const optimalConcurrency = {
    // FileAnalysisWorker: CPU-bound due to JSON parsing, limit to cores
    fileAnalysis: Math.max(4, Math.min(cpuCount, 16)),
    
    // DirectoryResolutionWorker: Mix of I/O and CPU, can be higher
    directoryResolution: Math.max(2, Math.min(Math.floor(cpuCount * 0.75), 8)),
    
    // GlobalResolutionWorker: Mostly I/O bound, lower concurrency
    globalResolution: Math.max(2, Math.min(Math.floor(cpuCount * 0.5), 4)),
    
    // RelationshipResolver: CPU-intensive, limit concurrency
    relationshipResolver: Math.max(2, Math.min(Math.floor(cpuCount * 0.5), 6)),
    
    // GraphIngestionWorker: I/O bound to Neo4j, low concurrency
    graphIngestion: Math.min(2, Math.floor(cpuCount * 0.25)),
    
    // ValidationWorker: Mix of CPU and I/O
    validation: Math.max(2, Math.min(cpuCount, 8)),
    
    // ReconciliationWorker: CPU-bound for scoring
    reconciliation: Math.max(2, Math.min(Math.floor(cpuCount * 0.5), 4))
};

// Queue configuration with backpressure
const queueConfig = {
    defaultJobOptions: {
        removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
            count: 1000 // Keep last 1000 completed jobs
        },
        removeOnFail: {
            age: 24 * 3600 // Keep failed jobs for 24 hours
        },
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000
        }
    },
    
    // Batch sizes for different operations
    batchSizes: {
        fileDiscovery: 100,      // Files to process in one batch
        poisBatch: 1000,         // POIs to insert in one transaction
        relationshipBatch: 1000, // Relationships per batch
        neo4jBatch: 10000       // Neo4j UNWIND batch size
    },
    
    // Rate limiting to prevent overwhelming LLM API
    rateLimits: {
        llmQueries: {
            max: 100,        // Max queries
            duration: 60000  // Per minute
        }
    }
};

// Worker-specific configurations
const workerConfigs = {
    FileAnalysisWorker: {
        concurrency: optimalConcurrency.fileAnalysis,
        stalledInterval: 30000,
        maxStalledCount: 1,
        // Custom settings for large file handling
        settings: {
            maxFileSize: 10 * 1024 * 1024, // 10MB max file size
            tokenLimit: 50000,              // Max tokens per file
            chunkSize: 25000                // Tokens per chunk if splitting
        }
    },
    
    DirectoryResolutionWorker: {
        concurrency: optimalConcurrency.directoryResolution,
        stalledInterval: 60000,
        maxStalledCount: 2
    },
    
    GlobalResolutionWorker: {
        concurrency: optimalConcurrency.globalResolution,
        stalledInterval: 120000,
        maxStalledCount: 1
    },
    
    RelationshipResolutionWorker: {
        concurrency: optimalConcurrency.relationshipResolver,
        stalledInterval: 60000,
        maxStalledCount: 1,
        settings: {
            batchSize: 50, // POIs per relationship batch
            useCache: true
        }
    },
    
    GraphIngestionWorker: {
        concurrency: optimalConcurrency.graphIngestion,
        stalledInterval: 300000, // 5 minutes for large Neo4j operations
        maxStalledCount: 1
    },
    
    ValidationWorker: {
        concurrency: optimalConcurrency.validation,
        stalledInterval: 30000,
        maxStalledCount: 2
    },
    
    ReconciliationWorker: {
        concurrency: optimalConcurrency.reconciliation,
        stalledInterval: 45000,
        maxStalledCount: 1
    }
};

// Database performance settings
const databaseConfig = {
    sqlite: {
        // Connection pool simulation
        maxConnections: 5,
        idleTimeout: 60000,
        
        // Performance pragmas
        pragmas: {
            journal_mode: 'WAL',
            synchronous: 'NORMAL',
            cache_size: 10000,        // ~40MB cache
            mmap_size: 268435456,     // 256MB memory-mapped I/O
            page_size: 4096,
            temp_store: 'MEMORY',
            busy_timeout: 10000
        }
    },
    
    neo4j: {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 60000,
        maxTransactionRetryTime: 30000,
        // Use APOC if available
        useApoc: true,
        apocBatchSize: 10000
    }
};

// Memory management settings
const memoryConfig = {
    // Maximum memory usage before triggering garbage collection
    maxMemoryUsage: 0.8, // 80% of available memory
    
    // File streaming threshold
    streamingThreshold: 1024 * 1024, // Stream files larger than 1MB
    
    // Cache sizes
    cacheConfig: {
        llmResponseCache: 1000,    // Number of LLM responses to cache
        poiCache: 10000,           // POIs to keep in memory
        relationshipCache: 5000    // Relationships to cache
    }
};

// Export the complete performance configuration
module.exports = {
    cpuCount,
    optimalConcurrency,
    queueConfig,
    workerConfigs,
    databaseConfig,
    memoryConfig,
    
    // Helper function to get worker config
    getWorkerConfig(workerName) {
        return workerConfigs[workerName] || {
            concurrency: Math.max(2, Math.floor(cpuCount * 0.5)),
            stalledInterval: 30000,
            maxStalledCount: 1
        };
    },
    
    // Dynamic adjustment based on system load
    adjustConcurrency(currentLoad) {
        const loadFactor = 1 - (currentLoad / 100);
        const adjusted = {};
        
        for (const [key, value] of Object.entries(optimalConcurrency)) {
            adjusted[key] = Math.max(1, Math.floor(value * loadFactor));
        }
        
        return adjusted;
    }
};