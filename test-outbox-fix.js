const { DatabaseManager } = require('./src/utils/sqliteDb');
const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');
const { getInstance: getQueueManager } = require('./src/utils/queueManager');
const crypto = require('crypto');

async function testOutboxPublisherFix() {
    console.log('🧪 Testing TransactionalOutboxPublisher Fix...');
    
    // Initialize dependencies
    const dbManager = new DatabaseManager('./data/database.db');
    const queueManager = getQueueManager();
    // Wait for Redis connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
    await publisher.start();
    
    // Create test outbox events
    const db = dbManager.getDb();
    const runId = `test-${Date.now()}`;
    
    // Test POI insertion
    const testPoiEvent = {
        run_id: runId,
        event_type: 'file-analysis-finding',
        payload: JSON.stringify({
            runId: runId,
            filePath: '/test/sample.js',
            pois: [
                {
                    id: 'test-poi-1',
                    name: 'testFunction',
                    type: 'FunctionDefinition',
                    startLine: 1,
                    endLine: 10
                },
                {
                    id: 'test-poi-2', 
                    name: 'TestClass',
                    type: 'ClassDefinition',
                    startLine: 12,
                    endLine: 25
                }
            ]
        }),
        status: 'PENDING'
    };
    
    // Test relationship insertion
    const testRelEvent = {
        run_id: runId,
        event_type: 'relationship-analysis-finding',
        payload: JSON.stringify({
            runId: runId,
            relationships: [
                {
                    from: 'testFunction',
                    to: 'TestClass',
                    type: 'CALLS',
                    filePath: '/test/sample.js',
                    confidence: 0.9,
                    evidence: 'Function calls class constructor'
                }
            ]
        }),
        status: 'PENDING'
    };
    
    // Insert test events
    const insertStmt = db.prepare(`
        INSERT INTO outbox (run_id, event_type, payload, status) 
        VALUES (?, ?, ?, ?)
    `);
    
    insertStmt.run(testPoiEvent.run_id, testPoiEvent.event_type, testPoiEvent.payload, testPoiEvent.status);
    insertStmt.run(testRelEvent.run_id, testRelEvent.event_type, testRelEvent.payload, testRelEvent.status);
    
    console.log('✅ Created test outbox events');
    
    // Check initial state
    console.log('\n📊 Before processing:');
    const poisBefore = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(runId);
    const relsBefore = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?').get(runId);
    console.log('POIs:', poisBefore.count);
    console.log('Relationships:', relsBefore.count);
    
    // Wait a bit for publisher to process
    console.log('\n⏳ Waiting for publisher to process events...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Force flush any pending batches
    await publisher.flushBatches();
    
    // Check final state
    console.log('\n📊 After processing:');
    const poisAfter = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(runId);
    const relsAfter = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?').get(runId);
    console.log('POIs:', poisAfter.count);
    console.log('Relationships:', relsAfter.count);
    
    // Check outbox status
    const outboxStatus = db.prepare('SELECT status, COUNT(*) as count FROM outbox WHERE run_id = ? GROUP BY status').all(runId);
    console.log('Outbox status:', outboxStatus);
    
    // Show inserted data
    if (poisAfter.count > 0) {
        console.log('\n📝 Inserted POIs:');
        const insertedPois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(runId);
        insertedPois.forEach(poi => console.log(`- ${poi.name} (${poi.type})`));
    }
    
    if (relsAfter.count > 0) {
        console.log('\n🔗 Inserted Relationships:');
        const insertedRels = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(runId);
        insertedRels.forEach(rel => console.log(`- ${rel.from_poi} ${rel.relationship_type} ${rel.to_poi}`));
    }
    
    await publisher.stop();
    await queueManager.shutdown();
    
    // Validate success
    const success = poisAfter.count >= 2 && relsAfter.count >= 1;
    console.log(`\n${success ? '✅ SUCCESS' : '❌ FAILED'}: Publisher fix is ${success ? 'working' : 'not working'}`);
    
    return success;
}

testOutboxPublisherFix().catch(console.error);