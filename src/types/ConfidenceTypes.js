/**
 * Confidence-based relationship scoring system types and enums
 * Supporting data structures for the ConfidenceScorer service
 */

/**
 * Confidence factors enum - scoring categories
 */
const ConfidenceFactors = {
    SYNTAX: 'syntax',           // Syntax pattern recognition
    SEMANTIC: 'semantic',       // Semantic understanding
    CONTEXT: 'context',         // Contextual analysis
    CROSS_REF: 'crossRef'       // Cross-reference validation
};

/**
 * Confidence levels based on score thresholds
 */
const ConfidenceLevels = {
    HIGH: 'HIGH',           // >= 0.85
    MEDIUM: 'MEDIUM',       // >= 0.65
    LOW: 'LOW',             // >= 0.45
    VERY_LOW: 'VERY_LOW',   // < 0.45
    ERROR: 'ERROR'          // Calculation error
};

/**
 * Escalation trigger types
 */
const EscalationTriggers = {
    LOW_CONFIDENCE: 'LOW_CONFIDENCE',           // Below escalation threshold
    HIGH_UNCERTAINTY: 'HIGH_UNCERTAINTY',       // High uncertainty indicators
    CONFLICTING_EVIDENCE: 'CONFLICTING_EVIDENCE', // Conflicting evidence detected
    CALCULATION_ERROR: 'CALCULATION_ERROR',      // Error during calculation
    MANUAL_REVIEW: 'MANUAL_REVIEW'              // Manual review requested
};

/**
 * Penalty types for confidence scoring
 */
const PenaltyTypes = {
    DYNAMIC_IMPORT: 'DYNAMIC_IMPORT',       // Dynamic import detected
    INDIRECT_REF: 'INDIRECT_REF',           // Indirect reference
    CONFLICT: 'CONFLICT',                   // Conflicting evidence
    AMBIGUOUS: 'AMBIGUOUS'                  // Ambiguous reference
};

/**
 * RelationshipConfidence interface structure
 * Represents the complete confidence assessment for a relationship
 */
class RelationshipConfidence {
    constructor(data = {}) {
        this.scoreId = data.scoreId || null;
        this.relationshipId = data.relationshipId || null;
        this.fromSemanticId = data.fromSemanticId || null;
        this.toSemanticId = data.toSemanticId || null;
        this.relationshipType = data.relationshipType || null;
        
        // Core confidence metrics
        this.finalConfidence = data.finalConfidence || 0.0;
        this.confidenceLevel = data.confidenceLevel || ConfidenceLevels.VERY_LOW;
        this.escalationNeeded = data.escalationNeeded || false;
        
        // Detailed breakdown
        this.breakdown = {
            factorScores: data.breakdown?.factorScores || {
                syntax: 0.0,
                semantic: 0.0,
                context: 0.0,
                crossRef: 0.0
            },
            weightedSum: data.breakdown?.weightedSum || 0.0,
            penaltyFactor: data.breakdown?.penaltyFactor || 1.0,
            uncertaintyAdjustment: data.breakdown?.uncertaintyAdjustment || 1.0,
            rawScore: data.breakdown?.rawScore || 0.0,
            appliedPenalties: data.breakdown?.appliedPenalties || [],
            evidenceCount: data.breakdown?.evidenceCount || 0
        };
        
        // Escalation information
        this.escalationTriggers = data.escalationTriggers || [];
        this.escalationMetadata = data.escalationMetadata || {};
        
        // Metadata
        this.timestamp = data.timestamp || new Date().toISOString();
        this.scorerVersion = data.scorerVersion || '1.0.0';
        this.calculationDuration = data.calculationDuration || null;
    }

    /**
     * Convert to database-friendly format
     */
    toDbRecord() {
        return {
            score_id: this.scoreId,
            relationship_id: this.relationshipId,
            from_semantic_id: this.fromSemanticId,
            to_semantic_id: this.toSemanticId,
            relationship_type: this.relationshipType,
            final_confidence: this.finalConfidence,
            confidence_level: this.confidenceLevel,
            escalation_needed: this.escalationNeeded,
            factor_scores: JSON.stringify(this.breakdown.factorScores),
            weighted_sum: this.breakdown.weightedSum,
            penalty_factor: this.breakdown.penaltyFactor,
            uncertainty_adjustment: this.breakdown.uncertaintyAdjustment,
            raw_score: this.breakdown.rawScore,
            applied_penalties: JSON.stringify(this.breakdown.appliedPenalties),
            evidence_count: this.breakdown.evidenceCount,
            escalation_triggers: JSON.stringify(this.escalationTriggers),
            escalation_metadata: JSON.stringify(this.escalationMetadata),
            timestamp: this.timestamp,
            scorer_version: this.scorerVersion,
            calculation_duration: this.calculationDuration
        };
    }

    /**
     * Create from database record
     */
    static fromDbRecord(record) {
        return new RelationshipConfidence({
            scoreId: record.score_id,
            relationshipId: record.relationship_id,
            fromSemanticId: record.from_semantic_id,
            toSemanticId: record.to_semantic_id,
            relationshipType: record.relationship_type,
            finalConfidence: record.final_confidence,
            confidenceLevel: record.confidence_level,
            escalationNeeded: record.escalation_needed,
            breakdown: {
                factorScores: JSON.parse(record.factor_scores || '{}'),
                weightedSum: record.weighted_sum,
                penaltyFactor: record.penalty_factor,
                uncertaintyAdjustment: record.uncertainty_adjustment,
                rawScore: record.raw_score,
                appliedPenalties: JSON.parse(record.applied_penalties || '[]'),
                evidenceCount: record.evidence_count
            },
            escalationTriggers: JSON.parse(record.escalation_triggers || '[]'),
            escalationMetadata: JSON.parse(record.escalation_metadata || '{}'),
            timestamp: record.timestamp,
            scorerVersion: record.scorer_version,
            calculationDuration: record.calculation_duration
        });
    }

    /**
     * Check if this confidence assessment requires human review
     */
    requiresHumanReview() {
        return this.escalationNeeded || 
               this.confidenceLevel === ConfidenceLevels.VERY_LOW ||
               this.escalationTriggers.includes(EscalationTriggers.CONFLICTING_EVIDENCE) ||
               this.escalationTriggers.includes(EscalationTriggers.CALCULATION_ERROR);
    }

    /**
     * Get summary for logging/display
     */
    getSummary() {
        return {
            scoreId: this.scoreId,
            relationship: `${this.fromSemanticId} -> ${this.toSemanticId}`,
            confidence: this.finalConfidence.toFixed(3),
            level: this.confidenceLevel,
            escalation: this.escalationNeeded,
            triggers: this.escalationTriggers,
            factors: {
                syntax: this.breakdown.factorScores.syntax.toFixed(3),
                semantic: this.breakdown.factorScores.semantic.toFixed(3),
                context: this.breakdown.factorScores.context.toFixed(3),
                crossRef: this.breakdown.factorScores.crossRef.toFixed(3)
            }
        };
    }
}

/**
 * EscalationTrigger configuration structure
 */
class EscalationTriggerConfig {
    constructor(data = {}) {
        this.triggerType = data.triggerType || EscalationTriggers.LOW_CONFIDENCE;
        this.threshold = data.threshold || 0.5;
        this.enabled = data.enabled !== undefined ? data.enabled : true;
        this.priority = data.priority || 'MEDIUM';
        this.action = data.action || 'QUEUE_FOR_REVIEW';
        this.metadata = data.metadata || {};
    }

    /**
     * Check if trigger condition is met
     */
    isTriggered(confidenceResult) {
        if (!this.enabled) return false;

        switch (this.triggerType) {
            case EscalationTriggers.LOW_CONFIDENCE:
                return confidenceResult.finalConfidence <= this.threshold;
                
            case EscalationTriggers.HIGH_UNCERTAINTY:
                return confidenceResult.breakdown.uncertaintyAdjustment < this.threshold;
                
            case EscalationTriggers.CONFLICTING_EVIDENCE:
                return confidenceResult.breakdown.penaltyFactor < this.threshold;
                
            case EscalationTriggers.CALCULATION_ERROR:
                return confidenceResult.confidenceLevel === ConfidenceLevels.ERROR;
                
            default:
                return false;
        }
    }
}

/**
 * Evidence item structure for confidence calculation
 */
class ConfidenceEvidenceItem {
    constructor(data = {}) {
        this.evidenceId = data.evidenceId || null;
        this.type = data.type || 'GENERAL';
        this.text = data.text || '';
        this.source = data.source || 'UNKNOWN';
        this.confidence = data.confidence || 0.5;
        this.context = data.context || {};
        this.weight = data.weight || 1.0;
        this.timestamp = data.timestamp || new Date().toISOString();
    }
}

module.exports = {
    ConfidenceFactors,
    ConfidenceLevels,
    EscalationTriggers,
    PenaltyTypes,
    RelationshipConfidence,
    EscalationTriggerConfig,
    ConfidenceEvidenceItem
};