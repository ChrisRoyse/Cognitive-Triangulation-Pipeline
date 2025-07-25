const Database = require('better-sqlite3');
const neo4j = require('neo4j-driver');
const { PipelineConfig } = require('./src/config/pipelineConfig');

async function checkBenchmarkResults() {
    // Initialize configuration
    const config = PipelineConfig.createDefault();
    const benchmarks = config.getBenchmarkRequirements();
    
    console.log('=== Benchmark Requirements ===');
    console.log('Minimum:', benchmarks.minimum);
    console.log('Expected:', benchmarks.expected);
    console.log('\n=== Checking Results ===');
    
    // Check SQLite results
    const db = new Database('./data/database.db');
    
    const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get().count;
    const poiCount = db.prepare('SELECT COUNT(*) as count FROM pois').get().count;
    const relationshipCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get().count;
    
    console.log('\nSQLite Results:');
    console.log(`Files: ${fileCount}`);
    console.log(`POIs: ${poiCount}`);
    console.log(`Relationships: ${relationshipCount}`);
    
    // Check Neo4j results
    const driver = neo4j.driver(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || '')
    );
    
    const session = driver.session();
    try {
        const nodeResult = await session.run('MATCH (n:POI) RETURN COUNT(n) as count');
        const nodeCount = nodeResult.records[0].get('count').toNumber();
        
        const relResult = await session.run('MATCH ()-[r:RELATIONSHIP]->() RETURN COUNT(r) as count');
        const relCount = relResult.records[0].get('count').toNumber();
        
        console.log('\nNeo4j Results:');
        console.log(`Nodes: ${nodeCount}`);
        console.log(`Relationships: ${relCount}`);
        
        // Calculate ratios
        const relationshipRatio = nodeCount > 0 ? relCount / nodeCount : 0;
        
        console.log('\n=== Benchmark Comparison ===');
        console.log(`Nodes: ${nodeCount}/${benchmarks.minimum.nodes} (minimum), ${nodeCount}/${benchmarks.expected.nodes} (expected)`);
        console.log(`Relationships: ${relCount}/${benchmarks.minimum.relationships} (minimum), ${relCount}/${benchmarks.expected.relationships} (expected)`);
        console.log(`Relationship Ratio: ${relationshipRatio.toFixed(2)}/${benchmarks.minimum.relationshipRatio} (minimum)`);
        
        // Calculate grade
        const grade = config.calculateGrade({ nodes: nodeCount, relationships: relCount });
        console.log(`\nGrade: ${grade}`);
        
        // Pass/Fail determination
        const passesMinimum = nodeCount >= benchmarks.minimum.nodes && 
                             relCount >= benchmarks.minimum.relationships &&
                             relationshipRatio >= benchmarks.minimum.relationshipRatio;
                             
        console.log(`\n=== Result: ${passesMinimum ? 'PASS ✅' : 'FAIL ❌'} ===`);
        
        if (!passesMinimum) {
            console.log('\nReasons for failure:');
            if (nodeCount < benchmarks.minimum.nodes) {
                console.log(`- Insufficient nodes: ${nodeCount} < ${benchmarks.minimum.nodes}`);
            }
            if (relCount < benchmarks.minimum.relationships) {
                console.log(`- Insufficient relationships: ${relCount} < ${benchmarks.minimum.relationships}`);
            }
            if (relationshipRatio < benchmarks.minimum.relationshipRatio) {
                console.log(`- Low relationship ratio: ${relationshipRatio.toFixed(2)} < ${benchmarks.minimum.relationshipRatio}`);
            }
        }
        
    } finally {
        await session.close();
        await driver.close();
    }
    
    db.close();
}

// Add a delay to allow pipeline to complete
setTimeout(() => {
    checkBenchmarkResults().catch(console.error);
}, 5000);

console.log('Waiting 5 seconds for pipeline to complete...');