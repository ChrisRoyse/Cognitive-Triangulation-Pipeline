/**
 * Performance Regression Validation Integration Tests
 * 
 * These tests ensure that the fixes don't cause performance regressions:
 * 1. Database operations maintain acceptable performance
 * 2. Worker processing throughput is not degraded
 * 3. Neo4j operations remain performant with timeouts
 * 4. Memory usage stays within bounds
 * 5. Pipeline end-to-end performance benchmarks
 * 6. Circuit breaker overhead is minimal
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { performance } = require('perf_hooks');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getDriver: getNeo4jDriver } = require('../../src/utils/neo4jDriver');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');
const EntityScout = require('../../src/agents/EntityScout');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const ValidationWorker = require('../../src/workers/ValidationWorker');
const GraphIngestionWorker = require('../../src/workers/GraphIngestionWorker');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');
const SemanticIdentityService = require('../../src/services/SemanticIdentityService');

// Performance benchmarks (based on system requirements)
const PERFORMANCE_BENCHMARKS = {
    database: {
        singleInsert: 5, // ms
        batchInsert: 1, // ms per item
        querySelect: 10, // ms
        indexedQuery: 15, // ms
        migration: 1000 // ms
    },
    workers: {
        fileAnalysis: 2000, // ms per small file
        validation: 100, // ms per POI
        graphIngestion: 500, // ms per batch
        outboxProcessing: 50 // ms per event
    },
    neo4j: {
        nodeCreation: 100, // ms per batch
        relationshipCreation: 150, // ms per batch
        query: 200, // ms
        transactionTimeout: 30000 // ms (should not hang)
    },
    memory: {
        maxHeapUsed: 256 * 1024 * 1024, // 256MB for test environment
        maxRss: 512 * 1024 * 1024 // 512MB total memory
    }
};

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            database: [],
            workers: [],
            neo4j: [],
            memory: []
        };
    }

    measureTime(category, operation, fn) {
        return new Promise(async (resolve, reject) => {
            const startTime = performance.now();
            const startMemory = process.memoryUsage();
            
            try {
                const result = await fn();
                const endTime = performance.now();
                const endMemory = process.memoryUsage();
                
                const duration = endTime - startTime;
                const memoryDelta = {
                    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
                    rss: endMemory.rss - startMemory.rss
                };
                
                this.metrics[category].push({
                    operation,
                    duration,
                    memoryDelta,
                    timestamp: Date.now()
                });
                
                resolve({ result, duration, memoryDelta });
            } catch (error) {
                const endTime = performance.now();
                const duration = endTime - startTime;
                
                this.metrics[category].push({
                    operation,
                    duration,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                reject(error);
            }
        });
    }

    getStats(category) {
        const categoryMetrics = this.metrics[category];
        if (categoryMetrics.length === 0) return null;
        
        const durations = categoryMetrics.map(m => m.duration);
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];
        
        return {
            count: categoryMetrics.length,
            avg: Math.round(avg * 100) / 100,
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            p95: Math.round(p95 * 100) / 100
        };
    }

    getAllStats() {
        return {
            database: this.getStats('database'),
            workers: this.getStats('workers'),
            neo4j: this.getStats('neo4j'),
            memory: this.getStats('memory')
        };
    }

    reset() {
        this.metrics = {
            database: [],
            workers: [],
            neo4j: [],
            memory: []
        };
    }
}

describe('Performance Regression Validation Integration Tests', () => {
    let config;
    let dbManager;
    let queueManager;
    let neo4jDriver;
    let llmClient;
    let workerPoolManager;
    let outboxPublisher;
    let performanceMonitor;
    let testRunId;
    let testDbPath;
    let testDataDir;

    beforeAll(async () => {
        config = new PipelineConfig({ environment: 'test' });
        testRunId = uuidv4();
        performanceMonitor = new PerformanceMonitor();
        
        testDataDir = path.join(__dirname, `perf-test-${Date.now()}`);
        await fs.ensureDir(testDataDir);
        
        testDbPath = path.join(testDataDir, 'perf-test.db');
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();

        queueManager = getQueueManagerInstance();
        await queueManager.connect();

        neo4jDriver = getNeo4jDriver();
        llmClient = getDeepseekClient();
        workerPoolManager = new WorkerPoolManager({ 
            maxGlobalConcurrency: 10,
            environment: 'test'
        });

        outboxPublisher = new TransactionalOutboxPublisher(dbManager, queueManager);

        console.log(`✅ Performance test environment initialized with runId: ${testRunId}`);
    }, 30000);

    afterAll(async () => {
        if (outboxPublisher) {
            await outboxPublisher.stop();
        }
        if (queueManager) {
            await queueManager.clearAllQueues();
            await queueManager.closeConnections();
        }
        if (dbManager) {
            await dbManager.close();
        }
        if (neo4jDriver) {
            await neo4jDriver.close();
        }
        if (fs.existsSync(testDataDir)) {
            await fs.remove(testDataDir);
        }
        
        // Print final performance summary
        const finalStats = performanceMonitor.getAllStats();
        console.log('\n📊 Final Performance Summary:');
        console.log(JSON.stringify(finalStats, null, 2));
        console.log('✅ Performance test cleanup completed');
    }, 30000);

    beforeEach(async () => {
        await queueManager.clearAllQueues();
        performanceMonitor.reset();
        
        const db = dbManager.getDb();
        const tables = ['pois', 'relationships', 'outbox', 'files'];
        for (const table of tables) {
            try {
                db.prepare(`DELETE FROM ${table}`).run();
            } catch (error) {
                console.warn(`Could not clear table ${table}:`, error.message);
            }
        }
        
        // Clear Neo4j test data
        const session = neo4jDriver.session();
        try {
            await session.run('MATCH (n) WHERE n.runId = $runId DETACH DELETE n', { runId: testRunId });
        } finally {
            await session.close();
        }
    });

    describe('1. Database Performance Benchmarks', () => {
        test('should maintain database insert performance after schema changes', async () => {
            const db = dbManager.getDb();
            
            // Test single insert performance
            const { duration: singleInsertTime } = await performanceMonitor.measureTime('database', 'single-insert', async () => {
                return db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                    .run('single-test.js', 'processed', testRunId);
            });
            
            expect(singleInsertTime).toBeLessThan(PERFORMANCE_BENCHMARKS.database.singleInsert);
            
            // Test batch insert performance
            const batchSize = 100;
            const { duration: batchInsertTime } = await performanceMonitor.measureTime('database', 'batch-insert', async () => {
                const insertStmt = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                const transaction = db.transaction((pois) => {
                    for (const poi of pois) {
                        insertStmt.run(
                            poi.fileId, poi.filePath, poi.name, poi.type, poi.startLine, poi.endLine,
                            poi.description, poi.isExported, poi.semanticId, poi.runId
                        );
                    }
                });
                
                const fileId = 1;
                const poisToInsert = [];
                for (let i = 0; i < batchSize; i++) {
                    poisToInsert.push({
                        fileId,
                        filePath: 'batch-test.js',
                        name: `func_${i}`,
                        type: 'function',
                        startLine: i,
                        endLine: i + 1,
                        description: `Function ${i}`,
                        isExported: false,
                        semanticId: `func_${i}_semantic`,
                        runId: testRunId
                    });
                }
                
                return transaction(poisToInsert);
            });
            
            const batchTimePerItem = batchInsertTime / batchSize;
            expect(batchTimePerItem).toBeLessThan(PERFORMANCE_BENCHMARKS.database.batchInsert);
            
            console.log(`Single insert: ${singleInsertTime.toFixed(2)}ms, Batch insert: ${batchTimePerItem.toFixed(2)}ms per item`);
            console.log('✅ Database insert performance maintained');
        });

        test('should maintain query performance with semantic ID index', async () => {
            const db = dbManager.getDb();
            
            // Insert test data
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('query-perf-test.js', 'processed', testRunId).lastInsertRowid;
            
            const numRecords = 500;
            const insertStmt = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            const transaction = db.transaction((pois) => {
                for (const poi of pois) {
                    insertStmt.run(
                        poi.fileId, poi.filePath, poi.name, poi.type, poi.startLine, poi.endLine,
                        poi.description, poi.isExported, poi.semanticId, poi.runId
                    );
                }
            });
            
            const poisToInsert = [];
            for (let i = 0; i < numRecords; i++) {
                poisToInsert.push({
                    fileId,
                    filePath: 'query-perf-test.js',
                    name: `func_${i}`,
                    type: i % 3 === 0 ? 'function' : (i % 3 === 1 ? 'class' : 'variable'),
                    startLine: i,
                    endLine: i + 1,
                    description: `Item ${i}`,
                    isExported: i % 5 === 0,
                    semanticId: `item_${i}_semantic`,
                    runId: testRunId
                });
            }
            
            transaction(poisToInsert);
            
            // Test various query types
            const queryTests = [
                {
                    name: 'semantic-id-lookup',
                    query: 'SELECT * FROM pois WHERE semantic_id = ?',
                    params: ['item_250_semantic']
                },
                {
                    name: 'type-filter',
                    query: 'SELECT COUNT(*) as count FROM pois WHERE type = ? AND run_id = ?',
                    params: ['function', testRunId]
                },
                {
                    name: 'exported-filter',
                    query: 'SELECT COUNT(*) as count FROM pois WHERE is_exported = 1 AND run_id = ?',
                    params: [testRunId]
                },
                {
                    name: 'name-pattern',
                    query: 'SELECT COUNT(*) as count FROM pois WHERE name LIKE ? AND run_id = ?',
                    params: ['func_%', testRunId]
                }
            ];
            
            for (const test of queryTests) {
                const { duration } = await performanceMonitor.measureTime('database', test.name, async () => {
                    return db.prepare(test.query).all(...test.params);
                });
                
                expect(duration).toBeLessThan(PERFORMANCE_BENCHMARKS.database.indexedQuery);
                console.log(`${test.name}: ${duration.toFixed(2)}ms`);
            }
            
            console.log('✅ Query performance maintained with semantic ID index');
        });

        test('should handle migration performance without regression', async () => {
            // Create separate test database for migration test
            const migrationDbPath = path.join(testDataDir, 'migration-perf.db');
            const migrationDbManager = new DatabaseManager(migrationDbPath);
            await migrationDbManager.initializeDb();
            
            const migrationDb = migrationDbManager.getDb();
            
            // Insert test data before migration
            const fileId = migrationDb.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('migration-perf.js', 'processed', testRunId).lastInsertRowid;
            
            const numPois = 200;
            for (let i = 0; i < numPois; i++) {
                migrationDb.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'migration-perf.js', `func_${i}`, 'function', i, i + 1,
                    `Function ${i}`, false, testRunId
                );
            }
            
            // Clear semantic_id to simulate pre-migration state
            migrationDb.prepare('UPDATE pois SET semantic_id = NULL').run();
            
            // Measure migration performance
            const { Migration003: Migration003AddSemanticIdColumn } = require('../../migrations/003_add_semantic_id_column');
            const migration = new Migration003AddSemanticIdColumn(migrationDb);
            
            const { duration: migrationTime } = await performanceMonitor.measureTime('database', 'migration', async () => {
                return await migration.up(migrationDb);
            });
            
            expect(migrationTime).toBeLessThan(PERFORMANCE_BENCHMARKS.database.migration);
            
            // Verify migration completed correctly
            const migratedPois = migrationDb.prepare('SELECT COUNT(*) as count FROM pois WHERE semantic_id IS NOT NULL').get();
            expect(migratedPois.count).toBe(numPois);
            
            await migrationDbManager.close();
            console.log(`Migration of ${numPois} POIs: ${migrationTime.toFixed(2)}ms`);
            console.log('✅ Migration performance acceptable');
        });
    });

    describe('2. Worker Performance Benchmarks', () => {
        test('should maintain FileAnalysisWorker performance', async () => {
            const fileAnalysisWorker = new FileAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager,
                { processOnly: true }
            );
            
            // Create test files of varying sizes
            const testFiles = [
                { name: 'small.js', content: 'function small() { return true; }' },
                { name: 'medium.js', content: 'function medium() {\n' + '  console.log("test");\n'.repeat(20) + '}' },
                { name: 'large.js', content: 'function large() {\n' + '  const data = "x";\n'.repeat(100) + '}' }
            ];
            
            const db = dbManager.getDb();
            
            for (const testFile of testFiles) {
                const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                    .run(testFile.name, 'pending', testRunId).lastInsertRowid;
                
                const mockJob = {
                    data: {
                        fileId: fileId,
                        filePath: testFile.name,
                        content: testFile.content,
                        runId: testRunId
                    }
                };
                
                // Mock LLM response to avoid actual API calls in performance test
                const originalCreate = llmClient.chat.completions.create;
                llmClient.chat.completions.create = async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                entities: [
                                    {
                                        name: 'testFunction',
                                        type: 'function',
                                        startLine: 1,
                                        endLine: 5,
                                        description: 'Test function',
                                        isExported: false
                                    }
                                ],
                                relationships: []
                            })
                        }
                    }]
                });
                
                const { duration } = await performanceMonitor.measureTime('workers', `file-analysis-${testFile.name}`, async () => {
                    return await fileAnalysisWorker._analyzeFileContent(mockJob.data);
                });
                
                // Restore original LLM client
                llmClient.chat.completions.create = originalCreate;
                
                expect(duration).toBeLessThan(PERFORMANCE_BENCHMARKS.workers.fileAnalysis);
                console.log(`${testFile.name} analysis: ${duration.toFixed(2)}ms`);
            }
            
            console.log('✅ FileAnalysisWorker performance maintained');
        });

        test('should maintain ValidationWorker performance', async () => {
            const validationWorker = new ValidationWorker(
                queueManager, dbManager, workerPoolManager,
                { processOnly: true }
            );
            
            const db = dbManager.getDb();
            
            // Create test file with many POIs
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('validation-perf.js', 'processed', testRunId).lastInsertRowid;
            
            const numPois = 50;
            for (let i = 0; i < numPois; i++) {
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'validation-perf.js', `func_${i}`, 'function', i, i + 1,
                    `Function ${i}`, false, `func_${i}_semantic`, testRunId
                );
            }
            
            const validationJob = {
                data: {
                    fileId: fileId,
                    filePath: 'validation-perf.js',
                    runId: testRunId
                }
            };
            
            const { duration } = await performanceMonitor.measureTime('workers', 'validation', async () => {
                return await validationWorker.process(validationJob);
            });
            
            const avgTimePerPoi = duration / numPois;
            expect(avgTimePerPoi).toBeLessThan(PERFORMANCE_BENCHMARKS.workers.validation);
            
            console.log(`Validation of ${numPois} POIs: ${duration.toFixed(2)}ms (${avgTimePerPoi.toFixed(2)}ms per POI)`);
            console.log('✅ ValidationWorker performance maintained');
        });

        test('should maintain outbox processing performance', async () => {
            const db = dbManager.getDb();
            
            // Create test data
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('outbox-perf.js', 'processed', testRunId).lastInsertRowid;
            
            const poi1Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'outbox-perf.js', 'funcA', 'function', 1, 5,
                'Function A', false, 'func_a_semantic', testRunId
            ).lastInsertRowid;
            
            const poi2Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'outbox-perf.js', 'funcB', 'function', 10, 15,
                'Function B', false, 'func_b_semantic', testRunId
            ).lastInsertRowid;
            
            // Create multiple outbox events
            const numEvents = 20;
            for (let i = 0; i < numEvents; i++) {
                const relationshipPayload = {
                    type: 'relationship-creation',
                    source: 'PerformanceTest',
                    runId: testRunId,
                    relationships: [
                        {
                            id: `perf-rel-${i}`,
                            from: 'funcA',
                            to: 'funcB',
                            type: 'CALLS',
                            reason: `Performance test relationship ${i}`,
                            confidence: 0.8
                        }
                    ]
                };
                
                db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                    .run('relationship-creation', JSON.stringify(relationshipPayload), 'PENDING', testRunId);
            }
            
            const { duration } = await performanceMonitor.measureTime('workers', 'outbox-processing', async () => {
                return await outboxPublisher.pollAndPublish();
            });
            
            const avgTimePerEvent = duration / numEvents;
            expect(avgTimePerEvent).toBeLessThan(PERFORMANCE_BENCHMARKS.workers.outboxProcessing);
            
            // Verify events were processed
            const processedEvents = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ? AND run_id = ?')
                .all('PROCESSED', testRunId);
            expect(processedEvents[0].count).toBe(numEvents);
            
            console.log(`Processed ${numEvents} outbox events: ${duration.toFixed(2)}ms (${avgTimePerEvent.toFixed(2)}ms per event)`);
            console.log('✅ Outbox processing performance maintained');
        });
    });

    describe('3. Neo4j Performance Benchmarks', () => {
        test('should maintain Neo4j node creation performance with timeouts', async () => {
            const batchSize = 50;
            const testNodes = [];
            
            for (let i = 0; i < batchSize; i++) {
                testNodes.push({
                    nodeId: `perf_node_${i}`,
                    name: `PerfNode_${i}`,
                    type: 'function',
                    filePath: 'perf-test.js',
                    runId: testRunId,
                    properties: {
                        description: `Performance test node ${i}`,
                        startLine: i,
                        endLine: i + 1,
                        isExported: false
                    }
                });
            }
            
            const { duration } = await performanceMonitor.measureTime('neo4j', 'node-creation', async () => {
                const session = neo4jDriver.session();
                try {
                    return await session.writeTransaction(async (tx) => {
                        const query = `
                            UNWIND $nodes as node
                            CREATE (n:POI {
                                nodeId: node.nodeId,
                                name: node.name,
                                type: node.type,
                                filePath: node.filePath,
                                runId: node.runId,
                                description: node.properties.description,
                                startLine: node.properties.startLine,
                                endLine: node.properties.endLine,
                                isExported: node.properties.isExported
                            })
                            RETURN count(n) as created
                        `;
                        
                        const result = await tx.run(query, { nodes: testNodes });
                        return result.records[0].get('created').low;
                    }, { 
                        timeout: 30000,
                        metadata: { operation: 'performance-test-node-creation' }
                    });
                } finally {
                    await session.close();
                }
            });
            
            expect(duration).toBeLessThan(PERFORMANCE_BENCHMARKS.neo4j.nodeCreation);
            
            // Verify nodes were created
            const session = neo4jDriver.session();
            try {
                const result = await session.run(
                    'MATCH (n:POI) WHERE n.runId = $runId RETURN count(n) as count',
                    { runId: testRunId }
                );
                const nodeCount = result.records[0].get('count').low;
                expect(nodeCount).toBe(batchSize);
            } finally {
                await session.close();
            }
            
            console.log(`Created ${batchSize} Neo4j nodes: ${duration.toFixed(2)}ms`);
            console.log('✅ Neo4j node creation performance maintained');
        });

        test('should maintain Neo4j query performance with timeouts', async () => {
            // First create some test data
            const session = neo4jDriver.session();
            try {
                await session.writeTransaction(async (tx) => {
                    const query = `
                        CREATE (n1:POI {nodeId: 'query_test_1', name: 'QueryTest1', type: 'function', runId: $runId})
                        CREATE (n2:POI {nodeId: 'query_test_2', name: 'QueryTest2', type: 'class', runId: $runId})
                        CREATE (n3:POI {nodeId: 'query_test_3', name: 'QueryTest3', type: 'variable', runId: $runId})
                        CREATE (n1)-[:CALLS]->(n2)
                        CREATE (n2)-[:USES]->(n3)
                        RETURN count(n1) + count(n2) + count(n3) as total
                    `;
                    
                    return await tx.run(query, { runId: testRunId });
                }, { timeout: 10000 });
            } finally {
                await session.close();
            }
            
            // Test various query types
            const queryTests = [
                {
                    name: 'simple-match',
                    query: 'MATCH (n:POI) WHERE n.runId = $runId RETURN count(n) as count',
                    params: { runId: testRunId }
                },
                {
                    name: 'relationship-query',
                    query: 'MATCH (n1:POI)-[r]->(n2:POI) WHERE n1.runId = $runId RETURN count(r) as count',
                    params: { runId: testRunId }
                },
                {
                    name: 'filtered-query',
                    query: 'MATCH (n:POI) WHERE n.runId = $runId AND n.type = $type RETURN count(n) as count',
                    params: { runId: testRunId, type: 'function' }
                }
            ];
            
            for (const test of queryTests) {
                const { duration } = await performanceMonitor.measureTime('neo4j', test.name, async () => {
                    const session = neo4jDriver.session();
                    try {
                        return await session.readTransaction(async (tx) => {
                            return await tx.run(test.query, test.params);
                        }, { 
                            timeout: 10000,
                            metadata: { operation: `performance-test-${test.name}` }
                        });
                    } finally {
                        await session.close();
                    }
                });
                
                expect(duration).toBeLessThan(PERFORMANCE_BENCHMARKS.neo4j.query);
                console.log(`${test.name}: ${duration.toFixed(2)}ms`);
            }
            
            console.log('✅ Neo4j query performance maintained');
        });

        test('should not hang on Neo4j timeout scenarios', async () => {
            // This test ensures timeouts work correctly and don't cause hanging
            const startTime = performance.now();
            
            try {
                const { duration } = await performanceMonitor.measureTime('neo4j', 'timeout-handling', async () => {
                    const session = neo4jDriver.session();
                    try {
                        // Create a query that might take time but should timeout gracefully
                        return await session.writeTransaction(async (tx) => {
                            const query = `
                                WITH range(1, 1000) as numbers
                                UNWIND numbers as num
                                CREATE (n:TimeoutTest {
                                    id: num,
                                    runId: $runId,
                                    data: toString(num * num),
                                    timestamp: timestamp()
                                })
                                RETURN count(n) as created
                            `;
                            
                            return await tx.run(query, { runId: testRunId });
                        }, { 
                            timeout: 5000, // Short timeout for testing
                            metadata: { operation: 'timeout-test' }
                        });
                    } finally {
                        await session.close();
                    }
                });
                
                console.log(`Timeout test completed in ${duration.toFixed(2)}ms`);
                
            } catch (error) {
                const totalTime = performance.now() - startTime;
                console.log(`Timeout test failed gracefully after ${totalTime.toFixed(2)}ms: ${error.message}`);
                
                // Should timeout within reasonable bounds (not hang)
                expect(totalTime).toBeLessThan(PERFORMANCE_BENCHMARKS.neo4j.transactionTimeout);
                
                // Should be a timeout-related error
                expect(error.message.toLowerCase()).toMatch(/(timeout|timed out|transaction|connection)/);
            }
            
            console.log('✅ Neo4j timeout handling working correctly');
        });
    });

    describe('4. Memory Usage Benchmarks', () => {
        test('should maintain reasonable memory usage during processing', async () => {
            const initialMemory = process.memoryUsage();
            console.log('Initial memory usage:', {
                heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB',
                rss: Math.round(initialMemory.rss / 1024 / 1024) + 'MB'
            });
            
            // Perform memory-intensive operations
            await performanceMonitor.measureTime('memory', 'bulk-processing', async () => {
                const db = dbManager.getDb();
                
                // Create large dataset
                const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                    .run('memory-test.js', 'processed', testRunId).lastInsertRowid;
                
                const batchSize = 1000;
                const insertStmt = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                const transaction = db.transaction((pois) => {
                    for (const poi of pois) {
                        insertStmt.run(
                            poi.fileId, poi.filePath, poi.name, poi.type, poi.startLine, poi.endLine,
                            poi.description, poi.isExported, poi.semanticId, poi.runId
                        );
                    }
                });
                
                const poisToInsert = [];
                for (let i = 0; i < batchSize; i++) {
                    poisToInsert.push({
                        fileId,
                        filePath: 'memory-test.js',
                        name: `memFunc_${i}`,
                        type: 'function',
                        startLine: i,
                        endLine: i + 1,
                        description: `Memory test function ${i} with some longer description text to use more memory`,
                        isExported: false,
                        semanticId: `mem_func_${i}_semantic_id`,
                        runId: testRunId
                    });
                }
                
                transaction(poisToInsert);
                
                // Process data with semantic identity service
                const semanticService = new SemanticIdentityService();
                const existingIds = db.prepare('SELECT semantic_id FROM pois WHERE run_id = ?').all(testRunId);
                semanticService.importExistingIds(existingIds.map(row => row.semantic_id));
                
                // Generate additional semantic IDs (memory intensive)
                for (let i = 0; i < 100; i++) {
                    const poiData = {
                        name: `additionalFunc_${i}`,
                        type: 'function',
                        start_line: i,
                        end_line: i + 1,
                        description: `Additional function ${i}`,
                        is_exported: false
                    };
                    semanticService.generateSemanticId('memory-test.js', poiData);
                }
                
                return batchSize;
            });
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = process.memoryUsage();
            const memoryDelta = {
                heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
                rss: finalMemory.rss - initialMemory.rss
            };
            
            console.log('Final memory usage:', {
                heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024) + 'MB',
                rss: Math.round(finalMemory.rss / 1024 / 1024) + 'MB'
            });
            
            console.log('Memory delta:', {
                heapUsed: Math.round(memoryDelta.heapUsed / 1024 / 1024) + 'MB',
                rss: Math.round(memoryDelta.rss / 1024 / 1024) + 'MB'
            });
            
            // Memory usage should stay within reasonable bounds
            expect(finalMemory.heapUsed).toBeLessThan(PERFORMANCE_BENCHMARKS.memory.maxHeapUsed);
            expect(finalMemory.rss).toBeLessThan(PERFORMANCE_BENCHMARKS.memory.maxRss);
            
            console.log('✅ Memory usage within acceptable bounds');
        });
    });

    describe('5. End-to-End Performance Benchmarks', () => {
        test('should maintain overall pipeline performance', async () => {
            // Create comprehensive test data
            const testFiles = await createPerformanceTestFiles(testDataDir);
            
            const { duration: e2eDuration } = await performanceMonitor.measureTime('workers', 'e2e-pipeline', async () => {
                // Phase 1: EntityScout
                const entityScout = new EntityScout(queueManager, dbManager, { processOnly: true });
                await entityScout.run(testDataDir, { runId: testRunId });
                
                // Phase 2: Process file analysis jobs
                const fileWorker = new FileAnalysisWorker(queueManager, dbManager, llmClient, workerPoolManager, { processOnly: true });
                const fileAnalysisQueue = queueManager.getQueue('file-analysis-queue');
                
                // Mock LLM responses for performance testing
                const originalCreate = llmClient.chat.completions.create;
                llmClient.chat.completions.create = async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                entities: [
                                    { name: 'testFunc', type: 'function', startLine: 1, endLine: 5, description: 'Test', isExported: false }
                                ],
                                relationships: []
                            })
                        }
                    }]
                });
                
                let processedJobs = 0;
                while (processedJobs < 10) { // Process up to 10 jobs
                    const job = await fileAnalysisQueue.getNextJob();
                    if (!job) break;
                    
                    await fileWorker.process(job);
                    await job.moveToCompleted();
                    processedJobs++;
                }
                
                llmClient.chat.completions.create = originalCreate;
                
                // Phase 3: Process outbox events
                await outboxPublisher.pollAndPublish();
                
                return processedJobs;
            });
            
            console.log(`End-to-end pipeline processing: ${e2eDuration.toFixed(2)}ms`);
            
            // Verify results
            const db = dbManager.getDb();
            const files = db.prepare('SELECT COUNT(*) as count FROM files WHERE run_id = ?').get(testRunId);
            const pois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(testRunId);
            
            console.log(`Processed ${files.count} files, created ${pois.count} POIs`);
            
            // Performance should be reasonable for the amount of work done
            expect(e2eDuration).toBeLessThan(30000); // 30 seconds max for test data
            
            console.log('✅ End-to-end pipeline performance acceptable');
        });
    });

    // Helper function to create performance test files
    async function createPerformanceTestFiles(baseDir) {
        const testFiles = [
            {
                path: 'src/performance1.js',
                content: `
function performanceTest1() {
    const data = [];
    for (let i = 0; i < 100; i++) {
        data.push({ id: i, name: 'item_' + i });
    }
    return data;
}

class PerformanceClass {
    constructor() {
        this.items = [];
    }
    
    addItem(item) {
        this.items.push(item);
    }
}

const PERFORMANCE_CONSTANT = 'test_value';
module.exports = { performanceTest1, PerformanceClass, PERFORMANCE_CONSTANT };
`
            },
            {
                path: 'src/performance2.js',
                content: `
const { performanceTest1 } = require('./performance1');

function performanceTest2() {
    const data = performanceTest1();
    return data.map(item => ({ ...item, processed: true }));
}

function calculateSum(numbers) {
    return numbers.reduce((sum, num) => sum + num, 0);
}

module.exports = { performanceTest2, calculateSum };
`
            }
        ];
        
        for (const file of testFiles) {
            const fullPath = path.join(baseDir, file.path);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, file.content.trim());
        }
        
        return testFiles;
    }
});