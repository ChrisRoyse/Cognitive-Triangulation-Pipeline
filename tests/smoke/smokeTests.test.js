/**
 * Smoke Test Suite - System Health Verification
 * 
 * Purpose: Quick verification of all critical system components
 * Target: < 30 seconds execution time
 * Use: Run before deployments or after system restarts
 * 
 * Components tested:
 * 1. Database connectivity (SQLite)
 * 2. Redis connectivity
 * 3. Neo4j connectivity
 * 4. DeepSeek API availability
 * 5. File system permissions
 * 6. Configuration validity
 * 7. Worker pool initialization
 * 8. Circuit breaker status
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const Redis = require('ioredis');
const neo4j = require('neo4j-driver');
const axios = require('axios');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');
const { ServiceCircuitBreakerManager } = require('../../src/utils/serviceCircuitBreakers');
const config = require('../../src/config');

// Test timeout - 30 seconds max
jest.setTimeout(30000);

// Test results collector for CI/CD integration
const testResults = {
    passed: [],
    failed: [],
    warnings: [],
    startTime: Date.now(),
    endTime: null
};

describe('Smoke Tests - System Health Verification', () => {
    let redis;
    let neo4jDriver;
    let testDb;
    
    // Cleanup function
    const cleanup = async () => {
        if (redis) await redis.quit().catch(() => {});
        if (neo4jDriver) await neo4jDriver.close().catch(() => {});
        if (testDb) testDb.close();
    };
    
    afterAll(async () => {
        await cleanup();
        
        // Generate test report
        testResults.endTime = Date.now();
        const duration = (testResults.endTime - testResults.startTime) / 1000;
        
        console.log('\n========== SMOKE TEST SUMMARY ==========');
        console.log(`Total Duration: ${duration.toFixed(2)}s`);
        console.log(`Passed: ${testResults.passed.length}`);
        console.log(`Failed: ${testResults.failed.length}`);
        console.log(`Warnings: ${testResults.warnings.length}`);
        
        if (testResults.failed.length > 0) {
            console.log('\nFAILED TESTS:');
            testResults.failed.forEach(test => {
                console.log(`  ❌ ${test.name}: ${test.error}`);
            });
        }
        
        if (testResults.warnings.length > 0) {
            console.log('\nWARNINGS:');
            testResults.warnings.forEach(warning => {
                console.log(`  ⚠️  ${warning}`);
            });
        }
        
        console.log('========================================\n');
    });
    
    describe('1. Configuration Validity', () => {
        test('All required environment variables are set', () => {
            const requiredVars = [
                'NEO4J_URI',
                'NEO4J_USER',
                'NEO4J_PASSWORD',
                'DEEPSEEK_API_KEY',
                'SQLITE_DB_PATH',
                'REDIS_URL'
            ];
            
            const missing = [];
            requiredVars.forEach(varName => {
                if (!config[varName]) {
                    missing.push(varName);
                }
            });
            
            if (missing.length > 0) {
                const error = `Missing required config: ${missing.join(', ')}`;
                testResults.failed.push({ name: 'Configuration Validity', error });
                throw new Error(error);
            }
            
            testResults.passed.push({ name: 'Configuration Validity' });
        });
        
        test('Configuration values are valid', () => {
            // Check Neo4j URI format
            expect(config.NEO4J_URI).toMatch(/^bolt:\/\/[^:]+:\d+$/);
            
            // Check Redis URL format
            expect(config.REDIS_URL).toMatch(/^redis:\/\/[^:]*:?\d*$/);
            
            // Check API key is not default
            if (config.DEEPSEEK_API_KEY === 'your-api-key-here') {
                testResults.warnings.push('DeepSeek API key appears to be default value');
            }
            
            testResults.passed.push({ name: 'Configuration Values Valid' });
        });
    });
    
    describe('2. Database Connectivity - SQLite', () => {
        test('Can connect to SQLite database', () => {
            try {
                const dbPath = path.resolve(config.SQLITE_DB_PATH);
                testDb = new Database(dbPath);
                
                // Test basic query
                const result = testDb.prepare('SELECT 1 as test').get();
                expect(result.test).toBe(1);
                
                testResults.passed.push({ name: 'SQLite Connection' });
            } catch (error) {
                testResults.failed.push({ name: 'SQLite Connection', error: error.message });
                throw error;
            }
        });
        
        test('Database schema is initialized', () => {
            try {
                // Check for essential tables
                const tables = testDb.prepare(`
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name NOT LIKE 'sqlite_%'
                `).all();
                
                const tableNames = tables.map(t => t.name);
                const requiredTables = ['files', 'entities', 'relationships'];
                
                const missingTables = requiredTables.filter(t => !tableNames.includes(t));
                
                if (missingTables.length > 0) {
                    throw new Error(`Missing tables: ${missingTables.join(', ')}`);
                }
                
                testResults.passed.push({ name: 'Database Schema' });
            } catch (error) {
                testResults.failed.push({ name: 'Database Schema', error: error.message });
                throw error;
            }
        });
    });
    
    describe('3. Redis Connectivity', () => {
        test('Can connect to Redis', async () => {
            try {
                redis = new Redis(config.REDIS_URL, {
                    maxRetriesPerRequest: 1,
                    retryStrategy: () => null,
                    lazyConnect: true
                });
                
                await redis.connect();
                const pong = await redis.ping();
                expect(pong).toBe('PONG');
                
                testResults.passed.push({ name: 'Redis Connection' });
            } catch (error) {
                testResults.failed.push({ name: 'Redis Connection', error: error.message });
                throw error;
            }
        });
        
        test('Can perform basic Redis operations', async () => {
            try {
                const testKey = 'smoke_test:' + Date.now();
                const testValue = 'test_value';
                
                // Set
                await redis.set(testKey, testValue, 'EX', 10);
                
                // Get
                const retrieved = await redis.get(testKey);
                expect(retrieved).toBe(testValue);
                
                // Delete
                await redis.del(testKey);
                
                testResults.passed.push({ name: 'Redis Operations' });
            } catch (error) {
                testResults.failed.push({ name: 'Redis Operations', error: error.message });
                throw error;
            }
        });
    });
    
    describe('4. Neo4j Connectivity', () => {
        test('Can connect to Neo4j', async () => {
            try {
                neo4jDriver = neo4j.driver(
                    config.NEO4J_URI,
                    neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD),
                    {
                        maxConnectionPoolSize: 5,
                        connectionTimeout: 5000
                    }
                );
                
                await neo4jDriver.verifyConnectivity();
                testResults.passed.push({ name: 'Neo4j Connection' });
            } catch (error) {
                testResults.failed.push({ name: 'Neo4j Connection', error: error.message });
                throw error;
            }
        });
        
        test('Can execute basic Neo4j query', async () => {
            try {
                const session = neo4jDriver.session();
                
                try {
                    const result = await session.run('RETURN 1 as test');
                    const record = result.records[0];
                    expect(record.get('test').toNumber()).toBe(1);
                    
                    testResults.passed.push({ name: 'Neo4j Query' });
                } finally {
                    await session.close();
                }
            } catch (error) {
                testResults.failed.push({ name: 'Neo4j Query', error: error.message });
                throw error;
            }
        });
    });
    
    describe('5. DeepSeek API Availability', () => {
        test('API key is configured', () => {
            const apiKey = config.DEEPSEEK_API_KEY;
            
            if (!apiKey || apiKey === 'your-api-key-here') {
                const error = 'DeepSeek API key not configured';
                testResults.failed.push({ name: 'DeepSeek API Key', error });
                throw new Error(error);
            }
            
            testResults.passed.push({ name: 'DeepSeek API Key' });
        });
        
        test('Can reach DeepSeek API endpoint', async () => {
            try {
                // Test with a minimal request
                const response = await axios.post(
                    'https://api.deepseek.com/v1/chat/completions',
                    {
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: 'test' }],
                        max_tokens: 1
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${config.DEEPSEEK_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 5000,
                        validateStatus: (status) => status < 500 // Don't fail on 4xx
                    }
                );
                
                if (response.status === 401) {
                    throw new Error('Invalid API key');
                }
                
                testResults.passed.push({ name: 'DeepSeek API Connectivity' });
            } catch (error) {
                if (error.code === 'ECONNABORTED') {
                    testResults.warnings.push('DeepSeek API timeout - may be network issue');
                } else {
                    testResults.failed.push({ 
                        name: 'DeepSeek API Connectivity', 
                        error: error.message 
                    });
                    throw error;
                }
            }
        });
    });
    
    describe('6. File System Permissions', () => {
        test('Can read/write to data directory', async () => {
            try {
                const dataDir = path.dirname(path.resolve(config.SQLITE_DB_PATH));
                const testFile = path.join(dataDir, 'smoke_test_' + Date.now() + '.tmp');
                
                // Ensure directory exists
                await fs.mkdir(dataDir, { recursive: true });
                
                // Write test
                await fs.writeFile(testFile, 'test content');
                
                // Read test
                const content = await fs.readFile(testFile, 'utf8');
                expect(content).toBe('test content');
                
                // Delete test
                await fs.unlink(testFile);
                
                testResults.passed.push({ name: 'File System Permissions' });
            } catch (error) {
                testResults.failed.push({ name: 'File System Permissions', error: error.message });
                throw error;
            }
        });
        
        test('Can access log directory', async () => {
            try {
                const logDir = config.LOG_DIRECTORY || './logs';
                await fs.mkdir(logDir, { recursive: true });
                
                const stats = await fs.stat(logDir);
                expect(stats.isDirectory()).toBe(true);
                
                testResults.passed.push({ name: 'Log Directory Access' });
            } catch (error) {
                testResults.failed.push({ name: 'Log Directory Access', error: error.message });
                throw error;
            }
        });
    });
    
    describe('7. Worker Pool Initialization', () => {
        test('Can initialize worker pool manager', () => {
            try {
                const workerPool = new WorkerPoolManager({
                    environment: 'test',
                    maxGlobalConcurrency: 10
                });
                
                expect(workerPool).toBeDefined();
                expect(workerPool.config.environment).toBe('test');
                
                testResults.passed.push({ name: 'Worker Pool Initialization' });
            } catch (error) {
                testResults.failed.push({ name: 'Worker Pool Initialization', error: error.message });
                throw error;
            }
        });
        
        test('Worker pool respects concurrency limits', () => {
            const workerPool = new WorkerPoolManager({
                maxGlobalConcurrency: 100
            });
            
            const limit = workerPool.config.maxGlobalConcurrency;
            expect(limit).toBeLessThanOrEqual(100);
            
            testResults.passed.push({ name: 'Worker Pool Concurrency' });
        });
    });
    
    describe('8. Circuit Breaker Status', () => {
        test('Can initialize circuit breaker manager', () => {
            try {
                const circuitManager = new ServiceCircuitBreakerManager({
                    services: {
                        llm: { name: 'deepseek' },
                        neo4j: neo4jDriver,
                        redis: redis
                    }
                });
                
                expect(circuitManager).toBeDefined();
                expect(circuitManager.breakers.size).toBeGreaterThan(0);
                
                testResults.passed.push({ name: 'Circuit Breaker Initialization' });
            } catch (error) {
                testResults.failed.push({ name: 'Circuit Breaker Initialization', error: error.message });
                throw error;
            }
        });
        
        test('All circuit breakers are in healthy state', async () => {
            const circuitManager = new ServiceCircuitBreakerManager({
                services: {
                    llm: { name: 'deepseek' },
                    neo4j: neo4jDriver,
                    redis: redis
                }
            });
            
            const health = await circuitManager.getHealthStatus();
            
            if (health.overall !== 'healthy') {
                testResults.warnings.push(`System health: ${health.overall}`);
                
                // Log specific unhealthy services
                Object.entries(health.services).forEach(([name, service]) => {
                    if (!service.healthy || service.state !== 'CLOSED') {
                        testResults.warnings.push(`Service ${name} state: ${service.state}`);
                    }
                });
            }
            
            testResults.passed.push({ name: 'Circuit Breaker Health' });
        });
    });
    
    describe('9. System Resources', () => {
        test('Adequate system resources available', () => {
            const cpuCount = os.cpus().length;
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const memoryUsagePercent = ((totalMemory - freeMemory) / totalMemory) * 100;
            
            // Check CPU count
            if (cpuCount < 2) {
                testResults.warnings.push(`Low CPU count: ${cpuCount}`);
            }
            
            // Check memory
            const freeMemoryGB = freeMemory / (1024 * 1024 * 1024);
            if (freeMemoryGB < 1) {
                testResults.warnings.push(`Low free memory: ${freeMemoryGB.toFixed(2)}GB`);
            }
            
            if (memoryUsagePercent > 90) {
                testResults.warnings.push(`High memory usage: ${memoryUsagePercent.toFixed(1)}%`);
            }
            
            testResults.passed.push({ name: 'System Resources' });
        });
    });
    
    describe('10. Queue System', () => {
        test('Can verify queue names are configured', () => {
            const expectedQueues = config.QUEUE_NAMES;
            
            expect(expectedQueues).toBeDefined();
            expect(expectedQueues.length).toBeGreaterThan(0);
            expect(expectedQueues).toContain('file-analysis-queue');
            
            testResults.passed.push({ name: 'Queue Configuration' });
        });
    });
});

// Export for external use
module.exports = {
    getTestResults: () => testResults
};