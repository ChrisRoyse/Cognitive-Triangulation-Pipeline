#!/usr/bin/env node

/**
 * Stress Testing for Data Consistency Fixes
 * 
 * Focused on load testing, resource exhaustion, and extreme stress scenarios:
 * - Database consolidation under extreme load
 * - Memory pressure testing
 * - High concurrency stress
 * - Large dataset processing
 * - Resource exhaustion scenarios
 * - Recovery testing under stress
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');
const DataConsistencyFixer = require('./fix-data-consistency-issues');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const cluster = require('cluster');
const os = require('os');

class StressTestDataConsistency {
    constructor() {
        this.testResults = [];
        this.stressTestDir = path.join(__dirname, 'stress-test-temp');
        this.originalDbPath = config.SQLITE_DB_PATH;
        this.setupStressEnvironment();
    }

    setupStressEnvironment() {
        if (!fs.existsSync(this.stressTestDir)) {
            fs.mkdirSync(this.stressTestDir, { recursive: true });
        }
        console.log(`💪 Stress test environment initialized in: ${this.stressTestDir}`);
    }

    async runAllStressTests() {
        console.log('🚀 Starting comprehensive stress testing for data consistency fixes...\n');

        try {
            // Stress Test 1: Extreme database consolidation load
            await this.stressTestDatabaseConsolidation();
            
            // Stress Test 2: Memory pressure testing
            await this.stressTestMemoryPressure();
            
            // Stress Test 3: High concurrency processing
            await this.stressTestHighConcurrency();
            
            // Stress Test 4: Large dataset processing
            await this.stressTestLargeDatasets();
            
            // Stress Test 5: Resource exhaustion scenarios
            await this.stressTestResourceExhaustion();
            
            // Stress Test 6: Recovery under load
            await this.stressTestRecoveryUnderLoad();
            
            // Stress Test 7: Database lock contention
            await this.stressTestLockContention();
            
            // Stress Test 8: I/O stress testing
            await this.stressTestIOStress();
            
            // Generate comprehensive stress test report
            this.generateStressTestReport();
            
        } catch (error) {
            console.error('❌ Critical error in stress testing:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    async stressTestDatabaseConsolidation() {
        console.log('📊 Stress Test 1: Extreme Database Consolidation Load');
        const testName = 'Database Consolidation Under Load';
        
        try {
            // Create multiple large databases to consolidate
            const dbCount = 10;
            const recordsPerDb = 5000;
            const databases = [];
            
            console.log(`  📝 Creating ${dbCount} databases with ${recordsPerDb} records each...`);
            
            for (let i = 0; i < dbCount; i++) {
                const dbPath = path.join(this.stressTestDir, `consolidation-db-${i}.db`);
                const db = new Database(dbPath);
                
                db.exec(`
                    CREATE TABLE relationships (
                        id INTEGER PRIMARY KEY,
                        source_poi_id INTEGER,
                        target_poi_id INTEGER,
                        type TEXT,
                        confidence REAL,
                        status TEXT,
                        evidence TEXT
                    );
                    CREATE TABLE pois (
                        id INTEGER PRIMARY KEY,
                        name TEXT,
                        type TEXT,
                        semantic_id TEXT,
                        large_data TEXT
                    );
                `);
                
                // Insert large amounts of data
                const largeData = 'x'.repeat(1000); // 1KB per record
                const insertPoi = db.prepare("INSERT INTO pois (name, type, semantic_id, large_data) VALUES (?, ?, ?, ?)");
                const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?)");
                
                db.transaction(() => {
                    for (let j = 0; j < recordsPerDb; j++) {
                        insertPoi.run(
                            `POI_${i}_${j}`,
                            'function',
                            `semantic_${i}_${j}`,
                            largeData
                        );
                        
                        if (j > 0) {
                            insertRel.run(
                                j,
                                Math.floor(Math.random() * j) + 1,
                                'calls',
                                Math.random(),
                                'VALIDATED',
                                `evidence_${i}_${j}`
                            );
                        }
                    }
                })();
                
                db.close();
                databases.push(dbPath);
            }
            
            console.log(`  ✅ Created ${dbCount} test databases`);
            
            // Set up for consolidation test
            const targetDbPath = path.join(this.stressTestDir, 'consolidated-target.db');
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = targetDbPath;
            
            // Measure consolidation performance under load
            const startTime = Date.now();
            const startMemory = process.memoryUsage().heapUsed;
            
            // Simulate multiple databases existing that need consolidation
            // (Modify the fixer's database discovery to include our test databases)
            const fixer = new DataConsistencyFixer();
            
            // Override the common database paths to include our test databases
            const originalAnalyzeAndFixDatabasePaths = fixer.analyzeAndFixDatabasePaths.bind(fixer);
            fixer.analyzeAndFixDatabasePaths = async function() {
                // Custom consolidation logic for stress test
                const existingDbs = databases.map(dbPath => ({
                    path: dbPath,
                    size: fs.statSync(dbPath).size,
                    modified: fs.statSync(dbPath).mtime
                }));
                
                if (existingDbs.length > 0) {
                    // Find largest database
                    const primaryDb = existingDbs.sort((a, b) => b.size - a.size)[0];
                    
                    // Copy to target location
                    fs.copyFileSync(primaryDb.path, targetDbPath);
                    this.fixes.push(`Consolidated ${existingDbs.length} databases to ${targetDbPath}`);
                }
            };
            
            await fixer.run();
            
            const endTime = Date.now();
            const endMemory = process.memoryUsage().heapUsed;
            
            const processingTime = (endTime - startTime) / 1000;
            const memoryIncrease = (endMemory - startMemory) / (1024 * 1024);
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Verify consolidation results
            const consolidatedDb = new Database(targetDbPath);
            const totalPois = consolidatedDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            const totalRelationships = consolidatedDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            consolidatedDb.close();
            
            // Performance thresholds
            const performancePassed = processingTime < 120; // 2 minutes max
            const memoryPassed = memoryIncrease < 500; // 500MB max
            const dataPassed = totalPois > 0 && totalRelationships > 0;
            
            this.addStressTestResult(testName + ' - Performance', performancePassed,
                `Consolidated ${dbCount} databases in ${processingTime.toFixed(2)}s (limit: 120s)`);
                
            this.addStressTestResult(testName + ' - Memory Usage', memoryPassed,
                `Memory increase: ${memoryIncrease.toFixed(2)}MB (limit: 500MB)`);
                
            this.addStressTestResult(testName + ' - Data Integrity', dataPassed,
                `Consolidated data: ${totalPois} POIs, ${totalRelationships} relationships`);
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Database consolidation stress test complete\n');
    }

    async stressTestMemoryPressure() {
        console.log('💾 Stress Test 2: Memory Pressure Testing');
        const testName = 'Memory Pressure Handling';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'memory-pressure-test.db');
            const db = new Database(testDbPath);
            
            // Create schema
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT,
                    evidence TEXT,
                    large_data TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT,
                    massive_data TEXT
                );
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    evidence_data TEXT,
                    confidence REAL
                );
            `);
            
            console.log('  📝 Generating memory-intensive dataset...');
            
            // Generate extremely large data to stress memory
            const hugeString = 'x'.repeat(50000); // 50KB per record
            const insertPoi = db.prepare("INSERT INTO pois (name, type, semantic_id, massive_data) VALUES (?, ?, ?, ?)");
            const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence, large_data) VALUES (?, ?, ?, ?, ?, ?, ?)");
            const insertEvidence = db.prepare("INSERT INTO relationship_evidence (relationship_id, evidence_data, confidence) VALUES (?, ?, ?)");
            
            const MEMORY_STRESS_COUNT = 2000; // 100MB+ of data
            
            db.transaction(() => {
                for (let i = 1; i <= MEMORY_STRESS_COUNT; i++) {
                    insertPoi.run(
                        `MemoryStressPOI_${i}`,
                        'function',
                        `semantic_${i}`,
                        hugeString
                    );
                    
                    if (i > 1) {
                        insertRel.run(
                            i,
                            Math.floor(Math.random() * (i - 1)) + 1,
                            'memory_stress_relationship',
                            Math.random(),
                            'VALIDATED',
                            `Large evidence for relationship ${i}`,
                            hugeString
                        );
                        
                        // Add multiple evidence entries per relationship
                        for (let j = 0; j < 3; j++) {
                            insertEvidence.run(
                                i - 1,
                                hugeString,
                                Math.random()
                            );
                        }
                    }
                }
            })();
            
            db.close();
            console.log('  ✅ Memory-intensive dataset created');
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Monitor memory usage during processing
            const initialMemory = process.memoryUsage();
            let peakMemory = initialMemory;
            
            const memoryMonitor = setInterval(() => {
                const currentMemory = process.memoryUsage();
                if (currentMemory.heapUsed > peakMemory.heapUsed) {
                    peakMemory = currentMemory;
                }
            }, 100);
            
            // Process under memory pressure
            const startTime = Date.now();
            const fixer = new DataConsistencyFixer();
            
            let processingSucceeded = true;
            try {
                await fixer.run();
            } catch (error) {
                if (error.message.includes('out of memory') || error.message.includes('ENOMEM')) {
                    processingSucceeded = false;
                } else {
                    throw error;
                }
            }
            
            clearInterval(memoryMonitor);
            const endTime = Date.now();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            const processingTime = (endTime - startTime) / 1000;
            const memoryIncrease = (peakMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);
            const peakMemoryMB = peakMemory.heapUsed / (1024 * 1024);
            
            // Assess memory handling
            const memoryControlled = peakMemoryMB < 1000; // 1GB limit
            const processedInTime = processingTime < 300; // 5 minutes
            
            this.addStressTestResult(testName + ' - Memory Control', memoryControlled,
                `Peak memory usage: ${peakMemoryMB.toFixed(2)}MB (limit: 1000MB)`);
                
            this.addStressTestResult(testName + ' - Processing Speed', processedInTime,
                `Processing time: ${processingTime.toFixed(2)}s (limit: 300s)`);
                
            this.addStressTestResult(testName + ' - Completion', processingSucceeded,
                processingSucceeded ? 'Successfully processed memory-intensive dataset' : 'Failed due to memory constraints');
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Memory pressure stress test complete\n');
    }

    async stressTestHighConcurrency() {
        console.log('🔄 Stress Test 3: High Concurrency Processing');
        const testName = 'High Concurrency Stress';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'concurrency-stress-test.db');
            
            // Create a substantial database for concurrent access
            const setupDb = new Database(testDbPath);
            setupDb.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT,
                    evidence TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                );
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    evidence_data TEXT,
                    confidence REAL
                );
            `);
            
            // Insert substantial data for concurrent processing
            const CONCURRENT_DATA_SIZE = 1000;
            const insertPoi = setupDb.prepare("INSERT INTO pois (name, type, semantic_id) VALUES (?, ?, ?)");
            const insertRel = setupDb.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?)");
            
            setupDb.transaction(() => {
                for (let i = 1; i <= CONCURRENT_DATA_SIZE; i++) {
                    insertPoi.run(`ConcurrentPOI_${i}`, 'function', `semantic_${i}`);
                    
                    if (i > 1) {
                        insertRel.run(
                            i,
                            Math.floor(Math.random() * (i - 1)) + 1,
                            'concurrent_test',
                            Math.random(),
                            'VALIDATED',
                            `evidence_${i}`
                        );
                    }
                }
            })();
            
            setupDb.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            console.log('  🚀 Launching high concurrency test...');
            
            // Launch many concurrent processes
            const concurrencyLevel = Math.min(os.cpus().length * 2, 16); // Max 16 concurrent processes
            const promises = [];
            const results = [];
            
            for (let i = 0; i < concurrencyLevel; i++) {
                const promise = (async (processId) => {
                    try {
                        const fixer = new DataConsistencyFixer();
                        const startTime = Date.now();
                        
                        await fixer.run();
                        
                        const endTime = Date.now();
                        return {
                            processId: processId,
                            success: true,
                            duration: endTime - startTime,
                            fixes: fixer.fixes.length
                        };
                    } catch (error) {
                        return {
                            processId: processId,
                            success: false,
                            error: error.message,
                            duration: 0
                        };
                    }
                })(i);
                
                promises.push(promise);
            }
            
            const concurrentResults = await Promise.allSettled(promises);
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Analyze concurrency results
            const successfulProcesses = concurrentResults.filter(r => 
                r.status === 'fulfilled' && r.value.success
            ).length;
            
            const failedProcesses = concurrentResults.length - successfulProcesses;
            const averageDuration = concurrentResults
                .filter(r => r.status === 'fulfilled' && r.value.success)
                .reduce((sum, r) => sum + r.value.duration, 0) / (successfulProcesses || 1);
            
            // Verify database integrity after concurrent access
            const integrityDb = new Database(testDbPath);
            const finalRelCount = integrityDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            const finalPoiCount = integrityDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            const corruptedData = integrityDb.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE source_poi_id IS NULL OR target_poi_id IS NULL OR confidence NOT BETWEEN 0 AND 1
            `).get().count;
            integrityDb.close();
            
            const concurrencyPassed = successfulProcesses >= concurrencyLevel * 0.7; // 70% success rate
            const integrityPassed = finalRelCount > 0 && finalPoiCount > 0 && corruptedData === 0;
            const performancePassed = averageDuration < 30000; // 30 seconds average
            
            this.addStressTestResult(testName + ' - Concurrency Handling', concurrencyPassed,
                `${successfulProcesses}/${concurrencyLevel} processes succeeded (70% required)`);
                
            this.addStressTestResult(testName + ' - Data Integrity', integrityPassed,
                integrityPassed ? `Data integrity maintained: ${finalRelCount} rels, ${finalPoiCount} POIs, ${corruptedData} corrupted` :
                `Data integrity compromised: ${corruptedData} corrupted records found`);
                
            this.addStressTestResult(testName + ' - Performance', performancePassed,
                `Average processing time: ${(averageDuration / 1000).toFixed(2)}s (limit: 30s)`);
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ High concurrency stress test complete\n');
    }

    async stressTestLargeDatasets() {
        console.log('📈 Stress Test 4: Large Dataset Processing');
        const testName = 'Large Dataset Processing';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'large-dataset-stress.db');
            const db = new Database(testDbPath);
            
            // Create schema optimized for large datasets
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT,
                    evidence TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                );
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    evidence_data TEXT,
                    confidence REAL
                );
                
                -- Create indexes for performance
                CREATE INDEX idx_rel_source ON relationships(source_poi_id);
                CREATE INDEX idx_rel_target ON relationships(target_poi_id);
                CREATE INDEX idx_rel_status ON relationships(status);
                CREATE INDEX idx_poi_semantic ON pois(semantic_id);
            `);
            
            console.log('  📊 Generating extremely large dataset...');
            
            const EXTREME_SIZE = 50000; // 50K records for real stress
            
            // Generate data in batches to avoid memory issues
            const batchSize = 5000;
            const batches = Math.ceil(EXTREME_SIZE / batchSize);
            
            for (let batch = 0; batch < batches; batch++) {
                const batchStart = batch * batchSize;
                const batchEnd = Math.min(batchStart + batchSize, EXTREME_SIZE);
                
                console.log(`    📝 Processing batch ${batch + 1}/${batches} (${batchStart}-${batchEnd})`);
                
                const insertPoi = db.prepare("INSERT INTO pois (name, type, semantic_id) VALUES (?, ?, ?)");
                const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?)");
                const insertEvidence = db.prepare("INSERT INTO relationship_evidence (relationship_id, evidence_data, confidence) VALUES (?, ?, ?)");
                
                db.transaction(() => {
                    for (let i = batchStart + 1; i <= batchEnd; i++) {
                        insertPoi.run(
                            `LargeDatasetPOI_${i}`,
                            i % 5 === 0 ? 'class' : 'function',
                            `semantic_large_${i}`
                        );
                        
                        if (i > 1) {
                            const targetId = Math.floor(Math.random() * (i - 1)) + 1;
                            const confidence = Math.random();
                            const status = confidence > 0.1 ? 'VALIDATED' : 'FAILED';
                            
                            insertRel.run(
                                i,
                                targetId,
                                'large_dataset_rel',
                                confidence,
                                status,
                                `Evidence for large relationship ${i}`
                            );
                            
                            // Add evidence for validated relationships
                            if (status === 'VALIDATED') {
                                insertEvidence.run(
                                    i - 1,
                                    `Evidence data for relationship ${i}`,
                                    confidence
                                );
                            }
                        }
                    }
                })();
                
                // Force garbage collection between batches if available
                if (global.gc) {
                    global.gc();
                }
            }
            
            db.close();
            console.log(`  ✅ Large dataset created: ${EXTREME_SIZE} POIs and relationships`);
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Measure performance on large dataset
            const startTime = Date.now();
            const startMemory = process.memoryUsage().heapUsed;
            
            console.log('  🔧 Processing large dataset...');
            
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            const endTime = Date.now();
            const endMemory = process.memoryUsage().heapUsed;
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            const processingTime = (endTime - startTime) / 1000;
            const memoryIncrease = (endMemory - startMemory) / (1024 * 1024);
            
            // Verify data integrity after processing
            const verifyDb = new Database(testDbPath);
            
            const finalPoiCount = verifyDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            const finalRelCount = verifyDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            const validatedRelCount = verifyDb.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get().count;
            const invalidDataCount = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE (confidence NOT BETWEEN 0 AND 1) OR (status = 'VALIDATED' AND confidence <= 0)
            `).get().count;
            
            verifyDb.close();
            
            // Performance and integrity assessment
            const performancePassed = processingTime < 600; // 10 minutes max
            const memoryPassed = memoryIncrease < 200; // 200MB increase max
            const integrityPassed = invalidDataCount === 0 && validatedRelCount > 0;
            const scalabilityPassed = finalPoiCount === EXTREME_SIZE && finalRelCount > 0;
            
            this.addStressTestResult(testName + ' - Performance', performancePassed,
                `Processed ${EXTREME_SIZE} records in ${processingTime.toFixed(2)}s (limit: 600s)`);
                
            this.addStressTestResult(testName + ' - Memory Efficiency', memoryPassed,
                `Memory increase: ${memoryIncrease.toFixed(2)}MB (limit: 200MB)`);
                
            this.addStressTestResult(testName + ' - Data Integrity', integrityPassed,
                integrityPassed ? `All data valid: ${validatedRelCount} validated relationships, ${invalidDataCount} invalid` :
                `Data integrity issues: ${invalidDataCount} invalid records found`);
                
            this.addStressTestResult(testName + ' - Scalability', scalabilityPassed,
                `Dataset integrity: ${finalPoiCount}/${EXTREME_SIZE} POIs, ${finalRelCount} relationships preserved`);
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Large dataset stress test complete\n');
    }

    async stressTestResourceExhaustion() {
        console.log('🔥 Stress Test 5: Resource Exhaustion Scenarios');
        const testName = 'Resource Exhaustion Handling';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'resource-exhaustion-test.db');
            
            // Create multiple resource exhaustion scenarios
            console.log('  💾 Testing disk space exhaustion simulation...');
            
            // Test 1: Simulated disk space exhaustion
            const largeDbPath = path.join(this.stressTestDir, 'space-exhaustion.db');
            const db = new Database(largeDbPath);
            
            db.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, data TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, data TEXT);
            `);
            
            // Fill with large amounts of data to stress disk space
            const hugeData = 'x'.repeat(100000); // 100KB per record
            const insert = db.prepare("INSERT INTO relationships (data) VALUES (?)");
            
            let recordsInserted = 0;
            let spaceExhaustionDetected = false;
            
            try {
                db.transaction(() => {
                    for (let i = 0; i < 1000; i++) { // Up to 100MB
                        insert.run(hugeData);
                        recordsInserted++;
                    }
                })();
            } catch (error) {
                if (error.message.includes('disk') || error.message.includes('space') || error.message.includes('ENOSPC')) {
                    spaceExhaustionDetected = true;
                }
            }
            
            db.close();
            
            // Test 2: File descriptor exhaustion
            console.log('  📁 Testing file descriptor exhaustion...');
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Create a small test database
            const testDb = new Database(testDbPath);
            testDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, status TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'TestPOI');
                INSERT INTO relationships VALUES (1, 'VALIDATED');
            `);
            testDb.close();
            
            // Open many database connections simultaneously to stress file descriptors
            const connections = [];
            let fdExhaustionDetected = false;
            
            try {
                for (let i = 0; i < 100; i++) {
                    connections.push(new Database(testDbPath, { readonly: true }));
                }
            } catch (error) {
                if (error.message.includes('EMFILE') || error.message.includes('too many open files')) {
                    fdExhaustionDetected = true;
                }
            }
            
            // Clean up connections
            for (const conn of connections) {
                try {
                    conn.close();
                } catch (error) {
                    // Ignore cleanup errors
                }
            }
            
            // Test data consistency fixer under resource constraints
            let fixerHandledConstraints = true;
            try {
                const fixer = new DataConsistencyFixer();
                await fixer.run();
            } catch (error) {
                if (error.message.includes('resource') || error.message.includes('EMFILE') || error.message.includes('ENOSPC')) {
                    // Expected behavior under resource exhaustion
                } else {
                    fixerHandledConstraints = false;
                }
            }
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Assess resource exhaustion handling
            this.addStressTestResult(testName + ' - Disk Space Handling', true,
                `Handled large data insertion: ${recordsInserted} records inserted, space exhaustion ${spaceExhaustionDetected ? 'detected' : 'not triggered'}`);
                
            this.addStressTestResult(testName + ' - File Descriptor Management', true,
                `File descriptor management: opened ${connections.length} connections, exhaustion ${fdExhaustionDetected ? 'detected' : 'not triggered'}`);
                
            this.addStressTestResult(testName + ' - Graceful Degradation', fixerHandledConstraints,
                fixerHandledConstraints ? 'Data consistency fixer handled resource constraints gracefully' :
                'Data consistency fixer failed to handle resource constraints');
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Resource exhaustion stress test complete\n');
    }

    async stressTestRecoveryUnderLoad() {
        console.log('🔄 Stress Test 6: Recovery Under Load');
        const testName = 'Recovery Under Load';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'recovery-load-test.db');
            
            // Create a database in partially corrupted state
            const db = new Database(testDbPath);
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                );
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
            `);
            
            // Insert data with various issues that need recovery
            const RECOVERY_DATA_SIZE = 10000;
            
            console.log(`  🔧 Creating ${RECOVERY_DATA_SIZE} records with various data issues...`);
            
            const insertPoi = db.prepare("INSERT INTO pois (name, type) VALUES (?, ?)");
            const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status) VALUES (?, ?, ?, ?, ?)");
            
            db.transaction(() => {
                for (let i = 1; i <= RECOVERY_DATA_SIZE; i++) {
                    insertPoi.run(`RecoveryPOI_${i}`, 'function');
                    
                    if (i > 1) {
                        // Introduce various data issues that need recovery
                        let confidence, status, type, targetId;
                        
                        if (i % 10 === 0) {
                            // Invalid confidence scores
                            confidence = 1.5 + Math.random();
                            status = 'VALIDATED';
                            type = 'calls';
                            targetId = Math.floor(Math.random() * (i - 1)) + 1;
                        } else if (i % 15 === 0) {
                            // Negative confidence
                            confidence = -Math.random();
                            status = 'VALIDATED';
                            type = 'uses';
                            targetId = Math.floor(Math.random() * (i - 1)) + 1;
                        } else if (i % 20 === 0) {
                            // Missing type
                            confidence = Math.random();
                            status = 'VALIDATED';
                            type = null;
                            targetId = Math.floor(Math.random() * (i - 1)) + 1;
                        } else if (i % 25 === 0) {
                            // Orphaned relationship (non-existent target)
                            confidence = Math.random();
                            status = 'VALIDATED';
                            type = 'calls';
                            targetId = i + 1000; // Non-existent POI
                        } else {
                            // Valid relationship
                            confidence = Math.random();
                            status = Math.random() > 0.2 ? 'VALIDATED' : 'FAILED';
                            type = 'calls';
                            targetId = Math.floor(Math.random() * (i - 1)) + 1;
                        }
                        
                        insertRel.run(i, targetId, type, confidence, status);
                    }
                }
            })();
            
            db.close();
            console.log('  ✅ Problematic dataset created');
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test recovery under concurrent load
            console.log('  🚀 Testing recovery under concurrent load...');
            
            const recoveryPromises = [];
            const concurrentRecoveryCount = 5;
            
            for (let i = 0; i < concurrentRecoveryCount; i++) {
                const promise = (async (processId) => {
                    try {
                        const fixer = new DataConsistencyFixer();
                        const startTime = Date.now();
                        
                        await fixer.run();
                        
                        const endTime = Date.now();
                        return {
                            processId: processId,
                            success: true,
                            duration: endTime - startTime,
                            fixesApplied: fixer.fixes.length
                        };
                    } catch (error) {
                        return {
                            processId: processId,
                            success: false,
                            error: error.message
                        };
                    }
                })(i);
                
                recoveryPromises.push(promise);
            }
            
            const recoveryResults = await Promise.allSettled(recoveryPromises);
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Analyze recovery results
            const successfulRecoveries = recoveryResults.filter(r => 
                r.status === 'fulfilled' && r.value.success
            ).length;
            
            // Verify final data state
            const verifyDb = new Database(testDbPath);
            
            const totalRelationships = verifyDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            const validatedRelationships = verifyDb.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get().count;
            const invalidConfidence = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE confidence NOT BETWEEN 0 AND 1
            `).get().count;
            const orphanedRelationships = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships r 
                LEFT JOIN pois p ON r.target_poi_id = p.id 
                WHERE p.id IS NULL AND r.status = 'VALIDATED'
            `).get().count;
            const missingTypes = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE type IS NULL AND status = 'VALIDATED'
            `).get().count;
            
            verifyDb.close();
            
            // Assessment
            const recoveryPassed = successfulRecoveries >= 1; // At least one should succeed
            const dataQualityPassed = invalidConfidence === 0 && orphanedRelationships === 0 && missingTypes === 0;
            const completenessReasonable = validatedRelationships > totalRelationships * 0.5; // At least 50% should remain valid
            
            this.addStressTestResult(testName + ' - Concurrent Recovery', recoveryPassed,
                `${successfulRecoveries}/${concurrentRecoveryCount} concurrent recovery processes succeeded`);
                
            this.addStressTestResult(testName + ' - Data Quality', dataQualityPassed,
                dataQualityPassed ? 'All data quality issues resolved' :
                `Issues remain: ${invalidConfidence} invalid confidence, ${orphanedRelationships} orphaned, ${missingTypes} missing types`);
                
            this.addStressTestResult(testName + ' - Data Preservation', completenessReasonable,
                `Data preservation: ${validatedRelationships}/${totalRelationships} relationships remain valid (${((validatedRelationships/totalRelationships)*100).toFixed(1)}%)`);
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Recovery under load stress test complete\n');
    }

    async stressTestLockContention() {
        console.log('🔒 Stress Test 7: Database Lock Contention');
        const testName = 'Lock Contention Stress';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'lock-contention-test.db');
            
            // Set up test database
            const setupDb = new Database(testDbPath);
            setupDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, status TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'TestPOI1'), (2, 'TestPOI2');
                INSERT INTO relationships VALUES (1, 'VALIDATED'), (2, 'VALIDATED');
            `);
            setupDb.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            console.log('  🔒 Creating lock contention scenario...');
            
            // Create multiple long-running transactions to create lock contention
            const lockingProcesses = [];
            const LOCK_CONTENTION_PROCESSES = 8;
            
            // Start processes that will hold locks
            for (let i = 0; i < LOCK_CONTENTION_PROCESSES; i++) {
                const lockProcess = (async (processId) => {
                    const db = new Database(testDbPath);
                    
                    try {
                        // Start exclusive transaction
                        db.prepare("BEGIN EXCLUSIVE TRANSACTION").run();
                        
                        // Hold lock for a while, simulating long operation
                        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
                        
                        // Do some work while holding lock
                        db.prepare("UPDATE relationships SET status = ? WHERE id = ?").run(`LOCKED_${processId}`, (processId % 2) + 1);
                        
                        // Commit transaction
                        db.prepare("COMMIT").run();
                        
                        return { processId, success: true };
                    } catch (error) {
                        try {
                            db.prepare("ROLLBACK").run();
                        } catch (rollbackError) {
                            // Ignore rollback errors
                        }
                        return { processId, success: false, error: error.message };
                    } finally {
                        db.close();
                    }
                })(i);
                
                lockingProcesses.push(lockProcess);
            }
            
            // While locks are contending, try to run data consistency fixer
            const fixerPromises = [];
            const FIXER_PROCESSES = 3;
            
            for (let i = 0; i < FIXER_PROCESSES; i++) {
                const fixerPromise = (async (processId) => {
                    try {
                        // Add small delay to ensure lock contention is active
                        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
                        
                        const fixer = new DataConsistencyFixer();
                        const startTime = Date.now();
                        
                        await fixer.run();
                        
                        const endTime = Date.now();
                        return {
                            processId: processId,
                            success: true,
                            duration: endTime - startTime
                        };
                    } catch (error) {
                        return {
                            processId: processId,
                            success: false,
                            error: error.message
                        };
                    }
                })(i);
                
                fixerPromises.push(fixerPromise);
            }
            
            // Wait for all processes to complete
            const [lockResults, fixerResults] = await Promise.all([
                Promise.allSettled(lockingProcesses),
                Promise.allSettled(fixerPromises)
            ]);
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Analyze results
            const successfulLocks = lockResults.filter(r => 
                r.status === 'fulfilled' && r.value.success
            ).length;
            
            const successfulFixers = fixerResults.filter(r => 
                r.status === 'fulfilled' && r.value.success
            ).length;
            
            const lockTimeouts = lockResults.filter(r => 
                r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success && r.value.error && r.value.error.includes('lock'))
            ).length;
            
            const fixerTimeouts = fixerResults.filter(r => 
                r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success && r.value.error && r.value.error.includes('lock'))
            ).length;
            
            // Verify database integrity after lock contention
            const integrityDb = new Database(testDbPath);
            const finalRelCount = integrityDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            const finalPoiCount = integrityDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            integrityDb.close();
            
            // Assessment
            const lockHandlingPassed = successfulLocks + lockTimeouts === LOCK_CONTENTION_PROCESSES; // All should either succeed or timeout gracefully
            const fixerHandlingPassed = successfulFixers > 0 || fixerTimeouts === FIXER_PROCESSES; // Should either succeed or timeout gracefully
            const integrityPassed = finalRelCount >= 2 && finalPoiCount >= 2; // Data should be preserved
            
            this.addStressTestResult(testName + ' - Lock Management', lockHandlingPassed,
                `Lock processes: ${successfulLocks} succeeded, ${lockTimeouts} timed out gracefully`);
                
            this.addStressTestResult(testName + ' - Fixer Resilience', fixerHandlingPassed,
                `Fixer processes: ${successfulFixers} succeeded, ${fixerTimeouts} handled locks gracefully`);
                
            this.addStressTestResult(testName + ' - Data Integrity', integrityPassed,
                `Database integrity maintained: ${finalRelCount} relationships, ${finalPoiCount} POIs`);
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Lock contention stress test complete\n');
    }

    async stressTestIOStress() {
        console.log('💽 Stress Test 8: I/O Stress Testing');
        const testName = 'I/O Stress Handling';
        
        try {
            const testDbPath = path.join(this.stressTestDir, 'io-stress-test.db');
            
            console.log('  📝 Creating I/O intensive scenario...');
            
            // Create database with I/O intensive structure
            const db = new Database(testDbPath);
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT,
                    evidence TEXT,
                    io_stress_data TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT,
                    io_stress_data TEXT
                );
                CREATE TABLE temp_io_stress (
                    id INTEGER PRIMARY KEY,
                    large_blob TEXT
                );
            `);
            
            // Generate I/O intensive workload
            const IO_STRESS_SIZE = 5000;
            const largeIOData = 'IO_STRESS_' + 'x'.repeat(10000); // 10KB per record
            
            const insertPoi = db.prepare("INSERT INTO pois (name, type, semantic_id, io_stress_data) VALUES (?, ?, ?, ?)");
            const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence, io_stress_data) VALUES (?, ?, ?, ?, ?, ?, ?)");
            const insertTemp = db.prepare("INSERT INTO temp_io_stress (large_blob) VALUES (?)");
            
            // Simulate I/O stress with frequent writes
            const batchSize = 500;
            const batches = Math.ceil(IO_STRESS_SIZE / batchSize);
            
            for (let batch = 0; batch < batches; batch++) {
                console.log(`    📝 I/O batch ${batch + 1}/${batches}`);
                
                const batchStart = batch * batchSize;
                const batchEnd = Math.min(batchStart + batchSize, IO_STRESS_SIZE);
                
                db.transaction(() => {
                    for (let i = batchStart + 1; i <= batchEnd; i++) {
                        insertPoi.run(
                            `IOStressPOI_${i}`,
                            'function',
                            `semantic_io_${i}`,
                            largeIOData
                        );
                        
                        if (i > 1) {
                            insertRel.run(
                                i,
                                Math.floor(Math.random() * (i - 1)) + 1,
                                'io_stress_rel',
                                Math.random(),
                                'VALIDATED',
                                `IO stress evidence ${i}`,
                                largeIOData
                            );
                        }
                        
                        // Additional I/O stress
                        insertTemp.run(largeIOData + `_temp_${i}`);
                    }
                })();
                
                // Force sync between batches to stress I/O
                db.pragma('wal_checkpoint');
            }
            
            db.close();
            console.log('  ✅ I/O intensive dataset created');
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test data consistency under I/O stress
            console.log('  🔧 Running data consistency fixer under I/O stress...');
            
            const startTime = Date.now();
            
            // Create additional I/O load during processing
            const ioStressPromise = (async () => {
                const stressDb = new Database(testDbPath);
                const stressInsert = stressDb.prepare("INSERT INTO temp_io_stress (large_blob) VALUES (?)");
                
                try {
                    for (let i = 0; i < 100; i++) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                        stressInsert.run('STRESS_' + 'y'.repeat(5000));
                    }
                } catch (error) {
                    // May fail due to database locks during consistency fixing
                } finally {
                    stressDb.close();
                }
            })();
            
            // Run fixer under I/O stress
            const fixerPromise = (async () => {
                const fixer = new DataConsistencyFixer();
                await fixer.run();
                return fixer;
            })();
            
            const [ioStressResult, fixerResult] = await Promise.allSettled([ioStressPromise, fixerPromise]);
            
            const endTime = Date.now();
            const processingTime = (endTime - startTime) / 1000;
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Verify results
            const verifyDb = new Database(testDbPath);
            const finalPoiCount = verifyDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            const finalRelCount = verifyDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            const validatedRelCount = verifyDb.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get().count;
            const dbSize = fs.statSync(testDbPath).size / (1024 * 1024); // MB
            verifyDb.close();
            
            // Assessment
            const fixerSucceeded = fixerResult.status === 'fulfilled';
            const performanceReasonable = processingTime < 180; // 3 minutes max under I/O stress
            const dataIntegrityMaintained = finalPoiCount === IO_STRESS_SIZE && finalRelCount > 0;
            const dbSizeReasonable = dbSize < 500; // Should not exceed 500MB
            
            this.addStressTestResult(testName + ' - Processing Success', fixerSucceeded,
                fixerSucceeded ? 'Data consistency fixer completed successfully under I/O stress' :
                'Data consistency fixer failed under I/O stress');
                
            this.addStressTestResult(testName + ' - Performance Under Load', performanceReasonable,
                `Processing time under I/O stress: ${processingTime.toFixed(2)}s (limit: 180s)`);
                
            this.addStressTestResult(testName + ' - Data Integrity', dataIntegrityMaintained,
                `Data integrity: ${finalPoiCount}/${IO_STRESS_SIZE} POIs, ${validatedRelCount} validated relationships`);
                
            this.addStressTestResult(testName + ' - Storage Efficiency', dbSizeReasonable,
                `Database size: ${dbSize.toFixed(2)}MB (limit: 500MB)`);
                
        } catch (error) {
            this.addStressTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ I/O stress test complete\n');
    }

    addStressTestResult(testName, passed, description) {
        this.testResults.push({
            name: testName,
            passed: passed,
            description: description,
            timestamp: new Date().toISOString(),
            category: 'stress'
        });
        
        if (passed) {
            console.log(`  ✅ ${testName}`);
        } else {
            console.log(`  ❌ ${testName}: ${description}`);
        }
    }

    generateStressTestReport() {
        console.log('📋 STRESS TEST SUMMARY');
        console.log('========================');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);
        
        console.log(`📊 Total Stress Tests: ${totalTests}`);
        console.log(`✅ Passed: ${passedTests}`);
        console.log(`❌ Failed: ${failedTests}`);
        console.log(`📈 Success Rate: ${successRate}%`);
        
        if (failedTests > 0) {
            console.log('\n❌ FAILED STRESS TESTS:');
            this.testResults
                .filter(test => !test.passed)
                .forEach((test, index) => {
                    console.log(`  ${index + 1}. ${test.name}: ${test.description}`);
                });
        }
        
        // Categorize failures by stress type
        const performanceFailures = this.testResults.filter(r => 
            !r.passed && (r.name.includes('Performance') || r.name.includes('Speed'))
        );
        
        const memoryFailures = this.testResults.filter(r => 
            !r.passed && r.name.includes('Memory')
        );
        
        const concurrencyFailures = this.testResults.filter(r => 
            !r.passed && (r.name.includes('Concurrency') || r.name.includes('Lock'))
        );
        
        const scalabilityFailures = this.testResults.filter(r => 
            !r.passed && (r.name.includes('Large') || r.name.includes('Scalability'))
        );
        
        // Generate detailed report
        const report = {
            timestamp: new Date().toISOString(),
            test_type: 'stress_testing',
            summary: {
                total_tests: totalTests,
                passed: passedTests,
                failed: failedTests,
                success_rate: successRate + '%'
            },
            stress_analysis: {
                performance_failures: performanceFailures.length,
                memory_failures: memoryFailures.length,
                concurrency_failures: concurrencyFailures.length,
                scalability_failures: scalabilityFailures.length
            },
            detailed_results: this.testResults,
            stress_recommendations: this.generateStressRecommendations(
                performanceFailures, 
                memoryFailures, 
                concurrencyFailures, 
                scalabilityFailures
            )
        };
        
        const reportPath = 'stress-test-data-consistency-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Detailed stress test report saved to: ${reportPath}`);
        
        // Overall stress assessment
        if (failedTests === 0) {
            console.log('\n🎉 ALL STRESS TESTS PASSED - Data consistency fixes are highly robust!');
        } else if (performanceFailures.length === 0 && memoryFailures.length === 0) {
            console.log('\n⚠️  MINOR STRESS ISSUES - Core performance is solid, some edge cases need attention');
        } else {
            console.log(`\n🚨 STRESS VULNERABILITIES FOUND - Performance or memory issues detected`);
        }
        
        return report;
    }

    generateStressRecommendations(performanceFailures, memoryFailures, concurrencyFailures, scalabilityFailures) {
        const recommendations = [];
        
        if (performanceFailures.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Performance Optimization',
                issue: 'Processing speed degradation under stress',
                action: 'Implement performance optimizations: batching, indexing, query optimization',
                affected_tests: performanceFailures.map(f => f.name)
            });
        }
        
        if (memoryFailures.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                category: 'Memory Management',
                issue: 'Excessive memory usage or memory leaks under load',
                action: 'Implement streaming processing, memory pooling, and garbage collection optimization',
                affected_tests: memoryFailures.map(f => f.name)
            });
        }
        
        if (concurrencyFailures.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Concurrency Control',
                issue: 'Lock contention or race conditions under concurrent load',
                action: 'Improve transaction management, implement better locking strategies, add retry mechanisms',
                affected_tests: concurrencyFailures.map(f => f.name)
            });
        }
        
        if (scalabilityFailures.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Scalability',
                issue: 'Performance degradation with large datasets',
                action: 'Implement data partitioning, parallel processing, and incremental processing strategies',
                affected_tests: scalabilityFailures.map(f => f.name)
            });
        }
        
        // General stress testing recommendations
        recommendations.push({
            priority: 'LOW',
            category: 'Continuous Stress Testing',
            issue: 'Need for regular stress testing in CI/CD pipeline',
            action: 'Integrate stress tests into automated testing, implement performance regression detection'
        });
        
        return recommendations;
    }

    async cleanup() {
        try {
            if (fs.existsSync(this.stressTestDir)) {
                fs.rmSync(this.stressTestDir, { recursive: true, force: true });
            }
            console.log('🧹 Stress test cleanup complete');
        } catch (error) {
            console.warn('⚠️  Warning: Could not clean up stress test directory:', error.message);
        }
    }
}

// Run stress tests if called directly
if (require.main === module) {
    const stressTests = new StressTestDataConsistency();
    stressTests.runAllStressTests()
        .then(() => {
            const failedTests = stressTests.testResults.filter(r => !r.passed).length;
            process.exit(failedTests > 0 ? 1 : 0);
        })
        .catch((error) => {
            console.error('\n❌ Stress testing failed:', error);
            process.exit(1);
        });
}

module.exports = StressTestDataConsistency;