const { DatabaseManager } = require('./src/utils/sqliteDb');
const { getCacheClient } = require('./src/utils/cacheClient');

async function fixRedisRelMap() {
    console.log('🔧 Fixing Redis rel_map entries for existing evidence...');
    
    const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
    const dbManager = new DatabaseManager(dbPath);
    const cacheClient = getCacheClient();
    
    try {
        // Get all evidence records grouped by run_id and relationship_hash
        const evidence = dbManager.getDb().prepare(`
            SELECT run_id, relationship_hash, COUNT(*) as count
            FROM relationship_evidence 
            GROUP BY run_id, relationship_hash
        `).all();
        
        console.log(`Found ${evidence.length} unique relationship hashes with evidence`);
        
        // Group by run_id
        const runGroups = {};
        for (const row of evidence) {
            if (!runGroups[row.run_id]) {
                runGroups[row.run_id] = {};
            }
            runGroups[row.run_id][row.relationship_hash] = row.count;
        }
        
        // Populate Redis rel_map for each run
        let totalRelationships = 0;
        for (const [runId, relationships] of Object.entries(runGroups)) {
            const relMapKey = `run:${runId}:rel_map`;
            const pipeline = cacheClient.pipeline();
            
            for (const [hash, count] of Object.entries(relationships)) {
                pipeline.hset(relMapKey, hash, count);
                totalRelationships++;
            }
            
            await pipeline.exec();
            console.log(`✅ Set rel_map for run ${runId}: ${Object.keys(relationships).length} relationships`);
        }
        
        console.log(`✅ Successfully populated Redis rel_map with ${totalRelationships} relationship mappings across ${Object.keys(runGroups).length} runs`);
        
        // Now check if there are any validation jobs that need to be reprocessed
        const { getInstance: getQueueManagerInstance } = require('./src/utils/queueManager');
        const queueManager = getQueueManagerInstance();
        
        // Add validation jobs for relationships that have evidence but haven't been validated
        for (const [runId, relationships] of Object.entries(runGroups)) {
            const batchedPayload = Object.keys(relationships).map(hash => ({
                relationshipHash: hash,
                evidencePayload: { synthetic: true, runId: runId, hash: hash }
            }));
            
            if (batchedPayload.length > 0) {
                const queue = queueManager.getQueue('analysis-findings-queue');
                await queue.add('validate-relationships-batch', {
                    runId: runId,
                    relationships: batchedPayload
                });
                
                console.log(`✅ Queued validation job for run ${runId} with ${batchedPayload.length} relationships`);
            }
        }
        
        console.log('🎉 Redis rel_map fix completed successfully!');
        
    } catch (error) {
        console.error('❌ Error fixing Redis rel_map:', error);
    } finally {
        dbManager.close();
        process.exit(0);
    }
}

fixRedisRelMap();