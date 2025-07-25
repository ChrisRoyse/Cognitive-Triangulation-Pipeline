const crypto = require('crypto');

/**
 * CrossFileRelationshipResolver - Service for finding relationships between POIs in different files
 * Uses semantic IDs and file analysis results to identify cross-file patterns
 * Supports import/export relationships, API calls, inheritance, and composition
 */
class CrossFileRelationshipResolver {
    constructor(dbManager) {
        this.dbManager = dbManager;
    }

    /**
     * Find all cross-file relationships for a run
     */
    async findAllCrossFileRelationships(runId) {
        console.log(`[CrossFileRelationshipResolver] Finding all cross-file relationships for run: ${runId}`);
        
        const relationships = [];
        
        // Find import-export relationships
        const importExportRels = await this.findImportExportRelationships(runId);
        relationships.push(...importExportRels);
        
        // Find API call relationships
        const apiCallRels = await this.findApiCallRelationships(runId);
        relationships.push(...apiCallRels);
        
        // Find inheritance relationships
        const inheritanceRels = await this.findInheritanceRelationships(runId);
        relationships.push(...inheritanceRels);
        
        // Find composition relationships
        const compositionRels = await this.findCompositionRelationships(runId);
        relationships.push(...compositionRels);
        
        // Find configuration dependencies
        const configRels = await this.findConfigurationDependencies(runId);
        relationships.push(...configRels);
        
        console.log(`[CrossFileRelationshipResolver] Found ${relationships.length} total cross-file relationships`);
        return relationships;
    }

    /**
     * Find import-export relationships by matching import statements to exported functions/classes
     */
    async findImportExportRelationships(runId) {
        const db = this.dbManager.getDb();
        
        // Get all exported POIs
        const exportedPois = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND is_exported = 1
            ORDER BY file_path, name
        `).all(runId);
        
        // Get all import-related POIs
        const importPois = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND (type LIKE '%import%' OR name LIKE '%import%' OR name LIKE '%require%')
            ORDER BY file_path, name
        `).all(runId);
        
        const relationships = [];
        
        for (const importPoi of importPois) {
            // Try to match import to exported items
            const matchedExports = this.matchImportToExports(importPoi, exportedPois);
            
            for (const exportPoi of matchedExports) {
                // Ensure it's a cross-file relationship
                if (importPoi.file_path !== exportPoi.file_path) {
                    const relationship = this.createCrossFileRelationship(
                        importPoi,
                        exportPoi,
                        'IMPORTS',
                        `Import statement '${importPoi.name}' imports '${exportPoi.name}' from ${exportPoi.file_path}`,
                        0.85,
                        `Cross-file import: ${importPoi.file_path} imports from ${exportPoi.file_path}`
                    );
                    
                    relationships.push(relationship);
                }
            }
        }
        
        console.log(`[CrossFileRelationshipResolver] Found ${relationships.length} import-export relationships`);
        return relationships;
    }

    /**
     * Find API call relationships by matching function calls to exported functions
     */
    async findApiCallRelationships(runId) {
        const db = this.dbManager.getDb();
        
        // Get all exported functions/methods
        const exportedFunctions = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND is_exported = 1
              AND (type LIKE '%function%' OR type LIKE '%method%')
            ORDER BY file_path, name
        `).all(runId);
        
        // Get all function calls
        const functionCalls = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND (type LIKE '%call%' OR type LIKE '%function%' OR type LIKE '%method%')
              AND is_exported = 0
            ORDER BY file_path, name
        `).all(runId);
        
        const relationships = [];
        
        for (const callPoi of functionCalls) {
            // Try to match function call to exported functions
            const matchedFunctions = this.matchCallToExportedFunctions(callPoi, exportedFunctions);
            
            for (const functionPoi of matchedFunctions) {
                // Ensure it's a cross-file relationship
                if (callPoi.file_path !== functionPoi.file_path) {
                    const relationship = this.createCrossFileRelationship(
                        callPoi,
                        functionPoi,
                        'CALLS',
                        `Function '${callPoi.name}' calls '${functionPoi.name}' from ${functionPoi.file_path}`,
                        0.80,
                        `Cross-file API call: ${callPoi.file_path} calls function in ${functionPoi.file_path}`
                    );
                    
                    relationships.push(relationship);
                }
            }
        }
        
        console.log(`[CrossFileRelationshipResolver] Found ${relationships.length} API call relationships`);
        return relationships;
    }

    /**
     * Find inheritance relationships between classes in different files
     */
    async findInheritanceRelationships(runId) {
        const db = this.dbManager.getDb();
        
        // Get all class POIs
        const classPois = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND (type LIKE '%class%' OR type LIKE '%interface%')
            ORDER BY file_path, name
        `).all(runId);
        
        const relationships = [];
        
        for (const childClass of classPois) {
            // Look for inheritance patterns in description or LLM output
            const parentClasses = this.findParentClasses(childClass, classPois);
            
            for (const parentClass of parentClasses) {
                // Ensure it's a cross-file relationship
                if (childClass.file_path !== parentClass.file_path) {
                    const relationship = this.createCrossFileRelationship(
                        childClass,
                        parentClass,
                        'INHERITS',
                        `Class '${childClass.name}' inherits from '${parentClass.name}' in ${parentClass.file_path}`,
                        0.90,
                        `Cross-file inheritance: ${childClass.file_path} extends class from ${parentClass.file_path}`
                    );
                    
                    relationships.push(relationship);
                }
            }
        }
        
        console.log(`[CrossFileRelationshipResolver] Found ${relationships.length} inheritance relationships`);
        return relationships;
    }

    /**
     * Find composition relationships (one class uses another class)
     */
    async findCompositionRelationships(runId) {
        const db = this.dbManager.getDb();
        
        // Get all class POIs
        const classPois = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND type LIKE '%class%'
            ORDER BY file_path, name
        `).all(runId);
        
        const relationships = [];
        
        for (const composerClass of classPois) {
            // Look for composition patterns (class uses other classes)
            const composedClasses = this.findComposedClasses(composerClass, classPois);
            
            for (const composedClass of composedClasses) {
                // Ensure it's a cross-file relationship
                if (composerClass.file_path !== composedClass.file_path) {
                    const relationship = this.createCrossFileRelationship(
                        composerClass,
                        composedClass,
                        'COMPOSES',
                        `Class '${composerClass.name}' uses/composes '${composedClass.name}' from ${composedClass.file_path}`,
                        0.75,
                        `Cross-file composition: ${composerClass.file_path} uses class from ${composedClass.file_path}`
                    );
                    
                    relationships.push(relationship);
                }
            }
        }
        
        console.log(`[CrossFileRelationshipResolver] Found ${relationships.length} composition relationships`);
        return relationships;
    }

    /**
     * Find configuration dependencies
     */
    async findConfigurationDependencies(runId) {
        const db = this.dbManager.getDb();
        
        // Get all configuration POIs
        const configPois = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND (name LIKE '%config%' OR name LIKE '%setting%' OR name LIKE '%option%' 
                   OR type LIKE '%config%' OR name LIKE '%env%')
            ORDER BY file_path, name
        `).all(runId);
        
        // Get all potential consumer POIs
        const consumerPois = db.prepare(`
            SELECT id, name, type, file_path, semantic_id, description
            FROM pois 
            WHERE run_id = ? 
              AND (type LIKE '%function%' OR type LIKE '%method%' OR type LIKE '%class%')
            ORDER BY file_path, name
        `).all(runId);
        
        const relationships = [];
        
        for (const consumerPoi of consumerPois) {
            // Look for configuration usage patterns
            const usedConfigs = this.findUsedConfigurations(consumerPoi, configPois);
            
            for (const configPoi of usedConfigs) {
                // Ensure it's a cross-file relationship
                if (consumerPoi.file_path !== configPoi.file_path) {
                    const relationship = this.createCrossFileRelationship(
                        consumerPoi,
                        configPoi,
                        'USES_CONFIG',
                        `${consumerPoi.type} '${consumerPoi.name}' uses configuration '${configPoi.name}' from ${configPoi.file_path}`,
                        0.70,
                        `Cross-file config dependency: ${consumerPoi.file_path} uses config from ${configPoi.file_path}`
                    );
                    
                    relationships.push(relationship);
                }
            }
        }
        
        console.log(`[CrossFileRelationshipResolver] Found ${relationships.length} configuration dependency relationships`);
        return relationships;
    }

    /**
     * Match import statement to exported items using name similarity
     */
    matchImportToExports(importPoi, exportedPois) {
        const matches = [];
        const importName = importPoi.name.toLowerCase();
        const importDesc = (importPoi.description || '').toLowerCase();
        
        for (const exportPoi of exportedPois) {
            const exportName = exportPoi.name.toLowerCase();
            
            // Direct name match
            if (importName.includes(exportName) || exportName.includes(importName)) {
                matches.push(exportPoi);
                continue;
            }
            
            // Check if import description mentions the export name
            if (importDesc.includes(exportName)) {
                matches.push(exportPoi);
                continue;
            }
            
            // Check for common import patterns
            if (this.isLikelyImportMatch(importPoi, exportPoi)) {
                matches.push(exportPoi);
            }
        }
        
        return matches;
    }

    /**
     * Match function call to exported functions using name similarity
     */
    matchCallToExportedFunctions(callPoi, exportedFunctions) {
        const matches = [];
        const callName = callPoi.name.toLowerCase();
        const callDesc = (callPoi.description || '').toLowerCase();
        
        for (const functionPoi of exportedFunctions) {
            const functionName = functionPoi.name.toLowerCase();
            
            // Direct name match
            if (callName.includes(functionName) || functionName.includes(callName)) {
                matches.push(functionPoi);
                continue;
            }
            
            // Check if call description mentions the function name
            if (callDesc.includes(functionName)) {
                matches.push(functionPoi);
                continue;
            }
            
            // Check for common call patterns
            if (this.isLikelyCallMatch(callPoi, functionPoi)) {
                matches.push(functionPoi);
            }
        }
        
        return matches;
    }

    /**
     * Find parent classes for inheritance relationships
     */
    findParentClasses(childClass, allClasses) {
        const parents = [];
        const childDesc = (childClass.description || '').toLowerCase();
        const childName = childClass.name.toLowerCase();
        
        for (const potentialParent of allClasses) {
            if (childClass.id === potentialParent.id) continue;
            
            const parentName = potentialParent.name.toLowerCase();
            
            // Check for extends keyword in description
            if (childDesc.includes(`extends ${parentName}`) || 
                childDesc.includes(`inherits from ${parentName}`) ||
                childDesc.includes(`: ${parentName}`)) {
                parents.push(potentialParent);
                continue;
            }
            
            // Check for common inheritance patterns
            if (this.isLikelyInheritanceMatch(childClass, potentialParent)) {
                parents.push(potentialParent);
            }
        }
        
        return parents;
    }

    /**
     * Find composed classes for composition relationships
     */
    findComposedClasses(composerClass, allClasses) {
        const composed = [];
        const composerDesc = (composerClass.description || '').toLowerCase();
        
        for (const potentialComposed of allClasses) {
            if (composerClass.id === potentialComposed.id) continue;
            
            const composedName = potentialComposed.name.toLowerCase();
            
            // Check if composer mentions using the other class
            if (composerDesc.includes(`uses ${composedName}`) || 
                composerDesc.includes(`contains ${composedName}`) ||
                composerDesc.includes(`has ${composedName}`) ||
                composerDesc.includes(`new ${composedName}`)) {
                composed.push(potentialComposed);
                continue;
            }
            
            // Check for common composition patterns
            if (this.isLikelyCompositionMatch(composerClass, potentialComposed)) {
                composed.push(potentialComposed);
            }
        }
        
        return composed;
    }

    /**
     * Find configurations used by a consumer
     */
    findUsedConfigurations(consumerPoi, configPois) {
        const usedConfigs = [];
        const consumerDesc = (consumerPoi.description || '').toLowerCase();
        
        for (const configPoi of configPois) {
            const configName = configPoi.name.toLowerCase();
            
            // Check if consumer mentions using the config
            if (consumerDesc.includes(configName) || 
                consumerDesc.includes(`config.${configName}`) ||
                consumerDesc.includes(`process.env.${configName.toUpperCase()}`)) {
                usedConfigs.push(configPoi);
                continue;
            }
            
            // Check for common config usage patterns
            if (this.isLikelyConfigUsage(consumerPoi, configPoi)) {
                usedConfigs.push(configPoi);
            }
        }
        
        return usedConfigs;
    }

    /**
     * Check if import likely matches export
     */
    isLikelyImportMatch(importPoi, exportPoi) {
        const importWords = this.extractWords(importPoi.name);
        const exportWords = this.extractWords(exportPoi.name);
        
        // Check for word overlap
        const overlap = importWords.filter(word => exportWords.includes(word));
        return overlap.length > 0 && overlap.some(word => word.length > 3);
    }

    /**
     * Check if call likely matches function
     */
    isLikelyCallMatch(callPoi, functionPoi) {
        const callWords = this.extractWords(callPoi.name);
        const functionWords = this.extractWords(functionPoi.name);
        
        // Check for word overlap
        const overlap = callWords.filter(word => functionWords.includes(word));
        return overlap.length > 0 && overlap.some(word => word.length > 3);
    }

    /**
     * Check if inheritance relationship is likely
     */
    isLikelyInheritanceMatch(childClass, parentClass) {
        const childName = childClass.name.toLowerCase();
        const parentName = parentClass.name.toLowerCase();
        
        // Common inheritance patterns
        if (childName.includes(parentName) && childName !== parentName) {
            return true;
        }
        
        // Check for base/abstract class patterns
        if (parentName.includes('base') || parentName.includes('abstract')) {
            return true;
        }
        
        return false;
    }

    /**
     * Check if composition relationship is likely
     */
    isLikelyCompositionMatch(composerClass, composedClass) {
        const composerName = composerClass.name.toLowerCase();
        const composedName = composedClass.name.toLowerCase();
        
        // Check if composer name suggests it uses the composed class
        if (composerName.includes(composedName) || 
            composerName.includes(`${composedName}manager`) ||
            composerName.includes(`${composedName}handler`)) {
            return true;
        }
        
        return false;
    }

    /**
     * Check if config usage is likely
     */
    isLikelyConfigUsage(consumerPoi, configPoi) {
        const consumerName = consumerPoi.name.toLowerCase();
        const configName = configPoi.name.toLowerCase();
        
        // Check for related functionality
        const configWords = this.extractWords(configName);
        const consumerWords = this.extractWords(consumerName);
        
        const overlap = configWords.filter(word => consumerWords.includes(word));
        return overlap.length > 0;
    }

    /**
     * Extract meaningful words from a name
     */
    extractWords(name) {
        // Split on camelCase, snake_case, and kebab-case
        return name.toLowerCase()
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(/[_\-\s]+/)
            .filter(word => word.length > 2);
    }

    /**
     * Create a cross-file relationship object
     */
    createCrossFileRelationship(fromPoi, toPoi, type, reason, confidence, evidence) {
        const hash = crypto.createHash('md5');
        hash.update(fromPoi.semantic_id || fromPoi.id.toString());
        hash.update(toPoi.semantic_id || toPoi.id.toString());
        hash.update(type);
        
        return {
            id: `cross-file-${hash.digest('hex').substring(0, 8)}`,
            from: fromPoi.semantic_id || fromPoi.id,
            to: toPoi.semantic_id || toPoi.id,
            type: type,
            reason: reason,
            confidence: confidence,
            evidence: evidence,
            cross_file: true,
            from_file: fromPoi.file_path,
            to_file: toPoi.file_path
        };
    }

    /**
     * Get cross-file relationship statistics for a run
     */
    async getCrossFileRelationshipStats(runId) {
        const db = this.dbManager.getDb();
        
        // Get total POI count
        const totalPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(runId).count;
        
        // Get file count
        const fileCount = db.prepare('SELECT COUNT(DISTINCT file_path) as count FROM pois WHERE run_id = ?').get(runId).count;
        
        // Get exported POI count
        const exportedPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ? AND is_exported = 1').get(runId).count;
        
        return {
            totalPois,
            fileCount,
            exportedPois,
            averagePoIsPerFile: Math.round(totalPois / fileCount),
            exportRatio: Math.round((exportedPois / totalPois) * 100) / 100
        };
    }
}

module.exports = CrossFileRelationshipResolver;