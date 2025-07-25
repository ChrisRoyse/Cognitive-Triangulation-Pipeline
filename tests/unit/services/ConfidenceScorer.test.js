const { describe, it, expect, beforeEach } = require('@jest/globals');
const ConfidenceScorer = require('../../../src/services/ConfidenceScorer');
const { ConfidenceEvidenceItem, ConfidenceLevels, EscalationTriggers } = require('../../../src/types/ConfidenceTypes');

describe('ConfidenceScorer', () => {
    let scorer;
    let mockRelationship;
    let mockEvidenceItems;

    beforeEach(() => {
        scorer = new ConfidenceScorer();
        
        mockRelationship = {
            id: 'test-rel-123',
            from: 'database_func_getUserById',
            to: 'user_model_User',
            type: 'CALLS',
            reason: 'Function getUserById calls User model constructor on line 42',
            evidence: 'Direct function call pattern detected',
            confidence: 0.8
        };

        mockEvidenceItems = [
            new ConfidenceEvidenceItem({
                evidenceId: 'evidence-1',
                type: 'LLM_REASONING',
                text: 'Function getUserById calls User model constructor on line 42',
                source: 'RelationshipResolutionWorker',
                confidence: 0.8,
                context: { filePath: '/test/user.js', relationshipType: 'CALLS' }
            }),
            new ConfidenceEvidenceItem({
                evidenceId: 'evidence-2',
                type: 'SEMANTIC_DOMAIN',
                text: 'Both entities share database domain',
                source: 'SemanticAnalysis',
                confidence: 0.7,
                context: { domain: 'database', filePath: '/test/user.js' }
            })
        ];
    });

    describe('Constructor', () => {
        it('should initialize with default weights and thresholds', () => {
            const scorer = new ConfidenceScorer();
            
            expect(scorer.weights.syntax).toBe(0.3);
            expect(scorer.weights.semantic).toBe(0.3);
            expect(scorer.weights.context).toBe(0.2);
            expect(scorer.weights.crossRef).toBe(0.2);
            
            expect(scorer.thresholds.high).toBe(0.85);
            expect(scorer.thresholds.medium).toBe(0.65);
            expect(scorer.thresholds.low).toBe(0.45);
            expect(scorer.thresholds.escalation).toBe(0.5);
        });

        it('should accept custom weights and thresholds', () => {
            const customOptions = {
                weights: { syntax: 0.4, semantic: 0.4, context: 0.1, crossRef: 0.1 },
                thresholds: { high: 0.9, escalation: 0.3 }
            };
            
            const scorer = new ConfidenceScorer(customOptions);
            
            expect(scorer.weights.syntax).toBe(0.4);
            expect(scorer.weights.semantic).toBe(0.4);
            expect(scorer.thresholds.high).toBe(0.9);
            expect(scorer.thresholds.escalation).toBe(0.3);
        });
    });

    describe('calculateConfidence', () => {
        it('should calculate confidence for a standard relationship', () => {
            const result = scorer.calculateConfidence(mockRelationship, mockEvidenceItems);
            
            expect(result).toHaveProperty('scoreId');
            expect(result).toHaveProperty('finalConfidence');
            expect(result).toHaveProperty('breakdown');
            expect(result).toHaveProperty('escalationNeeded');
            expect(result).toHaveProperty('confidenceLevel');
            expect(result).toHaveProperty('timestamp');
            
            expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
            expect(result.finalConfidence).toBeLessThanOrEqual(1);
            expect(typeof result.escalationNeeded).toBe('boolean');
        });

        it('should return high confidence for clear function calls', () => {
            const functionCallRelationship = {
                from: 'auth_func_validateCredentials',
                to: 'database_func_getUserByEmail',
                type: 'CALLS',
                reason: 'Function validateCredentials calls getUserByEmail on line 15 with email parameter',
                evidence: 'getUserByEmail(user.email) found in function body'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    type: 'LLM_REASONING',
                    text: 'getUserByEmail(user.email) found in function body',
                    confidence: 0.9,
                    context: { relationshipType: 'CALLS' }
                })
            ];

            const result = scorer.calculateConfidence(functionCallRelationship, evidence);
            
            expect(result.finalConfidence).toBeGreaterThan(0.7);
            expect(result.confidenceLevel).toMatch(/HIGH|MEDIUM/);
        });

        it('should return lower confidence for ambiguous relationships', () => {
            const ambiguousRelationship = {
                from: 'unknown_var_x',
                to: 'mysterious_func_y',
                type: 'USES',
                reason: 'Variable x might reference function y',
                evidence: 'Unclear reference pattern'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    type: 'LLM_REASONING',
                    text: 'Variable x might reference function y',
                    confidence: 0.3,
                    context: { relationshipType: 'USES' }
                })
            ];

            const result = scorer.calculateConfidence(ambiguousRelationship, evidence);
            
            expect(result.finalConfidence).toBeLessThan(0.6);
            expect(result.escalationNeeded).toBe(true);
        });

        it('should handle errors gracefully', () => {
            const invalidRelationship = null;
            
            const result = scorer.calculateConfidence(invalidRelationship, []);
            
            expect(result.finalConfidence).toBe(0.1);
            expect(result.confidenceLevel).toBe('ERROR');
            expect(result.escalationNeeded).toBe(true);
            expect(result.breakdown).toHaveProperty('error');
        });
    });

    describe('calculateFactorScores', () => {
        it('should calculate all four factor scores', () => {
            const scores = scorer.calculateFactorScores(mockRelationship, mockEvidenceItems);
            
            expect(scores).toHaveProperty('syntax');
            expect(scores).toHaveProperty('semantic');
            expect(scores).toHaveProperty('context');
            expect(scores).toHaveProperty('crossRef');
            
            expect(scores.syntax).toBeGreaterThanOrEqual(0);
            expect(scores.syntax).toBeLessThanOrEqual(1);
            expect(scores.semantic).toBeGreaterThanOrEqual(0);
            expect(scores.semantic).toBeLessThanOrEqual(1);
            expect(scores.context).toBeGreaterThanOrEqual(0);
            expect(scores.context).toBeLessThanOrEqual(1);
            expect(scores.crossRef).toBeGreaterThanOrEqual(0);
            expect(scores.crossRef).toBeLessThanOrEqual(1);
        });
    });

    describe('calculateSyntaxScore', () => {
        it('should give high score for direct function calls', () => {
            const callRelationship = {
                from: 'controller_func_handleLogin',
                to: 'auth_func_validateCredentials',
                type: 'CALLS',
                reason: 'Function handleLogin calls validateCredentials()'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    text: 'validateCredentials() called on line 25',
                    type: 'SYNTAX_PATTERN'
                })
            ];

            const score = scorer.calculateSyntaxScore(callRelationship, evidence);
            expect(score).toBeGreaterThan(0.7);
        });

        it('should give moderate score for import relationships', () => {
            const importRelationship = {
                from: 'app_module_main',
                to: 'utils_module_helpers',
                type: 'IMPORTS',
                reason: 'Main module imports helper utilities'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    text: 'import { helpers } from "./utils/helpers"',
                    type: 'IMPORT_STATEMENT'
                })
            ];

            const score = scorer.calculateSyntaxScore(importRelationship, evidence);
            expect(score).toBeGreaterThan(0.6);
        });
    });

    describe('calculateSemanticScore', () => {
        it('should give high score for semantically consistent names', () => {
            const semanticRelationship = {
                from: 'user_service_getUserProfile',
                to: 'user_repository_findUserById',
                type: 'CALLS',
                reason: 'User service calls user repository method'
            };

            const score = scorer.calculateSemanticScore(semanticRelationship, []);
            expect(score).toBeGreaterThan(0.6);
        });

        it('should consider evidence quality in scoring', () => {
            const relationship = {
                from: 'api_controller_users',
                to: 'database_model_User',
                type: 'USES',
                reason: 'Detailed analysis shows that the users controller utilizes the User database model for data operations, specifically calling User.findById() method on line 42 within the getUserProfile function'
            };

            const score = scorer.calculateSemanticScore(relationship, []);
            expect(score).toBeGreaterThan(0.7);
        });
    });

    describe('calculateContextScore', () => {
        it('should give bonus for same-file relationships', () => {
            const score = scorer.calculateContextScore(mockRelationship, mockEvidenceItems);
            expect(score).toBeGreaterThan(0.5); // Base score + same file bonus
        });

        it('should recognize domain coherence', () => {
            const domainRelationship = {
                from: 'auth_controller_login',
                to: 'auth_service_validateUser',
                type: 'CALLS'
            };

            const score = scorer.calculateContextScore(domainRelationship, []);
            expect(score).toBeGreaterThan(0.6);
        });
    });

    describe('calculateCrossRefScore', () => {
        it('should increase score with more evidence items', () => {
            const singleEvidence = [mockEvidenceItems[0]];
            const multipleEvidence = mockEvidenceItems;

            const singleScore = scorer.calculateCrossRefScore(mockRelationship, singleEvidence);
            const multipleScore = scorer.calculateCrossRefScore(mockRelationship, multipleEvidence);

            expect(multipleScore).toBeGreaterThan(singleScore);
        });

        it('should give bonus for consistent evidence', () => {
            const consistentEvidence = [
                new ConfidenceEvidenceItem({ type: 'FUNCTION_CALL', confidence: 0.8 }),
                new ConfidenceEvidenceItem({ type: 'FUNCTION_CALL', confidence: 0.85 })
            ];

            const score = scorer.calculateCrossRefScore(mockRelationship, consistentEvidence);
            expect(score).toBeGreaterThan(0.6);
        });
    });

    describe('calculateWeightedSum', () => {
        it('should correctly apply weights to factor scores', () => {
            const factorScores = {
                syntax: 0.8,
                semantic: 0.7,
                context: 0.6,
                crossRef: 0.5
            };

            const expectedSum = (0.3 * 0.8) + (0.3 * 0.7) + (0.2 * 0.6) + (0.2 * 0.5);
            const actualSum = scorer.calculateWeightedSum(factorScores);

            expect(actualSum).toBeCloseTo(expectedSum, 3);
        });

        it('should work with custom weights', () => {
            const customScorer = new ConfidenceScorer({
                weights: { syntax: 0.5, semantic: 0.3, context: 0.1, crossRef: 0.1 }
            });

            const factorScores = {
                syntax: 0.8,
                semantic: 0.7,
                context: 0.6,
                crossRef: 0.5
            };

            const expectedSum = (0.5 * 0.8) + (0.3 * 0.7) + (0.1 * 0.6) + (0.1 * 0.5);
            const actualSum = customScorer.calculateWeightedSum(factorScores);

            expect(actualSum).toBeCloseTo(expectedSum, 3);
        });
    });

    describe('calculatePenaltyFactor', () => {
        it('should return 1.0 when no penalties apply', () => {
            const cleanRelationship = {
                from: 'simple_func_a',
                to: 'simple_func_b',
                type: 'CALLS',
                reason: 'Direct function call'
            };

            const penaltyFactor = scorer.calculatePenaltyFactor(cleanRelationship, []);
            expect(penaltyFactor).toBe(1.0);
        });

        it('should apply dynamic import penalty', () => {
            const dynamicRelationship = {
                from: 'loader_func_loadModule',
                to: 'dynamic_module_target',
                type: 'IMPORTS',
                reason: 'Dynamic import using require(${moduleName})'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    text: 'require(${moduleName}) used for dynamic loading',
                    type: 'DYNAMIC_IMPORT'
                })
            ];

            const penaltyFactor = scorer.calculatePenaltyFactor(dynamicRelationship, evidence);
            expect(penaltyFactor).toBeLessThan(1.0);
            expect(penaltyFactor).toBeCloseTo(0.85, 2); // 1 - 0.15
        });

        it('should apply multiple penalties', () => {
            const problematicRelationship = {
                from: 'complex_func_handler',
                to: 'indirect_target',
                type: 'USES',
                reason: 'Complex indirect reference via dynamic import'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    text: 'Dynamic import and indirect reference detected',
                    type: 'COMPLEX_PATTERN'
                })
            ];

            // Mock the penalty detection methods to return true
            scorer.hasDynamicImport = jest.fn().mockReturnValue(true);
            scorer.hasIndirectReference = jest.fn().mockReturnValue(true);

            const penaltyFactor = scorer.calculatePenaltyFactor(problematicRelationship, evidence);
            expect(penaltyFactor).toBeLessThan(0.8); // 1 - 0.15 - 0.1 = 0.75
        });
    });

    describe('calculateUncertaintyAdjustment', () => {
        it('should return higher adjustment for more evidence', () => {
            const lowEvidenceAdjustment = scorer.calculateUncertaintyAdjustment(1);
            const highEvidenceAdjustment = scorer.calculateUncertaintyAdjustment(5);

            expect(highEvidenceAdjustment).toBeGreaterThan(lowEvidenceAdjustment);
        });

        it('should calculate correct adjustment using formula √(N/N+k)', () => {
            const N = 4;
            const k = scorer.uncertaintyParams.k; // 10
            const expected = Math.sqrt(N / (N + k)); // √(4/14)
            
            const actual = scorer.calculateUncertaintyAdjustment(N);
            expect(actual).toBeCloseTo(expected, 3);
        });

        it('should handle zero evidence gracefully', () => {
            const adjustment = scorer.calculateUncertaintyAdjustment(0);
            expect(adjustment).toBeGreaterThan(0);
            expect(adjustment).toBeLessThan(1);
        });
    });

    describe('getConfidenceLevel', () => {
        it('should classify scores correctly', () => {
            expect(scorer.getConfidenceLevel(0.9)).toBe(ConfidenceLevels.HIGH);
            expect(scorer.getConfidenceLevel(0.75)).toBe(ConfidenceLevels.MEDIUM);
            expect(scorer.getConfidenceLevel(0.55)).toBe(ConfidenceLevels.LOW);
            expect(scorer.getConfidenceLevel(0.3)).toBe(ConfidenceLevels.VERY_LOW);
        });

        it('should handle boundary values', () => {
            expect(scorer.getConfidenceLevel(0.85)).toBe(ConfidenceLevels.HIGH);
            expect(scorer.getConfidenceLevel(0.65)).toBe(ConfidenceLevels.MEDIUM);
            expect(scorer.getConfidenceLevel(0.45)).toBe(ConfidenceLevels.LOW);
        });
    });

    describe('needsEscalation', () => {
        it('should escalate low confidence results', () => {
            const lowConfidenceResult = {
                finalConfidence: 0.3,
                escalationNeeded: true,
                confidenceLevel: ConfidenceLevels.VERY_LOW,
                breakdown: {
                    uncertaintyAdjustment: 0.8,
                    penaltyFactor: 0.9
                }
            };

            expect(scorer.needsEscalation(lowConfidenceResult)).toBe(true);
        });

        it('should not escalate high confidence results', () => {
            const highConfidenceResult = {
                finalConfidence: 0.9,
                escalationNeeded: false,
                confidenceLevel: ConfidenceLevels.HIGH,
                breakdown: {
                    uncertaintyAdjustment: 0.9,
                    penaltyFactor: 0.95
                }
            };

            expect(scorer.needsEscalation(highConfidenceResult)).toBe(false);
        });
    });

    describe('Integration Tests', () => {
        it('should produce consistent results for the same input', () => {
            const result1 = scorer.calculateConfidence(mockRelationship, mockEvidenceItems);
            const result2 = scorer.calculateConfidence(mockRelationship, mockEvidenceItems);

            expect(result1.finalConfidence).toBeCloseTo(result2.finalConfidence, 3);
            expect(result1.confidenceLevel).toBe(result2.confidenceLevel);
        });

        it('should handle realistic database relationship example', () => {
            const dbRelationship = {
                from: 'database_func_getUserById',
                to: 'user_model_User',
                type: 'CALLS',
                reason: 'Function getUserById calls User model constructor to create user instance',
                evidence: 'new User(userData) called on line 156'
            };

            const evidence = [
                new ConfidenceEvidenceItem({
                    type: 'LLM_REASONING',
                    text: 'Function getUserById calls User model constructor to create user instance',
                    confidence: 0.85,
                    context: { filePath: '/models/user.js' }
                }),
                new ConfidenceEvidenceItem({
                    type: 'SYNTAX_PATTERN',
                    text: 'new User(userData) called on line 156',
                    confidence: 0.9,
                    context: { filePath: '/models/user.js' }
                })
            ];

            const result = scorer.calculateConfidence(dbRelationship, evidence);

            // This should achieve high confidence due to:
            // - Clear syntax pattern (new User())
            // - Semantic consistency (database->user)
            // - Good evidence quality
            expect(result.finalConfidence).toBeGreaterThan(0.75);
            expect(result.confidenceLevel).toMatch(/HIGH|MEDIUM/);
            expect(result.escalationNeeded).toBe(false);
        });

        it('should handle complex multi-factor scoring', () => {
            const complexRelationship = {
                from: 'api_controller_userprofile',
                to: 'auth_service_validatetoken',
                type: 'CALLS',
                reason: 'Controller validates authentication token before processing user profile request',
                evidence: 'validateToken(request.headers.authorization) called in middleware chain'
            };

            const complexEvidence = [
                new ConfidenceEvidenceItem({
                    type: 'LLM_REASONING',
                    text: 'Controller validates authentication token before processing user profile request',
                    confidence: 0.8
                }),
                new ConfidenceEvidenceItem({
                    type: 'SEMANTIC_DOMAIN',
                    text: 'Both entities belong to authentication domain',
                    confidence: 0.7
                }),
                new ConfidenceEvidenceItem({
                    type: 'ARCHITECTURAL_PATTERN',
                    text: 'Follows standard controller->service pattern',
                    confidence: 0.75
                })
            ];

            const result = scorer.calculateConfidence(complexRelationship, complexEvidence);

            // Verify comprehensive scoring
            expect(result.breakdown.factorScores).toBeDefined();
            expect(result.breakdown.weightedSum).toBeGreaterThan(0);
            expect(result.breakdown.penaltyFactor).toBeGreaterThan(0);
            expect(result.breakdown.uncertaintyAdjustment).toBeGreaterThan(0);
            
            // Should achieve good confidence with multiple supporting evidence
            expect(result.finalConfidence).toBeGreaterThan(0.6);
        });
    });
});