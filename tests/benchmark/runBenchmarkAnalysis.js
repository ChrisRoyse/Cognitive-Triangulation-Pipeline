#!/usr/bin/env node

/**
 * Benchmark Analysis Runner
 * 
 * Standalone script for running detailed benchmark analysis without full Jest test suite.
 * This is useful for debugging and continuous monitoring of pipeline performance.
 */

const { BenchmarkUtils } = require('./benchmarkUtils');
const { PipelineConfig } = require('../../src/config/PipelineConfig');
const path = require('path');
const fs = require('fs');

class BenchmarkAnalysisRunner {
    constructor() {
        this.config = PipelineConfig.createForTesting();
        this.utils = new BenchmarkUtils(this.config);
        this.outputDir = './test-results/benchmark';
    }
    
    async run() {
        console.log('🔍 Starting Benchmark Analysis...');
        console.log('=' .repeat(60));
        
        try {
            // Initialize database connections
            await this.utils.initialize();
            
            // Step 1: Validate polyglot-test directory
            console.log('\n📂 Validating polyglot-test directory...');
            const dirValidation = this.utils.validatePolyglotTestDirectory();
            this.reportDirectoryValidation(dirValidation);
            
            // Step 2: Check database states
            console.log('\n🗄️ Analyzing database states...');
            const databaseAnalysis = await this.analyzeDatabases();
            this.reportDatabaseAnalysis(databaseAnalysis);
            
            // Step 3: Generate comprehensive quality assessment
            console.log('\n📊 Generating quality assessment...');
            const qualityAssessment = await this.utils.generateQualityAssessment();
            this.reportQualityAssessment(qualityAssessment);
            
            // Step 4: Export results
            console.log('\n💾 Exporting results...');
            const exportPaths = await this.utils.exportResults(qualityAssessment, this.outputDir);
            this.reportExportPaths(exportPaths);
            
            // Step 5: Generate actionable recommendations
            console.log('\n💡 Generating recommendations...');
            this.generateActionableRecommendations(qualityAssessment);
            
            console.log('\n✅ Benchmark analysis completed successfully!');
            return qualityAssessment;
            
        } catch (error) {
            console.error('\n❌ Benchmark analysis failed:', error.message);
            console.error('Stack trace:', error.stack);
            process.exit(1);
        } finally {
            await this.utils.cleanup();
        }
    }
    
    reportDirectoryValidation(validation) {
        if (validation.valid) {
            console.log(`✅ All ${validation.totalRequired} required files found`);
        } else {
            console.log(`❌ Missing ${validation.missing} of ${validation.totalRequired} required files:`);
            validation.missingFiles.forEach(file => {
                console.log(`   • ${file}`);
            });
        }
        
        console.log(`📈 Coverage: ${validation.found}/${validation.totalRequired} (${((validation.found / validation.totalRequired) * 100).toFixed(1)}%)`);
    }
    
    async analyzeDatabases() {
        const analysis = {
            sqlite: null,
            neo4j: null,
            connectivity: {
                sqlite: false,
                neo4j: false
            }
        };
        
        // Check SQLite
        try {
            analysis.sqlite = await this.utils.getSQLiteMetrics();
            analysis.connectivity.sqlite = true;
            console.log('✅ SQLite database accessible');
        } catch (error) {
            console.log(`❌ SQLite database error: ${error.message}`);
        }
        
        // Check Neo4j
        try {
            analysis.neo4j = await this.utils.getNeo4jGraphStats();
            analysis.connectivity.neo4j = true;
            console.log('✅ Neo4j database accessible');
        } catch (error) {
            console.log(`❌ Neo4j database error: ${error.message}`);
        }
        
        return analysis;
    }
    
    reportDatabaseAnalysis(analysis) {
        if (analysis.sqlite) {
            console.log('\n📊 SQLite Database Metrics:');
            console.log(`   • Total Records: ${analysis.sqlite.totalRecords}`);
            console.log(`   • File Analysis: ${analysis.sqlite.fileAnalysisCount}`);
            console.log(`   • Entity Extractions: ${analysis.sqlite.entityExtractionCount}`);
            console.log(`   • Relationships: ${analysis.sqlite.relationshipCount}`);
        } else {
            console.log('\n⚠️ SQLite database not accessible - pipeline may not have run');
        }
        
        if (analysis.neo4j) {
            console.log('\n🕸️ Neo4j Graph Metrics:');
            console.log(`   • Total Nodes: ${analysis.neo4j.nodes.total}`);
            console.log(`   • Total Relationships: ${analysis.neo4j.relationships.total}`);
            console.log(`   • Relationship Ratio: ${analysis.neo4j.relationships.ratio.toFixed(2)}`);
            console.log(`   • Node Types: ${Object.keys(analysis.neo4j.nodes.byType).length}`);
            console.log(`   • Relationship Types: ${Object.keys(analysis.neo4j.relationships.byType).length}`);
            
            if (analysis.neo4j.nodes.withoutType > 0) {
                console.log(`   ⚠️ Nodes without type: ${analysis.neo4j.nodes.withoutType}`);
            }
        } else {
            console.log('\n⚠️ Neo4j graph not accessible - check database connection');
        }
    }
    
    reportQualityAssessment(assessment) {
        console.log(`\n🎯 Overall Quality: ${assessment.overall} (${assessment.scores.overall}%)`);
        
        console.log('\n📈 Component Scores:');
        console.log(`   • Node Count: ${assessment.scores.nodeCount}%`);
        console.log(`   • Relationship Count: ${assessment.scores.relationshipCount}%`);
        console.log(`   • Relationship Ratio: ${assessment.scores.relationshipRatio}%`);
        console.log(`   • Type Distribution: ${assessment.scores.typeDistribution}%`);
        console.log(`   • Cross-Language: ${assessment.scores.crossLanguage}%`);
        
        if (assessment.issues.length > 0) {
            console.log('\n⚠️ Issues Identified:');
            assessment.issues.forEach(issue => console.log(`   • ${issue}`));
        }
        
        if (assessment.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            assessment.recommendations.forEach(rec => console.log(`   • ${rec}`));
        }
        
        // Report cross-language patterns
        if (assessment.details.crossLangPatterns && assessment.details.crossLangPatterns.length > 0) {
            console.log('\n🔗 Cross-Language Patterns Found:');
            assessment.details.crossLangPatterns.forEach(pattern => {
                console.log(`   • ${pattern.type}: ${pattern.count} instances`);
            });
        } else {
            console.log('\n⚠️ No cross-language patterns detected - this may indicate analysis issues');
        }
    }
    
    reportExportPaths(exportPaths) {
        console.log('📄 Results exported to:');
        console.log(`   • JSON: ${exportPaths.json}`);
        console.log(`   • CSV: ${exportPaths.csv}`);
        console.log(`   • Markdown: ${exportPaths.markdown}`);
    }
    
    generateActionableRecommendations(assessment) {
        const recommendations = [];
        
        // Specific recommendations based on scores
        if (assessment.scores.nodeCount < 80) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Entity Extraction',
                issue: 'Node count below benchmark expectations',
                action: 'Review entity extraction prompts and file processing logic',
                impact: 'Critical for pipeline functionality'
            });
        }
        
        if (assessment.scores.relationshipCount < 80) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Relationship Resolution',
                issue: 'Relationship count below benchmark expectations',
                action: 'Enhance relationship detection algorithms and cross-file analysis',
                impact: 'Critical for knowledge graph completeness'
            });
        }
        
        if (assessment.scores.crossLanguage < 70) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Cross-Language Analysis',
                issue: 'Insufficient cross-language relationship detection',
                action: 'Improve multi-language parsing and API call detection',
                impact: 'Important for polyglot codebase analysis'
            });
        }
        
        if (assessment.scores.relationshipRatio < 80) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Graph Connectivity',
                issue: 'Low relationship-to-node ratio indicates isolated entities',
                action: 'Review relationship resolution and entity linking logic',
                impact: 'Affects graph traversal and analysis quality'
            });
        }
        
        // Database-specific recommendations
        if (!assessment.details.sqliteMetrics) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Pipeline Execution',
                issue: 'SQLite database not populated',
                action: 'Ensure pipeline is running and completing successfully',
                impact: 'Indicates pipeline execution failure'
            });
        }
        
        if (assessment.details.graphStats && assessment.details.graphStats.nodes.withoutType > 0) {
            recommendations.push({
                priority: 'LOW',
                category: 'Data Quality',
                issue: `${assessment.details.graphStats.nodes.withoutType} nodes without type classification`,
                action: 'Ensure all POIs receive proper type classification during extraction',
                impact: 'Improves graph queryability and analysis'
            });
        }
        
        // Display recommendations
        if (recommendations.length > 0) {
            console.log('\n🎯 Actionable Recommendations:');
            
            const byPriority = {
                HIGH: recommendations.filter(r => r.priority === 'HIGH'),
                MEDIUM: recommendations.filter(r => r.priority === 'MEDIUM'),
                LOW: recommendations.filter(r => r.priority === 'LOW')
            };
            
            Object.entries(byPriority).forEach(([priority, recs]) => {
                if (recs.length > 0) {
                    console.log(`\n   ${priority} Priority:`);
                    recs.forEach(rec => {
                        console.log(`   📌 ${rec.category}: ${rec.issue}`);
                        console.log(`      → Action: ${rec.action}`);
                        console.log(`      → Impact: ${rec.impact}`);
                        console.log('');
                    });
                }
            });
        } else {
            console.log('\n✨ No specific recommendations - pipeline performance is satisfactory!');
        }
    }
}

// CLI interface
if (require.main === module) {
    const runner = new BenchmarkAnalysisRunner();
    
    runner.run()
        .then(results => {
            console.log(`\n🏁 Analysis completed with overall score: ${results.scores.overall}%`);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Analysis failed:', error.message);
            process.exit(1);
        });
}

module.exports = { BenchmarkAnalysisRunner };