#!/usr/bin/env node

/**
 * Test script to manually run GraphBuilder on existing outbox data
 */

const GraphBuilderWorker = require('./src/agents/GraphBuilder');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const neo4j = require('neo4j-driver');

async function testGraphBuilder() {
    console.log('🧪 Testing GraphBuilder with existing outbox data...');
    
    try {
        // Create database connection
        const dbManager = new DatabaseManager('./database.db');
        const db = dbManager.getDb();
        
        // Check outbox data
        const outboxCount = db.prepare('SELECT COUNT(*) as count FROM outbox').get();
        console.log(`📦 Found ${outboxCount.count} items in outbox`);
        
        if (outboxCount.count === 0) {
            console.log('❌ No data in outbox to process');
            return;
        }
        
        // Create Neo4j connection
        const driver = neo4j.driver(
            'bolt://localhost:7687',
            neo4j.auth.basic('neo4j', 'CTPSecure2024!')
        );
        
        // Run GraphBuilder
        console.log('🏗️ Running GraphBuilder...');
        const graphBuilder = new GraphBuilderWorker(db, driver);
        await graphBuilder.run();
        
        console.log('✅ GraphBuilder completed');
        
        // Check results in Neo4j
        const session = driver.session();
        const result = await session.run('MATCH (n) RETURN count(n) as nodeCount');
        const nodeCount = result.records[0].get('nodeCount').toNumber();
        console.log(`📊 Neo4j now has ${nodeCount} nodes`);
        
        await session.close();
        await driver.close();
        
    } catch (error) {
        console.error('❌ GraphBuilder test failed:', error);
    }
}

testGraphBuilder();