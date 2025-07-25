#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function debugPipeline() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== COMPREHENSIVE PIPELINE DEBUG ===\n');
    
    try {
        // 1. Check pending outbox events
        const pendingEvents = db.prepare(`
            SELECT event_type, COUNT(*) as count, MIN(created_at) as oldest
            FROM outbox
            WHERE status = 'PENDING'
            GROUP BY event_type
        `).all();
        
        console.log('1. Pending outbox events by type:');
        if (pendingEvents.length === 0) {
            console.log('   No pending events');
        } else {
            pendingEvents.forEach(e => {
                console.log(`   ${e.event_type}: ${e.count} events (oldest: ${e.oldest})`);
            });
        }
        
        // 2. Check processed events
        const processedEvents = db.prepare(`
            SELECT event_type, status, COUNT(*) as count
            FROM outbox
            WHERE status != 'PENDING'
            GROUP BY event_type, status
            ORDER BY event_type, status
        `).all();
        
        console.log('\n2. Processed outbox events:');
        processedEvents.forEach(e => {
            console.log(`   ${e.event_type} [${e.status}]: ${e.count}`);
        });
        
        // 3. Check POI semantic ID mapping
        const samplePois = db.prepare(`
            SELECT name, type, semantic_id, file_path
            FROM pois
            WHERE semantic_id LIKE '%userserv%' OR semantic_id LIKE '%schema%'
            LIMIT 10
        `).all();
        
        console.log('\n3. Sample POIs with semantic IDs:');
        samplePois.forEach(poi => {
            console.log(`   ${poi.type} "${poi.name}" -> ${poi.semantic_id} (${poi.file_path})`);
        });
        
        // 4. Check a specific relationship finding
        const sampleFinding = db.prepare(`
            SELECT payload
            FROM outbox
            WHERE event_type = 'relationship-analysis-finding'
            AND status = 'PENDING'
            LIMIT 1
        `).get();
        
        if (sampleFinding) {
            const payload = JSON.parse(sampleFinding.payload);
            console.log('\n4. Sample pending relationship finding:');
            console.log(`   File: ${payload.filePath}`);
            console.log(`   Relationships: ${payload.relationships.length}`);
            if (payload.relationships.length > 0) {
                const rel = payload.relationships[0];
                console.log(`   Example: ${rel.from} -> ${rel.to}`);
                
                // Check if POIs exist
                const sourcePoi = db.prepare('SELECT id, name, semantic_id FROM pois WHERE semantic_id = ?').get(rel.from);
                const targetPoi = db.prepare('SELECT id, name, semantic_id FROM pois WHERE semantic_id = ?').get(rel.to);
                
                console.log(`   Source POI exists: ${sourcePoi ? 'YES (id=' + sourcePoi.id + ')' : 'NO'}`);
                console.log(`   Target POI exists: ${targetPoi ? 'YES (id=' + targetPoi.id + ')' : 'NO'}`);
            }
        }
        
        // 5. Check relationship table
        const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
        console.log(`\n5. Total relationships in database: ${relCount.count}`);
        
        if (relCount.count > 0) {
            const sampleRels = db.prepare(`
                SELECT source_poi_id, target_poi_id, type, confidence
                FROM relationships
                LIMIT 5
            `).all();
            
            console.log('   Sample relationships:');
            sampleRels.forEach(r => {
                console.log(`   POI ${r.source_poi_id} -> POI ${r.target_poi_id}: ${r.type} (conf: ${r.confidence})`);
            });
        }
        
        // 6. Check for TransactionalOutboxPublisher activity
        const latestLog = db.prepare(`
            SELECT created_at
            FROM outbox
            WHERE status = 'PUBLISHED'
            ORDER BY created_at DESC
            LIMIT 1
        `).get();
        
        console.log('\n6. TransactionalOutboxPublisher status:');
        if (latestLog) {
            console.log(`   Last published event: ${latestLog.created_at}`);
        } else {
            console.log('   No published events found - TransactionalOutboxPublisher may not be running!');
        }
        
        db.close();
        
    } catch (err) {
        console.error('Error debugging:', err);
        db.close();
    }
}

debugPipeline();