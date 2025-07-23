// Test pipeline with a single file to debug issues

const path = require('path');
const fs = require('fs');

// Create a simple test file
const testDir = './test-single';
const testFile = path.join(testDir, 'simple.js');

if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}

fs.writeFileSync(testFile, `
// Simple test file for pipeline
class DataProcessor {
    constructor() {
        this.data = [];
    }
    
    process(input) {
        return this.transform(input);
    }
    
    transform(data) {
        return data.map(item => item.toUpperCase());
    }
}

function createProcessor() {
    return new DataProcessor();
}

const processor = createProcessor();
module.exports = processor;
`);

console.log('✅ Created test file:', testFile);
console.log('📁 Test directory:', testDir);
console.log('🚀 Run pipeline with: node src/main.js --target ' + testDir);