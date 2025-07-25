const { v4: uuidv4 } = require('uuid');
const AdvancedRelationshipValidator = require('./AdvancedRelationshipValidator');
const EvidenceBasedValidator = require('./EvidenceBasedValidator');
const ConflictResolutionEngine = require('./ConflictResolutionEngine');

/**
 * ValidationOrchestrator - Coordinates the entire validation pipeline
 * Integrates all validation components for comprehensive relationship validation
 * 
 * Pipeline stages:
 * 1. Pre-validation filtering and grouping
 * 2. Evidence collection and analysis
 * 3. Cross-mode comparison and validation
 * 4. Conflict detection and resolution
 * 5. Final decision making and reporting
 */
class ValidationOrchestrator {
    constructor(dbManager, confidenceScorer, options = {}) {
        this.orchestratorId = uuidv4();
        this.dbManager = dbManager;
        
        // Initialize validation components
        this.relationshipValidator = new AdvancedRelationshipValidator(
            dbManager, 
            confidenceScorer, 
            options.validatorOptions
        );
        
        this.evidenceValidator = new EvidenceBasedValidator(
            dbManager, 
            options.evidenceOptions
        );
        
        this.conflictEngine = new ConflictResolutionEngine(
            dbManager, 
            options.conflictOptions
        );
        
        // Orchestration configuration
        this.config = {
            // Pipeline stages
            stages: {
                preValidation: options.enablePreValidation !== false,
                evidenceCollection: options.enableEvidenceCollection !== false,
                crossModeValidation: options.enableCrossModeValidation !== false,
                conflictResolution: options.enableConflictResolution !== false,
                postValidation: options.enablePostValidation !== false
            },
            
            // Performance settings
            batchSize: options.batchSize || 50,
            parallelProcessing: options.parallelProcessing !== false,
            maxConcurrency: options.maxConcurrency || 5,
            
            // Quality thresholds
            minConfidenceForAcceptance: options.minConfidence || 0.6,
            maxConflictsForAutoResolution: options.maxConflicts || 10,
            evidenceRequiredForHighConfidence: options.evidenceThreshold || 3,
            
            // Reporting options
            generateDetailedReports: options.detailedReports !== false,
            trackValidationMetrics: options.trackMetrics !== false
        };
        
        // Validation metrics
        this.metrics = {
            totalValidations: 0,
            successfulValidations: 0,
            failedValidations: 0,
            escalatedValidations: 0,
            averageProcessingTime: 0,
            conflictsResolved: 0,
            conflictsEscalated: 0
        };
        
        console.log(`[ValidationOrchestrator] Initialized orchestrator ${this.orchestratorId}`);
    }

    /**
     * Orchestrate complete validation pipeline
     */
    async validateRelationshipBatch(relationships, runId, context = {}) {
        const sessionId = uuidv4();
        const startTime = Date.now();
        
        try {
            console.log(`[ValidationOrchestrator] Starting validation session ${sessionId} for ${relationships.length} relationships`);
            
            const pipelineResult = {
                sessionId,
                runId,
                stages: {},
                finalResults: [],
                summary: {},
                metrics: {},
                timestamp: new Date().toISOString()
            };
            
            // Stage 1: Pre-validation
            if (this.config.stages.preValidation) {
                pipelineResult.stages.preValidation = await this.performPreValidation(relationships, context);
                relationships = pipelineResult.stages.preValidation.filteredRelationships;
            }
            
            // Stage 2: Evidence collection
            if (this.config.stages.evidenceCollection) {
                pipelineResult.stages.evidenceCollection = await this.performEvidenceCollection(relationships, runId, context);
            }
            
            // Stage 3: Cross-mode validation
            if (this.config.stages.crossModeValidation) {
                pipelineResult.stages.crossModeValidation = await this.performCrossModeValidation(
                    relationships, 
                    runId, 
                    pipelineResult.stages.evidenceCollection
                );
            }
            
            // Stage 4: Conflict resolution
            if (this.config.stages.conflictResolution) {
                pipelineResult.stages.conflictResolution = await this.performConflictResolution(
                    pipelineResult.stages.crossModeValidation,
                    relationships,
                    context
                );
            }
            
            // Stage 5: Post-validation and final decisions
            if (this.config.stages.postValidation) {
                pipelineResult.stages.postValidation = await this.performPostValidation(
                    pipelineResult.stages,
                    relationships,
                    context
                );
            }
            
            // Generate final results
            pipelineResult.finalResults = this.compileFinalResults(pipelineResult.stages);
            
            // Generate summary report
            pipelineResult.summary = this.generateValidationSummary(pipelineResult);
            
            // Calculate metrics
            const processingTime = Date.now() - startTime;
            pipelineResult.metrics = {
                processingTimeMs: processingTime,
                relationshipsPerSecond: relationships.length / (processingTime / 1000),
                stageTimings: this.calculateStageTimings(pipelineResult.stages)
            };
            
            // Update orchestrator metrics
            this.updateMetrics(pipelineResult);
            
            console.log(`[ValidationOrchestrator] Completed validation session ${sessionId} in ${processingTime}ms`);
            
            return pipelineResult;
            
        } catch (error) {
            console.error(`[ValidationOrchestrator] Validation session ${sessionId} failed:`, error);
            this.metrics.failedValidations++;
            throw error;
        }
    }

    /**
     * Stage 1: Pre-validation filtering and preparation
     */
    async performPreValidation(relationships, context) {
        const startTime = Date.now();
        
        console.log('[ValidationOrchestrator] Starting pre-validation stage');
        
        // Remove duplicates
        const uniqueRelationships = this.deduplicateRelationships(relationships);
        
        // Filter invalid relationships
        const validRelationships = this.filterInvalidRelationships(uniqueRelationships);
        
        // Enrich with metadata
        const enrichedRelationships = await this.enrichRelationshipMetadata(validRelationships, context);
        
        // Group by priority
        const priorityGroups = this.groupByPriority(enrichedRelationships);
        
        return {
            originalCount: relationships.length,
            filteredCount: enrichedRelationships.length,
            duplicatesRemoved: relationships.length - uniqueRelationships.length,
            invalidRemoved: uniqueRelationships.length - validRelationships.length,
            filteredRelationships: enrichedRelationships,
            priorityGroups,
            processingTimeMs: Date.now() - startTime
        };
    }

    /**
     * Stage 2: Evidence collection for all relationships
     */
    async performEvidenceCollection(relationships, runId, context) {
        const startTime = Date.now();
        
        console.log('[ValidationOrchestrator] Starting evidence collection stage');
        
        const evidenceMap = new Map();
        
        // Process in batches for performance
        const batches = this.createBatches(relationships, this.config.batchSize);
        
        for (const batch of batches) {
            const batchResults = await Promise.all(
                batch.map(async rel => {
                    const evidence = await this.evidenceValidator.collectComprehensiveEvidence(rel, runId, context);
                    return { relationship: rel, evidence };
                })
            );
            
            batchResults.forEach(result => {
                evidenceMap.set(
                    result.relationship.id || this.generateRelationshipKey(result.relationship),
                    result.evidence
                );
            });
        }
        
        // Build evidence correlation matrix
        const correlationAnalysis = this.analyzeEvidenceCorrelations(evidenceMap);
        
        return {
            evidenceMap,
            totalEvidenceItems: Array.from(evidenceMap.values())
                .reduce((sum, e) => sum + e.evidenceItems.length, 0),
            correlationAnalysis,
            processingTimeMs: Date.now() - startTime
        };
    }

    /**
     * Stage 3: Cross-mode validation
     */
    async performCrossModeValidation(relationships, runId, evidenceData) {
        const startTime = Date.now();
        
        console.log('[ValidationOrchestrator] Starting cross-mode validation stage');
        
        // Enhance relationships with evidence data
        const enhancedRelationships = relationships.map(rel => {
            const key = rel.id || this.generateRelationshipKey(rel);
            const evidence = evidenceData?.evidenceMap?.get(key);
            
            return {
                ...rel,
                evidenceStrength: evidence?.evidenceChain?.strength || 0,
                evidenceCompleteness: evidence?.evidenceChain?.completeness || 0
            };
        });
        
        // Perform validation
        const validationResult = await this.relationshipValidator.validateRelationships(
            enhancedRelationships, 
            runId
        );
        
        return {
            ...validationResult,
            processingTimeMs: Date.now() - startTime
        };
    }

    /**
     * Stage 4: Conflict resolution
     */
    async performConflictResolution(validationData, relationships, context) {
        const startTime = Date.now();
        
        console.log('[ValidationOrchestrator] Starting conflict resolution stage');
        
        const resolutionResults = [];
        
        // Extract conflicts from validation results
        const conflictGroups = this.extractConflictGroups(validationData);
        
        for (const conflictGroup of conflictGroups) {
            // Detect conflicts
            const conflictAnalysis = await this.conflictEngine.detectConflicts(
                conflictGroup.relationships,
                context
            );
            
            // Resolve if needed
            if (conflictAnalysis.totalConflicts > 0) {
                const resolution = await this.conflictEngine.resolveConflicts(
                    conflictAnalysis,
                    conflictGroup.relationships,
                    context
                );
                
                resolutionResults.push({
                    groupId: conflictGroup.groupId,
                    conflictAnalysis,
                    resolution
                });
            }
        }
        
        return {
            totalGroups: conflictGroups.length,
            groupsWithConflicts: resolutionResults.length,
            resolutionResults,
            processingTimeMs: Date.now() - startTime
        };
    }

    /**
     * Stage 5: Post-validation and final decisions
     */
    async performPostValidation(stages, relationships, context) {
        const startTime = Date.now();
        
        console.log('[ValidationOrchestrator] Starting post-validation stage');
        
        // Quality checks
        const qualityChecks = this.performQualityChecks(stages);
        
        // Consistency verification
        const consistencyChecks = this.verifyConsistency(stages);
        
        // Generate recommendations
        const recommendations = this.generateRecommendations(stages, qualityChecks, consistencyChecks);
        
        // Identify patterns
        const patterns = this.identifyValidationPatterns(stages);
        
        return {
            qualityChecks,
            consistencyChecks,
            recommendations,
            patterns,
            processingTimeMs: Date.now() - startTime
        };
    }

    /**
     * Compile final validation results
     */
    compileFinalResults(stages) {
        const results = [];
        
        // Extract results from cross-mode validation
        if (stages.crossModeValidation?.validationResults) {
            stages.crossModeValidation.validationResults.forEach(validation => {
                const result = {
                    groupId: validation.groupId,
                    relationships: validation.relationships,
                    decision: validation.finalDecision.decision,
                    confidence: validation.finalDecision.confidence,
                    reasoning: validation.finalDecision.reasoning,
                    hasConflicts: validation.conflictAnalysis?.hasConflicts || false,
                    requiresReview: validation.finalDecision.requiresHumanReview || false
                };
                
                // Add resolution data if available
                if (stages.conflictResolution) {
                    const resolution = stages.conflictResolution.resolutionResults.find(
                        r => r.groupId === validation.groupId
                    );
                    
                    if (resolution) {
                        result.conflictResolution = {
                            strategy: resolution.resolution.strategy,
                            confidence: resolution.resolution.report?.averageConfidence || 0
                        };
                    }
                }
                
                results.push(result);
            });
        }
        
        return results;
    }

    /**
     * Generate validation summary report
     */
    generateValidationSummary(pipelineResult) {
        const summary = {
            overview: {
                sessionId: pipelineResult.sessionId,
                runId: pipelineResult.runId,
                totalRelationships: pipelineResult.stages.preValidation?.originalCount || 0,
                processedRelationships: pipelineResult.stages.preValidation?.filteredCount || 0,
                totalGroups: pipelineResult.finalResults.length,
                timestamp: pipelineResult.timestamp
            },
            decisions: {
                accepted: 0,
                rejected: 0,
                escalated: 0,
                requiresReview: 0
            },
            quality: {
                averageConfidence: 0,
                highConfidenceCount: 0,
                lowConfidenceCount: 0,
                conflictRate: 0
            },
            performance: {
                totalProcessingTime: pipelineResult.metrics.processingTimeMs,
                relationshipsPerSecond: pipelineResult.metrics.relationshipsPerSecond,
                bottlenecks: []
            }
        };
        
        // Calculate decision statistics
        let totalConfidence = 0;
        pipelineResult.finalResults.forEach(result => {
            summary.decisions[result.decision.toLowerCase()]++;
            if (result.requiresReview) summary.decisions.requiresReview++;
            
            totalConfidence += result.confidence;
            
            if (result.confidence >= 0.8) summary.quality.highConfidenceCount++;
            if (result.confidence < 0.5) summary.quality.lowConfidenceCount++;
        });
        
        summary.quality.averageConfidence = pipelineResult.finalResults.length > 0 ?
            totalConfidence / pipelineResult.finalResults.length : 0;
        
        // Calculate conflict rate
        const conflictCount = pipelineResult.finalResults.filter(r => r.hasConflicts).length;
        summary.quality.conflictRate = pipelineResult.finalResults.length > 0 ?
            conflictCount / pipelineResult.finalResults.length : 0;
        
        // Identify performance bottlenecks
        const stageTimings = pipelineResult.metrics.stageTimings || {};
        const avgTime = Object.values(stageTimings).reduce((sum, time) => sum + time, 0) / Object.keys(stageTimings).length;
        
        Object.entries(stageTimings).forEach(([stage, time]) => {
            if (time > avgTime * 1.5) {
                summary.performance.bottlenecks.push({
                    stage,
                    time,
                    percentOfTotal: (time / pipelineResult.metrics.processingTimeMs) * 100
                });
            }
        });
        
        return summary;
    }

    // Helper methods

    deduplicateRelationships(relationships) {
        const seen = new Set();
        return relationships.filter(rel => {
            const key = this.generateRelationshipKey(rel);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    filterInvalidRelationships(relationships) {
        return relationships.filter(rel => {
            // Must have source and target
            if (!rel.from && !rel.source) return false;
            if (!rel.to && !rel.target) return false;
            
            // Must have a type
            if (!rel.type) return false;
            
            // Confidence must be valid
            if (rel.confidence !== undefined && (rel.confidence < 0 || rel.confidence > 1)) return false;
            
            return true;
        });
    }

    async enrichRelationshipMetadata(relationships, context) {
        return relationships.map(rel => ({
            ...rel,
            validationTimestamp: new Date().toISOString(),
            context: context.name || 'default',
            priority: this.calculateRelationshipPriority(rel)
        }));
    }

    calculateRelationshipPriority(relationship) {
        let priority = 0;
        
        // High confidence gets higher priority
        if (relationship.confidence >= 0.8) priority += 3;
        else if (relationship.confidence >= 0.6) priority += 2;
        else priority += 1;
        
        // Triangulated mode gets highest priority
        if (relationship.analysisMode === 'triangulated') priority += 3;
        else if (relationship.analysisMode === 'individual') priority += 2;
        else priority += 1;
        
        // Critical relationship types
        const criticalTypes = ['CALLS', 'DEPENDS_ON', 'MANAGES'];
        if (criticalTypes.includes(relationship.type)) priority += 2;
        
        return priority;
    }

    groupByPriority(relationships) {
        const groups = {
            high: [],
            medium: [],
            low: []
        };
        
        relationships.forEach(rel => {
            if (rel.priority >= 7) groups.high.push(rel);
            else if (rel.priority >= 4) groups.medium.push(rel);
            else groups.low.push(rel);
        });
        
        return groups;
    }

    createBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    generateRelationshipKey(relationship) {
        const from = relationship.from || relationship.source || '';
        const to = relationship.to || relationship.target || '';
        const type = relationship.type || '';
        return `${from}_${type}_${to}`.toLowerCase();
    }

    analyzeEvidenceCorrelations(evidenceMap) {
        const correlations = {
            strongCorrelations: 0,
            weakCorrelations: 0,
            averageCorrelation: 0
        };
        
        const allChains = Array.from(evidenceMap.values())
            .map(e => e.evidenceChain)
            .filter(chain => chain && chain.links);
        
        let totalCorrelation = 0;
        let linkCount = 0;
        
        allChains.forEach(chain => {
            chain.links.forEach(link => {
                linkCount++;
                totalCorrelation += link.correlation;
                
                if (link.correlation >= 0.8) correlations.strongCorrelations++;
                else if (link.correlation < 0.4) correlations.weakCorrelations++;
            });
        });
        
        correlations.averageCorrelation = linkCount > 0 ? totalCorrelation / linkCount : 0;
        
        return correlations;
    }

    extractConflictGroups(validationData) {
        const groups = [];
        
        if (validationData.validationResults) {
            validationData.validationResults.forEach(validation => {
                if (validation.conflictAnalysis?.hasConflicts) {
                    groups.push({
                        groupId: validation.groupId,
                        relationships: validation.relationships,
                        conflicts: validation.conflictAnalysis
                    });
                }
            });
        }
        
        return groups;
    }

    performQualityChecks(stages) {
        const checks = {
            dataQuality: 'PASS',
            evidenceQuality: 'PASS',
            validationQuality: 'PASS',
            issues: []
        };
        
        // Check data quality
        if (stages.preValidation) {
            const removalRate = (stages.preValidation.duplicatesRemoved + stages.preValidation.invalidRemoved) / 
                                stages.preValidation.originalCount;
            
            if (removalRate > 0.2) {
                checks.dataQuality = 'WARNING';
                checks.issues.push(`High data quality issues: ${(removalRate * 100).toFixed(1)}% relationships filtered`);
            }
        }
        
        // Check evidence quality
        if (stages.evidenceCollection) {
            const avgCorrelation = stages.evidenceCollection.correlationAnalysis?.averageCorrelation || 0;
            
            if (avgCorrelation < 0.5) {
                checks.evidenceQuality = 'WARNING';
                checks.issues.push(`Low evidence correlation: ${avgCorrelation.toFixed(3)}`);
            }
        }
        
        // Check validation quality
        if (stages.crossModeValidation) {
            const report = stages.crossModeValidation.report;
            if (report && report.summary.escalated > report.summary.totalGroups * 0.3) {
                checks.validationQuality = 'WARNING';
                checks.issues.push('High escalation rate in validation');
            }
        }
        
        return checks;
    }

    verifyConsistency(stages) {
        const consistency = {
            crossStageConsistency: true,
            dataFlowIntegrity: true,
            issues: []
        };
        
        // Verify relationship counts are consistent
        if (stages.preValidation && stages.crossModeValidation) {
            const preCount = stages.preValidation.filteredCount;
            const validationCount = stages.crossModeValidation.totalRelationships;
            
            if (Math.abs(preCount - validationCount) > 0) {
                consistency.dataFlowIntegrity = false;
                consistency.issues.push(`Relationship count mismatch: ${preCount} vs ${validationCount}`);
            }
        }
        
        return consistency;
    }

    generateRecommendations(stages, qualityChecks, consistencyChecks) {
        const recommendations = [];
        
        // Based on quality checks
        qualityChecks.issues.forEach(issue => {
            if (issue.includes('data quality')) {
                recommendations.push({
                    category: 'data_quality',
                    priority: 'high',
                    recommendation: 'Implement stricter data validation at source'
                });
            }
            
            if (issue.includes('evidence correlation')) {
                recommendations.push({
                    category: 'evidence',
                    priority: 'medium',
                    recommendation: 'Enhance evidence collection mechanisms'
                });
            }
        });
        
        // Based on validation results
        if (stages.crossModeValidation?.report?.recommendations) {
            stages.crossModeValidation.report.recommendations.forEach(rec => {
                recommendations.push({
                    category: 'validation',
                    priority: 'medium',
                    recommendation: rec
                });
            });
        }
        
        // Based on conflict resolution
        if (stages.conflictResolution && stages.conflictResolution.groupsWithConflicts > 5) {
            recommendations.push({
                category: 'conflicts',
                priority: 'high',
                recommendation: 'Review analysis mode consistency to reduce conflicts'
            });
        }
        
        return recommendations;
    }

    identifyValidationPatterns(stages) {
        const patterns = {
            commonConflictTypes: [],
            frequentDecisions: {},
            modePerformance: {}
        };
        
        // Analyze conflict patterns
        if (stages.conflictResolution?.resolutionResults) {
            const conflictTypes = {};
            
            stages.conflictResolution.resolutionResults.forEach(result => {
                result.conflictAnalysis.patterns?.dominantType && 
                    (conflictTypes[result.conflictAnalysis.patterns.dominantType] = 
                        (conflictTypes[result.conflictAnalysis.patterns.dominantType] || 0) + 1);
            });
            
            patterns.commonConflictTypes = Object.entries(conflictTypes)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([type, count]) => ({ type, count }));
        }
        
        // Analyze decision patterns
        if (stages.crossModeValidation?.validationResults) {
            stages.crossModeValidation.validationResults.forEach(validation => {
                const decision = validation.finalDecision.decision;
                patterns.frequentDecisions[decision] = (patterns.frequentDecisions[decision] || 0) + 1;
            });
        }
        
        return patterns;
    }

    calculateStageTimings(stages) {
        const timings = {};
        
        Object.entries(stages).forEach(([stageName, stageData]) => {
            if (stageData && stageData.processingTimeMs) {
                timings[stageName] = stageData.processingTimeMs;
            }
        });
        
        return timings;
    }

    updateMetrics(pipelineResult) {
        this.metrics.totalValidations++;
        
        if (pipelineResult.summary) {
            if (pipelineResult.summary.decisions.escalated === 0) {
                this.metrics.successfulValidations++;
            }
            
            this.metrics.escalatedValidations += pipelineResult.summary.decisions.escalated;
            
            // Update average processing time
            const currentAvg = this.metrics.averageProcessingTime;
            const newTime = pipelineResult.metrics.processingTimeMs;
            this.metrics.averageProcessingTime = 
                (currentAvg * (this.metrics.totalValidations - 1) + newTime) / this.metrics.totalValidations;
        }
        
        if (pipelineResult.stages.conflictResolution) {
            this.metrics.conflictsResolved += 
                pipelineResult.stages.conflictResolution.resolutionResults.length;
        }
    }

    /**
     * Get orchestrator health status and metrics
     */
    getHealthStatus() {
        return {
            orchestratorId: this.orchestratorId,
            status: 'healthy',
            metrics: { ...this.metrics },
            componentHealth: {
                relationshipValidator: this.relationshipValidator.getHealthStatus(),
                evidenceValidator: this.evidenceValidator.getHealthStatus(),
                conflictEngine: this.conflictEngine.getHealthStatus()
            },
            config: this.config
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            totalValidations: 0,
            successfulValidations: 0,
            failedValidations: 0,
            escalatedValidations: 0,
            averageProcessingTime: 0,
            conflictsResolved: 0,
            conflictsEscalated: 0
        };
        
        console.log('[ValidationOrchestrator] Metrics reset');
    }
}

module.exports = ValidationOrchestrator;