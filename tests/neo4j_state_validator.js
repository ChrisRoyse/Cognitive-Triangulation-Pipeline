/**
 * Neo4j Graph State Validator for Cognitive Triangulation Pipeline
 * 
 * Validates the complete state of Neo4j graph database after pipeline execution
 * against the established polyglot-test benchmark expectations.
 * 
 * Expected State for polyglot-test directory:
 * - Total Nodes: ~417 (matching SQLite POIs)
 * - Total Relationships: ~870 (2.1x node count)
 * - Node Labels: :POI with proper type distribution
 * - Relationship Types: CALLS, USES, EXTENDS, IMPORTS, CONTAINS, REFERENCES
 * - Cross-language relationships for polyglot analysis
 */

const neo4j = require('neo4j-driver');
const fs = require('fs');

class Neo4jStateValidator {
    constructor(uri = 'bolt://localhost:7687', username = 'neo4j', password = 'password') {
        this.uri = uri;
        this.username = username;
        this.password = password;
        this.driver = null;
        this.session = null;
        
        this.validationResults = {
            passed: false,
            errors: [],
            warnings: [],
            nodeValidations: {},
            relationshipValidations: {},
            benchmarkComparison: {},
            score: 0
        };
        
        // Expected benchmark values for polyglot-test
        this.benchmark = {
            totalNodes: { min: 375, expected: 417, max: 460 },
            totalRelationships: { min: 697, expected: 870, max: 1050 },
            relationshipToNodeRatio: { min: 1.8, expected: 2.1, max: 3.0 }
        };
        
        // Expected node type distribution (by POI type property)
        this.nodeTypeDistribution = {
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
        
        // Expected cross-language patterns for polyglot validation
        this.crossLanguageExpectations = {
            'js_to_py_api_calls': { min: 2, expected: 3, max: 5 },
            'java_to_js_imports': { min: 1, expected: 2, max: 3 },
            'sql_to_code_references': { min: 15, expected: 20, max: 30 },
            'inheritance_chains': { min: 1, expected: 2, max: 3 }
        };
    }
    
    async validate() {
        try {
            await this.connect();
            await this.validateGraphStructure();
            await this.validateNodeCounts();
            await this.validateRelationshipCounts();
            await this.validateNodeProperties();
            await this.validateRelationshipProperties();
            await this.validateCrossLanguagePatterns();
            await this.validateGraphIntegrity();
            await this.calculateScore();
            await this.disconnect();
            
            this.validationResults.passed = this.validationResults.score >= 85;
            return this.validationResults;
        } catch (error) {
            this.validationResults.errors.push(`Validation failed: ${error.message}`);
            this.validationResults.passed = false;
            return this.validationResults;
        }
    }
    
    async connect() {
        try {
            // Resolve localhost to IPv4 to avoid DNS resolution issues on Windows
            const resolvedUri = this.uri.replace('localhost', '127.0.0.1');
            this.driver = neo4j.driver(resolvedUri, neo4j.auth.basic(this.username, this.password));
            this.session = this.driver.session();
            
            // Test connection
            await this.session.run('RETURN 1');
            this.validationResults.warnings.push(`Connected to Neo4j at ${this.uri}`);
        } catch (error) {
            throw new Error(`Failed to connect to Neo4j: ${error.message}`);
        }
    }
    
    async disconnect() {
        if (this.session) {
            await this.session.close();
        }
        if (this.driver) {
            await this.driver.close();
        }
    }
    
    async validateGraphStructure() {
        try {
            // Check for expected labels
            const labelsResult = await this.session.run('CALL db.labels()');
            const labels = labelsResult.records.map(record => record.get(0));
            
            if (!labels.includes('POI')) {
                this.validationResults.errors.push('Missing :POI label on nodes');
            }
            
            // Check for expected relationship types
            const relTypesResult = await this.session.run('CALL db.relationshipTypes()');
            const relationshipTypes = relTypesResult.records.map(record => record.get(0));
            
            const expectedRelTypes = ['CALLS', 'USES', 'EXTENDS', 'IMPORTS', 'CONTAINS', 'REFERENCES'];
            for (const expectedType of expectedRelTypes) {
                if (!relationshipTypes.includes(expectedType)) {
                    this.validationResults.warnings.push(`Missing relationship type: ${expectedType}`);
                }
            }
            
            // Check for expected node properties
            await this.validateNodeSchema();
            
        } catch (error) {
            this.validationResults.errors.push(`Graph structure validation failed: ${error.message}`);
        }
    }
    
    async validateNodeSchema() {
        try {
            const schemaResult = await this.session.run(`
                MATCH (n:POI)
                WITH keys(n) as nodeKeys
                UNWIND nodeKeys as key
                RETURN DISTINCT key
                ORDER BY key
            `);
            
            const properties = schemaResult.records.map(record => record.get(0));
            const expectedProperties = ['id', 'type', 'name', 'filePath', 'startLine', 'endLine'];
            
            for (const expectedProp of expectedProperties) {
                if (!properties.includes(expectedProp)) {
                    this.validationResults.errors.push(`Missing node property: ${expectedProp}`);
                }
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Node schema validation failed: ${error.message}`);
        }
    }
    
    async validateNodeCounts() {
        try {
            // Total node count
            const totalNodesResult = await this.session.run('MATCH (n:POI) RETURN count(n) as count');
            const totalNodes = totalNodesResult.records[0].get('count').toNumber();
            
            this.validationResults.nodeValidations.total = {
                actual: totalNodes,
                expected: this.benchmark.totalNodes.expected,
                min: this.benchmark.totalNodes.min,
                max: this.benchmark.totalNodes.max,
                passed: totalNodes >= this.benchmark.totalNodes.min && totalNodes <= this.benchmark.totalNodes.max,
                score: this.calculateScore(totalNodes, this.benchmark.totalNodes)
            };
            
            if (totalNodes < this.benchmark.totalNodes.min) {
                this.validationResults.errors.push(
                    `Total nodes ${totalNodes} below minimum ${this.benchmark.totalNodes.min}`
                );
            }
            
            // Node type distribution
            const typeDistResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.type IS NOT NULL
                RETURN n.type as type, count(n) as count
                ORDER BY count DESC
            `);
            
            this.validationResults.nodeValidations.byType = {};
            
            for (const record of typeDistResult.records) {
                const type = record.get('type');
                const count = record.get('count').toNumber();
                const benchmark = this.nodeTypeDistribution[type];
                
                if (benchmark) {
                    this.validationResults.nodeValidations.byType[type] = {
                        actual: count,
                        expected: benchmark.expected,
                        min: benchmark.min,
                        max: benchmark.max,
                        passed: count >= benchmark.min && count <= benchmark.max,
                        score: this.calculateScore(count, benchmark)
                    };
                    
                    if (count < benchmark.min) {
                        this.validationResults.errors.push(
                            `Node type ${type}: count ${count} below minimum ${benchmark.min}`
                        );
                    }
                } else {
                    this.validationResults.warnings.push(`Unexpected node type found: ${type} (${count} instances)`);
                }
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Node count validation failed: ${error.message}`);
        }
    }
    
    async validateRelationshipCounts() {
        try {
            // Total relationship count
            const totalRelsResult = await this.session.run('MATCH ()-[r]->() RETURN count(r) as count');
            const totalRels = totalRelsResult.records[0].get('count').toNumber();
            
            this.validationResults.relationshipValidations.total = {
                actual: totalRels,
                expected: this.benchmark.totalRelationships.expected,
                min: this.benchmark.totalRelationships.min,
                max: this.benchmark.totalRelationships.max,
                passed: totalRels >= this.benchmark.totalRelationships.min && totalRels <= this.benchmark.totalRelationships.max,
                score: this.calculateScore(totalRels, this.benchmark.totalRelationships)
            };
            
            if (totalRels < this.benchmark.totalRelationships.min) {
                this.validationResults.errors.push(
                    `Total relationships ${totalRels} below minimum ${this.benchmark.totalRelationships.min}`
                );
            }
            
            // Relationship type distribution
            const relTypeDistResult = await this.session.run(`
                MATCH ()-[r]->()
                RETURN type(r) as relType, count(r) as count
                ORDER BY count DESC
            `);
            
            this.validationResults.relationshipValidations.byType = {};
            
            for (const record of relTypeDistResult.records) {
                const relType = record.get('relType');
                const count = record.get('count').toNumber();
                const benchmark = this.relationshipTypeDistribution[relType];
                
                if (benchmark) {
                    this.validationResults.relationshipValidations.byType[relType] = {
                        actual: count,
                        expected: benchmark.expected,
                        min: benchmark.min,
                        max: benchmark.max,
                        passed: count >= benchmark.min && count <= benchmark.max,
                        score: this.calculateScore(count, benchmark)
                    };
                    
                    if (count < benchmark.min) {
                        this.validationResults.errors.push(
                            `Relationship type ${relType}: count ${count} below minimum ${benchmark.min}`
                        );
                    }
                } else {
                    this.validationResults.warnings.push(`Unexpected relationship type found: ${relType} (${count} instances)`);
                }
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Relationship count validation failed: ${error.message}`);
        }
    }
    
    async validateNodeProperties() {
        try {
            // Check for nodes without required properties
            const missingIdResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.id IS NULL OR n.id = ''
                RETURN count(n) as count
            `);
            const missingId = missingIdResult.records[0].get('count').toNumber();
            
            if (missingId > 0) {
                this.validationResults.errors.push(`${missingId} nodes missing id property`);
            }
            
            const missingNameResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.name IS NULL OR n.name = ''
                RETURN count(n) as count
            `);
            const missingName = missingNameResult.records[0].get('count').toNumber();
            
            if (missingName > 0) {
                this.validationResults.errors.push(`${missingName} nodes missing name property`);
            }
            
            const missingTypeResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.type IS NULL OR n.type = ''
                RETURN count(n) as count
            `);
            const missingType = missingTypeResult.records[0].get('count').toNumber();
            
            if (missingType > 0) {
                this.validationResults.errors.push(`${missingType} nodes missing type property`);
            }
            
            // Check for valid file paths
            const invalidPathResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.filePath IS NULL OR n.filePath = '' OR NOT n.filePath CONTAINS 'polyglot-test'
                RETURN count(n) as count
            `);
            const invalidPath = invalidPathResult.records[0].get('count').toNumber();
            
            if (invalidPath > 0) {
                this.validationResults.warnings.push(`${invalidPath} nodes with invalid file paths`);
            }
            
            // Check for valid line numbers
            const invalidLinesResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.startLine IS NULL OR n.startLine < 1 OR 
                      (n.endLine IS NOT NULL AND n.endLine < n.startLine)
                RETURN count(n) as count
            `);
            const invalidLines = invalidLinesResult.records[0].get('count').toNumber();
            
            if (invalidLines > 0) {
                this.validationResults.errors.push(`${invalidLines} nodes with invalid line numbers`);
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Node property validation failed: ${error.message}`);
        }
    }
    
    async validateRelationshipProperties() {
        try {
            // Check for relationships with confidence scores
            const withConfidenceResult = await this.session.run(`
                MATCH ()-[r]->()
                WHERE r.confidence IS NOT NULL
                RETURN count(r) as count
            `);
            const withConfidence = withConfidenceResult.records[0].get('count').toNumber();
            
            if (withConfidence > 0) {
                // Validate confidence score ranges
                const invalidConfidenceResult = await this.session.run(`
                    MATCH ()-[r]->()
                    WHERE r.confidence IS NOT NULL AND (r.confidence < 0 OR r.confidence > 1)
                    RETURN count(r) as count
                `);
                const invalidConfidence = invalidConfidenceResult.records[0].get('count').toNumber();
                
                if (invalidConfidence > 0) {
                    this.validationResults.errors.push(`${invalidConfidence} relationships with invalid confidence scores`);
                }
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Relationship property validation failed: ${error.message}`);
        }
    }
    
    async validateCrossLanguagePatterns() {
        try {
            this.validationResults.crossLanguageValidations = {};
            
            // JavaScript to Python API calls
            const jsToPyResult = await this.session.run(`
                MATCH (js:POI)-[r:CALLS]->(py:POI)
                WHERE js.filePath CONTAINS '.js' AND py.filePath CONTAINS '.py'
                RETURN count(r) as count
            `);
            const jsToPy = jsToPyResult.records[0].get('count').toNumber();
            
            this.validationResults.crossLanguageValidations.js_to_py_api_calls = {
                actual: jsToPy,
                expected: this.crossLanguageExpectations.js_to_py_api_calls.expected,
                passed: jsToPy >= this.crossLanguageExpectations.js_to_py_api_calls.min
            };
            
            // Java to JavaScript imports/references
            const javaToJsResult = await this.session.run(`
                MATCH (java:POI)-[r]-(js:POI)
                WHERE java.filePath CONTAINS '.java' AND js.filePath CONTAINS '.js'
                  AND type(r) IN ['IMPORTS', 'REFERENCES', 'USES']
                RETURN count(r) as count
            `);
            const javaToJs = javaToJsResult.records[0].get('count').toNumber();
            
            this.validationResults.crossLanguageValidations.java_to_js_imports = {
                actual: javaToJs,
                expected: this.crossLanguageExpectations.java_to_js_imports.expected,
                passed: javaToJs >= this.crossLanguageExpectations.java_to_js_imports.min
            };
            
            // SQL to code references
            const sqlToCodeResult = await this.session.run(`
                MATCH (sql:POI)-[r]-(code:POI)
                WHERE sql.type IN ['table', 'view', 'index', 'trigger'] 
                  AND code.type IN ['function', 'class', 'variable']
                  AND type(r) IN ['REFERENCES', 'USES']
                RETURN count(r) as count
            `);
            const sqlToCode = sqlToCodeResult.records[0].get('count').toNumber();
            
            this.validationResults.crossLanguageValidations.sql_to_code_references = {
                actual: sqlToCode,
                expected: this.crossLanguageExpectations.sql_to_code_references.expected,
                passed: sqlToCode >= this.crossLanguageExpectations.sql_to_code_references.min
            };
            
            // Inheritance chains
            const inheritanceResult = await this.session.run(`
                MATCH (child:POI)-[r:EXTENDS]->(parent:POI)
                RETURN count(r) as count
            `);
            const inheritance = inheritanceResult.records[0].get('count').toNumber();
            
            this.validationResults.crossLanguageValidations.inheritance_chains = {
                actual: inheritance,
                expected: this.crossLanguageExpectations.inheritance_chains.expected,
                passed: inheritance >= this.crossLanguageExpectations.inheritance_chains.min
            };
            
            // Check for cross-file relationships
            const crossFileResult = await this.session.run(`
                MATCH (n1:POI)-[r]->(n2:POI)
                WHERE n1.filePath <> n2.filePath
                RETURN count(r) as count
            `);
            const crossFile = crossFileResult.records[0].get('count').toNumber();
            
            if (crossFile < 50) {
                this.validationResults.warnings.push(
                    `Only ${crossFile} cross-file relationships found, expected more for comprehensive analysis`
                );
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Cross-language pattern validation failed: ${error.message}`);
        }
    }
    
    async validateGraphIntegrity() {
        try {
            // Check relationship-to-node ratio
            const totalNodes = this.validationResults.nodeValidations.total?.actual || 0;
            const totalRels = this.validationResults.relationshipValidations.total?.actual || 0;
            const ratio = totalNodes > 0 ? totalRels / totalNodes : 0;
            
            this.validationResults.relationshipRatio = {
                actual: ratio,
                expected: this.benchmark.relationshipToNodeRatio.expected,
                min: this.benchmark.relationshipToNodeRatio.min,
                max: this.benchmark.relationshipToNodeRatio.max,
                passed: ratio >= this.benchmark.relationshipToNodeRatio.min && ratio <= this.benchmark.relationshipToNodeRatio.max
            };
            
            if (ratio < this.benchmark.relationshipToNodeRatio.min) {
                this.validationResults.errors.push(
                    `Relationship-to-node ratio ${ratio.toFixed(2)} too low (expected ~${this.benchmark.relationshipToNodeRatio.expected})`
                );
            } else if (ratio > this.benchmark.relationshipToNodeRatio.max) {
                this.validationResults.warnings.push(
                    `Relationship-to-node ratio ${ratio.toFixed(2)} higher than expected`
                );
            }
            
            // Check for disconnected components
            const isolatedNodesResult = await this.session.run(`
                MATCH (n:POI)
                WHERE NOT (n)-[]-()
                RETURN count(n) as count
            `);
            const isolatedNodes = isolatedNodesResult.records[0].get('count').toNumber();
            
            if (isolatedNodes > totalNodes * 0.1) {
                this.validationResults.warnings.push(
                    `${isolatedNodes} isolated nodes found (${((isolatedNodes/totalNodes)*100).toFixed(1)}% of total)`
                );
            }
            
            // Check for duplicate node IDs
            const duplicateIdsResult = await this.session.run(`
                MATCH (n:POI)
                WHERE n.id IS NOT NULL
                WITH n.id as nodeId, count(n) as count
                WHERE count > 1
                RETURN sum(count) as totalDuplicates
            `);
            const duplicateIds = duplicateIdsResult.records[0].get('totalDuplicates')?.toNumber() || 0;
            
            if (duplicateIds > 0) {
                this.validationResults.errors.push(`${duplicateIds} duplicate node IDs found`);
            }
            
        } catch (error) {
            this.validationResults.errors.push(`Graph integrity validation failed: ${error.message}`);
        }
    }
    
    calculateScore(actual, benchmark) {
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
        
        // Node count scores (30% weight)
        if (this.validationResults.nodeValidations.total) {
            totalScore += this.validationResults.nodeValidations.total.score * 0.3;
            validationCount++;
        }
        
        // Relationship count scores (30% weight)  
        if (this.validationResults.relationshipValidations.total) {
            totalScore += this.validationResults.relationshipValidations.total.score * 0.3;
            validationCount++;
        }
        
        // Data quality scores (25% weight)
        const errorCount = this.validationResults.errors.length;
        const qualityScore = Math.max(0, 100 - (errorCount * 10));
        totalScore += qualityScore * 0.25;
        validationCount++;
        
        // Cross-language pattern scores (10% weight)
        const crossLangValidations = Object.values(this.validationResults.crossLanguageValidations || {});
        const passedCrossLang = crossLangValidations.filter(v => v.passed).length;
        const crossLangScore = crossLangValidations.length > 0 ? (passedCrossLang / crossLangValidations.length) * 100 : 100;
        totalScore += crossLangScore * 0.1;
        validationCount++;
        
        // Integrity scores (5% weight)
        const ratioScore = this.validationResults.relationshipRatio?.passed ? 100 : 50;
        totalScore += ratioScore * 0.05;
        validationCount++;
        
        this.validationResults.score = Math.round(totalScore / validationCount);
    }
    
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            database: this.uri,
            score: this.validationResults.score,
            passed: this.validationResults.passed,
            summary: {
                errors: this.validationResults.errors.length,
                warnings: this.validationResults.warnings.length,
                totalNodes: this.validationResults.nodeValidations.total?.actual || 0,
                totalRelationships: this.validationResults.relationshipValidations.total?.actual || 0,
                relationshipRatio: this.validationResults.relationshipRatio?.actual || 0
            },
            nodes: this.validationResults.nodeValidations,
            relationships: this.validationResults.relationshipValidations,
            crossLanguage: this.validationResults.crossLanguageValidations,
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

module.exports = Neo4jStateValidator;

// CLI interface for direct usage
if (require.main === module) {
    const uri = process.argv[2] || 'bolt://localhost:7687';
    const username = process.argv[3] || 'neo4j';
    const password = process.argv[4] || 'password';
    
    const validator = new Neo4jStateValidator(uri, username, password);
    
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