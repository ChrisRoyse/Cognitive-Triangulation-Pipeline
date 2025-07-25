#!/usr/bin/env node

/**
 * Comprehensive Edge Case Test Suite for Data Consistency Fixes
 * 
 * Tests critical failure scenarios that could break the data consistency fixes:
 * - Database corruption during consolidation
 * - File locks and permission issues
 * - Memory constraints and resource exhaustion
 * - Concurrent access conflicts
 * - Malformed data injection
 * - Network interruptions and partial states
 * - Schema migration failures
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');
const DataConsistencyFixer = require('./fix-data-consistency-issues');
const ConsistencyValidator = require('./validate-consistency-fixes');
const crypto = require('crypto');
const { spawn, fork } = require('child_process');

class EdgeCaseTestSuite {
    constructor() {
        this.testResults = [];
        this.tempDbs = [];
        this.testDir = path.join(__dirname, 'edge-case-test-temp');
        this.originalDbPath = config.SQLITE_DB_PATH;
        this.setupTestEnvironment();
    }

    setupTestEnvironment() {
        // Create temporary test directory
        if (!fs.existsSync(this.testDir)) {
            fs.mkdirSync(this.testDir, { recursive: true });
        }
        console.log(`🧪 Edge case test environment initialized in: ${this.testDir}`);
    }

    async runAllTests() {
        console.log('🚀 Starting comprehensive edge case testing...\n');

        try {
            // Test 1: Database corruption scenarios
            await this.testDatabaseCorruption();
            
            // Test 2: File lock conflicts
            await this.testFileLockConflicts();
            
            // Test 3: Memory constraints
            await this.testMemoryConstraints();
            
            // Test 4: Concurrent access patterns
            await this.testConcurrentAccess();
            
            // Test 5: Malformed data injection
            await this.testMalformedDataInjection();
            
            // Test 6: Partial migration states
            await this.testPartialMigrationStates();
            
            // Test 7: Schema corruption
            await this.testSchemaCorruption();
            
            // Test 8: Network interruption simulation
            await this.testNetworkInterruption();
            
            // Test 9: Permission denied scenarios
            await this.testPermissionDenied();
            
            // Test 10: Large dataset stress test
            await this.testLargeDatasetStress();
            
            // Test 11: Circular reference detection
            await this.testCircularReferences();
            
            // Test 12: Evidence validation edge cases
            await this.testEvidenceValidationEdgeCases();
            
            // Test 13: Graph builder data integrity under stress
            await this.testGraphBuilderStress();
            
            // Test 14: Confidence scoring with extreme values
            await this.testConfidenceScoringExtremes();
            
            // Test 15: Database path consolidation rollback
            await this.testConsolidationRollback();
            
            // Generate comprehensive report
            this.generateEdgeCaseReport();
            
        } catch (error) {
            console.error('❌ Critical error in edge case testing:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    async testDatabaseCorruption() {
        console.log('🗂️  Test 1: Database Corruption Scenarios');
        const testName = 'Database Corruption Handling';
        
        try {
            // Create test database with valid data
            const testDbPath = path.join(this.testDir, 'corrupted-test.db');
            const db = new Database(testDbPath);
            
            // Set up valid schema and data
            db.exec(`
                CREATE TABLE IF NOT EXISTS relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT,
                    evidence_hash TEXT
                );
                CREATE TABLE IF NOT EXISTS pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                );
                INSERT INTO pois (name, type) VALUES ('TestPOI1', 'function'), ('TestPOI2', 'class');
                INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status) 
                VALUES (1, 2, 'calls', 0.8, 'VALIDATED');
            `);
            db.close();
            
            // Corrupt the database file by writing random bytes
            const buffer = fs.readFileSync(testDbPath);
            const corruptedBuffer = Buffer.from(buffer);
            // Corrupt header and some data pages
            corruptedBuffer.write('CORRUPT', 0);
            corruptedBuffer.write(crypto.randomBytes(100).toString('hex'), 1000);
            fs.writeFileSync(testDbPath, corruptedBuffer);
            
            // Test data consistency fixer's response to corruption
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const fixer = new DataConsistencyFixer();
            let errorCaught = false;
            let errorMessage = '';
            
            try {
                await fixer.run();
            } catch (error) {
                errorCaught = true;
                errorMessage = error.message;
            }
            
            // Restore original config
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Verify graceful handling
            const passed = errorCaught && errorMessage.includes('database');
            this.addTestResult(testName + ' - Graceful Error Handling', passed, 
                passed ? 'Correctly detected and handled database corruption' : 
                'Failed to gracefully handle database corruption');
            
            // Test recovery mechanism
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
            
            // Create new valid database and test recovery
            const newDb = new Database(testDbPath);
            newDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY);
                CREATE TABLE pois (id INTEGER PRIMARY KEY);
            `);
            newDb.close();
            
            config.SQLITE_DB_PATH = testDbPath;
            const recoveryFixer = new DataConsistencyFixer();
            await recoveryFixer.run();
            
            // Verify recovery worked
            const recoveredDb = new Database(testDbPath);
            const tables = recoveredDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            recoveredDb.close();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            const recoveryPassed = tables.length >= 2;
            this.addTestResult(testName + ' - Recovery from Corruption', recoveryPassed,
                recoveryPassed ? 'Successfully recovered from database corruption' :
                'Failed to recover from database corruption');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Database corruption test complete\n');
    }

    async testFileLockConflicts() {
        console.log('🔒 Test 2: File Lock Conflicts');
        const testName = 'File Lock Conflict Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'locked-test.db');
            
            // Create a test database
            const setupDb = new Database(testDbPath);
            setupDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, status TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois (name) VALUES ('TestPOI');
                INSERT INTO relationships (status) VALUES ('VALIDATED');
            `);
            setupDb.close();
            
            // Keep database locked during consolidation attempt
            const lockingDb = new Database(testDbPath);
            lockingDb.prepare("BEGIN EXCLUSIVE TRANSACTION").run();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const fixer = new DataConsistencyFixer();
            let errorCaught = false;
            let timeoutOccurred = false;
            
            // Test with timeout
            const testPromise = fixer.run();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    timeoutOccurred = true;
                    reject(new Error('Test timeout - likely database lock'));
                }, 5000);
            });
            
            try {
                await Promise.race([testPromise, timeoutPromise]);
            } catch (error) {
                errorCaught = true;
                if (error.message.includes('database is locked') || error.message.includes('timeout')) {
                    // Expected behavior
                }
            }
            
            // Release lock
            lockingDb.exec("ROLLBACK");
            lockingDb.close();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Should detect lock conflict or timeout appropriately
            const passed = errorCaught || timeoutOccurred;
            this.addTestResult(testName, passed,
                passed ? 'Correctly handled database lock conflict' :
                'Failed to handle database lock conflict');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ File lock conflict test complete\n');
    }

    async testMemoryConstraints() {
        console.log('💾 Test 3: Memory Constraint Scenarios');
        const testName = 'Memory Constraint Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'large-memory-test.db');
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
                    evidence TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    large_data TEXT
                );
            `);
            
            // Insert large amount of data to simulate memory pressure
            const insertPoi = db.prepare("INSERT INTO pois (name, type, large_data) VALUES (?, ?, ?)");
            const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?)");
            
            // Generate large strings to consume memory
            const largeString = 'x'.repeat(10000); // 10KB per record
            
            db.transaction(() => {
                for (let i = 0; i < 1000; i++) { // 10MB of POI data
                    insertPoi.run(`POI_${i}`, 'test', largeString);
                }
                for (let i = 0; i < 500; i++) { // Additional relationship data
                    insertRel.run(
                        Math.floor(Math.random() * 1000) + 1,
                        Math.floor(Math.random() * 1000) + 1,
                        'test_relationship',
                        Math.random(),
                        'VALIDATED',
                        largeString
                    );
                }
            })();
            
            db.close();
            
            // Test memory handling during processing
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Monitor memory usage during fix
            const initialMemory = process.memoryUsage().heapUsed;
            
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            const peakMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = (peakMemory - initialMemory) / (1024 * 1024); // MB
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Memory should not increase excessively (threshold: 100MB)
            const passed = memoryIncrease < 100;
            this.addTestResult(testName, passed,
                passed ? `Memory usage controlled: +${memoryIncrease.toFixed(2)}MB` :
                `Excessive memory usage: +${memoryIncrease.toFixed(2)}MB`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Memory constraint test complete\n');
    }

    async testConcurrentAccess() {
        console.log('🔄 Test 4: Concurrent Access Patterns');
        const testName = 'Concurrent Access Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'concurrent-test.db');
            
            // Set up test database
            const setupDb = new Database(testDbPath);
            setupDb.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                );
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
                INSERT INTO pois (name, type) VALUES ('POI1', 'function'), ('POI2', 'class');
                INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status) 
                VALUES (1, 2, 'calls', 0.8, 'VALIDATED');
            `);
            setupDb.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Launch multiple concurrent data consistency fixers
            const promises = [];
            const results = [];
            
            for (let i = 0; i < 3; i++) {
                const promise = (async () => {
                    try {
                        const fixer = new DataConsistencyFixer();
                        await fixer.run();
                        return { success: true, processId: i };
                    } catch (error) {
                        return { success: false, processId: i, error: error.message };
                    }
                })();
                promises.push(promise);
            }
            
            const concurrentResults = await Promise.allSettled(promises);
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Analyze results
            const successCount = concurrentResults.filter(r => 
                r.status === 'fulfilled' && r.value.success
            ).length;
            
            // At least one should succeed, others may fail gracefully
            const passed = successCount >= 1;
            this.addTestResult(testName, passed,
                passed ? `${successCount}/3 concurrent processes succeeded` :
                'All concurrent processes failed');
                
            // Verify database integrity after concurrent access
            const validationDb = new Database(testDbPath);
            const relationshipCount = validationDb.prepare("SELECT COUNT(*) as count FROM relationships").get().count;
            const poiCount = validationDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            validationDb.close();
            
            const integrityPassed = relationshipCount > 0 && poiCount > 0;
            this.addTestResult(testName + ' - Data Integrity', integrityPassed,
                integrityPassed ? 'Database integrity maintained during concurrent access' :
                'Database integrity compromised during concurrent access');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Concurrent access test complete\n');
    }

    async testMalformedDataInjection() {
        console.log('🦠 Test 5: Malformed Data Injection');
        const testName = 'Malformed Data Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'malformed-test.db');
            const db = new Database(testDbPath);
            
            // Create schema and inject malformed data
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
            `);
            
            // Insert malformed data that could break validation
            const malformedInserts = [
                // POIs with malformed data
                "INSERT INTO pois VALUES (1, NULL, 'function', 'semantic_1')",
                "INSERT INTO pois VALUES (2, '', '', NULL)",
                "INSERT INTO pois VALUES (3, 'Normal POI', 'class', 'semantic_1')", // Duplicate semantic_id
                
                // Relationships with invalid data
                "INSERT INTO relationships VALUES (1, NULL, 2, 'calls', 0.8, 'VALIDATED', NULL)",
                "INSERT INTO relationships VALUES (2, 1, 999, 'calls', 1.5, 'VALIDATED', 'evidence')", // Invalid confidence > 1
                "INSERT INTO relationships VALUES (3, 1, 2, NULL, 0.8, 'VALIDATED', 'evidence')", // NULL type
                "INSERT INTO relationships VALUES (4, 1, 2, 'calls', -0.5, 'VALIDATED', 'evidence')", // Negative confidence
                "INSERT INTO relationships VALUES (5, 1, 2, '', 0.8, 'VALIDATED', 'evidence')", // Empty type
                
                // Evidence with malformed confidence
                "INSERT INTO relationship_evidence VALUES (1, 1, 'test evidence', 'not_a_number')",
                "INSERT INTO relationship_evidence VALUES (2, 999, 'orphaned evidence', 0.5)" // References non-existent relationship
            ];
            
            for (const insert of malformedInserts) {
                try {
                    db.exec(insert);
                } catch (error) {
                    // Some inserts may fail due to constraints, that's okay
                }
            }
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test data consistency fixer's handling of malformed data
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Validate that fixer cleaned up malformed data
            const validator = new ConsistencyValidator();
            await validator.run();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Check validation results
            const failedTests = validator.validationResults.failed;
            const passed = failedTests === 0;
            
            this.addTestResult(testName, passed,
                passed ? 'Successfully cleaned up all malformed data' :
                `${failedTests} validation issues remain after cleanup`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Malformed data injection test complete\n');
    }

    async testPartialMigrationStates() {
        console.log('🔄 Test 6: Partial Migration States');
        const testName = 'Partial Migration Recovery';
        
        try {
            const testDbPath = path.join(this.testDir, 'partial-migration-test.db');
            const db = new Database(testDbPath);
            
            // Create database in partially migrated state
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                    -- Missing evidence_hash column
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT
                    -- Missing analysis_quality_score column
                );
                -- Missing relationship_evidence table entirely
                INSERT INTO pois VALUES (1, 'TestPOI', 'function');
                INSERT INTO relationships VALUES (1, 1, 1, 'self_reference', 0.8, 'VALIDATED');
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test migration completion
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify migration was completed
            const migratedDb = new Database(testDbPath);
            
            // Check for added columns
            const relationshipPragma = migratedDb.prepare("PRAGMA table_info(relationships)").all();
            const poisPragma = migratedDb.prepare("PRAGMA table_info(pois)").all();
            
            const hasEvidenceHash = relationshipPragma.some(col => col.name === 'evidence_hash');
            const hasQualityScore = poisPragma.some(col => col.name === 'analysis_quality_score');
            
            // Check for added tables
            const tables = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            const hasEvidenceTable = tableNames.includes('relationship_evidence');
            
            migratedDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            const passed = hasEvidenceHash && hasQualityScore && hasEvidenceTable;
            this.addTestResult(testName, passed,
                passed ? 'Successfully completed partial migration' :
                `Migration incomplete: evidence_hash=${hasEvidenceHash}, quality_score=${hasQualityScore}, evidence_table=${hasEvidenceTable}`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Partial migration state test complete\n');
    }

    async testSchemaCorruption() {
        console.log('🗃️  Test 7: Schema Corruption Scenarios');
        const testName = 'Schema Corruption Recovery';
        
        try {
            const testDbPath = path.join(this.testDir, 'schema-corrupt-test.db');
            const db = new Database(testDbPath);
            
            // Create database with corrupted schema
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT
                );
            `);
            
            // Add some valid data
            db.exec(`
                INSERT INTO pois VALUES (1, 'TestPOI1', 'function');
                INSERT INTO pois VALUES (2, 'TestPOI2', 'class');
                INSERT INTO relationships VALUES (1, 1, 2, 'calls', 0.8, 'VALIDATED');
            `);
            
            // Simulate schema corruption by dropping critical indexes
            try {
                db.exec("DROP INDEX IF EXISTS idx_relationships_status");
                db.exec("DROP INDEX IF EXISTS idx_pois_semantic_id");
            } catch (error) {
                // Indexes might not exist yet
            }
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test schema recovery
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify schema was repaired
            const repairedDb = new Database(testDbPath);
            const indexes = repairedDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
            const indexNames = indexes.map(i => i.name);
            
            repairedDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Should have recreated critical indexes
            const hasStatusIndex = indexNames.some(name => name.includes('relationships_status'));
            const passed = hasStatusIndex;
            
            this.addTestResult(testName, passed,
                passed ? 'Successfully recovered schema and recreated indexes' :
                'Failed to recover corrupted schema');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Schema corruption test complete\n');
    }

    async testNetworkInterruption() {
        console.log('🌐 Test 8: Network Interruption Simulation');
        const testName = 'Network Interruption Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'network-test.db');
            
            // Create test database
            const db = new Database(testDbPath);
            db.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, status TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'TestPOI');
                INSERT INTO relationships VALUES (1, 'VALIDATED');
            `);
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Simulate network interruption by temporarily making the file read-only
            const originalMode = fs.statSync(testDbPath).mode;
            fs.chmodSync(testDbPath, 0o444); // Read-only
            
            let errorCaught = false;
            try {
                const fixer = new DataConsistencyFixer();
                await fixer.run();
            } catch (error) {
                errorCaught = true;
                // Should gracefully handle permission errors
            }
            
            // Restore permissions
            fs.chmodSync(testDbPath, originalMode);
            
            // Now test recovery
            const recoveryFixer = new DataConsistencyFixer();
            await recoveryFixer.run();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            const passed = errorCaught; // Should have caught the permission error
            this.addTestResult(testName, passed,
                passed ? 'Correctly handled network/permission interruption' :
                'Failed to handle network interruption gracefully');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Network interruption test complete\n');
    }

    async testPermissionDenied() {
        console.log('🚫 Test 9: Permission Denied Scenarios');
        const testName = 'Permission Denied Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'permission-test.db');
            const testDataDir = path.dirname(testDbPath);
            
            // Create test directory with restricted permissions
            if (fs.existsSync(testDataDir)) {
                fs.rmSync(testDataDir, { recursive: true, force: true });
            }
            fs.mkdirSync(testDataDir, { recursive: true });
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Make directory read-only to simulate permission issues
            if (process.platform !== 'win32') {
                fs.chmodSync(testDataDir, 0o555); // Read and execute only
            }
            
            let errorCaught = false;
            let errorMessage = '';
            
            try {
                const fixer = new DataConsistencyFixer();
                await fixer.run();
            } catch (error) {
                errorCaught = true;
                errorMessage = error.message;
            }
            
            // Restore permissions
            if (process.platform !== 'win32') {
                fs.chmodSync(testDataDir, 0o755);
            }
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Should gracefully handle permission errors
            const passed = errorCaught && (
                errorMessage.includes('permission') || 
                errorMessage.includes('EACCES') || 
                errorMessage.includes('EPERM')
            );
            
            this.addTestResult(testName, passed,
                passed ? 'Correctly handled permission denied errors' :
                'Failed to handle permission denied scenarios');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Permission denied test complete\n');
    }

    async testLargeDatasetStress() {
        console.log('📊 Test 10: Large Dataset Stress Test');
        const testName = 'Large Dataset Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'large-dataset-test.db');
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
                    evidence TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                );
            `);
            
            // Insert large dataset
            const poiInsert = db.prepare("INSERT INTO pois (name, type, semantic_id) VALUES (?, ?, ?)");
            const relInsert = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, evidence) VALUES (?, ?, ?, ?, ?, ?)");
            
            console.log('  📝 Generating large dataset...');
            
            const LARGE_COUNT = 10000;
            db.transaction(() => {
                // Insert POIs
                for (let i = 1; i <= LARGE_COUNT; i++) {
                    poiInsert.run(`POI_${i}`, 'function', `semantic_${i}`);
                }
                
                // Insert relationships with some problematic data
                for (let i = 1; i <= LARGE_COUNT; i++) {
                    const sourceId = Math.floor(Math.random() * LARGE_COUNT) + 1;
                    const targetId = Math.floor(Math.random() * LARGE_COUNT) + 1;
                    const confidence = i % 100 === 0 ? 1.5 : Math.random(); // Some invalid confidence scores
                    const status = i % 50 === 0 ? 'INVALID' : 'VALIDATED'; // Some invalid statuses
                    
                    relInsert.run(sourceId, targetId, 'calls', confidence, status, `evidence_${i}`);
                }
            })();
            
            db.close();
            console.log('  ✅ Large dataset created');
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Measure performance
            const startTime = Date.now();
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            const endTime = Date.now();
            
            const processingTimeMs = endTime - startTime;
            const processingTimeS = processingTimeMs / 1000;
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Verify data was processed correctly
            const verifyDb = new Database(testDbPath);
            const invalidConfidenceCount = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE confidence > 1 OR confidence < 0
            `).get().count;
            
            const validatedCount = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE status = 'VALIDATED' AND confidence BETWEEN 0 AND 1
            `).get().count;
            
            verifyDb.close();
            
            // Should process within reasonable time (< 30 seconds) and fix invalid data
            const performancePassed = processingTimeS < 30;
            const dataPassed = invalidConfidenceCount === 0 && validatedCount > 0;
            
            this.addTestResult(testName + ' - Performance', performancePassed,
                `Processed ${LARGE_COUNT} records in ${processingTimeS.toFixed(2)}s (limit: 30s)`);
                
            this.addTestResult(testName + ' - Data Integrity', dataPassed,
                dataPassed ? `Fixed all invalid confidence scores, ${validatedCount} valid relationships remain` :
                `${invalidConfidenceCount} invalid confidence scores remain`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Large dataset stress test complete\n');
    }

    async testCircularReferences() {
        console.log('🔄 Test 11: Circular Reference Detection');
        const testName = 'Circular Reference Handling';
        
        try {
            const testDbPath = path.join(this.testDir, 'circular-test.db');
            const db = new Database(testDbPath);
            
            // Create schema and data with circular references
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                );
                
                -- Create POIs
                INSERT INTO pois VALUES (1, 'ClassA', 'class', 'class_a');
                INSERT INTO pois VALUES (2, 'ClassB', 'class', 'class_b');
                INSERT INTO pois VALUES (3, 'ClassC', 'class', 'class_c');
                
                -- Create circular references: A -> B -> C -> A
                INSERT INTO relationships VALUES (1, 1, 2, 'inherits', 0.9, 'VALIDATED');
                INSERT INTO relationships VALUES (2, 2, 3, 'inherits', 0.9, 'VALIDATED');
                INSERT INTO relationships VALUES (3, 3, 1, 'inherits', 0.9, 'VALIDATED');
                
                -- Self-reference
                INSERT INTO relationships VALUES (4, 1, 1, 'self_ref', 0.8, 'VALIDATED');
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test circular reference handling
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify circular references are handled appropriately
            const verifyDb = new Database(testDbPath);
            
            // Check if circular references still exist
            const circularQuery = `
                WITH RECURSIVE relationship_chain(source_id, target_id, depth, path) AS (
                    SELECT source_poi_id, target_poi_id, 1, CAST(source_poi_id AS TEXT)
                    FROM relationships WHERE status = 'VALIDATED'
                    UNION ALL
                    SELECT r.source_poi_id, r.target_poi_id, rc.depth + 1, rc.path || '->' || r.source_poi_id
                    FROM relationships r
                    JOIN relationship_chain rc ON r.source_poi_id = rc.target_id
                    WHERE rc.depth < 10 AND INSTR(rc.path, CAST(r.source_poi_id AS TEXT)) = 0
                )
                SELECT COUNT(*) as circular_count
                FROM relationship_chain
                WHERE source_id = target_id AND depth > 1
            `;
            
            let circularCount = 0;
            try {
                circularCount = verifyDb.prepare(circularQuery).get().circular_count;
            } catch (error) {
                // If CTE not supported, use simpler check
                circularCount = verifyDb.prepare(`
                    SELECT COUNT(*) as count FROM relationships 
                    WHERE source_poi_id = target_poi_id AND status = 'VALIDATED'
                `).get().count;
            }
            
            const totalRelationships = verifyDb.prepare(`
                SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'
            `).get().count;
            
            verifyDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            // System should either detect and handle circular references or maintain data integrity
            const passed = totalRelationships > 0; // Data should still be processable
            this.addTestResult(testName, passed,
                passed ? `Processed ${totalRelationships} relationships, ${circularCount} potential circular references detected` :
                'Failed to process relationships with circular references');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Circular reference test complete\n');
    }

    async testEvidenceValidationEdgeCases() {
        console.log('🔍 Test 12: Evidence Validation Edge Cases');
        const testName = 'Evidence Validation Edge Cases';
        
        try {
            const testDbPath = path.join(this.testDir, 'evidence-edge-test.db');
            const db = new Database(testDbPath);
            
            // Create schema with evidence tables
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
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    evidence_data TEXT,
                    confidence REAL
                );
                CREATE TABLE triangulated_analysis_sessions (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    status TEXT,
                    final_confidence REAL,
                    consensus_score REAL
                );
            `);
            
            // Insert edge case evidence scenarios
            db.exec(`
                INSERT INTO pois VALUES (1, 'TestPOI1', 'function'), (2, 'TestPOI2', 'class');
                
                -- Relationship with high confidence but no evidence
                INSERT INTO relationships VALUES (1, 1, 2, 'calls', 0.9, 'VALIDATED');
                
                -- Relationship with evidence but confidence mismatch
                INSERT INTO relationships VALUES (2, 1, 2, 'uses', 0.2, 'VALIDATED');
                INSERT INTO relationship_evidence VALUES (1, 2, 'strong evidence', 0.95);
                
                -- Relationship with multiple conflicting evidence
                INSERT INTO relationships VALUES (3, 1, 2, 'inherits', 0.5, 'VALIDATED');
                INSERT INTO relationship_evidence VALUES (2, 3, 'evidence supports', 0.9);
                INSERT INTO relationship_evidence VALUES (3, 3, 'evidence contradicts', 0.1);
                
                -- Triangulated session marked complete but missing data
                INSERT INTO triangulated_analysis_sessions VALUES (1, 1, 'COMPLETED', NULL, NULL);
                INSERT INTO triangulated_analysis_sessions VALUES (2, 2, 'COMPLETED', 0.8, NULL);
                INSERT INTO triangulated_analysis_sessions VALUES (3, 3, 'COMPLETED', 0.7, 0.6);
                
                -- Orphaned evidence (relationship doesn't exist)
                INSERT INTO relationship_evidence VALUES (4, 999, 'orphaned evidence', 0.8);
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test evidence validation and fixing
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify evidence was validated correctly
            const validator = new ConsistencyValidator();
            await validator.run();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Check specific validation results
            const validatedDb = new Database(testDbPath);
            
            // Check relationships without evidence don't have high confidence
            const noEvidenceHighConf = validatedDb.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships r 
                LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                WHERE r.confidence > 0.5 AND re.id IS NULL
            `).get().count;
            
            // Check incomplete triangulation sessions
            const incompleteTriangulation = validatedDb.prepare(`
                SELECT COUNT(*) as count 
                FROM triangulated_analysis_sessions 
                WHERE status = 'COMPLETED' AND (final_confidence IS NULL OR consensus_score IS NULL)
            `).get().count;
            
            // Check orphaned evidence
            const orphanedEvidence = validatedDb.prepare(`
                SELECT COUNT(*) as count 
                FROM relationship_evidence re 
                LEFT JOIN relationships r ON re.relationship_id = r.id 
                WHERE r.id IS NULL
            `).get().count;
            
            validatedDb.close();
            
            const passed = noEvidenceHighConf === 0 && incompleteTriangulation === 0 && orphanedEvidence === 0;
            this.addTestResult(testName, passed,
                passed ? 'All evidence edge cases handled correctly' :
                `Issues remain: ${noEvidenceHighConf} high conf w/o evidence, ${incompleteTriangulation} incomplete triangulation, ${orphanedEvidence} orphaned evidence`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Evidence validation edge cases test complete\n');
    }

    async testGraphBuilderStress() {
        console.log('🏗️  Test 13: Graph Builder Data Integrity Under Stress');
        const testName = 'Graph Builder Stress Test';
        
        try {
            const testDbPath = path.join(this.testDir, 'graph-builder-stress-test.db');
            const db = new Database(testDbPath);
            
            // Create schema and stress test data
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                );
            `);
            
            // Create stress scenario: many relationships with edge cases
            const stressInserts = [
                // Valid POIs
                "INSERT INTO pois VALUES (1, 'ValidPOI1', 'function', 'valid_1')",
                "INSERT INTO pois VALUES (2, 'ValidPOI2', 'class', 'valid_2')",
                "INSERT INTO pois VALUES (3, 'ValidPOI3', 'method', 'valid_3')",
                
                // POIs with problematic data
                "INSERT INTO pois VALUES (4, NULL, 'function', 'null_name')",
                "INSERT INTO pois VALUES (5, '', '', 'empty_data')",
                
                // Valid relationships
                "INSERT INTO relationships VALUES (1, 1, 2, 'calls', 0.8, 'VALIDATED')",
                "INSERT INTO relationships VALUES (2, 2, 3, 'contains', 0.9, 'VALIDATED')",
                
                // Problematic relationships that should be caught
                "INSERT INTO relationships VALUES (3, 999, 2, 'calls', 0.8, 'VALIDATED')", // Non-existent source
                "INSERT INTO relationships VALUES (4, 1, 999, 'calls', 0.8, 'VALIDATED')", // Non-existent target
                "INSERT INTO relationships VALUES (5, 1, 2, NULL, 0.8, 'VALIDATED')", // NULL type
                "INSERT INTO relationships VALUES (6, 1, 2, '', 0.8, 'VALIDATED')", // Empty type
                "INSERT INTO relationships VALUES (7, 1, 2, 'calls', 1.5, 'VALIDATED')", // Invalid confidence
                "INSERT INTO relationships VALUES (8, 1, 2, 'calls', -0.5, 'VALIDATED')", // Invalid confidence
                "INSERT INTO relationships VALUES (9, NULL, 2, 'calls', 0.8, 'VALIDATED')", // NULL source
                "INSERT INTO relationships VALUES (10, 1, NULL, 'calls', 0.8, 'VALIDATED')" // NULL target
            ];
            
            for (const insert of stressInserts) {
                try {
                    db.exec(insert);
                } catch (error) {
                    // Some inserts may fail due to constraints
                }
            }
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test GraphBuilder validation under stress
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Simulate GraphBuilder data integrity check
            const GraphBuilder = require('./src/agents/GraphBuilder_optimized');
            const testDb = new Database(testDbPath);
            
            // Test validation method
            const graphBuilder = new GraphBuilder(testDb, null, 'test');
            let validationResult;
            
            try {
                validationResult = await graphBuilder.validateDataIntegrity();
            } catch (error) {
                validationResult = { isValid: false, errors: [error.message] };
            }
            
            testDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Check final state
            const finalDb = new Database(testDbPath);
            const validRelationships = finalDb.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships r
                INNER JOIN pois sp ON r.source_poi_id = sp.id
                INNER JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND r.confidence BETWEEN 0 AND 1 
                AND r.type IS NOT NULL 
                AND r.type != ''
            `).get().count;
            
            const totalValidatedRels = finalDb.prepare(`
                SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'
            `).get().count;
            
            finalDb.close();
            
            const passed = validationResult.isValid && validRelationships === totalValidatedRels;
            this.addTestResult(testName, passed,
                passed ? `Data integrity maintained: ${validRelationships}/${totalValidatedRels} relationships valid` :
                `Data integrity issues: ${validationResult.errors ? validationResult.errors.join(', ') : 'Unknown validation failure'}`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Graph builder stress test complete\n');
    }

    async testConfidenceScoringExtremes() {
        console.log('🎯 Test 14: Confidence Scoring with Extreme Values');
        const testName = 'Confidence Scoring Extremes';
        
        try {
            const ConfidenceScoringService = require('./src/services/cognitive_triangulation/ConfidenceScoringService');
            
            // Test extreme evidence scenarios
            const testCases = [
                {
                    name: 'Empty Evidence Array',
                    evidence: [],
                    expected: { finalScore: 0, hasConflict: false }
                },
                {
                    name: 'Null Evidence',
                    evidence: null,
                    expected: { finalScore: 0, hasConflict: false }
                },
                {
                    name: 'Malformed Evidence Objects',
                    evidence: [null, undefined, 'string', 123, {}],
                    expected: { finalScore: 0.7, hasConflict: false } // Should default to found relationship
                },
                {
                    name: 'Extreme High Confidence',
                    evidence: [{ confidence: 999 }, { confidence: 1.5 }, { confidence: 10 }],
                    expected: { finalScore: 1, hasConflict: false } // Should be clamped to 1
                },
                {
                    name: 'Extreme Low Confidence',
                    evidence: [{ confidence: -999 }, { confidence: -1.5 }, { confidence: -10 }],
                    expected: { finalScore: 0, hasConflict: false } // Should be clamped to 0
                },
                {
                    name: 'High Conflict Evidence',
                    evidence: [{ confidence: 0.9 }, { confidence: 0.1 }, { confidence: 0.95 }, { confidence: 0.05 }],
                    expected: { hasConflict: true } // Should detect conflict
                },
                {
                    name: 'NaN and Infinity Values',
                    evidence: [{ confidence: NaN }, { confidence: Infinity }, { confidence: -Infinity }],
                    expected: { finalScore: 0.7, hasConflict: false } // Should handle gracefully
                },
                {
                    name: 'Mixed Valid and Invalid Evidence',
                    evidence: [
                        { confidence: 0.8 },
                        { confidence: 'invalid' },
                        { initialScore: 0.7 },
                        { synthetic: true },
                        null,
                        { confidence: NaN }
                    ],
                    expected: { finalScore: 0.7, hasConflict: false } // Should process valid parts
                }
            ];
            
            let passedTests = 0;
            let failedTests = 0;
            
            for (const testCase of testCases) {
                try {
                    const result = ConfidenceScoringService.calculateFinalScore(testCase.evidence);
                    
                    let passed = true;
                    let errorMsg = '';
                    
                    // Check final score bounds
                    if (result.finalScore < 0 || result.finalScore > 1) {
                        passed = false;
                        errorMsg += `Final score out of bounds: ${result.finalScore}. `;
                    }
                    
                    // Check expected values if specified
                    if (testCase.expected.finalScore !== undefined) {
                        const scoreDiff = Math.abs(result.finalScore - testCase.expected.finalScore);
                        if (scoreDiff > 0.1) { // Allow 10% tolerance
                            passed = false;
                            errorMsg += `Expected score ~${testCase.expected.finalScore}, got ${result.finalScore}. `;
                        }
                    }
                    
                    if (testCase.expected.hasConflict !== undefined) {
                        if (result.hasConflict !== testCase.expected.hasConflict) {
                            passed = false;
                            errorMsg += `Expected conflict: ${testCase.expected.hasConflict}, got ${result.hasConflict}. `;
                        }
                    }
                    
                    if (passed) {
                        passedTests++;
                    } else {
                        failedTests++;
                        console.log(`    ❌ ${testCase.name}: ${errorMsg}`);
                    }
                    
                } catch (error) {
                    failedTests++;
                    console.log(`    ❌ ${testCase.name}: Threw error - ${error.message}`);
                }
            }
            
            const overallPassed = failedTests === 0;
            this.addTestResult(testName, overallPassed,
                overallPassed ? `All ${passedTests} confidence scoring extreme cases handled correctly` :
                `${failedTests}/${testCases.length} confidence scoring tests failed`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Confidence scoring extremes test complete\n');
    }

    async testConsolidationRollback() {
        console.log('🔄 Test 15: Database Consolidation Rollback');
        const testName = 'Consolidation Rollback';
        
        try {
            // Create multiple test databases
            const primaryDbPath = path.join(this.testDir, 'primary.db');
            const secondaryDbPath = path.join(this.testDir, 'secondary.db');
            const targetDbPath = path.join(this.testDir, 'target.db');
            
            // Create primary database with data
            const primaryDb = new Database(primaryDbPath);
            primaryDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, type TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'PrimaryPOI');
                INSERT INTO relationships VALUES (1, 'primary_rel');
            `);
            primaryDb.close();
            
            // Create secondary database with different data
            const secondaryDb = new Database(secondaryDbPath);
            secondaryDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, type TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'SecondaryPOI');
                INSERT INTO relationships VALUES (1, 'secondary_rel');
            `);
            secondaryDb.close();
            
            // Create existing target with important data
            const targetDb = new Database(targetDbPath);
            targetDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, type TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'ImportantExistingPOI');
                INSERT INTO relationships VALUES (1, 'important_rel');
            `);
            targetDb.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = targetDbPath;
            
            // Simulate a failed consolidation by making target read-only after backup
            const targetStats = fs.statSync(targetDbPath);
            const backupPath = targetDbPath + '.backup';
            
            // Create backup
            fs.copyFileSync(targetDbPath, backupPath);
            
            // Make target read-only to force failure during consolidation
            if (process.platform !== 'win32') {
                fs.chmodSync(targetDbPath, 0o444);
            }
            
            let consolidationFailed = false;
            try {
                const fixer = new DataConsistencyFixer();
                await fixer.run();
            } catch (error) {
                consolidationFailed = true;
            }
            
            // Restore permissions
            if (process.platform !== 'win32') {
                fs.chmodSync(targetDbPath, targetStats.mode);
            }
            
            // Verify original data is still intact (rollback scenario)
            const verifyDb = new Database(targetDbPath);
            const originalPoi = verifyDb.prepare("SELECT name FROM pois WHERE id = 1").get();
            const originalRel = verifyDb.prepare("SELECT type FROM relationships WHERE id = 1").get();
            verifyDb.close();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Data should be preserved if consolidation failed
            const passed = consolidationFailed && 
                         originalPoi && originalPoi.name === 'ImportantExistingPOI' &&
                         originalRel && originalRel.type === 'important_rel';
            
            this.addTestResult(testName, passed,
                passed ? 'Successfully preserved original data when consolidation failed' :
                'Failed to preserve original data during failed consolidation');
                
            // Clean up backup
            if (fs.existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
            }
            
        } catch (error) {
            this.addTestResult(testName, false, `Test failed with error: ${error.message}`);
        }
        
        console.log('✅ Consolidation rollback test complete\n');
    }

    addTestResult(testName, passed, description) {
        this.testResults.push({
            name: testName,
            passed: passed,
            description: description,
            timestamp: new Date().toISOString()
        });
        
        if (passed) {
            console.log(`  ✅ ${testName}`);
        } else {
            console.log(`  ❌ ${testName}: ${description}`);
        }
    }

    generateEdgeCaseReport() {
        console.log('📋 EDGE CASE TEST SUMMARY');
        console.log('==========================');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);
        
        console.log(`📊 Total Tests: ${totalTests}`);
        console.log(`✅ Passed: ${passedTests}`);
        console.log(`❌ Failed: ${failedTests}`);
        console.log(`📈 Success Rate: ${successRate}%`);
        
        if (failedTests > 0) {
            console.log('\n❌ FAILED TESTS:');
            this.testResults
                .filter(test => !test.passed)
                .forEach((test, index) => {
                    console.log(`  ${index + 1}. ${test.name}: ${test.description}`);
                });
        }
        
        // Categorize vulnerabilities by severity
        const criticalFailures = this.testResults.filter(r => 
            !r.passed && (
                r.name.includes('Corruption') || 
                r.name.includes('Concurrent') || 
                r.name.includes('Rollback')
            )
        );
        
        const performanceFailures = this.testResults.filter(r => 
            !r.passed && (
                r.name.includes('Memory') || 
                r.name.includes('Large Dataset') || 
                r.name.includes('Performance')
            )
        );
        
        const dataIntegrityFailures = this.testResults.filter(r => 
            !r.passed && (
                r.name.includes('Malformed') || 
                r.name.includes('Evidence') || 
                r.name.includes('Confidence')
            )
        );
        
        // Generate detailed report
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                total_tests: totalTests,
                passed: passedTests,
                failed: failedTests,
                success_rate: successRate + '%'
            },
            vulnerability_analysis: {
                critical_failures: criticalFailures.length,
                performance_failures: performanceFailures.length,
                data_integrity_failures: dataIntegrityFailures.length
            },
            detailed_results: this.testResults,
            recommendations: this.generateRecommendations(criticalFailures, performanceFailures, dataIntegrityFailures)
        };
        
        const reportPath = 'edge-case-validation-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Detailed edge case report saved to: ${reportPath}`);
        
        // Overall assessment
        if (failedTests === 0) {
            console.log('\n🎉 ALL EDGE CASE TESTS PASSED - Data consistency fixes are robust!');
        } else if (criticalFailures.length === 0) {
            console.log('\n⚠️  MINOR ISSUES FOUND - No critical vulnerabilities, but some edge cases need attention');
        } else {
            console.log(`\n🚨 CRITICAL VULNERABILITIES FOUND - ${criticalFailures.length} critical failures need immediate attention`);
        }
        
        return report;
    }

    generateRecommendations(criticalFailures, performanceFailures, dataIntegrityFailures) {
        const recommendations = [];
        
        if (criticalFailures.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                category: 'Data Safety',
                issue: 'Critical failures in corruption handling, concurrency, or rollback mechanisms',
                action: 'Implement robust transaction handling, file locking, and backup/restore mechanisms',
                failures: criticalFailures.map(f => f.name)
            });
        }
        
        if (performanceFailures.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Performance',
                issue: 'Performance degradation under stress conditions',
                action: 'Optimize memory usage, implement batching, and add performance monitoring',
                failures: performanceFailures.map(f => f.name)
            });
        }
        
        if (dataIntegrityFailures.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Data Integrity',
                issue: 'Edge cases in data validation and confidence scoring',
                action: 'Enhance input validation, add boundary checks, and improve error handling',
                failures: dataIntegrityFailures.map(f => f.name)
            });
        }
        
        // General recommendations
        recommendations.push({
            priority: 'LOW',
            category: 'Monitoring',
            issue: 'Need for continuous monitoring of edge cases in production',
            action: 'Implement comprehensive logging, metrics, and automated testing in CI/CD'
        });
        
        return recommendations;
    }

    async cleanup() {
        try {
            // Clean up temporary test files
            if (fs.existsSync(this.testDir)) {
                fs.rmSync(this.testDir, { recursive: true, force: true });
            }
            console.log('🧹 Edge case test cleanup complete');
        } catch (error) {
            console.warn('⚠️  Warning: Could not clean up test directory:', error.message);
        }
    }
}

// Run edge case tests if called directly
if (require.main === module) {
    const edgeCaseTests = new EdgeCaseTestSuite();
    edgeCaseTests.runAllTests()
        .then(() => {
            const failedTests = edgeCaseTests.testResults.filter(r => !r.passed).length;
            process.exit(failedTests > 0 ? 1 : 0);
        })
        .catch((error) => {
            console.error('\n❌ Edge case testing failed:', error);
            process.exit(1);
        });
}

module.exports = EdgeCaseTestSuite;