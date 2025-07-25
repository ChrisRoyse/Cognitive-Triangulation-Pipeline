#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function debugPoiMatching() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== POI MATCHING DEBUG ===\n');
    
    try {
        // Get a processed relationship finding
        const finding = db.prepare(`
            SELECT payload
            FROM outbox
            WHERE event_type = 'relationship-analysis-finding'
            AND status = 'PUBLISHED'
            LIMIT 1
        `).get();
        
        if (!finding) {
            console.log('No published relationship findings found');
            db.close();
            return;
        }
        
        const payload = JSON.parse(finding.payload);
        const runId = payload.runId;
        console.log(`Testing with run ID: ${runId}`);
        console.log(`File: ${payload.filePath}`);
        console.log(`Total relationships in finding: ${payload.relationships.length}\n`);
        
        // Test each relationship
        let matchedCount = 0;
        let unmatchedCount = 0;
        
        for (const rel of payload.relationships) {
            console.log(`\nRelationship: ${rel.from} -> ${rel.to}`);
            
            // Check source POI
            let sourcePoi = db.prepare('SELECT id, name, semantic_id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(rel.from, runId);
            if (!sourcePoi) {
                sourcePoi = db.prepare('SELECT id, name, semantic_id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(rel.from, runId);
            }
            
            // Check target POI
            let targetPoi = db.prepare('SELECT id, name, semantic_id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(rel.to, runId);
            if (!targetPoi) {
                targetPoi = db.prepare('SELECT id, name, semantic_id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(rel.to, runId);
            }
            
            if (sourcePoi && targetPoi) {
                console.log(`  ✓ MATCHED: Source POI (id=${sourcePoi.id}) and Target POI (id=${targetPoi.id})`);
                matchedCount++;
            } else {
                console.log(`  ✗ UNMATCHED:`);
                if (!sourcePoi) {
                    console.log(`    - Source "${rel.from}" not found`);
                    // Check if similar POIs exist
                    const similarSource = db.prepare(`
                        SELECT semantic_id, name 
                        FROM pois 
                        WHERE run_id = ? 
                        AND (semantic_id LIKE ? OR semantic_id LIKE ?)
                        LIMIT 3
                    `).all(runId, `%${rel.from.split('_').pop()}%`, `${rel.from.split('_')[0]}%`);
                    
                    if (similarSource.length > 0) {
                        console.log(`      Similar POIs found:`);
                        similarSource.forEach(p => console.log(`        - ${p.semantic_id} (${p.name})`));
                    }
                }
                if (!targetPoi) {
                    console.log(`    - Target "${rel.to}" not found`);
                    // Check if similar POIs exist
                    const similarTarget = db.prepare(`
                        SELECT semantic_id, name 
                        FROM pois 
                        WHERE run_id = ? 
                        AND (semantic_id LIKE ? OR semantic_id LIKE ?)
                        LIMIT 3
                    `).all(runId, `%${rel.to.split('_').pop()}%`, `${rel.to.split('_')[0]}%`);
                    
                    if (similarTarget.length > 0) {
                        console.log(`      Similar POIs found:`);
                        similarTarget.forEach(p => console.log(`        - ${p.semantic_id} (${p.name})`));
                    }
                }
                unmatchedCount++;
            }
        }
        
        console.log(`\n=== SUMMARY ===`);
        console.log(`Total relationships: ${payload.relationships.length}`);
        console.log(`Matched: ${matchedCount}`);
        console.log(`Unmatched: ${unmatchedCount}`);
        console.log(`Success rate: ${((matchedCount / payload.relationships.length) * 100).toFixed(1)}%`);
        
        db.close();
        
    } catch (err) {
        console.error('Error debugging:', err);
        db.close();
    }
}

debugPoiMatching();