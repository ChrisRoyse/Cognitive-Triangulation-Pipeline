#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const { getLogger, createPerformanceLogger } = require('../src/config/logging');

async function verifyLogging() {
    console.log('🔍 Verifying production-ready logging system...\n');
    
    const logger = getLogger('verify-logging');
    const perfLogger = createPerformanceLogger('logging-verification', logger);
    
    try {
        perfLogger.start();
        
        // Test 1: Basic logging
        console.log('1️⃣ Testing basic logging...');
        logger.info('Starting logging verification', {
            timestamp: new Date().toISOString(),
            pid: process.pid,
            nodeVersion: process.version
        });
        
        perfLogger.checkpoint('basic-logging-complete');
        
        // Test 2: Sensitive data masking
        console.log('2️⃣ Testing sensitive data masking...');
        logger.info('Processing user data', {
            userId: 'user-123',
            email: 'test@example.com',
            password: 'super-secret-password',
            apiKey: 'sk-proj-1234567890',
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
            creditCard: '4111-1111-1111-1111'
        });
        
        perfLogger.checkpoint('masking-test-complete');
        
        // Test 3: Error logging with stack traces
        console.log('3️⃣ Testing error logging...');
        try {
            throw new Error('Simulated error for testing');
        } catch (error) {
            logger.error('Caught an error during verification', {
                error,
                context: 'error-test',
                recoverable: true
            });
        }
        
        perfLogger.checkpoint('error-logging-complete');
        
        // Test 4: Performance metrics
        console.log('4️⃣ Testing performance metrics...');
        const subPerfLogger = createPerformanceLogger('sub-operation', logger);
        subPerfLogger.start();
        
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 100));
        
        subPerfLogger.end({
            itemsProcessed: 42,
            bytesRead: 1024 * 1024,
            cacheHits: 10,
            cacheMisses: 2
        });
        
        perfLogger.checkpoint('performance-metrics-complete');
        
        // Test 5: High-volume logging
        console.log('5️⃣ Testing high-volume logging...');
        const startTime = Date.now();
        for (let i = 0; i < 100; i++) {
            logger.debug(`High-volume log entry ${i}`, {
                index: i,
                batchId: 'test-batch',
                data: { value: Math.random() }
            });
        }
        const duration = Date.now() - startTime;
        console.log(`   Logged 100 entries in ${duration}ms`);
        
        perfLogger.checkpoint('high-volume-complete', { entries: 100, duration });
        
        // Complete the verification
        const results = perfLogger.end({
            testsCompleted: 5,
            success: true
        });
        
        // Wait for logs to be written
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify log files
        console.log('\n📁 Checking log files...');
        const logsDir = path.join(process.cwd(), 'logs');
        const files = await fs.readdir(logsDir);
        
        console.log(`   Found ${files.length} log files:`);
        for (const file of files) {
            const stats = await fs.stat(path.join(logsDir, file));
            console.log(`   - ${file} (${stats.size} bytes)`);
        }
        
        // Read and check combined log
        const combinedLog = await fs.readFile(path.join(logsDir, 'combined.log'), 'utf-8');
        const lines = combinedLog.trim().split('\n');
        console.log(`\n📊 Combined log contains ${lines.length} entries`);
        
        // Verify masking worked
        if (combinedLog.includes('super-secret-password')) {
            console.error('❌ ERROR: Password was not masked!');
            process.exit(1);
        }
        if (combinedLog.includes('sk-proj-1234567890')) {
            console.error('❌ ERROR: API key was not masked!');
            process.exit(1);
        }
        
        console.log('✅ Sensitive data masking verified');
        
        // Show sample log entries
        console.log('\n📝 Sample log entries:');
        const recentLines = lines.slice(-5);
        recentLines.forEach(line => {
            try {
                const parsed = JSON.parse(line);
                console.log(`   [${parsed.level}] ${parsed.message}`);
            } catch (e) {
                console.log(`   ${line.substring(0, 80)}...`);
            }
        });
        
        console.log('\n✅ Logging system verification completed successfully!');
        console.log(`\n📈 Performance Summary:`);
        console.log(`   Total Duration: ${results.duration}ms`);
        console.log(`   Memory Delta: ${Math.round(results.memoryDelta.heapUsed / 1024)}KB`);
        console.log(`   Checkpoints: ${results.checkpoints.length}`);
        
    } catch (error) {
        logger.error('Verification failed', { error });
        console.error('\n❌ Verification failed:', error.message);
        process.exit(1);
    }
}

// Run verification
verifyLogging().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});