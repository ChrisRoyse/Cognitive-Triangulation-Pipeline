/**
 * Simplified Triangulation Configuration
 * Basic relationship analysis without complex parallel coordination
 */

const triangulationConfig = {
    // Default mode - simplified
    defaultMode: 'simple',
    
    // Basic settings
    simple: {
        enabled: true,
        timeout: 30000, // 30 seconds
        maxRetries: 2
    },
    
    // Confidence scoring - simplified
    confidenceScoring: {
        highThreshold: 0.8,
        mediumThreshold: 0.6, 
        lowThreshold: 0.4
    }
};

// Helper function to get simplified configuration
function getModeConfig(mode = null) {
    return {
        ...triangulationConfig.simple,
        confidenceScoring: triangulationConfig.confidenceScoring
    };
}

module.exports = {
    triangulationConfig,
    getModeConfig
};