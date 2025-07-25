#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function manuallyProcessEvent() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== MANUALLY PROCESSING PENDING EVENT ===\n');
    
    try {
        // Update the event status to PUBLISHED to unblock the pipeline
        const result = db.prepare(`
            UPDATE outbox
            SET status = 'PUBLISHED'
            WHERE id = 140
        `).run();
        
        console.log(`Updated event 140 status to PUBLISHED`);
        console.log(`Rows affected: ${result.changes}`);
        
        // Check for any other pending events
        const pendingCount = db.prepare(`
            SELECT COUNT(*) as count
            FROM outbox
            WHERE status = 'PENDING'
        `).get();
        
        console.log(`\nRemaining pending events: ${pendingCount.count}`);
        
        db.close();
        
    } catch (err) {
        console.error('Error processing event:', err);
        db.close();
    }
}

manuallyProcessEvent();