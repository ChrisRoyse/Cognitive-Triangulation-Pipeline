/**
 * SQLite Database State Validator for Cognitive Triangulation Pipeline
 * 
 * Validates the complete state of SQLite databases after pipeline execution
 * against the established polyglot-test benchmark expectations.
 * 
 * Expected State for polyglot-test directory:
 * - files: ~15 rows (one per processed file)
 * - pois: ~417 rows (total POIs extracted)
 * - relationships: ~870 rows (total relationships)
 * - directory_summaries: ~3-5 rows
 * - relationship_evidence: ~100+ rows
 * - outbox: ~0 rows (processed events)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class SQLiteStateValidator {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
        this.validationResults = {
            passed: false,
            errors: [],
            warnings: [],
            tableValidations: {},
            benchmarkComparison: {},
            score: 0
        };
        
        // Expected benchmark values for polyglot-test
        this.benchmark = {
            files: { min: 13, expected: 15, max: 17 },
            pois: { min: 375, expected: 417, max: 460 },
            relationships: { min: 697, expected: 870, max: 1050 },
            directory_summaries: { min: 3, expected: 5, max: 7 },
            relationship_evidence: { min: 80, expected: 100, max: 150 },
            outbox: { min: 0, expected: 0, max: 5 }
        };
        
        // Expected POI type distribution
        this.poiTypeDistribution = {
            'function': { min: 200, expected: 235, max: 270 },
            'class': { min: 18, expected: 21, max: 25 },
            'variable': { min: 35, expected: 41, max: 50 },
            'import': { min: 55, expected: 66, max: 75 },
            'export': { min: 8, expected: 10, max: 15 },
            'table': { min: 20, expected: 25, max: 30 },
            'view': { min: 8, expected: 10, max: 12 },
            'index': { min: 8, expected: 10, max: 12 },
            'trigger': { min: 3, expected: 5, max: 7 }
        };
        
        // Expected relationship type distribution
        this.relationshipTypeDistribution = {
            'CONTAINS': { min: 360, expected: 402, max: 450 },
            'CALLS': { min: 120, expected: 150, max: 200 },
            'USES': { min: 80, expected: 100, max: 150 },
            'IMPORTS': { min: 55, expected: 66, max: 75 },
            'EXTENDS': { min: 1, expected: 2, max: 3 },
            'REFERENCES': { min: 35, expected: 45, max: 60 }
        };
    }
    
    async validate() {
        try {
            this.openDatabase();
            await this.validateDatabaseStructure();
            await this.validateTableCounts();
            await this.validateDataQuality();
            await this.validatePoiDistribution();
            await this.validateRelationshipDistribution();
            await this.validateDataIntegrity();
            await this.calculateScore();
            this.closeDatabase();
            
            this.validationResults.passed = this.validationResults.score >= 85;
            return this.validationResults;
        } catch (error) {
            this.validationResults.errors.push(`Validation failed: ${error.message}`);
            this.validationResults.passed = false;
            return this.validationResults;
        }
    }
    
    openDatabase() {
        if (!fs.existsSync(this.dbPath)) {
            throw new Error(`Database file not found: ${this.dbPath}`);
        }
        
        this.db = new Database(this.dbPath, { readonly: true });
        this.validationResults.warnings.push(`Connected to database: ${this.dbPath}`);
    }
    
    closeDatabase() {
        if (this.db) {
            this.db.close();
        }
    }
    
    async validateDatabaseStructure() {
        const expectedTables = ['files', 'pois', 'relationships', 'directory_summaries', 'relationship_evidence', 'outbox'];
        
        try {
            const tables = this.db.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
            `).all();
            
            const tableNames = tables.map(t => t.name);
            
            for (const expectedTable of expectedTables) {
                if (!tableNames.includes(expectedTable)) {
                    this.validationResults.errors.push(`Missing table: ${expectedTable}`);
                }
            }
            
            // Validate table schemas
            await this.validateTableSchemas();
            
        } catch (error) {
            this.validationResults.errors.push(`Database structure validation failed: ${error.message}`);
        }
    }
    
    async validateTableSchemas() {
        const expectedSchemas = {
            files: ['id', 'file_path', 'hash', 'last_processed', 'status'],
            pois: ['id', 'file_path', 'name', 'type', 'start_line', 'end_line', 'llm_output', 'hash'],
            relationships: ['id', 'source_poi_id', 'target_poi_id', 'type', 'file_path', 'status', 'confidence'],
            directory_summaries: ['id', 'directory_path', 'summary', 'created_at'],
            relationship_evidence: ['id', 'relationship_id', 'evidence_type', 'evidence_data', 'confidence'],
            outbox: ['id', 'event_type', 'payload', 'status', 'created_at', 'processed_at']
        };
        
        for (const [tableName, expectedColumns] of Object.entries(expectedSchemas)) {
            try {
                const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
                const columnNames = columns.map(c => c.name);
                
                for (const expectedColumn of expectedColumns) {
                    if (!columnNames.includes(expectedColumn)) {
                        this.validationResults.errors.push(`Missing column ${expectedColumn} in table ${tableName}`);
                    }
                }
            } catch (error) {
                this.validationResults.errors.push(`Schema validation failed for table ${tableName}: ${error.message}`);
            }
        }
    }
    
    async validateTableCounts() {
        for (const [tableName, benchmark] of Object.entries(this.benchmark)) {
            try {
                const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
                const actualCount = result.count;
                
                this.validationResults.tableValidations[tableName] = {
                    actual: actualCount,
                    expected: benchmark.expected,
                    min: benchmark.min,
                    max: benchmark.max,
                    passed: actualCount >= benchmark.min && actualCount <= benchmark.max,
                    score: this.calculateTableScore(actualCount, benchmark)
                };
                
                if (actualCount < benchmark.min) {
                    this.validationResults.errors.push(
                        `Table ${tableName}: count ${actualCount} below minimum ${benchmark.min}`
                    );
                } else if (actualCount > benchmark.max) {
                    this.validationResults.warnings.push(
                        `Table ${tableName}: count ${actualCount} above expected maximum ${benchmark.max}`
                    );
                }
                
            } catch (error) {
                this.validationResults.errors.push(`Count validation failed for table ${tableName}: ${error.message}`);
            }
        }
    }
    
    async validateDataQuality() {
        // Validate files table
        await this.validateFilesTable();
        
        // Validate pois table
        await this.validatePoisTable();
        
        // Validate relationships table
        await this.validateRelationshipsTable();
    }
    
    async validateFilesTable() {
        try {
            // Check for processed files
            const processedFiles = this.db.prepare(`
                SELECT COUNT(*) as count FROM files WHERE status = 'completed'
            `).get();
            
            if (processedFiles.count < this.benchmark.files.min) {
                this.validationResults.errors.push(
                    `Only ${processedFiles.count} files processed, expected at least ${this.benchmark.files.min}`
                );
            }
            
            // Check for failed files
            const failedFiles = this.db.prepare(`
                SELECT COUNT(*) as count FROM files WHERE status = 'failed'
            `).get();
            
            if (failedFiles.count > 2) {
                this.validationResults.warnings.push(
                    `${failedFiles.count} files failed processing, investigate failures`
                );
            }
            
            // Check for unique file paths
            const duplicateFiles = this.db.prepare(`
                SELECT file_path, COUNT(*) as count FROM files 
                GROUP BY file_path HAVING COUNT(*) > 1
            `).all();
            
            if (duplicateFiles.length > 0) {
                this.validationResults.errors.push(
                    `Duplicate file paths found: ${duplicateFiles.map(f => f.file_path).join(', ')}`
                );
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Files table validation failed: ${error.message}`);
        }
    }
    
    async validatePoisTable() {
        try {
            // Check for valid POI types
            const invalidTypes = this.db.prepare(`
                SELECT DISTINCT type FROM pois 
                WHERE type NOT IN ('function', 'class', 'variable', 'import', 'export', 'comment', 'table', 'view', 'index', 'trigger')
            `).all();
            
            if (invalidTypes.length > 0) {
                this.validationResults.warnings.push(
                    `Unknown POI types found: ${invalidTypes.map(t => t.type).join(', ')}`
                );
            }
            
            // Check for POIs without names
            const unnamed = this.db.prepare(`
                SELECT COUNT(*) as count FROM pois WHERE name IS NULL OR name = ''
            `).get();
            
            if (unnamed.count > 0) {
                this.validationResults.errors.push(`${unnamed.count} POIs found without names`);
            }
            
            // Check for valid line numbers
            const invalidLines = this.db.prepare(`
                SELECT COUNT(*) as count FROM pois 
                WHERE start_line IS NULL OR start_line < 1 OR end_line < start_line
            `).get();
            
            if (invalidLines.count > 0) {
                this.validationResults.errors.push(`${invalidLines.count} POIs with invalid line numbers`);
            }
            
            // Check for duplicate POIs
            const duplicates = this.db.prepare(`
                SELECT hash, COUNT(*) as count FROM pois 
                GROUP BY hash HAVING COUNT(*) > 1
            `).all();
            
            if (duplicates.length > 0) {
                this.validationResults.warnings.push(
                    `${duplicates.length} duplicate POI hashes found (possible deduplication issues)`
                );
            }
            
        } catch (error) {
            this.validationResults.errors.push(`POIs table validation failed: ${error.message}`);
        }
    }
    
    async validateRelationshipsTable() {
        try {
            // Check for valid relationship types
            const invalidTypes = this.db.prepare(`
                SELECT DISTINCT type FROM relationships 
                WHERE type NOT IN ('CALLS', 'USES', 'EXTENDS', 'IMPORTS', 'CONTAINS', 'REFERENCES')
            `).all();
            
            if (invalidTypes.length > 0) {
                this.validationResults.warnings.push(
                    `Unknown relationship types found: ${invalidTypes.map(t => t.type).join(', ')}`
                );
            }
            
            // Check for orphaned relationships
            const orphaned = this.db.prepare(`
                SELECT COUNT(*) as count FROM relationships r
                WHERE NOT EXISTS (SELECT 1 FROM pois p WHERE p.id = r.source_poi_id)
                   OR NOT EXISTS (SELECT 1 FROM pois p WHERE p.id = r.target_poi_id)
            `).get();
            
            if (orphaned.count > 0) {
                this.validationResults.errors.push(`${orphaned.count} orphaned relationships found`);
            }
            
            // Check confidence scores
            const invalidConfidence = this.db.prepare(`
                SELECT COUNT(*) as count FROM relationships 
                WHERE confidence IS NOT NULL 
                  AND (confidence < 0 OR confidence > 1)
            `).get();
            
            if (invalidConfidence.count > 0) {
                this.validationResults.errors.push(`${invalidConfidence.count} relationships with invalid confidence scores`);
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Relationships table validation failed: ${error.message}`);
        }
    }
    
    async validatePoiDistribution() {
        try {
            const distribution = this.db.prepare(`
                SELECT type, COUNT(*) as count FROM pois GROUP BY type
            `).all();
            
            this.validationResults.poiDistribution = {};
            
            for (const row of distribution) {
                const type = row.type;
                const count = row.count;
                const benchmark = this.poiTypeDistribution[type];
                
                if (benchmark) {
                    this.validationResults.poiDistribution[type] = {
                        actual: count,
                        expected: benchmark.expected,
                        passed: count >= benchmark.min && count <= benchmark.max
                    };
                    
                    if (count < benchmark.min) {
                        this.validationResults.errors.push(
                            `POI type ${type}: count ${count} below minimum ${benchmark.min}`
                        );
                    }
                } else {
                    this.validationResults.warnings.push(`Unexpected POI type found: ${type} (${count} instances)`);
                }
            }
            
        } catch (error) {
            this.validationResults.errors.push(`POI distribution validation failed: ${error.message}`);
        }
    }
    
    async validateRelationshipDistribution() {
        try {
            const distribution = this.db.prepare(`
                SELECT type, COUNT(*) as count FROM relationships GROUP BY type
            `).all();
            
            this.validationResults.relationshipDistribution = {};
            
            for (const row of distribution) {
                const type = row.type;
                const count = row.count;
                const benchmark = this.relationshipTypeDistribution[type];
                
                if (benchmark) {
                    this.validationResults.relationshipDistribution[type] = {
                        actual: count,
                        expected: benchmark.expected,
                        passed: count >= benchmark.min && count <= benchmark.max
                    };
                    
                    if (count < benchmark.min) {
                        this.validationResults.errors.push(
                            `Relationship type ${type}: count ${count} below minimum ${benchmark.min}`
                        );
                    }
                } else {
                    this.validationResults.warnings.push(`Unexpected relationship type found: ${type} (${count} instances)`);
                }
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Relationship distribution validation failed: ${error.message}`);
        }
    }
    
    async validateDataIntegrity() {
        try {
            // Check relationship-to-POI ratio
            const poiCount = this.validationResults.tableValidations.pois?.actual || 0;
            const relationshipCount = this.validationResults.tableValidations.relationships?.actual || 0;
            const ratio = poiCount > 0 ? relationshipCount / poiCount : 0;
            
            this.validationResults.relationshipRatio = {
                actual: ratio,
                expected: 2.1, // From benchmark analysis
                passed: ratio >= 1.8 && ratio <= 3.0
            };
            
            if (ratio < 1.8) {
                this.validationResults.errors.push(
                    `Relationship-to-POI ratio ${ratio.toFixed(2)} too low (expected ~2.1)`
                );
            } else if (ratio > 3.0) {
                this.validationResults.warnings.push(
                    `Relationship-to-POI ratio ${ratio.toFixed(2)} higher than expected`
                );
            }
            
            // Check for cross-file relationships
            const crossFileRelationships = this.db.prepare(`
                SELECT COUNT(*) as count FROM relationships r
                JOIN pois p1 ON r.source_poi_id = p1.id
                JOIN pois p2 ON r.target_poi_id = p2.id
                WHERE p1.file_path != p2.file_path
            `).get();
            
            if (crossFileRelationships.count < 10) {
                this.validationResults.warnings.push(
                    `Only ${crossFileRelationships.count} cross-file relationships found, expected more for polyglot analysis`
                );
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Data integrity validation failed: ${error.message}`);
        }
    }
    
    calculateTableScore(actual, benchmark) {
        if (actual >= benchmark.min && actual <= benchmark.max) {
            // Perfect score if within expected range
            const distance = Math.abs(actual - benchmark.expected);
            const range = benchmark.max - benchmark.min;
            return Math.max(80, 100 - (distance / range) * 20);
        } else if (actual < benchmark.min) {
            // Partial score for below minimum
            return Math.max(0, (actual / benchmark.min) * 60);
        } else {
            // Slight penalty for above maximum
            return Math.max(70, 100 - ((actual - benchmark.max) / benchmark.max) * 10);
        }
    }
    
    async calculateScore() {
        let totalScore = 0;
        let validationCount = 0;
        
        // Table count scores (40% weight)
        for (const validation of Object.values(this.validationResults.tableValidations)) {
            totalScore += validation.score * 0.4;
            validationCount++;
        }
        
        // Data quality scores (30% weight)
        const errorCount = this.validationResults.errors.length;
        const qualityScore = Math.max(0, 100 - (errorCount * 10));
        totalScore += qualityScore * 0.3;
        validationCount++;
        
        // Distribution scores (20% weight)
        let distributionScore = 100;
        const poiDistributions = Object.values(this.validationResults.poiDistribution || {});
        const failedDistributions = poiDistributions.filter(d => !d.passed).length;
        distributionScore -= failedDistributions * 10;
        
        totalScore += Math.max(0, distributionScore) * 0.2;
        validationCount++;
        
        // Integrity scores (10% weight)
        const ratioScore = this.validationResults.relationshipRatio?.passed ? 100 : 50;
        totalScore += ratioScore * 0.1;
        validationCount++;
        
        this.validationResults.score = Math.round(totalScore / validationCount);
    }
    
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            database: this.dbPath,
            score: this.validationResults.score,
            passed: this.validationResults.passed,
            summary: {
                errors: this.validationResults.errors.length,
                warnings: this.validationResults.warnings.length,
                tablesValidated: Object.keys(this.validationResults.tableValidations).length
            },
            tables: this.validationResults.tableValidations,
            distributions: {
                pois: this.validationResults.poiDistribution,
                relationships: this.validationResults.relationshipDistribution
            },
            integrity: {
                relationshipRatio: this.validationResults.relationshipRatio
            },
            details: {
                errors: this.validationResults.errors,
                warnings: this.validationResults.warnings
            }
        };
        
        return report;
    }
}

module.exports = SQLiteStateValidator;

// CLI interface for direct usage
if (require.main === module) {
    const dbPath = process.argv[2] || './cognitive_graph.db';
    
    const validator = new SQLiteStateValidator(dbPath);
    
    validator.validate()
        .then(results => {
            const report = validator.generateReport();
            console.log(JSON.stringify(report, null, 2));
            process.exit(results.passed ? 0 : 1);
        })
        .catch(error => {
            console.error('Validation failed:', error);
            process.exit(1);
        });
}