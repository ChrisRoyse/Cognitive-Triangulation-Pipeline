# Pipeline Benchmark Verification Script

## Overview
This script (`verify-pipeline-benchmarks.js`) performs comprehensive testing of the pipeline to ensure it meets the required benchmark performance metrics.

## What It Does

1. **Clears All Databases**
   - SQLite database
   - Redis cache
   - Neo4j graph database

2. **Runs the Pipeline**
   - Targets the `polyglot-test` directory
   - Monitors pipeline execution
   - Timeout: 5 minutes

3. **Verifies Completion**
   - Checks all queues are empty
   - Verifies no PENDING outbox records
   - Confirms pipeline has finished processing

4. **Collects Results**
   - SQLite: POIs and relationships count
   - Neo4j: Nodes and relationships count
   - Queue status: waiting, active, completed, failed
   - Outbox status: pending, published, failed

5. **Calculates Grade**
   - Compares against benchmarks:
     - **Minimum**: 300 nodes, 1600 relationships, 4.0 ratio
     - **Expected**: 417 nodes, 1876 relationships, 4.5 ratio
   - Grading scale:
     - **A**: 95%+ of expected values
     - **B**: 90%+ of expected values
     - **C**: 85%+ of expected values
     - **D**: 80%+ of expected values
     - **F**: Below 80% or doesn't meet minimum

## Usage

### Windows
```bash
# Run from project root
node scripts/verify-pipeline-benchmarks.js

# Or use the batch file
scripts\run-benchmark-verification.bat
```

### Linux/Mac
```bash
# Run from project root
node scripts/verify-pipeline-benchmarks.js

# Or use the shell script
./scripts/run-benchmark-verification.sh
```

## Success Criteria

The verification passes if:
1. Pipeline completes within 5 minutes
2. Meets minimum benchmark requirements
3. All queues are empty (no stuck jobs)
4. No pending outbox records
5. Neo4j graph is populated

## Output

The script provides a comprehensive report including:
- Runtime statistics
- Database results (SQLite and Neo4j)
- Queue status
- Outbox status
- Benchmark comparison
- Final grade and pass/fail status

## Exit Codes
- `0`: Verification passed
- `1`: Verification failed

## Troubleshooting

If the verification fails:

1. **Timeout Issues**
   - Check if Redis/Neo4j services are running
   - Verify database connections
   - Look for stuck jobs in queues

2. **Low Node/Relationship Count**
   - Check LLM service availability
   - Review error logs
   - Verify file analysis is working

3. **Queue Issues**
   - Run `node scripts/test-redis-config.js` to verify Redis
   - Check for failed jobs in queues
   - Review worker logs

4. **Database Issues**
   - Ensure SQLite migrations have run
   - Verify Neo4j is accessible
   - Check outbox for failed publications