const crypto = require('crypto');
const { getCacheClient } = require('./cacheClient');
const config = require('../config');

/**
 * Multi-layer cache manager for LLM requests
 * Implements content hashing, file hashing, and POI pattern caching
 * with TTL support and comprehensive monitoring
 */
class CacheManager {
    constructor(options = {}) {
        this.enabled = options.enabled !== false; // Default enabled
        this.defaultTTL = options.defaultTTL || 24 * 60 * 60; // 24 hours in seconds
        this.redisClient = null;
        this.stats = {
            hits: 0,
            misses: 0,
            writes: 0,
            errors: 0,
            layerStats: {
                content: { hits: 0, misses: 0 },
                file: { hits: 0, misses: 0 },
                poi: { hits: 0, misses: 0 }
            }
        };
        
        // Cache key prefixes for different layers
        this.prefixes = {
            content: 'llm:content:',
            file: 'llm:file:',
            poi: 'llm:poi:',
            stats: 'cache:stats:',
            warming: 'cache:warm:'
        };

        // POI patterns for common code analysis requests
        this.commonPatterns = [
            'analyze_function',
            'extract_dependencies',
            'security_review',
            'code_quality',
            'performance_analysis'
        ];

        this._initializeRedis();
    }

    async _initializeRedis() {
        try {
            if (this.enabled) {
                this.redisClient = getCacheClient();
                console.log('[CacheManager] Redis client initialized for caching');
            } else {
                console.log('[CacheManager] Caching disabled');
            }
        } catch (error) {
            console.error('[CacheManager] Failed to initialize Redis:', error.message);
            this.enabled = false;
        }
    }

    /**
     * Generate content-based hash for cache key
     * @param {string} content - Content to hash
     * @param {string} model - Model name
     * @param {object} options - Additional options for hashing
     * @returns {string} - SHA-256 hash
     */
    _generateContentHash(content, model = 'deepseek-chat', options = {}) {
        const normalizedContent = this._normalizeContent(content);
        const hashInput = JSON.stringify({
            content: normalizedContent,
            model,
            temperature: options.temperature || 0.0,
            max_tokens: options.max_tokens || 8000
        });
        
        return crypto.createHash('sha256').update(hashInput).digest('hex');
    }

    /**
     * Generate file-based hash for cache key
     * @param {string} filePath - File path
     * @param {string} fileContent - File content
     * @returns {string} - File hash
     */
    _generateFileHash(filePath, fileContent) {
        const fileStats = {
            path: filePath,
            size: Buffer.byteLength(fileContent, 'utf8'),
            contentHash: crypto.createHash('md5').update(fileContent).digest('hex')
        };
        
        return crypto.createHash('sha256').update(JSON.stringify(fileStats)).digest('hex');
    }

    /**
     * Generate POI pattern hash for common analysis patterns
     * @param {string} pattern - Pattern identifier
     * @param {object} metadata - Pattern metadata
     * @returns {string} - Pattern hash
     */
    _generatePOIHash(pattern, metadata = {}) {
        const poiData = {
            pattern,
            language: metadata.language || 'unknown',
            complexity: metadata.complexity || 'medium',
            framework: metadata.framework || 'generic'
        };
        
        return crypto.createHash('sha256').update(JSON.stringify(poiData)).digest('hex');
    }

    /**
     * Normalize content for consistent hashing
     * @param {string} content - Content to normalize
     * @returns {string} - Normalized content
     */
    _normalizeContent(content) {
        return content
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
            .replace(/\/\/.*$/gm, '') // Remove line comments
            .trim()
            .toLowerCase();
    }

    /**
     * Get cached response with multi-layer lookup
     * @param {string} prompt - LLM prompt
     * @param {object} options - Cache options
     * @returns {Promise<object|null>} - Cached response or null
     */
    async get(prompt, options = {}) {
        if (!this.enabled || !this.redisClient) {
            this._updateStats('misses');
            return null;
        }

        try {
            // Layer 1: Content-based cache
            const contentHash = this._generateContentHash(prompt, options.model, options);
            const contentKey = this.prefixes.content + contentHash;
            
            let cached = await this.redisClient.get(contentKey);
            if (cached) {
                this._updateStats('hits');
                this._updateLayerStats('content', 'hits');
                console.log(`[CacheManager] Content cache HIT: ${contentHash.substring(0, 8)}`);
                return JSON.parse(cached);
            }

            // Layer 2: File-based cache (if file metadata provided)
            if (options.filePath && options.fileContent) {
                const fileHash = this._generateFileHash(options.filePath, options.fileContent);
                const fileKey = this.prefixes.file + fileHash;
                
                cached = await this.redisClient.get(fileKey);
                if (cached) {
                    this._updateStats('hits');
                    this._updateLayerStats('file', 'hits');
                    console.log(`[CacheManager] File cache HIT: ${fileHash.substring(0, 8)}`);
                    
                    // Store in content cache for faster future access
                    await this.redisClient.setex(contentKey, this.defaultTTL, cached);
                    return JSON.parse(cached);
                }
            }

            // Layer 3: POI pattern cache
            if (options.pattern) {
                const poiHash = this._generatePOIHash(options.pattern, options.metadata);
                const poiKey = this.prefixes.poi + poiHash;
                
                cached = await this.redisClient.get(poiKey);
                if (cached) {
                    this._updateStats('hits');
                    this._updateLayerStats('poi', 'hits');
                    console.log(`[CacheManager] POI cache HIT: ${poiHash.substring(0, 8)}`);
                    
                    // Store in higher layers for faster future access
                    await Promise.all([
                        this.redisClient.setex(contentKey, this.defaultTTL, cached),
                        options.filePath && options.fileContent ? 
                            this.redisClient.setex(this.prefixes.file + this._generateFileHash(options.filePath, options.fileContent), this.defaultTTL, cached) :
                            Promise.resolve()
                    ]);
                    return JSON.parse(cached);
                }
            }

            // Cache miss across all layers
            this._updateStats('misses');
            this._updateLayerStats('content', 'misses');
            if (options.filePath) this._updateLayerStats('file', 'misses');
            if (options.pattern) this._updateLayerStats('poi', 'misses');
            
            console.log(`[CacheManager] Cache MISS: ${contentHash.substring(0, 8)}`);
            return null;

        } catch (error) {
            console.error('[CacheManager] Cache get error:', error.message);
            this._updateStats('errors');
            return null;
        }
    }

    /**
     * Store response in multi-layer cache
     * @param {string} prompt - LLM prompt
     * @param {object} response - LLM response
     * @param {object} options - Cache options
     * @returns {Promise<boolean>} - Success status
     */
    async set(prompt, response, options = {}) {
        if (!this.enabled || !this.redisClient) {
            return false;
        }

        try {
            const serializedResponse = JSON.stringify(response);
            const ttl = options.ttl || this.defaultTTL;
            const promises = [];

            // Store in content cache
            const contentHash = this._generateContentHash(prompt, options.model, options);
            const contentKey = this.prefixes.content + contentHash;
            promises.push(this.redisClient.setex(contentKey, ttl, serializedResponse));

            // Store in file cache if file metadata provided
            if (options.filePath && options.fileContent) {
                const fileHash = this._generateFileHash(options.filePath, options.fileContent);
                const fileKey = this.prefixes.file + fileHash;
                promises.push(this.redisClient.setex(fileKey, ttl, serializedResponse));
            }

            // Store in POI pattern cache
            if (options.pattern) {
                const poiHash = this._generatePOIHash(options.pattern, options.metadata);
                const poiKey = this.prefixes.poi + poiHash;
                promises.push(this.redisClient.setex(poiKey, ttl, serializedResponse));
            }

            await Promise.all(promises);
            this._updateStats('writes');
            console.log(`[CacheManager] Cached response: ${contentHash.substring(0, 8)}`);
            return true;

        } catch (error) {
            console.error('[CacheManager] Cache set error:', error.message);
            this._updateStats('errors');
            return false;
        }
    }

    /**
     * Invalidate cache entries by pattern
     * @param {string} pattern - Redis key pattern
     * @returns {Promise<number>} - Number of keys deleted
     */
    async invalidate(pattern) {
        if (!this.enabled || !this.redisClient) {
            return 0;
        }

        try {
            const keys = await this.redisClient.keys(pattern);
            if (keys.length > 0) {
                const result = await this.redisClient.del(...keys);
                console.log(`[CacheManager] Invalidated ${result} cache entries matching: ${pattern}`);
                return result;
            }
            return 0;
        } catch (error) {
            console.error('[CacheManager] Cache invalidation error:', error.message);
            this._updateStats('errors');
            return 0;
        }
    }

    /**
     * Invalidate file-specific cache entries
     * @param {string} filePath - File path to invalidate
     * @returns {Promise<number>} - Number of keys deleted
     */
    async invalidateFile(filePath) {
        const pattern = `${this.prefixes.file}*`;
        return await this.invalidate(pattern);
    }

    /**
     * Warm cache with common patterns
     * @param {Array} patterns - Patterns to warm
     * @returns {Promise<void>}
     */
    async warmCache(patterns = this.commonPatterns) {
        if (!this.enabled || !this.redisClient) {
            return;
        }

        try {
            console.log('[CacheManager] Starting cache warming...');
            
            for (const pattern of patterns) {
                const warmKey = this.prefixes.warming + pattern;
                const exists = await this.redisClient.exists(warmKey);
                
                if (!exists) {
                    // Mark pattern as warmed to avoid duplicate warming
                    await this.redisClient.setex(warmKey, 3600, 'warmed'); // 1 hour marker
                    console.log(`[CacheManager] Marked pattern for warming: ${pattern}`);
                }
            }
            
            console.log('[CacheManager] Cache warming completed');
        } catch (error) {
            console.error('[CacheManager] Cache warming error:', error.message);
        }
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache statistics
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
        
        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            total,
            enabled: this.enabled
        };
    }

    /**
     * Reset cache statistics
     */
    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            writes: 0,
            errors: 0,
            layerStats: {
                content: { hits: 0, misses: 0 },
                file: { hits: 0, misses: 0 },
                poi: { hits: 0, misses: 0 }
            }
        };
        console.log('[CacheManager] Statistics reset');
    }

    /**
     * Update cache statistics
     * @param {string} type - Stat type to update
     */
    _updateStats(type) {
        if (this.stats[type] !== undefined) {
            this.stats[type]++;
        }
    }

    /**
     * Update layer-specific statistics
     * @param {string} layer - Cache layer
     * @param {string} type - Stat type
     */
    _updateLayerStats(layer, type) {
        if (this.stats.layerStats[layer] && this.stats.layerStats[layer][type] !== undefined) {
            this.stats.layerStats[layer][type]++;
        }
    }

    /**
     * Clear all cache entries
     * @returns {Promise<number>} - Number of keys deleted
     */
    async clearAll() {
        if (!this.enabled || !this.redisClient) {
            return 0;
        }

        try {
            const patterns = Object.values(this.prefixes).map(prefix => `${prefix}*`);
            let totalDeleted = 0;
            
            for (const pattern of patterns) {
                const deleted = await this.invalidate(pattern);
                totalDeleted += deleted;
            }
            
            console.log(`[CacheManager] Cleared all cache entries: ${totalDeleted} keys deleted`);
            return totalDeleted;
        } catch (error) {
            console.error('[CacheManager] Cache clear error:', error.message);
            this._updateStats('errors');
            return 0;
        }
    }

    /**
     * Health check for cache system
     * @returns {Promise<object>} - Health status
     */
    async healthCheck() {
        if (!this.enabled) {
            return { status: 'disabled', redis: false };
        }

        try {
            if (!this.redisClient) {
                return { status: 'error', redis: false, error: 'Redis client not initialized' };
            }

            // Test Redis connectivity
            await this.redisClient.ping();
            
            return {
                status: 'healthy',
                redis: true,
                stats: this.getStats()
            };
        } catch (error) {
            return {
                status: 'error',
                redis: false,
                error: error.message
            };
        }
    }
}

// Singleton instance
let cacheManagerInstance;

/**
 * Get cache manager singleton instance
 * @param {object} options - Cache options
 * @returns {CacheManager} - Cache manager instance
 */
function getCacheManager(options = {}) {
    if (!cacheManagerInstance) {
        // Read cache configuration from config
        const cacheOptions = {
            enabled: config.CACHE_ENABLED && config.REDIS_ENABLED,
            defaultTTL: config.CACHE_DEFAULT_TTL,
            maxSize: config.CACHE_MAX_SIZE,
            ...options
        };
        
        cacheManagerInstance = new CacheManager(cacheOptions);
    }
    return cacheManagerInstance;
}

module.exports = {
    CacheManager,
    getCacheManager
};