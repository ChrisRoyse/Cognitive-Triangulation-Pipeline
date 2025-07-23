#!/usr/bin/env node

/**
 * Pipeline Validation Monitor
 * 
 * Monitors the complete pipeline execution for the polyglot-test validation.
 * Tracks queue status, database growth, and generates real-time metrics.
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class PipelineValidationMonitor {
    constructor() {
        this.startTime = Date.now();
        this.monitoringInterval = null;
        this.pipelineProcess = null;
        this.metrics = {
            startTime: new Date().toISOString(),
            endTime: null,
            duration: null,
            queueSnapshots: [],
            databaseGrowth: [],
            errors: [],
            finalState: null
        };
        this.dbPath = './data/database.db';
        this.validationResults = {
            success: false,
            timeoutOccurred: false,
            benchmarksMet: false,
            errorRate: 0,
            finalCounts: {}
        };
    }

    async startValidation() {
        console.log('\n🚀 Starting Complete Pipeline Validation');
        console.log('=====================================');
        console.log(`Target: polyglot-test directory (20 files)`);
        console.log(`Timeout: 10 minutes (600 seconds)`);
        console.log(`Start Time: ${this.metrics.startTime}`);
        console.log('=====================================\n');

        // Start monitoring
        this.startMonitoring();

        // Start the pipeline with timeout
        return new Promise((resolve, reject) => {
            const env = { ...process.env };
            
            // Load environment variables from .env file
            if (fs.existsSync('.env')) {
                const envContent = fs.readFileSync('.env', 'utf8');
                envContent.split('\n').forEach(line => {
                    if (line.trim() && !line.startsWith('#')) {
                        const [key, value] = line.split('=');
                        if (key && value) {
                            env[key.trim()] = value.trim();
                        }
                    }
                });
            }

            console.log('🔧 Starting pipeline with optimizations enabled...');
            
            // Use timeout command to limit execution time
            const timeoutCmd = process.platform === 'win32' ? 
                `timeout /t 600 /nobreak && taskkill /f /pid` : 
                'timeout 600';
            
            this.pipelineProcess = spawn('node', ['src/main.js', '--target', './polyglot-test'], {
                env,
                stdio: ['inherit', 'pipe', 'pipe'],
                timeout: 600000 // 10 minutes
            });

            let outputBuffer = '';
            let errorBuffer = '';

            this.pipelineProcess.stdout.on('data', (data) => {
                const output = data.toString();
                outputBuffer += output;
                process.stdout.write(output);
                
                // Check for completion indicators
                if (output.includes('Pipeline completed') || output.includes('Processing complete')) {
                    console.log('\n✅ Pipeline completion detected');
                }
            });

            this.pipelineProcess.stderr.on('data', (data) => {
                const error = data.toString();
                errorBuffer += error;
                process.stderr.write(error);
                this.metrics.errors.push({
                    timestamp: new Date().toISOString(),
                    error: error.trim()
                });
            });

            this.pipelineProcess.on('close', (code) => {
                this.stopMonitoring();
                this.metrics.endTime = new Date().toISOString();
                this.metrics.duration = Date.now() - this.startTime;
                
                console.log(`\n📊 Pipeline process ended with code: ${code}`);
                console.log(`⏱️  Total execution time: ${(this.metrics.duration / 1000).toFixed(2)} seconds`);
                
                if (code === 0) {
                    console.log('✅ Pipeline completed successfully');
                    this.validationResults.success = true;
                } else {
                    console.log('❌ Pipeline completed with errors');
                    this.validationResults.success = false;
                }
                
                resolve(code);
            });

            this.pipelineProcess.on('error', (error) => {
                this.stopMonitoring();
                console.error('💥 Pipeline process error:', error);
                this.metrics.errors.push({
                    timestamp: new Date().toISOString(),
                    error: error.message
                });
                reject(error);
            });

            // Handle timeout
            setTimeout(() => {
                if (this.pipelineProcess && !this.pipelineProcess.killed) {
                    console.log('\n⏰ TIMEOUT: Killing pipeline process after 10 minutes');
                    this.validationResults.timeoutOccurred = true;
                    this.pipelineProcess.kill('SIGTERM');
                    
                    setTimeout(() => {
                        if (!this.pipelineProcess.killed) {
                            this.pipelineProcess.kill('SIGKILL');
                        }
                    }, 5000);
                }
            }, 600000); // 10 minutes
        });
    }

    startMonitoring() {
        console.log('📈 Starting real-time monitoring...\n');
        
        this.monitoringInterval = setInterval(() => {
            this.captureMetrics();
        }, 30000); // Every 30 seconds
        
        // Initial capture
        setTimeout(() => this.captureMetrics(), 5000); // First capture after 5 seconds
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        // Final capture
        this.captureMetrics();
    }

    async captureMetrics() {
        const timestamp = new Date().toISOString();
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
        
        try {
            // Check if database exists
            const dbExists = fs.existsSync(this.dbPath);
            let dbMetrics = {
                exists: dbExists,
                files: 0,
                pois: 0,
                relationships: 0,
                directory_summaries: 0
            };

            if (dbExists) {
                try {
                    const db = new Database(this.dbPath, { readonly: true });
                    
                    // Get table counts
                    const tables = ['files', 'pois', 'relationships', 'directory_summaries'];
                    for (const table of tables) {
                        try {
                            const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
                            dbMetrics[table] = result.count;
                        } catch (e) {
                            // Table might not exist yet
                            dbMetrics[table] = 0;
                        }
                    }
                    
                    db.close();
                } catch (dbError) {
                    console.log(`⚠️  Database read error: ${dbError.message}`);
                }
            }

            // Get Redis queue info (if available)
            let queueMetrics = { available: false };
            try {
                await new Promise((resolve, reject) => {
                    exec('docker exec ctp-redis redis-cli INFO stats | grep -E "(instantaneous_ops_per_sec|keyspace_hits|keyspace_misses)"', 
                        (error, stdout, stderr) => {
                            if (!error && stdout) {
                                const lines = stdout.trim().split('\n');
                                queueMetrics = {
                                    available: true,
                                    redis_info: lines.join(', ')
                                };
                            }
                            resolve();
                        });
                });
            } catch (e) {
                // Redis info not available
            }

            const snapshot = {
                timestamp,
                elapsed_seconds: parseInt(elapsed),
                database: dbMetrics,
                queue: queueMetrics
            };

            this.metrics.queueSnapshots.push(snapshot);
            this.metrics.databaseGrowth.push({
                timestamp,
                elapsed_seconds: parseInt(elapsed),
                ...dbMetrics
            });

            // Console output
            console.log(`[${elapsed}s] 📊 Files: ${dbMetrics.files}, POIs: ${dbMetrics.pois}, Relationships: ${dbMetrics.relationships}, Dirs: ${dbMetrics.directory_summaries}`);
            
            if (dbMetrics.files > 0) {
                const processingRate = (dbMetrics.files / (elapsed / 60)).toFixed(1);
                console.log(`[${elapsed}s] 🔄 Processing rate: ${processingRate} files/min`);
            }

        } catch (error) {
            console.error(`❌ Metrics capture error: ${error.message}`);
            this.metrics.errors.push({
                timestamp,
                error: `Metrics capture failed: ${error.message}`
            });
        }
    }

    async validateResults() {
        console.log('\n🔍 Validating Pipeline Results');
        console.log('==============================');

        // Final database state
        if (fs.existsSync(this.dbPath)) {
            try {
                const db = new Database(this.dbPath, { readonly: true });
                
                const finalCounts = {};
                const tables = ['files', 'pois', 'relationships', 'directory_summaries', 'relationship_evidence', 'outbox'];
                
                for (const table of tables) {
                    try {
                        const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
                        finalCounts[table] = result.count;
                    } catch (e) {
                        finalCounts[table] = 0;
                    }
                }

                // Get file success/failure counts
                try {
                    const completedFiles = db.prepare(`SELECT COUNT(*) as count FROM files WHERE status = 'completed'`).get();
                    const failedFiles = db.prepare(`SELECT COUNT(*) as count FROM files WHERE status = 'failed'`).get();
                    const totalFiles = db.prepare(`SELECT COUNT(*) as count FROM files`).get();
                    
                    finalCounts.completed_files = completedFiles.count;
                    finalCounts.failed_files = failedFiles.count;
                    finalCounts.total_files = totalFiles.count;
                    
                    this.validationResults.errorRate = totalFiles.count > 0 ? 
                        (failedFiles.count / totalFiles.count) * 100 : 0;
                } catch (e) {
                    console.log('⚠️  Could not get file status counts');
                }

                this.validationResults.finalCounts = finalCounts;
                this.metrics.finalState = finalCounts;
                
                db.close();

                // Print results
                console.log('\n📈 Final Database State:');
                console.log(`  Files: ${finalCounts.files || 0} (${finalCounts.completed_files || 0} completed, ${finalCounts.failed_files || 0} failed)`);
                console.log(`  POIs: ${finalCounts.pois || 0}`);
                console.log(`  Relationships: ${finalCounts.relationships || 0}`);
                console.log(`  Directory Summaries: ${finalCounts.directory_summaries || 0}`);
                console.log(`  Relationship Evidence: ${finalCounts.relationship_evidence || 0}`);
                console.log(`  Outbox Events: ${finalCounts.outbox || 0}`);

                // Check benchmarks
                const benchmarks = {
                    files: { min: 15, target: 20 },
                    pois: { min: 300, target: 417 },
                    relationships: { min: 500, target: 870 },
                    completed_files: { min: 15, target: 18 }
                };

                let benchmarksPassed = 0;
                let totalBenchmarks = 0;

                console.log('\n🎯 Benchmark Validation:');
                for (const [key, benchmark] of Object.entries(benchmarks)) {
                    const actual = finalCounts[key] || 0;
                    const passed = actual >= benchmark.min;
                    const status = passed ? '✅' : '❌';
                    const percentage = benchmark.target > 0 ? ((actual / benchmark.target) * 100).toFixed(1) : '0.0';
                    
                    console.log(`  ${status} ${key}: ${actual} (min: ${benchmark.min}, target: ${benchmark.target}) - ${percentage}%`);
                    
                    if (passed) benchmarksPassed++;
                    totalBenchmarks++;
                }

                this.validationResults.benchmarksMet = benchmarksPassed >= totalBenchmarks * 0.8; // 80% pass rate

                console.log(`\n📊 Benchmark Score: ${benchmarksPassed}/${totalBenchmarks} (${((benchmarksPassed/totalBenchmarks)*100).toFixed(1)}%)`);
                console.log(`🚫 Error Rate: ${this.validationResults.errorRate.toFixed(1)}%`);

            } catch (error) {
                console.error(`❌ Database validation error: ${error.message}`);
                this.validationResults.success = false;
            }
        } else {
            console.log('❌ Database file not found - pipeline may not have started');
            this.validationResults.success = false;
        }
    }

    generateReport() {
        const duration = this.metrics.duration || (Date.now() - this.startTime);
        const durationMinutes = (duration / 60000).toFixed(2);
        
        const report = {
            validation_timestamp: new Date().toISOString(),
            pipeline_validation: {
                success: this.validationResults.success,
                timeout_occurred: this.validationResults.timeoutOccurred,
                benchmarks_met: this.validationResults.benchmarksMet,
                duration_ms: duration,
                duration_minutes: parseFloat(durationMinutes),
                error_rate_percent: this.validationResults.errorRate
            },
            execution_metrics: {
                start_time: this.metrics.startTime,
                end_time: this.metrics.endTime,
                total_snapshots: this.metrics.queueSnapshots.length,
                errors_encountered: this.metrics.errors.length
            },
            final_database_state: this.metrics.finalState,
            success_criteria: {
                completed_within_timeout: !this.validationResults.timeoutOccurred,
                minimum_files_processed: (this.validationResults.finalCounts.completed_files || 0) >= 15,
                minimum_pois_extracted: (this.validationResults.finalCounts.pois || 0) >= 300,
                minimum_relationships_found: (this.validationResults.finalCounts.relationships || 0) >= 500,
                error_rate_acceptable: this.validationResults.errorRate <= 5.0
            },
            monitoring_data: {
                queue_snapshots: this.metrics.queueSnapshots,
                database_growth: this.metrics.databaseGrowth,
                errors: this.metrics.errors
            }
        };

        // Overall validation result
        const criteria = report.success_criteria;
        const passedCriteria = Object.values(criteria).filter(Boolean).length;
        const totalCriteria = Object.values(criteria).length;
        
        report.overall_validation = {
            passed: passedCriteria >= totalCriteria * 0.8, // 80% pass rate required
            criteria_passed: passedCriteria,
            criteria_total: totalCriteria,
            pass_percentage: ((passedCriteria / totalCriteria) * 100).toFixed(1)
        };

        return report;
    }

    async saveReport(report) {
        const reportPath = './pipeline-validation-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Validation report saved to: ${reportPath}`);
        
        // Also save a summary
        const summaryPath = './pipeline-validation-summary.txt';
        const summary = this.generateTextSummary(report);
        fs.writeFileSync(summaryPath, summary);
        console.log(`📄 Validation summary saved to: ${summaryPath}`);
    }

    generateTextSummary(report) {
        const duration = report.pipeline_validation.duration_minutes;
        const success = report.overall_validation.passed;
        const passRate = report.overall_validation.pass_percentage;
        
        return `
PIPELINE VALIDATION SUMMARY
===========================

Validation Result: ${success ? '✅ PASSED' : '❌ FAILED'}
Overall Score: ${passRate}% (${report.overall_validation.criteria_passed}/${report.overall_validation.criteria_total} criteria)

Execution Details:
- Duration: ${duration} minutes
- Timeout Occurred: ${report.pipeline_validation.timeout_occurred ? 'YES' : 'NO'}
- Error Rate: ${report.pipeline_validation.error_rate_percent.toFixed(1)}%

Final Database State:
- Files Processed: ${report.final_database_state?.completed_files || 0}/${report.final_database_state?.files || 0}
- POIs Extracted: ${report.final_database_state?.pois || 0}
- Relationships Found: ${report.final_database_state?.relationships || 0}
- Directory Summaries: ${report.final_database_state?.directory_summaries || 0}

Success Criteria Results:
${Object.entries(report.success_criteria).map(([key, passed]) => 
    `- ${key}: ${passed ? '✅ PASSED' : '❌ FAILED'}`
).join('\n')}

Benchmark Validation: ${report.pipeline_validation.benchmarks_met ? '✅ PASSED' : '❌ FAILED'}

Errors Encountered: ${report.execution_metrics.errors_encountered}

Generated: ${report.validation_timestamp}
`;
    }
}

// Main execution
if (require.main === module) {
    const monitor = new PipelineValidationMonitor();
    
    monitor.startValidation()
        .then(async (exitCode) => {
            console.log('\n🔍 Running post-execution validation...');
            await monitor.validateResults();
            
            const report = monitor.generateReport();
            await monitor.saveReport(report);
            
            console.log('\n' + '='.repeat(50));
            console.log('VALIDATION COMPLETE');
            console.log('='.repeat(50));
            
            if (report.overall_validation.passed) {
                console.log('🎉 VALIDATION PASSED - Pipeline working correctly!');
                process.exit(0);
            } else {
                console.log('💥 VALIDATION FAILED - Pipeline needs attention');
                process.exit(1);
            }
        })
        .catch((error) => {
            console.error('💥 Validation process failed:', error);
            process.exit(1);
        });
}

module.exports = PipelineValidationMonitor;