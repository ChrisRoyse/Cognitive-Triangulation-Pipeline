# Master Pipeline Benchmark Test Suite

This directory contains the comprehensive benchmark validation system for the Cognitive Triangulation Pipeline. The master benchmark test validates that the pipeline meets all requirements specified in `POLYGLOT_TEST_BENCHMARK.md`.

## Overview

The benchmark test suite provides:

- **Complete pipeline validation** on the polyglot-test directory
- **Comprehensive metrics collection** (nodes, relationships, performance)
- **Cross-language relationship detection** validation
- **Performance grading** (A-F scale)
- **Detailed failure analysis** and debugging guidance
- **Actionable recommendations** for improvements

## Files

### Core Test Files

- **`masterBenchmark.test.js`** - Main benchmark test suite that validates all requirements
- **`benchmarkUtils.js`** - Utility functions for detailed analysis and validation
- **`runBenchmarkAnalysis.js`** - Standalone analysis runner for debugging

### Benchmark Requirements

The tests validate against these minimum requirements:
- **Minimum**: 300+ nodes, 1600+ relationships, 4+ ratio
- **Expected**: 417 nodes, 1876 relationships, 4.5 ratio
- **Performance**: 30-minute max execution time, cross-language detection
- **Quality Grades**: A (95%+), B (90%+), C (85%+), D (80%+)

## Running the Tests

### Quick Start

```bash
# Run the complete master benchmark test
npm run benchmark

# Run detailed analysis (without full pipeline execution)
npm run benchmark:analysis
```

### Alternative Methods

```bash
# Using Jest directly
npm run test:benchmark:master

# Using raw Jest
jest tests/benchmark/masterBenchmark.test.js --timeout=2100000

# Analysis only
node tests/benchmark/runBenchmarkAnalysis.js
```

## Test Execution Flow

The master benchmark test follows this comprehensive flow:

### 1. Pre-flight Validation
- Verifies polyglot-test directory structure
- Confirms all 15 required files are present
- Tests database connectivity (Neo4j and SQLite)
- Validates pipeline entry point

### 2. State Cleanup
- Clears previous Neo4j graph data
- Removes existing SQLite database
- Cleans temporary files and logs

### 3. Pipeline Execution
- Runs complete pipeline on polyglot-test directory
- Monitors execution time and memory usage
- Captures progress metrics and error information
- Enforces 30-minute timeout limit

### 4. Metrics Collection
- **Node Metrics**: Total count, types, distribution
- **Relationship Metrics**: Total count, types, ratio
- **Performance Metrics**: Execution time, memory, throughput
- **Cross-Language Analysis**: Pattern detection and validation

### 5. Quality Assessment
- Calculates component scores (nodes, relationships, cross-language)
- Determines overall performance grade (A-F)
- Identifies gaps and issues
- Generates specific recommendations

### 6. Reporting and Analysis
- Saves detailed JSON results for debugging
- Generates human-readable reports
- Provides actionable failure analysis
- Exports data in multiple formats (JSON, CSV, Markdown)

## Expected Results

### Minimum Pass Criteria
- ✅ Pipeline execution completes successfully
- ✅ At least 300 nodes extracted
- ✅ At least 1600 relationships detected
- ✅ Relationship ratio ≥ 4.0
- ✅ Execution time ≤ 30 minutes
- ✅ Critical cross-language relationships found

### Node Type Expectations
- **Files**: 15 (SQL, Java, JavaScript, Python)
- **Classes**: 20 (across all languages)
- **Functions**: 163+ (methods, functions, procedures)
- **Variables**: 63+ (fields, module variables)
- **Imports**: 65 (import statements across languages)
- **Database Entities**: 56 (tables, views, indexes, triggers)

### Relationship Type Expectations
- **DEFINES**: 300+ (file→class, class→method relationships)
- **CALLS**: 500+ (function calls, API calls)
- **USES**: 600+ (variable usage, dependencies)
- **IMPORTS**: 65+ (import relationships)
- **Cross-Language**: Critical patterns between Java, Python, JavaScript

### Critical Cross-Language Relationships
- Java UserService → Python DataProcessor API calls
- Java ApiClient → JavaScript server endpoints
- Python → Java service calls
- Database schema → code relationships
- ML model inheritance hierarchy (Python)

## Performance Grading

The benchmark uses a weighted scoring system:

| Component | Weight | Criteria |
|-----------|--------|----------|
| Node Count | 30% | Count vs expected (417 nodes) |
| Relationship Count | 30% | Count vs expected (1876 relationships) |
| Cross-Language Detection | 20% | Critical patterns found |
| Performance Compliance | 20% | Time, memory, error rate limits |

### Grade Scale
- **A**: 95%+ of expected results
- **B**: 90%+ of expected results
- **C**: 85%+ of expected results
- **D**: 80%+ of expected results
- **F**: Below 80%

## Troubleshooting

### Common Issues

#### Low Node Count
```bash
# Check entity extraction
- Review LLM prompts for completeness
- Verify all 15 files are being processed
- Check file discovery and filtering logic
```

#### Low Relationship Count
```bash
# Check relationship resolution
- Review relationship detection algorithms
- Verify cross-file analysis is working
- Check relationship type mapping
```

#### Missing Cross-Language Relationships
```bash
# Check multi-language analysis
- Verify API call detection logic
- Review cross-service relationship patterns
- Check language-specific parsers
```

#### Pipeline Execution Failure
```bash
# Check pipeline setup
- Verify database connections
- Check environment variables
- Review dependency installation
```

### Debugging Commands

```bash
# Check database states
npm run test:sqlite
npm run test:neo4j

# Validate complete pipeline state
npm run validate:state

# Run analysis without full pipeline
npm run benchmark:analysis

# Run with verbose output
npm run test:pipeline:verbose
```

### Log Analysis

Check these locations for debugging information:

1. **Test Results**: `./test-results/benchmark/`
   - Detailed JSON results
   - Human-readable reports
   - CSV summaries

2. **Pipeline Logs**: Check console output for:
   - File processing progress
   - Entity extraction counts
   - Relationship creation progress
   - Error messages

3. **Database Queries**: Use Neo4j Browser or SQLite tools to inspect:
   - Node counts by type: `MATCH (n) RETURN n.type, count(n)`
   - Relationship counts: `MATCH ()-[r]->() RETURN type(r), count(r)`
   - Cross-language patterns: Custom queries for API calls

## Integration with CI/CD

The benchmark tests are designed for continuous integration:

```yaml
# Example GitHub Actions workflow
- name: Run Master Benchmark
  run: npm run benchmark
  timeout-minutes: 40

- name: Upload Benchmark Results
  uses: actions/upload-artifact@v3
  with:
    name: benchmark-results
    path: test-results/benchmark/
```

## File Structure

```
tests/benchmark/
├── README.md                    # This documentation
├── masterBenchmark.test.js      # Main benchmark test
├── benchmarkUtils.js            # Analysis utilities
└── runBenchmarkAnalysis.js      # Standalone analysis runner
```

## Configuration

The benchmark uses `PipelineConfig.createForTesting()` which provides:
- Reduced concurrency for stable testing
- 5-minute timeout for test environment
- Error logging level
- Test-specific database paths

## Success Criteria Summary

For the benchmark to pass, the pipeline must:

1. ✅ Execute successfully within 30 minutes
2. ✅ Extract minimum 300 nodes (target: 417)
3. ✅ Detect minimum 1600 relationships (target: 1876)
4. ✅ Achieve relationship ratio ≥ 4.0 (target: 4.5)
5. ✅ Find critical cross-language relationships
6. ✅ Maintain acceptable error rates (≤ 5%)
7. ✅ Process all 15 polyglot-test files correctly

The benchmark provides comprehensive validation that the Cognitive Triangulation Pipeline can handle real-world, multi-language codebases effectively.