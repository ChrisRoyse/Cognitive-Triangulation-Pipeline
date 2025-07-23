#!/usr/bin/env node

const neo4j = require('neo4j-driver');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// Benchmark expectations - Starting low for initial validation
const BENCHMARK = {
    nodes: {
        total: 417,
        minimum: 300, // Starting benchmark
        byType: {
            file: 15,
            class: 21,
            function: 235,
            variable: 41,
            import: 66,
            export: 4,
            table: 15,
            view: 5,
            index: 26,
            trigger: 4
        }
    },
    relationships: {
        total: 1876, // midpoint of 1668-2085
        minimum: 1600, // Starting benchmark
        minimumRatio: 5.3, // relationships per node
        byType: {
            CALLS: 500, // function/method invocations
            USES: 600, // variable/property usage  
            IMPORTS: 66, // import/require statements
            EXTENDS: 2 // class inheritance
        }
    }
};

class PolyglotBenchmarkValidator {
    constructor() {
        this.neo4jUri = process.env.NEO4J_URI || 'bolt://localhost:7687';
        this.neo4jUser = process.env.NEO4J_USER || 'neo4j';
        this.neo4jPassword = process.env.NEO4J_PASSWORD || 'CTPSecure2024!';
        this.sqliteDb = path.join(process.cwd(), process.env.SQLITE_DB_PATH || './data/database.db');
        this.results = {
            nodes: {},
            relationships: {},
            crossLanguage: {},
            inheritance: {},
            database: {}
        };
    }

    async validate() {
        console.log('🔍 Polyglot Test Benchmark Validation');
        console.log('====================================\n');

        try {
            // Connect to databases
            await this.connectDatabases();

            // Run validation checks
            await this.validateNodeCounts();
            await this.validateRelationshipCounts();
            await this.validateCrossLanguageConnections();
            await this.validateInheritance();
            await this.validateDatabaseEntities();

            // Generate report
            this.generateReport();

            // Cleanup
            await this.cleanup();

        } catch (error) {
            console.error('❌ Validation failed:', error);
            process.exit(1);
        }
    }

    async connectDatabases() {
        // Neo4j connection
        this.neo4jDriver = neo4j.driver(
            this.neo4jUri,
            neo4j.auth.basic(this.neo4jUser, this.neo4jPassword)
        );
        
        try {
            await this.neo4jDriver.verifyConnectivity();
            console.log('✅ Connected to Neo4j');
        } catch (error) {
            throw new Error(`Neo4j connection failed: ${error.message}`);
        }

        // SQLite connection
        this.sqlite = new sqlite3.Database(this.sqliteDb, (err) => {
            if (err) {
                throw new Error(`SQLite connection failed: ${err.message}`);
            }
            console.log('✅ Connected to SQLite\n');
        });
    }

    async validateNodeCounts() {
        console.log('📊 Validating Node Counts...');
        
        const session = this.neo4jDriver.session();
        try {
            // Total nodes
            const totalResult = await session.run(
                'MATCH (n:POI) RETURN count(n) as count'
            );
            this.results.nodes.total = totalResult.records[0].get('count').toNumber();

            // Nodes by type
            const typeResult = await session.run(`
                MATCH (n:POI) 
                RETURN n.type as type, count(n) as count 
                ORDER BY count DESC
            `);
            
            this.results.nodes.byType = {};
            typeResult.records.forEach(record => {
                const type = record.get('type');
                const count = record.get('count').toNumber();
                this.results.nodes.byType[type] = count;
            });

            // Specific file count
            const fileResult = await session.run(`
                MATCH (n:POI)
                WHERE n.file_path CONTAINS 'polyglot-test'
                RETURN count(DISTINCT n.file_path) as fileCount
            `);
            this.results.nodes.fileCount = fileResult.records[0].get('fileCount').toNumber();

        } finally {
            await session.close();
        }
    }

    async validateRelationshipCounts() {
        console.log('📊 Validating Relationship Counts...');
        
        const session = this.neo4jDriver.session();
        try {
            // Total relationships
            const totalResult = await session.run(
                'MATCH ()-[r:RELATIONSHIP]->() RETURN count(r) as count'
            );
            this.results.relationships.total = totalResult.records[0].get('count').toNumber();

            // Relationships by type
            const typeResult = await session.run(`
                MATCH ()-[r:RELATIONSHIP]->() 
                RETURN r.type as type, count(r) as count 
                ORDER BY count DESC
            `);
            
            this.results.relationships.byType = {};
            typeResult.records.forEach(record => {
                const type = record.get('type');
                const count = record.get('count').toNumber();
                this.results.relationships.byType[type] = count;
            });

        } finally {
            await session.close();
        }
    }

    async validateCrossLanguageConnections() {
        console.log('📊 Validating Cross-Language Connections...');
        
        const session = this.neo4jDriver.session();
        try {
            // Java to JavaScript
            const javaToJs = await session.run(`
                MATCH (java:POI)-[r:RELATIONSHIP]->(js:POI)
                WHERE java.file_path CONTAINS '/java/' 
                  AND js.file_path CONTAINS '/js/'
                RETURN count(r) as count
            `);
            this.results.crossLanguage.javaToJs = javaToJs.records[0].get('count').toNumber();

            // JavaScript to Python
            const jsToPython = await session.run(`
                MATCH (js:POI)-[r:RELATIONSHIP]->(py:POI)
                WHERE js.file_path CONTAINS '/js/' 
                  AND py.file_path CONTAINS '/python/'
                RETURN count(r) as count
            `);
            this.results.crossLanguage.jsToPython = jsToPython.records[0].get('count').toNumber();

            // Java to Python
            const javaToPython = await session.run(`
                MATCH (java:POI)-[r:RELATIONSHIP]->(py:POI)
                WHERE java.file_path CONTAINS '/java/' 
                  AND py.file_path CONTAINS '/python/'
                RETURN count(r) as count
            `);
            this.results.crossLanguage.javaToPython = javaToPython.records[0].get('count').toNumber();

        } finally {
            await session.close();
        }
    }

    async validateInheritance() {
        console.log('📊 Validating Inheritance Relationships...');
        
        const session = this.neo4jDriver.session();
        try {
            const result = await session.run(`
                MATCH (child:POI)-[r:RELATIONSHIP {type: 'EXTENDS'}]->(parent:POI)
                RETURN child.name as child, parent.name as parent
            `);
            
            this.results.inheritance.found = [];
            result.records.forEach(record => {
                this.results.inheritance.found.push({
                    child: record.get('child'),
                    parent: record.get('parent')
                });
            });

        } finally {
            await session.close();
        }
    }

    async validateDatabaseEntities() {
        console.log('📊 Validating Database Entities...');
        
        const session = this.neo4jDriver.session();
        try {
            const result = await session.run(`
                MATCH (n:POI)
                WHERE n.file_path CONTAINS 'schema.sql'
                RETURN n.type as type, count(n) as count
                ORDER BY type
            `);
            
            this.results.database.entities = {};
            result.records.forEach(record => {
                const type = record.get('type');
                const count = record.get('count').toNumber();
                this.results.database.entities[type] = count;
            });

        } finally {
            await session.close();
        }
    }

    generateReport() {
        console.log('\n\n' + '='.repeat(60));
        console.log('📋 POLYGLOT TEST BENCHMARK VALIDATION REPORT');
        console.log('='.repeat(60) + '\n');

        // Node validation
        console.log('🔷 NODE VALIDATION');
        console.log(`Total Nodes: ${this.results.nodes.total} / ${BENCHMARK.nodes.total} (${this.getPercentage(this.results.nodes.total, BENCHMARK.nodes.total)}%)`);
        console.log(`Status: ${this.results.nodes.total >= BENCHMARK.nodes.minimum ? '✅ PASS' : '❌ FAIL'}`);
        
        console.log('\nNode Distribution:');
        Object.entries(this.results.nodes.byType).forEach(([type, count]) => {
            const expected = BENCHMARK.nodes.byType[type] || 'N/A';
            console.log(`  ${type}: ${count} (expected: ${expected})`);
        });

        // Relationship validation
        console.log('\n\n🔷 RELATIONSHIP VALIDATION');
        console.log(`Total Relationships: ${this.results.relationships.total} / ${BENCHMARK.relationships.total} (${this.getPercentage(this.results.relationships.total, BENCHMARK.relationships.total)}%)`);
        console.log(`Status: ${this.results.relationships.total >= BENCHMARK.relationships.minimum ? '✅ PASS' : '❌ FAIL'}`);
        
        console.log('\nRelationship Distribution:');
        Object.entries(this.results.relationships.byType).forEach(([type, count]) => {
            const expected = BENCHMARK.relationships.byType[type] || 'N/A';
            console.log(`  ${type}: ${count} (expected: ${expected})`);
        });

        // Cross-language validation
        console.log('\n\n🔷 CROSS-LANGUAGE CONNECTIONS');
        console.log(`Java → JavaScript: ${this.results.crossLanguage.javaToJs} ${this.results.crossLanguage.javaToJs > 0 ? '✅' : '❌'}`);
        console.log(`JavaScript → Python: ${this.results.crossLanguage.jsToPython} ${this.results.crossLanguage.jsToPython > 0 ? '✅' : '❌'}`);
        console.log(`Java → Python: ${this.results.crossLanguage.javaToPython} ${this.results.crossLanguage.javaToPython > 0 ? '✅' : '❌'}`);

        // Inheritance validation
        console.log('\n\n🔷 INHERITANCE DETECTION');
        if (this.results.inheritance.found.length > 0) {
            console.log('✅ Found inheritance relationships:');
            this.results.inheritance.found.forEach(rel => {
                console.log(`  ${rel.child} extends ${rel.parent}`);
            });
        } else {
            console.log('❌ No inheritance relationships found');
        }

        // Database entities
        console.log('\n\n🔷 DATABASE ENTITIES');
        if (Object.keys(this.results.database.entities).length > 0) {
            console.log('Found database entities:');
            Object.entries(this.results.database.entities).forEach(([type, count]) => {
                console.log(`  ${type}: ${count}`);
            });
        } else {
            console.log('❌ No database entities found');
        }

        // Overall summary
        console.log('\n\n' + '='.repeat(60));
        console.log('📊 OVERALL RESULTS');
        console.log('='.repeat(60));
        
        const nodePass = this.results.nodes.total >= BENCHMARK.nodes.minimum;
        const relPass = this.results.relationships.total >= BENCHMARK.relationships.minimum;
        const crossLangPass = this.results.crossLanguage.javaToJs > 0 && 
                             this.results.crossLanguage.jsToPython > 0;
        const inheritancePass = this.results.inheritance.found.length >= 2;
        
        console.log(`Nodes: ${nodePass ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Relationships: ${relPass ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Cross-Language: ${crossLangPass ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Inheritance: ${inheritancePass ? '✅ PASS' : '❌ FAIL'}`);
        
        const overallPass = nodePass && relPass && crossLangPass && inheritancePass;
        console.log(`\n🎯 OVERALL: ${overallPass ? '✅ PASS - Pipeline is working correctly!' : '❌ FAIL - Pipeline needs debugging'}`);
        
        // Performance grade
        const nodeScore = this.getPercentage(this.results.nodes.total, BENCHMARK.nodes.total);
        const relScore = this.getPercentage(this.results.relationships.total, BENCHMARK.relationships.total);
        const avgScore = (nodeScore + relScore) / 2;
        
        let grade = 'F';
        if (avgScore >= 95) grade = 'A';
        else if (avgScore >= 90) grade = 'B';
        else if (avgScore >= 85) grade = 'C';
        else if (avgScore >= 80) grade = 'D';
        
        console.log(`\n📈 Performance Grade: ${grade} (${avgScore.toFixed(1)}%)`);
        console.log('='.repeat(60) + '\n');
    }

    getPercentage(actual, expected) {
        return ((actual / expected) * 100).toFixed(1);
    }

    async cleanup() {
        await this.neo4jDriver.close();
        this.sqlite.close();
    }
}

// Run validation
if (require.main === module) {
    const validator = new PolyglotBenchmarkValidator();
    validator.validate().catch(console.error);
}

module.exports = PolyglotBenchmarkValidator;