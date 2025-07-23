const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver');
const Redis = require('ioredis');
const EntityScout = require('../../../src/agents/EntityScout');
const FileAnalysisWorker = require('../../../src/workers/fileAnalysisWorker');
const DirectoryAggregationWorker = require('../../../src/workers/directoryAggregationWorker');
const GlobalResolutionWorker = require('../../../src/workers/globalResolutionWorker');
const RelationshipResolutionWorker = require('../../../src/workers/relationshipResolutionWorker');
const ValidationWorker = require('../../../src/workers/ValidationWorker');
const GraphBuilderWorker = require('../../../src/agents/GraphBuilder');
const QueueManager = require('../../../src/utils/queueManager');
const { DatabaseManager } = require('../../../src/utils/sqliteDb');
const { DeepSeekClient } = require('../../../src/utils/deepseekClient');
const TransactionalOutboxPublisher = require('../../../src/services/TransactionalOutboxPublisher');

const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, REDIS_CONFIG, SQLITE_DB_PATH } = global.config;

jest.mock('../../../src/utils/logger');
jest.setTimeout(150000);

describe('End-to-End Pipeline Test with Data Integrity Checks', () => {
    let testRootDir;
    let queueManager;
    let driver;
    let session;
    let redisClient;
    let dbManager;
    let workers = [];
    let publisher;
    let runId;

    beforeAll(async () => {
        queueManager = new QueueManager();
        driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
        redisClient = new Redis(REDIS_CONFIG);
        dbManager = new DatabaseManager(SQLITE_DB_PATH);
    });

    beforeEach(async () => {
        runId = uuidv4();
        testRootDir = path.resolve(__dirname, '../../../polyglot-test');
        
        session = driver.session();
        await session.run('MATCH (n) DETACH DELETE n');
        await redisClient.flushall();
        dbManager.rebuildDb();
        await queueManager.clearAllQueues();

        const llmClient = new DeepSeekClient();
        
        workers.push(new FileAnalysisWorker(queueManager, dbManager, redisClient, llmClient));
        workers.push(new DirectoryAggregationWorker(queueManager, redisClient));
        workers.push(new RelationshipResolutionWorker(queueManager, dbManager, llmClient));
        workers.push(new GlobalResolutionWorker(queueManager, llmClient, dbManager));
        workers.push(new ValidationWorker(queueManager, dbManager, redisClient));
        workers.push(new GraphBuilderWorker(queueManager, driver));

        publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
        publisher.start();
    });

    afterEach(async () => {
        if (publisher) {
            await publisher.stop();
        }
        for (const worker of workers) {
            if (worker.worker) {
                await worker.worker.close();
            }
        }
        workers = [];
        if (session) {
            await session.close();
        }
    });

    afterAll(async () => {
        await queueManager.closeConnections();
        await driver.close();
        await redisClient.quit();
        dbManager.close();
    });

    test('E2E-03: Should run against polyglot-test and validate data integrity', async () => {
        const entityScout = new EntityScout(queueManager, redisClient, testRootDir, runId);
        await entityScout.run();

        // Wait for the entire pipeline to finish
        const allQueues = [
            'file-analysis-queue',
            'relationship-resolution-queue',
            'analysis-findings-queue',
            'global-resolution-queue',
            'reconciliation-queue'
        ];
        await waitForQueuesDrained(queueManager, allQueues, 1800000); // 30 minute timeout

        // --- Data Integrity Assertions ---

        // --- Comprehensive State-of-the-World Assertions ---

        // 1. Assert SQLite State: All outbox events are published
        const db = dbManager.getDb();
        const pendingOrFailedEvents = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status != 'PUBLISHED'").get(runId);
        expect(pendingOrFailedEvents.count).toBe(0);

        const pythonEvent = db.prepare("SELECT * FROM outbox WHERE run_id = ? AND payload LIKE '%database_client.py%' AND event_type = 'file-analysis-finding'").get(runId);
        expect(pythonEvent).toBeDefined();

        // 2. Assert Redis State: No failed jobs
        const failedJobsQueue = queueManager.getQueue('failed-jobs');
        const failedJobCount = await failedJobsQueue.getJobCount();
        if (failedJobCount > 0) {
            const failedJobs = await failedJobsQueue.getJobs(['active', 'wait', 'completed'], 0, failedJobCount);
            console.error('Failed jobs found:', JSON.stringify(failedJobs, null, 2));
        }
        expect(failedJobCount).toBe(0);
        const relationshipQueue = queueManager.getQueue('relationship-resolution-queue');
        const completedJobs = await relationshipQueue.getCompleted();
        const pythonJob = completedJobs.find(j => j.data.filePath.includes('database_client.py'));
        expect(pythonJob).toBeDefined();

        // 3. Assert Neo4j State: Graph is correctly formed
        const graphStats = await session.run(
            `MATCH (n) WHERE n.run_id = $runId
             WITH count(DISTINCT n) AS nodes
             MATCH ()-[r]-() WHERE r.run_id = $runId
             RETURN nodes, count(DISTINCT r) AS relationships`,
            { runId }
        );
        expect(graphStats.records[0].get('nodes')).toBeGreaterThan(20);
        expect(graphStats.records[0].get('relationships')).toBeGreaterThan(10);

        const specificRelationship = await session.run(
            `MATCH (pyClass:Class {name: 'DatabaseClient'})-[r:CALLS]->(pyFunc:Function {name: 'process_data'})
             WHERE pyClass.run_id = $runId AND pyFunc.run_id = $runId
             RETURN r`,
            { runId }
        );
        expect(specificRelationship.records.length).toBeGreaterThan(0);
    }, 1800000); // 30 minute test timeout
});

async function waitForQueuesDrained(queueManager, queueNames, timeout = 1800000, interval = 1000) { // Default to 30 minutes
    const startTime = Date.now();
    console.log(`[TestUtil] Waiting for queues to drain: ${queueNames.join(', ')}`);

    while (Date.now() - startTime < timeout) {
        const jobCounts = await Promise.all(
            queueNames.map(name => queueManager.getQueue(name).getJobCounts('wait', 'active', 'delayed'))
        );

        const allQueuesEmpty = jobCounts.every(counts =>
            counts.wait === 0 && counts.active === 0 && counts.delayed === 0
        );

        if (allQueuesEmpty) {
            console.log(`[TestUtil] All specified queues are drained.`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return;
        }

        await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`[TestUtil] Timed out waiting for queues to drain: ${queueNames.join(', ')}`);
}

async function waitForCondition(conditionFn, timeout = 10000, interval = 500) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (await conditionFn()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`[TestUtil] Timed out waiting for condition to be met.`);
}