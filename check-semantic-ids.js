#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function checkSemanticIds() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== SEMANTIC ID CHECK ===\n');
    
    try {
        const runId = 'b26b63be-e423-4b48-a5ed-171413aef852';
        
        // Get all POIs grouped by file
        const pois = db.prepare(`
            SELECT semantic_id, name, type, file_path
            FROM pois
            WHERE run_id = ?
            ORDER BY file_path, semantic_id
        `).all(runId);
        
        const grouped = {};
        pois.forEach(p => {
            const file = p.file_path.split('\\').pop();
            if (!grouped[file]) grouped[file] = [];
            grouped[file].push({
                semantic_id: p.semantic_id,
                name: p.name,
                type: p.type
            });
        });
        
        // Show sample POIs from each file
        Object.entries(grouped).forEach(([file, filePois]) => {
            console.log(`${file} (${filePois.length} POIs):`);
            filePois.slice(0, 5).forEach(p => {
                console.log(`  ${p.semantic_id} (${p.type} "${p.name}")`);
            });
            if (filePois.length > 5) {
                console.log(`  ... and ${filePois.length - 5} more`);
            }
            console.log();
        });
        
        // Check for semantic ID patterns
        console.log('=== SEMANTIC ID PATTERNS ===\n');
        
        // Check if relationships are looking for truncated IDs
        const sampleRel = db.prepare(`
            SELECT payload
            FROM outbox
            WHERE event_type = 'relationship-analysis-finding'
            AND status = 'PENDING'
            LIMIT 1
        `).get();
        
        if (sampleRel) {
            const payload = JSON.parse(sampleRel.payload);
            const rel = payload.relationships[0];
            console.log('Sample relationship semantic IDs:');
            console.log(`  From: ${rel.from}`);
            console.log(`  To: ${rel.to}`);
            console.log();
            
            // Check if similar POIs exist
            const fromPattern = rel.from.substring(0, 15);
            const similarPois = db.prepare(`
                SELECT semantic_id, name
                FROM pois
                WHERE semantic_id LIKE ?
                AND run_id = ?
                LIMIT 5
            `).all(fromPattern + '%', runId);
            
            if (similarPois.length > 0) {
                console.log(`POIs matching pattern "${fromPattern}%":`);
                similarPois.forEach(p => {
                    console.log(`  ${p.semantic_id} ("${p.name}")`);
                });
            }
        }
        
        db.close();
        
    } catch (err) {
        console.error('Error:', err);
        db.close();
    }
}

checkSemanticIds();