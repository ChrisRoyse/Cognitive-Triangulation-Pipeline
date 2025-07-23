#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

/**
 * Performance Benchmark Script
 * Compares the original pipeline vs optimized pipeline
 */

class PerformanceBenchmark {
    constructor() {
        this.results = {
            original: null,
            optimized: null,
            improvement: null
        };
        this.testDirectory = process.argv[2] || path.join(__dirname, '..', 'sample_project');
    }

    async setup() {
        console.log(chalk.blue('🔧 Setting up benchmark environment...'));
        
        // Ensure test directory exists
        try {
            await fs.access(this.testDirectory);
            console.log(chalk.green(`✓ Using test directory: ${this.testDirectory}`));
        } catch (error) {
            console.error(chalk.red(`✗ Test directory not found: ${this.testDirectory}`));
            process.exit(1);
        }

        // Check Redis
        try {
            execSync('redis-cli ping', { stdio: 'pipe' });
            console.log(chalk.green('✓ Redis is running'));
        } catch (error) {
            console.error(chalk.red('✗ Redis is not running. Please start Redis first.'));
            process.exit(1);
        }

        // Check Neo4j
        try {
            const neo4jStatus = execSync('cypher-shell -u neo4j -p password "RETURN 1"', { 
                stdio: 'pipe',
                encoding: 'utf8'
            });
            console.log(chalk.green('✓ Neo4j is running'));
        } catch (error) {
            console.error(chalk.red('✗ Neo4j is not running or credentials are incorrect.'));
            console.log(chalk.yellow('  Ensure Neo4j is running with user: neo4j, password: password'));
        }
    }

    async runBenchmark(pipelineScript, label) {
        console.log(chalk.blue(`\n📊 Running ${label} benchmark...`));
        
        const startTime = Date.now();
        const startMemory = process.memoryUsage();
        
        try {
            // Run the pipeline
            const output = execSync(`node ${pipelineScript} "${this.testDirectory}"`, {
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });
            
            const endTime = Date.now();
            const endMemory = process.memoryUsage();
            const duration = endTime - startTime;
            
            // Parse output for metrics
            const metrics = this.parseOutput(output);
            
            const result = {
                label,
                duration: duration / 1000, // seconds
                memory: {
                    heapUsed: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024, // MB
                    external: (endMemory.external - startMemory.external) / 1024 / 1024, // MB
                    rss: (endMemory.rss - startMemory.rss) / 1024 / 1024 // MB
                },
                metrics,
                success: true
            };
            
            console.log(chalk.green(`✓ ${label} completed in ${result.duration.toFixed(2)}s`));
            return result;
            
        } catch (error) {
            console.error(chalk.red(`✗ ${label} failed:`), error.message);
            return {
                label,
                success: false,
                error: error.message
            };
        }
    }

    parseOutput(output) {
        const metrics = {
            filesProcessed: 0,
            poisFound: 0,
            relationshipsFound: 0,
            llmCalls: 0
        };

        // Extract metrics from output using regex
        const patterns = {
            filesProcessed: /Files Processed:\s*(\d+)/i,
            poisFound: /POIs?\s*(?:found|discovered):\s*(\d+)/i,
            relationshipsFound: /Relationships?\s*(?:found|discovered):\s*(\d+)/i,
            llmCalls: /LLM\s*(?:calls|queries):\s*(\d+)/i,
            filesPerSecond: /(\d+\.?\d*)\s*files\/second/i
        };

        for (const [key, pattern] of Object.entries(patterns)) {
            const match = output.match(pattern);
            if (match) {
                metrics[key] = key === 'filesPerSecond' ? parseFloat(match[1]) : parseInt(match[1]);
            }
        }

        return metrics;
    }

    async cleanupBetweenRuns() {
        console.log(chalk.gray('🧹 Cleaning up between runs...'));
        
        try {
            // Clear Redis cache
            execSync('redis-cli FLUSHDB', { stdio: 'pipe' });
            
            // Clear Neo4j data
            execSync('cypher-shell -u neo4j -p password "MATCH (n) DETACH DELETE n"', { 
                stdio: 'pipe' 
            });
            
            // Delete SQLite database
            const dbPath = path.join(__dirname, '..', 'data', 'pipeline.db');
            try {
                await fs.unlink(dbPath);
            } catch (error) {
                // Database might not exist, that's okay
            }
            
            // Wait a bit for everything to settle
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.warn(chalk.yellow('⚠️  Cleanup warning:'), error.message);
        }
    }

    calculateImprovement() {
        if (!this.results.original || !this.results.optimized) {
            return null;
        }

        const orig = this.results.original;
        const opt = this.results.optimized;

        this.results.improvement = {
            duration: {
                absolute: orig.duration - opt.duration,
                percentage: ((orig.duration - opt.duration) / orig.duration * 100).toFixed(2)
            },
            memory: {
                absolute: orig.memory.heapUsed - opt.memory.heapUsed,
                percentage: ((orig.memory.heapUsed - opt.memory.heapUsed) / orig.memory.heapUsed * 100).toFixed(2)
            },
            filesPerSecond: {
                original: orig.metrics.filesPerSecond || (orig.metrics.filesProcessed / orig.duration),
                optimized: opt.metrics.filesPerSecond || (opt.metrics.filesProcessed / opt.duration)
            }
        };

        this.results.improvement.speedup = (orig.duration / opt.duration).toFixed(2);
    }

    async generateReport() {
        console.log(chalk.blue('\n📈 PERFORMANCE BENCHMARK REPORT'));
        console.log('=' .repeat(60));

        if (this.results.original && this.results.original.success) {
            console.log(chalk.yellow('\n🔶 Original Pipeline:'));
            console.log(`  Duration: ${this.results.original.duration.toFixed(2)}s`);
            console.log(`  Memory (Heap): ${this.results.original.memory.heapUsed.toFixed(2)} MB`);
            console.log(`  Files Processed: ${this.results.original.metrics.filesProcessed}`);
            console.log(`  Relationships Found: ${this.results.original.metrics.relationshipsFound}`);
        }

        if (this.results.optimized && this.results.optimized.success) {
            console.log(chalk.green('\n🚀 Optimized Pipeline:'));
            console.log(`  Duration: ${this.results.optimized.duration.toFixed(2)}s`);
            console.log(`  Memory (Heap): ${this.results.optimized.memory.heapUsed.toFixed(2)} MB`);
            console.log(`  Files Processed: ${this.results.optimized.metrics.filesProcessed}`);
            console.log(`  Relationships Found: ${this.results.optimized.metrics.relationshipsFound}`);
        }

        if (this.results.improvement) {
            console.log(chalk.cyan('\n📊 Performance Improvement:'));
            console.log(`  Speed Improvement: ${this.results.improvement.speedup}x faster`);
            console.log(`  Time Saved: ${this.results.improvement.duration.absolute.toFixed(2)}s (${this.results.improvement.duration.percentage}%)`);
            console.log(`  Memory Saved: ${this.results.improvement.memory.absolute.toFixed(2)} MB (${this.results.improvement.memory.percentage}%)`);
            console.log(`  Throughput:`);
            console.log(`    Original: ${this.results.improvement.filesPerSecond.original.toFixed(2)} files/second`);
            console.log(`    Optimized: ${this.results.improvement.filesPerSecond.optimized.toFixed(2)} files/second`);
        }

        console.log('\n' + '=' .repeat(60));

        // Save detailed report to file
        const reportPath = path.join(__dirname, '..', 'benchmark_report.json');
        await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));
        console.log(chalk.gray(`\n📄 Detailed report saved to: ${reportPath}`));
    }

    async run() {
        try {
            await this.setup();

            // Run original pipeline
            await this.cleanupBetweenRuns();
            this.results.original = await this.runBenchmark(
                path.join(__dirname, '..', 'src', 'main.js'),
                'Original Pipeline'
            );

            // Run optimized pipeline
            await this.cleanupBetweenRuns();
            this.results.optimized = await this.runBenchmark(
                path.join(__dirname, '..', 'src', 'main_optimized.js'),
                'Optimized Pipeline'
            );

            // Calculate improvements
            this.calculateImprovement();

            // Generate report
            await this.generateReport();

            // Exit with appropriate code
            const allSuccess = this.results.original?.success && this.results.optimized?.success;
            process.exit(allSuccess ? 0 : 1);

        } catch (error) {
            console.error(chalk.red('\n❌ Benchmark failed:'), error);
            process.exit(1);
        }
    }
}

// Run benchmark
if (require.main === module) {
    const benchmark = new PerformanceBenchmark();
    benchmark.run();
}

module.exports = PerformanceBenchmark;