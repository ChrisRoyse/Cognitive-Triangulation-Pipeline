const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const neo4j = require('neo4j-driver');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const QueueManager = require('../../src/utils/queueManager');
const EntityScout = require('../../src/agents/EntityScout');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');
const GraphBuilder = require('../../src/agents/GraphBuilder');
const config = require('../../src/config');

const TEST_DB_PATH = './test_db.sqlite';
const TEST_PROJECT_DIR = path.join(__dirname, '../test-data/e2e-project');

// Utility function to wait for a short period
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Production E2E Pipeline Test', () => {
    let redisClient;
    let dbManager;
    let queueManager;
    let neo4jDriver;
    let neo4jSession;

    beforeAll(async () => {
        // Setup connections
        redisClient = new Redis(config.REDIS_URL);
        neo4jDriver = neo4j.driver(config.NEO4J_URI, neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD));
        dbManager = new DatabaseManager(TEST_DB_PATH);
        queueManager = new QueueManager();

        // Create test project directory
        await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });
        await fs.writeFile(path.join(TEST_PROJECT_DIR, 'main.js'), 'function hello() { console.log("world"); }');
        await fs.mkdir(path.join(TEST_PROJECT_DIR, 'lib'), { recursive: true });
        await fs.writeFile(path.join(TEST_PROJECT_DIR, 'lib', 'utils.js'), 'export const util = () => {};');
    });

    afterAll(async () => {
        // Close connections
        await redisClient.quit();
        await neo4jDriver.close();
        await queueManager.closeConnections();
        dbManager.close();
        await fs.rm(TEST_DB_PATH, { force: true });
        await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    });

    beforeEach(async () => {
        // Reset state before each test
        await redisClient.flushdb();
        
        neo4jSession = neo4jDriver.session({ database: config.NEO4J_DATABASE });
        await neo4jSession.run('MATCH (n) DETACH DELETE n');
        await neo4jSession.close();

        dbManager.close(); // Close any existing connection
        await fs.rm(TEST_DB_PATH, { force: true }); // Delete the old DB file
        dbManager = new DatabaseManager(TEST_DB_PATH); // Re-create
        dbManager.initializeDb();
    });

    afterEach(async () => {
        // Optional: any cleanup needed after each test
    });

    describe('E2E-01: EntityScout -> Redis Job Creation', () => {
        it('should scan a directory and create a hierarchy of jobs in Redis', async () => {
            // Action
            const entityScout = new EntityScout(queueManager, redisClient, TEST_PROJECT_DIR, `run-${uuidv4()}`);
            await entityScout.run();

            // Verification
            const fileQueue = queueManager.getQueue('file-analysis-queue');
            const dirQueue = queueManager.getQueue('directory-resolution-queue');

            const fileJobsCount = await fileQueue.getJobCountByTypes('waiting');
            const dirJobsCount = await dirQueue.getJobCountByTypes('waiting');

            expect(fileJobsCount).toBe(2);
            expect(dirJobsCount).toBe(2); // root and lib

            // Further verification could inspect job parent-child relationships if needed
        }, 30000);
    });

    describe('E2E-02: FileAnalysisWorker -> SQLite Data Persistence', () => {
        it('should process a job and persist POIs to SQLite idempotently', async () => {
            // Setup
            const fileAnalysisQueue = queueManager.getQueue('file-analysis-queue');
            const testFilePath = path.join(TEST_PROJECT_DIR, 'main.js');
            const jobData = { filePath: testFilePath, runId: `run-${uuidv4()}`, jobId: `job-${uuidv4()}` };
            
            const mockLlmClient = {
                query: jest.fn().mockResolvedValue(JSON.stringify({
                    pois: [{ name: 'hello', type: 'FunctionDefinition', start_line: 1, end_line: 1 }]
                }))
            };

            const worker = new FileAnalysisWorker(queueManager, dbManager, redisClient, mockLlmClient);
            
            let completedCount = 0;
            await new Promise(async (resolve, reject) => {
                worker.worker.on('completed', async (job) => {
                    if (job.data.filePath !== testFilePath) return;

                    completedCount++;
                    const db = dbManager.getDb();

                    if (completedCount === 1) {
                        // Verification 1
                        const outboxEvents = db.prepare("SELECT * FROM outbox WHERE status = 'PENDING'").all();
                        expect(outboxEvents.length).toBe(1);
                        const payload = JSON.parse(outboxEvents[0].payload);
                        expect(payload.pois[0].name).toBe('hello');
                        
                        // Trigger idempotency check
                        await fileAnalysisQueue.add('analyze-file', jobData);
                    } else if (completedCount === 2) {
                        // Verification 2 (Idempotency)
                        const outboxEvents = db.prepare("SELECT * FROM outbox WHERE status = 'PENDING'").all();
                        expect(outboxEvents.length).toBe(2);
                        
                        await worker.worker.close();
                        resolve();
                    }
                });

                worker.worker.on('failed', async (job, error) => {
                    await worker.worker.close();
                    reject(error);
                });

                // Add initial job
                await fileAnalysisQueue.add('analyze-file', jobData);
            });
        }, 30000);
    });

    describe('E2E-03: TransactionalOutboxPublisher -> Redis Event Forwarding', () => {
        it('should move an event from SQLite outbox to a Redis queue', async () => {
            // Setup
            const db = dbManager.getDb();
            const payload = { type: 'file-analysis-finding', message: 'test' };
            const result = db.prepare("INSERT INTO outbox (event_type, payload, status) VALUES (?, ?, ?)")
              .run('file-analysis-finding', JSON.stringify(payload), 'PENDING');
            const eventId = result.lastInsertRowid;

            // Action
            const publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
            await publisher.pollAndPublish(); // Run one cycle

            // Verification
            const relationshipQueue = queueManager.getQueue('relationship-resolution-queue');
            const jobCount = await relationshipQueue.getJobCountByTypes('waiting');
            expect(jobCount).toBe(1);

            const event = db.prepare("SELECT * FROM outbox WHERE id = ?").get(eventId);
            expect(event.status).toBe('PUBLISHED');
        }, 30000);
    });

    describe('E2E-04: GraphBuilder -> Neo4j Graph Creation', () => {
        it('should build a graph in Neo4j from SQLite data idempotently', async () => {
            // Setup: Seed SQLite with data
            const db = dbManager.getDb();
            // First, insert dummy POIs for the relationships to reference
            db.exec(`
                INSERT INTO pois (id, file_path, name, type, start_line, end_line, hash) VALUES
                (1, 'file1.js', 'poi-1', 'Function', 1, 1, 'hash1'),
                (2, 'file1.js', 'poi-2', 'Function', 2, 2, 'hash2'),
                (3, 'file1.js', 'poi-3', 'Function', 3, 3, 'hash3');
            `);
            db.exec(`
                INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, status) VALUES
                (1, 2, 'CALLS', 0.9, 'VALIDATED'),
                (2, 3, 'READS', 0.8, 'VALIDATED');
            `);

            // Action
            const graphBuilder = new GraphBuilder(db, neo4jDriver);
            await graphBuilder.run();

            // Verification 1
            const session1 = neo4jDriver.session({ database: config.NEO4J_DATABASE });
            const result1 = await session1.run('MATCH (n:POI) RETURN count(n) as count');
            expect(result1.records[0].get('count').low).toBe(3);
            const rels1 = await session1.run('MATCH ()-[r]->() RETURN count(r) as count');
            expect(rels1.records[0].get('count').low).toBe(2);
            await session1.close();

            // Idempotency Check
            await graphBuilder.run();
            const session2 = neo4jDriver.session({ database: config.NEO4J_DATABASE });
            const result2 = await session2.run('MATCH (n:POI) RETURN count(n) as count');
            expect(result2.records[0].get('count').low).toBe(3);
            const rels2 = await session2.run('MATCH ()-[r]->() RETURN count(r) as count');
            expect(rels2.records[0].get('count').low).toBe(2);
            await session2.close();
        }, 30000);
    });
});