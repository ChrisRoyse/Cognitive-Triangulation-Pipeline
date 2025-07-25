#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'database.db');
console.log('Checking database:', dbPath);

try {
    const db = new Database(dbPath, { readonly: true });
    
    // Check POIs
    const poiCount = db.prepare('SELECT COUNT(*) as count FROM pois').get();
    console.log('\nPOIs extracted:', poiCount.count);
    
    // Check POI types
    const poiTypes = db.prepare('SELECT type, COUNT(*) as count FROM pois GROUP BY type').all();
    console.log('\nPOI Types:');
    poiTypes.forEach(t => console.log(`  ${t.type}: ${t.count}`));
    
    // Check relationships
    const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
    console.log('\nRelationships discovered:', relCount.count);
    
    // Check relationship types
    const relTypes = db.prepare('SELECT type, COUNT(*) as count FROM relationships GROUP BY type').all();
    console.log('\nRelationship Types:');
    relTypes.forEach(t => console.log(`  ${t.type}: ${t.count}`));
    
    // Check files
    const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get();
    console.log('\nFiles processed:', fileCount.count);
    
    // Sample POIs
    const samplePois = db.prepare('SELECT name, type, file_path FROM pois LIMIT 5').all();
    console.log('\nSample POIs:');
    samplePois.forEach(p => console.log(`  ${p.type}: ${p.name} (${p.file_path})`));
    
    db.close();
} catch (error) {
    console.error('Error:', error.message);
}