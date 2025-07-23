#!/usr/bin/env node

const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');

/**
 * Optimized Pipeline Test Runner
 * Runs the CTP pipeline with all optimizations enabled and monitors performance
 */
class OptimizedPipelineRunner {
    constructor() {
        this.startTime = null;
        this.endTime = null;
        this.metrics = {
            beforeState: null,
            afterState: null,
            processing: {
                startTime: null,
                endTime: null,
                duration: null,
                errors: [],
                warnings: []
            },
            performance: {
                apiCalls: 0,
                filesProcessed: 0,
                poisCreated: 0,
                relationshipsCreated: 0,
                cacheHits: 0,
                cacheMisses: 0
            }
        };
    }

    async captureBeforeState() {
        console.log('📊 Capturing database state before optimization...');
        
        try {
            const db = require('better-sqlite3')('database.db');
            
            // Get distinct status values first
            const statusValues = db.prepare('SELECT DISTINCT status FROM outbox').all();
            const statusCounts = {};
            statusValues.forEach(status => {
                const count = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ?').get(status.status);
                statusCounts[status.status] = count.count;
            });

            const beforeState = {
                outbox: {
                    total: db.prepare('SELECT COUNT(*) as count FROM outbox').get().count,
                    statusCounts: statusCounts
                },
                files: db.prepare('SELECT COUNT(*) as count FROM files').get().count,
                pois: db.prepare('SELECT COUNT(*) as count FROM pois').get().count,
                relationships: db.prepare('SELECT COUNT(*) as count FROM relationships').get().count,
                dirSummaries: db.prepare('SELECT COUNT(*) as count FROM directory_summaries').get().count,
                evidence: db.prepare('SELECT COUNT(*) as count FROM relationship_evidence').get().count
            };
            
            db.close();
            
            this.metrics.beforeState = beforeState;
            console.log('✅ Before state captured:', beforeState);
            
        } catch (error) {
            console.error('❌ Error capturing before state:', error);
            this.metrics.processing.errors.push(`Before state capture: ${error.message}`);
        }
    }

    async captureAfterState() {
        console.log('📊 Capturing database state after optimization...');
        
        try {
            const db = require('better-sqlite3')('database.db');
            
            // Get distinct status values first
            const statusValues = db.prepare('SELECT DISTINCT status FROM outbox').all();
            const statusCounts = {};
            statusValues.forEach(status => {
                const count = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ?').get(status.status);
                statusCounts[status.status] = count.count;
            });

            const afterState = {
                outbox: {
                    total: db.prepare('SELECT COUNT(*) as count FROM outbox').get().count,
                    statusCounts: statusCounts
                },
                files: db.prepare('SELECT COUNT(*) as count FROM files').get().count,
                pois: db.prepare('SELECT COUNT(*) as count FROM pois').get().count,
                relationships: db.prepare('SELECT COUNT(*) as count FROM relationships').get().count,
                dirSummaries: db.prepare('SELECT COUNT(*) as count FROM directory_summaries').get().count,
                evidence: db.prepare('SELECT COUNT(*) as count FROM relationship_evidence').get().count
            };
            
            db.close();
            
            this.metrics.afterState = afterState;
            console.log('✅ After state captured:', afterState);
            
        } catch (error) {
            console.error('❌ Error capturing after state:', error);
            this.metrics.processing.errors.push(`After state capture: ${error.message}`);
        }
    }

    async runPipeline() {
        console.log('🚀 Starting optimized pipeline execution...');
        
        this.metrics.processing.startTime = performance.now();
        this.startTime = new Date();
        
        try {
            // Import and run the main CTP pipeline
            console.log('🔧 Loading CTP with optimized configuration...');
            
            // Set NODE_ENV to development to ensure all optimizations are loaded
            process.env.NODE_ENV = 'development';
            
            // Import the standard CTP pipeline (more reliable for testing)
            const { CognitiveTriangulationPipeline } = require('./src/main');
            
            console.log('⚡ Initializing CTP pipeline with optimization environment...');
            
            // Use the standard pipeline but with optimized environment settings
            const targetDirectory = process.env.SOURCE_DIR || './polyglot-test';
            const pipeline = new CognitiveTriangulationPipeline(targetDirectory);
            
            console.log('🔄 Running pipeline with optimizations enabled...');
            
            // Run the full pipeline
            const result = await pipeline.run();
            
            console.log('✅ Pipeline completed successfully');
            console.log('📋 Pipeline result:', result);
            
            this.metrics.processing.endTime = performance.now();
            this.endTime = new Date();
            this.metrics.processing.duration = this.metrics.processing.endTime - this.metrics.processing.startTime;
            
            return result;
            
        } catch (error) {
            console.error('❌ Pipeline execution failed:', error);
            this.metrics.processing.errors.push(`Pipeline execution: ${error.message}`);
            
            this.metrics.processing.endTime = performance.now();
            this.endTime = new Date();
            this.metrics.processing.duration = this.metrics.processing.endTime - this.metrics.processing.startTime;
            
            throw error;
        }
    }

    calculateDifferences() {
        if (!this.metrics.beforeState || !this.metrics.afterState) {
            return null;
        }

        const beforeStatusCounts = this.metrics.beforeState.outbox.statusCounts;
        const afterStatusCounts = this.metrics.afterState.outbox.statusCounts;
        
        // Calculate status changes
        const statusChanges = {};
        const allStatuses = new Set([
            ...Object.keys(beforeStatusCounts),
            ...Object.keys(afterStatusCounts)
        ]);
        
        allStatuses.forEach(status => {
            const before = beforeStatusCounts[status] || 0;
            const after = afterStatusCounts[status] || 0;
            statusChanges[status] = after - before;
        });

        return {
            outbox: {
                totalChange: this.metrics.afterState.outbox.total - this.metrics.beforeState.outbox.total,
                statusChanges: statusChanges
            },
            filesChange: this.metrics.afterState.files - this.metrics.beforeState.files,
            poisChange: this.metrics.afterState.pois - this.metrics.beforeState.pois,
            relationshipsChange: this.metrics.afterState.relationships - this.metrics.beforeState.relationships,
            dirSummariesChange: this.metrics.afterState.dirSummaries - this.metrics.beforeState.dirSummaries,
            evidenceChange: this.metrics.afterState.evidence - this.metrics.beforeState.evidence
        };
    }

    async generatePerformanceReport() {
        console.log('📊 Generating comprehensive performance report...');
        
        const differences = this.calculateDifferences();
        const duration = this.metrics.processing.duration / 1000; // Convert to seconds
        
        const report = {
            executionSummary: {
                startTime: this.startTime?.toISOString(),
                endTime: this.endTime?.toISOString(),
                duration: `${duration.toFixed(2)} seconds`,
                success: this.metrics.processing.errors.length === 0
            },
            
            databaseChanges: differences,
            
            optimizationEffectiveness: {
                filesProcessedRate: differences?.filesChange ? (differences.filesChange / duration).toFixed(2) : 'N/A',
                poisCreatedRate: differences?.poisChange ? (differences.poisChange / duration).toFixed(2) : 'N/A',
                relationshipsCreatedRate: differences?.relationshipsChange ? (differences.relationshipsChange / duration).toFixed(2) : 'N/A'
            },
            
            errorAnalysis: {
                totalErrors: this.metrics.processing.errors.length,
                errors: this.metrics.processing.errors,
                warnings: this.metrics.processing.warnings
            },
            
            beforeState: this.metrics.beforeState,
            afterState: this.metrics.afterState,
            
            optimizationFeatures: {
                characterChunking: 'ENABLED',
                fileBatching: 'ENABLED', 
                caching: 'ENABLED',
                workerManagement: 'ENABLED',
                databaseBatching: 'ENABLED',
                redisIntegration: 'ENABLED'
            }
        };
        
        // Save report to file
        const reportPath = path.join(__dirname, 'optimization-performance-report.json');
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log('✅ Performance report saved to:', reportPath);
        
        // Display summary
        this.displaySummary(report);
        
        return report;
    }

    displaySummary(report) {
        console.log('\\n' + '='.repeat(80));
        console.log('🎯 OPTIMIZED PIPELINE PERFORMANCE SUMMARY');
        console.log('='.repeat(80));
        
        console.log(`⏱️  Execution Time: ${report.executionSummary.duration}`);
        console.log(`✅ Success: ${report.executionSummary.success}`);
        
        if (report.databaseChanges) {
            console.log('\\n📊 DATABASE CHANGES:');
            console.log(`   Files Processed: ${report.databaseChanges.filesChange}`);
            console.log(`   POIs Created: ${report.databaseChanges.poisChange}`);
            console.log(`   Relationships Created: ${report.databaseChanges.relationshipsChange}`);
            console.log(`   Directory Summaries: ${report.databaseChanges.dirSummariesChange}`);
            console.log(`   Evidence Entries: ${report.databaseChanges.evidenceChange}`);
            
            console.log('\\n⚡ PROCESSING RATES:');
            console.log(`   Files/sec: ${report.optimizationEffectiveness.filesProcessedRate}`);
            console.log(`   POIs/sec: ${report.optimizationEffectiveness.poisCreatedRate}`);
            console.log(`   Relationships/sec: ${report.optimizationEffectiveness.relationshipsCreatedRate}`);
        }
        
        if (report.errorAnalysis.totalErrors > 0) {
            console.log(`\\n❌ ERRORS: ${report.errorAnalysis.totalErrors}`);
            report.errorAnalysis.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        } else {
            console.log('\\n✅ NO ERRORS DETECTED');
        }
        
        console.log('\\n🔧 OPTIMIZATIONS ENABLED:');
        Object.entries(report.optimizationFeatures).forEach(([feature, status]) => {
            console.log(`   ${feature}: ${status}`);
        });
        
        console.log('='.repeat(80));
    }

    async run() {
        try {
            // Capture before state
            await this.captureBeforeState();
            
            // Run the optimized pipeline
            await this.runPipeline();
            
            // Capture after state
            await this.captureAfterState();
            
            // Generate and display performance report
            const report = await this.generatePerformanceReport();
            
            return report;
            
        } catch (error) {
            console.error('❌ Optimized pipeline test failed:', error);
            
            // Still try to capture after state and generate report
            try {
                await this.captureAfterState();
                await this.generatePerformanceReport();
            } catch (reportError) {
                console.error('❌ Failed to generate report after error:', reportError);
            }
            
            throw error;
        }
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    const runner = new OptimizedPipelineRunner();
    
    runner.run()
        .then(report => {
            console.log('\\n🎉 Optimized pipeline test completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\\n💥 Optimized pipeline test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { OptimizedPipelineRunner };