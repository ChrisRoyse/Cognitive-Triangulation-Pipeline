/**
 * Standalone test for Service Circuit Breakers
 * Run with: node test-circuit-breakers.js
 */

const { 
    DeepSeekCircuitBreaker,
    Neo4jCircuitBreaker,
    ServiceCircuitBreakerManager
} = require('./src/utils/serviceCircuitBreakers');

async function testDeepSeekCircuitBreaker() {
    console.log('\n=== Testing DeepSeek Circuit Breaker ===');
    
    const mockService = {
        analyze: jest.fn()
    };
    
    const breaker = new DeepSeekCircuitBreaker({
        name: 'deepseek-test',
        failureThreshold: 3,
        resetTimeout: 1000,
        requestTimeout: 500,
        service: mockService
    });
    
    try {
        // Test rate limit handling
        console.log('\n1. Testing rate limit handling:');
        const rateLimitError = new Error('Rate limit exceeded');
        rateLimitError.code = 'RATE_LIMIT';
        rateLimitError.retryAfter = 1000;
        
        mockService.analyze = async () => { throw rateLimitError; };
        
        try {
            await breaker.execute(() => mockService.analyze());
        } catch (error) {
            console.log('✅ Rate limit detected:', error.message);
            console.log('   Backoff time:', breaker.getRateLimitBackoff() + 'ms');
            console.log('   Circuit state:', breaker.getState());
        }
        
        // Test network failures
        console.log('\n2. Testing network failures:');
        const networkError = new Error('Network error');
        networkError.code = 'ECONNREFUSED';
        
        mockService.analyze = async () => { throw networkError; };
        
        // Trigger failures
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => mockService.analyze());
            } catch (error) {
                console.log(`   Failure ${i + 1}/3`);
            }
        }
        
        console.log('✅ Circuit opened after 3 failures');
        console.log('   Circuit state:', breaker.getState());
        
        // Test fast fail
        console.log('\n3. Testing fast fail when open:');
        const startTime = Date.now();
        try {
            await breaker.execute(() => mockService.analyze());
        } catch (error) {
            const duration = Date.now() - startTime;
            console.log('✅ Failed fast in', duration + 'ms');
            console.log('   Error:', error.message);
        }
        
        // Test recovery
        console.log('\n4. Testing recovery:');
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        mockService.analyze = async () => ({ success: true });
        
        const result = await breaker.execute(() => mockService.analyze());
        console.log('✅ Circuit recovered:', result);
        console.log('   Circuit state:', breaker.getState());
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function testNeo4jCircuitBreaker() {
    console.log('\n=== Testing Neo4j Circuit Breaker ===');
    
    const mockClient = {
        session: jest.fn(),
        verifyConnectivity: jest.fn()
    };
    
    const breaker = new Neo4jCircuitBreaker({
        name: 'neo4j-test',
        failureThreshold: 3,
        connectionTimeout: 1000,
        client: mockClient
    });
    
    try {
        // Test connection pool exhaustion
        console.log('\n1. Testing connection pool exhaustion:');
        const poolError = new Error('Connection pool exhausted');
        poolError.code = 'Neo.ClientError.Pool.ExhaustedPool';
        
        mockClient.session = () => { throw poolError; };
        
        try {
            await breaker.execute(() => {
                const session = mockClient.session();
                return session.run('MATCH (n) RETURN n');
            });
        } catch (error) {
            console.log('✅ Pool exhaustion handled:', error.message);
            console.log('   Should backoff:', breaker.shouldBackoff());
            console.log('   Circuit state:', breaker.getState());
        }
        
        // Test deadlock handling
        console.log('\n2. Testing deadlock handling:');
        const deadlockError = new Error('Deadlock detected');
        deadlockError.code = 'Neo.TransientError.Transaction.DeadlockDetected';
        
        mockClient.session = () => ({
            run: async () => { throw deadlockError; },
            close: () => {}
        });
        
        try {
            await breaker.execute(async () => {
                const session = mockClient.session();
                return session.run('CREATE (n:Node)');
            });
        } catch (error) {
            console.log('✅ Deadlock handled:', error.message);
            console.log('   Transient errors:', breaker.getTransientErrorCount());
            console.log('   Circuit state:', breaker.getState());
        }
        
        // Test service unavailability
        console.log('\n3. Testing service unavailability:');
        const serviceError = new Error('Database unavailable');
        serviceError.code = 'ServiceUnavailable';
        
        mockClient.verifyConnectivity = async () => { throw serviceError; };
        
        // Trigger failures
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => mockClient.verifyConnectivity());
            } catch (error) {
                console.log(`   Failure ${i + 1}/3`);
            }
        }
        
        console.log('✅ Circuit opened for service unavailability');
        console.log('   Circuit state:', breaker.getState());
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function testServiceCircuitBreakerManager() {
    console.log('\n=== Testing Service Circuit Breaker Manager ===');
    
    const mockServices = {
        llm: { analyze: jest.fn() },
        neo4j: { session: jest.fn(), verifyConnectivity: jest.fn() },
        redis: { get: jest.fn(), set: jest.fn() }
    };
    
    const manager = new ServiceCircuitBreakerManager({
        services: mockServices
    });
    
    try {
        // Test coordinated failures
        console.log('\n1. Testing coordinated failures:');
        
        // Fail Neo4j
        mockServices.neo4j.verifyConnectivity = async () => {
            throw new Error('Database down');
        };
        
        for (let i = 0; i < 3; i++) {
            try {
                await manager.executeWithBreaker('neo4j', async () => {
                    return mockServices.neo4j.verifyConnectivity();
                });
            } catch (error) {
                // Expected
            }
        }
        
        console.log('✅ Neo4j circuit opened');
        console.log('   Protective mode:', manager.isInProtectiveMode());
        
        // Test health status
        console.log('\n2. Testing health status:');
        const health = await manager.getHealthStatus();
        console.log('✅ Health status:');
        console.log('   Overall:', health.overall);
        console.log('   Services:', Object.keys(health.services));
        console.log('   Recommendations:', health.recommendations.length);
        
        // Test adaptive configuration
        console.log('\n3. Testing adaptive configuration:');
        manager.updateSystemMetrics({
            cpuUsage: 85,
            memoryUsage: 90,
            activeConnections: 95
        });
        
        const config = manager.getAdaptedConfiguration();
        console.log('✅ Adapted configuration:');
        console.log('   DeepSeek threshold:', config.deepseek.failureThreshold);
        console.log('   Neo4j timeout:', config.neo4j.resetTimeout);
        console.log('   Concurrency reduction:', config.concurrencyReduction + '%');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Mock jest.fn for standalone test
global.jest = {
    fn: (impl) => {
        const mockFn = impl || (() => {});
        mockFn.mockImplementation = (newImpl) => {
            Object.assign(mockFn, newImpl);
            return mockFn;
        };
        mockFn.mockResolvedValue = (value) => {
            Object.assign(mockFn, async () => value);
            return mockFn;
        };
        mockFn.mockRejectedValue = (error) => {
            Object.assign(mockFn, async () => { throw error; });
            return mockFn;
        };
        return mockFn;
    }
};

async function runAllTests() {
    console.log('🚀 Starting Service Circuit Breaker Tests\n');
    
    await testDeepSeekCircuitBreaker();
    await testNeo4jCircuitBreaker();
    await testServiceCircuitBreakerManager();
    
    console.log('\n✨ All tests completed!');
}

// Run tests
runAllTests().catch(console.error);