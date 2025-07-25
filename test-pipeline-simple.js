#!/usr/bin/env node

/**
 * Simple Pipeline Test
 * 
 * Test the pipeline with reduced configuration to avoid timeout issues
 */

require('dotenv').config();

// Override configuration for simpler testing
process.env.FORCE_MAX_CONCURRENCY = '10';  // Reduce concurrency
process.env.TRIANGULATION_THRESHOLD = '0.1';  // Higher threshold to avoid triangulation
process.env.LLM_TIMEOUT_MS = '30000';  // Shorter timeout

const { CognitiveTriangulationPipeline } = require('./src/main');

async function runSimpleTest() {
    console.log('🧪 Running simple pipeline test...');
    console.log('📊 Configuration overrides:');
    console.log('   - Concurrency: 10 (reduced)');
    console.log('   - Triangulation threshold: 0.1 (higher)');
    console.log('   - LLM timeout: 30s (shorter)');
    
    try {
        const pipeline = new CognitiveTriangulationPipeline('polyglot-test');
        
        console.log('🚀 Starting pipeline...');
        const startTime = Date.now();
        
        await pipeline.run();
        
        const duration = Date.now() - startTime;
        console.log(`✅ Pipeline completed successfully in ${duration}ms`);
        
    } catch (error) {
        console.error('❌ Pipeline failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test with timeout
const timeout = setTimeout(() => {
    console.error('❌ Test timeout after 3 minutes');
    process.exit(1);
}, 180000);

runSimpleTest().then(() => {
    clearTimeout(timeout);
    console.log('🎉 Test completed!');
}).catch((error) => {
    clearTimeout(timeout);
    console.error('💥 Test failed:', error);
    process.exit(1);
});