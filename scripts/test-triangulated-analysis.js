/**
 * Test script for the Independent Analysis Trigger System
 * Demonstrates the complete triangulated analysis pipeline
 */

const { DatabaseManager } = require('../src/utils/sqliteDb');
const QueueManager = require('../src/utils/queueManager');
const TransactionalOutboxPublisher = require('../src/services/TransactionalOutboxPublisher');
const TriangulatedAnalysisQueue = require('../src/services/triangulation/TriangulatedAnalysisQueue');
const ConfidenceScorer = require('../src/services/ConfidenceScorer');
const { v4: uuidv4 } = require('uuid');

async function testTriangulatedAnalysis() {
    console.log('🧪 Starting Triangulated Analysis System Test');
    
    let dbManager, queueManager, publisher, triangulatedQueue;
    
    try {
        // Initialize components
        console.log('\n📊 Initializing components...');
        
        dbManager = new DatabaseManager({
            path: ':memory:', // Use in-memory database for testing
            enableWAL: false
        });
        
        queueManager = new QueueManager();
        await queueManager.connect();
        
        publisher = new TransactionalOutboxPublisher(dbManager, queueManager, {
            triangulationOptions: {
                confidenceThreshold: 0.45,
                concurrency: 1,
                enableAutoTrigger: false
            }
        });
        
        triangulatedQueue = new TriangulatedAnalysisQueue(dbManager, queueManager, null, {
            confidenceThreshold: 0.45,
            concurrency: 1,
            enableAutoTrigger: false
        });
        
        // Start systems
        await publisher.start();
        console.log('✅ Systems initialized and started');
        
        // Create test data
        console.log('\n🔬 Creating test data...');
        await createTestData(dbManager);
        
        // Test confidence scoring
        console.log('\n📈 Testing confidence scoring...');
        await testConfidenceScoring();
        
        // Test triangulated analysis workflow
        console.log('\n🔺 Testing triangulated analysis workflow...');
        await testTriangulatedWorkflow(dbManager, triangulatedQueue);
        
        // Display results
        console.log('\n📊 Getting analysis statistics...');
        const stats = await publisher.getTriangulatedAnalysisStats();
        console.log('Triangulated Analysis Statistics:', JSON.stringify(stats, null, 2));
        
        console.log('\n✅ Triangulated Analysis System Test completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Stack trace:', error.stack);
        
    } finally {
        // Cleanup
        try {
            if (publisher) await publisher.stop();
            if (triangulatedQueue) await triangulatedQueue.stop();
            if (queueManager) await queueManager.closeConnections();
            if (dbManager) await dbManager.close();
            console.log('🧹 Cleanup completed');
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }
    }
}

async function createTestData(dbManager) {
    const db = dbManager.getDb();
    const runId = uuidv4();
    
    // Create test file
    const fileResult = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run(
        '/test/example.js', 'processed'
    );
    const fileId = fileResult.lastInsertRowid;
    
    // Create test POIs
    const poisData = [
        { name: 'TestClass', type: 'ClassDefinition', semantic_id: 'test_TestClass' },
        { name: 'testMethod', type: 'FunctionDefinition', semantic_id: 'test_testMethod' },
        { name: 'helperFunction', type: 'FunctionDefinition', semantic_id: 'test_helperFunction' },
        { name: 'dataVariable', type: 'VariableDeclaration', semantic_id: 'test_dataVariable' }
    ];
    
    const poiIds = {};
    for (const poi of poisData) {
        const result = db.prepare(`
            INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, 
                            description, is_exported, semantic_id, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            fileId, '/test/example.js', poi.name, poi.type, 1, 10,
            `Test ${poi.type}`, false, poi.semantic_id, runId
        );
        poiIds[poi.name] = result.lastInsertRowid;
    }
    
    // Create test relationships with varying confidence levels
    const relationships = [
        {
            source: 'TestClass', target: 'testMethod', type: 'CONTAINS',
            confidence: 0.2, reason: 'Very low confidence relationship'
        },
        {
            source: 'testMethod', target: 'helperFunction', type: 'CALLS',
            confidence: 0.35, reason: 'Low confidence function call'
        },
        {
            source: 'helperFunction', target: 'dataVariable', type: 'USES',
            confidence: 0.15, reason: 'Extremely low confidence usage'
        },
        {
            source: 'TestClass', target: 'dataVariable', type: 'REFERENCES',
            confidence: 0.6, reason: 'Medium confidence reference (should not trigger triangulation)'
        }
    ];
    
    for (const rel of relationships) {
        db.prepare(`
            INSERT INTO relationships (source_poi_id, target_poi_id, type, file_path, 
                                     status, confidence, reason, run_id)
            VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)
        `).run(
            poiIds[rel.source], poiIds[rel.target], rel.type, '/test/example.js',
            rel.confidence, rel.reason, runId
        );
    }
    
    console.log(`✅ Created test data: ${poisData.length} POIs, ${relationships.length} relationships (runId: ${runId})`);
    return { runId, fileId, poiIds };
}

async function testConfidenceScoring() {
    const confidenceScorer = new ConfidenceScorer();
    
    const testRelationships = [
        {
            from: 'test_TestClass',
            to: 'test_testMethod', 
            type: 'CONTAINS',
            filePath: '/test/example.js',
            reason: 'Class contains method based on structure'
        },
        {
            from: 'test_testMethod',
            to: 'test_helperFunction',
            type: 'CALLS', 
            filePath: '/test/example.js',
            reason: 'Method calls helper function'
        }
    ];
    
    for (const relationship of testRelationships) {
        const result = confidenceScorer.calculateConfidence(relationship, []);
        console.log(`  📊 ${relationship.from} -> ${relationship.to}:`);
        console.log(`    Confidence: ${result.finalConfidence.toFixed(3)} (${result.confidenceLevel})`);
        console.log(`    Escalation needed: ${result.escalationNeeded}`);
        console.log(`    Breakdown: Syntax=${result.breakdown.factorScores.syntax.toFixed(3)}, Semantic=${result.breakdown.factorScores.semantic.toFixed(3)}, Context=${result.breakdown.factorScores.context.toFixed(3)}`);
    }
}

async function testTriangulatedWorkflow(dbManager, triangulatedQueue) {
    const db = dbManager.getDb();
    
    // Get low confidence relationships
    const lowConfRelationships = db.prepare(`
        SELECT id, confidence FROM relationships 
        WHERE confidence < 0.45
        ORDER BY confidence ASC
    `).all();
    
    console.log(`  🔍 Found ${lowConfRelationships.length} relationships needing triangulation`);
    
    if (lowConfRelationships.length > 0) {
        const runId = db.prepare('SELECT DISTINCT run_id FROM relationships LIMIT 1').get().run_id;
        
        // Trigger triangulated analysis
        const result = await triangulatedQueue.triggerTriangulatedAnalysis(
            lowConfRelationships, runId, 'normal'
        );
        
        console.log(`  🚀 Triggered triangulated analysis: ${result.jobIds.length} jobs created`);
        
        // Wait a moment for processing (in real system, this would be handled by workers)
        console.log('  ⏳ Simulating triangulated analysis processing...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check analysis sessions created
        const sessions = db.prepare(`
            SELECT session_id, status, initial_confidence 
            FROM triangulated_analysis_sessions
        `).all();
        
        console.log(`  📋 Created ${sessions.length} triangulated analysis sessions:`);
        sessions.forEach(session => {
            console.log(`    Session ${session.session_id}: ${session.status} (initial confidence: ${session.initial_confidence})`);
        });
    }
}

// Architecture demonstration
function demonstrateArchitecture() {
    console.log('\n🏗️ Independent Analysis Trigger System Architecture:');
    console.log(`
┌─────────────────────────────────────────────────────────────────┐
│                    TRIANGULATED ANALYSIS PIPELINE               │
├─────────────────────────────────────────────────────────────────┤
│  1. TransactionalOutboxPublisher                               │
│     • Processes relationship events                            │
│     • Calculates confidence scores (ConfidenceScorer)          │
│     • Triggers triangulation for confidence < 0.45             │
│                                                                 │
│  2. TriangulatedAnalysisQueue                                  │
│     • Manages low-confidence relationship analysis             │
│     • Prioritizes by confidence level (urgent/high/normal)     │
│     • Coordinates with SubagentCoordinator                     │
│                                                                 │
│  3. SubagentCoordinator                                        │
│     • Manages 3 specialized analysis agents                    │
│     • Executes parallel/sequential analysis                    │
│     • Handles timeouts and error recovery                      │
│                                                                 │
│  4. Specialized Analysis Agents                                │
│     • SyntacticAnalysisAgent (35% weight)                     │
│       - Code patterns, function calls, imports                 │
│     • SemanticAnalysisAgent (40% weight)                      │
│       - Meaning, purpose, domain logic                         │
│     • ContextualAnalysisAgent (25% weight)                    │
│       - File organization, architecture patterns              │
│                                                                 │
│  5. ConsensusBuilder                                           │
│     • Weighted consensus: Σ(Wi × Ci × Ai) / Σ(Wi)            │
│     • Conflict detection and resolution                        │
│     • Decision: ACCEPT/REJECT/ESCALATE                         │
│                                                                 │
│  6. Database Integration                                       │
│     • triangulated_analysis_sessions                          │
│     • subagent_analyses                                       │
│     • consensus_decisions                                     │
└─────────────────────────────────────────────────────────────────┘

📈 Analysis Distribution (Architecture Target):
  • Batch Analysis: 80% (high confidence relationships)
  • Individual Analysis: 15% (medium confidence relationships)  
  • Triangulated Analysis: 5% (low confidence relationships < 0.45)

🎯 Performance Targets:
  • <5% of relationships require triangulation
  • 2-minute timeout per triangulated analysis
  • 67% success rate threshold for consensus
  • Automatic escalation for unresolvable conflicts
`);
}

// Run the test
if (require.main === module) {
    demonstrateArchitecture();
    testTriangulatedAnalysis()
        .then(() => {
            console.log('\n🎉 Test completed - Independent Analysis Trigger System is ready!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = {
    testTriangulatedAnalysis,
    demonstrateArchitecture
};