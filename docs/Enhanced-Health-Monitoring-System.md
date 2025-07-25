# Enhanced Health Monitoring System

This document describes the enhanced health monitoring system that provides real dependency connectivity validation with proper error bubbling and timeout handling.

## Overview

The enhanced health monitoring system validates ALL service dependencies (Redis, Neo4j, SQLite) with actual connectivity tests instead of simple existence checks. Failed dependencies properly mark global health as unhealthy, and all dependency checks have appropriate timeouts.

## Key Features

### 1. Real Connectivity Testing
- **Neo4j**: Creates actual sessions and runs test queries
- **Redis**: Performs ping and set/get/delete operations
- **SQLite**: Tests read, write, and transaction capabilities
- **Queue Manager**: Validates connection pools and job operations
- **Worker Pool**: Checks circuit breaker states and concurrency limits

### 2. Enhanced Error Handling
- Comprehensive error context with validation types
- Proper timeout handling for all dependency checks
- Graceful degradation when dependencies fail
- Detailed error reporting with actionable insights

### 3. Global Health Impact
- Failed dependencies properly mark global health as unhealthy
- Configurable failure thresholds and recovery criteria
- Automatic recovery attempts with backoff strategies
- Real-time health status propagation

## Architecture

### Core Components

1. **HealthMonitor** (`src/utils/healthMonitor.js`)
   - Enhanced dependency health validation
   - Timeout-aware health checks
   - Global health status aggregation
   - Alert and recovery management

2. **Dependency Health Check Factories** (`src/utils/dependencyHealthChecks.js`)
   - Pre-built health check functions for common services
   - Timeout-wrapped connectivity tests
   - Comprehensive validation details

3. **Integration Example** (`examples/enhanced-health-monitoring-integration.js`)
   - Complete setup and configuration example
   - Event handling and monitoring patterns
   - Production-ready implementation guide

### Enhanced Validation Methods

#### Neo4j Validation
```javascript
async validateNeo4jConnectivity(dependency) {
    // 1. Verify driver connectivity
    await driver.verifyConnectivity();
    
    // 2. Create actual session
    const session = driver.session();
    
    // 3. Run test query
    const result = await session.run('RETURN 1 as test, datetime() as timestamp');
    
    // 4. Validate result
    // 5. Clean up session
}
```

#### Redis Validation
```javascript
async validateRedisConnectivity(dependency) {
    // 1. Test ping operation
    const pingResult = await client.ping();
    
    // 2. Test set/get operations
    await client.set(testKey, testValue, 'EX', 10);
    const retrievedValue = await client.get(testKey);
    
    // 3. Validate operations
    // 4. Clean up test data
}
```

#### SQLite Validation
```javascript
async validateSQLiteConnectivity(dependency) {
    // 1. Test basic query
    const result = db.prepare('SELECT 1 as test').get();
    
    // 2. Test write operations
    db.prepare('CREATE TEMP TABLE test_table ...').run();
    
    // 3. Test transactions
    const transaction = db.transaction(() => { ... });
    
    // 4. Validate all operations
    // 5. Clean up test data
}
```

## Configuration

### Health Monitor Settings
```javascript
const healthMonitor = new HealthMonitor({
    // Check intervals
    globalHealthInterval: 30000,      // 30 seconds
    dependencyHealthInterval: 60000,  // 1 minute
    
    // Failure thresholds
    unhealthyThreshold: 2,            // Mark unhealthy after 2 failures
    recoveryThreshold: 3,             // Mark healthy after 3 successes
    
    // Timeouts
    healthCheckTimeout: 15000,        // 15 seconds for dependency checks
    
    // Recovery settings
    enableAutoRecovery: true,
    maxRecoveryAttempts: 3
});
```

### Dependency Registration
```javascript
// Register with factory functions
healthMonitor.registerDependency(
    'neo4j',
    createNeo4jHealthCheck(neo4jDriver),
    async () => {
        // Recovery function
        await neo4jDriver.verifyConnectivity();
    }
);

healthMonitor.registerDependency(
    'redis',
    createRedisHealthCheck(cacheClient),
    async () => {
        // Recovery function
        await cacheClient.closeCacheClient();
        cacheClient.getCacheClient();
    }
);

healthMonitor.registerDependency(
    'sqlite',
    createSQLiteHealthCheck(dbManager),
    async () => {
        // Recovery function
        dbManager.close();
        await dbManager.initializeDb();
    }
);
```

## Usage Examples

### Basic Setup
```javascript
const { HealthMonitor } = require('./src/utils/healthMonitor');
const { 
    createNeo4jHealthCheck,
    createRedisHealthCheck,
    createSQLiteHealthCheck 
} = require('./src/utils/dependencyHealthChecks');

// Initialize health monitor
const healthMonitor = new HealthMonitor({
    dependencyHealthInterval: 60000,
    healthCheckTimeout: 15000,
    enableAutoRecovery: true
});

// Register dependencies
healthMonitor.registerDependency('neo4j', createNeo4jHealthCheck(neo4jDriver));
healthMonitor.registerDependency('redis', createRedisHealthCheck(cacheClient));
healthMonitor.registerDependency('sqlite', createSQLiteHealthCheck(dbManager));

// Start monitoring
healthMonitor.start();
```

### Event Handling
```javascript
// Listen for dependency health events
healthMonitor.on('dependencyHealth', (event) => {
    if (!event.healthy) {
        console.error(`Dependency ${event.name} failed: ${event.error}`);
        console.error(`Validation details:`, event.details);
    }
});

// Listen for global health changes
healthMonitor.on('globalHealthCheck', (results) => {
    if (!results.dependencies.healthy) {
        console.warn('System has unhealthy dependencies:', 
            results.dependencies.failureDetails);
    }
});

// Listen for alerts
healthMonitor.on('alert', (alert) => {
    console.warn(`Health Alert [${alert.level}]: ${alert.message}`);
});
```

### Health Status API
```javascript
// Get comprehensive health status
const healthStatus = healthMonitor.getHealthStatus();
console.log('Overall healthy:', healthStatus.summary.overallHealthy);
console.log('Dependencies:', healthStatus.summary.healthyDependencies, '/', healthStatus.summary.totalDependencies);

// Health check API endpoint
app.get('/health', async (req, res) => {
    const health = await healthMonitor.healthCheck();
    res.status(health.healthy ? 200 : 503).json(health);
});
```

## Testing

### Integration Tests
The system includes comprehensive integration tests in `tests/integration/enhanced-health-monitoring.test.js`:

- SQLite connectivity validation
- Neo4j session testing
- Redis ping and operations testing
- Global health status propagation
- Timeout handling
- Error recovery

### Running Tests
```bash
# Run specific health monitoring tests
npm test -- --testPathPattern=enhanced-health-monitoring

# Run all integration tests
npm test tests/integration/
```

### Test Example Usage
```bash
# Run the integration example
node examples/enhanced-health-monitoring-integration.js

# The example will:
# 1. Initialize all dependencies
# 2. Register enhanced health checks
# 3. Start monitoring
# 4. Display real-time health status
# 5. Demonstrate failure simulation
```

## Production Deployment

### Prerequisites
1. Ensure all dependencies (Redis, Neo4j, SQLite) are properly configured
2. Set appropriate timeout values based on network conditions
3. Configure alert thresholds based on application requirements
4. Set up monitoring dashboards to track health metrics

### Recommended Settings
```javascript
// Production configuration
const healthMonitor = new HealthMonitor({
    globalHealthInterval: 30000,      // 30 seconds
    dependencyHealthInterval: 120000, // 2 minutes
    healthCheckTimeout: 15000,        // 15 seconds
    unhealthyThreshold: 3,            // 3 consecutive failures
    recoveryThreshold: 2,             // 2 consecutive successes
    enableAlerts: true,
    alertCooldown: 300000,            // 5 minutes
    enableAutoRecovery: true,
    maxRecoveryAttempts: 3
});
```

### Monitoring Integration
```javascript
// Export metrics for external monitoring systems
healthMonitor.on('globalHealthCheck', (results) => {
    // Send to monitoring system (Prometheus, CloudWatch, etc.)
    metricsClient.gauge('app.health.global', results.dependencies.healthy ? 1 : 0);
    metricsClient.gauge('app.health.dependencies.total', results.dependencies.totalDependencies);
    metricsClient.gauge('app.health.dependencies.healthy', results.dependencies.healthyDependencies);
});
```

## Benefits

### 1. **Accurate Health Detection**
- Real connectivity tests instead of basic existence checks
- Proper validation of read/write capabilities
- Detection of partial service failures

### 2. **Improved Reliability**
- Failed dependencies properly impact global health status
- Automatic recovery attempts for transient failures
- Configurable failure thresholds prevent false positives

### 3. **Enhanced Debugging**
- Detailed error context with validation types
- Comprehensive health details for troubleshooting
- Timeout-specific error handling

### 4. **Production Readiness**
- Proper timeout handling prevents hanging operations
- Alert cooldown prevents notification spam
- Graceful degradation during dependency failures

## Migration from Basic Health Checks

### Before (Basic)
```javascript
// Simple existence check
healthMonitor.registerDependency('database', async () => {
    return dbManager ? true : false;
});
```

### After (Enhanced)
```javascript
// Real connectivity validation
healthMonitor.registerDependency(
    'database', 
    createSQLiteHealthCheck(dbManager),
    async () => {
        // Recovery logic
        dbManager.close();
        await dbManager.initializeDb();
    }
);
```

The enhanced system provides:
- Real database connectivity testing
- Write/read capability validation
- Transaction testing
- Proper error context
- Automatic recovery

## Troubleshooting

### Common Issues

1. **Timeout Errors**
   - Increase `healthCheckTimeout` for slow networks
   - Check network connectivity between services
   - Verify service responsiveness

2. **False Positives**
   - Adjust `unhealthyThreshold` to require more consecutive failures
   - Review validation logic for specific dependencies
   - Check for intermittent network issues

3. **Recovery Failures**
   - Implement custom recovery functions for specific dependencies
   - Check service configuration and permissions
   - Review dependency initialization logic

### Debug Logging
```javascript
// Enable detailed health check logging
healthMonitor.on('dependencyHealth', (event) => {
    console.log(`[Health Debug] ${event.name}:`, {
        healthy: event.healthy,
        error: event.error,
        details: event.details,
        consecutiveFailures: event.consecutiveFailures
    });
});
```

## Conclusion

The enhanced health monitoring system provides production-ready dependency validation with real connectivity tests, proper error handling, and automatic recovery capabilities. It ensures that health status accurately reflects system state and provides actionable insights for troubleshooting and maintenance.