const SemanticIdentityService = require('../../src/services/SemanticIdentityService');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');

describe('Semantic Identity System Integration', () => {
    let semanticService;
    let dbManager;
    let db;

    beforeAll(async () => {
        // Set up test database
        dbManager = new DatabaseManager(':memory:');
        await dbManager.initialize();
        db = dbManager.getDb();
        
        semanticService = new SemanticIdentityService();
    });

    afterAll(async () => {
        if (dbManager) {
            await dbManager.close();
        }
    });

    beforeEach(() => {
        // Clear all tables before each test
        db.exec('DELETE FROM pois');
        db.exec('DELETE FROM relationships');
        db.exec('DELETE FROM files');
        db.exec('DELETE FROM outbox');
        
        // Clear semantic service cache
        semanticService.clearCache();
    });

    describe('FileAnalysisWorker with Semantic IDs', () => {
        it('should generate semantic IDs for POIs during parsing', () => {
            const worker = new FileAnalysisWorker(
                null, // queueManager
                dbManager,
                null, // cacheClient
                null, // llmClient
                null, // workerPoolManager
                { processOnly: true }
            );

            const mockLLMResponse = JSON.stringify({
                pois: [
                    {
                        name: 'validateCredentials',
                        type: 'FunctionDefinition',
                        start_line: 10,
                        end_line: 20,
                        description: 'Validates user credentials',
                        is_exported: true
                    },
                    {
                        name: 'DATABASE_URL',
                        type: 'VariableDeclaration',
                        start_line: 5,
                        end_line: 5,
                        description: 'Database connection URL',
                        is_exported: false
                    }
                ]
            });

            const filePath = '/src/auth.js';
            const pois = worker.parseResponse(mockLLMResponse, filePath);

            expect(pois).toHaveLength(2);
            
            // Check semantic IDs are generated
            expect(pois[0].semantic_id).toBe('auth_func_validatecredentials');
            expect(pois[1].semantic_id).toBe('auth_var_database_url');
            
            // Check original data is preserved
            expect(pois[0].name).toBe('validateCredentials');
            expect(pois[0].type).toBe('functiondefinition');
            expect(pois[0].description).toBe('Validates user credentials');
            expect(pois[0].is_exported).toBe(true);
        });

        it('should handle POI names with special characters', () => {
            const worker = new FileAnalysisWorker(
                null, null, null, null, null,
                { processOnly: true }
            );

            const mockLLMResponse = JSON.stringify({
                pois: [
                    {
                        name: '__init__',
                        type: 'FunctionDefinition',
                        start_line: 1,
                        end_line: 5,
                        description: 'Constructor method',
                        is_exported: false
                    },
                    {
                        name: 'getUserProfile$',
                        type: 'FunctionDefinition',
                        start_line: 10,
                        end_line: 15,
                        description: 'Gets user profile',
                        is_exported: true
                    }
                ]
            });

            const filePath = '/src/user-manager.js';
            const pois = worker.parseResponse(mockLLMResponse, filePath);

            expect(pois).toHaveLength(2);
            expect(pois[0].semantic_id).toBe('usermanag_func_ninit');
            expect(pois[1].semantic_id).toBe('usermanag_func_getuserprofile');
        });
    });

    describe('Database Integration', () => {
        it('should store semantic IDs in database correctly', async () => {
            // Run migration to add semantic_id column
            const Migration = require('../../migrations/003_add_semantic_id_column');
            const migration = new Migration();
            await migration.up(db);

            // Insert test POI with semantic ID
            const stmt = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // First create a file record
            const fileStmt = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)');
            const fileResult = fileStmt.run('/src/auth.js', 'processed');
            const fileId = fileResult.lastInsertRowid;

            // Insert POI with semantic ID
            const poiResult = stmt.run(
                fileId,
                '/src/auth.js',
                'validateCredentials',
                'functiondefinition',
                10,
                20,
                'Validates user credentials',
                1,
                'auth_func_validatecredentials',
                'test-run-id'
            );

            expect(poiResult.changes).toBe(1);

            // Query back the POI
            const savedPoi = db.prepare('SELECT * FROM pois WHERE id = ?').get(poiResult.lastInsertRowid);
            expect(savedPoi.semantic_id).toBe('auth_func_validatecredentials');
            expect(savedPoi.name).toBe('validateCredentials');
        });

        it('should query POIs by semantic ID', async () => {
            // Run migration
            const Migration = require('../../migrations/003_add_semantic_id_column');
            const migration = new Migration();
            await migration.up(db);

            // Insert test data
            const fileStmt = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)');
            const fileResult = fileStmt.run('/src/auth.js', 'processed');
            const fileId = fileResult.lastInsertRowid;

            const poiStmt = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            poiStmt.run(fileId, '/src/auth.js', 'validateCredentials', 'functiondefinition', 10, 20, 'auth_func_validatecredentials', 'test-run');
            poiStmt.run(fileId, '/src/auth.js', 'hashPassword', 'functiondefinition', 25, 35, 'auth_func_hashpassword', 'test-run');

            // Query by semantic ID
            const poi = db.prepare('SELECT * FROM pois WHERE semantic_id = ?').get('auth_func_validatecredentials');
            expect(poi).toBeDefined();
            expect(poi.name).toBe('validateCredentials');

            // Query multiple POIs with semantic ID pattern
            const authFunctions = db.prepare('SELECT * FROM pois WHERE semantic_id LIKE ?').all('auth_func_%');
            expect(authFunctions).toHaveLength(2);
        });
    });

    describe('Relationship Resolution with Semantic IDs', () => {
        it('should demonstrate semantic ID usage in relationship prompts', () => {
            const filePath = '/src/auth.js';
            const primaryPoi = {
                id: 1,
                name: 'validateUser',
                type: 'functiondefinition',
                semantic_id: 'auth_func_validateuser'
            };

            const contextualPois = [
                {
                    id: 2,
                    name: 'hashPassword',
                    type: 'functiondefinition',
                    semantic_id: 'auth_func_hashpassword'
                },
                {
                    id: 3,
                    name: 'DATABASE_URL',
                    type: 'variabledeclaration',
                    semantic_id: 'auth_var_database_url'
                }
            ];

            const RelationshipResolutionWorker = require('../../src/workers/relationshipResolutionWorker');
            const worker = new RelationshipResolutionWorker(null, null, null, null, { processOnly: true });

            const prompt = worker.constructPrompt(filePath, primaryPoi, contextualPois);

            // Verify semantic IDs are used in prompt instead of database IDs
            expect(prompt).toContain('semantic_id: auth_func_validateuser');
            expect(prompt).toContain('semantic_id: auth_func_hashpassword');
            expect(prompt).toContain('semantic_id: auth_var_database_url');
            expect(prompt).toContain('from": "auth_func_validateuser"');
            
            // Verify database IDs are NOT in the prompt
            expect(prompt).not.toContain('id: 1');
            expect(prompt).not.toContain('id: 2');
            expect(prompt).not.toContain('id: 3');
        });

        it('should parse relationships with semantic IDs', () => {
            const RelationshipResolutionWorker = require('../../src/workers/relationshipResolutionWorker');
            const worker = new RelationshipResolutionWorker(null, null, null, null, { processOnly: true });

            const mockLLMResponse = JSON.stringify({
                relationships: [
                    {
                        id: 'rel-123',
                        from: 'auth_func_validateuser',
                        to: 'auth_func_hashpassword',
                        type: 'CALLS',
                        reason: 'validateUser calls hashPassword to secure credentials',
                        confidence: 0.9
                    },
                    {
                        id: 'rel-456',
                        from: 'auth_func_validateuser',
                        to: 'auth_var_database_url',
                        type: 'USES',
                        reason: 'validateUser uses DATABASE_URL for connection',
                        confidence: 0.8
                    }
                ]
            });

            const relationships = worker.parseResponse(mockLLMResponse);

            expect(relationships).toHaveLength(2);
            expect(relationships[0].from).toBe('auth_func_validateuser');
            expect(relationships[0].to).toBe('auth_func_hashpassword');
            expect(relationships[1].from).toBe('auth_func_validateuser');
            expect(relationships[1].to).toBe('auth_var_database_url');
        });
    });

    describe('Cross-file Cognitive Triangulation', () => {
        it('should enable reasoning across files with semantic IDs', () => {
            // Simulate POIs from different files with meaningful semantic IDs
            const authPois = semanticService.generateBatchSemanticIds('/src/auth.js', [
                { name: 'validateCredentials', type: 'FunctionDefinition' },
                { name: 'AuthManager', type: 'ClassDefinition' }
            ]);

            const userPois = semanticService.generateBatchSemanticIds('/src/user.js', [
                { name: 'UserManager', type: 'ClassDefinition' },
                { name: 'createUser', type: 'FunctionDefinition' }
            ]);

            const configPois = semanticService.generateBatchSemanticIds('/src/config.js', [
                { name: 'DATABASE_URL', type: 'VariableDeclaration' },
                { name: 'API_KEY', type: 'VariableDeclaration' }
            ]);

            // Verify semantic IDs enable cross-file understanding
            expect(authPois[0].semantic_id).toBe('auth_func_validatecredentials');
            expect(authPois[1].semantic_id).toBe('auth_class_authmanager');
            expect(userPois[0].semantic_id).toBe('user_class_usermanager');
            expect(userPois[1].semantic_id).toBe('user_func_createuser');
            expect(configPois[0].semantic_id).toBe('cfg_var_database_url');
            expect(configPois[1].semantic_id).toBe('cfg_var_api_key');

            // Now LLM can reason about relationships like:
            // "auth_func_validatecredentials" USES "cfg_var_database_url"
            // "user_func_createuser" CALLS "auth_func_validatecredentials"
            // This demonstrates meaningful cognitive triangulation across files
        });
    });
});