const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * AdvancedRelationshipValidator - Comprehensive validation system for cognitive triangulation
 * Implements cross-mode comparison, evidence-based validation, conflict detection & resolution
 * 
 * Core capabilities:
 * - Cross-mode validation (batch vs individual vs triangulated)
 * - Evidence collection and weighting system
 * - Multi-dimensional conflict detection
 * - Automated conflict resolution with escalation
 * - Performance-optimized validation caching
 */
class AdvancedRelationshipValidator {
    constructor(dbManager, confidenceScorer, options = {}) {
        this.validatorId = uuidv4();
        this.dbManager = dbManager;
        this.confidenceScorer = confidenceScorer;
        
        // Validation configuration
        this.config = {
            // Mode comparison thresholds
            modeVarianceThreshold: options.modeVarianceThreshold || 0.15,
            semanticSimilarityThreshold: options.semanticSimilarityThreshold || 0.7,
            
            // Evidence weighting factors
            evidenceWeights: {
                syntactic: options.syntacticWeight || 0.25,
                semantic: options.semanticWeight || 0.30,
                contextual: options.contextualWeight || 0.25,
                triangulated: options.triangulatedWeight || 0.20
            },
            
            // Conflict detection thresholds
            conflictThresholds: {
                semantic: options.semanticConflictThreshold || 0.4,
                temporal: options.temporalConflictThreshold || 0.3,
                scope: options.scopeConflictThreshold || 0.35,
                confidence: options.confidenceConflictThreshold || 0.25
            },
            
            // Resolution strategies
            resolutionStrategies: {
                highConfidenceWins: 'Select relationship with highest confidence',
                evidenceWeighted: 'Weight by evidence strength and recency',
                consensusBased: 'Use consensus from multiple modes',
                contextAware: 'Consider context and scope for resolution'
            },
            defaultStrategy: options.defaultStrategy || 'evidenceWeighted',
            
            // Caching configuration
            cacheEnabled: options.cacheEnabled !== false,
            cacheTTL: options.cacheTTL || 300000, // 5 minutes
            maxCacheSize: options.maxCacheSize || 10000
        };
        
        // Validation cache for performance
        this.validationCache = new Map();
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
        
        // Conflict resolution history
        this.conflictHistory = new Map();
        
        console.log(`[AdvancedRelationshipValidator] Initialized validator ${this.validatorId} with config:`, {
            modeVarianceThreshold: this.config.modeVarianceThreshold,
            defaultStrategy: this.config.defaultStrategy,
            cacheEnabled: this.config.cacheEnabled
        });
    }

    /**
     * Validate relationships across multiple analysis modes
     * @param {Array} relationships - Array of relationships from different modes
     * @param {String} runId - Current analysis run ID
     * @returns {Object} Comprehensive validation result
     */
    async validateRelationships(relationships, runId) {
        const validationId = uuidv4();
        const startTime = Date.now();
        
        try {
            console.log(`[AdvancedRelationshipValidator] Starting validation ${validationId} for ${relationships.length} relationships`);
            
            // Group relationships by semantic identity
            const groupedRelationships = this.groupRelationshipsBySemanticId(relationships);
            
            // Validate each relationship group
            const validationResults = [];
            
            for (const [semanticKey, relationshipGroup] of groupedRelationships) {
                // Check cache first
                const cachedResult = this.getCachedValidation(semanticKey);
                if (cachedResult) {
                    validationResults.push(cachedResult);
                    continue;
                }
                
                // Perform comprehensive validation
                const result = await this.validateRelationshipGroup(relationshipGroup, runId);
                
                // Cache the result
                this.cacheValidationResult(semanticKey, result);
                
                validationResults.push(result);
            }
            
            // Generate validation report
            const validationReport = this.generateValidationReport(validationResults);
            
            const processingTime = Date.now() - startTime;
            
            return {
                validationId,
                runId,
                totalRelationships: relationships.length,
                uniqueRelationships: groupedRelationships.size,
                validationResults,
                report: validationReport,
                processingTimeMs: processingTime,
                cacheStats: { ...this.cacheStats },
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[AdvancedRelationshipValidator] Validation ${validationId} failed:`, error);
            throw error;
        }
    }

    /**
     * Validate a group of relationships representing the same semantic connection
     */
    async validateRelationshipGroup(relationshipGroup, runId) {
        const groupId = uuidv4();
        
        try {
            // Step 1: Cross-mode comparison
            const modeComparison = this.performCrossModeComparison(relationshipGroup);
            
            // Step 2: Evidence collection and analysis
            const evidenceAnalysis = await this.analyzeEvidence(relationshipGroup, runId);
            
            // Step 3: Conflict detection
            const conflictAnalysis = this.detectConflicts(relationshipGroup, modeComparison);
            
            // Step 4: Resolution if conflicts exist
            let resolution = null;
            if (conflictAnalysis.hasConflicts) {
                resolution = await this.resolveConflicts(conflictAnalysis, relationshipGroup, evidenceAnalysis);
            }
            
            // Step 5: Final validation decision
            const finalDecision = this.makeFinalDecision(
                modeComparison, 
                evidenceAnalysis, 
                conflictAnalysis, 
                resolution
            );
            
            return {
                groupId,
                relationships: relationshipGroup,
                modeComparison,
                evidenceAnalysis,
                conflictAnalysis,
                resolution,
                finalDecision,
                validatedAt: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[AdvancedRelationshipValidator] Group validation ${groupId} failed:`, error);
            
            return {
                groupId,
                relationships: relationshipGroup,
                status: 'FAILED',
                error: error.message,
                validatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Perform cross-mode comparison between batch, individual, and triangulated analyses
     */
    performCrossModeComparison(relationshipGroup) {
        const comparison = {
            modes: {},
            consistency: 0,
            variance: 0,
            agreementMatrix: {}
        };
        
        // Categorize relationships by mode
        relationshipGroup.forEach(rel => {
            const mode = this.identifyAnalysisMode(rel);
            if (!comparison.modes[mode]) {
                comparison.modes[mode] = [];
            }
            comparison.modes[mode].push(rel);
        });
        
        // Calculate inter-mode consistency
        const modeNames = Object.keys(comparison.modes);
        let totalComparisons = 0;
        let consistentComparisons = 0;
        
        for (let i = 0; i < modeNames.length; i++) {
            for (let j = i + 1; j < modeNames.length; j++) {
                const mode1 = modeNames[i];
                const mode2 = modeNames[j];
                
                const consistency = this.calculateModeConsistency(
                    comparison.modes[mode1], 
                    comparison.modes[mode2]
                );
                
                comparison.agreementMatrix[`${mode1}-${mode2}`] = consistency;
                totalComparisons++;
                
                if (consistency.agreementScore > this.config.semanticSimilarityThreshold) {
                    consistentComparisons++;
                }
            }
        }
        
        comparison.consistency = totalComparisons > 0 ? 
            consistentComparisons / totalComparisons : 0;
        
        // Calculate confidence variance across modes
        const allConfidences = relationshipGroup.map(rel => rel.confidence || 0);
        comparison.variance = this.calculateVariance(allConfidences);
        
        // Determine if modes agree
        comparison.modesAgree = comparison.variance < this.config.modeVarianceThreshold;
        
        return comparison;
    }

    /**
     * Analyze and collect evidence from multiple sources
     */
    async analyzeEvidence(relationshipGroup, runId) {
        const evidenceMap = new Map();
        
        for (const relationship of relationshipGroup) {
            // Collect evidence from different sources
            const evidenceSources = await this.collectEvidenceSources(relationship, runId);
            
            // Weight evidence by source reliability
            const weightedEvidence = this.weightEvidence(evidenceSources);
            
            // Correlate evidence for consistency
            const correlationScore = this.correlateEvidence(evidenceSources);
            
            evidenceMap.set(relationship.id || relationship.semantic_id, {
                sources: evidenceSources,
                weightedStrength: weightedEvidence,
                correlationScore,
                confidence: relationship.confidence || 0
            });
        }
        
        // Calculate aggregate evidence metrics
        const aggregateMetrics = this.calculateAggregateEvidenceMetrics(evidenceMap);
        
        return {
            evidenceMap,
            aggregateMetrics,
            totalSources: Array.from(evidenceMap.values())
                .reduce((sum, e) => sum + e.sources.length, 0)
        };
    }

    /**
     * Detect various types of conflicts between relationships
     */
    detectConflicts(relationshipGroup, modeComparison) {
        const conflicts = {
            semantic: [],
            temporal: [],
            scope: [],
            confidence: [],
            hasConflicts: false
        };
        
        // Semantic conflicts - same relationship, different meanings
        for (let i = 0; i < relationshipGroup.length; i++) {
            for (let j = i + 1; j < relationshipGroup.length; j++) {
                const rel1 = relationshipGroup[i];
                const rel2 = relationshipGroup[j];
                
                // Check semantic conflict
                if (this.hasSemanticConflict(rel1, rel2)) {
                    conflicts.semantic.push({
                        relationship1: rel1,
                        relationship2: rel2,
                        conflictType: 'semantic_mismatch',
                        severity: this.calculateConflictSeverity(rel1, rel2)
                    });
                }
                
                // Check temporal conflict
                if (this.hasTemporalConflict(rel1, rel2)) {
                    conflicts.temporal.push({
                        relationship1: rel1,
                        relationship2: rel2,
                        conflictType: 'temporal_inconsistency',
                        severity: this.calculateTemporalSeverity(rel1, rel2)
                    });
                }
                
                // Check scope conflict
                if (this.hasScopeConflict(rel1, rel2)) {
                    conflicts.scope.push({
                        relationship1: rel1,
                        relationship2: rel2,
                        conflictType: 'scope_mismatch',
                        severity: this.calculateScopeSeverity(rel1, rel2)
                    });
                }
                
                // Check confidence conflict
                const confidenceDiff = Math.abs((rel1.confidence || 0) - (rel2.confidence || 0));
                if (confidenceDiff > this.config.conflictThresholds.confidence) {
                    conflicts.confidence.push({
                        relationship1: rel1,
                        relationship2: rel2,
                        conflictType: 'confidence_disparity',
                        difference: confidenceDiff,
                        severity: confidenceDiff / this.config.conflictThresholds.confidence
                    });
                }
            }
        }
        
        conflicts.hasConflicts = 
            conflicts.semantic.length > 0 ||
            conflicts.temporal.length > 0 ||
            conflicts.scope.length > 0 ||
            conflicts.confidence.length > 0;
        
        // Calculate overall conflict severity
        conflicts.overallSeverity = this.calculateOverallConflictSeverity(conflicts);
        
        return conflicts;
    }

    /**
     * Resolve detected conflicts using configured strategies
     */
    async resolveConflicts(conflictAnalysis, relationshipGroup, evidenceAnalysis) {
        const resolutionId = uuidv4();
        const strategy = this.config.defaultStrategy;
        
        console.log(`[AdvancedRelationshipValidator] Resolving conflicts using strategy: ${strategy}`);
        
        let resolution;
        
        switch (strategy) {
            case 'highConfidenceWins':
                resolution = this.resolveByHighestConfidence(relationshipGroup, evidenceAnalysis);
                break;
                
            case 'evidenceWeighted':
                resolution = this.resolveByEvidenceWeight(relationshipGroup, evidenceAnalysis);
                break;
                
            case 'consensusBased':
                resolution = this.resolveByConsensus(relationshipGroup, conflictAnalysis);
                break;
                
            case 'contextAware':
                resolution = await this.resolveByContext(relationshipGroup, evidenceAnalysis);
                break;
                
            default:
                resolution = this.resolveByEvidenceWeight(relationshipGroup, evidenceAnalysis);
        }
        
        // Store resolution in history
        this.storeConflictResolution(resolutionId, conflictAnalysis, resolution);
        
        return {
            resolutionId,
            strategy,
            resolution,
            conflictsResolved: this.countResolvedConflicts(conflictAnalysis),
            requiresEscalation: resolution.requiresEscalation || false,
            confidence: resolution.confidence || 0,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Make final validation decision based on all analyses
     */
    makeFinalDecision(modeComparison, evidenceAnalysis, conflictAnalysis, resolution) {
        let decision = 'ACCEPT';
        let confidence = 0;
        let reasoning = [];
        let requiresHumanReview = false;
        
        // Check mode agreement
        if (!modeComparison.modesAgree) {
            reasoning.push(`Mode variance (${modeComparison.variance.toFixed(3)}) exceeds threshold`);
            confidence -= 0.2;
        } else {
            reasoning.push(`Modes show good agreement (variance: ${modeComparison.variance.toFixed(3)})`);
            confidence += 0.1;
        }
        
        // Check evidence strength
        const avgEvidenceStrength = evidenceAnalysis.aggregateMetrics.averageStrength;
        if (avgEvidenceStrength < 0.5) {
            reasoning.push(`Weak evidence strength (${avgEvidenceStrength.toFixed(3)})`);
            confidence -= 0.15;
        } else {
            reasoning.push(`Strong evidence support (${avgEvidenceStrength.toFixed(3)})`);
            confidence += avgEvidenceStrength * 0.2;
        }
        
        // Check conflicts
        if (conflictAnalysis.hasConflicts) {
            if (conflictAnalysis.overallSeverity > 0.7) {
                decision = 'ESCALATE';
                requiresHumanReview = true;
                reasoning.push(`Severe conflicts detected (severity: ${conflictAnalysis.overallSeverity.toFixed(3)})`);
            } else if (resolution && resolution.confidence > 0.6) {
                reasoning.push(`Conflicts resolved with confidence ${resolution.confidence.toFixed(3)}`);
                confidence = resolution.confidence;
            } else {
                decision = 'REJECT';
                reasoning.push(`Unable to resolve conflicts satisfactorily`);
            }
        } else {
            reasoning.push(`No significant conflicts detected`);
            confidence += 0.1;
        }
        
        // Calculate final confidence from base + adjustments
        const baseConfidence = evidenceAnalysis.aggregateMetrics.averageConfidence || 0.5;
        confidence = Math.max(0, Math.min(1, baseConfidence + confidence));
        
        // Final decision based on confidence
        if (confidence >= 0.7 && decision !== 'ESCALATE') {
            decision = 'ACCEPT';
        } else if (confidence < 0.4) {
            decision = 'REJECT';
        } else if (confidence < 0.6 && conflictAnalysis.hasConflicts) {
            decision = 'ESCALATE';
            requiresHumanReview = true;
        }
        
        return {
            decision,
            confidence,
            reasoning: reasoning.join('; '),
            requiresHumanReview,
            factors: {
                modeAgreement: modeComparison.modesAgree,
                evidenceStrength: avgEvidenceStrength,
                hasConflicts: conflictAnalysis.hasConflicts,
                conflictSeverity: conflictAnalysis.overallSeverity || 0,
                resolutionConfidence: resolution?.confidence || 0
            }
        };
    }

    /**
     * Group relationships by semantic identity for comparison
     */
    groupRelationshipsBySemanticId(relationships) {
        const grouped = new Map();
        
        relationships.forEach(rel => {
            const semanticKey = this.generateSemanticKey(rel);
            
            if (!grouped.has(semanticKey)) {
                grouped.set(semanticKey, []);
            }
            
            grouped.get(semanticKey).push(rel);
        });
        
        return grouped;
    }

    /**
     * Generate semantic key for relationship grouping
     */
    generateSemanticKey(relationship) {
        const from = relationship.from || relationship.source || '';
        const to = relationship.to || relationship.target || '';
        const type = relationship.type || 'UNKNOWN';
        
        // Create normalized semantic key
        return `${from.toLowerCase()}_${type.toLowerCase()}_${to.toLowerCase()}`;
    }

    /**
     * Identify analysis mode from relationship metadata
     */
    identifyAnalysisMode(relationship) {
        if (relationship.analysisMode) {
            return relationship.analysisMode;
        }
        
        // Infer from other metadata
        if (relationship.triangulated || relationship.consensus_score) {
            return 'triangulated';
        } else if (relationship.batch_id || relationship.batch_analysis) {
            return 'batch';
        } else {
            return 'individual';
        }
    }

    /**
     * Calculate consistency between two analysis modes
     */
    calculateModeConsistency(mode1Relationships, mode2Relationships) {
        let matchCount = 0;
        let totalComparisons = 0;
        
        mode1Relationships.forEach(rel1 => {
            mode2Relationships.forEach(rel2 => {
                totalComparisons++;
                
                // Check if relationships are semantically similar
                const similarity = this.calculateSemanticSimilarity(rel1, rel2);
                if (similarity > this.config.semanticSimilarityThreshold) {
                    matchCount++;
                }
            });
        });
        
        const agreementScore = totalComparisons > 0 ? matchCount / totalComparisons : 0;
        
        return {
            agreementScore,
            matchCount,
            totalComparisons
        };
    }

    /**
     * Calculate semantic similarity between two relationships
     */
    calculateSemanticSimilarity(rel1, rel2) {
        let similarity = 0;
        
        // Type similarity
        if (rel1.type === rel2.type) {
            similarity += 0.3;
        }
        
        // Source/target similarity
        if (this.areEntitiesSimilar(rel1.from, rel2.from)) {
            similarity += 0.35;
        }
        if (this.areEntitiesSimilar(rel1.to, rel2.to)) {
            similarity += 0.35;
        }
        
        return similarity;
    }

    /**
     * Check if two entities are semantically similar
     */
    areEntitiesSimilar(entity1, entity2) {
        if (!entity1 || !entity2) return false;
        
        const e1 = entity1.toLowerCase();
        const e2 = entity2.toLowerCase();
        
        // Exact match
        if (e1 === e2) return true;
        
        // Check if one contains the other
        if (e1.includes(e2) || e2.includes(e1)) return true;
        
        // Check common patterns
        const e1Parts = e1.split(/[_\-\.]/);
        const e2Parts = e2.split(/[_\-\.]/);
        
        const intersection = e1Parts.filter(part => e2Parts.includes(part));
        return intersection.length > 0;
    }

    /**
     * Collect evidence from multiple sources
     */
    async collectEvidenceSources(relationship, runId) {
        const sources = [];
        
        // Direct evidence from relationship
        if (relationship.evidence || relationship.reason) {
            sources.push({
                type: 'direct',
                content: relationship.evidence || relationship.reason,
                confidence: relationship.confidence || 0.5,
                timestamp: relationship.created_at || new Date().toISOString()
            });
        }
        
        // Evidence from database
        if (this.dbManager) {
            const dbEvidence = await this.fetchDatabaseEvidence(relationship, runId);
            sources.push(...dbEvidence);
        }
        
        // Contextual evidence
        const contextualEvidence = this.extractContextualEvidence(relationship);
        if (contextualEvidence) {
            sources.push(contextualEvidence);
        }
        
        return sources;
    }

    /**
     * Fetch evidence from database
     */
    async fetchDatabaseEvidence(relationship, runId) {
        const db = this.dbManager.getDb();
        const evidence = [];
        
        try {
            // Check for related POIs
            const relatedPois = db.prepare(`
                SELECT * FROM pois 
                WHERE run_id = ? 
                AND (name = ? OR name = ?)
                LIMIT 10
            `).all(runId, relationship.from, relationship.to);
            
            if (relatedPois.length > 0) {
                evidence.push({
                    type: 'poi_metadata',
                    content: relatedPois.map(p => p.description).join('; '),
                    confidence: 0.7,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Check for other relationships involving same entities
            const relatedRelationships = db.prepare(`
                SELECT * FROM relationships 
                WHERE run_id = ? 
                AND (source = ? OR target = ? OR source = ? OR target = ?)
                LIMIT 20
            `).all(runId, relationship.from, relationship.from, relationship.to, relationship.to);
            
            if (relatedRelationships.length > 0) {
                evidence.push({
                    type: 'related_relationships',
                    content: `Found ${relatedRelationships.length} related relationships`,
                    confidence: 0.6,
                    count: relatedRelationships.length,
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('[AdvancedRelationshipValidator] Error fetching database evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Extract contextual evidence from relationship metadata
     */
    extractContextualEvidence(relationship) {
        const contextPieces = [];
        
        if (relationship.file_path) {
            contextPieces.push(`File: ${relationship.file_path}`);
        }
        
        if (relationship.line_number) {
            contextPieces.push(`Line: ${relationship.line_number}`);
        }
        
        if (relationship.context) {
            contextPieces.push(relationship.context);
        }
        
        if (contextPieces.length > 0) {
            return {
                type: 'contextual',
                content: contextPieces.join('; '),
                confidence: 0.5,
                timestamp: relationship.created_at || new Date().toISOString()
            };
        }
        
        return null;
    }

    /**
     * Weight evidence by source reliability and recency
     */
    weightEvidence(evidenceSources) {
        const weights = {
            direct: 1.0,
            poi_metadata: 0.8,
            related_relationships: 0.7,
            contextual: 0.6,
            inferred: 0.4
        };
        
        let totalWeight = 0;
        let weightedSum = 0;
        
        evidenceSources.forEach(source => {
            const typeWeight = weights[source.type] || 0.5;
            const recencyWeight = this.calculateRecencyWeight(source.timestamp);
            const confidenceWeight = source.confidence || 0.5;
            
            const finalWeight = typeWeight * recencyWeight * confidenceWeight;
            
            totalWeight += finalWeight;
            weightedSum += finalWeight * (source.confidence || 0.5);
        });
        
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    /**
     * Calculate recency weight for evidence
     */
    calculateRecencyWeight(timestamp) {
        if (!timestamp) return 0.5;
        
        const age = Date.now() - new Date(timestamp).getTime();
        const hourInMs = 3600000;
        
        // Exponential decay over time
        return Math.exp(-age / (24 * hourInMs)); // Half-life of 24 hours
    }

    /**
     * Correlate evidence for consistency
     */
    correlateEvidence(evidenceSources) {
        if (evidenceSources.length < 2) return 1.0;
        
        let correlationSum = 0;
        let pairCount = 0;
        
        for (let i = 0; i < evidenceSources.length; i++) {
            for (let j = i + 1; j < evidenceSources.length; j++) {
                const correlation = this.calculateEvidenceCorrelation(
                    evidenceSources[i], 
                    evidenceSources[j]
                );
                correlationSum += correlation;
                pairCount++;
            }
        }
        
        return pairCount > 0 ? correlationSum / pairCount : 0;
    }

    /**
     * Calculate correlation between two evidence sources
     */
    calculateEvidenceCorrelation(evidence1, evidence2) {
        // Simple correlation based on confidence similarity
        const confDiff = Math.abs((evidence1.confidence || 0.5) - (evidence2.confidence || 0.5));
        
        // Type compatibility
        const typeCompatibility = this.areEvidenceTypesCompatible(evidence1.type, evidence2.type) ? 0.2 : 0;
        
        return (1 - confDiff) * 0.8 + typeCompatibility;
    }

    /**
     * Check if evidence types are compatible
     */
    areEvidenceTypesCompatible(type1, type2) {
        const compatiblePairs = [
            ['direct', 'poi_metadata'],
            ['direct', 'contextual'],
            ['poi_metadata', 'related_relationships'],
            ['contextual', 'related_relationships']
        ];
        
        return compatiblePairs.some(pair => 
            (pair[0] === type1 && pair[1] === type2) ||
            (pair[0] === type2 && pair[1] === type1)
        );
    }

    /**
     * Calculate aggregate evidence metrics
     */
    calculateAggregateEvidenceMetrics(evidenceMap) {
        const values = Array.from(evidenceMap.values());
        
        const strengths = values.map(v => v.weightedStrength);
        const confidences = values.map(v => v.confidence);
        const correlations = values.map(v => v.correlationScore);
        
        return {
            averageStrength: this.calculateAverage(strengths),
            averageConfidence: this.calculateAverage(confidences),
            averageCorrelation: this.calculateAverage(correlations),
            minStrength: Math.min(...strengths),
            maxStrength: Math.max(...strengths),
            strengthVariance: this.calculateVariance(strengths)
        };
    }

    /**
     * Check for semantic conflicts between relationships
     */
    hasSemanticConflict(rel1, rel2) {
        // Different types for same source-target pair
        if (rel1.type !== rel2.type && 
            this.areEntitiesSimilar(rel1.from, rel2.from) &&
            this.areEntitiesSimilar(rel1.to, rel2.to)) {
            return true;
        }
        
        // Conflicting evidence
        const evidence1 = (rel1.evidence || rel1.reason || '').toLowerCase();
        const evidence2 = (rel2.evidence || rel2.reason || '').toLowerCase();
        
        const conflictingTerms = ['instead', 'not', 'rather than', 'but not', 'except'];
        return conflictingTerms.some(term => 
            evidence1.includes(term) || evidence2.includes(term)
        );
    }

    /**
     * Check for temporal conflicts
     */
    hasTemporalConflict(rel1, rel2) {
        if (!rel1.created_at || !rel2.created_at) return false;
        
        const time1 = new Date(rel1.created_at).getTime();
        const time2 = new Date(rel2.created_at).getTime();
        const timeDiff = Math.abs(time1 - time2);
        
        // Relationships created far apart might represent different states
        const dayInMs = 24 * 3600000;
        if (timeDiff > 7 * dayInMs) {
            // Check if they represent the same semantic relationship
            return this.areEntitiesSimilar(rel1.from, rel2.from) &&
                   this.areEntitiesSimilar(rel1.to, rel2.to) &&
                   rel1.type !== rel2.type;
        }
        
        return false;
    }

    /**
     * Check for scope conflicts
     */
    hasScopeConflict(rel1, rel2) {
        // Check if relationships have different scopes (file vs global, etc.)
        const scope1 = this.determineScope(rel1);
        const scope2 = this.determineScope(rel2);
        
        return scope1 !== scope2 && 
               this.areEntitiesSimilar(rel1.from, rel2.from) &&
               this.areEntitiesSimilar(rel1.to, rel2.to);
    }

    /**
     * Determine relationship scope
     */
    determineScope(relationship) {
        if (relationship.scope) return relationship.scope;
        
        // Infer from metadata
        if (relationship.file_path && !relationship.cross_file) {
            return 'file';
        } else if (relationship.cross_file) {
            return 'cross-file';
        } else if (relationship.global || relationship.project_wide) {
            return 'global';
        }
        
        return 'unknown';
    }

    /**
     * Calculate conflict severity
     */
    calculateConflictSeverity(rel1, rel2) {
        const confDiff = Math.abs((rel1.confidence || 0) - (rel2.confidence || 0));
        const typeMismatch = rel1.type !== rel2.type ? 0.3 : 0;
        
        return Math.min(1, confDiff + typeMismatch);
    }

    /**
     * Calculate temporal conflict severity
     */
    calculateTemporalSeverity(rel1, rel2) {
        const time1 = new Date(rel1.created_at || 0).getTime();
        const time2 = new Date(rel2.created_at || 0).getTime();
        const timeDiff = Math.abs(time1 - time2);
        
        const dayInMs = 24 * 3600000;
        return Math.min(1, timeDiff / (30 * dayInMs)); // Normalize to 30 days
    }

    /**
     * Calculate scope conflict severity
     */
    calculateScopeSeverity(rel1, rel2) {
        const scope1 = this.determineScope(rel1);
        const scope2 = this.determineScope(rel2);
        
        const scopeHierarchy = {
            'file': 1,
            'cross-file': 2,
            'global': 3,
            'unknown': 0
        };
        
        const scopeDiff = Math.abs(scopeHierarchy[scope1] - scopeHierarchy[scope2]);
        return scopeDiff / 3; // Normalize
    }

    /**
     * Calculate overall conflict severity
     */
    calculateOverallConflictSeverity(conflicts) {
        const severities = [];
        
        conflicts.semantic.forEach(c => severities.push(c.severity));
        conflicts.temporal.forEach(c => severities.push(c.severity));
        conflicts.scope.forEach(c => severities.push(c.severity));
        conflicts.confidence.forEach(c => severities.push(c.severity));
        
        if (severities.length === 0) return 0;
        
        // Use max severity with count penalty
        const maxSeverity = Math.max(...severities);
        const countPenalty = Math.min(0.3, severities.length * 0.05);
        
        return Math.min(1, maxSeverity + countPenalty);
    }

    /**
     * Resolve conflicts by highest confidence
     */
    resolveByHighestConfidence(relationshipGroup, evidenceAnalysis) {
        let bestRelationship = null;
        let highestConfidence = -1;
        
        relationshipGroup.forEach(rel => {
            const evidence = evidenceAnalysis.evidenceMap.get(rel.id || rel.semantic_id);
            const confidence = evidence ? evidence.confidence : (rel.confidence || 0);
            
            if (confidence > highestConfidence) {
                highestConfidence = confidence;
                bestRelationship = rel;
            }
        });
        
        return {
            selectedRelationship: bestRelationship,
            confidence: highestConfidence,
            method: 'highest_confidence',
            requiresEscalation: highestConfidence < 0.6
        };
    }

    /**
     * Resolve conflicts by evidence weighting
     */
    resolveByEvidenceWeight(relationshipGroup, evidenceAnalysis) {
        let bestRelationship = null;
        let highestWeight = -1;
        
        relationshipGroup.forEach(rel => {
            const evidence = evidenceAnalysis.evidenceMap.get(rel.id || rel.semantic_id);
            if (evidence) {
                const weight = evidence.weightedStrength * evidence.correlationScore;
                
                if (weight > highestWeight) {
                    highestWeight = weight;
                    bestRelationship = rel;
                }
            }
        });
        
        return {
            selectedRelationship: bestRelationship,
            confidence: highestWeight,
            method: 'evidence_weighted',
            requiresEscalation: highestWeight < 0.5
        };
    }

    /**
     * Resolve conflicts by consensus
     */
    resolveByConsensus(relationshipGroup, conflictAnalysis) {
        // Group by relationship type
        const typeGroups = {};
        relationshipGroup.forEach(rel => {
            const type = rel.type || 'UNKNOWN';
            if (!typeGroups[type]) {
                typeGroups[type] = [];
            }
            typeGroups[type].push(rel);
        });
        
        // Find type with most support
        let consensusType = null;
        let maxSupport = 0;
        
        Object.entries(typeGroups).forEach(([type, rels]) => {
            const support = rels.reduce((sum, rel) => sum + (rel.confidence || 0.5), 0);
            if (support > maxSupport) {
                maxSupport = support;
                consensusType = type;
            }
        });
        
        // Select best relationship from consensus type
        const consensusGroup = typeGroups[consensusType] || [];
        const bestRelationship = consensusGroup.reduce((best, rel) => 
            (rel.confidence || 0) > (best.confidence || 0) ? rel : best
        , consensusGroup[0]);
        
        const consensusStrength = consensusGroup.length / relationshipGroup.length;
        
        return {
            selectedRelationship: bestRelationship,
            confidence: consensusStrength * (bestRelationship?.confidence || 0.5),
            method: 'consensus',
            consensusType,
            supportRatio: consensusStrength,
            requiresEscalation: consensusStrength < 0.6
        };
    }

    /**
     * Resolve conflicts using context awareness
     */
    async resolveByContext(relationshipGroup, evidenceAnalysis) {
        // Analyze context for each relationship
        const contextScores = new Map();
        
        for (const rel of relationshipGroup) {
            const score = await this.scoreRelationshipContext(rel, evidenceAnalysis);
            contextScores.set(rel.id || rel.semantic_id, score);
        }
        
        // Select relationship with best context score
        let bestRelationship = null;
        let bestScore = -1;
        
        relationshipGroup.forEach(rel => {
            const score = contextScores.get(rel.id || rel.semantic_id) || 0;
            if (score > bestScore) {
                bestScore = score;
                bestRelationship = rel;
            }
        });
        
        return {
            selectedRelationship: bestRelationship,
            confidence: bestScore,
            method: 'context_aware',
            contextScores: Array.from(contextScores.entries()),
            requiresEscalation: bestScore < 0.55
        };
    }

    /**
     * Score relationship based on context
     */
    async scoreRelationshipContext(relationship, evidenceAnalysis) {
        let score = 0.5; // Base score
        
        // File context bonus
        if (relationship.file_path) {
            score += 0.1;
        }
        
        // Line number specificity
        if (relationship.line_number) {
            score += 0.05;
        }
        
        // Evidence quality from analysis
        const evidence = evidenceAnalysis.evidenceMap.get(relationship.id || relationship.semantic_id);
        if (evidence) {
            score += evidence.correlationScore * 0.2;
        }
        
        // Scope appropriateness
        const scope = this.determineScope(relationship);
        if (scope !== 'unknown') {
            score += 0.1;
        }
        
        // Cross-file relationships get slight penalty unless explicitly marked
        if (!relationship.cross_file && this.infersCrossFile(relationship)) {
            score -= 0.05;
        }
        
        return Math.max(0, Math.min(1, score));
    }

    /**
     * Infer if relationship crosses files
     */
    infersCrossFile(relationship) {
        const evidence = (relationship.evidence || relationship.reason || '').toLowerCase();
        return evidence.includes('import') || 
               evidence.includes('require') || 
               evidence.includes('different file') ||
               evidence.includes('external');
    }

    /**
     * Count resolved conflicts
     */
    countResolvedConflicts(conflictAnalysis) {
        return conflictAnalysis.semantic.length +
               conflictAnalysis.temporal.length +
               conflictAnalysis.scope.length +
               conflictAnalysis.confidence.length;
    }

    /**
     * Store conflict resolution for learning
     */
    storeConflictResolution(resolutionId, conflictAnalysis, resolution) {
        this.conflictHistory.set(resolutionId, {
            conflicts: conflictAnalysis,
            resolution,
            timestamp: new Date().toISOString()
        });
        
        // Maintain history size
        if (this.conflictHistory.size > 1000) {
            const firstKey = this.conflictHistory.keys().next().value;
            this.conflictHistory.delete(firstKey);
        }
    }

    /**
     * Generate comprehensive validation report
     */
    generateValidationReport(validationResults) {
        const report = {
            summary: {
                totalGroups: validationResults.length,
                accepted: 0,
                rejected: 0,
                escalated: 0,
                averageConfidence: 0
            },
            conflictSummary: {
                groupsWithConflicts: 0,
                totalConflicts: 0,
                resolvedConflicts: 0,
                escalatedConflicts: 0
            },
            modeSummary: {},
            recommendations: []
        };
        
        let totalConfidence = 0;
        
        validationResults.forEach(result => {
            // Update decision counts
            const decision = result.finalDecision?.decision;
            if (decision === 'ACCEPT') report.summary.accepted++;
            else if (decision === 'REJECT') report.summary.rejected++;
            else if (decision === 'ESCALATE') report.summary.escalated++;
            
            // Update confidence
            totalConfidence += result.finalDecision?.confidence || 0;
            
            // Update conflict summary
            if (result.conflictAnalysis?.hasConflicts) {
                report.conflictSummary.groupsWithConflicts++;
                
                if (result.resolution) {
                    report.conflictSummary.resolvedConflicts++;
                    if (result.resolution.requiresEscalation) {
                        report.conflictSummary.escalatedConflicts++;
                    }
                }
            }
            
            // Track mode participation
            Object.keys(result.modeComparison?.modes || {}).forEach(mode => {
                if (!report.modeSummary[mode]) {
                    report.modeSummary[mode] = { count: 0, avgConfidence: 0 };
                }
                report.modeSummary[mode].count++;
            });
        });
        
        // Calculate averages
        report.summary.averageConfidence = validationResults.length > 0 ?
            totalConfidence / validationResults.length : 0;
        
        // Generate recommendations
        if (report.summary.escalated > validationResults.length * 0.2) {
            report.recommendations.push('High escalation rate detected. Consider adjusting confidence thresholds.');
        }
        
        if (report.conflictSummary.groupsWithConflicts > validationResults.length * 0.3) {
            report.recommendations.push('Frequent conflicts detected. Review analysis mode consistency.');
        }
        
        if (report.summary.averageConfidence < 0.6) {
            report.recommendations.push('Low average confidence. Consider improving evidence collection.');
        }
        
        return report;
    }

    /**
     * Cache validation result
     */
    cacheValidationResult(key, result) {
        if (!this.config.cacheEnabled) return;
        
        // Add timestamp for TTL
        result._cachedAt = Date.now();
        
        this.validationCache.set(key, result);
        
        // Enforce cache size limit
        if (this.validationCache.size > this.config.maxCacheSize) {
            const firstKey = this.validationCache.keys().next().value;
            this.validationCache.delete(firstKey);
            this.cacheStats.evictions++;
        }
    }

    /**
     * Get cached validation result
     */
    getCachedValidation(key) {
        if (!this.config.cacheEnabled) return null;
        
        const cached = this.validationCache.get(key);
        if (!cached) {
            this.cacheStats.misses++;
            return null;
        }
        
        // Check TTL
        const age = Date.now() - cached._cachedAt;
        if (age > this.config.cacheTTL) {
            this.validationCache.delete(key);
            this.cacheStats.misses++;
            return null;
        }
        
        this.cacheStats.hits++;
        return cached;
    }

    /**
     * Calculate average of array
     */
    calculateAverage(values) {
        if (values.length === 0) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    /**
     * Calculate variance of array
     */
    calculateVariance(values) {
        if (values.length === 0) return 0;
        
        const avg = this.calculateAverage(values);
        const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
        
        return this.calculateAverage(squaredDiffs);
    }

    /**
     * Get validator health status
     */
    getHealthStatus() {
        return {
            validatorId: this.validatorId,
            status: 'healthy',
            cacheStats: { ...this.cacheStats },
            cacheSize: this.validationCache.size,
            conflictHistorySize: this.conflictHistory.size,
            config: this.config
        };
    }

    /**
     * Clear validation cache
     */
    clearCache() {
        this.validationCache.clear();
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
        console.log('[AdvancedRelationshipValidator] Cache cleared');
    }
}

module.exports = AdvancedRelationshipValidator;