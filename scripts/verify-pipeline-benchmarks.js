#!/usr/bin/env node

const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import required modules
const { connectRedis } = require('../src/utils/redisConnection');
const { sqliteDbPath } = require('../src/utils/database');
const { connect: connectNeo4j, disconnect: disconnectNeo4j } = require('../src/utils/neo4jDriver');
const QueueManager = require('../src/services/QueueManager');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// Benchmark requirements
const BENCHMARKS = {
    minimum: { nodes: 300, relationships: 1600, ratio: 4.0 },
    expected: { nodes: 417, relationships: 1876, ratio: 4.5 },
    grading: {
        A: 0.95,  // 95%+
        B: 0.90,  // 90%+
        C: 0.85,  // 85%+
        D: 0.80,  // 80%+
        F: 0      // < 80%
    }
};

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 5000; // Check every 5 seconds

class PipelineBenchmarkVerifier {
    constructor() {
        this.startTime = null;
        this.results = {
            sqlite: { pois: 0, relationships: 0 },
            neo4j: { nodes: 0, relationships: 0 },
            queues: { waiting: 0, active: 0, completed: 0, failed: 0 },
            outbox: { pending: 0, published: 0, failed: 0 },
            errors: []
        };
    }

    async run() {
        console.log('🚀 Pipeline Benchmark Verification Starting...\n');
        
        try {
            // Step 1: Clear all databases
            await this.clearDatabases();
            
            // Step 2: Start the pipeline
            await this.startPipeline();
            
            // Step 3: Wait for completion
            await this.waitForCompletion();
            
            // Step 4: Collect results
            await this.collectResults();
            
            // Step 5: Calculate grade
            const grade = this.calculateGrade();
            
            // Step 6: Print comprehensive report
            this.printReport(grade);
            
            // Step 7: Cleanup
            await this.cleanup();
            
            // Exit with appropriate code
            process.exit(grade.passed ? 0 : 1);
            
        } catch (error) {
            console.error('❌ Verification failed:', error);
            this.results.errors.push(error.message);
            this.printReport({ grade: 'F', score: 0, passed: false });
            process.exit(1);
        }
    }

    async clearDatabases() {
        console.log('🧹 Clearing databases...');
        
        // Clear SQLite
        try {
            await fs.unlink(sqliteDbPath);
            console.log('  ✓ SQLite database cleared');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            console.log('  ✓ SQLite database already clear');
        }
        
        // Clear Redis
        const redis = await connectRedis();
        await redis.flushall();
        await redis.quit();
        console.log('  ✓ Redis cleared');
        
        // Clear Neo4j
        const neo4j = await connectNeo4j();
        const session = neo4j.session();
        try {
            await session.run('MATCH (n) DETACH DELETE n');
            console.log('  ✓ Neo4j cleared');
        } finally {
            await session.close();
        }
        
        console.log('');
    }

    async startPipeline() {
        console.log('🏁 Starting pipeline...');
        this.startTime = Date.now();
        
        // Start the pipeline as a child process
        this.pipelineProcess = exec('node src/main.js', {
            cwd: path.resolve(__dirname, '..'),
            env: { ...process.env, TARGET_DIR: 'polyglot-test' }
        });
        
        // Capture output
        this.pipelineProcess.stdout.on('data', (data) => {
            if (process.env.VERBOSE) {
                console.log(`[Pipeline] ${data}`);
            }
        });
        
        this.pipelineProcess.stderr.on('data', (data) => {
            console.error(`[Pipeline Error] ${data}`);
        });
        
        // Wait a bit for pipeline to initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('  ✓ Pipeline started\n');
    }

    async waitForCompletion() {
        console.log('⏳ Waiting for pipeline completion...');
        
        const checkInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            process.stdout.write(`\r  Time elapsed: ${Math.floor(elapsed / 1000)}s`);
        }, 1000);
        
        try {
            const completed = await this.pollForCompletion();
            clearInterval(checkInterval);
            
            if (completed) {
                const totalTime = (Date.now() - this.startTime) / 1000;
                console.log(`\n  ✓ Pipeline completed in ${totalTime.toFixed(1)}s\n`);
            } else {
                throw new Error('Pipeline timed out');
            }
        } catch (error) {
            clearInterval(checkInterval);
            throw error;
        }
    }

    async pollForCompletion() {
        const endTime = this.startTime + TIMEOUT_MS;
        
        while (Date.now() < endTime) {
            try {
                // Check queue status
                const queueManager = new QueueManager();
                const fileAnalysisQueue = queueManager.getQueue('fileAnalysis');
                const relationshipQueue = queueManager.getQueue('relationshipResolution');
                const graphQueue = queueManager.getQueue('graphBuilder');
                
                const [fileStats, relStats, graphStats] = await Promise.all([
                    fileAnalysisQueue.getJobCounts(),
                    relationshipQueue.getJobCounts(),
                    graphQueue.getJobCounts()
                ]);
                
                const totalWaiting = fileStats.waiting + relStats.waiting + graphStats.waiting;
                const totalActive = fileStats.active + relStats.active + graphStats.active;
                
                // Check outbox status
                const db = await open({
                    filename: sqliteDbPath,
                    driver: sqlite3.Database
                });
                
                const pendingOutbox = await db.get(
                    'SELECT COUNT(*) as count FROM agent_communication_outbox WHERE status = ?',
                    ['PENDING']
                );
                
                await db.close();
                
                // Pipeline is complete when all queues are empty and no pending outbox
                if (totalWaiting === 0 && totalActive === 0 && pendingOutbox.count === 0) {
                    await queueManager.closeConnections();
                    return true;
                }
                
                await queueManager.closeConnections();
            } catch (error) {
                // Ignore errors during polling
            }
            
            await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
        }
        
        return false;
    }

    async collectResults() {
        console.log('📊 Collecting results...');
        
        // Collect SQLite results
        const db = await open({
            filename: sqliteDbPath,
            driver: sqlite3.Database
        });
        
        try {
            // Count POIs
            const poiCount = await db.get('SELECT COUNT(*) as count FROM pois');
            this.results.sqlite.pois = poiCount.count;
            
            // Count relationships
            const relCount = await db.get('SELECT COUNT(*) as count FROM relationships');
            this.results.sqlite.relationships = relCount.count;
            
            // Check outbox status
            const outboxStats = await db.all(`
                SELECT status, COUNT(*) as count 
                FROM agent_communication_outbox 
                GROUP BY status
            `);
            
            outboxStats.forEach(stat => {
                if (stat.status === 'PENDING') this.results.outbox.pending = stat.count;
                else if (stat.status === 'PUBLISHED') this.results.outbox.published = stat.count;
                else if (stat.status === 'FAILED') this.results.outbox.failed = stat.count;
            });
            
        } finally {
            await db.close();
        }
        
        // Collect Neo4j results
        const neo4j = await connectNeo4j();
        const session = neo4j.session();
        
        try {
            // Count nodes
            const nodeResult = await session.run('MATCH (n) RETURN COUNT(n) as count');
            this.results.neo4j.nodes = nodeResult.records[0].get('count').toNumber();
            
            // Count relationships
            const relResult = await session.run('MATCH ()-[r]->() RETURN COUNT(r) as count');
            this.results.neo4j.relationships = relResult.records[0].get('count').toNumber();
            
        } finally {
            await session.close();
        }
        
        // Collect queue results
        const queueManager = new QueueManager();
        const queues = ['fileAnalysis', 'relationshipResolution', 'graphBuilder'];
        
        for (const queueName of queues) {
            const queue = queueManager.getQueue(queueName);
            const counts = await queue.getJobCounts();
            this.results.queues.waiting += counts.waiting;
            this.results.queues.active += counts.active;
            this.results.queues.completed += counts.completed;
            this.results.queues.failed += counts.failed;
        }
        
        await queueManager.closeConnections();
        
        console.log('  ✓ Results collected\n');
    }

    calculateGrade() {
        const nodes = this.results.neo4j.nodes;
        const relationships = this.results.neo4j.relationships;
        const ratio = nodes > 0 ? relationships / nodes : 0;
        
        // Calculate score based on expected values
        const nodeScore = Math.min(nodes / BENCHMARKS.expected.nodes, 1);
        const relScore = Math.min(relationships / BENCHMARKS.expected.relationships, 1);
        const ratioScore = Math.min(ratio / BENCHMARKS.expected.ratio, 1);
        
        // Overall score (weighted average)
        const overallScore = (nodeScore * 0.3 + relScore * 0.5 + ratioScore * 0.2);
        
        // Determine grade
        let grade = 'F';
        for (const [letterGrade, threshold] of Object.entries(BENCHMARKS.grading)) {
            if (overallScore >= threshold) {
                grade = letterGrade;
                break;
            }
        }
        
        // Check if minimum requirements are met
        const meetsMinimum = (
            nodes >= BENCHMARKS.minimum.nodes &&
            relationships >= BENCHMARKS.minimum.relationships &&
            ratio >= BENCHMARKS.minimum.ratio
        );
        
        return {
            grade,
            score: overallScore,
            nodeScore,
            relScore,
            ratioScore,
            ratio,
            meetsMinimum,
            passed: meetsMinimum && grade !== 'F'
        };
    }

    printReport(gradeInfo) {
        console.log('📋 PIPELINE BENCHMARK VERIFICATION REPORT');
        console.log('=' .repeat(60));
        
        // Runtime info
        const totalTime = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
        console.log(`\n⏱️  Total Runtime: ${totalTime.toFixed(1)}s`);
        
        // Database Results
        console.log('\n📊 DATABASE RESULTS:');
        console.log('  SQLite:');
        console.log(`    - POIs: ${this.results.sqlite.pois}`);
        console.log(`    - Relationships: ${this.results.sqlite.relationships}`);
        console.log('  Neo4j:');
        console.log(`    - Nodes: ${this.results.neo4j.nodes}`);
        console.log(`    - Relationships: ${this.results.neo4j.relationships}`);
        console.log(`    - Ratio: ${gradeInfo.ratio ? gradeInfo.ratio.toFixed(2) : '0.00'}`);
        
        // Queue Status
        console.log('\n📦 QUEUE STATUS:');
        console.log(`  - Waiting: ${this.results.queues.waiting}`);
        console.log(`  - Active: ${this.results.queues.active}`);
        console.log(`  - Completed: ${this.results.queues.completed}`);
        console.log(`  - Failed: ${this.results.queues.failed}`);
        
        // Outbox Status
        console.log('\n📮 OUTBOX STATUS:');
        console.log(`  - Pending: ${this.results.outbox.pending}`);
        console.log(`  - Published: ${this.results.outbox.published}`);
        console.log(`  - Failed: ${this.results.outbox.failed}`);
        
        // Benchmark Comparison
        console.log('\n📏 BENCHMARK COMPARISON:');
        console.log('  Metric         | Actual | Expected | Minimum | Score');
        console.log('  ' + '-'.repeat(55));
        console.log(`  Nodes          | ${String(this.results.neo4j.nodes).padEnd(6)} | ${String(BENCHMARKS.expected.nodes).padEnd(8)} | ${String(BENCHMARKS.minimum.nodes).padEnd(7)} | ${(gradeInfo.nodeScore * 100).toFixed(0)}%`);
        console.log(`  Relationships  | ${String(this.results.neo4j.relationships).padEnd(6)} | ${String(BENCHMARKS.expected.relationships).padEnd(8)} | ${String(BENCHMARKS.minimum.relationships).padEnd(7)} | ${(gradeInfo.relScore * 100).toFixed(0)}%`);
        console.log(`  Ratio          | ${gradeInfo.ratio ? gradeInfo.ratio.toFixed(2).padEnd(6) : '0.00'.padEnd(6)} | ${BENCHMARKS.expected.ratio.toFixed(2).padEnd(8)} | ${BENCHMARKS.minimum.ratio.toFixed(2).padEnd(7)} | ${(gradeInfo.ratioScore * 100).toFixed(0)}%`);
        
        // Grade
        console.log('\n🎯 FINAL GRADE:');
        console.log(`  Grade: ${gradeInfo.grade}`);
        console.log(`  Overall Score: ${(gradeInfo.score * 100).toFixed(1)}%`);
        console.log(`  Meets Minimum Requirements: ${gradeInfo.meetsMinimum ? '✅ YES' : '❌ NO'}`);
        
        // Errors
        if (this.results.errors.length > 0) {
            console.log('\n❌ ERRORS:');
            this.results.errors.forEach(error => {
                console.log(`  - ${error}`);
            });
        }
        
        // Final Status
        console.log('\n' + '=' .repeat(60));
        if (gradeInfo.passed) {
            console.log('✅ PIPELINE VERIFICATION PASSED!');
        } else {
            console.log('❌ PIPELINE VERIFICATION FAILED!');
        }
        console.log('=' .repeat(60));
    }

    async cleanup() {
        // Terminate pipeline process if still running
        if (this.pipelineProcess && !this.pipelineProcess.killed) {
            this.pipelineProcess.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!this.pipelineProcess.killed) {
                this.pipelineProcess.kill('SIGKILL');
            }
        }
        
        // Disconnect from Neo4j
        await disconnectNeo4j();
    }
}

// Run the verifier
if (require.main === module) {
    const verifier = new PipelineBenchmarkVerifier();
    verifier.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = PipelineBenchmarkVerifier;