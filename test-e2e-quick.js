// Quick test of the end-to-end flow

const { DatabaseManager } = require('./src/utils/sqliteDb');
const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');
const { getInstance: getQueueManager } = require('./src/utils/queueManager');
const neo4j = require('neo4j-driver');
const config = require('./src/config.js');

async function quickE2ETest() {
    console.log('⚡ Quick End-to-End Pipeline Test');
    
    const dbManager = new DatabaseManager('./data/database.db');
    const queueManager = getQueueManager();
    const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
    const db = dbManager.getDb();
    const runId = `quick-${Date.now()}`;
    
    // Wait for Redis connection
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 1. Create outbox event
    console.log('\n1️⃣  Creating outbox event...');
    db.prepare(`
        INSERT INTO outbox (run_id, event_type, payload, status) 
        VALUES (?, ?, ?, ?)
    `).run(runId, 'file-analysis-finding', JSON.stringify({
        runId: runId,
        filePath: '/test/quick.js',
        pois: [{
            id: 'quick-poi',
            name: 'quickTest',
            type: 'FunctionDefinition',
            startLine: 1,
            endLine: 5
        }]
    }), 'PENDING');
    console.log('✅ Outbox event created');
    
    // 2. Process with publisher
    console.log('\n2️⃣  Processing with TransactionalOutboxPublisher...');
    publisher.start();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await publisher.flushBatches();
    
    const poisCount = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path = ?').get('/test/quick.js');
    const outboxStatus = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status = ?').get(runId, 'PUBLISHED');
    
    console.log(`📊 POIs in SQLite: ${poisCount.count}`);
    console.log(`📊 Outbox processed: ${outboxStatus.count}`);
    
    // 3. Test Neo4j connection
    console.log('\n3️⃣  Testing Neo4j connection...');
    const driver = neo4j.driver(config.NEO4J_URI, neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD));
    
    try {
        const session = driver.session();
        const result = await session.run('RETURN 1 as test');
        const canConnect = result.records.length > 0;
        console.log(`📊 Neo4j connection: ${canConnect ? '✅ Success' : '❌ Failed'}`);
        await session.close();
        
        await publisher.stop();
        await driver.close();
        
        const allSystemsWorking = poisCount.count > 0 && outboxStatus.count > 0 && canConnect;
        console.log(`\n🎉 ${allSystemsWorking ? '✅ SUCCESS' : '❌ FAILED'}: End-to-end pipeline ${allSystemsWorking ? 'working' : 'broken'}`);
        
        if (allSystemsWorking) {
            console.log('\n🔄 Pipeline Flow Verified:');
            console.log('   Outbox Events → TransactionalOutboxPublisher → SQLite POIs ✅');
            console.log('   SQLite Data → Neo4j Connection Ready ✅');
            console.log('   All authentication issues resolved ✅');
        }
        
        return allSystemsWorking;
        
    } catch (neo4jError) {
        console.log(`📊 Neo4j connection: ❌ Error - ${neo4jError.message}`);
        await publisher.stop();
        return false;
    }
}

quickE2ETest().catch(console.error);