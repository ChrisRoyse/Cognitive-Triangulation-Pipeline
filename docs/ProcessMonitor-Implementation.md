# ProcessMonitor - Zombie Process Detection and Prevention

## Overview

The ProcessMonitor is a comprehensive system for detecting and preventing zombie processes during application shutdown. It tracks child processes, worker threads, timers, and intervals to ensure clean system shutdown without leaving phantom processes running.

## Key Features

### 1. Process Tracking
- **Child Process Monitoring**: Tracks spawned child processes with PID-based lifecycle management
- **Worker Thread Tracking**: Monitors worker instances and their associated processes
- **Timer/Interval Tracking**: Tracks setTimeout/setInterval calls for proper cleanup

### 2. Zombie Detection
- **Real-time Process Verification**: Uses `process.kill(pid, 0)` to check if processes are still alive
- **Worker Instance Checking**: Validates worker thread states and instances
- **Comprehensive Status Reports**: Provides detailed zombie process information

### 3. Force Kill Mechanisms
- **Escalating Signal Sequence**: SIGTERM → SIGINT → SIGQUIT → SIGKILL (platform-specific)
- **Timeout-based Escalation**: Waits between signals before escalating
- **Cross-platform Support**: Handles Windows vs Unix signal differences
- **Retry Logic**: Multiple attempts with exponential backoff

### 4. Graceful Shutdown Integration
- **Verification Before Success**: Only reports success after confirming no zombies remain
- **Automatic Cleanup**: Detects and eliminates zombie processes during shutdown
- **Error Recovery**: Handles partial shutdown failures gracefully

## Architecture

```
┌─────────────────────┐
│   ProcessMonitor    │
├─────────────────────┤
│ • trackedProcesses  │──► Map<PID, ProcessInfo>
│ • trackedWorkers    │──► Map<WorkerID, WorkerInfo>  
│ • trackedTimers     │──► Set<TimerID>
│ • trackedIntervals  │──► Set<IntervalID>
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Zombie Detection   │
├─────────────────────┤
│ • isProcessAlive()  │──► process.kill(pid, 0)
│ • isWorkerRunning() │──► Worker instance checks
│ • verifyCleanShutdown() │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│   Force Kill        │
├─────────────────────┤
│ • forceKillSingle() │──► SIGTERM → SIGKILL
│ • waitForProcessDeath() │
│ • cleanupTimers()   │
└─────────────────────┘
```

## Integration Points

### WorkerPoolManager Integration

The ProcessMonitor is embedded in WorkerPoolManager to track:

```javascript
// Track worker registration
registerWorker(workerType, options) {
    // ... existing logic ...
    
    this.processMonitor.trackWorker(workerType, {
        name: workerType,
        type: 'managed_worker',
        workerInstance: null
    });
}

// Track worker instances
trackWorkerInstance(workerType, workerInstance, pid) {
    this.processMonitor.trackWorker(workerType, {
        workerInstance,
        pid
    });
}

// Enhanced shutdown with verification
async shutdown() {
    // ... graceful shutdown ...
    
    const verification = await this.processMonitor.verifyCleanShutdown();
    if (!verification.clean) {
        await this.processMonitor.forceKillZombies();
    }
}
```

### Main Pipeline Integration

The main pipeline uses WorkerPoolManager's ProcessMonitor for final verification:

```javascript
async close() {
    // ... normal shutdown sequence ...
    
    // Final zombie verification
    if (processMonitor) {
        const verification = await processMonitor.verifyCleanShutdown();
        if (!verification.clean) {
            const killResult = await processMonitor.forceKillZombies();
            // Handle failed kills...
        }
    }
}
```

## API Reference

### Core Methods

#### `trackProcess(pid, processInfo)`
Tracks a child process for monitoring.

```javascript
monitor.trackProcess(childProcess.pid, {
    name: 'file-analyzer',
    type: 'child_process',
    command: 'node',
    args: ['analyzer.js']
});
```

#### `trackWorker(workerId, workerInfo)`
Tracks a worker thread or managed worker.

```javascript
monitor.trackWorker('worker-1', {
    name: 'file-analysis-worker',
    type: 'bullmq_worker',
    workerInstance: worker,
    pid: associatedPid
});
```

#### `verifyCleanShutdown()`
Checks for zombie processes and orphaned resources.

```javascript
const verification = await monitor.verifyCleanShutdown();
// Returns: { clean: boolean, zombies: [], orphanedTimers: [] }
```

#### `forceKillZombies(zombies?)`
Force kills zombie processes with escalating signals.

```javascript
const result = await monitor.forceKillZombies();
// Returns: { success: boolean, killed: [], failed: [] }
```

#### `executeGracefulShutdown(shutdownCallback)`
Executes shutdown with automatic zombie cleanup.

```javascript
await monitor.executeGracefulShutdown(async () => {
    // Your application shutdown logic
    await app.close();
});
```

### Configuration Options

```javascript
const monitor = new ProcessMonitor({
    // Timeout escalation
    gracefulShutdownTimeout: 15000,  // 15 seconds
    forceKillTimeout: 30000,         // 30 seconds total
    maxForceKillAttempts: 3,
    
    // Monitoring
    enablePeriodicChecks: true,
    periodicCheckInterval: 30000,    // 30 seconds
    zombieCheckInterval: 5000,       // 5 seconds
    
    // Logging
    verboseLogging: false
});
```

## Signal Escalation Strategy

The ProcessMonitor uses platform-specific signal escalation:

### Unix/Linux/macOS
1. **SIGTERM** (graceful termination) - 3 second wait
2. **SIGINT** (interrupt) - 3 second wait  
3. **SIGQUIT** (quit with core dump) - 3 second wait
4. **SIGKILL** (force kill) - 5 second wait

### Windows
1. **SIGTERM** (graceful termination) - 3 second wait
2. **SIGKILL** (force kill) - 5 second wait

## Error Handling

### Process Kill Failures
- **ESRCH**: Process already dead (success)
- **EPERM**: Process exists but no permission (still alive)
- **Other errors**: Assume process is alive, continue escalation

### Partial Shutdown Handling
- Tracks which components failed to shutdown
- Provides detailed error reporting
- Continues with zombie cleanup even if some shutdowns fail
- Returns comprehensive failure information

## Testing

Run the test suite to verify ProcessMonitor functionality:

```bash
node test-process-monitor.js
```

The test suite covers:
- Process tracking and lifecycle management
- Worker thread simulation and monitoring
- Zombie process detection accuracy
- Force kill mechanism effectiveness
- Timer/interval cleanup verification
- Graceful shutdown with verification

## Best Practices

### 1. Track Early, Untrack on Success
```javascript
// Track immediately when creating
const worker = new Worker('queue', processor);
monitor.trackWorker('worker-1', { workerInstance: worker });

// Untrack when cleanly shut down
await worker.close();
monitor.untrackWorker('worker-1');
```

### 2. Use Graceful Shutdown Wrapper
```javascript
// Instead of manual verification
await monitor.executeGracefulShutdown(async () => {
    await shutdownAllServices();
});
```

### 3. Handle Force Kill Failures
```javascript
const killResult = await monitor.forceKillZombies();
if (killResult.failed.length > 0) {
    // Log critical errors - manual intervention may be needed
    console.error('Manual cleanup required for PIDs:', 
        killResult.failed.map(f => f.pid));
}
```

### 4. Monitor in Development
```javascript
const monitor = new ProcessMonitor({
    verboseLogging: process.env.NODE_ENV === 'development',
    enablePeriodicChecks: true
});
```

## Limitations

1. **Permission-based Failures**: Cannot kill processes owned by other users
2. **System Process Protection**: OS may prevent killing certain system processes  
3. **Resource Leaks**: Cannot clean up all types of OS resources (file handles, sockets)
4. **Platform Differences**: Signal behavior varies between operating systems

## Security Considerations

- Only tracks and kills processes spawned by the current application
- Uses safe PID checking before attempting kills
- Implements timeout bounds to prevent infinite waiting
- Provides detailed logging for security auditing

## Performance Impact

- **Memory**: ~1KB per tracked process/worker
- **CPU**: Minimal during normal operation, moderate during verification
- **IO**: Process existence checks are lightweight system calls
- **Network**: No network overhead

The ProcessMonitor adds negligible overhead during normal operation while providing comprehensive protection against zombie processes during shutdown scenarios.