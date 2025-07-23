# Cognitive Triangulation Pipeline - State of the World Testing

This document describes the comprehensive testing system for validating the Cognitive Triangulation Pipeline against established benchmarks and ensuring consistent performance.

## Overview

The state-of-the-world testing system validates that the pipeline produces the exact expected database states when processing the `polyglot-test` directory. It provides:

- **Precise Benchmark Validation**: Tests against exact counts and distributions
- **Historical Trend Analysis**: Tracks performance over time
- **Regression Detection**: Identifies performance degradations
- **Cross-Language Validation**: Ensures polyglot relationship detection
- **Automated Reporting**: Generates actionable insights

## Quick Start

### Basic Pipeline Test
```bash
# Run complete pipeline test with validation
npm run test:pipeline

# Verbose output for debugging
npm run test:pipeline:verbose

# Dry run to validate setup without execution
npm run pipeline:dry-run
```

### Individual Component Testing
```bash
# Test only SQLite database state
npm run test:sqlite

# Test only Neo4j graph state  
npm run test:neo4j

# Test both databases
npm run validate:state

# Benchmark comparison only (no pipeline execution)
npm run test:benchmark
```

### Advanced Testing
```bash
# Reliability testing (multiple runs)
npm run pipeline:reliability

# Continuous monitoring mode
npm run test:pipeline:continuous
```

## Test Components

### 1. Pipeline Runner (`tests/pipeline_runner.js`)

Orchestrates complete pipeline execution and validation:

- Cleans previous state
- Runs pipeline on polyglot-test directory
- Validates resulting database states
- Generates comprehensive reports

**Usage:**
```javascript
const PipelineRunner = require('./tests/pipeline_runner');

const runner = new PipelineRunner({
    testDirectory: './polyglot-test',
    sqliteDbPath: './cognitive_graph.db',
    neo4jUri: 'bolt://localhost:7687',
    timeout: 300000,
    verbose: true
});

const results = await runner.run();
console.log(`Score: ${results.overallScore}/100`);
```

### 2. SQLite State Validator (`tests/sqlite_state_validator.js`)

Validates SQLite database against polyglot-test benchmarks:

**Expected State:**
- **files**: 15 rows (processed files)
- **pois**: 417 rows (extracted entities)
- **relationships**: 870 rows (entity relationships)
- **POI Distribution**: Functions (235), Classes (21), Variables (41), Imports (66)
- **Relationship Types**: CONTAINS (402), CALLS (150), USES (100), IMPORTS (66)

**Validation Includes:**
- Table row counts vs benchmarks
- Data quality checks (no orphaned relationships, valid line numbers)
- POI type distribution analysis
- Relationship type distribution analysis
- Data integrity verification

### 3. Neo4j State Validator (`tests/neo4j_state_validator.js`)

Validates Neo4j graph against polyglot-test benchmarks:

**Expected State:**
- **Total Nodes**: 417 (matching SQLite POIs)
- **Total Relationships**: 870 (2.1x node ratio)
- **Cross-Language Patterns**: JS-to-Python calls, SQL references, inheritance chains
- **Graph Integrity**: No isolated nodes, proper relationship ratios

**Validation Includes:**
- Node and relationship counts
- Cross-language relationship detection
- Graph structure integrity
- Property validation

### 4. Benchmark Comparator (`tests/benchmark_comparator.js`)

Advanced analysis system providing:

- **Historical Trend Analysis**: Performance tracking over time
- **Regression Detection**: Identifies performance drops
- **Recommendation Engine**: Actionable improvement suggestions
- **Alert System**: Critical issue notifications

## Polyglot-Test Benchmark

The `polyglot-test` directory contains a carefully crafted codebase that exercises all pipeline capabilities:

### File Structure
```
polyglot-test/
├── javascript/
│   ├── api-gateway.js          # Express API with user endpoints
│   └── frontend-app.js         # React frontend components
├── python/
│   ├── ml-service.py           # ML model with sklearn
│   └── data-processor.py       # Data processing utilities
├── java/
│   ├── DataProcessor.java      # Java data processing
│   └── ApiClient.java          # HTTP client for API calls
└── sql/
    ├── schema.sql              # Database tables and indexes
    ├── views.sql               # Database views
    └── triggers.sql            # Database triggers
```

### Expected Extraction Counts

| Entity Type | Count | Description |
|-------------|-------|-------------|
| Functions   | 235   | All functions/methods across languages |
| Classes     | 21    | Class definitions |
| Variables   | 41    | Module-level variables/constants |
| Imports     | 66    | Import/require statements |
| Tables      | 25    | SQL table definitions |
| Relationships | 870 | Total entity relationships |

### Critical Validation Points

1. **Cross-Language API Calls**: JavaScript calling Python ML service
2. **Database References**: Code referencing SQL schema entities
3. **Inheritance Chains**: Python class inheritance detection
4. **Import Resolution**: Cross-file dependency tracking

## Test Execution Workflow

### 1. Pre-flight Checks
- Validates test directory structure
- Confirms database connectivity
- Checks pipeline entry points

### 2. State Cleanup
- Removes previous SQLite database
- Clears Neo4j graph data
- Cleans temporary files

### 3. Pipeline Execution
- Runs pipeline with environment variables:
  ```bash
  NODE_ENV=test
  TEST_MODE=true
  TARGET_DIRECTORY=./polyglot-test
  ```
- Monitors execution with timeout
- Captures output for metrics extraction

### 4. Database Validation
- SQLite: Table counts, data quality, distributions
- Neo4j: Graph structure, relationships, cross-language patterns

### 5. Report Generation
- JSON reports for automation
- Markdown summaries for humans
- Historical trend analysis
- Regression detection

## Success Criteria

### Minimum Passing Thresholds (85%+ overall score)

**SQLite Database:**
- Files: ≥13 processed successfully
- POIs: ≥375 total entities extracted
- Relationships: ≥697 total relationships
- Error rate: <5% orphaned relationships

**Neo4j Graph:**
- Nodes: ≥375 (matching SQLite POIs within 10%)
- Relationships: ≥697 with 1.8-3.0x node ratio
- Cross-language patterns: All detected
- Graph integrity: <10% isolated nodes

**Pipeline Performance:**
- Execution time: <2 minutes
- Memory usage: <1GB peak
- Success rate: 100% for test runs

## Usage Examples

### Basic Testing
```bash
# Run standard pipeline test
npm run test:pipeline

# Expected output:
# ✅ Pipeline completed successfully
# ✅ SQLite validation passed (score: 95/100)
# ✅ Neo4j validation passed (score: 92/100)
# 📊 Overall Score: 94/100 - PASSED
```

### Debugging Failed Tests
```bash
# Verbose output for troubleshooting
npm run test:pipeline:verbose

# Check individual components
npm run test:sqlite     # SQLite-specific issues
npm run test:neo4j      # Neo4j-specific issues

# Validate setup without running pipeline
npm run pipeline:dry-run
```

### Continuous Integration
```bash
# Reliability testing (recommended for CI)
npm run pipeline:reliability

# Quick benchmark check
npm run test:benchmark
```

### Development Workflow
```bash
# Start continuous monitoring during development
npm run test:pipeline:continuous

# In another terminal, make code changes
# Monitor automatically detects issues
```

## Interpreting Results

### Score Breakdown
- **85-100**: Excellent - Pipeline working optimally
- **70-84**: Good - Minor issues, investigate warnings
- **50-69**: Poor - Significant problems, needs attention
- **<50**: Critical - Major failures, immediate action required

### Common Issues and Solutions

**Low POI Count:**
- Check file processing logic
- Verify LLM analysis quality
- Review chunking strategy

**Missing Relationships:**
- Investigate relationship resolution algorithms
- Check cross-file analysis
- Verify import/export detection

**Cross-Language Detection Failures:**
- Review API endpoint matching
- Check database schema references
- Validate inheritance detection

**Performance Issues:**
- Profile pipeline execution
- Check memory usage patterns
- Optimize chunking strategy

## Integration with CI/CD

### GitHub Actions Example
```yaml
name: Pipeline State Testing
on: [push, pull_request]

jobs:
  test-pipeline:
    runs-on: ubuntu-latest
    services:
      neo4j:
        image: neo4j:5.17
        env:
          NEO4J_AUTH: neo4j/password
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm install
      - run: npm run pipeline:dry-run
      - run: npm run pipeline:reliability
      
      - name: Upload test results
        uses: actions/upload-artifact@v4
        with:
          name: pipeline-test-results
          path: test-results/
```

### Environment Variables
```bash
# Required for testing
NODE_ENV=test
TEST_MODE=true

# Database connections
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password

# Test configuration
TEST_DIRECTORY=./polyglot-test
SQLITE_DB_PATH=./cognitive_graph.db
TEST_TIMEOUT=300000
```

## Troubleshooting

### Common Setup Issues

**Neo4j Connection Failed:**
```bash
# Check Neo4j is running
docker ps | grep neo4j

# Test connection
npm run test:neo4j:ip
```

**Missing Dependencies:**
```bash
# Install required packages
npm install commander better-sqlite3 neo4j-driver

# Check package versions
npm list neo4j-driver better-sqlite3
```

**Permission Issues:**
```bash
# Check database file permissions
ls -la cognitive_graph.db

# Ensure write access to test-results directory
mkdir -p test-results
chmod 755 test-results
```

### Test Failures

**SQLite Validation Failures:**
1. Check file processing completed successfully
2. Verify POI extraction logic
3. Review relationship resolution
4. Examine data quality issues

**Neo4j Validation Failures:**
1. Confirm data synchronization from SQLite
2. Check graph building logic
3. Verify relationship creation
4. Review cross-language pattern detection

**Pipeline Execution Failures:**
1. Check entry point exists and is executable
2. Verify environment variables are set
3. Review memory and timeout limits
4. Examine error logs for specific issues

## Best Practices

### Development
- Run `npm run pipeline:dry-run` before making changes
- Use `npm run test:pipeline:verbose` for debugging
- Monitor trends with continuous testing
- Address regressions immediately

### CI/CD
- Always run reliability testing for critical changes
- Set up alerts for score drops >10%
- Archive test results for historical analysis
- Use benchmark-only mode for quick validation

### Performance
- Monitor execution time trends
- Profile memory usage patterns
- Optimize based on bottleneck analysis
- Set reasonable timeout limits

This testing system ensures the Cognitive Triangulation Pipeline maintains consistent, high-quality performance across all supported code analysis scenarios.