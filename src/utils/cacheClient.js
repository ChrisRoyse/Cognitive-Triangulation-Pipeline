const Redis = require('ioredis');
const config = require('../../config');

let client;

function getCacheClient() {
    if (!client) {
        client = new Redis(config.REDIS_URL);

        client.on('error', (err) => {
            console.error('Redis Client Error', err);
        });

        client.on('ready', () => {
            console.log('Redis connected');
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