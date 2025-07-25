#!/usr/bin/env node

/**
 * Comprehensive Data Consistency Fixes
 * 
 * This script addresses critical data consistency issues:
 * 1. Database path inconsistencies across multiple SQLite files
 * 2. Confidence scoring with meaningless results due to lack of evidence
 * 3. Graph building proceeding with incomplete/failed analysis data
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');

class DataConsistencyFixer {
    constructor() {
        this.issues = [];
        this.fixes = [];
        this.dbPath = config.SQLITE_DB_PATH;
        
        console.log(`🔍 Data Consistency Fixer initialized with DB path: ${this.dbPath}`);
    }

    async run() {
        console.log('🚀 Starting comprehensive data consistency analysis and fixes...\n');

        try {
            // Phase 1: Database Path Consolidation
            await this.analyzeAndFixDatabasePaths();
            
            // Phase 2: Confidence Scoring Validation
            await this.analyzeAndFixConfidenceScoring();
            
            // Phase 3: Graph Building Data Validation
            await this.analyzeAndFixGraphBuildingData();
            
            // Phase 4: Apply Critical Database Schema Fixes
            await this.applyCriticalSchemaFixes();
            
            // Phase 5: Generate Summary Report
            this.generateSummaryReport();
            
        } catch (error) {
            console.error('❌ Critical error during data consistency fixes:', error);
            throw error;
        }
    }

    async analyzeAndFixDatabasePaths() {
        console.log('📁 Phase 1: Analyzing database path inconsistencies...');
        
        // Check for multiple database files
        const commonDbPaths = [
            './data/database.db',
            './database.sqlite',
            './cognitive_graph.db',
            './test_db.sqlite',
            './dev.db',
            './test.db'
        ];
        
        const existingDbs = [];
        for (const dbPath of commonDbPaths) {
            if (fs.existsSync(dbPath)) {
                existingDbs.push({
                    path: dbPath,
                    size: fs.statSync(dbPath).size,
                    modified: fs.statSync(dbPath).mtime
                });
            }
        }
        
        if (existingDbs.length > 1) {
            this.issues.push({
                type: 'DATABASE_PATH_INCONSISTENCY',
                severity: 'HIGH',
                description: `Found ${existingDbs.length} database files, expected 1`,
                details: existingDbs
            });
            
            // Find the most recent non-empty database
            const primaryDb = existingDbs
                .filter(db => db.size > 0)
                .sort((a, b) => b.modified - a.modified)[0];
                
            if (primaryDb && primaryDb.path !== this.dbPath) {
                console.log(`📋 Primary database identified: ${primaryDb.path} (${primaryDb.size} bytes)`);
                console.log(`🔄 Expected path: ${this.dbPath}`);
                
                // Create data directory if it doesn't exist
                const expectedDir = path.dirname(this.dbPath);
                if (!fs.existsSync(expectedDir)) {
                    fs.mkdirSync(expectedDir, { recursive: true });
                    this.fixes.push(`Created directory: ${expectedDir}`);
                }
                
                // Copy primary database to expected location if needed
                if (!fs.existsSync(this.dbPath) || fs.statSync(this.dbPath).size === 0) {
                    fs.copyFileSync(primaryDb.path, this.dbPath);
                    this.fixes.push(`Copied ${primaryDb.path} to ${this.dbPath}`);
                    console.log(`✅ Consolidated database to: ${this.dbPath}`);
                }
            }
        }
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            this.fixes.push(`Created data directory: ${dataDir}`);
        }
        
        console.log('✅ Database path analysis complete\n');
    }

    async analyzeAndFixConfidenceScoring() {
        console.log('🎯 Phase 2: Analyzing confidence scoring data consistency...');
        
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  No database found, skipping confidence analysis');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Check if confidence scoring tables exist
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            
            const requiredTables = [
                'relationship_evidence',
                'relationship_evidence_tracking',
                'triangulated_analysis_sessions',
                'subagent_analyses',
                'consensus_decisions'
            ];
            
            const missingTables = requiredTables.filter(table => !tableNames.includes(table));
            if (missingTables.length > 0) {
                this.issues.push({
                    type: 'MISSING_CONFIDENCE_TABLES',
                    severity: 'HIGH',
                    description: `Missing tables required for confidence scoring: ${missingTables.join(', ')}`
                });
            }
            
            // Check relationships without proper evidence
            if (tableNames.includes('relationships')) {
                const relationshipsWithoutEvidence = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM relationships r 
                    LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                    WHERE re.id IS NULL AND r.confidence > 0
                `).get();
                
                if (relationshipsWithoutEvidence.count > 0) {
                    this.issues.push({
                        type: 'RELATIONSHIPS_WITHOUT_EVIDENCE',
                        severity: 'HIGH',
                        description: `${relationshipsWithoutEvidence.count} relationships have confidence scores but no supporting evidence`,
                        count: relationshipsWithoutEvidence.count
                    });
                    
                    // Fix: Reset confidence scores for relationships without evidence
                    const resetCount = db.prepare(`
                        UPDATE relationships 
                        SET confidence = 0.0, evidence = NULL 
                        WHERE id IN (
                            SELECT r.id 
                            FROM relationships r 
                            LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                            WHERE re.id IS NULL AND r.confidence > 0
                        )
                    `).run();
                    
                    this.fixes.push(`Reset confidence scores for ${resetCount.changes} relationships without evidence`);
                    console.log(`🔧 Reset confidence for ${resetCount.changes} relationships without evidence`);
                }
            }
            
            // Check for triangulated sessions without proper completion
            if (tableNames.includes('triangulated_analysis_sessions')) {
                const incompleteTriangulation = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM triangulated_analysis_sessions 
                    WHERE status = 'COMPLETED' AND (final_confidence IS NULL OR consensus_score IS NULL)
                `).get();
                
                if (incompleteTriangulation.count > 0) {
                    this.issues.push({
                        type: 'INCOMPLETE_TRIANGULATION',
                        severity: 'MEDIUM',
                        description: `${incompleteTriangulation.count} triangulation sessions marked complete but missing final scores`,
                        count: incompleteTriangulation.count
                    });
                    
                    // Fix: Reset incomplete triangulation sessions
                    const resetTriangulation = db.prepare(`
                        UPDATE triangulated_analysis_sessions 
                        SET status = 'FAILED', error_message = 'Reset due to incomplete data during consistency check'
                        WHERE status = 'COMPLETED' AND (final_confidence IS NULL OR consensus_score IS NULL)
                    `).run();
                    
                    this.fixes.push(`Reset ${resetTriangulation.changes} incomplete triangulation sessions`);
                    console.log(`🔧 Reset ${resetTriangulation.changes} incomplete triangulation sessions`);
                }
            }
            
        } finally {
            db.close();
        }
        
        console.log('✅ Confidence scoring analysis complete\n');
    }

    async analyzeAndFixGraphBuildingData() {
        console.log('📊 Phase 3: Analyzing graph building data consistency...');
        
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  No database found, skipping graph building analysis');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Check for relationships marked as VALIDATED but missing critical data
            const invalidValidatedRels = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (
                    source_poi_id IS NULL 
                    OR target_poi_id IS NULL 
                    OR confidence <= 0 
                    OR type IS NULL 
                    OR type = ''
                )
            `).get();
            
            if (invalidValidatedRels.count > 0) {
                this.issues.push({
                    type: 'INVALID_VALIDATED_RELATIONSHIPS',
                    severity: 'HIGH',
                    description: `${invalidValidatedRels.count} relationships marked VALIDATED but missing critical data`,
                    count: invalidValidatedRels.count
                });
                
                // Fix: Reset invalid validated relationships
                const resetInvalid = db.prepare(`
                    UPDATE relationships 
                    SET status = 'FAILED', confidence = 0.0
                    WHERE status = 'VALIDATED' 
                    AND (
                        source_poi_id IS NULL 
                        OR target_poi_id IS NULL 
                        OR confidence <= 0 
                        OR type IS NULL 
                        OR type = ''
                    )
                `).run();
                
                this.fixes.push(`Reset ${resetInvalid.changes} invalid validated relationships`);
                console.log(`🔧 Reset ${resetInvalid.changes} invalid validated relationships`);
            }
            
            // Check for POIs referenced by relationships but missing from pois table
            const orphanedRelationships = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND (sp.id IS NULL OR tp.id IS NULL)
            `).get();
            
            if (orphanedRelationships.count > 0) {
                this.issues.push({
                    type: 'ORPHANED_RELATIONSHIPS',
                    severity: 'HIGH',
                    description: `${orphanedRelationships.count} validated relationships reference non-existent POIs`,
                    count: orphanedRelationships.count
                });
                
                // Fix: Mark orphaned relationships as failed
                const markOrphaned = db.prepare(`
                    UPDATE relationships 
                    SET status = 'FAILED', confidence = 0.0
                    WHERE id IN (
                        SELECT r.id
                        FROM relationships r
                        LEFT JOIN pois sp ON r.source_poi_id = sp.id
                        LEFT JOIN pois tp ON r.target_poi_id = tp.id
                        WHERE r.status = 'VALIDATED' 
                        AND (sp.id IS NULL OR tp.id IS NULL)
                    )
                `).run();
                
                this.fixes.push(`Marked ${markOrphaned.changes} orphaned relationships as failed`);
                console.log(`🔧 Marked ${markOrphaned.changes} orphaned relationships as failed`);
            }
            
            // Check POI semantic ID consistency
            const duplicateSemanticIds = db.prepare(`
                SELECT semantic_id, COUNT(*) as count
                FROM pois 
                WHERE semantic_id IS NOT NULL AND semantic_id != ''
                GROUP BY semantic_id 
                HAVING COUNT(*) > 1
            `).all();
            
            if (duplicateSemanticIds.length > 0) {
                this.issues.push({
                    type: 'DUPLICATE_SEMANTIC_IDS',
                    severity: 'MEDIUM',
                    description: `${duplicateSemanticIds.length} semantic IDs are duplicated across POIs`,
                    count: duplicateSemanticIds.length
                });
                
                // Fix: Clear duplicate semantic IDs except for the first occurrence
                let fixedDuplicates = 0;
                for (const duplicate of duplicateSemanticIds) {
                    const clearDuplicates = db.prepare(`
                        UPDATE pois 
                        SET semantic_id = NULL 
                        WHERE semantic_id = ? 
                        AND id NOT IN (
                            SELECT id FROM (
                                SELECT id FROM pois 
                                WHERE semantic_id = ? 
                                ORDER BY id LIMIT 1
                            )
                        )
                    `).run(duplicate.semantic_id, duplicate.semantic_id);
                    
                    fixedDuplicates += clearDuplicates.changes;
                }
                
                this.fixes.push(`Cleared ${fixedDuplicates} duplicate semantic IDs`);
                console.log(`🔧 Cleared ${fixedDuplicates} duplicate semantic IDs`);
            }
            
        } finally {
            db.close();
        }
        
        console.log('✅ Graph building data analysis complete\n');
    }

    async applyCriticalSchemaFixes() {
        console.log('🛠️  Phase 4: Applying critical database schema fixes...');
        
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  No database found, skipping schema fixes');
            return;
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Ensure all required indexes exist
            const indexCommands = [
                'CREATE INDEX IF NOT EXISTS idx_relationships_status_validation ON relationships(status) WHERE status = "VALIDATED"',
                'CREATE INDEX IF NOT EXISTS idx_relationships_confidence_high ON relationships(confidence) WHERE confidence > 0.5',
                'CREATE INDEX IF NOT EXISTS idx_pois_semantic_id_not_null ON pois(semantic_id) WHERE semantic_id IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_relationship_evidence_relationship_id_active ON relationship_evidence(relationship_id)',
                'CREATE INDEX IF NOT EXISTS idx_triangulated_sessions_status_completed ON triangulated_analysis_sessions(status) WHERE status = "COMPLETED"'
            ];
            
            for (const indexCmd of indexCommands) {
                try {
                    db.exec(indexCmd);
                    this.fixes.push(`Created index: ${indexCmd.split('INDEX ')[1].split(' ')[0]}`);
                } catch (error) {
                    console.warn(`⚠️  Could not create index: ${error.message}`);
                }
            }
            
            // Add missing columns if they don't exist
            const columns = [
                { table: 'relationships', column: 'evidence_hash', type: 'TEXT' },
                { table: 'pois', column: 'analysis_quality_score', type: 'REAL DEFAULT 0.0' },
                { table: 'relationships', column: 'validation_timestamp', type: 'DATETIME' }
            ];
            
            for (const col of columns) {
                try {
                    // Check if column exists
                    const pragma = db.prepare(`PRAGMA table_info(${col.table})`).all();
                    const columnExists = pragma.some(p => p.name === col.column);
                    
                    if (!columnExists) {
                        db.exec(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.type}`);
                        this.fixes.push(`Added column ${col.column} to ${col.table}`);
                        console.log(`🔧 Added column ${col.column} to ${col.table}`);
                    }
                } catch (error) {
                    console.warn(`⚠️  Could not add column ${col.column}: ${error.message}`);
                }
            }
            
        } finally {
            db.close();
        }
        
        console.log('✅ Schema fixes complete\n');
    }

    generateSummaryReport() {
        console.log('📋 Phase 5: Generating summary report...\n');
        
        const report = {
            timestamp: new Date().toISOString(),
            database_path: this.dbPath,
            issues_found: this.issues.length,
            fixes_applied: this.fixes.length,
            issues: this.issues,
            fixes: this.fixes,
            recommendations: [
                'Run pipeline validation tests to ensure fixes are working correctly',
                'Monitor confidence scoring to ensure evidence is properly collected',
                'Verify graph building only processes validated relationships',
                'Consider implementing database integrity checks in the pipeline'
            ]
        };
        
        // Write report to file
        const reportPath = 'data-consistency-fix-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log('📊 DATA CONSISTENCY FIX SUMMARY');
        console.log('=====================================');
        console.log(`🗂️  Database Path: ${this.dbPath}`);
        console.log(`🚨 Issues Found: ${this.issues.length}`);
        console.log(`🔧 Fixes Applied: ${this.fixes.length}`);
        
        if (this.issues.length > 0) {
            console.log('\n📋 ISSUES IDENTIFIED:');
            this.issues.forEach((issue, index) => {
                console.log(`  ${index + 1}. [${issue.severity}] ${issue.type}: ${issue.description}`);
            });
        }
        
        if (this.fixes.length > 0) {
            console.log('\n✅ FIXES APPLIED:');
            this.fixes.forEach((fix, index) => {
                console.log(`  ${index + 1}. ${fix}`);
            });
        }
        
        console.log(`\n📄 Detailed report saved to: ${reportPath}`);
        
        // Quality assessment
        const criticalIssues = this.issues.filter(i => i.severity === 'HIGH').length;
        if (criticalIssues === 0) {
            console.log('\n✅ NO CRITICAL ISSUES REMAINING - Data consistency is good');
        } else {
            console.log(`\n⚠️  ${criticalIssues} CRITICAL ISSUES STILL NEED ATTENTION`);
        }
        
        console.log('\n🎯 NEXT STEPS:');
        console.log('1. Run pipeline tests to validate fixes');
        console.log('2. Monitor confidence scoring output quality');
        console.log('3. Verify graph building data integrity');
        console.log('4. Consider implementing automated integrity checks');
    }
}

// Run the fixer if called directly
if (require.main === module) {
    const fixer = new DataConsistencyFixer();
    fixer.run()
        .then(() => {
            console.log('\n🎉 Data consistency fix completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Data consistency fix failed:', error);
            process.exit(1);
        });
}

module.exports = DataConsistencyFixer;