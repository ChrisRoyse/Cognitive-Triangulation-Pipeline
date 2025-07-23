const BatchingFileAnalysisWorker = require('../../src/workers/BatchingFileAnalysisWorker');
const FileBatcher = require('../../src/utils/fileBatcher');

/**
 * Integration test for BatchingFileAnalysisWorker
 * 
 * This test demonstrates how the worker would be used in a real scenario
 * Note: This is a mock test since we don't have the full infrastructure running
 */

// Mock dependencies
class MockQueueManager {
    getQueue(name) {
        return {
            add: async (type, data) => {
                console.log(`[MockQueue] Added ${type} job:`, data);
            }
        };
    }

    get connection() {
        return {}; // Mock connection
    }
}

class MockDbManager {
    getDb() {
        return {
            prepare: (sql) => ({
                run: (...args) => {
                    console.log(`[MockDB] Executed: ${sql} with args:`, args);
                }
            })
        };
    }
}

class MockLLMClient {
    async query(prompt) {
        console.log(`[MockLLM] Received prompt (${prompt.length} chars)`);
        
        // Simulate a batch response
        if (prompt.includes('FILE 1:') && prompt.includes('FILE 2:')) {
            return {
                files: [
                    {
                        filePath: '/test/file1.js',
                        pois: [
                            { name: 'testFunction', type: 'FunctionDefinition', start_line: 1, end_line: 5 }
                        ]
                    },
                    {
                        filePath: '/test/file2.js',
                        pois: [
                            { name: 'TestClass', type: 'ClassDefinition', start_line: 1, end_line: 10 }
                        ]
                    }
                ]
            };
        } else {
            // Single file response
            return {
                pois: [
                    { name: 'singleFunction', type: 'FunctionDefinition', start_line: 1, end_line: 3 }
                ]
            };
        }
    }
}

// Mock the tokenizer module by creating a simple implementation
function mockGetTokenizer() {
    return function(text) {
        return Math.floor(text.length / 4); // Rough estimate: 4 chars per token
    };
}

async function testBatchingWorker() {
    console.log('Starting BatchingFileAnalysisWorker integration test...\n');

    // Mock the tokenizer before importing the worker
    const path = require('path');
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    
    Module.prototype.require = function(id) {
        if (id === '../utils/tokenizer') {
            return { getTokenizer: mockGetTokenizer };
        }
        return originalRequire.apply(this, arguments);
    };

    // Create mock dependencies
    const queueManager = new MockQueueManager();
    const dbManager = new MockDbManager();
    const cacheClient = {}; // Not used in this test
    const llmClient = new MockLLMClient();

    // Create worker with processOnly option to avoid starting the actual worker
    const worker = new BatchingFileAnalysisWorker(
        queueManager, 
        dbManager, 
        cacheClient, 
        llmClient,
        { processOnly: true, batchProcessingInterval: 1000 }
    );

    console.log('Worker created successfully');

    // Test 1: Process small files (should be batched)
    console.log('\n--- Test 1: Small Files (Batching) ---');
    
    const smallFileJobs = [
        { id: 1, data: { filePath: '/test/small1.js', runId: 'run1', jobId: 'job1' } },
        { id: 2, data: { filePath: '/test/small2.js', runId: 'run1', jobId: 'job2' } },
        { id: 3, data: { filePath: '/test/small3.js', runId: 'run1', jobId: 'job3' } }
    ];

    // Mock file system calls for small files
    const originalReadFile = require('fs').promises.readFile;
    const originalStat = require('fs').promises.stat;
    
    require('fs').promises.readFile = async (path) => {
        return `// Small file content for ${path}\nfunction test() { return 'hello'; }`;
    };
    
    require('fs').promises.stat = async (path) => {
        return { size: 500 }; // Small file
    };

    // Process small file jobs
    for (const job of smallFileJobs) {
        await worker.process(job);
    }

    // Wait a bit then process pending batches
    console.log('\nProcessing pending batches...');
    await worker.processPendingBatches();

    // Test 2: Process large file (should be individual)
    console.log('\n--- Test 2: Large File (Individual Processing) ---');
    
    require('fs').promises.stat = async (path) => {
        return { size: 50000 }; // Large file
    };

    require('fs').promises.readFile = async (path) => {
        return `// Large file content for ${path}\n${'function test() { return "large"; }\n'.repeat(100)}`;
    };

    const largeFileJob = { 
        id: 4, 
        data: { filePath: '/test/large.js', runId: 'run2', jobId: 'job4' } 
    };
    
    await worker.process(largeFileJob);

    // Test 3: Show statistics
    console.log('\n--- Test 3: Worker Statistics ---');
    const stats = worker.getStats();
    console.log(JSON.stringify(stats, null, 2));

    // Cleanup
    await worker.close();
    
    // Restore original functions
    require('fs').promises.readFile = originalReadFile;
    require('fs').promises.stat = originalStat;
    Module.prototype.require = originalRequire;

    console.log('\nBatchingFileAnalysisWorker integration test completed!');
}

// Run the test if this file is executed directly
if (require.main === module) {
    testBatchingWorker().catch(console.error);
}

module.exports = { testBatchingWorker };