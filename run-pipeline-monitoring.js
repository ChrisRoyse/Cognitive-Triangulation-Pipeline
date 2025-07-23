// Run pipeline with monitoring to see what's happening

const { spawn } = require('child_process');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const neo4j = require('neo4j-driver');

async function monitorPipeline() {
    console.log('🚀 Starting pipeline with monitoring...');
    console.log('📁 Target: ./polyglot-test');
    console.log('🤖 Using Deepseek LLM');
    
    const startTime = Date.now();
    
    // Start monitoring in background
    const monitorInterval = setInterval(async () => {
        try {
            const dbManager = new DatabaseManager('./database.db');
            await dbManager.initializeDb();
            const db = dbManager.getDb();
            
            const files = db.prepare('SELECT COUNT(*) as count FROM files').get();
            const pois = db.prepare('SELECT COUNT(*) as count FROM pois').get();
            const relationships = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
            const outbox = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE status = "PENDING"').get();
            
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log(`[${elapsed}s] Files: ${files.count}, POIs: ${pois.count}, Relationships: ${relationships.count}, Pending Events: ${outbox.count}`);
            
            dbManager.close();
        } catch (e) {
            // Ignore errors during monitoring
        }
    }, 5000);
    
    return new Promise((resolve, reject) => {
        const child = spawn('node', ['-r', 'dotenv/config', 'src/main.js', '--target', './polyglot-test'], {
            env: {
                ...process.env,
                NODE_ENV: 'debug', // Use debug mode for lower concurrency
                LOG_LEVEL: 'info'
            },
            stdio: 'pipe'
        });
        
        // Only show important messages
        child.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('✅') || output.includes('🎉') || output.includes('❌') || 
                output.includes('Job') || output.includes('completed') || output.includes('failed') ||
                output.includes('POIs found') || output.includes('relationships found')) {
                process.stdout.write(output);
            }
        });
        
        child.stderr.on('data', (data) => {
            process.stderr.write(data);
        });
        
        child.on('close', (code) => {
            clearInterval(monitorInterval);
            console.log(`\\n🏁 Pipeline finished with code ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Pipeline failed with code ${code}`));
            }
        });
        
        // 10 minute timeout
        setTimeout(() => {
            clearInterval(monitorInterval);
            child.kill();
            reject(new Error('Pipeline timed out after 10 minutes'));
        }, 600000);
    });
}

async function checkFinalResults() {
    console.log('\\n📊 Final Results:');
    
    const dbManager = new DatabaseManager('./database.db');
    await dbManager.initializeDb();
    const db = dbManager.getDb();
    
    // SQLite stats
    const files = db.prepare('SELECT COUNT(*) as count FROM files').get();
    const pois = db.prepare('SELECT COUNT(*) as count FROM pois').get();
    const relationships = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
    
    console.log('\\nSQLite:');
    console.log('├─ Files:', files.count);
    console.log('├─ POIs:', pois.count);
    console.log('└─ Relationships:', relationships.count);
    
    if (pois.count > 0) {
        const poiTypes = db.prepare('SELECT type, COUNT(*) as count FROM pois GROUP BY type ORDER BY count DESC').all();
        console.log('\\nPOI Types:');
        poiTypes.forEach(p => console.log('  ' + p.type + ':', p.count));
    }
    
    dbManager.close();
    
    // Neo4j stats
    const driver = neo4j.driver(
        'bolt://localhost:7687',
        neo4j.auth.basic('neo4j', 'test1234')
    );
    
    const session = driver.session();
    const nodeResult = await session.run('MATCH (n) RETURN COUNT(n) as count');
    const relResult = await session.run('MATCH ()-[r]->() RETURN COUNT(r) as count');
    
    const nodeCount = nodeResult.records[0].get('count').toNumber();
    const relCount = relResult.records[0].get('count').toNumber();
    
    console.log('\\nNeo4j:');
    console.log('├─ Nodes:', nodeCount);
    console.log('└─ Relationships:', relCount);
    
    await session.close();
    await driver.close();
    
    // Benchmark check
    const ratio = nodeCount > 0 ? relCount / nodeCount : 0;
    console.log('\\n🎯 Benchmarks:');
    console.log('├─ Nodes (≥300):', nodeCount >= 300 ? '✅ PASSED' : '❌ FAILED', `(${nodeCount})`);
    console.log('├─ Relationships (≥1600):', relCount >= 1600 ? '✅ PASSED' : '❌ FAILED', `(${relCount})`);
    console.log('└─ Ratio (≥4.0):', ratio >= 4 ? '✅ PASSED' : '❌ FAILED', `(${ratio.toFixed(2)})`);
}

async function main() {
    try {
        // Clear databases first
        console.log('🧹 Clearing databases...');
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
        
        console.log('✅ Databases cleared\\n');
        
        // Run pipeline
        await monitorPipeline();
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await checkFinalResults();
    }
}

main().catch(console.error);