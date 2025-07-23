const Redis = require('ioredis');
const config = require('../../config');

let client;

function getCacheClient() {
    if (!client) {
        client = new Redis(config.REDIS_URL, {
            maxRetriesPerRequest: null,
        });

        client.on('error', (err) => {
            console.error('Redis Client Error', err);
        });

        client.on('ready', async () => {
            // Check and warn about eviction policy
            try {
                const evictionPolicy = await client.config('GET', 'maxmemory-policy');
                if (evictionPolicy && evictionPolicy[1] !== 'noeviction') {
                    console.warn(`IMPORTANT! Eviction policy is ${evictionPolicy[1]}. It should be "noeviction"`);
                }
            } catch (err) {
                // Ignore if CONFIG command is disabled
            }
        });
    }
    return client;
}

async function closeCacheClient() {
    if (client) {
        await client.quit();
        client = null;
    }
}

module.exports = { getCacheClient, closeCacheClient };