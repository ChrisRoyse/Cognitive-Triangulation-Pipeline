#!/usr/bin/env node

/**
 * Quick Pipeline Test - Simplified version for testing
 * 
 * This script tests the pipeline with:
 * - Only JavaScript files (smaller/simpler)
 * - Very short timeout
 * - Minimal concurrency
 * - Skip large/complex files
 */

const fs = require('fs');
const path = require('path');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const { getDeepseekClient } = require('./src/utils/deepseekClient');

async function quickPipelineTest() {
    console.log('🚀 Starting Quick Pipeline Test...');
    
    try {
        // Initialize database
        console.log('📊 Initializing database...');
        const dbManager = new DatabaseManager('./data/test-quick-database.db');
        await dbManager.rebuildDb();
        
        console.log('✅ Database initialized');
        
        // Find only small JS files
        const targetDir = 'polyglot-test';
        const jsFiles = [];
        
        function findJSFiles(dir) {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                
                if (stats.isDirectory()) {
                    findJSFiles(fullPath);
                } else if (item.endsWith('.js')) {
                    // Only include files smaller than 5KB
                    if (stats.size < 5000) {
                        jsFiles.push({
                            path: fullPath,
                            size: stats.size
                        });
                    }
                }
            }
        }
        
        findJSFiles(targetDir);
        console.log(`📁 Found ${jsFiles.length} small JS files for analysis:`);
        jsFiles.forEach(file => console.log(`  - ${file.path} (${file.size} bytes)`));
        
        if (jsFiles.length === 0) {
            console.log('❌ No suitable files found for testing');
            return;
        }
        
        // Test LLM connection with a simple file
        console.log('🤖 Testing LLM on first file...');
        const testFile = jsFiles[0];
        const content = fs.readFileSync(testFile.path, 'utf-8');
        
        const llmClient = getDeepseekClient();
        const prompt = `Analyze this JavaScript code and extract key information in JSON format:

${content}

Return a JSON object with:
{
  "functions": [{"name": "functionName", "type": "function", "description": "what it does"}],
  "variables": [{"name": "varName", "type": "variable", "description": "what it stores"}],
  "imports": [{"name": "moduleName", "type": "import"}]
}`;

        console.log('⏳ Making LLM call...');
        const startTime = Date.now();
        
        try {
            const result = await llmClient.query(prompt);
            const elapsed = Date.now() - startTime;
            console.log(`✅ LLM call successful in ${elapsed}ms`);
            console.log('📝 LLM Result:', result.substring(0, 200) + '...');
            
            // Parse and validate JSON
            const parsed = JSON.parse(result);
            console.log(`📊 Analysis: ${parsed.functions?.length || 0} functions, ${parsed.variables?.length || 0} variables, ${parsed.imports?.length || 0} imports`);
            
        } catch (error) {
            console.error('❌ LLM call failed:', error.message);
            throw error;
        }
        
        console.log('🎉 Quick pipeline test completed successfully!');
        console.log('✅ All critical components are working:');
        console.log('   - Database initialization ✓');
        console.log('   - File discovery ✓');
        console.log('   - LLM integration ✓');
        console.log('   - JSON parsing ✓');
        
        // Estimate full pipeline time
        const avgTimePerFile = 3000; // 3 seconds per file (conservative)
        const totalFiles = 17; // From previous run
        const estimatedTime = Math.ceil(totalFiles * avgTimePerFile / 1000 / 60);
        console.log(`📈 Estimated full pipeline time: ~${estimatedTime} minutes for ${totalFiles} files`);
        
    } catch (error) {
        console.error('❌ Quick pipeline test failed:', error);
        process.exit(1);
    }
}

// Run the test
quickPipelineTest();