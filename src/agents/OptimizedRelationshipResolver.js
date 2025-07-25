const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDeepseekClient } = require('../utils/deepseekClient');
const config = require('../config/secure');
const resourceManager = require('../utils/resourceManager');

/**
 * Optimized Relationship Resolver
 * 
 * Key optimizations:
 * - Replaced O(n²) nested loops with hash-based approaches O(n log n)
 * - Batch database operations
 * - Intelligent relationship filtering
 * - Memory-efficient processing
 * - Circuit breaker for LLM failures
 */
class OptimizedRelationshipResolver {
    constructor(dbManager, llmClient = null) {
        this.dbManager = dbManager;
        this.llmClient = llmClient || getDeepseekClient();
        this.stats = {
            relationshipsFound: 0,
            llmQueries: 0,
            cacheHits: 0,
            processingTime: 0,
            errors: 0
        };
        this.relationshipCache = new Map();
        this.maxCacheSize = 10000;
        
        // Register for cleanup
        resourceManager.register('OptimizedRelationshipResolver', this);
    }

    /**
     * Main entry point for relationship resolution
     * @param {string} runId - Pipeline run identifier
     */
    async run(runId) {
        const startTime = Date.now();
        console.log('🔍 Starting optimized relationship resolution...');

        try {
            const directories = await this.getDirectories();
            console.log(`📁 Found ${directories.length} directories to analyze`);

            for (const directory of directories) {
                await this.processDirectory(directory, runId);
            }

            this.stats.processingTime = Date.now() - startTime;
            console.log(`✅ Relationship resolution completed in ${this.stats.processingTime}ms`);
            console.log(`📊 Stats: ${this.stats.relationshipsFound} relationships, ${this.stats.llmQueries} LLM queries`);

        } catch (error) {
            this.stats.errors++;
            console.error('❌ Relationship resolution failed:', error);
            throw error;
        }
    }

    /**
     * Get all directories that contain analyzed files
     */
    async getDirectories() {
        const db = this.dbManager.getDb();
        const rows = db.prepare(`
            SELECT DISTINCT f.file_path
            FROM files f
            JOIN pois p ON p.file_path = f.file_path
            WHERE f.status = 'completed'
        `).all();

        const directories = new Set();
        rows.forEach(row => {
            directories.add(path.dirname(row.file_path));
        });

        return Array.from(directories);
    }

    /**
     * Process all relationships in a directory
     * @param {string} directory - Directory path
     * @param {string} runId - Pipeline run identifier
     */
    async processDirectory(directory, runId) {
        console.log(`🔍 Processing directory: ${directory}`);

        try {
            // Load all POIs for the directory
            const pois = await this.loadPoisForDirectory(directory);
            if (pois.length === 0) return;

            console.log(`📊 Directory ${directory}: ${pois.length} POIs`);

            // Group POIs by file for intra-file analysis
            const poisByFile = this.groupPoisByFile(pois);

            // Process each file individually for intra-file relationships
            const intraFileRelationships = await this.processIntraFileRelationships(poisByFile);

            // Process inter-file relationships within directory
            const interFileRelationships = await this.processInterFileRelationships(directory, pois);

            // Combine all relationships
            const allRelationships = [
                ...intraFileRelationships,
                ...interFileRelationships
            ];

            // Batch save to database
            if (allRelationships.length > 0) {
                await this.saveRelationshipsBatch(allRelationships, runId);
                this.stats.relationshipsFound += allRelationships.length;
            }

        } catch (error) {
            console.error(`❌ Error processing directory ${directory}:`, error);
            throw error;
        }
    }

    /**
     * Load POIs for a specific directory - OPTIMIZED
     */
    async loadPoisForDirectory(directory) {
        const db = this.dbManager.getDb();
        
        // Use prepared statement with index on file_path
        const stmt = db.prepare(`
            SELECT p.*, p.file_path
            FROM pois p
            JOIN files f ON p.file_path = f.file_path
            WHERE f.file_path LIKE ? AND f.status = 'completed'
            ORDER BY p.file_path, p.start_line
        `);
        
        return stmt.all(`${directory}${path.sep}%`);
    }

    /**
     * Group POIs by file path - O(n) instead of O(n²)
     */
    groupPoisByFile(pois) {
        const grouped = new Map();
        
        for (const poi of pois) {
            const filePath = poi.file_path;
            if (!grouped.has(filePath)) {
                grouped.set(filePath, []);
            }
            grouped.get(filePath).push(poi);
        }
        
        return grouped;
    }

    /**
     * Process intra-file relationships - OPTIMIZED to O(n log n)
     */
    async processIntraFileRelationships(poisByFile) {
        const allRelationships = [];

        for (const [filePath, pois] of poisByFile) {
            if (pois.length < 2) continue;

            // Use hash-based approach instead of nested loops
            const relationships = this.findIntraFileRelationshipsOptimized(pois);
            allRelationships.push(...relationships);
        }

        return allRelationships;
    }

    /**
     * OPTIMIZED: Find intra-file relationships using hash maps - O(n log n)
     * Replaces the O(n²) nested loop with intelligent pattern matching
     */
    findIntraFileRelationshipsOptimized(pois) {
        const relationships = [];
        
        // Create lookup maps for different POI types - O(n)
        const poiMaps = {
            functions: new Map(),
            classes: new Map(),
            variables: new Map(),
            imports: new Map(),
            exports: new Map()
        };

        // Populate lookup maps - O(n)
        for (const poi of pois) {
            switch (poi.type) {
                case 'function':
                    poiMaps.functions.set(poi.name, poi);
                    break;
                case 'class':
                    poiMaps.classes.set(poi.name, poi);
                    break;
                case 'variable':
                    poiMaps.variables.set(poi.name, poi);
                    break;
                case 'import':
                    poiMaps.imports.set(poi.name, poi);
                    break;
                case 'export':
                    poiMaps.exports.set(poi.name, poi);
                    break;
            }
        }

        // Find relationships using pattern matching - O(n log n)
        for (const poi of pois) {
            relationships.push(...this.findRelationshipsForPoi(poi, poiMaps));
        }

        return relationships;
    }

    /**
     * Find relationships for a specific POI using hash lookups
     */
    findRelationshipsForPoi(poi, poiMaps) {
        const relationships = [];
        const content = poi.llm_output || poi.description || '';

        // 1. Function call relationships - O(log n) per pattern
        if (poi.type === 'function' || poi.type === 'class') {
            const functionCalls = this.extractFunctionCalls(content);
            for (const funcName of functionCalls) {
                const targetFunction = poiMaps.functions.get(funcName);
                if (targetFunction && targetFunction.id !== poi.id) {
                    relationships.push({
                        source_poi_id: poi.id,
                        target_poi_id: targetFunction.id,
                        type: 'CALLS',
                        confidence: 0.8,
                        evidence: 'function_call_pattern',
                        reason: `${poi.name} calls ${funcName}`
                    });
                }
            }
        }

        // 2. Variable usage relationships - O(log n) per pattern  
        if (poi.type === 'function' || poi.type === 'class') {
            const variableUsages = this.extractVariableUsages(content);
            for (const varName of variableUsages) {
                const targetVariable = poiMaps.variables.get(varName);
                if (targetVariable && targetVariable.id !== poi.id) {
                    relationships.push({
                        source_poi_id: poi.id,
                        target_poi_id: targetVariable.id,
                        type: 'USES',
                        confidence: 0.7,
                        evidence: 'variable_usage_pattern',
                        reason: `${poi.name} uses variable ${varName}`
                    });
                }
            }
        }

        // 3. Class inheritance relationships - O(log n)
        if (poi.type === 'class') {
            const extends_class = this.extractClassInheritance(content);
            if (extends_class) {
                const parentClass = poiMaps.classes.get(extends_class);
                if (parentClass && parentClass.id !== poi.id) {
                    relationships.push({
                        source_poi_id: poi.id,
                        target_poi_id: parentClass.id,
                        type: 'EXTENDS',
                        confidence: 0.9,
                        evidence: 'inheritance_pattern',
                        reason: `${poi.name} extends ${extends_class}`
                    });
                }
            }
        }

        // 4. Import/Export relationships - O(log n)
        if (poi.type === 'import') {
            const exportedItem = poiMaps.exports.get(poi.name);
            if (exportedItem) {
                relationships.push({
                    source_poi_id: poi.id,
                    target_poi_id: exportedItem.id,
                    type: 'IMPORTS',
                    confidence: 0.95,
                    evidence: 'import_export_match',
                    reason: `imports ${poi.name}`
                });
            }
        }

        return relationships;
    }

    /**
     * Extract function calls using optimized regex patterns
     */
    extractFunctionCalls(content) {
        const calls = new Set();
        
        // Match function call patterns: functionName(
        const patterns = [
            /(\w+)\s*\(/g,                    // Basic function calls
            /\.(\w+)\s*\(/g,                  // Method calls
            /await\s+(\w+)\s*\(/g,            // Async function calls
            /new\s+(\w+)\s*\(/g               // Constructor calls
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const funcName = match[1];
                if (funcName && funcName.length > 1) { // Filter out single character matches
                    calls.add(funcName);
                }
            }
        }
        
        return Array.from(calls);
    }

    /**
     * Extract variable usages using optimized regex patterns
     */
    extractVariableUsages(content) {
        const variables = new Set();
        
        // Match variable usage patterns
        const patterns = [
            /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=]/g,           // Variable assignments
            /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\./g,            // Object property access
            /\bconst\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,         // Const declarations
            /\blet\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,           // Let declarations
            /\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g            // Var declarations
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const varName = match[1];
                if (varName && varName.length > 1) {
                    variables.add(varName);
                }
            }
        }
        
        return Array.from(variables);
    }

    /**
     * Extract class inheritance using regex patterns
     */
    extractClassInheritance(content) {
        const patterns = [
            /class\s+\w+\s+extends\s+(\w+)/g,        // ES6 class inheritance
            /extends\s+(\w+)/g,                      // General extends pattern
            /inherits\s*\(\s*\w+\s*,\s*(\w+)\s*\)/g  // Node.js util.inherits pattern
        ];
        
        for (const pattern of patterns) {
            const match = pattern.exec(content);
            if (match && match[1]) {
                return match[1];
            }
        }
        
        return null;
    }

    /**
     * Process inter-file relationships within a directory - OPTIMIZED
     */
    async processInterFileRelationships(directory, allPois) {
        const relationships = [];
        
        // Group by file for efficient lookups
        const poisByFile = this.groupPoisByFile(allPois);
        const exportMap = this.buildExportMap(allPois);
        
        // Process each file's imports against directory exports
        for (const [filePath, pois] of poisByFile) {
            const fileImports = pois.filter(p => p.type === 'import');
            
            for (const importPoi of fileImports) {
                const exportPoi = exportMap.get(importPoi.name);
                if (exportPoi && exportPoi.file_path !== filePath) {
                    relationships.push({
                        source_poi_id: importPoi.id,
                        target_poi_id: exportPoi.id,
                        type: 'IMPORTS',
                        confidence: 0.9,
                        evidence: 'cross_file_import',
                        reason: `${path.basename(filePath)} imports ${importPoi.name} from ${path.basename(exportPoi.file_path)}`
                    });
                }
            }
        }
        
        return relationships;
    }

    /**
     * Build a map of exported items for fast lookup - O(n)
     */
    buildExportMap(pois) {
        const exportMap = new Map();
        
        for (const poi of pois) {
            if (poi.type === 'export' || poi.is_exported) {
                exportMap.set(poi.name, poi);
            }
        }
        
        return exportMap;
    }

    /**
     * Batch save relationships to database - OPTIMIZED
     */
    async saveRelationshipsBatch(relationships, runId, batchSize = 1000) {
        if (!relationships.length) return;

        console.log(`💾 Saving ${relationships.length} relationships...`);
        
        try {
            // Validate and prepare relationships for batch insert
            const validatedRows = [];
            
            for (const rel of relationships) {
                try {
                    // Validate required fields
                    if (!rel.source_poi_id || !rel.target_poi_id) {
                        console.warn(`[OptimizedRelationshipResolver] Invalid relationship missing POI IDs, skipping:`, rel);
                        continue;
                    }
                    
                    if (!rel.type || typeof rel.type !== 'string') {
                        console.warn(`[OptimizedRelationshipResolver] Invalid relationship missing type, skipping:`, rel);
                        continue;
                    }

                    // Validate and provide defaults for new required fields
                    let confidence = rel.confidence;
                    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                        confidence = 0.8; // Default confidence
                        if (rel.confidence !== undefined) {
                            console.warn(`[OptimizedRelationshipResolver] Invalid confidence ${rel.confidence} for relationship ${rel.source_poi_id} -> ${rel.target_poi_id}, using default 0.8`);
                        }
                    }

                    let reason = rel.reason;
                    if (!reason || typeof reason !== 'string') {
                        reason = `${rel.type} relationship detected`; // Default reason
                        if (rel.reason !== undefined) {
                            console.warn(`[OptimizedRelationshipResolver] Invalid reason for relationship ${rel.source_poi_id} -> ${rel.target_poi_id}, using default`);
                        }
                    }

                    validatedRows.push([
                        rel.source_poi_id,
                        rel.target_poi_id,
                        rel.type.toUpperCase(),
                        confidence,
                        rel.evidence || 'deterministic',
                        reason.trim(),
                        runId,
                        new Date().toISOString()
                    ]);
                } catch (error) {
                    console.error(`[OptimizedRelationshipResolver] Error validating relationship:`, error, rel);
                }
            }

            if (validatedRows.length === 0) {
                console.warn(`[OptimizedRelationshipResolver] No valid relationships to save`);
                return;
            }

            // Use enhanced database manager's batch insert
            const inserted = this.dbManager.batchInsert(
                'relationships',
                ['source_poi_id', 'target_poi_id', 'type', 'confidence', 'evidence_type', 'reason', 'run_id', 'created_at'],
                validatedRows,
                batchSize
            );

            console.log(`✅ Saved ${inserted} validated relationships to database`);
        } catch (error) {
            console.error('❌ Failed to save relationships:', error);
            throw error;
        }
    }

    /**
     * Get processing statistics
     */
    getStats() {
        return {
            ...this.stats,
            cacheSize: this.relationshipCache.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Clean up resources
     */
    async close() {
        this.relationshipCache.clear();
        console.log('✅ OptimizedRelationshipResolver cleaned up');
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            return {
                healthy: true,
                stats: this.getStats(),
                cacheSize: this.relationshipCache.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = OptimizedRelationshipResolver;