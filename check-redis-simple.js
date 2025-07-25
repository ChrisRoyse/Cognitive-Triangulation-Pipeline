const { createClient } = require('redis');

async function checkRedis() {
    const redis = createClient({
        host: 'localhost',
        port: 6379,
        db: 3
    });
    
    try {
        await redis.connect();
        console.log('Connected to Redis db 3');
        
        const keys = await redis.keys('*');
        console.log(`Found ${keys.length} keys in Redis:`, keys);
        
        await redis.disconnect();
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkRedis();