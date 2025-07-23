const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Import optimized components
const EntityScout = require('./agents/EntityScout_incremental');
const OptimizedRelationshipResolver = require('./agents/OptimizedRelationshipResolver');
const GraphBuilder = require('./agents/GraphBuilder_optimized');

// Import enhanced utilities
const { EnhancedDatabaseManager } = require('./utils/sqliteDb_enhanced');
const { getCacheClient } = require('./utils/cacheClient');
const { EnhancedQueueManager } = require('./utils/queueManager_enhanced');
const { getNeo4jDriver } = require('./utils/neo4jDriver');
const logger = require('./utils/logger');

// Import performance configuration
const performanceConfig = require('./config/performance');

// Import workers
const FileAnalysisWorker = require('./workers/StreamingFileAnalysisWorker');
const DirectoryResolutionWorker = require('./workers/directoryResolutionWorker');
const GlobalResolutionWorker = require('./workers/globalResolutionWorker');
const ValidationWorker = require('./workers/ValidationWorker');
const ReconciliationWorker = require('./workers/ReconciliationWorker');
const GraphIngestionWorker = require('./workers/GraphIngestionWorker');

class OptimizedCognitiveTriangulationPipeline {
    constructor(config) {
        this.config = config;
        this.targetDirectory = config.targetDirectory;
        this.runId = uuidv4();
        this.dbManager = null;
        this.cacheClient = null;
        this.queueManager = null;
        this.neo4jDriver = null;
        this.workers = [];
        this.startTime = null;
        this.performanceMetrics = {
            filesProcessed: 0,
            poisFound: 0,
            relationshipsFound: 0,
            llmCalls: 0,
            cacheHits: 0,
            errors: 0
        };
    }

    async initialize() {
        logger.info('🚀 Initializing Optimized Cognitive Triangulation Pipeline', {
            runId: this.runId,
            targetDirectory: this.targetDirectory,
            cpuCount: performanceConfig.cpuCount
        });

        try {
            // Initialize enhanced database with optimizations
            this.dbManager = new EnhancedDatabaseManager();
            await this.dbManager.initialize();
            
            // Optimize database on startup
            await this.dbManager.optimize();
            
            // Initialize cache client
            this.cacheClient = getCacheClient();
            
            // Initialize queue manager with performance settings
            this.queueManager = new EnhancedQueueManager(
                this.config.redis || { host: 'localhost', port: 6379 }
            );
            await this.queueManager.connect();
            
            // Initialize Neo4j driver
            this.neo4jDriver = getNeo4jDriver();
            
            // Initialize LLM client
            const { optimizedLlmClient } = require('./utils/optimizedLlmClient');
            this.llmClient = optimizedLlmClient;
            
            // Initialize workers with optimized concurrency
            await this.initializeWorkers();
            
            logger.info('✅ Pipeline initialized successfully');
        } catch (error) {
            logger.error('❌ Pipeline initialization failed:', error);
            throw error;
        }
    }

    async initializeWorkers() {
        const workerClasses = [
            { Class: FileAnalysisWorker, name: 'FileAnalysisWorker' },
            { Class: DirectoryResolutionWorker, name: 'DirectoryResolutionWorker' },
            { Class: GlobalResolutionWorker, name: 'GlobalResolutionWorker' },
            { Class: ValidationWorker, name: 'ValidationWorker' },
            { Class: ReconciliationWorker, name: 'ReconciliationWorker' },
            { Class: GraphIngestionWorker, name: 'GraphIngestionWorker' }
        ];

        for (const { Class, name } of workerClasses) {
            const config = performanceConfig.getWorkerConfig(name);
            const worker = new Class(
                this.queueManager,
                this.dbManager,
                this.cacheClient,
                this.llmClient,
                {
                    concurrency: config.concurrency,
                    stalledInterval: config.stalledInterval,
                    maxStalledCount: config.maxStalledCount,
                    ...config.settings
                }
            );
            this.workers.push(worker);
            logger.info(`Initialized ${name} with concurrency: ${config.concurrency}`);
        }
    }

    async run() {
        this.startTime = Date.now();
        logger.info('🏃 Starting optimized pipeline run', { runId: this.runId });

        try {
            // Phase 1: Incremental file discovery with hashing
            const entityScout = new EntityScout(
                this.queueManager,
                this.cacheClient,
                this.targetDirectory,
                this.runId,
                this.dbManager
            );
            
            const { totalJobs, stats } = await entityScout.run();
            this.performanceMetrics.filesProcessed = stats.newFiles + stats.changedFiles;
            
            if (totalJobs === 0) {
                logger.info('No changes detected. Skipping analysis.');
                return await this.generateReport();
            }

            // Phase 2: Wait for file analysis to complete
            await this.waitForPhase('file-analysis', totalJobs);
            
            // Phase 3: Run optimized relationship resolution
            const relationshipResolver = new OptimizedRelationshipResolver(
                this.dbManager,
                this.llmClient
            );
            await relationshipResolver.run(this.runId);
            this.performanceMetrics.relationshipsFound = relationshipResolver.stats.relationshipsFound;
            this.performanceMetrics.llmCalls += relationshipResolver.stats.llmQueries;
            
            // Phase 4: Wait for validation and reconciliation
            await this.waitForPhase('validation', 'auto');
            
            // Phase 5: Build graph with optimized bulk operations
            const graphBuilder = new GraphBuilder(
                this.dbManager.getDb(),
                this.neo4jDriver,
                this.config.neo4j?.database || 'neo4j'
            );
            await graphBuilder.run();
            
            // Generate final report
            return await this.generateReport();
            
        } catch (error) {
            logger.error('❌ Pipeline run failed:', error);
            this.performanceMetrics.errors++;
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    async waitForPhase(phaseName, expectedJobs = 'auto') {
        logger.info(`⏳ Waiting for ${phaseName} phase to complete...`);
        
        const checkInterval = 5000; // 5 seconds
        const maxWaitTime = 600000; // 10 minutes
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            const queueName = `${phaseName}-queue`;
            const queue = this.queueManager.getQueue(queueName);
            
            if (!queue) {
                logger.warn(`Queue ${queueName} not found, phase may be complete`);
                break;
            }
            
            const counts = await queue.getJobCounts();
            const activeJobs = counts.active + counts.waiting + counts.delayed;
            
            if (activeJobs === 0) {
                logger.info(`✅ ${phaseName} phase completed`);
                break;
            }
            
            logger.info(`${phaseName} progress: ${counts.completed} completed, ${activeJobs} remaining`);
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
    }

    async generateReport() {
        const endTime = Date.now();
        const duration = endTime - this.startTime;
        
        // Get database statistics
        const dbStats = this.dbManager.getStats();
        
        // Calculate performance metrics
        const filesPerSecond = this.performanceMetrics.filesProcessed / (duration / 1000);
        const avgTimePerFile = duration / this.performanceMetrics.filesProcessed;
        
        const report = {
            runId: this.runId,
            status: 'completed',
            duration: `${(duration / 1000).toFixed(2)}s`,
            performance: {
                filesProcessed: this.performanceMetrics.filesProcessed,
                filesPerSecond: filesPerSecond.toFixed(2),
                avgTimePerFile: `${avgTimePerFile.toFixed(0)}ms`,
                poisFound: this.performanceMetrics.poisFound,
                relationshipsFound: this.performanceMetrics.relationshipsFound,
                llmCalls: this.performanceMetrics.llmCalls,
                cacheHits: this.performanceMetrics.cacheHits,
                errors: this.performanceMetrics.errors
            },
            database: {
                queries: dbStats.queries,
                transactions: dbStats.transactions,
                errors: dbStats.errors
            },
            optimization: {
                cpuCores: performanceConfig.cpuCount,
                concurrency: performanceConfig.optimalConcurrency
            }
        };
        
        logger.info('📊 Pipeline Report:', report);
        
        // Save report to cache
        await this.cacheClient.set(
            `run:${this.runId}:report`,
            JSON.stringify(report),
            'EX',
            86400 // 24 hours
        );
        
        return report;
    }

    async cleanup() {
        logger.info('🧹 Cleaning up resources...');
        
        try {
            // Stop all workers
            await Promise.all(this.workers.map(w => w.close?.()));
            
            // Close database connections
            if (this.dbManager) {
                await this.dbManager.close();
            }
            
            // Close cache client
            if (this.cacheClient) {
                await this.cacheClient.quit();
            }
            
            // Close queue manager
            if (this.queueManager) {
                await this.queueManager.close();
            }
            
            // Close Neo4j driver
            if (this.neo4jDriver) {
                await this.neo4jDriver.close();
            }
            
            logger.info('✅ Cleanup completed');
        } catch (error) {
            logger.error('Error during cleanup:', error);
        }
    }
}

// Main execution
async function main() {
    const config = {
        targetDirectory: process.argv[2] || process.cwd(),
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379
        },
        neo4j: {
            uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
            user: process.env.NEO4J_USER || 'neo4j',
            password: process.env.NEO4J_PASSWORD || 'test1234',
            database: process.env.NEO4J_DATABASE || 'neo4j'
        }
    };
    
    const pipeline = new OptimizedCognitiveTriangulationPipeline(config);
    
    try {
        await pipeline.initialize();
        const report = await pipeline.run();
        
        console.log('\n========================================');
        console.log('PIPELINE COMPLETED SUCCESSFULLY');
        console.log('========================================');
        console.log(`Duration: ${report.duration}`);
        console.log(`Files Processed: ${report.performance.filesProcessed}`);
        console.log(`Performance: ${report.performance.filesPerSecond} files/second`);
        console.log(`Relationships Found: ${report.performance.relationshipsFound}`);
        console.log('========================================\n');
        
        process.exit(0);
    } catch (error) {
        console.error('Pipeline failed:', error);
        process.exit(1);
    }
}

// Export for testing
module.exports = OptimizedCognitiveTriangulationPipeline;

// Run if called directly
if (require.main === module) {
    main();
}