/**
 * ConfidenceScorer - Simple confidence scoring for relationship detection
 * Simplified from complex triangulation system to basic confidence calculation
 */
class ConfidenceScorer {
    constructor(options = {}) {
        // Simple confidence thresholds
        this.thresholds = {
            high: 0.8,
            medium: 0.6, 
            low: 0.4
        };
        
        console.log('[ConfidenceScorer] Initialized with simple scoring');
    }

    /**
     * Calculate simple confidence score for a relationship
     * Basic scoring based on evidence quality and relationship type
     */
    calculateConfidence(relationshipData, evidenceItems = []) {
        try {
            let confidence = 0.5; // Base confidence

            // Boost confidence for direct function calls
            if (relationshipData.type === 'CALLS' && relationshipData.reason) {
                if (relationshipData.reason.includes('calls') || relationshipData.reason.includes('invoke')) {
                    confidence += 0.3;
                }
            }

            // Boost confidence for imports
            if (relationshipData.type === 'IMPORTS' && relationshipData.reason) {
                if (relationshipData.reason.includes('import') || relationshipData.reason.includes('require')) {
                    confidence += 0.3;
                }
            }

            // Evidence quality factor
            if (relationshipData.reason && relationshipData.reason.length > 20) {
                confidence += 0.1;
            }

            // Multiple evidence sources
            if (evidenceItems && evidenceItems.length > 1) {
                confidence += 0.1;
            }

            const finalConfidence = Math.max(0.1, Math.min(1.0, confidence));

            return {
                finalConfidence,
                confidenceLevel: this.getConfidenceLevel(finalConfidence),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('[ConfidenceScorer] Error calculating confidence:', error);
            return { finalConfidence: 0.1, confidenceLevel: 'ERROR', timestamp: new Date().toISOString() };
        }
    }


    /**
     * Get confidence level classification
     */
    getConfidenceLevel(score) {
        if (score >= this.thresholds.high) return 'HIGH';
        if (score >= this.thresholds.medium) return 'MEDIUM';  
        if (score >= this.thresholds.low) return 'LOW';
        return 'VERY_LOW';
    }
}

module.exports = ConfidenceScorer;