/**
 * Cache Monitoring Utility
 * Provides cache performance monitoring and management tools
 */

const { getCacheManager } = require('./cacheManager');
const { getDeepseekClient } = require('./deepseekClient');

class CacheMonitor {
    constructor() {
        this.cacheManager = getCacheManager();
        this.deepSeekClient = getDeepseekClient();
        this.monitoring = false;
        this.monitoringInterval = null;
    }

    /**
     * Start monitoring cache performance
     * @param {number} intervalMs - Monitoring interval in milliseconds
     */
    startMonitoring(intervalMs = 30000) { // Default 30 seconds
        if (this.monitoring) {
            console.log('[CacheMonitor] Already monitoring');
            return;
        }

        this.monitoring = true;
        console.log(`[CacheMonitor] Starting cache monitoring every ${intervalMs/1000}s`);

        this.monitoringInterval = setInterval(async () => {
            await this.logCacheStats();
        }, intervalMs);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (!this.monitoring) {
            return;
        }

        this.monitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('[CacheMonitor] Stopped cache monitoring');
    }

    /**
     * Log current cache statistics
     */
    async logCacheStats() {
        try {
            const stats = this.deepSeekClient.getCacheStats();
            const health = await this.deepSeekClient.cacheHealthCheck();
            
            console.log('\n=== Cache Performance Report ===');
            console.log(`Status: ${health.status}`);
            console.log(`Redis: ${health.redis ? '✅ Connected' : '❌ Disconnected'}`);
            console.log(`Hit Rate: ${stats.hitRate}`);
            console.log(`Total Requests: ${stats.total}`);
            console.log(`Cache Hits: ${stats.hits}`);
            console.log(`Cache Misses: ${stats.misses}`);
            console.log(`Cache Writes: ${stats.writes}`);
            console.log(`Errors: ${stats.errors}`);
            
            if (stats.layerStats) {
                console.log('\nLayer Performance:');
                Object.entries(stats.layerStats).forEach(([layer, layerStats]) => {
                    const layerTotal = layerStats.hits + layerStats.misses;
                    const layerHitRate = layerTotal > 0 ? (layerStats.hits / layerTotal * 100).toFixed(2) : 0;
                    console.log(`  ${layer}: ${layerHitRate}% hit rate (${layerStats.hits}/${layerTotal})`);
                });
            }
            console.log('===============================\n');

            // Alert on poor performance
            if (stats.total > 10) { // Only alert after some usage
                const hitRate = parseFloat(stats.hitRate.replace('%', ''));
                if (hitRate < 50) {
                    console.warn(`⚠️  LOW CACHE HIT RATE: ${stats.hitRate} - Consider cache warming or TTL adjustment`);
                }
            }

            if (stats.errors > 5) {
                console.warn(`⚠️  HIGH ERROR COUNT: ${stats.errors} cache errors detected`);
            }

        } catch (error) {
            console.error('[CacheMonitor] Error logging stats:', error.message);
        }
    }

    /**
     * Generate cache performance report
     * @returns {Promise<object>} - Detailed performance report
     */
    async generateReport() {
        try {
            const stats = this.deepSeekClient.getCacheStats();
            const health = await this.deepSeekClient.cacheHealthCheck();
            
            const report = {
                timestamp: new Date().toISOString(),
                health,
                performance: {
                    ...stats,
                    recommendations: []
                }
            };

            // Add performance recommendations
            if (stats.total > 0) {
                const hitRate = parseFloat(stats.hitRate.replace('%', ''));
                
                if (hitRate < 30) {
                    report.performance.recommendations.push({
                        type: 'critical',
                        message: 'Very low hit rate. Consider implementing cache warming for common patterns.'
                    });
                } else if (hitRate < 60) {
                    report.performance.recommendations.push({
                        type: 'warning',
                        message: 'Low hit rate. Review cache TTL settings or add more specific caching patterns.'
                    });
                } else if (hitRate > 90) {
                    report.performance.recommendations.push({
                        type: 'info',
                        message: 'Excellent cache performance. Consider increasing TTL for even better efficiency.'
                    });
                }

                if (stats.errors > stats.total * 0.05) { // More than 5% error rate
                    report.performance.recommendations.push({
                        type: 'critical',
                        message: 'High error rate detected. Check Redis connectivity and configuration.'
                    });
                }
            }

            return report;
        } catch (error) {
            console.error('[CacheMonitor] Error generating report:', error.message);
            return {
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * Clear cache and reset statistics
     */
    async resetCache() {
        try {
            console.log('[CacheMonitor] Clearing all cache entries...');
            const cleared = await this.deepSeekClient.clearCache();
            
            console.log('[CacheMonitor] Resetting cache statistics...');
            this.cacheManager.resetStats();
            
            console.log(`[CacheMonitor] Cache reset complete. Cleared ${cleared} entries.`);
            return cleared;
        } catch (error) {
            console.error('[CacheMonitor] Error resetting cache:', error.message);
            throw error;
        }
    }

    /**
     * Optimize cache by warming common patterns
     */
    async optimizeCache() {
        try {
            console.log('[CacheMonitor] Starting cache optimization...');
            
            const commonPatterns = [
                'analyze_function',
                'extract_dependencies',
                'security_review',
                'code_quality',
                'performance_analysis',
                'error_detection',
                'refactoring_suggestions'
            ];

            await this.deepSeekClient.warmCache(commonPatterns);
            console.log('[CacheMonitor] Cache optimization completed');
            
            return commonPatterns.length;
        } catch (error) {
            console.error('[CacheMonitor] Error optimizing cache:', error.message);
            throw error;
        }
    }
}

// CLI interface for cache monitoring
if (require.main === module) {
    const monitor = new CacheMonitor();
    const command = process.argv[2];

    switch (command) {
        case 'start':
            const interval = parseInt(process.argv[3]) || 30000;
            monitor.startMonitoring(interval);
            console.log('Press Ctrl+C to stop monitoring');
            process.on('SIGINT', () => {
                monitor.stopMonitoring();
                process.exit(0);
            });
            break;

        case 'stats':
            monitor.logCacheStats()
                .then(() => process.exit(0))
                .catch(err => {
                    console.error('Error:', err.message);
                    process.exit(1);
                });
            break;

        case 'report':
            monitor.generateReport()
                .then(report => {
                    console.log(JSON.stringify(report, null, 2));
                    process.exit(0);
                })
                .catch(err => {
                    console.error('Error:', err.message);
                    process.exit(1);
                });
            break;

        case 'reset':
            monitor.resetCache()
                .then(() => process.exit(0))
                .catch(err => {
                    console.error('Error:', err.message);
                    process.exit(1);
                });
            break;

        case 'optimize':
            monitor.optimizeCache()
                .then(() => process.exit(0))
                .catch(err => {
                    console.error('Error:', err.message);
                    process.exit(1);
                });
            break;

        default:
            console.log('Cache Monitor Usage:');
            console.log('  node cacheMonitor.js start [interval_ms]  - Start monitoring');
            console.log('  node cacheMonitor.js stats                - Show current stats');
            console.log('  node cacheMonitor.js report              - Generate detailed report');
            console.log('  node cacheMonitor.js reset               - Clear cache and reset stats');
            console.log('  node cacheMonitor.js optimize            - Warm cache with common patterns');
            process.exit(1);
    }
}

module.exports = { CacheMonitor };