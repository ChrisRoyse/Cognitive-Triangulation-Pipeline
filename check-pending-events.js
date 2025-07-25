#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function checkPendingEvents() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== PENDING OUTBOX EVENTS DETAILS ===\n');
    
    try {
        // Get all pending events with full details
        const pendingEvents = db.prepare(`
            SELECT id, run_id, event_type, payload, status, created_at
            FROM outbox
            WHERE status = 'PENDING'
            ORDER BY created_at
            LIMIT 10
        `).all();
        
        for (const event of pendingEvents) {
            console.log(`Event ID: ${event.id}`);
            console.log(`Run ID: ${event.run_id}`);
            console.log(`Type: ${event.event_type}`);
            console.log(`Status: ${event.status}`);
            console.log(`Created: ${event.created_at}`);
            console.log(`Payload: ${event.payload.substring(0, 200)}...`);
            console.log('-'.repeat(80));
        }
        
        // Check latest processed events
        console.log('\n=== LATEST PROCESSED EVENTS ===\n');
        const processedEvents = db.prepare(`
            SELECT id, event_type, status, created_at
            FROM outbox
            WHERE status != 'PENDING'
            ORDER BY created_at DESC
            LIMIT 5
        `).all();
        
        if (processedEvents.length === 0) {
            console.log('No processed events found');
        } else {
            for (const event of processedEvents) {
                console.log(`Event ID: ${event.id} - Type: ${event.event_type} - Status: ${event.status} - Created: ${event.created_at}`);
            }
        }
        
        // Check if TransactionalOutboxPublisher is running
        console.log('\n=== OUTBOX PUBLISHER STATUS ===\n');
        
        // Get event age
        const oldestPending = db.prepare(`
            SELECT id, created_at, 
                   (julianday('now') - julianday(created_at)) * 24 * 60 as age_minutes
            FROM outbox
            WHERE status = 'PENDING'
            ORDER BY created_at
            LIMIT 1
        `).get();
        
        if (oldestPending) {
            console.log(`Oldest pending event age: ${oldestPending.age_minutes.toFixed(2)} minutes`);
            if (oldestPending.age_minutes > 5) {
                console.log('⚠️  WARNING: Events are not being processed! TransactionalOutboxPublisher may not be running.');
            }
        }
        
        db.close();
        
    } catch (err) {
        console.error('Error checking events:', err);
        db.close();
    }
}

checkPendingEvents();