#!/usr/bin/env node

/**
 * Realistic Performance Benchmarks for Production Readiness
 * 
 * This script tests performance under realistic conditions:
 * - Cache miss scenarios (cold start performance)
 * - Memory pressure conditions  
 * - High concurrency load
 * - Large dataset scaling
 * - Network latency simulation
 * - Database lock contention
 */

const fs = require('fs');
const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');
const config = require('./src/config');

// Import optimized components
const OptimizedDataValidator = require('./src/utils/OptimizedDataValidator');
const ValidationCache = require('./src/utils/ValidationCache');
const OptimizedBatchValidator = require('./src/utils/OptimizedBatchValidator');

class RealisticPerformanceBenchmark {
    constructor() {
        this.dbPath = config.SQLITE_DB_PATH;
        this.results = {
            timestamp: new Date().toISOString(),
            scenarios: {},
            summary: {},
            issues: [],
            recommendations: []
        };
        this.testDatabases = [];
    }

    async run() {
        console.log('🔬 Starting Realistic Performance Benchmark...\n');

        try {
            // 1. Cache Miss Performance (Cold Start)
            await this.testCacheMissPerformance();
            
            // 2. Memory Pressure Testing
            await this.testMemoryPressurePerformance();
            
            // 3. Concurrent Load Testing
            await this.testConcurrentLoadPerformance();
            
            // 4. Large Dataset Scaling
            await this.testLargeDatasetScaling();
            
            // 5. Cache Coherence Testing
            await this.testCacheCoherence();
            
            // 6. Database Lock Contention
            await this.testDatabaseLockContention();
            
            // 7. Edge Case Performance
            await this.testEdgeCasePerformance();
            
            // Generate comprehensive analysis
            this.analyzeResults();
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Realistic benchmark failed:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    async testCacheMissPerformance() {
        console.log('📊 Testing Cache Miss Performance (Cold Start)...');
        
        const db = this.createTestDatabase('cache_miss_test');
        await this.setupTestData(db, 1000, 'cache_miss');
        
        // Clear all caches to simulate cold start
        const validator = new OptimizedDataValidator(db, {
            cacheSize: 10000,
            cacheTtl: 300000,
            batchSize: 5000
        });
        
        validator.clearCache();
        
        const testSizes = [100, 500, 1000, 2000];
        const results = {};
        
        for (const size of testSizes) {
            console.log(`  Testing ${size} records with 0% cache hit rate...`);
            
            // Ensure cache miss by using unique cache keys
            const uniqueValidator = new OptimizedDataValidator(db, {
                cacheSize: 1, // Very small cache to force misses
                cacheTtl: 1, // Very short TTL
                batchSize: size
            });
            
            const startTime = performance.now();
            const result = await uniqueValidator.validateDataIntegrity();
            const endTime = performance.now();
            
            const duration = endTime - startTime;
            const metrics = uniqueValidator.getPerformanceMetrics();
            
            results[`${size}_records`] = {
                duration_ms: duration,
                cache_hit_rate: metrics.cacheStats?.hitRate || '0%',
                records_processed: metrics.recordsProcessed,
                is_realistic: duration < 5000 // Should complete within 5 seconds
            };
            
            console.log(`    Duration: ${duration.toFixed(2)}ms, Cache hits: ${results[`${size}_records`].cache_hit_rate}`);
        }
        
        this.results.scenarios.cache_miss = results;
        db.close();
        
        // Analyze cache miss performance
        const avgDuration = Object.values(results).reduce((sum, r) => sum + r.duration_ms, 0) / testSizes.length;
        if (avgDuration > 3000) {
            this.results.issues.push({
                type: 'performance',
                severity: 'high',
                description: `Cache miss performance is poor (${avgDuration.toFixed(2)}ms average). Production may suffer during cold starts.`,
                recommendation: 'Consider cache warming strategies or faster fallback validation'
            });
        }
        
        console.log('✅ Cache miss performance testing completed\n');
    }

    async testMemoryPressurePerformance() {
        console.log('📊 Testing Memory Pressure Performance...');
        
        const db = this.createTestDatabase('memory_pressure_test');
        await this.setupTestData(db, 5000, 'memory_pressure');
        
        // Simulate memory pressure by creating large objects
        const memoryPressure = [];
        const initialMemory = process.memoryUsage();
        
        try {
            // Allocate memory to simulate pressure (aim for 80% of available heap)
            const targetMemory = initialMemory.heapTotal * 0.8;
            while (process.memoryUsage().heapUsed < targetMemory) {
                memoryPressure.push(new Array(100000).fill('memory_pressure_data'));
            }
            
            console.log(`  Simulated memory pressure: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used`);
            
            const validator = new OptimizedDataValidator(db, {
                cacheSize: 1000, // Smaller cache under memory pressure
                batchSize: 1000
            });
            
            const startTime = performance.now();
            const startMemory = process.memoryUsage();
            
            const result = await validator.validateDataIntegrity();
            
            const endTime = performance.now();
            const endMemory = process.memoryUsage();
            
            const duration = endTime - startTime;
            const memoryGrowth = endMemory.heapUsed - startMemory.heapUsed;
            
            this.results.scenarios.memory_pressure = {
                duration_ms: duration,
                memory_growth_mb: memoryGrowth / 1024 / 1024,
                initial_memory_mb: startMemory.heapUsed / 1024 / 1024,
                final_memory_mb: endMemory.heapUsed / 1024 / 1024,
                is_valid: result.isValid,
                performance_acceptable: duration < 10000 && memoryGrowth < 50 * 1024 * 1024 // <50MB growth
            };
            
            console.log(`  Duration: ${duration.toFixed(2)}ms, Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`);
            
            if (!this.results.scenarios.memory_pressure.performance_acceptable) {
                this.results.issues.push({
                    type: 'memory',
                    severity: 'high',
                    description: `Poor performance under memory pressure: ${duration.toFixed(2)}ms, ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB growth`,
                    recommendation: 'Optimize memory usage or implement memory-aware caching'
                });
            }
            
        } finally {
            // Clear memory pressure
            memoryPressure.length = 0;
            if (global.gc) global.gc();
        }
        
        db.close();
        console.log('✅ Memory pressure performance testing completed\n');
    }

    async testConcurrentLoadPerformance() {
        console.log('📊 Testing Concurrent Load Performance...');
        
        const db = this.createTestDatabase('concurrent_test');
        await this.setupTestData(db, 2000, 'concurrent');
        
        const concurrencyLevels = [1, 5, 10, 20];
        const results = {};
        
        for (const concurrency of concurrencyLevels) {
            console.log(`  Testing ${concurrency} concurrent operations...`);
            
            const promises = [];
            const startTime = performance.now();
            
            for (let i = 0; i < concurrency; i++) {
                const validator = new OptimizedDataValidator(db, {
                    cacheSize: 5000,
                    batchSize: 1000
                });
                
                promises.push(validator.validateDataIntegrity());
            }
            
            const concurrentResults = await Promise.all(promises);
            const endTime = performance.now();
            
            const totalDuration = endTime - startTime;
            const avgDuration = totalDuration / concurrency;
            const allValid = concurrentResults.every(r => r.isValid);
            
            results[`${concurrency}_concurrent`] = {
                total_duration_ms: totalDuration,
                avg_duration_ms: avgDuration,
                all_valid: allValid,
                throughput_ops_per_sec: (concurrency / totalDuration) * 1000,
                performance_acceptable: avgDuration < 5000 && allValid
            };
            
            console.log(`    Total: ${totalDuration.toFixed(2)}ms, Avg: ${avgDuration.toFixed(2)}ms, Throughput: ${results[`${concurrency}_concurrent`].throughput_ops_per_sec.toFixed(2)} ops/sec`);
        }
        
        this.results.scenarios.concurrent_load = results;
        
        // Check for performance degradation under concurrency
        const single = results['1_concurrent'];
        const highest = results['20_concurrent'];
        if (highest && single && highest.avg_duration_ms > single.avg_duration_ms * 2) {
            this.results.issues.push({
                type: 'concurrency',
                severity: 'medium',
                description: `Performance degrades significantly under high concurrency (${(highest.avg_duration_ms / single.avg_duration_ms).toFixed(1)}x slower)`,
                recommendation: 'Consider connection pooling or queue-based processing for high concurrency scenarios'
            });
        }
        
        db.close();
        console.log('✅ Concurrent load performance testing completed\n');
    }

    async testLargeDatasetScaling() {
        console.log('📊 Testing Large Dataset Scaling...');
        
        const largeSizes = [1000, 5000, 10000, 25000, 50000];
        const results = {};
        
        for (const size of largeSizes) {
            console.log(`  Testing ${size} records...`);
            
            const db = this.createTestDatabase(`large_${size}`);
            await this.setupTestData(db, size, 'large_scale');
            
            const validator = new OptimizedDataValidator(db, {
                cacheSize: 50000,
                batchSize: Math.min(5000, size / 2),
                enableStreaming: size > 10000
            });
            
            const startTime = performance.now();
            const startMemory = process.memoryUsage();
            
            const result = await validator.validateDataIntegrity();
            
            const endTime = performance.now();
            const endMemory = process.memoryUsage();
            
            const duration = endTime - startTime;
            const memoryUsed = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;
            const throughput = size / (duration / 1000); // records per second
            
            results[`${size}_records`] = {
                duration_ms: duration,
                memory_used_mb: memoryUsed,
                throughput_records_per_sec: throughput,
                is_valid: result.isValid,
                scales_linearly: true // We'll calculate this after all tests
            };
            
            console.log(`    Duration: ${duration.toFixed(2)}ms, Memory: ${memoryUsed.toFixed(2)}MB, Throughput: ${throughput.toFixed(0)} rec/sec`);
            
            db.close();
        }
        
        // Check for linear scaling
        const sizes = largeSizes.slice(0, -1); // Exclude largest for comparison
        let scalingIssues = 0;
        
        for (let i = 1; i < sizes.length; i++) {
            const smaller = results[`${sizes[i-1]}_records`];
            const larger = results[`${sizes[i]}_records`];
            const sizeRatio = sizes[i] / sizes[i-1];
            const timeRatio = larger.duration_ms / smaller.duration_ms;
            
            // Performance should scale roughly linearly (within 50% tolerance)
            if (timeRatio > sizeRatio * 1.5) {
                scalingIssues++;
                results[`${sizes[i]}_records`].scales_linearly = false;
            }
        }
        
        this.results.scenarios.large_dataset_scaling = results;
        
        if (scalingIssues > 1) {
            this.results.issues.push({
                type: 'scalability',
                severity: 'high',
                description: 'Performance does not scale linearly with dataset size',
                recommendation: 'Implement streaming processing and optimize algorithms for O(n) complexity'
            });
        }
        
        console.log('✅ Large dataset scaling testing completed\n');
    }

    async testCacheCoherence() {
        console.log('📊 Testing Cache Coherence...');
        
        const db = this.createTestDatabase('cache_coherence_test');
        await this.setupTestData(db, 1000, 'coherence');
        
        const validator1 = new OptimizedDataValidator(db, { cacheSize: 10000 });
        const validator2 = new OptimizedDataValidator(db, { cacheSize: 10000 });
        
        // First validation - populate cache
        console.log('  Running initial validation to populate cache...');
        const result1 = await validator1.validateDataIntegrity();
        
        // Modify data while cache is warm
        console.log('  Modifying data while cache is active...');
        const stmt = db.prepare("UPDATE relationships SET confidence = 0.1 WHERE run_id = 'coherence' LIMIT 10");
        stmt.run();
        
        // Test cache coherence
        console.log('  Testing cache coherence after data modification...');
        const result2 = await validator1.validateDataIntegrity(); // Should use cache
        const result3 = await validator2.validateDataIntegrity(); // Fresh validator, should detect changes
        
        // Clear cache and test again
        validator1.clearCache();
        const result4 = await validator1.validateDataIntegrity(); // Should detect changes now
        
        const cacheCoherenceResults = {
            initial_validation_valid: result1.isValid,
            cached_validation_after_change: result2.isValid,
            fresh_validator_after_change: result3.isValid,
            cleared_cache_validation: result4.isValid,
            cache_coherence_issue: result2.isValid && !result4.isValid, // Cache gave stale "valid" result
            cache_invalidation_works: true // Will be determined by analysis
        };
        
        // Analyze coherence
        if (cacheCoherenceResults.cache_coherence_issue) {
            this.results.issues.push({
                type: 'cache_coherence',
                severity: 'critical',
                description: 'Cache is serving stale data - could hide data integrity issues in production',
                recommendation: 'Implement cache invalidation on data changes or reduce cache TTL'
            });
            cacheCoherenceResults.cache_invalidation_works = false;
        }
        
        this.results.scenarios.cache_coherence = cacheCoherenceResults;
        
        console.log(`    Cache coherence: ${cacheCoherenceResults.cache_coherence_issue ? '❌ ISSUE DETECTED' : '✅ OK'}`);
        
        db.close();
        console.log('✅ Cache coherence testing completed\n');
    }

    async testDatabaseLockContention() {
        console.log('📊 Testing Database Lock Contention...');
        
        const db = this.createTestDatabase('lock_contention_test');
        await this.setupTestData(db, 2000, 'lock_test');
        
        // Test concurrent database operations
        const promises = [];
        const startTime = performance.now();
        
        // Simulate mixed read/write workload
        for (let i = 0; i < 5; i++) {
            // Readers
            promises.push(this.simulateReaderOperation(db, i));
            
            // Writers
            if (i < 2) {
                promises.push(this.simulateWriterOperation(db, i));
            }
        }
        
        try {
            const results = await Promise.all(promises);
            const endTime = performance.now();
            
            const totalDuration = endTime - startTime;
            const failures = results.filter(r => !r.success).length;
            const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
            
            this.results.scenarios.database_lock_contention = {
                total_duration_ms: totalDuration,
                avg_operation_duration_ms: avgDuration,
                total_operations: results.length,
                failed_operations: failures,
                success_rate: ((results.length - failures) / results.length) * 100,
                contention_acceptable: failures === 0 && avgDuration < 1000
            };
            
            console.log(`    ${results.length} operations, ${failures} failures, ${avgDuration.toFixed(2)}ms avg duration`);
            
            if (failures > 0) {
                this.results.issues.push({
                    type: 'database_contention',
                    severity: 'medium',
                    description: `${failures} database operations failed due to lock contention`,
                    recommendation: 'Consider using WAL mode or optimizing transaction scope'
                });
            }
            
        } catch (error) {
            console.error('  Database lock contention test failed:', error.message);
            this.results.issues.push({
                type: 'database_contention',
                severity: 'high',
                description: `Database lock contention test failed: ${error.message}`,
                recommendation: 'Review database configuration and transaction handling'
            });
        }
        
        db.close();
        console.log('✅ Database lock contention testing completed\n');
    }

    async testEdgeCasePerformance() {
        console.log('📊 Testing Edge Case Performance...');
        
        const db = this.createTestDatabase('edge_case_test');
        
        const edgeCases = [
            {
                name: 'empty_database',
                setup: () => {}, // No data
                expected_duration_ms: 100
            },
            {
                name: 'malformed_data',
                setup: () => {
                    // Insert malformed data
                    db.exec(`
                        INSERT INTO files (file_path, status, run_id) VALUES ('malformed.js', 'processed', 'edge_case');
                        INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, run_id) 
                        VALUES (1, 'malformed.js', NULL, '', -1, -1, 'edge_case');
                        INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, run_id)
                        VALUES (1, 999999, '', NULL, 'VALIDATED', 'edge_case');
                    `);
                },
                expected_duration_ms: 500
            },
            {
                name: 'very_long_strings',
                setup: () => {
                    const longString = 'x'.repeat(10000);
                    const stmt = db.prepare(`
                        INSERT INTO files (file_path, status, run_id) VALUES (?, 'processed', 'edge_case')
                    `);
                    stmt.run(longString);
                    
                    const poiStmt = db.prepare(`
                        INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, run_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'edge_case')
                    `);
                    poiStmt.run(db.lastInsertRowid, longString, longString, longString, 1, 1, longString);
                },
                expected_duration_ms: 1000
            }
        ];
        
        const results = {};
        
        for (const edgeCase of edgeCases) {
            console.log(`  Testing ${edgeCase.name}...`);
            
            // Clear and setup
            db.exec("DELETE FROM relationships; DELETE FROM pois; DELETE FROM files;");
            edgeCase.setup();
            
            const validator = new OptimizedDataValidator(db, {
                cacheSize: 10000,
                batchSize: 1000
            });
            
            try {
                const startTime = performance.now();
                const result = await validator.validateDataIntegrity();
                const endTime = performance.now();
                
                const duration = endTime - startTime;
                
                results[edgeCase.name] = {
                    duration_ms: duration,
                    is_valid: result.isValid,
                    errors_count: result.errors.length,
                    within_expected: duration < edgeCase.expected_duration_ms,
                    completed_successfully: true
                };
                
                console.log(`    Duration: ${duration.toFixed(2)}ms, Valid: ${result.isValid}, Errors: ${result.errors.length}`);
                
                if (!results[edgeCase.name].within_expected) {
                    this.results.issues.push({
                        type: 'edge_case_performance',
                        severity: 'medium',
                        description: `Edge case '${edgeCase.name}' took ${duration.toFixed(2)}ms (expected <${edgeCase.expected_duration_ms}ms)`,
                        recommendation: 'Add input validation and early returns for edge cases'
                    });
                }
                
            } catch (error) {
                console.error(`    Failed: ${error.message}`);
                results[edgeCase.name] = {
                    duration_ms: null,
                    is_valid: false,
                    errors_count: 1,
                    within_expected: false,
                    completed_successfully: false,
                    error: error.message
                };
                
                this.results.issues.push({
                    type: 'edge_case_failure',
                    severity: 'high',
                    description: `Edge case '${edgeCase.name}' failed: ${error.message}`,
                    recommendation: 'Add error handling for malformed data scenarios'
                });
            }
        }
        
        this.results.scenarios.edge_cases = results;
        
        db.close();
        console.log('✅ Edge case performance testing completed\n');
    }

    async simulateReaderOperation(db, operationId) {
        const startTime = performance.now();
        
        try {
            const validator = new OptimizedDataValidator(db, {
                cacheSize: 1000,
                batchSize: 1000
            });
            
            await validator.validateDataIntegrity();
            
            return {
                type: 'read',
                operationId,
                duration: performance.now() - startTime,
                success: true
            };
            
        } catch (error) {
            return {
                type: 'read',
                operationId,
                duration: performance.now() - startTime,
                success: false,
                error: error.message
            };
        }
    }

    async simulateWriterOperation(db, operationId) {
        const startTime = performance.now();
        
        try {
            const stmt = db.prepare(`
                INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, run_id)
                VALUES (1, 1, 'test_write_${operationId}', 0.8, 'VALIDATED', 'lock_test')
            `);
            stmt.run();
            
            return {
                type: 'write',
                operationId,
                duration: performance.now() - startTime,
                success: true
            };
            
        } catch (error) {
            return {
                type: 'write',
                operationId,
                duration: performance.now() - startTime,
                success: false,
                error: error.message
            };
        }
    }

    createTestDatabase(suffix) {
        const dbPath = `${this.dbPath}.${suffix}.test`;
        this.testDatabases.push(dbPath);
        
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
        
        const db = new Database(dbPath);
        
        // Initialize schema
        const schema = fs.readFileSync('./src/utils/schema.sql', 'utf8');
        db.exec(schema);
        
        return db;
    }

    async setupTestData(db, size, runId) {
        // Create test file
        const fileStmt = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)');
        fileStmt.run(`/test/${runId}.js`, 'processed', runId);
        const fileId = db.lastInsertRowid;
        
        // Create POIs and relationships
        const poiStmt = db.prepare(`
            INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, semantic_id, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const relStmt = db.prepare(`
            INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status, run_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const transaction = db.transaction(() => {
            for (let i = 0; i < size; i++) {
                // Source POI
                poiStmt.run(fileId, `/test/${runId}.js`, `func_${i}`, 'function', i, i + 1, `func_${i}_semantic`, runId);
                const sourceId = db.lastInsertRowid;
                
                // Target POI
                poiStmt.run(fileId, `/test/${runId}.js`, `var_${i}`, 'variable', i + 10, i + 10, `var_${i}_semantic`, runId);
                const targetId = db.lastInsertRowid;
                
                // Relationship
                relStmt.run(sourceId, targetId, 'uses', Math.random() * 0.5 + 0.5, 'VALIDATED', runId);
            }
        });
        
        transaction();
    }

    analyzeResults() {
        console.log('📈 Analyzing performance results...');
        
        const summary = {
            total_scenarios: Object.keys(this.results.scenarios).length,
            critical_issues: this.results.issues.filter(i => i.severity === 'critical').length,
            high_issues: this.results.issues.filter(i => i.severity === 'high').length,
            medium_issues: this.results.issues.filter(i => i.severity === 'medium').length,
            production_ready: false,
            overall_performance_score: 0
        };
        
        // Calculate performance score
        let scoreComponents = [];
        
        // Cache miss performance (25% weight)
        const cacheMiss = this.results.scenarios.cache_miss;
        if (cacheMiss) {
            const avgDuration = Object.values(cacheMiss).reduce((sum, r) => sum + r.duration_ms, 0) / Object.keys(cacheMiss).length;
            const cacheMissScore = Math.max(0, 100 - (avgDuration / 100)); // 100ms = 90 points, 1000ms = 0 points
            scoreComponents.push({ name: 'cache_miss', score: cacheMissScore, weight: 0.25 });
        }
        
        // Memory pressure (20% weight)
        const memoryPressure = this.results.scenarios.memory_pressure;
        if (memoryPressure) {
            const memoryScore = memoryPressure.performance_acceptable ? 100 : 30;
            scoreComponents.push({ name: 'memory_pressure', score: memoryScore, weight: 0.20 });
        }
        
        // Concurrency (20% weight)
        const concurrent = this.results.scenarios.concurrent_load;
        if (concurrent) {
            const concurrencyScore = Object.values(concurrent).every(r => r.performance_acceptable) ? 100 : 50;
            scoreComponents.push({ name: 'concurrency', score: concurrencyScore, weight: 0.20 });
        }
        
        // Scalability (20% weight)
        const scaling = this.results.scenarios.large_dataset_scaling;
        if (scaling) {
            const scalingIssues = Object.values(scaling).filter(r => !r.scales_linearly).length;
            const scalingScore = Math.max(0, 100 - (scalingIssues * 25));
            scoreComponents.push({ name: 'scalability', score: scalingScore, weight: 0.20 });
        }
        
        // Cache coherence (15% weight)
        const coherence = this.results.scenarios.cache_coherence;
        if (coherence) {
            const coherenceScore = coherence.cache_invalidation_works ? 100 : 0;
            scoreComponents.push({ name: 'cache_coherence', score: coherenceScore, weight: 0.15 });
        }
        
        // Calculate weighted score
        summary.overall_performance_score = scoreComponents.reduce((total, component) => {
            return total + (component.score * component.weight);
        }, 0);
        
        // Determine production readiness
        summary.production_ready = (
            summary.critical_issues === 0 &&
            summary.high_issues <= 1 &&
            summary.overall_performance_score >= 75
        );
        
        // Add recommendations based on analysis
        if (summary.overall_performance_score < 75) {
            this.results.recommendations.push('Performance score below production threshold (75). Address identified issues before deployment.');
        }
        
        if (summary.critical_issues > 0) {
            this.results.recommendations.push('CRITICAL: Address all critical issues immediately. Do not deploy to production.');
        }
        
        if (summary.overall_performance_score >= 90) {
            this.results.recommendations.push('Excellent performance! Ready for production deployment with monitoring.');
        }
        
        this.results.summary = summary;
        
        console.log(`  Performance Score: ${summary.overall_performance_score.toFixed(1)}/100`);
        console.log(`  Production Ready: ${summary.production_ready ? '✅ YES' : '❌ NO'}`);
    }

    generateReport() {
        console.log('\n📋 Generating Realistic Performance Report...\n');
        
        const reportPath = 'realistic-performance-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
        
        console.log('🏆 REALISTIC PERFORMANCE ANALYSIS RESULTS');
        console.log('==========================================');
        
        const { summary } = this.results;
        
        console.log(`📊 Overall Performance Score: ${summary.overall_performance_score.toFixed(1)}/100`);
        console.log(`🎯 Production Ready: ${summary.production_ready ? '✅ YES' : '❌ NO'}`);
        console.log(`🔍 Issues Found: ${summary.critical_issues} Critical, ${summary.high_issues} High, ${summary.medium_issues} Medium`);
        
        console.log('\n📈 SCENARIO RESULTS:');
        
        Object.entries(this.results.scenarios).forEach(([scenario, data]) => {
            console.log(`\n  🔬 ${scenario.toUpperCase()}:`);
            
            switch (scenario) {
                case 'cache_miss':
                    Object.entries(data).forEach(([size, result]) => {
                        const status = result.is_realistic ? '✅' : '⚠️';
                        console.log(`    ${status} ${size}: ${result.duration_ms.toFixed(2)}ms (${result.cache_hit_rate} cache hits)`);
                    });
                    break;
                    
                case 'memory_pressure':
                    const status = data.performance_acceptable ? '✅' : '❌';
                    console.log(`    ${status} Duration: ${data.duration_ms.toFixed(2)}ms, Memory growth: ${data.memory_growth_mb.toFixed(2)}MB`);
                    break;
                    
                case 'concurrent_load':
                    Object.entries(data).forEach(([concurrency, result]) => {
                        const status = result.performance_acceptable ? '✅' : '⚠️';
                        console.log(`    ${status} ${concurrency}: ${result.avg_duration_ms.toFixed(2)}ms avg, ${result.throughput_ops_per_sec.toFixed(1)} ops/sec`);
                    });
                    break;
                    
                case 'large_dataset_scaling':
                    Object.entries(data).forEach(([size, result]) => {
                        const status = result.scales_linearly ? '✅' : '⚠️';
                        console.log(`    ${status} ${size}: ${result.duration_ms.toFixed(2)}ms, ${result.throughput_records_per_sec.toFixed(0)} rec/sec`);
                    });
                    break;
                    
                case 'cache_coherence':
                    const coherenceStatus = data.cache_invalidation_works ? '✅' : '❌';
                    console.log(`    ${coherenceStatus} Cache coherence: ${data.cache_coherence_issue ? 'ISSUE DETECTED' : 'Working correctly'}`);
                    break;
                    
                case 'database_lock_contention':
                    const lockStatus = data.contention_acceptable ? '✅' : '⚠️';
                    console.log(`    ${lockStatus} ${data.total_operations} ops, ${data.failed_operations} failures, ${data.success_rate.toFixed(1)}% success`);
                    break;
                    
                case 'edge_cases':
                    Object.entries(data).forEach(([caseName, result]) => {
                        const status = result.completed_successfully && result.within_expected ? '✅' : '❌';
                        console.log(`    ${status} ${caseName}: ${result.duration_ms ? result.duration_ms.toFixed(2) + 'ms' : 'FAILED'}`);
                    });
                    break;
            }
        });
        
        if (this.results.issues.length > 0) {
            console.log('\n🚨 ISSUES IDENTIFIED:');
            this.results.issues.forEach((issue, index) => {
                const severity = issue.severity.toUpperCase();
                const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : '🟡';
                console.log(`\n  ${icon} ${severity}: ${issue.description}`);
                console.log(`     💡 Recommendation: ${issue.recommendation}`);
            });
        }
        
        if (this.results.recommendations.length > 0) {
            console.log('\n💡 OVERALL RECOMMENDATIONS:');
            this.results.recommendations.forEach((rec, index) => {
                console.log(`  ${index + 1}. ${rec}`);
            });
        }
        
        console.log('\n🔍 PRODUCTION READINESS ASSESSMENT:');
        if (summary.production_ready) {
            console.log('✅ READY FOR PRODUCTION DEPLOYMENT');
            console.log('• Performance meets production standards');
            console.log('• No critical blocking issues identified');
            console.log('• Recommended to implement monitoring in production');
        } else {
            console.log('❌ NOT READY FOR PRODUCTION DEPLOYMENT');
            console.log('• Address all identified issues before deployment');
            console.log('• Re-run benchmarks after fixes');
            console.log('• Consider load testing in staging environment');
        }
        
        console.log(`\n📄 Detailed report saved to: ${reportPath}`);
        
        return this.results;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up test databases...');
        
        for (const dbPath of this.testDatabases) {
            try {
                if (fs.existsSync(dbPath)) {
                    fs.unlinkSync(dbPath);
                }
            } catch (error) {
                console.warn(`Could not clean up ${dbPath}:`, error.message);
            }
        }
        
        console.log('✅ Cleanup completed');
    }
}

// Run the benchmark if called directly
if (require.main === module) {
    const benchmark = new RealisticPerformanceBenchmark();
    benchmark.run()
        .then(() => {
            console.log('\n🎉 Realistic performance benchmark completed!');
            const exitCode = benchmark.results.summary.production_ready ? 0 : 1;
            process.exit(exitCode);
        })
        .catch((error) => {
            console.error('\n❌ Realistic performance benchmark failed:', error);
            process.exit(1);
        });
}

module.exports = RealisticPerformanceBenchmark;