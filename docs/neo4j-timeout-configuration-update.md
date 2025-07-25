# Neo4j Timeout Configuration Update

## Overview
Added comprehensive timeout configuration for all Neo4j operations throughout the codebase to prevent hanging connections in production.

## Changes Made

### 1. Configuration File (`src/config.js`)
Added new environment variables for Neo4j timeout configuration:
- `NEO4J_CONNECTION_TIMEOUT`: Default 30000ms (30 seconds)
- `NEO4J_MAX_TRANSACTION_RETRY_TIME`: Default 15000ms (15 seconds)
- `NEO4J_CONNECTION_POOL_SIZE`: Default 50
- `NEO4J_CONNECTION_ACQUISITION_TIMEOUT`: Default 60000ms (60 seconds)
- `NEO4J_TRANSACTION_TIMEOUT`: Default 300000ms (5 minutes)

### 2. Neo4j Driver (`src/utils/neo4jDriver.js`)
- Updated driver initialization to use the new timeout configurations
- Added connection timeout, retry time, pool size, and acquisition timeout
- Added logging configuration for better debugging

### 3. GraphIngestionWorker (`src/workers/GraphIngestionWorker.js`)
- Updated driver configuration to include all timeout settings
- Made transaction timeout configurable via options
- Already had transaction timeout but now it's configurable

### 4. GraphBuilder (`src/agents/GraphBuilder.js`)
- Converted direct session.run() to use writeTransaction with timeout
- Added transaction timeout configuration (uses NEO4J_TRANSACTION_TIMEOUT)
- Added metadata for operation tracking

### 5. GraphBuilder_optimized (`src/agents/GraphBuilder_optimized.js`)
- Updated all methods to use transactions with timeouts:
  - `createIndexes()`: 60 seconds timeout
  - `checkApocAvailability()`: 5 seconds timeout
  - `_persistWithApoc()`: Uses NEO4J_TRANSACTION_TIMEOUT
  - `_runOptimizedBatch()`: Uses NEO4J_TRANSACTION_TIMEOUT
- Added metadata for operation tracking

### 6. Main Entry Points
- `src/main.js`: Updated database clearing to use transaction with 60-second timeout
- `src/main-simplified.js`: Updated database clearing to use transaction with 60-second timeout

### 7. SelfCleaningAgent (`src/agents/SelfCleaningAgent.js`)
- Updated `_cleanNeo4jBatch()` to use transaction with 60-second timeout
- Added metadata for operation tracking

### 8. Pipeline API (`src/utils/pipelineApi.js`)
- Updated Neo4j count queries to use read transactions with 30-second timeout
- Batch multiple queries in single transaction for efficiency

## Environment Variables
Users can now configure Neo4j timeouts via environment variables:
```bash
NEO4J_CONNECTION_TIMEOUT=30000
NEO4J_MAX_TRANSACTION_RETRY_TIME=15000
NEO4J_CONNECTION_POOL_SIZE=50
NEO4J_CONNECTION_ACQUISITION_TIMEOUT=60000
NEO4J_TRANSACTION_TIMEOUT=300000
```

## Benefits
1. **No Hanging Connections**: All operations now have explicit timeouts
2. **Configurable**: Timeouts can be adjusted via environment variables
3. **Better Error Handling**: Operations will fail gracefully instead of hanging
4. **Operation Tracking**: Metadata added to track different operation types
5. **Production Ready**: Proper timeout configuration for production environments

## Testing Recommendations
1. Test with various timeout values to find optimal settings
2. Monitor Neo4j logs for timeout-related issues
3. Adjust timeouts based on actual query performance
4. Consider different timeouts for different operation types if needed