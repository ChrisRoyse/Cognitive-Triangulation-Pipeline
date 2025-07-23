/**
 * Unit Tests for FileAnalysisWorker
 * 
 * Tests the FileAnalysisWorker in isolation to ensure proper functionality
 * with the new centralized configuration system.
 */

require('dotenv').config();
const { describe, test, beforeEach, afterEach, expect } = require('@jest/globals');
const FileAnalysisWorker = require('../../src/workers/fileAnalysisWorker');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const { getInstance: getQueueManagerInstance } = require('../../src/utils/queueManager');
const { getCacheClient } = require('../../src/utils/cacheClient');
const { getDeepseekClient } = require('../../src/utils/deepseekClient');
const { WorkerPoolManager } = require('../../src/utils/workerPoolManager');

describe('FileAnalysisWorker', () => {
    let dbManager;
    let queueManager;
    let cacheClient;
    let llmClient;
    let workerPoolManager;
    let pipelineConfig;
    let testDbPath;

    beforeEach(async () => {
        // Create test-specific configuration
        pipelineConfig = PipelineConfig.createForTesting();
        
        // Setup test database
        testDbPath = `./tests/test-file-analysis-${Date.now()}.db`;
        dbManager = new DatabaseManager(testDbPath);
        await dbManager.initializeDb();
        
        // Setup other dependencies
        queueManager = getQueueManagerInstance();
        await queueManager.connect();
        
        cacheClient = getCacheClient();
        llmClient = getDeepseekClient();
        
        workerPoolManager = new WorkerPoolManager({
            environment: 'test',
            maxGlobalConcurrency: pipelineConfig.TOTAL_WORKER_CONCURRENCY,
            cpuThreshold: pipelineConfig.performance.cpuThreshold,
            memoryThreshold: pipelineConfig.performance.memoryThreshold
        });
    });

    afterEach(async () => {
        // Cleanup
        if (dbManager) {
            await dbManager.close();
        }
        
        // Clean up test database file
        const fs = require('fs');
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        
        // Clear test queues
        if (queueManager) {
            const queue = queueManager.getQueue('file-analysis-queue');
            await queue.obliterate();
        }
    });

    describe('Constructor', () => {
        test('should initialize with centralized configuration', () => {
            const worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { 
                    processOnly: true,  // Don't start actual worker
                    pipelineConfig: pipelineConfig 
                }
            );

            expect(worker.config).toBeDefined();
            expect(worker.config.getWorkerLimit('file-analysis')).toBe(5); // Test environment limit
            expect(worker.queueManager).toBe(queueManager);
            expect(worker.dbManager).toBe(dbManager);
            expect(worker.cacheClient).toBe(cacheClient);
            expect(worker.llmClient).toBe(llmClient);
        });

        test('should use default configuration when not provided', () => {
            const worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { processOnly: true }
            );

            expect(worker.config).toBeDefined();
            expect(worker.config.getWorkerLimit('file-analysis')).toBe(40); // Default environment limit
        });

        test('should respect worker limits from configuration', () => {
            const customConfig = PipelineConfig.createForTesting();
            customConfig.updateWorkerLimit('file-analysis', 3);

            const worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { 
                    processOnly: true,
                    pipelineConfig: customConfig 
                }
            );

            expect(worker.config.getWorkerLimit('file-analysis')).toBe(3);
        });
    });

    describe('File Processing', () => {
        let worker;

        beforeEach(() => {
            worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { 
                    processOnly: true,
                    pipelineConfig: pipelineConfig 
                }
            );
        });

        test('should process simple JavaScript file', async () => {
            const testRunId = 'test-run-' + Date.now();
            const testFilePath = '/test/simple.js';
            const testContent = `
                function greetUser(name) {
                    console.log("Hello, " + name);
                    return "Hello, " + name;
                }
                
                const userName = "Alice";
                greetUser(userName);
            `;

            const job = {
                data: {
                    runId: testRunId,
                    filePath: testFilePath,
                    content: testContent,
                    metadata: {
                        size: testContent.length,
                        language: 'javascript'
                    }
                }
            };

            // Process the file
            const result = await worker.process(job);

            // Verify results
            expect(result).toBeDefined();
            expect(result.status).toBe('completed');
            expect(result.filePath).toBe(testFilePath);
            expect(result.runId).toBe(testRunId);

            // Verify data was stored in database
            const db = dbManager.getDb();
            const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            const relationships = db.prepare('SELECT * FROM relationships WHERE run_id = ?').all(testRunId);

            expect(pois.length).toBeGreaterThan(0);
            console.log(`Extracted ${pois.length} POIs and ${relationships.length} relationships`);

            // Should have at least the function and variable
            const functionPois = pois.filter(poi => poi.type === 'FunctionDefinition');
            const variablePois = pois.filter(poi => poi.type === 'VariableDeclaration');

            expect(functionPois.length).toBeGreaterThanOrEqual(1);
            expect(variablePois.length).toBeGreaterThanOrEqual(1);

        }, 30000); // 30 second timeout for LLM processing

        test('should handle empty file gracefully', async () => {
            const testRunId = 'test-empty-' + Date.now();
            const testFilePath = '/test/empty.js';
            const testContent = '';

            const job = {
                data: {
                    runId: testRunId,
                    filePath: testFilePath,
                    content: testContent,
                    metadata: {
                        size: 0,
                        language: 'javascript'
                    }
                }
            };

            const result = await worker.process(job);

            expect(result).toBeDefined();
            expect(result.status).toBe('completed');
            expect(result.filePath).toBe(testFilePath);
            expect(result.runId).toBe(testRunId);

            // Should not fail, even with empty content
            const db = dbManager.getDb();
            const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            
            // Empty files should not generate POIs but shouldn't error
            expect(pois.length).toBe(0);

        }, 15000);

        test('should respect token limits for large files', async () => {
            const testRunId = 'test-large-' + Date.now();
            const testFilePath = '/test/large.js';
            
            // Create a large content string
            let largeContent = '// Large file test\n';
            for (let i = 0; i < 1000; i++) {
                largeContent += `function func${i}() { return ${i}; }\n`;
            }

            const job = {
                data: {
                    runId: testRunId,
                    filePath: testFilePath,
                    content: largeContent,
                    metadata: {
                        size: largeContent.length,
                        language: 'javascript'
                    }
                }
            };

            // This should either process successfully (if within limits) or truncate gracefully
            const result = await worker.process(job);

            expect(result).toBeDefined();
            expect(result.status).toBe('completed');
            expect(result.filePath).toBe(testFilePath);

            // Should process at least some POIs from the large file
            const db = dbManager.getDb();
            const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            expect(pois.length).toBeGreaterThan(0);

        }, 60000); // Longer timeout for large file processing

        test('should handle malformed JavaScript gracefully', async () => {
            const testRunId = 'test-malformed-' + Date.now();
            const testFilePath = '/test/malformed.js';
            const testContent = `
                function incompleteFunction( {
                    console.log("missing closing brace"
                    const x = ;
                    return
                }
            `;

            const job = {
                data: {
                    runId: testRunId,
                    filePath: testFilePath,
                    content: testContent,
                    metadata: {
                        size: testContent.length,
                        language: 'javascript'
                    }
                }
            };

            // Should not throw error, even with malformed code
            const result = await worker.process(job);

            expect(result).toBeDefined();
            expect(result.status).toBe('completed');
            expect(result.filePath).toBe(testFilePath);

            // May or may not extract POIs from malformed code, but shouldn't crash
            const db = dbManager.getDb();
            const pois = db.prepare('SELECT * FROM pois WHERE run_id = ?').all(testRunId);
            
            // Test passes if no exception was thrown
            expect(Array.isArray(pois)).toBe(true);

        }, 30000);
    });

    describe('Configuration Integration', () => {
        test('should use correct timeout from configuration', () => {
            const customConfig = PipelineConfig.createForTesting();
            const worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { 
                    processOnly: true,
                    pipelineConfig: customConfig 
                }
            );

            // Worker should use timeout from config
            expect(worker.config.performance.maxExecutionTime).toBe(5 * 60 * 1000); // Test environment timeout
        });

        test('should use correct API rate limit from configuration', () => {
            const customConfig = PipelineConfig.createForTesting();
            const worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { 
                    processOnly: true,
                    pipelineConfig: customConfig 
                }
            );

            expect(worker.config.performance.apiRateLimit).toBe(25); // Test environment rate limit
        });
    });

    describe('Error Handling', () => {
        let worker;

        beforeEach(() => {
            worker = new FileAnalysisWorker(
                queueManager,
                dbManager,
                cacheClient,
                llmClient,
                workerPoolManager,
                { 
                    processOnly: true,
                    pipelineConfig: pipelineConfig 
                }
            );
        });

        test('should handle database errors gracefully', async () => {
            // Close database to force error
            await dbManager.close();

            const testRunId = 'test-db-error-' + Date.now();
            const job = {
                data: {
                    runId: testRunId,
                    filePath: '/test/error.js',
                    content: 'console.log("test");',
                    metadata: { size: 20, language: 'javascript' }
                }
            };

            // Should handle database error gracefully
            await expect(worker.process(job)).rejects.toThrow();
        });

        test('should handle missing job data gracefully', async () => {
            const job = { data: null };

            await expect(worker.process(job)).rejects.toThrow();
        });

        test('should validate required job fields', async () => {
            const incompleteJob = {
                data: {
                    runId: 'test-incomplete',
                    // Missing filePath and content
                }
            };

            await expect(worker.process(incompleteJob)).rejects.toThrow();
        });
    });
});