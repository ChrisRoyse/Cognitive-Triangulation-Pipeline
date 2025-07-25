const { describe, it, expect, beforeEach, jest } = require('@jest/globals');
const RelationshipResolutionWorker = require('../../../src/workers/relationshipResolutionWorker');
const ConfidenceScorer = require('../../../src/services/ConfidenceScorer');
const { ConfidenceLevels, EscalationTriggers } = require('../../../src/types/ConfidenceTypes');

// Mock dependencies
const mockQueueManager = {
    connection: {},
    getQueue: jest.fn().mockReturnValue({
        add: jest.fn()
    })
};

const mockDbManager = {
    getDb: jest.fn().mockReturnValue({
        prepare: jest.fn().mockReturnValue({
            run: jest.fn()
        })
    })
};

const mockLlmClient = {
    query: jest.fn()
};

const mockWorkerPoolManager = {
    executeWithManagement: jest.fn()
};

describe('RelationshipResolutionWorker - Confidence Scoring Integration', () => {
    let worker;
    let mockJob;

    beforeEach(() => {
        jest.clearAllMocks();
        
        worker = new RelationshipResolutionWorker(
            mockQueueManager,
            mockDbManager,
            mockLlmClient,
            mockWorkerPoolManager,
            {
                processOnly: true, // Skip worker initialization
                enableConfidenceScoring: true,
                confidenceThreshold: 0.6,
                confidenceScorer: {
                    weights: { syntax: 0.3, semantic: 0.3, context: 0.2, crossRef: 0.2 }
                }
            }
        );

        mockJob = {
            id: 'test-job-123',
            data: {
                filePath: '/test/user.js',
                primaryPoi: {
                    id: 1,
                    semantic_id: 'user_func_getProfile',
                    name: 'getProfile',
                    type: 'function'
                },
                contextualPois: [
                    {
                        id: 2,
                        semantic_id: 'database_func_findUser',
                        name: 'findUser',
                        type: 'function'
                    }
                ],
                runId: 'test-run-456',
                jobId: 'job-789'
            }
        };
    });

    describe('Constructor with Confidence Scoring', () => {
        it('should initialize confidence scorer with default options', () => {
            expect(worker.confidenceScorer).toBeInstanceOf(ConfidenceScorer);
            expect(worker.enableConfidenceScoring).toBe(true);
            expect(worker.confidenceThreshold).toBe(0.6);
        });

        it('should initialize escalation triggers', () => {
            expect(worker.escalationTriggers).toBeDefined();
            expect(worker.escalationTriggers.length).toBeGreaterThan(0);
            
            const lowConfidenceTrigger = worker.escalationTriggers.find(
                t => t.triggerType === EscalationTriggers.LOW_CONFIDENCE
            );
            expect(lowConfidenceTrigger).toBeDefined();
        });

        it('should allow disabling confidence scoring', () => {
            const workerWithoutScoring = new RelationshipResolutionWorker(
                mockQueueManager,
                mockDbManager,
                mockLlmClient,
                mockWorkerPoolManager,
                {
                    processOnly: true,
                    enableConfidenceScoring: false
                }
            );

            expect(workerWithoutScoring.enableConfidenceScoring).toBe(false);
        });
    });

    describe('applyConfidenceScoring', () => {
        let mockRelationships;

        beforeEach(() => {
            mockRelationships = [
                {
                    id: 'rel-1',
                    from: 'user_func_getProfile',
                    to: 'database_func_findUser',
                    type: 'CALLS',
                    reason: 'Function getProfile calls findUser to retrieve user data',
                    confidence: 0.8
                },
                {
                    id: 'rel-2',
                    from: 'user_func_getProfile',
                    to: 'cache_func_get',
                    type: 'CALLS',
                    reason: 'Function might use cache for user lookup',
                    confidence: 0.4
                }
            ];
        });

        it('should apply confidence scoring to all relationships', async () => {
            const result = await worker.applyConfidenceScoring(mockRelationships, '/test/user.js');

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            
            // Should have confidence data added to each relationship
            result.forEach(rel => {
                expect(rel).toHaveProperty('confidence');
                expect(rel).toHaveProperty('confidenceLevel');
                expect(rel).toHaveProperty('confidenceBreakdown');
                expect(rel).toHaveProperty('scoringMetadata');
            });
        });

        it('should filter out relationships below confidence threshold', async () => {
            worker.confidenceThreshold = 0.7;

            const result = await worker.applyConfidenceScoring(mockRelationships, '/test/user.js');

            // Should filter out the low-confidence relationship (rel-2)
            expect(result.length).toBeLessThan(mockRelationships.length);
            
            // All remaining relationships should be above threshold
            result.forEach(rel => {
                expect(rel.confidence).toBeGreaterThanOrEqual(0.7);
            });
        });

        it('should handle escalated relationships', async () => {
            const escalatedRelationship = {
                id: 'rel-escalated',
                from: 'unclear_func_x',
                to: 'mysterious_var_y',
                type: 'USES',
                reason: 'Unclear relationship pattern',
                confidence: 0.2
            };

            const result = await worker.applyConfidenceScoring([escalatedRelationship], '/test/unclear.js');

            // Should handle escalation by queuing for review
            expect(mockDbManager.getDb().prepare().run).toHaveBeenCalledWith(
                'relationship-confidence-escalation',
                expect.any(String),
                'PENDING'
            );
        });

        it('should skip scoring when disabled', async () => {
            worker.enableConfidenceScoring = false;

            const result = await worker.applyConfidenceScoring(mockRelationships, '/test/user.js');

            // Should return original relationships unchanged
            expect(result).toEqual(mockRelationships);
        });

        it('should handle empty relationships array', async () => {
            const result = await worker.applyConfidenceScoring([], '/test/empty.js');

            expect(result).toEqual([]);
        });

        it('should handle confidence scoring errors gracefully', async () => {
            // Mock scorer to throw error
            worker.confidenceScorer.calculateConfidence = jest.fn().mockImplementation(() => {
                throw new Error('Scoring error');
            });

            const result = await worker.applyConfidenceScoring(mockRelationships, '/test/error.js');

            // Should include relationships with error confidence
            expect(result.length).toBeGreaterThan(0);
            result.forEach(rel => {
                if (rel.confidenceError) {
                    expect(rel.confidence).toBe(0.1);
                    expect(rel.confidenceLevel).toBe('ERROR');
                }
            });
        });
    });

    describe('createEvidenceItems', () => {
        it('should create evidence from relationship data', () => {
            const relationship = {
                from: 'api_func_handleRequest',
                to: 'auth_func_validateToken',
                type: 'CALLS',
                reason: 'Function handleRequest calls validateToken for authentication',
                evidence: 'validateToken(token) called on line 25'
            };

            const evidenceItems = worker.createEvidenceItems(relationship, '/test/api.js');

            expect(evidenceItems.length).toBeGreaterThan(0);
            
            const reasonEvidence = evidenceItems.find(item => item.type === 'LLM_REASONING');
            expect(reasonEvidence).toBeDefined();
            expect(reasonEvidence.text).toBe(relationship.reason);

            const evidenceItem = evidenceItems.find(item => item.type === 'LLM_EVIDENCE');
            expect(evidenceItem).toBeDefined();
            expect(evidenceItem.text).toBe(relationship.evidence);
        });

        it('should extract contextual evidence from semantic IDs', () => {
            const relationship = {
                from: 'database_func_createUser',
                to: 'database_model_User',
                type: 'CALLS',
                reason: 'Function creates new user instance'
            };

            const evidenceItems = worker.createEvidenceItems(relationship, '/test/database.js');

            // Should find domain consistency evidence
            const domainEvidence = evidenceItems.find(item => item.type === 'SEMANTIC_DOMAIN');
            expect(domainEvidence).toBeDefined();
            expect(domainEvidence.text).toContain('database');
        });

        it('should handle relationships without evidence gracefully', () => {
            const minimalRelationship = {
                from: 'func_a',
                to: 'func_b',
                type: 'CALLS'
            };

            const evidenceItems = worker.createEvidenceItems(minimalRelationship, '/test/minimal.js');

            // Should still create some contextual evidence
            expect(evidenceItems).toBeDefined();
        });
    });

    describe('checkEscalationTriggers', () => {
        it('should trigger on low confidence', () => {
            const lowConfidenceResult = {
                finalConfidence: 0.3,
                breakdown: {
                    uncertaintyAdjustment: 0.8,
                    penaltyFactor: 0.9
                }
            };

            const triggers = worker.checkEscalationTriggers(lowConfidenceResult);

            expect(triggers.length).toBeGreaterThan(0);
            const lowConfTrigger = triggers.find(t => t.triggerType === EscalationTriggers.LOW_CONFIDENCE);
            expect(lowConfTrigger).toBeDefined();
        });

        it('should trigger on high uncertainty', () => {
            const highUncertaintyResult = {
                finalConfidence: 0.7,
                breakdown: {
                    uncertaintyAdjustment: 0.4, // Low adjustment = high uncertainty
                    penaltyFactor: 0.9
                }
            };

            const triggers = worker.checkEscalationTriggers(highUncertaintyResult);

            const uncertaintyTrigger = triggers.find(t => t.triggerType === EscalationTriggers.HIGH_UNCERTAINTY);
            expect(uncertaintyTrigger).toBeDefined();
        });

        it('should not trigger on high confidence results', () => {
            const highConfidenceResult = {
                finalConfidence: 0.9,
                breakdown: {
                    uncertaintyAdjustment: 0.9,
                    penaltyFactor: 0.95
                }
            };

            const triggers = worker.checkEscalationTriggers(highConfidenceResult);

            expect(triggers.length).toBe(0);
        });
    });

    describe('handleEscalatedRelationships', () => {
        it('should queue escalated relationships for review', async () => {
            const escalatedRelationships = [
                {
                    relationship: {
                        from: 'func_a',
                        to: 'func_b',
                        type: 'CALLS',
                        confidence: 0.3
                    },
                    confidenceResult: {
                        finalConfidence: 0.3,
                        confidenceLevel: ConfidenceLevels.VERY_LOW
                    },
                    triggers: [
                        {
                            triggerType: EscalationTriggers.LOW_CONFIDENCE,
                            priority: 'HIGH'
                        }
                    ]
                }
            ];

            await worker.handleEscalatedRelationships(escalatedRelationships, '/test/escalated.js');

            // Should insert escalation into outbox
            expect(mockDbManager.getDb().prepare().run).toHaveBeenCalledWith(
                'relationship-confidence-escalation',
                expect.any(String),
                'PENDING'
            );
        });

        it('should handle multiple escalated relationships', async () => {
            const multipleEscalated = [
                {
                    relationship: { from: 'a', to: 'b', type: 'CALLS' },
                    confidenceResult: { finalConfidence: 0.2 },
                    triggers: [{ triggerType: EscalationTriggers.LOW_CONFIDENCE }]
                },
                {
                    relationship: { from: 'c', to: 'd', type: 'USES' },
                    confidenceResult: { finalConfidence: 0.1 },
                    triggers: [{ triggerType: EscalationTriggers.CONFLICTING_EVIDENCE }]
                }
            ];

            await worker.handleEscalatedRelationships(multipleEscalated, '/test/multiple.js');

            // Should insert multiple escalations
            expect(mockDbManager.getDb().prepare().run).toHaveBeenCalledTimes(2);
        });

        it('should handle database errors gracefully', async () => {
            mockDbManager.getDb().prepare().run.mockImplementationOnce(() => {
                throw new Error('Database error');
            });

            const escalatedRelationships = [
                {
                    relationship: { from: 'a', to: 'b', type: 'CALLS' },
                    confidenceResult: { finalConfidence: 0.2 },
                    triggers: []
                }
            ];

            // Should not throw error
            await expect(
                worker.handleEscalatedRelationships(escalatedRelationships, '/test/error.js')
            ).resolves.not.toThrow();
        });
    });

    describe('Integration with processSinglePoi', () => {
        beforeEach(() => {
            // Mock LLM response
            mockLlmClient.query.mockResolvedValue(JSON.stringify({
                relationships: [
                    {
                        id: 'test-rel-1',
                        from: 'user_func_getProfile',
                        to: 'database_func_findUser',
                        type: 'CALLS',
                        reason: 'Function getProfile calls findUser to retrieve user data',
                        confidence: 0.8
                    }
                ]
            }));
        });

        it('should apply confidence scoring in processSinglePoi', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            await worker.processSinglePoi(mockJob);

            // Should log confidence scoring activity
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Applying confidence scoring')
            );

            // Should insert relationship with confidence data into outbox
            expect(mockDbManager.getDb().prepare().run).toHaveBeenCalledWith(
                'relationship-analysis-finding',
                expect.stringContaining('confidence'),
                'PENDING'
            );

            consoleSpy.mockRestore();
        });

        it('should handle LLM response parsing with confidence', async () => {
            // Mock complex LLM response
            mockLlmClient.query.mockResolvedValue(JSON.stringify({
                relationships: [
                    {
                        id: 'rel-high-conf',
                        from: 'user_func_getProfile',
                        to: 'database_func_findUser',
                        type: 'CALLS',
                        reason: 'Clear function call pattern with strong evidence',
                        confidence: 0.9
                    },
                    {
                        id: 'rel-low-conf',
                        from: 'user_func_getProfile',
                        to: 'unclear_var_x',
                        type: 'USES',
                        reason: 'Unclear usage pattern',
                        confidence: 0.2
                    }
                ]
            }));

            await worker.processSinglePoi(mockJob);

            // Should process both relationships with confidence scoring
            const outboxCalls = mockDbManager.getDb().prepare().run.mock.calls;
            const relationshipCalls = outboxCalls.filter(call => 
                call[0] === 'relationship-analysis-finding'
            );

            expect(relationshipCalls.length).toBeGreaterThan(0);

            // Parse the payload to verify confidence data
            const payload = JSON.parse(relationshipCalls[0][1]);
            expect(payload.relationships).toBeDefined();
            
            payload.relationships.forEach(rel => {
                expect(rel).toHaveProperty('confidence');
                expect(rel).toHaveProperty('confidenceLevel');
            });
        });
    });

    describe('Real-world Confidence Scoring Scenarios', () => {
        it('should handle database relationship with high confidence', async () => {
            const dbRelationship = {
                from: 'database_func_getUserById',
                to: 'user_model_User',
                type: 'CALLS',
                reason: 'Function getUserById calls User model constructor on line 42',
                evidence: 'new User(userData) called directly'
            };

            const result = await worker.applyConfidenceScoring([dbRelationship], '/models/user.js');

            expect(result.length).toBe(1);
            expect(result[0].confidence).toBeGreaterThan(0.7);
            expect(result[0].confidenceLevel).toMatch(/HIGH|MEDIUM/);
        });

        it('should handle API controller relationship with medium confidence', async () => {
            const apiRelationship = {
                from: 'api_controller_users',
                to: 'service_user_manager',
                type: 'CALLS',
                reason: 'Controller delegates to service layer for user management',
                evidence: 'userManager.processRequest() called in handler'
            };

            const result = await worker.applyConfidenceScoring([apiRelationship], '/controllers/users.js');

            expect(result.length).toBe(1);
            expect(result[0].confidence).toBeGreaterThan(0.5);
            expect(result[0].confidenceLevel).toMatch(/HIGH|MEDIUM|LOW/);
        });

        it('should escalate ambiguous relationships', async () => {
            const ambiguousRelationship = {
                from: 'unclear_handler_x',
                to: 'mysterious_util_y',
                type: 'USES',
                reason: 'Possible indirect usage through complex pattern',
                evidence: 'Unclear reference detected'
            };

            const result = await worker.applyConfidenceScoring([ambiguousRelationship], '/utils/unclear.js');

            // Should either filter out or escalate
            if (result.length > 0) {
                expect(result[0]).toHaveProperty('escalationTriggers');
            }

            // Should have queued escalation
            const escalationCalls = mockDbManager.getDb().prepare().run.mock.calls.filter(
                call => call[0] === 'relationship-confidence-escalation'
            );
            expect(escalationCalls.length).toBeGreaterThan(0);
        });
    });
});