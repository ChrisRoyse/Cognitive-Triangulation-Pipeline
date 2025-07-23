# Comprehensive Logging System Documentation

## Overview

The CTP pipeline uses a centralized logging system built on Winston that provides structured logging, performance tracking, and comprehensive monitoring capabilities. All components use this unified logging infrastructure to ensure consistent, searchable, and debuggable log output.

## Features

- **Structured Logging**: JSON-formatted logs with consistent metadata
- **Correlation IDs**: Track requests across distributed components
- **Performance Metrics**: Built-in timing and resource tracking
- **Sensitive Data Protection**: Automatic redaction of API keys and passwords
- **Multiple Output Targets**: Console, files, and performance-specific logs
- **Log Rotation**: Automatic file rotation based on size
- **Context Propagation**: Child loggers maintain parent context
- **Zero-configuration**: Works out of the box with sensible defaults

## Configuration

### Environment Variables

```bash
# Logging Configuration
LOG_LEVEL=info                    # Log level: debug, info, warn, error
LOG_DIRECTORY=./logs              # Directory for log files
LOG_TO_CONSOLE=true              # Enable console output
LOG_MAX_FILE_SIZE=52428800       # Max file size in bytes (50MB)
LOG_MAX_FILES=10                 # Number of files to keep
LOG_ROTATION_ENABLED=true        # Enable log rotation
```

### Log Levels

- `debug`: Detailed information for debugging
- `info`: General informational messages
- `warn`: Warning messages for potentially harmful situations
- `error`: Error messages for serious problems

## Usage

### Basic Logging

```javascript
const { getLogger } = require('../config/logging');

// Create a logger for your module
const logger = getLogger('MyModule');

// Log messages
logger.info('Module initialized');
logger.debug('Processing item', { itemId: 123 });
logger.warn('Low memory', { available: '100MB' });
logger.error('Failed to process', new Error('Connection timeout'));
```

### Correlation IDs

```javascript
const { generateCorrelationId } = require('../config/logging');

// Generate correlation ID for a request
const correlationId = generateCorrelationId();

// Create child logger with correlation ID
const requestLogger = logger.child(correlationId);
requestLogger.info('Processing request', { userId: 456 });
```

### Performance Tracking

```javascript
// Start a timer
const timer = logger.startTimer('database-query', correlationId);

// Perform operation
const result = await db.query('SELECT * FROM users');

// End timer and log metrics
const metrics = timer.end('Query completed', { 
    rowCount: result.length 
});
// Logs: duration, memory usage, CPU usage
```

### Structured Logging Helpers

```javascript
// Log API calls
logger.logApiCall('POST', '/api/analyze', 200, 150, {
    requestId: '123',
    contentLength: 1024
});

// Log database operations
logger.logDatabaseOperation('INSERT', 'pois', 25, 5, {
    runId: 'run-123'
});

// Log queue events
logger.logQueueEvent('completed', 'file-analysis-queue', 'job-123', {
    processingTime: 1500
});

// Log worker pool events
logger.logWorkerPoolEvent('concurrency-changed', 'file-analysis', 10, {
    oldConcurrency: 5,
    reason: 'scale-up'
});
```

### System Metrics

```javascript
const { getSystemMetrics } = require('../config/logging');

// Get current system metrics
const metrics = getSystemMetrics();
logger.logMetrics(metrics);
```

## Log Files

The system creates multiple log files for different purposes:

1. **pipeline.log**: All application logs
2. **error.log**: Error-level logs only
3. **performance.log**: Performance metrics and timing data
4. **exceptions.log**: Uncaught exceptions (production only)
5. **rejections.log**: Unhandled promise rejections (production only)

## Worker Integration

All workers automatically integrate with the logging system:

```javascript
class MyWorker {
    constructor() {
        this.logger = getLogger('MyWorker');
    }
    
    async process(job) {
        const jobLogger = this.logger.child(job.id);
        const timer = jobLogger.startTimer('job-processing', job.id);
        
        try {
            jobLogger.info('Processing job', { 
                jobType: job.name,
                data: job.data 
            });
            
            // Process job...
            
            timer.end('Job completed successfully');
        } catch (error) {
            timer.end('Job failed');
            jobLogger.error('Job processing failed', error);
            throw error;
        }
    }
}
```

## API Logging Middleware

For HTTP APIs, use the provided middleware:

```javascript
const { expressMiddleware } = require('../utils/apiLoggingMiddleware');
const express = require('express');

const app = express();

// Add logging middleware
app.use(expressMiddleware());

// Your routes now have request logging
app.get('/api/status', (req, res) => {
    // req.logger is available with correlation ID
    req.logger.info('Status check requested');
    res.json({ status: 'ok' });
});
```

## Performance Monitoring

Use the performance monitor for comprehensive metrics:

```javascript
const { getPerformanceMonitor } = require('../utils/performanceMonitor');

const monitor = getPerformanceMonitor('MyService');

// Start monitoring
monitor.startMonitoring(30000); // Every 30 seconds

// Track custom operations
const operation = monitor.trackOperation('data-processing', {
    batchSize: 100
});

// Process data...

operation.end(true, { itemsProcessed: 95 });

// Generate report
const report = monitor.generateReport();
```

## Best Practices

1. **Always use module-specific loggers**: Create a logger for each module/class
2. **Use correlation IDs**: Pass correlation IDs through your call chain
3. **Log at appropriate levels**: Use debug for verbose output, info for general flow
4. **Include context**: Add relevant metadata to help debugging
5. **Use timers for performance**: Track important operations
6. **Don't log sensitive data**: The system auto-redacts common fields, but be careful
7. **Use structured helpers**: Prefer logApiCall, logDatabaseOperation, etc.

## Debugging

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm start
```

### View Logs in Real-time

```bash
# All logs
tail -f logs/pipeline.log

# Only errors
tail -f logs/error.log

# Performance metrics
tail -f logs/performance.log
```

### Search Logs

```bash
# Find all logs for a specific correlation ID
grep "correlation-id-here" logs/pipeline.log

# Find all errors for a module
jq 'select(.level == "error" and .module == "FileAnalysisWorker")' logs/pipeline.log

# Find slow operations
jq 'select(.duration > 1000)' logs/performance.log
```

## Production Considerations

1. **Set appropriate log level**: Use 'info' or 'warn' in production
2. **Configure log rotation**: Ensure LOG_MAX_FILE_SIZE and LOG_MAX_FILES are set
3. **Monitor disk space**: Logs can grow quickly under high load
4. **Use external log aggregation**: Consider shipping logs to ELK, Datadog, etc.
5. **Enable exception handling**: Logs uncaught errors in production

## Troubleshooting

### Logs not appearing

1. Check LOG_DIRECTORY exists and is writable
2. Verify LOG_LEVEL is not set too high
3. Ensure logger is properly initialized

### Performance impact

1. Reduce LOG_LEVEL to 'warn' or 'error'
2. Disable LOG_TO_CONSOLE in production
3. Increase LOG_MAX_FILE_SIZE to reduce rotation frequency

### Missing correlation IDs

1. Ensure child loggers are created for each request/job
2. Pass correlation IDs through async boundaries
3. Use the middleware for HTTP requests