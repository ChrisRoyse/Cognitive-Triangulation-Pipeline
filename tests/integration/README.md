# Integration Test Suite for Cognitive Triangulation Pipeline Fixes

This comprehensive integration test suite validates that all pipeline fixes work together correctly and don't introduce performance regressions.

## Test Suite Overview

### 1. Comprehensive Pipeline Integration Test (`comprehensive-pipeline-integration.test.js`)
**Purpose**: Validates the complete end-to-end pipeline flow and all key fixes
- **Database Path Consistency**: Tests that all components use consistent database paths
- **Complete Pipeline Flow**: EntityScout → FileAnalysisWorker → ValidationWorker → ReconciliationWorker → GraphBuilder → Neo4j
- **POI ID Resolution**: Validates the TransactionalOutboxPublisher fix for resolving POI names to database IDs
- **Worker Concurrency**: Tests centralized concurrency configuration
- **File Processing**: Validates file filtering and .git directory exclusion
- **Redis Configuration**: Tests Redis eviction policy fix

### 2. Timeout Handling and Recovery Test (`timeout-recovery-integration.test.js`)
**Purpose**: Validates timeout fixes prevent hanging connections and handle failures gracefully
- **Neo4j Timeout Configuration**: Tests connection, transaction, and query timeouts
- **API Timeout Handling**: Tests DeepSeek API timeout handling with network delays
- **Worker Timeout Recovery**: Tests worker job timeouts without affecting other workers
- **System-Wide Integration**: Tests cascading timeout scenarios without system breakdown

### 3. Circuit Breaker Integration Test (`circuit-breaker-integration.test.js`)
**Purpose**: Validates circuit breaker behavior after configuration changes
- **State Management**: Tests CLOSED → OPEN → HALF_OPEN → CLOSED transitions
- **Service-Specific Behavior**: Tests LLM API and Neo4j circuit breakers separately
- **Metrics Collection**: Validates accurate metrics during circuit breaker operations
- **Worker Integration**: Tests circuit breaker integration with workers prevents cascading failures
- **Recovery Patterns**: Tests exponential backoff during recovery

### 4. Worker Scaling Stability Test (`worker-scaling-stability.test.js`)
**Purpose**: Validates worker scaling fixes prevent spam up/down behavior
- **Cooldown Prevention**: Tests cooldown periods prevent rapid scaling decisions
- **Sustained Load Detection**: Requires sustained load before scaling (not just spikes)
- **Resource Threshold Compliance**: Respects CPU/memory thresholds and worker limits
- **Centralized Configuration**: Uses pipeline config worker limits consistently
- **Scaling Stability**: Maintains stable behavior under variable load

### 5. Database Schema Validation Test (`database-schema-validation.test.js`)
**Purpose**: Validates database schema fixes and ValidationWorker improvements
- **Schema Consistency**: Tests all required tables and columns exist with proper indexes
- **Semantic ID Migration**: Tests migration and population of semantic_id column
- **ValidationWorker Integration**: Tests ValidationWorker handles schema changes correctly
- **Data Integrity**: Maintains referential integrity during schema updates
- **Performance Impact**: Tests query performance with semantic ID indexes

### 6. POI Relationship Fix Validation (`poi-relationship-fix-validation.test.js`)
**Purpose**: Validates the TransactionalOutboxPublisher POI ID resolution fix
- **Name to ID Resolution**: Tests POI names are correctly resolved to database IDs
- **Invalid Reference Handling**: Gracefully handles invalid POI references
- **Batch Processing**: Efficiently processes large batches of relationship creation
- **Cross-File Relationships**: Resolves POI IDs across different files correctly
- **Performance Testing**: Handles high-volume relationship creation efficiently

### 7. Performance Regression Validation (`performance-regression-validation.test.js`)
**Purpose**: Ensures fixes don't cause performance regressions
- **Database Performance**: Maintains insert, query, and migration performance
- **Worker Performance**: File analysis, validation, and outbox processing benchmarks
- **Neo4j Performance**: Node/relationship creation and query performance with timeouts
- **Memory Usage**: Stays within acceptable memory bounds during processing
- **End-to-End Benchmarks**: Overall pipeline performance maintains acceptable levels

## Running the Tests

### Prerequisites
1. **Environment Setup**: Ensure test environment variables are configured
2. **Services Running**: Neo4j, Redis, and test database must be accessible
3. **Dependencies**: All npm dependencies installed
4. **Test Data**: Tests create their own test data in temporary directories

### Running Individual Test Suites
```bash
# Run comprehensive pipeline integration test
npm test tests/integration/comprehensive-pipeline-integration.test.js

# Run timeout handling tests
npm test tests/integration/timeout-recovery-integration.test.js

# Run circuit breaker tests
npm test tests/integration/circuit-breaker-integration.test.js

# Run worker scaling tests
npm test tests/integration/worker-scaling-stability.test.js

# Run database schema tests
npm test tests/integration/database-schema-validation.test.js

# Run POI relationship fix tests
npm test tests/integration/poi-relationship-fix-validation.test.js

# Run performance regression tests
npm test tests/integration/performance-regression-validation.test.js
```

### Running All Integration Tests
```bash
# Run all integration tests
npm test tests/integration/

# Run with verbose output
npm test tests/integration/ -- --verbose

# Run with specific timeout (for longer tests)
npm test tests/integration/ -- --testTimeout=300000
```

## Test Utilities

### Integration Test Environment (`integration-test-utils.js`)
Provides comprehensive utilities for setting up realistic test scenarios:

- **IntegrationTestEnvironment**: Complete test environment setup and teardown
- **TestDataGenerator**: Creates realistic codebases with cross-file relationships
- **MockLLMResponseGenerator**: Generates realistic LLM responses for testing
- **IntegrationTestScenario**: Builds complete test scenarios with expected results

### Using Test Utilities
```javascript
const { IntegrationTestEnvironment, IntegrationTestScenario } = require('./integration-test-utils');

describe('My Integration Test', () => {
    let testEnv;
    
    beforeAll(async () => {
        testEnv = new IntegrationTestEnvironment({ verbose: true });
        await testEnv.initialize();
    });
    
    afterAll(async () => {
        await testEnv.cleanup();
    });
    
    test('should process realistic codebase', async () => {
        const scenario = new IntegrationTestScenario(testEnv);
        const testCase = await scenario.createPerformanceScenario('medium');
        
        // Run your test with the scenario data
        // testCase.files contains realistic code files
        // testCase.expectedResults contains minimum expected outcomes
    });
});
```

## Test Data and Cleanup

### Test Data Management
- Each test suite creates its own temporary directories
- Test databases are created in temporary locations
- Neo4j test data uses unique runIds for isolation
- Redis operations use test-specific keys

### Automatic Cleanup
- Test environments automatically clean up after themselves
- Temporary directories are removed after tests complete
- Database connections are properly closed
- Queue connections are cleaned up
- Neo4j test data is removed by runId

### Manual Cleanup (if needed)
```bash
# Remove any leftover temporary test directories
find tests/integration -name "*test-*" -type d -exec rm -rf {} +

# Clear Redis test data (if using test-specific prefix)
redis-cli FLUSHDB

# Clear Neo4j test data (replace with actual runId if known)
cypher-shell "MATCH (n) WHERE n.runId STARTS WITH 'test-' DETACH DELETE n"
```

## Expected Performance Benchmarks

The tests validate performance against these benchmarks:

### Database Operations
- Single insert: < 5ms
- Batch insert: < 1ms per item
- Indexed query: < 15ms
- Migration: < 1000ms

### Worker Processing
- File analysis: < 2000ms per small file
- Validation: < 100ms per POI
- Graph ingestion: < 500ms per batch
- Outbox processing: < 50ms per event

### Neo4j Operations
- Node creation: < 100ms per batch
- Relationship creation: < 150ms per batch
- Query: < 200ms
- Transaction timeout: < 30000ms (should not hang)

### Memory Usage
- Max heap used: < 256MB (test environment)
- Max RSS: < 512MB (test environment)

## Troubleshooting

### Common Issues

1. **Test Timeouts**: Some integration tests may take longer due to realistic processing
   - Increase test timeout: `jest.setTimeout(300000)` in test files
   - Use `--testTimeout=300000` flag when running tests

2. **Service Connection Failures**: 
   - Ensure Neo4j is running on expected port (7687)
   - Ensure Redis is running on expected port (6379)
   - Check environment variables in test configuration

3. **Database Permission Issues**:
   - Tests create temporary databases in test directories
   - Ensure write permissions in test directories
   - Check SQLite file creation permissions

4. **Memory Issues**:
   - Large test datasets may consume significant memory
   - Run tests individually if encountering memory limits
   - Consider reducing test data size for resource-constrained environments

### Debug Mode
Enable verbose logging in test utilities:
```javascript
const testEnv = new IntegrationTestEnvironment({ verbose: true });
```

### Performance Monitoring
Tests include built-in performance monitoring that reports:
- Operation durations
- Memory usage deltas
- Database query performance
- Worker processing times

Check test output for performance metrics and warnings about benchmark violations.

## Success Criteria

Tests validate that all fixes work correctly by ensuring:

1. **✅ Database Path Consistency**: All components use the same database path
2. **✅ POI ID Resolution**: Relationships use actual database IDs, not names
3. **✅ Worker Concurrency**: Centralized limits are respected across all workers
4. **✅ Timeout Handling**: Operations timeout gracefully without hanging
5. **✅ Circuit Breaker Recovery**: Circuit breakers recover correctly after timeout fixes
6. **✅ Worker Scaling Stability**: No rapid up/down scaling spam
7. **✅ Schema Validation**: Database schema changes work correctly
8. **✅ Performance Maintenance**: No significant performance regressions
9. **✅ File Processing**: Only code files processed, .git directories ignored
10. **✅ Error Handling**: Invalid references handled gracefully

Each test suite provides detailed validation of these criteria with realistic scenarios that reproduce the original issues to prove they're fixed.