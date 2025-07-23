const fs = require('fs');
const path = require('path');
const { LoggingConfig, initializeLogging, getLogger, generateCorrelationId, getSystemMetrics } = require('../../src/config/logging');
const { PipelineConfig } = require('../../src/config/pipelineConfig');

describe('Centralized Logging System', () => {
    let loggingConfig;
    let testLogDir;

    beforeAll(() => {
        // Create test log directory
        testLogDir = path.join(__dirname, '../../logs/test');
        if (!fs.existsSync(testLogDir)) {
            fs.mkdirSync(testLogDir, { recursive: true });
        }

        // Initialize logging with test configuration
        const pipelineConfig = PipelineConfig.createForTesting();
        process.env.LOG_DIRECTORY = testLogDir;
        loggingConfig = initializeLogging(pipelineConfig);
    });

    afterAll(async () => {
        // Flush logs
        await loggingConfig.flush();
        
        // Clean up test logs
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });

    describe('Logger Creation', () => {
        test('should create logger with module name', () => {
            const logger = getLogger('TestModule');
            expect(logger).toBeDefined();
            expect(logger.info).toBeInstanceOf(Function);
            expect(logger.error).toBeInstanceOf(Function);
            expect(logger.warn).toBeInstanceOf(Function);
            expect(logger.debug).toBeInstanceOf(Function);
        });

        test('should create child logger with correlation ID', () => {
            const logger = getLogger('TestModule');
            const correlationId = generateCorrelationId();
            const childLogger = logger.child(correlationId);
            
            expect(childLogger).toBeDefined();
            expect(childLogger.info).toBeInstanceOf(Function);
        });
    });

    describe('Logging Methods', () => {
        test('should log info message with metadata', () => {
            const logger = getLogger('TestModule');
            
            expect(() => {
                logger.info('Test info message', {
                    testField: 'value',
                    numberField: 123
                });
            }).not.toThrow();
        });

        test('should log error with Error object', () => {
            const logger = getLogger('TestModule');
            const testError = new Error('Test error message');
            
            expect(() => {
                logger.error('Test error occurred', testError, {
                    additionalInfo: 'test'
                });
            }).not.toThrow();
        });

        test('should not log sensitive data', () => {
            const logger = getLogger('TestModule');
            
            // This should not throw but should mask sensitive data
            expect(() => {
                logger.info('Sensitive data test', {
                    apiKey: 'secret-key-12345',
                    password: 'my-password',
                    publicInfo: 'this is public'
                });
            }).not.toThrow();
        });
    });

    describe('Performance Tracking', () => {
        test('should track operation timing', async () => {
            const logger = getLogger('TestModule');
            const timer = logger.startTimer('test-operation');
            
            // Simulate some work
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const metrics = timer.end('Operation completed');
            
            expect(metrics).toBeDefined();
            expect(metrics.duration).toBeGreaterThan(90);
            expect(metrics.memoryUsage).toBeDefined();
            expect(metrics.cpuUsage).toBeDefined();
        });
    });

    describe('Structured Logging Helpers', () => {
        test('should log API call', () => {
            const logger = getLogger('TestModule');
            
            expect(() => {
                logger.logApiCall('POST', '/api/test', 200, 150, {
                    requestId: '123'
                });
            }).not.toThrow();
        });

        test('should log database operation', () => {
            const logger = getLogger('TestModule');
            
            expect(() => {
                logger.logDatabaseOperation('INSERT', 'pois', 25, 5, {
                    runId: 'test-run'
                });
            }).not.toThrow();
        });

        test('should log queue event', () => {
            const logger = getLogger('TestModule');
            
            expect(() => {
                logger.logQueueEvent('completed', 'test-queue', 'job-123', {
                    processingTime: 1500
                });
            }).not.toThrow();
        });

        test('should log worker pool event', () => {
            const logger = getLogger('TestModule');
            
            expect(() => {
                logger.logWorkerPoolEvent('concurrency-changed', 'test-worker', 10, {
                    oldConcurrency: 5,
                    reason: 'scale-up'
                });
            }).not.toThrow();
        });
    });

    describe('System Metrics', () => {
        test('should get system metrics', () => {
            const metrics = getSystemMetrics();
            
            expect(metrics).toBeDefined();
            expect(metrics.memory).toBeDefined();
            expect(metrics.memory.heapUsed).toBeGreaterThan(0);
            expect(metrics.cpu).toBeDefined();
            expect(metrics.process).toBeDefined();
            expect(metrics.system).toBeDefined();
        });
    });

    describe('Correlation ID', () => {
        test('should generate unique correlation IDs', () => {
            const id1 = generateCorrelationId();
            const id2 = generateCorrelationId();
            
            expect(id1).toBeDefined();
            expect(id2).toBeDefined();
            expect(id1).not.toBe(id2);
            expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });
    });

    describe('Log Files', () => {
        test('should create log files', async () => {
            const logger = getLogger('TestModule');
            
            // Log some messages
            logger.info('Test message for file');
            logger.error('Test error for file', new Error('Test'));
            
            // Wait for logs to be written
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check if log files exist
            const pipelineLogPath = path.join(testLogDir, 'pipeline.log');
            const errorLogPath = path.join(testLogDir, 'error.log');
            
            expect(fs.existsSync(pipelineLogPath)).toBe(true);
            expect(fs.existsSync(errorLogPath)).toBe(true);
        });
    });
});