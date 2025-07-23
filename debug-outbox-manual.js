// Debug the outbox publisher manually

const { DatabaseManager } = require('./src/utils/sqliteDb');
const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');
const { getInstance: getQueueManager } = require('./src/utils/queueManager');

async function debugOutboxManual() {
    console.log('🔍 Debug Outbox Publisher Manual Test');
    
    const dbManager = new DatabaseManager('./data/database.db');
    
    // Initialize database first
    await dbManager.initializeDb();
    console.log('✅ Database initialized');
    
    const queueManager = getQueueManager();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for Redis
    
    const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
    
    const db = dbManager.getDb();
    const runId = `debug-manual-${Date.now()}`;
    
    console.log('\n1️⃣  Manually creating outbox events...');
    
    // Create POI event
    const poiPayload = JSON.stringify({
        runId: runId,
        filePath: '/test/manual.js',
        pois: [
            {
                id: 'manual-poi-1',
                name: 'testFunction',
                type: 'FunctionDefinition',
                startLine: 1,
                endLine: 10
            },
            {
                id: 'manual-poi-2',
                name: 'TestClass',
                type: 'ClassDefinition',
                startLine: 12,
                endLine: 25
            }
        ]
    });
    
    db.prepare(`
        INSERT INTO outbox (run_id, event_type, payload, status) 
        VALUES (?, ?, ?, ?)
    `).run(runId, 'file-analysis-finding', poiPayload, 'PENDING');
    
    // Create relationship event
    const relPayload = JSON.stringify({
        runId: runId,
        relationships: [
            {
                from: 'testFunction',
                to: 'TestClass',
                type: 'CALLS',
                filePath: '/test/manual.js',
                confidence: 0.9
            }
        ]
    });
    
    db.prepare(`
        INSERT INTO outbox (run_id, event_type, payload, status) 
        VALUES (?, ?, ?, ?)
    `).run(runId, 'relationship-analysis-finding', relPayload, 'PENDING');
    
    console.log('✅ Created 2 outbox events');
    
    // Check before processing
    const beforeOutbox = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE run_id = ?').get(runId);
    const beforePois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(runId);
    const beforeRels = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE file_path = ?').get('/test/manual.js');
    
    console.log('\\n📊 Before processing:');
    console.log('  Outbox events:', beforeOutbox.count);
    console.log('  POIs:', beforePois.count);
    console.log('  Relationships:', beforeRels.count);
    
    console.log('\\n2️⃣  Starting publisher and processing...');
    
    // Start publisher
    publisher.start();
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Force flush
    await publisher.flushBatches();
    
    // Check after processing
    const afterOutbox = db.prepare('SELECT status, COUNT(*) as count FROM outbox WHERE run_id = ? GROUP BY status').all(runId);
    const afterPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(runId);
    const afterRels = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE file_path = ?').get('/test/manual.js');
    
    console.log('\\n📊 After processing:');
    console.log('  Outbox status:');
    afterOutbox.forEach(o => console.log('    ' + o.status + ': ' + o.count));
    console.log('  POIs:', afterPois.count);
    console.log('  Relationships:', afterRels.count);
    
    if (afterPois.count > 0) {
        const poisDetails = db.prepare('SELECT name, type, run_id FROM pois WHERE run_id = ?').all(runId);
        console.log('\\n📝 POIs created:');
        poisDetails.forEach(poi => console.log('    - ' + poi.name + ' (' + poi.type + ') run_id: ' + poi.run_id));
    }
    
    if (afterRels.count > 0) {
        const relsDetails = db.prepare(`
            SELECT r.type, r.status, r.confidence_score, 
                   s.name as source_name, t.name as target_name
            FROM relationships r
            JOIN pois s ON r.source_poi_id = s.id
            JOIN pois t ON r.target_poi_id = t.id
            WHERE r.file_path = ?
        `).all('/test/manual.js');
        
        console.log('\\n🔗 Relationships created:');
        relsDetails.forEach(rel => console.log('    - ' + rel.source_name + ' ' + rel.type + ' ' + rel.target_name + ' (status: ' + (rel.status || 'NULL') + ')'));
    }
    
    await publisher.stop();
    
    const success = afterPois.count > 0;
    console.log('\\n' + (success ? '✅ SUCCESS' : '❌ FAILED') + ': Manual outbox processing ' + (success ? 'worked' : 'failed'));
    
    return success;
}

debugOutboxManual().catch(console.error);