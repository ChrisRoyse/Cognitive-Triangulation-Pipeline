#!/usr/bin/env node
/**
 * Smoke Test Runner
 * 
 * Standalone script to run smoke tests with proper exit codes for CI/CD integration
 * Usage: node tests/smoke/runSmokeTests.js
 */

const { spawn } = require('child_process');
const path = require('path');
const chalk = require('chalk');

console.log(chalk.blue.bold('\n🔥 Running Smoke Tests...\n'));
console.log(chalk.gray('Target: All tests should complete in < 30 seconds'));
console.log(chalk.gray('═'.repeat(50)) + '\n');

const startTime = Date.now();

// Run jest with smoke test configuration
const jest = spawn('npx', [
    'jest',
    'tests/smoke/smokeTests.test.js',
    '--runInBand',
    '--forceExit',
    '--detectOpenHandles',
    '--colors'
], {
    stdio: 'inherit',
    shell: true
});

jest.on('close', (code) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + chalk.gray('═'.repeat(50)));
    console.log(chalk.blue(`\nTotal execution time: ${duration}s`));
    
    if (code === 0) {
        console.log(chalk.green.bold('\n✅ All smoke tests passed!\n'));
        console.log(chalk.green('System is ready for deployment.\n'));
    } else {
        console.log(chalk.red.bold('\n❌ Smoke tests failed!\n'));
        console.log(chalk.red('Please check the errors above before proceeding.\n'));
    }
    
    // Exit with the same code as jest for CI/CD
    process.exit(code);
});

jest.on('error', (error) => {
    console.error(chalk.red('Failed to run smoke tests:'), error);
    process.exit(1);
});