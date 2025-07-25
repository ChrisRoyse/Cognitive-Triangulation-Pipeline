const logger = require('../../utils/logger');

/**
 * A stateless utility class that centralizes all logic related to the calculation
 * and interpretation of confidence scores.
 */
class ConfidenceScoringService {
  /**
   * Extracts or calculates a preliminary confidence score from the direct output of an LLM.
   * @param {object} llmOutput - The raw JSON object from the LLM.
   * @param {object} context - Contextual information for logging.
   * @returns {number} A preliminary confidence score between 0.0 and 1.0.
   */
  static getInitialScoreFromLlm(llmOutput, context = {}) {
    if (llmOutput && typeof llmOutput.probability === 'number') {
      return Math.max(0, Math.min(1, llmOutput.probability));
    }
    logger.warn({
      msg: 'Uncalibrated score-- LLM output missing probability. Using default.',
      ...context,
    });
    return 0.5; // Default neutral score
  }

  /**
   * Calculates a final, reconciled confidence score from an array of evidence
   * using a single-pass reduce operation for improved efficiency and robustness.
   * @param {Array<object>} evidenceArray - Array of evidence objects from workers.
   *        Each object should have `confidence` (number) or will be treated as found relationship.
   * @returns {{finalScore: number, hasConflict: boolean}}
   */
  static calculateFinalScore(evidenceArray) {
    if (!evidenceArray || evidenceArray.length === 0) {
      return { finalScore: 0, hasConflict: false };
    }

    // Extract confidence scores from evidence, handling different structures
    const confidenceScores = [];
    for (const evidence of evidenceArray) {
      if (!evidence || typeof evidence !== 'object') {
        continue; // Skip invalid evidence
      }
      
      // Handle different evidence structures
      if (typeof evidence.confidence === 'number') {
        // Direct confidence score
        confidenceScores.push(Math.max(0, Math.min(1, evidence.confidence)));
      } else if (typeof evidence.initialScore === 'number') {
        // Legacy structure with initialScore
        confidenceScores.push(Math.max(0, Math.min(1, evidence.initialScore)));
      } else if (evidence.synthetic) {
        // Synthetic evidence from repair scripts - treat as medium confidence
        confidenceScores.push(0.6);
      } else {
        // Evidence without explicit confidence - treat as found relationship with default confidence
        confidenceScores.push(0.7);
      }
    }
    
    if (confidenceScores.length === 0) {
      logger.warn({
        msg: 'No valid confidence scores found in evidence array.',
        evidenceCount: evidenceArray.length,
      });
      return { finalScore: 0, hasConflict: false };
    }

    // Calculate weighted average of confidence scores
    const totalScore = confidenceScores.reduce((sum, score) => sum + score, 0);
    const averageScore = totalScore / confidenceScores.length;
    
    // Apply confidence boosting for multiple evidence sources
    let finalScore = averageScore;
    if (confidenceScores.length > 1) {
      // Boost confidence when multiple sources agree (convergence bonus)
      const variance = confidenceScores.reduce((sum, score) => sum + Math.pow(score - averageScore, 2), 0) / confidenceScores.length;
      const convergenceBonus = Math.max(0, (1 - variance) * 0.2); // Up to 20% bonus for low variance
      finalScore = Math.min(1, averageScore + convergenceBonus);
    }
    
    // Detect conflicts (high variance in confidence scores)
    const maxScore = Math.max(...confidenceScores);
    const minScore = Math.min(...confidenceScores);
    const hasConflict = (maxScore - minScore) > 0.4; // Conflict if scores differ by more than 40%
    
    return {
      finalScore: Math.max(0, Math.min(1, finalScore)),
      hasConflict: hasConflict,
    };
  }
}

module.exports = ConfidenceScoringService;