const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const PipelineMonitor = require('./src/utils/pipelineMonitor');

class RealisticPipelineTest {
    constructor() {
        this.testStartTime = Date.now();
        this.results = {
            phase1: null,
            phase2: null,
            phase3: null,
            summary: null
        };
        this.dbPath = path.join(__dirname, 'codebase_analysis.db');
    }

    async clearDatabase() {
        try {
            await fs.unlink(this.dbPath);
            console.log('🗑️  Database cleared for fresh test');
        } catch (err) {
            // Database doesn't exist, that's fine
        }
    }

    async runPipelineTest(target, timeoutMinutes, phaseName) {
        console.log(`\n🚀 Starting ${phaseName}: ${target}`);
        console.log(`⏱️  Timeout: ${timeoutMinutes} minutes`);
        console.log(`${'='.repeat(60)}\n`);

        const startTime = Date.now();
        const timeoutMs = timeoutMinutes * 60 * 1000;

        // Start monitoring in background
        const monitor = new PipelineMonitor(this.dbPath);
        const monitorPromise = monitor.monitor(30); // Check every 30 seconds

        return new Promise((resolve) => {
            const pipelineProcess = spawn('node', ['src/main.js', '--target', target], {
                cwd: __dirname,
                stdio: 'pipe',
                env: { ...process.env, NODE_ENV: 'production' }
            });

            let stdout = '';
            let stderr = '';

            pipelineProcess.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                process.stdout.write(output); // Live output
            });

            pipelineProcess.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                process.stderr.write(output); // Live output
            });

            // Set timeout
            const timeout = setTimeout(() => {
                console.log(`\n⏰ ${phaseName} timed out after ${timeoutMinutes} minutes`);
                pipelineProcess.kill('SIGTERM');
            }, timeoutMs);

            pipelineProcess.on('close', async (code) => {
                clearTimeout(timeout);
                clearInterval(monitor.interval); // Stop monitoring
                
                const endTime = Date.now();
                const duration = Math.floor((endTime - startTime) / 1000);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;

                // Get final stats
                const finalStats = await monitor.getStats();

                const result = {
                    phase: phaseName,
                    target,
                    exitCode: code,
                    duration: `${minutes}m ${seconds}s`,
                    durationSeconds: duration,
                    timeoutMinutes,
                    timedOut: code === null,
                    finalStats,
                    stdout: stdout.split('\n').slice(-20), // Last 20 lines
                    stderr: stderr.split('\n').slice(-20)
                };

                console.log(`\n📊 ${phaseName} Results:`);
                console.log(`├─ Exit Code: ${code}`);
                console.log(`├─ Duration: ${result.duration}`);
                console.log(`├─ Files Processed: ${finalStats.files}`);
                console.log(`├─ POIs Discovered: ${finalStats.pois}`);
                console.log(`├─ Relationships: ${finalStats.relationships}`);
                
                if (Object.keys(finalStats.queues).length > 0) {
                    console.log(`└─ Queue Summary:`);
                    Object.entries(finalStats.queues).forEach(([queue, counts]) => {
                        const total = counts.pending + counts.active + counts.completed + counts.failed;
                        const successRate = total > 0 ? ((counts.completed / total) * 100).toFixed(1) : 0;
                        console.log(`   ├─ ${queue}: ${counts.completed}/${total} (${successRate}%)`);
                    });
                }

                resolve(result);
            });
        });
    }

    async calculatePerformanceMetrics(results) {
        const allResults = [results.phase1, results.phase2, results.phase3].filter(r => r);
        
        const metrics = {
            totalFilesProcessed: 0,
            totalPoisDiscovered: 0,
            totalRelationships: 0,
            averageProcessingRate: 0,
            successRate: 0,
            phases: []
        };

        for (const result of allResults) {
            if (!result) continue;

            const { finalStats, durationSeconds } = result;
            metrics.totalFilesProcessed += finalStats.files;
            metrics.totalPoisDiscovered += finalStats.pois;
            metrics.totalRelationships += finalStats.relationships;

            // Calculate rates (per minute)
            const filesPerMinute = durationSeconds > 0 ? (finalStats.files / (durationSeconds / 60)).toFixed(2) : 0;
            const poisPerMinute = durationSeconds > 0 ? (finalStats.pois / (durationSeconds / 60)).toFixed(2) : 0;

            // Calculate success rate from queues
            let totalJobs = 0, completedJobs = 0;
            Object.values(finalStats.queues).forEach(counts => {
                totalJobs += counts.pending + counts.active + counts.completed + counts.failed;
                completedJobs += counts.completed;
            });
            const phaseSuccessRate = totalJobs > 0 ? ((completedJobs / totalJobs) * 100).toFixed(1) : 0;

            metrics.phases.push({
                phase: result.phase,
                filesPerMinute: parseFloat(filesPerMinute),
                poisPerMinute: parseFloat(poisPerMinute),
                successRate: parseFloat(phaseSuccessRate),
                completed: !result.timedOut && result.exitCode === 0
            });
        }

        // Calculate overall averages
        const validPhases = metrics.phases.filter(p => p.completed);
        if (validPhases.length > 0) {
            metrics.averageProcessingRate = (validPhases.reduce((sum, p) => sum + p.filesPerMinute, 0) / validPhases.length).toFixed(2);
            metrics.successRate = (validPhases.reduce((sum, p) => sum + p.successRate, 0) / validPhases.length).toFixed(1);
        }

        return metrics;
    }

    async generateReport() {
        const metrics = await this.calculatePerformanceMetrics(this.results);
        const totalTestTime = Math.floor((Date.now() - this.testStartTime) / 1000 / 60);

        const report = {
            testSummary: {
                timestamp: new Date().toISOString(),
                totalTestDuration: `${totalTestTime} minutes`,
                testProtocol: 'Realistic Timeout Pipeline Test',
                phases: this.results
            },
            performanceMetrics: metrics,
            conclusions: this.analyzeResults(metrics),
            recommendations: this.generateRecommendations(metrics)
        };

        // Save detailed report
        const reportPath = path.join(__dirname, 'test-results', `realistic-pipeline-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

        return report;
    }

    analyzeResults(metrics) {
        const conclusions = [];

        // Performance Analysis
        if (metrics.averageProcessingRate > 1.5) {
            conclusions.push("✅ Good performance: Processing rate exceeds 1.5 files/minute");
        } else if (metrics.averageProcessingRate > 0.5) {
            conclusions.push("⚠️ Moderate performance: Processing rate between 0.5-1.5 files/minute");
        } else {
            conclusions.push("❌ Poor performance: Processing rate below 0.5 files/minute");
        }

        // Success Rate Analysis
        if (metrics.successRate > 80) {
            conclusions.push("✅ High reliability: Success rate above 80%");
        } else if (metrics.successRate > 60) {
            conclusions.push("⚠️ Moderate reliability: Success rate between 60-80%");
        } else {
            conclusions.push("❌ Low reliability: Success rate below 60%");
        }

        // Scalability Analysis
        const completedPhases = metrics.phases.filter(p => p.completed).length;
        if (completedPhases >= 2) {
            conclusions.push("✅ Scalability demonstrated: Multiple test phases completed successfully");
        } else if (completedPhases === 1) {
            conclusions.push("⚠️ Limited scalability validation: Only one phase completed");
        } else {
            conclusions.push("❌ Scalability concerns: No phases completed successfully within timeout");
        }

        return conclusions;
    }

    generateRecommendations(metrics) {
        const recommendations = [];

        if (metrics.averageProcessingRate < 1.0) {
            recommendations.push("Consider increasing worker pool size or optimizing LLM response times");
        }

        if (metrics.successRate < 80) {
            recommendations.push("Investigate job failures and improve error handling/retry logic");
        }

        const anyPhaseTimedOut = Object.values(this.results).some(r => r && r.timedOut);
        if (anyPhaseTimedOut) {
            recommendations.push("Consider extending timeouts for production workloads or optimizing bottlenecks");
        }

        if (metrics.totalFilesProcessed === 0) {
            recommendations.push("Critical: Pipeline appears to be failing at initialization - check logs immediately");
        }

        return recommendations;
    }

    async run() {
        console.log('🧪 Realistic Pipeline Test Suite Starting');
        console.log('📋 Protocol: Progressive testing with realistic timeouts\n');

        try {
            // Phase 1: Small test (JS files only - 4 files)
            await this.clearDatabase();
            this.results.phase1 = await this.runPipelineTest('./polyglot-test/js', 15, 'Phase 1: Small Test (JS)');

            // Phase 2: Medium test (Java files - 5 files) 
            if (this.results.phase1.finalStats.files >= 3) {
                await this.clearDatabase();
                this.results.phase2 = await this.runPipelineTest('./polyglot-test/java', 20, 'Phase 2: Medium Test (Java)');
            } else {
                console.log('⏭️  Skipping Phase 2: Phase 1 processed fewer than 3 files');
            }

            // Phase 3: Full test (All files - ~12 files)
            if (this.results.phase2 && this.results.phase2.finalStats.files >= 4) {
                await this.clearDatabase();
                this.results.phase3 = await this.runPipelineTest('./polyglot-test', 60, 'Phase 3: Full Test (All Languages)');
            } else {
                console.log('⏭️  Skipping Phase 3: Phase 2 did not process enough files');
            }

            // Generate comprehensive report
            const report = await this.generateReport();

            // Display summary
            console.log('\n' + '='.repeat(80));
            console.log('📊 REALISTIC PIPELINE TEST RESULTS');
            console.log('='.repeat(80));

            console.log('\n📈 Performance Metrics:');
            console.log(`├─ Total Files Processed: ${report.performanceMetrics.totalFilesProcessed}`);
            console.log(`├─ Total POIs Discovered: ${report.performanceMetrics.totalPoisDiscovered}`);
            console.log(`├─ Total Relationships: ${report.performanceMetrics.totalRelationships}`);
            console.log(`├─ Average Processing Rate: ${report.performanceMetrics.averageProcessingRate} files/minute`);
            console.log(`└─ Overall Success Rate: ${report.performanceMetrics.successRate}%`);

            console.log('\n🔍 Analysis:');
            report.conclusions.forEach(conclusion => console.log(`  ${conclusion}`));

            console.log('\n💡 Recommendations:');
            if (report.recommendations.length > 0) {
                report.recommendations.forEach(rec => console.log(`  • ${rec}`));
            } else {
                console.log('  ✅ No recommendations - pipeline performance is satisfactory');
            }

            console.log('\n' + '='.repeat(80));
            console.log(`📄 Detailed report saved to: ${path.relative(__dirname, reportPath)}`);
            console.log('='.repeat(80));

            return report;

        } catch (error) {
            console.error('❌ Test suite failed:', error);
            throw error;
        }
    }
}

// Run if executed directly
if (require.main === module) {
    const tester = new RealisticPipelineTest();
    tester.run()
        .then(() => {
            console.log('\n✅ Test suite completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = RealisticPipelineTest;