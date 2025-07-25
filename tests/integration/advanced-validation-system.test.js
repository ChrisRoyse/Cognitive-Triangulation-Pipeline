const AdvancedRelationshipValidator = require('../../src/services/AdvancedRelationshipValidator');
const EvidenceBasedValidator = require('../../src/services/EvidenceBasedValidator');
const ConflictResolutionEngine = require('../../src/services/ConflictResolutionEngine');
const ConfidenceScorer = require('../../src/services/ConfidenceScorer');

describe('Advanced Relationship Validation System Integration', () => {
    let validator;
    let evidenceValidator;
    let conflictEngine;
    let confidenceScorer;
    let mockDbManager;

    beforeEach(() => {
        // Mock database manager
        mockDbManager = {
            getDb: jest.fn().mockReturnValue({
                prepare: jest.fn().mockReturnValue({
                    all: jest.fn().mockReturnValue([]),
                    get: jest.fn().mockReturnValue({}),
                    run: jest.fn()
                })
            })
        };

        // Initialize components
        confidenceScorer = new ConfidenceScorer();
        validator = new AdvancedRelationshipValidator(mockDbManager, confidenceScorer);
        evidenceValidator = new EvidenceBasedValidator(mockDbManager);
        conflictEngine = new ConflictResolutionEngine(mockDbManager);
    });

    describe('Cross-Mode Validation', () => {
        it('should validate relationships across batch, individual, and triangulated modes', async () => {
            // Create relationships from different analysis modes
            const relationships = [
                // Batch mode analysis
                {
                    id: 'rel1',
                    from: 'AuthService',
                    to: 'Database',
                    type: 'CALLS',
                    confidence: 0.75,
                    analysisMode: 'batch',
                    evidence: 'AuthService calls Database.query() method',
                    created_at: new Date().toISOString()
                },
                // Individual mode analysis
                {
                    id: 'rel2',
                    from: 'AuthService',
                    to: 'DatabaseConfig',
                    type: 'USES',
                    confidence: 0.85,
                    analysisMode: 'individual',
                    evidence: 'AuthService uses DatabaseConfig for connection settings',
                    created_at: new Date().toISOString()
                },
                // Triangulated mode analysis
                {
                    id: 'rel3',
                    from: 'AuthService',
                    to: 'Database',
                    type: 'CALLS',
                    confidence: 0.92,
                    analysisMode: 'triangulated',
                    evidence: 'Confirmed by syntactic, semantic, and contextual analysis',
                    consensus_score: 0.88,
                    created_at: new Date().toISOString()
                }
            ];

            const result = await validator.validateRelationships(relationships, 'test-run-1');

            expect(result.validationId).toBeDefined();
            expect(result.totalRelationships).toBe(3);
            expect(result.uniqueRelationships).toBe(2); // AuthService->Database and AuthService->DatabaseConfig
            expect(result.validationResults).toHaveLength(2);

            // Check first relationship group (AuthService -> Database)
            const dbRelationshipValidation = result.validationResults.find(v => 
                v.relationships.some(r => r.to === 'Database')
            );
            
            expect(dbRelationshipValidation).toBeDefined();
            expect(dbRelationshipValidation.modeComparison.modes).toHaveProperty('batch');
            expect(dbRelationshipValidation.modeComparison.modes).toHaveProperty('triangulated');
            expect(dbRelationshipValidation.conflictAnalysis.hasConflicts).toBe(false);
            expect(dbRelationshipValidation.finalDecision.decision).toBe('ACCEPT');
            expect(dbRelationshipValidation.finalDecision.confidence).toBeGreaterThan(0.8);
        });

        it('should detect and resolve mode conflicts', async () => {
            const relationships = [
                {
                    id: 'rel1',
                    from: 'PaymentService',
                    to: 'BankAPI',
                    type: 'CALLS',
                    confidence: 0.9,
                    analysisMode: 'batch',
                    evidence: 'Direct API call to process payments'
                },
                {
                    id: 'rel2',
                    from: 'PaymentService',
                    to: 'BankAPI',
                    type: 'VALIDATES',
                    confidence: 0.85,
                    analysisMode: 'individual',
                    evidence: 'Validates bank response format'
                },
                {
                    id: 'rel3',
                    from: 'PaymentService',
                    to: 'BankAPI',
                    type: 'DEPENDS_ON',
                    confidence: 0.7,
                    analysisMode: 'triangulated',
                    evidence: 'General dependency relationship'
                }
            ];

            const result = await validator.validateRelationships(relationships, 'test-run-2');
            
            const validation = result.validationResults[0];
            expect(validation.conflictAnalysis.hasConflicts).toBe(true);
            expect(validation.conflictAnalysis.semantic.length).toBeGreaterThan(0);
            expect(validation.resolution).toBeDefined();
            expect(validation.finalDecision.decision).toBeDefined();
        });
    });

    describe('Evidence-Based Validation', () => {
        it('should collect comprehensive evidence for relationships', async () => {
            const relationship = {
                id: 'rel1',
                from: 'UserController',
                to: 'UserService',
                type: 'CALLS',
                confidence: 0.8,
                evidence: 'UserController.createUser() calls UserService.registerUser()',
                file_path: '/src/controllers/UserController.js',
                line_number: 42
            };

            const evidence = await evidenceValidator.collectComprehensiveEvidence(
                relationship, 
                'test-run-3'
            );

            expect(evidence.evidenceId).toBeDefined();
            expect(evidence.evidenceItems).toBeDefined();
            expect(evidence.evidenceItems.length).toBeGreaterThan(0);
            
            // Check evidence types
            const evidenceTypes = evidence.evidenceItems.map(e => e.type);
            expect(evidenceTypes).toContain('syntactic');
            expect(evidenceTypes).toContain('semantic');
            
            // Check evidence chain
            expect(evidence.evidenceChain).toBeDefined();
            expect(evidence.evidenceChain.strength).toBeGreaterThan(0);
            expect(evidence.evidenceChain.completeness).toBeGreaterThan(0);
            
            // Check summary
            expect(evidence.summary.totalItems).toBe(evidence.evidenceItems.length);
            expect(evidence.summary.averageConfidence).toBeGreaterThan(0);
        });

        it('should build evidence correlation matrix', () => {
            const evidenceItems = [
                {
                    type: 'syntactic',
                    subtype: 'function_call',
                    confidence: 0.9,
                    source: 'ast_parsing',
                    timestamp: new Date().toISOString()
                },
                {
                    type: 'semantic',
                    subtype: 'naming_convention',
                    confidence: 0.85,
                    source: 'llm_analysis',
                    timestamp: new Date().toISOString()
                },
                {
                    type: 'syntactic',
                    subtype: 'import_statement',
                    confidence: 0.95,
                    source: 'ast_parsing',
                    timestamp: new Date().toISOString()
                }
            ];

            const matrix = evidenceValidator.buildCorrelationMatrix(evidenceItems);
            
            expect(matrix).toBeDefined();
            expect(matrix[0][0]).toBe(1); // Self-correlation
            expect(matrix[0][2]).toBeGreaterThan(0.5); // Same type correlation
            expect(matrix[0][1]).toBeLessThan(matrix[0][2]); // Different types
        });
    });

    describe('Conflict Detection and Resolution', () => {
        it('should detect semantic conflicts', async () => {
            const relationships = [
                {
                    id: 'rel1',
                    from: 'CacheService',
                    to: 'RedisClient',
                    type: 'USES',
                    confidence: 0.9,
                    evidence: 'CacheService uses RedisClient for caching'
                },
                {
                    id: 'rel2',
                    from: 'CacheService',
                    to: 'RedisClient',
                    type: 'MANAGES',
                    confidence: 0.85,
                    evidence: 'CacheService manages RedisClient lifecycle'
                }
            ];

            const conflicts = await conflictEngine.detectConflicts(relationships);
            
            expect(conflicts.totalConflicts).toBeGreaterThan(0);
            expect(conflicts.conflicts.semantic).toHaveLength(1);
            expect(conflicts.conflicts.semantic[0].type).toBe('semantic');
            expect(conflicts.conflicts.semantic[0].description).toContain('Type mismatch');
        });

        it('should detect temporal conflicts', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 30);
            
            const relationships = [
                {
                    id: 'rel1',
                    from: 'APIGateway',
                    to: 'AuthService',
                    type: 'CALLS',
                    confidence: 0.9,
                    created_at: oldDate.toISOString()
                },
                {
                    id: 'rel2',
                    from: 'APIGateway',
                    to: 'AuthService',
                    type: 'BYPASSES',
                    confidence: 0.85,
                    created_at: new Date().toISOString()
                }
            ];

            const conflicts = await conflictEngine.detectConflicts(relationships);
            
            expect(conflicts.conflicts.temporal).toHaveLength(1);
            expect(conflicts.conflicts.temporal[0].details.daysApart).toBeGreaterThanOrEqual(29);
        });

        it('should detect scope conflicts', async () => {
            const relationships = [
                {
                    id: 'rel1',
                    from: 'LocalCache',
                    to: 'MemoryStore',
                    type: 'USES',
                    confidence: 0.9,
                    scope: 'file',
                    file_path: '/src/cache/LocalCache.js'
                },
                {
                    id: 'rel2',
                    from: 'LocalCache',
                    to: 'MemoryStore',
                    type: 'USES',
                    confidence: 0.85,
                    scope: 'global',
                    cross_file: true
                }
            ];

            const conflicts = await conflictEngine.detectConflicts(relationships);
            
            expect(conflicts.conflicts.scope).toHaveLength(1);
            expect(conflicts.conflicts.scope[0].details.scope1).not.toBe(conflicts.conflicts.scope[0].details.scope2);
        });

        it('should resolve conflicts using consensus strategy', async () => {
            const relationships = [
                {
                    id: 'rel1',
                    from: 'OrderService',
                    to: 'PaymentGateway',
                    type: 'CALLS',
                    confidence: 0.9
                },
                {
                    id: 'rel2',
                    from: 'OrderService',
                    to: 'PaymentGateway',
                    type: 'CALLS',
                    confidence: 0.85
                },
                {
                    id: 'rel3',
                    from: 'OrderService',
                    to: 'PaymentGateway',
                    type: 'DELEGATES',
                    confidence: 0.7
                }
            ];

            const conflicts = await conflictEngine.detectConflicts(relationships);
            const resolution = await conflictEngine.resolveConflicts(conflicts, relationships);
            
            expect(resolution.resolutions).toHaveLength(1);
            expect(resolution.resolutions[0].strategy).toBe('consensus');
            expect(resolution.resolutions[0].selected).toBeDefined();
            expect(resolution.resolutions[0].selected.type).toBe('CALLS'); // Majority type
        });
    });

    describe('Full Validation Pipeline', () => {
        it('should handle complex multi-mode validation scenario', async () => {
            // Simulate complex scenario with multiple analysis modes
            const relationships = [
                // Batch analysis results
                {
                    id: 'batch1',
                    from: 'SecurityModule',
                    to: 'CryptoService',
                    type: 'USES',
                    confidence: 0.7,
                    analysisMode: 'batch',
                    evidence: 'Security module uses crypto for encryption'
                },
                {
                    id: 'batch2',
                    from: 'SecurityModule',
                    to: 'AuditLogger',
                    type: 'CALLS',
                    confidence: 0.8,
                    analysisMode: 'batch',
                    evidence: 'Logs security events'
                },
                
                // Individual analysis results
                {
                    id: 'ind1',
                    from: 'SecurityModule',
                    to: 'CryptoService',
                    type: 'DEPENDS_ON',
                    confidence: 0.85,
                    analysisMode: 'individual',
                    evidence: 'Strong dependency for all security operations'
                },
                {
                    id: 'ind2',
                    from: 'SecurityModule',
                    to: 'TokenValidator',
                    type: 'USES',
                    confidence: 0.9,
                    analysisMode: 'individual',
                    evidence: 'Validates JWT tokens'
                },
                
                // Triangulated analysis results
                {
                    id: 'tri1',
                    from: 'SecurityModule',
                    to: 'CryptoService',
                    type: 'USES',
                    confidence: 0.92,
                    analysisMode: 'triangulated',
                    evidence: 'Confirmed by all analysis perspectives',
                    consensus_score: 0.9
                },
                {
                    id: 'tri2',
                    from: 'SecurityModule',
                    to: 'AuditLogger',
                    type: 'CALLS',
                    confidence: 0.88,
                    analysisMode: 'triangulated',
                    evidence: 'Critical for compliance logging',
                    consensus_score: 0.85
                }
            ];

            // Run full validation
            const validationResult = await validator.validateRelationships(relationships, 'test-run-4');
            
            // Verify grouping
            expect(validationResult.uniqueRelationships).toBe(3); // CryptoService, AuditLogger, TokenValidator
            
            // Check validation report
            const report = validationResult.report;
            expect(report.summary.totalGroups).toBe(3);
            expect(report.summary.accepted).toBeGreaterThan(0);
            
            // Verify conflict resolution
            const cryptoValidation = validationResult.validationResults.find(v =>
                v.relationships.some(r => r.to === 'CryptoService')
            );
            
            expect(cryptoValidation).toBeDefined();
            expect(cryptoValidation.conflictAnalysis.hasConflicts).toBe(true); // USES vs DEPENDS_ON
            expect(cryptoValidation.resolution).toBeDefined();
            expect(cryptoValidation.finalDecision.confidence).toBeGreaterThan(0.8); // High confidence due to triangulation
            
            // Verify evidence collection
            for (const validation of validationResult.validationResults) {
                expect(validation.evidenceAnalysis).toBeDefined();
                expect(validation.evidenceAnalysis.aggregateMetrics).toBeDefined();
            }
        });

        it('should handle escalation scenarios appropriately', async () => {
            const relationships = [
                {
                    id: 'rel1',
                    from: 'PaymentProcessor',
                    to: 'BankingAPI',
                    type: 'CALLS',
                    confidence: 0.4, // Low confidence
                    evidence: 'Unclear relationship'
                },
                {
                    id: 'rel2',
                    from: 'PaymentProcessor',
                    to: 'BankingAPI',
                    type: 'BYPASSES',
                    confidence: 0.45, // Also low confidence
                    evidence: 'Possibly bypasses in test mode'
                }
            ];

            const validationResult = await validator.validateRelationships(relationships, 'test-run-5');
            
            const validation = validationResult.validationResults[0];
            expect(validation.finalDecision.decision).toBe('ESCALATE');
            expect(validation.finalDecision.requiresHumanReview).toBe(true);
            expect(validation.finalDecision.reasoning).toContain('confidence');
        });
    });

    describe('Performance and Caching', () => {
        it('should cache validation results for performance', async () => {
            const relationships = [
                {
                    id: 'rel1',
                    from: 'CacheTest',
                    to: 'TargetService',
                    type: 'CALLS',
                    confidence: 0.85
                }
            ];

            // First call - should miss cache
            await validator.validateRelationships(relationships, 'test-run-6');
            expect(validator.cacheStats.misses).toBe(1);
            expect(validator.cacheStats.hits).toBe(0);

            // Second call with same relationships - should hit cache
            await validator.validateRelationships(relationships, 'test-run-6');
            expect(validator.cacheStats.hits).toBe(1);
            expect(validator.cacheStats.misses).toBe(1);
        });

        it('should handle large relationship sets efficiently', async () => {
            // Generate large set of relationships
            const relationships = [];
            for (let i = 0; i < 100; i++) {
                relationships.push({
                    id: `rel${i}`,
                    from: `Service${Math.floor(i / 10)}`,
                    to: `Target${i % 10}`,
                    type: i % 2 === 0 ? 'CALLS' : 'USES',
                    confidence: 0.5 + Math.random() * 0.5,
                    analysisMode: ['batch', 'individual', 'triangulated'][i % 3]
                });
            }

            const startTime = Date.now();
            const result = await validator.validateRelationships(relationships, 'test-run-7');
            const endTime = Date.now();

            expect(result.totalRelationships).toBe(100);
            expect(result.processingTimeMs).toBeLessThan(5000); // Should complete within 5 seconds
            expect(endTime - startTime).toBeLessThan(5000);
        });
    });
});

describe('Validation System Health and Monitoring', () => {
    it('should report health status of all components', () => {
        const mockDb = {
            getDb: () => ({
                prepare: () => ({
                    all: () => [],
                    get: () => ({}),
                    run: () => {}
                })
            })
        };

        const validator = new AdvancedRelationshipValidator(mockDb, new ConfidenceScorer());
        const evidenceValidator = new EvidenceBasedValidator(mockDb);
        const conflictEngine = new ConflictResolutionEngine(mockDb);

        const validatorHealth = validator.getHealthStatus();
        expect(validatorHealth.status).toBe('healthy');
        expect(validatorHealth.validatorId).toBeDefined();
        expect(validatorHealth.cacheSize).toBeDefined();

        const evidenceHealth = evidenceValidator.getHealthStatus();
        expect(evidenceHealth.status).toBe('healthy');
        expect(evidenceHealth.validatorId).toBeDefined();

        const conflictHealth = conflictEngine.getHealthStatus();
        expect(conflictHealth.status).toBe('healthy');
        expect(conflictHealth.engineId).toBeDefined();
    });
});