#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const QueueManager = require('./src/utils/queueManager');
const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');

async function testOutbox() {
    console.log('🧪 Testing TransactionalOutboxPublisher...');
    
    try {
        // Create connections
        const dbManager = new DatabaseManager('./database.db');
        const queueManager = new QueueManager();
        
        // Check current state
        const db = dbManager.getDb();
        const outboxCount = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ?').get('PENDING');
        const poisCount = db.prepare('SELECT COUNT(*) as count FROM pois').get();
        const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
        
        console.log(`📦 Outbox PENDING: ${outboxCount.count}`);
        console.log(`👥 POIs: ${poisCount.count}`);
        console.log(`🔗 Relationships: ${relCount.count}`);
        
        if (outboxCount.count > 0) {
            console.log('🔄 Starting outbox publisher...');
            const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
            publisher.start();
            
            // Wait a bit for processing
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            publisher.stop();
            
            // Check results
            const newPoisCount = db.prepare('SELECT COUNT(*) as count FROM pois').get();
            const newRelCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
            
            console.log(`👥 POIs after: ${newPoisCount.count}`);
            console.log(`🔗 Relationships after: ${newRelCount.count}`);
        }
        
        await queueManager.closeConnections();
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testOutbox();