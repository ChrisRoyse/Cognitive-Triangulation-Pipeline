const { v4: uuidv4 } = require('uuid');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getCacheClient } = require('../../src/utils/cacheClient');
const TriangulatedAnalysisQueue = require('../../src/services/triangulation/TriangulatedAnalysisQueue');
const { getLogger } = require('../../src/config/logging');

const logger = getLogger('TriangulationTest');

/**
 * Production Triangulation System Test
 * Tests the complete production-ready implementation with real LLM integration
 */
class ProductionTriangulationTest {
    constructor() {
        this.testId = uuidv4();
        this.dbManager = null;
        this.queueManager = null;
        this.cacheClient = null;
        this.triangulatedQueue = null;
        this.runId = uuidv4();
    }

    async setup() {
        logger.info(`[Test] Setting up production triangulation test ${this.testId}`);
        
        // Initialize database
        this.dbManager = new DatabaseManager(':memory:'); // Use in-memory for testing
        await this.dbManager.initializeDb();
        
        // Initialize queue manager
        this.queueManager = getQueueManagerInstance();
        await this.queueManager.connect();
        
        // Initialize cache client
        this.cacheClient = getCacheClient();
        
        // Initialize triangulated analysis queue
        this.triangulatedQueue = new TriangulatedAnalysisQueue(
            this.dbManager,
            this.queueManager,
            this.cacheClient,
            {
                concurrency: 2,
                confidenceThreshold: 0.45,
                enableAutoTrigger: false, // Manual trigger for testing
                processingTimeout: 120000 // 2 minutes for test
            }
        );
        
        await this.triangulatedQueue.start();
        
        logger.info('[Test] Setup complete');
    }

    async teardown() {
        logger.info('[Test] Tearing down...');
        
        if (this.triangulatedQueue) {
            await this.triangulatedQueue.stop();
        }
        
        if (this.queueManager) {
            await this.queueManager.closeConnections();
        }
        
        if (this.dbManager) {
            this.dbManager.close();
        }
        
        logger.info('[Test] Teardown complete');
    }

    async createTestData() {
        const db = this.dbManager.getDb();
        
        // Create test file
        const fileStmt = db.prepare('INSERT INTO files (file_path, hash, status) VALUES (?, ?, ?)');
        const fileResult = fileStmt.run('/test/example.js', 'test-hash', 'processed');
        const fileId = fileResult.lastInsertRowid;
        
        // Create test POIs
        const poiStmt = db.prepare(`
            INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, run_id, semantic_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const sourcePoi = poiStmt.run(
            fileId,
            '/test/example.js',
            'UserService',
            'class',
            10,
            50,
            'Service for user management',
            this.runId,
            'UserService_class_/test/example.js'
        );
        
        const targetPoi = poiStmt.run(
            fileId,
            '/test/example.js',
            'DatabaseConnection',
            'class',
            60,
            80,
            'Database connection handler',
            this.runId,
            'DatabaseConnection_class_/test/example.js'
        );
        
        // Create low-confidence relationships
        const relStmt = db.prepare(`
            INSERT INTO relationships (source_poi_id, target_poi_id, type, file_path, status, confidence, reason, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const relationships = [
            {
                sourceId: sourcePoi.lastInsertRowid,
                targetId: targetPoi.lastInsertRowid,
                type: 'uses',
                confidence: 0.35, // Low confidence - should trigger triangulation
                reason: 'Indirect reference detected'
            },
            {
                sourceId: targetPoi.lastInsertRowid,
                targetId: sourcePoi.lastInsertRowid,
                type: 'referenced_by',
                confidence: 0.42, // Low confidence - should trigger triangulation
                reason: 'Possible dependency'
            },
            {
                sourceId: sourcePoi.lastInsertRowid,
                targetId: targetPoi.lastInsertRowid,
                type: 'depends_on',
                confidence: 0.85, // High confidence - should NOT trigger triangulation
                reason: 'Direct import statement'
            }
        ];
        
        const createdRelationships = [];
        for (const rel of relationships) {
            const result = relStmt.run(
                rel.sourceId,
                rel.targetId,
                rel.type,
                '/test/example.js',
                'PENDING',
                rel.confidence,
                rel.reason,
                this.runId
            );
            createdRelationships.push({
                id: result.lastInsertRowid,
                ...rel
            });
        }
        
        return createdRelationships;
    }

    async testTriangulatedAnalysis() {
        logger.info('[Test] Starting triangulated analysis test');
        
        // Create test data
        const relationships = await this.createTestData();
        const lowConfidenceRels = relationships.filter(r => r.confidence < 0.45);
        
        logger.info(`[Test] Created ${relationships.length} test relationships, ${lowConfidenceRels.length} with low confidence`);
        
        // Trigger triangulated analysis
        const triggerResult = await this.triangulatedQueue.triggerTriangulatedAnalysis(
            lowConfidenceRels,
            this.runId,
            'high' // High priority for testing
        );
        
        logger.info(`[Test] Triggered analysis with ID ${triggerResult.triggerId}, created ${triggerResult.jobIds.length} jobs`);
        
        // Wait for jobs to complete
        const timeout = 120000; // 2 minutes
        const startTime = Date.now();
        let completed = false;
        
        while (!completed && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
            
            const stats = await this.triangulatedQueue.getStats();
            const queueStats = stats.queueStats || {};
            
            logger.info(`[Test] Queue status - Active: ${queueStats.active || 0}, Completed: ${stats.stats.successful}, Failed: ${stats.stats.failed}`);
            
            if ((queueStats.active || 0) === 0 && (queueStats.waiting || 0) === 0) {
                completed = true;
            }
        }
        
        if (!completed) {
            throw new Error('Triangulated analysis timed out');
        }
        
        // Verify results
        const db = this.dbManager.getDb();
        
        // Check analysis sessions
        const sessions = db.prepare(`
            SELECT * FROM triangulated_analysis_sessions
            WHERE run_id = ?
        `).all(this.runId);
        
        logger.info(`[Test] Found ${sessions.length} analysis sessions`);
        
        for (const session of sessions) {
            logger.info(`[Test] Session ${session.session_id}:`, {
                status: session.status,
                initialConfidence: session.initial_confidence,
                finalConfidence: session.final_confidence,
                consensusScore: session.consensus_score,
                escalated: session.escalated_to_human
            });
            
            // Check agent results
            const agentResults = db.prepare(`
                SELECT * FROM subagent_analyses
                WHERE session_id = ?
            `).all(session.session_id);
            
            logger.info(`[Test] Found ${agentResults.length} agent analyses for session ${session.session_id}`);
            
            for (const agent of agentResults) {
                logger.info(`[Test] ${agent.agent_type} agent:`, {
                    status: agent.status,
                    confidence: agent.confidence_score,
                    evidenceStrength: agent.evidence_strength
                });
            }
        }
        
        // Check updated relationships
        const updatedRelationships = db.prepare(`
            SELECT * FROM relationships
            WHERE run_id = ? AND status LIKE '%TRIANGULATED%'
        `).all(this.runId);
        
        logger.info(`[Test] Found ${updatedRelationships.length} triangulated relationships`);
        
        // Verify stats
        const finalStats = await this.triangulatedQueue.getStats();
        logger.info('[Test] Final queue statistics:', {
            totalProcessed: finalStats.stats.totalProcessed,
            successful: finalStats.stats.successful,
            failed: finalStats.stats.failed,
            escalated: finalStats.stats.escalated,
            averageProcessingTime: `${Math.round(finalStats.stats.averageProcessingTime)}ms`,
            successRate: `${finalStats.stats.successRate.toFixed(1)}%`
        });
        
        return {
            sessions: sessions.length,
            successful: finalStats.stats.successful,
            failed: finalStats.stats.failed,
            escalated: finalStats.stats.escalated
        };
    }

    async testLLMHealthCheck() {
        logger.info('[Test] Testing LLM health check');
        
        // Get a syntactic agent to test LLM connectivity
        const SyntacticAnalysisAgent = require('../../src/services/triangulation/SyntacticAnalysisAgent');
        const agent = new SyntacticAnalysisAgent();
        
        const healthResult = await agent.llmClient.healthCheck();
        
        logger.info('[Test] LLM health check result:', healthResult);
        
        return healthResult.healthy;
    }

    async run() {
        try {
            await this.setup();
            
            // Test LLM connectivity first
            const llmHealthy = await this.testLLMHealthCheck();
            if (!llmHealthy) {
                throw new Error('LLM health check failed - ensure DEEPSEEK_API_KEY is set');
            }
            
            // Run main triangulation test
            const results = await this.testTriangulatedAnalysis();
            
            logger.info('[Test] Production triangulation test completed successfully', results);
            
            return {
                success: true,
                results
            };
            
        } catch (error) {
            logger.error('[Test] Production triangulation test failed:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            await this.teardown();
        }
    }
}

// Run test if executed directly
if (require.main === module) {
    const test = new ProductionTriangulationTest();
    test.run().then(result => {
        console.log('\n=== Test Result ===');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = ProductionTriangulationTest;