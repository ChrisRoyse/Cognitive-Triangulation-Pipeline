#!/usr/bin/env node

const sqliteDb = require('./src/utils/sqliteDb');
const { DatabaseManager } = require('./src/utils/sqliteDb');

async function debugDbTables() {
    console.log('=== DATABASE TABLES DEBUG ===\n');
    
    try {
        // Initialize database first
        const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
        const dbManager = new DatabaseManager(dbPath);
        await dbManager.initializeDb();
        const db = dbManager.getDb();
        
        // List all tables
        console.log('All tables in database:');
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        tables.forEach(table => {
            console.log(`  - ${table.name}`);
        });
        console.log('');
        
        // Check for outbox tables specifically
        const outboxTables = tables.filter(t => t.name.includes('outbox'));
        console.log('Outbox-related tables:');
        outboxTables.forEach(table => {
            console.log(`  - ${table.name}`);
        });
        console.log('');
        
        // Check if we can insert into outbox table
        console.log('Testing insert into outbox table:');
        try {
            const testInsert = db.prepare('INSERT INTO outbox (event_type, payload, status) VALUES (?, ?, ?)');
            const result = testInsert.run('test-event', '{"test": true}', 'PENDING');
            console.log(`✅ Successfully inserted test record with ID: ${result.lastInsertRowid}`);
            
            // Clean up
            db.prepare('DELETE FROM outbox WHERE id = ?').run(result.lastInsertRowid);
            console.log('✅ Test record cleaned up');
        } catch (error) {
            console.error(`❌ Failed to insert into outbox: ${error.message}`);
            console.error(error.stack);
        }
        
        // Check if we can insert into outbox_events (if it exists)
        if (outboxTables.some(t => t.name === 'outbox_events')) {
            console.log('\nTesting insert into outbox_events table:');
            try {
                const testInsert = db.prepare('INSERT INTO outbox_events (event_type, payload, status) VALUES (?, ?, ?)');
                const result = testInsert.run('test-event', '{"test": true}', 'PENDING');
                console.log(`✅ Successfully inserted test record with ID: ${result.lastInsertRowid}`);
                
                // Clean up
                db.prepare('DELETE FROM outbox_events WHERE id = ?').run(result.lastInsertRowid);
                console.log('✅ Test record cleaned up');
            } catch (error) {
                console.error(`❌ Failed to insert into outbox_events: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error during debug:', error.message);
        console.error(error.stack);
    }
}

debugDbTables().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});