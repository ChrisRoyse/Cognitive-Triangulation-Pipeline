# Smoke Tests - System Health Verification

Quick health checks for the CTP (Cognitive Triangulation Pipeline) system. These tests verify that all critical components are operational before deployment or after system restarts.

## Overview

- **Execution Time**: < 30 seconds
- **Purpose**: Rapid system health verification
- **Exit Codes**: 0 for success, non-zero for failure (CI/CD compatible)

## Components Tested

1. **Configuration Validity**
   - Environment variables
   - Configuration format validation

2. **Database Connectivity**
   - SQLite connection and schema
   - Neo4j connection and queries
   - Redis connection and operations

3. **External Services**
   - DeepSeek API availability
   - API key validation

4. **System Resources**
   - File system permissions
   - Memory availability
   - CPU resources

5. **Application Components**
   - Worker pool initialization
   - Circuit breaker status
   - Queue configuration

## Running Smoke Tests

### Quick Start
```bash
npm run smoke
# or
npm run test:smoke
```

### Direct Execution
```bash
node tests/smoke/runSmokeTests.js
```

### With Docker Compose
```bash
# Start test environment
docker-compose -f tests/smoke/docker-compose.smoke.yml up -d

# Run tests
npm run smoke

# Cleanup
docker-compose -f tests/smoke/docker-compose.smoke.yml down
```

## CI/CD Integration

### GitHub Actions
Copy `ci-smoke-test.yml.example` to `.github/workflows/smoke-test.yml` and configure:

```yaml
- name: Run smoke tests
  run: npm run test:smoke
```

### Jenkins
```groovy
stage('Smoke Tests') {
    steps {
        sh 'npm run test:smoke'
    }
}
```

### GitLab CI
```yaml
smoke-test:
  stage: test
  script:
    - npm run test:smoke
  timeout: 5 minutes
```

## Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed
- `2`: Test execution error

## Test Output

The tests provide:
- ✅ **Passed**: Component is working correctly
- ❌ **Failed**: Component has critical issues
- ⚠️  **Warning**: Non-critical issues detected

### Example Output
```
🔥 Running Smoke Tests...

Target: All tests should complete in < 30 seconds
══════════════════════════════════════════════════

 PASS  tests/smoke/smokeTests.test.js
  Smoke Tests - System Health Verification
    1. Configuration Validity
      ✓ All required environment variables are set (2 ms)
      ✓ Configuration values are valid (1 ms)
    2. Database Connectivity - SQLite
      ✓ Can connect to SQLite database (5 ms)
      ✓ Database schema is initialized (3 ms)
    ...

========== SMOKE TEST SUMMARY ==========
Total Duration: 12.45s
Passed: 15
Failed: 0
Warnings: 1

WARNINGS:
  ⚠️  High memory usage: 82.3%
========================================

✅ All smoke tests passed!

System is ready for deployment.
```

## Troubleshooting

### Common Issues

1. **Neo4j Connection Failed**
   ```
   Error: Failed to connect to Neo4j
   Solution: Ensure Neo4j is running on bolt://localhost:7687
   ```

2. **Redis Connection Failed**
   ```
   Error: Redis connection refused
   Solution: Start Redis service or check REDIS_URL configuration
   ```

3. **API Key Invalid**
   ```
   Error: Invalid API key
   Solution: Set DEEPSEEK_API_KEY in .env file
   ```

### Debug Mode
```bash
# Run with Jest debug output
npx jest tests/smoke/smokeTests.test.js --verbose --detectOpenHandles
```

## Customization

### Add New Tests
Edit `smokeTests.test.js` and add new test suites:

```javascript
describe('New Component', () => {
    test('Component is healthy', async () => {
        // Your test logic
        testResults.passed.push({ name: 'New Component' });
    });
});
```

### Adjust Timeouts
Modify the timeout in `smokeTests.test.js`:
```javascript
jest.setTimeout(30000); // 30 seconds
```

### Configure Thresholds
Update warning thresholds in the tests:
```javascript
if (memoryUsagePercent > 90) { // Change threshold
    testResults.warnings.push(`High memory usage: ${memoryUsagePercent.toFixed(1)}%`);
}
```

## Best Practices

1. **Keep tests fast** - Each test should complete in < 5 seconds
2. **Test connectivity only** - Don't test business logic
3. **Clear error messages** - Help diagnose issues quickly
4. **Non-destructive** - Don't modify production data
5. **Idempotent** - Can run multiple times safely

## Integration with Monitoring

The smoke tests can be integrated with monitoring systems:

```javascript
// Export results for monitoring
const results = require('./smokeTests').getTestResults();
// Send to monitoring system
```

## Security Notes

- API keys are never logged
- Test data is cleaned up automatically
- Connection strings are validated but not exposed
- Failed authentication is reported without details