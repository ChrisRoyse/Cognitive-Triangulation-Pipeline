/**
 * Enhanced Health Monitoring Integration Tests
 * 
 * Tests the enhanced health monitoring system with real dependency connectivity validation
 */

const { HealthMonitor } = require('../../src/utils/healthMonitor');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const neo4jDriver = require('../../src/utils/neo4jDriver');
const cacheClient = require('../../src/utils/cacheClient');

const {
    createNeo4jHealthCheck,
    createRedisHealthCheck,
    createSQLiteHealthCheck
} = require('../../src/utils/dependencyHealthChecks');

const fs = require('fs');
const path = require('path');

describe('Enhanced Health Monitoring Integration', () => {
    let healthMonitor;
    let dbManager;
    let testDbPath;

    beforeAll(async () => {
        // Create test database path
        testDbPath = path.join(__dirname, '../test-data', `health_test_${Date.now()}.db`);
        
        // Ensure test data directory exists
        const testDataDir = path.dirname(testDbPath);
        if (!fs.existsSync(testDataDir)) {
            fs.mkdirSync(testDataDir, { recursive: true });
        }

        // Initialize test database
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();
    });

    afterAll(async () => {
        // Clean up test database
        if (dbManager) {
            dbManager.close();
        }
        
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(() => {
        // Initialize health monitor for each test
        healthMonitor = new HealthMonitor({
            globalHealthInterval: 5000,      // 5 seconds for faster testing
            dependencyHealthInterval: 3000,  // 3 seconds for faster testing
            healthCheckTimeout: 8000,        // 8 seconds timeout
            unhealthyThreshold: 2,           // 2 consecutive failures
            enableAlerts: false              // Disable alerts for testing
        });
    });

    afterEach(async () => {
        // Clean up health monitor
        if (healthMonitor) {
            healthMonitor.stop();
        }
    });

    describe('SQLite Health Check Enhancement', () => {
        test('should properly validate SQLite connectivity with write/read tests', async () => {
            // Register SQLite dependency with enhanced health check
            const sqliteHealthCheck = createSQLiteHealthCheck(dbManager);
            healthMonitor.registerDependency('sqlite', sqliteHealthCheck);

            // Perform health check
            const healthResult = await sqliteHealthCheck();

            expect(healthResult).toHaveProperty('healthy');
            expect(healthResult).toHaveProperty('details');
            
            if (healthResult.healthy) {
                expect(healthResult.details).toHaveProperty('basicQueryTest', 'passed');
                expect(healthResult.details).toHaveProperty('writeTest', 'passed');
                expect(healthResult.details).toHaveProperty('readTest', 'passed');
                expect(healthResult.details).toHaveProperty('transactionTest', 'passed');
                expect(healthResult.details).toHaveProperty('timestamp');
            } else {
                expect(healthResult).toHaveProperty('error');
                console.warn('SQLite health check failed:', healthResult.error);
            }
        });

        test('should detect SQLite database corruption/inaccessibility', async () => {
            // Create a corrupted database manager (invalid path)
            const corruptedDbManager = new DatabaseManager('/invalid/path/database.db');
            const sqliteHealthCheck = createSQLiteHealthCheck(corruptedDbManager);

            // Health check should fail
            const healthResult = await sqliteHealthCheck();

            expect(healthResult.healthy).toBe(false);
            expect(healthResult.error).toContain('SQLite health check failed');
            expect(healthResult.details).toHaveProperty('errorCode');
        });
    });

    describe('Neo4j Health Check Enhancement', () => {
        test('should properly validate Neo4j connectivity with session tests', async () => {
            // Register Neo4j dependency with enhanced health check
            const neo4jHealthCheck = createNeo4jHealthCheck(neo4jDriver);
            healthMonitor.registerDependency('neo4j', neo4jHealthCheck);

            // Perform health check
            const healthResult = await neo4jHealthCheck();

            expect(healthResult).toHaveProperty('healthy');
            expect(healthResult).toHaveProperty('details');
            
            if (healthResult.healthy) {
                expect(healthResult.details).toHaveProperty('verifyConnectivity', 'passed');
                expect(healthResult.details).toHaveProperty('sessionTest', 'passed');
                expect(healthResult.details).toHaveProperty('queryTest', 'passed');
                expect(healthResult.details).toHaveProperty('timestamp');
            } else {
                expect(healthResult).toHaveProperty('error');
                console.warn('Neo4j health check failed (may be expected in test environment):', healthResult.error);
            }
        }, 20000); // Longer timeout for Neo4j connectivity

        test('should handle Neo4j connection failures gracefully', async () => {
            // Create a mock driver that will fail
            const mockDriver = {
                verifyConnectivity: () => Promise.reject(new Error('Connection refused')),
                session: () => ({
                    run: () => Promise.reject(new Error('No session available')),
                    close: () => Promise.resolve()
                })
            };

            const neo4jHealthCheck = createNeo4jHealthCheck(mockDriver);

            // Health check should fail gracefully
            const healthResult = await neo4jHealthCheck();

            expect(healthResult.healthy).toBe(false);
            expect(healthResult.error).toContain('Neo4j health check failed');
            expect(healthResult.details).toHaveProperty('errorCode');
        });
    });

    describe('Redis Health Check Enhancement', () => {
        test('should properly validate Redis connectivity with ping and set/get tests', async () => {
            // Register Redis dependency with enhanced health check
            const redisHealthCheck = createRedisHealthCheck(cacheClient);
            healthMonitor.registerDependency('redis', redisHealthCheck);

            // Perform health check
            const healthResult = await redisHealthCheck();

            expect(healthResult).toHaveProperty('healthy');
            expect(healthResult).toHaveProperty('details');
            
            if (healthResult.healthy) {
                expect(healthResult.details).toHaveProperty('pingTest', 'passed');
                expect(healthResult.details).toHaveProperty('setGetTest', 'passed');
                expect(healthResult.details).toHaveProperty('connectionState');
                expect(healthResult.details).toHaveProperty('serverInfo');
            } else {
                expect(healthResult).toHaveProperty('error');
                console.warn('Redis health check failed (may be expected in test environment):', healthResult.error);
            }
        }, 15000); // Longer timeout for Redis connectivity

        test('should handle Redis connection failures gracefully', async () => {
            // Create a mock cache client that will fail
            const mockCacheClient = {
                getCacheClient: () => ({
                    ping: () => Promise.reject(new Error('Connection refused')),
                    set: () => Promise.reject(new Error('Cannot set key')),
                    get: () => Promise.reject(new Error('Cannot get key')),
                    del: () => Promise.reject(new Error('Cannot delete key')),
                    info: () => Promise.reject(new Error('Cannot get info')),
                    status: 'disconnected'
                })
            };

            const redisHealthCheck = createRedisHealthCheck(mockCacheClient);

            // Health check should fail gracefully
            const healthResult = await redisHealthCheck();

            expect(healthResult.healthy).toBe(false);
            expect(healthResult.error).toContain('Redis health check failed');
            expect(healthResult.details).toHaveProperty('errorCode');
        });
    });

    describe('Global Health Status Integration', () => {
        test('should properly propagate dependency failures to global health status', async () => {
            // Register a failing dependency
            const failingHealthCheck = async () => ({
                healthy: false,
                error: 'Simulated dependency failure',
                details: { simulated: true }
            });

            healthMonitor.registerDependency('failing_service', failingHealthCheck);

            // Perform dependency health checks
            await healthMonitor.performDependencyHealthChecks();

            // Get dependency health summary
            const dependencyHealth = await healthMonitor.checkDependencyHealthSummary();

            expect(dependencyHealth.healthy).toBe(false);
            expect(dependencyHealth.unhealthyDependencies).toHaveLength(1);
            expect(dependencyHealth.failureDetails).toHaveLength(1);
            expect(dependencyHealth.failureDetails[0]).toHaveProperty('name', 'failing_service');
            expect(dependencyHealth.failureDetails[0]).toHaveProperty('error', 'Simulated dependency failure');
        });

        test('should mark global health as unhealthy when dependencies fail', async () => {
            // Register multiple dependencies - one healthy, one unhealthy
            const healthyCheck = async () => ({ healthy: true, details: { test: 'passed' } });
            const unhealthyCheck = async () => ({ healthy: false, error: 'Service down', details: { test: 'failed' } });

            healthMonitor.registerDependency('healthy_service', healthyCheck);
            healthMonitor.registerDependency('unhealthy_service', unhealthyCheck);

            // Perform global health check
            await healthMonitor.performGlobalHealthCheck();

            // Get health status
            const healthStatus = healthMonitor.getHealthStatus();

            expect(healthStatus.global.healthy).toBe(false); // Global should be unhealthy due to dependency failure
            expect(healthStatus.summary.healthyDependencies).toBe(1);
            expect(healthStatus.summary.totalDependencies).toBe(2);
        });

        test('should handle health check timeouts properly', async () => {
            // Create a health check that times out
            const timeoutHealthCheck = async () => {
                return new Promise((resolve) => {
                    setTimeout(() => resolve({ healthy: true }), 10000); // 10 seconds - longer than timeout
                });
            };

            healthMonitor.registerDependency('timeout_service', timeoutHealthCheck);

            // Perform dependency health check (should timeout)
            await healthMonitor.performDependencyHealthChecks();

            const healthStatus = healthMonitor.getHealthStatus();
            const timeoutDependency = healthStatus.dependencies.find(dep => dep.name === 'timeout_service');

            expect(timeoutDependency).toBeDefined();
            expect(timeoutDependency.healthy).toBe(false);
            expect(timeoutDependency.lastError).toContain('timeout');
        });
    });

    describe('Health Check API Endpoint', () => {
        test('should return comprehensive health status via API endpoint', async () => {
            // Register some test dependencies
            const healthyCheck = async () => ({ healthy: true, details: { status: 'ok' } });
            const unhealthyCheck = async () => ({ healthy: false, error: 'Service unavailable' });

            healthMonitor.registerDependency('api_service', healthyCheck);
            healthMonitor.registerDependency('database_service', unhealthyCheck);

            // Perform health checks
            await healthMonitor.performDependencyHealthChecks();

            // Call health check API
            const apiResponse = await healthMonitor.healthCheck();

            expect(apiResponse).toHaveProperty('healthy');
            expect(apiResponse).toHaveProperty('status');
            expect(apiResponse).toHaveProperty('timestamp');
            
            expect(apiResponse.status).toHaveProperty('global');
            expect(apiResponse.status).toHaveProperty('dependencies');
            expect(apiResponse.status).toHaveProperty('summary');
            
            expect(apiResponse.status.summary).toHaveProperty('totalDependencies');
            expect(apiResponse.status.summary).toHaveProperty('healthyDependencies');
            expect(apiResponse.status.summary).toHaveProperty('overallHealthy');
        });
    });

    describe('Enhanced Validation Logic', () => {
        test('should use enhanced validation for recognized dependency types', async () => {
            // Test with SQLite (should use enhanced validation)
            const sqliteHealthCheck = createSQLiteHealthCheck(dbManager);
            healthMonitor.registerDependency('sqlite_test', sqliteHealthCheck);

            // Perform health check
            await healthMonitor.performDependencyHealthChecks();

            const healthStatus = healthMonitor.getHealthStatus();
            const sqliteDep = healthStatus.dependencies.find(dep => dep.name === 'sqlite_test');

            if (sqliteDep && sqliteDep.healthy) {
                expect(sqliteDep.details).toHaveProperty('validationType', 'sqlite_operations');
                expect(sqliteDep.details).toHaveProperty('basicQueryTest', 'passed');
                expect(sqliteDep.details).toHaveProperty('writeTest', 'passed');
                expect(sqliteDep.details).toHaveProperty('readTest', 'passed');
            }
        });

        test('should fall back to basic validation for unrecognized dependencies', async () => {
            // Register a generic dependency
            const genericCheck = async () => ({ healthy: true });
            healthMonitor.registerDependency('generic_service', genericCheck);

            // Perform health check
            await healthMonitor.performDependencyHealthChecks();

            const healthStatus = healthMonitor.getHealthStatus();
            const genericDep = healthStatus.dependencies.find(dep => dep.name === 'generic_service');

            expect(genericDep).toBeDefined();
            expect(genericDep.healthy).toBe(true);
        });
    });
});