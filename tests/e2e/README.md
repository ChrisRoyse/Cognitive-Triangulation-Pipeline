# Comprehensive End-to-End Testing System

This directory contains the complete end-to-end testing infrastructure for the hybrid cognitive triangulation pipeline. The testing system validates accuracy, performance, scalability, and the theoretical benefits of the cognitive triangulation architecture.

## Test Components

### 1. **comprehensive-pipeline-e2e.test.js**
The main test suite that validates the entire pipeline from file discovery to graph building.

**Key Features:**
- Complete pipeline integration testing
- Accuracy metrics and benchmarking against ground truth
- Performance and scalability validation
- Quality assurance and edge case handling

**Run with:**
```bash
npm test tests/e2e/comprehensive-pipeline-e2e.test.js
```

### 2. **run-performance-benchmark.js**
Standalone performance benchmarking tool that compares different pipeline configurations.

**Configurations Tested:**
- Batch Mode Only
- Mixed Mode (Default)
- High Accuracy Mode
- High Concurrency Mode

**Run with:**
```bash
node tests/e2e/run-performance-benchmark.js
```

### 3. **validate-triangulation-benefits.js**
Validates that cognitive triangulation delivers the promised theoretical benefits.

**Validates:**
- Higher accuracy through multiple perspectives
- Better confidence calibration
- Reduced false positives
- Improved handling of complex relationships

**Run with:**
```bash
node tests/e2e/validate-triangulation-benefits.js
```

## Ground Truth Data

The `ground-truth/polyglot-relationships.json` file contains manually verified relationships from the polyglot-test codebase. This serves as the baseline for accuracy measurements.

**Ground Truth Categories:**
- `cross_language`: Relationships between different programming languages
- `data_model`: Entity-to-database mappings
- `intra_file`: Relationships within the same file
- `intra_directory`: Relationships within the same directory
- `cross_directory`: Relationships across directories
- `configuration`: Configuration-related relationships

## Success Criteria

The testing system validates against these success criteria:

1. **Overall Accuracy**: ≥ 95% on ground truth dataset
2. **Triangulated Analysis Accuracy**: ≥ 98% (beating individual analysis)
3. **Processing Time**: ≤ 20 minutes for polyglot-test directory
4. **Human Escalation Rate**: ≤ 2% of total relationships
5. **Memory Usage**: ≤ 2GB peak during processing

## Utility Classes

### MetricsCollector
Collects and aggregates metrics throughout the test execution:
- Stage completion times
- Analysis mode distribution
- Accuracy metrics
- Performance data

### GroundTruthValidator
Compares detected relationships against ground truth:
- Normalizes entity IDs for comparison
- Handles fuzzy matching for different naming conventions
- Generates detailed comparison reports

### PerformanceMonitor
Monitors system resources during test execution:
- Memory usage snapshots
- CPU utilization
- GC pressure analysis
- Performance trend detection

### AccuracyCalculator
Calculates comprehensive accuracy metrics:
- Precision, Recall, F1 Score
- Matthews Correlation Coefficient
- Confidence-accuracy correlation
- Statistical significance testing

## Running All Tests

To run the complete test suite:

```bash
# Run all E2E tests
npm run test:e2e

# Run with detailed output
npm run test:e2e -- --reporter spec

# Run specific test file
npm test tests/e2e/comprehensive-pipeline-e2e.test.js
```

## Test Reports

Test results are saved in the `reports/` directory:
- `e2e-test-report-*.json`: Comprehensive test results
- `benchmark-*.json`: Performance benchmark results
- `triangulation-validation-*.json`: Triangulation benefits validation

## Performance Tuning

Based on test results, you can tune the pipeline configuration:

```javascript
const config = {
    confidence: {
        batchAnalysisThreshold: 0.8,    // Lower = more batch mode
        individualAnalysisThreshold: 0.6, // Lower = more individual analysis
        humanEscalationThreshold: 0.4    // Lower = more escalations
    },
    workerConcurrency: {
        fileAnalysis: 4,  // Parallel file processing
        validation: 2     // Parallel validation
    }
};
```

## Troubleshooting

### Test Failures
1. Check Neo4j connection: `npm run test:services`
2. Verify Redis is running: `redis-cli ping`
3. Check disk space for SQLite databases
4. Review logs in test output

### Performance Issues
1. Reduce worker concurrency if memory constrained
2. Increase confidence thresholds for faster processing
3. Use SSD for database storage
4. Ensure adequate CPU cores available

### Accuracy Issues
1. Review ground truth data for correctness
2. Check LLM API connectivity and rate limits
3. Analyze confidence score distribution
4. Review failed relationship comparisons

## Contributing

When adding new tests:
1. Update ground truth data if adding new test cases
2. Document expected behavior and success criteria
3. Add appropriate test categories
4. Include performance benchmarks for new features