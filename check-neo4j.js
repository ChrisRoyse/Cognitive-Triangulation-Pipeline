#!/usr/bin/env node

const neo4j = require('neo4j-driver');

async function checkNeo4j() {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'password';
    
    console.log('Connecting to Neo4j at:', uri);
    
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    
    try {
        const session = driver.session();
        
        // Count nodes
        const nodeResult = await session.run('MATCH (n) RETURN labels(n)[0] as label, COUNT(n) as count');
        console.log('\nNodes in graph:');
        nodeResult.records.forEach(record => {
            console.log(`  ${record.get('label')}: ${record.get('count')}`);
        });
        
        // Count relationships
        const relResult = await session.run('MATCH ()-[r]->() RETURN type(r) as type, COUNT(r) as count');
        console.log('\nRelationships in graph:');
        relResult.records.forEach(record => {
            console.log(`  ${record.get('type')}: ${record.get('count')}`);
        });
        
        // Total counts
        const totalNodes = await session.run('MATCH (n) RETURN COUNT(n) as count');
        const totalRels = await session.run('MATCH ()-[r]->() RETURN COUNT(r) as count');
        
        console.log('\nTotals:');
        console.log(`  Total nodes: ${totalNodes.records[0].get('count')}`);
        console.log(`  Total relationships: ${totalRels.records[0].get('count')}`);
        
        await session.close();
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await driver.close();
    }
}

checkNeo4j();