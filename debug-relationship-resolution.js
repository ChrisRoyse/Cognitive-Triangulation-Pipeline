#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function debugRelationshipResolution() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n=== RELATIONSHIP RESOLUTION DEBUG ===\n');
    
    try {
        // 1. Check if relationship resolution jobs were created
        const relJobs = db.prepare(`
            SELECT event_type, payload, created_at, status
            FROM outbox
            WHERE event_type = 'relationship-resolution'
            ORDER BY created_at DESC
            LIMIT 5
        `).all();
        
        console.log(`1. Relationship resolution jobs created: ${relJobs.length}`);
        if (relJobs.length > 0) {
            const sample = JSON.parse(relJobs[0].payload);
            console.log(`   Latest job: ${sample.filePath} with ${sample.poisBatch?.length || 1} POIs`);
        }
        
        // 2. Check if relationship findings were created
        const relFindings = db.prepare(`
            SELECT event_type, payload, created_at, status
            FROM outbox
            WHERE event_type = 'relationship-analysis-finding'
            ORDER BY created_at DESC
            LIMIT 5
        `).all();
        
        console.log(`\n2. Relationship findings created: ${relFindings.length}`);
        if (relFindings.length > 0) {
            const sample = JSON.parse(relFindings[0].payload);
            console.log(`   Latest finding: ${sample.filePath} with ${sample.relationships?.length || 0} relationships`);
            if (sample.relationships && sample.relationships.length > 0) {
                console.log(`   Sample relationship: ${sample.relationships[0].from} -> ${sample.relationships[0].to}`);
            }
        }
        
        // 3. Check POI semantic IDs
        const poisWithIds = db.prepare(`
            SELECT id, name, type, semantic_id
            FROM pois
            WHERE semantic_id IS NOT NULL
            ORDER BY id DESC
            LIMIT 10
        `).all();
        
        console.log(`\n3. POIs with semantic IDs: ${poisWithIds.length}`);
        poisWithIds.forEach(poi => {
            console.log(`   ${poi.type} "${poi.name}" -> ${poi.semantic_id}`);
        });
        
        // 4. Check if any POIs are missing semantic IDs
        const poisWithoutIds = db.prepare(`
            SELECT COUNT(*) as count
            FROM pois
            WHERE semantic_id IS NULL
        `).get();
        
        console.log(`\n4. POIs without semantic IDs: ${poisWithoutIds.count}`);
        
        // 5. Check relationship confidence scores
        const relWithConf = db.prepare(`
            SELECT r.id, r.source_poi_id, r.target_poi_id, r.type, r.confidence,
                   rcs.final_confidence, rcs.confidence_level
            FROM relationships r
            LEFT JOIN relationship_confidence_scores rcs ON r.id = rcs.relationship_id
            ORDER BY r.id DESC
            LIMIT 5
        `).all();
        
        console.log(`\n5. Relationships with confidence scores:`);
        if (relWithConf.length === 0) {
            console.log('   No relationships found in database');
        } else {
            relWithConf.forEach(r => {
                console.log(`   ${r.source_poi_id} -> ${r.target_poi_id}: ${r.type} (confidence: ${r.final_confidence || r.confidence || 'N/A'})`);
            });
        }
        
        // 6. Check for failed relationship jobs
        const failedJobs = db.prepare(`
            SELECT payload
            FROM outbox
            WHERE event_type = 'failed-jobs' 
              AND payload LIKE '%relationship-resolution%'
            ORDER BY created_at DESC
            LIMIT 3
        `).all();
        
        console.log(`\n6. Failed relationship resolution jobs: ${failedJobs.length}`);
        if (failedJobs.length > 0) {
            const failed = JSON.parse(failedJobs[0].payload);
            console.log(`   Latest failure: ${failed.error}`);
        }
        
        db.close();
        
    } catch (err) {
        console.error('Error debugging:', err);
        db.close();
    }
}

debugRelationshipResolution();