/**
 * Unit Tests for Service-Specific Circuit Breakers
 * 
 * Tests circuit breaker implementations for each external service:
 * - DeepSeek API Circuit Breaker
 * - Neo4j Database Circuit Breaker
 * - Redis Cache Circuit Breaker
 * 
 * Test Scenarios:
 * 1. Service-specific failure patterns
 * 2. Recovery strategies
 * 3. Fallback mechanisms
 * 4. Integration with concurrency manager
 * 5. Performance impact
 */

// Mock external dependencies
require('../../jest.mocks');

const { 
    DeepSeekCircuitBreaker,
    Neo4jCircuitBreaker,
    RedisCircuitBreaker,
    ServiceCircuitBreakerManager
} = require('../../../src/utils/serviceCircuitBreakers');

describe('DeepSeekCircuitBreaker', () => {
    let circuitBreaker;
    let mockLLMService;
    
    beforeEach(() => {
        mockLLMService = {
            analyze: jest.fn(),
            generateRelationships: jest.fn()
        };
        
        circuitBreaker = new DeepSeekCircuitBreaker({
            failureThreshold: 5,
            resetTimeout: 30000,
            requestTimeout: 10000,
            service: mockLLMService
        });
    });
    
    afterEach(() => {
        jest.clearAllMocks();
    });
    
    describe('API-Specific Failure Handling', () => {
        test('should handle rate limit errors specially', async () => {
            const rateLimitError = new Error('Rate limit exceeded');
            rateLimitError.code = 'RATE_LIMIT';
            rateLimitError.retryAfter = 60000;
            
            mockLLMService.analyze.mockRejectedValue(rateLimitError);
            
            // Should not count rate limits as failures
            for (let i = 0; i < 10; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    expect(error.code).toBe('RATE_LIMIT');
                }
            }
            
            expect(circuitBreaker.getState()).toBe('CLOSED');
            expect(circuitBreaker.getFailureCount()).toBe(0);
            expect(circuitBreaker.getRateLimitBackoff()).toBe(60000);
        });
        
        test('should handle timeout errors', async () => {
            mockLLMService.analyze.mockImplementation(() => {
                return new Promise((resolve) => {
                    setTimeout(resolve, 20000); // Longer than timeout
                });
            });
            
            await expect(
                circuitBreaker.execute(() => mockLLMService.analyze({}))
            ).rejects.toThrow('Request timeout');
            
            expect(circuitBreaker.getFailureCount()).toBe(1);
        });
        
        test('should handle authentication errors without opening', async () => {
            const authError = new Error('Invalid API key');
            authError.code = 'AUTH_ERROR';
            
            mockLLMService.analyze.mockRejectedValue(authError);
            
            // Auth errors should not open circuit
            for (let i = 0; i < 10; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    expect(error.code).toBe('AUTH_ERROR');
                }
            }
            
            expect(circuitBreaker.getState()).toBe('CLOSED');
            expect(circuitBreaker.isPermanentError()).toBe(true);
        });
        
        test('should handle network errors and open circuit', async () => {
            const networkError = new Error('ECONNREFUSED');
            networkError.code = 'ECONNREFUSED';
            
            mockLLMService.analyze.mockRejectedValue(networkError);
            
            // Trigger failures
            for (let i = 0; i < 5; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    // Expected
                }
            }
            
            expect(circuitBreaker.getState()).toBe('OPEN');
            
            // Should fail fast when open
            const startTime = Date.now();
            await expect(
                circuitBreaker.execute(() => mockLLMService.analyze({}))
            ).rejects.toThrow('Circuit breaker is OPEN');
            
            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(10); // Fast fail
        });
    });
    
    describe('Intelligent Recovery', () => {
        test('should use exponential backoff for recovery', async () => {
            const networkError = new Error('Network error');
            mockLLMService.analyze.mockRejectedValue(networkError);
            
            // Open the circuit
            for (let i = 0; i < 5; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    // Expected
                }
            }
            
            expect(circuitBreaker.getState()).toBe('OPEN');
            
            // Check backoff periods
            const backoff1 = circuitBreaker.getNextRetryTime();
            
            // Force retry attempt
            jest.advanceTimersByTime(backoff1);
            circuitBreaker.attemptReset();
            
            // If it fails again, backoff should increase
            try {
                await circuitBreaker.execute(() => mockLLMService.analyze({}));
            } catch (error) {
                // Expected
            }
            
            const backoff2 = circuitBreaker.getNextRetryTime();
            expect(backoff2).toBeGreaterThan(backoff1);
        });
        
        test('should gradually test service health in half-open state', async () => {
            const networkError = new Error('Network error');
            let callCount = 0;
            
            mockLLMService.analyze.mockImplementation(() => {
                callCount++;
                if (callCount <= 5) {
                    throw networkError;
                }
                return Promise.resolve({ success: true });
            });
            
            // Open the circuit
            for (let i = 0; i < 5; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    // Expected
                }
            }
            
            expect(circuitBreaker.getState()).toBe('OPEN');
            
            // Wait for reset timeout
            jest.advanceTimersByTime(30000);
            
            // Should transition to half-open and allow limited requests
            const result = await circuitBreaker.execute(() => mockLLMService.analyze({}));
            expect(result.success).toBe(true);
            expect(circuitBreaker.getState()).toBe('HALF_OPEN');
            
            // After successful requests, should close
            await circuitBreaker.execute(() => mockLLMService.analyze({}));
            await circuitBreaker.execute(() => mockLLMService.analyze({}));
            
            expect(circuitBreaker.getState()).toBe('CLOSED');
        });
    });
    
    describe('Fallback Mechanisms', () => {
        test('should use cached responses when circuit is open', async () => {
            const cachedResponse = { cached: true, data: 'cached-analysis' };
            circuitBreaker.setCacheFallback(() => cachedResponse);
            
            // Open the circuit
            const error = new Error('Service unavailable');
            mockLLMService.analyze.mockRejectedValue(error);
            
            for (let i = 0; i < 5; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    // Expected
                }
            }
            
            // Now should use fallback
            const result = await circuitBreaker.execute(
                () => mockLLMService.analyze({}),
                { useFallback: true }
            );
            
            expect(result).toEqual(cachedResponse);
            expect(result.cached).toBe(true);
        });
        
        test('should degrade gracefully with simplified analysis', async () => {
            circuitBreaker.setDegradedMode(true);
            
            const degradedResponse = { 
                simplified: true, 
                confidence: 0.5,
                data: 'basic-analysis' 
            };
            
            circuitBreaker.setDegradedFunction(() => degradedResponse);
            
            // Open the circuit
            mockLLMService.analyze.mockRejectedValue(new Error('Service error'));
            
            for (let i = 0; i < 5; i++) {
                try {
                    await circuitBreaker.execute(() => mockLLMService.analyze({}));
                } catch (error) {
                    // Expected
                }
            }
            
            // Should use degraded function
            const result = await circuitBreaker.execute(
                () => mockLLMService.analyze({}),
                { allowDegraded: true }
            );
            
            expect(result.simplified).toBe(true);
            expect(result.confidence).toBe(0.5);
        });
    });
});

describe('Neo4jCircuitBreaker', () => {
    let circuitBreaker;
    let mockNeo4jClient;
    
    beforeEach(() => {
        mockNeo4jClient = {
            session: jest.fn(),
            verifyConnectivity: jest.fn()
        };
        
        circuitBreaker = new Neo4jCircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 60000,
            connectionTimeout: 5000,
            client: mockNeo4jClient
        });
    });
    
    describe('Database-Specific Failure Handling', () => {
        test('should handle connection pool exhaustion', async () => {
            const poolError = new Error('Connection pool exhausted');
            poolError.code = 'Neo.ClientError.Pool.ExhaustedPool';
            
            mockNeo4jClient.session.mockImplementation(() => {
                throw poolError;
            });
            
            // Should not immediately open circuit for pool exhaustion
            for (let i = 0; i < 2; i++) {
                try {
                    await circuitBreaker.execute(() => {
                        const session = mockNeo4jClient.session();
                        return session.run('MATCH (n) RETURN n');
                    });
                } catch (error) {
                    expect(error.code).toBe('Neo.ClientError.Pool.ExhaustedPool');
                }
            }
            
            expect(circuitBreaker.getState()).toBe('CLOSED');
            expect(circuitBreaker.shouldBackoff()).toBe(true);
        });
        
        test('should handle transaction deadlocks', async () => {
            const deadlockError = new Error('Deadlock detected');
            deadlockError.code = 'Neo.TransientError.Transaction.DeadlockDetected';
            
            mockNeo4jClient.session.mockImplementation(() => ({
                run: jest.fn().mockRejectedValue(deadlockError),
                close: jest.fn()
            }));
            
            // Deadlocks should not count as circuit breaker failures
            for (let i = 0; i < 10; i++) {
                try {
                    await circuitBreaker.execute(async () => {
                        const session = mockNeo4jClient.session();
                        return session.run('CREATE (n:Node)');
                    });
                } catch (error) {
                    expect(error.code).toBe('Neo.TransientError.Transaction.DeadlockDetected');
                }
            }
            
            expect(circuitBreaker.getState()).toBe('CLOSED');
            expect(circuitBreaker.getTransientErrorCount()).toBeGreaterThan(0);
        });
        
        test('should handle database unavailability', async () => {
            const serviceError = new Error('Database unavailable');
            serviceError.code = 'ServiceUnavailable';
            
            mockNeo4jClient.verifyConnectivity.mockRejectedValue(serviceError);
            
            // Should open circuit quickly for service unavailability
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => 
                        mockNeo4jClient.verifyConnectivity()
                    );
                } catch (error) {
                    // Expected
                }
            }
            
            expect(circuitBreaker.getState()).toBe('OPEN');
        });
    });
    
    describe('Connection Health Monitoring', () => {
        test('should perform health checks in half-open state', async () => {
            // Open the circuit
            const error = new Error('Connection failed');
            mockNeo4jClient.verifyConnectivity.mockRejectedValue(error);
            
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => 
                        mockNeo4jClient.verifyConnectivity()
                    );
                } catch (error) {
                    // Expected
                }
            }
            
            expect(circuitBreaker.getState()).toBe('OPEN');
            
            // Mock recovery
            mockNeo4jClient.verifyConnectivity.mockResolvedValue(true);
            
            // Wait for reset timeout
            jest.advanceTimersByTime(60000);
            
            // Should perform health check first
            const healthCheck = await circuitBreaker.performHealthCheck();
            expect(healthCheck.healthy).toBe(true);
            expect(circuitBreaker.getState()).toBe('HALF_OPEN');
        });
        
        test('should monitor query performance', async () => {
            const mockSession = {
                run: jest.fn().mockImplementation(async () => {
                    // Simulate slow query
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    return { records: [] };
                }),
                close: jest.fn()
            };
            
            mockNeo4jClient.session.mockReturnValue(mockSession);
            
            // Execute queries
            for (let i = 0; i < 5; i++) {
                await circuitBreaker.execute(async () => {
                    const session = mockNeo4jClient.session();
                    const result = await session.run('MATCH (n) RETURN n');
                    session.close();
                    return result;
                });
            }
            
            const metrics = circuitBreaker.getPerformanceMetrics();
            expect(metrics.avgQueryTime).toBeGreaterThan(2900);
            expect(metrics.slowQueries).toBeGreaterThan(0);
        });
    });
    
    describe('Query Retry Strategies', () => {
        test('should retry transient errors with backoff', async () => {
            let attempts = 0;
            const mockSession = {
                run: jest.fn().mockImplementation(() => {
                    attempts++;
                    if (attempts < 3) {
                        const error = new Error('Transient error');
                        error.code = 'Neo.TransientError.General.Unknown';
                        throw error;
                    }
                    return { records: [{ data: 'success' }] };
                }),
                close: jest.fn()
            };
            
            mockNeo4jClient.session.mockReturnValue(mockSession);
            
            const result = await circuitBreaker.execute(async () => {
                const session = mockNeo4jClient.session();
                const result = await session.run('MATCH (n) RETURN n');
                session.close();
                return result;
            }, { maxRetries: 3 });
            
            expect(result.records[0].data).toBe('success');
            expect(attempts).toBe(3);
        });
        
        test('should not retry non-transient errors', async () => {
            const mockSession = {
                run: jest.fn().mockImplementation(() => {
                    const error = new Error('Syntax error');
                    error.code = 'Neo.ClientError.Statement.SyntaxError';
                    throw error;
                }),
                close: jest.fn()
            };
            
            mockNeo4jClient.session.mockReturnValue(mockSession);
            
            await expect(
                circuitBreaker.execute(async () => {
                    const session = mockNeo4jClient.session();
                    return session.run('INVALID QUERY');
                }, { maxRetries: 3 })
            ).rejects.toThrow('Syntax error');
            
            expect(mockSession.run).toHaveBeenCalledTimes(1); // No retries
        });
    });
});

describe('ServiceCircuitBreakerManager', () => {
    let manager;
    let mockServices;
    
    beforeEach(() => {
        mockServices = {
            llm: { analyze: jest.fn() },
            neo4j: { session: jest.fn(), verifyConnectivity: jest.fn() },
            redis: { get: jest.fn(), set: jest.fn() }
        };
        
        manager = new ServiceCircuitBreakerManager({
            services: mockServices,
            globalConcurrencyManager: {
                acquire: jest.fn().mockResolvedValue({ id: 'permit-123' }),
                release: jest.fn()
            }
        });
    });
    
    describe('Coordinated Circuit Breaking', () => {
        test('should coordinate failures across services', async () => {
            // Simulate cascading failure
            mockServices.neo4j.verifyConnectivity.mockRejectedValue(
                new Error('Database down')
            );
            mockServices.llm.analyze.mockRejectedValue(
                new Error('Service overloaded')
            );
            
            // Trigger Neo4j failures
            for (let i = 0; i < 3; i++) {
                try {
                    await manager.executeWithBreaker('neo4j', async () => {
                        return mockServices.neo4j.verifyConnectivity();
                    });
                } catch (error) {
                    // Expected
                }
            }
            
            // Should affect LLM circuit breaker threshold
            const llmBreaker = manager.getCircuitBreaker('deepseek');
            expect(llmBreaker.getAdjustedThreshold()).toBeLessThan(5);
            
            // Trigger fewer LLM failures to open circuit
            for (let i = 0; i < 3; i++) {
                try {
                    await manager.executeWithBreaker('deepseek', async () => {
                        return mockServices.llm.analyze({});
                    });
                } catch (error) {
                    // Expected
                }
            }
            
            expect(llmBreaker.getState()).toBe('OPEN');
        });
        
        test('should prevent cascade failures', async () => {
            // Open Neo4j circuit
            mockServices.neo4j.verifyConnectivity.mockRejectedValue(
                new Error('Connection failed')
            );
            
            for (let i = 0; i < 3; i++) {
                try {
                    await manager.executeWithBreaker('neo4j', async () => {
                        return mockServices.neo4j.verifyConnectivity();
                    });
                } catch (error) {
                    // Expected
                }
            }
            
            // Should activate protective mode
            expect(manager.isInProtectiveMode()).toBe(true);
            
            // Should limit concurrency for other services
            const concurrencyLimit = manager.getAdjustedConcurrencyLimit('deepseek');
            expect(concurrencyLimit).toBeLessThan(50); // Reduced from normal
        });
    });
    
    describe('Health Monitoring', () => {
        test('should provide unified health status', async () => {
            const health = await manager.getHealthStatus();
            
            expect(health).toHaveProperty('overall');
            expect(health).toHaveProperty('services');
            expect(health.services).toHaveProperty('deepseek');
            expect(health.services).toHaveProperty('neo4j');
            expect(health.services).toHaveProperty('redis');
            expect(health).toHaveProperty('recommendations');
        });
        
        test('should detect unhealthy patterns', async () => {
            // Simulate intermittent failures
            let callCount = 0;
            mockServices.llm.analyze.mockImplementation(() => {
                callCount++;
                if (callCount % 3 === 0) {
                    throw new Error('Random failure');
                }
                return { success: true };
            });
            
            // Execute many requests
            for (let i = 0; i < 30; i++) {
                try {
                    await manager.executeWithBreaker('deepseek', () => 
                        mockServices.llm.analyze({})
                    );
                } catch (error) {
                    // Some will fail
                }
            }
            
            const patterns = manager.detectUnhealthyPatterns();
            expect(patterns).toContain('intermittent_failures');
            expect(patterns).toContain('degraded_performance');
        });
    });
    
    describe('Adaptive Behavior', () => {
        test('should adapt thresholds based on system load', async () => {
            // Simulate high system load
            manager.updateSystemMetrics({
                cpuUsage: 85,
                memoryUsage: 90,
                activeConnections: 95
            });
            
            const adaptedConfig = manager.getAdaptedConfiguration();
            
            expect(adaptedConfig.deepseek.failureThreshold).toBeGreaterThan(5);
            expect(adaptedConfig.neo4j.resetTimeout).toBeGreaterThan(60000);
            expect(adaptedConfig.concurrencyReduction).toBeGreaterThan(0);
        });
        
        test('should recover gracefully when load decreases', async () => {
            // Start with high load
            manager.updateSystemMetrics({
                cpuUsage: 85,
                memoryUsage: 90,
                activeConnections: 95
            });
            
            // Reduce load
            manager.updateSystemMetrics({
                cpuUsage: 40,
                memoryUsage: 50,
                activeConnections: 30
            });
            
            const adaptedConfig = manager.getAdaptedConfiguration();
            
            expect(adaptedConfig.deepseek.failureThreshold).toBe(5); // Back to normal
            expect(adaptedConfig.concurrencyReduction).toBe(0);
        });
    });
});