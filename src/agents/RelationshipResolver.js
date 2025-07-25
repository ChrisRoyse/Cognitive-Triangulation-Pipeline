const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDeepseekClient } = require('../utils/deepseekClient');
const { getDb } = require('../utils/sqliteDb');

class RelationshipResolver {
    constructor(db, apiKey) {
        this.db = db;
        this.apiKey = apiKey;
        this.llmClient = getDeepseekClient();
    }

    async _getDirectories() {
        const rows = this.db.prepare(`
            SELECT DISTINCT f.file_path
            FROM files f
            JOIN pois p ON f.id = p.file_id
        `).all();

        const dirs = new Set(rows.map(r => path.dirname(r.file_path)));
        return Array.from(dirs);
    }

    async _loadPoisForDirectory(directory) {
        // This query is illustrative. You might need to adjust it based on your exact schema and needs.
        // It assumes that paths are stored in a way that allows for efficient directory-based filtering.
        // For example, using LIKE with a wildcard. Ensure your 'files.path' column is indexed.
        const pois = this.db.prepare(`
            SELECT p.*, f.file_path as path
            FROM pois p
            JOIN files f ON p.file_id = f.id
            WHERE f.file_path LIKE ?
        `).all(`${directory}${path.sep}%`);
        return pois;
    }

    async _runIntraFilePass(poisInFile) {
        if (poisInFile.length < 2) {
            return [];
        }

        const context = poisInFile.map(p => `ID: ${p.id}, Type: ${p.type}, Name: ${p.name}, Content: ${p.description}`).join('\n');
        const prompt = `Analyze the following points of interest (POIs) from a single file and identify any relationships between them. Context:\n${context}\n\nRespond with a JSON object containing a 'relationships' array.`;

        const response = await this._queryLlmWithRetry(prompt);
        return response.relationships || [];
    }

    async _runIntraDirectoryPass(directory, poisByFile) {
        const allPoisInDir = Array.from(poisByFile.values()).flat();
        const exports = allPoisInDir.filter(p => p.is_exported);

        const context = `Directory: ${directory}\n\n` +
            Array.from(poisByFile.entries())
                .map(([filePath, pois]) => `File: ${filePath}\nPOIs:\n${pois.map(p => `  ID: ${p.id}, Type: ${p.type}, Name: ${p.name}, Content: "${p.description}"`).join('\n')}`)
                .join('\n\n');

        const prompt = `Analyze the following POIs from the directory "${directory}" and identify relationships between them. Focus on imports and calls between files.\n\n${context}\n\nRespond with a JSON object containing a 'relationships' array.`;

        const response = await this._queryLlmWithRetry(prompt);
        
        return {
            relationships: response.relationships || [],
            exports: exports
        };
    }

    async _runDeterministicPass() {
        console.log('Running deterministic relationship detection...');
        const relationships = [];
        
        // Get all POIs with file information
        const allPois = this.db.prepare(`
            SELECT p.*, f.file_path
            FROM pois p
            JOIN files f ON p.file_id = f.id
            ORDER BY f.file_path, p.start_line
        `).all();
        
        // Group POIs by file
        const poisByFile = new Map();
        for (const poi of allPois) {
            if (!poisByFile.has(poi.file_id)) {
                poisByFile.set(poi.file_id, []);
            }
            poisByFile.get(poi.file_id).push(poi);
        }
        
        // Generate deterministic relationships
        for (const [fileId, pois] of poisByFile) {
            // 1. CONTAINS relationships: Files contain classes, classes contain methods
            const classes = pois.filter(p => p.type === 'ClassDefinition');
            const methods = pois.filter(p => p.type === 'Method');
            const functions = pois.filter(p => p.type === 'FunctionDefinition');
            const variables = pois.filter(p => p.type === 'VariableDeclaration' || p.type === 'ConstantDeclaration');
            
            // Skip file-level DEFINES relationships since files aren't POIs
            // Focus on POI-to-POI relationships only
            
            // Classes CONTAIN methods (methods that appear after class definition)
            for (const cls of classes) {
                for (const method of methods) {
                    if (method.start_line > cls.start_line) {
                        // Find the next class after this method to determine containment
                        const nextClass = classes.find(c => c.start_line > method.start_line);
                        if (!nextClass || nextClass.start_line > method.start_line) {
                            relationships.push({
                                source_poi_id: cls.id,
                                target_poi_id: method.id,
                                type: 'CONTAINS',
                                reason: `Class ${cls.name} contains method ${method.name}`
                            });
                        }
                    }
                }
            }
            
            // 2. USES relationships: Methods use variables (simple name matching)
            for (const method of methods) {
                for (const variable of variables) {
                    // If variable is defined before method and has similar context
                    if (variable.start_line < method.start_line) {
                        relationships.push({
                            source_poi_id: method.id,
                            target_poi_id: variable.id,
                            type: 'USES',
                            reason: `Method ${method.name} potentially uses variable ${variable.name}`
                        });
                    }
                }
            }
            
            // 3. REFERENCES relationships: Cross-references within file
            for (let i = 0; i < pois.length; i++) {
                for (let j = i + 1; j < pois.length; j++) {
                    const poi1 = pois[i];
                    const poi2 = pois[j];
                    
                    // Create bidirectional references for related POIs
                    if (poi1.type !== poi2.type) {
                        relationships.push({
                            source_poi_id: poi1.id,
                            target_poi_id: poi2.id,
                            type: 'REFERENCES',
                            reason: `${poi1.type} ${poi1.name} references ${poi2.type} ${poi2.name} in same file`
                        });
                    }
                }
            }
        }
        
        // 4. Cross-file relationships based on naming patterns
        const exportedPois = allPois.filter(p => p.is_exported);
        for (const exported of exportedPois) {
            for (const poi of allPois) {
                if (poi.file_id !== exported.file_id && poi.name.includes(exported.name)) {
                    relationships.push({
                        source_poi_id: poi.id,
                        target_poi_id: exported.id,
                        type: 'IMPORTS',
                        reason: `${poi.name} likely imports ${exported.name} from ${exported.file_path}`
                    });
                }
            }
        }
        
        console.log(`Generated ${relationships.length} deterministic relationships`);
        return relationships;
    }

    async _runGlobalPass() {
        const allExports = this.db.prepare(`
            SELECT p.*, f.file_path as path
            FROM pois p
            JOIN files f ON p.file_id = f.id
            WHERE p.is_exported = 1
        `).all();

        if (allExports.length < 2) {
            return [];
        }

        const exportsByDir = new Map();
        for (const poi of allExports) {
            const dir = path.dirname(poi.path);
            if (!exportsByDir.has(dir)) {
                exportsByDir.set(dir, []);
            }
            exportsByDir.get(dir).push(poi);
        }

        const context = 'Analyze the following exported POIs from all directories and identify any global relationships (e.g., a route in one directory using a service from another).\n\n' +
            Array.from(exportsByDir.entries())
                .map(([dir, exports]) => `Directory: ${dir}\nExports:\n${exports.map(p => `  ID: ${p.id}, Type: ${p.type}, Name: ${p.name}, Content: "${p.description}"`).join('\n')}`)
                .join('\n\n');

        const prompt = `${context}\n\nRespond with a JSON object containing a 'relationships' array.`;

        const response = await this._queryLlmWithRetry(prompt);
        return response.relationships || [];
    }
    
    async run() {
        console.log('Starting relationship resolution...');
        const directories = await this._getDirectories();
        let totalRelationshipsFound = 0;
        const pass0Results = { relationshipsFound: 0 };
        const pass1Results = { relationshipsFound: 0 };
        const pass2Results = { relationshipsFound: 0 };
        const pass3Results = { relationshipsFound: 0 };

        // Pass 0: Deterministic relationship detection
        console.log('Running deterministic relationship detection...');
        const deterministicRelationships = await this._runDeterministicPass();
        if (deterministicRelationships.length > 0) {
            this.persistRelationships(deterministicRelationships);
            pass0Results.relationshipsFound = deterministicRelationships.length;
        }
        totalRelationshipsFound += pass0Results.relationshipsFound;

        const concurrencyLimit = 50;
        const promises = [];
        
        // Simple semaphore implementation
        let activePromises = 0;
        let resolveQueue = [];

        const acquire = () => {
            if (activePromises < concurrencyLimit) {
                activePromises++;
                return Promise.resolve();
            }
            return new Promise(resolve => {
                resolveQueue.push(resolve);
            });
        };

        const release = () => {
            activePromises--;
            if (resolveQueue.length > 0) {
                resolveQueue.shift()();
            }
        };

        for (const dir of directories) {
            const promise = (async () => {
                await acquire();
                try {
                    console.log(`Processing directory: ${dir}`);
                    const poisInDir = await this._loadPoisForDirectory(dir);

                    // Pass 1: Intra-file analysis
                    const poisByFile = new Map();
                    for (const poi of poisInDir) {
                        if (!poisByFile.has(poi.file_id)) {
                            poisByFile.set(poi.file_id, []);
                        }
                        poisByFile.get(poi.file_id).push(poi);
                    }
                    for (const poisInFile of poisByFile.values()) {
                        const relationships = await this._runIntraFilePass(poisInFile);
                        if (relationships.length > 0) {
                            this.persistRelationships(relationships);
                            pass1Results.relationshipsFound += relationships.length;
                        }
                    }

                    // Pass 2: Intra-directory analysis
                    const poisByFilePath = new Map();
                    for (const poi of poisInDir) {
                        if (!poisByFilePath.has(poi.path)) {
                            poisByFilePath.set(poi.path, []);
                        }
                        poisByFilePath.get(poi.path).push(poi);
                    }
                    const { relationships } = await this._runIntraDirectoryPass(dir, poisByFilePath);
                    if (relationships.length > 0) {
                        this.persistRelationships(relationships);
                        pass2Results.relationshipsFound += relationships.length;
                    }
                } finally {
                    release();
                }
            })();
            promises.push(promise);
        }

        await Promise.all(promises);
        
        totalRelationshipsFound += pass1Results.relationshipsFound + pass2Results.relationshipsFound;

        // Pass 3: Global pass
        console.log('Running global relationship pass...');
        const globalRelationships = await this._runGlobalPass();
        if (globalRelationships.length > 0) {
            this.persistRelationships(globalRelationships);
            pass3Results.relationshipsFound = globalRelationships.length;
        }
        totalRelationshipsFound += pass3Results.relationshipsFound;

        const summary = {
            totalRelationshipsFound,
            pass0: pass0Results,
            pass1: pass1Results,
            pass2: pass2Results,
            pass3: pass3Results,
        };
        console.log('Relationship resolution finished.', summary);
        return summary;
    }

    async _queryLlmWithRetry(prompt, schema = { type: 'object' }, retries = 3) {
        let lastError = null;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await this.llmClient.createChatCompletion({
                    model: 'deepseek-chat',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'You are a code analysis expert. Analyze the provided code and identify relationships between components. Always respond with valid JSON in the format: {"relationships": [{"source_poi_id": "id1", "target_poi_id": "id2", "type": "CALLS|IMPORTS|EXTENDS|IMPLEMENTS", "reason": "explanation"}]}'
                        },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: 'json_object' },
                });
                const content = JSON.parse(response.choices[0].message.content);
                // Basic validation
                if (content && typeof content === 'object' && Array.isArray(content.relationships)) {
                    return content;
                }
                throw new Error('Invalid JSON structure in LLM response');
            } catch (error) {
                lastError = error;
                console.warn(`LLM query attempt ${i + 1} failed. Retrying...`, error.message);
            }
        }
        console.error('LLM query failed after all retries.', lastError);
        return { relationships: [] }; // Return empty on failure
    }

    persistRelationships(relationships) {
        const insert = this.db.prepare('INSERT INTO relationships (id, source_poi_id, target_poi_id, type, confidence, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
        
        const validatedRelationships = [];
        
        for (const rel of relationships) {
            try {
                // Validate required fields
                if (!rel.source_poi_id || !rel.target_poi_id) {
                    console.warn(`[RelationshipResolver] Invalid relationship missing POI IDs, skipping:`, rel);
                    continue;
                }
                
                if (!rel.type || typeof rel.type !== 'string') {
                    console.warn(`[RelationshipResolver] Invalid relationship missing type, skipping:`, rel);
                    continue;
                }

                // Validate and provide defaults for new required fields
                let confidence = rel.confidence;
                if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                    confidence = 0.8; // Default confidence
                    if (rel.confidence !== undefined) {
                        console.warn(`[RelationshipResolver] Invalid confidence ${rel.confidence} for relationship ${rel.source_poi_id} -> ${rel.target_poi_id}, using default 0.8`);
                    }
                }

                let reason = rel.reason;
                if (!reason || typeof reason !== 'string') {
                    reason = `${rel.type} relationship detected`; // Default reason
                    console.warn(`[RelationshipResolver] Missing reason for relationship ${rel.source_poi_id} -> ${rel.target_poi_id}, using default`);
                }

                validatedRelationships.push({
                    id: uuidv4(),
                    source_poi_id: rel.source_poi_id,
                    target_poi_id: rel.target_poi_id,
                    type: rel.type.toUpperCase(),
                    confidence: confidence,
                    reason: reason.trim(),
                    status: 'PENDING'
                });
            } catch (error) {
                console.error(`[RelationshipResolver] Error validating relationship:`, error, rel);
            }
        }

        if (validatedRelationships.length === 0) {
            console.warn(`[RelationshipResolver] No valid relationships to persist`);
            return;
        }

        this.db.transaction((rels) => {
            for (const rel of rels) {
                insert.run(
                    rel.id,
                    rel.source_poi_id, 
                    rel.target_poi_id, 
                    rel.type, 
                    rel.confidence,
                    rel.reason,
                    rel.status
                );
            }
        })(validatedRelationships);

        console.log(`[RelationshipResolver] Persisted ${validatedRelationships.length} validated relationships`);
    }
}

module.exports = RelationshipResolver;