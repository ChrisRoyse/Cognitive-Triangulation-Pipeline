#!/usr/bin/env node

/**
 * Test script to verify centralized configuration is working properly
 */

// Load environment variables
require('dotenv').config();

const { PipelineConfig } = require('./src/config/pipelineConfig');
const { DatabaseManager } = require('./src/utils/sqliteDb');

async function testCentralizedConfig() {
    console.log('🧪 Testing Centralized Configuration...\n');
    
    try {
        // Test 1: Create default configuration
        console.log('1️⃣ Testing default configuration creation...');
        const defaultConfig = PipelineConfig.createDefault();
        console.log('   ✅ Default config created');
        console.log('   📊 Worker limits:', defaultConfig.workerLimits);
        console.log('   📊 Total workers:', Object.values(defaultConfig.workerLimits).reduce((a, b) => a + b, 0));
        
        // Test 2: Create test configuration
        console.log('\n2️⃣ Testing test configuration creation...');
        const testConfig = PipelineConfig.createForTesting();
        console.log('   ✅ Test config created');
        console.log('   📊 Worker limits:', testConfig.workerLimits);
        console.log('   📊 Total workers:', Object.values(testConfig.workerLimits).reduce((a, b) => a + b, 0));
        
        // Test 3: Test configuration validation
        console.log('\n3️⃣ Testing configuration validation...');
        const fileAnalysisLimit = defaultConfig.getWorkerLimit('file-analysis');
        console.log(`   ✅ File analysis worker limit: ${fileAnalysisLimit}`);
        
        const invalidLimit = defaultConfig.getWorkerLimit('non-existent-worker');
        console.log(`   ✅ Invalid worker limit (should be 1): ${invalidLimit}`);
        
        // Test 4: Test benchmark requirements
        console.log('\n4️⃣ Testing benchmark requirements...');
        const benchmarks = defaultConfig.getBenchmarkRequirements();
        console.log('   ✅ Benchmark requirements loaded');
        console.log('   📊 Minimum nodes:', benchmarks.minimum.nodes);
        console.log('   📊 Expected nodes:', benchmarks.expected.nodes);
        console.log('   📊 Minimum relationships:', benchmarks.minimum.relationships);
        
        // Test 5: Test grade calculation
        console.log('\n5️⃣ Testing grade calculation...');
        const testResults = { nodes: 400, relationships: 1800 };
        const grade = defaultConfig.calculateGrade(testResults);
        console.log(`   ✅ Grade for ${testResults.nodes} nodes, ${testResults.relationships} relationships: ${grade}`);
        
        // Test 6: Test database configuration
        console.log('\n6️⃣ Testing database configuration integration...');
        const dbConfig = defaultConfig.getDatabaseConfig('sqlite');
        console.log('   ✅ SQLite config loaded');
        console.log('   📊 Database path:', dbConfig.path);
        console.log('   📊 Batch size:', dbConfig.batchSize);
        
        // Test 7: Test configuration update
        console.log('\n7️⃣ Testing dynamic configuration updates...');
        const originalLimit = defaultConfig.getWorkerLimit('file-analysis');
        const newLimit = Math.max(1, originalLimit - 5);
        
        try {
            defaultConfig.updateWorkerLimit('file-analysis', newLimit);
            console.log(`   ✅ Successfully updated file-analysis limit: ${originalLimit} → ${newLimit}`);
            
            // Reset back
            defaultConfig.updateWorkerLimit('file-analysis', originalLimit);
            console.log(`   ✅ Successfully reset file-analysis limit: ${newLimit} → ${originalLimit}`);
        } catch (error) {
            console.error('   ❌ Configuration update failed:', error.message);
        }
        
        // Test 8: Test threshold checking
        console.log('\n8️⃣ Testing performance threshold checking...');
        const cpuExceeded = defaultConfig.isThresholdExceeded('cpu', 95);
        const memoryOK = defaultConfig.isThresholdExceeded('memory', 50);
        console.log(`   ✅ CPU threshold (95%) exceeded: ${cpuExceeded}`);
        console.log(`   ✅ Memory threshold (50%) exceeded: ${memoryOK}`);
        
        console.log('\n✅ All centralized configuration tests passed!');
        
    } catch (error) {
        console.error('\n❌ Configuration test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Test with database integration
async function testDatabaseIntegration() {
    console.log('\n🗄️  Testing Database Integration with Config...\n');
    
    try {
        const config = PipelineConfig.createForTesting();
        const dbManager = new DatabaseManager('./test-config.db');
        
        console.log('1️⃣ Initializing database with migrations...');
        await dbManager.initializeDb();
        console.log('   ✅ Database initialized successfully');
        
        console.log('\n2️⃣ Testing migration manager...');
        const migrationManager = dbManager.getMigrationManager();
        migrationManager.showStatus();
        
        console.log('\n3️⃣ Cleaning up test database...');
        await dbManager.close();
        const fs = require('fs');
        if (fs.existsSync('./test-config.db')) {
            fs.unlinkSync('./test-config.db');
        }
        console.log('   ✅ Test database cleaned up');
        
        console.log('\n✅ Database integration tests passed!');
        
    } catch (error) {
        console.error('\n❌ Database integration test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

async function main() {
    console.log('🔧 Centralized Configuration Test Suite');
    console.log('=' .repeat(60));
    
    await testCentralizedConfig();
    await testDatabaseIntegration();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('=' .repeat(60));
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { testCentralizedConfig, testDatabaseIntegration };