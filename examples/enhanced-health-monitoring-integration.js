/**
 * Enhanced Health Monitoring Integration Example
 * 
 * This example demonstrates how to properly integrate the enhanced health monitoring
 * system with real connectivity tests for all service dependencies.
 */

const { HealthMonitor } = require('../src/utils/healthMonitor');
const { DatabaseManager } = require('../src/utils/sqliteDb');
const neo4jDriver = require('../src/utils/neo4jDriver');
const cacheClient = require('../src/utils/cacheClient');
const { getInstance: getQueueManagerInstance } = require('../src/utils/queueManager');
const { WorkerPoolManager } = require('../src/utils/workerPoolManager');

const {
    createNeo4jHealthCheck,
    createRedisHealthCheck,
    createSQLiteHealthCheck,
    createQueueManagerHealthCheck,
    createWorkerPoolHealthCheck
} = require('../src/utils/dependencyHealthChecks');

class EnhancedHealthMonitoringExample {
    constructor() {
        this.healthMonitor = null;
        this.dbManager = null;
        this.queueManager = null;
        this.workerPoolManager = null;
        
        this.dependencies = {
            neo4j: null,
            redis: null,
            sqlite: null,
            queueManager: null,
            workerPool: null
        };
    }

    /**
     * Initialize all components and health monitoring
     */
    async initialize() {
        console.log('🏥 Initializing Enhanced Health Monitoring System...');

        // Initialize core components
        await this.initializeComponents();
        
        // Initialize health monitor with enhanced configuration
        this.initializeHealthMonitor();
        
        // Register all dependencies with enhanced health checks
        await this.registerDependencies();
        
        console.log('✅ Enhanced Health Monitoring System initialized successfully!');
    }

    /**
     * Initialize core application components
     */
    async initializeComponents() {
        console.log('🔧 Initializing core components...');

        // Initialize database manager
        this.dbManager = new DatabaseManager('./data/health_test.db');
        await this.dbManager.initializeDb();
        console.log('✅ Database manager initialized');

        // Initialize queue manager
        this.queueManager = getQueueManagerInstance();
        await this.queueManager.connect();
        console.log('✅ Queue manager initialized');

        // Initialize worker pool manager
        this.workerPoolManager = new WorkerPoolManager({
            environment: 'development',
            maxGlobalConcurrency: 50
        });
        console.log('✅ Worker pool manager initialized');
    }

    /**
     * Initialize health monitor with enhanced settings
     */
    initializeHealthMonitor() {
        this.healthMonitor = new HealthMonitor({
            // Enhanced intervals for more responsive monitoring
            globalHealthInterval: 30000,     // 30 seconds
            workerHealthInterval: 45000,     // 45 seconds  
            dependencyHealthInterval: 60000,  // 1 minute
            
            // Stricter thresholds for better reliability
            unhealthyThreshold: 2,           // Mark unhealthy after 2 consecutive failures
            recoveryThreshold: 3,            // Mark healthy after 3 consecutive successes
            
            // Reasonable timeouts for connectivity tests
            healthCheckTimeout: 15000,       // 15 seconds for dependency checks
            
            // Enable alerts and auto-recovery
            enableAlerts: true,
            alertCooldown: 180000,           // 3 minutes between duplicate alerts
            enableAutoRecovery: true,
            maxRecoveryAttempts: 3
        });

        console.log('🏥 Health monitor initialized with enhanced settings');
    }

    /**
     * Register all dependencies with proper health check functions
     */
    async registerDependencies() {
        console.log('📝 Registering dependencies with enhanced health checks...');

        // Register Neo4j with real session connectivity test
        this.healthMonitor.registerDependency(
            'neo4j',
            createNeo4jHealthCheck(neo4jDriver),
            async () => {
                console.log('🔄 Attempting Neo4j recovery...');
                // Recovery could involve recreating driver connection
                try {
                    await neo4jDriver.verifyConnectivity();
                    console.log('✅ Neo4j recovery successful');
                } catch (error) {
                    console.error('❌ Neo4j recovery failed:', error.message);
                    throw error;
                }
            }
        );
        console.log('✅ Neo4j dependency registered');

        // Register Redis with ping and set/get tests
        this.healthMonitor.registerDependency(
            'redis',
            createRedisHealthCheck(cacheClient),
            async () => {
                console.log('🔄 Attempting Redis recovery...');
                try {
                    // Close and recreate Redis connection
                    await cacheClient.closeCacheClient();
                    const newClient = cacheClient.getCacheClient();
                    await newClient.ping();
                    console.log('✅ Redis recovery successful');
                } catch (error) {
                    console.error('❌ Redis recovery failed:', error.message);
                    throw error;
                }
            }
        );
        console.log('✅ Redis dependency registered');

        // Register SQLite with write/read transaction tests
        this.healthMonitor.registerDependency(
            'sqlite',
            createSQLiteHealthCheck(this.dbManager),
            async () => {
                console.log('🔄 Attempting SQLite recovery...');
                try {
                    // Close and reopen database connection
                    this.dbManager.close();
                    await this.dbManager.initializeDb();
                    console.log('✅ SQLite recovery successful');
                } catch (error) {
                    console.error('❌ SQLite recovery failed:', error.message);
                    throw error;
                }
            }
        );
        console.log('✅ SQLite dependency registered');

        // Register Queue Manager with connection pool tests
        this.healthMonitor.registerDependency(
            'queue_manager',
            createQueueManagerHealthCheck(this.queueManager),
            async () => {
                console.log('🔄 Attempting Queue Manager recovery...');
                try {
                    // Attempt to reconnect queue manager
                    await this.queueManager.disconnect();
                    await this.queueManager.connect();
                    console.log('✅ Queue Manager recovery successful');
                } catch (error) {
                    console.error('❌ Queue Manager recovery failed:', error.message);
                    throw error;
                }
            }
        );
        console.log('✅ Queue Manager dependency registered');

        // Register Worker Pool Manager with circuit breaker tests
        this.healthMonitor.registerDependency(
            'worker_pool',
            createWorkerPoolHealthCheck(this.workerPoolManager)
            // No recovery function - worker pool manager handles its own recovery
        );
        console.log('✅ Worker Pool Manager dependency registered');
    }

    /**
     * Start the health monitoring system
     */
    async start() {
        console.log('🚀 Starting enhanced health monitoring...');

        // Set up event listeners for health events
        this.setupHealthEventListeners();

        // Start health monitoring
        this.healthMonitor.start();

        console.log('✅ Enhanced health monitoring started successfully!');
        console.log('📊 Health status will be checked every 30-60 seconds');
        console.log('🔔 Alerts will be generated for unhealthy dependencies');
        console.log('🔄 Auto-recovery will attempt to fix dependency issues');
    }

    /**
     * Set up event listeners for health monitoring events
     */
    setupHealthEventListeners() {
        // Global health check events
        this.healthMonitor.on('globalHealthCheck', (results) => {
            const status = results.dependencies.healthy ? '✅' : '❌';
            console.log(`🏥 [Health Check] Global: ${status} | System: ${results.system.healthy ? '✅' : '❌'} | Worker Pool: ${results.workerPool.healthy ? '✅' : '❌'} | Dependencies: ${results.dependencies.healthyDependencies}/${results.dependencies.totalDependencies}`);
            
            // Log dependency details if any are unhealthy
            if (!results.dependencies.healthy) {
                console.warn('⚠️ [Health Check] Unhealthy dependencies detected:');
                results.dependencies.failureDetails?.forEach(failure => {
                    console.warn(`   - ${failure.name}: ${failure.error} (${failure.failures} consecutive failures)`);
                });
            }
        });

        // Dependency health events
        this.healthMonitor.on('dependencyHealth', (event) => {
            if (!event.healthy) {
                console.warn(`⚠️ [Dependency Health] ${event.name} is unhealthy: ${event.error}`);
                if (event.details) {
                    console.warn(`   Details: ${JSON.stringify(event.details, null, 2)}`);
                }
            } else {
                console.log(`✅ [Dependency Health] ${event.name} is healthy`);
                if (event.details?.validationType) {
                    console.log(`   Validation: ${event.details.validationType}`);
                }
            }
        });

        // Health alert events
        this.healthMonitor.on('alert', (alert) => {
            const emoji = alert.level === 'critical' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
            console.warn(`${emoji} [Health Alert] ${alert.level.toUpperCase()}: ${alert.message}`);
            
            if (alert.details) {
                console.warn(`   Details: ${JSON.stringify(alert.details, null, 2)}`);
            }
        });

        // Health monitor lifecycle events
        this.healthMonitor.on('started', () => {
            console.log('🚀 [Health Monitor] Monitoring started');
        });

        this.healthMonitor.on('stopped', () => {
            console.log('🛑 [Health Monitor] Monitoring stopped');
        });
    }

    /**
     * Get comprehensive health status
     */
    async getHealthStatus() {
        const status = this.healthMonitor.getHealthStatus();
        
        console.log('\\n📋 Health Status Report:');
        console.log('==========================');
        console.log(`Overall Health: ${status.summary.overallHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
        console.log(`Workers: ${status.summary.healthyWorkers}/${status.summary.totalWorkers} healthy`);
        console.log(`Dependencies: ${status.summary.healthyDependencies}/${status.summary.totalDependencies} healthy`);
        
        if (status.dependencies.length > 0) {
            console.log('\\nDependency Details:');
            status.dependencies.forEach(dep => {
                const status_emoji = dep.healthy ? '✅' : '❌';
                console.log(`  ${status_emoji} ${dep.name}`);
                if (!dep.healthy && dep.lastError) {
                    console.log(`     Error: ${dep.lastError}`);
                    console.log(`     Failures: ${dep.consecutiveFailures}`);
                }
                if (dep.details && Object.keys(dep.details).length > 0) {
                    console.log(`     Details: ${JSON.stringify(dep.details, null, 6)}`);
                }
            });
        }
        
        console.log('\\nMetrics:');
        const metrics = this.healthMonitor.getMetrics();
        console.log(`  Uptime: ${Math.floor(metrics.uptime / 1000)}s`);
        console.log(`  Total Checks: ${metrics.totalChecks}`);
        console.log(`  Success Rate: ${metrics.successRate.toFixed(1)}%`);
        console.log(`  Alerts Sent: ${metrics.alertsSent}`);
        console.log(`  Recovery Attempts: ${metrics.recoveryAttempts}`);
        console.log('==========================\\n');
        
        return status;
    }

    /**
     * Perform manual health check
     */
    async performManualHealthCheck() {
        console.log('🔍 Performing manual health check...');
        
        const healthResult = await this.healthMonitor.healthCheck();
        
        console.log(`\\n🏥 Manual Health Check Result: ${healthResult.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
        if (!healthResult.healthy && healthResult.error) {
            console.error(`Error: ${healthResult.error}`);
        }
        
        return healthResult;
    }

    /**
     * Simulate dependency failure for testing
     */
    async simulateDependencyFailure(dependencyName) {
        console.log(`🧪 Simulating ${dependencyName} failure for testing...`);
        
        // Temporarily replace the health check with a failing one
        const originalDependency = this.healthMonitor.components.dependencies.get(dependencyName);
        
        if (originalDependency) {
            const failingHealthCheck = async () => ({
                healthy: false,
                error: `Simulated ${dependencyName} failure for testing`,
                details: { simulated: true, timestamp: new Date().toISOString() }
            });
            
            this.healthMonitor.components.dependencies.set(dependencyName, {
                ...originalDependency,
                healthCheck: failingHealthCheck
            });
            
            console.log(`❌ Simulated failure activated for ${dependencyName}`);
            console.log('Wait for next health check cycle to see the effect...');
            
            // Restore after 2 minutes
            setTimeout(() => {
                this.healthMonitor.components.dependencies.set(dependencyName, originalDependency);
                console.log(`✅ Restored normal health check for ${dependencyName}`);
            }, 120000);
        } else {
            console.error(`❌ Dependency '${dependencyName}' not found`);
        }
    }

    /**
     * Stop health monitoring and clean up
     */
    async stop() {
        console.log('🛑 Stopping enhanced health monitoring...');

        if (this.healthMonitor) {
            await this.healthMonitor.shutdown();
        }

        // Clean up components
        if (this.dbManager) {
            this.dbManager.close();
        }

        if (this.queueManager) {
            await this.queueManager.disconnect();
        }

        if (this.workerPoolManager) {
            await this.workerPoolManager.shutdown();
        }

        console.log('✅ Enhanced health monitoring stopped and cleaned up');
    }
}

// Example usage
async function runExample() {
    const healthSystem = new EnhancedHealthMonitoringExample();
    
    try {
        // Initialize and start the system
        await healthSystem.initialize();
        await healthSystem.start();
        
        // Wait a bit for initial health checks
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Get initial health status
        await healthSystem.getHealthStatus();
        
        // Perform manual health check
        await healthSystem.performManualHealthCheck();
        
        // Demonstrate failure simulation (uncomment to test)
        // await healthSystem.simulateDependencyFailure('redis');
        
        // Keep running for demonstration (in real app, this would run continuously)
        console.log('🔄 Health monitoring running... (Ctrl+C to stop)');
        console.log('💡 Check logs every 30-60 seconds for health status updates');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\\n🛑 Received shutdown signal...');
            await healthSystem.stop();
            process.exit(0);
        });
        
        // Keep the example running
        setInterval(async () => {
            await healthSystem.getHealthStatus();
        }, 300000); // Status report every 5 minutes
        
    } catch (error) {
        console.error('❌ Health monitoring example failed:', error);
        await healthSystem.stop();
        process.exit(1);
    }
}

// Export for use in other modules
module.exports = { EnhancedHealthMonitoringExample };

// Run example if called directly
if (require.main === module) {
    runExample();
}