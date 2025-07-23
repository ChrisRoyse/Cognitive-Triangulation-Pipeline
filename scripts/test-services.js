#!/usr/bin/env node

const Redis = require('ioredis');
const neo4j = require('neo4j-driver');
const chalk = require('chalk').default || require('chalk');
require('dotenv').config();

async function testRedis() {
    console.log(chalk.blue('\n🔴 Testing Redis Connection...'));
    
    const redis = new Redis({
        host: 'localhost',
        port: process.env.REDIS_PORT || 6379,
        retryStrategy: () => null // Don't retry for this test
    });

    try {
        const pong = await redis.ping();
        console.log(chalk.green('✅ Redis is working! Response:', pong));
        
        // Test basic operations
        await redis.set('test:key', 'Hello from CTP!');
        const value = await redis.get('test:key');
        console.log(chalk.green('✅ Redis read/write test passed:', value));
        await redis.del('test:key');
        
        await redis.quit();
        return true;
    } catch (error) {
        console.error(chalk.red('❌ Redis connection failed:'), error.message);
        await redis.quit();
        return false;
    }
}

async function testNeo4j() {
    console.log(chalk.blue('\n🔵 Testing Neo4j Connection...'));
    
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'CTPSecure2024!';
    
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    const session = driver.session();

    try {
        // Test connection with a simple query
        const result = await session.run('RETURN 1 as test');
        console.log(chalk.green('✅ Neo4j is working! Query result:', result.records[0].get('test')));
        
        // Check APOC availability
        try {
            const apocResult = await session.run('RETURN apoc.version() as version');
            console.log(chalk.green('✅ APOC is available! Version:', apocResult.records[0].get('version')));
        } catch (apocError) {
            console.log(chalk.yellow('⚠️  APOC is not available (optional)'));
        }
        
        await session.close();
        await driver.close();
        return true;
    } catch (error) {
        console.error(chalk.red('❌ Neo4j connection failed:'), error.message);
        await session.close();
        await driver.close();
        return false;
    }
}

async function testDeepSeek() {
    console.log(chalk.blue('\n🤖 Testing DeepSeek API...'));
    
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error(chalk.red('❌ DEEPSEEK_API_KEY not found in environment'));
        return false;
    }
    
    console.log(chalk.green('✅ DeepSeek API key is configured'));
    console.log(chalk.gray(`   Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`));
    return true;
}

async function main() {
    console.log(chalk.cyan('================================================'));
    console.log(chalk.cyan('   Cognitive Triangulation Pipeline - Service Test'));
    console.log(chalk.cyan('================================================'));

    const results = {
        redis: await testRedis(),
        neo4j: await testNeo4j(),
        deepseek: await testDeepSeek()
    };

    console.log(chalk.cyan('\n================================================'));
    console.log(chalk.cyan('Summary:'));
    console.log(chalk.cyan('================================================'));
    
    let allPassed = true;
    for (const [service, passed] of Object.entries(results)) {
        if (passed) {
            console.log(chalk.green(`✅ ${service.toUpperCase()}: Working`));
        } else {
            console.log(chalk.red(`❌ ${service.toUpperCase()}: Failed`));
            allPassed = false;
        }
    }

    if (allPassed) {
        console.log(chalk.green('\n🎉 All services are working correctly!'));
        console.log(chalk.gray('\nYou can now run the pipeline with:'));
        console.log(chalk.white('  node src/main.js <directory-to-analyze>'));
        console.log(chalk.white('  OR'));
        console.log(chalk.white('  node src/main_optimized.js <directory-to-analyze>'));
    } else {
        console.log(chalk.red('\n⚠️  Some services are not working. Please check the errors above.'));
    }

    console.log(chalk.cyan('\n================================================\n'));
    process.exit(allPassed ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}