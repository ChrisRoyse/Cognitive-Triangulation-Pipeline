const { v4: uuidv4 } = require('uuid');

/**
 * Enhanced LLM Prompt Generator for Low-Confidence Relationships
 * 
 * Generates specialized prompts for individual analysis of relationships
 * that scored below confidence thresholds in batch processing.
 * Focuses on specific confidence factors to improve accuracy.
 */
class EnhancedPromptGenerator {
    constructor(options = {}) {
        this.confidenceThresholds = {
            individual: options.individualThreshold || 0.70,
            syntax: options.syntaxThreshold || 0.45,
            semantic: options.semanticThreshold || 0.50,
            context: options.contextThreshold || 0.55
        };

        // Template configurations for different confidence factor issues
        this.promptTemplates = {
            syntax: this.createSyntaxFocusedTemplate(),
            semantic: this.createSemanticFocusedTemplate(),
            context: this.createContextFocusedTemplate(),
            crossref: this.createCrossRefFocusedTemplate(),
            general: this.createGeneralEnhancedTemplate()
        };

        console.log('[EnhancedPromptGenerator] Initialized with thresholds:', this.confidenceThresholds);
    }

    /**
     * Generate enhanced prompt for low-confidence relationship
     */
    generateEnhancedPrompt(relationshipData, confidenceResult, filePath, contextualPois = [], sourceCode = '') {
        const promptId = uuidv4();
        
        console.log(`[EnhancedPromptGenerator] Generating enhanced prompt for ${relationshipData.from} -> ${relationshipData.to} (promptId: ${promptId})`);
        
        // Analyze confidence breakdown to determine focus area
        const focusArea = this.determineFocusArea(confidenceResult);
        const template = this.promptTemplates[focusArea];
        
        // Build context enhancement based on focus area
        const contextEnhancement = this.buildContextEnhancement(
            relationshipData, 
            confidenceResult, 
            focusArea, 
            contextualPois, 
            sourceCode
        );

        // Generate the specialized prompt
        const enhancedPrompt = template.generate({
            promptId,
            filePath,
            relationship: relationshipData,
            confidenceBreakdown: confidenceResult.breakdown,
            focusArea,
            contextEnhancement,
            originalEvidence: relationshipData.reason || relationshipData.evidence,
            contextualPois
        });

        console.log(`[EnhancedPromptGenerator] Generated ${focusArea}-focused prompt (promptId: ${promptId})`);

        return {
            promptId,
            focusArea,
            prompt: enhancedPrompt,
            metadata: {
                originalConfidence: confidenceResult.finalConfidence,
                confidenceLevel: confidenceResult.confidenceLevel,
                primaryIssues: this.identifyPrimaryIssues(confidenceResult),
                enhancementType: 'individual_analysis',
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Determine which confidence factor needs the most focus
     */
    determineFocusArea(confidenceResult) {
        const scores = confidenceResult.breakdown.factorScores;
        
        // Find the lowest scoring factor
        const factorScores = [
            { factor: 'syntax', score: scores.syntax },
            { factor: 'semantic', score: scores.semantic },
            { factor: 'context', score: scores.context },
            { factor: 'crossref', score: scores.crossRef }
        ];
        
        // Sort by score (lowest first)
        factorScores.sort((a, b) => a.score - b.score);
        
        const lowestFactor = factorScores[0];
        
        // Check if it's significantly lower than others
        if (lowestFactor.score < 0.5) {
            console.log(`[EnhancedPromptGenerator] Focus area: ${lowestFactor.factor} (score: ${lowestFactor.score.toFixed(3)})`);
            return lowestFactor.factor;
        }
        
        // If no single factor is dramatically low, use general enhancement
        return 'general';
    }

    /**
     * Build context enhancement based on focus area
     */
    buildContextEnhancement(relationshipData, confidenceResult, focusArea, contextualPois, sourceCode) {
        const enhancement = {
            focusArea,
            specificIssues: [],
            additionalContext: {},
            analysisHints: []
        };

        switch (focusArea) {
            case 'syntax':
                enhancement.specificIssues = this.identifySyntaxIssues(relationshipData, confidenceResult);
                enhancement.additionalContext.codePatterns = this.extractCodePatterns(sourceCode, relationshipData);
                enhancement.analysisHints = [
                    'Look for direct function calls, method invocations, or variable assignments',
                    'Check for import/require statements or module references',
                    'Identify specific line numbers or code blocks showing the relationship'
                ];
                break;

            case 'semantic':
                enhancement.specificIssues = this.identifySemanticIssues(relationshipData, confidenceResult);
                enhancement.additionalContext.namingAnalysis = this.analyzeNamingPatterns(relationshipData, contextualPois);
                enhancement.analysisHints = [
                    'Consider the purpose and domain of each entity',
                    'Analyze naming conventions and domain consistency',
                    'Evaluate if the relationship type makes logical sense'
                ];
                break;

            case 'context':
                enhancement.specificIssues = this.identifyContextIssues(relationshipData, confidenceResult);
                enhancement.additionalContext.fileContext = this.analyzeFileContext(relationshipData, contextualPois);
                enhancement.analysisHints = [
                    'Consider the architectural patterns and file structure',
                    'Analyze the surrounding code context and dependencies',
                    'Evaluate if entities belong to the same logical module'
                ];
                break;

            case 'crossref':
                enhancement.specificIssues = this.identifyCrossRefIssues(relationshipData, confidenceResult);
                enhancement.additionalContext.evidenceAnalysis = this.analyzeEvidenceConsistency(relationshipData);
                enhancement.analysisHints = [
                    'Look for multiple sources of evidence supporting the relationship',
                    'Check for consistency across different code references',
                    'Validate the relationship against project patterns'
                ];
                break;
        }

        return enhancement;
    }

    /**
     * Create syntax-focused prompt template
     */
    createSyntaxFocusedTemplate() {
        return {
            generate: (params) => `
**SPECIALIZED SYNTAX ANALYSIS REQUEST**
Prompt ID: ${params.promptId}

You are performing a detailed syntax analysis for a relationship that scored low on syntax pattern recognition (score: ${params.confidenceBreakdown.factorScores.syntax.toFixed(3)}).

**File**: ${params.filePath}

**Relationship Under Analysis**:
- FROM: ${params.relationship.from}
- TO: ${params.relationship.to}  
- TYPE: ${params.relationship.type}
- Original Evidence: "${params.originalEvidence}"

**Primary Syntax Issues Identified**:
${params.contextEnhancement.specificIssues.map(issue => `- ${issue}`).join('\n')}

**Code Pattern Context**:
${JSON.stringify(params.contextEnhancement.additionalContext.codePatterns, null, 2)}

**Analysis Focus**: ${params.contextEnhancement.analysisHints.map(hint => `\n- ${hint}`).join('')}

**Your Task**:
1. Perform deep syntax analysis of the relationship between "${params.relationship.from}" and "${params.relationship.to}"
2. Look for specific code patterns: function calls, method invocations, variable references, imports
3. Identify exact line numbers, function signatures, or code constructs that demonstrate the relationship
4. Provide concrete syntax evidence with code snippets where possible

**Required Response Format**:
{
  "analysis_type": "syntax_focused",
  "prompt_id": "${params.promptId}",
  "relationship": {
    "id": "${params.relationship.id || uuidv4()}",
    "from": "${params.relationship.from}",
    "to": "${params.relationship.to}",
    "type": "${params.relationship.type}",
    "confidence": <float 0.0-1.0>,
    "evidence": "<detailed syntax evidence with specific code references>",
    "syntax_analysis": {
      "pattern_type": "<direct_call|method_chain|import|variable_ref|other>",
      "code_location": "<specific line or block reference>",
      "syntax_confidence": <float 0.0-1.0>,
      "concrete_evidence": "<actual code snippet or pattern found>"
    }
  },
  "enhanced_reasoning": "<detailed explanation focusing on syntax patterns and code structure>"
}

If no valid syntax relationship exists, set confidence to 0.0 and explain why.
`
        };
    }

    /**
     * Create semantic-focused prompt template
     */
    createSemanticFocusedTemplate() {
        return {
            generate: (params) => `
**SPECIALIZED SEMANTIC ANALYSIS REQUEST**
Prompt ID: ${params.promptId}

You are performing detailed semantic analysis for a relationship that scored low on semantic understanding (score: ${params.confidenceBreakdown.factorScores.semantic.toFixed(3)}).

**File**: ${params.filePath}

**Relationship Under Analysis**:
- FROM: ${params.relationship.from}
- TO: ${params.relationship.to}
- TYPE: ${params.relationship.type}
- Original Evidence: "${params.originalEvidence}"

**Semantic Issues Identified**:
${params.contextEnhancement.specificIssues.map(issue => `- ${issue}`).join('\n')}

**Naming Pattern Analysis**:
${JSON.stringify(params.contextEnhancement.additionalContext.namingAnalysis, null, 2)}

**Analysis Focus**: ${params.contextEnhancement.analysisHints.map(hint => `\n- ${hint}`).join('')}

**Available Context POIs** (for semantic consistency):
${params.contextualPois.map(poi => `- ${poi.type}: ${poi.name} (${poi.semantic_id})`).join('\n')}

**Your Task**:
1. Analyze the semantic meaning and purpose of both entities
2. Evaluate if the relationship type makes logical sense given their purposes
3. Check naming conventions, domain consistency, and architectural patterns
4. Determine if entities belong to the same logical domain or have complementary functions

**Required Response Format**:
{
  "analysis_type": "semantic_focused", 
  "prompt_id": "${params.promptId}",
  "relationship": {
    "id": "${params.relationship.id || uuidv4()}",
    "from": "${params.relationship.from}",
    "to": "${params.relationship.to}",
    "type": "${params.relationship.type}",
    "confidence": <float 0.0-1.0>,
    "evidence": "<detailed semantic evidence explaining the logical relationship>",
    "semantic_analysis": {
      "domain_consistency": <boolean>,
      "logical_coherence": <boolean>,
      "naming_pattern_match": <boolean>,
      "semantic_confidence": <float 0.0-1.0>,
      "purpose_alignment": "<how the entities' purposes align or complement each other>"
    }
  },
  "enhanced_reasoning": "<detailed explanation focusing on semantic meaning and logical coherence>"
}

Focus on WHY these entities would be related, not just HOW they are connected.
`
        };
    }

    /**
     * Create context-focused prompt template
     */
    createContextFocusedTemplate() {
        return {
            generate: (params) => `
**SPECIALIZED CONTEXT ANALYSIS REQUEST**
Prompt ID: ${params.promptId}

You are performing detailed contextual analysis for a relationship that scored low on contextual understanding (score: ${params.confidenceBreakdown.factorScores.context.toFixed(3)}).

**File**: ${params.filePath}

**Relationship Under Analysis**:
- FROM: ${params.relationship.from}
- TO: ${params.relationship.to}
- TYPE: ${params.relationship.type}
- Original Evidence: "${params.originalEvidence}"

**Context Issues Identified**:
${params.contextEnhancement.specificIssues.map(issue => `- ${issue}`).join('\n')}

**File Context Analysis**:
${JSON.stringify(params.contextEnhancement.additionalContext.fileContext, null, 2)}

**Analysis Focus**: ${params.contextEnhancement.analysisHints.map(hint => `\n- ${hint}`).join('')}

**Available POIs in Context**:
${params.contextualPois.map(poi => `- ${poi.type}: ${poi.name} (${poi.semantic_id})`).join('\n')}

**Your Task**:
1. Analyze the architectural context and project structure
2. Evaluate file organization, module boundaries, and dependency patterns  
3. Consider the surrounding entities and their relationships
4. Determine if the relationship fits within the broader system architecture

**Required Response Format**:
{
  "analysis_type": "context_focused",
  "prompt_id": "${params.promptId}", 
  "relationship": {
    "id": "${params.relationship.id || uuidv4()}",
    "from": "${params.relationship.from}",
    "to": "${params.relationship.to}",
    "type": "${params.relationship.type}",
    "confidence": <float 0.0-1.0>,
    "evidence": "<detailed contextual evidence about architectural patterns and structure>",
    "context_analysis": {
      "architectural_fit": <boolean>,
      "module_coherence": <boolean>, 
      "dependency_pattern": "<describes the dependency pattern if valid>",
      "context_confidence": <float 0.0-1.0>,
      "surrounding_relationships": "<analysis of how this fits with other relationships>"
    }
  },
  "enhanced_reasoning": "<detailed explanation focusing on architectural context and system design>"
}

Consider the broader system architecture, not just the immediate code connection.
`
        };
    }

    /**
     * Create cross-reference focused prompt template
     */
    createCrossRefFocusedTemplate() {
        return {
            generate: (params) => `
**SPECIALIZED CROSS-REFERENCE ANALYSIS REQUEST**
Prompt ID: ${params.promptId}

You are performing detailed cross-reference validation for a relationship that scored low on cross-reference validation (score: ${params.confidenceBreakdown.factorScores.crossRef.toFixed(3)}).

**File**: ${params.filePath}

**Relationship Under Analysis**:
- FROM: ${params.relationship.from}
- TO: ${params.relationship.to}
- TYPE: ${params.relationship.type}
- Original Evidence: "${params.originalEvidence}"

**Cross-Reference Issues Identified**:
${params.contextEnhancement.specificIssues.map(issue => `- ${issue}`).join('\n')}

**Evidence Consistency Analysis**:
${JSON.stringify(params.contextEnhancement.additionalContext.evidenceAnalysis, null, 2)}

**Analysis Focus**: ${params.contextEnhancement.analysisHints.map(hint => `\n- ${hint}`).join('')}

**Your Task**:
1. Look for multiple independent sources of evidence for this relationship
2. Validate consistency across different code locations or patterns
3. Check for corroborating evidence in imports, function signatures, comments, etc.
4. Identify any conflicting evidence that might undermine the relationship

**Required Response Format**:
{
  "analysis_type": "crossref_focused",
  "prompt_id": "${params.promptId}",
  "relationship": {
    "id": "${params.relationship.id || uuidv4()}",
    "from": "${params.relationship.from}",
    "to": "${params.relationship.to}",
    "type": "${params.relationship.type}",
    "confidence": <float 0.0-1.0>,
    "evidence": "<consolidated evidence from multiple sources>",
    "crossref_analysis": {
      "evidence_sources": [<list of different evidence sources found>],
      "consistency_score": <float 0.0-1.0>,
      "conflicting_evidence": [<any contradictory evidence found>],
      "validation_confidence": <float 0.0-1.0>,
      "corroborating_patterns": "<patterns that support the relationship>"
    }
  },
  "enhanced_reasoning": "<detailed explanation of evidence validation and consistency analysis>"
}

Focus on finding multiple independent confirmations of the relationship.
`
        };
    }

    /**
     * Create general enhanced prompt template
     */
    createGeneralEnhancedTemplate() {
        return {
            generate: (params) => `
**COMPREHENSIVE RELATIONSHIP RE-ANALYSIS REQUEST**
Prompt ID: ${params.promptId}

You are performing comprehensive re-analysis of a relationship that requires individual attention (confidence: ${params.confidenceBreakdown.factorScores ? Object.values(params.confidenceBreakdown.factorScores).reduce((a,b) => a+b, 0) / 4 : 'N/A'}).

**File**: ${params.filePath}

**Relationship Under Analysis**:
- FROM: ${params.relationship.from}
- TO: ${params.relationship.to}
- TYPE: ${params.relationship.type}
- Original Evidence: "${params.originalEvidence}"

**Confidence Factor Scores**:
- Syntax: ${params.confidenceBreakdown.factorScores?.syntax?.toFixed(3) || 'N/A'}
- Semantic: ${params.confidenceBreakdown.factorScores?.semantic?.toFixed(3) || 'N/A'}
- Context: ${params.confidenceBreakdown.factorScores?.context?.toFixed(3) || 'N/A'}
- Cross-Ref: ${params.confidenceBreakdown.factorScores?.crossRef?.toFixed(3) || 'N/A'}

**Available Context POIs**:
${params.contextualPois.map(poi => `- ${poi.type}: ${poi.name} (${poi.semantic_id})`).join('\n')}

**Your Task**:
Perform a thorough, comprehensive analysis addressing ALL aspects:
1. **Syntax**: Look for concrete code patterns and structural evidence
2. **Semantics**: Analyze logical meaning and purpose alignment  
3. **Context**: Consider architectural patterns and system design
4. **Cross-Reference**: Validate with multiple sources of evidence

**Required Response Format**:
{
  "analysis_type": "comprehensive",
  "prompt_id": "${params.promptId}",
  "relationship": {
    "id": "${params.relationship.id || uuidv4()}",
    "from": "${params.relationship.from}",
    "to": "${params.relationship.to}",
    "type": "${params.relationship.type}",
    "confidence": <float 0.0-1.0>,
    "evidence": "<comprehensive evidence addressing all confidence factors>",
    "comprehensive_analysis": {
      "syntax_evidence": "<specific code patterns found>",
      "semantic_reasoning": "<logical purpose and meaning analysis>", 
      "contextual_fit": "<architectural and structural analysis>",
      "validation_sources": "<multiple evidence sources and consistency check>",
      "overall_assessment": "<final judgment on relationship validity>"
    }
  },
  "enhanced_reasoning": "<detailed explanation covering all aspects of the analysis>"
}

Provide the most thorough analysis possible, addressing every aspect of relationship validation.
`
        };
    }

    // Helper methods for issue identification and context analysis

    identifyPrimaryIssues(confidenceResult) {
        const issues = [];
        const scores = confidenceResult.breakdown.factorScores;
        
        if (scores.syntax < 0.5) issues.push('Low syntax pattern recognition');
        if (scores.semantic < 0.5) issues.push('Weak semantic understanding');
        if (scores.context < 0.5) issues.push('Poor contextual fit');
        if (scores.crossRef < 0.5) issues.push('Insufficient cross-reference validation');
        
        if (confidenceResult.breakdown.penaltyFactor < 0.8) {
            issues.push('Penalty factors applied (dynamic imports, conflicts, etc.)');
        }
        
        if (confidenceResult.breakdown.uncertaintyAdjustment < 0.7) {
            issues.push('High uncertainty due to limited evidence');
        }
        
        return issues;
    }

    identifySyntaxIssues(relationshipData, confidenceResult) {
        const issues = [];
        
        // Check specific syntax issues based on relationship type
        const relType = relationshipData.type?.toUpperCase();
        const evidence = relationshipData.reason || relationshipData.evidence || '';
        
        if (relType === 'CALLS' && !evidence.includes('call') && !evidence.includes('(')) {
            issues.push('Missing function call syntax patterns');
        }
        
        if (relType === 'IMPORTS' && !evidence.includes('import') && !evidence.includes('require')) {
            issues.push('Missing import/require statement patterns');
        }
        
        if (relType === 'USES' && !evidence.includes('use') && !evidence.includes('reference')) {
            issues.push('Missing variable usage patterns');
        }
        
        if (evidence.length < 20) {
            issues.push('Very brief evidence suggests insufficient syntax analysis');
        }
        
        return issues;
    }

    identifySemanticIssues(relationshipData, confidenceResult) {
        const issues = [];
        
        const fromParts = relationshipData.from.split('_');
        const toParts = relationshipData.to.split('_');
        
        if (fromParts.length < 2 || toParts.length < 2) {
            issues.push('Semantic IDs lack sufficient naming context');
        }
        
        if (fromParts[0] !== toParts[0]) {
            issues.push('Entities appear to be from different domains');
        }
        
        const evidence = relationshipData.reason || relationshipData.evidence || '';
        if (!evidence.includes('purpose') && !evidence.includes('function') && !evidence.includes('role')) {
            issues.push('Evidence lacks semantic reasoning about entity purposes');
        }
        
        return issues;
    }

    identifyContextIssues(relationshipData, confidenceResult) {
        const issues = [];
        
        const evidence = relationshipData.reason || relationshipData.evidence || '';
        
        if (!evidence.includes('file') && !evidence.includes('module') && !evidence.includes('component')) {
            issues.push('Evidence lacks contextual information about file/module structure');
        }
        
        if (!evidence.includes('architecture') && !evidence.includes('pattern') && !evidence.includes('design')) {
            issues.push('No architectural context provided');
        }
        
        return issues;
    }

    identifyCrossRefIssues(relationshipData, confidenceResult) {
        const issues = [];
        
        if (confidenceResult.breakdown.factorScores.crossRef < 0.4) {
            issues.push('Very limited cross-reference validation');
        }
        
        const evidence = relationshipData.reason || relationshipData.evidence || '';
        if (evidence.length < 50) {
            issues.push('Insufficient evidence detail for proper validation');
        }
        
        return issues;
    }

    extractCodePatterns(sourceCode, relationshipData) {
        if (!sourceCode) return {};
        
        const patterns = {
            functionCalls: [],
            imports: [],
            variables: []
        };
        
        const toName = this.extractEntityName(relationshipData.to);
        const lines = sourceCode.split('\n');
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Function calls
            if (trimmed.includes(`${toName}(`) || trimmed.includes(`.${toName}(`)) {
                patterns.functionCalls.push({ line: index + 1, code: trimmed });
            }
            
            // Imports
            if ((trimmed.includes('import') || trimmed.includes('require')) && trimmed.includes(toName)) {
                patterns.imports.push({ line: index + 1, code: trimmed });
            }
            
            // Variable references
            if (trimmed.includes(toName) && !trimmed.includes(`${toName}(`)) {
                patterns.variables.push({ line: index + 1, code: trimmed });
            }
        });
        
        return patterns;
    }

    analyzeNamingPatterns(relationshipData, contextualPois) {
        const fromParts = relationshipData.from.split('_');
        const toParts = relationshipData.to.split('_');
        
        const analysis = {
            fromDomain: fromParts[0],
            toDomain: toParts[0],
            fromType: fromParts[1] || 'unknown',
            toType: toParts[1] || 'unknown',
            domainMatch: fromParts[0] === toParts[0],
            typeCompatibility: this.assessTypeCompatibility(fromParts[1], toParts[1]),
            contextualSimilarity: this.calculateContextualSimilarity(relationshipData, contextualPois)
        };
        
        return analysis;
    }

    analyzeFileContext(relationshipData, contextualPois) {
        return {
            totalPois: contextualPois.length,
            domains: [...new Set(contextualPois.map(poi => poi.semantic_id.split('_')[0]))],
            types: [...new Set(contextualPois.map(poi => poi.type))],
            relatedPois: contextualPois.filter(poi => 
                poi.semantic_id.split('_')[0] === relationshipData.from.split('_')[0] ||
                poi.semantic_id.split('_')[0] === relationshipData.to.split('_')[0]
            ).length
        };
    }

    analyzeEvidenceConsistency(relationshipData) {
        const evidence = relationshipData.reason || relationshipData.evidence || '';
        
        return {
            evidenceLength: evidence.length,
            hasSpecifics: evidence.includes('line') || evidence.includes('function') || evidence.includes('method'),
            hasCodeReferences: evidence.includes('(') || evidence.includes('{') || evidence.includes('['),
            hasLocationInfo: evidence.includes('file') || evidence.includes('module'),
            confidenceKeywords: ['certain', 'clear', 'obvious', 'evident'].some(word => evidence.includes(word)),
            uncertaintyKeywords: ['might', 'possibly', 'maybe', 'unclear'].some(word => evidence.includes(word))
        };
    }

    assessTypeCompatibility(fromType, toType) {
        const compatibilityMatrix = {
            'func': ['func', 'method', 'handler'],
            'var': ['var', 'const', 'config'],
            'class': ['class', 'service', 'component'],
            'config': ['var', 'const', 'setting']
        };
        
        return compatibilityMatrix[fromType]?.includes(toType) || false;
    }

    calculateContextualSimilarity(relationshipData, contextualPois) {
        if (!contextualPois.length) return 0;
        
        const fromDomain = relationshipData.from.split('_')[0];
        const toDomain = relationshipData.to.split('_')[0];
        
        const sameDomainPois = contextualPois.filter(poi => {
            const poiDomain = poi.semantic_id.split('_')[0];
            return poiDomain === fromDomain || poiDomain === toDomain;
        });
        
        return sameDomainPois.length / contextualPois.length;
    }

    extractEntityName(semanticId) {
        const parts = semanticId.split('_');
        return parts[parts.length - 1] || semanticId;
    }
}

module.exports = EnhancedPromptGenerator;