#!/usr/bin/env node

/**
 * Performance Benchmark Verification
 * 
 * This script runs before/after benchmarks to measure the actual performance
 * improvements achieved by the optimization fixes.
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./src/config');
const GraphBuilder = require('./src/agents/GraphBuilder_optimized');

// Import optimized components if they exist
let OptimizedDataValidator;
try {
    OptimizedDataValidator = require('./src/utils/OptimizedDataValidator');
} catch (e) {
    console.log('⚠️  OptimizedDataValidator not found, using standard validation');
}

class PerformanceBenchmark {
    constructor() {
        this.dbPath = config.SQLITE_DB_PATH;
        this.results = {
            timestamp: new Date().toISOString(),
            baseline: {},
            optimized: {},
            improvements: {},
            test_datasets: [100, 500, 1000, 5000]
        };
    }

    async run() {
        console.log('🏁 Starting Performance Benchmark Verification...\n');

        try {
            // Setup test environment
            await this.setupTestEnvironment();
            
            // Run baseline benchmarks
            console.log('📊 Running baseline performance tests...');
            this.results.baseline = await this.runBaselineBenchmarks();
            
            // Run optimized benchmarks
            console.log('\n⚡ Running optimized performance tests...');
            this.results.optimized = await this.runOptimizedBenchmarks();
            
            // Calculate improvements
            this.calculateImprovements();
            
            // Generate report
            this.generateBenchmarkReport();
            
        } catch (error) {
            console.error('❌ Benchmark verification failed:', error);
            throw error;
        }
    }

    async setupTestEnvironment() {
        console.log('🔧 Setting up test environment...');
        
        // Ensure database exists
        if (!fs.existsSync(this.dbPath)) {
            const dataDir = require('path').dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
        }
        
        const db = new Database(this.dbPath);
        
        try {
            // Initialize schema if needed
            const tableCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get().count;
            if (tableCount === 0) {
                console.log('  📋 Initializing database schema...');
                const schema = fs.readFileSync('./src/utils/schema.sql', 'utf8');
                db.exec(schema);
            }
            
            // Clear existing test data
            db.exec("DELETE FROM relationships WHERE run_id = 'benchmark_test'");
            db.exec("DELETE FROM pois WHERE run_id = 'benchmark_test'");
            db.exec("DELETE FROM files WHERE file_path LIKE '/benchmark/%'");
            
            console.log('  ✅ Test environment ready');
        } finally {
            db.close();
        }
    }

    async runBaselineBenchmarks() {
        console.log('  🔍 Testing baseline validation performance...');
        
        const results = {};
        const db = new Database(this.dbPath);
        
        try {
            const graphBuilder = new GraphBuilder(db, null, 'test');
            
            for (const size of this.results.test_datasets) {
                console.log(`    📊 Testing ${size} records...`);
                
                // Setup test data
                await this.createTestData(db, size, 'baseline');
                
                // Measure validation time
                const startTime = process.hrtime.bigint();
                const validationResult = await graphBuilder.validateDataIntegrity();
                const endTime = process.hrtime.bigint();
                
                const validationTimeMs = Number(endTime - startTime) / 1000000;
                
                // Measure memory usage
                const memoryBefore = process.memoryUsage();
                const stmt = db.prepare(`
                    SELECT COUNT(*) as count
                    FROM relationships r
                    LEFT JOIN pois sp ON r.source_poi_id = sp.id
                    LEFT JOIN pois tp ON r.target_poi_id = tp.id
                    WHERE r.run_id = 'baseline_${size}'
                `);
                stmt.all();
                const memoryAfter = process.memoryUsage();
                
                results[`${size}_records`] = {
                    validation_time_ms: validationTimeMs,
                    memory_delta_mb: (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024,
                    is_valid: validationResult.isValid,
                    errors_count: validationResult.errors.length
                };
                
                console.log(`      ⏱️  ${validationTimeMs.toFixed(2)}ms validation`);
            }
            
        } finally {
            db.close();
        }
        
        return results;
    }

    async runOptimizedBenchmarks() {
        if (!OptimizedDataValidator) {
            console.log('  ⚠️  Optimized validator not available, skipping optimized tests');
            return {};
        }
        
        console.log('  🚀 Testing optimized validation performance...');
        
        const results = {};
        const db = new Database(this.dbPath);
        
        try {
            const optimizedValidator = new OptimizedDataValidator(db, {
                cacheSize: 10000,
                enableStreaming: false,
                batchSize: 5000
            });
            
            for (const size of this.results.test_datasets) {
                console.log(`    📊 Testing ${size} records (optimized)...`);
                
                // Setup test data
                await this.createTestData(db, size, 'optimized');
                
                // Measure validation time
                const startTime = process.hrtime.bigint();
                const validationResult = await optimizedValidator.validateDataIntegrity();
                const endTime = process.hrtime.bigint();
                
                const validationTimeMs = Number(endTime - startTime) / 1000000;
                
                // Measure memory usage
                const memoryBefore = process.memoryUsage();
                const stmt = db.prepare(`
                    SELECT COUNT(*) as count
                    FROM relationships r
                    LEFT JOIN pois sp ON r.source_poi_id = sp.id
                    LEFT JOIN pois tp ON r.target_poi_id = tp.id
                    WHERE r.run_id = 'optimized_${size}'
                `);
                stmt.all();
                const memoryAfter = process.memoryUsage();
                
                // Get performance metrics
                const perfMetrics = optimizedValidator.getPerformanceMetrics();
                
                results[`${size}_records`] = {
                    validation_time_ms: validationTimeMs,
                    memory_delta_mb: (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024,
                    is_valid: validationResult.isValid,
                    errors_count: validationResult.errors.length,
                    cache_hit_rate: perfMetrics.cacheStats?.hitRate || '0%',
                    records_processed: perfMetrics.recordsProcessed || 0
                };
                
                console.log(`      ⏱️  ${validationTimeMs.toFixed(2)}ms validation (cache: ${results[`${size}_records`].cache_hit_rate})`);
            }
            
        } finally {
            db.close();
        }
        
        return results;
    }

    async createTestData(db, size, testType) {
        const runId = `${testType}_${size}`;
        
        // Create test file
        const fileStmt = db.prepare(`
            INSERT OR REPLACE INTO files (file_path, hash, status)
            VALUES (?, ?, 'COMPLETED')
        `);
        fileStmt.run(`/benchmark/${testType}_${size}.js`, `hash_${testType}_${size}`);
        
        const fileId = db.prepare("SELECT id FROM files WHERE file_path = ?").get(`/benchmark/${testType}_${size}.js`).id;
        
        // Create POIs
        const poiStmt = db.prepare(`
            INSERT OR REPLACE INTO pois (file_id, file_path, name, type, start_line, end_line, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (let i = 0; i < size; i++) {
            // Source POI
            poiStmt.run(fileId, `/benchmark/${testType}_${size}.js`, `source_${i}`, 'function', i + 1, i + 5, runId);
            // Target POI
            poiStmt.run(fileId, `/benchmark/${testType}_${size}.js`, `target_${i}`, 'variable', i + 10, i + 10, runId);
        }
        
        // Create relationships
        const relStmt = db.prepare(`
            INSERT OR REPLACE INTO relationships (source_poi_id, target_poi_id, type, confidence, status, file_path, run_id)
            SELECT sp.id, tp.id, 'calls', ?, 'VALIDATED', ?, ?
            FROM pois sp, pois tp
            WHERE sp.name = ? AND tp.name = ? 
            AND sp.run_id = ? AND tp.run_id = ?
        `);
        
        for (let i = 0; i < size; i++) {
            relStmt.run(
                Math.random() * 0.5 + 0.5, // confidence 0.5-1.0
                `/benchmark/${testType}_${size}.js`,
                runId,
                `source_${i}`,
                `target_${i}`,
                runId,
                runId
            );
        }
    }

    calculateImprovements() {
        console.log('\n📈 Calculating performance improvements...');
        
        const improvements = {};
        
        for (const size of this.results.test_datasets) {
            const key = `${size}_records`;
            const baseline = this.results.baseline[key];
            const optimized = this.results.optimized[key];
            
            if (baseline && optimized) {
                const timeImprovement = ((baseline.validation_time_ms - optimized.validation_time_ms) / baseline.validation_time_ms * 100);
                const memoryImprovement = baseline.memory_delta_mb > 0 ? 
                    ((baseline.memory_delta_mb - optimized.memory_delta_mb) / baseline.memory_delta_mb * 100) : 0;
                
                improvements[key] = {
                    validation_time_improvement_percent: timeImprovement.toFixed(1),
                    memory_improvement_percent: memoryImprovement.toFixed(1),
                    baseline_time_ms: baseline.validation_time_ms.toFixed(2),
                    optimized_time_ms: optimized.validation_time_ms.toFixed(2),
                    cache_hit_rate: optimized.cache_hit_rate || 'N/A',
                    meets_target: timeImprovement > 50 && Math.abs(timeImprovement) < 200 // reasonable improvement
                };
                
                console.log(`  📊 ${size} records: ${timeImprovement.toFixed(1)}% faster, ${memoryImprovement.toFixed(1)}% less memory`);
            }
        }
        
        this.results.improvements = improvements;
    }

    generateBenchmarkReport() {
        console.log('\n📋 Generating benchmark report...\n');
        
        const reportPath = 'performance-benchmark-results.json';
        fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
        
        console.log('🏆 PERFORMANCE BENCHMARK RESULTS');
        console.log('=====================================');
        
        // Summary statistics
        const validImprovements = Object.values(this.results.improvements).filter(i => i.meets_target);
        const avgTimeImprovement = Object.values(this.results.improvements)
            .reduce((sum, i) => sum + parseFloat(i.validation_time_improvement_percent), 0) / 
            Object.keys(this.results.improvements).length;
        
        console.log(`📊 Test datasets: ${this.results.test_datasets.join(', ')} records`);
        console.log(`⚡ Average time improvement: ${avgTimeImprovement.toFixed(1)}%`);
        console.log(`✅ Tests meeting targets: ${validImprovements.length}/${Object.keys(this.results.improvements).length}`);
        
        console.log('\n📈 DETAILED RESULTS:');
        Object.entries(this.results.improvements).forEach(([size, improvement]) => {
            const status = improvement.meets_target ? '✅' : '⚠️';
            console.log(`  ${status} ${size}: ${improvement.validation_time_improvement_percent}% faster`);
            console.log(`     Baseline: ${improvement.baseline_time_ms}ms → Optimized: ${improvement.optimized_time_ms}ms`);
            if (improvement.cache_hit_rate !== 'N/A') {
                console.log(`     Cache hit rate: ${improvement.cache_hit_rate}`);
            }
        });
        
        // Performance target assessment
        console.log('\n🎯 PERFORMANCE TARGET ASSESSMENT:');
        const overallSuccess = avgTimeImprovement > 30 && validImprovements.length >= this.results.test_datasets.length / 2;
        console.log(`📈 Validation speed improvement >30%: ${avgTimeImprovement > 30 ? '✅ PASS' : '❌ FAIL'} (${avgTimeImprovement.toFixed(1)}%)`);
        console.log(`✅ Majority of tests meet targets: ${validImprovements.length >= this.results.test_datasets.length / 2 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`🎯 OVERALL OPTIMIZATION SUCCESS: ${overallSuccess ? '✅ SUCCESS' : '⚠️ PARTIAL'}`);
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        if (avgTimeImprovement < 30) {
            console.log('• Consider enabling aggressive caching for better performance');
            console.log('• Tune batch sizes based on dataset characteristics');
        }
        if (validImprovements.length < this.results.test_datasets.length) {
            console.log('• Review outlier performance for specific dataset sizes');
            console.log('• Consider adaptive optimization based on dataset size');
        }
        if (overallSuccess) {
            console.log('• Optimizations are working well - ready for production deployment');
            console.log('• Consider implementing performance monitoring in production');
        }
        
        console.log(`\n📄 Detailed results saved to: ${reportPath}`);
        
        return this.results;
    }
}

// Run the benchmark if called directly
if (require.main === module) {
    const benchmark = new PerformanceBenchmark();
    benchmark.run()
        .then(() => {
            console.log('\n🎉 Performance benchmark completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Performance benchmark failed:', error);
            process.exit(1);
        });
}

module.exports = PerformanceBenchmark;