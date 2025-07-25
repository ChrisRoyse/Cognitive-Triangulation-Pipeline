/**
 * Enhanced Integration Test Utilities
 * 
 * Comprehensive utilities for setting up realistic integration test scenarios
 * that validate the pipeline fixes work together correctly.
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getDriver: getNeo4jDriver } = require('../../src/utils/neo4jDriver');
const { getCacheClient } = require('../../src/utils/cacheClient');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');
const TransactionalOutboxPublisher = require('../../src/services/TransactionalOutboxPublisher');

/**
 * Comprehensive Test Environment Manager
 */
class IntegrationTestEnvironment {
    constructor(options = {}) {
        this.testId = options.testId || uuidv4();
        this.runId = options.runId || uuidv4();
        this.environment = options.environment || 'test';
        this.cleanup = options.cleanup !== false;
        this.verbose = options.verbose || false;
        
        this.components = {};
        this.testDataDir = null;
        this.isInitialized = false;
        this.cleanupTasks = [];
    }

    /**
     * Initialize complete test environment
     */
    async initialize() {
        if (this.isInitialized) {
            throw new Error('Test environment already initialized');
        }

        try {
            this.log('Initializing integration test environment...');
            
            // Create test data directory
            this.testDataDir = path.join(__dirname, `integration-test-${this.testId}`);
            await fs.ensureDir(this.testDataDir);
            this.addCleanupTask(() => fs.remove(this.testDataDir));

            // Initialize configuration
            this.components.config = new PipelineConfig({ environment: this.environment });
            
            // Initialize database
            const testDbPath = path.join(this.testDataDir, 'integration-test.db');
            this.components.dbManager = new DatabaseManager(testDbPath);
            await this.components.dbManager.initializeDb();
            this.addCleanupTask(() => this.components.dbManager.close());

            // Initialize queue manager
            this.components.queueManager = getQueueManagerInstance();
            await this.components.queueManager.connect();
            this.addCleanupTask(() => this.components.queueManager.closeConnections());

            // Initialize Neo4j driver
            this.components.neo4jDriver = getNeo4jDriver();
            this.addCleanupTask(() => this.components.neo4jDriver.close());

            // Initialize cache client
            this.components.cacheClient = getCacheClient();

            // Initialize LLM client
            this.components.llmClient = getDeepseekClient();

            // Initialize worker pool manager
            this.components.workerPoolManager = new WorkerPoolManager({
                maxGlobalConcurrency: 10,
                environment: this.environment
            });

            // Initialize outbox publisher
            this.components.outboxPublisher = new TransactionalOutboxPublisher(
                this.components.dbManager,
                this.components.queueManager
            );
            this.addCleanupTask(() => this.components.outboxPublisher.stop());

            this.isInitialized = true;
            this.log(`Test environment initialized with runId: ${this.runId}`);
            
        } catch (error) {
            await this.cleanup();
            throw error;
        }
    }

    /**
     * Clean up test environment
     */
    async cleanup() {
        this.log('Cleaning up integration test environment...');
        
        // Clear queues first
        if (this.components.queueManager) {
            try {
                await this.components.queueManager.clearAllQueues();
            } catch (error) {
                this.log(`Warning: Queue cleanup failed: ${error.message}`);
            }
        }

        // Clear Neo4j test data
        if (this.components.neo4jDriver) {
            try {
                const session = this.components.neo4jDriver.session();
                try {
                    await session.run('MATCH (n) WHERE n.runId = $runId DETACH DELETE n', { runId: this.runId });
                } finally {
                    await session.close();
                }
            } catch (error) {
                this.log(`Warning: Neo4j cleanup failed: ${error.message}`);
            }
        }

        // Clear database tables
        if (this.components.dbManager) {
            try {
                const db = this.components.dbManager.getDb();
                const tables = ['pois', 'relationships', 'outbox', 'files'];
                for (const table of tables) {
                    try {
                        db.prepare(`DELETE FROM ${table}`).run();
                    } catch (error) {
                        this.log(`Warning: Could not clear table ${table}: ${error.message}`);
                    }
                }
            } catch (error) {
                this.log(`Warning: Database cleanup failed: ${error.message}`);
            }
        }

        // Execute cleanup tasks in reverse order
        for (let i = this.cleanupTasks.length - 1; i >= 0; i--) {
            try {
                await this.cleanupTasks[i]();
            } catch (error) {
                this.log(`Warning: Cleanup task failed: ${error.message}`);
            }
        }

        this.isInitialized = false;
        this.log('Test environment cleanup completed');
    }

    /**
     * Add cleanup task
     */
    addCleanupTask(task) {
        this.cleanupTasks.push(task);
    }

    /**
     * Get component by name
     */
    get(componentName) {
        if (!this.isInitialized) {
            throw new Error('Test environment not initialized');
        }
        
        if (!this.components[componentName]) {
            throw new Error(`Component '${componentName}' not found`);
        }
        
        return this.components[componentName];
    }

    /**
     * Get test data directory
     */
    getTestDataDir() {
        return this.testDataDir;
    }

    /**
     * Get run ID
     */
    getRunId() {
        return this.runId;
    }

    /**
     * Log message if verbose
     */
    log(message) {
        if (this.verbose) {
            console.log(`[IntegrationTest:${this.testId}] ${message}`);
        }
    }
}

/**
 * Realistic Test Data Generator
 */
class TestDataGenerator {
    constructor(environment) {
        this.environment = environment;
    }

    /**
     * Create realistic code files for testing
     */
    async createRealisticCodebase(baseDir, options = {}) {
        const {
            numFiles = 5,
            complexity = 'medium',
            includeCrossFileRefs = true,
            includeInvalidFiles = false
        } = options;

        const files = [];
        
        // Create main application files
        const appFiles = await this._createApplicationFiles(baseDir, numFiles, complexity);
        files.push(...appFiles);

        // Create utility files
        const utilFiles = await this._createUtilityFiles(baseDir, complexity);
        files.push(...utilFiles);

        // Create configuration files
        const configFiles = await this._createConfigurationFiles(baseDir);
        files.push(...configFiles);

        // Add cross-file references if requested
        if (includeCrossFileRefs) {
            await this._addCrossFileReferences(baseDir, files);
        }

        // Add invalid files if requested (for testing filtering)
        if (includeInvalidFiles) {
            const invalidFiles = await this._createInvalidFiles(baseDir);
            files.push(...invalidFiles);
        }

        return files;
    }

    /**
     * Create application files
     */
    async _createApplicationFiles(baseDir, numFiles, complexity) {
        const files = [];
        const complexityMultiplier = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3;

        for (let i = 0; i < numFiles; i++) {
            const fileName = `app-module-${i}.js`;
            const filePath = path.join(baseDir, 'src', fileName);
            
            let content = `// Application Module ${i}\n\n`;
            
            // Add classes
            for (let c = 0; c < complexityMultiplier; c++) {
                content += `class Module${i}Class${c} {\n`;
                content += `    constructor(options = {}) {\n`;
                content += `        this.options = options;\n`;
                content += `        this.initialized = false;\n`;
                content += `    }\n\n`;
                
                // Add methods
                for (let m = 0; m < complexityMultiplier + 1; m++) {
                    content += `    method${c}${m}(param1, param2) {\n`;
                    content += `        if (!this.initialized) {\n`;
                    content += `            throw new Error('Module not initialized');\n`;
                    content += `        }\n`;
                    content += `        return this._processData(param1, param2);\n`;
                    content += `    }\n\n`;
                }
                
                content += `    _processData(data1, data2) {\n`;
                content += `        return { combined: data1 + data2, timestamp: Date.now() };\n`;
                content += `    }\n`;
                content += `}\n\n`;
            }
            
            // Add standalone functions
            for (let f = 0; f < complexityMultiplier; f++) {
                content += `function module${i}Function${f}(input) {\n`;
                content += `    const processed = input.map(item => ({\n`;
                content += `        ...item,\n`;
                content += `        processed: true,\n`;
                content += `        moduleId: ${i},\n`;
                content += `        functionId: ${f}\n`;
                content += `    }));\n`;
                content += `    return processed;\n`;
                content += `}\n\n`;
            }
            
            // Add constants
            content += `const MODULE_${i}_CONFIG = {\n`;
            content += `    version: '1.0.${i}',\n`;
            content += `    enabled: true,\n`;
            content += `    debug: process.env.NODE_ENV === 'development'\n`;
            content += `};\n\n`;
            
            // Add exports
            content += `module.exports = {\n`;
            for (let c = 0; c < complexityMultiplier; c++) {
                content += `    Module${i}Class${c},\n`;
            }
            for (let f = 0; f < complexityMultiplier; f++) {
                content += `    module${i}Function${f},\n`;
            }
            content += `    MODULE_${i}_CONFIG\n`;
            content += `};\n`;

            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content);
            
            files.push({
                path: fileName,
                fullPath: filePath,
                type: 'application',
                complexity,
                classCount: complexityMultiplier,
                functionCount: complexityMultiplier
            });
        }

        return files;
    }

    /**
     * Create utility files
     */
    async _createUtilityFiles(baseDir, complexity) {
        const files = [];
        
        // String utilities
        const stringUtilsPath = path.join(baseDir, 'src/utils', 'stringUtils.js');
        const stringUtilsContent = `
// String Utility Functions

function capitalizeString(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\\s+/g, '-')
        .replace(/[^\\w\\-]+/g, '');
}

function truncateString(str, maxLength, suffix = '...') {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const STRING_CONSTANTS = {
    DEFAULT_SEPARATOR: '-',
    MAX_LENGTH: 255,
    ESCAPE_CHARS: ['&', '<', '>', '"', "'"]
};

module.exports = {
    capitalizeString,
    slugify,
    truncateString,
    escapeHtml,
    STRING_CONSTANTS
};
`;

        // Math utilities
        const mathUtilsPath = path.join(baseDir, 'src/utils', 'mathUtils.js');
        const mathUtilsContent = `
// Mathematical Utility Functions

function calculateAverage(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) {
        throw new Error('Input must be a non-empty array');
    }
    
    const sum = numbers.reduce((acc, num) => acc + num, 0);
    return sum / numbers.length;
}

function findMinMax(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) {
        return { min: null, max: null };
    }
    
    return {
        min: Math.min(...numbers),
        max: Math.max(...numbers)
    };
}

function generateRange(start, end, step = 1) {
    const range = [];
    for (let i = start; i < end; i += step) {
        range.push(i);
    }
    return range;
}

class StatisticsCalculator {
    constructor(data = []) {
        this.data = data;
    }
    
    addValue(value) {
        this.data.push(value);
    }
    
    getMean() {
        return calculateAverage(this.data);
    }
    
    getMedian() {
        const sorted = [...this.data].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }
    
    getStandardDeviation() {
        const mean = this.getMean();
        const squaredDiffs = this.data.map(value => Math.pow(value - mean, 2));
        const avgSquaredDiff = calculateAverage(squaredDiffs);
        return Math.sqrt(avgSquaredDiff);
    }
}

const MATH_CONSTANTS = {
    PRECISION: 6,
    PI_EXTENDED: 3.141592653589793
};

module.exports = {
    calculateAverage,
    findMinMax,
    generateRange,
    StatisticsCalculator,
    MATH_CONSTANTS
};
`;

        await fs.ensureDir(path.dirname(stringUtilsPath));
        await fs.writeFile(stringUtilsPath, stringUtilsContent.trim());
        
        await fs.ensureDir(path.dirname(mathUtilsPath));
        await fs.writeFile(mathUtilsPath, mathUtilsContent.trim());

        files.push(
            {
                path: 'src/utils/stringUtils.js',
                fullPath: stringUtilsPath,
                type: 'utility',
                category: 'string-processing'
            },
            {
                path: 'src/utils/mathUtils.js',
                fullPath: mathUtilsPath,
                type: 'utility',
                category: 'mathematics'
            }
        );

        return files;
    }

    /**
     * Create configuration files
     */
    async _createConfigurationFiles(baseDir) {
        const files = [];
        
        // Application config
        const configPath = path.join(baseDir, 'src/config', 'appConfig.js');
        const configContent = `
// Application Configuration

const CONFIG_ENVIRONMENTS = {
    development: {
        debug: true,
        logLevel: 'debug',
        apiUrl: 'http://localhost:3000',
        databaseUrl: 'sqlite://./dev.db'
    },
    test: {
        debug: false,
        logLevel: 'error',
        apiUrl: 'http://localhost:3001',
        databaseUrl: 'sqlite://./test.db'
    },
    production: {
        debug: false,
        logLevel: 'warn',
        apiUrl: process.env.API_URL,
        databaseUrl: process.env.DATABASE_URL
    }
};

function getConfig(environment = 'development') {
    const config = CONFIG_ENVIRONMENTS[environment];
    if (!config) {
        throw new Error(\`Unknown environment: \${environment}\`);
    }
    return config;
}

function validateConfig(config) {
    const required = ['apiUrl', 'databaseUrl'];
    for (const field of required) {
        if (!config[field]) {
            throw new Error(\`Missing required config field: \${field}\`);
        }
    }
    return true;
}

class ConfigManager {
    constructor(environment) {
        this.environment = environment;
        this.config = getConfig(environment);
        validateConfig(this.config);
    }
    
    get(key) {
        return this.config[key];
    }
    
    set(key, value) {
        this.config[key] = value;
    }
    
    reload() {
        this.config = getConfig(this.environment);
        validateConfig(this.config);
    }
}

const DEFAULT_CONFIG = getConfig('development');

module.exports = {
    CONFIG_ENVIRONMENTS,
    getConfig,
    validateConfig,
    ConfigManager,
    DEFAULT_CONFIG
};
`;

        await fs.ensureDir(path.dirname(configPath));
        await fs.writeFile(configPath, configContent.trim());

        files.push({
            path: 'src/config/appConfig.js',
            fullPath: configPath,
            type: 'configuration',
            category: 'application-config'
        });

        return files;
    }

    /**
     * Add cross-file references
     */
    async _addCrossFileReferences(baseDir, files) {
        // Create an index file that imports from other files
        const indexPath = path.join(baseDir, 'src', 'index.js');
        let indexContent = `// Main Application Entry Point\n\n`;
        
        // Import utilities
        indexContent += `const { capitalizeString, slugify } = require('./utils/stringUtils');\n`;
        indexContent += `const { calculateAverage, StatisticsCalculator } = require('./utils/mathUtils');\n`;
        indexContent += `const { getConfig, ConfigManager } = require('./config/appConfig');\n\n`;
        
        // Import application modules
        const appFiles = files.filter(f => f.type === 'application');
        for (let i = 0; i < Math.min(appFiles.length, 3); i++) {
            indexContent += `const module${i} = require('./${appFiles[i].path.replace('.js', '')}');\n`;
        }
        
        indexContent += `\nclass ApplicationBootstrap {\n`;
        indexContent += `    constructor() {\n`;
        indexContent += `        this.config = new ConfigManager(process.env.NODE_ENV || 'development');\n`;
        indexContent += `        this.modules = [];\n`;
        indexContent += `        this.stats = new StatisticsCalculator();\n`;
        indexContent += `    }\n\n`;
        
        indexContent += `    initialize() {\n`;
        indexContent += `        console.log('Initializing application...');\n`;
        indexContent += `        \n`;
        for (let i = 0; i < Math.min(appFiles.length, 3); i++) {
            indexContent += `        // Initialize module ${i}\n`;
            indexContent += `        const mod${i} = new module${i}.Module${i}Class0(this.config.get('debug'));\n`;
            indexContent += `        this.modules.push(mod${i});\n`;
        }
        indexContent += `        \n`;
        indexContent += `        console.log(\`Initialized \${this.modules.length} modules\`);\n`;
        indexContent += `    }\n\n`;
        
        indexContent += `    processData(data) {\n`;
        indexContent += `        const processedData = data.map(item => {\n`;
        indexContent += `            const slug = slugify(item.name || 'unnamed');\n`;
        indexContent += `            const title = capitalizeString(item.title || '');\n`;
        indexContent += `            return { ...item, slug, title };\n`;
        indexContent += `        });\n`;
        indexContent += `        \n`;
        indexContent += `        const values = processedData.map(item => item.value || 0);\n`;
        indexContent += `        const average = calculateAverage(values);\n`;
        indexContent += `        this.stats.addValue(average);\n`;
        indexContent += `        \n`;
        indexContent += `        return { processedData, average };\n`;
        indexContent += `    }\n`;
        indexContent += `}\n\n`;
        
        indexContent += `module.exports = { ApplicationBootstrap };\n`;

        await fs.writeFile(indexPath, indexContent);
        
        files.push({
            path: 'src/index.js',
            fullPath: indexPath,
            type: 'main',
            category: 'bootstrap',
            crossFileRefs: true
        });
    }

    /**
     * Create invalid files for testing filtering
     */
    async _createInvalidFiles(baseDir) {
        const files = [];
        
        // Create .git directory
        const gitDir = path.join(baseDir, '.git');
        await fs.ensureDir(gitDir);
        await fs.writeFile(path.join(gitDir, 'config'), 'git config content');
        
        // Create non-code files
        const nonCodeFiles = [
            { name: 'README.md', content: '# Test Project\n\nThis is a test project.' },
            { name: 'package.json', content: '{"name": "test", "version": "1.0.0"}' },
            { name: 'data.json', content: '{"test": true}' },
            { name: 'image.png', content: 'binary data' },
            { name: '.env', content: 'NODE_ENV=test' }
        ];
        
        for (const file of nonCodeFiles) {
            const filePath = path.join(baseDir, file.name);
            await fs.writeFile(filePath, file.content);
            
            files.push({
                path: file.name,
                fullPath: filePath,
                type: 'invalid',
                reason: 'non-code-file'
            });
        }
        
        return files;
    }
}

/**
 * Mock LLM Response Generator
 */
class MockLLMResponseGenerator {
    constructor() {
        this.responseTemplates = {
            simple: {
                entities: 1,
                relationships: 0
            },
            medium: {
                entities: 3,
                relationships: 2
            },
            complex: {
                entities: 5,
                relationships: 4
            }
        };
    }

    /**
     * Generate mock LLM response based on file content
     */
    generateResponse(filePath, content, complexity = 'medium') {
        const template = this.responseTemplates[complexity];
        const entities = [];
        const relationships = [];
        
        // Extract actual function/class names from content for realism
        const functionMatches = content.match(/function\s+(\w+)/g) || [];
        const classMatches = content.match(/class\s+(\w+)/g) || [];
        const constMatches = content.match(/const\s+(\w+)/g) || [];
        
        let entityCount = 0;
        
        // Add functions
        for (const match of functionMatches.slice(0, template.entities)) {
            const name = match.replace('function ', '');
            entities.push({
                name,
                type: 'function',
                startLine: Math.floor(Math.random() * 50) + 1,
                endLine: Math.floor(Math.random() * 50) + 10,
                description: `Function ${name} from ${filePath}`,
                isExported: Math.random() > 0.5
            });
            entityCount++;
        }
        
        // Add classes
        for (const match of classMatches.slice(0, template.entities - entityCount)) {
            const name = match.replace('class ', '');
            entities.push({
                name,
                type: 'class',
                startLine: Math.floor(Math.random() * 50) + 1,
                endLine: Math.floor(Math.random() * 50) + 20,
                description: `Class ${name} from ${filePath}`,
                isExported: Math.random() > 0.3
            });
            entityCount++;
        }
        
        // Add constants
        for (const match of constMatches.slice(0, template.entities - entityCount)) {
            const name = match.replace('const ', '');
            entities.push({
                name,
                type: 'constant',
                startLine: Math.floor(Math.random() * 20) + 1,
                endLine: Math.floor(Math.random() * 20) + 1,
                description: `Constant ${name} from ${filePath}`,
                isExported: Math.random() > 0.7
            });
            entityCount++;
        }
        
        // Generate relationships between entities
        for (let i = 0; i < Math.min(template.relationships, entities.length - 1); i++) {
            const fromEntity = entities[i];
            const toEntity = entities[i + 1];
            
            relationships.push({
                from: fromEntity.name,
                to: toEntity.name,
                type: this._getRandomRelationshipType(),
                reason: `${fromEntity.name} ${this._getRandomRelationshipType().toLowerCase()} ${toEntity.name}`,
                confidence: Math.random() * 0.4 + 0.6 // 0.6 to 1.0
            });
        }
        
        return {
            entities,
            relationships
        };
    }

    /**
     * Get random relationship type
     */
    _getRandomRelationshipType() {
        const types = ['CALLS', 'USES', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS'];
        return types[Math.floor(Math.random() * types.length)];
    }

    /**
     * Create mock LLM client
     */
    createMockClient(complexity = 'medium') {
        return {
            chat: {
                completions: {
                    create: async (params) => {
                        // Simulate processing time
                        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
                        
                        // Extract file path from prompt if available
                        const filePath = params.messages?.[0]?.content?.match(/File: (.+?)\\n/)?.[1] || 'unknown.js';
                        const content = params.messages?.[0]?.content || '';
                        
                        const response = this.generateResponse(filePath, content, complexity);
                        
                        return {
                            choices: [{
                                message: {
                                    content: JSON.stringify(response)
                                }
                            }]
                        };
                    }
                }
            }
        };
    }
}

/**
 * Integration Test Scenario Builder
 */
class IntegrationTestScenario {
    constructor(environment) {
        this.environment = environment;
        this.dataGenerator = new TestDataGenerator(environment);
        this.mockLLM = new MockLLMResponseGenerator();
    }

    /**
     * Create complete test scenario
     */
    async createScenario(name, options = {}) {
        const scenario = {
            name,
            environment: this.environment,
            runId: uuidv4(),
            options,
            files: [],
            expectedResults: {
                minNodes: 0,
                minRelationships: 0,
                minFiles: 0
            }
        };

        // Generate test files
        const testDataDir = this.environment.getTestDataDir();
        scenario.files = await this.dataGenerator.createRealisticCodebase(testDataDir, options.codebase || {});
        
        // Calculate expected results
        const codeFiles = scenario.files.filter(f => f.type !== 'invalid');
        scenario.expectedResults.minFiles = codeFiles.length;
        scenario.expectedResults.minNodes = codeFiles.length * 2; // Conservative estimate
        scenario.expectedResults.minRelationships = Math.max(0, codeFiles.length - 1); // At least some relationships
        
        return scenario;
    }

    /**
     * Create performance test scenario
     */
    async createPerformanceScenario(scale = 'medium') {
        const scaleConfig = {
            small: { numFiles: 3, complexity: 'simple' },
            medium: { numFiles: 8, complexity: 'medium' },
            large: { numFiles: 15, complexity: 'complex' }
        };

        const config = scaleConfig[scale] || scaleConfig.medium;
        
        return await this.createScenario(`performance-${scale}`, {
            codebase: {
                numFiles: config.numFiles,
                complexity: config.complexity,
                includeCrossFileRefs: true,
                includeInvalidFiles: true
            }
        });
    }

    /**
     * Create error handling test scenario
     */
    async createErrorHandlingScenario() {
        return await this.createScenario('error-handling', {
            codebase: {
                numFiles: 5,
                complexity: 'medium',
                includeCrossFileRefs: true,
                includeInvalidFiles: true
            },
            simulateErrors: {
                llmTimeouts: true,
                databaseErrors: true,
                neo4jTimeouts: true,
                invalidPOIReferences: true
            }
        });
    }

    /**
     * Create cross-file relationship scenario
     */
    async createCrossFileScenario() {
        return await this.createScenario('cross-file-relationships', {
            codebase: {
                numFiles: 6,
                complexity: 'medium',
                includeCrossFileRefs: true,
                includeInvalidFiles: false
            }
        });
    }
}

module.exports = {
    IntegrationTestEnvironment,
    TestDataGenerator,
    MockLLMResponseGenerator,
    IntegrationTestScenario
};