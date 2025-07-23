// Test the complete end-to-end data flow: outbox → SQLite → Neo4j

const { DatabaseManager } = require('./src/utils/sqliteDb');
const TransactionalOutboxPublisher = require('./src/services/TransactionalOutboxPublisher');
const { getInstance: getQueueManager } = require('./src/utils/queueManager');
const neo4j = require('neo4j-driver');
const config = require('./src/config.js');

async function testEndToEndFlow() {
    console.log('🔄 Testing End-to-End Data Flow: outbox → SQLite → Neo4j');
    
    // Initialize components
    const dbManager = new DatabaseManager('./data/database.db');
    const queueManager = getQueueManager();
    const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
    
    // Wait for Redis connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const db = dbManager.getDb();
    const runId = `e2e-test-${Date.now()}`;
    
    console.log(`\n📊 Step 1: Create test outbox events (run_id: ${runId})`);
    
    // Clean up any existing test data
    db.prepare('DELETE FROM outbox WHERE run_id LIKE ?').run('e2e-test-%');
    db.prepare('DELETE FROM pois WHERE file_path LIKE ?').run('/test/e2e-%');
    
    // Create test outbox events
    const testEvents = [
        {
            run_id: runId,
            event_type: 'file-analysis-finding',
            payload: JSON.stringify({
                runId: runId,
                filePath: '/test/e2e-sample1.js',
                pois: [
                    {
                        id: 'e2e-poi-1',
                        name: 'testFunction',
                        type: 'FunctionDefinition',
                        startLine: 1,
                        endLine: 10
                    },
                    {
                        id: 'e2e-poi-2',
                        name: 'TestClass',
                        type: 'ClassDefinition',
                        startLine: 12,
                        endLine: 25
                    }
                ]
            }),
            status: 'PENDING'
        },
        {
            run_id: runId,
            event_type: 'file-analysis-finding',
            payload: JSON.stringify({
                runId: runId,
                filePath: '/test/e2e-sample2.js',
                pois: [
                    {
                        id: 'e2e-poi-3',
                        name: 'helperFunction',
                        type: 'FunctionDefinition',
                        startLine: 5,
                        endLine: 15
                    }
                ]
            }),
            status: 'PENDING'
        }
    ];
    
    const insertStmt = db.prepare(`
        INSERT INTO outbox (run_id, event_type, payload, status) 
        VALUES (?, ?, ?, ?)
    `);
    
    testEvents.forEach(event => {
        insertStmt.run(event.run_id, event.event_type, event.payload, event.status);
    });
    
    console.log(`✅ Created ${testEvents.length} outbox events`);
    
    // Check initial state
    const initialOutbox = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE run_id = ?').get(runId);
    const initialPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path LIKE ?').get('/test/e2e-%');
    
    console.log(`📊 Initial state - Outbox: ${initialOutbox.count}, POIs: ${initialPois.count}`);
    
    console.log('\n📊 Step 2: Process outbox events via TransactionalOutboxPublisher');
    
    // Start publisher
    publisher.start();
    
    // Wait for processing
    console.log('⏳ Waiting for publisher to process events...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Force flush any pending batches
    await publisher.flushBatches();
    
    // Check intermediate state
    const processedOutbox = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status = ?').get(runId, 'PUBLISHED');
    const extractedPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path LIKE ?').get('/test/e2e-%');
    
    console.log(`📊 After processing - Published outbox: ${processedOutbox.count}, Extracted POIs: ${extractedPois.count}`);
    
    if (extractedPois.count === 0) {
        console.log('❌ No POIs were extracted from outbox events');
        await publisher.stop();
        return false;
    }
    
    // Show extracted POIs
    const poisDetails = db.prepare('SELECT name, type, file_path FROM pois WHERE file_path LIKE ? ORDER BY name').all('/test/e2e-%');
    console.log('📝 Extracted POIs:');
    poisDetails.forEach(poi => console.log(`   - ${poi.name} (${poi.type}) in ${poi.file_path}`));
    
    console.log('\n📊 Step 3: Test Neo4j connection and data ingestion simulation');
    
    // Test Neo4j connection with the fixed credentials
    const driver = neo4j.driver(config.NEO4J_URI, neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD));
    
    try {
        const session = driver.session();
        
        // Test basic connection
        const connectionTest = await session.run('RETURN 1 as test');
        if (connectionTest.records.length === 0) {
            throw new Error('Neo4j connection test failed');
        }
        console.log('✅ Neo4j connection successful');
        
        // Create test constraint (required for POI ingestion)
        try {
            await session.run('CREATE CONSTRAINT poi_id_unique IF NOT EXISTS FOR (p:POI) REQUIRE p.id IS UNIQUE');
            console.log('✅ Neo4j constraint created/verified');
        } catch (constraintError) {
            if (constraintError.message.includes('already exists')) {
                console.log('✅ Neo4j constraint already exists');
            } else {
                throw constraintError;
            }
        }
        
        // Simulate data ingestion (create POI nodes based on SQLite data)
        const testNodeCreations = [];
        for (const poi of poisDetails) {
            const poiId = `${poi.file_path}:${poi.name}`;
            const result = await session.run(
                'MERGE (p:POI {id: $id}) SET p.name = $name, p.type = $type, p.filePath = $filePath, p.testRun = $testRun RETURN p',
                { 
                    id: poiId,
                    name: poi.name, 
                    type: poi.type,
                    filePath: poi.file_path,
                    testRun: runId
                }
            );
            testNodeCreations.push(result.records.length > 0);
        }
        
        const successfulCreations = testNodeCreations.filter(Boolean).length;
        console.log(`✅ Created ${successfulCreations}/${poisDetails.length} POI nodes in Neo4j`);
        
        // Verify the nodes exist
        const verificationResult = await session.run(
            'MATCH (p:POI) WHERE p.testRun = $testRun RETURN count(p) as nodeCount',
            { testRun: runId }
        );
        
        const nodeCount = verificationResult.records[0].get('nodeCount').toNumber();
        console.log(`✅ Verified ${nodeCount} nodes in Neo4j for test run`);
        
        // Cleanup test nodes
        await session.run('MATCH (p:POI) WHERE p.testRun = $testRun DELETE p', { testRun: runId });
        console.log('🧹 Cleaned up test nodes from Neo4j');
        
        await session.close();
        
    } catch (neo4jError) {
        console.error(`❌ Neo4j error: ${neo4jError.message}`);
        return false;
    } finally {
        await driver.close();
    }
    
    // Cleanup
    await publisher.stop();
    
    // Final verification
    const finalOutboxPublished = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status = ?').get(runId, 'PUBLISHED');
    const finalPoisCount = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_path LIKE ?').get('/test/e2e-%');
    
    console.log('\n🎉 End-to-End Flow Test Complete!');
    console.log('📊 Final Results:');
    console.log(`   - Outbox events processed: ${finalOutboxPublished.count}/${testEvents.length}`);
    console.log(`   - POIs extracted to SQLite: ${finalPoisCount.count}`);
    console.log(`   - Neo4j nodes created and verified: ${nodeCount}`);
    console.log(`   - Neo4j authentication: ✅ Working`);
    
    const success = finalOutboxPublished.count === testEvents.length && finalPoisCount.count > 0;
    console.log(`\n${success ? '✅ SUCCESS' : '❌ FAILED'}: End-to-end data flow is ${success ? 'working correctly' : 'broken'}`);
    
    return success;
}

testEndToEndFlow().catch(console.error);