# Multi-Layer LLM Caching System

A comprehensive caching system designed to reduce API calls and improve performance for LLM requests.

## 🚀 Features

### Multi-Layer Architecture
- **Content Hash Cache**: Primary cache based on prompt content hash
- **File Hash Cache**: Secondary cache for file-specific analysis
- **POI Pattern Cache**: Tertiary cache for common code patterns

### Performance Optimization
- **TTL Management**: Configurable expiration (24 hours default)
- **Cache Warming**: Pre-populate cache with common patterns
- **Intelligent Invalidation**: File-specific and pattern-based cache clearing
- **Graceful Degradation**: System works without Redis/caching

### Monitoring & Analytics
- **Real-time Statistics**: Hit rates, miss rates, error tracking
- **Layer Performance**: Per-layer cache performance metrics
- **Health Monitoring**: Redis connectivity and cache status
- **Performance Recommendations**: Automated suggestions for optimization

## 📦 Components

### Core Files
- `cacheManager.js` - Main cache manager with multi-layer support
- `deepseekClient.js` - Enhanced with caching integration
- `cacheMonitor.js` - Monitoring and management utilities
- `cacheDemo.js` - Demonstration script

### Configuration
```env
# Cache Configuration
CACHE_ENABLED=true
CACHE_DEFAULT_TTL=86400
CACHE_MAX_SIZE=1000000
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379
```

## 🔧 Usage

### Basic Usage
```javascript
const { getDeepseekClient } = require('./deepseekClient');

const client = getDeepseekClient();

// Simple query with caching
const response = await client.query('Analyze this function: function add(a, b) { return a + b; }');

// With cache options
const response = await client.query(prompt, {
    pattern: 'analyze_function',
    metadata: { language: 'javascript', complexity: 'simple' },
    ttl: 3600 // 1 hour
});

// File-based caching
const response = await client.query(prompt, {
    filePath: '/path/to/file.js',
    fileContent: 'const example = () => {};',
    pattern: 'code_review'
});
```

### Cache Management
```javascript
// Get cache statistics
const stats = client.getCacheStats();
console.log(`Hit rate: ${stats.hitRate}`);

// Clear all cache
await client.clearCache();

// Invalidate specific file cache
await client.invalidateFileCache('/path/to/file.js');

// Warm cache with common patterns
await client.warmCache(['analyze_function', 'security_review']);

// Health check
const health = await client.cacheHealthCheck();
```

### Monitoring
```bash
# Start monitoring (30 second intervals)
node src/utils/cacheMonitor.js start 30000

# Show current statistics
node src/utils/cacheMonitor.js stats

# Generate detailed report
node src/utils/cacheMonitor.js report

# Reset cache and statistics
node src/utils/cacheMonitor.js reset

# Optimize cache with common patterns
node src/utils/cacheMonitor.js optimize
```

### Demo
```bash
# Run comprehensive demo
node src/utils/cacheDemo.js
```

## 🏗️ Architecture

### Cache Key Generation
```
Content Hash: SHA-256(normalized_content + model + options)
File Hash: SHA-256(file_path + file_size + content_hash)
POI Hash: SHA-256(pattern + language + complexity + framework)
```

### Cache Layers (in lookup order)
1. **Content Cache** - Fastest, direct content match
2. **File Cache** - Medium speed, file-based lookup
3. **POI Cache** - Slowest, pattern-based lookup

### Cache Hierarchy
```
Cache Miss → API Call → Store in all applicable layers
Cache Hit → Return immediately + promote to higher layers
```

## 📊 Performance Metrics

### Tracked Statistics
- **Global**: hits, misses, writes, errors, hit rate
- **Per-Layer**: content, file, POI hit/miss rates
- **Health**: Redis connectivity, cache status
- **Timing**: Request duration tracking

### Performance Recommendations
- **< 30% hit rate**: Critical - implement cache warming
- **30-60% hit rate**: Warning - review TTL settings
- **> 90% hit rate**: Excellent - consider increasing TTL
- **> 5% error rate**: Critical - check Redis connectivity

## 🔐 Security & Best Practices

### Security Features
- **Content Normalization**: Strips comments and normalizes whitespace
- **Configurable TTL**: Prevents stale data issues
- **Graceful Degradation**: Works without Redis
- **Error Handling**: Comprehensive error recovery

### Best Practices
- Enable caching in production for significant performance gains
- Monitor hit rates and adjust TTL based on usage patterns
- Use file-based caching for static analysis workflows
- Implement cache warming for frequently used patterns
- Regular cache health monitoring

## 🚨 Troubleshooting

### Common Issues
1. **Low Hit Rate**: Enable cache warming, review TTL settings
2. **Redis Connection**: Check REDIS_URL and Redis server status
3. **High Error Rate**: Verify Redis permissions and connectivity
4. **Memory Usage**: Monitor cache size and set appropriate limits

### Debug Mode
```javascript
// Enable verbose logging
const cacheManager = getCacheManager({ debug: true });
```

### Health Checks
```javascript
const health = await client.cacheHealthCheck();
if (!health.redis) {
    console.error('Redis connectivity issue:', health.error);
}
```

## 📈 Future Enhancements

- [ ] Distributed caching across multiple Redis instances
- [ ] Cache compression for large responses
- [ ] Automatic cache size management
- [ ] Advanced cache warming based on usage patterns
- [ ] Integration with APM tools for deeper monitoring
- [ ] Cache versioning for API changes

## 🤝 Contributing

When modifying the cache system:
1. Maintain backward compatibility
2. Add comprehensive tests
3. Update monitoring capabilities
4. Document configuration changes
5. Ensure graceful degradation

---

*Built with ❤️ for high-performance LLM applications*