#!/usr/bin/env node

/**
 * Configure Redis for optimal CTP pipeline performance
 * 
 * This script ensures Redis is configured with:
 * - noeviction policy to prevent data loss
 * - Appropriate memory limits
 * - Persistence settings
 */

const Redis = require('ioredis');
const config = require('../config');

async function configureRedis() {
    console.log('🔧 Configuring Redis for CTP pipeline...\n');
    
    const client = new Redis(config.REDIS_URL);
    
    try {
        // Check current configuration
        console.log('📊 Current Redis Configuration:');
        const currentPolicy = await client.config('GET', 'maxmemory-policy');
        const currentMemory = await client.config('GET', 'maxmemory');
        
        console.log(`  - Eviction Policy: ${currentPolicy[1]}`);
        console.log(`  - Max Memory: ${currentMemory[1] || 'unlimited'}`);
        
        // Set recommended configuration
        console.log('\n⚙️ Applying recommended settings...');
        
        // Set eviction policy to noeviction
        await client.config('SET', 'maxmemory-policy', 'noeviction');
        console.log('  ✅ Set maxmemory-policy to noeviction');
        
        // Set memory limit if not set (512MB recommended for local dev)
        if (!currentMemory[1] || currentMemory[1] === '0') {
            await client.config('SET', 'maxmemory', '512mb');
            console.log('  ✅ Set maxmemory to 512mb');
        }
        
        // Enable AOF persistence
        const aofEnabled = await client.config('GET', 'appendonly');
        if (aofEnabled[1] !== 'yes') {
            await client.config('SET', 'appendonly', 'yes');
            console.log('  ✅ Enabled AOF persistence');
        }
        
        // Verify configuration
        console.log('\n✅ Redis configuration updated successfully!');
        const newPolicy = await client.config('GET', 'maxmemory-policy');
        const newMemory = await client.config('GET', 'maxmemory');
        
        console.log('\n📊 New Redis Configuration:');
        console.log(`  - Eviction Policy: ${newPolicy[1]}`);
        console.log(`  - Max Memory: ${newMemory[1]}`);
        
        await client.quit();
        
    } catch (error) {
        console.error('\n❌ Error configuring Redis:', error.message);
        console.log('\n💡 If you see "ERR CONFIG SET is disabled", you need to:');
        console.log('   1. Stop Redis');
        console.log('   2. Edit redis.conf and add:');
        console.log('      maxmemory-policy noeviction');
        console.log('      maxmemory 512mb');
        console.log('   3. Restart Redis with the config file');
        console.log('   OR');
        console.log('   Run Redis with: redis-server --maxmemory-policy noeviction --maxmemory 512mb');
        
        await client.quit();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    configureRedis().catch(console.error);
}

module.exports = { configureRedis };