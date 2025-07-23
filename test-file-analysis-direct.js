// Test file analysis directly without queues

const FileAnalysisWorker = require('./src/workers/fileAnalysisWorker');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const { getDeepseekClient } = require('./src/utils/deepseekClient');
const { getCacheClient } = require('./src/utils/cacheClient');
const fs = require('fs').promises;
const path = require('path');

async function testFileAnalysis() {
    console.log('🧪 Testing file analysis directly...');
    
    try {
        // Initialize dependencies
        const dbManager = new DatabaseManager('./data/test-analysis.db');
        await dbManager.initializeDb();
        
        const llmClient = getDeepseekClient();
        const cacheClient = getCacheClient();
        
        // Create a mock queue manager
        const mockQueueManager = {
            getQueue: () => ({
                add: async () => ({ id: 'mock-job' })
            })
        };
        
        // Create worker in process-only mode (no queue)
        const worker = new FileAnalysisWorker(
            mockQueueManager,
            dbManager,
            cacheClient,
            llmClient,
            null, // workerPoolManager
            { processOnly: true } // Don't start queue worker
        );
        
        // Test file
        const testFile = './polyglot-test/js/utils.js';
        const fileContent = await fs.readFile(testFile, 'utf-8');
        
        console.log('📄 Analyzing file:', testFile);
        console.log('File size:', fileContent.length, 'characters');
        
        // Create a mock job
        const mockJob = {
            id: 'test-job-1',
            data: {
                filePath: path.resolve(testFile),
                runId: 'test-run-1'
            }
        };
        
        console.log('\\n🔍 Starting analysis...');
        const startTime = Date.now();
        
        // Process directly
        const result = await worker.process(mockJob);
        
        const duration = Date.now() - startTime;
        console.log('⏱️ Analysis duration:', duration, 'ms');
        
        console.log('\\n📊 Results:');
        console.log('POIs found:', result.length);
        
        if (result.length > 0) {
            console.log('\\nSample POIs:');
            result.slice(0, 5).forEach(poi => {
                console.log(`  - ${poi.name} (${poi.type}) at lines ${poi.start_line}-${poi.end_line}`);
            });
        }
        
        // Check database
        const db = dbManager.getDb();
        const outboxCount = db.prepare('SELECT COUNT(*) as count FROM outbox').get();
        console.log('\\nOutbox events created:', outboxCount.count);
        
        dbManager.close();
        await cacheClient.quit();
        
        console.log('\\n✅ Test completed successfully!');
        
    } catch (error) {
        console.error('\\n❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Load environment variables first
require('dotenv').config();

testFileAnalysis().catch(console.error);