const path = require('path');
const fs = require('fs').promises;
const { getLogger, createPerformanceLogger } = require('../../src/config/logging');

describe('Logging E2E Test', () => {
    test('should successfully log from multiple workers without errors', async () => {
        // Simulate multiple workers logging concurrently
        const workers = ['worker1', 'worker2', 'worker3'];
        const promises = workers.map(async (workerName) => {
            const logger = getLogger(workerName);
            const perfLogger = createPerformanceLogger(`${workerName}-task`, logger);
            
            perfLogger.start();
            
            // Simulate work with logging
            for (let i = 0; i < 5; i++) {
                await new Promise(resolve => setTimeout(resolve, 10));
                logger.info(`Processing item ${i}`, {
                    workerId: workerName,
                    itemId: i,
                    apiKey: `sk-worker-${workerName}-key-${i}`
                });
            }
            
            perfLogger.end({ itemsProcessed: 5 });
        });
        
        // All workers should complete without errors
        await expect(Promise.all(promises)).resolves.not.toThrow();
    });
    
    test('should verify log files are created with proper content', async () => {
        const logger = getLogger('file-test');
        
        // Log various levels
        logger.info('Info message', { type: 'test' });
        logger.warn('Warning message', { code: 'WARN001' });
        logger.error('Error message', { 
            error: new Error('Test error'),
            apiKey: 'sk-should-be-masked'
        });
        
        // Wait for logs to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check that log files exist
        const logsDir = path.join(process.cwd(), 'logs');
        const files = await fs.readdir(logsDir);
        
        expect(files).toContain('combined.log');
        expect(files).toContain('error.log');
        
        // Read and verify combined log
        const combinedLog = await fs.readFile(path.join(logsDir, 'combined.log'), 'utf-8');
        expect(combinedLog).toContain('Info message');
        expect(combinedLog).toContain('Warning message');
        expect(combinedLog).toContain('Error message');
        expect(combinedLog).not.toContain('sk-should-be-masked');
        expect(combinedLog).toContain('sk-****');
        
        // Read and verify error log (should only contain errors)
        const errorLog = await fs.readFile(path.join(logsDir, 'error.log'), 'utf-8');
        expect(errorLog).toContain('Error message');
        expect(errorLog).not.toContain('Info message');
        expect(errorLog).not.toContain('sk-should-be-masked');
    });
    
    test('should handle production environment settings', async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        
        try {
            // Clear logger cache to force recreation
            if (getLogger.cache) {
                getLogger.cache.clear();
            }
            
            const prodLogger = getLogger('production-test');
            
            // In production, console transport should be disabled
            const consoleTransport = prodLogger.transports.find(t => 
                t.constructor.name === 'Console'
            );
            expect(consoleTransport).toBeUndefined();
            
            // File transports should still work
            prodLogger.info('Production log message', {
                environment: 'production',
                password: 'secret123' // Should be masked
            });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify log was written to file
            const combinedLog = await fs.readFile(
                path.join(process.cwd(), 'logs', 'combined.log'), 
                'utf-8'
            );
            expect(combinedLog).toContain('Production log message');
            expect(combinedLog).toContain('production');
            expect(combinedLog).not.toContain('secret123');
            expect(combinedLog).toContain('***');
            
        } finally {
            process.env.NODE_ENV = originalEnv;
        }
    });
});