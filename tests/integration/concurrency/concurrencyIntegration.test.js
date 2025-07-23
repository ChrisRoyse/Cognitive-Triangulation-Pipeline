/**
 * Integration Tests for Concurrency Management and Circuit Breakers
 * 
 * Tests the complete integration of:
 * - Global concurrency manager
 * - Service-specific circuit breakers
 * - Worker pool manager
 * - Real service interactions
 * 
 * These tests verify the system behaves correctly under various failure scenarios
 * and load conditions with all components working together.
 */

// Mock external dependencies
require('../../jest.mocks');

const { GlobalConcurrencyManager } = require('../../../src/utils/globalConcurrencyManager');
const { ServiceCircuitBreakerManager } = require('../../../src/utils/serviceCircuitBreakers');
const { WorkerPoolManager } = require('../../../src/utils/workerPoolManager');
const { PipelineConfig } = require('../../../src/config/PipelineConfig');

describe('Concurrency and Circuit Breaker Integration', () => {
    let globalConcurrencyManager;
    let circuitBreakerManager;
    let workerPoolManager;
    let config;
    
    beforeAll(async () => {
        config = PipelineConfig.createForTesting();
        
        // Initialize managers
        globalConcurrencyManager = new GlobalConcurrencyManager({
            maxConcurrency: 100,
            enablePriorities: true
        });
        
        circuitBreakerManager = new ServiceCircuitBreakerManager({
            globalConcurrencyManager
        });
        
        workerPoolManager = new WorkerPoolManager({
            environment: 'test',
            maxGlobalConcurrency: 100
        });
        
        // Wire up integration
        workerPoolManager.setGlobalConcurrencyManager(globalConcurrencyManager);
        workerPoolManager.setCircuitBreakerManager(circuitBreakerManager);
    });
    
    afterAll(async () => {
        await globalConcurrencyManager.shutdown();
        await workerPoolManager.shutdown();
    });
    
    describe('Full System Load Test', () => {
        test('should handle 100 concurrent workers without exceeding limit', async () => {
            const workerTypes = ['file-analysis', 'validation', 'relationship-resolution'];
            const workersPerType = 33;
            const promises = [];
            
            // Track actual concurrency
            let maxObservedConcurrency = 0;
            globalConcurrencyManager.on('permitAcquired', () => {
                const current = globalConcurrencyManager.getCurrentConcurrency();
                maxObservedConcurrency = Math.max(maxObservedConcurrency, current);
            });
            
            // Simulate workers
            for (const workerType of workerTypes) {
                for (let i = 0; i < workersPerType; i++) {
                    promises.push(
                        workerPoolManager.executeWithManagement(
                            workerType,
                            async () => {
                                // Simulate work
                                await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
                                return { success: true };
                            }
                        )
                    );
                }
            }
            
            const results = await Promise.all(promises);
            
            expect(results).toHaveLength(99);
            expect(results.every(r => r.success)).toBe(true);
            expect(maxObservedConcurrency).toBeLessThanOrEqual(100);
            expect(maxObservedConcurrency).toBeGreaterThan(50); // Should utilize capacity
        });
        
        test('should queue and process overflow requests', async () => {
            const totalRequests = 150;
            const results = [];
            const errors = [];
            
            // Fill up to capacity
            const blockerPromises = [];
            for (let i = 0; i < 100; i++) {
                blockerPromises.push(
                    globalConcurrencyManager.acquire(`blocker-${i}`)
                );
            }
            
            const blockers = await Promise.all(blockerPromises);
            expect(globalConcurrencyManager.getCurrentConcurrency()).toBe(100);
            
            // Submit overflow requests
            const overflowPromises = [];
            for (let i = 0; i < 50; i++) {
                overflowPromises.push(
                    workerPoolManager.executeWithManagement(
                        'overflow-worker',
                        async () => {
                            return { id: i, processed: Date.now() };
                        }
                    ).then(
                        result => results.push(result),
                        error => errors.push(error)
                    )
                );
            }
            
            // Verify they're queued
            expect(globalConcurrencyManager.getQueueLength()).toBeGreaterThan(0);
            
            // Gradually release blockers
            for (let i = 0; i < blockers.length; i++) {
                await globalConcurrencyManager.release(blockers[i].id);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            // Wait for overflow to complete
            await Promise.all(overflowPromises);
            
            expect(results).toHaveLength(50);
            expect(errors).toHaveLength(0);
        });
    });
    
    describe('Circuit Breaker Integration', () => {
        test('should reduce concurrency when circuit breakers open', async () => {
            // Simulate service failures
            const failingService = {
                execute: jest.fn().mockRejectedValue(new Error('Service error'))
            };
            
            // Register failing service
            circuitBreakerManager.registerService('failing-service', failingService, {
                failureThreshold: 5,
                resetTimeout: 30000
            });
            
            // Trigger failures to open circuit
            for (let i = 0; i < 5; i++) {
                try {
                    await circuitBreakerManager.executeWithBreaker(
                        'failing-service',
                        () => failingService.execute()
                    );
                } catch (error) {
                    // Expected
                }
            }
            
            // Circuit should be open
            const breaker = circuitBreakerManager.getCircuitBreaker('failing-service');
            expect(breaker.getState()).toBe('OPEN');
            
            // Worker pool should reduce concurrency
            const adjustedConcurrency = workerPoolManager.getAdjustedConcurrency('file-analysis');
            expect(adjustedConcurrency).toBeLessThan(40); // Reduced from normal
        });
        
        test('should handle cascading failures gracefully', async () => {
            const services = {
                primary: { execute: jest.fn() },
                secondary: { execute: jest.fn() },
                tertiary: { execute: jest.fn() }
            };
            
            // Register services with dependencies
            circuitBreakerManager.registerService('primary', services.primary, {
                failureThreshold: 3
            });
            circuitBreakerManager.registerService('secondary', services.secondary, {
                failureThreshold: 3,
                dependencies: ['primary']
            });
            circuitBreakerManager.registerService('tertiary', services.tertiary, {
                failureThreshold: 3,
                dependencies: ['secondary']
            });
            
            // Fail primary service
            services.primary.execute.mockRejectedValue(new Error('Primary failed'));
            
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreakerManager.executeWithBreaker(
                        'primary',
                        () => services.primary.execute()
                    );
                } catch (error) {
                    // Expected
                }
            }
            
            // Primary circuit should be open
            expect(circuitBreakerManager.getCircuitBreaker('primary').getState()).toBe('OPEN');
            
            // Dependent services should be in protective mode
            expect(circuitBreakerManager.isServiceProtected('secondary')).toBe(true);
            expect(circuitBreakerManager.isServiceProtected('tertiary')).toBe(true);
            
            // Should limit operations on dependent services
            const secondaryLimit = circuitBreakerManager.getConcurrencyLimit('secondary');
            expect(secondaryLimit).toBeLessThan(50); // Reduced
        });
    });
    
    describe('Real Service Integration', () => {
        test('should handle DeepSeek API failures gracefully', async () => {
            // Mock API failure scenario
            const mockLLMService = {
                analyze: jest.fn().mockImplementation(() => {
                    const error = new Error('Rate limit exceeded');
                    error.code = 'RATE_LIMIT';
                    error.retryAfter = 60000;
                    throw error;
                })
            };
            
            circuitBreakerManager.registerService('deepseek', mockLLMService);
            
            const results = [];
            const errors = [];
            
            // Try multiple concurrent requests
            const promises = [];
            for (let i = 0; i < 20; i++) {
                promises.push(
                    workerPoolManager.executeWithManagement(
                        'llm-analysis',
                        async () => {
                            return circuitBreakerManager.executeWithBreaker(
                                'deepseek',
                                () => mockLLMService.analyze({ code: 'test' })
                            );
                        }
                    ).then(
                        result => results.push(result),
                        error => errors.push(error)
                    )
                );
            }
            
            await Promise.all(promises);
            
            // All should fail with rate limit
            expect(errors).toHaveLength(20);
            expect(errors.every(e => e.message.includes('Rate limit'))).toBe(true);
            
            // Circuit should remain closed (rate limits don't open circuit)
            expect(circuitBreakerManager.getCircuitBreaker('deepseek').getState()).toBe('CLOSED');
            
            // But should have backoff state
            expect(circuitBreakerManager.getBackoffTime('deepseek')).toBe(60000);
        });
        
        test('should handle Neo4j connection failures', async () => {
            // Mock connection failure
            const mockNeo4j = {
                verifyConnectivity: jest.fn().mockRejectedValue(
                    new Error('Connection refused')
                ),
                session: jest.fn().mockImplementation(() => {
                    throw new Error('No connection available');
                })
            };
            
            circuitBreakerManager.registerService('neo4j', mockNeo4j, {
                failureThreshold: 3,
                healthCheck: () => mockNeo4j.verifyConnectivity()
            });
            
            // Attempt operations
            const operations = [];
            for (let i = 0; i < 5; i++) {
                operations.push(
                    circuitBreakerManager.executeWithBreaker(
                        'neo4j',
                        () => mockNeo4j.verifyConnectivity()
                    ).catch(e => e)
                );
            }
            
            const results = await Promise.all(operations);
            
            // First 3 should fail normally, last 2 should fail fast
            expect(results.slice(0, 3).every(e => e.message.includes('Connection refused'))).toBe(true);
            expect(results.slice(3).every(e => e.message.includes('Circuit breaker is OPEN'))).toBe(true);
            
            // System should enter protective mode
            expect(workerPoolManager.isInProtectiveMode()).toBe(true);
        });
    });
    
    describe('Performance Under Load', () => {
        test('should maintain <2% overhead with concurrency management', async () => {
            const iterations = 1000;
            const baselineResults = [];
            const managedResults = [];
            
            // Baseline: Direct execution without management
            const baselineStart = Date.now();
            for (let i = 0; i < iterations; i++) {
                const result = await (async () => {
                    // Simulate work
                    const start = Date.now();
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return Date.now() - start;
                })();
                baselineResults.push(result);
            }
            const baselineDuration = Date.now() - baselineStart;
            
            // Managed: With concurrency management
            const managedStart = Date.now();
            const managedPromises = [];
            
            for (let i = 0; i < iterations; i++) {
                managedPromises.push(
                    workerPoolManager.executeWithManagement(
                        'perf-test',
                        async () => {
                            const start = Date.now();
                            await new Promise(resolve => setTimeout(resolve, 10));
                            return Date.now() - start;
                        }
                    )
                );
                
                // Process in batches to avoid overwhelming
                if (i % 50 === 49) {
                    const batch = await Promise.all(managedPromises.splice(0, 50));
                    managedResults.push(...batch);
                }
            }
            
            // Process remaining
            const remaining = await Promise.all(managedPromises);
            managedResults.push(...remaining);
            
            const managedDuration = Date.now() - managedStart;
            
            // Calculate overhead
            const overhead = ((managedDuration - baselineDuration) / baselineDuration) * 100;
            
            console.log(`Performance overhead: ${overhead.toFixed(2)}%`);
            console.log(`Baseline: ${baselineDuration}ms, Managed: ${managedDuration}ms`);
            
            expect(overhead).toBeLessThan(2); // Less than 2% overhead
        });
        
        test('should handle mixed workload efficiently', async () => {
            const workload = [
                { type: 'file-analysis', duration: 50, count: 30 },
                { type: 'validation', duration: 20, count: 40 },
                { type: 'relationship-resolution', duration: 100, count: 20 },
                { type: 'graph-ingestion', duration: 150, count: 10 }
            ];
            
            const startTime = Date.now();
            const promises = [];
            
            for (const work of workload) {
                for (let i = 0; i < work.count; i++) {
                    promises.push(
                        workerPoolManager.executeWithManagement(
                            work.type,
                            async () => {
                                await new Promise(resolve => setTimeout(resolve, work.duration));
                                return { type: work.type, completed: Date.now() };
                            }
                        )
                    );
                }
            }
            
            const results = await Promise.all(promises);
            const totalDuration = Date.now() - startTime;
            
            expect(results).toHaveLength(100);
            
            // Verify fair distribution
            const typeDistribution = results.reduce((acc, r) => {
                acc[r.type] = (acc[r.type] || 0) + 1;
                return acc;
            }, {});
            
            expect(typeDistribution['file-analysis']).toBe(30);
            expect(typeDistribution['validation']).toBe(40);
            expect(typeDistribution['relationship-resolution']).toBe(20);
            expect(typeDistribution['graph-ingestion']).toBe(10);
            
            // Should complete efficiently
            const theoreticalMinimum = Math.max(
                30 * 50 / 40,  // file-analysis
                40 * 20 / 15,  // validation
                20 * 100 / 30, // relationship-resolution
                10 * 150 / 5   // graph-ingestion
            );
            
            expect(totalDuration).toBeLessThan(theoreticalMinimum * 1.5); // Allow 50% overhead
        });
    });
    
    describe('Recovery and Resilience', () => {
        test('should recover from temporary service outages', async () => {
            let failureCount = 0;
            const unreliableService = {
                execute: jest.fn().mockImplementation(() => {
                    failureCount++;
                    if (failureCount <= 5) {
                        throw new Error('Temporary failure');
                    }
                    return { success: true };
                })
            };
            
            circuitBreakerManager.registerService('unreliable', unreliableService, {
                failureThreshold: 3,
                resetTimeout: 1000 // Quick reset for testing
            });
            
            const results = [];
            const errors = [];
            
            // Execute requests over time
            for (let i = 0; i < 20; i++) {
                await new Promise(resolve => setTimeout(resolve, 200));
                
                try {
                    const result = await circuitBreakerManager.executeWithBreaker(
                        'unreliable',
                        () => unreliableService.execute()
                    );
                    results.push(result);
                } catch (error) {
                    errors.push(error);
                }
            }
            
            // Should have some failures and some successes
            expect(errors.length).toBeGreaterThan(0);
            expect(results.length).toBeGreaterThan(0);
            
            // Circuit should eventually close
            expect(circuitBreakerManager.getCircuitBreaker('unreliable').getState()).toBe('CLOSED');
        });
        
        test('should maintain system stability during partial failures', async () => {
            // Set up services with different failure rates
            const services = {
                stable: { execute: jest.fn().mockResolvedValue({ status: 'ok' }) },
                flaky: { 
                    execute: jest.fn().mockImplementation(() => {
                        if (Math.random() < 0.3) throw new Error('Random failure');
                        return { status: 'ok' };
                    })
                },
                failing: { execute: jest.fn().mockRejectedValue(new Error('Always fails')) }
            };
            
            // Register all services
            Object.entries(services).forEach(([name, service]) => {
                circuitBreakerManager.registerService(name, service, {
                    failureThreshold: 5
                });
            });
            
            // Run mixed workload
            const workPromises = [];
            for (let i = 0; i < 100; i++) {
                const serviceName = ['stable', 'flaky', 'failing'][i % 3];
                
                workPromises.push(
                    workerPoolManager.executeWithManagement(
                        `worker-${serviceName}`,
                        async () => {
                            try {
                                return await circuitBreakerManager.executeWithBreaker(
                                    serviceName,
                                    () => services[serviceName].execute()
                                );
                            } catch (error) {
                                return { error: error.message };
                            }
                        }
                    )
                );
            }
            
            const results = await Promise.all(workPromises);
            
            // Stable service should have 100% success
            const stableResults = results.filter((_, i) => i % 3 === 0);
            expect(stableResults.every(r => r.status === 'ok')).toBe(true);
            
            // System should remain operational
            expect(globalConcurrencyManager.getCurrentConcurrency()).toBe(0);
            expect(workerPoolManager.getStatus().globalConcurrency.utilization).toBeLessThan(100);
        });
    });
});