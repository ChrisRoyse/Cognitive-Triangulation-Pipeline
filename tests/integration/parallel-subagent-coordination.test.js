const { expect } = require('chai');
const sinon = require('sinon');
const ParallelSubagentCoordinator = require('../../src/services/triangulation/ParallelSubagentCoordinator');
const AdvancedTriangulationOrchestrator = require('../../src/services/triangulation/AdvancedTriangulationOrchestrator');
const { initializeDb } = require('../../src/utils/initializeDb');

describe('Parallel Subagent Coordination System', () => {
    let dbManager;
    let coordinator;
    let orchestrator;
    
    before(async () => {
        // Initialize test database
        dbManager = await initializeDb({ isTest: true });
    });
    
    beforeEach(() => {
        // Create fresh instances for each test
        coordinator = new ParallelSubagentCoordinator(dbManager, {
            maxParallelAgents: 6,
            enablePeerReview: true,
            agentTypes: ['syntactic', 'semantic', 'contextual', 'architecture', 'security', 'performance']
        });
        
        orchestrator = new AdvancedTriangulationOrchestrator(dbManager, {
            enableParallelCoordination: true,
            enableAdvancedConsensus: true,
            cacheResults: true
        });
    });
    
    afterEach(async () => {
        // Cleanup
        if (coordinator) await coordinator.shutdown();
        if (orchestrator) await orchestrator.shutdown();
    });
    
    after(async () => {
        // Close database
        if (dbManager) dbManager.close();
    });
    
    describe('Parallel Agent Spawning', () => {
        it('should spawn 6 specialized agents in parallel', async () => {
            const coordination = {
                id: 'test-coord-1',
                sessionId: 'test-session-1',
                agents: new Map(),
                results: new Map()
            };
            
            const agents = await coordinator.spawnAgentsInParallel(coordination);
            
            expect(agents).to.have.lengthOf(6);
            expect(coordination.agents.size).to.equal(6);
            
            // Verify all agent types are present
            const agentTypes = agents.map(a => a.type);
            expect(agentTypes).to.include.members([
                'syntactic', 'semantic', 'contextual', 
                'architecture', 'security', 'performance'
            ]);
        });
        
        it('should handle partial agent spawn failures gracefully', async () => {
            // Mock factory to fail on security agent
            const mockFactory = sinon.stub(coordinator.subagentFactory, 'createAgentPool');
            mockFactory.resolves({
                agents: [
                    { type: 'syntactic', agent: {} },
                    { type: 'semantic', agent: {} },
                    { type: 'contextual', agent: {} }
                ],
                failures: [
                    { type: 'security', error: 'Mock failure' }
                ],
                summary: { total: 4, successful: 3, failed: 1 }
            });
            
            const coordination = {
                id: 'test-coord-2',
                sessionId: 'test-session-2',
                agents: new Map(),
                results: new Map()
            };
            
            const agents = await coordinator.spawnAgentsInParallel(coordination);
            
            expect(agents).to.have.lengthOf(3);
            expect(coordination.agents.size).to.equal(3);
            
            mockFactory.restore();
        });
    });
    
    describe('Parallel Analysis Execution', () => {
        it('should execute all agents in parallel with isolated contexts', async () => {
            const analysisContext = {
                relationship: {
                    from: 'ComponentA',
                    to: 'ComponentB',
                    type: 'USES',
                    filePath: 'src/components/test.js'
                },
                sourcePoi: {
                    name: 'ComponentA',
                    type: 'class',
                    start_line: 10,
                    end_line: 50
                },
                targetPoi: {
                    name: 'ComponentB',
                    type: 'class',
                    start_line: 60,
                    end_line: 100
                },
                fileContent: 'class ComponentA { ... }'
            };
            
            const coordination = {
                id: 'test-coord-3',
                sessionId: 'test-session-3',
                status: 'INITIALIZING',
                agents: new Map(),
                results: new Map()
            };
            
            // Spawn agents first
            const agents = await coordinator.spawnAgentsInParallel(coordination);
            
            // Execute parallel analysis
            const results = await coordinator.executeParallelAnalysis(
                agents, 
                analysisContext, 
                coordination
            );
            
            expect(results.size).to.equal(6);
            expect(coordination.status).to.equal('ANALYZING');
            
            // Verify each agent received isolated context
            for (const [agentType, result] of results) {
                expect(result).to.have.property('agentType', agentType);
                expect(result).to.have.property('status');
                expect(result).to.have.property('confidenceScore');
            }
        });
        
        it('should handle agent timeouts appropriately', async () => {
            // Create coordinator with short timeout
            const shortTimeoutCoordinator = new ParallelSubagentCoordinator(dbManager, {
                agentTimeout: 100, // 100ms timeout
                agentTypes: ['syntactic', 'semantic']
            });
            
            const analysisContext = {
                relationship: { from: 'A', to: 'B', type: 'USES' },
                sourcePoi: { name: 'A', type: 'class' },
                targetPoi: { name: 'B', type: 'class' },
                fileContent: 'test'
            };
            
            const coordination = {
                id: 'test-coord-4',
                sessionId: 'test-session-4',
                agents: new Map(),
                results: new Map()
            };
            
            // Mock agents to simulate slow response
            const agents = [
                {
                    type: 'syntactic',
                    agent: {
                        analyzeRelationship: async () => {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            return { status: 'COMPLETED' };
                        }
                    }
                },
                {
                    type: 'semantic',
                    agent: {
                        analyzeRelationship: async () => {
                            return { status: 'COMPLETED', confidenceScore: 0.8 };
                        }
                    }
                }
            ];
            
            coordination.agents.set('syntactic', agents[0].agent);
            coordination.agents.set('semantic', agents[1].agent);
            
            const results = await shortTimeoutCoordinator.executeParallelAnalysis(
                agents, 
                analysisContext, 
                coordination
            );
            
            // Syntactic should timeout, semantic should succeed
            const syntacticResult = results.get('syntactic');
            const semanticResult = results.get('semantic');
            
            expect(syntacticResult.status).to.equal('FAILED');
            expect(syntacticResult.errorMessage).to.include('timeout');
            expect(semanticResult.status).to.equal('COMPLETED');
            expect(semanticResult.confidenceScore).to.equal(0.8);
            
            await shortTimeoutCoordinator.shutdown();
        });
    });
    
    describe('Peer Review Chain', () => {
        it('should execute cross-validation reviews between agents', async () => {
            const analysisResults = new Map([
                ['syntactic', { 
                    status: 'COMPLETED', 
                    confidenceScore: 0.8,
                    reasoning: 'Strong syntactic evidence'
                }],
                ['semantic', { 
                    status: 'COMPLETED', 
                    confidenceScore: 0.7,
                    reasoning: 'Moderate semantic relationship'
                }],
                ['contextual', { 
                    status: 'COMPLETED', 
                    confidenceScore: 0.9,
                    reasoning: 'High contextual relevance'
                }]
            ]);
            
            const coordination = {
                id: 'test-coord-5',
                sessionId: 'test-session-5',
                agents: new Map([
                    ['syntactic', { analyzeRelationship: async () => ({ confidenceScore: 0.75 }) }],
                    ['semantic', { analyzeRelationship: async () => ({ confidenceScore: 0.72 }) }],
                    ['contextual', { analyzeRelationship: async () => ({ confidenceScore: 0.88 }) }]
                ]),
                results: analysisResults,
                reviews: new Map()
            };
            
            const reviewResults = await coordinator.executePeerReviewChain(
                analysisResults,
                { relationship: { from: 'A', to: 'B' } },
                coordination
            );
            
            // Each agent should have been reviewed by others
            expect(reviewResults.size).to.be.at.least(2);
            
            for (const [target, reviews] of reviewResults) {
                expect(reviews).to.be.an('array');
                expect(reviews.length).to.be.at.least(1);
                
                reviews.forEach(review => {
                    expect(review).to.have.property('reviewer');
                    expect(review).to.have.property('target', target);
                    expect(review).to.have.property('agreement');
                    expect(review).to.have.property('confidenceDelta');
                });
            }
        });
    });
    
    describe('Conflict Detection and Resolution', () => {
        it('should detect high variance in confidence scores', () => {
            const analysisResults = new Map([
                ['syntactic', { status: 'COMPLETED', confidenceScore: 0.9 }],
                ['semantic', { status: 'COMPLETED', confidenceScore: 0.3 }],
                ['contextual', { status: 'COMPLETED', confidenceScore: 0.8 }]
            ]);
            
            const conflicts = coordinator.detectConflicts(analysisResults, null);
            
            expect(conflicts).to.have.lengthOf.at.least(1);
            
            const varianceConflict = conflicts.find(c => c.type === 'confidence_variance');
            expect(varianceConflict).to.exist;
            expect(varianceConflict.severity).to.equal('high');
            expect(varianceConflict.details.variance).to.be.above(coordinator.config.conflictThreshold);
        });
        
        it('should resolve conflicts through weighted consensus', async () => {
            const conflicts = [{
                type: 'confidence_variance',
                severity: 'high',
                details: {
                    scores: [0.9, 0.3, 0.8],
                    average: 0.67,
                    variance: 0.08
                }
            }];
            
            const analysisResults = new Map([
                ['syntactic', { 
                    status: 'COMPLETED', 
                    confidenceScore: 0.9,
                    evidenceStrength: 0.85,
                    processingTimeMs: 5000
                }],
                ['semantic', { 
                    status: 'COMPLETED', 
                    confidenceScore: 0.3,
                    evidenceStrength: 0.4,
                    processingTimeMs: 8000
                }],
                ['contextual', { 
                    status: 'COMPLETED', 
                    confidenceScore: 0.8,
                    evidenceStrength: 0.75,
                    processingTimeMs: 6000
                }]
            ]);
            
            const coordination = {
                id: 'test-coord-6',
                status: 'ANALYZING',
                conflicts: []
            };
            
            const consensus = await coordinator.resolveConflicts(
                conflicts,
                analysisResults,
                null,
                coordination
            );
            
            expect(consensus).to.have.property('consensusReached', true);
            expect(consensus).to.have.property('confidence');
            expect(consensus.confidence).to.be.above(0.5).and.below(0.9);
            expect(consensus).to.have.property('conflictResolutions');
            expect(consensus.conflictResolutions[0].resolved).to.be.true;
        });
    });
    
    describe('Full Orchestration Integration', () => {
        it('should complete full triangulation with 6 parallel agents', async function() {
            this.timeout(30000); // Extended timeout for full integration test
            
            // Prepare test data
            const db = dbManager.getDb();
            const runId = 'test-run-1';
            
            // Insert test POIs
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, run_id)
                VALUES (1, 'test.js', 'ServiceA', 'class', 10, 50, ?)
            `).run(runId);
            
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, run_id)
                VALUES (1, 'test.js', 'ServiceB', 'class', 60, 100, ?)
            `).run(runId);
            
            const relationship = {
                from: 'ServiceA',
                to: 'ServiceB',
                type: 'IMPLEMENTS',
                filePath: 'test.js'
            };
            
            // Execute full orchestration
            const result = await orchestrator.analyzeRelationship(relationship, runId);
            
            expect(result).to.have.property('sessionId');
            expect(result).to.have.property('finalDecision');
            expect(result.finalDecision).to.have.property('confidence');
            expect(result.finalDecision).to.have.property('recommendation');
            expect(result.finalDecision).to.have.property('reasoning');
            
            expect(result).to.have.property('triangulationResults');
            expect(result.triangulationResults).to.have.property('parallelCoordination');
            expect(result.triangulationResults.parallelCoordination.agentResults).to.be.an('object');
            
            // Verify all 6 agents participated
            const agentResults = result.triangulationResults.parallelCoordination.agentResults;
            expect(Object.keys(agentResults)).to.have.lengthOf(6);
            
            // Verify metadata
            expect(result.metadata.parallelAgents).to.equal(6);
            expect(result.metadata.processingTimeMs).to.be.a('number');
        });
        
        it('should handle cache hits for repeated analyses', async function() {
            this.timeout(20000);
            
            const db = dbManager.getDb();
            const runId = 'test-run-2';
            
            // Insert test POIs
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, run_id)
                VALUES (1, 'cached.js', 'CachedA', 'function', 1, 10, ?)
            `).run(runId);
            
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, run_id)
                VALUES (1, 'cached.js', 'CachedB', 'function', 15, 25, ?)
            `).run(runId);
            
            const relationship = {
                from: 'CachedA',
                to: 'CachedB',
                type: 'CALLS',
                filePath: 'cached.js'
            };
            
            // First analysis (cache miss)
            const startTime1 = Date.now();
            const result1 = await orchestrator.analyzeRelationship(relationship, runId);
            const time1 = Date.now() - startTime1;
            
            expect(result1.metadata.cacheHit).to.be.false;
            
            // Second analysis (cache hit)
            const startTime2 = Date.now();
            const result2 = await orchestrator.analyzeRelationship(relationship, runId);
            const time2 = Date.now() - startTime2;
            
            // Cache hit should be much faster
            expect(time2).to.be.lessThan(time1 / 2);
            expect(orchestrator.orchestrationStats.cacheHits).to.equal(1);
            
            // Results should be identical
            expect(result2.finalDecision.confidence).to.equal(result1.finalDecision.confidence);
        });
    });
    
    describe('Performance and Monitoring', () => {
        it('should track performance metrics across coordinations', async () => {
            const coordination1 = {
                id: 'perf-coord-1',
                sessionId: 'perf-session-1',
                startTime: Date.now(),
                agents: new Map(),
                results: new Map([
                    ['syntactic', { status: 'COMPLETED', confidenceScore: 0.8, processingTimeMs: 5000 }],
                    ['semantic', { status: 'COMPLETED', confidenceScore: 0.7, processingTimeMs: 6000 }]
                ]),
                conflicts: []
            };
            
            coordinator.updatePerformanceMetrics(coordination1, true);
            
            expect(coordinator.performanceStats.totalCoordinations).to.equal(1);
            expect(coordinator.performanceStats.successfulCoordinations).to.equal(1);
            expect(coordinator.performanceStats.averageCoordinationTime).to.be.above(0);
            
            // Check agent-specific metrics
            const syntacticMetrics = coordinator.agentMetrics.get('syntactic');
            expect(syntacticMetrics).to.exist;
            expect(syntacticMetrics.totalRuns).to.equal(1);
            expect(syntacticMetrics.successful).to.equal(1);
            expect(syntacticMetrics.averageConfidence).to.equal(0.8);
        });
        
        it('should provide comprehensive health status', () => {
            const health = coordinator.getHealthStatus();
            
            expect(health).to.have.property('coordinatorId');
            expect(health).to.have.property('status', 'healthy');
            expect(health).to.have.property('config');
            expect(health).to.have.property('performanceStats');
            expect(health).to.have.property('agentHealth');
            expect(health).to.have.property('workerPoolStatus');
        });
    });
});

describe('Advanced Subagent Isolation', () => {
    let factory;
    
    beforeEach(() => {
        factory = require('../../src/services/triangulation/SubagentFactory');
        factory = new factory();
    });
    
    it('should create agents with proper isolation', () => {
        const agent1 = factory.createAgent('syntactic');
        const agent2 = factory.createAgent('syntactic');
        
        // Agents should have different IDs
        expect(agent1.agentId).to.not.equal(agent2.agentId);
        
        // Modifying one should not affect the other (if properly isolated)
        if (agent1.config) {
            agent1.config.timeout = 1000;
            expect(agent2.config?.timeout).to.not.equal(1000);
        }
    });
    
    it('should support all 6 agent types', () => {
        const agentTypes = ['syntactic', 'semantic', 'contextual', 'architecture', 'security', 'performance'];
        
        agentTypes.forEach(type => {
            const agent = factory.createAgent(type);
            expect(agent).to.exist;
            expect(agent.agentType).to.equal(type);
        });
    });
});