const { v4: uuidv4 } = require('uuid');

/**
 * ConflictResolutionEngine - Sophisticated conflict detection and resolution system
 * Implements multi-dimensional conflict analysis and automated resolution strategies
 * 
 * Core capabilities:
 * - Semantic conflict detection and resolution
 * - Temporal conflict handling
 * - Scope-based conflict resolution
 * - Escalation path management
 * - Learning from resolution history
 */
class ConflictResolutionEngine {
    constructor(dbManager, options = {}) {
        this.engineId = uuidv4();
        this.dbManager = dbManager;
        
        // Resolution configuration
        this.config = {
            // Conflict detection sensitivity
            sensitivity: {
                semantic: options.semanticSensitivity || 0.7,
                temporal: options.temporalSensitivity || 0.6,
                scope: options.scopeSensitivity || 0.65,
                confidence: options.confidenceSensitivity || 0.5
            },
            
            // Resolution strategies with priorities
            strategies: {
                consensus: { priority: 1, threshold: 0.7 },
                evidence_based: { priority: 2, threshold: 0.65 },
                recency_weighted: { priority: 3, threshold: 0.6 },
                authority_based: { priority: 4, threshold: 0.55 },
                machine_learning: { priority: 5, threshold: 0.5 }
            },
            
            // Escalation rules
            escalationRules: {
                maxConflicts: 5,
                severityThreshold: 0.8,
                uncertaintyThreshold: 0.7,
                humanReviewRequired: ['security', 'critical', 'data_loss']
            },
            
            // Learning parameters
            learning: {
                enabled: options.learningEnabled !== false,
                historySize: 1000,
                minDataPoints: 10,
                adaptationRate: 0.1
            }
        };
        
        // Resolution history for learning
        this.resolutionHistory = new Map();
        this.conflictPatterns = new Map();
        this.resolutionSuccess = new Map();
        
        console.log(`[ConflictResolutionEngine] Initialized engine ${this.engineId}`);
    }

    /**
     * Detect and analyze conflicts in relationship set
     */
    async detectConflicts(relationships, context = {}) {
        const detectionId = uuidv4();
        const startTime = Date.now();
        
        try {
            console.log(`[ConflictResolutionEngine] Starting conflict detection ${detectionId} for ${relationships.length} relationships`);
            
            const conflicts = {
                semantic: [],
                temporal: [],
                scope: [],
                confidence: [],
                compound: []
            };
            
            // Pairwise conflict detection
            for (let i = 0; i < relationships.length; i++) {
                for (let j = i + 1; j < relationships.length; j++) {
                    const rel1 = relationships[i];
                    const rel2 = relationships[j];
                    
                    // Detect each conflict type
                    const semanticConflict = this.detectSemanticConflict(rel1, rel2, context);
                    if (semanticConflict) conflicts.semantic.push(semanticConflict);
                    
                    const temporalConflict = this.detectTemporalConflict(rel1, rel2, context);
                    if (temporalConflict) conflicts.temporal.push(temporalConflict);
                    
                    const scopeConflict = this.detectScopeConflict(rel1, rel2, context);
                    if (scopeConflict) conflicts.scope.push(scopeConflict);
                    
                    const confidenceConflict = this.detectConfidenceConflict(rel1, rel2, context);
                    if (confidenceConflict) conflicts.confidence.push(confidenceConflict);
                    
                    // Check for compound conflicts
                    const compoundConflict = this.detectCompoundConflict(
                        rel1, rel2, 
                        semanticConflict, temporalConflict, 
                        scopeConflict, confidenceConflict
                    );
                    if (compoundConflict) conflicts.compound.push(compoundConflict);
                }
            }
            
            // Analyze conflict patterns
            const patterns = this.analyzeConflictPatterns(conflicts);
            
            // Calculate overall severity
            const severity = this.calculateOverallSeverity(conflicts);
            
            const processingTime = Date.now() - startTime;
            
            return {
                detectionId,
                conflicts,
                patterns,
                severity,
                totalConflicts: this.countTotalConflicts(conflicts),
                requiresEscalation: this.requiresEscalation(conflicts, severity),
                processingTimeMs: processingTime,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[ConflictResolutionEngine] Detection ${detectionId} failed:`, error);
            throw error;
        }
    }

    /**
     * Resolve detected conflicts using appropriate strategies
     */
    async resolveConflicts(conflictAnalysis, relationships, context = {}) {
        const resolutionId = uuidv4();
        const startTime = Date.now();
        
        try {
            console.log(`[ConflictResolutionEngine] Starting conflict resolution ${resolutionId}`);
            
            // Group conflicts by relationship pair
            const conflictGroups = this.groupConflictsByRelationship(conflictAnalysis.conflicts);
            
            const resolutions = [];
            
            for (const [pairKey, conflictGroup] of conflictGroups) {
                // Determine best resolution strategy
                const strategy = this.selectResolutionStrategy(conflictGroup, context);
                
                // Apply resolution strategy
                const resolution = await this.applyResolutionStrategy(
                    strategy, 
                    conflictGroup, 
                    relationships,
                    context
                );
                
                resolutions.push(resolution);
                
                // Learn from resolution
                if (this.config.learning.enabled) {
                    this.recordResolution(conflictGroup, resolution);
                }
            }
            
            // Generate resolution report
            const report = this.generateResolutionReport(resolutions, conflictAnalysis);
            
            const processingTime = Date.now() - startTime;
            
            return {
                resolutionId,
                resolutions,
                report,
                strategy: this.summarizeStrategiesUsed(resolutions),
                processingTimeMs: processingTime,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[ConflictResolutionEngine] Resolution ${resolutionId} failed:`, error);
            throw error;
        }
    }

    /**
     * Detect semantic conflicts between relationships
     */
    detectSemanticConflict(rel1, rel2, context) {
        // Check if relationships connect same entities but with different semantics
        if (!this.areSameEntities(rel1, rel2)) return null;
        
        // Different relationship types
        if (rel1.type !== rel2.type) {
            const severity = this.calculateSemanticSeverity(rel1, rel2);
            
            if (severity > this.config.sensitivity.semantic) {
                return {
                    type: 'semantic',
                    relationships: [rel1, rel2],
                    severity,
                    description: `Type mismatch: ${rel1.type} vs ${rel2.type}`,
                    details: {
                        type1: rel1.type,
                        type2: rel2.type,
                        evidenceMismatch: this.compareEvidence(rel1, rel2)
                    }
                };
            }
        }
        
        // Conflicting evidence or reasoning
        const evidenceConflict = this.detectEvidenceConflict(rel1, rel2);
        if (evidenceConflict && evidenceConflict.severity > this.config.sensitivity.semantic) {
            return {
                type: 'semantic',
                subtype: 'evidence',
                relationships: [rel1, rel2],
                severity: evidenceConflict.severity,
                description: 'Conflicting evidence for same relationship',
                details: evidenceConflict
            };
        }
        
        return null;
    }

    /**
     * Detect temporal conflicts
     */
    detectTemporalConflict(rel1, rel2, context) {
        if (!this.areSameEntities(rel1, rel2)) return null;
        
        const time1 = new Date(rel1.created_at || 0).getTime();
        const time2 = new Date(rel2.created_at || 0).getTime();
        const timeDiff = Math.abs(time1 - time2);
        
        const dayInMs = 24 * 3600000;
        
        // Significant time difference with conflicting information
        if (timeDiff > 7 * dayInMs) {
            const hasConflict = rel1.type !== rel2.type || 
                               Math.abs((rel1.confidence || 0) - (rel2.confidence || 0)) > 0.3;
            
            if (hasConflict) {
                const severity = this.calculateTemporalSeverity(timeDiff, hasConflict);
                
                if (severity > this.config.sensitivity.temporal) {
                    return {
                        type: 'temporal',
                        relationships: [rel1, rel2],
                        severity,
                        description: `Temporal conflict: ${Math.floor(timeDiff / dayInMs)} days apart`,
                        details: {
                            timeDifference: timeDiff,
                            daysApart: Math.floor(timeDiff / dayInMs),
                            older: time1 < time2 ? rel1 : rel2,
                            newer: time1 < time2 ? rel2 : rel1
                        }
                    };
                }
            }
        }
        
        return null;
    }

    /**
     * Detect scope conflicts
     */
    detectScopeConflict(rel1, rel2, context) {
        if (!this.areSameEntities(rel1, rel2)) return null;
        
        const scope1 = this.determineScope(rel1);
        const scope2 = this.determineScope(rel2);
        
        if (scope1 !== scope2) {
            const severity = this.calculateScopeSeverity(scope1, scope2, rel1, rel2);
            
            if (severity > this.config.sensitivity.scope) {
                return {
                    type: 'scope',
                    relationships: [rel1, rel2],
                    severity,
                    description: `Scope mismatch: ${scope1} vs ${scope2}`,
                    details: {
                        scope1,
                        scope2,
                        validInBothScopes: this.canCoexistInScopes(scope1, scope2, rel1, rel2)
                    }
                };
            }
        }
        
        return null;
    }

    /**
     * Detect confidence conflicts
     */
    detectConfidenceConflict(rel1, rel2, context) {
        if (!this.areSameEntities(rel1, rel2)) return null;
        
        const conf1 = rel1.confidence || 0;
        const conf2 = rel2.confidence || 0;
        const confDiff = Math.abs(conf1 - conf2);
        
        if (confDiff > this.config.sensitivity.confidence) {
            return {
                type: 'confidence',
                relationships: [rel1, rel2],
                severity: confDiff,
                description: `Confidence disparity: ${conf1.toFixed(2)} vs ${conf2.toFixed(2)}`,
                details: {
                    confidence1: conf1,
                    confidence2: conf2,
                    difference: confDiff,
                    ratio: conf1 > 0 ? conf2 / conf1 : 0
                }
            };
        }
        
        return null;
    }

    /**
     * Detect compound conflicts (multiple conflict types)
     */
    detectCompoundConflict(rel1, rel2, semantic, temporal, scope, confidence) {
        const conflicts = [semantic, temporal, scope, confidence].filter(c => c !== null);
        
        if (conflicts.length >= 2) {
            const avgSeverity = conflicts.reduce((sum, c) => sum + c.severity, 0) / conflicts.length;
            const maxSeverity = Math.max(...conflicts.map(c => c.severity));
            
            return {
                type: 'compound',
                relationships: [rel1, rel2],
                severity: maxSeverity * 1.2, // Compound conflicts are more severe
                description: `Multiple conflicts detected (${conflicts.length} types)`,
                details: {
                    conflictTypes: conflicts.map(c => c.type),
                    averageSeverity: avgSeverity,
                    maxSeverity,
                    conflicts
                }
            };
        }
        
        return null;
    }

    /**
     * Apply selected resolution strategy
     */
    async applyResolutionStrategy(strategy, conflictGroup, relationships, context) {
        console.log(`[ConflictResolutionEngine] Applying ${strategy} strategy`);
        
        switch (strategy) {
            case 'consensus':
                return await this.resolveByConsensus(conflictGroup, relationships, context);
                
            case 'evidence_based':
                return await this.resolveByEvidence(conflictGroup, relationships, context);
                
            case 'recency_weighted':
                return await this.resolveByRecency(conflictGroup, relationships, context);
                
            case 'authority_based':
                return await this.resolveByAuthority(conflictGroup, relationships, context);
                
            case 'machine_learning':
                return await this.resolveByMachineLearning(conflictGroup, relationships, context);
                
            default:
                return await this.resolveByDefault(conflictGroup, relationships, context);
        }
    }

    /**
     * Consensus-based resolution
     */
    async resolveByConsensus(conflictGroup, relationships, context) {
        const affectedRels = this.getAffectedRelationships(conflictGroup);
        
        // Find all relationships that agree
        const consensus = new Map();
        
        relationships.forEach(rel => {
            if (this.involvesEntities(rel, affectedRels[0])) {
                const key = `${rel.type}_${this.normalizeScope(rel)}`;
                if (!consensus.has(key)) {
                    consensus.set(key, { 
                        relationships: [], 
                        totalConfidence: 0,
                        type: rel.type,
                        scope: this.determineScope(rel)
                    });
                }
                
                const group = consensus.get(key);
                group.relationships.push(rel);
                group.totalConfidence += (rel.confidence || 0.5);
            }
        });
        
        // Select consensus with highest support
        let bestConsensus = null;
        let maxSupport = -1;
        
        for (const [key, group] of consensus) {
            const support = group.totalConfidence * Math.sqrt(group.relationships.length);
            if (support > maxSupport) {
                maxSupport = support;
                bestConsensus = group;
            }
        }
        
        if (bestConsensus && bestConsensus.relationships.length > 0) {
            // Select best relationship from consensus group
            const selected = bestConsensus.relationships.reduce((best, rel) => 
                (rel.confidence || 0) > (best.confidence || 0) ? rel : best
            );
            
            return {
                strategy: 'consensus',
                selected,
                rejected: affectedRels.filter(r => r !== selected),
                confidence: maxSupport / (relationships.length * 0.5),
                reasoning: `Consensus: ${bestConsensus.relationships.length} relationships agree on ${bestConsensus.type}`,
                details: {
                    consensusGroups: consensus.size,
                    winningGroup: bestConsensus,
                    supportScore: maxSupport
                }
            };
        }
        
        return this.createFailedResolution('consensus', affectedRels, 'No consensus found');
    }

    /**
     * Evidence-based resolution
     */
    async resolveByEvidence(conflictGroup, relationships, context) {
        const affectedRels = this.getAffectedRelationships(conflictGroup);
        
        // Score each relationship by evidence quality
        const scoredRels = await Promise.all(affectedRels.map(async rel => {
            const evidenceScore = await this.scoreEvidence(rel, context);
            return { relationship: rel, score: evidenceScore };
        }));
        
        // Sort by evidence score
        scoredRels.sort((a, b) => b.score - a.score);
        
        const best = scoredRels[0];
        
        if (best && best.score > 0.5) {
            return {
                strategy: 'evidence_based',
                selected: best.relationship,
                rejected: affectedRels.filter(r => r !== best.relationship),
                confidence: best.score,
                reasoning: `Strongest evidence score: ${best.score.toFixed(3)}`,
                details: {
                    evidenceScores: scoredRels,
                    scoreDifference: scoredRels.length > 1 ? 
                        best.score - scoredRels[1].score : best.score
                }
            };
        }
        
        return this.createFailedResolution('evidence_based', affectedRels, 'Insufficient evidence');
    }

    /**
     * Recency-weighted resolution
     */
    async resolveByRecency(conflictGroup, relationships, context) {
        const affectedRels = this.getAffectedRelationships(conflictGroup);
        
        // Score by recency and confidence
        const scoredRels = affectedRels.map(rel => {
            const age = Date.now() - new Date(rel.created_at || 0).getTime();
            const dayInMs = 24 * 3600000;
            const recencyScore = Math.exp(-age / (7 * dayInMs)); // Decay over 7 days
            const confidence = rel.confidence || 0.5;
            
            return {
                relationship: rel,
                score: recencyScore * confidence,
                recencyScore,
                age: Math.floor(age / dayInMs)
            };
        });
        
        scoredRels.sort((a, b) => b.score - a.score);
        
        const best = scoredRels[0];
        
        if (best) {
            return {
                strategy: 'recency_weighted',
                selected: best.relationship,
                rejected: affectedRels.filter(r => r !== best.relationship),
                confidence: best.score,
                reasoning: `Most recent with confidence: ${best.age} days old, score ${best.score.toFixed(3)}`,
                details: {
                    recencyScores: scoredRels,
                    selectedAge: best.age
                }
            };
        }
        
        return this.createFailedResolution('recency_weighted', affectedRels, 'No valid relationships');
    }

    /**
     * Authority-based resolution
     */
    async resolveByAuthority(conflictGroup, relationships, context) {
        const affectedRels = this.getAffectedRelationships(conflictGroup);
        
        // Score by source authority
        const scoredRels = affectedRels.map(rel => {
            const authorityScore = this.calculateAuthorityScore(rel, context);
            return {
                relationship: rel,
                score: authorityScore * (rel.confidence || 0.5)
            };
        });
        
        scoredRels.sort((a, b) => b.score - a.score);
        
        const best = scoredRels[0];
        
        if (best && best.score > 0.4) {
            return {
                strategy: 'authority_based',
                selected: best.relationship,
                rejected: affectedRels.filter(r => r !== best.relationship),
                confidence: best.score,
                reasoning: `Highest authority source: score ${best.score.toFixed(3)}`,
                details: {
                    authorityScores: scoredRels
                }
            };
        }
        
        return this.createFailedResolution('authority_based', affectedRels, 'No authoritative source');
    }

    /**
     * Machine learning-based resolution
     */
    async resolveByMachineLearning(conflictGroup, relationships, context) {
        const affectedRels = this.getAffectedRelationships(conflictGroup);
        
        // Check if we have enough historical data
        if (this.resolutionHistory.size < this.config.learning.minDataPoints) {
            return this.createFailedResolution('machine_learning', affectedRels, 'Insufficient training data');
        }
        
        // Extract features from conflicts and relationships
        const features = this.extractResolutionFeatures(conflictGroup, affectedRels);
        
        // Find similar historical cases
        const similarCases = this.findSimilarResolutions(features);
        
        if (similarCases.length > 0) {
            // Apply learned patterns
            const prediction = this.predictBestResolution(features, similarCases, affectedRels);
            
            if (prediction.confidence > 0.6) {
                return {
                    strategy: 'machine_learning',
                    selected: prediction.selected,
                    rejected: affectedRels.filter(r => r !== prediction.selected),
                    confidence: prediction.confidence,
                    reasoning: `ML prediction based on ${similarCases.length} similar cases`,
                    details: {
                        features,
                        similarCases: similarCases.length,
                        predictionConfidence: prediction.confidence
                    }
                };
            }
        }
        
        return this.createFailedResolution('machine_learning', affectedRels, 'Low prediction confidence');
    }

    /**
     * Default resolution strategy
     */
    async resolveByDefault(conflictGroup, relationships, context) {
        const affectedRels = this.getAffectedRelationships(conflictGroup);
        
        // Simple highest confidence wins
        const best = affectedRels.reduce((best, rel) => 
            (rel.confidence || 0) > (best.confidence || 0) ? rel : best
        );
        
        return {
            strategy: 'default',
            selected: best,
            rejected: affectedRels.filter(r => r !== best),
            confidence: best.confidence || 0.5,
            reasoning: 'Default: highest confidence selected',
            details: {
                confidences: affectedRels.map(r => ({
                    relationship: r,
                    confidence: r.confidence || 0
                }))
            }
        };
    }

    /**
     * Score evidence quality
     */
    async scoreEvidence(relationship, context) {
        let score = 0.5; // Base score
        
        // Evidence length and quality
        const evidence = relationship.evidence || relationship.reason || '';
        if (evidence.length > 100) score += 0.1;
        if (evidence.length > 200) score += 0.1;
        
        // Specific evidence markers
        const evidenceMarkers = ['because', 'since', 'due to', 'calls', 'imports', 'uses'];
        const markerCount = evidenceMarkers.filter(marker => 
            evidence.toLowerCase().includes(marker)
        ).length;
        score += markerCount * 0.05;
        
        // Line number specificity
        if (relationship.line_number) score += 0.1;
        
        // File path specificity
        if (relationship.file_path) score += 0.05;
        
        // Confidence correlation
        score *= (relationship.confidence || 0.5);
        
        return Math.min(1, score);
    }

    /**
     * Calculate authority score for a relationship
     */
    calculateAuthorityScore(relationship, context) {
        let score = 0.5;
        
        // Source-based authority
        if (relationship.source === 'user_annotation') score = 1.0;
        else if (relationship.source === 'llm_analysis') score = 0.8;
        else if (relationship.source === 'ast_parsing') score = 0.9;
        else if (relationship.source === 'pattern_matching') score = 0.7;
        
        // Analysis mode authority
        if (relationship.analysisMode === 'triangulated') score *= 1.2;
        else if (relationship.analysisMode === 'individual') score *= 1.0;
        else if (relationship.analysisMode === 'batch') score *= 0.9;
        
        return Math.min(1, score);
    }

    /**
     * Extract features for ML-based resolution
     */
    extractResolutionFeatures(conflictGroup, relationships) {
        const conflicts = conflictGroup.conflicts || [];
        
        return {
            conflictCount: conflicts.length,
            conflictTypes: [...new Set(conflicts.map(c => c.type))],
            avgSeverity: conflicts.reduce((sum, c) => sum + c.severity, 0) / conflicts.length,
            maxSeverity: Math.max(...conflicts.map(c => c.severity)),
            relationshipCount: relationships.length,
            confidenceRange: {
                min: Math.min(...relationships.map(r => r.confidence || 0)),
                max: Math.max(...relationships.map(r => r.confidence || 0))
            },
            typeVariety: [...new Set(relationships.map(r => r.type))].length,
            hasTemporalConflict: conflicts.some(c => c.type === 'temporal'),
            hasSemanticConflict: conflicts.some(c => c.type === 'semantic'),
            hasScopeConflict: conflicts.some(c => c.type === 'scope')
        };
    }

    /**
     * Find similar historical resolutions
     */
    findSimilarResolutions(features) {
        const similar = [];
        
        for (const [id, history] of this.resolutionHistory) {
            const similarity = this.calculateFeatureSimilarity(features, history.features);
            
            if (similarity > 0.7) {
                similar.push({
                    id,
                    similarity,
                    resolution: history.resolution,
                    success: history.success
                });
            }
        }
        
        return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    }

    /**
     * Calculate similarity between feature sets
     */
    calculateFeatureSimilarity(features1, features2) {
        let similarity = 0;
        let count = 0;
        
        // Numeric features
        const numericFeatures = ['conflictCount', 'avgSeverity', 'maxSeverity', 'relationshipCount'];
        numericFeatures.forEach(key => {
            if (features1[key] !== undefined && features2[key] !== undefined) {
                const diff = Math.abs(features1[key] - features2[key]);
                const max = Math.max(features1[key], features2[key]);
                similarity += max > 0 ? 1 - (diff / max) : 1;
                count++;
            }
        });
        
        // Boolean features
        const booleanFeatures = ['hasTemporalConflict', 'hasSemanticConflict', 'hasScopeConflict'];
        booleanFeatures.forEach(key => {
            if (features1[key] !== undefined && features2[key] !== undefined) {
                similarity += features1[key] === features2[key] ? 1 : 0;
                count++;
            }
        });
        
        return count > 0 ? similarity / count : 0;
    }

    /**
     * Predict best resolution based on similar cases
     */
    predictBestResolution(features, similarCases, relationships) {
        // Aggregate successful resolution patterns
        const strategySuccess = {};
        
        similarCases.forEach(case_ => {
            if (case_.success) {
                const strategy = case_.resolution.strategy;
                strategySuccess[strategy] = (strategySuccess[strategy] || 0) + case_.similarity;
            }
        });
        
        // Find best strategy
        let bestStrategy = 'default';
        let maxSuccess = 0;
        
        Object.entries(strategySuccess).forEach(([strategy, success]) => {
            if (success > maxSuccess) {
                maxSuccess = success;
                bestStrategy = strategy;
            }
        });
        
        // Apply predicted best strategy (simplified)
        const selected = relationships.reduce((best, rel) => 
            (rel.confidence || 0) > (best.confidence || 0) ? rel : best
        );
        
        return {
            selected,
            confidence: maxSuccess / similarCases.length,
            predictedStrategy: bestStrategy
        };
    }

    /**
     * Record resolution for learning
     */
    recordResolution(conflictGroup, resolution) {
        const id = uuidv4();
        
        this.resolutionHistory.set(id, {
            features: this.extractResolutionFeatures(conflictGroup, 
                this.getAffectedRelationships(conflictGroup)),
            resolution,
            timestamp: new Date().toISOString(),
            success: true // Will be updated based on feedback
        });
        
        // Maintain history size
        if (this.resolutionHistory.size > this.config.learning.historySize) {
            const firstKey = this.resolutionHistory.keys().next().value;
            this.resolutionHistory.delete(firstKey);
        }
        
        // Update pattern recognition
        this.updateConflictPatterns(conflictGroup);
    }

    /**
     * Update conflict pattern recognition
     */
    updateConflictPatterns(conflictGroup) {
        const pattern = this.extractConflictPattern(conflictGroup);
        const key = this.hashPattern(pattern);
        
        if (!this.conflictPatterns.has(key)) {
            this.conflictPatterns.set(key, {
                pattern,
                count: 0,
                resolutions: []
            });
        }
        
        const stored = this.conflictPatterns.get(key);
        stored.count++;
        stored.resolutions.push(new Date().toISOString());
        
        // Keep only recent resolutions
        if (stored.resolutions.length > 10) {
            stored.resolutions = stored.resolutions.slice(-10);
        }
    }

    /**
     * Extract conflict pattern for learning
     */
    extractConflictPattern(conflictGroup) {
        const conflicts = conflictGroup.conflicts || [];
        
        return {
            types: [...new Set(conflicts.map(c => c.type))].sort(),
            severityRange: {
                min: Math.min(...conflicts.map(c => c.severity)),
                max: Math.max(...conflicts.map(c => c.severity))
            },
            count: conflicts.length
        };
    }

    /**
     * Generate hash for pattern
     */
    hashPattern(pattern) {
        return JSON.stringify(pattern);
    }

    // Helper methods

    areSameEntities(rel1, rel2) {
        const from1 = (rel1.from || rel1.source || '').toLowerCase();
        const from2 = (rel2.from || rel2.source || '').toLowerCase();
        const to1 = (rel1.to || rel1.target || '').toLowerCase();
        const to2 = (rel2.to || rel2.target || '').toLowerCase();
        
        return (from1 === from2 || from1.includes(from2) || from2.includes(from1)) &&
               (to1 === to2 || to1.includes(to2) || to2.includes(to1));
    }

    involvesEntities(relationship, reference) {
        const refFrom = (reference.from || reference.source || '').toLowerCase();
        const refTo = (reference.to || reference.target || '').toLowerCase();
        const relFrom = (relationship.from || relationship.source || '').toLowerCase();
        const relTo = (relationship.to || relationship.target || '').toLowerCase();
        
        return (relFrom.includes(refFrom) || refFrom.includes(relFrom)) &&
               (relTo.includes(refTo) || refTo.includes(relTo));
    }

    calculateSemanticSeverity(rel1, rel2) {
        let severity = 0.5;
        
        // Type difference
        if (rel1.type !== rel2.type) {
            severity += 0.3;
        }
        
        // Evidence conflict
        const evidence1 = (rel1.evidence || rel1.reason || '').toLowerCase();
        const evidence2 = (rel2.evidence || rel2.reason || '').toLowerCase();
        
        if (evidence1.includes('not') !== evidence2.includes('not')) {
            severity += 0.2;
        }
        
        return Math.min(1, severity);
    }

    calculateTemporalSeverity(timeDiff, hasConflict) {
        const dayInMs = 24 * 3600000;
        const days = timeDiff / dayInMs;
        
        let severity = Math.min(1, days / 30); // Normalize to 30 days
        
        if (hasConflict) {
            severity *= 1.5;
        }
        
        return Math.min(1, severity);
    }

    calculateScopeSeverity(scope1, scope2, rel1, rel2) {
        const scopeHierarchy = {
            'file': 1,
            'module': 2,
            'cross-file': 3,
            'global': 4,
            'unknown': 0
        };
        
        const level1 = scopeHierarchy[scope1] || 0;
        const level2 = scopeHierarchy[scope2] || 0;
        
        const scopeDiff = Math.abs(level1 - level2) / 4;
        
        // Additional penalty for scope violations
        let severity = scopeDiff;
        
        if (scope1 === 'file' && scope2 === 'global') {
            severity += 0.3; // File-scoped shouldn't be global
        }
        
        return Math.min(1, severity);
    }

    compareEvidence(rel1, rel2) {
        const evidence1 = (rel1.evidence || rel1.reason || '').toLowerCase();
        const evidence2 = (rel2.evidence || rel2.reason || '').toLowerCase();
        
        // Simple evidence comparison
        const words1 = evidence1.split(/\s+/);
        const words2 = evidence2.split(/\s+/);
        
        const common = words1.filter(w => words2.includes(w)).length;
        const total = Math.max(words1.length, words2.length);
        
        return {
            similarity: total > 0 ? common / total : 0,
            hasConflict: evidence1.includes('not') !== evidence2.includes('not')
        };
    }

    detectEvidenceConflict(rel1, rel2) {
        const comparison = this.compareEvidence(rel1, rel2);
        
        if (comparison.hasConflict || comparison.similarity < 0.3) {
            return {
                severity: 1 - comparison.similarity,
                hasDirectConflict: comparison.hasConflict,
                similarity: comparison.similarity
            };
        }
        
        return null;
    }

    determineScope(relationship) {
        if (relationship.scope) return relationship.scope;
        
        if (relationship.cross_file) return 'cross-file';
        if (relationship.file_path) return 'file';
        if (relationship.global || relationship.project_wide) return 'global';
        
        return 'unknown';
    }

    normalizeScope(relationship) {
        return this.determineScope(relationship);
    }

    canCoexistInScopes(scope1, scope2, rel1, rel2) {
        // Some relationships can exist at different scopes
        if (rel1.type === rel2.type) {
            // Same type can exist at different scopes
            return true;
        }
        
        // Different types at different scopes might be valid
        return scope1 !== scope2;
    }

    analyzeConflictPatterns(conflicts) {
        const patterns = {
            dominantType: null,
            frequency: {},
            severityDistribution: {},
            correlations: []
        };
        
        // Count conflict types
        Object.entries(conflicts).forEach(([type, conflictList]) => {
            if (conflictList.length > 0) {
                patterns.frequency[type] = conflictList.length;
            }
        });
        
        // Find dominant type
        let maxCount = 0;
        Object.entries(patterns.frequency).forEach(([type, count]) => {
            if (count > maxCount) {
                maxCount = count;
                patterns.dominantType = type;
            }
        });
        
        // Analyze severity distribution
        const allConflicts = Object.values(conflicts).flat();
        const severities = allConflicts.map(c => c.severity);
        
        patterns.severityDistribution = {
            min: Math.min(...severities),
            max: Math.max(...severities),
            avg: severities.reduce((sum, s) => sum + s, 0) / severities.length
        };
        
        // Find correlations between conflict types
        if (conflicts.compound.length > 0) {
            conflicts.compound.forEach(compound => {
                patterns.correlations.push({
                    types: compound.details.conflictTypes,
                    frequency: 1
                });
            });
        }
        
        return patterns;
    }

    calculateOverallSeverity(conflicts) {
        const allConflicts = Object.values(conflicts).flat();
        
        if (allConflicts.length === 0) return 0;
        
        const severities = allConflicts.map(c => c.severity);
        const maxSeverity = Math.max(...severities);
        const avgSeverity = severities.reduce((sum, s) => sum + s, 0) / severities.length;
        
        // Weight by count and max severity
        const countFactor = Math.min(1, allConflicts.length / this.config.escalationRules.maxConflicts);
        
        return maxSeverity * 0.7 + avgSeverity * 0.2 + countFactor * 0.1;
    }

    countTotalConflicts(conflicts) {
        return Object.values(conflicts).reduce((sum, list) => sum + list.length, 0);
    }

    requiresEscalation(conflicts, severity) {
        // Check severity threshold
        if (severity > this.config.escalationRules.severityThreshold) {
            return true;
        }
        
        // Check conflict count
        const totalConflicts = this.countTotalConflicts(conflicts);
        if (totalConflicts > this.config.escalationRules.maxConflicts) {
            return true;
        }
        
        // Check for critical conflict types
        const allConflicts = Object.values(conflicts).flat();
        const hasCritical = allConflicts.some(c => 
            this.config.escalationRules.humanReviewRequired.some(critical => 
                c.description && c.description.toLowerCase().includes(critical)
            )
        );
        
        return hasCritical;
    }

    groupConflictsByRelationship(conflicts) {
        const groups = new Map();
        
        Object.values(conflicts).flat().forEach(conflict => {
            if (conflict.relationships && conflict.relationships.length >= 2) {
                const key = this.generateRelationshipPairKey(
                    conflict.relationships[0], 
                    conflict.relationships[1]
                );
                
                if (!groups.has(key)) {
                    groups.set(key, {
                        relationships: conflict.relationships,
                        conflicts: []
                    });
                }
                
                groups.get(key).conflicts.push(conflict);
            }
        });
        
        return groups;
    }

    generateRelationshipPairKey(rel1, rel2) {
        const id1 = rel1.id || `${rel1.from}_${rel1.to}`;
        const id2 = rel2.id || `${rel2.from}_${rel2.to}`;
        
        return [id1, id2].sort().join('::');
    }

    selectResolutionStrategy(conflictGroup, context) {
        const conflicts = conflictGroup.conflicts || [];
        
        // Analyze conflict characteristics
        const hasCompound = conflicts.some(c => c.type === 'compound');
        const hasSemantic = conflicts.some(c => c.type === 'semantic');
        const hasTemporal = conflicts.some(c => c.type === 'temporal');
        
        // Priority-based selection
        if (hasCompound || conflicts.length > 3) {
            return 'consensus';
        }
        
        if (hasSemantic) {
            return 'evidence_based';
        }
        
        if (hasTemporal) {
            return 'recency_weighted';
        }
        
        // Check if ML is viable
        if (this.config.learning.enabled && 
            this.resolutionHistory.size >= this.config.learning.minDataPoints) {
            return 'machine_learning';
        }
        
        return 'evidence_based';
    }

    getAffectedRelationships(conflictGroup) {
        const relationships = new Set();
        
        conflictGroup.conflicts.forEach(conflict => {
            if (conflict.relationships) {
                conflict.relationships.forEach(rel => relationships.add(rel));
            }
        });
        
        return Array.from(relationships);
    }

    createFailedResolution(strategy, relationships, reason) {
        return {
            strategy,
            selected: null,
            rejected: relationships,
            confidence: 0,
            reasoning: `${strategy} failed: ${reason}`,
            failed: true,
            requiresEscalation: true
        };
    }

    generateResolutionReport(resolutions, conflictAnalysis) {
        const report = {
            totalResolutions: resolutions.length,
            successful: resolutions.filter(r => !r.failed).length,
            failed: resolutions.filter(r => r.failed).length,
            strategiesUsed: {},
            averageConfidence: 0,
            escalationRequired: resolutions.filter(r => r.requiresEscalation).length
        };
        
        let totalConfidence = 0;
        
        resolutions.forEach(resolution => {
            report.strategiesUsed[resolution.strategy] = 
                (report.strategiesUsed[resolution.strategy] || 0) + 1;
            
            totalConfidence += resolution.confidence || 0;
        });
        
        report.averageConfidence = resolutions.length > 0 ? 
            totalConfidence / resolutions.length : 0;
        
        return report;
    }

    summarizeStrategiesUsed(resolutions) {
        const summary = {};
        
        resolutions.forEach(resolution => {
            const strategy = resolution.strategy;
            if (!summary[strategy]) {
                summary[strategy] = {
                    count: 0,
                    avgConfidence: 0,
                    successful: 0
                };
            }
            
            summary[strategy].count++;
            summary[strategy].avgConfidence += resolution.confidence || 0;
            if (!resolution.failed) {
                summary[strategy].successful++;
            }
        });
        
        // Calculate averages
        Object.values(summary).forEach(stats => {
            stats.avgConfidence = stats.count > 0 ? 
                stats.avgConfidence / stats.count : 0;
            stats.successRate = stats.count > 0 ? 
                stats.successful / stats.count : 0;
        });
        
        return summary;
    }

    /**
     * Get engine health status
     */
    getHealthStatus() {
        return {
            engineId: this.engineId,
            status: 'healthy',
            resolutionHistorySize: this.resolutionHistory.size,
            conflictPatternsRecognized: this.conflictPatterns.size,
            learningEnabled: this.config.learning.enabled,
            config: this.config
        };
    }

    /**
     * Update resolution success based on feedback
     */
    updateResolutionSuccess(resolutionId, success) {
        if (this.resolutionHistory.has(resolutionId)) {
            this.resolutionHistory.get(resolutionId).success = success;
            console.log(`[ConflictResolutionEngine] Updated resolution ${resolutionId} success: ${success}`);
        }
    }
}

module.exports = ConflictResolutionEngine;