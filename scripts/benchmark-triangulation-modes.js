/**
 * Benchmark script to compare parallel vs sequential triangulation analysis
 * Measures accuracy improvements and performance metrics
 */

const { DatabaseManager } = require('../src/utils/sqliteDb');
const QueueManager = require('../src/utils/queueManager');
const redis = require('../src/utils/cacheClient');
const TriangulatedAnalysisQueue = require('../src/services/triangulation/TriangulatedAnalysisQueue');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

// Test data for benchmarking
const TEST_RELATIONSHIPS = [
    // Low confidence relationships that benefit from triangulation
    {
        id: 'test-rel-1',
        from: 'UserService',
        to: 'AuthenticationModule',
        type: 'USES',
        filePath: '/test/services/user-service.js',
        confidence: 0.35,
        reason: 'Indirect usage pattern detected'
    },
    {
        id: 'test-rel-2',
        from: 'DataProcessor',
        to: 'ValidationHelper',
        type: 'VALIDATES_WITH',
        filePath: '/test/processors/data-processor.js',
        confidence: 0.28,
        reason: 'Complex validation flow'
    },
    {
        id: 'test-rel-3',
        from: 'APIController',
        to: 'SecurityMiddleware',
        type: 'PROTECTED_BY',
        filePath: '/test/controllers/api-controller.js',
        confidence: 0.42,
        reason: 'Security relationship inferred'
    },
    {
        id: 'test-rel-4',
        from: 'CacheManager',
        to: 'RedisClient',
        type: 'DEPENDS_ON',
        filePath: '/test/cache/cache-manager.js',
        confidence: 0.38,
        reason: 'Dependency through abstraction'
    },
    {
        id: 'test-rel-5',
        from: 'EventEmitter',
        to: 'LoggingService',
        type: 'NOTIFIES',
        filePath: '/test/events/event-emitter.js',
        confidence: 0.25,
        reason: 'Event-based communication'
    },
    {
        id: 'test-rel-6',
        from: 'DatabaseModel',
        to: 'SchemaValidator',
        type: 'VALIDATED_BY',
        filePath: '/test/models/database-model.js',
        confidence: 0.33,
        reason: 'Schema validation pattern'
    }
];

// Ground truth for accuracy measurement
const GROUND_TRUTH = {
    'test-rel-1': { isValid: true, actualConfidence: 0.85 },
    'test-rel-2': { isValid: true, actualConfidence: 0.92 },
    'test-rel-3': { isValid: true, actualConfidence: 0.78 },
    'test-rel-4': { isValid: true, actualConfidence: 0.95 },
    'test-rel-5': { isValid: false, actualConfidence: 0.15 },
    'test-rel-6': { isValid: true, actualConfidence: 0.88 }
};

class TriangulationBenchmark {
    constructor() {
        this.dbManager = null;
        this.queueManager = null;
        this.results = {
            sequential: {
                totalTime: 0,
                accuracyScores: [],
                confidenceDeltas: [],
                decisionsCorrect: 0,
                escalations: 0,
                errors: 0
            },
            parallel: {
                totalTime: 0,
                accuracyScores: [],
                confidenceDeltas: [],
                decisionsCorrect: 0,
                escalations: 0,
                errors: 0
            }
        };
    }
    
    async initialize() {
        console.log(chalk.blue('🚀 Initializing benchmark environment...'));
        
        // Initialize database
        this.dbManager = new DatabaseManager({
            dbPath: path.join(__dirname, '../test-benchmark.db'),
            enableWAL: true,
            pragmaOptions: {
                journal_mode: 'WAL',
                synchronous: 'NORMAL',
                cache_size: -64000,
                temp_store: 'MEMORY'
            }
        });
        
        // Initialize queue manager
        this.queueManager = new QueueManager({
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                maxRetriesPerRequest: 3,
                enableReadyCheck: true
            }
        });
        
        // Setup test database schema
        await this.setupTestDatabase();
        
        console.log(chalk.green('✓ Benchmark environment initialized'));
    }
    
    async setupTestDatabase() {
        const db = this.dbManager.getDb();
        
        // Create necessary tables
        db.exec(`
            CREATE TABLE IF NOT EXISTS pois (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                name TEXT NOT NULL,
                type TEXT,
                file_path TEXT,
                start_line INTEGER,
                end_line INTEGER,
                description TEXT,
                is_exported BOOLEAN DEFAULT 0,
                semantic_id TEXT,
                llm_output TEXT,
                hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                source_poi_id INTEGER,
                target_poi_id INTEGER,
                type TEXT,
                file_path TEXT,
                status TEXT DEFAULT 'PENDING',
                confidence REAL,
                reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (source_poi_id) REFERENCES pois (id),
                FOREIGN KEY (target_poi_id) REFERENCES pois (id)
            );
            
            CREATE TABLE IF NOT EXISTS triangulated_analysis_sessions (
                session_id TEXT PRIMARY KEY,
                relationship_id INTEGER,
                run_id TEXT,
                status TEXT,
                initial_confidence REAL,
                final_confidence REAL,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS agent_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                agent_type TEXT,
                confidence_score REAL,
                evidence_strength REAL,
                reasoning TEXT,
                analysis_data TEXT,
                status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id)
            );
            
            CREATE TABLE IF NOT EXISTS consensus_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                final_decision TEXT,
                weighted_consensus REAL,
                agreement_level REAL,
                conflict_count INTEGER,
                decision_reasoning TEXT,
                requires_human_review BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id)
            );
        `);
        
        // Insert test POIs and relationships
        const runId = 'benchmark-run-' + Date.now();
        
        for (const rel of TEST_RELATIONSHIPS) {
            // Insert source POI
            const sourceInsert = db.prepare(`
                INSERT INTO pois (run_id, name, type, file_path, description)
                VALUES (?, ?, 'class', ?, ?)
            `).run(runId, rel.from, rel.filePath, `Test POI: ${rel.from}`);
            
            // Insert target POI
            const targetInsert = db.prepare(`
                INSERT INTO pois (run_id, name, type, file_path, description)
                VALUES (?, ?, 'class', ?, ?)
            `).run(runId, rel.to, rel.filePath, `Test POI: ${rel.to}`);
            
            // Insert relationship
            db.prepare(`
                INSERT INTO relationships (
                    run_id, source_poi_id, target_poi_id, type, 
                    file_path, confidence, reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                runId,
                sourceInsert.lastInsertRowid,
                targetInsert.lastInsertRowid,
                rel.type,
                rel.filePath,
                rel.confidence,
                rel.reason
            );
            
            // Store the database ID for later use
            rel.dbId = db.lastInsertRowid;
        }
        
        this.runId = runId;
    }
    
    async runBenchmark() {
        console.log(chalk.blue('\n📊 Starting triangulation mode benchmarks...\n'));
        
        // Run sequential mode benchmark
        await this.benchmarkMode('sequential');
        
        // Clean up between runs
        await this.cleanupAnalysisSessions();
        
        // Run parallel mode benchmark
        await this.benchmarkMode('parallel');
        
        // Generate and display results
        this.displayResults();
    }
    
    async benchmarkMode(mode) {
        console.log(chalk.yellow(`\n🔄 Running ${mode.toUpperCase()} mode benchmark...`));
        
        const startTime = Date.now();
        
        // Create triangulated analysis queue
        const queue = new TriangulatedAnalysisQueue(
            this.dbManager,
            this.queueManager,
            redis,
            {
                coordinationMode: mode,
                enableAdvancedOrchestration: mode === 'parallel',
                maxParallelAgents: 6,
                concurrency: mode === 'parallel' ? 3 : 1
            }
        );
        
        await queue.start();
        
        try {
            // Process each test relationship
            for (const rel of TEST_RELATIONSHIPS) {
                console.log(chalk.gray(`  Processing ${rel.from} -> ${rel.to}`));
                
                const analysisStart = Date.now();
                
                try {
                    // Trigger triangulated analysis
                    const result = await this.analyzeRelationship(queue, rel);
                    
                    // Measure accuracy
                    const accuracy = this.measureAccuracy(rel, result);
                    this.results[mode].accuracyScores.push(accuracy);
                    
                    // Track decisions
                    if (result.decision === 'CORRECT') {
                        this.results[mode].decisionsCorrect++;
                    } else if (result.decision === 'ESCALATE') {
                        this.results[mode].escalations++;
                    }
                    
                    const analysisTime = Date.now() - analysisStart;
                    console.log(chalk.gray(`    Completed in ${analysisTime}ms - Accuracy: ${(accuracy * 100).toFixed(1)}%`));
                    
                } catch (error) {
                    console.error(chalk.red(`    Error: ${error.message}`));
                    this.results[mode].errors++;
                }
            }
            
        } finally {
            await queue.stop();
        }
        
        this.results[mode].totalTime = Date.now() - startTime;
    }
    
    async analyzeRelationship(queue, relationship) {
        // Simulate the triangulated analysis process
        const db = this.dbManager.getDb();
        
        // Get the actual relationship from database
        const dbRel = db.prepare(`
            SELECT * FROM relationships WHERE id = ?
        `).get(relationship.dbId);
        
        // Trigger analysis
        await queue.triggerTriangulatedAnalysis([{
            id: dbRel.id,
            confidence: dbRel.confidence
        }], this.runId, 'normal');
        
        // Wait for processing (with timeout)
        const maxWait = 30000; // 30 seconds
        const checkInterval = 100;
        let waited = 0;
        
        while (waited < maxWait) {
            const session = db.prepare(`
                SELECT tas.*, cd.final_decision, cd.weighted_consensus
                FROM triangulated_analysis_sessions tas
                LEFT JOIN consensus_decisions cd ON tas.session_id = cd.session_id
                WHERE tas.relationship_id = ? AND tas.status = 'COMPLETED'
                ORDER BY tas.created_at DESC
                LIMIT 1
            `).get(dbRel.id);
            
            if (session) {
                const updatedRel = db.prepare(`
                    SELECT confidence, status FROM relationships WHERE id = ?
                `).get(dbRel.id);
                
                return {
                    sessionId: session.session_id,
                    initialConfidence: relationship.confidence,
                    finalConfidence: updatedRel.confidence,
                    status: updatedRel.status,
                    decision: this.evaluateDecision(relationship.id, session.final_decision, updatedRel.confidence)
                };
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;
        }
        
        throw new Error('Analysis timeout');
    }
    
    measureAccuracy(relationship, result) {
        const groundTruth = GROUND_TRUTH[relationship.id];
        if (!groundTruth) return 0;
        
        // Calculate confidence delta
        const confidenceDelta = Math.abs(result.finalConfidence - groundTruth.actualConfidence);
        this.results[result.mode || 'sequential'].confidenceDeltas.push(confidenceDelta);
        
        // Calculate accuracy score (inverse of delta, normalized)
        const accuracy = 1 - (confidenceDelta / 1.0); // Max delta is 1.0
        
        return Math.max(0, accuracy);
    }
    
    evaluateDecision(relationshipId, decision, finalConfidence) {
        const groundTruth = GROUND_TRUTH[relationshipId];
        if (!groundTruth) return 'UNKNOWN';
        
        // Determine if the decision was correct
        const isValid = finalConfidence >= 0.5;
        const correctDecision = isValid === groundTruth.isValid;
        
        if (decision === 'ESCALATE') {
            return 'ESCALATE';
        }
        
        return correctDecision ? 'CORRECT' : 'INCORRECT';
    }
    
    async cleanupAnalysisSessions() {
        const db = this.dbManager.getDb();
        
        // Clean up analysis sessions between runs
        db.prepare('DELETE FROM triangulated_analysis_sessions').run();
        db.prepare('DELETE FROM agent_analyses').run();
        db.prepare('DELETE FROM consensus_decisions').run();
        
        // Reset relationship statuses
        db.prepare(`
            UPDATE relationships 
            SET status = 'PENDING', confidence = confidence 
            WHERE run_id = ?
        `).run(this.runId);
    }
    
    displayResults() {
        console.log(chalk.blue('\n\n📊 BENCHMARK RESULTS\n'));
        console.log(chalk.white('═'.repeat(80)));
        
        // Sequential Results
        const seqResults = this.results.sequential;
        const seqAvgAccuracy = seqResults.accuracyScores.reduce((a, b) => a + b, 0) / seqResults.accuracyScores.length;
        const seqAvgDelta = seqResults.confidenceDeltas.reduce((a, b) => a + b, 0) / seqResults.confidenceDeltas.length;
        
        console.log(chalk.yellow('\n📋 SEQUENTIAL ANALYSIS:'));
        console.log(chalk.white(`  • Total Time: ${seqResults.totalTime}ms`));
        console.log(chalk.white(`  • Average Accuracy: ${(seqAvgAccuracy * 100).toFixed(1)}%`));
        console.log(chalk.white(`  • Average Confidence Delta: ${seqAvgDelta.toFixed(3)}`));
        console.log(chalk.white(`  • Correct Decisions: ${seqResults.decisionsCorrect}/${TEST_RELATIONSHIPS.length}`));
        console.log(chalk.white(`  • Escalations: ${seqResults.escalations}`));
        console.log(chalk.white(`  • Errors: ${seqResults.errors}`));
        console.log(chalk.white(`  • Processing Speed: ${(TEST_RELATIONSHIPS.length / (seqResults.totalTime / 1000)).toFixed(2)} relationships/sec`));
        
        // Parallel Results
        const parResults = this.results.parallel;
        const parAvgAccuracy = parResults.accuracyScores.reduce((a, b) => a + b, 0) / parResults.accuracyScores.length;
        const parAvgDelta = parResults.confidenceDeltas.reduce((a, b) => a + b, 0) / parResults.confidenceDeltas.length;
        
        console.log(chalk.cyan('\n🚀 PARALLEL ANALYSIS:'));
        console.log(chalk.white(`  • Total Time: ${parResults.totalTime}ms`));
        console.log(chalk.white(`  • Average Accuracy: ${(parAvgAccuracy * 100).toFixed(1)}%`));
        console.log(chalk.white(`  • Average Confidence Delta: ${parAvgDelta.toFixed(3)}`));
        console.log(chalk.white(`  • Correct Decisions: ${parResults.decisionsCorrect}/${TEST_RELATIONSHIPS.length}`));
        console.log(chalk.white(`  • Escalations: ${parResults.escalations}`));
        console.log(chalk.white(`  • Errors: ${parResults.errors}`));
        console.log(chalk.white(`  • Processing Speed: ${(TEST_RELATIONSHIPS.length / (parResults.totalTime / 1000)).toFixed(2)} relationships/sec`));
        
        // Comparison
        console.log(chalk.green('\n📈 IMPROVEMENTS:'));
        const accuracyImprovement = ((parAvgAccuracy - seqAvgAccuracy) / seqAvgAccuracy) * 100;
        const speedImprovement = ((seqResults.totalTime - parResults.totalTime) / seqResults.totalTime) * 100;
        const deltaImprovement = ((seqAvgDelta - parAvgDelta) / seqAvgDelta) * 100;
        const escalationReduction = ((seqResults.escalations - parResults.escalations) / seqResults.escalations) * 100;
        
        console.log(chalk.white(`  • Accuracy Improvement: ${accuracyImprovement > 0 ? '+' : ''}${accuracyImprovement.toFixed(1)}%`));
        console.log(chalk.white(`  • Speed Improvement: ${speedImprovement > 0 ? '+' : ''}${speedImprovement.toFixed(1)}%`));
        console.log(chalk.white(`  • Confidence Delta Reduction: ${deltaImprovement > 0 ? '+' : ''}${deltaImprovement.toFixed(1)}%`));
        console.log(chalk.white(`  • Escalation Reduction: ${escalationReduction > 0 ? '+' : ''}${escalationReduction.toFixed(1)}%`));
        
        // Summary
        console.log(chalk.blue('\n📌 SUMMARY:'));
        if (parAvgAccuracy > seqAvgAccuracy && parResults.totalTime < seqResults.totalTime) {
            console.log(chalk.green('  ✅ Parallel coordination delivers superior results!'));
            console.log(chalk.white(`     - ${accuracyImprovement.toFixed(1)}% more accurate`));
            console.log(chalk.white(`     - ${speedImprovement.toFixed(1)}% faster processing`));
            console.log(chalk.white(`     - ${escalationReduction.toFixed(1)}% fewer human escalations`));
        } else {
            console.log(chalk.yellow('  ⚠️  Mixed results - further optimization needed'));
        }
        
        console.log(chalk.white('\n' + '═'.repeat(80) + '\n'));
    }
    
    async cleanup() {
        console.log(chalk.blue('🧹 Cleaning up...'));
        
        // Close connections
        if (this.queueManager) {
            await this.queueManager.closeConnections();
        }
        
        // Delete test database
        try {
            await fs.unlink(path.join(__dirname, '../test-benchmark.db'));
            await fs.unlink(path.join(__dirname, '../test-benchmark.db-wal'));
            await fs.unlink(path.join(__dirname, '../test-benchmark.db-shm'));
        } catch (error) {
            // Ignore cleanup errors
        }
        
        console.log(chalk.green('✓ Cleanup complete'));
    }
}

// Run the benchmark
async function main() {
    const benchmark = new TriangulationBenchmark();
    
    try {
        await benchmark.initialize();
        await benchmark.runBenchmark();
    } catch (error) {
        console.error(chalk.red('\n❌ Benchmark failed:'), error);
        process.exit(1);
    } finally {
        await benchmark.cleanup();
    }
}

// Execute if run directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TriangulationBenchmark;