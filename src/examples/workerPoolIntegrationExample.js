/**
 * Worker Pool Integration Example
 * 
 * Demonstrates how to integrate all the worker pool management components:
 * - WorkerPoolManager
 * - SystemMonitor  
 * - HealthMonitor
 * - ManagedWorker
 * - Configuration
 */

const { WorkerPoolManager } = require('../utils/workerPoolManager');
const { SystemMonitor } = require('../utils/systemMonitor');
const { HealthMonitor } = require('../utils/healthMonitor');
const { WorkerPoolConfig } = require('../config/workerPoolConfig');
const FileAnalysisWorker = require('../workers/fileAnalysisWorker');

class IntegratedWorkerPoolSystem {
    constructor(dependencies = {}) {
        this.dependencies = dependencies;
        this.components = {};
        this.isInitialized = false;
        this.isShuttingDown = false;
        
        console.log('🚀 Initializing Integrated Worker Pool System...');
    }

    /**
     * Initialize the complete system
     */
    async initialize() {
        if (this.isInitialized) {
            throw new Error('System is already initialized');
        }

        try {
            // 1. Load configuration
            console.log('⚙️  Loading configuration...');
            this.components.config = new WorkerPoolConfig(process.env.NODE_ENV);
            
            if (!this.components.config.validateConfig()) {
                throw new Error('Configuration validation failed');
            }

            // 2. Initialize SystemMonitor
            console.log('📊 Initializing SystemMonitor...');
            this.components.systemMonitor = new SystemMonitor({
                monitoringInterval: this.components.config.getConfig().monitoring.systemMonitoring.interval,
                reportingInterval: this.components.config.getConfig().monitoring.systemMonitoring.reportInterval,
                cpuWarningThreshold: this.components.config.getConfig().monitoring.systemMonitoring.cpuWarningThreshold,
                cpuCriticalThreshold: this.components.config.getConfig().monitoring.systemMonitoring.cpuCriticalThreshold,
                memoryWarningThreshold: this.components.config.getConfig().monitoring.systemMonitoring.memoryWarningThreshold,
                memoryCriticalThreshold: this.components.config.getConfig().monitoring.systemMonitoring.memoryCriticalThreshold,
                enablePredictiveScaling: this.components.config.getConfig().monitoring.systemMonitoring.enablePredictiveScaling
            });

            // 3. Initialize WorkerPoolManager
            console.log('🎯 Initializing WorkerPoolManager...');
            this.components.workerPoolManager = new WorkerPoolManager({
                maxGlobalConcurrency: this.components.config.getConfig().global.maxGlobalConcurrency,
                minWorkerConcurrency: this.components.config.getConfig().global.minWorkerConcurrency,
                maxWorkerConcurrency: this.components.config.getConfig().global.maxWorkerConcurrency,
                cpuThreshold: this.components.config.getConfig().global.cpuThreshold,
                memoryThreshold: this.components.config.getConfig().global.memoryThreshold,
                scaleUpFactor: this.components.config.getConfig().global.scaleUpFactor,
                scaleDownFactor: this.components.config.getConfig().global.scaleDownFactor,
                adaptiveInterval: this.components.config.getConfig().global.adaptiveInterval,
                rateLimits: this.components.config.getConfig().rateLimits,
                workerPriorities: this.extractWorkerPriorities(),
                environment: this.components.config.environment
            });

            // 4. Initialize HealthMonitor
            console.log('🏥 Initializing HealthMonitor...');
            this.components.healthMonitor = new HealthMonitor({
                enabled: this.components.config.getConfig().healthChecks.enabled,
                globalHealthInterval: this.components.config.getConfig().healthChecks.global.interval,
                workerHealthInterval: this.components.config.getConfig().healthChecks.workers.interval,
                dependencyHealthInterval: this.components.config.getConfig().healthChecks.dependencies.interval,
                healthCheckTimeout: this.components.config.getConfig().healthChecks.global.timeout,
                unhealthyThreshold: this.components.config.getConfig().healthChecks.workers.failureThreshold,
                recoveryThreshold: this.components.config.getConfig().healthChecks.workers.recoveryThreshold,
                enableAlerts: this.components.config.getConfig().healthChecks.alerts.enabled,
                alertCooldown: this.components.config.getConfig().healthChecks.alerts.cooldown,
                enableAutoRecovery: true
            });

            // 5. Register components with each other
            console.log('🔗 Connecting system components...');
            this.connectComponents();

            // 6. Register dependencies for health monitoring
            console.log('📝 Registering dependencies...');
            this.registerDependencies();

            // 7. Initialize workers
            console.log('👷 Initializing workers...');
            await this.initializeWorkers();

            // 8. Start monitoring systems
            console.log('🚀 Starting monitoring systems...');
            this.components.systemMonitor.start();
            this.components.healthMonitor.start();

            // 9. Setup event handlers
            this.setupEventHandlers();

            this.isInitialized = true;
            console.log('✅ Integrated Worker Pool System initialized successfully');

            // Display system status
            this.displaySystemStatus();

        } catch (error) {
            console.error('❌ Failed to initialize Integrated Worker Pool System:', error);
            await this.cleanup();
            throw error;
        }
    }

    /**
     * Extract worker priorities from configuration
     */
    extractWorkerPriorities() {
        const priorities = {};
        const workerConfigs = this.components.config.getConfig().workers;
        
        for (const [workerType, config] of Object.entries(workerConfigs)) {
            if (config.priority) {
                priorities[workerType] = config.priority;
            }
        }
        
        return priorities;
    }

    /**
     * Connect system components
     */
    connectComponents() {
        // Register WorkerPoolManager with HealthMonitor
        this.components.healthMonitor.registerWorkerPoolManager(this.components.workerPoolManager);
        
        // Register SystemMonitor with HealthMonitor
        this.components.healthMonitor.registerSystemMonitor(this.components.systemMonitor);
        
        // Connect WorkerPoolManager with SystemMonitor for resource-aware scaling
        this.components.systemMonitor.on('alert', (alert) => {
            this.handleSystemAlert(alert);
        });
        
        this.components.systemMonitor.on('predictions', (predictions) => {
            this.handleSystemPredictions(predictions);
        });
    }

    /**
     * Register dependencies for health monitoring
     */
    registerDependencies() {
        // Register database dependency
        if (this.dependencies.dbManager) {
            this.components.healthMonitor.registerDependency(
                'database',
                async () => {
                    try {
                        const db = this.dependencies.dbManager.getDb();
                        const result = db.prepare('SELECT 1 as test').get();
                        return result.test === 1;
                    } catch (error) {
                        return { healthy: false, error: error.message };
                    }
                },
                async () => {
                    console.log('🔄 Attempting database recovery...');
                    // Database recovery logic would go here
                }
            );
        }

        // Register cache dependency
        if (this.dependencies.cacheClient) {
            this.components.healthMonitor.registerDependency(
                'cache',
                async () => {
                    try {
                        await this.dependencies.cacheClient.ping();
                        return true;
                    } catch (error) {
                        return { healthy: false, error: error.message };
                    }
                },
                async () => {
                    console.log('🔄 Attempting cache recovery...');
                    // Cache recovery logic would go here
                }
            );
        }

        // Register LLM API dependency
        if (this.dependencies.llmClient) {
            this.components.healthMonitor.registerDependency(
                'llm_api',
                async () => {
                    try {
                        // Simple health check query
                        const response = await this.dependencies.llmClient.query('Hello');
                        return response !== null;
                    } catch (error) {
                        return { healthy: false, error: error.message };
                    }
                },
                async () => {
                    console.log('🔄 Attempting LLM API recovery...');
                    // LLM API recovery logic would go here
                }
            );
        }

        // Register queue manager dependency
        if (this.dependencies.queueManager) {
            this.components.healthMonitor.registerDependency(
                'queue_manager',
                async () => {
                    try {
                        const isHealthy = await this.dependencies.queueManager.isHealthy();
                        return isHealthy;
                    } catch (error) {
                        return { healthy: false, error: error.message };
                    }
                },
                async () => {
                    console.log('🔄 Attempting queue manager recovery...');
                    // Queue manager recovery logic would go here
                }
            );
        }
    }

    /**
     * Initialize workers
     */
    async initializeWorkers() {
        this.components.workers = {};

        // Initialize FileAnalysisWorker
        if (this.dependencies.queueManager && 
            this.dependencies.dbManager && 
            this.dependencies.cacheClient && 
            this.dependencies.llmClient) {
            
            console.log('👷 Initializing FileAnalysisWorker...');
            this.components.workers.fileAnalysis = new FileAnalysisWorker(
                this.dependencies.queueManager,
                this.dependencies.dbManager,
                this.dependencies.cacheClient,
                this.dependencies.llmClient,
                this.components.workerPoolManager,
                this.components.config.getWorkerConfig('file-analysis')
            );
        }

        // Add other workers here as they are converted to ManagedWorker
        // this.components.workers.validation = new ValidationWorker(...);
        // this.components.workers.graphIngestion = new GraphIngestionWorker(...);
        // etc.
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // System alert handlers
        this.components.systemMonitor.on('alert', (alert) => {
            console.log(`📊 SystemMonitor Alert: ${alert.type} ${alert.level} - ${alert.value.toFixed(1)}%`);
        });

        // WorkerPoolManager event handlers
        this.components.workerPoolManager.on('workerScaled', (event) => {
            console.log(`🔄 Worker '${event.worker}' scaled ${event.direction}: ${event.oldConcurrency} → ${event.newConcurrency} (${event.reason})`);
        });

        this.components.workerPoolManager.on('resourceScaling', (event) => {
            console.log(`📊 Resource-based scaling: ${event.direction} (CPU: ${event.cpuUsage?.toFixed(1)}%, Memory: ${event.memoryUsage?.toFixed(1)}%)`);
        });

        // HealthMonitor event handlers
        this.components.healthMonitor.on('alert', (alert) => {
            console.log(`🏥 HealthMonitor Alert: ${alert.type} ${alert.level} - ${alert.message}`);
        });

        this.components.healthMonitor.on('workerHealth', (event) => {
            if (!event.healthy) {
                console.warn(`⚠️  Worker '${event.workerType}' unhealthy: ${event.issues.join(', ')}`);
            }
        });

        // Process shutdown handlers
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught Exception:', error);
            this.gracefulShutdown('UNCAUGHT_EXCEPTION');
        });
        process.on('unhandledRejection', (reason) => {
            console.error('💥 Unhandled Rejection:', reason);
            this.gracefulShutdown('UNHANDLED_REJECTION');
        });
    }

    /**
     * Handle system alerts
     */
    handleSystemAlert(alert) {
        if (alert.level === 'critical') {
            // Emergency scale down if system is under severe pressure
            if (alert.type === 'cpu' && alert.value > 90) {
                console.log('🚨 Emergency CPU pressure - scaling down all workers');
                // The WorkerPoolManager will handle this automatically through resource monitoring
            }
            
            if (alert.type === 'memory' && alert.value > 95) {
                console.log('🚨 Emergency memory pressure - triggering GC and scaling down');
                if (global.gc) {
                    global.gc();
                }
            }
        }
    }

    /**
     * Handle system predictions
     */
    handleSystemPredictions(predictions) {
        // Proactively scale based on predictions
        if (predictions.recommendations) {
            for (const recommendation of predictions.recommendations) {
                if (recommendation.priority === 'critical' || recommendation.priority === 'high') {
                    console.log(`🔮 System prediction: ${recommendation.action} - ${recommendation.reason}`);
                    
                    // The WorkerPoolManager will handle scaling recommendations automatically
                }
            }
        }
    }

    /**
     * Display current system status
     */
    displaySystemStatus() {
        console.log('\n📊 System Status Summary:');
        console.log('================================');
        
        // WorkerPoolManager status
        const poolStatus = this.components.workerPoolManager.getStatus();
        console.log(`🎯 Worker Pool: ${poolStatus.globalConcurrency.current}/${poolStatus.globalConcurrency.max} concurrency (${poolStatus.globalConcurrency.utilization.toFixed(1)}%)`);
        
        // System resources
        const systemReport = this.components.systemMonitor.getReport();
        if (systemReport.current) {
            console.log(`💻 CPU: ${systemReport.current.cpu.usage.toFixed(1)}%, Memory: ${systemReport.current.memory.heapUsedPercent.toFixed(1)}%`);
        }
        
        // Health status
        const healthStatus = this.components.healthMonitor.getHealthStatus();
        console.log(`🏥 Health: ${healthStatus.summary.overallHealthy ? '✅ Healthy' : '❌ Unhealthy'} (${healthStatus.summary.healthyWorkers}/${healthStatus.summary.totalWorkers} workers, ${healthStatus.summary.healthyDependencies}/${healthStatus.summary.totalDependencies} dependencies)`);
        
        // Workers
        console.log('\n👷 Workers:');
        for (const [type, worker] of Object.entries(poolStatus.workers)) {
            const status = worker.circuitBreakerState === 'OPEN' ? '🔴' : worker.circuitBreakerState === 'HALF_OPEN' ? '🟡' : '🟢';
            console.log(`   ${status} ${type}: ${worker.activeJobs}/${worker.concurrency} active (${worker.utilization.toFixed(1)}% utilization)`);
        }
        
        console.log('================================\n');
    }

    /**
     * Get comprehensive system metrics
     */
    getSystemMetrics() {
        return {
            timestamp: new Date().toISOString(),
            workerPool: this.components.workerPoolManager.getStatus(),
            system: this.components.systemMonitor.getReport(),
            health: this.components.healthMonitor.getHealthStatus(),
            uptime: Date.now() - (this.components.config?.metrics?.startTime || Date.now())
        };
    }

    /**
     * Perform comprehensive health check
     */
    async healthCheck() {
        try {
            const results = {
                timestamp: new Date().toISOString(),
                healthy: true,
                components: {}
            };

            // Check WorkerPoolManager
            const poolHealth = await this.components.workerPoolManager.healthCheck();
            results.components.workerPool = poolHealth;
            results.healthy = results.healthy && poolHealth.healthy;

            // Check SystemMonitor
            const systemHealth = await this.components.systemMonitor.healthCheck();
            results.components.system = systemHealth;
            results.healthy = results.healthy && systemHealth.healthy;

            // Check HealthMonitor
            const healthMonitorHealth = await this.components.healthMonitor.healthCheck();
            results.components.healthMonitor = healthMonitorHealth;
            results.healthy = results.healthy && healthMonitorHealth.healthy;

            return results;

        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Graceful shutdown
     */
    async gracefulShutdown(signal = 'MANUAL') {
        if (this.isShuttingDown) {
            console.log('🔄 Shutdown already in progress...');
            return;
        }

        this.isShuttingDown = true;
        console.log(`🛑 Starting graceful shutdown (signal: ${signal})...`);

        try {
            const shutdownTimeout = 30000; // 30 seconds
            const shutdownPromise = this.performShutdown();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout);
            });

            await Promise.race([shutdownPromise, timeoutPromise]);
            console.log('✅ Graceful shutdown completed successfully');

        } catch (error) {
            console.error('❌ Shutdown error:', error.message);
            console.log('🔥 Forcing immediate shutdown...');
        } finally {
            process.exit(0);
        }
    }

    /**
     * Perform shutdown sequence
     */
    async performShutdown() {
        const shutdownSteps = [
            { name: 'Stop health monitoring', fn: () => this.components.healthMonitor?.stop() },
            { name: 'Stop system monitoring', fn: () => this.components.systemMonitor?.stop() },
            { name: 'Shutdown workers', fn: () => this.shutdownWorkers() },
            { name: 'Shutdown WorkerPoolManager', fn: () => this.components.workerPoolManager?.shutdown() },
            { name: 'Final cleanup', fn: () => this.cleanup() }
        ];

        for (const step of shutdownSteps) {
            try {
                console.log(`🔄 ${step.name}...`);
                await step.fn();
                console.log(`✅ ${step.name} completed`);
            } catch (error) {
                console.error(`❌ ${step.name} failed:`, error.message);
            }
        }
    }

    /**
     * Shutdown all workers
     */
    async shutdownWorkers() {
        if (!this.components.workers) {
            return;
        }

        const shutdownPromises = Object.entries(this.components.workers).map(async ([name, worker]) => {
            try {
                console.log(`🔄 Shutting down ${name} worker...`);
                await worker.close();
                console.log(`✅ ${name} worker shutdown completed`);
            } catch (error) {
                console.error(`❌ ${name} worker shutdown failed:`, error.message);
            }
        });

        await Promise.allSettled(shutdownPromises);
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            // Clear any remaining timers
            // Additional cleanup logic here
            
            this.components = {};
            this.isInitialized = false;
            
            console.log('🧹 Cleanup completed');
            
        } catch (error) {
            console.error('❌ Cleanup error:', error.message);
        }
    }

    /**
     * Get system status for monitoring endpoints
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            shuttingDown: this.isShuttingDown,
            environment: this.components.config?.environment,
            uptime: this.isInitialized ? Date.now() - (this.components.config?.metrics?.startTime || Date.now()) : 0,
            components: {
                config: !!this.components.config,
                workerPoolManager: !!this.components.workerPoolManager,
                systemMonitor: !!this.components.systemMonitor,
                healthMonitor: !!this.components.healthMonitor,
                workers: Object.keys(this.components.workers || {})
            }
        };
    }
}

// Example usage
async function createIntegratedSystem(dependencies) {
    const system = new IntegratedWorkerPoolSystem(dependencies);
    
    try {
        await system.initialize();
        
        // Start periodic status reports
        setInterval(() => {
            system.displaySystemStatus();
        }, 300000); // Every 5 minutes
        
        return system;
        
    } catch (error) {
        console.error('❌ Failed to create integrated system:', error);
        throw error;
    }
}

module.exports = { 
    IntegratedWorkerPoolSystem, 
    createIntegratedSystem 
};