const { DatabaseManager } = require('./src/utils/sqliteDb');
const crypto = require('crypto');

async function testPublisherDirectly() {
    console.log('🧪 Simple Publisher Test...');
    
    const dbManager = new DatabaseManager('./data/database.db');
    const db = dbManager.getDb();
    
    // Clean up any existing test data
    db.prepare('DELETE FROM outbox WHERE run_id LIKE ?').run('simple-test-%');
    
    const runId = `simple-test-${Date.now()}`;
    
    // Create a single file-analysis-finding event
    const poiEvent = {
        run_id: runId,
        event_type: 'file-analysis-finding',
        payload: JSON.stringify({
            runId: runId,
            filePath: '/test/simple.js',
            pois: [
                {
                    id: 'simple-poi-1',
                    name: 'simpleFunction',
                    type: 'FunctionDefinition',
                    startLine: 1,
                    endLine: 10
                }
            ]
        }),
        status: 'PENDING'
    };
    
    // Insert the event
    const insertStmt = db.prepare(`
        INSERT INTO outbox (run_id, event_type, payload, status) 
        VALUES (?, ?, ?, ?)
    `);
    
    insertStmt.run(poiEvent.run_id, poiEvent.event_type, poiEvent.payload, poiEvent.status);
    console.log('✅ Created test outbox event');
    
    // Check initial counts
    const initialPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path = ?').get('/test/simple.js');
    console.log('📊 Initial POIs:', initialPois.count);
    
    // Let the publisher process manually
    const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');
    const { getInstance: getQueueManager } = require('./src/utils/queueManager');
    
    const queueManager = getQueueManager();
    const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
    
    // Start publisher
    publisher.start();
    
    // Wait for processing
    console.log('⏳ Waiting for publisher to process...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Force flush
    await publisher.flushBatches();
    
    // Check final counts
    const finalPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path = ?').get('/test/simple.js');
    const outboxStatus = db.prepare('SELECT status, COUNT(*) as count FROM outbox WHERE run_id = ? GROUP BY status').all(runId);
    
    console.log('📊 Final POIs:', finalPois.count);
    console.log('📊 Outbox status:', outboxStatus);
    
    // Show POIs if any
    if (finalPois.count > 0) {
        const pois = db.prepare('SELECT * FROM pois WHERE file_path = ?').all('/test/simple.js');
        console.log('📝 Inserted POIs:');
        pois.forEach(poi => console.log(`  - ${poi.name} (${poi.type})`));
    }
    
    await publisher.stop();
    
    const success = finalPois.count > 0;
    console.log(`\n${success ? '✅ SUCCESS' : '❌ FAILED'}: ${success ? 'POI was inserted' : 'No POIs inserted'}`);
    
    return success;
}

testPublisherDirectly().catch(console.error);