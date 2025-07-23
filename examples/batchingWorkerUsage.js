/**
 * Example: Using BatchingFileAnalysisWorker in the CTP system
 * 
 * This example shows how to replace the standard FileAnalysisWorker 
 * with the new BatchingFileAnalysisWorker for improved efficiency.
 */

const BatchingFileAnalysisWorker = require('../src/workers/BatchingFileAnalysisWorker');
const { getOptimizedLLMClient } = require('../src/utils/optimizedLlmClient');

/**
 * Example 1: Basic Setup
 * Replace existing FileAnalysisWorker with BatchingFileAnalysisWorker
 */
function setupBatchingWorker(queueManager, dbManager, cacheClient) {
    console.log('Setting up BatchingFileAnalysisWorker...');
    
    const llmClient = getOptimizedLLMClient();
    
    // Create the batching worker
    const worker = new BatchingFileAnalysisWorker(
        queueManager,
        dbManager,
        cacheClient,
        llmClient,
        {
            // Optional configuration
            batchProcessingInterval: 3000, // Process batches every 3 seconds
            processOnly: false // Set to true to disable automatic worker startup
        }
    );
    
    console.log('BatchingFileAnalysisWorker initialized');
    return worker;
}

/**
 * Example 2: Configuration Options
 * Customize batching behavior for different scenarios
 */
function createCustomBatchingWorker(queueManager, dbManager, cacheClient, llmClient) {
    // For high-throughput scenarios with many small files
    const highThroughputWorker = new BatchingFileAnalysisWorker(
        queueManager, dbManager, cacheClient, llmClient,
        {
            // Process batches more frequently
            batchProcessingInterval: 1000, // 1 second
            
            // Custom FileBatcher options can be added here
            // (would require modifying the constructor to accept these)
        }
    );
    
    return highThroughputWorker;
}

/**
 * Example 3: Monitoring and Statistics
 * How to monitor the batching worker's performance
 */
function monitorBatchingWorker(worker) {
    console.log('Setting up monitoring for BatchingFileAnalysisWorker...');
    
    // Monitor stats every 30 seconds
    const monitoringInterval = setInterval(() => {
        const stats = worker.getStats();
        
        console.log('--- Batching Worker Statistics ---');
        console.log(`Single files processed: ${stats.singleFiles}`);
        console.log(`Batched files processed: ${stats.batchedFiles}`);
        console.log(`Total batches processed: ${stats.batchesProcessed}`);
        console.log(`POIs extracted: ${stats.poisExtracted}`);
        console.log(`Errors: ${stats.errors}`);
        
        if (stats.batcherStats) {
            console.log('\n--- Batcher Statistics ---');
            console.log(`Files processed: ${stats.batcherStats.filesProcessed}`);
            console.log(`Batches created: ${stats.batcherStats.batchesCreated}`);
            console.log(`Average files per batch: ${stats.batcherStats.averageFilesPerBatch}`);
            console.log(`Average chars per batch: ${stats.batcherStats.averageCharsPerBatch}`);
        }
        
        console.log(`Pending batches: ${stats.pendingBatches}`);
        console.log(`Pending files: ${stats.pendingFiles}`);
        console.log('--------------------------------\n');
        
    }, 30000);
    
    return monitoringInterval;
}

/**
 * Example 4: Integration with existing codebase
 * Shows minimal changes needed to upgrade from FileAnalysisWorker
 */
function integrateWithExistingSystem() {
    console.log('Example: Minimal integration changes...\n');
    
    console.log('BEFORE (using FileAnalysisWorker):');
    console.log(`
const FileAnalysisWorker = require('./workers/fileAnalysisWorker');

// Initialize worker
const worker = new FileAnalysisWorker(
    queueManager, 
    dbManager, 
    cacheClient, 
    llmClient
);
    `);
    
    console.log('AFTER (using BatchingFileAnalysisWorker):');
    console.log(`
const BatchingFileAnalysisWorker = require('./workers/BatchingFileAnalysisWorker');

// Initialize worker (same interface, enhanced functionality)
const worker = new BatchingFileAnalysisWorker(
    queueManager, 
    dbManager, 
    cacheClient, 
    llmClient
);
    `);
    
    console.log('Key benefits of this upgrade:');
    console.log('✓ No changes to job queuing logic required');
    console.log('✓ Same database schema and output format');
    console.log('✓ Backward compatible for large files');
    console.log('✓ Automatic batching for small files');
    console.log('✓ Significant API efficiency improvements');
}

/**
 * Example 5: Performance comparison simulation
 */
function simulatePerformanceComparison() {
    console.log('\n=== PERFORMANCE COMPARISON SIMULATION ===\n');
    
    const scenarios = [
        {
            name: 'Small project (20 files, avg 2KB each)',
            files: 20,
            avgSize: 2048,
            individualCalls: 20,
            batchedCalls: 1
        },
        {
            name: 'Medium project (100 files, avg 3KB each)',
            files: 100,
            avgSize: 3072,
            individualCalls: 100,
            batchedCalls: 2
        },
        {
            name: 'Large project (500 files, avg 4KB each)',
            files: 500,
            avgSize: 4096,
            individualCalls: 500,
            batchedCalls: 9
        }
    ];
    
    scenarios.forEach(scenario => {
        console.log(`--- ${scenario.name} ---`);
        console.log(`Files: ${scenario.files} files (${(scenario.avgSize / 1024).toFixed(1)}KB average)`);
        console.log(`Individual processing: ${scenario.individualCalls} API calls`);
        console.log(`Batched processing: ${scenario.batchedCalls} API calls`);
        
        const reduction = ((scenario.individualCalls - scenario.batchedCalls) / scenario.individualCalls * 100).toFixed(1);
        console.log(`API call reduction: ${reduction}%`);
        
        const timeReduction = reduction * 0.8; // Assume 80% time correlation
        console.log(`Estimated time savings: ~${timeReduction.toFixed(1)}%`);
        console.log('');
    });
}

/**
 * Example 6: Error handling and fallback behavior
 */
function demonstrateErrorHandling() {
    console.log('=== ERROR HANDLING AND FALLBACK ===\n');
    
    console.log('The BatchingFileAnalysisWorker includes robust error handling:');
    console.log('');
    
    console.log('1. Batch Processing Failures:');
    console.log('   - If a batch fails to process, individual files are processed as fallback');
    console.log('   - No files are lost due to batch processing errors');
    console.log('');
    
    console.log('2. File Read Errors:');
    console.log('   - Individual file read errors don\'t fail the entire batch');
    console.log('   - Error statistics are tracked and logged');
    console.log('');
    
    console.log('3. LLM API Errors:');
    console.log('   - Batch requests retry with exponential backoff');
    console.log('   - Circuit breaker prevents cascade failures');
    console.log('   - Rate limiting prevents API overload');
    console.log('');
    
    console.log('4. Response Parsing Errors:');
    console.log('   - Malformed responses return empty POI arrays');
    console.log('   - Files without POIs are handled gracefully');
    console.log('   - Detailed error logging for debugging');
}

// Main example runner
async function runExamples() {
    console.log('BatchingFileAnalysisWorker Usage Examples\n');
    console.log('==========================================\n');
    
    // Example 1: Basic integration
    integrateWithExistingSystem();
    
    // Example 2: Performance comparison
    simulatePerformanceComparison();
    
    // Example 3: Error handling
    demonstrateErrorHandling();
    
    console.log('\n=== CONCLUSION ===\n');
    console.log('The BatchingFileAnalysisWorker provides:');
    console.log('• Significant performance improvements for projects with many small files');
    console.log('• Seamless integration with existing codebase');
    console.log('• Robust error handling and fallback mechanisms');
    console.log('• Comprehensive monitoring and statistics');
    console.log('• Full backward compatibility');
    console.log('\nUpgrade your FileAnalysisWorker today for better efficiency!');
}

// Export for use in other modules
module.exports = {
    setupBatchingWorker,
    createCustomBatchingWorker,
    monitorBatchingWorker,
    runExamples
};

// Run examples if this file is executed directly
if (require.main === module) {
    runExamples().catch(console.error);
}