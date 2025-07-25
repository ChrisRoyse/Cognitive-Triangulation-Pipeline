#!/usr/bin/env node

/**
 * Test Redis Configuration
 * 
 * This script tests that the Redis eviction policy is correctly set
 * through the cacheClient module.
 */

const { getCacheClient } = require('../src/utils/cacheClient');

async function testRedisConfig() {
    console.log('Testing Redis configuration through cacheClient...\n');
    
    try {
        // Get the cache client - this should trigger the automatic configuration
        const client = getCacheClient();
        
        // Wait a bit for the 'ready' event to fire and configuration to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check the configuration
        const evictionPolicy = await client.config('GET', 'maxmemory-policy');
        
        console.log('\nFinal Redis configuration:');
        console.log(`- Eviction policy: ${evictionPolicy[1]}`);
        
        if (evictionPolicy[1] === 'noeviction') {
            console.log('\n✅ SUCCESS: Redis eviction policy is correctly set to noeviction');
            process.exit(0);
        } else {
            console.error('\n❌ FAILED: Redis eviction policy is not set to noeviction');
            process.exit(1);
        }
        
    } catch (err) {
        console.error('Error testing Redis configuration:', err.message);
        process.exit(1);
    }
}

// Run the test
testRedisConfig();