const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver');
const Redis = require('ioredis');

// Import pipeline components
const EntityScout = require('../../src/agents/EntityScout');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const RelationshipResolutionWorker = require('../../src/workers/relationshipResolutionWorker');
const ValidationWorker = require('../../src/workers/ValidationWorker');
const GraphBuilderWorker = require('../../src/agents/GraphBuilder');
const QueueManager = require('../../src/utils/queueManager');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { DeepSeekClient } = require('../../src/utils/deepseekClient');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Use environment variables for configuration
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || '';
const REDIS_CONFIG = { host: 'localhost', port: 6379 };

jest.setTimeout(120000); // 2 minutes as specified in requirements

describe('End-to-End Single File Processing', () => {
    let testRootDir;
    let testFilePath;
    let queueManager;
    let driver;
    let session;
    let redisClient;
    let dbManager;
    let workers = [];
    let publisher;
    let runId;
    let config;

    beforeAll(async () => {
        // Use test configuration
        config = PipelineConfig.createForTesting();
        
        // Initialize core services
        queueManager = new QueueManager.QueueManagerForTest();
        driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
        redisClient = new Redis(REDIS_CONFIG);
        
        // Create test database
        const testDbPath = path.join(os.tmpdir(), `test_single_file_${uuidv4()}.db`);
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();
        
        console.log('✅ Test environment initialized');
    });

    beforeEach(async () => {
        runId = uuidv4();
        
        // Create test directory and file
        testRootDir = path.join(os.tmpdir(), `single_file_test_${runId}`);
        await fs.ensureDir(testRootDir);
        
        testFilePath = path.join(testRootDir, 'testFile.js');
        await createTestJavaScriptFile(testFilePath);
        
        // Clean databases
        session = driver.session();
        await session.run('MATCH (n) DETACH DELETE n');
        await redisClient.flushall();
        await dbManager.rebuildDb();
        await queueManager.clearAllQueues();

        // Initialize LLM client
        const llmClient = new DeepSeekClient();
        
        // Create workers with test configuration
        workers.push(new FileAnalysisWorker(queueManager, dbManager, redisClient, llmClient, null, { 
            pipelineConfig: config,
            processOnly: false 
        }));
        workers.push(new RelationshipResolutionWorker(queueManager, dbManager, llmClient, null, { 
            pipelineConfig: config 
        }));
        workers.push(new ValidationWorker(queueManager, dbManager, redisClient, { 
            pipelineConfig: config 
        }));
        workers.push(new GraphBuilderWorker(queueManager, driver, { 
            pipelineConfig: config 
        }));

        // Initialize transactional outbox publisher
        publisher = new TransactionalOutboxPublisher(dbManager, queueManager);
        publisher.start();
        
        console.log(`🚀 Test setup complete for run ${runId}`);
    });

    afterEach(async () => {
        // Cleanup workers and publisher
        if (publisher) {
            await publisher.stop();
        }
        
        for (const worker of workers) {
            if (worker.worker) {
                await worker.worker.close();
            }
            if (worker.close) {
                await worker.close();
            }
        }
        workers = [];
        
        if (session) {
            await session.close();
        }
        
        // Cleanup test files
        if (testRootDir && await fs.pathExists(testRootDir)) {
            await fs.remove(testRootDir);
        }
        
        console.log(`🧹 Test cleanup complete for run ${runId}`);
    });

    afterAll(async () => {
        // Close all connections
        await queueManager.closeConnections();
        await driver.close();
        await redisClient.quit();
        dbManager.close();
        
        console.log('✅ Test environment shutdown complete');
    });

    test('should process JavaScript file through complete pipeline', async () => {
        console.log(`🧪 Starting single file processing test for run ${runId}`);
        console.log(`📁 Test file: ${testFilePath}`);
        
        // ===== PHASE 1: FILE DISCOVERY AND ANALYSIS =====
        console.log('📊 Phase 1: File Discovery and Analysis');
        
        // Use EntityScout to discover and queue the single file
        const entityScout = new EntityScout(queueManager, redisClient, testRootDir, runId);
        await entityScout.run();
        
        // Wait for file analysis to complete
        await waitForQueueDrained(queueManager, 'file-analysis-queue', 30000);
        
        // ===== PHASE 2: VALIDATE SQLITE DATA =====
        console.log('📊 Phase 2: SQLite Data Validation');
        
        const db = dbManager.getDb();
        
        // Wait for events to be processed by the TransactionalOutboxPublisher
        await waitForCondition(async () => {
            const publishedEvents = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status = 'PUBLISHED'").get(runId);
            return publishedEvents.count > 0;
        }, 45000);
        
        // Verify POIs were extracted and stored with run_id
        const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(runId);
        console.log(`📈 Found ${pois.length} POIs for run ${runId}`);
        
        expect(pois.length).toBeGreaterThan(0);
        expect(pois.length).toBeGreaterThanOrEqual(5); // Minimum expected POIs
        
        // Validate POI types match expected JavaScript constructs
        const poiTypes = [...new Set(pois.map(poi => poi.type))];
        console.log('🏷️  POI Types found:', poiTypes);
        
        const expectedTypes = ['FunctionDefinition', 'VariableDeclaration', 'ClassDefinition', 'ImportStatement'];
        const foundExpectedTypes = expectedTypes.filter(type => poiTypes.includes(type));
        expect(foundExpectedTypes.length).toBeGreaterThan(0);
        
        // Verify all POIs have required fields
        pois.forEach(poi => {
            expect(poi.run_id).toBe(runId);
            expect(poi.file_path).toBe(testFilePath);
            expect(poi.name).toBeTruthy();
            expect(poi.type).toBeTruthy();
            expect(poi.start_line).toBeGreaterThan(0);
            expect(poi.end_line).toBeGreaterThanOrEqual(poi.start_line);
        });
        
        // ===== PHASE 3: RELATIONSHIP PROCESSING =====
        console.log('📊 Phase 3: Relationship Processing');
        
        // Wait for relationship resolution
        await waitForQueueDrained(queueManager, 'relationship-resolution-queue', 45000);
        
        // Verify relationships were detected and stored
        const relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(runId);
        console.log(`🔗 Found ${relationships.length} relationships for run ${runId}`);
        
        expect(relationships.length).toBeGreaterThan(0);
        expect(relationships.length).toBeGreaterThanOrEqual(2); // Minimum expected relationships
        
        // Validate foreign key relationships work correctly
        relationships.forEach(rel => {
            expect(rel.run_id).toBe(runId);
            expect(rel.source_poi_id).toBeTruthy();
            expect(rel.target_poi_id).toBeTruthy();
            expect(rel.type).toBeTruthy();
            
            // Verify foreign key integrity
            const sourcePoi = db.prepare('SELECT * FROM pois WHERE id = ? AND run_id = ?').get(rel.source_poi_id, runId);
            const targetPoi = db.prepare('SELECT * FROM pois WHERE id = ? AND run_id = ?').get(rel.target_poi_id, runId);
            
            expect(sourcePoi).toBeTruthy();
            expect(targetPoi).toBeTruthy();
        });
        
        // ===== PHASE 4: VALIDATION PROCESSING =====
        console.log('📊 Phase 4: Validation Processing');
        
        // Wait for validation to complete
        await waitForQueueDrained(queueManager, 'validation-queue', 30000);
        
        // ===== PHASE 5: GRAPH INGESTION =====
        console.log('📊 Phase 5: Graph Ingestion');
        
        // Wait for all outbox events to be published to graph ingestion
        await waitForCondition(async () => {
            const pendingEvents = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status != 'PUBLISHED'").get(runId);
            return pendingEvents.count === 0;
        }, 60000);
        
        // Wait for graph ingestion to complete
        await waitForQueueDrained(queueManager, 'graph-ingestion-queue', 45000);
        
        // ===== PHASE 6: NEO4J DATA VALIDATION =====
        console.log('📊 Phase 6: Neo4j Data Validation');
        
        // Verify data flows correctly to Neo4j graph
        const graphStats = await session.run(
            `MATCH (n) WHERE n.run_id = $runId
             WITH count(DISTINCT n) AS nodes
             MATCH ()-[r]-() WHERE r.run_id = $runId
             RETURN nodes, count(DISTINCT r) AS relationships`,
            { runId }
        );
        
        const nodeCount = graphStats.records[0].get('nodes').toNumber();
        const relationshipCount = graphStats.records[0].get('relationships').toNumber();
        
        console.log(`📊 Neo4j Results: ${nodeCount} nodes, ${relationshipCount} relationships`);
        
        expect(nodeCount).toBeGreaterThan(0);
        expect(nodeCount).toBeGreaterThanOrEqual(pois.length); // At least as many nodes as POIs
        expect(relationshipCount).toBeGreaterThan(0);
        expect(relationshipCount).toBeGreaterThanOrEqual(relationships.length); // At least as many relationships
        
        // Verify specific node types exist in Neo4j
        const nodeTypes = await session.run(
            `MATCH (n) WHERE n.run_id = $runId 
             RETURN DISTINCT labels(n) as labels, count(n) as count`,
            { runId }
        );
        
        const graphNodeTypes = nodeTypes.records.map(record => ({
            labels: record.get('labels'),
            count: record.get('count').toNumber()
        }));
        
        console.log('🏷️  Neo4j Node Types:', graphNodeTypes);
        
        // Verify we have function and/or class nodes
        const hasComplexNodes = graphNodeTypes.some(nodeType => 
            nodeType.labels.some(label => ['Function', 'Class', 'Variable'].includes(label))
        );
        expect(hasComplexNodes).toBe(true);
        
        // ===== PHASE 7: DATA CONSISTENCY VALIDATION =====
        console.log('📊 Phase 7: Data Consistency Validation');
        
        // Verify no failed jobs in any queue
        const queueNames = ['file-analysis-queue', 'relationship-resolution-queue', 'validation-queue', 'graph-ingestion-queue'];
        for (const queueName of queueNames) {
            const queue = queueManager.getQueue(queueName);
            const failedCount = await queue.getJobCounts('failed');
            expect(failedCount.failed).toBe(0);
        }
        
        // Verify all outbox events were successfully published
        const unpublishedEvents = db.prepare("SELECT COUNT(*) as count FROM outbox WHERE run_id = ? AND status != 'PUBLISHED'").get(runId);
        expect(unpublishedEvents.count).toBe(0);
        
        // ===== PHASE 8: PERFORMANCE VALIDATION =====
        console.log('📊 Phase 8: Performance Validation');
        
        // Test completed within 2 minutes (handled by Jest timeout)
        // Verify minimum relationship ratio (relationships per node)
        const relationshipRatio = relationshipCount / nodeCount;
        console.log(`📈 Relationship ratio: ${relationshipRatio.toFixed(2)} relationships per node`);
        
        // For a single file, we expect a reasonable relationship density
        expect(relationshipRatio).toBeGreaterThan(0.5); // At least 0.5 relationships per node
        
        console.log('✅ Single file processing pipeline test completed successfully!');
        
        // ===== FINAL SUMMARY =====
        console.log('\n📊 FINAL TEST SUMMARY:');
        console.log(`   Run ID: ${runId}`);
        console.log(`   File processed: ${path.basename(testFilePath)}`);
        console.log(`   SQLite POIs: ${pois.length}`);
        console.log(`   SQLite Relationships: ${relationships.length}`);
        console.log(`   Neo4j Nodes: ${nodeCount}`);
        console.log(`   Neo4j Relationships: ${relationshipCount}`);
        console.log(`   Relationship Ratio: ${relationshipRatio.toFixed(2)}`);
        console.log(`   Test Duration: ${(Date.now() - global.testStartTime) / 1000}s`);
        
    }, 120000); // 2 minutes timeout as specified
});

/**
 * Creates a realistic JavaScript test file with various POI types
 */
async function createTestJavaScriptFile(filePath) {
    const content = `// Test JavaScript file for single file processing
const fs = require('fs');
const path = require('path');

// Class definition with various methods
class DataProcessor {
    constructor(config) {
        this.config = config;
        this.cache = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the data processor
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        
        this.initialized = true;
        await this.loadConfiguration();
    }

    /**
     * Load configuration from file
     */
    async loadConfiguration() {
        try {
            const configPath = path.join(__dirname, 'config.json');
            const configData = await fs.promises.readFile(configPath, 'utf8');
            this.config = JSON.parse(configData);
        } catch (error) {
            console.error('Failed to load configuration:', error);
            throw error;
        }
    }

    /**
     * Process data with caching
     */
    processData(inputData) {
        const cacheKey = this.generateCacheKey(inputData);
        
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        
        const result = this.transformData(inputData);
        this.cache.set(cacheKey, result);
        
        return result;
    }

    /**
     * Transform input data
     */
    transformData(data) {
        return data.map(item => ({
            ...item,
            processed: true,
            timestamp: Date.now()
        }));
    }

    /**
     * Generate cache key from input
     */
    generateCacheKey(data) {
        return JSON.stringify(data).substring(0, 50);
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
    }
}

// Factory function
function createProcessor(config) {
    return new DataProcessor(config);
}

// Utility functions
const validateInput = (input) => {
    return input && typeof input === 'object' && Array.isArray(input);
};

const formatOutput = (data) => {
    return {
        success: true,
        data: data,
        count: data.length
    };
};

// Constants
const DEFAULT_CONFIG = {
    cacheSize: 1000,
    timeout: 5000,
    retries: 3
};

const SUPPORTED_FORMATS = ['json', 'xml', 'csv'];

// Export functionality
module.exports = {
    DataProcessor,
    createProcessor,
    validateInput,
    formatOutput,
    DEFAULT_CONFIG,
    SUPPORTED_FORMATS
};
`;

    await fs.writeFile(filePath, content);
    console.log(`📄 Created test JavaScript file: ${filePath}`);
}

/**
 * Wait for a queue to be completely drained
 */
async function waitForQueueDrained(queueManager, queueName, timeout = 30000) {
    const startTime = Date.now();
    console.log(`⏳ Waiting for queue '${queueName}' to drain...`);

    while (Date.now() - startTime < timeout) {
        const queue = queueManager.getQueue(queueName);
        const jobCounts = await queue.getJobCounts('wait', 'active', 'delayed');
        
        if (jobCounts.wait === 0 && jobCounts.active === 0 && jobCounts.delayed === 0) {
            console.log(`✅ Queue '${queueName}' is drained`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay to ensure processing
            return;
        }
        
        console.log(`   📊 ${queueName}: ${jobCounts.wait} waiting, ${jobCounts.active} active, ${jobCounts.delayed} delayed`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`⏰ Timeout waiting for queue '${queueName}' to drain after ${timeout}ms`);
}

/**
 * Wait for a condition to be met
 */
async function waitForCondition(conditionFn, timeout = 30000, interval = 1000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        if (await conditionFn()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error(`⏰ Timeout waiting for condition to be met after ${timeout}ms`);
}

// Track test start time for performance measurement
beforeAll(() => {
    global.testStartTime = Date.now();
});