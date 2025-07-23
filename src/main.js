const { DatabaseManager } = require('./utils/sqliteDb');
const neo4jDriver = require('./utils/neo4jDriver');
const { getInstance: getQueueManagerInstance } = require('./utils/queueManager');
const { getCacheClient, closeCacheClient } = require('./utils/cacheClient');
const { WorkerPoolManager } = require('./utils/workerPoolManager');
const EntityScout = require('./agents/EntityScout');
const FileAnalysisWorker = require('./workers/fileAnalysisWorker');
const DirectoryResolutionWorker = require('./workers/directoryResolutionWorker');
const DirectoryAggregationWorker = require('./workers/directoryAggregationWorker');
const RelationshipResolutionWorker = require('./workers/relationshipResolutionWorker');
const ValidationWorker = require('./workers/ValidationWorker');
const ReconciliationWorker = require('./workers/ReconciliationWorker');
const GraphBuilderWorker = require('./agents/GraphBuilder');
const TransactionalOutboxPublisher = require('./services/TransactionalOutboxPublisher');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');
const { getDeepseekClient } = require('./utils/deepseekClient');
const { PipelineConfig } = require('./config/pipelineConfig');

class CognitiveTriangulationPipeline {
    constructor(targetDirectory, dbPath = './database.db', options = {}) {
        this.targetDirectory = targetDirectory;
        this.dbPath = dbPath;
        this.runId = uuidv4();
        this.queueManager = getQueueManagerInstance();
        this.dbManager = new DatabaseManager(this.dbPath);
        
        // Use centralized configuration
        this.pipelineConfig = options.pipelineConfig || PipelineConfig.createDefault();
        console.log('🔧 Pipeline Configuration:', this.pipelineConfig.getSummary());
        
        this.cacheClient = getCacheClient();
        this.llmClient = getDeepseekClient();
        
        // Initialize WorkerPoolManager using centralized config
        this.workerPoolManager = new WorkerPoolManager({
            environment: this.pipelineConfig.environment,
            maxGlobalConcurrency: this.pipelineConfig.TOTAL_WORKER_CONCURRENCY,
            cpuThreshold: this.pipelineConfig.performance.cpuThreshold,
            memoryThreshold: this.pipelineConfig.performance.memoryThreshold
        });
        
        this.outboxPublisher = null; // Will be initialized after database setup
        this.workers = []; // Track workers for cleanup
        this.metrics = {
            startTime: null,
            endTime: null,
            totalJobs: 0,
        };
    }

    async initialize() {
        console.log('🚀 [main.js] Initializing Cognitive Triangulation v2 Pipeline...');
        
        // Initialize database schema with migrations
        await this.dbManager.initializeDb();
        console.log('🚀 [main.js] Database schema initialized with migrations.');
        
        // Initialize outbox publisher after database is ready
        this.outboxPublisher = new TransactionalOutboxPublisher(this.dbManager, this.queueManager);
        console.log('🚀 [main.js] TransactionalOutboxPublisher initialized.');
        
        await this.queueManager.connect();
        await this.clearDatabases();
        console.log('✅ [main.js] Databases and clients initialized successfully');
    }

    async run() {
        console.log(`🚀 [main.js] Pipeline run started with ID: ${this.runId}`);
        this.metrics.startTime = new Date();
        try {
            await this.initialize();

            console.log('🏁 [main.js] Starting workers and services...');
            await this.startWorkers();
            this.outboxPublisher.start();

            console.log('🔍 [main.js] Starting EntityScout to produce jobs...');
            const entityScout = new EntityScout(this.queueManager, this.cacheClient, this.targetDirectory, this.runId);
            const { totalJobs } = await entityScout.run();
            this.metrics.totalJobs = totalJobs;
            console.log(`✅ [main.js] EntityScout created ${totalJobs} initial jobs.`);

            console.log('⏳ [main.js] Waiting for all jobs to complete...');
            await this.waitForCompletion();
            console.log('🎉 [main.js] All analysis and reconciliation jobs completed!');
            
            console.log('🏗️ [main.js] Starting final graph build...');
            const graphBuilder = new GraphBuilderWorker(this.dbManager.getDb(), neo4jDriver);
            await graphBuilder.run();
            console.log('✅ [main.js] Graph build complete.');

            this.metrics.endTime = new Date();
            await this.printFinalReport();
        } catch (error) {
            console.error('❌ [main.js] Critical error in pipeline execution:', error);
            throw error;
        } finally {
            await this.close();
        }
    }

    async startWorkers() {
        console.log('🚀 [main.js] Starting managed workers with intelligent concurrency control...');
        
        try {
            // Create and initialize workers with centralized configuration
            const fileAnalysisWorker = new FileAnalysisWorker(
                this.queueManager, 
                this.dbManager, 
                this.cacheClient, 
                this.llmClient, 
                this.workerPoolManager,
                { pipelineConfig: this.pipelineConfig }
            );
            
            // Initialize the managed worker if it exists
            if (fileAnalysisWorker.managedWorker) {
                await fileAnalysisWorker.initializeWorker();
            }
            
            this.workers.push(fileAnalysisWorker);
            
            const directoryResolutionWorker = new DirectoryResolutionWorker(
                this.queueManager, 
                this.dbManager, 
                this.cacheClient, 
                this.llmClient, 
                this.workerPoolManager
            );
            if (directoryResolutionWorker.managedWorker) {
                await directoryResolutionWorker.initializeWorker();
            }
            this.workers.push(directoryResolutionWorker);
            
            const directoryAggregationWorker = new DirectoryAggregationWorker(
                this.queueManager, 
                this.cacheClient, 
                this.workerPoolManager
            );
            if (directoryAggregationWorker.managedWorker) {
                await directoryAggregationWorker.initializeWorker();
            }
            this.workers.push(directoryAggregationWorker);
            
            const relationshipResolutionWorker = new RelationshipResolutionWorker(
                this.queueManager, 
                this.dbManager, 
                this.llmClient, 
                this.workerPoolManager
            );
            if (relationshipResolutionWorker.managedWorker) {
                await relationshipResolutionWorker.initializeWorker();
            }
            this.workers.push(relationshipResolutionWorker);
            
            const validationWorker = new ValidationWorker(
                this.queueManager, 
                this.dbManager, 
                this.cacheClient, 
                this.workerPoolManager
            );
            if (validationWorker.managedWorker) {
                await validationWorker.initializeWorker();
            }
            this.workers.push(validationWorker);
            
            const reconciliationWorker = new ReconciliationWorker(
                this.queueManager, 
                this.dbManager, 
                this.workerPoolManager
            );
            if (reconciliationWorker.managedWorker) {
                await reconciliationWorker.initializeWorker();
            }
            this.workers.push(reconciliationWorker);
            
            console.log('✅ All managed workers are running and listening for jobs.');
            
            // Log worker pool status
            const status = this.workerPoolManager.getStatus();
            console.log(`📊 WorkerPoolManager Status: ${Object.keys(status.workers).length} workers registered, max global concurrency: ${status.globalConcurrency.max}`);
            
        } catch (error) {
            console.error('❌ [main.js] Error starting workers:', error);
            throw error;
        }
    }

    async clearDatabases() {
        const db = this.dbManager.getDb();
        console.log('🗑️ Clearing SQLite database...');
        db.exec('DELETE FROM relationships');
        db.exec('DELETE FROM relationship_evidence');
        db.exec('DELETE FROM pois');
        db.exec('DELETE FROM files');
        db.exec('DELETE FROM directory_summaries');

        console.log('🗑️ Clearing Redis database...');
        await this.cacheClient.flushdb();

        const driver = neo4jDriver;
        console.log('🗑️ Clearing Neo4j database...');
        const session = driver.session({ database: config.NEO4J_DATABASE });
        try {
            await session.run('MATCH (n) DETACH DELETE n');
            console.log('✅ Neo4j database cleared successfully');
        } catch (error) {
            console.error('❌ Error clearing Neo4j database:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    async printFinalReport() {
        const duration = this.metrics.endTime - this.metrics.startTime;
        const durationSeconds = Math.round(duration / 1000);
        
        console.log(`\n🎯 ====== Cognitive Triangulation v2 Report ======`);
        console.log(`Run ID: ${this.runId}`);
        console.log(`⏱️  Total Duration: ${durationSeconds} seconds`);
        console.log(`📈 Total Initial Jobs: ${this.metrics.totalJobs}`);
        console.log(`==============================================\n`);
    }

    async waitForCompletion() {
        return new Promise((resolve, reject) => {
            const checkInterval = 5000; // Check every 5 seconds
            const maxWaitTime = 10 * 60 * 1000; // 10 minutes maximum wait time
            const maxFailureRate = 0.5; // Allow up to 50% job failure rate
            const startTime = Date.now();
            let idleChecks = 0;
            const requiredIdleChecks = 3; // Require 3 consecutive idle checks to be sure

            const intervalId = setInterval(async () => {
                try {
                    const counts = await this.queueManager.getJobCounts();
                    const totalActive = counts.active + counts.waiting + counts.delayed;
                    const totalProcessed = counts.completed + counts.failed;
                    const failureRate = totalProcessed > 0 ? counts.failed / totalProcessed : 0;
                    
                    console.log(`[Queue Monitor] Active: ${counts.active}, Waiting: ${counts.waiting}, Completed: ${counts.completed}, Failed: ${counts.failed}, Failure Rate: ${(failureRate * 100).toFixed(1)}%`);

                    // Check for timeout
                    if (Date.now() - startTime > maxWaitTime) {
                        console.error('❌ [Queue Monitor] Maximum wait time exceeded. Forcing completion.');
                        console.error(`Final stats - Completed: ${counts.completed}, Failed: ${counts.failed}, Still Active: ${totalActive}`);
                        clearInterval(intervalId);
                        resolve(); // Force completion rather than reject to allow GraphBuilder to run
                        return;
                    }

                    // Check for excessive failure rate
                    if (totalProcessed > 10 && failureRate > maxFailureRate) {
                        console.error(`❌ [Queue Monitor] Excessive failure rate (${(failureRate * 100).toFixed(1)}%). Forcing completion.`);
                        console.error(`Final stats - Completed: ${counts.completed}, Failed: ${counts.failed}, Still Active: ${totalActive}`);
                        clearInterval(intervalId);
                        resolve(); // Force completion to allow partial results processing
                        return;
                    }

                    if (totalActive === 0) {
                        idleChecks++;
                        console.log(`[Queue Monitor] Queues appear idle. Check ${idleChecks}/${requiredIdleChecks}.`);
                        if (idleChecks >= requiredIdleChecks) {
                            console.log(`✅ [Queue Monitor] Pipeline completion - Completed: ${counts.completed}, Failed: ${counts.failed}`);
                            clearInterval(intervalId);
                            resolve();
                        }
                    } else {
                        idleChecks = 0; // Reset if we see activity
                    }
                } catch (error) {
                    console.error('[Queue Monitor] Error checking job counts:', error);
                    clearInterval(intervalId);
                    reject(error);
                }
            }, checkInterval);
        });
    }

    async close() {
        console.log('🚀 [main.js] Closing connections...');
        
        try {
            // Stop outbox publisher
            this.outboxPublisher.stop();
            
            // Gracefully shutdown all workers
            console.log('🛑 [main.js] Shutting down workers...');
            const workerShutdowns = this.workers.map(async (worker) => {
                if (worker && typeof worker.close === 'function') {
                    try {
                        await worker.close();
                    } catch (error) {
                        console.error('❌ Error closing worker:', error);
                    }
                }
            });
            await Promise.all(workerShutdowns);
            
            // Shutdown WorkerPoolManager
            if (this.workerPoolManager) {
                await this.workerPoolManager.shutdown();
            }
            
            // Close other connections
            await this.queueManager.closeConnections();
            await closeCacheClient();
            
            const driver = neo4jDriver;
            if (process.env.NODE_ENV !== 'test' && driver) {
                await driver.close();
            }
            
            this.dbManager.close();
            console.log('✅ [main.js] All connections closed gracefully.');
            
        } catch (error) {
            console.error('❌ [main.js] Error during cleanup:', error);
            throw error;
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    const targetDirectory = args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd();
    const isTestMode = args.includes('--test-mode');
    let pipeline;

    try {
        pipeline = new CognitiveTriangulationPipeline(targetDirectory);
        await pipeline.run();
        console.log('🎉 Cognitive triangulation pipeline completed successfully!');
        if (isTestMode) {
            // In test mode, we exit cleanly for the test runner.
            process.exit(0);
        }
    } catch (error) {
        console.error('💥 Fatal error in pipeline:', error);
        if (pipeline) {
            await pipeline.close();
        }
        process.exit(1);
    }
}

// Only run main if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = { CognitiveTriangulationPipeline, main };