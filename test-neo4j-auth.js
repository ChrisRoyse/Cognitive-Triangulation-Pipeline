const neo4j = require('neo4j-driver');

async function testNeo4jAuth() {
    console.log('🔐 Testing Neo4j Authentication...');
    
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    
    // Test different passwords to find which one works
    const passwordsToTest = [
        process.env.NEO4J_PASSWORD,  // From .env: test1234
        'test1234',                  // Explicit
        'password',                  // Common fallback
        'CTPSecure2024!',           // Script fallback
        'neo4j'                     // Default Neo4j password
    ];
    
    console.log(`📡 Testing connection to ${uri} with user ${user}`);
    
    for (const password of passwordsToTest) {
        if (!password) continue;
        
        console.log(`\n🔑 Testing password: ${password.substring(0, 2)}${'*'.repeat(password.length - 2)}`);
        
        const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
        
        try {
            // Test the connection
            const session = driver.session();
            const result = await session.run('RETURN 1 as test');
            const record = result.records[0];
            
            if (record && record.get('test') === 1) {
                console.log('✅ SUCCESS! Connection established');
                console.log(`🎯 CORRECT PASSWORD: ${password}`);
                console.log('📊 Testing database write capability...');
                
                // Test write capability
                const writeResult = await session.run(
                    'CREATE (test:TestNode {id: $id, timestamp: $timestamp}) RETURN test',
                    { id: `test-${Date.now()}`, timestamp: new Date().toISOString() }
                );
                
                if (writeResult.records.length > 0) {
                    console.log('✅ Write capability confirmed');
                    
                    // Clean up test node
                    await session.run('MATCH (test:TestNode {id: $id}) DELETE test', { id: `test-${Date.now()}` });
                }
                
                await session.close();
                await driver.close();
                
                return { success: true, correctPassword: password };
            }
        } catch (error) {
            console.log(`❌ Failed: ${error.message}`);
        } finally {
            try { await driver.close(); } catch {}
        }
    }
    
    console.log('\n💥 FAILED: No password worked');
    return { success: false };
}

testNeo4jAuth().then(result => {
    if (result.success) {
        console.log(`\n🎉 Neo4j authentication working with password: ${result.correctPassword}`);
        console.log('The issue is likely inconsistent passwords in other files.');
    } else {
        console.log('\n❌ Neo4j authentication completely failed');
        console.log('Neo4j may not be running or credentials are all wrong.');
    }
}).catch(console.error);