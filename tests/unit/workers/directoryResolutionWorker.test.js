const DirectoryResolutionWorker = require('../../../src/workers/directoryResolutionWorker');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('DirectoryResolutionWorker - Smart Content Extraction', () => {
    let worker;
    let testDir;

    beforeEach(async () => {
        // Create a temporary directory for testing
        testDir = path.join(os.tmpdir(), `test-dir-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

        // Create worker instance (with mocked dependencies)
        worker = new DirectoryResolutionWorker(
            null, // queueManager
            null, // dbManager
            null, // cacheClient
            null, // llmClient
            null, // workerPoolManager
            { processOnly: true }
        );
    });

    afterEach(async () => {
        // Clean up test directory
        await fs.rm(testDir, { recursive: true, force: true });
    });

    describe('extractKeyContent', () => {
        it('should return full content for small files', async () => {
            const smallFile = path.join(testDir, 'small.js');
            const content = 'const x = 1;\nconst y = 2;\nexport { x, y };';
            await fs.writeFile(smallFile, content);

            const result = await worker.extractKeyContent(smallFile);
            expect(result).toBe(content);
        });

        it('should extract imports, definitions, and exports for large files', async () => {
            const largeFile = path.join(testDir, 'large.js');
            const content = `
// This is a large file with lots of content
import React from 'react';
import { useState, useEffect } from 'react';
import axios from 'axios';

${'// Lots of filler content\n'.repeat(200)}

export class MyComponent extends React.Component {
    constructor(props) {
        super(props);
        this.state = { data: null };
    }
    
    render() {
        return <div>Component</div>;
    }
}

export function helperFunction(x) {
    return x * 2;
}

${'// More filler content\n'.repeat(100)}

export default MyComponent;
export { helperFunction };
`;
            await fs.writeFile(largeFile, content);

            const result = await worker.extractKeyContent(largeFile);
            
            // Should include imports
            expect(result).toContain("import React from 'react'");
            expect(result).toContain("import { useState, useEffect } from 'react'");
            expect(result).toContain("import axios from 'axios'");
            
            // Should include class definition
            expect(result).toContain('export class MyComponent');
            expect(result).toContain('constructor(props)');
            
            // Should include function definition
            expect(result).toContain('export function helperFunction');
            
            // Should include exports
            expect(result).toContain('export default MyComponent');
            expect(result).toContain('export { helperFunction }');
            
            // Should have section markers
            expect(result).toContain('// Imports/Dependencies:');
            expect(result).toContain('// Key definitions:');
            expect(result).toContain('// Exports:');
            
            // Should be within size limits
            expect(result.length).toBeLessThanOrEqual(3000);
        });

        it('should handle Python files correctly', async () => {
            const pythonFile = path.join(testDir, 'test.py');
            const content = `
#!/usr/bin/env python3
"""This is a Python module for testing."""

import os
import sys
from typing import List, Dict
import numpy as np

def main():
    """Main function."""
    print("Hello, World!")

class DataProcessor:
    def __init__(self, data: List[Dict]):
        self.data = data
    
    def process(self):
        return [d for d in self.data if d.get('valid')]

if __name__ == "__main__":
    main()
`;
            await fs.writeFile(pythonFile, content);

            const result = await worker.extractKeyContent(pythonFile);
            
            // Should include imports
            expect(result).toContain('import os');
            expect(result).toContain('from typing import List, Dict');
            
            // Should include function and class definitions
            expect(result).toContain('def main():');
            expect(result).toContain('class DataProcessor:');
            
            // Should include docstrings
            expect(result).toContain('"""This is a Python module for testing."""');
        });

        it('should skip non-code files', async () => {
            const textFile = path.join(testDir, 'readme.txt');
            await fs.writeFile(textFile, 'This is a text file');

            const result = await worker.extractKeyContent(textFile);
            expect(result).toBeNull();
        });

        it('should handle files with only exports at the end', async () => {
            const exportsFile = path.join(testDir, 'exports.js');
            const content = `
const privateFunction = () => {
    // Implementation
};

${'// Lots of private code\n'.repeat(100)}

module.exports = {
    publicFunction: () => {
        return privateFunction();
    },
    anotherExport: true,
    config: {
        timeout: 5000
    }
};
`;
            await fs.writeFile(exportsFile, content);

            const result = await worker.extractKeyContent(exportsFile);
            
            // Should include the module.exports
            expect(result).toContain('module.exports = {');
            expect(result).toContain('publicFunction:');
        });
    });

    describe('getFileContents', () => {
        it('should process multiple files in a directory', async () => {
            // Create test files
            await fs.writeFile(path.join(testDir, 'index.js'), 'export default class Main {}');
            await fs.writeFile(path.join(testDir, 'utils.js'), 'export function util() {}');
            await fs.writeFile(path.join(testDir, 'README.md'), '# Documentation');
            
            const contents = await worker.getFileContents(testDir);
            
            // Should include only code files
            expect(contents).toHaveLength(2);
            expect(contents.find(f => f.fileName === 'index.js')).toBeDefined();
            expect(contents.find(f => f.fileName === 'utils.js')).toBeDefined();
            expect(contents.find(f => f.fileName === 'README.md')).toBeUndefined();
        });

        it('should handle errors gracefully', async () => {
            // Create a valid JS file and a binary file
            await fs.writeFile(path.join(testDir, 'valid.js'), 'const x = 1;');
            await fs.writeFile(path.join(testDir, 'binary.exe'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
            
            // Mock console.warn to verify error handling
            const originalWarn = console.warn;
            const warnings = [];
            console.warn = (...args) => warnings.push(args);
            
            try {
                const contents = await worker.getFileContents(testDir);
                
                // Should include only the valid JS file
                expect(contents).toHaveLength(1);
                expect(contents[0].fileName).toBe('valid.js');
                
                // Binary file should be skipped (not a code extension)
                expect(contents.find(f => f.fileName === 'binary.exe')).toBeUndefined();
            } finally {
                console.warn = originalWarn;
            }
        });
    });
});