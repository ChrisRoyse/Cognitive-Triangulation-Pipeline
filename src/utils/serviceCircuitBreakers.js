const { CircuitBreaker } = require('./circuitBreaker');

class ServiceCircuitBreakerManager {
    constructor() {
        this.breakers = new Map();
        this.breakers.set('deepseek', new CircuitBreaker({ name: 'deepseek', failureThreshold: 5, resetTimeout: 30000 }));
        this.breakers.set('neo4j', new CircuitBreaker({ name: 'neo4j', failureThreshold: 3, resetTimeout: 60000 }));
        this.breakers.set('redis', new CircuitBreaker({ name: 'redis', failureThreshold: 5, resetTimeout: 20000 }));
    }
    
    async executeWithBreaker(serviceName, operation) {
        const breaker = this.breakers.get(serviceName);
        if (!breaker) {
            return await operation();
        }
        return await breaker.execute(operation);
    }
    
    getCircuitBreaker(serviceName) {
        return this.breakers.get(serviceName);
    }
}

module.exports = { ServiceCircuitBreakerManager };