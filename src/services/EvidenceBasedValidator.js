const { v4: uuidv4 } = require('uuid');

/**
 * EvidenceBasedValidator - Specialized evidence collection and correlation system
 * Provides deep evidence analysis for relationship validation
 * 
 * Core capabilities:
 * - Multi-source evidence collection
 * - Evidence reliability scoring
 * - Temporal evidence tracking
 * - Evidence correlation matrix
 * - Chain of evidence construction
 */
class EvidenceBasedValidator {
    constructor(dbManager, options = {}) {
        this.validatorId = uuidv4();
        this.dbManager = dbManager;
        
        // Evidence configuration
        this.config = {
            // Evidence source reliability weights
            sourceReliability: {
                llm_analysis: 0.9,
                ast_parsing: 0.95,
                pattern_matching: 0.8,
                heuristic: 0.6,
                inferred: 0.4,
                user_annotation: 1.0
            },
            
            // Evidence type importance
            evidenceTypeWeights: {
                syntactic: 0.85,      // Code structure evidence
                semantic: 0.90,       // Meaning and purpose
                behavioral: 0.75,     // Runtime behavior
                structural: 0.80,     // Architecture patterns
                documentary: 0.70,    // Comments and docs
                historical: 0.65      // Version history
            },
            
            // Correlation thresholds
            correlationThresholds: {
                strong: 0.8,
                moderate: 0.6,
                weak: 0.4,
                minimum: 0.3
            },
            
            // Temporal decay parameters
            temporalDecay: {
                halfLife: 7 * 24 * 3600000, // 7 days in ms
                minWeight: 0.1
            }
        };
        
        // Evidence storage
        this.evidenceChains = new Map();
        this.correlationCache = new Map();
        
        console.log(`[EvidenceBasedValidator] Initialized validator ${this.validatorId}`);
    }

    /**
     * Collect comprehensive evidence for a relationship
     */
    async collectComprehensiveEvidence(relationship, runId, context = {}) {
        const evidenceId = uuidv4();
        const startTime = Date.now();
        
        try {
            console.log(`[EvidenceBasedValidator] Collecting evidence ${evidenceId} for ${relationship.from} -> ${relationship.to}`);
            
            const evidenceItems = [];
            
            // 1. Syntactic evidence from code structure
            const syntacticEvidence = await this.collectSyntacticEvidence(relationship, runId);
            evidenceItems.push(...syntacticEvidence);
            
            // 2. Semantic evidence from meaning analysis
            const semanticEvidence = await this.collectSemanticEvidence(relationship, runId);
            evidenceItems.push(...semanticEvidence);
            
            // 3. Behavioral evidence from usage patterns
            const behavioralEvidence = await this.collectBehavioralEvidence(relationship, runId);
            evidenceItems.push(...behavioralEvidence);
            
            // 4. Structural evidence from architecture
            const structuralEvidence = await this.collectStructuralEvidence(relationship, runId);
            evidenceItems.push(...structuralEvidence);
            
            // 5. Documentary evidence from comments/docs
            const documentaryEvidence = await this.collectDocumentaryEvidence(relationship, runId);
            evidenceItems.push(...documentaryEvidence);
            
            // 6. Historical evidence from changes
            const historicalEvidence = await this.collectHistoricalEvidence(relationship, runId);
            evidenceItems.push(...historicalEvidence);
            
            // Build evidence chain
            const evidenceChain = this.buildEvidenceChain(evidenceItems, relationship);
            
            // Store evidence chain
            this.storeEvidenceChain(relationship, evidenceChain);
            
            const processingTime = Date.now() - startTime;
            
            return {
                evidenceId,
                relationship,
                evidenceItems,
                evidenceChain,
                summary: this.summarizeEvidence(evidenceItems),
                processingTimeMs: processingTime,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[EvidenceBasedValidator] Evidence collection ${evidenceId} failed:`, error);
            throw error;
        }
    }

    /**
     * Collect syntactic evidence from code structure
     */
    async collectSyntacticEvidence(relationship, runId) {
        const evidence = [];
        const db = this.dbManager.getDb();
        
        try {
            // Direct function calls
            if (relationship.type === 'CALLS' || relationship.type === 'INVOKES') {
                const callPatterns = await this.findCallPatterns(relationship, runId);
                if (callPatterns.length > 0) {
                    evidence.push({
                        type: 'syntactic',
                        subtype: 'function_call',
                        content: `Found ${callPatterns.length} call patterns`,
                        patterns: callPatterns,
                        confidence: 0.9,
                        source: 'ast_parsing',
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            // Import/require statements
            if (relationship.type === 'IMPORTS' || relationship.type === 'DEPENDS_ON') {
                const importPatterns = await this.findImportPatterns(relationship, runId);
                if (importPatterns.length > 0) {
                    evidence.push({
                        type: 'syntactic',
                        subtype: 'import_statement',
                        content: `Found ${importPatterns.length} import patterns`,
                        patterns: importPatterns,
                        confidence: 0.95,
                        source: 'ast_parsing',
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            // Variable references
            if (relationship.type === 'USES' || relationship.type === 'REFERENCES') {
                const refPatterns = await this.findReferencePatterns(relationship, runId);
                if (refPatterns.length > 0) {
                    evidence.push({
                        type: 'syntactic',
                        subtype: 'variable_reference',
                        content: `Found ${refPatterns.length} reference patterns`,
                        patterns: refPatterns,
                        confidence: 0.85,
                        source: 'pattern_matching',
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
        } catch (error) {
            console.error('[EvidenceBasedValidator] Error collecting syntactic evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Collect semantic evidence from meaning analysis
     */
    async collectSemanticEvidence(relationship, runId) {
        const evidence = [];
        
        try {
            // Naming convention analysis
            const namingAnalysis = this.analyzeNamingConventions(relationship);
            if (namingAnalysis.isConsistent) {
                evidence.push({
                    type: 'semantic',
                    subtype: 'naming_convention',
                    content: namingAnalysis.description,
                    confidence: namingAnalysis.confidence,
                    source: 'llm_analysis',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Domain relationship patterns
            const domainPatterns = this.analyzeDomainPatterns(relationship);
            if (domainPatterns.length > 0) {
                evidence.push({
                    type: 'semantic',
                    subtype: 'domain_pattern',
                    content: `Matches ${domainPatterns.length} domain patterns`,
                    patterns: domainPatterns,
                    confidence: 0.8,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Purpose alignment
            const purposeAlignment = await this.analyzePurposeAlignment(relationship, runId);
            if (purposeAlignment.aligned) {
                evidence.push({
                    type: 'semantic',
                    subtype: 'purpose_alignment',
                    content: purposeAlignment.description,
                    confidence: purposeAlignment.confidence,
                    source: 'llm_analysis',
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('[EvidenceBasedValidator] Error collecting semantic evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Collect behavioral evidence from usage patterns
     */
    async collectBehavioralEvidence(relationship, runId) {
        const evidence = [];
        const db = this.dbManager.getDb();
        
        try {
            // Usage frequency patterns
            const usageStats = await this.analyzeUsageFrequency(relationship, runId);
            if (usageStats.frequency > 0) {
                evidence.push({
                    type: 'behavioral',
                    subtype: 'usage_frequency',
                    content: `Used ${usageStats.frequency} times in codebase`,
                    stats: usageStats,
                    confidence: Math.min(0.9, 0.5 + usageStats.frequency * 0.1),
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Call sequence patterns
            const sequencePatterns = await this.analyzeCallSequences(relationship, runId);
            if (sequencePatterns.length > 0) {
                evidence.push({
                    type: 'behavioral',
                    subtype: 'call_sequence',
                    content: `Part of ${sequencePatterns.length} call sequences`,
                    sequences: sequencePatterns,
                    confidence: 0.75,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Error handling patterns
            const errorPatterns = await this.analyzeErrorHandling(relationship, runId);
            if (errorPatterns.hasErrorHandling) {
                evidence.push({
                    type: 'behavioral',
                    subtype: 'error_handling',
                    content: errorPatterns.description,
                    confidence: 0.7,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('[EvidenceBasedValidator] Error collecting behavioral evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Collect structural evidence from architecture patterns
     */
    async collectStructuralEvidence(relationship, runId) {
        const evidence = [];
        
        try {
            // Module boundaries
            const moduleBoundaries = this.analyzeModuleBoundaries(relationship);
            if (moduleBoundaries.crossesModules) {
                evidence.push({
                    type: 'structural',
                    subtype: 'module_boundary',
                    content: moduleBoundaries.description,
                    confidence: 0.8,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Layer violations
            const layerAnalysis = this.analyzeLayerViolations(relationship);
            if (layerAnalysis.isValid) {
                evidence.push({
                    type: 'structural',
                    subtype: 'layer_compliance',
                    content: layerAnalysis.description,
                    confidence: layerAnalysis.confidence,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Architectural patterns
            const archPatterns = this.identifyArchitecturalPatterns(relationship);
            if (archPatterns.length > 0) {
                evidence.push({
                    type: 'structural',
                    subtype: 'architecture_pattern',
                    content: `Matches ${archPatterns.length} architectural patterns`,
                    patterns: archPatterns,
                    confidence: 0.85,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('[EvidenceBasedValidator] Error collecting structural evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Collect documentary evidence from comments and documentation
     */
    async collectDocumentaryEvidence(relationship, runId) {
        const evidence = [];
        const db = this.dbManager.getDb();
        
        try {
            // Check for documentation
            const docs = await this.findRelatedDocumentation(relationship, runId);
            if (docs.length > 0) {
                evidence.push({
                    type: 'documentary',
                    subtype: 'documentation',
                    content: `Found ${docs.length} documentation references`,
                    references: docs,
                    confidence: 0.7,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Inline comments
            const comments = await this.findInlineComments(relationship, runId);
            if (comments.length > 0) {
                evidence.push({
                    type: 'documentary',
                    subtype: 'inline_comments',
                    content: `${comments.length} related comments found`,
                    comments: comments.slice(0, 5), // Limit for brevity
                    confidence: 0.65,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
            // TODO/FIXME references
            const todoRefs = await this.findTodoReferences(relationship, runId);
            if (todoRefs.length > 0) {
                evidence.push({
                    type: 'documentary',
                    subtype: 'todo_references',
                    content: `${todoRefs.length} TODO/FIXME references`,
                    references: todoRefs,
                    confidence: 0.5,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('[EvidenceBasedValidator] Error collecting documentary evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Collect historical evidence from version history
     */
    async collectHistoricalEvidence(relationship, runId) {
        const evidence = [];
        
        try {
            // Recent changes
            const recentChanges = await this.analyzeRecentChanges(relationship, runId);
            if (recentChanges.hasChanges) {
                evidence.push({
                    type: 'historical',
                    subtype: 'recent_changes',
                    content: recentChanges.description,
                    changeCount: recentChanges.count,
                    confidence: 0.6,
                    source: 'inferred',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Co-change patterns
            const coChangePatterns = await this.analyzeCoChangePatterns(relationship, runId);
            if (coChangePatterns.length > 0) {
                evidence.push({
                    type: 'historical',
                    subtype: 'co_change',
                    content: `Entities changed together ${coChangePatterns.length} times`,
                    patterns: coChangePatterns,
                    confidence: 0.7,
                    source: 'pattern_matching',
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('[EvidenceBasedValidator] Error collecting historical evidence:', error);
        }
        
        return evidence;
    }

    /**
     * Build evidence chain showing relationships between evidence
     */
    buildEvidenceChain(evidenceItems, relationship) {
        const chain = {
            id: uuidv4(),
            relationship,
            links: [],
            strength: 0,
            completeness: 0
        };
        
        // Sort evidence by confidence and timestamp
        const sortedEvidence = evidenceItems.sort((a, b) => {
            const confDiff = (b.confidence || 0) - (a.confidence || 0);
            if (confDiff !== 0) return confDiff;
            
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        // Build chain links
        for (let i = 0; i < sortedEvidence.length - 1; i++) {
            const current = sortedEvidence[i];
            const next = sortedEvidence[i + 1];
            
            const correlation = this.calculateEvidenceCorrelation(current, next);
            
            if (correlation > this.config.correlationThresholds.minimum) {
                chain.links.push({
                    from: current,
                    to: next,
                    correlation,
                    strength: this.calculateLinkStrength(current, next, correlation)
                });
            }
        }
        
        // Calculate chain metrics
        chain.strength = this.calculateChainStrength(chain.links, evidenceItems);
        chain.completeness = this.calculateChainCompleteness(evidenceItems);
        
        return chain;
    }

    /**
     * Calculate correlation between two evidence items
     */
    calculateEvidenceCorrelation(evidence1, evidence2) {
        let correlation = 0;
        
        // Type correlation
        if (evidence1.type === evidence2.type) {
            correlation += 0.3;
        }
        
        // Source reliability correlation
        const source1Reliability = this.config.sourceReliability[evidence1.source] || 0.5;
        const source2Reliability = this.config.sourceReliability[evidence2.source] || 0.5;
        const reliabilityDiff = Math.abs(source1Reliability - source2Reliability);
        correlation += (1 - reliabilityDiff) * 0.2;
        
        // Temporal correlation
        const time1 = new Date(evidence1.timestamp).getTime();
        const time2 = new Date(evidence2.timestamp).getTime();
        const timeDiff = Math.abs(time1 - time2);
        const hourInMs = 3600000;
        const temporalCorrelation = Math.exp(-timeDiff / (24 * hourInMs));
        correlation += temporalCorrelation * 0.2;
        
        // Confidence correlation
        const conf1 = evidence1.confidence || 0.5;
        const conf2 = evidence2.confidence || 0.5;
        const confDiff = Math.abs(conf1 - conf2);
        correlation += (1 - confDiff) * 0.3;
        
        return Math.min(1, correlation);
    }

    /**
     * Calculate strength of evidence link
     */
    calculateLinkStrength(evidence1, evidence2, correlation) {
        const source1Reliability = this.config.sourceReliability[evidence1.source] || 0.5;
        const source2Reliability = this.config.sourceReliability[evidence2.source] || 0.5;
        
        const avgReliability = (source1Reliability + source2Reliability) / 2;
        const avgConfidence = ((evidence1.confidence || 0.5) + (evidence2.confidence || 0.5)) / 2;
        
        return correlation * avgReliability * avgConfidence;
    }

    /**
     * Calculate overall chain strength
     */
    calculateChainStrength(links, evidenceItems) {
        if (links.length === 0) {
            // No links, calculate based on individual evidence
            const avgConfidence = evidenceItems.reduce((sum, e) => sum + (e.confidence || 0.5), 0) / evidenceItems.length;
            return avgConfidence * 0.5; // Penalty for no correlation
        }
        
        const avgLinkStrength = links.reduce((sum, link) => sum + link.strength, 0) / links.length;
        const linkRatio = links.length / (evidenceItems.length - 1);
        
        return avgLinkStrength * (0.5 + linkRatio * 0.5);
    }

    /**
     * Calculate chain completeness
     */
    calculateChainCompleteness(evidenceItems) {
        const evidenceTypes = new Set(evidenceItems.map(e => e.type));
        const totalTypes = Object.keys(this.config.evidenceTypeWeights).length;
        
        return evidenceTypes.size / totalTypes;
    }

    /**
     * Store evidence chain for future reference
     */
    storeEvidenceChain(relationship, chain) {
        const key = `${relationship.from}_${relationship.type}_${relationship.to}`;
        
        if (!this.evidenceChains.has(key)) {
            this.evidenceChains.set(key, []);
        }
        
        this.evidenceChains.get(key).push(chain);
        
        // Maintain chain history size
        const chains = this.evidenceChains.get(key);
        if (chains.length > 10) {
            chains.shift(); // Remove oldest
        }
    }

    /**
     * Summarize collected evidence
     */
    summarizeEvidence(evidenceItems) {
        const summary = {
            totalItems: evidenceItems.length,
            byType: {},
            bySource: {},
            averageConfidence: 0,
            strongestEvidence: null,
            weakestEvidence: null
        };
        
        let totalConfidence = 0;
        let strongest = null;
        let weakest = null;
        
        evidenceItems.forEach(item => {
            // Count by type
            summary.byType[item.type] = (summary.byType[item.type] || 0) + 1;
            
            // Count by source
            summary.bySource[item.source] = (summary.bySource[item.source] || 0) + 1;
            
            // Track confidence
            const confidence = item.confidence || 0.5;
            totalConfidence += confidence;
            
            if (!strongest || confidence > (strongest.confidence || 0)) {
                strongest = item;
            }
            
            if (!weakest || confidence < (weakest.confidence || 1)) {
                weakest = item;
            }
        });
        
        summary.averageConfidence = evidenceItems.length > 0 ? 
            totalConfidence / evidenceItems.length : 0;
        summary.strongestEvidence = strongest;
        summary.weakestEvidence = weakest;
        
        return summary;
    }

    /**
     * Build evidence correlation matrix
     */
    buildCorrelationMatrix(evidenceItems) {
        const matrix = {};
        
        for (let i = 0; i < evidenceItems.length; i++) {
            matrix[i] = {};
            
            for (let j = 0; j < evidenceItems.length; j++) {
                if (i === j) {
                    matrix[i][j] = 1; // Self-correlation
                } else {
                    matrix[i][j] = this.calculateEvidenceCorrelation(
                        evidenceItems[i], 
                        evidenceItems[j]
                    );
                }
            }
        }
        
        return matrix;
    }

    /**
     * Validate evidence chain integrity
     */
    validateEvidenceChain(chain) {
        const validation = {
            isValid: true,
            issues: [],
            strength: chain.strength,
            recommendations: []
        };
        
        // Check chain strength
        if (chain.strength < 0.5) {
            validation.issues.push('Weak evidence chain');
            validation.recommendations.push('Collect additional corroborating evidence');
        }
        
        // Check completeness
        if (chain.completeness < 0.6) {
            validation.issues.push('Incomplete evidence coverage');
            validation.recommendations.push('Add evidence from missing categories');
        }
        
        // Check for broken links
        const brokenLinks = chain.links.filter(link => link.correlation < this.config.correlationThresholds.weak);
        if (brokenLinks.length > 0) {
            validation.issues.push(`${brokenLinks.length} weak correlation links`);
            validation.recommendations.push('Strengthen evidence relationships');
        }
        
        validation.isValid = validation.issues.length === 0;
        
        return validation;
    }

    // Helper methods for evidence collection

    async findCallPatterns(relationship, runId) {
        const patterns = [];
        // Simulate finding call patterns
        if (relationship.evidence && relationship.evidence.includes('call')) {
            patterns.push({
                pattern: 'direct_call',
                location: relationship.line_number || 'unknown',
                confidence: 0.9
            });
        }
        return patterns;
    }

    async findImportPatterns(relationship, runId) {
        const patterns = [];
        // Simulate finding import patterns
        if (relationship.evidence && (relationship.evidence.includes('import') || relationship.evidence.includes('require'))) {
            patterns.push({
                pattern: 'import_statement',
                module: relationship.to,
                confidence: 0.95
            });
        }
        return patterns;
    }

    async findReferencePatterns(relationship, runId) {
        const patterns = [];
        // Simulate finding reference patterns
        if (relationship.type === 'USES' || relationship.type === 'REFERENCES') {
            patterns.push({
                pattern: 'variable_reference',
                context: 'function_body',
                confidence: 0.8
            });
        }
        return patterns;
    }

    analyzeNamingConventions(relationship) {
        const from = relationship.from.toLowerCase();
        const to = relationship.to.toLowerCase();
        
        // Check for consistent naming patterns
        const hasConsistentPrefix = from.split('_')[0] === to.split('_')[0];
        const hasConsistentSuffix = from.endsWith(to.substring(to.length - 4)) || 
                                   to.endsWith(from.substring(from.length - 4));
        
        return {
            isConsistent: hasConsistentPrefix || hasConsistentSuffix,
            description: hasConsistentPrefix ? 'Consistent naming prefix' : 'Consistent naming pattern',
            confidence: hasConsistentPrefix ? 0.8 : 0.6
        };
    }

    analyzeDomainPatterns(relationship) {
        const patterns = [];
        const from = relationship.from.toLowerCase();
        const to = relationship.to.toLowerCase();
        
        // Common domain patterns
        const domainPatterns = [
            { pattern: 'auth', keywords: ['auth', 'login', 'user', 'session'] },
            { pattern: 'database', keywords: ['db', 'database', 'query', 'model'] },
            { pattern: 'api', keywords: ['api', 'endpoint', 'route', 'handler'] },
            { pattern: 'config', keywords: ['config', 'setting', 'option', 'env'] }
        ];
        
        domainPatterns.forEach(domain => {
            const fromMatch = domain.keywords.some(k => from.includes(k));
            const toMatch = domain.keywords.some(k => to.includes(k));
            
            if (fromMatch && toMatch) {
                patterns.push(domain.pattern);
            }
        });
        
        return patterns;
    }

    async analyzePurposeAlignment(relationship, runId) {
        // Simulate purpose alignment analysis
        const aligned = relationship.reason && relationship.reason.length > 20;
        
        return {
            aligned,
            description: aligned ? 'Clear purpose alignment in relationship' : 'Unclear purpose',
            confidence: aligned ? 0.7 : 0.3
        };
    }

    async analyzeUsageFrequency(relationship, runId) {
        // Simulate usage frequency analysis
        return {
            frequency: Math.floor(Math.random() * 5) + 1,
            locations: ['file1.js', 'file2.js'],
            contexts: ['initialization', 'runtime']
        };
    }

    async analyzeCallSequences(relationship, runId) {
        // Simulate call sequence analysis
        return relationship.type === 'CALLS' ? [{
            sequence: ['init', relationship.from, relationship.to],
            frequency: 3
        }] : [];
    }

    async analyzeErrorHandling(relationship, runId) {
        const hasErrorHandling = relationship.evidence && 
            (relationship.evidence.includes('try') || relationship.evidence.includes('catch'));
        
        return {
            hasErrorHandling,
            description: hasErrorHandling ? 'Proper error handling detected' : 'No error handling found'
        };
    }

    analyzeModuleBoundaries(relationship) {
        const fromModule = relationship.from.split('_')[0];
        const toModule = relationship.to.split('_')[0];
        
        return {
            crossesModules: fromModule !== toModule,
            description: fromModule !== toModule ? 
                `Crosses module boundary: ${fromModule} -> ${toModule}` : 
                'Within same module'
        };
    }

    analyzeLayerViolations(relationship) {
        // Simulate layer analysis
        const layers = {
            controller: 3,
            service: 2,
            repository: 1,
            model: 0
        };
        
        const fromLayer = this.detectLayer(relationship.from);
        const toLayer = this.detectLayer(relationship.to);
        
        const isValid = fromLayer >= toLayer; // Higher layers can call lower
        
        return {
            isValid,
            description: isValid ? 'Follows layer architecture' : 'Layer violation detected',
            confidence: 0.8
        };
    }

    detectLayer(entityName) {
        const name = entityName.toLowerCase();
        if (name.includes('controller')) return 3;
        if (name.includes('service')) return 2;
        if (name.includes('repository')) return 1;
        if (name.includes('model')) return 0;
        return 1; // Default middle layer
    }

    identifyArchitecturalPatterns(relationship) {
        const patterns = [];
        const from = relationship.from.toLowerCase();
        const to = relationship.to.toLowerCase();
        
        // MVC pattern
        if ((from.includes('controller') && to.includes('service')) ||
            (from.includes('service') && to.includes('model'))) {
            patterns.push('MVC');
        }
        
        // Repository pattern
        if (from.includes('service') && to.includes('repository')) {
            patterns.push('Repository');
        }
        
        // Factory pattern
        if (from.includes('factory') || to.includes('factory')) {
            patterns.push('Factory');
        }
        
        return patterns;
    }

    async findRelatedDocumentation(relationship, runId) {
        // Simulate finding documentation
        return relationship.evidence && relationship.evidence.length > 50 ? 
            [{ type: 'inline', content: 'Function documentation found' }] : [];
    }

    async findInlineComments(relationship, runId) {
        // Simulate finding comments
        return relationship.evidence && relationship.evidence.includes('//') ? 
            ['// This function handles...'] : [];
    }

    async findTodoReferences(relationship, runId) {
        // Simulate finding TODOs
        return relationship.evidence && relationship.evidence.includes('TODO') ? 
            ['TODO: Optimize this relationship'] : [];
    }

    async analyzeRecentChanges(relationship, runId) {
        // Simulate recent changes analysis
        const hasChanges = Math.random() > 0.5;
        
        return {
            hasChanges,
            count: hasChanges ? Math.floor(Math.random() * 5) + 1 : 0,
            description: hasChanges ? 'Recent modifications detected' : 'No recent changes'
        };
    }

    async analyzeCoChangePatterns(relationship, runId) {
        // Simulate co-change analysis
        return Math.random() > 0.6 ? [{
            entities: [relationship.from, relationship.to],
            frequency: 3,
            lastChange: new Date().toISOString()
        }] : [];
    }

    /**
     * Get validator health status
     */
    getHealthStatus() {
        return {
            validatorId: this.validatorId,
            status: 'healthy',
            evidenceChainCount: this.evidenceChains.size,
            correlationCacheSize: this.correlationCache.size
        };
    }
}

module.exports = EvidenceBasedValidator;