/**
 * Resource Management System
 * 
 * This module handles:
 * - Graceful shutdown coordination
 * - Resource cleanup registration
 * - Memory monitoring and limits
 * - Process signal handling
 * - Health check coordination
 */

const config = require('../config/secure');

class ResourceManager {
    constructor() {
        this.resources = new Map();
        this.shutdownCallbacks = [];
        this.isShuttingDown = false;
        this.shutdownTimeout = 30000; // 30 seconds
        this.memoryLimit = 2 * 1024 * 1024 * 1024; // 2GB
        this.memoryCheckInterval = 30000; // 30 seconds
        this.stats = {
            registeredResources: 0,
            shutdownsInitiated: 0,
            gracefulShutdowns: 0,
            forcedShutdowns: 0,
            memoryWarnings: 0,
            startTime: new Date()
        };
        
        this.setupSignalHandlers();
        this.startMemoryMonitoring();
    }

    /**
     * Register a resource for cleanup during shutdown
     * @param {string} name - Resource identifier
     * @param {Object} resource - Resource object with cleanup method
     * @param {Function} cleanupFn - Optional custom cleanup function
     */
    register(name, resource, cleanupFn = null) {
        if (this.isShuttingDown) {
            console.warn(`⚠️  Cannot register resource '${name}' during shutdown`);
            return () => {};
        }

        const cleanup = cleanupFn || this.getDefaultCleanupFunction(resource);
        
        this.resources.set(name, {
            resource,
            cleanup,
            registeredAt: new Date(),
            cleaned: false
        });

        this.stats.registeredResources++;
        console.log(`📝 Resource '${name}' registered for cleanup`);

        // Return deregistration function
        return () => this.deregister(name);
    }

    /**
     * Deregister a resource
     * @param {string} name - Resource identifier
     */
    deregister(name) {
        if (this.resources.has(name)) {
            this.resources.delete(name);
            console.log(`📝 Resource '${name}' deregistered`);
        }
    }

    /**
     * Get default cleanup function for common resource types
     * @param {Object} resource - Resource object
     */
    getDefaultCleanupFunction(resource) {
        if (typeof resource.close === 'function') {
            return async () => await resource.close();
        }
        if (typeof resource.end === 'function') {
            return async () => await resource.end();
        }
        if (typeof resource.disconnect === 'function') {
            return async () => await resource.disconnect();
        }
        if (typeof resource.quit === 'function') {
            return async () => await resource.quit();
        }
        if (typeof resource.destroy === 'function') {
            return async () => await resource.destroy();
        }
        
        return async () => {
            console.warn(`⚠️  No cleanup method found for resource`);
        };
    }

    /**
     * Register a shutdown callback
     * @param {Function} callback - Function to call during shutdown
     * @param {number} priority - Higher numbers run first (default: 0)
     */
    onShutdown(callback, priority = 0) {
        this.shutdownCallbacks.push({ callback, priority });
        this.shutdownCallbacks.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Setup process signal handlers for graceful shutdown
     */
    setupSignalHandlers() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR1', 'SIGUSR2'];
        
        signals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`🛑 Received ${signal}. Starting graceful shutdown...`);
                await this.shutdown(signal);
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            console.error('💥 Uncaught Exception:', error);
            await this.shutdown('UNCAUGHT_EXCEPTION', 1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', async (reason, promise) => {
            console.error('💥 Unhandled Promise Rejection:', reason);
            console.error('Promise:', promise);
            await this.shutdown('UNHANDLED_REJECTION', 1);
        });

        // Handle warnings
        process.on('warning', (warning) => {
            console.warn('⚠️  Process Warning:', warning.name, warning.message);
            if (warning.stack) {
                console.warn(warning.stack);
            }
        });
    }

    /**
     * Start memory monitoring
     */
    startMemoryMonitoring() {
        const checkMemory = () => {
            if (this.isShuttingDown) return;

            const usage = process.memoryUsage();
            const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
            const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
            const externalMB = Math.round(usage.external / 1024 / 1024);

            // Check if memory usage is approaching limits
            if (usage.heapUsed > this.memoryLimit * 0.8) {
                this.stats.memoryWarnings++;
                console.warn(`⚠️  High memory usage: ${usedMB}MB heap, ${totalMB}MB total, ${externalMB}MB external`);
                
                // Trigger garbage collection if available
                if (global.gc) {
                    global.gc();
                    console.log('🗑️  Garbage collection triggered');
                }
            }

            // Force shutdown if memory limit exceeded
            if (usage.heapUsed > this.memoryLimit) {
                console.error(`💥 Memory limit exceeded: ${usedMB}MB > ${Math.round(this.memoryLimit / 1024 / 1024)}MB`);
                this.shutdown('MEMORY_LIMIT_EXCEEDED', 1);
                return;
            }

            setTimeout(checkMemory, this.memoryCheckInterval);
        };

        setTimeout(checkMemory, this.memoryCheckInterval);
    }

    /**
     * Get current memory usage information
     */
    getMemoryInfo() {
        const usage = process.memoryUsage();
        return {
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
            external: Math.round(usage.external / 1024 / 1024), // MB
            rss: Math.round(usage.rss / 1024 / 1024), // MB
            heapUsedPercent: Math.round((usage.heapUsed / this.memoryLimit) * 100),
            memoryLimit: Math.round(this.memoryLimit / 1024 / 1024) // MB
        };
    }

    /**
     * Perform graceful shutdown
     * @param {string} signal - Signal that triggered shutdown
     * @param {number} exitCode - Exit code (default: 0)
     */
    async shutdown(signal = 'MANUAL', exitCode = 0) {
        if (this.isShuttingDown) {
            console.log('🔄 Shutdown already in progress...');
            return;
        }

        this.isShuttingDown = true;
        this.stats.shutdownsInitiated++;
        
        console.log(`🛑 Initiating graceful shutdown (signal: ${signal})`);

        const shutdownPromise = this.performShutdown(signal);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Shutdown timeout exceeded (${this.shutdownTimeout}ms)`));
            }, this.shutdownTimeout);
        });

        try {
            await Promise.race([shutdownPromise, timeoutPromise]);
            this.stats.gracefulShutdowns++;
            console.log('✅ Graceful shutdown completed successfully');
        } catch (error) {
            this.stats.forcedShutdowns++;
            console.error('❌ Shutdown timeout or error:', error.message);
            console.log('🔥 Forcing immediate shutdown...');
        } finally {
            process.exit(exitCode);
        }
    }

    /**
     * Execute shutdown sequence
     * @param {string} signal - Signal that triggered shutdown
     */
    async performShutdown(signal) {
        const startTime = Date.now();

        try {
            // 1. Execute shutdown callbacks first
            console.log('🔄 Running shutdown callbacks...');
            for (const { callback, priority } of this.shutdownCallbacks) {
                try {
                    await callback(signal);
                } catch (error) {
                    console.error('❌ Shutdown callback failed:', error);
                }
            }

            // 2. Cleanup registered resources
            console.log(`🔄 Cleaning up ${this.resources.size} registered resources...`);
            
            const cleanupPromises = Array.from(this.resources.entries()).map(async ([name, { resource, cleanup }]) => {
                try {
                    console.log(`🧹 Cleaning up resource: ${name}`);
                    await cleanup();
                    this.resources.get(name).cleaned = true;
                    console.log(`✅ Resource '${name}' cleaned up`);
                } catch (error) {
                    console.error(`❌ Failed to cleanup resource '${name}':`, error);
                }
            });

            // Wait for all cleanups with individual timeouts
            await Promise.allSettled(cleanupPromises);

            // 3. Final system cleanup
            this.performFinalCleanup();

            const duration = Date.now() - startTime;
            console.log(`✅ Shutdown sequence completed in ${duration}ms`);

        } catch (error) {
            console.error('❌ Error during shutdown sequence:', error);
            throw error;
        }
    }

    /**
     * Perform final system cleanup
     */
    performFinalCleanup() {
        try {
            // Clear all timers and intervals
            const maxId = setTimeout(() => {}, 0);
            for (let id = 0; id <= maxId; id++) {
                clearTimeout(id);
                clearInterval(id);
            }

            // Clear require cache for clean exit
            if (process.env.NODE_ENV !== 'production') {
                Object.keys(require.cache).forEach(key => {
                    delete require.cache[key];
                });
            }

            console.log('🧹 Final system cleanup completed');
        } catch (error) {
            console.error('❌ Error during final cleanup:', error);
        }
    }

    /**
     * Get resource manager statistics
     */
    getStats() {
        const uptime = new Date() - this.stats.startTime;
        
        return {
            ...this.stats,
            uptime: Math.floor(uptime / 1000), // seconds
            activeResources: this.resources.size,
            shutdownCallbacks: this.shutdownCallbacks.length,
            isShuttingDown: this.isShuttingDown,
            memoryInfo: this.getMemoryInfo()
        };
    }

    /**
     * Health check for resource manager
     */
    async healthCheck() {
        try {
            const memoryInfo = this.getMemoryInfo();
            const isMemoryHealthy = memoryInfo.heapUsedPercent < 80;
            
            return {
                healthy: !this.isShuttingDown && isMemoryHealthy,
                shutting_down: this.isShuttingDown,
                memory: memoryInfo,
                resources: this.resources.size,
                stats: this.getStats(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Force cleanup of all resources (emergency use)
     */
    async forceCleanup() {
        console.log('🚨 Emergency resource cleanup initiated');
        
        for (const [name, { cleanup }] of this.resources) {
            try {
                await Promise.race([
                    cleanup(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Cleanup timeout')), 5000)
                    )
                ]);
                console.log(`✅ Emergency cleanup: ${name}`);
            } catch (error) {
                console.error(`❌ Emergency cleanup failed: ${name}`, error);
            }
        }
    }

    /**
     * Set memory limit
     * @param {number} limitMB - Memory limit in MB
     */
    setMemoryLimit(limitMB) {
        this.memoryLimit = limitMB * 1024 * 1024;
        console.log(`📏 Memory limit set to ${limitMB}MB`);
    }

    /**
     * Set shutdown timeout
     * @param {number} timeoutMs - Timeout in milliseconds
     */
    setShutdownTimeout(timeoutMs) {
        this.shutdownTimeout = timeoutMs;
        console.log(`⏱️  Shutdown timeout set to ${timeoutMs}ms`);
    }
}

// Export singleton instance
module.exports = new ResourceManager();