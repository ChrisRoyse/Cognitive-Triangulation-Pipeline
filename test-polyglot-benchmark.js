#!/usr/bin/env node

/**
 * Integration test that defines success for polyglot-test processing
 * This test must pass for the system to be considered working
 */

const neo4j = require('neo4j-driver');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
require('dotenv').config();

// Minimum benchmark requirements
const BENCHMARKS = {
    minNodes: 300,
    minRelationships: 1600,
    minRatio: 4.0
};

async function testPolyglotBenchmark() {
    console.log('🧪 Testing Polyglot Benchmark Processing');
    console.log('=====================================\n');

    const driver = neo4j.driver(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        neo4j.auth.basic(
            process.env.NEO4J_USER || 'neo4j',
            process.env.NEO4J_PASSWORD || 'CTPSecure2024!'
        )
    );

    const session = driver.session();

    try {
        // Clear Neo4j before test
        console.log('🗑️  Clearing Neo4j...');
        await session.run('MATCH (n) DETACH DELETE n');

        // Run pipeline on polyglot-test directory
        console.log('🚀 Running pipeline on polyglot-test directory...');
        const startTime = Date.now();
        
        const { stdout, stderr } = await execPromise('node src/main.js --target polyglot-test', {
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer
            timeout: 300000 // 5 minute timeout
        });

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        console.log(`✅ Pipeline completed in ${duration}s`);
        
        if (stderr && !stderr.includes('It is highly recommended to use a minimum Redis version')) {
            console.warn('⚠️  Pipeline stderr:', stderr);
        }

        // Wait a moment for final operations to complete
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check results against benchmarks
        console.log('\n📊 Checking Results Against Benchmarks');
        console.log('=====================================');

        // Get node count
        const nodeResult = await session.run('MATCH (n:POI) RETURN count(n) as count');
        const nodeCount = nodeResult.records[0].get('count').toNumber();
        
        // Get relationship count  
        const relResult = await session.run('MATCH ()-[r:RELATIONSHIP]->() RETURN count(r) as count');
        const relCount = relResult.records[0].get('count').toNumber();
        
        // Calculate ratio
        const ratio = nodeCount > 0 ? relCount / nodeCount : 0;

        // Display results
        console.log(`Nodes: ${nodeCount} (min: ${BENCHMARKS.minNodes})`);
        console.log(`Relationships: ${relCount} (min: ${BENCHMARKS.minRelationships})`);
        console.log(`Ratio: ${ratio.toFixed(2)} (min: ${BENCHMARKS.minRatio})`);

        // Test assertions
        const nodePass = nodeCount >= BENCHMARKS.minNodes;
        const relPass = relCount >= BENCHMARKS.minRelationships;
        const ratioPass = ratio >= BENCHMARKS.minRatio;

        console.log('\n🎯 Benchmark Results:');
        console.log(`Nodes: ${nodePass ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Relationships: ${relPass ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Ratio: ${ratioPass ? '✅ PASS' : '❌ FAIL'}`);

        const overallPass = nodePass && relPass && ratioPass;
        console.log(`\n🏆 OVERALL: ${overallPass ? '✅ PASS - Benchmarks met!' : '❌ FAIL - Benchmarks not met'}`);

        if (!overallPass) {
            process.exit(1);
        }

        console.log('\n🎉 SUCCESS: Pipeline working correctly!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    } finally {
        await session.close();
        await driver.close();
    }
}

if (require.main === module) {
    testPolyglotBenchmark();
}

module.exports = { testPolyglotBenchmark, BENCHMARKS };