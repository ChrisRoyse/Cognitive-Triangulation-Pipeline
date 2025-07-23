# High Performance Configuration - 150 Concurrent Agents (HARD LIMIT)

This document explains how to configure the system to support up to 150 concurrent agents running in parallel. **The system enforces a hard limit of 150 agents and will not exceed this under any circumstances.**

## Configuration Changes Made

### 1. Environment Variables (.env)
Added the following environment variables to support high performance mode:

```bash
# High Performance Configuration - Support 150 concurrent agents
FORCE_MAX_CONCURRENCY=150        # Forces the system to use 150 as max global concurrency
HIGH_PERFORMANCE_MODE=true       # Enables high performance mode with increased limits
DISABLE_RESOURCE_SCALING=false   # Can be set to true to prevent scaling down under load
CPU_THRESHOLD=90                 # Increased from 80% to allow higher CPU usage
MEMORY_THRESHOLD=90              # Increased from 85% to allow higher memory usage
```

### 2. WorkerPoolManager Updates
- Added support for `FORCE_MAX_CONCURRENCY` environment variable
- Modified to check for forced concurrency override before calculating based on system resources
- Added high performance mode detection that disables automatic scaling down
- Increased `maxWorkerConcurrency` from 50 to 75 to support more agents per worker type

### 3. WorkerPoolConfig Updates
- Added forced concurrency override support in `getGlobalConfig()`
- When `FORCE_MAX_CONCURRENCY` is set, it overrides all calculated values
- Implemented scaling factors for high performance mode:
  - Base concurrency scaled by 3x
  - Max concurrency scaled by 2.5x
- Updated per-worker type limits:
  - file-analysis: max 40 (from 15-20)
  - llm-analysis: max 30 (from 10-15)
  - validation: max 50 (from 20-30)
  - graph-ingestion: max 40 (from 15-25)
  - directory-aggregation: max 30 (from 12-20)
  - relationship-resolution: max 30 (from 12-20)
  - global-resolution: max 25 (from 8-15)

### 4. Rate Limiting Adjustments
In high performance mode, rate limits are doubled:
- file-analysis: 25 req/sec (from 12)
- llm-analysis: 20 req/sec (from 8)
- validation: 40 req/sec (from 20)
- graph-ingestion: 30 req/sec (from 15)

### 5. Main.js Updates
- Updated to use `FORCE_MAX_CONCURRENCY` as primary override
- Passes CPU and memory thresholds from environment variables

## How It Works

1. **Forced Concurrency**: When `FORCE_MAX_CONCURRENCY=150` is set, the system bypasses all automatic calculations and uses 150 as the maximum global concurrency limit.

2. **Hard Limit Enforcement**: The system enforces a hard limit of 150 agents:
   - Any configuration attempting to set more than 150 will be capped at 150
   - The `requestJobSlot()` method will reject requests if 150 agents are already running
   - Scaling operations will stop before reaching the 150 limit
   - Warning messages are logged if attempts are made to exceed 150

3. **High Performance Mode**: When `HIGH_PERFORMANCE_MODE=true`:
   - Worker concurrency limits are scaled up by 2.5-3x
   - Rate limits are doubled
   - Resource-based scaling down is disabled

4. **Resource Protection**: Even with forced concurrency, the system still:
   - Monitors CPU and memory usage
   - Uses circuit breakers for fault tolerance
   - Implements rate limiting (though at higher levels)

5. **Distribution**: The 150 agents are distributed across worker types based on:
   - Priority levels (file-analysis and llm-analysis have highest priority)
   - Current workload
   - Queue backlogs

## Important Considerations

1. **API Limits**: Ensure your DeepSeek API can handle the increased request rate (up to 20-25 req/sec)

2. **System Resources**: Running 150 concurrent agents requires:
   - Significant CPU resources (multi-core system recommended)
   - Adequate RAM (16GB+ recommended)
   - Good network bandwidth for API calls

3. **Database Performance**: Ensure your databases can handle the increased load:
   - SQLite may need WAL mode optimization
   - Redis should have sufficient memory
   - Neo4j should be properly configured for concurrent writes

4. **Monitoring**: With high concurrency, monitoring becomes crucial:
   - Watch for API rate limit errors
   - Monitor system resource usage
   - Check circuit breaker states
   - Track job completion rates

## Usage

To enable 150 concurrent agents:

1. Ensure your `.env` file contains the configuration above
2. Start the pipeline normally: `node src/main.js`
3. The system will log: "Using forced max global concurrency: 150"

To disable high performance mode, simply comment out or remove the environment variables.

## Hard Limit Safety Features

The system includes multiple safety checks to ensure it never exceeds 150 concurrent agents:

1. **Configuration Capping**: Any `FORCE_MAX_CONCURRENCY` value above 150 is automatically reduced to 150
2. **Runtime Checks**: The `requestJobSlot()` method includes a hard check that rejects requests at 150 agents
3. **Scaling Prevention**: Auto-scaling stops at 135 agents (90% of limit) to prevent accidental overruns
4. **Logging**: Clear error messages when the limit is reached or approached

## Troubleshooting

If you experience issues:

1. **"Maximum concurrent agent limit (150) reached" errors**: 
   - The system is at capacity. Wait for some agents to complete
   - Check if jobs are getting stuck and not releasing slots

2. **API Errors**: Reduce rate limits in workerPoolManager.js
3. **Memory Issues**: Lower MEMORY_THRESHOLD or reduce FORCE_MAX_CONCURRENCY
4. **CPU Overload**: Lower CPU_THRESHOLD or enable DISABLE_RESOURCE_SCALING
5. **Database Bottlenecks**: Check database configurations and consider batching

The system is now configured to support up to 150 concurrent agents (and no more) while maintaining stability through intelligent resource management and fault tolerance mechanisms.