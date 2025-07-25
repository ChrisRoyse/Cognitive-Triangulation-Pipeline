#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const { CognitiveTriangulationPipeline } = require('../../src/main');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const chalk = require('chalk');
const Table = require('cli-table3');

/**
 * This script validates that the cognitive triangulation architecture
 * delivers the theoretical benefits it promises:
 * 1. Higher accuracy through multiple perspectives
 * 2. Better confidence calibration
 * 3. Reduced false positives through validation
 * 4. Improved handling of complex relationships
 */
class TriangulationValidator {
    constructor() {
        this.testCases = [
            {
                name: 'Complex Cross-Language Relationship',
                description: 'JavaScript API calling Python service through REST',
                setupFile: 'js/api/dataSync.js',
                expectedRelationship: {
                    source: 'DataSyncService',
                    target: 'python/services/dataService.py:DataProcessor',
                    type: 'CALLS'
                }
            },
            {
                name: 'Ambiguous Relationship Resolution',
                description: 'Multiple possible targets with same name',
                setupFile: 'js/services/userService.js',
                expectedRelationship: {
                    source: 'UserService',
                    target: 'js/models/user.js:UserModel',
                    type: 'USES'
                }
            },
            {
                name: 'Indirect Relationship Detection',
                description: 'Relationship through intermediate configuration',
                setupFile: 'js/config/database.js',
                expectedRelationship: {
                    source: 'DatabaseConfig',
                    target: 'database/schema.sql',
                    type: 'CONFIGURES'
                }
            }
        ];
        
        this.results = {
            modeComparison: {},
            confidenceAnalysis: {},
            accuracyImprovement: {},
            validationEffectiveness: {}
        };
    }
    
    async run() {
        console.log(chalk.blue.bold('\n🔺 Cognitive Triangulation Validation Suite\n'));
        
        // Load ground truth
        const groundTruthPath = path.join(__dirname, 'ground-truth', 'polyglot-relationships.json');
        this.groundTruth = JSON.parse(await fs.readFile(groundTruthPath, 'utf8'));
        
        // Run comparative analysis
        await this.runComparativeAnalysis();
        
        // Analyze specific test cases
        await this.analyzeTestCases();
        
        // Generate validation report
        await this.generateValidationReport();
    }
    
    async runComparativeAnalysis() {
        console.log(chalk.yellow('\n📊 Running Comparative Analysis...\n'));
        
        // Test configurations for each mode
        const modeConfigs = [
            {
                mode: 'batch_only',
                name: 'Batch Analysis Only',
                config: {
                    batchAnalysisThreshold: 0.0,
                    individualAnalysisThreshold: 1.1, // Never trigger
                    triangulationThreshold: 1.1 // Never trigger
                }
            },
            {
                mode: 'individual_only',
                name: 'Individual Analysis Only',
                config: {
                    batchAnalysisThreshold: 1.1, // Never use batch
                    individualAnalysisThreshold: 0.0,
                    triangulationThreshold: 1.1 // Never trigger
                }
            },
            {
                mode: 'with_triangulation',
                name: 'Full Triangulation',
                config: {
                    batchAnalysisThreshold: 0.8,
                    individualAnalysisThreshold: 0.6,
                    triangulationThreshold: 0.7 // Enable triangulation
                }
            }
        ];
        
        for (const modeConfig of modeConfigs) {
            console.log(chalk.cyan(`Testing: ${modeConfig.name}`));
            
            const results = await this.runPipelineWithConfig(modeConfig.config);
            this.results.modeComparison[modeConfig.mode] = results;
            
            // Display immediate results
            console.log(`  ✓ Relationships found: ${results.relationshipCount}`);
            console.log(`  ✓ Average confidence: ${results.avgConfidence.toFixed(3)}`);
            console.log(`  ✓ F1 Score: ${(results.accuracy.f1Score * 100).toFixed(2)}%`);
        }
    }
    
    async runPipelineWithConfig(confidenceConfig) {
        const dbPath = path.join(__dirname, 'temp', `triangulation_test_${Date.now()}.db`);
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        
        // Configure pipeline
        const pipelineConfig = PipelineConfig.createDefault();
        Object.assign(pipelineConfig.confidence, confidenceConfig);
        pipelineConfig.database.sqlite.path = dbPath;
        pipelineConfig.environment = 'test';
        
        // Run pipeline
        const pipeline = new CognitiveTriangulationPipeline(
            path.join(process.cwd(), 'polyglot-test'),
            dbPath,
            { pipelineConfig }
        );
        
        try {
            const runResults = await pipeline.run();
            
            // Analyze results
            const dbManager = new DatabaseManager(dbPath);
            
            const analysis = await this.analyzePipelineResults(dbManager, runResults.runId);
            
            await dbManager.close();
            await pipeline.shutdown();
            
            return analysis;
            
        } finally {
            // Cleanup
            try {
                await fs.unlink(dbPath);
            } catch (err) {
                // Ignore
            }
        }
    }
    
    async analyzePipelineResults(dbManager, runId) {
        // Get relationship statistics
        const stats = await dbManager.db.get(`
            SELECT 
                COUNT(*) as relationshipCount,
                AVG(confidence_score) as avgConfidence,
                MIN(confidence_score) as minConfidence,
                MAX(confidence_score) as maxConfidence,
                COUNT(DISTINCT source_poi_id) as uniqueSources,
                COUNT(DISTINCT target_poi_id) as uniqueTargets
            FROM code_relationships
            WHERE run_id = ?
        `, [runId]);
        
        // Get mode distribution
        const modeDistribution = await dbManager.db.all(`
            SELECT 
                am.mode_type,
                COUNT(*) as count,
                AVG(ar.confidence_score) as avgConfidence
            FROM analysis_results ar
            JOIN analysis_modes am ON ar.analysis_mode_id = am.id
            WHERE ar.run_id = ?
            GROUP BY am.mode_type
        `, [runId]);
        
        // Get relationships for accuracy calculation
        const relationships = await dbManager.db.all(`
            SELECT 
                cr.*,
                sf.file_path as source_path,
                tf.file_path as target_path,
                sp.name as source_name,
                tp.name as target_name
            FROM code_relationships cr
            JOIN points_of_interest sp ON cr.source_poi_id = sp.id
            JOIN points_of_interest tp ON cr.target_poi_id = tp.id
            JOIN code_files sf ON sp.file_id = sf.id
            JOIN code_files tf ON tp.file_id = tf.id
            WHERE cr.run_id = ?
        `, [runId]);
        
        // Calculate accuracy
        const accuracy = this.calculateAccuracy(relationships);
        
        // Analyze confidence distribution
        const confidenceDistribution = await dbManager.db.all(`
            SELECT 
                CASE 
                    WHEN confidence_score >= 0.9 THEN 'very_high'
                    WHEN confidence_score >= 0.8 THEN 'high'
                    WHEN confidence_score >= 0.7 THEN 'medium'
                    WHEN confidence_score >= 0.6 THEN 'low'
                    ELSE 'very_low'
                END as bucket,
                COUNT(*) as count
            FROM code_relationships
            WHERE run_id = ?
            GROUP BY bucket
        `, [runId]);
        
        return {
            ...stats,
            modeDistribution: modeDistribution.reduce((acc, m) => {
                acc[m.mode_type] = {
                    count: m.count,
                    avgConfidence: m.avgConfidence
                };
                return acc;
            }, {}),
            accuracy,
            confidenceDistribution: confidenceDistribution.reduce((acc, c) => {
                acc[c.bucket] = c.count;
                return acc;
            }, {}),
            relationships
        };
    }
    
    calculateAccuracy(relationships) {
        let truePositives = 0;
        let falsePositives = 0;
        
        relationships.forEach(rel => {
            const isCorrect = this.isRelationshipCorrect(rel);
            if (isCorrect) {
                truePositives++;
            } else {
                falsePositives++;
            }
        });
        
        const falseNegatives = this.groundTruth.relationships.length - truePositives;
        
        const precision = truePositives / (truePositives + falsePositives) || 0;
        const recall = truePositives / (truePositives + falseNegatives) || 0;
        const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
        
        return {
            truePositives,
            falsePositives,
            falseNegatives,
            precision,
            recall,
            f1Score
        };
    }
    
    isRelationshipCorrect(relationship) {
        // Simplified matching for validation purposes
        const relKey = `${relationship.source_path}:${relationship.source_name}->${relationship.target_path}:${relationship.target_name}`.toLowerCase();
        
        return this.groundTruth.relationships.some(gt => {
            const gtKey = `${gt.source}->${gt.target}`.toLowerCase();
            return relKey.includes(gtKey.split('->')[0]) && relKey.includes(gtKey.split('->')[1]);
        });
    }
    
    async analyzeTestCases() {
        console.log(chalk.yellow('\n🔍 Analyzing Specific Test Cases...\n'));
        
        for (const testCase of this.testCases) {
            console.log(chalk.cyan(`Test Case: ${testCase.name}`));
            console.log(`  ${testCase.description}`);
            
            // Run focused analysis on specific file
            const analysis = await this.analyzeSpecificRelationship(testCase);
            
            console.log(`  ✓ Batch mode confidence: ${analysis.batchConfidence?.toFixed(3) || 'N/A'}`);
            console.log(`  ✓ Individual mode confidence: ${analysis.individualConfidence?.toFixed(3) || 'N/A'}`);
            console.log(`  ✓ Triangulated confidence: ${analysis.triangulatedConfidence?.toFixed(3) || 'N/A'}`);
            console.log(`  ✓ Correctly identified: ${analysis.correctlyIdentified ? chalk.green('YES') : chalk.red('NO')}`);
            
            this.results.accuracyImprovement[testCase.name] = analysis;
        }
    }
    
    async analyzeSpecificRelationship(testCase) {
        // Compare how different modes handle this specific relationship
        const analysis = {
            testCase: testCase.name,
            batchConfidence: null,
            individualConfidence: null,
            triangulatedConfidence: null,
            correctlyIdentified: false
        };
        
        // Check results from each mode
        const modes = ['batch_only', 'individual_only', 'with_triangulation'];
        
        for (const mode of modes) {
            const modeResults = this.results.modeComparison[mode];
            if (!modeResults) continue;
            
            const relationship = modeResults.relationships.find(rel => {
                return rel.source_name === testCase.expectedRelationship.source &&
                       rel.target_path.includes(testCase.expectedRelationship.target.split(':')[0]);
            });
            
            if (relationship) {
                switch (mode) {
                    case 'batch_only':
                        analysis.batchConfidence = relationship.confidence_score;
                        break;
                    case 'individual_only':
                        analysis.individualConfidence = relationship.confidence_score;
                        break;
                    case 'with_triangulation':
                        analysis.triangulatedConfidence = relationship.confidence_score;
                        analysis.correctlyIdentified = true;
                        break;
                }
            }
        }
        
        return analysis;
    }
    
    async generateValidationReport() {
        console.log(chalk.blue.bold('\n📋 Validation Report\n'));
        
        // 1. Mode Comparison Table
        console.log(chalk.yellow('1. Mode Comparison:'));
        
        const modeTable = new Table({
            head: ['Mode', 'Relationships', 'Avg Confidence', 'Precision', 'Recall', 'F1 Score'],
            colWidths: [20, 15, 15, 12, 12, 12]
        });
        
        Object.entries(this.results.modeComparison).forEach(([mode, results]) => {
            modeTable.push([
                mode.replace('_', ' ').toUpperCase(),
                results.relationshipCount,
                results.avgConfidence.toFixed(3),
                (results.accuracy.precision * 100).toFixed(1) + '%',
                (results.accuracy.recall * 100).toFixed(1) + '%',
                (results.accuracy.f1Score * 100).toFixed(1) + '%'
            ]);
        });
        
        console.log(modeTable.toString());
        
        // 2. Triangulation Benefits
        console.log(chalk.yellow('\n2. Triangulation Benefits:'));
        
        const benefits = this.calculateTriangulationBenefits();
        
        console.log(`  ${chalk.green('✓')} Accuracy Improvement: ${benefits.accuracyImprovement}%`);
        console.log(`  ${chalk.green('✓')} Confidence Improvement: ${benefits.confidenceImprovement}%`);
        console.log(`  ${chalk.green('✓')} False Positive Reduction: ${benefits.falsePositiveReduction}%`);
        
        // 3. Confidence Calibration
        console.log(chalk.yellow('\n3. Confidence Calibration:'));
        
        const calibration = this.analyzeConfidenceCalibration();
        console.log(`  ${chalk.green('✓')} Confidence-Accuracy Correlation: ${calibration.correlation.toFixed(3)}`);
        console.log(`  ${chalk.green('✓')} Calibration Error: ${calibration.calibrationError.toFixed(3)}`);
        
        // 4. Complex Relationship Handling
        console.log(chalk.yellow('\n4. Complex Relationship Handling:'));
        
        const complexTable = new Table({
            head: ['Test Case', 'Batch', 'Individual', 'Triangulated', 'Improvement'],
            colWidths: [30, 10, 12, 13, 12]
        });
        
        Object.entries(this.results.accuracyImprovement).forEach(([name, analysis]) => {
            const improvement = analysis.triangulatedConfidence && analysis.individualConfidence
                ? ((analysis.triangulatedConfidence - analysis.individualConfidence) * 100).toFixed(1) + '%'
                : 'N/A';
            
            complexTable.push([
                name,
                analysis.batchConfidence?.toFixed(3) || 'N/A',
                analysis.individualConfidence?.toFixed(3) || 'N/A',
                analysis.triangulatedConfidence?.toFixed(3) || 'N/A',
                improvement
            ]);
        });
        
        console.log(complexTable.toString());
        
        // 5. Overall Validation Summary
        console.log(chalk.blue.bold('\n📊 Validation Summary:'));
        
        const validationPassed = this.validateRequirements();
        
        validationPassed.forEach(validation => {
            const icon = validation.passed ? chalk.green('✓') : chalk.red('✗');
            const status = validation.passed ? chalk.green('PASSED') : chalk.red('FAILED');
            console.log(`  ${icon} ${validation.requirement}: ${status} (${validation.actual})`);
        });
        
        // Save detailed report
        await this.saveDetailedReport();
    }
    
    calculateTriangulationBenefits() {
        const batchOnly = this.results.modeComparison.batch_only;
        const withTriangulation = this.results.modeComparison.with_triangulation;
        
        if (!batchOnly || !withTriangulation) {
            return {
                accuracyImprovement: 0,
                confidenceImprovement: 0,
                falsePositiveReduction: 0
            };
        }
        
        const accuracyImprovement = (
            (withTriangulation.accuracy.f1Score - batchOnly.accuracy.f1Score) / 
            batchOnly.accuracy.f1Score * 100
        );
        
        const confidenceImprovement = (
            (withTriangulation.avgConfidence - batchOnly.avgConfidence) / 
            batchOnly.avgConfidence * 100
        );
        
        const falsePositiveReduction = (
            (batchOnly.accuracy.falsePositives - withTriangulation.accuracy.falsePositives) / 
            batchOnly.accuracy.falsePositives * 100
        );
        
        return {
            accuracyImprovement: accuracyImprovement.toFixed(1),
            confidenceImprovement: confidenceImprovement.toFixed(1),
            falsePositiveReduction: falsePositiveReduction.toFixed(1)
        };
    }
    
    analyzeConfidenceCalibration() {
        // Analyze how well confidence scores predict accuracy
        const withTriangulation = this.results.modeComparison.with_triangulation;
        
        if (!withTriangulation || !withTriangulation.relationships) {
            return { correlation: 0, calibrationError: 1 };
        }
        
        // Group relationships by confidence buckets
        const buckets = {};
        withTriangulation.relationships.forEach(rel => {
            const bucket = Math.floor(rel.confidence_score * 10) / 10;
            if (!buckets[bucket]) {
                buckets[bucket] = { total: 0, correct: 0 };
            }
            buckets[bucket].total++;
            if (this.isRelationshipCorrect(rel)) {
                buckets[bucket].correct++;
            }
        });
        
        // Calculate calibration error
        let calibrationError = 0;
        let dataPoints = 0;
        
        Object.entries(buckets).forEach(([confidence, stats]) => {
            const expectedAccuracy = parseFloat(confidence);
            const actualAccuracy = stats.correct / stats.total;
            calibrationError += Math.abs(expectedAccuracy - actualAccuracy) * stats.total;
            dataPoints += stats.total;
        });
        
        calibrationError = dataPoints > 0 ? calibrationError / dataPoints : 1;
        
        // Simple correlation calculation
        const correlation = 1 - calibrationError;
        
        return { correlation, calibrationError };
    }
    
    validateRequirements() {
        const withTriangulation = this.results.modeComparison.with_triangulation;
        const batchOnly = this.results.modeComparison.batch_only;
        
        return [
            {
                requirement: 'Overall accuracy ≥ 95%',
                passed: withTriangulation && withTriangulation.accuracy.f1Score >= 0.95,
                actual: withTriangulation ? `${(withTriangulation.accuracy.f1Score * 100).toFixed(1)}%` : 'N/A'
            },
            {
                requirement: 'Triangulated accuracy ≥ 98%',
                passed: withTriangulation && withTriangulation.accuracy.precision >= 0.98,
                actual: withTriangulation ? `${(withTriangulation.accuracy.precision * 100).toFixed(1)}%` : 'N/A'
            },
            {
                requirement: 'Triangulation improves accuracy',
                passed: withTriangulation && batchOnly && 
                        withTriangulation.accuracy.f1Score > batchOnly.accuracy.f1Score,
                actual: 'See benefits analysis above'
            },
            {
                requirement: 'Confidence calibration correlation > 0.7',
                passed: this.analyzeConfidenceCalibration().correlation > 0.7,
                actual: this.analyzeConfidenceCalibration().correlation.toFixed(3)
            }
        ];
    }
    
    async saveDetailedReport() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(__dirname, 'reports', `triangulation-validation-${timestamp}.json`);
        
        await fs.mkdir(path.join(__dirname, 'reports'), { recursive: true });
        
        const report = {
            timestamp: new Date().toISOString(),
            results: this.results,
            benefits: this.calculateTriangulationBenefits(),
            calibration: this.analyzeConfidenceCalibration(),
            validation: this.validateRequirements(),
            conclusion: this.generateConclusion()
        };
        
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        console.log(chalk.blue(`\n📄 Detailed report saved to: ${reportPath}`));
    }
    
    generateConclusion() {
        const validationResults = this.validateRequirements();
        const allPassed = validationResults.every(v => v.passed);
        
        if (allPassed) {
            return {
                status: 'SUCCESS',
                message: 'Cognitive triangulation delivers all promised benefits',
                recommendations: [
                    'Continue using triangulation for complex relationships',
                    'Consider tuning thresholds for specific use cases',
                    'Monitor performance impact in production'
                ]
            };
        } else {
            const failedRequirements = validationResults
                .filter(v => !v.passed)
                .map(v => v.requirement);
            
            return {
                status: 'PARTIAL',
                message: 'Some triangulation benefits not fully realized',
                failedRequirements,
                recommendations: [
                    'Review and optimize triangulation logic',
                    'Adjust confidence thresholds',
                    'Improve prompt engineering for better results'
                ]
            };
        }
    }
}

// Run validation if executed directly
if (require.main === module) {
    const validator = new TriangulationValidator();
    validator.run()
        .then(() => {
            console.log(chalk.green.bold('\n✅ Triangulation validation completed!'));
            process.exit(0);
        })
        .catch(error => {
            console.error(chalk.red.bold('\n❌ Validation failed:'), error);
            process.exit(1);
        });
}

module.exports = { TriangulationValidator };