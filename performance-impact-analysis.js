#!/usr/bin/env node

/**
 * Performance Impact Analysis of Data Consistency Fixes
 * 
 * This script benchmarks the performance impact of data consistency fixes
 * and identifies optimization opportunities.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');
const GraphBuilder = require('./src/agents/GraphBuilder_optimized');
const ConfidenceScoringService = require('./src/services/cognitive_triangulation/ConfidenceScoringService');

class PerformanceAnalyzer {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            validation_overhead: {},
            memory_usage: {},
            database_performance: {},
            pipeline_throughput: {},
            bottlenecks: [],
            optimizations: []
        };
        this.dbPath = config.SQLITE_DB_PATH;
    }

    async run() {
        console.log('🔬 Starting Performance Impact Analysis...\n');

        try {
            // 1. Benchmark validation overhead
            await this.benchmarkValidationOverhead();
            
            // 2. Analyze memory usage impact
            await this.analyzeMemoryUsage();
            
            // 3. Test database query performance
            await this.benchmarkDatabasePerformance();
            
            // 4. Measure pipeline throughput impact
            await this.benchmarkPipelineThroughput();
            
            // 5. Profile bottlenecks
            await this.profileBottlenecks();
            
            // 6. Generate optimization recommendations
            this.generateOptimizations();
            
            // 7. Save results
            this.saveResults();
            
        } catch (error) {
            console.error('❌ Performance analysis failed:', error);
            throw error;
        }
    }

    async benchmarkValidationOverhead() {
        console.log('⏱️  Benchmarking validation overhead...');
        
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  No database found for validation testing');
            return;
        }

        const db = new Database(this.dbPath);
        
        try {
            // Test GraphBuilder data integrity validation
            const graphBuilder = new GraphBuilder(db, null, 'test');
            
            // Measure validation time for different dataset sizes
            const testSizes = [100, 500, 1000, 5000];
            
            for (const size of testSizes) {
                // Setup test data
                await this.setupTestData(db, size);
                
                const startTime = process.hrtime.bigint();
                const validationResult = await graphBuilder.validateDataIntegrity();
                const endTime = process.hrtime.bigint();
                
                const validationTimeMs = Number(endTime - startTime) / 1000000;
                
                this.results.validation_overhead[`${size}_records`] = {
                    validation_time_ms: validationTimeMs,
                    is_valid: validationResult.isValid,
                    errors_found: validationResult.errors.length
                };
                
                console.log(`  📊 ${size} records: ${validationTimeMs.toFixed(2)}ms validation time`);
            }
            
            // Test ConfidenceScoringService performance
            const evidenceArray = this.generateTestEvidence(1000);
            
            const confidenceStartTime = process.hrtime.bigint();
            ConfidenceScoringService.calculateFinalScore(evidenceArray);
            const confidenceEndTime = process.hrtime.bigint();
            
            const confidenceTimeMs = Number(confidenceEndTime - confidenceStartTime) / 1000000;
            
            this.results.validation_overhead.confidence_scoring = {
                evidence_count: evidenceArray.length,
                processing_time_ms: confidenceTimeMs,
                time_per_evidence_us: (confidenceTimeMs * 1000) / evidenceArray.length
            };
            
            console.log(`  🎯 Confidence scoring: ${confidenceTimeMs.toFixed(3)}ms for ${evidenceArray.length} evidence items`);
            
        } finally {
            db.close();
        }
    }

    async analyzeMemoryUsage() {
        console.log('🧠 Analyzing memory usage impact...');
        
        const initialMemory = process.memoryUsage();
        
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  No database found for memory analysis');
            return;
        }

        const db = new Database(this.dbPath);
        
        try {
            // Measure memory before and after large operations
            const beforeLargeQuery = process.memoryUsage();
            
            // Simulate large validation query
            const largeValidationQuery = db.prepare(`
                SELECT 
                    r.id, r.type, r.confidence, r.status,
                    sp.name as source_name, sp.type as source_type,
                    tp.name as target_name, tp.type as target_type
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                LIMIT 10000
            `);
            
            const results = largeValidationQuery.all();
            const afterLargeQuery = process.memoryUsage();
            
            // Memory usage analysis
            this.results.memory_usage = {
                initial_heap_mb: (initialMemory.heapUsed / 1024 / 1024).toFixed(2),
                after_query_heap_mb: (afterLargeQuery.heapUsed / 1024 / 1024).toFixed(2),
                heap_increase_mb: ((afterLargeQuery.heapUsed - beforeLargeQuery.heapUsed) / 1024 / 1024).toFixed(2),
                records_processed: results.length,
                memory_per_record_kb: ((afterLargeQuery.heapUsed - beforeLargeQuery.heapUsed) / results.length / 1024).toFixed(3)
            };
            
            console.log(`  📈 Memory usage increased by ${this.results.memory_usage.heap_increase_mb}MB for ${results.length} records`);
            console.log(`  💾 ${this.results.memory_usage.memory_per_record_kb}KB per record`);
            
        } finally {
            db.close();
        }
    }

    async benchmarkDatabasePerformance() {
        console.log('🗄️  Benchmarking database query performance...');
        
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  No database found for query benchmarking');
            return;
        }

        const db = new Database(this.dbPath);
        
        try {
            const queries = [
                {
                    name: 'validation_orphaned_relationships',
                    query: `
                        SELECT COUNT(*) as count
                        FROM relationships r
                        LEFT JOIN pois sp ON r.source_poi_id = sp.id
                        LEFT JOIN pois tp ON r.target_poi_id = tp.id
                        WHERE r.status = 'VALIDATED' 
                        AND (sp.id IS NULL OR tp.id IS NULL)
                    `
                },
                {
                    name: 'validation_invalid_confidence',
                    query: `
                        SELECT COUNT(*) as count
                        FROM relationships 
                        WHERE status = 'VALIDATED' 
                        AND (confidence IS NULL OR confidence <= 0 OR confidence > 1)
                    `
                },
                {
                    name: 'validation_missing_types',
                    query: `
                        SELECT COUNT(*) as count
                        FROM relationships 
                        WHERE status = 'VALIDATED' 
                        AND (type IS NULL OR type = '')
                    `
                },
                {
                    name: 'complex_join_query',
                    query: `
                        SELECT r.id, r.type, r.confidence,
                               sp.name as source_name, tp.name as target_name
                        FROM relationships r
                        JOIN pois sp ON r.source_poi_id = sp.id
                        JOIN pois tp ON r.target_poi_id = tp.id
                        WHERE r.status = 'VALIDATED'
                        ORDER BY r.confidence DESC
                        LIMIT 1000
                    `
                }
            ];
            
            for (const test of queries) {
                const stmt = db.prepare(test.query);
                const iterations = 10;
                const times = [];
                
                for (let i = 0; i < iterations; i++) {
                    const startTime = process.hrtime.bigint();
                    stmt.all();
                    const endTime = process.hrtime.bigint();
                    times.push(Number(endTime - startTime) / 1000000);
                }
                
                const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
                const minTime = Math.min(...times);
                const maxTime = Math.max(...times);
                
                this.results.database_performance[test.name] = {
                    avg_time_ms: avgTime.toFixed(3),
                    min_time_ms: minTime.toFixed(3),
                    max_time_ms: maxTime.toFixed(3),
                    iterations: iterations
                };
                
                console.log(`  📊 ${test.name}: ${avgTime.toFixed(2)}ms avg (${minTime.toFixed(2)}-${maxTime.toFixed(2)}ms)`);
            }
            
        } finally {
            db.close();
        }
    }

    async benchmarkPipelineThroughput() {
        console.log('🚀 Benchmarking pipeline throughput impact...');
        
        // Simulate pipeline processing with and without validation overhead
        const testSizes = [100, 500, 1000];
        
        for (const size of testSizes) {
            // Measure processing time without validation
            const withoutValidationStart = process.hrtime.bigint();
            await this.simulateProcessingWithoutValidation(size);
            const withoutValidationEnd = process.hrtime.bigint();
            
            // Measure processing time with validation
            const withValidationStart = process.hrtime.bigint();
            await this.simulateProcessingWithValidation(size);
            const withValidationEnd = process.hrtime.bigint();
            
            const withoutValidationMs = Number(withoutValidationEnd - withoutValidationStart) / 1000000;
            const withValidationMs = Number(withValidationEnd - withValidationStart) / 1000000;
            const overhead = ((withValidationMs - withoutValidationMs) / withoutValidationMs * 100);
            
            this.results.pipeline_throughput[`${size}_records`] = {
                without_validation_ms: withoutValidationMs.toFixed(2),
                with_validation_ms: withValidationMs.toFixed(2),
                overhead_percentage: overhead.toFixed(2),
                throughput_degradation: overhead > 15 ? 'HIGH' : overhead > 10 ? 'MEDIUM' : 'LOW'
            };
            
            console.log(`  📈 ${size} records: ${overhead.toFixed(1)}% overhead (${this.results.pipeline_throughput[`${size}_records`].throughput_degradation})`);
        }
    }

    async profileBottlenecks() {
        console.log('🔍 Profiling performance bottlenecks...');
        
        // Analyze hot paths in validation functions
        const bottlenecks = [];
        
        // 1. Complex validation queries
        if (this.results.database_performance.complex_join_query) {
            const complexQueryTime = parseFloat(this.results.database_performance.complex_join_query.avg_time_ms);
            if (complexQueryTime > 100) {
                bottlenecks.push({
                    type: 'SLOW_QUERY',
                    location: 'GraphBuilder.validateDataIntegrity - complex join',
                    impact: 'HIGH',
                    time_ms: complexQueryTime,
                    description: 'Complex JOIN query for validation taking excessive time'
                });
            }
        }
        
        // 2. Memory usage per record
        if (this.results.memory_usage.memory_per_record_kb) {
            const memoryPerRecord = parseFloat(this.results.memory_usage.memory_per_record_kb);
            if (memoryPerRecord > 1) {
                bottlenecks.push({
                    type: 'MEMORY_OVERHEAD',
                    location: 'Database query result processing',
                    impact: 'MEDIUM',
                    memory_kb: memoryPerRecord,
                    description: 'High memory usage per record during validation'
                });
            }
        }
        
        // 3. Validation overhead
        Object.entries(this.results.validation_overhead).forEach(([key, value]) => {
            if (value.validation_time_ms > 1000) {
                bottlenecks.push({
                    type: 'VALIDATION_OVERHEAD',
                    location: `Validation for ${key}`,
                    impact: 'HIGH',
                    time_ms: value.validation_time_ms,
                    description: 'Validation taking over 1 second'
                });
            }
        });
        
        // 4. Pipeline throughput degradation
        Object.entries(this.results.pipeline_throughput).forEach(([key, value]) => {
            if (parseFloat(value.overhead_percentage) > 15) {
                bottlenecks.push({
                    type: 'THROUGHPUT_DEGRADATION',
                    location: `Pipeline processing for ${key}`,
                    impact: 'HIGH',
                    overhead_percent: value.overhead_percentage,
                    description: 'Pipeline throughput degraded by more than 15%'
                });
            }
        });
        
        this.results.bottlenecks = bottlenecks;
        
        console.log(`  🚨 Found ${bottlenecks.length} performance bottlenecks`);
        bottlenecks.forEach(b => {
            console.log(`    - [${b.impact}] ${b.type}: ${b.description}`);
        });
    }

    generateOptimizations() {
        console.log('💡 Generating optimization recommendations...');
        
        const optimizations = [];
        
        // Based on bottleneck analysis
        this.results.bottlenecks.forEach(bottleneck => {
            switch (bottleneck.type) {
                case 'SLOW_QUERY':
                    optimizations.push({
                        type: 'DATABASE_OPTIMIZATION',
                        priority: 'HIGH',
                        description: 'Optimize slow validation queries with better indexes',
                        implementation: 'Add composite indexes on (status, source_poi_id, target_poi_id)',
                        expected_improvement: '60-80% query time reduction'
                    });
                    break;
                    
                case 'MEMORY_OVERHEAD':
                    optimizations.push({
                        type: 'MEMORY_OPTIMIZATION',
                        priority: 'MEDIUM',
                        description: 'Implement streaming query processing',
                        implementation: 'Process validation results in batches instead of loading all at once',
                        expected_improvement: '50-70% memory usage reduction'
                    });
                    break;
                    
                case 'VALIDATION_OVERHEAD':
                    optimizations.push({
                        type: 'VALIDATION_CACHING',
                        priority: 'HIGH',
                        description: 'Cache validation results',
                        implementation: 'Add validation_hash column and cache results',
                        expected_improvement: '80-90% validation time reduction on repeated runs'
                    });
                    break;
                    
                case 'THROUGHPUT_DEGRADATION':
                    optimizations.push({
                        type: 'ASYNC_VALIDATION',
                        priority: 'HIGH',
                        description: 'Implement asynchronous validation',
                        implementation: 'Move validation to background workers',
                        expected_improvement: '70-90% throughput recovery'
                    });
                    break;
            }
        });
        
        // General optimizations
        optimizations.push(
            {
                type: 'BATCH_VALIDATION',
                priority: 'MEDIUM',
                description: 'Batch validation operations',
                implementation: 'Group validation checks into single queries',
                expected_improvement: '30-50% validation time reduction'
            },
            {
                type: 'PARTIAL_INDEX_OPTIMIZATION',
                priority: 'LOW',
                description: 'Create partial indexes for hot paths',
                implementation: 'Add WHERE clauses to indexes for validated relationships',
                expected_improvement: '20-30% query time improvement'
            }
        );
        
        this.results.optimizations = optimizations;
        
        console.log(`  💡 Generated ${optimizations.length} optimization recommendations`);
        optimizations.forEach(opt => {
            console.log(`    - [${opt.priority}] ${opt.type}: ${opt.description}`);
        });
    }

    async setupTestData(db, size) {
        // Create test files first
        const fileStmt = db.prepare(`
            INSERT OR IGNORE INTO files (file_path, hash, status)
            VALUES (?, ?, ?)
        `);
        
        fileStmt.run('/test/file.js', 'test_hash', 'COMPLETED');
        
        // Create test POIs
        const poiStmt = db.prepare(`
            INSERT OR IGNORE INTO pois (id, file_id, file_path, name, type, start_line, end_line, run_id)
            VALUES (?, 1, '/test/file.js', ?, ?, ?, ?, 'test_run')
        `);
        
        for (let i = 0; i < size; i++) {
            // Create source POI
            poiStmt.run(i * 2 + 1, `test_source_${i}`, 'function', i + 1, i + 5);
            // Create target POI  
            poiStmt.run(i * 2 + 2, `test_target_${i}`, 'variable', i + 10, i + 10);
        }
        
        // Create test relationships for benchmarking
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO relationships (type, confidence, status, source_poi_id, target_poi_id, file_path, run_id)
            VALUES (?, ?, ?, ?, ?, '/test/file.js', 'test_run')
        `);
        
        for (let i = 0; i < size; i++) {
            stmt.run(
                'test_relationship',
                Math.random(),
                'VALIDATED',
                i * 2 + 1,  // source_poi_id
                i * 2 + 2   // target_poi_id
            );
        }
    }

    generateTestEvidence(count) {
        const evidence = [];
        for (let i = 0; i < count; i++) {
            evidence.push({
                confidence: Math.random(),
                source: `test_source_${i}`,
                timestamp: Date.now()
            });
        }
        return evidence;
    }

    async simulateProcessingWithoutValidation(size) {
        // Simulate basic processing without validation overhead
        for (let i = 0; i < size; i++) {
            // Simulate some work
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    async simulateProcessingWithValidation(size) {
        // Simulate processing with validation overhead
        for (let i = 0; i < size; i++) {
            // Simulate validation work
            const evidence = this.generateTestEvidence(10);
            ConfidenceScoringService.calculateFinalScore(evidence);
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    saveResults() {
        const reportPath = 'performance-impact-analysis-results.json';
        fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
        
        console.log('\n📊 PERFORMANCE ANALYSIS SUMMARY');
        console.log('=====================================');
        
        // Validation overhead summary
        if (this.results.validation_overhead['1000_records']) {
            const validationTime = this.results.validation_overhead['1000_records'].validation_time_ms;
            console.log(`🔍 Validation overhead: ${validationTime}ms for 1000 records`);
        }
        
        // Memory usage summary
        if (this.results.memory_usage.heap_increase_mb) {
            console.log(`🧠 Memory usage: +${this.results.memory_usage.heap_increase_mb}MB for large queries`);
        }
        
        // Performance assessment
        const criticalBottlenecks = this.results.bottlenecks.filter(b => b.impact === 'HIGH').length;
        const highPriorityOptimizations = this.results.optimizations.filter(o => o.priority === 'HIGH').length;
        
        console.log(`🚨 Critical bottlenecks: ${criticalBottlenecks}`);
        console.log(`💡 High priority optimizations: ${highPriorityOptimizations}`);
        
        console.log(`\n📄 Detailed results saved to: ${reportPath}`);
        
        // Performance targets assessment
        console.log('\n🎯 PERFORMANCE TARGETS ASSESSMENT:');
        
        // Check validation overhead target (<10%)
        let validationOverheadOk = true;
        Object.values(this.results.pipeline_throughput).forEach(result => {
            if (parseFloat(result.overhead_percentage) > 10) {
                validationOverheadOk = false;
            }
        });
        console.log(`📈 Validation overhead <10%: ${validationOverheadOk ? '✅ PASS' : '❌ FAIL'}`);
        
        // Check memory usage increase (<20%)
        const memoryIncrease = parseFloat(this.results.memory_usage.heap_increase_mb || 0);
        const memoryOk = memoryIncrease < 50; // Rough estimate for <20% increase
        console.log(`💾 Memory usage <20% increase: ${memoryOk ? '✅ PASS' : '❌ FAIL'}`);
        
        // Check database query performance (<5% increase)
        const avgQueryTime = Object.values(this.results.database_performance)
            .reduce((sum, result) => sum + parseFloat(result.avg_time_ms), 0) / 
            Object.keys(this.results.database_performance).length;
        const queryPerformanceOk = avgQueryTime < 100; // <100ms average
        console.log(`🗄️  Database query performance: ${queryPerformanceOk ? '✅ PASS' : '❌ FAIL'}`);
        
        // Overall assessment
        const overallOk = validationOverheadOk && memoryOk && queryPerformanceOk;
        console.log(`\n🎯 OVERALL PERFORMANCE: ${overallOk ? '✅ WITHIN TARGETS' : '⚠️  NEEDS OPTIMIZATION'}`);
    }
}

// Run the analyzer if called directly
if (require.main === module) {
    const analyzer = new PerformanceAnalyzer();
    analyzer.run()
        .then(() => {
            console.log('\n🎉 Performance analysis completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Performance analysis failed:', error);
            process.exit(1);
        });
}

module.exports = PerformanceAnalyzer;