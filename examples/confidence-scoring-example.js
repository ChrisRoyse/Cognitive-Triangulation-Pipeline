/**
 * Confidence Scoring System Example
 * 
 * Demonstrates the complete confidence-based relationship scoring system
 * implemented based on the hybrid cognitive triangulation architecture.
 * 
 * This example shows:
 * 1. ConfidenceScorer service with mathematical formulas
 * 2. RelationshipResolutionWorker integration
 * 3. Escalation trigger system
 * 4. Real-world scoring scenarios
 */

const ConfidenceScorer = require('../src/services/ConfidenceScorer');
const { RelationshipConfidence, ConfidenceEvidenceItem, EscalationTriggerConfig, EscalationTriggers } = require('../src/types/ConfidenceTypes');

async function demonstrateConfidenceScoring() {
    console.log('🔍 Confidence-Based Relationship Scoring System Demo\n');
    console.log('=' .repeat(60));

    // Initialize confidence scorer with custom configuration
    const scorer = new ConfidenceScorer({
        weights: {
            syntax: 0.3,        // Syntax pattern recognition
            semantic: 0.3,      // Semantic understanding
            context: 0.2,       // Contextual analysis
            crossRef: 0.2       // Cross-reference validation
        },
        penalties: {
            dynamicImport: -0.15,
            indirectRef: -0.1,
            conflict: -0.2,
            ambiguous: -0.05
        },
        thresholds: {
            high: 0.85,
            medium: 0.65,
            low: 0.45,
            escalation: 0.5
        }
    });

    console.log('\n📊 Scorer Configuration:');
    console.log('Weights:', scorer.weights);
    console.log('Penalties:', scorer.penalties);
    console.log('Thresholds:', scorer.thresholds);

    // Example 1: High Confidence Database Relationship
    console.log('\n' + '='.repeat(60));
    console.log('📈 Example 1: High Confidence Database Relationship');
    console.log('='.repeat(60));

    const dbRelationship = {
        id: 'rel-db-001',
        from: 'database_func_getUserById',
        to: 'user_model_User',
        type: 'CALLS',
        reason: 'Function getUserById calls User model constructor on line 42 to create user instance',
        evidence: 'new User(userData) called directly with clear parameter passing',
        confidence: 0.9
    };

    const dbEvidence = [
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-db-001',
            type: 'LLM_REASONING',
            text: 'Function getUserById calls User model constructor on line 42 to create user instance',
            source: 'RelationshipResolutionWorker',
            confidence: 0.9,
            context: { filePath: '/models/user.js', relationshipType: 'CALLS' }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-db-002',
            type: 'SYNTAX_PATTERN',
            text: 'new User(userData) called directly with clear parameter passing',
            source: 'SyntaxAnalyzer',
            confidence: 0.95,
            context: { filePath: '/models/user.js', pattern: 'constructor_call' }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-db-003',
            type: 'SEMANTIC_DOMAIN',
            text: 'Both entities belong to database/user domain with consistent naming',
            source: 'SemanticAnalysis',
            confidence: 0.8,
            context: { domain: 'database', semantic_consistency: true }
        })
    ];

    const dbResult = scorer.calculateConfidence(dbRelationship, dbEvidence);
    displayConfidenceResult('Database Relationship', dbResult);

    // Example 2: Medium Confidence API Controller Relationship
    console.log('\n' + '='.repeat(60));
    console.log('📊 Example 2: Medium Confidence API Controller Relationship');
    console.log('='.repeat(60));

    const apiRelationship = {
        id: 'rel-api-001',
        from: 'api_controller_userprofile',
        to: 'auth_service_validatetoken',
        type: 'CALLS',
        reason: 'Controller validates authentication token before processing user profile request',
        evidence: 'validateToken(request.headers.authorization) called in middleware chain',
        confidence: 0.75
    };

    const apiEvidence = [
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-api-001',
            type: 'LLM_REASONING',
            text: 'Controller validates authentication token before processing user profile request',
            source: 'RelationshipResolutionWorker',
            confidence: 0.8,
            context: { filePath: '/controllers/user.js', relationshipType: 'CALLS' }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-api-002',
            type: 'ARCHITECTURAL_PATTERN',
            text: 'Follows standard controller->service pattern in MVC architecture',
            source: 'ArchitecturalAnalysis',
            confidence: 0.75,
            context: { pattern: 'mvc', layer_separation: true }
        })
    ];

    const apiResult = scorer.calculateConfidence(apiRelationship, apiEvidence);
    displayConfidenceResult('API Controller Relationship', apiResult);

    // Example 3: Low Confidence Ambiguous Relationship (Escalation)
    console.log('\n' + '='.repeat(60));
    console.log('⚠️  Example 3: Low Confidence Ambiguous Relationship (Escalation)');
    console.log('='.repeat(60));

    const ambiguousRelationship = {
        id: 'rel-ambiguous-001',
        from: 'unclear_handler_processrequest',
        to: 'mysterious_util_helper',
        type: 'USES',
        reason: 'Handler might indirectly reference helper utility through dynamic loading',
        evidence: 'Unclear reference pattern detected, possibly via require(${name})',
        confidence: 0.3
    };

    const ambiguousEvidence = [
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-amb-001',
            type: 'LLM_REASONING',
            text: 'Handler might indirectly reference helper utility through dynamic loading',
            source: 'RelationshipResolutionWorker',
            confidence: 0.3,
            context: { filePath: '/handlers/unclear.js', uncertainty: true }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-amb-002',
            type: 'DYNAMIC_PATTERN',
            text: 'Unclear reference pattern detected, possibly via require(${name})',
            source: 'DynamicAnalysis',
            confidence: 0.2,
            context: { dynamic_import: true, indirect_reference: true }
        })
    ];

    const ambiguousResult = scorer.calculateConfidence(ambiguousRelationship, ambiguousEvidence);
    displayConfidenceResult('Ambiguous Relationship', ambiguousResult);

    // Example 4: Complex Multi-Factor Relationship
    console.log('\n' + '='.repeat(60));
    console.log('🔬 Example 4: Complex Multi-Factor Relationship Analysis');
    console.log('='.repeat(60));

    const complexRelationship = {
        id: 'rel-complex-001',
        from: 'payment_service_processPayment',
        to: 'external_gateway_stripe',
        type: 'CALLS',
        reason: 'Payment service integrates with Stripe gateway for credit card processing',
        evidence: 'stripe.charges.create() called with payment data validation',
        confidence: 0.8
    };

    const complexEvidence = [
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-comp-001',
            type: 'LLM_REASONING',
            text: 'Payment service integrates with Stripe gateway for credit card processing',
            source: 'RelationshipResolutionWorker',
            confidence: 0.85,
            context: { filePath: '/services/payment.js', relationshipType: 'CALLS' }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-comp-002',
            type: 'API_INTEGRATION',
            text: 'stripe.charges.create() called with payment data validation',
            source: 'APIAnalyzer',
            confidence: 0.9,
            context: { external_api: true, method_call: 'stripe.charges.create' }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-comp-003',
            type: 'DOMAIN_CONSISTENCY',
            text: 'Both entities belong to payment processing domain',
            source: 'DomainAnalysis',
            confidence: 0.8,
            context: { domain: 'payment', business_logic: true }
        }),
        new ConfidenceEvidenceItem({
            evidenceId: 'ev-comp-004',
            type: 'CROSS_REFERENCE',
            text: 'Multiple references to Stripe integration found across codebase',
            source: 'CrossReferenceAnalysis',
            confidence: 0.75,
            context: { cross_file_references: 3, consistency_check: true }
        })
    ];

    const complexResult = scorer.calculateConfidence(complexRelationship, complexEvidence);
    displayConfidenceResult('Complex Multi-Factor Relationship', complexResult);

    // Demonstrate escalation system
    console.log('\n' + '='.repeat(60));
    console.log('🚨 Escalation System Demonstration');
    console.log('='.repeat(60));

    demonstrateEscalationSystem(scorer, [dbResult, apiResult, ambiguousResult, complexResult]);

    // Performance analysis
    console.log('\n' + '='.repeat(60));
    console.log('⚡ Performance Analysis');
    console.log('='.repeat(60));

    await performanceAnalysis(scorer);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Confidence Scoring System Demo Complete');
    console.log('='.repeat(60));
}

function displayConfidenceResult(title, result) {
    console.log(`\n📋 ${title}:`);
    console.log(`  Final Confidence: ${result.finalConfidence.toFixed(3)} (${result.confidenceLevel})`);
    console.log(`  Escalation Needed: ${result.escalationNeeded ? '⚠️  YES' : '✅ NO'}`);
    
    console.log('\n  📊 Factor Breakdown:');
    console.log(`    Syntax Score:    ${result.breakdown.factorScores.syntax.toFixed(3)}`);
    console.log(`    Semantic Score:  ${result.breakdown.factorScores.semantic.toFixed(3)}`);
    console.log(`    Context Score:   ${result.breakdown.factorScores.context.toFixed(3)}`);
    console.log(`    Cross-Ref Score: ${result.breakdown.factorScores.crossRef.toFixed(3)}`);
    
    console.log('\n  🧮 Calculation Steps:');
    console.log(`    Weighted Sum:           ${result.breakdown.weightedSum.toFixed(3)}`);
    console.log(`    Penalty Factor:         ${result.breakdown.penaltyFactor.toFixed(3)}`);
    console.log(`    Uncertainty Adjustment: ${result.breakdown.uncertaintyAdjustment.toFixed(3)}`);
    console.log(`    Raw Score:              ${result.breakdown.rawScore.toFixed(3)}`);

    if (result.escalationNeeded) {
        console.log('\n  ⚠️  Escalation Required - This relationship needs human review');
    }
}

function demonstrateEscalationSystem(scorer, results) {
    console.log('\nEscalation Trigger Analysis:');
    
    // Configure escalation triggers
    const triggers = [
        new EscalationTriggerConfig({
            triggerType: EscalationTriggers.LOW_CONFIDENCE,
            threshold: 0.5,
            enabled: true,
            priority: 'HIGH',
            action: 'QUEUE_FOR_REVIEW'
        }),
        new EscalationTriggerConfig({
            triggerType: EscalationTriggers.HIGH_UNCERTAINTY,
            threshold: 0.6,
            enabled: true,
            priority: 'MEDIUM',
            action: 'FLAG_FOR_VALIDATION'
        })
    ];

    results.forEach((result, index) => {
        console.log(`\n${index + 1}. Relationship Analysis:`);
        
        const triggeredEscalations = [];
        triggers.forEach(trigger => {
            if (trigger.isTriggered(result)) {
                triggeredEscalations.push({
                    type: trigger.triggerType,
                    priority: trigger.priority,
                    action: trigger.action
                });
            }
        });

        if (triggeredEscalations.length > 0) {
            console.log(`   🚨 ESCALATED - ${triggeredEscalations.length} trigger(s):`);
            triggeredEscalations.forEach(esc => {
                console.log(`     - ${esc.type} (${esc.priority}) → ${esc.action}`);
            });
        } else {
            console.log('   ✅ No escalation needed');
        }
    });
}

async function performanceAnalysis(scorer) {
    console.log('\n🔬 Running Performance Analysis...');
    
    const testRelationships = [
        {
            from: 'test_func_a', to: 'test_func_b', type: 'CALLS',
            reason: 'Simple function call', confidence: 0.8
        },
        {
            from: 'api_controller_complex', to: 'service_layer_handler', type: 'USES',
            reason: 'Complex service layer interaction', confidence: 0.7
        },
        {
            from: 'db_repository_user', to: 'model_user_entity', type: 'INSTANTIATES',
            reason: 'Repository creates model instance', confidence: 0.85
        }
    ];

    const iterations = 100;
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
        for (const rel of testRelationships) {
            const evidence = [
                new ConfidenceEvidenceItem({
                    type: 'LLM_REASONING',
                    text: rel.reason,
                    confidence: rel.confidence
                })
            ];
            scorer.calculateConfidence(rel, evidence);
        }
    }
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTimePerCalculation = totalTime / (iterations * testRelationships.length);
    
    console.log(`\n📈 Performance Results:`);
    console.log(`  Total Calculations: ${iterations * testRelationships.length}`);
    console.log(`  Total Time: ${totalTime}ms`);
    console.log(`  Average Time per Calculation: ${avgTimePerCalculation.toFixed(2)}ms`);
    console.log(`  Calculations per Second: ${Math.round(1000 / avgTimePerCalculation)}`);
}

// Integration example with RelationshipResolutionWorker
function demonstrateWorkerIntegration() {
    console.log('\n' + '='.repeat(60));
    console.log('🔗 RelationshipResolutionWorker Integration Example');
    console.log('='.repeat(60));

    console.log(`
// Example usage in RelationshipResolutionWorker:

const worker = new RelationshipResolutionWorker(
    queueManager,
    dbManager,
    llmClient,
    workerPoolManager,
    {
        enableConfidenceScoring: true,
        confidenceThreshold: 0.6,
        confidenceScorer: {
            weights: { syntax: 0.3, semantic: 0.3, context: 0.2, crossRef: 0.2 },
            thresholds: { escalation: 0.5 }
        },
        escalationTriggers: [
            {
                triggerType: 'LOW_CONFIDENCE',
                threshold: 0.5,
                priority: 'HIGH',
                action: 'QUEUE_FOR_REVIEW'
            }
        ]
    }
);

// The worker will automatically:
// 1. Apply confidence scoring to all relationships
// 2. Filter out relationships below threshold
// 3. Escalate low-confidence relationships for review
// 4. Store detailed confidence data in database
// 5. Provide comprehensive logging and debugging info
    `);
}

// Run the demonstration
if (require.main === module) {
    demonstrateConfidenceScoring()
        .then(() => {
            demonstrateWorkerIntegration();
            console.log('\n🎉 All demonstrations completed successfully!');
        })
        .catch(console.error);
}

module.exports = {
    demonstrateConfidenceScoring,
    demonstrateWorkerIntegration
};