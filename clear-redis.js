#!/usr/bin/env node

const Redis = require('ioredis');
require('dotenv').config();

async function clearRedis() {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    try {
        console.log('🗑️  Clearing all Redis data...');
        await redis.flushall();
        console.log('✅ Redis cleared successfully');
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await redis.quit();
    }
}

clearRedis().catch(console.error);