#!/usr/bin/env node

const neo4j = require('neo4j-driver');
require('dotenv').config();

async function checkNeo4jResults() {
    const driver = neo4j.driver(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        neo4j.auth.basic(
            process.env.NEO4J_USER || 'neo4j',
            process.env.NEO4J_PASSWORD || 'CTPSecure2024!'
        )
    );

    const session = driver.session();

    try {
        console.log('🔍 Checking Neo4j Results for Polyglot Test\n');

        // Check total nodes
        const totalNodesResult = await session.run('MATCH (n:POI) RETURN count(n) as count');
        const totalNodes = totalNodesResult.records[0].get('count').toNumber();
        console.log(`📊 Total Nodes: ${totalNodes}`);

        // Check nodes by type
        console.log('\n📋 Nodes by Type:');
        const nodesByTypeResult = await session.run(`
            MATCH (n:POI) 
            RETURN n.type as type, count(n) as count 
            ORDER BY count DESC
        `);
        
        nodesByTypeResult.records.forEach(record => {
            console.log(`   ${record.get('type')}: ${record.get('count').toNumber()}`);
        });

        // Check total relationships
        const totalRelsResult = await session.run('MATCH ()-[r:RELATIONSHIP]->() RETURN count(r) as count');
        const totalRels = totalRelsResult.records[0].get('count').toNumber();
        console.log(`\n📊 Total Relationships: ${totalRels}`);

        // Check relationships by type
        console.log('\n📋 Relationships by Type:');
        const relsByTypeResult = await session.run(`
            MATCH ()-[r:RELATIONSHIP]->() 
            RETURN r.type as type, count(r) as count 
            ORDER BY count DESC
        `);
        
        relsByTypeResult.records.forEach(record => {
            console.log(`   ${record.get('type')}: ${record.get('count').toNumber()}`);
        });

        // Calculate ratio
        const ratio = totalNodes > 0 ? (totalRels / totalNodes).toFixed(2) : 0;
        console.log(`\n📈 Relationships per Node: ${ratio}`);

        // Check benchmarks
        console.log('\n🎯 Benchmark Comparison:');
        console.log(`   Nodes: ${totalNodes} / 300 minimum (${totalNodes >= 300 ? '✅ PASS' : '❌ FAIL'})`);
        console.log(`   Relationships: ${totalRels} / 1600 minimum (${totalRels >= 1600 ? '✅ PASS' : '❌ FAIL'})`);
        console.log(`   Ratio: ${ratio} / 4.0 minimum (${ratio >= 4.0 ? '✅ PASS' : '❌ FAIL'})`);

        // Check for polyglot-test specific nodes
        console.log('\n🔍 Polyglot Test Files:');
        const polyglotFilesResult = await session.run(`
            MATCH (n:POI)
            WHERE n.filePath CONTAINS 'polyglot-test'
            RETURN DISTINCT n.filePath as path
            ORDER BY path
            LIMIT 20
        `);
        
        polyglotFilesResult.records.forEach(record => {
            console.log(`   ${record.get('path')}`);
        });

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await session.close();
        await driver.close();
    }
}

checkNeo4jResults().catch(console.error);