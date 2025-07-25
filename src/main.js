const { DatabaseManager } = require('./utils/sqliteDb');
const neo4jDriver = require('./utils/neo4jDriver');
const { getInstance: getQueueManagerInstance } = require('./utils/queueManager');
const { WorkerPoolManager } = require('./utils/workerPoolManager');
const { PipelineError } = require('./utils/PipelineError');
const { ErrorReporter } = require('./utils/ErrorReporter');
const { ShutdownCoordinator } = require('./utils/shutdownCoordinator');
const EntityScout = require('./agents/EntityScout');
const FileAnalysisWorker = require('./workers/fileAnalysisWorker');
const DirectoryResolutionWorker = require('./workers/directoryResolutionWorker');
const DirectoryAggregationWorker = require('./workers/directoryAggregationWorker');
const RelationshipResolutionWorker = require('./workers/relationshipResolutionWorker');
const GlobalRelationshipAnalysisWorker = require('./workers/GlobalRelationshipAnalysisWorker');
const ValidationWorker = require('./workers/ValidationWorker');
const ReconciliationWorker = require('./workers/ReconciliationWorker');
const StandardGraphBuilder = require('./agents/StandardGraphBuilder');
const TransactionalOutboxPublisher = require('./services/TransactionalOutboxPublisher');
const TriangulatedAnalysisQueue = require('./services/triangulation/TriangulatedAnalysisQueue');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');
const { getDeepseekClient } = require('./utils/deepseekClient');
const { PipelineConfig } = require('./config/pipelineConfig');

class CognitiveTriangulationPipeline {
    constructor(targetDirectory, dbPath = null, options = {}) {
        this.targetDirectory = targetDirectory;
        this.pipelineConfig = options.pipelineConfig || PipelineConfig.createDefault();
        this.dbPath = dbPath || this.pipelineConfig.database.sqlite.path;
        this.runId = uuidv4();
        this.queueManager = getQueueManagerInstance();
        this.dbManager = new DatabaseManager(this.dbPath);
        this.llmClient = getDeepseekClient();
        
        // Initialize error reporting system
        this.errorReporter = new ErrorReporter({
            metricsPath: options.errorMetricsPath || './data/error-metrics.json',
            reportPath: options.errorReportPath || './data/error-reports'
        });
        this.workerPoolManager = new WorkerPoolManager({
            environment: this.pipelineConfig.environment,
            maxGlobalConcurrency: this.pipelineConfig.TOTAL_WORKER_CONCURRENCY,
            cpuThreshold: this.pipelineConfig.performance.cpuThreshold,
            memoryThreshold: this.pipelineConfig.performance.memoryThreshold
        });
        this.outboxPublisher = null;
        this.triangulatedAnalysisQueue = null;
        this.workers = [];
        this.metrics = {
            startTime: null,
            endTime: null,
            totalJobs: 0,
        };
    }

    async initialize() {
        console.log('🚀 [main.js] Initializing Cognitive Triangulation v2 Pipeline...');
        
        await this.dbManager.initializeDb();
        console.log('✅ [main.js] Database schema initialized.');
        
        this.outboxPublisher = new TransactionalOutboxPublisher(this.dbManager, this.queueManager);
        this.triangulatedAnalysisQueue = new TriangulatedAnalysisQueue(
            this.dbManager,
            this.queueManager,
            {
                concurrency: this.pipelineConfig.triangulation?.concurrency || 2,
                confidenceThreshold: this.pipelineConfig.triangulation?.confidenceThreshold || 0.45,
                enableAutoTrigger: this.pipelineConfig.triangulation?.enableAutoTrigger !== false,
                processingTimeout: this.pipelineConfig.triangulation?.processingTimeout || 300000
            }
        );
        
        await this.queueManager.connect();
        await this.clearDatabases();
        console.log('✅ [main.js] Databases and clients initialized successfully');
    }

    async run() {
        console.log(`🚀 [main.js] Pipeline run started with ID: ${this.runId}`);
        this.metrics.startTime = new Date();
        
        try {
            await this.initialize();
            await this.startWorkers();
            
            this.outboxPublisher.start();
            await this.triangulatedAnalysisQueue.start();

            console.log('🔍 [main.js] Starting EntityScout to produce jobs...');
            const entityScout = new EntityScout(this.queueManager, this.targetDirectory, this.runId, this.dbManager);
            const { totalJobs } = await entityScout.run();
            this.metrics.totalJobs = totalJobs;
            console.log(`✅ [main.js] EntityScout created ${totalJobs} initial jobs.`);

            console.log('⏳ [main.js] Waiting for all jobs to complete...');
            await this.waitForCompletion();
            console.log('🎉 [main.js] All analysis and reconciliation jobs completed!');
            
            console.log('🏗️ [main.js] Starting final graph build...');
            const graphBuilder = new StandardGraphBuilder(this.dbManager.getDb(), neo4jDriver, config.NEO4J_DATABASE);
            await graphBuilder.run();
            console.log('✅ [main.js] Graph build complete.');

            this.metrics.endTime = new Date();
            await this.printFinalReport();
        } catch (error) {
            // Create enhanced error with comprehensive context
            const pipelineError = await this._createEnhancedError(error, 'PIPELINE_EXECUTION', {
                stage: 'main_execution',
                runId: this.runId,
                targetDirectory: this.targetDirectory,
                duration: this.metrics.startTime ? Date.now() - this.metrics.startTime : 0,
                totalJobs: this.metrics.totalJobs
            });
            
            // Report the error through the centralized system
            await this.errorReporter.reportError(pipelineError);
            
            console.error('❌ [main.js] Critical error in pipeline execution:', {
                ...pipelineError.toLogObject(),
                actionSuggestions: pipelineError.getActionSuggestions().slice(0, 3)
            });
            
            throw pipelineError;
        } finally {
            await this.close();
        }
    }

    async startWorkers() {
        console.log('🚀 [main.js] Starting workers...');
        
        try {
            const fileAnalysisWorker = new FileAnalysisWorker(
                this.queueManager, 
                this.dbManager, 
                this.llmClient, 
                this.workerPoolManager,
                { pipelineConfig: this.pipelineConfig }
            );
            if (fileAnalysisWorker.managedWorker) {
                await fileAnalysisWorker.initializeWorker();
            }
            this.workers.push(fileAnalysisWorker);
            
            const directoryResolutionWorker = new DirectoryResolutionWorker(
                this.queueManager, 
                this.dbManager, 
                this.llmClient, 
                this.workerPoolManager
            );
            if (directoryResolutionWorker.managedWorker) {
                await directoryResolutionWorker.initializeWorker();
            }
            this.workers.push(directoryResolutionWorker);
            
            const directoryAggregationWorker = new DirectoryAggregationWorker(
                this.queueManager, 
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
                this.workerPoolManager,
                { pipelineConfig: this.pipelineConfig }
            );
            if (relationshipResolutionWorker.managedWorker) {
                await relationshipResolutionWorker.initializeWorker();
            }
            this.workers.push(relationshipResolutionWorker);
            
            const globalRelationshipAnalysisWorker = new GlobalRelationshipAnalysisWorker(
                this.queueManager, 
                this.dbManager, 
                this.llmClient, 
                this.workerPoolManager,
                { pipelineConfig: this.pipelineConfig }
            );
            if (globalRelationshipAnalysisWorker.managedWorker) {
                await globalRelationshipAnalysisWorker.initializeWorker();
            }
            this.workers.push(globalRelationshipAnalysisWorker);
            
            const validationWorker = new ValidationWorker(
                this.queueManager, 
                this.dbManager, 
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
            
            console.log('✅ All workers are running and listening for jobs.');
            
        } catch (error) {
            // Create enhanced error for worker startup failure
            const workerError = await this._createEnhancedError(error, 'WORKER_STARTUP', {
                stage: 'worker_initialization',
                runId: this.runId,
                workersCreated: this.workers.length,
                targetWorkerTypes: [
                    'FileAnalysisWorker',
                    'DirectoryResolutionWorker', 
                    'DirectoryAggregationWorker',
                    'RelationshipResolutionWorker',
                    'GlobalRelationshipAnalysisWorker',
                    'ValidationWorker',
                    'ReconciliationWorker'
                ]
            });
            
            // Report the error
            await this.errorReporter.reportError(workerError);
            
            console.error('❌ [main.js] Error starting workers:', {
                ...workerError.toLogObject(),
                actionSuggestions: workerError.getActionSuggestions().slice(0, 2)
            });
            
            throw workerError;
        }
    }

    async clearDatabases() {
        const db = this.dbManager.getDb();
        console.log('🗑️ Clearing SQLite database...');
        
        const tables = [
            'relationships',
            'relationship_evidence',
            'pois',
            'files',
            'directory_summaries',
            'triangulated_analysis_sessions',
            'triangulated_analysis_results'
        ];
        
        for (const table of tables) {
            try {
                db.exec(`DELETE FROM ${table}`);
            } catch (error) {
                if (!error.message.includes('no such table')) {
                    throw error;
                }
            }
        }

        console.log('🗑️ Clearing Redis queues...');
        await this.queueManager.clearAllQueues();

        const driver = neo4jDriver;
        console.log('🗑️ Clearing Neo4j database...');
        const session = driver.session({ database: config.NEO4J_DATABASE });
        
        try {
            await session.writeTransaction(async (tx) => {
                await tx.run('MATCH (n) DETACH DELETE n');
            });
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
            const checkInterval = this.pipelineConfig.monitoring.checkIntervalMs;
            const maxWaitTime = this.pipelineConfig.monitoring.maxWaitTimeMs;
            const maxFailureRate = this.pipelineConfig.monitoring.maxFailureRate;
            const startTime = Date.now();
            let idleChecks = 0;
            const requiredIdleChecks = this.pipelineConfig.monitoring.requiredIdleChecks;

            const intervalId = setInterval(async () => {
                try {
                    const counts = await this.queueManager.getJobCounts();
                    const triangulatedCounts = await this.triangulatedAnalysisQueue.queue?.getJobCounts() || {};
                    const totalTriangulatedActive = (triangulatedCounts.active || 0) + (triangulatedCounts.waiting || 0);
                    
                    const totalActive = counts.active + counts.waiting + counts.delayed + totalTriangulatedActive;
                    const totalProcessed = counts.completed + counts.failed;
                    const failureRate = totalProcessed > 0 ? counts.failed / totalProcessed : 0;
                    
                    console.log(`[Queue Monitor] Active: ${counts.active}, Waiting: ${counts.waiting}, Completed: ${counts.completed}, Failed: ${counts.failed}`);

                    // Check for timeout
                    if (Date.now() - startTime > maxWaitTime) {
                        clearInterval(intervalId);
                        const timeoutError = PipelineError.timeout('pipeline-completion', maxWaitTime, {
                            runId: this.runId,
                            stage: 'completion_monitoring',
                            activeJobs: totalActive,
                            completed: counts.completed,
                            failed: counts.failed,
                            triangulatedActive: totalTriangulatedActive,
                            elapsedTime: Date.now() - startTime
                        });
                        
                        // Report timeout error
                        await this.errorReporter.reportError(timeoutError);
                        reject(timeoutError);
                        return;
                    }

                    // Check for excessive failure rate
                    if (totalProcessed > 10 && failureRate > maxFailureRate) {
                        clearInterval(intervalId);
                        const failureError = new PipelineError({
                            type: 'EXCESSIVE_FAILURES',
                            message: `Pipeline failure rate too high: ${(failureRate * 100).toFixed(1)}% (threshold: ${(maxFailureRate * 100).toFixed(1)}%)`,
                            context: {
                                runId: this.runId,
                                stage: 'completion_monitoring',
                                failureRate,
                                threshold: maxFailureRate,
                                completed: counts.completed,
                                failed: counts.failed,
                                totalProcessed,
                                triangulatedCounts
                            }
                        });
                        
                        // Report failure rate error
                        await this.errorReporter.reportError(failureError);
                        reject(failureError);
                        return;
                    }

                    if (totalActive === 0) {
                        idleChecks++;
                        console.log(`[Queue Monitor] Queues appear idle. Check ${idleChecks}/${requiredIdleChecks}.`);
                        if (idleChecks >= requiredIdleChecks) {
                            clearInterval(intervalId);
                            resolve();
                        }
                    } else {
                        idleChecks = 0;
                    }
                } catch (error) {
                    clearInterval(intervalId);
                    reject(error);
                }
            }, checkInterval);
        });
    }

    async close() {
        console.log('🚀 [main.js] Initiating shutdown...');
        
        try {
            // Stop outbox publisher
            if (this.outboxPublisher) {
                await Promise.race([
                    this.outboxPublisher.stop(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('OutboxPublisher stop timeout')), this.pipelineConfig.monitoring.shutdownTimeouts.outboxPublisher))
                ]);
                console.log('✅ [main.js] OutboxPublisher stopped.');
            }
            
            // Stop triangulated analysis queue
            if (this.triangulatedAnalysisQueue) {
                await Promise.race([
                    this.triangulatedAnalysisQueue.stop(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('TriangulatedAnalysisQueue stop timeout')), 10000))
                ]);
                console.log('✅ [main.js] TriangulatedAnalysisQueue stopped.');
            }
            
            // Shutdown workers
            console.log('🛑 [main.js] Shutting down workers...');
            for (const worker of this.workers) {
                if (worker && typeof worker.close === 'function') {
                    try {
                        await Promise.race([
                            worker.close(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error(`Worker ${worker.constructor.name} close timeout`)), 15000))
                        ]);
                        console.log(`✅ [main.js] Worker ${worker.constructor.name} closed successfully.`);
                    } catch (error) {
                        console.error(`❌ Error closing worker ${worker.constructor.name}:`, error.message);
                    }
                }
            }
            
            // Shutdown WorkerPoolManager
            if (this.workerPoolManager) {
                await Promise.race([
                    this.workerPoolManager.shutdown(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('WorkerPoolManager shutdown timeout')), 20000))
                ]);
                console.log('✅ [main.js] WorkerPoolManager shutdown successfully.');
            }
            
            // Close queue connections
            await Promise.race([
                this.queueManager.closeConnections(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('QueueManager close timeout')), 10000))
            ]);
            console.log('✅ [main.js] Queue connections closed successfully.');
            
            // Close Neo4j driver
            const driver = neo4jDriver;
            if (process.env.NODE_ENV !== 'test' && driver) {
                await Promise.race([
                    driver.close(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Neo4j driver close timeout')), 10000))
                ]);
                console.log('✅ [main.js] Neo4j driver closed successfully.');
            }
            
            // Close SQLite database
            this.dbManager.close();
            console.log('✅ [main.js] SQLite database closed successfully.');
            
            console.log('✅ [main.js] All connections closed gracefully.');
            
        } catch (error) {
            console.error('❌ [main.js] Error during cleanup:', error.message);
            throw error;
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    const targetDirectory = args.includes('--target') 
        ? args[args.indexOf('--target') + 1] 
        : (args[0] && !args[0].startsWith('--') ? args[0] : process.cwd());
    const isTestMode = args.includes('--test-mode');
    let pipeline;

    try {
        pipeline = new CognitiveTriangulationPipeline(targetDirectory);
        await pipeline.run();
        console.log('🎉 Cognitive triangulation pipeline completed successfully!');
        if (isTestMode) {
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