/**
 * Cache System Demo Script
 * Demonstrates the multi-layer caching system functionality
 */

const { getDeepseekClient } = require('./deepseekClient');
const { getCacheManager } = require('./cacheManager');

async function runCacheDemo() {
    console.log('🚀 Starting Cache System Demo\n');

    try {
        // Initialize clients
        const client = getDeepseekClient();
        const cacheManager = getCacheManager();

        // Check cache health
        console.log('📊 Cache Health Check:');
        const health = await client.cacheHealthCheck();
        console.log(JSON.stringify(health, null, 2));
        console.log('');

        if (!health.redis) {
            console.log('❌ Redis not available, caching disabled for demo');
            return;
        }

        // Demo 1: Basic caching
        console.log('🔥 Demo 1: Basic Content Caching');
        const testPrompt = 'Analyze this simple function: function add(a, b) { return a + b; }';
        
        console.log('Making first request (should be cache miss)...');
        const start1 = Date.now();
        const response1 = await client.query(testPrompt, { 
            pattern: 'analyze_function',
            metadata: { language: 'javascript', complexity: 'simple' }
        });
        const time1 = Date.now() - start1;
        console.log(`✅ First request completed in ${time1}ms`);

        console.log('Making second request (should be cache hit)...');
        const start2 = Date.now();
        const response2 = await client.query(testPrompt, { 
            pattern: 'analyze_function',
            metadata: { language: 'javascript', complexity: 'simple' }
        });
        const time2 = Date.now() - start2;
        console.log(`⚡ Second request completed in ${time2}ms`);
        
        console.log(`Cache speedup: ${(time1/time2).toFixed(2)}x faster\n`);

        // Demo 2: File-based caching
        console.log('🔥 Demo 2: File-based Caching');
        const filePath = '/example/test.js';
        const fileContent = 'const example = () => { console.log("Hello"); };';
        
        const filePrompt = 'Review this code for best practices';
        console.log('Making file analysis request...');
        await client.query(filePrompt, {
            filePath,
            fileContent,
            pattern: 'code_quality'
        });

        console.log('Making same file analysis again (should hit file cache)...');
        await client.query(filePrompt, {
            filePath,
            fileContent,
            pattern: 'code_quality'
        });
        console.log('');

        // Demo 3: Cache statistics
        console.log('📈 Cache Statistics:');
        const stats = client.getCacheStats();
        console.log(JSON.stringify(stats, null, 2));
        console.log('');

        // Demo 4: Cache warming
        console.log('🔥 Demo 4: Cache Warming');
        console.log('Warming cache with common patterns...');
        await client.warmCache(['analyze_function', 'security_review', 'performance_analysis']);
        console.log('✅ Cache warming completed\n');

        // Demo 5: Cache invalidation
        console.log('🔥 Demo 5: Cache Invalidation');
        console.log('Invalidating file cache...');
        const invalidated = await client.invalidateFileCache(filePath);
        console.log(`✅ Invalidated ${invalidated} cache entries\n`);

        // Final stats
        console.log('📊 Final Cache Statistics:');
        const finalStats = client.getCacheStats();
        console.log(JSON.stringify(finalStats, null, 2));

        console.log('\n🎉 Cache Demo Completed Successfully!');

    } catch (error) {
        console.error('❌ Cache demo failed:', error.message);
        console.error(error.stack);
    }
}

// Run demo if called directly
if (require.main === module) {
    runCacheDemo()
        .then(() => {
            console.log('\n✅ Demo finished');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Demo failed:', error);
            process.exit(1);
        });
}

module.exports = { runCacheDemo };