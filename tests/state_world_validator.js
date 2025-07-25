#!/usr/bin/env node

const neo4j = require('neo4j-driver');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const chalk = require('chalk');
require('dotenv').config();

/**
 * Comprehensive State-of-the-World Validator
 * 
 * This validates the entire state of all databases after pipeline execution
 * against the known expected state from the polyglot-test directory.
 */

const EXPECTED_STATE = {
    files: {
        total: 15,
        processed: 13, // Excluding README.md and package.json which may not be analyzed
        byExtension: {
            '.js': 4,
            '.py': 4,
            '.java': 5,
            '.sql': 2
        }
    },
    sqlite: {
        tables: {
            files: { minRows: 13, columns: ['id', 'file_path', 'hash', 'status', 'created_at', 'updated_at'] },
            pois: { minRows: 300, columns: ['id', 'file_path', 'name', 'type', 'start_line', 'end_line', 'llm_output', 'hash'] },
            relationships: { minRows: 1600, columns: ['id', 'source_poi_id', 'target_poi_id', 'type', 'file_path', 'status', 'confidence'] },
            directory_summaries: { minRows: 1, columns: ['id', 'directory_path', 'summary', 'file_count'] },
            relationship_evidence: { minRows: 100, columns: ['id', 'source_poi_id', 'target_poi_id', 'relationship_type', 'evidence_type', 'confidence'] },
            outbox: { minRows: 50, columns: ['id', 'event_type', 'aggregate_id', 'payload', 'created_at', 'processed_at', 'status'] }
        }
    },
    neo4j: {
        nodes: {
            total: 300,
            byType: {
                'function': 100,
                'class': 15,
                'variable': 30,
                'import': 50,
                'table': 10
            }
        },
        relationships: {
            total: 1600,
            ratio: 5.3, // relationships per node
            byType: {
                'CONTAINS': 200,
                'CALLS': 400,
                'USES': 500,
                'IMPORTS': 50,
                'EXTENDS': 2
            }
        }
    },
    crossLanguage: {
        javaToJs: 5,
        jsToPython: 10,
        pythonToJava: 3
    },
    inheritance: {
        pythonMLModels: 2 // LinearRegressionModel, ClassificationModel extending MLModel
    }
};

class StateWorldValidator {
    constructor() {
        this.neo4jUri = process.env.NEO4J_URI || 'bolt://localhost:7687';
        this.neo4jUser = process.env.NEO4J_USER || 'neo4j';
        this.neo4jPassword = process.env.NEO4J_PASSWORD || 'CTPSecure2024!';
        this.sqliteDb = path.join(process.cwd(), process.env.SQLITE_DB_PATH || './data/database.db');
        this.polyglotPath = path.join(process.cwd(), 'polyglot-test');
        
        this.results = {
            sqlite: {},
            neo4j: {},
            crossValidation: {},
            performance: {},
            errors: []
        };
    }

    async validateCompleteState() {
        console.log(chalk.cyan('🌍 STATE-OF-THE-WORLD VALIDATION'));
        console.log(chalk.cyan('=====================================\n'));

        try {
            await this.connectDatabases();
            await this.validateSQLiteState();
            await this.validateNeo4jState();
            await this.validateCrossReferences();
            await this.validateSpecificEntities();
            await this.generateComprehensiveReport();
        } catch (error) {
            console.error(chalk.red('❌ Validation failed:'), error);
            this.results.errors.push(error.message);
        } finally {
            await this.cleanup();
        }
    }

    async connectDatabases() {
        // Neo4j connection
        this.neo4jDriver = neo4j.driver(
            this.neo4jUri,
            neo4j.auth.basic(this.neo4jUser, this.neo4jPassword)
        );
        
        await this.neo4jDriver.verifyConnectivity();
        console.log(chalk.green('✅ Connected to Neo4j'));

        // SQLite connection
        return new Promise((resolve, reject) => {
            this.sqlite = new sqlite3.Database(this.sqliteDb, (err) => {
                if (err) reject(err);
                else {
                    console.log(chalk.green('✅ Connected to SQLite\n'));
                    resolve();
                }
            });
        });
    }

    async validateSQLiteState() {
        console.log(chalk.blue('📊 Validating SQLite Database State...'));
        
        const tableResults = {};
        
        for (const [tableName, expected] of Object.entries(EXPECTED_STATE.sqlite.tables)) {
            try {
                // Check table exists
                const tableExists = await this.checkTableExists(tableName);
                if (!tableExists) {
                    this.results.errors.push(`Table ${tableName} does not exist`);
                    continue;
                }

                // Check row count
                const rowCount = await this.getRowCount(tableName);
                const rowsPass = rowCount >= expected.minRows;
                
                // Check columns
                const columns = await this.getTableColumns(tableName);
                const columnsPass = expected.columns.every(col => columns.includes(col));
                
                // Check data quality for specific tables
                let dataQuality = { valid: true, issues: [] };
                if (tableName === 'pois') {
                    dataQuality = await this.validatePOIData();
                } else if (tableName === 'relationships') {
                    dataQuality = await this.validateRelationshipData();
                } else if (tableName === 'files') {
                    dataQuality = await this.validateFileData();
                }

                tableResults[tableName] = {
                    exists: tableExists,
                    rowCount,
                    rowsPass,
                    expectedRows: expected.minRows,
                    columns,
                    columnsPass,
                    expectedColumns: expected.columns,
                    dataQuality
                };

                console.log(`  ${tableName}: ${rowCount} rows ${rowsPass ? '✅' : '❌'}, columns ${columnsPass ? '✅' : '❌'}, data ${dataQuality.valid ? '✅' : '❌'}`);
                
            } catch (error) {
                this.results.errors.push(`Error validating table ${tableName}: ${error.message}`);
                tableResults[tableName] = { error: error.message };
            }
        }
        
        this.results.sqlite = tableResults;
        console.log();
    }

    async validateNeo4jState() {
        console.log(chalk.blue('📊 Validating Neo4j Graph State...'));
        
        const session = this.neo4jDriver.session();
        try {
            // Total nodes
            const nodeResult = await session.run('MATCH (n:POI) RETURN count(n) as count');
            const totalNodes = nodeResult.records[0].get('count').toNumber();
            
            // Nodes by type
            const nodeTypeResult = await session.run(`
                MATCH (n:POI) 
                RETURN n.type as type, count(n) as count 
                ORDER BY count DESC
            `);
            
            const nodesByType = {};
            nodeTypeResult.records.forEach(record => {
                const type = record.get('type');
                const count = record.get('count').toNumber();
                nodesByType[type] = count;
            });

            // Total relationships
            const relResult = await session.run('MATCH ()-[r:RELATIONSHIP]->() RETURN count(r) as count');
            const totalRels = relResult.records[0].get('count').toNumber();
            
            // Relationships by type
            const relTypeResult = await session.run(`
                MATCH ()-[r:RELATIONSHIP]->() 
                RETURN r.type as type, count(r) as count 
                ORDER BY count DESC
            `);
            
            const relsByType = {};
            relTypeResult.records.forEach(record => {
                const type = record.get('type');
                const count = record.get('count').toNumber();
                relsByType[type] = count;
            });

            // Calculate ratio
            const ratio = totalNodes > 0 ? (totalRels / totalNodes) : 0;

            this.results.neo4j = {
                nodes: {
                    total: totalNodes,
                    byType: nodesByType,
                    pass: totalNodes >= EXPECTED_STATE.neo4j.nodes.total
                },
                relationships: {
                    total: totalRels,
                    byType: relsByType,
                    ratio: ratio.toFixed(2),
                    pass: totalRels >= EXPECTED_STATE.neo4j.relationships.total,
                    ratioPass: ratio >= EXPECTED_STATE.neo4j.relationships.ratio
                }
            };

            console.log(`  Nodes: ${totalNodes} ${this.results.neo4j.nodes.pass ? '✅' : '❌'}`);
            console.log(`  Relationships: ${totalRels} ${this.results.neo4j.relationships.pass ? '✅' : '❌'}`);
            console.log(`  Ratio: ${ratio.toFixed(2)}:1 ${this.results.neo4j.relationships.ratioPass ? '✅' : '❌'}`);
            console.log();

        } finally {
            await session.close();
        }
    }

    async validateCrossReferences() {
        console.log(chalk.blue('📊 Validating Cross-References...'));
        
        // Validate SQLite -> Neo4j consistency
        const sqlitePOIs = await this.getRowCount('pois');
        const sqliteRels = await this.getRowCount('relationships');
        
        const neo4jNodes = this.results.neo4j.nodes.total;
        const neo4jRels = this.results.neo4j.relationships.total;
        
        // Should have close to same number of entities
        const nodeConsistency = Math.abs(sqlitePOIs - neo4jNodes) <= (sqlitePOIs * 0.1); // 10% tolerance
        const relConsistency = Math.abs(sqliteRels - neo4jRels) <= (sqliteRels * 0.1);
        
        this.results.crossValidation = {
            sqlite: { pois: sqlitePOIs, relationships: sqliteRels },
            neo4j: { nodes: neo4jNodes, relationships: neo4jRels },
            consistency: {
                nodes: nodeConsistency,
                relationships: relConsistency
            }
        };

        console.log(`  Node consistency: ${nodeConsistency ? '✅' : '❌'} (SQLite: ${sqlitePOIs}, Neo4j: ${neo4jNodes})`);
        console.log(`  Relationship consistency: ${relConsistency ? '✅' : '❌'} (SQLite: ${sqliteRels}, Neo4j: ${neo4jRels})`);
        console.log();
    }

    async validateSpecificEntities() {
        console.log(chalk.blue('📊 Validating Specific Known Entities...'));
        
        const session = this.neo4jDriver.session();
        try {
            // Check for Java classes
            const javaClasses = await session.run(`
                MATCH (n:POI)
                WHERE n.file_path CONTAINS '/java/' AND n.type = 'class'
                RETURN n.name as name
            `);
            
            const foundJavaClasses = javaClasses.records.map(r => r.get('name'));
            const expectedJavaClasses = ['User', 'UserService', 'DatabaseManager', 'BusinessLogic', 'ApiClient'];
            const javaClassesFound = expectedJavaClasses.filter(cls => foundJavaClasses.includes(cls)).length;

            // Check for Python inheritance
            const inheritance = await session.run(`
                MATCH (child:POI)-[r:RELATIONSHIP {type: 'EXTENDS'}]->(parent:POI)
                WHERE parent.name = 'MLModel'
                RETURN child.name as child
            `);
            
            const inheritanceFound = inheritance.records.map(r => r.get('child'));

            // Check for cross-language calls
            const crossLangCalls = await session.run(`
                MATCH (source:POI)-[r:RELATIONSHIP {type: 'CALLS'}]->(target:POI)
                WHERE source.file_path CONTAINS '/java/' AND target.file_path CONTAINS '/js/'
                   OR source.file_path CONTAINS '/js/' AND target.file_path CONTAINS '/python/'
                RETURN count(r) as count
            `);
            
            const crossCallCount = crossLangCalls.records[0].get('count').toNumber();

            this.results.specificEntities = {
                javaClasses: {
                    found: javaClassesFound,
                    expected: expectedJavaClasses.length,
                    pass: javaClassesFound >= 3 // At least 3 of 5 classes
                },
                inheritance: {
                    found: inheritanceFound,
                    pass: inheritanceFound.length >= 2
                },
                crossLanguageCalls: {
                    count: crossCallCount,
                    pass: crossCallCount >= 5
                }
            };

            console.log(`  Java Classes: ${javaClassesFound}/${expectedJavaClasses.length} ${this.results.specificEntities.javaClasses.pass ? '✅' : '❌'}`);
            console.log(`  Inheritance: ${inheritanceFound.length} ${this.results.specificEntities.inheritance.pass ? '✅' : '❌'}`);
            console.log(`  Cross-lang calls: ${crossCallCount} ${this.results.specificEntities.crossLanguageCalls.pass ? '✅' : '❌'}`);
            console.log();

        } finally {
            await session.close();
        }
    }

    async generateComprehensiveReport() {
        console.log(chalk.cyan('\n' + '='.repeat(80)));
        console.log(chalk.cyan('📋 COMPREHENSIVE STATE-OF-THE-WORLD VALIDATION REPORT'));
        console.log(chalk.cyan('='.repeat(80) + '\n'));

        // SQLite Summary
        console.log(chalk.yellow('🗃️  SQLITE DATABASE STATE:'));
        let sqlitePassed = 0;
        const sqliteTotal = Object.keys(EXPECTED_STATE.sqlite.tables).length;
        
        for (const [table, result] of Object.entries(this.results.sqlite)) {
            if (result.rowsPass && result.columnsPass && result.dataQuality?.valid) {
                sqlitePassed++;
                console.log(chalk.green(`  ✅ ${table}: ${result.rowCount} rows, valid structure`));
            } else {
                console.log(chalk.red(`  ❌ ${table}: Issues detected`));
                if (!result.rowsPass) console.log(chalk.gray(`     - Row count: ${result.rowCount} < ${result.expectedRows}`));
                if (!result.columnsPass) console.log(chalk.gray(`     - Missing columns`));
                if (!result.dataQuality?.valid) console.log(chalk.gray(`     - Data quality issues: ${result.dataQuality?.issues?.join(', ')}`));
            }
        }
        
        console.log(`SQLite Score: ${sqlitePassed}/${sqliteTotal} tables passing\n`);

        // Neo4j Summary
        console.log(chalk.yellow('📊 NEO4J GRAPH STATE:'));
        const neo4jScore = [];
        if (this.results.neo4j.nodes.pass) neo4jScore.push('nodes');
        if (this.results.neo4j.relationships.pass) neo4jScore.push('relationships');
        if (this.results.neo4j.relationships.ratioPass) neo4jScore.push('ratio');
        
        console.log(`  Nodes: ${this.results.neo4j.nodes.total} ${this.results.neo4j.nodes.pass ? '✅' : '❌'}`);
        console.log(`  Relationships: ${this.results.neo4j.relationships.total} ${this.results.neo4j.relationships.pass ? '✅' : '❌'}`);
        console.log(`  Ratio: ${this.results.neo4j.relationships.ratio}:1 ${this.results.neo4j.relationships.ratioPass ? '✅' : '❌'}`);
        console.log(`Neo4j Score: ${neo4jScore.length}/3 metrics passing\n`);

        // Cross-validation Summary
        console.log(chalk.yellow('🔗 CROSS-VALIDATION:'));
        const crossPassed = Object.values(this.results.crossValidation.consistency).filter(Boolean).length;
        console.log(`  Database consistency: ${crossPassed}/2 checks passing\n`);

        // Specific Entities Summary
        console.log(chalk.yellow('🎯 SPECIFIC ENTITY VALIDATION:'));
        const specificPassed = Object.values(this.results.specificEntities).filter(e => e.pass).length;
        console.log(`  Known entities: ${specificPassed}/3 checks passing\n`);

        // Overall Assessment
        const totalChecks = sqliteTotal + 3 + 2 + 3; // sqlite + neo4j + cross + specific
        const totalPassed = sqlitePassed + neo4jScore.length + crossPassed + specificPassed;
        const overallScore = (totalPassed / totalChecks * 100).toFixed(1);
        
        console.log(chalk.cyan('='.repeat(80)));
        console.log(chalk.cyan('🎯 OVERALL ASSESSMENT:'));
        console.log(chalk.cyan('='.repeat(80)));
        
        let grade = 'F';
        let status = '❌ FAILED';
        if (overallScore >= 90) { grade = 'A'; status = '✅ EXCELLENT'; }
        else if (overallScore >= 80) { grade = 'B'; status = '✅ GOOD'; }
        else if (overallScore >= 70) { grade = 'C'; status = '⚠️  ACCEPTABLE'; }
        else if (overallScore >= 60) { grade = 'D'; status = '⚠️  POOR'; }
        
        console.log(`Score: ${totalPassed}/${totalChecks} checks passed (${overallScore}%)`);
        console.log(`Grade: ${grade}`);
        console.log(`Status: ${status}`);
        
        // Minimum benchmark check
        const minimumMet = this.results.neo4j.nodes.total >= 300 && 
                          this.results.neo4j.relationships.total >= 1600;
        
        console.log(`\nMinimum Benchmark: ${minimumMet ? '✅ MET' : '❌ NOT MET'}`);
        console.log(`  (≥300 nodes: ${this.results.neo4j.nodes.total >= 300 ? '✅' : '❌'}, ≥1600 relationships: ${this.results.neo4j.relationships.total >= 1600 ? '✅' : '❌'})`);

        if (this.results.errors.length > 0) {
            console.log(chalk.red('\n⚠️  ERRORS ENCOUNTERED:'));
            this.results.errors.forEach(error => console.log(chalk.red(`  - ${error}`)));
        }
        
        console.log(chalk.cyan('\n' + '='.repeat(80) + '\n'));
    }

    // Helper methods for SQLite validation
    async checkTableExists(tableName) {
        return new Promise((resolve, reject) => {
            this.sqlite.get(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                [tableName],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });
    }

    async getRowCount(tableName) {
        return new Promise((resolve, reject) => {
            this.sqlite.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    }

    async getTableColumns(tableName) {
        return new Promise((resolve, reject) => {
            this.sqlite.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.name));
            });
        });
    }

    async validatePOIData() {
        return new Promise((resolve, reject) => {
            this.sqlite.all(`
                SELECT file_path, type, COUNT(*) as count 
                FROM pois 
                WHERE file_path LIKE '%polyglot-test%' 
                GROUP BY file_path, type
            `, (err, rows) => {
                if (err) reject(err);
                else {
                    const issues = [];
                    if (rows.length === 0) issues.push('No POIs found for polyglot-test');
                    resolve({ valid: issues.length === 0, issues });
                }
            });
        });
    }

    async validateRelationshipData() {
        return new Promise((resolve, reject) => {
            this.sqlite.all(`
                SELECT type, COUNT(*) as count, AVG(confidence) as avg_confidence
                FROM relationships 
                GROUP BY type
            `, (err, rows) => {
                if (err) reject(err);
                else {
                    const issues = [];
                    if (rows.length === 0) issues.push('No relationships found');
                    resolve({ valid: issues.length === 0, issues });
                }
            });
        });
    }

    async validateFileData() {
        return new Promise((resolve, reject) => {
            this.sqlite.all(`
                SELECT status, COUNT(*) as count 
                FROM files 
                WHERE file_path LIKE '%polyglot-test%'
                GROUP BY status
            `, (err, rows) => {
                if (err) reject(err);
                else {
                    const issues = [];
                    const processedFiles = rows.find(r => r.status === 'completed')?.count || 0;
                    if (processedFiles < 10) issues.push(`Only ${processedFiles} files processed`);
                    resolve({ valid: issues.length === 0, issues });
                }
            });
        });
    }

    async cleanup() {
        if (this.neo4jDriver) await this.neo4jDriver.close();
        if (this.sqlite) this.sqlite.close();
    }
}

// Export for testing and run if called directly
module.exports = StateWorldValidator;

if (require.main === module) {
    const validator = new StateWorldValidator();
    validator.validateCompleteState().catch(console.error);
}