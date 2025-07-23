const { DatabaseManager } = require('./utils/sqliteDb');
const neo4jDriver = require('./utils/neo4jDriver');
const { getInstance: getQueueManagerInstance } = require('./utils/queueManager');
const { getCacheClient, closeCacheClient } = require('./utils/cacheClient');
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

class SimplifiedCognitiveTriangulationPipeline {
    constructor(targetDirectory, dbPath = './database.db') {
        this.targetDirectory = targetDirectory;
        this.dbPath = dbPath;
        this.runId = uuidv4();
        this.queueManager = getQueueManagerInstance();
        this.dbManager = new DatabaseManager(this.dbPath);
        
        // Initialize database schema early to avoid table not found errors
        this.dbManager.initializeDb();
        console.log('🚀 [main-simplified.js] Database schema initialized in constructor.');
        
        this.cacheClient = getCacheClient();
        this.llmClient = getDeepseekClient();
        
        this.outboxPublisher = new TransactionalOutboxPublisher(this.dbManager, this.queueManager);
        this.workers = []; // Track workers for cleanup
        this.metrics = {
            startTime: null,
            endTime: null,
            totalJobs: 0,
            deadlockDetected: false,
            lastActivityTime: Date.now()
        };
        
        // Deadlock detection
        this.deadlockCheckInterval = null;
        this.lastJobCounts = { active: 0, waiting: 0, completed: 0, failed: 0 };
        this.unchangedChecks = 0;
    }

    async initialize() {
        console.log('🚀 [main-simplified.js] Initializing Simplified Cognitive Triangulation Pipeline...');
        await this.queueManager.connect();
        await this.clearDatabases();
        console.log('✅ [main-simplified.js] Databases and clients initialized successfully');
    }

    async run() {
        console.log(`🚀 [main-simplified.js] Simplified pipeline run started with ID: ${this.runId}`);
        this.metrics.startTime = new Date();
        try {
            await this.initialize();

            console.log('🏁 [main-simplified.js] Starting workers with basic concurrency control...');
            this.startSimplifiedWorkers();
            this.outboxPublisher.start();

            // Start deadlock detection
            this.startDeadlockDetection();

            console.log('🔍 [main-simplified.js] Starting EntityScout to produce jobs...');
            const entityScout = new EntityScout(this.queueManager, this.cacheClient, this.targetDirectory, this.runId);
            const { totalJobs } = await entityScout.run();
            this.metrics.totalJobs = totalJobs;
            console.log(`✅ [main-simplified.js] EntityScout created ${totalJobs} initial jobs.`);

            console.log('⏳ [main-simplified.js] Waiting for all jobs to complete...');
            await this.waitForCompletion();
            console.log('🎉 [main-simplified.js] All analysis and reconciliation jobs completed!');
            
            console.log('🏗️ [main-simplified.js] Starting final graph build...');
            const graphBuilder = new GraphBuilderWorker(this.dbManager.getDb(), neo4jDriver);
            await graphBuilder.run();
            console.log('✅ [main-simplified.js] Graph build complete.');

            this.metrics.endTime = new Date();
            await this.printFinalReport();
        } catch (error) {
            console.error('❌ [main-simplified.js] Critical error in pipeline execution:', error);
            throw error;
        } finally {
            this.stopDeadlockDetection();
            await this.close();
        }
    }

    startSimplifiedWorkers() {
        console.log('🚀 [main-simplified.js] Starting basic workers with conservative concurrency...');
        
        try {
            // Conservative concurrency settings to avoid deadlocks
            const concurrencySettings = {
                fileAnalysis: 3,      // Conservative for LLM calls
                directoryResolution: 2,
                directoryAggregation: 4,
                relationshipResolution: 2,
                validation: 5,        // Can handle more
                reconciliation: 3
            };
            
            // Create workers with basic BullMQ configuration (no WorkerPoolManager)
            const fileAnalysisWorker = new FileAnalysisWorker(
                this.queueManager, 
                this.dbManager, 
                this.cacheClient, 
                this.llmClient, 
                null,  // No workerPoolManager
                { 
                    concurrency: concurrencySettings.fileAnalysis
                }
            );
            this.workers.push(fileAnalysisWorker);
            
            const directoryResolutionWorker = new DirectoryResolutionWorker(
                this.queueManager, 
                this.dbManager, 
                this.cacheClient, 
                this.llmClient, 
                null,  // No workerPoolManager
                { 
                    concurrency: concurrencySettings.directoryResolution
                }
            );
            this.workers.push(directoryResolutionWorker);
            
            const directoryAggregationWorker = new DirectoryAggregationWorker(
                this.queueManager, 
                this.cacheClient, 
                null,  // No workerPoolManager
                { 
                    concurrency: concurrencySettings.directoryAggregation
                }
            );
            this.workers.push(directoryAggregationWorker);
            
            const relationshipResolutionWorker = new RelationshipResolutionWorker(
                this.queueManager, 
                this.dbManager, 
                this.llmClient, 
                null,  // No workerPoolManager
                { 
                    concurrency: concurrencySettings.relationshipResolution
                }
            );
            this.workers.push(relationshipResolutionWorker);
            
            const validationWorker = new ValidationWorker(
                this.queueManager, 
                this.dbManager, 
                this.cacheClient, 
                null,  // No workerPoolManager
                { 
                    concurrency: concurrencySettings.validation
                }
            );
            this.workers.push(validationWorker);
            
            const reconciliationWorker = new ReconciliationWorker(
                this.queueManager, 
                this.dbManager, 
                null,  // No workerPoolManager
                { 
                    concurrency: concurrencySettings.reconciliation
                }
            );
            this.workers.push(reconciliationWorker);
            
            console.log('✅ All simplified workers are running with basic concurrency control.');
            console.log(`📊 Concurrency Settings: FileAnalysis=${concurrencySettings.fileAnalysis}, DirectoryResolution=${concurrencySettings.directoryResolution}, DirectoryAggregation=${concurrencySettings.directoryAggregation}, RelationshipResolution=${concurrencySettings.relationshipResolution}, Validation=${concurrencySettings.validation}, Reconciliation=${concurrencySettings.reconciliation}`);
            
        } catch (error) {
            console.error('❌ [main-simplified.js] Error starting workers:', error);
            throw error;
        }
    }

    startDeadlockDetection() {
        console.log('🔍 [main-simplified.js] Starting deadlock detection...');
        this.deadlockCheckInterval = setInterval(async () => {
            try {
                const counts = await this.queueManager.getJobCounts();
                
                // Check if job counts haven't changed (potential deadlock)
                const currentState = `${counts.active}-${counts.waiting}-${counts.completed}-${counts.failed}`;
                const lastState = `${this.lastJobCounts.active}-${this.lastJobCounts.waiting}-${this.lastJobCounts.completed}-${this.lastJobCounts.failed}`;
                
                if (currentState === lastState && counts.active > 0) {
                    this.unchangedChecks++;
                    console.warn(`⚠️  [Deadlock Detection] Job counts unchanged for ${this.unchangedChecks} checks. Active: ${counts.active}, Waiting: ${counts.waiting}`);
                    
                    // Detect deadlock after 5 unchanged checks (25 seconds with 5s intervals)
                    if (this.unchangedChecks >= 5) {
                        this.metrics.deadlockDetected = true;
                        console.error(`🚨 [Deadlock Detection] DEADLOCK DETECTED! Jobs stuck for ${this.unchangedChecks * 5} seconds.`);
                        console.error(`🚨 Current state: Active: ${counts.active}, Waiting: ${counts.waiting}, Completed: ${counts.completed}, Failed: ${counts.failed}`);
                        
                        // Log additional debugging info
                        await this.logDeadlockDiagnostics();
                    }
                } else {
                    this.unchangedChecks = 0;
                    this.metrics.lastActivityTime = Date.now();
                }
                
                this.lastJobCounts = counts;
                
            } catch (error) {
                console.error('❌ [Deadlock Detection] Error checking for deadlocks:', error);
            }
        }, 5000); // Check every 5 seconds
    }

    async logDeadlockDiagnostics() {
        try {
            console.log('🔍 [Deadlock Diagnostics] Gathering diagnostic information...');
            
            // Get queue details
            const queueNames = ['file-analysis-queue', 'directory-resolution-queue', 'directory-aggregation-queue', 
                              'relationship-resolution-queue', 'validation-queue', 'reconciliation-queue'];
            
            for (const queueName of queueNames) {
                try {
                    const queue = this.queueManager.getQueue(queueName);
                    const waiting = await queue.getWaiting();
                    const active = await queue.getActive();
                    const failed = await queue.getFailed();
                    
                    console.log(`📊 [${queueName}] Waiting: ${waiting.length}, Active: ${active.length}, Failed: ${failed.length}`);
                    
                    if (active.length > 0) {
                        console.log(`🔍 [${queueName}] Active jobs:`, active.slice(0, 3).map(job => ({
                            id: job.id,
                            processedOn: job.processedOn,
                            delay: job.processedOn ? Date.now() - job.processedOn : 'N/A'
                        })));
                    }
                } catch (error) {
                    console.error(`❌ Error getting queue details for ${queueName}:`, error.message);
                }
            }
            
        } catch (error) {
            console.error('❌ Error gathering deadlock diagnostics:', error);
        }
    }

    stopDeadlockDetection() {
        if (this.deadlockCheckInterval) {
            clearInterval(this.deadlockCheckInterval);
            this.deadlockCheckInterval = null;
            console.log('🛑 [main-simplified.js] Stopped deadlock detection.');
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
        
        console.log(`\n🎯 ====== Simplified Cognitive Triangulation Report ======`);
        console.log(`Run ID: ${this.runId}`);
        console.log(`⏱️  Total Duration: ${durationSeconds} seconds`);
        console.log(`📈 Total Initial Jobs: ${this.metrics.totalJobs}`);
        console.log(`🚨 Deadlock Detected: ${this.metrics.deadlockDetected ? 'YES' : 'NO'}`);
        
        // Get final job counts
        try {
            const finalCounts = await this.queueManager.getJobCounts();
            console.log(`📊 Final Job Counts - Active: ${finalCounts.active}, Waiting: ${finalCounts.waiting}, Completed: ${finalCounts.completed}, Failed: ${finalCounts.failed}`);
            
            const completionRate = this.metrics.totalJobs > 0 ? 
                ((finalCounts.completed / this.metrics.totalJobs) * 100).toFixed(1) : 'N/A';
            console.log(`📈 Job Completion Rate: ${completionRate}%`);
        } catch (error) {
            console.error('❌ Error getting final job counts:', error);
        }
        
        console.log(`=======================================================\n`);
    }

    async waitForCompletion() {
        return new Promise((resolve, reject) => {
            const checkInterval = 5000; // Check every 5 seconds
            let idleChecks = 0;
            const requiredIdleChecks = 3; // Require 3 consecutive idle checks to be sure
            const maxWaitTime = 600000; // 10 minutes max wait time
            const startTime = Date.now();

            const intervalId = setInterval(async () => {
                try {
                    // Check if we've exceeded max wait time
                    if (Date.now() - startTime > maxWaitTime) {
                        console.error('❌ [Queue Monitor] Maximum wait time exceeded. Forcing completion.');
                        const counts = await this.queueManager.getJobCounts();
                        console.error(`Final stats - Completed: ${counts.completed}, Failed: ${counts.failed}, Still Active: ${counts.active + counts.waiting + counts.delayed}`);
                        clearInterval(intervalId);
                        resolve(); // Force completion rather than reject to allow GraphBuilder to run
                        return;
                    }
                    
                    // Check for deadlock
                    if (this.metrics.deadlockDetected) {
                        console.error('❌ [Queue Monitor] Deadlock detected. Aborting wait for completion.');
                        clearInterval(intervalId);
                        reject(new Error('Pipeline deadlock detected'));
                        return;
                    }
                    
                    const counts = await this.queueManager.getJobCounts();
                    const totalActive = counts.active + counts.waiting + counts.delayed;
                    const totalProcessed = counts.completed + counts.failed;
                    const failureRate = totalProcessed > 0 ? counts.failed / totalProcessed : 0;
                    
                    console.log(`[Queue Monitor] Active: ${counts.active}, Waiting: ${counts.waiting}, Completed: ${counts.completed}, Failed: ${counts.failed}, Failure Rate: ${(failureRate * 100).toFixed(1)}%`);

                    // Check for excessive failure rate (allow up to 50% failure)
                    if (totalProcessed > 10 && failureRate > 0.5) {
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
                    clearInterval(intervalId);
                    reject(error);
                }
            }, checkInterval);
        });
    }

    async close() {
        console.log('🚀 [main-simplified.js] Closing connections...');
        
        try {
            // Stop outbox publisher
            this.outboxPublisher.stop();
            
            // Gracefully shutdown all workers
            console.log('🛑 [main-simplified.js] Shutting down workers...');
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
            
            // Close other connections
            await this.queueManager.closeConnections();
            await closeCacheClient();
            
            const driver = neo4jDriver;
            if (process.env.NODE_ENV !== 'test' && driver) {
                await driver.close();
            }
            
            this.dbManager.close();
            console.log('✅ [main-simplified.js] All connections closed gracefully.');
            
        } catch (error) {
            console.error('❌ [main-simplified.js] Error during cleanup:', error);
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
        pipeline = new SimplifiedCognitiveTriangulationPipeline(targetDirectory);
        await pipeline.run();
        console.log('🎉 Simplified cognitive triangulation pipeline completed successfully!');
        if (isTestMode) {
            // In test mode, we exit cleanly for the test runner.
            process.exit(0);
        }
    } catch (error) {
        console.error('💥 Fatal error in simplified pipeline:', error);
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

module.exports = { SimplifiedCognitiveTriangulationPipeline, main };