#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const { getInstance: getQueueManager } = require('./src/utils/queueManager');
const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');
const path = require('path');

async function processPendingRelationships() {
    console.log('\n=== PROCESSING PENDING RELATIONSHIPS ===\n');
    
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const queueManager = getQueueManager();
    
    // Initialize the publisher
    const publisher = new TransactionalOutboxPublisher(dbManager, queueManager, {
        batchSize: 100,
        flushInterval: 500,
        enableStats: true
    });
    
    try {
        // Start the publisher
        await publisher.start();
        console.log('✅ TransactionalOutboxPublisher started\n');
        
        // Let it process for 30 seconds
        console.log('Processing pending events for 30 seconds...');
        
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Stop the publisher
        await publisher.stop();
        console.log('\n✅ TransactionalOutboxPublisher stopped');
        
        // Check results
        const db = dbManager.getDb();
        const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
        console.log(`\nTotal relationships in database: ${relCount.count}`);
        
        const pendingCount = db.prepare(`
            SELECT COUNT(*) as count 
            FROM outbox 
            WHERE status = 'PENDING' 
            AND event_type = 'relationship-analysis-finding'
        `).get();
        console.log(`Remaining pending relationship events: ${pendingCount.count}`);
        
        if (relCount.count > 0) {
            const sampleRels = db.prepare(`
                SELECT r.id, r.source_poi_id, r.target_poi_id, r.type, r.confidence,
                       sp.name as source_name, sp.semantic_id as source_semantic,
                       tp.name as target_name, tp.semantic_id as target_semantic
                FROM relationships r
                JOIN pois sp ON r.source_poi_id = sp.id
                JOIN pois tp ON r.target_poi_id = tp.id
                LIMIT 5
            `).all();
            
            console.log('\nSample relationships created:');
            sampleRels.forEach(r => {
                console.log(`  ${r.source_semantic} -> ${r.target_semantic}`);
                console.log(`    (${r.source_name} -> ${r.target_name})`);
                console.log(`    Type: ${r.type}, Confidence: ${r.confidence}\n`);
            });
        }
        
        await queueManager.close();
        db.close();
        
    } catch (err) {
        console.error('Error:', err);
        await publisher.stop();
        await queueManager.close();
        dbManager.getDb().close();
    }
}

processPendingRelationships();