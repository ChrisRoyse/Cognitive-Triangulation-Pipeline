const fs = require('fs').promises;
const path = require('path');
const FileBatcher = require('../src/utils/fileBatcher');

/**
 * Test script for FileBatcher functionality
 * 
 * Creates sample small files and tests batching behavior
 */
async function testFileBatching() {
    console.log('Starting FileBatcher test...\n');

    // Create test directory
    const testDir = path.join(__dirname, 'test-files');
    await fs.mkdir(testDir, { recursive: true });

    // Create sample small files
    const sampleFiles = [
        {
            name: 'utils.js',
            content: `// Utility functions
export function formatDate(date) {
    return date.toISOString();
}

export function parseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

const API_KEY = process.env.API_KEY;`
        },
        {
            name: 'math.js',
            content: `// Math operations
export const add = (a, b) => a + b;
export const subtract = (a, b) => a - b;
export const multiply = (a, b) => a * b;
export const divide = (a, b) => b !== 0 ? a / b : null;

class Calculator {
    constructor() {
        this.result = 0;
    }
    
    calculate(operation, value) {
        switch(operation) {
            case 'add': this.result += value; break;
            case 'subtract': this.result -= value; break;
        }
        return this.result;
    }
}`
        },
        {
            name: 'config.py',
            content: `# Configuration module
import os
import json

DEBUG = os.getenv('DEBUG', False)
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///app.db')

def load_config(file_path):
    """Load configuration from JSON file"""
    with open(file_path, 'r') as f:
        return json.load(f)

class Config:
    def __init__(self):
        self.settings = {}
    
    def get(self, key, default=None):
        return self.settings.get(key, default)`
        },
        {
            name: 'helpers.py',
            content: `# Helper functions
from datetime import datetime

def get_timestamp():
    return datetime.now().isoformat()

def validate_email(email):
    return '@' in email and '.' in email.split('@')[1]

def slugify(text):
    """Convert text to URL-friendly slug"""
    return text.lower().replace(' ', '-')`
        },
        {
            name: 'constants.js',
            content: `// Application constants
export const API_VERSION = 'v1';
export const MAX_RETRIES = 3;
export const TIMEOUT_MS = 30000;

export const ERROR_CODES = {
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    SERVER_ERROR: 500
};`
        }
    ];

    // Write sample files
    const filePaths = [];
    for (const sample of sampleFiles) {
        const filePath = path.join(testDir, sample.name);
        await fs.writeFile(filePath, sample.content, 'utf-8');
        filePaths.push(filePath);
        console.log(`Created test file: ${sample.name}`);
    }

    console.log('\n--- Testing FileBatcher ---\n');

    // Initialize FileBatcher
    const batcher = new FileBatcher({
        maxBatchChars: 2000, // Small limit for testing
        smallFileThreshold: 5000, // 5KB
        maxFilesPerBatch: 3
    });

    // Test 1: Check if files should be batched
    console.log('Test 1: Checking file sizes...');
    for (const filePath of filePaths) {
        const shouldBatch = await batcher.shouldBatchFile(filePath);
        console.log(`  ${path.basename(filePath)}: ${shouldBatch ? 'Should batch' : 'Too large'}`);
    }

    // Test 2: Create batches
    console.log('\nTest 2: Creating batches...');
    const batches = await batcher.createBatches(filePaths);
    console.log(`Created ${batches.length} batches:`);
    
    batches.forEach((batch, index) => {
        console.log(`\nBatch ${index + 1} (ID: ${batch.id}):`);
        console.log(`  Total characters: ${batch.totalChars}`);
        console.log(`  Files: ${batch.files.length}`);
        batch.files.forEach(file => {
            console.log(`    - ${file.metadata.fileName} (${file.chars} chars)`);
        });
    });

    // Test 3: Construct batch prompt
    console.log('\nTest 3: Constructing batch prompt...');
    if (batches.length > 0 && !batches[0].isSingleLargeFile) {
        const prompt = batcher.constructBatchPrompt(batches[0]);
        console.log('Prompt preview (first 500 chars):');
        console.log(prompt.substring(0, 500) + '...\n');
    }

    // Test 4: Simulate LLM response parsing
    console.log('Test 4: Testing response parsing...');
    const mockResponse = {
        files: [
            {
                filePath: filePaths[0],
                pois: [
                    { name: 'formatDate', type: 'function', start_line: 2, end_line: 4 },
                    { name: 'parseJSON', type: 'function', start_line: 6, end_line: 12 },
                    { name: 'API_KEY', type: 'variable', start_line: 14, end_line: 14 }
                ]
            },
            {
                filePath: filePaths[1],
                pois: [
                    { name: 'add', type: 'function', start_line: 2, end_line: 2 },
                    { name: 'Calculator', type: 'class', start_line: 7, end_line: 18 }
                ]
            }
        ]
    };

    if (batches.length > 0 && !batches[0].isSingleLargeFile) {
        const parsedResults = batcher.parseBatchResponse(mockResponse, batches[0]);
        console.log('Parsed results:');
        Object.entries(parsedResults).forEach(([filePath, pois]) => {
            console.log(`\n  ${path.basename(filePath)}:`);
            pois.forEach(poi => {
                console.log(`    - ${poi.name} (${poi.type}) lines ${poi.start_line}-${poi.end_line}`);
            });
        });
    }

    // Test 5: Statistics
    console.log('\nTest 5: Batcher statistics:');
    const stats = batcher.getStats();
    console.log(JSON.stringify(stats, null, 2));

    // Cleanup
    console.log('\nCleaning up test files...');
    for (const filePath of filePaths) {
        await fs.unlink(filePath);
    }
    await fs.rmdir(testDir);

    console.log('\nFileBatcher test completed successfully!');
}

// Run the test
testFileBatching().catch(console.error);