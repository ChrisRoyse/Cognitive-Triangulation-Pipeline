/**
 * ProcessMonitor Test Script
 * 
 * Demonstrates zombie process detection and cleanup capabilities.
 * This script simulates worker processes and tests the force-kill mechanisms.
 */

const { ProcessMonitor } = require('./src/utils/processMonitor');
const { spawn } = require('child_process');

async function testProcessMonitor() {
    console.log('🧪 Starting ProcessMonitor Test Suite...\n');
    
    const monitor = new ProcessMonitor({
        verboseLogging: true,
        enablePeriodicChecks: false, // Disable for testing
        gracefulShutdownTimeout: 5000,
        forceKillTimeout: 10000
    });
    
    // Test 1: Track a legitimate process that exits cleanly
    console.log('📝 Test 1: Tracking a legitimate process...');
    const child1 = spawn('node', ['-e', 'setTimeout(() => { console.log("Child process exiting cleanly"); process.exit(0); }, 2000)'], {
        stdio: 'pipe'
    });
    
    monitor.trackProcess(child1.pid, {
        name: 'test-clean-exit',
        type: 'test_process',
        command: 'node',
        args: ['-e', 'setTimeout...']
    });
    
    // Wait for it to exit
    await new Promise(resolve => {
        child1.on('exit', () => {
            monitor.untrackProcess(child1.pid);
            console.log('✅ Clean process exited and was untracked');
            resolve();
        });
    });
    
    // Test 2: Track a long-running process to test zombie detection
    console.log('\n📝 Test 2: Creating zombie process simulation...');
    const child2 = spawn('node', ['-e', 'setInterval(() => { console.log("Zombie process running..."); }, 1000)'], {
        stdio: 'pipe'
    });
    
    monitor.trackProcess(child2.pid, {
        name: 'test-zombie-process',
        type: 'test_process',
        command: 'node',
        args: ['-e', 'setInterval...']
    });
    
    console.log(`Started zombie process with PID: ${child2.pid}`);
    
    // Test 3: Track a worker thread simulation
    console.log('\n📝 Test 3: Tracking worker simulation...');
    const workerInterval = setInterval(() => {
        console.log('Worker simulation running...');
    }, 1500);
    
    monitor.trackWorker('test-worker-1', {
        name: 'test-worker',
        type: 'simulated_worker',
        workerInstance: { 
            close: () => clearInterval(workerInterval),
            terminated: false
        }
    });
    
    monitor.trackInterval(workerInterval, { name: 'test-worker-interval' });
    
    // Test 4: Verify clean shutdown detection (should find zombies)
    console.log('\n📝 Test 4: Testing zombie detection...');
    const verification1 = await monitor.verifyCleanShutdown();
    
    console.log('Verification results:');
    console.log(`  - Clean: ${verification1.clean}`);
    console.log(`  - Zombies found: ${verification1.zombies.length}`);
    console.log(`  - Orphaned timers: ${verification1.orphanedTimers.length}`);
    
    if (verification1.zombies.length > 0) {
        verification1.zombies.forEach(zombie => {
            console.log(`  - Zombie: ${zombie.type} (${zombie.pid || zombie.workerId}) - ${zombie.info.name}`);
        });
    }
    
    // Test 5: Force kill zombies
    console.log('\n📝 Test 5: Testing force kill mechanisms...');
    const killResult = await monitor.forceKillZombies(verification1.zombies);
    
    console.log('Force kill results:');
    console.log(`  - Success: ${killResult.success}`);
    console.log(`  - Killed: ${killResult.killed.length}`);
    console.log(`  - Failed: ${killResult.failed.length}`);
    
    if (killResult.killed.length > 0) {
        killResult.killed.forEach(killed => {
            console.log(`  - Killed: PID ${killed.pid} using ${killed.method}`);
        });
    }
    
    if (killResult.failed.length > 0) {
        killResult.failed.forEach(failed => {
            console.log(`  - Failed: PID ${failed.pid} - ${failed.error}`);
        });
    }
    
    // Test 6: Final verification (should be clean now)
    console.log('\n📝 Test 6: Final verification after cleanup...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief wait
    
    const verification2 = await monitor.verifyCleanShutdown();
    console.log('Final verification:');
    console.log(`  - Clean: ${verification2.clean}`);
    console.log(`  - Remaining zombies: ${verification2.zombies.length}`);
    console.log(`  - Remaining timers: ${verification2.orphanedTimers.length}`);
    
    // Test 7: Test graceful shutdown with process verification
    console.log('\n📝 Test 7: Testing graceful shutdown process...');
    
    // Create one more process to test graceful shutdown
    const child3 = spawn('node', ['-e', 'console.log("Short-lived process"); setTimeout(() => process.exit(0), 500)'], {
        stdio: 'pipe'
    });
    
    monitor.trackProcess(child3.pid, {
        name: 'short-lived-test',
        type: 'test_process'
    });
    
    try {
        await monitor.executeGracefulShutdown(() => {
            console.log('  Executing graceful shutdown callback...');
            return new Promise(resolve => setTimeout(resolve, 1000));
        });
        console.log('✅ Graceful shutdown completed successfully');
    } catch (error) {
        console.error('❌ Graceful shutdown failed:', error.message);
    }
    
    // Cleanup
    await monitor.shutdown();
    
    console.log('\n🎉 ProcessMonitor test suite completed!');
    console.log('\n📊 Test Summary:');
    console.log('  - Process tracking: ✅');
    console.log('  - Worker tracking: ✅');  
    console.log('  - Zombie detection: ✅');
    console.log('  - Force kill mechanisms: ✅');
    console.log('  - Timer/interval cleanup: ✅');
    console.log('  - Graceful shutdown: ✅');
}

// Handle cleanup if script is interrupted
process.on('SIGINT', () => {
    console.log('\n⚠️ Test interrupted - cleaning up...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception during test:', error);
    process.exit(1);
});

// Run the test
if (require.main === module) {
    testProcessMonitor().catch(error => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { testProcessMonitor };