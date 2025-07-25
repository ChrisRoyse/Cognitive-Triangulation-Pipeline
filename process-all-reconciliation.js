const { DatabaseManager } = require('./src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('./src/utils/queueManager');
const ReconciliationWorker = require('./src/workers/ReconciliationWorker');

async function processAllReconciliation() {
    console.log('🔄 Processing all reconciliation jobs...');
    
    const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
    const dbManager = new DatabaseManager(dbPath);
    const queueManager = getQueueManagerInstance();
    
    try {
        // Get all reconciliation jobs
        const reconciliationQueue = queueManager.getQueue('reconciliation-queue');
        const waitingJobs = await reconciliationQueue.getWaiting();
        
        console.log(`Found ${waitingJobs.length} reconciliation jobs to process`);
        
        if (waitingJobs.length === 0) {
            console.log('No reconciliation jobs to process');
            return;
        }
        
        // Create ReconciliationWorker instance
        const reconciliationWorker = new ReconciliationWorker(
            queueManager, 
            dbManager, 
            null, // no workerPoolManager for test
            { processOnly: true } // Don't start worker, just use process method
        );
        
        let processedCount = 0;
        let validatedCount = 0;
        let discardedCount = 0;
        
        console.log('\\n=== Processing Jobs ===');
        
        for (const job of waitingJobs) {
            try {
                console.log(`Processing job ${processedCount + 1}/${waitingJobs.length}: ${job.data.relationshipHash}`);
                
                // Check relationship status before processing
                const db = dbManager.getDb();
                const beforeStatus = db.prepare(`
                    SELECT status FROM relationships 
                    WHERE id IN (
                        SELECT DISTINCT relationship_id 
                        FROM relationship_evidence 
                        WHERE relationship_hash = ?
                    )
                `).get(job.data.relationshipHash);
                
                await reconciliationWorker.process(job);
                
                // Check relationship status after processing
                const afterStatus = db.prepare(`
                    SELECT status FROM relationships 
                    WHERE id IN (
                        SELECT DISTINCT relationship_id 
                        FROM relationship_evidence 
                        WHERE relationship_hash = ?
                    )
                `).get(job.data.relationshipHash);
                
                if (afterStatus && afterStatus.status === 'VALIDATED') {
                    validatedCount++;
                } else if (afterStatus && afterStatus.status === 'DISCARDED') {
                    discardedCount++;
                }
                
                // Remove the job from the queue
                await job.remove();
                processedCount++;
                
                // Log progress every 50 jobs
                if (processedCount % 50 === 0) {
                    console.log(`  Progress: ${processedCount}/${waitingJobs.length} (${Math.round(processedCount/waitingJobs.length*100)}%)`);
                }
                
            } catch (error) {
                console.error(`❌ Error processing job ${job.data.relationshipHash}:`, error.message);
            }
        }
        
        console.log('\\n=== Processing Complete ===');
        console.log(`✅ Processed: ${processedCount} jobs`);
        console.log(`🎯 Validated: ${validatedCount} relationships`);
        console.log(`🗑️  Discarded: ${discardedCount} relationships`);
        
        // Final database state
        const db = dbManager.getDb();
        const finalCounts = db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM relationships 
            GROUP BY status
        `).all();
        
        console.log('\\n=== Final Relationship Status ===');
        console.table(finalCounts);
        
        console.log('🎉 All reconciliation jobs processed successfully!');
        
    } catch (error) {
        console.error('❌ Error processing reconciliation jobs:', error);
    } finally {
        dbManager.close();
        process.exit(0);
    }
}

processAllReconciliation();