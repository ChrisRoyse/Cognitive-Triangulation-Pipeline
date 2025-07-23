/**
 * Benchmark Utilities
 * 
 * Helper functions for benchmark validation, analysis, and reporting.
 * These utilities support the master benchmark test suite with detailed
 * validation logic and debugging capabilities.
 */

const fs = require('fs');
const path = require('path');
const neo4j = require('neo4j-driver');
const sqlite3 = require('sqlite3').verbose();

class BenchmarkUtils {
    constructor(config) {
        this.config = config;
        this.neo4jDriver = null;
        this.sqliteDb = null;
    }
    
    /**
     * Initialize database connections
     */
    async initialize() {
        // Initialize Neo4j connection
        this.neo4jDriver = neo4j.driver(
            this.config.database.neo4j.uri,
            neo4j.auth.basic(this.config.database.neo4j.user, this.config.database.neo4j.password)
        );
        
        // Test Neo4j connection
        const session = this.neo4jDriver.session();
        try {
            await session.run('RETURN 1');
        } finally {
            await session.close();
        }
        
        // Initialize SQLite connection if database exists
        if (fs.existsSync(this.config.database.sqlite.path)) {
            this.sqliteDb = new sqlite3.Database(this.config.database.sqlite.path);
        }
    }
    
    /**
     * Close database connections
     */
    async cleanup() {
        if (this.neo4jDriver) {
            await this.neo4jDriver.close();
        }
        if (this.sqliteDb) {
            this.sqliteDb.close();
        }
    }
    
    /**
     * Validate that all required files in polyglot-test directory exist
     */
    validatePolyglotTestDirectory(testDir = './polyglot-test') {
        const requiredFiles = [
            // SQL files
            'database/schema.sql',
            'database/test_data.sql',
            
            // Java files
            'java/User.java',
            'java/UserService.java',
            'java/DatabaseManager.java',
            'java/BusinessLogic.java',
            'java/ApiClient.java',
            
            // JavaScript files
            'js/server.js',
            'js/config.js',
            'js/utils.js',
            'js/auth.js',
            
            // Python files
            'python/data_processor.py',
            'python/database_client.py',
            'python/ml_service.py',
            'python/utils.py'
        ];
        
        const missing = [];
        const found = [];
        
        for (const file of requiredFiles) {
            const filePath = path.join(testDir, file);
            if (fs.existsSync(filePath)) {
                found.push(file);
            } else {
                missing.push(file);
            }
        }
        
        return {
            valid: missing.length === 0,
            totalRequired: requiredFiles.length,
            found: found.length,
            missing: missing.length,
            missingFiles: missing,
            foundFiles: found
        };
    }
    
    /**
     * Get detailed SQLite database metrics
     */
    async getSQLiteMetrics() {
        if (!this.sqliteDb) {
            throw new Error('SQLite database not initialized');
        }
        
        return new Promise((resolve, reject) => {
            const metrics = {
                tables: {},
                totalRecords: 0,
                fileAnalysisCount: 0,
                entityExtractionCount: 0,
                relationshipCount: 0
            };
            
            // Get table counts
            const queries = [
                "SELECT COUNT(*) as count FROM file_analysis WHERE 1",
                "SELECT COUNT(*) as count FROM entity_extractions WHERE 1",
                "SELECT COUNT(*) as count FROM relationships WHERE 1",
                "SELECT COUNT(*) as count FROM outbox WHERE 1"
            ];
            
            let completed = 0;
            const tableNames = ['file_analysis', 'entity_extractions', 'relationships', 'outbox'];
            
            queries.forEach((query, index) => {
                this.sqliteDb.get(query, (err, row) => {
                    if (err) {
                        console.warn(`SQLite query failed: ${err.message}`);
                        metrics.tables[tableNames[index]] = 0;
                    } else {
                        const count = row ? row.count : 0;
                        metrics.tables[tableNames[index]] = count;
                        metrics.totalRecords += count;
                        
                        // Set specific counters
                        if (tableNames[index] === 'file_analysis') metrics.fileAnalysisCount = count;
                        if (tableNames[index] === 'entity_extractions') metrics.entityExtractionCount = count;
                        if (tableNames[index] === 'relationships') metrics.relationshipCount = count;
                    }
                    
                    completed++;
                    if (completed === queries.length) {
                        resolve(metrics);
                    }
                });
            });
        });
    }
    
    /**
     * Get comprehensive Neo4j graph statistics
     */
    async getNeo4jGraphStats() {
        const session = this.neo4jDriver.session();
        try {
            const stats = {
                nodes: {
                    total: 0,
                    byType: {},
                    byLabel: {},
                    withoutType: 0
                },
                relationships: {
                    total: 0,
                    byType: {},
                    ratio: 0
                },
                fileDistribution: {},
                languageDistribution: {}
            };
            
            // Get total node count
            const nodeCountResult = await session.run('MATCH (n) RETURN count(n) as total');
            stats.nodes.total = nodeCountResult.records[0].get('total').toNumber();
            
            // Get total relationship count
            const relCountResult = await session.run('MATCH ()-[r]->() RETURN count(r) as total');
            stats.relationships.total = relCountResult.records[0].get('total').toNumber();
            
            // Calculate ratio
            stats.relationships.ratio = stats.nodes.total > 0 ? stats.relationships.total / stats.nodes.total : 0;
            
            // Get node counts by type
            const nodeTypeResult = await session.run(`
                MATCH (n) 
                WHERE n.type IS NOT NULL
                RETURN n.type as type, count(n) as count
                ORDER BY count DESC
            `);
            
            nodeTypeResult.records.forEach(record => {
                stats.nodes.byType[record.get('type')] = record.get('count').toNumber();
            });
            
            // Get nodes without type
            const noTypeResult = await session.run('MATCH (n) WHERE n.type IS NULL RETURN count(n) as count');
            stats.nodes.withoutType = noTypeResult.records[0].get('count').toNumber();
            
            // Get relationship counts by type
            const relTypeResult = await session.run(`
                MATCH ()-[r]->() 
                RETURN type(r) as relType, count(r) as count
                ORDER BY count DESC
            `);
            
            relTypeResult.records.forEach(record => {
                stats.relationships.byType[record.get('relType')] = record.get('count').toNumber();
            });
            
            // Get file distribution
            const fileDistResult = await session.run(`
                MATCH (n) 
                WHERE n.file_path IS NOT NULL
                RETURN n.file_path as filePath, count(n) as count
                ORDER BY count DESC
            `);
            
            fileDistResult.records.forEach(record => {
                const filePath = record.get('filePath');
                stats.fileDistribution[filePath] = record.get('count').toNumber();
                
                // Extract language from file extension
                const ext = path.extname(filePath).toLowerCase();
                const language = this.getLanguageFromExtension(ext);
                stats.languageDistribution[language] = (stats.languageDistribution[language] || 0) + 1;
            });
            
            return stats;
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Detect specific cross-language relationship patterns
     */
    async detectCrossLanguagePatterns() {
        const session = this.neo4jDriver.session();
        try {
            const patterns = [];
            
            // Pattern 1: Java to Python API calls
            const javaToPython = await session.run(`
                MATCH (j:POI)-[r]->(p:POI)
                WHERE j.file_path =~ '.*\\.java$' AND p.file_path =~ '.*\\.py$'
                AND (j.name CONTAINS 'Service' OR j.name CONTAINS 'Client')
                AND (p.name CONTAINS 'processor' OR p.name CONTAINS 'service')
                RETURN j.name as javaEntity, type(r) as relationship, p.name as pythonEntity, 
                       j.file_path as javaFile, p.file_path as pythonFile
                LIMIT 10
            `);
            
            if (javaToPython.records.length > 0) {
                patterns.push({
                    type: 'Java to Python API calls',
                    count: javaToPython.records.length,
                    examples: javaToPython.records.map(r => ({
                        source: `${r.get('javaEntity')} (${path.basename(r.get('javaFile'))})`,
                        relationship: r.get('relationship'),
                        target: `${r.get('pythonEntity')} (${path.basename(r.get('pythonFile'))})`
                    }))
                });
            }
            
            // Pattern 2: Database to code relationships
            const dbToCode = await session.run(`
                MATCH (db:POI)-[r]->(code:POI)
                WHERE db.file_path CONTAINS 'schema.sql'
                AND code.file_path =~ '.*\\.(java|py|js)$'
                RETURN db.name as dbEntity, type(r) as relationship, code.name as codeEntity,
                       code.file_path as codeFile
                LIMIT 10
            `);
            
            if (dbToCode.records.length > 0) {
                patterns.push({
                    type: 'Database schema to code relationships',
                    count: dbToCode.records.length,
                    examples: dbToCode.records.map(r => ({
                        source: `${r.get('dbEntity')} (schema.sql)`,
                        relationship: r.get('relationship'),
                        target: `${r.get('codeEntity')} (${path.basename(r.get('codeFile'))})`
                    }))
                });
            }
            
            // Pattern 3: Inheritance relationships
            const inheritance = await session.run(`
                MATCH (child:POI)-[r:EXTENDS]->(parent:POI)
                RETURN child.name as childClass, parent.name as parentClass,
                       child.file_path as childFile, parent.file_path as parentFile
                LIMIT 10
            `);
            
            if (inheritance.records.length > 0) {
                patterns.push({
                    type: 'Class inheritance relationships',
                    count: inheritance.records.length,
                    examples: inheritance.records.map(r => ({
                        source: `${r.get('childClass')} (${path.basename(r.get('childFile'))})`,
                        relationship: 'EXTENDS',
                        target: `${r.get('parentClass')} (${path.basename(r.get('parentFile'))})`
                    }))
                });
            }
            
            // Pattern 4: Cross-service function calls
            const crossServiceCalls = await session.run(`
                MATCH (caller:POI)-[r:CALLS]->(callee:POI)
                WHERE caller.file_path =~ '.*\\.(java|py|js)$' 
                AND callee.file_path =~ '.*\\.(java|py|js)$'
                AND caller.file_path <> callee.file_path
                AND NOT (caller.file_path =~ callee.file_path OR callee.file_path =~ caller.file_path)
                RETURN caller.name as callerFunction, callee.name as calleeFunction,
                       caller.file_path as callerFile, callee.file_path as calleeFile
                LIMIT 10
            `);
            
            if (crossServiceCalls.records.length > 0) {
                patterns.push({
                    type: 'Cross-service function calls',
                    count: crossServiceCalls.records.length,
                    examples: crossServiceCalls.records.map(r => ({
                        source: `${r.get('callerFunction')} (${path.basename(r.get('callerFile'))})`,
                        relationship: 'CALLS',
                        target: `${r.get('calleeFunction')} (${path.basename(r.get('calleeFile'))})`
                    }))
                });
            }
            
            return patterns;
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Generate a detailed quality assessment
     */
    async generateQualityAssessment() {
        const assessment = {
            timestamp: new Date().toISOString(),
            overall: 'UNKNOWN',
            scores: {},
            issues: [],
            recommendations: [],
            details: {}
        };
        
        try {
            // Get basic stats
            const graphStats = await this.getNeo4jGraphStats();
            const sqliteMetrics = this.sqliteDb ? await this.getSQLiteMetrics() : null;
            
            // Score components
            const scores = {
                nodeCount: this.scoreNodeCount(graphStats.nodes.total),
                relationshipCount: this.scoreRelationshipCount(graphStats.relationships.total),
                relationshipRatio: this.scoreRelationshipRatio(graphStats.relationships.ratio),
                typeDistribution: this.scoreTypeDistribution(graphStats.nodes.byType),
                crossLanguage: 0 // Will be calculated
            };
            
            // Get cross-language patterns
            const crossLangPatterns = await this.detectCrossLanguagePatterns();
            scores.crossLanguage = this.scoreCrossLanguagePatterns(crossLangPatterns);
            
            // Calculate overall score
            const weights = { nodeCount: 0.25, relationshipCount: 0.25, relationshipRatio: 0.15, typeDistribution: 0.15, crossLanguage: 0.20 };
            const overallScore = Object.entries(scores).reduce((sum, [key, score]) => sum + (score * weights[key]), 0);
            
            // Determine overall grade
            if (overallScore >= 90) assessment.overall = 'EXCELLENT';
            else if (overallScore >= 80) assessment.overall = 'GOOD';
            else if (overallScore >= 70) assessment.overall = 'SATISFACTORY';
            else if (overallScore >= 60) assessment.overall = 'NEEDS_IMPROVEMENT';
            else assessment.overall = 'POOR';
            
            assessment.scores = {
                ...scores,
                overall: Math.round(overallScore)
            };
            
            // Generate issues and recommendations
            this.analyzeIssuesAndRecommendations(assessment, graphStats, crossLangPatterns);
            
            assessment.details = {
                graphStats,
                sqliteMetrics,
                crossLangPatterns
            };
            
            return assessment;
            
        } catch (error) {
            assessment.overall = 'ERROR';
            assessment.issues.push(`Quality assessment failed: ${error.message}`);
            return assessment;
        }
    }
    
    /**
     * Score node count against benchmark expectations
     */
    scoreNodeCount(count) {
        const expected = 417;
        const minimum = 300;
        
        if (count >= expected) return 100;
        if (count >= expected * 0.9) return 90;
        if (count >= expected * 0.8) return 80;
        if (count >= minimum) return 70;
        return Math.max(0, (count / minimum) * 70);
    }
    
    /**
     * Score relationship count against benchmark expectations
     */
    scoreRelationshipCount(count) {
        const expected = 1876;
        const minimum = 1600;
        
        if (count >= expected) return 100;
        if (count >= expected * 0.9) return 90;
        if (count >= expected * 0.8) return 80;
        if (count >= minimum) return 70;
        return Math.max(0, (count / minimum) * 70);
    }
    
    /**
     * Score relationship ratio
     */
    scoreRelationshipRatio(ratio) {
        const expected = 4.5;
        const minimum = 4.0;
        
        if (ratio >= expected) return 100;
        if (ratio >= expected * 0.9) return 90;
        if (ratio >= minimum) return 80;
        return Math.max(0, (ratio / minimum) * 80);
    }
    
    /**
     * Score type distribution diversity
     */
    scoreTypeDistribution(nodeTypes) {
        const expectedTypes = ['File', 'Class', 'Function', 'Variable', 'Import', 'Export'];
        const foundTypes = Object.keys(nodeTypes);
        const typesCovered = expectedTypes.filter(type => foundTypes.includes(type)).length;
        
        return (typesCovered / expectedTypes.length) * 100;
    }
    
    /**
     * Score cross-language pattern detection
     */
    scoreCrossLanguagePatterns(patterns) {
        const expectedPatternTypes = ['Java to Python API calls', 'Database schema to code relationships', 'Class inheritance relationships'];
        const foundPatternTypes = patterns.map(p => p.type);
        const patternsCovered = expectedPatternTypes.filter(type => foundPatternTypes.includes(type)).length;
        
        return (patternsCovered / expectedPatternTypes.length) * 100;
    }
    
    /**
     * Analyze issues and generate recommendations
     */
    analyzeIssuesAndRecommendations(assessment, graphStats, crossLangPatterns) {
        // Node count issues
        if (graphStats.nodes.total < 300) {
            assessment.issues.push('Node count below minimum requirement');
            assessment.recommendations.push('Check entity extraction - files may not be processed correctly');
        }
        
        // Relationship issues
        if (graphStats.relationships.total < 1600) {
            assessment.issues.push('Relationship count below minimum requirement');
            assessment.recommendations.push('Review relationship resolution algorithms');
        }
        
        // Ratio issues
        if (graphStats.relationships.ratio < 4.0) {
            assessment.issues.push('Relationship ratio too low - entities may be isolated');
            assessment.recommendations.push('Check relationship detection and graph connectivity');
        }
        
        // Type distribution issues
        const expectedTypes = ['File', 'Class', 'Function', 'Variable', 'Import'];
        const missingTypes = expectedTypes.filter(type => !graphStats.nodes.byType[type]);
        if (missingTypes.length > 0) {
            assessment.issues.push(`Missing node types: ${missingTypes.join(', ')}`);
            assessment.recommendations.push('Review entity extraction prompts and parsing logic');
        }
        
        // Cross-language issues
        if (crossLangPatterns.length < 3) {
            assessment.issues.push('Insufficient cross-language relationship detection');
            assessment.recommendations.push('Enhance cross-language analysis and relationship resolution');
        }
        
        // Nodes without type
        if (graphStats.nodes.withoutType > 0) {
            assessment.issues.push(`${graphStats.nodes.withoutType} nodes missing type classification`);
            assessment.recommendations.push('Ensure all POIs have proper type classification');
        }
    }
    
    /**
     * Get language from file extension
     */
    getLanguageFromExtension(ext) {
        const langMap = {
            '.java': 'Java',
            '.js': 'JavaScript',
            '.py': 'Python',
            '.sql': 'SQL',
            '.json': 'JSON',
            '.md': 'Markdown'
        };
        
        return langMap[ext] || 'Unknown';
    }
    
    /**
     * Export benchmark results to various formats
     */
    async exportResults(results, outputDir = './test-results/benchmark') {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Export JSON
        const jsonPath = path.join(outputDir, `benchmark-analysis-${timestamp}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        
        // Export CSV summary
        const csvPath = path.join(outputDir, `benchmark-summary-${timestamp}.csv`);
        const csvContent = this.generateCSVSummary(results);
        fs.writeFileSync(csvPath, csvContent);
        
        // Export detailed markdown report
        const mdPath = path.join(outputDir, `benchmark-detailed-${timestamp}.md`);
        const mdContent = this.generateMarkdownReport(results);
        fs.writeFileSync(mdPath, mdContent);
        
        return {
            json: jsonPath,
            csv: csvPath,
            markdown: mdPath
        };
    }
    
    /**
     * Generate CSV summary
     */
    generateCSVSummary(results) {
        let csv = 'Metric,Expected,Actual,Score,Grade\n';
        csv += `Nodes,417,${results.details.graphStats.nodes.total},${results.scores.nodeCount},${this.getGradeFromScore(results.scores.nodeCount)}\n`;
        csv += `Relationships,1876,${results.details.graphStats.relationships.total},${results.scores.relationshipCount},${this.getGradeFromScore(results.scores.relationshipCount)}\n`;
        csv += `Ratio,4.5,${results.details.graphStats.relationships.ratio.toFixed(2)},${results.scores.relationshipRatio},${this.getGradeFromScore(results.scores.relationshipRatio)}\n`;
        csv += `Cross-Language,100%,${results.details.crossLangPatterns.length} patterns,${results.scores.crossLanguage},${this.getGradeFromScore(results.scores.crossLanguage)}\n`;
        csv += `Overall,100,${results.scores.overall},${results.scores.overall},${this.getGradeFromScore(results.scores.overall)}\n`;
        
        return csv;
    }
    
    /**
     * Generate detailed markdown report
     */
    generateMarkdownReport(results) {
        return `# Cognitive Triangulation Pipeline Benchmark Analysis

Generated: ${results.timestamp}
Overall Assessment: **${results.overall}** (${results.scores.overall}%)

## Executive Summary

The Cognitive Triangulation Pipeline has been evaluated against the polyglot-test benchmark requirements. This analysis provides comprehensive insights into entity extraction, relationship detection, and cross-language analysis capabilities.

## Quantitative Results

| Metric | Expected | Actual | Score | Grade |
|--------|----------|--------|-------|-------|
| Total Nodes | 417 | ${results.details.graphStats.nodes.total} | ${results.scores.nodeCount}% | ${this.getGradeFromScore(results.scores.nodeCount)} |
| Total Relationships | 1,876 | ${results.details.graphStats.relationships.total} | ${results.scores.relationshipCount}% | ${this.getGradeFromScore(results.scores.relationshipCount)} |
| Relationship Ratio | 4.5 | ${results.details.graphStats.relationships.ratio.toFixed(2)} | ${results.scores.relationshipRatio}% | ${this.getGradeFromScore(results.scores.relationshipRatio)} |
| Cross-Language Detection | Multiple patterns | ${results.details.crossLangPatterns.length} patterns | ${results.scores.crossLanguage}% | ${this.getGradeFromScore(results.scores.crossLanguage)} |

## Node Type Distribution

${Object.entries(results.details.graphStats.nodes.byType).map(([type, count]) => `- **${type}**: ${count}`).join('\n')}

## Relationship Type Distribution

${Object.entries(results.details.graphStats.relationships.byType).map(([type, count]) => `- **${type}**: ${count}`).join('\n')}

## Cross-Language Patterns Detected

${results.details.crossLangPatterns.map(pattern => `
### ${pattern.type}
- **Count**: ${pattern.count}
- **Examples**:
${pattern.examples.map(ex => `  - ${ex.source} → [${ex.relationship}] → ${ex.target}`).join('\n')}
`).join('\n')}

## Issues Identified

${results.issues.length === 0 ? 'No critical issues identified.' : results.issues.map(issue => `- ${issue}`).join('\n')}

## Recommendations

${results.recommendations.length === 0 ? 'Pipeline performance is satisfactory.' : results.recommendations.map(rec => `- ${rec}`).join('\n')}

## Conclusion

${this.generateConclusion(results)}
`;
    }
    
    /**
     * Get letter grade from numeric score
     */
    getGradeFromScore(score) {
        if (score >= 95) return 'A+';
        if (score >= 90) return 'A';
        if (score >= 85) return 'B+';
        if (score >= 80) return 'B';
        if (score >= 75) return 'C+';
        if (score >= 70) return 'C';
        if (score >= 65) return 'D+';
        if (score >= 60) return 'D';
        return 'F';
    }
    
    /**
     * Generate conclusion based on results
     */
    generateConclusion(results) {
        const score = results.scores.overall;
        
        if (score >= 90) {
            return 'The pipeline demonstrates excellent performance across all benchmark criteria. Entity extraction and relationship detection are operating at optimal levels with strong cross-language analysis capabilities.';
        } else if (score >= 80) {
            return 'The pipeline shows good performance with minor areas for improvement. Core functionality is solid with effective entity and relationship detection.';
        } else if (score >= 70) {
            return 'The pipeline meets basic requirements but has room for improvement in several areas. Focus on enhancing relationship detection and cross-language analysis.';
        } else if (score >= 60) {
            return 'The pipeline requires significant improvements to meet benchmark standards. Review entity extraction logic and relationship resolution algorithms.';
        } else {
            return 'The pipeline is not meeting minimum benchmark requirements. Comprehensive review and debugging of core functionality is needed.';
        }
    }
}

module.exports = { BenchmarkUtils };