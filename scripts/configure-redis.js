#!/usr/bin/env node

/**
 * Redis Configuration Script
 * 
 * This script ensures Redis is configured with the correct eviction policy
 * for the CTP pipeline. It can be run manually or as part of the setup process.
 * 
 * Usage: node scripts/configure-redis.js [redis-url]
 */

const Redis = require('ioredis');

async function configureRedis() {
    const redisUrl = process.argv[2] || process.env.REDIS_URL || 'redis://localhost:6379';
    
    console.log(`Connecting to Redis at: ${redisUrl}`);
    
    const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        connectTimeout: 30000,    // 30 second connection timeout
        commandTimeout: 5000,     // 5 second command timeout
        retryStrategy: (times) => {
            return Math.min(times * 50, 2000);
        }
    });

    try {
        // Wait for connection
        await client.ping();
        console.log('Successfully connected to Redis');

        // Get current eviction policy
        const currentPolicy = await client.config('GET', 'maxmemory-policy');
        console.log(`Current eviction policy: ${currentPolicy[1]}`);

        if (currentPolicy[1] !== 'noeviction') {
            console.log('Setting eviction policy to noeviction...');
            
            // Set the policy
            await client.config('SET', 'maxmemory-policy', 'noeviction');
            
            // Persist the configuration
            try {
                await client.config('REWRITE');
                console.log('Configuration persisted to disk');
            } catch (err) {
                console.warn('Failed to persist configuration:', err.message);
                console.warn('The setting will be active but may not survive a Redis restart');
            }

            // Verify the change
            const newPolicy = await client.config('GET', 'maxmemory-policy');
            console.log(`New eviction policy: ${newPolicy[1]}`);
            
            if (newPolicy[1] === 'noeviction') {
                console.log('✓ Redis eviction policy successfully configured');
            } else {
                console.error('✗ Failed to update eviction policy');
                process.exit(1);
            }
        } else {
            console.log('✓ Redis eviction policy is already correctly set to noeviction');
        }

        // Optional: Display other relevant Redis settings
        console.log('\nOther Redis settings:');
        const maxmemory = await client.config('GET', 'maxmemory');
        console.log(`- maxmemory: ${maxmemory[1] || '0 (unlimited)'}`);
        
        const save = await client.config('GET', 'save');
        console.log(`- save: ${save[1] || 'not configured'}`);
        
        const aof = await client.config('GET', 'appendonly');
        console.log(`- appendonly: ${aof[1]}`);
        
        // Check timeout settings for large codebase processing
        const timeout = await client.config('GET', 'timeout');
        console.log(`- timeout: ${timeout[1]} seconds`);
        
        // Recommend settings for large codebases (207+ jobs)
        console.log('\nRecommendations for large codebase processing:');
        console.log('- Set maxmemory to appropriate limit (e.g., 1GB for 207+ jobs)');
        console.log('- Monitor Redis memory usage during processing');
        console.log('- Client-side connection and command timeouts are configured in QueueManager');

    } catch (err) {
        console.error('Error configuring Redis:', err.message);
        if (err.message.includes('CONFIG')) {
            console.error('\nRedis CONFIG commands may be disabled.');
            console.error('You may need to:');
            console.error('1. Enable CONFIG commands in Redis configuration');
            console.error('2. Or manually set in redis.conf: maxmemory-policy noeviction');
            console.error('3. Or use Docker with command: redis-server --maxmemory-policy noeviction');
        }
        process.exit(1);
    } finally {
        await client.quit();
        console.log('\nRedis connection closed');
    }
}

// Run the configuration
configureRedis().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});