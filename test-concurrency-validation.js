#!/usr/bin/env node

/**
 * Comprehensive Concurrency Configuration Validation
 * 
 * This script validates the entire concurrency configuration system to ensure all components
 * are aligned with the new distribution model across different FORCE_MAX_CONCURRENCY values.
 */

const { PipelineConfig } = require('./src/config/pipelineConfig.js');
const { WorkerPoolManager } = require('./src/utils/workerPoolManager.js');

class ConcurrencyValidationSuite {
    constructor() {
        this.results = [];
        this.errors = [];
        this.testCases = [
            { name: 'Force 1', value: 1 },
            { name: 'Force 7', value: 7 },
            { name: 'Force 50', value: 50 },
            { name: 'Force 100', value: 100 },
            { name: 'Force 150', value: 150 },
            { name: 'No Force', value: null }
        ];
    }

    /**
     * Run all validation tests
     */
    async runValidation() {
        console.log('🔍 Starting Comprehensive Concurrency Configuration Validation\n');
        
        for (const testCase of this.testCases) {
            await this.validateConfiguration(testCase);
        }
        
        this.generateReport();
    }

    /**
     * Validate configuration for a specific FORCE_MAX_CONCURRENCY value
     */
    async validateConfiguration(testCase) {
        console.log(`\n📋 Testing: ${testCase.name} (FORCE_MAX_CONCURRENCY=${testCase.value || 'undefined'})`);
        console.log('='.repeat(80));
        
        // Set environment variable
        if (testCase.value !== null) {
            process.env.FORCE_MAX_CONCURRENCY = testCase.value.toString();
        } else {
            delete process.env.FORCE_MAX_CONCURRENCY;
        }
        
        const result = {
            testCase: testCase.name,
            forceValue: testCase.value,
            validations: {},
            errors: [],
            warnings: []
        };
        
        try {
            // 1. Test PipelineConfig
            result.validations.pipelineConfig = await this.validatePipelineConfig(testCase);
            
            // 2. Test WorkerPoolManager
            result.validations.workerPoolManager = await this.validateWorkerPoolManager(testCase);
            
            // 3. Test cross-component consistency
            result.validations.consistency = await this.validateCrossComponentConsistency(testCase);
            
            // 4. Test edge cases
            result.validations.edgeCases = await this.validateEdgeCases(testCase);
            
            // 5. Test Redis pool sizing
            result.validations.redisPooling = await this.validateRedisPoolSizing(testCase);
            
        } catch (error) {
            result.errors.push(`Fatal error during validation: ${error.message}`);
            this.errors.push(`${testCase.name}: ${error.message}`);
        }
        
        this.results.push(result);
        this.printTestResult(result);
    }

    /**
     * Validate PipelineConfig behavior
     */
    async validatePipelineConfig(testCase) {
        const validation = {
            passed: true,
            details: {},
            issues: []
        };
        
        try {
            const config = new PipelineConfig();
            const workerLimits = config.workerLimits;
            const queueConcurrency = config.queues.concurrency;
            
            // Calculate total workers
            const totalWorkers = Object.values(workerLimits).reduce((sum, limit) => sum + limit, 0);
            
            validation.details = {
                totalWorkerConcurrency: config.TOTAL_WORKER_CONCURRENCY,
                actualTotalWorkers: totalWorkers,
                workerLimits: { ...workerLimits },
                queueConcurrency: { ...queueConcurrency }
            };
            
            // Validation checks
            if (testCase.value !== null) {
                // When FORCE_MAX_CONCURRENCY is set
                if (totalWorkers !== testCase.value) {
                    validation.passed = false;
                    validation.issues.push(
                        `Total workers (${totalWorkers}) should equal FORCE_MAX_CONCURRENCY (${testCase.value})`
                    );
                }
                
                if (config.TOTAL_WORKER_CONCURRENCY !== testCase.value) {
                    validation.passed = false;
                    validation.issues.push(
                        `TOTAL_WORKER_CONCURRENCY (${config.TOTAL_WORKER_CONCURRENCY}) should equal FORCE_MAX_CONCURRENCY (${testCase.value})`
                    );
                }
                
                // Check minimum worker allocation
                const workerTypes = Object.keys(workerLimits);
                if (testCase.value === 7 && workerTypes.length === 7) {
                    // Each worker should get exactly 1
                    for (const [type, limit] of Object.entries(workerLimits)) {
                        if (limit !== 1) {
                            validation.passed = false;
                            validation.issues.push(
                                `Worker '${type}' should have exactly 1 worker when FORCE_MAX_CONCURRENCY=7, got ${limit}`
                            );
                        }
                    }
                }
                
                // Check queue consistency
                for (const [queueName, queueLimit] of Object.entries(queueConcurrency)) {
                    const workerType = queueName.replace('-queue', '');
                    const workerLimit = workerLimits[workerType];
                    
                    if (workerLimit && queueLimit !== workerLimit) {
                        validation.passed = false;
                        validation.issues.push(
                            `Queue '${queueName}' concurrency (${queueLimit}) doesn't match worker '${workerType}' limit (${workerLimit})`
                        );
                    }
                }
            } else {
                // When no force is set, should use defaults
                if (config.TOTAL_WORKER_CONCURRENCY !== 100) {
                    validation.issues.push(
                        `TOTAL_WORKER_CONCURRENCY should default to 100 when no force is set, got ${config.TOTAL_WORKER_CONCURRENCY}`
                    );
                }
            }
            
        } catch (error) {
            validation.passed = false;
            validation.issues.push(`PipelineConfig error: ${error.message}`);
        }
        
        return validation;
    }

    /**
     * Validate WorkerPoolManager behavior
     */
    async validateWorkerPoolManager(testCase) {
        const validation = {
            passed: true,
            details: {},
            issues: []
        };
        
        try {
            const poolManager = new WorkerPoolManager();
            
            validation.details = {
                maxGlobalConcurrency: poolManager.config.maxGlobalConcurrency,
                environment: poolManager.config.environment,
                highPerformanceMode: poolManager.config.highPerformanceMode
            };
            
            // Validate global concurrency respects hard limits
            if (poolManager.config.maxGlobalConcurrency > 100) {
                validation.passed = false;
                validation.issues.push(
                    `WorkerPoolManager maxGlobalConcurrency (${poolManager.config.maxGlobalConcurrency}) exceeds hard limit of 100`
                );
            }
            
            // Test worker registration
            const workerTypes = [
                'file-analysis',
                'relationship-resolution', 
                'directory-resolution',
                'directory-aggregation',
                'validation',
                'reconciliation',
                'graph-ingestion'
            ];
            
            let totalRegisteredConcurrency = 0;
            for (const workerType of workerTypes) {
                const workerInfo = poolManager.registerWorker(workerType);
                totalRegisteredConcurrency += workerInfo.concurrency;
                
                validation.details[`${workerType}Concurrency`] = workerInfo.concurrency;
            }
            
            validation.details.totalRegisteredConcurrency = totalRegisteredConcurrency;
            
            // Validate total doesn't exceed limits
            if (testCase.value !== null && totalRegisteredConcurrency > testCase.value) {
                validation.issues.push(
                    `Total registered concurrency (${totalRegisteredConcurrency}) exceeds FORCE_MAX_CONCURRENCY (${testCase.value})`
                );
            }
            
            await poolManager.shutdown();
            
        } catch (error) {
            validation.passed = false;
            validation.issues.push(`WorkerPoolManager error: ${error.message}`);
        }
        
        return validation;
    }

    /**
     * Validate consistency between PipelineConfig and WorkerPoolManager
     */
    async validateCrossComponentConsistency(testCase) {
        const validation = {
            passed: true,
            details: {},
            issues: []
        };
        
        try {
            const pipelineConfig = new PipelineConfig();
            const poolManager = new WorkerPoolManager();
            
            // Compare configurations
            validation.details = {
                pipelineTotal: pipelineConfig.TOTAL_WORKER_CONCURRENCY,
                poolManagerMax: poolManager.config.maxGlobalConcurrency,
                consistent: pipelineConfig.TOTAL_WORKER_CONCURRENCY <= poolManager.config.maxGlobalConcurrency
            };
            
            if (pipelineConfig.TOTAL_WORKER_CONCURRENCY > poolManager.config.maxGlobalConcurrency) {
                validation.passed = false;
                validation.issues.push(
                    `PipelineConfig TOTAL_WORKER_CONCURRENCY (${pipelineConfig.TOTAL_WORKER_CONCURRENCY}) ` +
                    `exceeds WorkerPoolManager maxGlobalConcurrency (${poolManager.config.maxGlobalConcurrency})`
                );
            }
            
            await poolManager.shutdown();
            
        } catch (error) {
            validation.passed = false;
            validation.issues.push(`Cross-component consistency error: ${error.message}`);
        }
        
        return validation;
    }

    /**
     * Validate edge cases and error handling
     */
    async validateEdgeCases(testCase) {
        const validation = {
            passed: true,
            details: {},
            issues: []
        };
        
        try {
            // Test invalid values
            const edgeCases = [];
            
            // Test zero concurrency
            process.env.FORCE_MAX_CONCURRENCY = '0';
            try {
                const config = new PipelineConfig();
                edgeCases.push({
                    name: 'Zero concurrency',
                    value: 0,
                    totalWorkers: Object.values(config.workerLimits).reduce((sum, limit) => sum + limit, 0),
                    handled: true
                });
            } catch (error) {
                edgeCases.push({
                    name: 'Zero concurrency',
                    value: 0,
                    error: error.message,
                    handled: false
                });
            }
            
            // Test negative values
            process.env.FORCE_MAX_CONCURRENCY = '-5';
            try {
                const config = new PipelineConfig();
                edgeCases.push({
                    name: 'Negative concurrency',
                    value: -5,
                    totalWorkers: Object.values(config.workerLimits).reduce((sum, limit) => sum + limit, 0),
                    handled: true
                });
            } catch (error) {
                edgeCases.push({
                    name: 'Negative concurrency',
                    value: -5,
                    error: error.message,
                    handled: false
                });
            }
            
            // Test non-numeric values
            process.env.FORCE_MAX_CONCURRENCY = 'invalid';
            try {
                const config = new PipelineConfig();
                edgeCases.push({
                    name: 'Non-numeric concurrency',
                    value: 'invalid',
                    totalWorkers: Object.values(config.workerLimits).reduce((sum, limit) => sum + limit, 0),
                    handled: true
                });
            } catch (error) {
                edgeCases.push({
                    name: 'Non-numeric concurrency',
                    value: 'invalid',
                    error: error.message,
                    handled: false
                });
            }
            
            // Test very large values
            process.env.FORCE_MAX_CONCURRENCY = '1000';
            try {
                const config = new PipelineConfig();
                const poolManager = new WorkerPoolManager();
                
                edgeCases.push({
                    name: 'Very large concurrency',
                    value: 1000,
                    configTotal: config.TOTAL_WORKER_CONCURRENCY,
                    poolMax: poolManager.config.maxGlobalConcurrency,
                    cappedCorrectly: poolManager.config.maxGlobalConcurrency <= 100
                });
                
                await poolManager.shutdown();
            } catch (error) {
                edgeCases.push({
                    name: 'Very large concurrency',
                    value: 1000,
                    error: error.message,
                    handled: false
                });
            }
            
            validation.details.edgeCases = edgeCases;
            
            // Restore original test case value
            if (testCase.value !== null) {
                process.env.FORCE_MAX_CONCURRENCY = testCase.value.toString();
            } else {
                delete process.env.FORCE_MAX_CONCURRENCY;
            }
            
        } catch (error) {
            validation.passed = false;
            validation.issues.push(`Edge case validation error: ${error.message}`);
        }
        
        return validation;
    }

    /**
     * Validate Redis pool sizing
     */
    async validateRedisPoolSizing(testCase) {
        const validation = {
            passed: true,
            details: {},
            issues: []
        };
        
        try {
            // Note: We can't easily test the actual Redis pool without a Redis connection
            // But we can validate the sizing logic conceptually
            
            const expectedConcurrency = testCase.value || 100;
            const recommendedPoolSize = Math.max(50, Math.ceil(expectedConcurrency / 15));
            
            validation.details = {
                expectedConcurrency,
                recommendedPoolSize,
                reasoning: `Pool size should be at least 50 or ceil(${expectedConcurrency}/15) = ${Math.ceil(expectedConcurrency / 15)}`
            };
            
            // Validate pool size is reasonable
            if (recommendedPoolSize < 10) {
                validation.issues.push(
                    `Recommended pool size (${recommendedPoolSize}) seems too small for concurrency ${expectedConcurrency}`
                );
            }
            
            if (recommendedPoolSize > 200) {
                validation.issues.push(
                    `Recommended pool size (${recommendedPoolSize}) seems excessive for concurrency ${expectedConcurrency}`
                );
            }
            
        } catch (error) {
            validation.passed = false;
            validation.issues.push(`Redis pool sizing validation error: ${error.message}`);
        }
        
        return validation;
    }

    /**
     * Print test result for a single test case
     */
    printTestResult(result) {
        const passed = Object.values(result.validations).every(v => v.passed);
        const icon = passed ? '✅' : '❌';
        
        console.log(`\n${icon} ${result.testCase} (FORCE_MAX_CONCURRENCY=${result.forceValue || 'undefined'})`);
        
        for (const [validationType, validation] of Object.entries(result.validations)) {
            const status = validation.passed ? '✓' : '✗';
            console.log(`   ${status} ${validationType}`);
            
            if (validation.issues && validation.issues.length > 0) {
                validation.issues.forEach(issue => {
                    console.log(`      ⚠️  ${issue}`);
                });
            }
        }
        
        if (result.errors.length > 0) {
            result.errors.forEach(error => {
                console.log(`   ❌ ${error}`);
            });
        }
    }

    /**
     * Generate comprehensive validation report
     */
    generateReport() {
        console.log('\n' + '='.repeat(100));
        console.log('📊 COMPREHENSIVE CONCURRENCY CONFIGURATION VALIDATION REPORT');
        console.log('='.repeat(100));
        
        const summary = {
            totalTests: this.results.length,
            passedTests: 0,
            failedTests: 0,
            totalValidations: 0,
            passedValidations: 0,
            failedValidations: 0
        };
        
        console.log('\n🔍 DETAILED RESULTS:\n');
        
        for (const result of this.results) {
            const testPassed = Object.values(result.validations).every(v => v.passed);
            if (testPassed) summary.passedTests++;
            else summary.failedTests++;
            
            console.log(`\n📋 ${result.testCase} (FORCE_MAX_CONCURRENCY=${result.forceValue || 'undefined'})`);
            console.log('-'.repeat(80));
            
            for (const [validationType, validation] of Object.entries(result.validations)) {
                summary.totalValidations++;
                if (validation.passed) summary.passedValidations++;
                else summary.failedValidations++;
                
                const status = validation.passed ? '✅ PASS' : '❌ FAIL';
                console.log(`   ${validationType}: ${status}`);
                
                // Show key details
                if (validation.details) {
                    if (validationType === 'pipelineConfig') {
                        console.log(`      Total Workers: ${validation.details.actualTotalWorkers}`);
                        console.log(`      Expected Total: ${validation.details.totalWorkerConcurrency}`);
                        console.log(`      Worker Distribution: ${JSON.stringify(validation.details.workerLimits)}`);
                    } else if (validationType === 'workerPoolManager') {
                        console.log(`      Max Global Concurrency: ${validation.details.maxGlobalConcurrency}`);
                        console.log(`      Total Registered: ${validation.details.totalRegisteredConcurrency}`);
                    } else if (validationType === 'consistency') {
                        console.log(`      Pipeline Total: ${validation.details.pipelineTotal}`);
                        console.log(`      Pool Manager Max: ${validation.details.poolManagerMax}`);
                        console.log(`      Consistent: ${validation.details.consistent}`);
                    }
                }
                
                if (validation.issues && validation.issues.length > 0) {
                    validation.issues.forEach(issue => {
                        console.log(`      ⚠️  ${issue}`);
                    });
                }
            }
        }
        
        // Summary
        console.log('\n📈 SUMMARY:');
        console.log('-'.repeat(50));
        console.log(`Total Test Cases: ${summary.totalTests}`);
        console.log(`Passed Test Cases: ${summary.passedTests} (${((summary.passedTests/summary.totalTests)*100).toFixed(1)}%)`);
        console.log(`Failed Test Cases: ${summary.failedTests} (${((summary.failedTests/summary.totalTests)*100).toFixed(1)}%)`);
        console.log(`Total Validations: ${summary.totalValidations}`);
        console.log(`Passed Validations: ${summary.passedValidations} (${((summary.passedValidations/summary.totalValidations)*100).toFixed(1)}%)`);
        console.log(`Failed Validations: ${summary.failedValidations} (${((summary.failedValidations/summary.totalValidations)*100).toFixed(1)}%)`);
        
        // Critical Issues
        const criticalIssues = [];
        for (const result of this.results) {
            for (const [validationType, validation] of Object.entries(result.validations)) {
                if (!validation.passed) {
                    validation.issues.forEach(issue => {
                        criticalIssues.push(`${result.testCase} - ${validationType}: ${issue}`);
                    });
                }
            }
        }
        
        if (criticalIssues.length > 0) {
            console.log('\n🚨 CRITICAL ISSUES FOUND:');
            console.log('-'.repeat(50));
            criticalIssues.forEach((issue, index) => {
                console.log(`${index + 1}. ${issue}`);
            });
        }
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        console.log('-'.repeat(50));
        
        if (summary.failedValidations === 0) {
            console.log('✅ All validations passed! The concurrency configuration system is working correctly.');
        } else {
            console.log('❌ Issues detected in the concurrency configuration system.');
            console.log('   1. Review the critical issues listed above');
            console.log('   2. Ensure PipelineConfig and WorkerPoolManager are aligned');
            console.log('   3. Verify queue concurrency matches worker limits');
            console.log('   4. Check Redis pool sizing is appropriate for expected load');
            console.log('   5. Test edge cases and error handling');
        }
        
        console.log('\n' + '='.repeat(100));
        
        // Exit with appropriate code
        if (summary.failedValidations > 0) {
            process.exit(1);
        }
    }
}

// Run the validation if this script is executed directly
if (require.main === module) {
    const validator = new ConcurrencyValidationSuite();
    validator.runValidation().catch(error => {
        console.error('❌ Validation suite failed:', error);
        process.exit(1);
    });
}

module.exports = { ConcurrencyValidationSuite };