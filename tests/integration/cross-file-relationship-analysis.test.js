const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const GlobalRelationshipAnalysisWorker = require('../../src/workers/GlobalRelationshipAnalysisWorker');
const CrossFileRelationshipResolver = require('../../src/services/CrossFileRelationshipResolver');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

describe('Cross-File Relationship Analysis Integration', () => {
    let dbManager;
    let queueManager;
    let llmClient;
    let workerPoolManager;
    let outboxPublisher;
    let testRunId;
    let testDbPath;

    beforeAll(async () => {
        // Create temporary database for testing
        testDbPath = path.join(__dirname, `test-cross-file-${Date.now()}.db`);
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();

        queueManager = getQueueManagerInstance();
        await queueManager.connect();

        llmClient = getDeepseekClient();
        workerPoolManager = new WorkerPoolManager({ maxGlobalConcurrency: 10 });
        
        outboxPublisher = new TransactionalOutboxPublisher(dbManager, queueManager);
        
        testRunId = uuidv4();
    });

    afterAll(async () => {
        await queueManager.closeConnections();
        await dbManager.close();
        
        // Clean up test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(async () => {
        // Clear all queues before each test
        await queueManager.clearAllQueues();
        
        // Clear database tables
        const db = dbManager.getDb();
        db.prepare('DELETE FROM pois').run();
        db.prepare('DELETE FROM relationships').run();
        db.prepare('DELETE FROM outbox').run();
        db.prepare('DELETE FROM files').run();
    });

    describe('CrossFileRelationshipResolver', () => {
        test('should find import-export relationships across files', async () => {
            const resolver = new CrossFileRelationshipResolver(dbManager);
            const db = dbManager.getDb();

            // Insert test files
            const authFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/auth.js', 'processed').lastInsertRowid;
            const userFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/user.js', 'processed').lastInsertRowid;

            // Insert test POIs - exported function in auth.js
            const exportedPoiId = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                authFileId, 'src/auth.js', 'authenticate', 'function', 10, 25, 
                'Authenticates user credentials', true, 'auth_func_authenticate', testRunId
            ).lastInsertRowid;

            // Insert import POI in user.js
            const importPoiId = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userFileId, 'src/user.js', 'import { authenticate }', 'import', 1, 1, 
                'Import authenticate function from auth.js', false, 'user_import_authenticate', testRunId
            ).lastInsertRowid;

            // Test import-export relationship detection
            const relationships = await resolver.findImportExportRelationships(testRunId);

            expect(relationships).toBeDefined();
            expect(relationships.length).toBeGreaterThan(0);
            
            const relationship = relationships[0];
            expect(relationship.type).toBe('IMPORTS');
            expect(relationship.cross_file).toBe(true);
            expect(relationship.from_file).toBe('src/user.js');
            expect(relationship.to_file).toBe('src/auth.js');
        });

        test('should find API call relationships across files', async () => {
            const resolver = new CrossFileRelationshipResolver(dbManager);
            const db = dbManager.getDb();

            // Insert test files
            const utilsFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/utils.js', 'processed').lastInsertRowid;
            const serviceFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/service.js', 'processed').lastInsertRowid;

            // Insert exported function in utils.js
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                utilsFileId, 'src/utils.js', 'validateEmail', 'function', 5, 15, 
                'Validates email format', true, 'utils_func_validateEmail', testRunId
            );

            // Insert function call in service.js
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                serviceFileId, 'src/service.js', 'validateEmail(email)', 'function_call', 20, 20, 
                'Call to validateEmail function', false, 'service_call_validateEmail', testRunId
            );

            // Test API call relationship detection
            const relationships = await resolver.findApiCallRelationships(testRunId);

            expect(relationships).toBeDefined();
            expect(relationships.length).toBeGreaterThan(0);
            
            const relationship = relationships[0];
            expect(relationship.type).toBe('CALLS');
            expect(relationship.cross_file).toBe(true);
            expect(relationship.from_file).toBe('src/service.js');
            expect(relationship.to_file).toBe('src/utils.js');
        });

        test('should find inheritance relationships across files', async () => {
            const resolver = new CrossFileRelationshipResolver(dbManager);
            const db = dbManager.getDb();

            // Insert test files
            const baseFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/base.js', 'processed').lastInsertRowid;
            const childFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/child.js', 'processed').lastInsertRowid;

            // Insert base class
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                baseFileId, 'src/base.js', 'BaseUser', 'class', 1, 30, 
                'Base user class', true, 'base_class_BaseUser', testRunId
            );

            // Insert child class
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                childFileId, 'src/child.js', 'AdminUser', 'class', 5, 50, 
                'AdminUser class extends BaseUser from base module', false, 'child_class_AdminUser', testRunId
            );

            // Test inheritance relationship detection
            const relationships = await resolver.findInheritanceRelationships(testRunId);

            expect(relationships).toBeDefined();
            expect(relationships.length).toBeGreaterThan(0);
            
            const relationship = relationships[0];
            expect(relationship.type).toBe('INHERITS');
            expect(relationship.cross_file).toBe(true);
            expect(relationship.from_file).toBe('src/child.js');
            expect(relationship.to_file).toBe('src/base.js');
        });

        test('should get cross-file relationship statistics', async () => {
            const resolver = new CrossFileRelationshipResolver(dbManager);
            const db = dbManager.getDb();

            // Insert test data
            const file1Id = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('file1.js', 'processed').lastInsertRowid;
            const file2Id = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('file2.js', 'processed').lastInsertRowid;

            // Insert POIs
            for (let i = 0; i < 5; i++) {
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    file1Id, 'file1.js', `poi${i}`, 'function', i*10, i*10+5, 
                    `Function ${i}`, i < 2, `poi${i}_semantic`, testRunId
                );
            }

            for (let i = 5; i < 8; i++) {
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    file2Id, 'file2.js', `poi${i}`, 'function', (i-5)*10, (i-5)*10+5, 
                    `Function ${i}`, false, `poi${i}_semantic`, testRunId
                );
            }

            const stats = await resolver.getCrossFileRelationshipStats(testRunId);

            expect(stats.totalPois).toBe(8);
            expect(stats.fileCount).toBe(2);
            expect(stats.exportedPois).toBe(2);
            expect(stats.averagePoIsPerFile).toBe(4);
            expect(stats.exportRatio).toBe(0.25);
        });
    });

    describe('GlobalRelationshipAnalysisWorker', () => {
        test('should process cross-file analysis job', async () => {
            const worker = new GlobalRelationshipAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager, { processOnly: true }
            );

            const db = dbManager.getDb();

            // Insert test files and POIs
            const authFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/auth.js', 'processed').lastInsertRowid;
            const userFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/user.js', 'processed').lastInsertRowid;

            // Insert exported function
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                authFileId, 'src/auth.js', 'authenticate', 'function', 10, 25, 
                'Authenticates user credentials', true, 'auth_func_authenticate', testRunId
            );

            // Insert import statement
            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userFileId, 'src/user.js', 'import authenticate', 'import', 1, 1, 
                'Import authenticate from auth.js', false, 'user_import_authenticate', testRunId
            );

            // Create mock job
            const jobData = {
                runId: testRunId,
                directoryPath: 'src',
                batchNumber: 1,
                totalBatches: 1
            };

            const mockJob = {
                id: 'test-job-1',
                data: jobData
            };

            // Process the job
            await worker.process(mockJob);

            // Check that outbox contains the global relationship findings
            const outboxEvents = db.prepare('SELECT * FROM outbox WHERE event_type = ?').all('global-relationship-analysis-finding');
            expect(outboxEvents.length).toBeGreaterThan(0);

            const event = outboxEvents[0];
            const payload = JSON.parse(event.payload);
            expect(payload.type).toBe('global-relationship-analysis-finding');
            expect(payload.source).toBe('GlobalRelationshipAnalysisWorker');
            expect(payload.runId).toBe(testRunId);
            expect(payload.analysisType).toBe('cross-file');
        });

        test('should group POIs by semantic patterns correctly', async () => {
            const worker = new GlobalRelationshipAnalysisWorker(
                queueManager, dbManager, llmClient, workerPoolManager, { processOnly: true }
            );

            // Mock POIs with different types
            const mockPois = [
                { id: 1, name: 'authenticate', type: 'function', is_exported: true, file_path: 'auth.js' },
                { id: 2, name: 'import authenticate', type: 'import', is_exported: false, file_path: 'user.js' },
                { id: 3, name: 'BaseUser', type: 'class', is_exported: true, file_path: 'base.js' },
                { id: 4, name: 'DATABASE_URL', type: 'constant', is_exported: true, file_path: 'config.js' },
                { id: 5, name: 'UserInterface', type: 'interface', is_exported: true, file_path: 'types.js' }
            ];

            const groups = worker.groupPoisBySemanticPatterns(mockPois);

            expect(groups.exports).toContain(mockPois[0]); // authenticate function
            expect(groups.imports).toContain(mockPois[1]); // import statement
            expect(groups.classes).toContain(mockPois[2]); // BaseUser class
            expect(groups.constants).toContain(mockPois[3]); // DATABASE_URL constant
            expect(groups.interfaces).toContain(mockPois[4]); // UserInterface
            expect(groups.types).toContain(mockPois[4]); // Also in types
        });
    });

    describe('TransactionalOutboxPublisher Cross-File Integration', () => {
        test('should trigger global analysis after all files are processed', async () => {
            const db = dbManager.getDb();

            // Insert test files and POIs for multiple files
            const files = ['file1.js', 'file2.js', 'file3.js'];
            for (const filePath of files) {
                const fileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run(filePath, 'processed').lastInsertRowid;
                
                // Insert some POIs for each file
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    fileId, filePath, `function_${filePath.replace('.js', '')}`, 'function', 1, 10, 
                    `Function in ${filePath}`, true, `${filePath}_func`, testRunId
                );
            }

            // Check that global analysis gets triggered
            await outboxPublisher._checkAndTriggerGlobalAnalysis();

            // Wait a bit for async operations
            await new Promise(resolve => setTimeout(resolve, 100));

            // Check that global analysis jobs were created
            const globalAnalysisQueue = queueManager.getQueue('global-relationship-analysis-queue');
            const jobCounts = await globalAnalysisQueue.getJobCounts();
            
            expect(jobCounts.waiting + jobCounts.active).toBeGreaterThan(0);
        });

        test('should handle global relationship analysis findings', async () => {
            const db = dbManager.getDb();

            // Create mock global relationship analysis findings in outbox
            const findingPayload = {
                type: 'global-relationship-analysis-finding',
                source: 'GlobalRelationshipAnalysisWorker',
                runId: testRunId,
                relationships: [
                    {
                        id: 'cross-file-rel-1',
                        from: 'file1_func',
                        to: 'file2_func',
                        type: 'CALLS',
                        reason: 'Function in file1 calls function in file2',
                        confidence: 0.9,
                        cross_file: true,
                        from_file: 'file1.js',
                        to_file: 'file2.js'
                    }
                ]
            };

            db.prepare('INSERT INTO outbox (event_type, payload, status) VALUES (?, ?, ?)')
              .run('global-relationship-analysis-finding', JSON.stringify(findingPayload), 'PENDING');

            // Insert corresponding POIs
            const file1Id = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('file1.js', 'processed').lastInsertRowid;
            const file2Id = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('file2.js', 'processed').lastInsertRowid;

            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(file1Id, 'file1.js', 'func1', 'function', 1, 10, 'Function 1', false, 'file1_func', testRunId);

            db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(file2Id, 'file2.js', 'func2', 'function', 1, 10, 'Function 2', true, 'file2_func', testRunId);

            // Process the outbox events
            await outboxPublisher.pollAndPublish();

            // Check that cross-file relationships were written to database
            const relationships = db.prepare(`
                SELECT * FROM relationships 
                WHERE run_id = ? AND status = 'CROSS_FILE_VALIDATED'
            `).all(testRunId);

            expect(relationships.length).toBeGreaterThan(0);
            
            const relationship = relationships[0];
            expect(relationship.type).toBe('CALLS');
            expect(relationship.status).toBe('CROSS_FILE_VALIDATED');
            expect(relationship.confidence).toBe(0.9);
        });
    });

    describe('End-to-End Cross-File Analysis', () => {
        test('should complete full cross-file analysis workflow', async () => {
            const db = dbManager.getDb();

            // 1. Set up test data with multiple files and cross-file relationships
            const authFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/auth.js', 'processed').lastInsertRowid;
            const userFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/user.js', 'processed').lastInsertRowid;
            const configFileId = db.prepare('INSERT INTO files (file_path, status) VALUES (?, ?)').run('src/config.js', 'processed').lastInsertRowid;

            // Insert POIs representing a realistic cross-file scenario
            const pois = [
                { fileId: authFileId, filePath: 'src/auth.js', name: 'authenticate', type: 'function', is_exported: true, semanticId: 'auth_func_authenticate' },
                { fileId: authFileId, filePath: 'src/auth.js', name: 'hashPassword', type: 'function', is_exported: true, semanticId: 'auth_func_hashPassword' },
                { fileId: userFileId, filePath: 'src/user.js', name: 'import { authenticate }', type: 'import', is_exported: false, semanticId: 'user_import_authenticate' },
                { fileId: userFileId, filePath: 'src/user.js', name: 'login', type: 'function', is_exported: false, semanticId: 'user_func_login' },
                { fileId: configFileId, filePath: 'src/config.js', name: 'JWT_SECRET', type: 'constant', is_exported: true, semanticId: 'config_const_jwt_secret' }
            ];

            for (const poi of pois) {
                db.prepare(`
                    INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    poi.fileId, poi.filePath, poi.name, poi.type, 10, 20,
                    `${poi.type} ${poi.name}`, poi.is_exported, poi.semanticId, testRunId
                );
            }

            // 2. Start outbox publisher to trigger global analysis
            outboxPublisher.start();

            // 3. Trigger global analysis manually for testing
            await outboxPublisher._checkAndTriggerGlobalAnalysis();

            // 4. Wait for processing
            await new Promise(resolve => setTimeout(resolve, 500));

            // 5. Process any pending outbox events
            await outboxPublisher.pollAndPublish();

            // 6. Stop outbox publisher
            await outboxPublisher.stop();

            // 7. Verify that cross-file analysis was triggered
            const globalAnalysisQueue = queueManager.getQueue('global-relationship-analysis-queue');
            const jobCounts = await globalAnalysisQueue.getJobCounts();
            
            // Should have created at least one global analysis job
            expect(jobCounts.waiting + jobCounts.completed + jobCounts.active).toBeGreaterThan(0);

            // 8. Verify statistics
            const resolver = new CrossFileRelationshipResolver(dbManager);
            const stats = await resolver.getCrossFileRelationshipStats(testRunId);
            
            expect(stats.totalPois).toBe(5);
            expect(stats.fileCount).toBe(3);
            expect(stats.exportedPois).toBe(3); // authenticate, hashPassword, JWT_SECRET
            expect(stats.averagePoIsPerFile).toBeGreaterThan(1);
        });
    });
});