#!/usr/bin/env node

const { spawn } = require('child_process');
const chalk = require('chalk');
const path = require('path');

/**
 * Comprehensive test runner for the cognitive triangulation pipeline
 * Executes all E2E tests and generates a summary report
 */
class TestRunner {
    constructor() {
        this.tests = [
            {
                name: 'Unit Tests',
                command: 'npm',
                args: ['test', '--', '--grep', 'unit'],
                optional: true
            },
            {
                name: 'Integration Tests',
                command: 'npm',
                args: ['test', '--', '--grep', 'integration'],
                optional: true
            },
            {
                name: 'Comprehensive E2E Tests',
                command: 'npm',
                args: ['test', 'tests/e2e/comprehensive-pipeline-e2e.test.js'],
                critical: true
            },
            {
                name: 'Performance Benchmark',
                command: 'node',
                args: ['tests/e2e/run-performance-benchmark.js'],
                critical: true
            },
            {
                name: 'Triangulation Validation',
                command: 'node',
                args: ['tests/e2e/validate-triangulation-benefits.js'],
                critical: true
            }
        ];
        
        this.results = [];
    }
    
    async run() {
        console.log(chalk.blue.bold('\n🚀 Cognitive Triangulation Pipeline - Comprehensive Test Suite\n'));
        console.log(chalk.gray('This will run all tests and validations. Please ensure Neo4j and Redis are running.\n'));
        
        const startTime = Date.now();
        
        for (const test of this.tests) {
            await this.runTest(test);
        }
        
        const duration = Date.now() - startTime;
        
        this.displaySummary(duration);
        
        // Exit with appropriate code
        const hasFailures = this.results.some(r => !r.success && r.critical);
        process.exit(hasFailures ? 1 : 0);
    }
    
    async runTest(test) {
        console.log(chalk.yellow(`\n📋 Running: ${test.name}`));
        console.log(chalk.gray(`Command: ${test.command} ${test.args.join(' ')}`));
        
        const startTime = Date.now();
        
        try {
            const exitCode = await this.executeCommand(test.command, test.args);
            const duration = Date.now() - startTime;
            
            const success = exitCode === 0;
            
            this.results.push({
                name: test.name,
                success,
                duration,
                critical: test.critical,
                optional: test.optional
            });
            
            if (success) {
                console.log(chalk.green(`✅ ${test.name} passed (${(duration / 1000).toFixed(2)}s)`));
            } else {
                console.log(chalk.red(`❌ ${test.name} failed (exit code: ${exitCode})`));
                
                if (test.critical && !test.optional) {
                    console.log(chalk.red.bold('\n⚠️  Critical test failed. Stopping test suite.'));
                    this.displaySummary(Date.now() - startTime);
                    process.exit(1);
                }
            }
            
        } catch (error) {
            console.error(chalk.red(`❌ ${test.name} error: ${error.message}`));
            
            this.results.push({
                name: test.name,
                success: false,
                error: error.message,
                critical: test.critical,
                optional: test.optional
            });
            
            if (test.critical && !test.optional) {
                console.log(chalk.red.bold('\n⚠️  Critical test error. Stopping test suite.'));
                this.displaySummary(Date.now() - startTime);
                process.exit(1);
            }
        }
    }
    
    executeCommand(command, args) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: 'inherit',
                shell: true,
                cwd: path.join(__dirname, '..', '..')
            });
            
            child.on('close', (code) => {
                resolve(code);
            });
            
            child.on('error', (error) => {
                reject(error);
            });
        });
    }
    
    displaySummary(totalDuration) {
        console.log(chalk.blue.bold('\n📊 Test Suite Summary\n'));
        
        const passed = this.results.filter(r => r.success).length;
        const failed = this.results.filter(r => !r.success).length;
        const total = this.results.length;
        
        console.log(chalk.white(`Total Tests: ${total}`));
        console.log(chalk.green(`Passed: ${passed}`));
        console.log(chalk.red(`Failed: ${failed}`));
        console.log(chalk.gray(`Duration: ${(totalDuration / 1000).toFixed(2)}s`));
        
        if (failed > 0) {
            console.log(chalk.red.bold('\n❌ Failed Tests:'));
            this.results
                .filter(r => !r.success)
                .forEach(r => {
                    const label = r.critical ? chalk.red('[CRITICAL]') : chalk.yellow('[OPTIONAL]');
                    console.log(`  ${label} ${r.name}`);
                    if (r.error) {
                        console.log(chalk.gray(`    Error: ${r.error}`));
                    }
                });
        }
        
        // Success criteria check
        console.log(chalk.blue.bold('\n✅ Success Criteria Validation:'));
        
        const criteriaChecks = [
            {
                name: 'All critical tests passed',
                passed: !this.results.some(r => !r.success && r.critical && !r.optional)
            },
            {
                name: 'E2E tests completed',
                passed: this.results.some(r => r.name === 'Comprehensive E2E Tests' && r.success)
            },
            {
                name: 'Performance benchmarks run',
                passed: this.results.some(r => r.name === 'Performance Benchmark' && r.success)
            },
            {
                name: 'Triangulation benefits validated',
                passed: this.results.some(r => r.name === 'Triangulation Validation' && r.success)
            }
        ];
        
        criteriaChecks.forEach(check => {
            const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
            console.log(`  ${icon} ${check.name}`);
        });
        
        const allCriteriaPassed = criteriaChecks.every(c => c.passed);
        
        if (allCriteriaPassed) {
            console.log(chalk.green.bold('\n🎉 All success criteria met! The cognitive triangulation pipeline is ready for production.'));
        } else {
            console.log(chalk.red.bold('\n⚠️  Some success criteria not met. Please review failed tests and fix issues.'));
        }
    }
}

// Check prerequisites
async function checkPrerequisites() {
    console.log(chalk.gray('Checking prerequisites...'));
    
    // Check Neo4j
    try {
        const neo4jDriver = require('../../src/utils/neo4jDriver');
        const session = neo4jDriver.session();
        await session.run('RETURN 1');
        await session.close();
        console.log(chalk.green('✓ Neo4j connection successful'));
    } catch (error) {
        console.error(chalk.red('✗ Neo4j connection failed. Please ensure Neo4j is running.'));
        return false;
    }
    
    // Check Redis
    try {
        const { getCacheClient, closeCacheClient } = require('../../src/utils/cacheClient');
        const client = getCacheClient();
        await client.ping();
        await closeCacheClient();
        console.log(chalk.green('✓ Redis connection successful'));
    } catch (error) {
        console.error(chalk.red('✗ Redis connection failed. Please ensure Redis is running.'));
        return false;
    }
    
    return true;
}

// Main execution
async function main() {
    console.log(chalk.blue.bold('Cognitive Triangulation Pipeline - Test Suite'));
    console.log(chalk.gray('Version 1.0.0\n'));
    
    const prerequisitesPassed = await checkPrerequisites();
    
    if (!prerequisitesPassed) {
        console.log(chalk.red.bold('\n❌ Prerequisites check failed. Please fix the issues above and try again.'));
        process.exit(1);
    }
    
    console.log(chalk.green('\n✓ All prerequisites passed'));
    
    const runner = new TestRunner();
    await runner.run();
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error(chalk.red.bold('\n❌ Test runner failed:'), error);
        process.exit(1);
    });
}

module.exports = { TestRunner };