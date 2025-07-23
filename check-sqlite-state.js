#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const dbPath = path.join(process.cwd(), process.env.SQLITE_DB_PATH || './data/database.db');
console.log('📁 Database path:', dbPath);

try {
    const db = new Database(dbPath, { readonly: true });

    console.log('\n🔍 Checking SQLite Database State\n');

    // Check POIs (Points of Interest)
    const poisCount = db.prepare('SELECT COUNT(*) as count FROM pois').get();
    console.log(`📊 Total POIs: ${poisCount.count}`);

    // Check files
    const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get();
    console.log(`📁 Files Processed: ${fileCount.count}`);

    // Check polyglot-test files
    const polyglotFiles = db.prepare(`
        SELECT DISTINCT file_path 
        FROM files 
        WHERE file_path LIKE '%polyglot-test%'
        ORDER BY file_path
    `).all();
    
    console.log(`\n📋 Polyglot Test Files Found (${polyglotFiles.length}):`);
    polyglotFiles.forEach(row => {
        console.log(`   ${row.file_path}`);
    });

    // Check POI types
    const entityTypes = db.prepare(`
        SELECT type, COUNT(*) as count 
        FROM pois 
        WHERE file_path LIKE '%polyglot-test%'
        GROUP BY type
        ORDER BY count DESC
    `).all();

    console.log('\n📊 Entity Types in Polyglot Test:');
    entityTypes.forEach(row => {
        console.log(`   ${row.type}: ${row.count}`);
    });

    // Check relationships
    const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
    console.log(`\n📊 Total Relationships: ${relCount.count}`);

    // Check relationship types
    const relTypes = db.prepare(`
        SELECT type, COUNT(*) as count 
        FROM relationships 
        GROUP BY type
        ORDER BY count DESC
        LIMIT 10
    `).all();

    console.log('\n📊 Top Relationship Types:');
    relTypes.forEach(row => {
        console.log(`   ${row.type}: ${row.count}`);
    });

    // Check outbox status
    const outboxStats = db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM outbox 
        GROUP BY status
    `).all();

    console.log('\n📮 Outbox Status:');
    outboxStats.forEach(row => {
        console.log(`   ${row.status}: ${row.count}`);
    });

    // Check recent runs
    const recentRuns = db.prepare(`
        SELECT run_id, COUNT(*) as event_count 
        FROM outbox 
        WHERE run_id IS NOT NULL
        GROUP BY run_id 
        ORDER BY run_id DESC 
        LIMIT 5
    `).all();

    console.log('\n🏃 Recent Runs:');
    recentRuns.forEach(row => {
        console.log(`   ${row.run_id}: ${row.event_count} events`);
    });

    db.close();
} catch (error) {
    console.error('❌ Error:', error.message);
}