const path = require('path');
const crypto = require('crypto');

/**
 * SemanticIdentityService provides meaningful semantic identifiers for POIs
 * to enable cognitive triangulation across files and contexts.
 * 
 * Format: {file_prefix}_{poi_type}_{semantic_name}
 * Examples:
 * - auth_func_validateCredentials
 * - user_class_UserManager  
 * - config_var_DATABASE_URL
 * - api_import_express
 */
class SemanticIdentityService {
    constructor() {
        // Cache for file prefixes to ensure consistency
        this.filePrefixCache = new Map();
        
        // Track used IDs to handle conflicts
        this.usedIds = new Set();
        
        // Type mappings for consistent naming
        this.typeMap = {
            'classdefinition': 'class',
            'functiondefinition': 'func',
            'variabledeclaration': 'var',
            'importstatement': 'import',
            'exportstatement': 'export',
            'interface': 'interface',
            'enum': 'enum',
            'type': 'type',
            'constant': 'const',
            'method': 'method',
            'property': 'prop'
        };
    }

    /**
     * Generate a semantic identifier for a POI
     * @param {string} filePath - The file path
     * @param {object} poi - The POI object with name, type, etc.
     * @returns {string} Semantic identifier
     */
    generateSemanticId(filePath, poi) {
        if (!filePath || !poi || !poi.name || !poi.type) {
            throw new Error(`[SemanticIdentityService] Invalid parameters for semantic ID generation. FilePath: ${filePath ? 'provided' : 'missing'}, POI name: ${poi?.name || 'missing'}, POI type: ${poi?.type || 'missing'}. All three are required.`);
        }

        // Get or generate file prefix
        const filePrefix = this.getFilePrefix(filePath);
        
        // Normalize POI type
        const poiType = this.normalizePoiType(poi.type);
        
        // Clean and normalize semantic name
        const semanticName = this.normalizeName(poi.name);
        
        // Construct base semantic ID
        const baseId = `${filePrefix}_${poiType}_${semanticName}`;
        
        // Handle conflicts by adding suffix
        let semanticId = baseId;
        let suffix = 1;
        
        while (this.usedIds.has(semanticId)) {
            semanticId = `${baseId}_${suffix}`;
            suffix++;
        }
        
        // Track this ID as used
        this.usedIds.add(semanticId);
        
        return semanticId;
    }

    /**
     * Parse a semantic ID back into its components
     * @param {string} semanticId - The semantic identifier
     * @returns {object} {filePrefix, poiType, semanticName, suffix?}
     */
    parseSemanticId(semanticId) {
        if (!semanticId || typeof semanticId !== 'string') {
            throw new Error(`[SemanticIdentityService] Invalid semantic ID provided. Expected non-empty string, got: ${typeof semanticId} ${semanticId === null ? '(null)' : semanticId === undefined ? '(undefined)' : `"${semanticId}"`}`);
        }

        const parts = semanticId.split('_');
        if (parts.length < 3) {
            throw new Error(`[SemanticIdentityService] Invalid semantic ID format: "${semanticId}". Expected format: filePrefix_poiType_semanticName (e.g., "auth_func_validateUser"). Got ${parts.length} parts instead of minimum 3.`);
        }

        const filePrefix = parts[0];
        const poiType = parts[1];
        
        // Handle names with underscores and potential suffixes
        let semanticName = parts.slice(2).join('_');
        let suffix = null;
        
        // Check if last part is a numeric suffix
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart) && parts.length > 3) {
            suffix = parseInt(lastPart);
            semanticName = parts.slice(2, -1).join('_');
        }

        return {
            filePrefix,
            poiType,
            semanticName,
            suffix
        };
    }

    /**
     * Get file prefix from file path, with caching for consistency
     * @param {string} filePath - The file path
     * @returns {string} File prefix
     */
    getFilePrefix(filePath) {
        if (this.filePrefixCache.has(filePath)) {
            return this.filePrefixCache.get(filePath);
        }

        const fileName = path.basename(filePath);
        const nameWithoutExt = path.parse(fileName).name;
        
        // Convert to lowercase and handle special cases
        let prefix = nameWithoutExt.toLowerCase();
        
        // Handle common patterns
        prefix = prefix
            .replace(/[^a-z0-9]/g, '') // Remove special characters
            .replace(/^index$/, 'idx') // Shorten common names
            .replace(/^main$/, 'main')
            .replace(/^app$/, 'app')
            .replace(/^server$/, 'srv')
            .replace(/^client$/, 'cli')
            .replace(/^config$/, 'cfg')
            .replace(/^utils$/, 'util')
            .replace(/^helpers$/, 'help')
            .replace(/^constants$/, 'const')
            .replace(/^types$/, 'types')
            .replace(/^interfaces$/, 'iface');

        // Ensure prefix is not empty and has reasonable length
        if (!prefix) {
            prefix = 'file';
        }
        
        // Truncate if too long
        if (prefix.length > 8) {
            prefix = prefix.substring(0, 8);
        }

        this.filePrefixCache.set(filePath, prefix);
        return prefix;
    }

    /**
     * Normalize POI type to consistent short form
     * @param {string} type - The POI type
     * @returns {string} Normalized type
     */
    normalizePoiType(type) {
        const normalized = type.toLowerCase().replace(/[^a-z]/g, '');
        return this.typeMap[normalized] || normalized.substring(0, 6); // Fallback to first 6 chars
    }

    /**
     * Normalize and clean a name for use in semantic ID
     * @param {string} name - The name to normalize
     * @returns {string} Normalized name
     */
    normalizeName(name) {
        if (!name) return 'unnamed';
        
        // Handle different naming conventions
        let normalized = name
            .replace(/^[_$]+/, '') // Remove leading underscores/dollars
            .replace(/[_$]+$/, '') // Remove trailing underscores/dollars
            .replace(/[^a-zA-Z0-9_]/g, '') // Keep only alphanumeric and underscore
            .replace(/_+/g, '_') // Collapse multiple underscores
            .toLowerCase();

        // Handle camelCase by converting to snake_case
        normalized = normalized.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        
        // Ensure it starts with a letter
        if (!/^[a-z]/.test(normalized)) {
            normalized = 'n' + normalized;
        }

        // Truncate if too long
        if (normalized.length > 20) {
            normalized = normalized.substring(0, 20);
        }

        return normalized || 'unnamed';
    }

    /**
     * Validate a semantic ID format
     * @param {string} semanticId - The semantic identifier
     * @returns {boolean} True if valid format
     */
    isValidSemanticId(semanticId) {
        try {
            const parts = this.parseSemanticId(semanticId);
            return !!(parts.filePrefix && parts.poiType && parts.semanticName);
        } catch {
            return false;
        }
    }

    /**
     * Generate a batch of semantic IDs for multiple POIs from the same file
     * This ensures consistency and handles conflicts efficiently
     * @param {string} filePath - The file path
     * @param {Array} pois - Array of POI objects
     * @returns {Array} Array of POIs with semantic_id added
     */
    generateBatchSemanticIds(filePath, pois) {
        if (!Array.isArray(pois)) {
            throw new Error('POIs must be an array');
        }

        const results = [];
        
        for (const poi of pois) {
            try {
                const semanticId = this.generateSemanticId(filePath, poi);
                results.push({
                    ...poi,
                    semantic_id: semanticId
                });
            } catch (error) {
                console.warn(`Failed to generate semantic ID for POI ${poi.name}: ${error.message}`);
                // Fallback to UUID if semantic ID generation fails
                const fallbackId = `fallback_${crypto.randomUUID().substring(0, 8)}`;
                this.usedIds.add(fallbackId);
                results.push({
                    ...poi,
                    semantic_id: fallbackId
                });
            }
        }

        return results;
    }

    /**
     * Clear the used IDs cache (useful for testing or new runs)
     */
    clearCache() {
        this.usedIds.clear();
        this.filePrefixCache.clear();
    }

    /**
     * Get statistics about the semantic identity service
     * @returns {object} Statistics
     */
    getStats() {
        return {
            totalGeneratedIds: this.usedIds.size,
            cachedFilePrefixes: this.filePrefixCache.size,
            typeMapping: Object.keys(this.typeMap).length
        };
    }

    /**
     * Import existing IDs to track conflicts (useful when loading from database)
     * @param {Array<string>} existingIds - Array of existing semantic IDs
     */
    importExistingIds(existingIds) {
        if (Array.isArray(existingIds)) {
            existingIds.forEach(id => {
                if (typeof id === 'string') {
                    this.usedIds.add(id);
                }
            });
        }
    }
}

module.exports = SemanticIdentityService;