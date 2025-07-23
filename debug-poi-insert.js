const { DatabaseManager } = require('./src/utils/sqliteDb');
const BatchedDatabaseWriter = require('./src/utils/batchedDatabaseWriter');
const crypto = require('crypto');

async function debugPoiInsert() {
    console.log('🔍 Debug POI Insert...');
    
    const dbManager = new DatabaseManager('./data/database.db');
    const batchWriter = new BatchedDatabaseWriter(dbManager, {
        batchSize: 10,
        flushInterval: 100,
        enableStats: true
    });
    
    // Listen for events
    batchWriter.on('batchProcessed', (info) => {
        console.log('✅ Batch processed:', info);
    });
    
    batchWriter.on('batchError', (error) => {
        console.error('❌ Batch error:', error);
    });
    
    const runId = `debug-${Date.now()}`;
    const filePath = '/test/debug.js';
    
    console.log(`\n📝 Inserting test POI with run_id: ${runId}`);
    
    // Create hash
    const hash = crypto.createHash('md5');
    hash.update(filePath);
    hash.update('debugFunction');
    hash.update('FunctionDefinition');
    hash.update('1');
    const poiHash = hash.digest('hex');
    
    // Add POI to batch
    batchWriter.addPoiInsert({
        filePath: filePath,
        name: 'debugFunction',
        type: 'FunctionDefinition',
        startLine: 1,
        endLine: 5,
        llmOutput: '{"id":"debug-1","name":"debugFunction"}',
        hash: poiHash
    });
    
    console.log('⏳ Waiting for batch to process...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Force flush
    await batchWriter.flush();
    
    // Check database
    const db = dbManager.getDb();
    const count = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path = ?').get(filePath);
    console.log('📊 POIs inserted:', count.count);
    
    if (count.count > 0) {
        const poi = db.prepare('SELECT * FROM pois WHERE file_path = ?').get(filePath);
        console.log('📝 Inserted POI:', poi);
    }
    
    await batchWriter.shutdown();
    
    return count.count > 0;
}

debugPoiInsert().then(success => {
    console.log(`\n${success ? '✅ SUCCESS' : '❌ FAILED'}: POI insertion ${success ? 'worked' : 'failed'}`);
    process.exit(success ? 0 : 1);
}).catch(console.error);