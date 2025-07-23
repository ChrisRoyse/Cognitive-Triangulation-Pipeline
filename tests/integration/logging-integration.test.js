const path = require('path');
const fs = require('fs').promises;
const { getLogger, createPerformanceLogger } = require('../../src/config/logging');

describe('Logging Integration Test', () => {
    let logger;
    
    beforeEach(() => {
        logger = getLogger('integration-test');
    });
    
    test('should log a complete workflow with performance metrics', async () => {
        const consoleSpy = jest.spyOn(console._stdout, 'write');
        
        // Simulate a file processing workflow
        const perfLogger = createPerformanceLogger('test-workflow', logger);
        
        perfLogger.start();
        
        // Log initial message with metadata
        logger.info('Starting file processing', {
            filePath: '/test/file.js',
            runId: 'test-run-123',
            userId: 'user-456'
        });
        
        // Simulate reading file
        await new Promise(resolve => setTimeout(resolve, 50));
        perfLogger.checkpoint('file-read', { fileSize: 1024 });
        
        // Log with sensitive data (should be masked)
        logger.info('Calling LLM API', {
            apiKey: 'sk-test-secret-key-123',
            model: 'gpt-4',
            temperature: 0.7
        });
        
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 100));
        perfLogger.checkpoint('llm-api-call', { tokensUsed: 500 });
        
        // Log error with stack trace
        const testError = new Error('Test API error');
        testError.code = 'API_ERROR';
        logger.error('API call failed', {
            error: testError,
            retryCount: 2,
            password: 'should-be-masked'
        });
        
        // Complete the workflow
        perfLogger.end({
            success: true,
            filesProcessed: 1,
            totalTokens: 500
        });
        
        // Verify logs were created
        const logs = consoleSpy.mock.calls.map(call => call[0]);
        
        // Check that logs contain expected content
        expect(logs.some(log => log.includes('Starting file processing'))).toBe(true);
        expect(logs.some(log => log.includes('test-run-123'))).toBe(true);
        
        // Check that sensitive data was masked
        expect(logs.every(log => !log.includes('sk-test-secret-key-123'))).toBe(true);
        expect(logs.some(log => log.includes('sk-****'))).toBe(true);
        expect(logs.every(log => !log.includes('should-be-masked'))).toBe(true);
        expect(logs.some(log => log.includes('***'))).toBe(true);
        
        // Check performance metrics
        expect(logs.some(log => log.includes('Performance') && log.includes('test-workflow'))).toBe(true);
        expect(logs.some(log => log.includes('checkpoint') && log.includes('file-read'))).toBe(true);
        expect(logs.some(log => log.includes('checkpoint') && log.includes('llm-api-call'))).toBe(true);
        expect(logs.some(log => log.includes('memoryUsage'))).toBe(true);
        
        consoleSpy.mockRestore();
    });
    
    test('should handle high-volume logging efficiently', async () => {
        const startTime = Date.now();
        const iterations = 1000;
        
        // Log many messages quickly
        for (let i = 0; i < iterations; i++) {
            logger.info('Processing item', {
                index: i,
                data: {
                    id: `item-${i}`,
                    apiKey: `sk-key-${i}`,
                    metadata: {
                        timestamp: new Date().toISOString(),
                        random: Math.random()
                    }
                }
            });
        }
        
        const duration = Date.now() - startTime;
        
        // Should complete in reasonable time (less than 1 second for 1000 logs)
        expect(duration).toBeLessThan(1000);
        
        // Verify masking didn't break
        logger.info('Final log', { apiKey: 'sk-final-key' });
    });
    
    test('should work with actual file operations', async () => {
        const testFile = path.join(__dirname, 'test-file.txt');
        const perfLogger = createPerformanceLogger('file-operation', logger);
        
        try {
            perfLogger.start();
            
            // Write file
            await fs.writeFile(testFile, 'Test content for logging');
            perfLogger.checkpoint('file-written');
            
            // Read file
            const content = await fs.readFile(testFile, 'utf-8');
            perfLogger.checkpoint('file-read', { contentLength: content.length });
            
            // Log success
            logger.info('File operation completed', {
                filePath: testFile,
                size: content.length
            });
            
            perfLogger.end({ success: true });
            
        } finally {
            // Cleanup
            try {
                await fs.unlink(testFile);
            } catch (err) {
                // Ignore cleanup errors
            }
        }
    });
});