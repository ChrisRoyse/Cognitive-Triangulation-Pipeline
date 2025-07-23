// Test Neo4j authentication from different parts of the pipeline

const config = require('./src/config.js');
const neo4j = require('neo4j-driver');

async function testPipelineAuth() {
    console.log('🔐 Testing Neo4j Pipeline Authentication...');
    
    // Test 1: Main config.js
    console.log('\n1️⃣  Testing src/config.js credentials');
    console.log(`   URI: ${config.NEO4J_URI}`);
    console.log(`   User: ${config.NEO4J_USER}`);
    console.log(`   Password: ${config.NEO4J_PASSWORD.substring(0, 2)}${'*'.repeat(config.NEO4J_PASSWORD.length - 2)}`);
    
    const driver1 = neo4j.driver(config.NEO4J_URI, neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD));
    
    try {
        const session1 = driver1.session();
        const result1 = await session1.run('RETURN "config.js test" as source');
        if (result1.records.length > 0) {
            console.log('   ✅ SUCCESS: config.js authentication works');
        }
        await session1.close();
    } catch (error) {
        console.log(`   ❌ FAILED: ${error.message}`);
    } finally {
        await driver1.close();
    }
    
    // Test 2: main_optimized.js pattern
    console.log('\n2️⃣  Testing main_optimized.js pattern');
    const mainOptimizedPassword = process.env.NEO4J_PASSWORD || 'test1234';
    console.log(`   Password fallback: ${mainOptimizedPassword}`);
    
    const driver2 = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', mainOptimizedPassword));
    
    try {
        const session2 = driver2.session();
        const result2 = await session2.run('RETURN "main_optimized.js test" as source');
        if (result2.records.length > 0) {
            console.log('   ✅ SUCCESS: main_optimized.js pattern works');
        }
        await session2.close();
    } catch (error) {
        console.log(`   ❌ FAILED: ${error.message}`);
    } finally {
        await driver2.close();
    }
    
    // Test 3: Pipeline runner pattern
    console.log('\n3️⃣  Testing pipeline_runner.js pattern');
    const pipelinePassword = process.env.NEO4J_PASSWORD || 'test1234';
    console.log(`   Password fallback: ${pipelinePassword}`);
    
    const driver3 = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', pipelinePassword));
    
    try {
        const session3 = driver3.session();
        const result3 = await session3.run('RETURN "pipeline_runner.js test" as source');
        if (result3.records.length > 0) {
            console.log('   ✅ SUCCESS: pipeline_runner.js pattern works');
        }
        await session3.close();
    } catch (error) {
        console.log(`   ❌ FAILED: ${error.message}`);
    } finally {
        await driver3.close();
    }
    
    // Test 4: Direct Neo4j schema operations
    console.log('\n4️⃣  Testing Neo4j schema operations');
    const driver4 = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'test1234'));
    
    try {
        const session4 = driver4.session();
        
        // Test constraint creation (important for GraphBuilder)
        try {
            await session4.run('CREATE CONSTRAINT poi_id_unique IF NOT EXISTS FOR (p:POI) REQUIRE p.id IS UNIQUE');
            console.log('   ✅ SUCCESS: Can create constraints');
        } catch (constraintError) {
            if (constraintError.message.includes('already exists')) {
                console.log('   ✅ SUCCESS: Constraint already exists (expected)');
            } else {
                console.log(`   ⚠️  Constraint error: ${constraintError.message}`);
            }
        }
        
        // Test basic node operations
        await session4.run('MERGE (test:TestNode {id: $id}) RETURN test', { id: 'auth-test-' + Date.now() });
        console.log('   ✅ SUCCESS: Can create/merge nodes');
        
        // Test cleanup
        await session4.run('MATCH (test:TestNode) WHERE test.id STARTS WITH "auth-test-" DELETE test');
        console.log('   ✅ SUCCESS: Can delete nodes');
        
        await session4.close();
    } catch (error) {
        console.log(`   ❌ FAILED: Schema operations failed - ${error.message}`);
    } finally {
        await driver4.close();
    }
    
    console.log('\n🎉 Neo4j authentication testing complete!');
    console.log('The pipeline should now have consistent Neo4j authentication.');
}

testPipelineAuth().catch(console.error);