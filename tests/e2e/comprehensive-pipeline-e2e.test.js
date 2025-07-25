const { describe, it, before, after, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Pipeline components
const { CognitiveTriangulationPipeline } = require('../../src/main');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const neo4jDriver = require('../../src/utils/neo4jDriver');
const { PipelineConfig } = require('../../src/config/pipelineConfig');

// Test utilities
const { MetricsCollector } = require('./utils/MetricsCollector');
const { GroundTruthValidator } = require('./utils/GroundTruthValidator');
const { PerformanceMonitor } = require('./utils/PerformanceMonitor');
const { AccuracyCalculator } = require('./utils/AccuracyCalculator');

describe('Comprehensive End-to-End Pipeline Testing', function() {
    this.timeout(30 * 60 * 1000); // 30 minutes for full pipeline tests
    
    let pipeline;
    let dbManager;
    let metricsCollector;
    let groundTruthValidator;
    let performanceMonitor;
    let accuracyCalculator;
    let testRunId;
    let testDbPath;
    let groundTruthData;
    
    before(async function() {
        // Load ground truth data
        const groundTruthPath = path.join(__dirname, 'ground-truth', 'polyglot-relationships.json');
        groundTruthData = JSON.parse(await fs.readFile(groundTruthPath, 'utf8'));
        
        // Initialize test infrastructure
        testRunId = uuidv4();
        testDbPath = path.join(__dirname, 'temp', `test_${testRunId}.db`);
        
        // Create temp directory
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        
        // Initialize metrics and monitoring
        metricsCollector = new MetricsCollector(testRunId);
        groundTruthValidator = new GroundTruthValidator(groundTruthData);
        performanceMonitor = new PerformanceMonitor();
        accuracyCalculator = new AccuracyCalculator();
        
        // Clean Neo4j test data
        const session = neo4jDriver.session();
        try {
            await session.run('MATCH (n:TestNode) DETACH DELETE n');
        } finally {
            await session.close();
        }
    });
    
    after(async function() {
        // Cleanup
        if (pipeline) {
            await pipeline.shutdown();
        }
        
        // Remove test database
        try {
            await fs.unlink(testDbPath);
        } catch (err) {
            // Ignore if already deleted
        }
        
        // Generate test report
        await generateTestReport();
    });
    
    describe('1. Complete Pipeline Integration Test', function() {
        let pipelineResults;
        
        it('should successfully process polyglot-test directory through all pipeline stages', async function() {
            // Start performance monitoring
            performanceMonitor.startMonitoring('complete_pipeline');
            
            // Configure pipeline for testing
            const config = PipelineConfig.createDefault();
            config.database.sqlite.path = testDbPath;
            config.environment = 'test';
            config.confidence.batchAnalysisThreshold = 0.8;
            config.confidence.individualAnalysisThreshold = 0.6;
            config.confidence.humanEscalationThreshold = 0.4;
            
            // Initialize pipeline
            pipeline = new CognitiveTriangulationPipeline(
                path.join(process.cwd(), 'polyglot-test'),
                testDbPath,
                { pipelineConfig: config }
            );
            
            // Track pipeline events
            const pipelineEvents = [];
            pipeline.on('stage:complete', (stage) => {
                pipelineEvents.push({
                    stage: stage.name,
                    duration: stage.duration,
                    timestamp: new Date()
                });
                metricsCollector.recordStageCompletion(stage);
            });
            
            pipeline.on('analysis:mode', (mode) => {
                metricsCollector.recordAnalysisMode(mode);
            });
            
            // Run pipeline
            const startTime = Date.now();
            pipelineResults = await pipeline.run();
            const endTime = Date.now();
            
            // Stop monitoring
            const performanceMetrics = performanceMonitor.stopMonitoring('complete_pipeline');
            
            // Basic assertions
            expect(pipelineResults).to.have.property('success', true);
            expect(pipelineResults).to.have.property('runId');
            expect(pipelineResults).to.have.property('statistics');
            
            // Verify all stages completed
            const expectedStages = [
                'discovery',
                'fileAnalysis',
                'directoryResolution',
                'directoryAggregation',
                'relationshipResolution',
                'globalAnalysis',
                'validation',
                'reconciliation',
                'graphBuilding'
            ];
            
            const completedStages = pipelineEvents.map(e => e.stage);
            for (const stage of expectedStages) {
                expect(completedStages).to.include(stage);
            }
            
            // Performance assertions
            const totalDuration = endTime - startTime;
            expect(totalDuration).to.be.lessThan(20 * 60 * 1000); // 20 minutes max
            
            // Memory usage check
            expect(performanceMetrics.peakMemoryUsage).to.be.lessThan(2 * 1024 * 1024 * 1024); // 2GB max
            
            // Store results for further analysis
            metricsCollector.recordPipelineRun({
                duration: totalDuration,
                stages: pipelineEvents,
                performance: performanceMetrics,
                results: pipelineResults
            });
        });
        
        it('should properly escalate analysis based on confidence thresholds', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Query analysis results
            const analysisResults = await dbManager.db.all(`
                SELECT 
                    ar.*,
                    am.mode_type
                FROM analysis_results ar
                JOIN analysis_modes am ON ar.analysis_mode_id = am.id
                WHERE ar.run_id = ?
            `, [pipelineResults.runId]);
            
            // Group by analysis mode
            const resultsByMode = analysisResults.reduce((acc, result) => {
                acc[result.mode_type] = (acc[result.mode_type] || 0) + 1;
                return acc;
            }, {});
            
            // Verify escalation logic
            expect(resultsByMode).to.have.property('batch');
            expect(resultsByMode).to.have.property('individual');
            
            // Check confidence-based escalation
            const lowConfidenceResults = analysisResults.filter(r => r.confidence_score < 0.8);
            const escalatedResults = analysisResults.filter(r => 
                r.confidence_score < 0.8 && r.mode_type !== 'batch'
            );
            
            // At least some results should have been escalated
            expect(escalatedResults.length).to.be.greaterThan(0);
            
            // Triangulated analysis should have higher confidence
            const triangulatedResults = analysisResults.filter(r => r.mode_type === 'triangulated');
            if (triangulatedResults.length > 0) {
                const avgTriangulatedConfidence = triangulatedResults.reduce(
                    (sum, r) => sum + r.confidence_score, 0
                ) / triangulatedResults.length;
                
                const avgBatchConfidence = analysisResults
                    .filter(r => r.mode_type === 'batch')
                    .reduce((sum, r) => sum + r.confidence_score, 0) / 
                    resultsByMode.batch;
                
                expect(avgTriangulatedConfidence).to.be.greaterThan(avgBatchConfidence);
            }
            
            await dbManager.close();
        });
        
        it('should maintain data flow integrity through all components', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Verify data consistency across tables
            const fileCounts = await dbManager.db.get(`
                SELECT COUNT(*) as count FROM code_files WHERE run_id = ?
            `, [pipelineResults.runId]);
            
            const poiCounts = await dbManager.db.get(`
                SELECT COUNT(*) as count FROM points_of_interest WHERE run_id = ?
            `, [pipelineResults.runId]);
            
            const relationshipCounts = await dbManager.db.get(`
                SELECT COUNT(*) as count FROM code_relationships WHERE run_id = ?
            `, [pipelineResults.runId]);
            
            // All files should have been processed
            expect(fileCounts.count).to.be.greaterThan(0);
            expect(poiCounts.count).to.be.greaterThan(0);
            expect(relationshipCounts.count).to.be.greaterThan(0);
            
            // Verify Neo4j data
            const session = neo4jDriver.session();
            try {
                const neo4jResult = await session.run(`
                    MATCH (n:Entity)-[r:RELATES_TO]->(m:Entity)
                    WHERE n.runId = $runId
                    RETURN COUNT(r) as count
                `, { runId: pipelineResults.runId });
                
                const neo4jCount = neo4jResult.records[0].get('count').toNumber();
                expect(neo4jCount).to.be.greaterThan(0);
                
                // Neo4j relationships should roughly match SQLite relationships
                expect(Math.abs(neo4jCount - relationshipCounts.count)).to.be.lessThan(
                    relationshipCounts.count * 0.1 // Within 10% tolerance
                );
            } finally {
                await session.close();
            }
            
            await dbManager.close();
        });
    });
    
    describe('2. Accuracy Metrics and Benchmarking', function() {
        let detectedRelationships;
        let accuracyMetrics;
        
        before(async function() {
            // Extract detected relationships from database
            const dbManager = new DatabaseManager(testDbPath);
            
            detectedRelationships = await dbManager.db.all(`
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
            `, [pipeline.runId]);
            
            await dbManager.close();
        });
        
        it('should achieve ≥95% overall accuracy on ground truth dataset', async function() {
            // Compare detected relationships with ground truth
            const comparisonResults = groundTruthValidator.compareRelationships(
                detectedRelationships,
                groundTruthData.relationships
            );
            
            accuracyMetrics = accuracyCalculator.calculateMetrics(comparisonResults);
            
            // Log detailed metrics
            console.log('\n📊 Accuracy Metrics:');
            console.log(`  - Precision: ${(accuracyMetrics.precision * 100).toFixed(2)}%`);
            console.log(`  - Recall: ${(accuracyMetrics.recall * 100).toFixed(2)}%`);
            console.log(`  - F1 Score: ${(accuracyMetrics.f1Score * 100).toFixed(2)}%`);
            console.log(`  - Accuracy: ${(accuracyMetrics.accuracy * 100).toFixed(2)}%`);
            
            // Assert accuracy requirements
            expect(accuracyMetrics.accuracy).to.be.at.least(0.95);
            
            // Store metrics
            metricsCollector.recordAccuracyMetrics(accuracyMetrics);
        });
        
        it('should show improved accuracy with triangulated analysis', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Get relationships by analysis mode
            const relationshipsByMode = await dbManager.db.all(`
                SELECT 
                    cr.*,
                    am.mode_type,
                    ar.confidence_score
                FROM code_relationships cr
                JOIN analysis_results ar ON cr.source_poi_id = ar.poi_id
                JOIN analysis_modes am ON ar.analysis_mode_id = am.id
                WHERE cr.run_id = ?
            `, [pipeline.runId]);
            
            // Calculate accuracy by mode
            const modeAccuracy = {};
            const modes = ['batch', 'individual', 'triangulated'];
            
            for (const mode of modes) {
                const modeRelationships = relationshipsByMode.filter(r => r.mode_type === mode);
                if (modeRelationships.length > 0) {
                    const comparison = groundTruthValidator.compareRelationships(
                        modeRelationships,
                        groundTruthData.relationships
                    );
                    modeAccuracy[mode] = accuracyCalculator.calculateMetrics(comparison);
                }
            }
            
            // Triangulated should have highest accuracy
            if (modeAccuracy.triangulated && modeAccuracy.individual) {
                expect(modeAccuracy.triangulated.accuracy).to.be.at.least(0.98);
                expect(modeAccuracy.triangulated.accuracy).to.be.greaterThan(
                    modeAccuracy.individual.accuracy
                );
            }
            
            await dbManager.close();
        });
        
        it('should correctly identify cross-language relationships', async function() {
            // Filter for cross-language relationships
            const crossLangDetected = detectedRelationships.filter(r => {
                const sourceExt = path.extname(r.source_path);
                const targetExt = path.extname(r.target_path);
                return sourceExt !== targetExt;
            });
            
            const crossLangGroundTruth = groundTruthData.relationships.filter(
                r => r.category === 'cross_language'
            );
            
            const crossLangComparison = groundTruthValidator.compareRelationships(
                crossLangDetected,
                crossLangGroundTruth
            );
            
            const crossLangMetrics = accuracyCalculator.calculateMetrics(crossLangComparison);
            
            // Cross-language relationships are harder, so allow slightly lower accuracy
            expect(crossLangMetrics.precision).to.be.at.least(0.85);
            expect(crossLangMetrics.recall).to.be.at.least(0.85);
        });
    });
    
    describe('3. Performance and Scalability Testing', function() {
        it('should process files with acceptable throughput', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Get processing metrics
            const fileCount = await dbManager.db.get(`
                SELECT COUNT(*) as count FROM code_files WHERE run_id = ?
            `, [pipeline.runId]);
            
            const relationshipCount = await dbManager.db.get(`
                SELECT COUNT(*) as count FROM code_relationships WHERE run_id = ?
            `, [pipeline.runId]);
            
            const totalDuration = pipelineResults.statistics.duration;
            
            // Calculate throughput
            const filesPerMinute = (fileCount.count / totalDuration) * 60 * 1000;
            const relationshipsPerMinute = (relationshipCount.count / totalDuration) * 60 * 1000;
            
            console.log('\n⚡ Performance Metrics:');
            console.log(`  - Files processed: ${fileCount.count}`);
            console.log(`  - Relationships found: ${relationshipCount.count}`);
            console.log(`  - Files/minute: ${filesPerMinute.toFixed(2)}`);
            console.log(`  - Relationships/minute: ${relationshipsPerMinute.toFixed(2)}`);
            
            // Performance assertions
            expect(filesPerMinute).to.be.at.least(5); // At least 5 files per minute
            expect(relationshipsPerMinute).to.be.at.least(10); // At least 10 relationships per minute
            
            await dbManager.close();
        });
        
        it('should maintain acceptable memory usage throughout processing', async function() {
            const memorySnapshots = performanceMonitor.getMemorySnapshots('complete_pipeline');
            
            // Analyze memory usage pattern
            const peakMemory = Math.max(...memorySnapshots.map(s => s.heapUsed));
            const avgMemory = memorySnapshots.reduce((sum, s) => sum + s.heapUsed, 0) / memorySnapshots.length;
            
            console.log('\n💾 Memory Usage:');
            console.log(`  - Peak: ${(peakMemory / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  - Average: ${(avgMemory / 1024 / 1024).toFixed(2)} MB`);
            
            // Memory assertions
            expect(peakMemory).to.be.lessThan(2 * 1024 * 1024 * 1024); // Less than 2GB
            expect(avgMemory).to.be.lessThan(1 * 1024 * 1024 * 1024); // Average less than 1GB
            
            // Check for memory leaks (memory should stabilize)
            const lastQuarter = memorySnapshots.slice(-Math.floor(memorySnapshots.length / 4));
            const memoryVariance = calculateVariance(lastQuarter.map(s => s.heapUsed));
            const coefficientOfVariation = Math.sqrt(memoryVariance) / avgMemory;
            
            expect(coefficientOfVariation).to.be.lessThan(0.2); // Less than 20% variation
        });
        
        it('should handle concurrent operations efficiently', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Analyze queue processing metrics
            const queueMetrics = await dbManager.db.all(`
                SELECT 
                    queue_name,
                    COUNT(*) as job_count,
                    AVG(processing_time) as avg_time,
                    MAX(processing_time) as max_time,
                    MIN(processing_time) as min_time
                FROM job_processing_metrics
                WHERE run_id = ?
                GROUP BY queue_name
            `, [pipeline.runId]);
            
            console.log('\n🔄 Queue Processing Metrics:');
            queueMetrics.forEach(metric => {
                console.log(`  ${metric.queue_name}:`);
                console.log(`    - Jobs: ${metric.job_count}`);
                console.log(`    - Avg time: ${metric.avg_time?.toFixed(2) || 'N/A'} ms`);
                console.log(`    - Max time: ${metric.max_time?.toFixed(2) || 'N/A'} ms`);
            });
            
            // Verify concurrent processing benefits
            const fileAnalysisQueue = queueMetrics.find(m => m.queue_name === 'fileAnalysis');
            if (fileAnalysisQueue && fileAnalysisQueue.job_count > 10) {
                // With concurrency, average time should be reasonable
                expect(fileAnalysisQueue.avg_time).to.be.lessThan(5000); // Less than 5 seconds per file
            }
            
            await dbManager.close();
        });
    });
    
    describe('4. Quality Assurance and Validation', function() {
        it('should have confidence scores that correlate with accuracy', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Get relationships with confidence scores
            const relationshipsWithConfidence = await dbManager.db.all(`
                SELECT 
                    cr.*,
                    ar.confidence_score,
                    sf.file_path as source_path,
                    tf.file_path as target_path
                FROM code_relationships cr
                JOIN analysis_results ar ON cr.source_poi_id = ar.poi_id
                JOIN points_of_interest sp ON cr.source_poi_id = sp.id
                JOIN points_of_interest tp ON cr.target_poi_id = tp.id
                JOIN code_files sf ON sp.file_id = sf.id
                JOIN code_files tf ON tp.file_id = tf.id
                WHERE cr.run_id = ?
                ORDER BY ar.confidence_score DESC
            `, [pipeline.runId]);
            
            // Group by confidence buckets
            const confidenceBuckets = {
                high: relationshipsWithConfidence.filter(r => r.confidence_score >= 0.9),
                medium: relationshipsWithConfidence.filter(r => r.confidence_score >= 0.7 && r.confidence_score < 0.9),
                low: relationshipsWithConfidence.filter(r => r.confidence_score < 0.7)
            };
            
            // Calculate accuracy for each bucket
            const bucketAccuracy = {};
            for (const [bucket, relationships] of Object.entries(confidenceBuckets)) {
                if (relationships.length > 0) {
                    const comparison = groundTruthValidator.compareRelationships(
                        relationships,
                        groundTruthData.relationships
                    );
                    bucketAccuracy[bucket] = accuracyCalculator.calculateMetrics(comparison).precision;
                }
            }
            
            console.log('\n🎯 Confidence-Accuracy Correlation:');
            console.log(`  - High confidence (≥0.9): ${(bucketAccuracy.high * 100).toFixed(2)}% precision`);
            console.log(`  - Medium confidence (0.7-0.9): ${(bucketAccuracy.medium * 100).toFixed(2)}% precision`);
            console.log(`  - Low confidence (<0.7): ${(bucketAccuracy.low * 100).toFixed(2)}% precision`);
            
            // Verify correlation
            if (bucketAccuracy.high && bucketAccuracy.medium) {
                expect(bucketAccuracy.high).to.be.greaterThan(bucketAccuracy.medium);
            }
            if (bucketAccuracy.medium && bucketAccuracy.low) {
                expect(bucketAccuracy.medium).to.be.greaterThan(bucketAccuracy.low);
            }
            
            await dbManager.close();
        });
        
        it('should achieve low human escalation rate', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Count escalations
            const escalationStats = await dbManager.db.get(`
                SELECT 
                    COUNT(*) as total_results,
                    SUM(CASE WHEN confidence_score < ? THEN 1 ELSE 0 END) as escalated,
                    AVG(confidence_score) as avg_confidence
                FROM analysis_results
                WHERE run_id = ?
            `, [0.4, pipeline.runId]); // 0.4 is the escalation threshold
            
            const escalationRate = escalationStats.escalated / escalationStats.total_results;
            
            console.log('\n👤 Human Escalation Metrics:');
            console.log(`  - Total analysis results: ${escalationStats.total_results}`);
            console.log(`  - Escalated for review: ${escalationStats.escalated}`);
            console.log(`  - Escalation rate: ${(escalationRate * 100).toFixed(2)}%`);
            console.log(`  - Average confidence: ${escalationStats.avg_confidence.toFixed(3)}`);
            
            // Assert escalation rate is within target
            expect(escalationRate).to.be.at.most(0.02); // ≤ 2% escalation rate
            
            await dbManager.close();
        });
        
        it('should handle edge cases gracefully', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Check for various edge cases
            const edgeCaseChecks = await dbManager.db.all(`
                SELECT 
                    'empty_files' as check_type,
                    COUNT(*) as count
                FROM code_files
                WHERE file_size = 0 AND run_id = ?
                
                UNION ALL
                
                SELECT 
                    'self_relationships' as check_type,
                    COUNT(*) as count
                FROM code_relationships
                WHERE source_poi_id = target_poi_id AND run_id = ?
                
                UNION ALL
                
                SELECT 
                    'orphaned_pois' as check_type,
                    COUNT(*) as count
                FROM points_of_interest p
                WHERE NOT EXISTS (
                    SELECT 1 FROM code_relationships cr
                    WHERE cr.source_poi_id = p.id OR cr.target_poi_id = p.id
                ) AND p.run_id = ?
            `, [pipeline.runId, pipeline.runId, pipeline.runId]);
            
            console.log('\n🔍 Edge Case Handling:');
            edgeCaseChecks.forEach(check => {
                console.log(`  - ${check.check_type}: ${check.count}`);
            });
            
            // Verify edge cases are handled
            const selfRelationships = edgeCaseChecks.find(c => c.check_type === 'self_relationships');
            expect(selfRelationships.count).to.equal(0); // No self-relationships
            
            await dbManager.close();
        });
        
        it('should validate triangulation improves accuracy as expected', async function() {
            const dbManager = new DatabaseManager(testDbPath);
            
            // Get triangulated results
            const triangulationStats = await dbManager.db.all(`
                SELECT 
                    am.mode_type,
                    COUNT(*) as count,
                    AVG(ar.confidence_score) as avg_confidence,
                    MIN(ar.confidence_score) as min_confidence,
                    MAX(ar.confidence_score) as max_confidence
                FROM analysis_results ar
                JOIN analysis_modes am ON ar.analysis_mode_id = am.id
                WHERE ar.run_id = ?
                GROUP BY am.mode_type
            `, [pipeline.runId]);
            
            console.log('\n🔺 Triangulation Analysis:');
            triangulationStats.forEach(stat => {
                console.log(`  ${stat.mode_type}:`);
                console.log(`    - Count: ${stat.count}`);
                console.log(`    - Avg confidence: ${stat.avg_confidence.toFixed(3)}`);
                console.log(`    - Range: ${stat.min_confidence.toFixed(3)} - ${stat.max_confidence.toFixed(3)}`);
            });
            
            // Find triangulated mode stats
            const triangulated = triangulationStats.find(s => s.mode_type === 'triangulated');
            const individual = triangulationStats.find(s => s.mode_type === 'individual');
            
            if (triangulated && individual) {
                // Triangulated should have higher average confidence
                expect(triangulated.avg_confidence).to.be.greaterThan(individual.avg_confidence);
                
                // Triangulated should have less variance (more stable)
                const triangulatedRange = triangulated.max_confidence - triangulated.min_confidence;
                const individualRange = individual.max_confidence - individual.min_confidence;
                expect(triangulatedRange).to.be.lessThan(individualRange);
            }
            
            await dbManager.close();
        });
    });
    
    // Helper function to generate comprehensive test report
    async function generateTestReport() {
        const report = {
            testRunId,
            timestamp: new Date().toISOString(),
            summary: {
                overallAccuracy: accuracyMetrics?.accuracy || 0,
                precision: accuracyMetrics?.precision || 0,
                recall: accuracyMetrics?.recall || 0,
                f1Score: accuracyMetrics?.f1Score || 0,
                processingTime: pipelineResults?.statistics?.duration || 0,
                escalationRate: metricsCollector.getEscalationRate(),
                peakMemoryUsage: performanceMonitor.getPeakMemory('complete_pipeline')
            },
            detailedMetrics: metricsCollector.getAllMetrics(),
            recommendations: generateRecommendations()
        };
        
        const reportPath = path.join(__dirname, 'reports', `e2e-test-report-${testRunId}.json`);
        await fs.mkdir(path.join(__dirname, 'reports'), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`\n📄 Test report generated: ${reportPath}`);
    }
    
    function generateRecommendations() {
        const recommendations = [];
        
        if (accuracyMetrics?.accuracy < 0.95) {
            recommendations.push({
                type: 'accuracy',
                severity: 'high',
                message: 'Overall accuracy below target. Consider tuning confidence thresholds or improving prompts.'
            });
        }
        
        const escalationRate = metricsCollector.getEscalationRate();
        if (escalationRate > 0.02) {
            recommendations.push({
                type: 'escalation',
                severity: 'medium',
                message: 'Human escalation rate exceeds target. Review low-confidence cases for patterns.'
            });
        }
        
        const peakMemory = performanceMonitor.getPeakMemory('complete_pipeline');
        if (peakMemory > 1.5 * 1024 * 1024 * 1024) {
            recommendations.push({
                type: 'memory',
                severity: 'medium',
                message: 'High memory usage detected. Consider optimizing batch sizes or implementing streaming.'
            });
        }
        
        return recommendations;
    }
    
    function calculateVariance(values) {
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    }
});