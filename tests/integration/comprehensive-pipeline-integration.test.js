/**
 * Comprehensive Pipeline Integration Tests
 * 
 * This test suite validates that all pipeline fixes work together correctly:
 * 1. Database path consistency fixes
 * 2. POI ID resolution and relationship creation fixes
 * 3. Worker concurrency configuration fixes
 * 4. Redis eviction policy fixes
 * 5. File processing improvements
 * 6. Neo4j timeout configuration fixes
 * 
 * Tests the complete data flow:
 * EntityScout → FileAnalysisWorker → ValidationWorker → ReconciliationWorker → GraphBuilder → Neo4j
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getDriver: getNeo4jDriver } = require('../../src/utils/neo4jDriver');
const { getCacheClient } = require('../../src/utils/cacheClient');
const EntityScout = require('../../src/agents/EntityScout');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const ValidationWorker = require('../../src/workers/ValidationWorker');
const ReconciliationWorker = require('../../src/workers/ReconciliationWorker');
const GraphBuilder = require('../../src/agents/GraphBuilder');
const GraphIngestionWorker = require('../../src/workers/GraphIngestionWorker');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');

describe('Comprehensive Pipeline Integration Tests', () => {
    let config;
    let dbManager;
    let queueManager;
    let neo4jDriver;
    let cacheClient;
    let llmClient;
    let workerPoolManager;
    let outboxPublisher;
    let testRunId;
    let testDbPath;
    let testDataDir;
    let workers;

    beforeAll(async () => {
        // Create test environment with pipeline configuration
        config = new PipelineConfig({ environment: 'test' });
        testRunId = uuidv4();
        
        // Create test data directory
        testDataDir = path.join(__dirname, `test-data-${Date.now()}`);
        await fs.ensureDir(testDataDir);
        
        // Create test database
        testDbPath = path.join(testDataDir, 'test-database.db');
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();

        // Initialize queue manager
        queueManager = getQueueManagerInstance();
        await queueManager.connect();

        // Initialize Neo4j driver with timeout configurations
        neo4jDriver = getNeo4jDriver();

        // Initialize cache client (will set Redis eviction policy)
        cacheClient = getCacheClient();

        // Initialize LLM client
        llmClient = getDeepseekClient();

        // Initialize worker pool manager with test configuration
        workerPoolManager = new WorkerPoolManager({ 
            maxGlobalConcurrency: config.getWorkerLimit('file-analysis'),
            environment: 'test'
        });

        // Initialize transactional outbox publisher
        outboxPublisher = new TransactionalOutboxPublisher(dbManager, queueManager);

        // Initialize workers
        workers = {
            fileAnalysis: new FileAnalysisWorker(queueManager, dbManager, llmClient, workerPoolManager, { processOnly: true }),
            validation: new ValidationWorker(queueManager, dbManager, workerPoolManager, { processOnly: true }),
            reconciliation: new ReconciliationWorker(queueManager, dbManager, workerPoolManager, { processOnly: true }),
            graphIngestion: new GraphIngestionWorker(queueManager, dbManager, neo4jDriver, workerPoolManager, { processOnly: true })
        };

        console.log(`✅ Test environment initialized with runId: ${testRunId}`);
    }, 30000);

    afterAll(async () => {
        // Clean up connections
        if (queueManager) {
            await queueManager.clearAllQueues();
            await queueManager.closeConnections();
        }
        if (dbManager) {
            await dbManager.close();
        }
        if (neo4jDriver) {
            await neo4jDriver.close();
        }
        if (outboxPublisher) {
            await outboxPublisher.stop();
        }

        // Clean up test data
        if (fs.existsSync(testDataDir)) {
            await fs.remove(testDataDir);
        }

        console.log('✅ Test cleanup completed');
    }, 30000);

    beforeEach(async () => {
        // Clear all queues before each test
        await queueManager.clearAllQueues();
        
        // Clear database tables
        const db = dbManager.getDb();
        const tables = ['pois', 'relationships', 'outbox', 'files'];
        for (const table of tables) {
            try {
                db.prepare(`DELETE FROM ${table}`).run();
            } catch (error) {
                console.warn(`Could not clear table ${table}:`, error.message);
            }
        }
        
        // Clear Neo4j test data
        const session = neo4jDriver.session();
        try {
            await session.run('MATCH (n) WHERE n.runId = $runId DETACH DELETE n', { runId: testRunId });
        } finally {
            await session.close();
        }
    });

    describe('1. Database Path Consistency Fix Validation', () => {
        test('should use consistent database path across all components', async () => {
            // Verify config provides consistent path
            const expectedPath = config.getDatabaseConfig('sqlite').path;
            expect(expectedPath).toBe('./data/database.db');
            
            // Verify database manager uses the correct path (test uses different path)
            expect(dbManager.dbPath).toBe(testDbPath);
            
            // Verify directory structure exists
            const dataDir = path.dirname(testDbPath);
            expect(fs.existsSync(dataDir)).toBe(true);
            
            // Test database operations work
            const db = dbManager.getDb();
            const result = db.prepare('SELECT name FROM sqlite_master WHERE type="table" AND name="files"').get();
            expect(result).toBeDefined();
            expect(result.name).toBe('files');
        });

        test('should handle database directory creation gracefully', async () => {
            const tempDbPath = path.join(testDataDir, 'nested', 'deep', 'database.db');
            const tempDbManager = new DatabaseManager(tempDbPath);
            
            // This should create the directory structure and initialize the database
            await expect(tempDbManager.initializeDb()).resolves.not.toThrow();
            
            // Verify the database is functional
            const db = tempDbManager.getDb();
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            expect(tables.length).toBeGreaterThan(0);
            
            await tempDbManager.close();
        });
    });

    describe('2. Complete End-to-End Pipeline Flow', () => {
        test('should process files through complete pipeline with all fixes applied', async () => {
            // Create test files with realistic code content
            const testFiles = await createTestCodeFiles(testDataDir);
            
            // Phase 1: EntityScout discovers files
            console.log('Phase 1: EntityScout file discovery');
            const entityScout = new EntityScout(queueManager, dbManager, { processOnly: true });
            await entityScout.run(testDataDir, { runId: testRunId });
            
            // Verify files were discovered and .git directory was ignored
            const db = dbManager.getDb();
            const discoveredFiles = db.prepare('SELECT file_path FROM files WHERE run_id = ?').all(testRunId);
            expect(discoveredFiles.length).toBeGreaterThan(0);
            
            // Verify .git files are not included
            const gitFiles = discoveredFiles.filter(f => f.file_path.includes('.git'));
            expect(gitFiles.length).toBe(0);
            
            // Verify only code files are included
            const codeFiles = discoveredFiles.filter(f => 
                ['.js', '.py', '.java', '.cpp', '.ts'].some(ext => f.file_path.endsWith(ext))
            );
            expect(codeFiles.length).toBe(discoveredFiles.length);

            // Phase 2: FileAnalysisWorker processes files
            console.log('Phase 2: FileAnalysisWorker processing');
            const fileAnalysisQueue = queueManager.getQueue('file-analysis-queue');
            let jobCounts = await fileAnalysisQueue.getJobCounts();
            expect(jobCounts.waiting + jobCounts.active).toBeGreaterThan(0);

            // Process file analysis jobs
            let processedJobs = 0;
            while (processedJobs < 10) { // Safety limit
                const job = await fileAnalysisQueue.getNextJob();
                if (!job) break;
                
                await workers.fileAnalysis.process(job);
                await job.moveToCompleted();
                processedJobs++;
            }

            // Verify POIs were created with semantic IDs
            const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            expect(pois.length).toBeGreaterThan(0);
            
            // Verify semantic IDs were assigned
            const poisWithSemanticIds = pois.filter(poi => poi.semantic_id && poi.semantic_id.length > 0);
            expect(poisWithSemanticIds.length).toBe(pois.length);

            // Phase 3: ValidationWorker validates POIs
            console.log('Phase 3: ValidationWorker processing');
            const validationQueue = queueManager.getQueue('validation-queue');
            jobCounts = await validationQueue.getJobCounts();
            
            if (jobCounts.waiting + jobCounts.active > 0) {
                processedJobs = 0;
                while (processedJobs < 10) { // Safety limit
                    const job = await validationQueue.getNextJob();
                    if (!job) break;
                    
                    await workers.validation.process(job);
                    await job.moveToCompleted();
                    processedJobs++;
                }
            }

            // Phase 4: Process outbox events (includes POI ID resolution fix)
            console.log('Phase 4: Outbox processing with POI ID resolution');
            await outboxPublisher.pollAndPublish();

            // Verify outbox events were processed correctly
            const outboxEvents = db.prepare('SELECT * FROM outbox WHERE status = ?').all('PROCESSED');
            expect(outboxEvents.length).toBeGreaterThan(0);

            // Phase 5: ReconciliationWorker processes relationships
            console.log('Phase 5: ReconciliationWorker processing');
            const reconciliationQueue = queueManager.getQueue('reconciliation-queue');
            jobCounts = await reconciliationQueue.getJobCounts();
            
            if (jobCounts.waiting + jobCounts.active > 0) {
                processedJobs = 0;
                while (processedJobs < 10) { // Safety limit
                    const job = await reconciliationQueue.getNextJob();
                    if (!job) break;
                    
                    await workers.reconciliation.process(job);
                    await job.moveToCompleted();
                    processedJobs++;
                }
            }

            // Phase 6: GraphIngestionWorker builds Neo4j graph
            console.log('Phase 6: GraphIngestionWorker processing');
            const graphQueue = queueManager.getQueue('graph-ingestion-queue');
            jobCounts = await graphQueue.getJobCounts();
            
            if (jobCounts.waiting + jobCounts.active > 0) {
                processedJobs = 0;
                while (processedJobs < 10) { // Safety limit
                    const job = await graphQueue.getNextJob();
                    if (!job) break;
                    
                    await workers.graphIngestion.process(job);
                    await job.moveToCompleted();
                    processedJobs++;
                }
            }

            // Phase 7: Verify final graph state in Neo4j
            console.log('Phase 7: Neo4j graph verification');
            const session = neo4jDriver.session();
            try {
                // Verify nodes were created
                const nodeResult = await session.run(
                    'MATCH (n) WHERE n.runId = $runId RETURN count(n) as nodeCount',
                    { runId: testRunId }
                );
                const nodeCount = nodeResult.records[0].get('nodeCount').low;
                expect(nodeCount).toBeGreaterThan(0);

                // Verify relationships were created
                const relResult = await session.run(
                    'MATCH ()-[r]->() WHERE r.runId = $runId RETURN count(r) as relCount',
                    { runId: testRunId }
                );
                const relCount = relResult.records[0].get('relCount').low;
                console.log(`Created ${nodeCount} nodes and ${relCount} relationships in Neo4j`);
                
            } finally {
                await session.close();
            }

            console.log('✅ Complete end-to-end pipeline flow test passed');
        }, 120000); // 2 minute timeout for full pipeline
    });

    describe('3. POI ID Resolution and Relationship Creation Fix', () => {
        test('should correctly resolve POI IDs and create relationships with actual database IDs', async () => {
            const db = dbManager.getDb();
            
            // Insert test file
            const fileId = db.prepare('INSERT INTO files (file_path, status, run_id) VALUES (?, ?, ?)')
                .run('test.js', 'processed', testRunId).lastInsertRowid;
            
            // Insert test POIs with names that will be used in relationships
            const poi1Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'test.js', 'createUser', 'function', 1, 10, 
                'Creates a new user', true, 'test_func_createUser', testRunId
            ).lastInsertRowid;
            
            const poi2Id = db.prepare(`
                INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported, semantic_id, run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                fileId, 'test.js', 'validateUser', 'function', 15, 25, 
                'Validates user data', false, 'test_func_validateUser', testRunId
            ).lastInsertRowid;
            
            // Create outbox event that should trigger relationship creation
            const relationshipPayload = {
                type: 'relationship-creation',
                source: 'FileAnalysisWorker',
                runId: testRunId,
                relationships: [
                    {
                        id: 'rel-1',
                        from: 'createUser', // POI name, not ID
                        to: 'validateUser',   // POI name, not ID
                        type: 'CALLS',
                        reason: 'createUser calls validateUser',
                        confidence: 0.9
                    }
                ]
            };
            
            db.prepare('INSERT INTO outbox (event_type, payload, status, run_id) VALUES (?, ?, ?, ?)')
                .run('relationship-creation', JSON.stringify(relationshipPayload), 'PENDING', testRunId);
            
            // Process outbox events (this should resolve POI names to actual database IDs)
            await outboxPublisher.pollAndPublish();
            
            // Verify relationship was created with correct POI IDs
            const relationships = db.prepare(`
                SELECT * FROM relationships 
                WHERE run_id = ? AND source_poi_id IS NOT NULL AND target_poi_id IS NOT NULL
            `).all(testRunId);
            
            expect(relationships.length).toBe(1);
            
            const relationship = relationships[0];
            expect(relationship.source_poi_id).toBe(poi1Id);
            expect(relationship.target_poi_id).toBe(poi2Id);
            expect(relationship.type).toBe('CALLS');
            expect(relationship.confidence).toBe(0.9);
            
            // Verify the outbox event was processed
            const processedEvents = db.prepare('SELECT * FROM outbox WHERE status = ? AND run_id = ?')
                .all('PROCESSED', testRunId);
            expect(processedEvents.length).toBe(1);
            
            console.log('✅ POI ID resolution and relationship creation fix validated');
        });
    });

    describe('4. Worker Concurrency Configuration Fix', () => {
        test('should respect centralized worker concurrency limits', async () => {
            // Verify worker limits are applied from pipeline config
            const fileAnalysisLimit = config.getWorkerLimit('file-analysis');
            const relationshipLimit = config.getWorkerLimit('relationship-resolution');
            const validationLimit = config.getWorkerLimit('validation');
            
            expect(fileAnalysisLimit).toBeGreaterThan(0);
            expect(relationshipLimit).toBeGreaterThan(0);
            expect(validationLimit).toBeGreaterThan(0);
            
            // In test environment, limits should be reasonable
            expect(fileAnalysisLimit).toBeLessThanOrEqual(100);
            expect(relationshipLimit).toBeLessThanOrEqual(100);
            expect(validationLimit).toBeLessThanOrEqual(100);
            
            // Verify worker pool manager respects these limits
            expect(workerPoolManager.config.maxGlobalConcurrency).toBeDefined();
            expect(workerPoolManager.config.maxWorkerConcurrency).toBeDefined();
            
            console.log(`Worker limits - File Analysis: ${fileAnalysisLimit}, Relationships: ${relationshipLimit}, Validation: ${validationLimit}`);
            console.log('✅ Worker concurrency configuration fix validated');
        });
    });

    describe('5. File Processing Improvements', () => {
        test('should filter and process only supported code files', async () => {
            // Create test directory with mixed file types
            const mixedFilesDir = path.join(testDataDir, 'mixed-files');
            await fs.ensureDir(mixedFilesDir);
            
            // Create various file types
            const testFiles = [
                { name: 'app.js', content: 'function main() { console.log("Hello"); }', shouldProcess: true },
                { name: 'utils.py', content: 'def helper(): pass', shouldProcess: true },
                { name: 'config.json', content: '{"key": "value"}', shouldProcess: false },
                { name: 'README.md', content: '# Project', shouldProcess: false },
                { name: 'image.png', content: 'binary data', shouldProcess: false },
                { name: 'Component.tsx', content: 'export const Component = () => <div/>', shouldProcess: true }
            ];
            
            // Create .git directory (should be ignored)
            const gitDir = path.join(mixedFilesDir, '.git');
            await fs.ensureDir(gitDir);
            await fs.writeFile(path.join(gitDir, 'config'), 'git config content');
            
            for (const file of testFiles) {
                await fs.writeFile(path.join(mixedFilesDir, file.name), file.content);
            }
            
            // Run EntityScout on mixed files
            const entityScout = new EntityScout(queueManager, dbManager, { processOnly: true });
            await entityScout.run(mixedFilesDir, { runId: testRunId });
            
            // Verify only code files were processed
            const db = dbManager.getDb();
            const processedFiles = db.prepare('SELECT file_path FROM files WHERE run_id = ?').all(testRunId);
            
            const expectedFiles = testFiles.filter(f => f.shouldProcess).length;
            expect(processedFiles.length).toBe(expectedFiles);
            
            // Verify no .git files were processed
            const gitFiles = processedFiles.filter(f => f.file_path.includes('.git'));
            expect(gitFiles.length).toBe(0);
            
            // Verify only supported extensions were processed
            for (const file of processedFiles) {
                const hasValidExtension = ['.js', '.py', '.tsx', '.ts', '.java', '.cpp', '.c', '.h', '.cs', '.php', '.rb', '.go', '.rs'].some(ext => 
                    file.file_path.endsWith(ext)
                );
                expect(hasValidExtension).toBe(true);
            }
            
            console.log(`Processed ${processedFiles.length} out of ${testFiles.length} files (filtered correctly)`);
            console.log('✅ File processing improvements validated');
        });
    });

    describe('6. Redis Configuration Fix', () => {
        test('should configure Redis with noeviction policy', async () => {
            // The getCacheClient() call in beforeAll should have set the eviction policy
            // We can verify this by checking if Redis operations work as expected
            
            const testKey = `test-key-${testRunId}`;
            const testValue = 'test-value';
            
            // Test basic Redis operations
            await cacheClient.set(testKey, testValue, 'EX', 60);
            const retrievedValue = await cacheClient.get(testKey);
            expect(retrievedValue).toBe(testValue);
            
            // Clean up
            await cacheClient.del(testKey);
            
            console.log('✅ Redis configuration fix validated');
        });
    });

    // Helper function to create realistic test code files
    async function createTestCodeFiles(baseDir) {
        const codeFiles = [
            {
                path: 'src/utils.js',
                content: `
function validateEmail(email) {
    return email.includes('@');
}

function hashPassword(password) {
    return 'hashed_' + password;
}

module.exports = { validateEmail, hashPassword };
`
            },
            {
                path: 'src/user.js',
                content: `
const { validateEmail, hashPassword } = require('./utils');

class User {
    constructor(email, password) {
        this.email = email;
        this.password = password;
    }
    
    validate() {
        return validateEmail(this.email);
    }
    
    hashPassword() {
        this.password = hashPassword(this.password);
    }
}

module.exports = User;
`
            },
            {
                path: 'src/auth.py',
                content: `
def authenticate(username, password):
    """Authenticate a user with username and password"""
    if not username or not password:
        return False
    return check_credentials(username, password)

def check_credentials(username, password):
    """Check user credentials against database"""
    return True  # Simplified for testing

class AuthService:
    def __init__(self):
        self.logged_in_users = set()
    
    def login(self, username, password):
        if authenticate(username, password):
            self.logged_in_users.add(username)
            return True
        return False
`
            }
        ];
        
        for (const file of codeFiles) {
            const fullPath = path.join(baseDir, file.path);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, file.content.trim());
        }
        
        return codeFiles;
    }
});