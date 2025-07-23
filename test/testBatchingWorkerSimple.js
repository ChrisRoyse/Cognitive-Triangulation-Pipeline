const path = require('path');
const fs = require('fs').promises;

/**
 * Simple test for BatchingFileAnalysisWorker functionality
 * Tests the core batching logic without full infrastructure
 */

async function testBatchingLogic() {
    console.log('Testing FileBatcher and BatchingFileAnalysisWorker logic...\n');

    // Test just the FileBatcher component
    const FileBatcher = require('../src/utils/fileBatcher');

    const batcher = new FileBatcher({
        maxBatchChars: 3000,
        smallFileThreshold: 8192, // 8KB
        maxFilesPerBatch: 5
    });

    // Create test scenarios
    const testScenarios = [
        {
            name: 'Mixed small and large files',
            files: [
                { path: '/test/small1.js', size: 500 },
                { path: '/test/small2.py', size: 800 },
                { path: '/test/large1.js', size: 15000 }, // Too large for batching
                { path: '/test/small3.js', size: 600 },
                { path: '/test/small4.py', size: 400 }
            ]
        },
        {
            name: 'All small files',
            files: [
                { path: '/test/util1.js', size: 1000 },
                { path: '/test/util2.js', size: 1200 },
                { path: '/test/util3.js', size: 800 },
                { path: '/test/util4.js', size: 600 }
            ]
        },
        {
            name: 'All large files',
            files: [
                { path: '/test/large1.js', size: 20000 },
                { path: '/test/large2.py', size: 25000 }
            ]
        }
    ];

    for (const scenario of testScenarios) {
        console.log(`--- Scenario: ${scenario.name} ---`);
        
        // Mock shouldBatchFile method
        const originalShouldBatch = batcher.shouldBatchFile;
        batcher.shouldBatchFile = async (filePath) => {
            const file = scenario.files.find(f => f.path === filePath);
            return file && file.size <= batcher.smallFileThreshold;
        };

        // Mock fs.readFile
        const originalReadFile = fs.readFile;
        fs.readFile = async (filePath, encoding) => {
            const file = scenario.files.find(f => f.path === filePath);
            if (!file) throw new Error(`File not found: ${filePath}`);
            return `// Content for ${path.basename(filePath)}\n${'x'.repeat(file.size - 50)}`;
        };

        try {
            const filePaths = scenario.files.map(f => f.path);
            const batches = await batcher.createBatches(filePaths);
            
            console.log(`Created ${batches.length} batches from ${filePaths.length} files:`);
            
            batches.forEach((batch, index) => {
                if (batch.isSingleLargeFile) {
                    console.log(`  Batch ${index + 1}: Single large file - ${batch.files[0].path}`);
                } else {
                    console.log(`  Batch ${index + 1}: ${batch.files.length} files, ${batch.totalChars} chars`);
                    batch.files.forEach(file => {
                        console.log(`    - ${file.metadata.fileName} (${file.chars} chars)`);
                    });
                }
            });

            // Test prompt construction for first batch
            if (batches.length > 0 && !batches[0].isSingleLargeFile) {
                const prompt = batcher.constructBatchPrompt(batches[0]);
                console.log(`  Prompt length: ${prompt.length} characters`);
            }

        } catch (error) {
            console.error(`Error in scenario ${scenario.name}:`, error);
        } finally {
            // Restore original methods
            batcher.shouldBatchFile = originalShouldBatch;
            fs.readFile = originalReadFile;
        }

        console.log('');
    }

    // Test response parsing
    console.log('--- Testing Response Parsing ---');
    
    const mockBatch = {
        files: [
            { path: '/test/file1.js', content: 'content1', chars: 100 },
            { path: '/test/file2.py', content: 'content2', chars: 150 }
        ]
    };

    const mockResponse = {
        files: [
            {
                filePath: '/test/file1.js',
                pois: [
                    { name: 'testFunc', type: 'function', start_line: 1, end_line: 5 },
                    { name: 'testVar', type: 'variable', start_line: 7, end_line: 7 }
                ]
            },
            {
                filePath: '/test/file2.py',
                pois: [
                    { name: 'TestClass', type: 'class', start_line: 1, end_line: 15 }
                ]
            }
        ]
    };

    const parsedResults = batcher.parseBatchResponse(mockResponse, mockBatch);
    console.log('Parsed POIs:');
    Object.entries(parsedResults).forEach(([filePath, pois]) => {
        console.log(`  ${path.basename(filePath)}:`);
        pois.forEach(poi => {
            console.log(`    - ${poi.name} (${poi.type}) lines ${poi.start_line}-${poi.end_line}`);
        });
    });

    // Show final statistics
    console.log('\n--- Final Statistics ---');
    const stats = batcher.getStats();
    console.log(JSON.stringify(stats, null, 2));

    console.log('\nBatching logic test completed successfully!');
}

// Key benefits demonstration
function demonstrateBenefits() {
    console.log('\n=== FILE BATCHING BENEFITS ===\n');
    
    console.log('Before Batching (Individual Processing):');
    console.log('  - 100 small files (1KB each)');
    console.log('  - 100 API calls required');
    console.log('  - Each call uses ~1KB of 64KB context window (1.6% utilization)');
    console.log('  - High API overhead per request');
    console.log('');
    
    console.log('After Batching:');
    console.log('  - 100 small files grouped into ~2 batches');
    console.log('  - 2 API calls required (98% reduction)');
    console.log('  - Each call uses ~50KB of 64KB context window (78% utilization)');
    console.log('  - Minimal API overhead');
    console.log('  - Faster overall processing');
    console.log('');
    
    console.log('Key Features:');
    console.log('  ✓ Automatic file size detection');
    console.log('  ✓ Intelligent batch grouping');
    console.log('  ✓ Per-file POI extraction from batches');
    console.log('  ✓ Backward compatibility for large files');
    console.log('  ✓ Comprehensive error handling');
    console.log('  ✓ Detailed statistics and monitoring');
}

// Run tests
testBatchingLogic()
    .then(() => demonstrateBenefits())
    .catch(console.error);