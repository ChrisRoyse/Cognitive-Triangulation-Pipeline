#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function fixRunIdMismatch() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== RUN ID MISMATCH ANALYSIS ===\n');
    
    try {
        // Get all run IDs from outbox events
        const outboxRuns = db.prepare(`
            SELECT DISTINCT json_extract(payload, '$.runId') as run_id, event_type, COUNT(*) as count
            FROM outbox
            WHERE json_extract(payload, '$.runId') IS NOT NULL
            GROUP BY run_id, event_type
            ORDER BY run_id
        `).all();
        
        console.log('1. Run IDs in outbox events:');
        outboxRuns.forEach(r => {
            console.log(`   ${r.run_id} - ${r.event_type}: ${r.count} events`);
        });
        
        // Get all run IDs from POIs
        const poiRuns = db.prepare(`
            SELECT DISTINCT run_id, COUNT(*) as count
            FROM pois
            GROUP BY run_id
            ORDER BY run_id
        `).all();
        
        console.log('\n2. Run IDs in POIs table:');
        poiRuns.forEach(r => {
            console.log(`   ${r.run_id}: ${r.count} POIs`);
        });
        
        // Check a specific relationship finding
        const finding = db.prepare(`
            SELECT payload
            FROM outbox
            WHERE event_type = 'relationship-analysis-finding'
            LIMIT 1
        `).get();
        
        if (finding) {
            const payload = JSON.parse(finding.payload);
            const findingRunId = payload.runId;
            console.log(`\n3. Sample relationship finding uses run ID: ${findingRunId}`);
            
            // Check if POIs exist for this run
            const poiCount = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(findingRunId);
            console.log(`   POIs for this run: ${poiCount.count}`);
            
            // Find the correct run ID with POIs
            const correctRun = db.prepare(`
                SELECT run_id, COUNT(*) as count
                FROM pois
                GROUP BY run_id
                ORDER BY count DESC
                LIMIT 1
            `).get();
            
            if (correctRun && correctRun.run_id !== findingRunId) {
                console.log(`\n4. MISMATCH DETECTED!`);
                console.log(`   Relationships are looking for run: ${findingRunId}`);
                console.log(`   POIs exist in run: ${correctRun.run_id}`);
                console.log(`   POI count: ${correctRun.count}`);
                
                // Update outbox events to use correct run ID
                console.log(`\n5. Fixing run IDs in pending relationship findings...`);
                
                const updateCount = db.prepare(`
                    UPDATE outbox
                    SET payload = json_set(payload, '$.runId', ?)
                    WHERE event_type = 'relationship-analysis-finding'
                    AND status = 'PUBLISHED'
                `).run(correctRun.run_id);
                
                console.log(`   Updated ${updateCount.changes} relationship findings to use correct run ID`);
                
                // Reset status to PENDING so they get reprocessed
                const resetCount = db.prepare(`
                    UPDATE outbox
                    SET status = 'PENDING'
                    WHERE event_type = 'relationship-analysis-finding'
                `).run();
                
                console.log(`   Reset ${resetCount.changes} relationship findings to PENDING for reprocessing`);
            }
        }
        
        db.close();
        
    } catch (err) {
        console.error('Error:', err);
        db.close();
    }
}

fixRunIdMismatch();