#!/usr/bin/env node

/**
 * Debug Pipeline - Comprehensive system testing and diagnostics
 * 
 * This script provides systematic debugging of the Cognitive Triangulation Pipeline
 * by testing each component in isolation and then together.
 * 
 * Usage: node debug-pipeline.js [--test=component]
 */

const { DatabaseManager } = require('./src/utils/sqliteDb');
const neo4jDriver = require('./src/utils/neo4jDriver');
const { getInstance: getQueueManagerInstance } = require('./src/utils/queueManager');
const { getCacheClient } = require('./src/utils/cacheClient');
const { getDeepseekClient } = require('./src/utils/deepseekClient');
const FileAnalysisWorker = require('./src/workers/fileAnalysisWorker');
const { WorkerPoolManager } = require('./src/utils/workerPoolManager');
const config = require('./src/config');
const fs = require('fs').promises;
const path = require('path');

class PipelineDebugger {
    constructor() {
        this.results = {
            database: null,
            redis: null,
            neo4j: null,
            deepseek: null,
            fileSystem: null,
            workers: null,
            singleFile: null,
            miniPipeline: null
        };
        
        this.startTime = Date.now();
        this.dbManager = null;
        this.queueManager = null;
        this.cacheClient = null;
        this.llmClient = null;
        this.workerPoolManager = null;
    }

    async run() {
        console.log('🔧 DEBUG MODE: Starting comprehensive pipeline diagnostics');
        console.log('=' .repeat(80));
        
        try {
            // Phase 1: Test individual components
            await this.testDatabaseConnection();
            await this.testRedisConnection();
            await this.testNeo4jConnection();
            await this.testDeepSeekAPI();
            await this.testFileSystem();
            
            // Phase 2: Test worker initialization
            await this.testWorkerInitialization();
            
            // Phase 3: Test single file processing
            await this.testSingleFileAnalysis();
            
            // Phase 4: Test mini pipeline
            await this.testMiniPipeline();
            
            // Generate report
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Fatal error during debugging:', error);
            process.exit(1);
        }
    }

    async testDatabaseConnection() {
        console.log('\n📊 Testing SQLite Database Connection...');
        
        try {
            this.dbManager = new DatabaseManager('./data/database.db');
            this.dbManager.initializeDb();
            
            // Test basic operations
            const db = this.dbManager.getDb();
            
            // Check if tables exist
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            console.log(`   ✅ Found ${tables.length} tables:`, tables.map(t => t.name).join(', '));
            
            // Test INSERT and SELECT
            const testRunId = 'debug-test-' + Date.now();
            
            // Test POIs table
            try {
                const insertPoi = db.prepare(`
                    INSERT INTO pois (run_id, file_path, type, name, start_line, end_line, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                insertPoi.run(testRunId, '/test/file.js', 'FunctionDefinition', 'testFunc', 1, 5, '{}');
                
                const selectPoi = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?');
                const poiCount = selectPoi.get(testRunId);
                console.log(`   ✅ POIs table working - inserted and retrieved ${poiCount.count} record`);
            } catch (error) {
                console.error('   ❌ POIs table error:', error.message);
                throw error;
            }
            
            // Test relationships table
            try {
                // First get the POI ID we just inserted
                const poiId = db.prepare('SELECT id FROM pois WHERE run_id = ? LIMIT 1').get(testRunId).id;
                
                const insertRel = db.prepare(`
                    INSERT INTO relationships (run_id, source_poi_id, target_poi_id, type, confidence, evidence, file_path)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                insertRel.run(testRunId, poiId, poiId, 'CALLS', 0.9, 'test evidence', '/test/file.js');
                
                const selectRel = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?');
                const relCount = selectRel.get(testRunId);
                console.log(`   ✅ Relationships table working - inserted and retrieved ${relCount.count} record`);
            } catch (error) {
                console.error('   ❌ Relationships table error:', error.message);
                throw error;
            }
            
            // Cleanup test data
            db.prepare('DELETE FROM pois WHERE run_id = ?').run(testRunId);
            db.prepare('DELETE FROM relationships WHERE run_id = ?').run(testRunId);
            
            this.results.database = { status: 'OK', tables: tables.length };
            console.log('   ✅ Database connection and operations successful');
            
        } catch (error) {
            this.results.database = { status: 'FAILED', error: error.message };
            console.error('   ❌ Database test failed:', error.message);
            throw error;
        }
    }

    async testRedisConnection() {
        console.log('\n🔄 Testing Redis Connection...');
        
        try {
            this.cacheClient = getCacheClient();
            this.queueManager = getQueueManagerInstance();
            
            // Test Redis ping
            const pingResult = await this.cacheClient.ping();
            console.log('   ✅ Redis ping successful:', pingResult);
            
            // Test set/get
            const testKey = 'debug-test-' + Date.now();
            const testValue = 'debug-value';
            
            await this.cacheClient.set(testKey, testValue, 'EX', 60);
            const retrievedValue = await this.cacheClient.get(testKey);
            
            if (retrievedValue === testValue) {
                console.log('   ✅ Redis set/get operations working');
            } else {
                throw new Error(`Value mismatch: expected ${testValue}, got ${retrievedValue}`);
            }
            
            // Test queue operations
            const testQueue = this.queueManager.getQueue('debug-test-queue');
            await testQueue.add('test-job', { message: 'debug test' });
            
            const waitingJobs = await testQueue.getWaiting();
            console.log(`   ✅ Queue operations working - ${waitingJobs.length} jobs in debug queue`);
            
            // Cleanup
            await testQueue.clean(0, 'waiting');
            await this.cacheClient.del(testKey);
            
            this.results.redis = { status: 'OK' };
            console.log('   ✅ Redis connection and operations successful');
            
        } catch (error) {
            this.results.redis = { status: 'FAILED', error: error.message };
            console.error('   ❌ Redis test failed:', error.message);
            throw error;
        }
    }

    async testNeo4jConnection() {
        console.log('\n🔗 Testing Neo4j Connection...');
        
        try {
            const session = neo4jDriver.session();
            
            // Test basic query
            const result = await session.run('RETURN "Hello Neo4j" as message');
            const record = result.records[0];
            const message = record.get('message');
            
            console.log('   ✅ Neo4j query successful:', message);
            
            // Check constraints
            const constraintsResult = await session.run('SHOW CONSTRAINTS');
            const constraints = constraintsResult.records;
            console.log(`   📋 Found ${constraints.length} constraints`);
            
            const hasPoiConstraint = constraints.some(record => {
                const name = record.get('name');
                return name.includes('poi') || name.includes('POI');
            });
            
            if (!hasPoiConstraint) {
                console.warn('   ⚠️  POI unique constraint not found - this may cause issues');
                console.log('   💡 Recommendation: Run "CREATE CONSTRAINT poi_id_unique IF NOT EXISTS FOR (p:POI) REQUIRE p.id IS UNIQUE"');
            } else {
                console.log('   ✅ POI unique constraint found');
            }
            
            // Test node creation and deletion
            const testNodeId = 'debug-test-' + Date.now();
            await session.run(
                'CREATE (n:POI {id: $id, type: "Test", name: "debug-test"}) RETURN n',
                { id: testNodeId }
            );
            
            const nodeResult = await session.run(
                'MATCH (n:POI {id: $id}) RETURN n',
                { id: testNodeId }
            );
            
            if (nodeResult.records.length === 1) {
                console.log('   ✅ Neo4j node creation and retrieval working');
            } else {
                throw new Error('Failed to create or retrieve test node');
            }
            
            // Cleanup
            await session.run('MATCH (n:POI {id: $id}) DELETE n', { id: testNodeId });
            
            await session.close();
            
            this.results.neo4j = { status: 'OK', constraints: constraints.length };
            console.log('   ✅ Neo4j connection and operations successful');
            
        } catch (error) {
            this.results.neo4j = { status: 'FAILED', error: error.message };
            console.error('   ❌ Neo4j test failed:', error.message);
            throw error;
        }
    }

    async testDeepSeekAPI() {
        console.log('\n🤖 Testing DeepSeek API Connection...');
        
        try {
            this.llmClient = getDeepseekClient();
            
            // Test simple API call
            const testPrompt = 'Respond with exactly "API_TEST_SUCCESS" and nothing else.';
            
            const response = await this.llmClient.chat.completions.create({
                model: 'deepseek-coder',
                messages: [{ role: 'user', content: testPrompt }],
                max_tokens: 10,
                temperature: 0
            });
            
            const responseText = response.choices[0].message.content.trim();
            console.log('   📝 API Response:', responseText);
            
            if (responseText.includes('API_TEST_SUCCESS')) {
                console.log('   ✅ DeepSeek API responding correctly');
                this.results.deepseek = { status: 'OK', model: response.model };
            } else {
                console.warn('   ⚠️  API responded but with unexpected content');
                this.results.deepseek = { status: 'PARTIAL', response: responseText };
            }
            
        } catch (error) {
            this.results.deepseek = { status: 'FAILED', error: error.message };
            console.error('   ❌ DeepSeek API test failed:', error.message);
            
            if (error.message.includes('401')) {
                console.error('   💡 Check your DEEPSEEK_API_KEY in .env file');
            } else if (error.message.includes('network')) {
                console.error('   💡 Check your internet connection');
            }
            
            throw error;
        }
    }

    async testFileSystem() {
        console.log('\n📁 Testing File System Access...');
        
        try {
            const testDir = './polyglot-test';
            
            // Check if test directory exists
            try {
                const stats = await fs.stat(testDir);
                if (stats.isDirectory()) {
                    console.log('   ✅ Test directory found:', testDir);
                } else {
                    throw new Error('Path exists but is not a directory');
                }
            } catch (error) {
                console.error('   ❌ Test directory not found:', testDir);
                throw new Error(`Test directory ${testDir} not accessible: ${error.message}`);
            }
            
            // Scan for files
            const files = await this.scanDirectory(testDir);
            const sourceFiles = files.filter(f => this.isSourceFile(f));
            
            console.log(`   📊 Found ${files.length} total files, ${sourceFiles.length} source files`);
            
            if (sourceFiles.length < 10) {
                console.warn('   ⚠️  Low number of source files - may not meet benchmark requirements');
            }
            
            // Test file reading
            if (sourceFiles.length > 0) {
                const testFile = sourceFiles[0];
                const content = await fs.readFile(testFile, 'utf8');
                console.log(`   ✅ File reading test successful - read ${content.length} characters from ${testFile}`);
            }
            
            this.results.fileSystem = { 
                status: 'OK', 
                totalFiles: files.length, 
                sourceFiles: sourceFiles.length 
            };
            
        } catch (error) {
            this.results.fileSystem = { status: 'FAILED', error: error.message };
            console.error('   ❌ File system test failed:', error.message);
            throw error;
        }
    }

    async testWorkerInitialization() {
        console.log('\n⚙️  Testing Worker Initialization...');
        
        try {
            // Initialize WorkerPoolManager
            this.workerPoolManager = new WorkerPoolManager({
                environment: 'debug',
                maxGlobalConcurrency: 10,
                cpuThreshold: 90,
                memoryThreshold: 90
            });
            
            console.log('   ✅ WorkerPoolManager initialized');
            
            // Test FileAnalysisWorker initialization
            const fileWorker = new FileAnalysisWorker(
                this.queueManager,
                this.dbManager,
                this.cacheClient,
                this.llmClient,
                this.workerPoolManager
            );
            
            console.log('   ✅ FileAnalysisWorker initialized');
            
            // Test worker queue setup
            const queues = [
                'file-analysis-queue',
                'relationship-resolution-queue',
                'directory-aggregation-queue',
                'validation-queue',
                'graph-ingestion-queue'
            ];
            
            let workingQueues = 0;
            for (const queueName of queues) {
                try {
                    const queue = this.queueManager.getQueue(queueName);
                    const stats = await queue.getJobCounts();
                    console.log(`   ✅ Queue ${queueName}: ${JSON.stringify(stats)}`);
                    workingQueues++;
                } catch (error) {
                    console.error(`   ❌ Queue ${queueName} failed:`, error.message);
                }
            }
            
            this.results.workers = { 
                status: workingQueues === queues.length ? 'OK' : 'PARTIAL',
                workingQueues: workingQueues,
                totalQueues: queues.length
            };
            
            console.log(`   📊 ${workingQueues}/${queues.length} queues working properly`);
            
        } catch (error) {
            this.results.workers = { status: 'FAILED', error: error.message };
            console.error('   ❌ Worker initialization test failed:', error.message);
            throw error;
        }
    }

    async testSingleFileAnalysis() {
        console.log('\n🔍 Testing Single File Analysis...');
        
        try {
            // Find a simple test file
            const testFile = await this.findSimpleTestFile();
            console.log('   📄 Testing with file:', testFile);
            
            const content = await fs.readFile(testFile, 'utf8');
            console.log(`   📊 File size: ${content.length} characters`);
            
            // Create test job
            const runId = 'debug-single-' + Date.now();
            const job = {
                runId: runId,
                filePath: testFile,
                content: content,
                metadata: {
                    size: content.length,
                    language: this.detectLanguage(testFile)
                }
            };
            
            console.log('   🚀 Starting file analysis...');
            
            // Initialize file analysis worker
            const fileWorker = new FileAnalysisWorker(
                this.queueManager,
                this.dbManager,
                this.cacheClient,
                this.llmClient,
                this.workerPoolManager
            );
            
            // Process the file (simulate worker processing)
            const startTime = Date.now();
            
            // Add job to queue and wait for processing
            const queue = this.queueManager.getQueue('file-analysis-queue');
            await queue.add('analyze-file', job);
            
            // Wait briefly for processing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check results in database
            const db = this.dbManager.getDb();
            const poisResult = db.prepare('SELECT COUNT(*) as count FROM pois WHERE run_id = ?').get(runId);
            const relationshipsResult = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE run_id = ?').get(runId);
            
            const processingTime = Date.now() - startTime;
            
            console.log(`   📊 Processing took ${processingTime}ms`);
            console.log(`   📊 Extracted ${poisResult.count} POIs`);
            console.log(`   📊 Found ${relationshipsResult.count} relationships`);
            
            if (poisResult.count > 0) {
                console.log('   ✅ File analysis successful - entities extracted');
            } else {
                console.warn('   ⚠️  No entities extracted - may indicate LLM or parsing issues');
            }
            
            this.results.singleFile = {
                status: poisResult.count > 0 ? 'OK' : 'PARTIAL',
                file: testFile,
                pois: poisResult.count,
                relationships: relationshipsResult.count,
                processingTime: processingTime
            };
            
            // Cleanup
            db.prepare('DELETE FROM pois WHERE run_id = ?').run(runId);
            db.prepare('DELETE FROM relationships WHERE run_id = ?').run(runId);
            
        } catch (error) {
            this.results.singleFile = { status: 'FAILED', error: error.message };
            console.error('   ❌ Single file analysis test failed:', error.message);
            throw error;
        }
    }

    async testMiniPipeline() {
        console.log('\n🔄 Testing Mini Pipeline (3 files)...');
        
        try {
            // Find 3 simple test files
            const testFiles = await this.findMultipleTestFiles(3);
            console.log('   📄 Testing with files:', testFiles);
            
            const runId = 'debug-mini-' + Date.now();
            
            console.log('   🚀 Starting mini pipeline...');
            const startTime = Date.now();
            
            // This is a simplified pipeline test
            // In a real implementation, we'd run the full pipeline
            console.log('   ⚠️  Mini pipeline test is simplified for debugging');
            console.log('   💡 Full pipeline integration test will be in Phase 7');
            
            const processingTime = Date.now() - startTime;
            
            this.results.miniPipeline = {
                status: 'SKIPPED',
                reason: 'Simplified for debugging - full test in Phase 7',
                files: testFiles.length,
                processingTime: processingTime
            };
            
            console.log('   ⏭️  Mini pipeline test skipped - will be implemented in Phase 7');
            
        } catch (error) {
            this.results.miniPipeline = { status: 'FAILED', error: error.message };
            console.error('   ❌ Mini pipeline test failed:', error.message);
        }
    }

    generateReport() {
        const endTime = Date.now();
        const totalTime = endTime - this.startTime;
        
        console.log('\n' + '='.repeat(80));
        console.log('📋 DEBUGGING REPORT');
        console.log('='.repeat(80));
        
        console.log(`⏱️  Total debugging time: ${totalTime}ms`);
        console.log(`📅 Completed at: ${new Date().toISOString()}`);
        
        console.log('\n🔍 Component Status:');
        
        Object.entries(this.results).forEach(([component, result]) => {
            if (!result) return;
            
            const statusIcon = result.status === 'OK' ? '✅' : 
                              result.status === 'PARTIAL' ? '⚠️' : '❌';
            
            console.log(`${statusIcon} ${component.toUpperCase()}: ${result.status}`);
            
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
            
            // Additional info for each component
            if (component === 'database' && result.tables) {
                console.log(`   Tables: ${result.tables}`);
            } else if (component === 'neo4j' && result.constraints) {
                console.log(`   Constraints: ${result.constraints}`);
            } else if (component === 'fileSystem') {
                console.log(`   Source files: ${result.sourceFiles}/${result.totalFiles}`);
            } else if (component === 'workers') {
                console.log(`   Working queues: ${result.workingQueues}/${result.totalQueues}`);
            } else if (component === 'singleFile' && result.pois !== undefined) {
                console.log(`   POIs extracted: ${result.pois}, Relationships: ${result.relationships}`);
            }
        });
        
        console.log('\n💡 Recommendations:');
        
        // Generate recommendations based on results
        const failedComponents = Object.entries(this.results)
            .filter(([_, result]) => result && result.status === 'FAILED')
            .map(([component]) => component);
        
        if (failedComponents.length === 0) {
            console.log('✅ All components working - ready for Phase 2 implementation');
        } else {
            console.log('❌ Fix these components before proceeding:');
            failedComponents.forEach(component => {
                console.log(`   - ${component.toUpperCase()}`);
            });
        }
        
        // Specific recommendations
        if (this.results.neo4j && !this.results.neo4j.error && 
            this.results.neo4j.status === 'OK') {
            console.log('🔗 Consider running: CREATE CONSTRAINT poi_id_unique IF NOT EXISTS FOR (p:POI) REQUIRE p.id IS UNIQUE');
        }
        
        if (this.results.fileSystem && this.results.fileSystem.sourceFiles < 15) {
            console.log('📁 Warning: Low source file count may not meet benchmark requirements (need 15+)');
        }
        
        console.log('\n🎯 Next Steps:');
        console.log('1. Fix any failed components above');
        console.log('2. Run Phase 2: Create centralized configuration');
        console.log('3. Run Phase 3: Fix database schema issues');
        console.log('4. Continue with systematic fixes');
        
        console.log('='.repeat(80));
    }

    // Helper methods
    async scanDirectory(dir, files = []) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                await this.scanDirectory(fullPath, files);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
        
        return files;
    }

    isSourceFile(filePath) {
        const sourceExtensions = ['.js', '.java', '.py', '.sql', '.ts', '.jsx', '.tsx'];
        return sourceExtensions.some(ext => filePath.endsWith(ext));
    }

    detectLanguage(filePath) {
        const ext = path.extname(filePath);
        const languageMap = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.java': 'java',
            '.py': 'python',
            '.sql': 'sql'
        };
        return languageMap[ext] || 'unknown';
    }

    async findSimpleTestFile() {
        const testDir = './polyglot-test';
        const files = await this.scanDirectory(testDir);
        const sourceFiles = files.filter(f => this.isSourceFile(f));
        
        // Prefer JavaScript files for initial testing
        const jsFiles = sourceFiles.filter(f => f.endsWith('.js'));
        if (jsFiles.length > 0) {
            return jsFiles[0];
        }
        
        return sourceFiles[0];
    }

    async findMultipleTestFiles(count) {
        const testDir = './polyglot-test';
        const files = await this.scanDirectory(testDir);
        const sourceFiles = files.filter(f => this.isSourceFile(f));
        
        return sourceFiles.slice(0, count);
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const testArg = args.find(arg => arg.startsWith('--test='));
    const specificTest = testArg ? testArg.split('=')[1] : null;
    
    const pipelineDebugger = new PipelineDebugger();
    
    if (specificTest) {
        console.log(`🎯 Running specific test: ${specificTest}`);
        
        const testMethods = {
            'database': 'testDatabaseConnection',
            'redis': 'testRedisConnection',
            'neo4j': 'testNeo4jConnection',
            'deepseek': 'testDeepSeekAPI',
            'filesystem': 'testFileSystem',
            'workers': 'testWorkerInitialization',
            'singlefile': 'testSingleFileAnalysis',
            'minipipeline': 'testMiniPipeline'
        };
        
        const methodName = testMethods[specificTest.toLowerCase()];
        if (methodName && typeof pipelineDebugger[methodName] === 'function') {
            try {
                await pipelineDebugger[methodName]();
                console.log(`✅ ${specificTest} test completed successfully`);
            } catch (error) {
                console.error(`❌ ${specificTest} test failed:`, error.message);
                process.exit(1);
            }
        } else {
            console.error(`❌ Unknown test: ${specificTest}`);
            console.log('Available tests:', Object.keys(testMethods).join(', '));
            process.exit(1);
        }
    } else {
        await pipelineDebugger.run();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Debug script failed:', error);
        process.exit(1);
    });
}

module.exports = { PipelineDebugger };