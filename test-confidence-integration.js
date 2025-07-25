/**
 * Simple integration test for the Confidence Scoring System
 * Tests the complete integration without external testing frameworks
 */

const ConfidenceScorer = require('./src/services/ConfidenceScorer');
const { RelationshipConfidence, ConfidenceEvidenceItem } = require('./src/types/ConfidenceTypes');

async function runIntegrationTests() {
    console.log('🧪 Running Confidence Scoring Integration Tests\n');
    
    let testsRun = 0;
    let testsPass = 0;
    
    function assert(condition, message) {
        testsRun++;
        if (condition) {
            testsPass++;
            console.log(`✅ PASS: ${message}`);
        } else {
            console.log(`❌ FAIL: ${message}`);
        }
    }

    // Test 1: Basic ConfidenceScorer initialization
    console.log('📋 Test 1: ConfidenceScorer Initialization');
    const scorer = new ConfidenceScorer();
    assert(scorer.weights.syntax === 0.3, 'Default syntax weight is 0.3');
    assert(scorer.weights.semantic === 0.3, 'Default semantic weight is 0.3');
    assert(scorer.weights.context === 0.2, 'Default context weight is 0.2');
    assert(scorer.weights.crossRef === 0.2, 'Default crossRef weight is 0.2');
    assert(scorer.thresholds.escalation === 0.5, 'Default escalation threshold is 0.5');

    // Test 2: Custom configuration
    console.log('\n📋 Test 2: Custom Configuration');
    const customScorer = new ConfidenceScorer({
        weights: { syntax: 0.4, semantic: 0.4, context: 0.1, crossRef: 0.1 },
        thresholds: { escalation: 0.3 }
    });
    assert(customScorer.weights.syntax === 0.4, 'Custom syntax weight applied');
    assert(customScorer.thresholds.escalation === 0.3, 'Custom escalation threshold applied');

    // Test 3: High confidence relationship
    console.log('\n📋 Test 3: High Confidence Database Relationship');
    const dbRelationship = {
        from: 'database_func_getUserById',
        to: 'user_model_User',
        type: 'CALLS',
        reason: 'Function getUserById calls User model constructor on line 42',
        evidence: 'new User(userData) called directly'
    };

    const dbEvidence = [
        new ConfidenceEvidenceItem({
            type: 'LLM_REASONING',
            text: 'Function getUserById calls User model constructor on line 42',
            confidence: 0.9
        }),
        new ConfidenceEvidenceItem({
            type: 'SYNTAX_PATTERN',
            text: 'new User(userData) called directly',
            confidence: 0.95
        })
    ];

    const dbResult = scorer.calculateConfidence(dbRelationship, dbEvidence);
    assert(dbResult.finalConfidence >= 0, 'Confidence score is non-negative');
    assert(dbResult.finalConfidence <= 1, 'Confidence score is not greater than 1');
    assert(dbResult.scoreId !== null, 'Score ID is generated');
    assert(dbResult.confidenceLevel !== null, 'Confidence level is assigned');
    assert(typeof dbResult.escalationNeeded === 'boolean', 'Escalation needed is boolean');

    // Test 4: Low confidence relationship (should trigger escalation)
    console.log('\n📋 Test 4: Low Confidence Ambiguous Relationship');
    const ambiguousRelationship = {
        from: 'unclear_handler_x',
        to: 'mysterious_util_y',
        type: 'USES',
        reason: 'Unclear relationship pattern',
        evidence: 'Possibly via dynamic require'
    };

    const ambiguousEvidence = [
        new ConfidenceEvidenceItem({
            type: 'LLM_REASONING',
            text: 'Unclear relationship pattern',
            confidence: 0.2
        })
    ];

    const ambiguousResult = scorer.calculateConfidence(ambiguousRelationship, ambiguousEvidence);
    assert(ambiguousResult.finalConfidence < 0.5, 'Low confidence relationship has score < 0.5');
    assert(ambiguousResult.escalationNeeded === true, 'Low confidence triggers escalation');
    assert(ambiguousResult.confidenceLevel === 'VERY_LOW', 'Confidence level is VERY_LOW');

    // Test 5: Factor score calculation
    console.log('\n📋 Test 5: Factor Score Calculation');
    const testRelationship = {
        from: 'api_controller_test',
        to: 'service_handler_test',
        type: 'CALLS',
        reason: 'Controller calls service handler'
    };

    const factorScores = scorer.calculateFactorScores(testRelationship, []);
    assert(factorScores.syntax >= 0 && factorScores.syntax <= 1, 'Syntax score in valid range');
    assert(factorScores.semantic >= 0 && factorScores.semantic <= 1, 'Semantic score in valid range');
    assert(factorScores.context >= 0 && factorScores.context <= 1, 'Context score in valid range');
    assert(factorScores.crossRef >= 0 && factorScores.crossRef <= 1, 'CrossRef score in valid range');

    // Test 6: Weighted sum calculation
    console.log('\n📋 Test 6: Weighted Sum Calculation');
    const mockFactorScores = {
        syntax: 0.8,
        semantic: 0.7,
        context: 0.6,
        crossRef: 0.5
    };
    const expectedSum = (0.3 * 0.8) + (0.3 * 0.7) + (0.2 * 0.6) + (0.2 * 0.5);
    const calculatedSum = scorer.calculateWeightedSum(mockFactorScores);
    assert(Math.abs(calculatedSum - expectedSum) < 0.001, 'Weighted sum calculation is correct');

    // Test 7: Penalty factor calculation
    console.log('\n📋 Test 7: Penalty Factor Calculation');
    const cleanRelationship = {
        from: 'simple_func_a',
        to: 'simple_func_b',
        type: 'CALLS',
        reason: 'Direct function call'
    };
    const penaltyFactor = scorer.calculatePenaltyFactor(cleanRelationship, []);
    assert(penaltyFactor === 1.0, 'Clean relationship has no penalties');

    // Test 8: Uncertainty adjustment
    console.log('\n📋 Test 8: Uncertainty Adjustment');
    const adjustment1 = scorer.calculateUncertaintyAdjustment(1);
    const adjustment5 = scorer.calculateUncertaintyAdjustment(5);
    assert(adjustment5 > adjustment1, 'More evidence results in higher adjustment');
    assert(adjustment1 > 0 && adjustment1 <= 1, 'Adjustment is in valid range');

    // Test 9: Confidence level classification
    console.log('\n📋 Test 9: Confidence Level Classification');
    assert(scorer.getConfidenceLevel(0.9) === 'HIGH', 'Score 0.9 is HIGH confidence');
    assert(scorer.getConfidenceLevel(0.75) === 'MEDIUM', 'Score 0.75 is MEDIUM confidence');
    assert(scorer.getConfidenceLevel(0.55) === 'LOW', 'Score 0.55 is LOW confidence');
    assert(scorer.getConfidenceLevel(0.3) === 'VERY_LOW', 'Score 0.3 is VERY_LOW confidence');

    // Test 10: RelationshipConfidence type
    console.log('\n📋 Test 10: RelationshipConfidence Type');
    const confidenceObj = new RelationshipConfidence({
        scoreId: 'test-score-123',
        finalConfidence: 0.75,
        confidenceLevel: 'MEDIUM'
    });
    assert(confidenceObj.scoreId === 'test-score-123', 'RelationshipConfidence stores scoreId');
    assert(confidenceObj.finalConfidence === 0.75, 'RelationshipConfidence stores confidence');
    assert(confidenceObj.requiresHumanReview() === false, 'Medium confidence does not require review');

    // Test 11: Evidence item creation
    console.log('\n📋 Test 11: Evidence Item Creation');
    const evidenceItem = new ConfidenceEvidenceItem({
        type: 'SYNTAX_PATTERN',
        text: 'Direct function call detected',
        confidence: 0.8
    });
    assert(evidenceItem.type === 'SYNTAX_PATTERN', 'Evidence item stores type');
    assert(evidenceItem.text === 'Direct function call detected', 'Evidence item stores text');
    assert(evidenceItem.confidence === 0.8, 'Evidence item stores confidence');

    // Test 12: Error handling
    console.log('\n📋 Test 12: Error Handling');
    const errorResult = scorer.calculateConfidence(null, []);
    assert(errorResult.finalConfidence === 0.1, 'Error case returns low confidence');
    assert(errorResult.confidenceLevel === 'ERROR', 'Error case has ERROR level');
    assert(errorResult.escalationNeeded === true, 'Error case triggers escalation');

    // Test 13: Performance baseline
    console.log('\n📋 Test 13: Performance Baseline');
    const perfStart = Date.now();
    for (let i = 0; i < 10; i++) {
        scorer.calculateConfidence(dbRelationship, dbEvidence);
    }
    const perfEnd = Date.now();
    const avgTime = (perfEnd - perfStart) / 10;
    assert(avgTime < 50, `Performance is acceptable (${avgTime.toFixed(2)}ms per calculation)`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log(`📊 Test Results: ${testsPass}/${testsRun} tests passed`);
    
    if (testsPass === testsRun) {
        console.log('🎉 All tests passed! Confidence scoring system is working correctly.');
        return true;
    } else {
        console.log(`❌ ${testsRun - testsPass} tests failed. Please review the implementation.`);
        return false;
    }
}

// Run the tests
if (require.main === module) {
    runIntegrationTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

module.exports = { runIntegrationTests };