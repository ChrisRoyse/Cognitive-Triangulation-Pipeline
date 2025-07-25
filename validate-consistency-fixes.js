#!/usr/bin/env node

/**
 * Validation Script for Data Consistency Fixes
 * 
 * This script validates that all data consistency fixes are working correctly:
 * 1. Database path consistency
 * 2. Confidence scoring validation
 * 3. Graph building data integrity
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');

class ConsistencyValidator {
    constructor() {
        this.dbPath = config.SQLITE_DB_PATH;
        this.validationResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
        
        console.log(`🔍 Consistency Validator initialized with DB path: ${this.dbPath}`);
    }

    async run() {
        console.log('🚀 Starting consistency validation tests...\n');

        try {
            // Test 1: Database Path Consistency
            this.testDatabasePathConsistency();
            
            // Test 2: Database Schema Completeness
            this.testDatabaseSchema();
            
            // Test 3: Confidence Scoring Data Integrity
            this.testConfidenceScoringIntegrity();
            
            // Test 4: Graph Building Data Validation
            this.testGraphBuildingDataIntegrity();
            
            // Test 5: Index Existence
            this.testIndexExistence();
            
            // Generate final report
            this.generateValidationReport();
            
        } catch (error) {
            console.error('❌ Critical error during validation:', error);
            throw error;
        }
    }

    testDatabasePathConsistency() {
        console.log('📁 Test 1: Database Path Consistency');
        
        try {
            // Check if primary database exists
            const exists = fs.existsSync(this.dbPath);
            this.addTestResult('Database file exists', exists, `Database should exist at ${this.dbPath}`);
            
            if (exists) {
                const stats = fs.statSync(this.dbPath);
                const hasData = stats.size > 0;
                this.addTestResult('Database has data', hasData, 'Database file should not be empty');
                
                // Check data directory structure
                const dataDir = path.dirname(this.dbPath);
                const dataDirExists = fs.existsSync(dataDir);
                this.addTestResult('Data directory exists', dataDirExists, `Data directory should exist at ${dataDir}`);
            }
            
        } catch (error) {
            this.addTestResult('Database path test', false, `Error: ${error.message}`);
        }
        
        console.log('✅ Database path consistency test complete\n');
    }

    testDatabaseSchema() {
        console.log('🗂️  Test 2: Database Schema Completeness');
        
        if (!fs.existsSync(this.dbPath)) {
            this.addTestResult('Schema test', false, 'Database file does not exist');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Check required tables exist
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            
            const requiredTables = [
                'files', 'pois', 'relationships', 
                'relationship_evidence', 'relationship_evidence_tracking',
                'triangulated_analysis_sessions', 'subagent_analyses', 'consensus_decisions'
            ];
            
            for (const table of requiredTables) {
                const exists = tableNames.includes(table);
                this.addTestResult(`Table ${table} exists`, exists, `Required table ${table} should exist`);
            }
            
            // Check new columns exist
            const newColumns = [
                { table: 'relationships', column: 'evidence_hash' },
                { table: 'pois', column: 'analysis_quality_score' },
                { table: 'relationships', column: 'validation_timestamp' }
            ];
            
            for (const col of newColumns) {
                try {
                    const pragma = db.prepare(`PRAGMA table_info(${col.table})`).all();
                    const columnExists = pragma.some(p => p.name === col.column);
                    this.addTestResult(`Column ${col.table}.${col.column} exists`, columnExists, 
                        `New column ${col.column} should exist in ${col.table} table`);
                } catch (error) {
                    this.addTestResult(`Column ${col.table}.${col.column} check`, false, `Error: ${error.message}`);
                }
            }
            
        } finally {
            db.close();
        }
        
        console.log('✅ Database schema test complete\n');
    }

    testConfidenceScoringIntegrity() {
        console.log('🎯 Test 3: Confidence Scoring Data Integrity');
        
        if (!fs.existsSync(this.dbPath)) {
            this.addTestResult('Confidence scoring test', false, 'Database file does not exist');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Test: No relationships with confidence > 0 but no evidence
            const invalidConfidenceRels = db.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships r 
                LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                WHERE r.confidence > 0 AND re.id IS NULL
            `).get();
            
            this.addTestResult('No relationships with confidence but no evidence', 
                invalidConfidenceRels.count === 0, 
                `Found ${invalidConfidenceRels.count} relationships with confidence scores but no evidence`);
            
            // Test: Confidence scores are in valid range
            const invalidRangeConfidence = db.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships 
                WHERE confidence IS NOT NULL AND (confidence < 0 OR confidence > 1)
            `).get();
            
            this.addTestResult('All confidence scores in valid range (0-1)', 
                invalidRangeConfidence.count === 0, 
                `Found ${invalidRangeConfidence.count} relationships with confidence scores outside 0-1 range`);
            
            // Test: Triangulation sessions have consistent data
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            
            if (tableNames.includes('triangulated_analysis_sessions')) {
                const incompleteTriangulation = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM triangulated_analysis_sessions 
                    WHERE status = 'COMPLETED' AND (final_confidence IS NULL OR consensus_score IS NULL)
                `).get();
                
                this.addTestResult('No incomplete triangulation sessions marked as completed', 
                    incompleteTriangulation.count === 0, 
                    `Found ${incompleteTriangulation.count} completed triangulation sessions with missing data`);
            }
            
        } finally {
            db.close();
        }
        
        console.log('✅ Confidence scoring integrity test complete\n');
    }

    testGraphBuildingDataIntegrity() {
        console.log('📊 Test 4: Graph Building Data Integrity');
        
        if (!fs.existsSync(this.dbPath)) {
            this.addTestResult('Graph building test', false, 'Database file does not exist');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Test: No validated relationships with missing POI references
            const orphanedRels = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND (sp.id IS NULL OR tp.id IS NULL)
            `).get();
            
            this.addTestResult('No validated relationships with missing POI references', 
                orphanedRels.count === 0, 
                `Found ${orphanedRels.count} validated relationships referencing non-existent POIs`);
            
            // Test: All validated relationships have valid confidence
            const invalidValidatedConfidence = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (confidence IS NULL OR confidence <= 0 OR confidence > 1)
            `).get();
            
            this.addTestResult('All validated relationships have valid confidence', 
                invalidValidatedConfidence.count === 0, 
                `Found ${invalidValidatedConfidence.count} validated relationships with invalid confidence`);
            
            // Test: All validated relationships have types
            const missingTypes = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (type IS NULL OR type = '')
            `).get();
            
            this.addTestResult('All validated relationships have types', 
                missingTypes.count === 0, 
                `Found ${missingTypes.count} validated relationships without types`);
            
            // Test: POIs referenced by validated relationships have complete data
            const incompletePois = db.prepare(`
                SELECT COUNT(*) as count
                FROM pois p
                INNER JOIN relationships r ON (p.id = r.source_poi_id OR p.id = r.target_poi_id)
                WHERE r.status = 'VALIDATED'
                AND (p.name IS NULL OR p.name = '' OR p.type IS NULL OR p.type = '')
            `).get();
            
            this.addTestResult('POIs referenced by validated relationships have complete data', 
                incompletePois.count === 0, 
                `Found ${incompletePois.count} POIs with missing data referenced by validated relationships`);
            
        } finally {
            db.close();
        }
        
        console.log('✅ Graph building data integrity test complete\n');
    }

    testIndexExistence() {
        console.log('📇 Test 5: Index Existence');
        
        if (!fs.existsSync(this.dbPath)) {
            this.addTestResult('Index test', false, 'Database file does not exist');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Get all indexes
            const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();
            const indexNames = indexes.map(i => i.name);
            
            // Check for key performance indexes
            const expectedIndexes = [
                'idx_relationships_status',
                'idx_pois_file_id',
                'idx_pois_run_id',
                'idx_relationships_run_id',
                'idx_pois_semantic_id',
                'idx_relationships_confidence_desc'
            ];
            
            for (const indexName of expectedIndexes) {
                const exists = indexNames.includes(indexName);
                this.addTestResult(`Index ${indexName} exists`, exists, `Performance index ${indexName} should exist`);
            }
            
            // Test index effectiveness with a sample query
            try {
                const explainQuery = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM relationships WHERE status = 'VALIDATED'");
                const queryPlan = explainQuery.all();
                const usesIndex = queryPlan.some(step => step.detail && step.detail.includes('idx_relationships_status'));
                
                this.addTestResult('Query uses status index', usesIndex, 'Queries on relationship status should use index');
            } catch (error) {
                this.addTestResult('Index usage test', false, `Could not test index usage: ${error.message}`);
            }
            
        } finally {
            db.close();
        }
        
        console.log('✅ Index existence test complete\n');
    }

    addTestResult(testName, passed, description) {
        this.validationResults.tests.push({
            name: testName,
            passed: passed,
            description: description
        });
        
        if (passed) {
            this.validationResults.passed++;
            console.log(`  ✅ ${testName}`);
        } else {
            this.validationResults.failed++;
            console.log(`  ❌ ${testName}: ${description}`);
        }
    }

    generateValidationReport() {
        console.log('📋 VALIDATION SUMMARY');
        console.log('========================');
        console.log(`🗂️  Database Path: ${this.dbPath}`);
        console.log(`✅ Tests Passed: ${this.validationResults.passed}`);
        console.log(`❌ Tests Failed: ${this.validationResults.failed}`);
        console.log(`📊 Total Tests: ${this.validationResults.tests.length}`);
        
        const successRate = ((this.validationResults.passed / this.validationResults.tests.length) * 100).toFixed(1);
        console.log(`📈 Success Rate: ${successRate}%`);
        
        if (this.validationResults.failed > 0) {
            console.log('\n❌ FAILED TESTS:');
            this.validationResults.tests
                .filter(test => !test.passed)
                .forEach((test, index) => {
                    console.log(`  ${index + 1}. ${test.name}: ${test.description}`);
                });
        }
        
        // Save detailed report
        const report = {
            timestamp: new Date().toISOString(),
            database_path: this.dbPath,
            summary: {
                total_tests: this.validationResults.tests.length,
                passed: this.validationResults.passed,
                failed: this.validationResults.failed,
                success_rate: successRate + '%'
            },
            tests: this.validationResults.tests
        };
        
        const reportPath = 'consistency-validation-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Detailed validation report saved to: ${reportPath}`);
        
        // Overall assessment
        if (this.validationResults.failed === 0) {
            console.log('\n🎉 ALL TESTS PASSED - Data consistency fixes are working correctly!');
        } else if (successRate >= 80) {
            console.log('\n⚠️  MOSTLY SUCCESSFUL - Some minor issues remain but core fixes are working');
        } else {
            console.log('\n🚨 SIGNIFICANT ISSUES - Data consistency fixes need additional attention');
        }
    }
}

// Run validation if called directly
if (require.main === module) {
    const validator = new ConsistencyValidator();
    validator.run()
        .then(() => {
            const hasFailures = validator.validationResults.failed > 0;
            process.exit(hasFailures ? 1 : 0);
        })
        .catch((error) => {
            console.error('\n❌ Validation failed:', error);
            process.exit(1);
        });
}

module.exports = ConsistencyValidator;