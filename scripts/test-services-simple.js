#!/usr/bin/env node

const Redis = require('ioredis');
const neo4j = require('neo4j-driver');
require('dotenv').config();

async function testRedis() {
    console.log('\n🔴 Testing Redis Connection...');
    
    const redis = new Redis({
        host: 'localhost',
        port: process.env.REDIS_PORT || 6379,
        retryStrategy: () => null
    });

    try {
        const pong = await redis.ping();
        console.log('✅ Redis is working! Response:', pong);
        await redis.quit();
        return true;
    } catch (error) {
        console.error('❌ Redis connection failed:', error.message);
        await redis.quit();
        return false;
    }
}

async function testNeo4j() {
    console.log('\n🔵 Testing Neo4j Connection...');
    
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'CTPSecure2024!';
    
    console.log('   URI:', uri);
    console.log('   User:', user);
    console.log('   Password:', password.substring(0, 3) + '***');
    
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 60 * 1000 // 60 seconds
    });

    try {
        await driver.verifyConnectivity();
        console.log('✅ Neo4j connectivity verified!');
        
        const session = driver.session();
        const result = await session.run('RETURN 1 as test');
        console.log('✅ Neo4j query test passed! Result:', result.records[0].get('test').toNumber());
        
        await session.close();
        await driver.close();
        return true;
    } catch (error) {
        console.error('❌ Neo4j connection failed:', error.message);
        await driver.close();
        return false;
    }
}

async function main() {
    console.log('================================================');
    console.log('   CTP Service Connection Test');
    console.log('================================================');

    const redisOk = await testRedis();
    const neo4jOk = await testNeo4j();

    console.log('\n================================================');
    console.log('Summary:');
    console.log('================================================');
    console.log('Redis:', redisOk ? '✅ Working' : '❌ Failed');
    console.log('Neo4j:', neo4jOk ? '✅ Working' : '❌ Failed');
    console.log('================================================\n');
    
    if (redisOk && neo4jOk) {
        console.log('🎉 All services are working!');
        console.log('\nYou can now run:');
        console.log('  node src/main.js <directory>');
        console.log('  node src/main_optimized.js <directory>');
    }
    
    process.exit(redisOk && neo4jOk ? 0 : 1);
}

main().catch(console.error);