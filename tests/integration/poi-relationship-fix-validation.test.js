/**
 * POI Relationship Fix Validation Integration Tests
 * 
 * These tests validate the TransactionalOutboxPublisher POI ID resolution fix:
 * 1. POI names are correctly resolved to database IDs
 * 2. Relationships use actual POI IDs, not names
 * 3. Outbox events are processed correctly with ID resolution
 * 4. Invalid POI references are handled gracefully
 * 5. Batch processing with ID resolution works correctly
 * 6. Cross-file relationship ID resolution
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');

describe('POI Relationship Fix Validation Integration Tests', () => {
    let config;
    let dbManager;
    let queueManager;
    let outboxPublisher;
    let testRunId;
    let testDbPath;
    let testDataDir;

    beforeAll(async () => {
        config = new PipelineConfig({ environment: 'test' });
        testRunId = uuidv4();
        
        testDataDir = path.join(__dirname, `poi-fix-test-${Date.now()}`);
        await fs.ensureDir(testDataDir);
        
        testDbPath = path.join(testDataDir, 'poi-fix-test.db');
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();

        queueManager = getQueueManagerInstance();
        await queueManager.connect();

        outboxPublisher = new TransactionalOutboxPublisher(dbManager, queueManager);

        console.log(`✅ POI relationship fix test environment initialized with runId: ${testRunId}`);
    }, 30000);

    afterAll(async () => {
        if (outboxPublisher) {
            await outboxPublisher.stop();
        }
        if (queueManager) {
            await queueManager.clearAllQueues();
            await queueManager.closeConnections();
        }
        if (dbManager) {
            await dbManager.close();
        }
        if (fs.existsSync(testDataDir)) {
            await fs.remove(testDataDir);
        }
        console.log('✅ POI relationship fix test cleanup completed');
    });

    beforeEach(async () => {
        await queueManager.clearAllQueues();
        
        const db = dbManager.getDb();
        const tables = ['pois', 'relationships', 'outbox', 'files'];
        for (const table of tables) {
            try {
                db.prepare(`DELETE FROM ${table}`).run();
            } catch (error) {
                console.warn(`Could not clear table ${table}:`, error.message);
            }
        }
    });

    describe('1. POI Name to ID Resolution', () => {
        test('should resolve POI names to correct database IDs', async () => {
            const db = dbManager.getDb();
            
            // Insert test file
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('resolution-test.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert POIs with known names
            const testPois = [
                { name: 'createUser', type: 'function', semanticId: 'create_user_func' },
                { name: 'validateEmail', type: 'function', semanticId: 'validate_email_func' },
                { name: 'UserClass', type: 'class', semanticId: 'user_class' },
                { name: 'API_KEY', type: 'constant', semanticId: 'api_key_const' }
            ];

            const poiIdMap = {};
            for (const poi of testPois) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'resolution-test.js', poi.name, poi.type, 1, 5,
                    `${poi.type} ${poi.name}`, false, poi.semanticId, testRunId
                ).lastInsertRowid;
                
                poiIdMap[poi.name] = poiId;
            }
            
            // Create outbox event with POI names (not IDs)
            const relationshipPayload = {
                type: 'relationship-creation',
                source: 'FileAnalysisWorker',
                runId: testRunId,
                relationships: [
                    {
                        id: 'rel-1',
                        from: 'createUser',      // POI name
                        to: 'validateEmail',     // POI name
                        type: 'CALLS',
                        reason: 'createUser calls validateEmail',
                        confidence: 0.9
                    },
                    {
                        id: 'rel-2',
                        from: 'UserClass',       // POI name
                        to: 'API_KEY',          // POI name
                        type: 'USES',
                        reason: 'UserClass uses API_KEY constant',
                        confidence: 0.8
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(relationshipPayload), 'PENDING', testRunId);
            
            // Process outbox events (should resolve names to IDs)
            await outboxPublisher.pollAndPublish();
            
            // Verify relationships were created with correct POI IDs
            const relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            
            expect(relationships.length).toBe(2);
            
            // Check first relationship
            const callsRel = relationships.find(r => r.type === 'CALLS');
            expect(callsRel).toBeDefined();
            expect(callsRel.source_poi_id).toBe(poiIdMap['createUser']);
            expect(callsRel.target_poi_id).toBe(poiIdMap['validateEmail']);
            expect(callsRel.confidence).toBe(0.9);
            
            // Check second relationship
            const usesRel = relationships.find(r => r.type === 'USES');
            expect(usesRel).toBeDefined();
            expect(usesRel.source_poi_id).toBe(poiIdMap['UserClass']);
            expect(usesRel.target_poi_id).toBe(poiIdMap['API_KEY']);
            expect(usesRel.confidence).toBe(0.8);
            
            // Verify outbox event was processed
            const processedEvents = db.prepare('SELECT * FROM outbox WHERE status = ? AND run_id = ?')
                .all('PROCESSED', testRunId);
            expect(processedEvents.length).toBe(1);
            
            console.log('Created relationships:', relationships.map(r => ({
                type: r.type,
                source_poi_id: r.source_poi_id,
                target_poi_id: r.target_poi_id,
                confidence: r.confidence
            })));
            console.log('✅ POI name to ID resolution working correctly');
        });

        test('should handle POI name resolution with semantic IDs', async () => {
            const db = dbManager.getDb();
            
            // Insert test file
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('semantic-resolution.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert POIs using semantic IDs for resolution
            const testPois = [
                { name: 'getUserById', semanticId: 'get_user_by_id_func' },
                { name: 'updateUserProfile', semanticId: 'update_user_profile_func' },
                { name: 'deleteUser', semanticId: 'delete_user_func' }
            ];

            const poiIdMap = {};
            for (const poi of testPois) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'semantic-resolution.js', poi.name, 'function', 1, 5,
                    `Function ${poi.name}`, true, poi.semanticId, testRunId
                ).lastInsertRowid;
                
                poiIdMap[poi.semanticId] = poiId;
            }
            
            // Create outbox event using both names and semantic IDs
            const relationshipPayload = {
                type: 'relationship-creation',
                source: 'RelationshipResolver',
                runId: testRunId,
                relationships: [
                    {
                        id: 'semantic-rel-1',
                        from: 'get_user_by_id_func',        // Semantic ID
                        to: 'update_user_profile_func',     // Semantic ID
                        type: 'RELATED_TO',
                        reason: 'Both operate on user data',
                        confidence: 0.7
                    },
                    {
                        id: 'mixed-rel-1',
                        from: 'getUserById',                // POI name
                        to: 'delete_user_func',            // Semantic ID
                        type: 'CALLS',
                        reason: 'getUserById may call delete functionality',
                        confidence: 0.6
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(relationshipPayload), 'PENDING', testRunId);
            
            // Process outbox events
            await outboxPublisher.pollAndPublish();
            
            // Verify relationships were created
            const relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            
            expect(relationships.length).toBe(2);
            
            // Verify semantic ID resolution
            const semanticRel = relationships.find(r => r.type === 'RELATED_TO');
            expect(semanticRel).toBeDefined();
            expect(semanticRel.source_poi_id).toBe(poiIdMap['get_user_by_id_func']);
            expect(semanticRel.target_poi_id).toBe(poiIdMap['update_user_profile_func']);
            
            // Verify mixed resolution (name -> semantic ID)
            const mixedRel = relationships.find(r => r.type === 'CALLS');
            expect(mixedRel).toBeDefined();
            expect(mixedRel.source_poi_id).toBe(poiIdMap['get_user_by_id_func']); // Resolved from name
            expect(mixedRel.target_poi_id).toBe(poiIdMap['delete_user_func']);    // Already semantic ID
            
            console.log('✅ Semantic ID resolution working correctly');
        });
    });

    describe('2. Invalid Reference Handling', () => {
        test('should handle invalid POI references gracefully', async () => {
            const db = dbManager.getDb();
            
            // Insert test file with limited POIs
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('invalid-refs.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert only one POI
            const validPoiId = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'invalid-refs.js', 'validFunction', 'function', 1, 5,
                'Valid function', false, 'valid_func_semantic', testRunId
            ).lastInsertRowid;
            
            // Create outbox event with mix of valid and invalid references
            const relationshipPayload = {
                type: 'relationship-creation',
                source: 'FileAnalysisWorker',
                runId: testRunId,
                relationships: [
                    {
                        id: 'valid-rel',
                        from: 'validFunction',      // Valid POI name
                        to: 'validFunction',        // Self-reference (valid)
                        type: 'REFERENCES',
                        reason: 'Self-reference',
                        confidence: 1.0
                    },
                    {
                        id: 'invalid-from',
                        from: 'nonexistentFunction', // Invalid POI name
                        to: 'validFunction',         // Valid POI name
                        type: 'CALLS',
                        reason: 'Invalid from reference',
                        confidence: 0.8
                    },
                    {
                        id: 'invalid-to',
                        from: 'validFunction',       // Valid POI name
                        to: 'anotherNonexistent',   // Invalid POI name
                        type: 'USES',
                        reason: 'Invalid to reference',
                        confidence: 0.7
                    },
                    {
                        id: 'both-invalid',
                        from: 'ghostFunction',       // Invalid POI name
                        to: 'phantomFunction',      // Invalid POI name
                        type: 'RELATED_TO',
                        reason: 'Both invalid',
                        confidence: 0.5
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(relationshipPayload), 'PENDING', testRunId);
            
            // Process outbox events (should handle invalid references gracefully)
            await outboxPublisher.pollAndPublish();
            
            // Only valid relationships should be created
            const relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            
            expect(relationships.length).toBe(1); // Only the valid self-reference
            
            const validRel = relationships[0];
            expect(validRel.type).toBe('REFERENCES');
            expect(validRel.source_poi_id).toBe(validPoiId);
            expect(validRel.target_poi_id).toBe(validPoiId);
            expect(validRel.confidence).toBe(1.0);
            
            // Outbox event should still be processed (with partial success)
            const processedEvents = db.prepare('SELECT * FROM outbox WHERE status = ? AND run_id = ?')
                .all('PROCESSED', testRunId);
            expect(processedEvents.length).toBe(1);
            
            console.log('Valid relationships created:', relationships.length);
            console.log('✅ Invalid POI references handled gracefully');
        });

        test('should log warnings for unresolved POI references', async () => {
            const db = dbManager.getDb();
            
            // Capture console warnings
            const originalWarn = console.warn;
            const warnings = [];
            console.warn = (message) => {
                warnings.push(message);
                originalWarn(message);
            };
            
            try {
                // Insert test file (no POIs)
                const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                    .run('no-pois.js', 'processed', testRunId).lastInsertRowid;
                
                // Create outbox event with unresolvable references
                const relationshipPayload = {
                    type: 'relationship-creation',
                    source: 'TestWorker',
                    runId: testRunId,
                    relationships: [
                        {
                            id: 'unresolvable-1',
                            from: 'missingFunction',
                            to: 'alsoMissing',
                            type: 'CALLS',
                            reason: 'Both POIs missing',
                            confidence: 0.9
                        }
                    ]
                };
                
                db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                    .run('relationship-creation', JSON.stringify(relationshipPayload), 'PENDING', testRunId);
                
                // Process outbox events
                await outboxPublisher.pollAndPublish();
                
                // No relationships should be created
                const relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
                expect(relationships.length).toBe(0);
                
                // Should have logged warnings about unresolved references
                const relevantWarnings = warnings.filter(w => 
                    w.includes('POI') && (w.includes('missingFunction') || w.includes('alsoMissing'))
                );
                expect(relevantWarnings.length).toBeGreaterThan(0);
                
                console.log('Warnings logged:', relevantWarnings.length);
                console.log('✅ Warnings logged for unresolved POI references');
                
            } finally {
                console.warn = originalWarn;
            }
        });
    });

    describe('3. Batch Processing with ID Resolution', () => {
        test('should handle large batches of relationship creation efficiently', async () => {
            const db = dbManager.getDb();
            
            // Insert test files with many POIs
            const file1Id = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('batch-test-1.js', 'processed', testRunId).lastInsertRowid;
            const file2Id = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('batch-test-2.js', 'processed', testRunId).lastInsertRowid;
            
            // Create many POIs for batch testing
            const poiNames = [];
            const batchSize = 50;
            
            for (let i = 0; i < batchSize; i++) {
                const poiName = `function_${i}`;
                poiNames.push(poiName);
                
                const fileId = i % 2 === 0 ? file1Id : file2Id;
                const filePath = i % 2 === 0 ? 'batch-test-1.js' : 'batch-test-2.js';
                
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, filePath, poiName, 'function', i, i + 5,
                    `Function ${i}`, false, `func_${i}_semantic`, testRunId
                );
            }
            
            // Create large batch of relationships
            const relationships = [];
            for (let i = 0; i < batchSize - 1; i++) {
                relationships.push({
                    id: `batch-rel-${i}`,
                    from: `function_${i}`,
                    to: `function_${i + 1}`,
                    type: 'CALLS',
                    reason: `function_${i} calls function_${i + 1}`,
                    confidence: 0.8
                });
            }
            
            const batchPayload = {
                type: 'relationship-creation',
                source: 'BatchProcessor',
                runId: testRunId,
                relationships: relationships
            };
            
            const batchStart = Date.now();
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(batchPayload), 'PENDING', testRunId);
            
            // Process batch
            await outboxPublisher.pollAndPublish();
            
            const batchDuration = Date.now() - batchStart;
            
            // Verify all relationships were created
            const createdRelationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            expect(createdRelationships.length).toBe(batchSize - 1);
            
            // Verify all relationships have valid POI IDs
            for (const rel of createdRelationships) {
                expect(rel.source_poi_id).toBeGreaterThan(0);
                expect(rel.target_poi_id).toBeGreaterThan(0);
                expect(rel.type).toBe('CALLS');
                expect(rel.confidence).toBe(0.8);
            }
            
            console.log(`Processed ${batchSize - 1} relationships in ${batchDuration}ms`);
            console.log('✅ Large batch processing with ID resolution efficient');
        });

        test('should handle mixed batch with valid and invalid references', async () => {
            const db = dbManager.getDb();
            
            // Insert test file with some POIs
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('mixed-batch.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert only even-numbered POIs
            const validPois = [];
            for (let i = 0; i < 10; i += 2) {
                const poiName = `function_${i}`;
                validPois.push(poiName);
                
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'mixed-batch.js', poiName, 'function', i, i + 5,
                    `Function ${i}`, false, `func_${i}_semantic`, testRunId
                );
            }
            
            // Create mixed batch with valid and invalid references
            const mixedRelationships = [];
            for (let i = 0; i < 10; i++) {
                mixedRelationships.push({
                    id: `mixed-rel-${i}`,
                    from: `function_${i}`,     // Some valid, some invalid
                    to: `function_${i + 2}`,   // Some valid, some invalid
                    type: 'RELATED_TO',
                    reason: `Relationship ${i}`,
                    confidence: 0.6
                });
            }
            
            const mixedPayload = {
                type: 'relationship-creation',
                source: 'MixedBatchProcessor',
                runId: testRunId,
                relationships: mixedRelationships
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(mixedPayload), 'PENDING', testRunId);
            
            // Process mixed batch
            await outboxPublisher.pollAndPublish();
            
            // Count valid relationships created
            const createdRelationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            
            // Should have created relationships only for valid POI pairs
            // function_0 -> function_2, function_2 -> function_4, function_4 -> function_6, function_6 -> function_8
            const expectedValidRels = 4;
            expect(createdRelationships.length).toBe(expectedValidRels);
            
            // Verify all created relationships have valid POI IDs
            for (const rel of createdRelationships) {
                expect(rel.source_poi_id).toBeGreaterThan(0);
                expect(rel.target_poi_id).toBeGreaterThan(0);
                expect(rel.type).toBe('RELATED_TO');
                expect(rel.confidence).toBe(0.6);
            }
            
            // Outbox should still be processed despite partial failures
            const processedEvents = db.prepare('SELECT * FROM outbox WHERE status = ? AND run_id = ?')
                .all('PROCESSED', testRunId);
            expect(processedEvents.length).toBe(1);
            
            console.log(`Created ${createdRelationships.length} valid relationships from mixed batch of ${mixedRelationships.length}`);
            console.log('✅ Mixed batch with valid/invalid references handled correctly');
        });
    });

    describe('4. Cross-File Relationship ID Resolution', () => {
        test('should resolve POI IDs across different files correctly', async () => {
            const db = dbManager.getDb();
            
            // Insert multiple files
            const authFileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('src/auth.js', 'processed', testRunId).lastInsertRowid;
            const userFileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('src/user.js', 'processed', testRunId).lastInsertRowid;
            const configFileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('src/config.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert POIs in different files
            const crossFilePois = [
                { fileId: authFileId, filePath: 'src/auth.js', name: 'authenticate', semanticId: 'auth_authenticate_func' },
                { fileId: authFileId, filePath: 'src/auth.js', name: 'hashPassword', semanticId: 'auth_hash_password_func' },
                { fileId: userFileId, filePath: 'src/user.js', name: 'createUser', semanticId: 'user_create_user_func' },
                { fileId: userFileId, filePath: 'src/user.js', name: 'User', semanticId: 'user_class' },
                { fileId: configFileId, filePath: 'src/config.js', name: 'JWT_SECRET', semanticId: 'config_jwt_secret_const' }
            ];
            
            const poiIdMap = {};
            for (const poi of crossFilePois) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    poi.fileId, poi.filePath, poi.name, 'function', 1, 5,
                    `${poi.name} in ${poi.filePath}`, true, poi.semanticId, testRunId
                ).lastInsertRowid;
                
                poiIdMap[poi.name] = poiId;
                poiIdMap[poi.semanticId] = poiId;
            }
            
            // Create cross-file relationships
            const crossFilePayload = {
                type: 'relationship-creation',
                source: 'CrossFileAnalyzer',
                runId: testRunId,
                relationships: [
                    {
                        id: 'cross-rel-1',
                        from: 'createUser',        // user.js
                        to: 'authenticate',        // auth.js
                        type: 'CALLS',
                        reason: 'createUser calls authenticate',
                        confidence: 0.9
                    },
                    {
                        id: 'cross-rel-2',
                        from: 'auth_authenticate_func', // semantic ID from auth.js
                        to: 'auth_hash_password_func',  // semantic ID from auth.js
                        type: 'USES',
                        reason: 'authenticate uses hashPassword',
                        confidence: 0.8
                    },
                    {
                        id: 'cross-rel-3',
                        from: 'User',              // user.js
                        to: 'JWT_SECRET',          // config.js
                        type: 'REFERENCES',
                        reason: 'User class references JWT_SECRET',
                        confidence: 0.7
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(crossFilePayload), 'PENDING', testRunId);
            
            // Process cross-file relationships
            await outboxPublisher.pollAndPublish();
            
            // Verify cross-file relationships were created
            const crossFileRels = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            expect(crossFileRels.length).toBe(3);
            
            // Verify each relationship
            const callsRel = crossFileRels.find(r => r.type === 'CALLS');
            expect(callsRel.source_poi_id).toBe(poiIdMap['createUser']);
            expect(callsRel.target_poi_id).toBe(poiIdMap['authenticate']);
            
            const usesRel = crossFileRels.find(r => r.type === 'USES');
            expect(usesRel.source_poi_id).toBe(poiIdMap['auth_authenticate_func']);
            expect(usesRel.target_poi_id).toBe(poiIdMap['auth_hash_password_func']);
            
            const referencesRel = crossFileRels.find(r => r.type === 'REFERENCES');
            expect(referencesRel.source_poi_id).toBe(poiIdMap['User']);
            expect(referencesRel.target_poi_id).toBe(poiIdMap['JWT_SECRET']);
            
            // Verify POIs are actually from different files
            const allPois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            const filePathSet = new Set(allPois.map(p => p.file_path));
            expect(filePathSet.size).toBe(3); // Three different files
            
            console.log('Cross-file relationships created:', crossFileRels.length);
            console.log('Files involved:', Array.from(filePathSet));
            console.log('✅ Cross-file relationship ID resolution working correctly');
        });
    });

    describe('5. Relationship Deduplication and Updates', () => {
        test('should handle duplicate relationship prevention', async () => {
            const db = dbManager.getDb();
            
            // Insert test file and POIs
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('dedup-test.js', 'processed', testRunId).lastInsertRowid;
            
            const poi1Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'dedup-test.js', 'funcA', 'function', 1, 5,
                'Function A', false, 'func_a_semantic', testRunId
            ).lastInsertRowid;
            
            const poi2Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'dedup-test.js', 'funcB', 'function', 10, 15,
                'Function B', false, 'func_b_semantic', testRunId
            ).lastInsertRowid;
            
            // Create first relationship
            const firstPayload = {
                type: 'relationship-creation',
                source: 'FirstAnalyzer',
                runId: testRunId,
                relationships: [
                    {
                        id: 'dedup-rel-1',
                        from: 'funcA',
                        to: 'funcB',
                        type: 'CALLS',
                        reason: 'funcA calls funcB',
                        confidence: 0.8
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(firstPayload), 'PENDING', testRunId);
            
            // Process first relationship
            await outboxPublisher.pollAndPublish();
            
            // Verify first relationship was created
            let relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            expect(relationships.length).toBe(1);
            expect(relationships[0].confidence).toBe(0.8);
            
            // Create duplicate relationship with different confidence
            const duplicatePayload = {
                type: 'relationship-creation',
                source: 'SecondAnalyzer',
                runId: testRunId,
                relationships: [
                    {
                        id: 'dedup-rel-2',
                        from: 'funcA',
                        to: 'funcB',
                        type: 'CALLS',
                        reason: 'funcA calls funcB (duplicate)',
                        confidence: 0.9 // Higher confidence
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(duplicatePayload), 'PENDING', testRunId);
            
            // Process duplicate relationship
            await outboxPublisher.pollAndPublish();
            
            // Should still have only one relationship, but potentially updated
            relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);
            expect(relationships.length).toBe(1);
            
            const finalRel = relationships[0];
            expect(finalRel.source_poi_id).toBe(poi1Id);
            expect(finalRel.target_poi_id).toBe(poi2Id);
            expect(finalRel.type).toBe('CALLS');
            
            // The system should handle duplicates gracefully (either ignore or update)
            // The specific behavior depends on the implementation
            console.log('Final relationship confidence:', finalRel.confidence);
            console.log('✅ Duplicate relationship handling working correctly');
        });
    });

    describe('6. Performance and Stress Testing', () => {
        test('should handle high-volume relationship creation efficiently', async () => {
            const db = dbManager.getDb();
            
            // Create a large number of POIs for stress testing
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('stress-test.js', 'processed', testRunId).lastInsertRowid;
            
            const numPois = 200;
            const poiNames = [];
            
            console.log(`Creating ${numPois} POIs for stress test...`);
            
            const insertStmt = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            const transaction = db.transaction((pois) => {
                for (const poi of pois) {
                    insertStmt.run(
                        poi.fileId, poi.filePath, poi.name, poi.type, poi.startLine, poi.endLine,
                        poi.description, poi.isExported, poi.semanticId, poi.runId
                    );
                }
            });
            
            const poisToInsert = [];
            for (let i = 0; i < numPois; i++) {
                const poiName = `stressFunc_${i}`;
                poiNames.push(poiName);
                
                poisToInsert.push({
                    fileId,
                    filePath: 'stress-test.js',
                    name: poiName,
                    type: 'function',
                    startLine: i * 10,
                    endLine: i * 10 + 5,
                    description: `Stress test function ${i}`,
                    isExported: false,
                    semanticId: `stress_func_${i}_semantic`,
                    runId: testRunId
                });
            }
            
            transaction(poisToInsert);
            
            // Create many relationships
            const numRelationships = 500;
            const relationships = [];
            
            for (let i = 0; i < numRelationships; i++) {
                const fromIdx = Math.floor(Math.random() * numPois);
                const toIdx = Math.floor(Math.random() * numPois);
                
                if (fromIdx !== toIdx) { // Avoid self-relationships
                    relationships.push({
                        id: `stress-rel-${i}`,
                        from: poiNames[fromIdx],
                        to: poiNames[toIdx],
                        type: 'CALLS',
                        reason: `Stress relationship ${i}`,
                        confidence: Math.random() * 0.5 + 0.5 // 0.5 to 1.0
                    });
                }
            }
            
            const stressPayload = {
                type: 'relationship-creation',
                source: 'StressTestAnalyzer',
                runId: testRunId,
                relationships: relationships
            };
            
            console.log(`Processing ${relationships.length} relationships...`);
            const processStart = Date.now();
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(stressPayload), 'PENDING', testRunId);
            
            // Process stress test relationships
            await outboxPublisher.pollAndPublish();
            
            const processDuration = Date.now() - processStart;
            
            // Verify relationships were created
            const createdRels = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?').get(testRunId);
            
            console.log(`Created ${createdRels.count} relationships in ${processDuration}ms`);
            console.log(`Average: ${(processDuration / createdRels.count).toFixed(2)}ms per relationship`);
            
            // Performance should be reasonable (under 10ms per relationship on average)
            const avgTime = processDuration / createdRels.count;
            expect(avgTime).toBeLessThan(10);
            
            // Should have created most relationships (some may be duplicates)
            expect(createdRels.count).toBeGreaterThan(relationships.length * 0.8);
            
            console.log('✅ High-volume relationship creation handled efficiently');
        });
    });
});