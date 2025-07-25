#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const { performance } = require('perf_hooks');
const { CognitiveTriangulationPipeline } = require('../../src/main');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const neo4jDriver = require('../../src/utils/neo4jDriver');
const Table = require('cli-table3');
const chalk = require('chalk');

class PerformanceBenchmark {
    constructor() {
        this.results = [];
        this.testConfigurations = [
            {
                name: 'Batch Mode Only',
                config: {
                    batchAnalysisThreshold: 0.0,
                    individualAnalysisThreshold: 1.1,
                    humanEscalationThreshold: 0.0,
                    workerConcurrency: { fileAnalysis: 4 }
                }
            },
            {
                name: 'Mixed Mode (Default)',
                config: {
                    batchAnalysisThreshold: 0.8,
                    individualAnalysisThreshold: 0.6,
                    humanEscalationThreshold: 0.4,
                    workerConcurrency: { fileAnalysis: 4 }
                }
            },
            {
                name: 'High Accuracy Mode',
                config: {
                    batchAnalysisThreshold: 0.9,
                    individualAnalysisThreshold: 0.7,
                    humanEscalationThreshold: 0.5,
                    workerConcurrency: { fileAnalysis: 2 }
                }
            },
            {
                name: 'High Concurrency',
                config: {
                    batchAnalysisThreshold: 0.8,
                    individualAnalysisThreshold: 0.6,
                    humanEscalationThreshold: 0.4,
                    workerConcurrency: { fileAnalysis: 8 }
                }
            }
        ];
    }
    
    async run() {
        console.log(chalk.blue.bold('\n🚀 Starting Performance Benchmark Suite\n'));
        
        // Ensure clean state
        await this.cleanup();
        
        // Load ground truth for accuracy comparison
        const groundTruthPath = path.join(__dirname, 'ground-truth', 'polyglot-relationships.json');
        this.groundTruth = JSON.parse(await fs.readFile(groundTruthPath, 'utf8'));
        
        // Run benchmarks for each configuration
        for (const testConfig of this.testConfigurations) {
            console.log(chalk.yellow(`\n📊 Running benchmark: ${testConfig.name}`));
            await this.runBenchmark(testConfig);
        }
        
        // Display results
        await this.displayResults();
        await this.saveResults();
    }
    
    async runBenchmark(testConfig) {
        const startTime = performance.now();
        const startMemory = process.memoryUsage();
        
        // Create temporary database
        const dbPath = path.join(__dirname, 'temp', `benchmark_${Date.now()}.db`);
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        
        // Configure pipeline
        const pipelineConfig = PipelineConfig.createDefault();
        Object.assign(pipelineConfig.confidence, {
            batchAnalysisThreshold: testConfig.config.batchAnalysisThreshold,
            individualAnalysisThreshold: testConfig.config.individualAnalysisThreshold,
            humanEscalationThreshold: testConfig.config.humanEscalationThreshold
        });
        
        if (testConfig.config.workerConcurrency) {
            Object.assign(pipelineConfig.workerConcurrency, testConfig.config.workerConcurrency);
        }
        
        pipelineConfig.database.sqlite.path = dbPath;
        pipelineConfig.environment = 'benchmark';
        
        // Initialize and run pipeline
        const pipeline = new CognitiveTriangulationPipeline(
            path.join(process.cwd(), 'polyglot-test'),
            dbPath,
            { pipelineConfig }
        );
        
        // Monitor memory during execution
        const memorySnapshots = [];
        const memoryInterval = setInterval(() => {
            memorySnapshots.push(process.memoryUsage());
        }, 1000);
        
        try {
            // Run pipeline
            const pipelineResults = await pipeline.run();
            
            clearInterval(memoryInterval);
            
            const endTime = performance.now();
            const endMemory = process.memoryUsage();
            
            // Calculate metrics
            const duration = endTime - startTime;
            const peakMemory = Math.max(...memorySnapshots.map(m => m.heapUsed));
            const avgMemory = memorySnapshots.reduce((sum, m) => sum + m.heapUsed, 0) / memorySnapshots.length;
            
            // Get accuracy metrics
            const accuracy = await this.calculateAccuracy(dbPath, pipelineResults.runId);
            
            // Get processing statistics
            const stats = await this.getProcessingStats(dbPath, pipelineResults.runId);
            
            // Store results
            this.results.push({
                name: testConfig.name,
                config: testConfig.config,
                duration: duration / 1000, // Convert to seconds
                throughput: {
                    filesPerSecond: stats.fileCount / (duration / 1000),
                    relationshipsPerSecond: stats.relationshipCount / (duration / 1000)
                },
                memory: {
                    peak: peakMemory / 1024 / 1024, // Convert to MB
                    average: avgMemory / 1024 / 1024,
                    growth: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024
                },
                accuracy: accuracy,
                stats: stats,
                success: pipelineResults.success
            });
            
            await pipeline.shutdown();
            
        } catch (error) {
            console.error(chalk.red(`Benchmark failed: ${error.message}`));
            this.results.push({
                name: testConfig.name,
                config: testConfig.config,
                error: error.message,
                success: false
            });
        } finally {
            clearInterval(memoryInterval);
            
            // Cleanup
            try {
                await fs.unlink(dbPath);
            } catch (err) {
                // Ignore cleanup errors
            }
        }
    }
    
    async calculateAccuracy(dbPath, runId) {
        const dbManager = new DatabaseManager(dbPath);
        
        try {
            // Get detected relationships
            const relationships = await dbManager.db.all(`
                SELECT 
                    cr.relationship_type,
                    cr.confidence_score,
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
            
            // Simple accuracy calculation
            const detectedSet = new Set(
                relationships.map(r => 
                    `${r.source_path}:${r.source_name}->${r.target_path}:${r.target_name}`
                )
            );
            
            const groundTruthSet = new Set(
                this.groundTruth.relationships.map(r => {
                    const source = r.source.toLowerCase().replace(/\\/g, '/');
                    const target = r.target.toLowerCase().replace(/\\/g, '/');
                    return `${source}->${target}`;
                })
            );
            
            let matches = 0;
            detectedSet.forEach(detected => {
                groundTruthSet.forEach(truth => {
                    if (this.fuzzyMatch(detected, truth)) {
                        matches++;
                    }
                });
            });
            
            const precision = matches / detectedSet.size || 0;
            const recall = matches / groundTruthSet.size || 0;
            const f1 = 2 * (precision * recall) / (precision + recall) || 0;
            
            return {
                precision,
                recall,
                f1Score: f1,
                detectedCount: detectedSet.size,
                groundTruthCount: groundTruthSet.size,
                matches
            };
            
        } finally {
            await dbManager.close();
        }
    }
    
    fuzzyMatch(detected, truth) {
        // Simple fuzzy matching for benchmark purposes
        const detectedLower = detected.toLowerCase();
        const truthLower = truth.toLowerCase();
        
        // Check if main components match
        const detectedParts = detectedLower.split('->');
        const truthParts = truthLower.split('->');
        
        if (detectedParts.length !== 2 || truthParts.length !== 2) return false;
        
        // Check if source and target contain key parts
        return (
            detectedParts[0].includes(truthParts[0].split(':').pop()) ||
            truthParts[0].includes(detectedParts[0].split(':').pop())
        ) && (
            detectedParts[1].includes(truthParts[1].split(':').pop()) ||
            truthParts[1].includes(detectedParts[1].split(':').pop())
        );
    }
    
    async getProcessingStats(dbPath, runId) {
        const dbManager = new DatabaseManager(dbPath);
        
        try {
            const stats = await dbManager.db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM code_files WHERE run_id = ?) as fileCount,
                    (SELECT COUNT(*) FROM points_of_interest WHERE run_id = ?) as poiCount,
                    (SELECT COUNT(*) FROM code_relationships WHERE run_id = ?) as relationshipCount,
                    (SELECT COUNT(*) FROM analysis_results WHERE run_id = ?) as analysisCount
            `, [runId, runId, runId, runId]);
            
            const modeDistribution = await dbManager.db.all(`
                SELECT 
                    am.mode_type,
                    COUNT(*) as count
                FROM analysis_results ar
                JOIN analysis_modes am ON ar.analysis_mode_id = am.id
                WHERE ar.run_id = ?
                GROUP BY am.mode_type
            `, [runId]);
            
            stats.modeDistribution = modeDistribution.reduce((acc, m) => {
                acc[m.mode_type] = m.count;
                return acc;
            }, {});
            
            return stats;
            
        } finally {
            await dbManager.close();
        }
    }
    
    async displayResults() {
        console.log(chalk.blue.bold('\n📈 Benchmark Results Summary\n'));
        
        // Performance comparison table
        const perfTable = new Table({
            head: ['Configuration', 'Duration (s)', 'Files/sec', 'Relations/sec', 'Peak Mem (MB)', 'F1 Score'],
            colWidths: [20, 15, 12, 15, 15, 12]
        });
        
        this.results.forEach(result => {
            if (result.success !== false) {
                perfTable.push([
                    result.name,
                    result.duration.toFixed(2),
                    result.throughput.filesPerSecond.toFixed(2),
                    result.throughput.relationshipsPerSecond.toFixed(2),
                    result.memory.peak.toFixed(2),
                    (result.accuracy.f1Score * 100).toFixed(2) + '%'
                ]);
            }
        });
        
        console.log(perfTable.toString());
        
        // Find best configuration
        const successfulResults = this.results.filter(r => r.success !== false);
        
        if (successfulResults.length > 0) {
            const fastest = successfulResults.reduce((prev, curr) => 
                curr.duration < prev.duration ? curr : prev
            );
            
            const mostAccurate = successfulResults.reduce((prev, curr) => 
                curr.accuracy.f1Score > prev.accuracy.f1Score ? curr : prev
            );
            
            const mostEfficient = successfulResults.reduce((prev, curr) => {
                const prevScore = prev.accuracy.f1Score / prev.duration;
                const currScore = curr.accuracy.f1Score / curr.duration;
                return currScore > prevScore ? curr : prev;
            });
            
            console.log(chalk.green.bold('\n🏆 Best Configurations:'));
            console.log(`  Fastest: ${fastest.name} (${fastest.duration.toFixed(2)}s)`);
            console.log(`  Most Accurate: ${mostAccurate.name} (F1: ${(mostAccurate.accuracy.f1Score * 100).toFixed(2)}%)`);
            console.log(`  Most Efficient: ${mostEfficient.name}`);
        }
        
        // Mode distribution analysis
        console.log(chalk.yellow.bold('\n📊 Analysis Mode Distribution:'));
        
        const modeTable = new Table({
            head: ['Configuration', 'Batch', 'Individual', 'Triangulated'],
            colWidths: [20, 15, 15, 15]
        });
        
        successfulResults.forEach(result => {
            const modes = result.stats.modeDistribution;
            modeTable.push([
                result.name,
                modes.batch || 0,
                modes.individual || 0,
                modes.triangulated || 0
            ]);
        });
        
        console.log(modeTable.toString());
    }
    
    async saveResults() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(__dirname, 'reports', `benchmark-${timestamp}.json`);
        
        await fs.mkdir(path.join(__dirname, 'reports'), { recursive: true });
        
        const report = {
            timestamp: new Date().toISOString(),
            results: this.results,
            summary: this.generateSummary(),
            environment: {
                node: process.version,
                platform: process.platform,
                arch: process.arch,
                cpus: require('os').cpus().length,
                totalMemory: require('os').totalmem() / 1024 / 1024 / 1024 // GB
            }
        };
        
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        console.log(chalk.blue(`\n📄 Detailed report saved to: ${reportPath}`));
    }
    
    generateSummary() {
        const successful = this.results.filter(r => r.success !== false);
        
        if (successful.length === 0) {
            return { error: 'No successful benchmarks' };
        }
        
        return {
            averageMetrics: {
                duration: successful.reduce((sum, r) => sum + r.duration, 0) / successful.length,
                f1Score: successful.reduce((sum, r) => sum + r.accuracy.f1Score, 0) / successful.length,
                peakMemory: successful.reduce((sum, r) => sum + r.memory.peak, 0) / successful.length
            },
            recommendations: this.generateRecommendations(successful)
        };
    }
    
    generateRecommendations(results) {
        const recommendations = [];
        
        // Find optimal configuration based on requirements
        const balancedScores = results.map(r => ({
            name: r.name,
            score: (r.accuracy.f1Score * 0.5) + ((1 / r.duration) * 100 * 0.3) + ((1 / r.memory.peak) * 1000 * 0.2)
        }));
        
        const optimal = balancedScores.reduce((prev, curr) => 
            curr.score > prev.score ? curr : prev
        );
        
        recommendations.push({
            type: 'configuration',
            priority: 'high',
            message: `Recommended configuration: ${optimal.name} (balanced score: ${optimal.score.toFixed(2)})`
        });
        
        // Memory optimization
        const highMemoryConfigs = results.filter(r => r.memory.peak > 1500);
        if (highMemoryConfigs.length > 0) {
            recommendations.push({
                type: 'memory',
                priority: 'medium',
                message: 'Consider reducing worker concurrency to lower memory usage'
            });
        }
        
        // Accuracy improvements
        const lowAccuracyConfigs = results.filter(r => r.accuracy.f1Score < 0.9);
        if (lowAccuracyConfigs.length > 0) {
            recommendations.push({
                type: 'accuracy',
                priority: 'high',
                message: 'Some configurations have accuracy below 90%. Consider adjusting confidence thresholds.'
            });
        }
        
        return recommendations;
    }
    
    async cleanup() {
        // Clean up any leftover test data
        const session = neo4jDriver.session();
        try {
            await session.run('MATCH (n:TestNode) DETACH DELETE n');
            await session.run('MATCH (n:Entity) WHERE n.runId STARTS WITH "benchmark_" DETACH DELETE n');
        } finally {
            await session.close();
        }
    }
}

// Run benchmark if executed directly
if (require.main === module) {
    const benchmark = new PerformanceBenchmark();
    benchmark.run()
        .then(() => {
            console.log(chalk.green.bold('\n✅ Benchmark completed successfully!'));
            process.exit(0);
        })
        .catch(error => {
            console.error(chalk.red.bold('\n❌ Benchmark failed:'), error);
            process.exit(1);
        });
}

module.exports = { PerformanceBenchmark };