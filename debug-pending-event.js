#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function debugPendingEvent() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== DEBUGGING PENDING EVENT ===\n');
    
    try {
        // Get the specific pending event
        const event = db.prepare(`
            SELECT id, run_id, event_type, payload, status, created_at
            FROM outbox
            WHERE id = 140
        `).get();
        
        if (!event) {
            console.log('Event ID 140 not found');
            return;
        }
        
        console.log('Event Details:');
        console.log('ID:', event.id);
        console.log('Run ID:', event.run_id);
        console.log('Type:', event.event_type);
        console.log('Status:', event.status);
        console.log('Created:', event.created_at);
        
        // Parse and inspect the payload
        const payload = JSON.parse(event.payload);
        console.log('\nPayload Structure:');
        console.log('- File Path:', payload.filePath);
        console.log('- Run ID:', payload.runId);
        console.log('- POIs count:', payload.pois ? payload.pois.length : 0);
        
        if (payload.pois && payload.pois.length > 0) {
            console.log('\nFirst POI details:');
            const firstPoi = payload.pois[0];
            console.log(JSON.stringify(firstPoi, null, 2));
            
            // Check for issues
            console.log('\n=== VALIDATION CHECKS ===');
            for (let i = 0; i < payload.pois.length; i++) {
                const poi = payload.pois[i];
                const issues = [];
                
                if (!poi.name || typeof poi.name !== 'string') {
                    issues.push(`Missing or invalid 'name' field`);
                }
                if (!poi.type || typeof poi.type !== 'string') {
                    issues.push(`Missing or invalid 'type' field`);
                }
                if (typeof poi.startLine !== 'number') {
                    issues.push(`Missing or invalid 'startLine' field`);
                }
                if (typeof poi.endLine !== 'number') {
                    issues.push(`Missing or invalid 'endLine' field`);
                }
                
                if (issues.length > 0) {
                    console.log(`\nPOI ${i} has issues:`);
                    issues.forEach(issue => console.log(`  - ${issue}`));
                    console.log(`  POI data: ${JSON.stringify(poi).substring(0, 200)}...`);
                }
            }
        }
        
        // Check if file exists in files table
        const fileRecord = db.prepare(`
            SELECT id, file_path, status
            FROM files
            WHERE file_path = ?
        `).get(payload.filePath);
        
        console.log('\n=== FILE TABLE CHECK ===');
        if (fileRecord) {
            console.log('File exists in files table:');
            console.log('- ID:', fileRecord.id);
            console.log('- Path:', fileRecord.file_path);
            console.log('- Status:', fileRecord.status);
        } else {
            console.log('⚠️  File NOT found in files table!');
            console.log('This could be why the event cannot be processed.');
        }
        
        db.close();
        
    } catch (err) {
        console.error('Error debugging event:', err);
        db.close();
    }
}

debugPendingEvent();