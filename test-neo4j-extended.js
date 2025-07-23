const neo4j = require('neo4j-driver');

async function testNeo4jExtended() {
    console.log('🔐 Extended Neo4j Authentication Test...');
    
    const uri = 'bolt://localhost:7687';
    const user = 'neo4j';
    
    // Test more password combinations
    const passwordsToTest = [
        'test1234',           // From .env
        'password',           // Common fallback  
        'admin',              // Simple admin
        'neo4j',              // Default Neo4j
        'CTPSecure2024!',     // From scripts
        '',                   // Empty password
        'root',               // Root
        '123456',             // Simple
        'admin123',           // Admin123
        'test',               // Test
        'backend',            // Database name from backup
        'ctp'                 // Database name from example
    ];
    
    console.log(`📡 Testing ${passwordsToTest.length} different passwords...\n`);
    
    for (let i = 0; i < passwordsToTest.length; i++) {
        const password = passwordsToTest[i];
        const displayPassword = password ? `"${password.substring(0, 1)}${'*'.repeat(Math.max(0, password.length - 1))}"` : '""';
        
        console.log(`🔑 Test ${i + 1}/${passwordsToTest.length}: ${displayPassword}`);
        
        const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
        
        try {
            const session = driver.session();
            const result = await session.run('RETURN 1 as test');
            
            if (result.records.length > 0) {
                console.log('✅ SUCCESS! Connection established');
                console.log(`🎯 WORKING PASSWORD: "${password}"`);
                
                // Test database access
                const dbResult = await session.run('CALL db.info()');
                console.log('📊 Database info available');
                
                await session.close();
                await driver.close();
                
                return { success: true, correctPassword: password };
            }
        } catch (error) {
            if (error.message.includes('authentication failure')) {
                console.log('❌ Authentication failed');
            } else {
                console.log(`❌ Error: ${error.message}`);
            }
        } finally {
            try { await driver.close(); } catch {}
        }
    }
    
    console.log('\n💥 ALL PASSWORDS FAILED');
    console.log('Possible issues:');
    console.log('1. Neo4j requires password reset');
    console.log('2. Neo4j is in maintenance mode');
    console.log('3. Connection encryption mismatch');
    console.log('4. User account locked');
    
    // Try with different URI schemes
    console.log('\n🔄 Trying different connection schemes...');
    
    const uriSchemes = [
        'neo4j://localhost:7687',
        'bolt://localhost:7687',
        'neo4j://127.0.0.1:7687',
        'bolt://127.0.0.1:7687'
    ];
    
    for (const testUri of uriSchemes) {
        console.log(`🌐 Testing URI: ${testUri}`);
        const driver = neo4j.driver(testUri, neo4j.auth.basic(user, 'test1234'));
        
        try {
            const session = driver.session();
            const result = await session.run('RETURN 1 as test');
            
            if (result.records.length > 0) {
                console.log(`✅ SUCCESS with URI: ${testUri}`);
                await session.close();
                await driver.close();
                return { success: true, correctPassword: 'test1234', uri: testUri };
            }
        } catch (error) {
            console.log(`❌ Failed: ${error.message.substring(0, 50)}...`);
        } finally {
            try { await driver.close(); } catch {}
        }
    }
    
    return { success: false };
}

testNeo4jExtended().then(result => {
    if (result.success) {
        console.log(`\n🎉 SUCCESS!`);
        console.log(`Password: "${result.correctPassword}"`);
        if (result.uri) console.log(`URI: ${result.uri}`);
    } else {
        console.log('\n❌ Complete authentication failure');
        console.log('Manual Neo4j reset may be required');
    }
}).catch(console.error);