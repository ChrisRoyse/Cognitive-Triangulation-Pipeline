
const crypto = require('crypto');

/**
 * High-performance validation result cache
 */
class ValidationCache {
    constructor(maxSize = 10000, ttlMs = 300000) { // 5 minute TTL
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.hitCount = 0;
        this.missCount = 0;
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            size: 0
        };
    }

    generateKey(queryType, parameters) {
        const data = JSON.stringify({ queryType, parameters });
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.stats.misses++;
            return null;
        }
        
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.stats.misses++;
            return null;
        }
        
        // Update access time for LRU
        entry.lastAccessed = Date.now();
        this.stats.hits++;
        return entry.data;
    }

    set(key, data) {
        if (this.cache.size >= this.maxSize) {
            this.evictLRU();
        }
        
        this.cache.set(key, {
            data,
            expiresAt: Date.now() + this.ttlMs,
            lastAccessed: Date.now()
        });
        
        this.stats.size = this.cache.size;
    }

    evictLRU() {
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.stats.evictions++;
        }
    }

    clear() {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0, size: 0 };
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
            size: this.cache.size
        };
    }
}

module.exports = ValidationCache;
