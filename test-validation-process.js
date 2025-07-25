const { DatabaseManager } = require('./src/utils/sqliteDb');
const { getCacheClient } = require('./src/utils/cacheClient');
const { getInstance: getQueueManagerInstance } = require('./src/utils/queueManager');
const ValidationWorker = require('./src/workers/ValidationWorker');
const ReconciliationWorker = require('./src/workers/ReconciliationWorker');

async function testValidationProcess() {
    console.log('🧪 Testing Validation and Reconciliation Process...');
    
    const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
    const dbManager = new DatabaseManager(dbPath);
    const cacheClient = getCacheClient();
    const queueManager = getQueueManagerInstance();
    
    try {
        // Check current database state
        console.log('\n=== Initial Database State ===');
        const relationships = dbManager.getDb().prepare('SELECT status, COUNT(*) as count FROM relationships GROUP BY status').all();
        const evidence = dbManager.getDb().prepare('SELECT COUNT(*) as count FROM relationship_evidence').get();
        console.log('Evidence records:', evidence.count);
        console.log('Relationships by status:');
        console.table(relationships);
        
        // Get a pending job from the analysis-findings-queue
        const analysisQueue = queueManager.getQueue('analysis-findings-queue');
        const waitingJobs = await analysisQueue.getWaiting();
        console.log('\n=== Queue State ===');
        console.log('Waiting validation jobs:', waitingJobs.length);
        
        if (waitingJobs.length > 0) {
            console.log('\n=== Processing Validation Job ===');
            
            // Create ValidationWorker instance
            const validationWorker = new ValidationWorker(
                queueManager, 
                dbManager, 
                cacheClient, 
                null, // no workerPoolManager for test
                { processOnly: true } // Don't start worker, just use process method
            );
            
            // Get the first job and process it
            const job = waitingJobs[0];
            console.log('Processing job:', job.id, 'with', job.data.relationships.length, 'relationships');
            
            try {
                await validationWorker.process(job);
                console.log('✅ Validation job processed successfully');
                
                // Remove the job from the queue manually since we're testing
                await job.remove();
                
            } catch (error) {
                console.error('❌ Validation job failed:', error);
            }
        }
        
        // Check reconciliation queue
        const reconciliationQueue = queueManager.getQueue('reconciliation-queue');
        const reconciliationWaiting = await reconciliationQueue.getWaiting();
        console.log('\nReconciliation jobs created:', reconciliationWaiting.length);
        
        if (reconciliationWaiting.length > 0) {
            console.log('\n=== Processing Reconciliation Jobs ===');
            
            // Create ReconciliationWorker instance
            const reconciliationWorker = new ReconciliationWorker(
                queueManager, 
                dbManager, 
                null, // no workerPoolManager for test
                { processOnly: true } // Don't start worker, just use process method
            );
            
            // Process first few reconciliation jobs
            const jobsToProcess = Math.min(5, reconciliationWaiting.length);
            for (let i = 0; i < jobsToProcess; i++) {
                const job = reconciliationWaiting[i];
                console.log(`Processing reconciliation job ${i+1}/${jobsToProcess}: ${job.data.relationshipHash}`);
                
                try {
                    await reconciliationWorker.process(job);
                    console.log(`✅ Reconciliation job ${i+1} processed successfully`);
                    
                    // Remove the job from the queue manually since we're testing
                    await job.remove();
                    
                } catch (error) {
                    console.error(`❌ Reconciliation job ${i+1} failed:`, error);
                }
            }
        }
        
        // Check final database state
        console.log('\n=== Final Database State ===');
        const finalRelationships = dbManager.getDb().prepare('SELECT status, COUNT(*) as count FROM relationships GROUP BY status').all();
        console.log('Relationships by status:');
        console.table(finalRelationships);
        
        // Show sample validated relationships
        const sampleValidated = dbManager.getDb().prepare(`
            SELECT r.id, r.type, r.confidence, p1.name as source_name, p2.name as target_name
            FROM relationships r
            JOIN pois p1 ON r.source_poi_id = p1.id
            JOIN pois p2 ON r.target_poi_id = p2.id
            WHERE r.status = 'VALIDATED'
            LIMIT 5
        `).all();
        
        if (sampleValidated.length > 0) {
            console.log('\nSample validated relationships:');
            console.table(sampleValidated);
        }
        
        console.log('\n🎉 Test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        dbManager.close();
        process.exit(0);
    }
}

testValidationProcess();