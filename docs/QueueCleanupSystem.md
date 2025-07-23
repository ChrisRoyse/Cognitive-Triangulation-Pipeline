# Queue Cleanup System Documentation

## Overview

The Queue Cleanup System provides comprehensive queue management and cleanup functionality for the CTP pipeline. It automatically maintains queue health, removes stale jobs, and provides monitoring capabilities to ensure optimal pipeline performance.

## Architecture

### Core Components

1. **QueueCleanupManager** (`src/utils/queueCleanupManager.js`)
   - Main cleanup orchestrator
   - Handles all cleanup operations
   - Provides health monitoring and metrics
   - Manages periodic cleanup scheduling

2. **PipelineConfig Integration** (`src/config/pipelineConfig.js`)
   - Centralized cleanup configuration
   - Environment-specific settings
   - Configurable thresholds and intervals

3. **QueueManager Integration** (`src/utils/queueManager.js`)
   - Seamless integration with existing queue infrastructure
   - Automatic cleanup manager initialization
   - Proxy methods for cleanup operations

4. **CLI Tool** (`src/utils/queueCleanupCLI.js`)
   - Command-line interface for manual operations
   - Detailed reporting and metrics
   - Emergency cleanup capabilities

## Features

### Automatic Cleanup Operations

- **Stale Job Cleanup**: Removes jobs stuck in processing beyond configured time limits
- **Failed Job Management**: Maintains configurable retention limits for failed jobs
- **Completed Job Cleanup**: Removes excess completed jobs to prevent memory bloat
- **Stuck Job Detection**: Identifies and clears jobs blocking worker processes

### Health Monitoring

- **Real-time Health Checks**: Continuous monitoring of queue status
- **Configurable Thresholds**: Warning and critical levels for various metrics
- **Performance Metrics**: Tracking of processing times, failure rates, and throughput
- **Historical Data**: Retention of health check history for trend analysis

### Safety Features

- **Batch Processing**: Prevents system overload during cleanup operations
- **Rate Limiting**: Configurable delays between operations
- **Emergency Safeguards**: Confirmation requirements for destructive operations
- **Graceful Error Handling**: Robust error recovery and logging

## Configuration

### Environment Variables

Add these to your `.env` file to customize cleanup behavior:

```env
# Cleanup Intervals (milliseconds)
CLEANUP_INTERVAL=300000                    # 5 minutes - general periodic cleanup
STALE_CLEANUP_INTERVAL=600000             # 10 minutes - stale job cleanup
FAILED_CLEANUP_INTERVAL=1800000           # 30 minutes - failed job cleanup
COMPLETED_CLEANUP_INTERVAL=3600000        # 1 hour - completed job cleanup

# Retention Policies
MAX_JOB_AGE=86400000                      # 24 hours - maximum job age
MAX_STALE_AGE=1800000                     # 30 minutes - stale job threshold
MAX_FAILED_RETENTION=100                  # Keep 100 failed jobs per queue
MAX_COMPLETED_RETENTION=50                # Keep 50 completed jobs per queue

# Batch Processing
CLEANUP_BATCH_SIZE=100                    # Process 100 jobs per batch
MAX_BATCH_TIME=30000                      # 30 seconds max per batch
BATCH_DELAY=1000                          # 1 second between batches

# Health Monitoring
HEALTH_CHECK_INTERVAL=120000              # 2 minutes - health check frequency
WARNING_QUEUE_DEPTH=1000                  # Warn if queue > 1000 jobs
CRITICAL_QUEUE_DEPTH=5000                 # Critical if queue > 5000 jobs
WARNING_FAILURE_RATE=0.1                  # Warn if failure rate > 10%
CRITICAL_FAILURE_RATE=0.25                # Critical if failure rate > 25%

# Safety Settings
EMERGENCY_CLEANUP_ENABLED=true            # Allow emergency cleanup operations
DETAILED_CLEANUP_LOGGING=false            # Enable detailed operation logging
DISABLE_CLEANUP_SAFETY=false              # Disable safety checks (not recommended)
```

### Programmatic Configuration

```javascript
const { PipelineConfig } = require('./src/config/pipelineConfig.js');

const config = new PipelineConfig();
const cleanupConfig = config.getCleanupConfig();

// Access configuration values
console.log('Stale cleanup interval:', cleanupConfig.staleJobCleanupInterval);
console.log('Failed job retention:', cleanupConfig.maxFailedJobRetention);
```

## Usage

### Automatic Integration

The cleanup system integrates automatically when you use the QueueManager:

```javascript
const { getInstance: getQueueManager } = require('./src/utils/queueManager.js');

// Initialize queue manager (cleanup starts automatically)
const queueManager = getQueueManager();
await queueManager.connect();

// Cleanup operations are now running in the background
// Health monitoring is active
// Periodic cleanup is scheduled
```

### Manual Operations

```javascript
// Clean stale jobs from all queues
const staleResult = await queueManager.cleanStaleJobs();
console.log(`Cleaned ${staleResult.cleaned} stale jobs`);

// Clean failed jobs from specific queue
const failedResult = await queueManager.cleanFailedJobs('file-analysis-queue', 50);

// Get queue health status
const health = await queueManager.getQueueHealth();
console.log(`Overall status: ${health.overall}`);

// Get cleanup metrics
const metrics = queueManager.getCleanupMetrics();
console.log(`Total operations: ${metrics.operations.total}`);
```

### CLI Usage

The CLI tool provides comprehensive queue management from the command line:

```bash
# Check queue health with detailed breakdown
node src/utils/queueCleanupCLI.js health-check --detailed

# Clean stale jobs from specific queue
node src/utils/queueCleanupCLI.js clean-stale --queue file-analysis-queue

# Clean failed jobs with custom retention
node src/utils/queueCleanupCLI.js clean-failed --retention 75

# Get system metrics
node src/utils/queueCleanupCLI.js metrics

# Perform full cleanup (all types)
node src/utils/queueCleanupCLI.js full-cleanup --detailed

# Emergency cleanup (DANGEROUS - requires confirmation)
node src/utils/queueCleanupCLI.js emergency-cleanup --confirm

# View cleanup schedule information
node src/utils/queueCleanupCLI.js schedule-info
```

## API Reference

### QueueCleanupManager Methods

#### `cleanStaleJobs(queueName?, maxAge?)`
Removes jobs that have been processing for too long.

**Parameters:**
- `queueName` (string, optional): Target specific queue, or all queues if omitted
- `maxAge` (number, optional): Maximum age in milliseconds, uses config default if omitted

**Returns:** `Promise<CleanupResult>`

#### `cleanFailedJobs(queueName?, retentionCount?)`
Removes failed jobs beyond the retention limit.

**Parameters:**
- `queueName` (string, optional): Target specific queue
- `retentionCount` (number, optional): Number of failed jobs to retain

**Returns:** `Promise<CleanupResult>`

#### `cleanCompletedJobs(queueName?, retentionCount?)`
Removes completed jobs beyond the retention limit.

**Parameters:**
- `queueName` (string, optional): Target specific queue
- `retentionCount` (number, optional): Number of completed jobs to retain

**Returns:** `Promise<CleanupResult>`

#### `clearStuckJobs(queueName?)`
Identifies and clears jobs that are blocking worker processes.

**Parameters:**
- `queueName` (string, optional): Target specific queue

**Returns:** `Promise<CleanupResult>`

#### `getQueueHealth(queueName?)`
Retrieves comprehensive health status for queues.

**Parameters:**
- `queueName` (string, optional): Target specific queue

**Returns:** `Promise<HealthStatus>`

#### `clearAllQueues(confirmation)`
**DANGEROUS**: Removes all jobs from all queues.

**Parameters:**
- `confirmation` (boolean): Must be `true` to proceed

**Returns:** `Promise<CleanupResult>`

### Data Types

#### CleanupResult
```javascript
{
  processed: number,      // Total jobs processed
  cleaned: number,        // Total jobs cleaned/removed
  errors: number,         // Number of errors encountered
  queues: {              // Per-queue breakdown
    [queueName]: {
      processed: number,
      cleaned: number
    }
  },
  duration: number        // Operation duration in milliseconds
}
```

#### HealthStatus
```javascript
{
  timestamp: string,      // ISO timestamp
  overall: 'healthy' | 'warning' | 'critical' | 'error',
  summary: {
    totalQueues: number,
    healthyQueues: number,
    warningQueues: number,
    criticalQueues: number,
    totalJobs: number,
    avgProcessingTime: number,
    overallFailureRate: number
  },
  queues: {
    [queueName]: {
      status: 'healthy' | 'warning' | 'critical' | 'error',
      issues: string[],
      metrics: {
        totalJobs: number,
        activeJobs: number,
        waitingJobs: number,
        completedJobs: number,
        failedJobs: number,
        delayedJobs: number,
        failureRate: number,
        avgProcessingTime: number,
        queueUtilization: number
      }
    }
  }
}
```

## Monitoring and Observability

### Health Check Levels

**Healthy (✅)**
- Queue depth below warning threshold
- Failure rate acceptable
- Processing times normal
- No stalled jobs

**Warning (⚠️)**
- Queue depth approaching limits
- Elevated failure rate (>10%)
- Slower processing times
- Some stalled jobs present

**Critical (🚨)**
- Queue depth at dangerous levels (>5000 jobs)
- High failure rate (>25%)
- Severely degraded performance
- Many stalled jobs (>50)

### Metrics Collection

The system automatically collects and maintains:

- **Operation Counts**: Total cleanup operations, success/failure rates
- **Job Cleanup Stats**: Breakdown by cleanup type (stale, failed, completed, stuck)
- **Performance Metrics**: Average cleanup times, batch processing statistics
- **Health History**: Historical queue health data for trend analysis
- **Configuration Status**: Active intervals, safety settings, feature flags

### Event Emission

The cleanup manager emits events for integration with monitoring systems:

```javascript
cleanupManager.on('staleJobsCleanup', (result) => {
  console.log(`Cleaned ${result.cleaned} stale jobs`);
});

cleanupManager.on('healthCheck', (health) => {
  if (health.overall === 'critical') {
    // Alert system administrators
  }
});

cleanupManager.on('cleanupError', (error) => {
  // Log error for investigation
});
```

## Best Practices

### Configuration Tuning

1. **Start Conservative**: Begin with longer intervals and higher retention counts
2. **Monitor Impact**: Watch system performance during cleanup operations
3. **Adjust Gradually**: Make incremental changes based on observed behavior
4. **Environment-Specific**: Use different settings for development, staging, and production

### Operational Guidelines

1. **Regular Health Checks**: Monitor queue health proactively
2. **Cleanup Scheduling**: Align cleanup operations with low-traffic periods
3. **Retention Policies**: Balance storage costs with debugging needs
4. **Emergency Procedures**: Document and test emergency cleanup procedures

### Troubleshooting

#### High Memory Usage
- Reduce retention counts for completed jobs
- Increase cleanup frequency
- Check for stuck jobs blocking processing

#### Performance Degradation
- Reduce batch sizes
- Increase delays between operations
- Monitor system resources during cleanup

#### Queue Backlog
- Identify root cause (processing failures, resource constraints)
- Consider temporary worker scaling
- Review job processing logic

## Integration Examples

### Basic Integration
```javascript
// In your main application
const { getInstance: getQueueManager } = require('./src/utils/queueManager.js');

async function startApplication() {
  const queueManager = getQueueManager();
  await queueManager.connect();
  
  // Cleanup system is now active
  // Your application can focus on business logic
}
```

### Custom Health Monitoring
```javascript
const queueManager = getQueueManager();

setInterval(async () => {
  const health = await queueManager.getQueueHealth();
  
  if (health.overall === 'critical') {
    // Send alert to monitoring system
    await sendAlert('Queue system critical', health);
  }
}, 60000); // Check every minute
```

### Programmatic Cleanup
```javascript
// Custom cleanup logic based on business rules
async function customCleanup() {
  const health = await queueManager.getQueueHealth();
  
  for (const [queueName, queueHealth] of Object.entries(health.queues)) {
    if (queueHealth.metrics.failedJobs > 500) {
      // Clean excess failed jobs for this queue
      await queueManager.cleanFailedJobs(queueName, 100);
    }
  }
}
```

## Security Considerations

### Access Control
- CLI tool should be restricted to authorized personnel
- Emergency cleanup requires explicit confirmation
- Monitor cleanup operations in production environments

### Data Retention
- Consider regulatory requirements for job data retention
- Implement secure deletion for sensitive job data
- Document cleanup policies for compliance

### Audit Trail
- All cleanup operations are logged with timestamps
- Failed operations generate error logs
- Metrics provide accountability and troubleshooting data

## Performance Impact

### Resource Usage
- Cleanup operations use minimal CPU and memory
- Batch processing prevents system overload
- Configurable delays allow system recovery between operations

### Network Impact
- Redis operations are optimized for minimal network traffic
- Batch queries reduce round-trip latency
- Health checks use lightweight operations

### Timing Considerations
- Cleanup operations typically complete in seconds
- Large queues may require longer processing times
- System remains responsive during cleanup operations

## Troubleshooting Guide

### Common Issues

**Issue**: Cleanup operations failing with connection errors
**Solution**: Verify Redis connectivity and increase connection timeout

**Issue**: High memory usage despite cleanup
**Solution**: Check retention settings and verify cleanup execution

**Issue**: Stale jobs not being detected
**Solution**: Review stale job age thresholds and processing time monitoring

**Issue**: Performance degradation during cleanup
**Solution**: Increase batch delays and reduce batch sizes

### Diagnostic Commands

```bash
# Check current queue status
node src/utils/queueCleanupCLI.js health-check --detailed

# View cleanup configuration
node src/utils/queueCleanupCLI.js schedule-info

# Get performance metrics
node src/utils/queueCleanupCLI.js metrics

# Manual cleanup for testing
node src/utils/queueCleanupCLI.js clean-stale --queue test-queue --detailed
```

## Future Enhancements

### Planned Features
- Adaptive cleanup intervals based on queue activity
- Integration with external monitoring systems (Prometheus, Grafana)
- Advanced analytics and trend detection
- Automated scaling recommendations

### Extension Points
- Custom cleanup strategies for specific job types
- Integration with external storage for long-term metrics
- Webhook notifications for critical events
- Multi-tenant queue isolation and cleanup

---

For additional support or feature requests, please refer to the project documentation or contact the development team.