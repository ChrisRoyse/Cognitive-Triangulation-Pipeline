/**
 * Dependency Health Check Factories
 * 
 * This module provides factory functions to create proper health check functions
 * for different service dependencies (Redis, Neo4j, SQLite) that can be used
 * with the HealthMonitor system.
 */

const { executeWithTimeout } = require('./timeoutUtil');

/**
 * Create a Neo4j health check function
 * @param {Object} neo4jDriver - Neo4j driver utility
 * @returns {Function} Health check function
 */
function createNeo4jHealthCheck(neo4jDriver) {
    return async function neo4jHealthCheck() {
        try {
            const result = await executeWithTimeout(
                (async () => {
                    // Test driver connectivity first
                    await neo4jDriver.verifyConnectivity();
                    
                    // Test actual session creation and query
                    const session = neo4jDriver.session();
                    try {
                        const queryResult = await session.run('RETURN 1 as test, datetime() as timestamp');
                        const record = queryResult.records[0];
                        
                        if (!record || record.get('test').toNumber() !== 1) {
                            throw new Error('Neo4j query returned unexpected result');
                        }
                        
                        return {
                            healthy: true,
                            details: {
                                verifyConnectivity: 'passed',
                                sessionTest: 'passed',
                                queryTest: 'passed',
                                timestamp: record.get('timestamp').toString()
                            }
                        };
                    } finally {
                        await session.close();
                    }
                })(),
                15000, // 15 second timeout
                'Neo4j health check'
            );
            
            return result;
            
        } catch (error) {
            return {
                healthy: false,
                error: `Neo4j health check failed: ${error.message}`,
                details: {
                    errorCode: error.code,
                    errorName: error.name,
                    timeout: error.message.includes('timed out')
                }
            };
        }
    };
}

/**
 * Create a Redis health check function
 * @param {Object} cacheClient - Redis cache client utility
 * @returns {Function} Health check function
 */
function createRedisHealthCheck(cacheClient) {
    return async function redisHealthCheck() {
        try {
            const result = await executeWithTimeout(
                (async () => {
                    const client = cacheClient.getCacheClient();
                    
                    // Test ping
                    const pingResult = await client.ping();
                    if (pingResult !== 'PONG') {
                        throw new Error(`Redis ping returned '${pingResult}' instead of 'PONG'`);
                    }
                    
                    // Test basic set/get operation
                    const testKey = `healthcheck:${Date.now()}:${Math.random()}`;
                    const testValue = `health_test_${Date.now()}`;
                    
                    await client.set(testKey, testValue, 'EX', 10); // Expire in 10 seconds
                    const retrievedValue = await client.get(testKey);
                    
                    if (retrievedValue !== testValue) {
                        throw new Error(`Redis set/get test failed: expected '${testValue}', got '${retrievedValue}'`);
                    }
                    
                    // Clean up test key
                    await client.del(testKey);
                    
                    // Get connection info
                    const info = await client.info('server');
                    const serverInfo = {};
                    if (info) {
                        const lines = info.split('\\r\\n');
                        lines.forEach(line => {
                            if (line.includes('redis_version:')) {
                                serverInfo.version = line.split(':')[1];
                            }
                            if (line.includes('uptime_in_seconds:')) {
                                serverInfo.uptime = parseInt(line.split(':')[1]);
                            }
                        });
                    }
                    
                    return {
                        healthy: true,
                        details: {
                            pingTest: 'passed',
                            setGetTest: 'passed',
                            connectionState: client.status,
                            serverInfo,
                            testKey: testKey // For debugging if needed
                        }
                    };
                })(),
                10000, // 10 second timeout
                'Redis health check'
            );
            
            return result;
            
        } catch (error) {
            return {
                healthy: false,
                error: `Redis health check failed: ${error.message}`,
                details: {
                    errorCode: error.code,
                    errorName: error.name,
                    timeout: error.message.includes('timed out')
                }
            };
        }
    };
}

/**
 * Create a SQLite health check function
 * @param {Object} dbManager - Database manager instance
 * @returns {Function} Health check function
 */
function createSQLiteHealthCheck(dbManager) {
    return async function sqliteHealthCheck() {
        try {
            const result = await executeWithTimeout(
                (async () => {
                    const db = dbManager.getDb();
                    
                    // Test basic query execution
                    const basicResult = db.prepare('SELECT 1 as test, datetime() as timestamp').get();
                    
                    if (!basicResult || basicResult.test !== 1) {
                        throw new Error('SQLite basic query returned unexpected result');
                    }
                    
                    // Test database write capability with temporary table
                    const testTableName = `health_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                    
                    // Create temporary table
                    db.prepare(`CREATE TEMP TABLE ${testTableName} (id INTEGER, value TEXT, created_at TEXT)`).run();
                    
                    // Insert test data
                    const testValue = `test_${Date.now()}`;
                    const insertResult = db.prepare(`INSERT INTO ${testTableName} (id, value, created_at) VALUES (?, ?, ?)`).run(1, testValue, basicResult.timestamp);
                    
                    if (insertResult.changes !== 1) {
                        throw new Error('SQLite insert operation failed');
                    }
                    
                    // Read test data
                    const testResult = db.prepare(`SELECT value, created_at FROM ${testTableName} WHERE id = ?`).get(1);
                    
                    if (!testResult || testResult.value !== testValue) {
                        throw new Error('SQLite write/read test failed');
                    }
                    
                    // Test transaction capability
                    const transactionTest = db.transaction(() => {\n                        const updateResult = db.prepare(`UPDATE ${testTableName} SET value = ? WHERE id = ?`).run('updated_value', 1);\n                        return updateResult.changes;\n                    });\n                    \n                    const transactionChanges = transactionTest();\n                    if (transactionChanges !== 1) {\n                        throw new Error('SQLite transaction test failed');\n                    }\n                    \n                    // Verify transaction result\n                    const finalResult = db.prepare(`SELECT value FROM ${testTableName} WHERE id = ?`).get(1);\n                    if (!finalResult || finalResult.value !== 'updated_value') {\n                        throw new Error('SQLite transaction verification failed');\n                    }\n                    \n                    // Clean up (temp tables are automatically dropped, but let's be explicit)\n                    db.prepare(`DROP TABLE IF EXISTS ${testTableName}`).run();\n                    \n                    return {\n                        healthy: true,\n                        details: {\n                            basicQueryTest: 'passed',\n                            writeTest: 'passed',\n                            readTest: 'passed',\n                            transactionTest: 'passed',\n                            timestamp: basicResult.timestamp,\n                            testTable: testTableName,\n                            insertedRows: insertResult.changes,\n                            transactionChanges\n                        }\n                    };\n                })(),\n                8000, // 8 second timeout\n                'SQLite health check'\n            );\n            \n            return result;\n            \n        } catch (error) {\n            return {\n                healthy: false,\n                error: `SQLite health check failed: ${error.message}`,\n                details: {\n                    errorCode: error.code,\n                    errorName: error.name,\n                    timeout: error.message.includes('timed out')\n                }\n            };\n        }\n    };\n}\n\n/**\n * Create a Queue Manager health check function\n * @param {Object} queueManager - Queue manager instance\n * @returns {Function} Health check function\n */\nfunction createQueueManagerHealthCheck(queueManager) {\n    return async function queueManagerHealthCheck() {\n        try {\n            const result = await executeWithTimeout(\n                (async () => {\n                    // Test queue manager connectivity\n                    const isHealthy = await queueManager.isHealthy();\n                    \n                    if (!isHealthy) {\n                        throw new Error('Queue manager reports unhealthy status');\n                    }\n                    \n                    // Get job counts to verify queue operations\n                    const jobCounts = await queueManager.getJobCounts();\n                    \n                    // Test connection pool status if available\n                    let poolStatus = null;\n                    if (queueManager.getConnectionPoolStatus) {\n                        poolStatus = queueManager.getConnectionPoolStatus();\n                    }\n                    \n                    return {\n                        healthy: true,\n                        details: {\n                            healthCheck: 'passed',\n                            jobCountsTest: 'passed',\n                            jobCounts,\n                            poolStatus,\n                            timestamp: new Date().toISOString()\n                        }\n                    };\n                })(),\n                12000, // 12 second timeout\n                'Queue manager health check'\n            );\n            \n            return result;\n            \n        } catch (error) {\n            return {\n                healthy: false,\n                error: `Queue manager health check failed: ${error.message}`,\n                details: {\n                    errorCode: error.code,\n                    errorName: error.name,\n                    timeout: error.message.includes('timed out')\n                }\n            };\n        }\n    };\n}\n\n/**\n * Create a Worker Pool Manager health check function\n * @param {Object} workerPoolManager - Worker pool manager instance\n * @returns {Function} Health check function\n */\nfunction createWorkerPoolHealthCheck(workerPoolManager) {\n    return async function workerPoolHealthCheck() {\n        try {\n            const result = await executeWithTimeout(\n                (async () => {\n                    // Get worker pool status\n                    const status = workerPoolManager.getStatus();\n                    \n                    // Check if any workers are registered\n                    const workerCount = Object.keys(status.workers).length;\n                    \n                    // Check circuit breaker status\n                    const circuitBreakerStatus = workerPoolManager.getCircuitBreakerStatus();\n                    const openBreakers = Object.entries(circuitBreakerStatus)\n                        .filter(([_, status]) => status.state === 'OPEN');\n                    \n                    // Check for critical issues\n                    const issues = [];\n                    \n                    if (workerCount === 0) {\n                        issues.push('No workers registered');\n                    }\n                    \n                    if (openBreakers.length > 0) {\n                        issues.push(`${openBreakers.length} circuit breakers are OPEN`);\n                    }\n                    \n                    // Check global concurrency limits\n                    if (status.globalConcurrency.current > status.globalConcurrency.max * 0.95) {\n                        issues.push('Global concurrency near limit');\n                    }\n                    \n                    const healthy = issues.length === 0;\n                    \n                    return {\n                        healthy,\n                        error: healthy ? null : `Worker pool issues: ${issues.join(', ')}`,\n                        details: {\n                            workerCount,\n                            globalConcurrency: status.globalConcurrency,\n                            openCircuitBreakers: openBreakers.length,\n                            issues,\n                            timestamp: new Date().toISOString()\n                        }\n                    };\n                })(),\n                5000, // 5 second timeout\n                'Worker pool health check'\n            );\n            \n            return result;\n            \n        } catch (error) {\n            return {\n                healthy: false,\n                error: `Worker pool health check failed: ${error.message}`,\n                details: {\n                    errorCode: error.code,\n                    errorName: error.name,\n                    timeout: error.message.includes('timed out')\n                }\n            };\n        }\n    };\n}\n\nmodule.exports = {\n    createNeo4jHealthCheck,\n    createRedisHealthCheck,\n    createSQLiteHealthCheck,\n    createQueueManagerHealthCheck,\n    createWorkerPoolHealthCheck\n};\n