const Database = require('better-sqlite3');
const db = new Database('./data/database.db');

// Count records in each table
const tables = ['files', 'pois', 'relationships', 'outbox', 'directory_summaries', 'relationship_evidence'];

console.log('=== SQLite Database Status ===');
for (const table of tables) {
    try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        console.log(`${table}: ${count.count} records`);
    } catch (e) {
        console.log(`${table}: ERROR - ${e.message}`);
    }
}

// Check outbox status
console.log('\n=== Outbox Status ===');
const outboxStats = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM outbox 
    GROUP BY status
`).all();

for (const stat of outboxStats) {
    console.log(`${stat.status}: ${stat.count}`);
}

// Check for any POIs
console.log('\n=== POI Summary ===');
const poiTypes = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM pois 
    GROUP BY type
`).all();

for (const type of poiTypes) {
    console.log(`${type.type}: ${type.count}`);
}

// Check files processed
console.log('\n=== Files Processed ===');
const fileStats = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN file_path LIKE '%polyglot-test%' THEN 1 ELSE 0 END) as polyglot_files
    FROM files
`).get();
console.log(`Total files: ${fileStats.total}`);
console.log(`Polyglot-test files: ${fileStats.polyglot_files}`);

db.close();