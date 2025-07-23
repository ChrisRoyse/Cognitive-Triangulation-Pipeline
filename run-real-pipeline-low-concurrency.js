// Run the real LLM pipeline with very low concurrency to avoid overload

const { spawn } = require('child_process');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const neo4j = require('neo4j-driver');

async function clearDatabases() {
    console.log('🧹 Clearing databases...');
    
    // Clear SQLite
    const dbManager = new DatabaseManager('./database.db');
    await dbManager.initializeDb();
    const db = dbManager.getDb();
    
    db.exec('DELETE FROM relationships');
    db.exec('DELETE FROM relationship_evidence');
    db.exec('DELETE FROM pois');
    db.exec('DELETE FROM files');
    db.exec('DELETE FROM directory_summaries');
    db.exec('DELETE FROM outbox');
    
    dbManager.close();
    
    // Clear Neo4j
    const driver = neo4j.driver(
        'bolt://localhost:7687',
        neo4j.auth.basic('neo4j', 'test1234')
    );
    
    const session = driver.session();
    await session.run('MATCH (n) DETACH DELETE n');
    await session.close();
    await driver.close();
    
    console.log('✅ Databases cleared');
}

async function runPipeline() {
    await clearDatabases();
    
    console.log('🚀 Running real LLM pipeline with low concurrency...');
    console.log('📁 Target: ./polyglot-test');
    console.log('🤖 Using Deepseek LLM for code analysis');
    
    const env = {
        ...process.env,
        // Force very low concurrency to avoid overload
        FORCE_MAX_CONCURRENCY: '1', // Only 1 worker at a time
        MAX_GLOBAL_CONCURRENCY: '1',
        MAX_FILE_ANALYSIS_WORKERS: '1',
        MAX_DIRECTORY_RESOLUTION_WORKERS: '1',
        MAX_DIRECTORY_AGGREGATION_WORKERS: '1',
        MAX_RELATIONSHIP_WORKERS: '1',
        MAX_VALIDATION_WORKERS: '1',
        MAX_RECONCILIATION_WORKERS: '1',
        // Disable adaptive features
        ADAPTIVE_CONCURRENCY: 'false',
        CIRCUIT_BREAKER_ENABLED: 'false',
        // Low API rate
        API_RATE_LIMIT: '2', // 2 requests per second
        // Small batches
        BATCH_SIZE: '5',
        FILE_BATCHING_ENABLED: 'false',
        // Increase timeouts for LLM processing
        MAX_EXECUTION_TIME: '600000', // 10 minutes
        JOB_TIMEOUT: '120000' // 2 minutes per job
    };
    
    return new Promise((resolve, reject) => {
        const child = spawn('node', ['src/main.js', '--target', './polyglot-test'], {
            env,
            stdio: 'inherit' // Show all output
        });
        
        child.on('close', (code) => {
            console.log(`\\n🏁 Pipeline finished with code ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Pipeline failed with code ${code}`));
            }
        });
        
        // 10 minute timeout
        setTimeout(() => {
            child.kill();
            reject(new Error('Pipeline timed out after 10 minutes'));
        }, 600000);
    });
}

async function checkResults() {
    console.log('\\n📊 Checking pipeline results...');
    
    const dbManager = new DatabaseManager('./database.db');
    await dbManager.initializeDb();
    const db = dbManager.getDb();
    
    const files = db.prepare('SELECT COUNT(*) as count FROM files').get();
    const pois = db.prepare('SELECT COUNT(*) as count FROM pois').get();
    const relationships = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
    
    console.log('\\nSQLite Results:');
    console.log('├─ Files:', files.count);
    console.log('├─ POIs:', pois.count);
    console.log('└─ Relationships:', relationships.count);
    
    if (pois.count > 0) {
        const poiTypes = db.prepare('SELECT type, COUNT(*) as count FROM pois GROUP BY type ORDER BY count DESC').all();
        console.log('\\nPOI Types:');
        poiTypes.forEach(p => console.log('  ' + p.type + ':', p.count));
    }
    
    dbManager.close();
    
    // Check Neo4j
    const driver = neo4j.driver(
        'bolt://localhost:7687',
        neo4j.auth.basic('neo4j', 'test1234')
    );
    
    const session = driver.session();
    const nodeResult = await session.run('MATCH (n) RETURN COUNT(n) as count');
    const relResult = await session.run('MATCH ()-[r]->() RETURN COUNT(r) as count');
    
    const nodeCount = nodeResult.records[0].get('count').toNumber();
    const relCount = relResult.records[0].get('count').toNumber();
    
    console.log('\\nNeo4j Results:');
    console.log('├─ Nodes:', nodeCount);
    console.log('└─ Relationships:', relCount);
    
    await session.close();
    await driver.close();
    
    // Check benchmarks
    console.log('\\n🎯 Benchmark Check:');
    console.log('├─ Nodes (≥300):', nodeCount >= 300 ? '✅ PASSED' : '❌ FAILED');
    console.log('├─ Relationships (≥1600):', relCount >= 1600 ? '✅ PASSED' : '❌ FAILED');
    console.log('└─ Ratio (≥4.0):', nodeCount > 0 && relCount/nodeCount >= 4 ? '✅ PASSED' : '❌ FAILED');
}

async function main() {
    try {
        await runPipeline();
        await checkResults();
    } catch (error) {
        console.error('❌ Pipeline error:', error.message);
        await checkResults();
    }
}

main().catch(console.error);