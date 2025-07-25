const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');
const { createTimeoutAwareExecution } = require('../utils/timeoutUtil');

/**
 * GlobalRelationshipAnalysisWorker - Analyzes relationships across ALL files in a run
 * This enables true cognitive triangulation by finding cross-file relationships
 * like imports, API calls, inheritance, and data dependencies.
 */
class GlobalRelationshipAnalysisWorker {
    constructor(queueManager, dbManager, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        
        // Create timeout-aware execution wrapper if worker pool manager is available
        this.executeWithTimeout = workerPoolManager 
            ? createTimeoutAwareExecution(workerPoolManager, 'global-relationship-analysis', 120000) // 2 minute timeout
            : null;
        
        // Get centralized configuration
        const pipelineConfig = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = pipelineConfig.getWorkerLimit('global-relationship-analysis') || 
                           pipelineConfig.getWorkerLimit('relationship-resolution'); // Fallback to relationship-resolution if not defined
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('global-relationship-analysis-queue', workerPoolManager, {
                    workerType: 'global-relationship-analysis',
                    baseConcurrency: Math.min(5, workerLimit), // Lower concurrency - complex analysis
                    maxConcurrency: workerLimit,
                    minConcurrency: 1,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: Math.floor(workerLimit / 4), // Conservative rate limiting
                    // rateLimitWindow: 2000,
                    failureThreshold: 10, // Increased from 2 to be less aggressive
                    resetTimeout: 120000,
                    jobTimeout: 600000, // 10 minutes for cross-file analysis
                    retryAttempts: 2,
                    retryDelay: 15000,
                    ...options
                });
                
                console.log('GlobalRelationshipAnalysisWorker ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('global-relationship-analysis-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: workerLimit // Use centralized config
                });
            }
        }
    }

    async initializeWorker() {
        try {
            await this.managedWorker.initialize(
                this.queueManager.connection,
                this.process.bind(this)
            );
            
            console.log('✅ GlobalRelationshipAnalysisWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize GlobalRelationshipAnalysisWorker:', error);
            throw error;
        }
    }

    async close() {
        if (this.managedWorker) {
            await this.managedWorker.shutdown();
        } else if (this.worker) {
            await this.worker.close();
        }
    }

    async process(job) {
        const { runId, directoryPath, batchNumber, totalBatches } = job.data;
        console.log(`[GlobalRelationshipAnalysisWorker] Processing cross-file analysis batch ${batchNumber}/${totalBatches} for run: ${runId} in directory: ${directoryPath}`);

        try {
            // Get all POIs for this run and directory
            const allPois = await this.getAllPoisForDirectory(runId, directoryPath);
            
            if (allPois.length === 0) {
                console.log(`[GlobalRelationshipAnalysisWorker] No POIs found for run ${runId} in directory ${directoryPath}`);
                return;
            }

            console.log(`[GlobalRelationshipAnalysisWorker] Found ${allPois.length} POIs across ${new Set(allPois.map(p => p.file_path)).size} files`);

            // Group POIs by semantic patterns for cross-file analysis
            const semanticGroups = this.groupPoisBySemanticPatterns(allPois);
            
            // Generate cross-file relationships using LLM analysis
            const crossFileRelationships = await this.analyzeCrossFileRelationships(semanticGroups, runId);
            
            if (crossFileRelationships.length > 0) {
                console.log(`[GlobalRelationshipAnalysisWorker] Found ${crossFileRelationships.length} cross-file relationships`);
                
                // Publish findings to outbox for persistence
                const findingPayload = {
                    type: 'global-relationship-analysis-finding',
                    source: 'GlobalRelationshipAnalysisWorker',
                    jobId: job.id,
                    runId: runId,
                    directoryPath: directoryPath,
                    batchNumber: batchNumber,
                    totalBatches: totalBatches,
                    relationships: crossFileRelationships,
                    analysisType: 'cross-file'
                };
                
                const db = this.dbManager.getDb();
                db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)')
                  .run(runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
                  
                console.log(`[GlobalRelationshipAnalysisWorker] Published ${crossFileRelationships.length} cross-file relationships to outbox`);
            } else {
                console.log(`[GlobalRelationshipAnalysisWorker] No cross-file relationships found for directory ${directoryPath}`);
            }
            
        } catch (error) {
            console.error(`[GlobalRelationshipAnalysisWorker] FINAL ERROR processing job ${job.id}:`, error.message);
            const failedQueue = this.queueManager.getQueue('failed-jobs');
            await failedQueue.add('failed-global-relationship-analysis', {
                jobData: job.data,
                error: error.message,
                stack: error.stack,
            });
        }
    }

    /**
     * Get all POIs for a specific run and directory
     */
    async getAllPoisForDirectory(runId, directoryPath) {
        const db = this.dbManager.getDb();
        
        // Get all POIs in files within this directory
        const query = `
            SELECT p.id, p.file_path, p.name, p.type, p.start_line, p.end_line, 
                   p.description, p.is_exported, p.semantic_id, p.llm_output
            FROM pois p
            WHERE p.run_id = ? 
              AND p.file_path LIKE ?
            ORDER BY p.file_path, p.start_line
        `;
        
        return db.prepare(query).all(runId, `${directoryPath}%`);
    }

    /**
     * Group POIs by semantic patterns to identify potential cross-file relationships
     */
    groupPoisBySemanticPatterns(allPois) {
        const groups = {
            exports: [], // Functions, classes, variables that are exported
            imports: [], // Import statements and references
            apiCalls: [], // Function calls that might be cross-file
            classes: [], // Class definitions that might be inherited
            interfaces: [], // Interface definitions
            configs: [], // Configuration variables
            utilities: [], // Utility functions
            constants: [], // Constants that might be shared
            types: [] // Type definitions
        };

        for (const poi of allPois) {
            const poiType = poi.type.toLowerCase();
            const poiName = poi.name.toLowerCase();
            const isExported = poi.is_exported;

            // Categorize based on type and export status
            if (isExported || poiType.includes('export')) {
                groups.exports.push(poi);
            }
            
            if (poiType.includes('import') || poiName.includes('import') || poiName.includes('require')) {
                groups.imports.push(poi);
            }
            
            if (poiType.includes('function') || poiType.includes('method')) {
                if (isExported) {
                    groups.exports.push(poi);
                } else {
                    groups.apiCalls.push(poi);
                }
            }
            
            if (poiType.includes('class')) {
                groups.classes.push(poi);
            }
            
            if (poiType.includes('interface') || poiType.includes('type')) {
                groups.interfaces.push(poi);
                groups.types.push(poi);
            }
            
            if (poiName.includes('config') || poiName.includes('setting') || poiName.includes('option')) {
                groups.configs.push(poi);
            }
            
            if (poiName.includes('util') || poiName.includes('helper') || poiName.includes('tool')) {
                groups.utilities.push(poi);
            }
            
            if (poiType.includes('constant') || poiType.includes('const') || poiName.toUpperCase() === poiName) {
                groups.constants.push(poi);
            }
        }

        return groups;
    }

    /**
     * Analyze cross-file relationships using LLM with semantic groups
     */
    async analyzeCrossFileRelationships(semanticGroups, runId) {
        const crossFileRelationships = [];
        
        // Analyze export-import relationships
        if (semanticGroups.exports.length > 0 && semanticGroups.imports.length > 0) {
            const importExportRelationships = await this.analyzeImportExportRelationships(
                semanticGroups.exports, 
                semanticGroups.imports, 
                runId
            );
            crossFileRelationships.push(...importExportRelationships);
        }
        
        // Analyze API call relationships
        if (semanticGroups.exports.length > 0 && semanticGroups.apiCalls.length > 0) {
            const apiCallRelationships = await this.analyzeApiCallRelationships(
                semanticGroups.exports, 
                semanticGroups.apiCalls, 
                runId
            );
            crossFileRelationships.push(...apiCallRelationships);
        }
        
        // Analyze inheritance relationships
        if (semanticGroups.classes.length > 1) {
            const inheritanceRelationships = await this.analyzeInheritanceRelationships(
                semanticGroups.classes, 
                runId
            );
            crossFileRelationships.push(...inheritanceRelationships);
        }
        
        // Analyze configuration dependencies
        if (semanticGroups.configs.length > 0) {
            const configRelationships = await this.analyzeConfigurationDependencies(
                semanticGroups.configs, 
                semanticGroups.apiCalls.concat(semanticGroups.exports), 
                runId
            );
            crossFileRelationships.push(...configRelationships);
        }

        return crossFileRelationships;
    }

    /**
     * Analyze import-export relationships using LLM
     */
    async analyzeImportExportRelationships(exports, imports, runId) {
        const prompt = this.constructImportExportPrompt(exports, imports);
        
        console.log(`[GlobalRelationshipAnalysisWorker] Analyzing import-export relationships with ${exports.length} exports and ${imports.length} imports`);
        
        const llmResponse = this.executeWithTimeout
            ? await this.executeWithTimeout(
                () => this.llmClient.query(prompt),
                { analysisType: 'import-export', exportsCount: exports.length, importsCount: imports.length }
              )
            : await this.llmClient.query(prompt);

        return this.parseRelationshipResponse(llmResponse, 'IMPORTS');
    }

    /**
     * Analyze API call relationships using LLM
     */
    async analyzeApiCallRelationships(exports, apiCalls, runId) {
        const prompt = this.constructApiCallPrompt(exports, apiCalls);
        
        console.log(`[GlobalRelationshipAnalysisWorker] Analyzing API call relationships with ${exports.length} exports and ${apiCalls.length} API calls`);
        
        const llmResponse = this.executeWithTimeout
            ? await this.executeWithTimeout(
                () => this.llmClient.query(prompt),
                { analysisType: 'api-calls', exportsCount: exports.length, apiCallsCount: apiCalls.length }
              )
            : await this.llmClient.query(prompt);

        return this.parseRelationshipResponse(llmResponse, 'CALLS');
    }

    /**
     * Analyze inheritance relationships using LLM
     */
    async analyzeInheritanceRelationships(classes, runId) {
        const prompt = this.constructInheritancePrompt(classes);
        
        console.log(`[GlobalRelationshipAnalysisWorker] Analyzing inheritance relationships with ${classes.length} classes`);
        
        const llmResponse = this.executeWithTimeout
            ? await this.executeWithTimeout(
                () => this.llmClient.query(prompt),
                { analysisType: 'inheritance', classesCount: classes.length }
              )
            : await this.llmClient.query(prompt);

        return this.parseRelationshipResponse(llmResponse, 'INHERITS');
    }

    /**
     * Analyze configuration dependencies using LLM
     */
    async analyzeConfigurationDependencies(configs, consumers, runId) {
        const prompt = this.constructConfigDependencyPrompt(configs, consumers);
        
        console.log(`[GlobalRelationshipAnalysisWorker] Analyzing configuration dependencies with ${configs.length} configs and ${consumers.length} consumers`);
        
        const llmResponse = this.executeWithTimeout
            ? await this.executeWithTimeout(
                () => this.llmClient.query(prompt),
                { analysisType: 'config-deps', configsCount: configs.length, consumersCount: consumers.length }
              )
            : await this.llmClient.query(prompt);

        return this.parseRelationshipResponse(llmResponse, 'USES_CONFIG');
    }

    /**
     * Construct LLM prompt for import-export analysis
     */
    constructImportExportPrompt(exports, imports) {
        const exportsList = exports.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');
        
        const importsList = imports.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');

        return `
Analyze cross-file import-export relationships between exported functions/classes and import statements.

EXPORTED ITEMS:
${exportsList}

IMPORT STATEMENTS:
${importsList}

Find relationships where import statements are importing the exported items from other files.
Look for:
1. Direct imports (import { functionName } from './file')
2. Namespace imports (import * as module from './file')
3. Default imports (import defaultExport from './file')
4. CommonJS requires (const { item } = require('./file'))

Format the output as a JSON object with a single key "relationships". Each relationship object must have:
"id", "from", "to", "type", "reason", "confidence", "cross_file_evidence"

The "from" should be the import statement's semantic_id
The "to" should be the exported item's semantic_id
The "type" should be "IMPORTS"
The "cross_file_evidence" should describe the cross-file nature of the relationship

Example:
{
  "relationships": [
    {
      "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "from": "import_stmt_authenticate",
      "to": "auth_func_authenticate",
      "type": "IMPORTS",
      "reason": "Import statement imports authenticate function from auth.js",
      "confidence": 0.95,
      "cross_file_evidence": "Import in user.js references exported function from auth.js"
    }
  ]
}

If no relationships are found, return an empty array.
        `;
    }

    /**
     * Construct LLM prompt for API call analysis
     */
    constructApiCallPrompt(exports, apiCalls) {
        const exportsList = exports.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');
        
        const apiCallsList = apiCalls.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');

        return `
Analyze cross-file API call relationships between exported functions/methods and function calls in different files.

EXPORTED FUNCTIONS/METHODS:
${exportsList}

FUNCTION CALLS:
${apiCallsList}

Find relationships where function calls in one file are calling exported functions from other files.
Look for:
1. Direct function calls to imported functions
2. Method calls on imported objects/classes
3. Callback function usage
4. Event handler assignments

Format the output as a JSON object with a single key "relationships". Each relationship object must have:
"id", "from", "to", "type", "reason", "confidence", "cross_file_evidence"

The "from" should be the calling function's semantic_id
The "to" should be the called exported function's semantic_id
The "type" should be "CALLS"
The "cross_file_evidence" should describe the cross-file nature of the call

Example:
{
  "relationships": [
    {
      "id": "b2c3d4e5-f6g7-8901-2345-678901bcdef0",
      "from": "user_func_login",
      "to": "auth_func_authenticate",
      "type": "CALLS",
      "reason": "login function calls authenticate function from auth module",
      "confidence": 0.90,
      "cross_file_evidence": "Function call in user.js invokes exported function from auth.js"
    }
  ]
}

If no relationships are found, return an empty array.
        `;
    }

    /**
     * Construct LLM prompt for inheritance analysis
     */
    constructInheritancePrompt(classes) {
        const classesList = classes.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');

        return `
Analyze inheritance relationships between classes across different files.

CLASSES:
${classesList}

Find relationships where classes inherit from other classes in different files.
Look for:
1. Class extends relationships (class Child extends Parent)
2. Interface implementations
3. Mixin usage
4. Prototype inheritance

Format the output as a JSON object with a single key "relationships". Each relationship object must have:
"id", "from", "to", "type", "reason", "confidence", "cross_file_evidence"

The "from" should be the child class's semantic_id
The "to" should be the parent class's semantic_id
The "type" should be "INHERITS"
The "cross_file_evidence" should describe the cross-file inheritance

Example:
{
  "relationships": [
    {
      "id": "c3d4e5f6-g7h8-9012-3456-789012cdef01",
      "from": "user_class_AdminUser",
      "to": "base_class_User",
      "type": "INHERITS",
      "reason": "AdminUser class extends User class from base module",
      "confidence": 0.95,
      "cross_file_evidence": "AdminUser in admin.js inherits from User class in base.js"
    }
  ]
}

If no relationships are found, return an empty array.
        `;
    }

    /**
     * Construct LLM prompt for configuration dependency analysis
     */
    constructConfigDependencyPrompt(configs, consumers) {
        const configsList = configs.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');
        
        const consumersList = consumers.map(p => 
            `- ${p.type}: ${p.name} (file: ${p.file_path}, semantic_id: ${p.semantic_id || p.id})`
        ).join('\n');

        return `
Analyze configuration dependency relationships where functions/classes use configuration values from other files.

CONFIGURATION ITEMS:
${configsList}

POTENTIAL CONSUMERS:
${consumersList}

Find relationships where functions/classes reference configuration values from other files.
Look for:
1. Import and usage of config variables
2. Environment variable dependencies
3. Settings object references
4. Configuration parameter usage

Format the output as a JSON object with a single key "relationships". Each relationship object must have:
"id", "from", "to", "type", "reason", "confidence", "cross_file_evidence"

The "from" should be the consumer's semantic_id
The "to" should be the configuration item's semantic_id
The "type" should be "USES_CONFIG"
The "cross_file_evidence" should describe the cross-file configuration usage

Example:
{
  "relationships": [
    {
      "id": "d4e5f6g7-h8i9-0123-4567-890123def012",
      "from": "db_func_connect",
      "to": "config_var_database_url",
      "type": "USES_CONFIG",
      "reason": "Database connection function uses database URL from config",
      "confidence": 0.85,
      "cross_file_evidence": "connect function in db.js uses DATABASE_URL from config.js"
    }
  ]
}

If no relationships are found, return an empty array.
        `;
    }

    /**
     * Parse LLM response for relationships
     */
    parseRelationshipResponse(response, defaultType) {
        try {
            const sanitized = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(sanitized);
            const relationships = parsed.relationships || [];
            
            const validatedRelationships = [];
            
            for (const rel of relationships) {
                try {
                    // Validate required fields
                    if (!rel.from || !rel.to) {
                        console.warn('[GlobalRelationshipAnalysisWorker] Invalid relationship missing from/to fields, skipping:', rel);
                        continue;
                    }
                    
                    if (!rel.type || typeof rel.type !== 'string') {
                        console.warn('[GlobalRelationshipAnalysisWorker] Invalid relationship missing type, skipping:', rel);
                        continue;
                    }

                    // Validate cross-file nature
                    if (!rel.cross_file_evidence || typeof rel.cross_file_evidence !== 'string') {
                        console.warn('[GlobalRelationshipAnalysisWorker] Missing cross-file evidence, skipping:', rel);
                        continue;
                    }

                    let confidence = rel.confidence;
                    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                        confidence = 0.8;
                        if (rel.confidence !== undefined) {
                            console.warn(`[GlobalRelationshipAnalysisWorker] Invalid confidence ${rel.confidence} for relationship ${rel.from} -> ${rel.to}, using default 0.8`);
                        }
                    }

                    let reason = rel.reason;
                    if (!reason || typeof reason !== 'string') {
                        reason = `${rel.type} cross-file relationship detected`;
                        console.warn(`[GlobalRelationshipAnalysisWorker] Missing reason for relationship ${rel.from} -> ${rel.to}, using default`);
                    }

                    // Create validated relationship object
                    validatedRelationships.push({
                        id: rel.id || uuidv4(),
                        from: rel.from,
                        to: rel.to,
                        type: rel.type.toUpperCase(),
                        confidence: confidence,
                        reason: reason.trim(),
                        evidence: rel.cross_file_evidence.trim(),
                        cross_file: true // Mark as cross-file relationship
                    });
                } catch (error) {
                    console.error('[GlobalRelationshipAnalysisWorker] Error validating relationship:', error, rel);
                }
            }
            
            return validatedRelationships;
        } catch (error) {
            console.error(`Failed to parse LLM response for cross-file relationship analysis:`, error);
            console.error('Original response:', response);
            return [];
        }
    }
}

module.exports = GlobalRelationshipAnalysisWorker;