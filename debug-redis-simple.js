#!/usr/bin/env node

const IORedis = require('ioredis');
const config = require('./config/index.js');

async function debugRedis() {
    console.log('=== SIMPLE REDIS DEBUG ===\n');
    
    const redis = new IORedis(config.REDIS_URL);
    
    try {
        // Check Redis connection
        console.log('Testing Redis connection...');
        await redis.ping();
        console.log('✅ Redis connection successful\n');
        
        // Get all keys
        console.log('All keys in Redis:');
        const keys = await redis.keys('*');
        console.log(`Found ${keys.length} keys total\n`);
        
        // Show keys related to our queues
        const queueKeys = keys.filter(key => 
            key.includes('bull:') || 
            key.includes('queue') || 
            key.includes('relationship')
        );
        
        console.log('Queue-related keys:');
        for (const key of queueKeys.slice(0, 20)) { // Show first 20
            const type = await redis.type(key);
            console.log(`  ${key} (type: ${type})`);
        }
        
        if (queueKeys.length > 20) {
            console.log(`  ... and ${queueKeys.length - 20} more queue keys`);
        }
        console.log('');
        
        // Check specific BullMQ keys for relationship queue
        const relQueueKeys = keys.filter(key => key.includes('relationship-resolution-queue'));
        console.log('Relationship resolution queue keys:');
        for (const key of relQueueKeys) {
            const type = await redis.type(key);
            let count = 'N/A';
            try {
                if (type === 'list') {
                    count = await redis.llen(key);
                } else if (type === 'set') {
                    count = await redis.scard(key);
                } else if (type === 'zset') {
                    count = await redis.zcard(key);
                } else if (type === 'hash') {
                    count = await redis.hlen(key);
                }
            } catch (e) {
                count = `Error: ${e.message}`;
            }
            console.log(`  ${key} (type: ${type}, count: ${count})`);
        }
        
    } catch (error) {
        console.error('❌ Error during debug:', error.message);
    } finally {
        await redis.quit();
    }
}

debugRedis().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});