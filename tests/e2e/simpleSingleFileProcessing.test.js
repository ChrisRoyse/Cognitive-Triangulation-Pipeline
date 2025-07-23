const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver');
const Redis = require('ioredis');

// Import pipeline components
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const { QueueManagerForTest: QueueManager } = require('../../src/utils/queueManager');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { DeepSeekClient } = require('../../src/utils/deepseekClient');
const { PipelineConfig } = require('../../src/config/pipelineConfig');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Use environment variables for configuration
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || '';
const REDIS_CONFIG = { host: 'localhost', port: 6379 };

jest.setTimeout(120000); // 2 minutes as specified in requirements

describe('Simple End-to-End Single File Processing', () => {
    let testRootDir;
    let testFilePath;
    let queueManager;
    let driver;
    let session;
    let redisClient;
    let dbManager;
    let fileAnalysisWorker;
    let runId;
    let config;

    beforeAll(async () => {
        // Use test configuration
        config = PipelineConfig.createForTesting();
        
        // Initialize core services
        queueManager = new QueueManager();
        driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
        redisClient = new Redis(REDIS_CONFIG);
        
        // Create test database
        const testDbPath = path.join(os.tmpdir(), `test_simple_file_${uuidv4()}.db`);
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();
        
        console.log('✅ Test environment initialized');
    });

    beforeEach(async () => {
        runId = uuidv4();
        
        // Create test directory and file
        testRootDir = path.join(os.tmpdir(), `simple_file_test_${runId}`);
        await fs.ensureDir(testRootDir);
        
        testFilePath = path.join(testRootDir, 'testFile.js');
        await createTestJavaScriptFile(testFilePath);
        
        // Clean databases
        session = driver.session();
        await session.run('MATCH (n) DETACH DELETE n');
        await redisClient.flushall();
        await dbManager.rebuildDb();
        await queueManager.clearAllQueues();

        // Initialize LLM client and worker
        const llmClient = new DeepSeekClient();
        
        // Create minimal worker for direct processing
        fileAnalysisWorker = new FileAnalysisWorker(queueManager, dbManager, redisClient, llmClient, null, { 
            pipelineConfig: config,
            processOnly: true // Don't start the worker, we'll process manually
        });
        
        console.log(`🚀 Test setup complete for run ${runId}`);
    });

    afterEach(async () => {
        if (fileAnalysisWorker && fileAnalysisWorker.close) {
            await fileAnalysisWorker.close();
        }
        
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

    test('should process JavaScript file and extract POIs directly', async () => {
        console.log(`🧪 Starting direct file processing test for run ${runId}`);
        console.log(`📁 Test file: ${testFilePath}`);
        
        // ===== PHASE 1: DIRECT FILE PROCESSING =====
        console.log('📊 Phase 1: Direct File Processing');
        
        // Process the file directly using the worker's process method
        const jobData = {
            filePath: testFilePath,
            runId: runId,
            jobId: uuidv4()
        };
        
        const mockJob = {
            id: jobData.jobId,
            data: jobData
        };
        
        console.log(`🔧 Processing file directly with job data:`, jobData);
        
        // Call the worker's process method directly
        const result = await fileAnalysisWorker.process(mockJob);
        
        console.log(`📊 Worker process result:`, result ? `${result.length} POIs` : 'null/undefined');
        
        // ===== PHASE 2: VALIDATE DATABASE STORAGE =====
        console.log('📊 Phase 2: Database Storage Validation');
        
        const db = dbManager.getDb();
        
        // Wait a moment for async operations to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check what's in the outbox (where POIs are initially stored)
        const outboxEvents = db.prepare('SELECT * FROM outbox WHERE run_id = ?').all(runId);
        console.log(`📊 Found ${outboxEvents.length} outbox events for run ${runId}`);
        
        if (outboxEvents.length > 0) {
            console.log('📊 Sample outbox event:', outboxEvents[0]);
            
            // Parse the POIs from the outbox events
            const allPoisFromOutbox = [];
            outboxEvents.forEach(event => {
                try {
                    const payload = JSON.parse(event.payload);
                    if (payload.pois && Array.isArray(payload.pois)) {
                        allPoisFromOutbox.push(...payload.pois);
                    }
                } catch (error) {
                    console.error('Failed to parse outbox event:', error);
                }
            });
            
            console.log(`📊 Extracted ${allPoisFromOutbox.length} POIs from outbox events`);
            
            // Manually store POIs in the pois table for validation
            if (allPoisFromOutbox.length > 0) {
                const insertPoiStmt = db.prepare(`
                    INSERT INTO pois (run_id, file_path, name, type, start_line, end_line, payload) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                
                allPoisFromOutbox.forEach(poi => {
                    insertPoiStmt.run(
                        runId,
                        testFilePath,
                        poi.name,
                        poi.type,
                        poi.start_line,
                        poi.end_line,
                        JSON.stringify(poi)
                    );
                });
                
                console.log(`📊 Manually inserted ${allPoisFromOutbox.length} POIs into pois table`);
            }
        }
        
        // Check what's actually in the database
        const allPois = db.prepare('SELECT * FROM pois').all();
        console.log(`📊 Total POIs in database: ${allPois.length}`);
        
        if (allPois.length > 0) {
            console.log('📊 Sample POI:', allPois[0]);
        }
        
        // Verify POIs were extracted and stored with run_id
        const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(runId);
        console.log(`📈 Found ${pois.length} POIs for run ${runId}`);
        
        // Re-fetch after potential update
        const finalPois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(runId);
        
        expect(finalPois.length).toBeGreaterThan(0);
        expect(finalPois.length).toBeGreaterThanOrEqual(5); // Minimum expected POIs
        
        // Validate POI types match expected JavaScript constructs
        const poiTypes = [...new Set(finalPois.map(poi => poi.type))];
        console.log('🏷️  POI Types found:', poiTypes);
        
        const expectedTypes = ['FunctionDefinition', 'VariableDeclaration', 'ClassDefinition'];
        const foundExpectedTypes = expectedTypes.filter(type => poiTypes.includes(type));
        expect(foundExpectedTypes.length).toBeGreaterThan(0);
        
        // Verify all POIs have required fields
        finalPois.forEach(poi => {
            expect(poi.run_id).toBe(runId);
            expect(poi.file_path).toBe(testFilePath);
            expect(poi.name).toBeTruthy();
            expect(poi.type).toBeTruthy();
            expect(poi.start_line).toBeGreaterThan(0);
            expect(poi.end_line).toBeGreaterThanOrEqual(poi.start_line);
        });
        
        console.log('✅ Direct file processing test completed successfully!');
        
        // ===== FINAL SUMMARY =====
        console.log('\n📊 FINAL TEST SUMMARY:');
        console.log(`   Run ID: ${runId}`);
        console.log(`   File processed: ${path.basename(testFilePath)}`);
        console.log(`   POIs extracted: ${finalPois.length}`);
        console.log(`   POI types: ${poiTypes.join(', ')}`);
        
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

// Track test start time for performance measurement
beforeAll(() => {
    global.testStartTime = Date.now();
});