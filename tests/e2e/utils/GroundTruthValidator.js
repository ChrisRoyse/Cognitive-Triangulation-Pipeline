class GroundTruthValidator {
    constructor(groundTruthData) {
        this.groundTruth = groundTruthData;
        this.relationships = this.normalizeRelationships(groundTruthData.relationships);
    }
    
    normalizeRelationships(relationships) {
        return relationships.map(rel => ({
            ...rel,
            normalizedSource: this.normalizeEntityId(rel.source),
            normalizedTarget: this.normalizeEntityId(rel.target),
            normalizedType: rel.type.toUpperCase()
        }));
    }
    
    normalizeEntityId(entityId) {
        // Normalize entity IDs for comparison
        // Handle different path formats and naming conventions
        return entityId
            .replace(/\\/g, '/')  // Normalize path separators
            .replace(/^\.\//, '') // Remove leading ./
            .toLowerCase();       // Case insensitive comparison
    }
    
    compareRelationships(detected, groundTruth) {
        const results = {
            truePositives: [],
            falsePositives: [],
            falseNegatives: [],
            matches: []
        };
        
        // Normalize detected relationships
        const normalizedDetected = detected.map(rel => ({
            ...rel,
            normalizedSource: this.createEntityId(rel.source_path, rel.source_name),
            normalizedTarget: this.createEntityId(rel.target_path, rel.target_name),
            normalizedType: (rel.relationship_type || rel.type || '').toUpperCase()
        }));
        
        // Find matches
        const matchedGroundTruth = new Set();
        
        for (const detected of normalizedDetected) {
            const match = this.findMatchingGroundTruth(detected, groundTruth || this.relationships);
            
            if (match) {
                results.truePositives.push({
                    detected,
                    groundTruth: match,
                    confidence: detected.confidence_score || detected.confidence || 1.0
                });
                matchedGroundTruth.add(match.id);
                results.matches.push({ detected, groundTruth: match });
            } else {
                results.falsePositives.push(detected);
            }
        }
        
        // Find false negatives (ground truth not detected)
        const allGroundTruth = groundTruth || this.relationships;
        for (const gt of allGroundTruth) {
            if (!matchedGroundTruth.has(gt.id)) {
                results.falseNegatives.push(gt);
            }
        }
        
        return results;
    }
    
    createEntityId(filePath, entityName) {
        // Create normalized entity ID from file path and entity name
        const normalizedPath = filePath
            .replace(/\\/g, '/')
            .replace(/^\.\//, '')
            .toLowerCase();
        
        const normalizedName = (entityName || '').toLowerCase();
        
        return `${normalizedPath}:${normalizedName}`;
    }
    
    findMatchingGroundTruth(detected, groundTruthList) {
        for (const gt of groundTruthList) {
            if (this.isMatch(detected, gt)) {
                return gt;
            }
        }
        return null;
    }
    
    isMatch(detected, groundTruth) {
        // Check if source and target match (in either direction for undirected relationships)
        const directMatch = 
            this.entityMatches(detected.normalizedSource, groundTruth.normalizedSource) &&
            this.entityMatches(detected.normalizedTarget, groundTruth.normalizedTarget);
        
        const reverseMatch = 
            this.entityMatches(detected.normalizedSource, groundTruth.normalizedTarget) &&
            this.entityMatches(detected.normalizedTarget, groundTruth.normalizedSource);
        
        if (!(directMatch || reverseMatch)) {
            return false;
        }
        
        // Check relationship type (with some flexibility)
        return this.typeMatches(detected.normalizedType, groundTruth.normalizedType);
    }
    
    entityMatches(detected, groundTruth) {
        // Exact match
        if (detected === groundTruth) return true;
        
        // Handle partial matches (e.g., class name without full path)
        const detectedParts = detected.split(':');
        const groundTruthParts = groundTruth.split(':');
        
        // Check if entity names match
        if (detectedParts[1] && groundTruthParts[1]) {
            if (detectedParts[1] === groundTruthParts[1]) {
                // Entity names match, check if paths are compatible
                return this.pathsAreCompatible(detectedParts[0], groundTruthParts[0]);
            }
        }
        
        return false;
    }
    
    pathsAreCompatible(path1, path2) {
        // Check if one path ends with the other (handling different root paths)
        return path1.endsWith(path2) || path2.endsWith(path1);
    }
    
    typeMatches(detected, groundTruth) {
        // Exact match
        if (detected === groundTruth) return true;
        
        // Handle type synonyms
        const typeSynonyms = {
            'USES': ['DEPENDS_ON', 'IMPORTS', 'REQUIRES'],
            'CALLS': ['INVOKES', 'EXECUTES'],
            'IMPLEMENTS': ['REALIZES', 'PROVIDES'],
            'EXTENDS': ['INHERITS_FROM', 'DERIVES_FROM'],
            'RELATES_TO': ['ASSOCIATED_WITH', 'CONNECTED_TO']
        };
        
        // Check if types are synonyms
        for (const [baseType, synonyms] of Object.entries(typeSynonyms)) {
            const allTypes = [baseType, ...synonyms];
            if (allTypes.includes(detected) && allTypes.includes(groundTruth)) {
                return true;
            }
        }
        
        return false;
    }
    
    generateReport(comparisonResults) {
        const report = {
            summary: {
                truePositives: comparisonResults.truePositives.length,
                falsePositives: comparisonResults.falsePositives.length,
                falseNegatives: comparisonResults.falseNegatives.length,
                totalDetected: comparisonResults.truePositives.length + comparisonResults.falsePositives.length,
                totalGroundTruth: this.relationships.length
            },
            details: {
                matched: comparisonResults.truePositives.map(tp => ({
                    detected: `${tp.detected.normalizedSource} -> ${tp.detected.normalizedTarget}`,
                    groundTruth: `${tp.groundTruth.source} -> ${tp.groundTruth.target}`,
                    type: tp.detected.normalizedType,
                    confidence: tp.confidence
                })),
                falsePositives: comparisonResults.falsePositives.map(fp => ({
                    detected: `${fp.normalizedSource} -> ${fp.normalizedTarget}`,
                    type: fp.normalizedType
                })),
                missed: comparisonResults.falseNegatives.map(fn => ({
                    expected: `${fn.source} -> ${fn.target}`,
                    type: fn.type,
                    evidence: fn.evidence
                }))
            }
        };
        
        return report;
    }
}

module.exports = { GroundTruthValidator };