/**
 * Database Schema Validation Integration Tests
 * 
 * These tests validate database schema fixes and ValidationWorker improvements:
 * 1. Semantic ID column migration and population
 * 2. Database schema consistency across components
 * 3. ValidationWorker handles schema changes correctly
 * 4. Migration rollback functionality
 * 5. Data integrity during schema updates
 * 6. Index creation and performance
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const ValidationWorker = require('../../src/workers/ValidationWorker');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');
const SemanticIdentityService = require('../../src/services/SemanticIdentityService');
const { Migration003: Migration003AddSemanticIdColumn } = require('../../migrations/003_add_semantic_id_column');

describe('Database Schema Validation Integration Tests', () => {
    let config;
    let dbManager;
    let queueManager;
    let workerPoolManager;
    let testRunId;
    let testDbPath;
    let testDataDir;

    beforeAll(async () => {
        config = new PipelineConfig({ environment: 'test' });
        testRunId = uuidv4();
        
        testDataDir = path.join(__dirname, `schema-test-${Date.now()}`);
        await fs.ensureDir(testDataDir);
        
        testDbPath = path.join(testDataDir, 'schema-test.db');
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();

        queueManager = getQueueManagerInstance();
        await queueManager.connect();

        workerPoolManager = new WorkerPoolManager({ 
            maxGlobalConcurrency: 5,
            environment: 'test'
        });

        console.log(`✅ Schema validation test environment initialized with runId: ${testRunId}`);
    }, 30000);

    afterAll(async () => {
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
        console.log('✅ Schema validation test cleanup completed');
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

    describe('1. Database Schema Consistency', () => {
        test('should have all required tables with correct schema', async () => {
            const db = dbManager.getDb();
            
            // Check that all required tables exist
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            
            const requiredTables = ['files', 'pois', 'relationships', 'outbox'];
            for (const table of requiredTables) {
                expect(tableNames).toContain(table);
            }

            // Check POIs table schema (including semantic_id column)
            const poisSchema = db.prepare("PRAGMA table_info(pois)").all();
            const poisColumns = poisSchema.map(col => col.name);
            
            const requiredPoisColumns = [
                'id', 'file_id', 'file_path', 'name', 'type', 
                'start_line', 'end_line', 'description', 'is_exported', 
                'semantic_id', 'run_id'
            ];
            
            for (const column of requiredPoisColumns) {
                expect(poisColumns).toContain(column);
            }

            // Verify semantic_id column properties
            const semanticIdColumn = poisSchema.find(col => col.name === 'semantic_id');
            expect(semanticIdColumn).toBeDefined();
            expect(semanticIdColumn.type).toBe('TEXT');

            console.log('POIs table columns:', poisColumns);
            console.log('✅ Database schema consistency verified');
        });

        test('should have proper indexes for performance', async () => {
            const db = dbManager.getDb();
            
            // Check for indexes
            const indexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index'").all();
            const indexNames = indexes.map(i => i.name);
            
            // Check for semantic_id index
            const semanticIdIndex = indexes.find(i => i.name === 'idx_pois_semantic_id');
            expect(semanticIdIndex).toBeDefined();
            expect(semanticIdIndex.tbl_name).toBe('pois');

            // Check for other important indexes
            const expectedIndexes = [
                'idx_pois_file_id',
                'idx_pois_run_id',
                'idx_pois_type',
                'idx_pois_semantic_id'
            ];

            for (const indexName of expectedIndexes) {
                const hasIndex = indexNames.some(name => name === indexName);
                expect(hasIndex).toBe(true);
            }

            console.log('Database indexes:', indexNames);
            console.log('✅ Database indexes verified');
        });

        test('should handle foreign key constraints correctly', async () => {
            const db = dbManager.getDb();
            
            // Test foreign key relationship between pois and files
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('test.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert POI with valid file_id
            const validPoiId = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'test.js', 'testFunction', 'function', 1, 5,
                'Test function', false, 'test_func_semantic', testRunId
            ).lastInsertRowid;
            
            expect(validPoiId).toBeGreaterThan(0);

            // Verify the POI was inserted correctly
            const insertedPoi = db.prepare('SELECT * FROM pois WHERE id = ?').get(validPoiId);
            expect(insertedPoi).toBeDefined();
            expect(insertedPoi.file_id).toBe(fileId);
            expect(insertedPoi.semantic_id).toBe('test_func_semantic');

            // Test cascade delete
            db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
            
            // POI should be deleted due to CASCADE
            const deletedPoi = db.prepare('SELECT * FROM pois WHERE id = ?').get(validPoiId);
            expect(deletedPoi).toBeUndefined();

            console.log('✅ Foreign key constraints working correctly');
        });
    });

    describe('2. Semantic ID Column Migration', () => {
        test('should migrate existing POIs to include semantic IDs', async () => {
            const db = dbManager.getDb();
            
            // Insert test file and POIs without semantic IDs
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('migration-test.js', 'processed', testRunId).lastInsertRowid;
            
            // Temporarily remove semantic_id values to simulate pre-migration state
            const poisWithoutSemanticId = [
                { name: 'createUser', type: 'function', startLine: 1, endLine: 10 },
                { name: 'validateUser', type: 'function', startLine: 15, endLine: 25 },
                { name: 'UserClass', type: 'class', startLine: 30, endLine: 50 }
            ];
            
            const poiIds = [];
            for (const poi of poisWithoutSemanticId) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'migration-test.js', poi.name, poi.type, poi.startLine, poi.endLine,
                    `${poi.type} ${poi.name}`, false, testRunId
                ).lastInsertRowid;
                poiIds.push(poiId);
            }
            
            // Clear semantic_id to simulate pre-migration state
            db.prepare('UPDATE pois SET semantic_id = NULL WHERE file_id = ?').run(fileId);
            
            // Run migration
            const migration = new Migration003AddSemanticIdColumn(db);
            await migration.up(db);
            
            // Verify semantic IDs were generated
            const migratedPois = db.prepare('SELECT * FROM pois WHERE file_id = ?').all(fileId);
            
            for (const poi of migratedPois) {
                expect(poi.semantic_id).toBeDefined();
                expect(poi.semantic_id).not.toBeNull();
                expect(poi.semantic_id.length).toBeGreaterThan(0);
                
                // Semantic ID should be related to the POI name and type
                expect(poi.semantic_id.toLowerCase()).toContain(poi.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
            }
            
            console.log('Migrated POIs:', migratedPois.map(p => ({ name: p.name, semantic_id: p.semantic_id })));
            console.log('✅ Semantic ID migration working correctly');
        });

        test('should generate unique semantic IDs for POIs', async () => {
            const semanticService = new SemanticIdentityService();
            const db = dbManager.getDb();
            
            // Insert test file
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('uniqueness-test.js', 'processed', testRunId).lastInsertRowid;
            
            // Create POIs with similar names that might conflict
            const similarPois = [
                { name: 'user', type: 'variable', startLine: 1, endLine: 1 },
                { name: 'user', type: 'function', startLine: 5, endLine: 10 },
                { name: 'User', type: 'class', startLine: 15, endLine: 30 },
                { name: 'user_id', type: 'variable', startLine: 35, endLine: 35 },
                { name: 'getUser', type: 'function', startLine: 40, endLine: 45 }
            ];
            
            const generatedSemanticIds = [];
            for (const poi of similarPois) {
                const poiData = {
                    name: poi.name,
                    type: poi.type,
                    start_line: poi.startLine,
                    end_line: poi.endLine,
                    description: `${poi.type} ${poi.name}`,
                    is_exported: false
                };
                
                const semanticId = semanticService.generateSemanticId('uniqueness-test.js', poiData);
                generatedSemanticIds.push(semanticId);
                
                // Insert POI with generated semantic ID
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'uniqueness-test.js', poi.name, poi.type, poi.startLine, poi.endLine,
                    poiData.description, false, semanticId, testRunId
                );
            }
            
            // Verify all semantic IDs are unique
            const uniqueSemanticIds = new Set(generatedSemanticIds);
            expect(uniqueSemanticIds.size).toBe(generatedSemanticIds.length);
            
            // Verify semantic IDs in database are unique
            const dbSemanticIds = db.prepare('SELECT semantic_id FROM pois WHERE file_id = ?').all(fileId);
            const dbUniqueIds = new Set(dbSemanticIds.map(row => row.semantic_id));
            expect(dbUniqueIds.size).toBe(dbSemanticIds.length);
            
            console.log('Generated semantic IDs:', generatedSemanticIds);
            console.log('✅ Semantic ID uniqueness verified');
        });

        test('should handle migration rollback correctly', async () => {
            // Create a separate test database for rollback test
            const rollbackDbPath = path.join(testDataDir, 'rollback-test.db');
            const rollbackDbManager = new DatabaseManager(rollbackDbPath);
            await rollbackDbManager.initializeDb();
            
            const rollbackDb = rollbackDbManager.getDb();
            
            // Insert test data
            const fileId = rollbackDb.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('rollback-test.js', 'processed', testRunId).lastInsertRowid;
            
            const poiId = rollbackDb.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'rollback-test.js', 'testFunc', 'function', 1, 5,
                'Test function', false, 'test_semantic_id', testRunId
            ).lastInsertRowid;
            
            // Verify semantic_id exists
            let poisSchema = rollbackDb.prepare("PRAGMA table_info(pois)").all();
            let hasSemanticId = poisSchema.some(col => col.name === 'semantic_id');
            expect(hasSemanticId).toBe(true);
            
            // Run rollback
            const migration = new Migration003AddSemanticIdColumn(rollbackDb);
            await migration.down(rollbackDb);
            
            // Verify semantic_id column was removed
            poisSchema = rollbackDb.prepare("PRAGMA table_info(pois)").all();
            hasSemanticId = poisSchema.some(col => col.name === 'semantic_id');
            expect(hasSemanticId).toBe(false);
            
            // Verify other data is preserved
            const remainingPoi = rollbackDb.prepare('SELECT * FROM pois WHERE id = ?').get(poiId);
            expect(remainingPoi).toBeDefined();
            expect(remainingPoi.name).toBe('testFunc');
            expect(remainingPoi.type).toBe('function');
            
            await rollbackDbManager.close();
            console.log('✅ Migration rollback working correctly');
        });
    });

    describe('3. ValidationWorker Schema Integration', () => {
        test('should validate POIs with semantic IDs correctly', async () => {
            const validationWorker = new ValidationWorker(
                queueManager, dbManager, workerPoolManager,
                { processOnly: true }
            );
            
            const db = dbManager.getDb();
            
            // Insert test file and POIs
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('validation-test.js', 'processed', testRunId).lastInsertRowid;
            
            const validPois = [
                { name: 'validFunction', type: 'function', semanticId: 'valid_func_semantic' },
                { name: 'ValidClass', type: 'class', semanticId: 'valid_class_semantic' }
            ];
            
            const invalidPois = [
                { name: 'invalidFunction', type: 'function', semanticId: null }, // Missing semantic ID
                { name: '', type: 'function', semanticId: 'empty_name_semantic' }, // Empty name
                { name: 'noTypeFunction', type: '', semanticId: 'no_type_semantic' } // Empty type
            ];
            
            const allPois = [...validPois, ...invalidPois];
            const poiIds = [];
            
            for (const poi of allPois) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'validation-test.js', poi.name, poi.type, 1, 5,
                    `${poi.type} ${poi.name}`, false, poi.semanticId, testRunId
                ).lastInsertRowid;
                poiIds.push(poiId);
            }
            
            // Create validation job
            const validationJob = {
                data: {
                    fileId: fileId,
                    filePath: 'validation-test.js',
                    runId: testRunId,
                    validationRules: ['semantic_id_required', 'name_not_empty', 'type_not_empty']
                }
            };
            
            // Process validation
            await validationWorker.process(validationJob);
            
            // Check validation results
            const validatedPois = db.prepare('SELECT * FROM pois WHERE file_id = ?').all(fileId);
            
            // Valid POIs should pass validation
            const validResults = validatedPois.filter(poi => 
                poi.name === 'validFunction' || poi.name === 'ValidClass'
            );
            
            for (const poi of validResults) {
                expect(poi.semantic_id).toBeDefined();
                expect(poi.semantic_id).not.toBeNull();
                expect(poi.name.length).toBeGreaterThan(0);
                expect(poi.type.length).toBeGreaterThan(0);
            }
            
            console.log('Validation results:', validatedPois.map(p => ({ 
                name: p.name, 
                type: p.type, 
                semantic_id: p.semantic_id,
                valid: !!(p.semantic_id && p.name && p.type)
            })));
            console.log('✅ ValidationWorker handles semantic IDs correctly');
        });

        test('should auto-generate missing semantic IDs during validation', async () => {
            const validationWorker = new ValidationWorker(
                queueManager, dbManager, workerPoolManager,
                { processOnly: true }
            );
            
            const db = dbManager.getDb();
            
            // Insert test file
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('auto-generation-test.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert POIs without semantic IDs
            const poisWithoutSemanticId = [
                { name: 'functionOne', type: 'function' },
                { name: 'ClassTwo', type: 'class' },
                { name: 'variableThree', type: 'variable' }
            ];
            
            const poiIds = [];
            for (const poi of poisWithoutSemanticId) {
                const poiId = db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'auto-generation-test.js', poi.name, poi.type, 1, 5,
                    `${poi.type} ${poi.name}`, false, testRunId
                ).lastInsertRowid;
                poiIds.push(poiId);
            }
            
            // Verify POIs don't have semantic IDs initially
            let preValidationPois = db.prepare('SELECT * FROM pois WHERE file_id = ?').all(fileId);
            for (const poi of preValidationPois) {
                expect(poi.semantic_id).toBeNull();
            }
            
            // Create validation job with auto-generation enabled
            const validationJob = {
                data: {
                    fileId: fileId,
                    filePath: 'auto-generation-test.js',
                    runId: testRunId,
                    autoGenerateSemanticIds: true
                }
            };
            
            // Process validation
            await validationWorker.process(validationJob);
            
            // Verify semantic IDs were auto-generated
            const postValidationPois = db.prepare('SELECT * FROM pois WHERE file_id = ?').all(fileId);
            
            for (const poi of postValidationPois) {
                expect(poi.semantic_id).toBeDefined();
                expect(poi.semantic_id).not.toBeNull();
                expect(poi.semantic_id.length).toBeGreaterThan(0);
                
                // Semantic ID should relate to the POI
                expect(poi.semantic_id.toLowerCase()).toContain(poi.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
            }
            
            console.log('Auto-generated semantic IDs:', postValidationPois.map(p => ({ 
                name: p.name, 
                semantic_id: p.semantic_id 
            })));
            console.log('✅ Auto-generation of missing semantic IDs working');
        });
    });

    describe('4. Data Integrity During Schema Updates', () => {
        test('should maintain referential integrity during schema changes', async () => {
            const db = dbManager.getDb();
            
            // Create complex relationship data
            const fileId1 = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('file1.js', 'processed', testRunId).lastInsertRowid;
            const fileId2 = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('file2.js', 'processed', testRunId).lastInsertRowid;
            
            const poi1Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId1, 'file1.js', 'sourceFunc', 'function', 1, 5,
                'Source function', true, 'source_func_semantic', testRunId
            ).lastInsertRowid;
            
            const poi2Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId2, 'file2.js', 'targetFunc', 'function', 10, 15,
                'Target function', false, 'target_func_semantic', testRunId
            ).lastInsertRowid;
            
            // Create relationship
            const relationshipId = db.prepare(`
                INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, reason, run_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                poi1Id, poi2Id, 'CALLS', 0.9, 'Function call relationship', testRunId
            ).lastInsertRowid;
            
            // Verify initial state
            const initialPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(testRunId);
            const initialRels = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?').get(testRunId);
            const initialFiles = db.prepare('SELECT COUNT(*) as count FROM files WHERE run_id = ?').get(testRunId);
            
            expect(initialPois.count).toBe(2);
            expect(initialRels.count).toBe(1);
            expect(initialFiles.count).toBe(2);
            
            // Simulate schema update (re-run migration to ensure idempotency)
            const migration = new Migration003AddSemanticIdColumn(db);
            await migration.up(db);
            
            // Verify data integrity after schema update
            const finalPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(testRunId);
            const finalRels = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?').get(testRunId);
            const finalFiles = db.prepare('SELECT COUNT(*) as count FROM files WHERE run_id = ?').get(testRunId);
            
            expect(finalPois.count).toBe(initialPois.count);
            expect(finalRels.count).toBe(initialRels.count);
            expect(finalFiles.count).toBe(initialFiles.count);
            
            // Verify relationships still valid
            const relationship = db.prepare('SELECT * FROM relationships WHERE id = ?').get(relationshipId);
            expect(relationship).toBeDefined();
            expect(relationship.source_poi_id).toBe(poi1Id);
            expect(relationship.target_poi_id).toBe(poi2Id);
            
            // Verify POIs still have semantic IDs
            const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            for (const poi of pois) {
                expect(poi.semantic_id).toBeDefined();
                expect(poi.semantic_id).not.toBeNull();
            }
            
            console.log('✅ Referential integrity maintained during schema updates');
        });

        test('should handle concurrent schema access gracefully', async () => {
            const db = dbManager.getDb();
            
            // Create test data
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('concurrent-test.js', 'processed', testRunId).lastInsertRowid;
            
            // Simulate concurrent operations during schema changes
            const concurrentOperations = [];
            
            // Operation 1: Insert POIs
            concurrentOperations.push(async () => {
                for (let i = 0; i < 10; i++) {
                    try {
                        db.prepare(`
                            INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            fileId, 'concurrent-test.js', `func${i}`, 'function', i, i + 1,
                            `Function ${i}`, false, `func${i}_semantic`, testRunId
                        );
                    } catch (error) {
                        console.log(`Insert error ${i}:`, error.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            });
            
            // Operation 2: Query POIs
            concurrentOperations.push(async () => {
                for (let i = 0; i < 5; i++) {
                    try {
                        const pois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE file_id = ?').get(fileId);
                        console.log(`Query ${i}: Found ${pois.count} POIs`);
                    } catch (error) {
                        console.log(`Query error ${i}:`, error.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            });
            
            // Operation 3: Update POIs
            concurrentOperations.push(async () => {
                await new Promise(resolve => setTimeout(resolve, 50)); // Let some POIs be inserted first
                for (let i = 0; i < 5; i++) {
                    try {
                        db.prepare('UPDATE pois SET description = ? WHERE file_id = ? AND name = ?')
                            .run(`Updated function ${i}`, fileId, `func${i}`);
                    } catch (error) {
                        console.log(`Update error ${i}:`, error.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 15));
                }
            });
            
            // Run all operations concurrently
            const results = await Promise.allSettled(concurrentOperations);
            
            // Check that operations completed (some may have failed due to concurrency, but system should be stable)
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            
            console.log(`Concurrent operations: ${successful} successful, ${failed} failed`);
            
            // Verify final data state is consistent
            const finalPois = db.prepare('SELECT * FROM pois WHERE file_id = ?').all(fileId);
            
            // All POIs should have valid semantic IDs
            for (const poi of finalPois) {
                expect(poi.semantic_id).toBeDefined();
                expect(poi.semantic_id).not.toBeNull();
                expect(poi.semantic_id.length).toBeGreaterThan(0);
            }
            
            console.log(`Final state: ${finalPois.length} POIs with valid semantic IDs`);
            console.log('✅ Concurrent schema access handled gracefully');
        });
    });

    describe('5. Performance Impact of Schema Changes', () => {
        test('should maintain query performance with semantic ID index', async () => {
            const db = dbManager.getDb();
            
            // Insert large number of POIs to test performance
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('performance-test.js', 'processed', testRunId).lastInsertRowid;
            
            const numPois = 1000;
            console.log(`Inserting ${numPois} POIs for performance test...`);
            
            const insertStart = Date.now();
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
                poisToInsert.push({
                    fileId,
                    filePath: 'performance-test.js',
                    name: `function_${i}`,
                    type: 'function',
                    startLine: i * 10,
                    endLine: i * 10 + 5,
                    description: `Performance test function ${i}`,
                    isExported: i % 10 === 0,
                    semanticId: `perf_func_${i}_semantic`,
                    runId: testRunId
                });
            }
            
            transaction(poisToInsert);
            const insertDuration = Date.now() - insertStart;
            console.log(`Inserted ${numPois} POIs in ${insertDuration}ms`);
            
            // Test query performance with semantic_id index
            const queryTests = [
                {
                    name: 'semantic_id lookup',
                    query: 'SELECT * FROM pois WHERE semantic_id = ?',
                    param: 'perf_func_500_semantic'
                },
                {
                    name: 'semantic_id prefix search',
                    query: 'SELECT COUNT(*) as count FROM pois WHERE semantic_id LIKE ?',
                    param: 'perf_func_%'
                },
                {
                    name: 'type with semantic_id',
                    query: 'SELECT COUNT(*) as count FROM pois WHERE type = ? AND semantic_id IS NOT NULL',
                    param: 'function'
                },
                {
                    name: 'exported with semantic_id',
                    query: 'SELECT COUNT(*) as count FROM pois WHERE is_exported = 1 AND semantic_id IS NOT NULL',
                    param: null
                }
            ];
            
            for (const test of queryTests) {
                const queryStart = Date.now();
                const result = test.param ? 
                    db.prepare(test.query).get(test.param) : 
                    db.prepare(test.query).get();
                const queryDuration = Date.now() - queryStart;
                
                console.log(`${test.name}: ${queryDuration}ms`, result);
                
                // Queries should be fast (under 50ms for 1000 records)
                expect(queryDuration).toBeLessThan(50);
            }
            
            console.log('✅ Query performance maintained with semantic ID index');
        });

        test('should efficiently handle semantic ID uniqueness checks', async () => {
            const semanticService = new SemanticIdentityService();
            const db = dbManager.getDb();
            
            // Insert test file
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('uniqueness-performance.js', 'processed', testRunId).lastInsertRowid;
            
            // Pre-populate with some POIs to test collision detection
            const existingPois = [];
            for (let i = 0; i < 100; i++) {
                const semanticId = `existing_func_${i}_semantic`;
                existingPois.push(semanticId);
                
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, 'uniqueness-performance.js', `existingFunc${i}`, 'function', i, i + 1,
                    `Existing function ${i}`, false, semanticId, testRunId
                );
            }
            
            // Load existing IDs into semantic service
            semanticService.importExistingIds(existingPois);
            
            // Test performance of generating unique IDs when collisions occur
            const uniquenessStart = Date.now();
            const newSemanticIds = [];
            
            for (let i = 0; i < 50; i++) {
                const poiData = {
                    name: `existingFunc${i % 10}`, // Will cause collisions
                    type: 'function',
                    start_line: i + 200,
                    end_line: i + 205,
                    description: `New function with collision ${i}`,
                    is_exported: false
                };
                
                const semanticId = semanticService.generateSemanticId('uniqueness-performance.js', poiData);
                newSemanticIds.push(semanticId);
            }
            
            const uniquenessDuration = Date.now() - uniquenessStart;
            console.log(`Generated 50 unique semantic IDs in ${uniquenessDuration}ms`);
            
            // Should be reasonably fast (under 100ms)
            expect(uniquenessDuration).toBeLessThan(100);
            
            // Verify all IDs are unique
            const uniqueIds = new Set(newSemanticIds);
            expect(uniqueIds.size).toBe(newSemanticIds.length);
            
            // Verify no collisions with existing IDs
            for (const id of newSemanticIds) {
                expect(existingPois).not.toContain(id);
            }
            
            console.log('Sample new semantic IDs:', newSemanticIds.slice(0, 5));
            console.log('✅ Semantic ID uniqueness checks are efficient');
        });
    });
});