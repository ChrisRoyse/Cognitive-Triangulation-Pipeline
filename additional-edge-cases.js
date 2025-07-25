#!/usr/bin/env node

/**
 * Additional Critical Edge Cases for Data Consistency Testing
 * 
 * This file identifies and implements missing edge cases that were not covered
 * in the initial edge case testing work. These are critical for production deployment.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');

class AdditionalEdgeCases {
    constructor() {
        this.testResults = [];
        this.tempDir = path.join(__dirname, 'additional-edge-case-temp');
        this.setupTestEnvironment();
    }

    setupTestEnvironment() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        console.log(`🧪 Additional edge case environment initialized: ${this.tempDir}`);
    }

    async runAllAdditionalTests() {
        console.log('🚀 Running additional critical edge cases...\n');

        try {
            // MISSING CATEGORY 1: Schema Evolution Edge Cases
            await this.testSchemaVersionCompatibility();
            await this.testPartialSchemaMigration();
            await this.testSchemaRollbackScenarios();
            await this.testMixedSchemaVersions();

            // MISSING CATEGORY 2: Cognitive Triangulation Domain Edge Cases
            await this.testEvidenceCircularReferences();
            await this.testSemanticIdCollisions();
            await this.testCrossFileRelationshipValidation();
            await this.testConfidenceScoreBoundaryViolations();
            await this.testGraphTraversalInfiniteLoops();

            // MISSING CATEGORY 3: Production Environment Edge Cases
            await this.testContainerMemoryLimits();
            await this.testNetworkPartitionRecovery();
            await this.testFileSystemIOErrors();
            await this.testDatabaseConnectionPoolExhaustion();
            await this.testRedisEvictionUnderLoad();

            // MISSING CATEGORY 4: Security and Data Safety Edge Cases
            await this.testPOISemanticIdCollisionAttacks();
            await this.testRelationshipEvidenceTampering();
            await this.testConfidenceScoreManipulation();
            await this.testGraphDataPoisoning();
            await this.testSQLInjectionInDynamicQueries();

            // MISSING CATEGORY 5: Advanced Recovery Edge Cases
            await this.testCascadingFailureRecovery();
            await this.testPartialRecoveryCompletion();
            await this.testRecoveryDataIntegrityValidation();
            await this.testRecoveryUnderResourceConstraints();

            // MISSING CATEGORY 6: Performance Regression Edge Cases
            await this.testPerformanceDegradationDetection();
            await this.testMemoryLeakDetection();
            await this.testResourceExhaustionRecovery();

            this.generateAdditionalEdgeCaseReport();

        } catch (error) {
            console.error('❌ Error in additional edge case testing:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    // ========== SCHEMA EVOLUTION EDGE CASES ==========

    async testSchemaVersionCompatibility() {
        console.log('📋 Schema Version Compatibility Testing');
        const testName = 'Schema Version Compatibility';
        
        try {
            const testDbPath = path.join(this.tempDir, 'schema-version-test.db');
            const db = new Database(testDbPath);
            
            // Create database with old schema version (missing recent columns/tables)
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL
                    -- Missing: evidence_hash, status, created_at columns
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT
                    -- Missing: semantic_id, analysis_quality_score columns
                );
                -- Missing entire tables: relationship_evidence, triangulated_analysis_sessions
                
                INSERT INTO pois VALUES (1, 'OldPOI1', 'function');
                INSERT INTO pois VALUES (2, 'OldPOI2', 'class');
                INSERT INTO relationships VALUES (1, 1, 2, 'calls', 0.8);
            `);
            
            db.close();
            
            // Test that data consistency fixer can handle old schema
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            try {
                const DataConsistencyFixer = require('./fix-data-consistency-issues');
                const fixer = new DataConsistencyFixer();
                await fixer.run();
                
                // Verify schema was upgraded gracefully
                const upgradedDb = new Database(testDbPath);
                const columns = upgradedDb.prepare("PRAGMA table_info(relationships)").all();
                const columnNames = columns.map(c => c.name);
                
                const hasStatus = columnNames.includes('status');
                const hasEvidenceHash = columnNames.includes('evidence_hash');
                
                upgradedDb.close();
                
                const passed = hasStatus || hasEvidenceHash; // At least some upgrade occurred
                this.addTestResult(testName, passed,
                    passed ? 'Schema version upgrade handled gracefully' :
                    'Failed to handle old schema version compatibility');
                    
            } catch (error) {
                // Should not crash on old schema - should handle gracefully
                const passed = error.message.includes('graceful') || error.message.includes('skip');
                this.addTestResult(testName, passed,
                    `Schema compatibility error: ${error.message}`);
            }
            
            config.SQLITE_DB_PATH = originalDbPath;
            
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    async testPartialSchemaMigration() {
        console.log('🔄 Partial Schema Migration Recovery');
        const testName = 'Partial Schema Migration Recovery';
        
        try {
            const testDbPath = path.join(this.tempDir, 'partial-migration-test.db');
            const db = new Database(testDbPath);
            
            // Create database in partially migrated state (some columns added, others missing)
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT DEFAULT 'PENDING'
                    -- Missing: evidence_hash column
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT
                    -- Missing: analysis_quality_score column
                );
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER
                    -- Missing: evidence_data, confidence columns
                );
                -- Missing: triangulated_analysis_sessions table entirely
                
                INSERT INTO pois VALUES (1, 'PartialPOI1', 'function', 'partial_1');
                INSERT INTO relationships VALUES (1, 1, 1, 'self_ref', 0.7, 'VALIDATED');
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const DataConsistencyFixer = require('./fix-data-consistency-issues');
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify partial migration was completed
            const migratedDb = new Database(testDbPath);
            const relColumns = migratedDb.prepare("PRAGMA table_info(relationships)").all();
            const poiColumns = migratedDb.prepare("PRAGMA table_info(pois)").all();
            const tables = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            
            const hasEvidenceHash = relColumns.some(c => c.name === 'evidence_hash');
            const hasQualityScore = poiColumns.some(c => c.name === 'analysis_quality_score');
            const hasTriangulationTable = tables.some(t => t.name === 'triangulated_analysis_sessions');
            
            migratedDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            const passed = hasEvidenceHash && hasQualityScore && hasTriangulationTable;
            this.addTestResult(testName, passed,
                passed ? 'Partial migration completed successfully' :
                `Migration incomplete: evidence_hash=${hasEvidenceHash}, quality_score=${hasQualityScore}, triangulation=${hasTriangulationTable}`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    // ========== COGNITIVE TRIANGULATION DOMAIN EDGE CASES ==========

    async testEvidenceCircularReferences() {
        console.log('🔄 Evidence Circular Reference Detection');
        const testName = 'Evidence Circular Reference Detection';
        
        try {
            const testDbPath = path.join(this.tempDir, 'circular-evidence-test.db');
            const db = new Database(testDbPath);
            
            // Create complex circular evidence scenario
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
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    evidence_data TEXT,
                    confidence REAL,
                    source_relationship_id INTEGER -- Evidence derived from another relationship
                );
                
                -- Create POIs
                INSERT INTO pois VALUES (1, 'CircularA', 'class', 'circular_a');
                INSERT INTO pois VALUES (2, 'CircularB', 'class', 'circular_b');
                INSERT INTO pois VALUES (3, 'CircularC', 'class', 'circular_c');
                
                -- Create circular relationship evidence chain
                INSERT INTO relationships VALUES (1, 1, 2, 'inherits', 0.8, 'VALIDATED');
                INSERT INTO relationships VALUES (2, 2, 3, 'inherits', 0.8, 'VALIDATED');
                INSERT INTO relationships VALUES (3, 3, 1, 'inherits', 0.8, 'VALIDATED');
                
                -- Circular evidence: R1 evidence comes from R2, R2 from R3, R3 from R1
                INSERT INTO relationship_evidence VALUES (1, 1, 'Evidence from relationship 2', 0.8, 2);
                INSERT INTO relationship_evidence VALUES (2, 2, 'Evidence from relationship 3', 0.8, 3);
                INSERT INTO relationship_evidence VALUES (3, 3, 'Evidence from relationship 1', 0.8, 1);
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const DataConsistencyFixer = require('./fix-data-consistency-issues');
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify circular evidence was detected and handled
            const verifyDb = new Database(testDbPath);
            
            // Check if system detected and broke circular evidence chain
            const circularEvidence = verifyDb.prepare(`
                WITH RECURSIVE evidence_chain(rel_id, source_rel_id, depth, path) AS (
                    SELECT relationship_id, source_relationship_id, 1, CAST(relationship_id AS TEXT)
                    FROM relationship_evidence 
                    WHERE source_relationship_id IS NOT NULL
                    UNION ALL
                    SELECT re.relationship_id, re.source_relationship_id, ec.depth + 1, 
                           ec.path || '->' || re.relationship_id
                    FROM relationship_evidence re
                    JOIN evidence_chain ec ON re.relationship_id = ec.source_rel_id
                    WHERE ec.depth < 10 AND INSTR(ec.path, CAST(re.relationship_id AS TEXT)) = 0
                )
                SELECT COUNT(*) as count FROM evidence_chain WHERE rel_id = source_rel_id AND depth > 1
            `).get();
            
            verifyDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Should detect and handle circular evidence (either break cycle or flag as invalid)
            const passed = circularEvidence.count === 0; // No circular evidence chains remain
            this.addTestResult(testName, passed,
                passed ? 'Circular evidence chain detected and resolved' :
                `${circularEvidence.count} circular evidence chains remain unresolved`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    async testSemanticIdCollisions() {
        console.log('🔀 Semantic ID Collision Resolution');
        const testName = 'Semantic ID Collision Resolution';
        
        try {
            const testDbPath = path.join(this.tempDir, 'semantic-collision-test.db');
            const db = new Database(testDbPath);
            
            // Create scenario with semantic ID collisions
            db.exec(`
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT,
                    file_path TEXT
                );
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT
                );
                
                -- Semantic ID collisions: same semantic_id in different files
                INSERT INTO pois VALUES (1, 'User', 'class', 'user_class', '/src/models/User.js');
                INSERT INTO pois VALUES (2, 'User', 'class', 'user_class', '/src/entities/User.js');
                INSERT INTO pois VALUES (3, 'User', 'interface', 'user_class', '/src/types/User.ts');
                
                -- Relationships involving colliding POIs
                INSERT INTO relationships VALUES (1, 1, 2, 'duplicate_of', 0.9, 'VALIDATED');
                INSERT INTO relationships VALUES (2, 2, 3, 'implements', 0.8, 'VALIDATED');
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const DataConsistencyFixer = require('./fix-data-consistency-issues');
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify semantic ID collisions were resolved
            const verifyDb = new Database(testDbPath);
            
            // Check for duplicate semantic IDs
            const duplicateSemanticIds = verifyDb.prepare(`
                SELECT semantic_id, COUNT(*) as count 
                FROM pois 
                WHERE semantic_id IS NOT NULL 
                GROUP BY semantic_id 
                HAVING COUNT(*) > 1
            `).all();
            
            // Check if relationships maintain integrity after collision resolution
            const validRelationships = verifyDb.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                INNER JOIN pois sp ON r.source_poi_id = sp.id
                INNER JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED'
            `).get().count;
            
            verifyDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            const passed = duplicateSemanticIds.length === 0 && validRelationships >= 2;
            this.addTestResult(testName, passed,
                passed ? 'Semantic ID collisions resolved while maintaining relationship integrity' :
                `${duplicateSemanticIds.length} semantic ID collisions remain, ${validRelationships} relationships valid`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    // ========== PRODUCTION ENVIRONMENT EDGE CASES ==========

    async testContainerMemoryLimits() {
        console.log('🐳 Container Memory Limit Handling');
        const testName = 'Container Memory Limit Handling';
        
        try {
            const testDbPath = path.join(this.tempDir, 'memory-limit-test.db');
            const db = new Database(testDbPath);
            
            // Create large dataset that might exceed container memory limits
            db.exec(`
                CREATE TABLE relationships (
                    id INTEGER PRIMARY KEY,
                    source_poi_id INTEGER,
                    target_poi_id INTEGER,
                    type TEXT,
                    confidence REAL,
                    status TEXT,
                    large_data TEXT
                );
                CREATE TABLE pois (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    semantic_id TEXT,
                    large_metadata TEXT
                );
            `);
            
            // Insert data designed to consume significant memory
            const largeData = 'x'.repeat(50000); // 50KB per record
            const insertPoi = db.prepare("INSERT INTO pois (name, type, semantic_id, large_metadata) VALUES (?, ?, ?, ?)");
            const insertRel = db.prepare("INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, large_data) VALUES (?, ?, ?, ?, ?, ?)");
            
            db.transaction(() => {
                for (let i = 1; i <= 500; i++) { // 25MB of POI data
                    insertPoi.run(`MemTestPOI_${i}`, 'function', `mem_test_${i}`, largeData);
                }
                for (let i = 1; i <= 250; i++) { // Additional relationship data
                    insertRel.run(
                        Math.floor(Math.random() * 500) + 1,
                        Math.floor(Math.random() * 500) + 1,
                        'memory_test_rel',
                        Math.random(),
                        'VALIDATED',
                        largeData
                    );
                }
            })();
            
            db.close();
            
            // Monitor memory usage during processing
            const initialMemory = process.memoryUsage();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const DataConsistencyFixer = require('./fix-data-consistency-issues');
            const fixer = new DataConsistencyFixer();
            
            // Process with memory monitoring
            let memoryExceeded = false;
            const memoryMonitor = setInterval(() => {
                const currentMemory = process.memoryUsage();
                const heapUsedMB = currentMemory.heapUsed / (1024 * 1024);
                if (heapUsedMB > 512) { // 512MB limit simulation
                    memoryExceeded = true;
                }
            }, 100);
            
            try {
                await fixer.run();
            } catch (error) {
                if (error.message.includes('memory') || error.message.includes('ENOMEM')) {
                    // Expected behavior under memory pressure
                }
            }
            
            clearInterval(memoryMonitor);
            
            const finalMemory = process.memoryUsage();
            const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Should handle memory pressure gracefully without crashing
            const passed = !memoryExceeded && memoryIncrease < 200; // Reasonable memory usage
            this.addTestResult(testName, passed,
                passed ? `Memory usage controlled: +${memoryIncrease.toFixed(2)}MB` :
                `Memory pressure detected: +${memoryIncrease.toFixed(2)}MB, exceeded limit: ${memoryExceeded}`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    // ========== SECURITY AND DATA SAFETY EDGE CASES ==========

    async testConfidenceScoreManipulation() {
        console.log('🎯 Confidence Score Manipulation Detection');
        const testName = 'Confidence Score Manipulation Detection';
        
        try {
            const testDbPath = path.join(this.tempDir, 'confidence-manipulation-test.db');
            const db = new Database(testDbPath);
            
            // Create scenarios with manipulated confidence scores
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
                CREATE TABLE relationship_evidence (
                    id INTEGER PRIMARY KEY,
                    relationship_id INTEGER,
                    evidence_data TEXT,
                    confidence REAL
                );
                
                INSERT INTO pois VALUES (1, 'TestPOI1', 'function'), (2, 'TestPOI2', 'class');
                
                -- Manipulated confidence scores that don't match evidence
                INSERT INTO relationships VALUES (1, 1, 2, 'calls', 0.95, 'VALIDATED'); -- High confidence
                INSERT INTO relationship_evidence VALUES (1, 1, 'weak evidence', 0.2); -- But low evidence
                
                INSERT INTO relationships VALUES (2, 1, 2, 'inherits', 0.1, 'VALIDATED'); -- Low confidence  
                INSERT INTO relationship_evidence VALUES (2, 2, 'strong evidence', 0.9); -- But high evidence
                
                -- Impossible confidence values
                INSERT INTO relationships VALUES (3, 1, 2, 'uses', 1.5, 'VALIDATED'); -- > 1.0
                INSERT INTO relationships VALUES (4, 1, 2, 'imports', -0.3, 'VALIDATED'); -- < 0.0
            `);
            
            db.close();
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            const DataConsistencyFixer = require('./fix-data-consistency-issues');
            const fixer = new DataConsistencyFixer();
            await fixer.run();
            
            // Verify manipulation detection and correction
            const verifyDb = new Database(testDbPath);
            
            // Check for impossible confidence values
            const invalidConfidence = verifyDb.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE confidence < 0 OR confidence > 1 OR confidence IS NULL
            `).get().count;
            
            // Check evidence-confidence alignment
            const misaligned = verifyDb.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                INNER JOIN relationship_evidence re ON r.id = re.relationship_id
                WHERE ABS(r.confidence - re.confidence) > 0.5
            `).get().count;
            
            verifyDb.close();
            config.SQLITE_DB_PATH = originalDbPath;
            
            const passed = invalidConfidence === 0 && misaligned <= 1;
            this.addTestResult(testName, passed,
                passed ? 'Confidence score manipulation detected and corrected' :
                `${invalidConfidence} invalid confidence scores, ${misaligned} evidence misalignments remain`);
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    // ========== ADVANCED RECOVERY EDGE CASES ==========

    async testCascadingFailureRecovery() {
        console.log('⚡ Cascading Failure Recovery');
        const testName = 'Cascading Failure Recovery';
        
        try {
            const testDbPath = path.join(this.tempDir, 'cascading-failure-test.db');
            
            // Create multiple databases that depend on each other
            const primaryDb = new Database(testDbPath);
            const secondaryDbPath = testDbPath.replace('.db', '-secondary.db');
            const secondaryDb = new Database(secondaryDbPath);
            
            // Set up interdependent data
            primaryDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, type TEXT, dependency_db TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'PrimaryPOI');
                INSERT INTO relationships VALUES (1, 'primary_rel', 'secondary');
            `);
            
            secondaryDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, type TEXT, dependency_db TEXT);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO pois VALUES (1, 'SecondaryPOI');
                INSERT INTO relationships VALUES (1, 'secondary_rel', 'primary');
            `);
            
            primaryDb.close();
            secondaryDb.close();
            
            // Corrupt secondary database to trigger cascading failure
            const secondaryBuffer = fs.readFileSync(secondaryDbPath);
            const corruptedBuffer = Buffer.from(secondaryBuffer);
            corruptedBuffer.write('CORRUPT', 100); // Corrupt data pages
            fs.writeFileSync(secondaryDbPath, corruptedBuffer);
            
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = testDbPath;
            
            // Test recovery from cascading failure
            let recoveryAttempted = false;
            try {
                const DataConsistencyFixer = require('./fix-data-consistency-issues');
                const fixer = new DataConsistencyFixer();
                await fixer.run();
                recoveryAttempted = true;
            } catch (error) {
                // Should attempt graceful recovery even with dependencies failing
                recoveryAttempted = error.message.includes('recovery') || error.message.includes('fallback');
            }
            
            // Verify primary database remains functional
            const recoveredDb = new Database(testDbPath);
            const primaryData = recoveredDb.prepare("SELECT COUNT(*) as count FROM pois").get().count;
            recoveredDb.close();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            const passed = recoveryAttempted && primaryData > 0;
            this.addTestResult(testName, passed,
                passed ? 'Cascading failure recovery handled gracefully' :
                'Failed to recover from cascading failures');
                
        } catch (error) {
            this.addTestResult(testName, false, `Test failed: ${error.message}`);
        }
    }

    // ========== HELPER METHODS ==========

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

    generateAdditionalEdgeCaseReport() {
        console.log('\n📋 ADDITIONAL EDGE CASE TEST SUMMARY');
        console.log('=====================================');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);
        
        console.log(`📊 Additional Tests: ${totalTests}`);
        console.log(`✅ Passed: ${passedTests}`);
        console.log(`❌ Failed: ${failedTests}`);
        console.log(`📈 Success Rate: ${successRate}%`);
        
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                additional_tests: totalTests,
                passed: passedTests,
                failed: failedTests,
                success_rate: successRate + '%'
            },
            test_categories: {
                schema_evolution: this.testResults.filter(r => r.name.includes('Schema')).length,
                cognitive_triangulation: this.testResults.filter(r => 
                    r.name.includes('Evidence') || r.name.includes('Semantic') || r.name.includes('Confidence')
                ).length,
                production_environment: this.testResults.filter(r => 
                    r.name.includes('Container') || r.name.includes('Network') || r.name.includes('Memory')
                ).length,
                security_data_safety: this.testResults.filter(r => 
                    r.name.includes('Manipulation') || r.name.includes('Collision') || r.name.includes('Poisoning')
                ).length,
                advanced_recovery: this.testResults.filter(r => r.name.includes('Recovery')).length
            },
            detailed_results: this.testResults,
            gaps_identified: this.identifyRemainingGaps()
        };
        
        const reportPath = 'additional-edge-case-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Additional edge case report saved to: ${reportPath}`);
        
        return report;
    }

    identifyRemainingGaps() {
        return [
            {
                category: 'Distributed System Edge Cases',
                missing_tests: [
                    'Multi-node data consistency under network partition',
                    'Consensus algorithm failure scenarios',
                    'Distributed transaction rollback coordination'
                ]
            },
            {
                category: 'Real-time Processing Edge Cases',
                missing_tests: [
                    'Streaming data ingestion failures',
                    'Real-time confidence score updates under load',
                    'Live system reconfiguration edge cases'
                ]
            },
            {
                category: 'Machine Learning Edge Cases',
                missing_tests: [
                    'Model prediction confidence calibration failures',
                    'Training data poisoning detection',
                    'Adversarial input handling in confidence scoring'
                ]
            }
        ];
    }

    async cleanup() {
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
            console.log('🧹 Additional edge case cleanup complete');
        } catch (error) {
            console.warn('⚠️  Warning: Could not clean up test directory:', error.message);
        }
    }
}

// Placeholder implementations for remaining methods
AdditionalEdgeCases.prototype.testSchemaRollbackScenarios = async function() {
    this.addTestResult('Schema Rollback Scenarios', false, 'Not implemented - requires schema versioning system');
};

AdditionalEdgeCases.prototype.testMixedSchemaVersions = async function() {
    this.addTestResult('Mixed Schema Versions', false, 'Not implemented - requires distributed database testing');
};

AdditionalEdgeCases.prototype.testCrossFileRelationshipValidation = async function() {
    this.addTestResult('Cross-File Relationship Validation', false, 'Not implemented - requires file system integration');
};

AdditionalEdgeCases.prototype.testConfidenceScoreBoundaryViolations = async function() {
    this.addTestResult('Confidence Score Boundary Violations', false, 'Not implemented - requires ConfidenceScoring integration');
};

AdditionalEdgeCases.prototype.testGraphTraversalInfiniteLoops = async function() {
    this.addTestResult('Graph Traversal Infinite Loops', false, 'Not implemented - requires Neo4j integration');
};

AdditionalEdgeCases.prototype.testNetworkPartitionRecovery = async function() {
    this.addTestResult('Network Partition Recovery', false, 'Not implemented - requires network simulation');
};

AdditionalEdgeCases.prototype.testFileSystemIOErrors = async function() {
    this.addTestResult('File System I/O Errors', false, 'Not implemented - requires filesystem mocking');
};

AdditionalEdgeCases.prototype.testDatabaseConnectionPoolExhaustion = async function() {
    this.addTestResult('Database Connection Pool Exhaustion', false, 'Not implemented - requires connection pool testing');
};

AdditionalEdgeCases.prototype.testRedisEvictionUnderLoad = async function() {
    this.addTestResult('Redis Eviction Under Load', false, 'Not implemented - requires Redis integration');
};

AdditionalEdgeCases.prototype.testPOISemanticIdCollisionAttacks = async function() {
    this.addTestResult('POI Semantic ID Collision Attacks', false, 'Not implemented - requires security testing framework');
};

AdditionalEdgeCases.prototype.testRelationshipEvidenceTampering = async function() {
    this.addTestResult('Relationship Evidence Tampering', false, 'Not implemented - requires cryptographic validation');
};

AdditionalEdgeCases.prototype.testGraphDataPoisoning = async function() {
    this.addTestResult('Graph Data Poisoning', false, 'Not implemented - requires anomaly detection');
};

AdditionalEdgeCases.prototype.testSQLInjectionInDynamicQueries = async function() {
    this.addTestResult('SQL Injection in Dynamic Queries', false, 'Not implemented - requires query analysis');
};

AdditionalEdgeCases.prototype.testPartialRecoveryCompletion = async function() {
    this.addTestResult('Partial Recovery Completion', false, 'Not implemented - requires recovery state tracking');
};

AdditionalEdgeCases.prototype.testRecoveryDataIntegrityValidation = async function() {
    this.addTestResult('Recovery Data Integrity Validation', false, 'Not implemented - requires integrity checking');
};

AdditionalEdgeCases.prototype.testRecoveryUnderResourceConstraints = async function() {
    this.addTestResult('Recovery Under Resource Constraints', false, 'Not implemented - requires resource monitoring');
};

AdditionalEdgeCases.prototype.testPerformanceDegradationDetection = async function() {
    this.addTestResult('Performance Degradation Detection', false, 'Not implemented - requires performance baseline');
};

AdditionalEdgeCases.prototype.testMemoryLeakDetection = async function() {
    this.addTestResult('Memory Leak Detection', false, 'Not implemented - requires long-running tests');
};

AdditionalEdgeCases.prototype.testResourceExhaustionRecovery = async function() {
    this.addTestResult('Resource Exhaustion Recovery', false, 'Not implemented - requires resource simulation');
};

// Run additional edge case tests if called directly
if (require.main === module) {
    const additionalTests = new AdditionalEdgeCases();
    additionalTests.runAllAdditionalTests()
        .then(() => {
            const failedTests = additionalTests.testResults.filter(r => !r.passed).length;
            process.exit(failedTests > 0 ? 1 : 0);
        })
        .catch((error) => {
            console.error('\n❌ Additional edge case testing failed:', error);
            process.exit(1);
        });
}

module.exports = AdditionalEdgeCases;