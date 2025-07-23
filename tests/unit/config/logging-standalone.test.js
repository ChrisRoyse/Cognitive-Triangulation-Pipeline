// Standalone test for logging module without global setup
const path = require('path');
const fs = require('fs');
const os = require('os');

// Create a temporary directory for test logs
const tempDir = path.join(os.tmpdir(), 'ctp-logging-test-' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

// Mock process.cwd to return our temp directory
const originalCwd = process.cwd;
process.cwd = () => tempDir;

// Now require the modules
const winston = require('winston');
const { createLogger, maskSensitiveData, createPerformanceLogger, getLogger } = require('../../../src/config/logging');

describe('Logging System (Standalone)', () => {
  let logger;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    // Clear any cached loggers
    if (getLogger.cache) {
      getLogger.cache.clear();
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    // Close all transports to prevent handle leaks
    if (logger && logger.transports) {
      logger.transports.forEach(transport => {
        if (transport.close) transport.close();
      });
    }
  });

  afterAll(() => {
    // Restore original cwd
    process.cwd = originalCwd;
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore errors
    }
  });

  describe('Logger Initialization', () => {
    test('should create a logger with default configuration', () => {
      logger = createLogger();
      
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(winston.Logger);
      expect(logger.transports.length).toBeGreaterThanOrEqual(2); // At least Console and File
    });

    test('should respect LOG_LEVEL environment variable', () => {
      process.env.LOG_LEVEL = 'debug';
      logger = createLogger();
      
      expect(logger.level).toBe('debug');
    });

    test('should use info as default log level', () => {
      delete process.env.LOG_LEVEL;
      logger = createLogger();
      
      expect(logger.level).toBe('info');
    });
  });

  describe('Sensitive Data Masking', () => {
    test('should mask API keys', () => {
      const data = {
        apiKey: 'sk-1234567890abcdef',
        api_key: 'pk_test_1234567890',
        message: 'Processing with key'
      };
      
      const masked = maskSensitiveData(data);
      
      expect(masked.apiKey).toBe('sk-****');
      expect(masked.api_key).toBe('pk_****');
      expect(masked.message).toBe('Processing with key');
    });

    test('should mask passwords', () => {
      const data = {
        password: 'supersecret123',
        user_password: 'mypassword',
        pwd: 'short'
      };
      
      const masked = maskSensitiveData(data);
      
      expect(masked.password).toBe('***');
      expect(masked.user_password).toBe('***');
      expect(masked.pwd).toBe('***');
    });

    test('should mask tokens and secrets', () => {
      const data = {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        access_token: 'gho_1234567890abcdef',
        secret: 'my-secret-value',
        client_secret: 'secret123'
      };
      
      const masked = maskSensitiveData(data);
      
      expect(masked.token).toBe('eyJ****');
      expect(masked.access_token).toBe('gho****');
      expect(masked.secret).toBe('***');
      expect(masked.client_secret).toBe('***');
    });

    test('should handle nested objects', () => {
      const data = {
        user: {
          id: '123',
          credentials: {
            apiKey: 'sk-secret-key',
            password: 'userpass'
          }
        },
        config: {
          database: {
            password: 'dbpass'
          }
        }
      };
      
      const masked = maskSensitiveData(data);
      
      expect(masked.user.id).toBe('123');
      expect(masked.user.credentials.apiKey).toBe('sk-****');
      expect(masked.user.credentials.password).toBe('***');
      expect(masked.config.database.password).toBe('***');
    });

    test('should handle arrays', () => {
      const data = {
        keys: ['sk-key1', 'sk-key2', 'normal-value'],
        users: [
          { id: 1, password: 'pass1' },
          { id: 2, password: 'pass2' }
        ]
      };
      
      const masked = maskSensitiveData(data);
      
      expect(masked.keys[0]).toBe('sk-****');
      expect(masked.keys[1]).toBe('sk-****');
      expect(masked.keys[2]).toBe('normal-value');
      expect(masked.users[0].password).toBe('***');
      expect(masked.users[1].password).toBe('***');
    });

    test('should not modify original object', () => {
      const data = {
        apiKey: 'sk-secret',
        nested: {
          password: 'pass123'
        }
      };
      
      const masked = maskSensitiveData(data);
      
      expect(data.apiKey).toBe('sk-secret');
      expect(data.nested.password).toBe('pass123');
      expect(masked.apiKey).toBe('sk-****');
      expect(masked.nested.password).toBe('***');
    });

    test('should handle circular references safely', () => {
      const data = { name: 'test' };
      data.circular = data;
      
      // Should not throw when masking
      expect(() => maskSensitiveData(data)).not.toThrow();
    });
  });

  describe('Performance Logging', () => {
    test('should create performance logger', () => {
      const perfLogger = createPerformanceLogger('test-operation');
      
      expect(perfLogger).toBeDefined();
      expect(perfLogger.start).toBeInstanceOf(Function);
      expect(perfLogger.end).toBeInstanceOf(Function);
      expect(perfLogger.checkpoint).toBeInstanceOf(Function);
    });

    test('should track operation duration', async () => {
      const perfLogger = createPerformanceLogger('file-processing');
      
      perfLogger.start();
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = perfLogger.end({ success: true, filesProcessed: 5 });
      
      expect(result.duration).toBeGreaterThanOrEqual(100);
      expect(result.duration).toBeLessThan(200);
      expect(result.memoryDelta).toBeDefined();
      expect(result.memoryDelta.heapUsed).toBeDefined();
    });

    test('should track checkpoints', async () => {
      const perfLogger = createPerformanceLogger('multi-step-operation');
      
      perfLogger.start();
      
      await new Promise(resolve => setTimeout(resolve, 50));
      perfLogger.checkpoint('step1', { items: 10 });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      perfLogger.checkpoint('step2', { items: 20 });
      
      const result = perfLogger.end();
      
      expect(result.checkpoints).toHaveLength(2);
      expect(result.checkpoints[0].name).toBe('step1');
      expect(result.checkpoints[0].duration).toBeGreaterThanOrEqual(50);
      expect(result.checkpoints[1].name).toBe('step2');
      expect(result.checkpoints[1].duration).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Log Rotation', () => {
    test('should configure file transport with rotation settings', () => {
      logger = createLogger();
      
      const fileTransport = logger.transports.find(t => t.filename);
      
      expect(fileTransport).toBeDefined();
      expect(fileTransport.maxsize).toBeDefined();
      expect(fileTransport.maxFiles).toBeDefined();
    });

    test('should use environment variables for rotation settings', () => {
      process.env.LOG_MAX_SIZE = '50m';
      process.env.LOG_MAX_FILES = '10';
      
      logger = createLogger();
      
      const fileTransport = logger.transports.find(t => t.filename);
      
      expect(fileTransport.maxsize).toBe(50 * 1024 * 1024); // 50MB in bytes
      expect(fileTransport.maxFiles).toBe(10);
    });
  });

  describe('Logger Singleton', () => {
    test('should return the same logger instance', () => {
      const logger1 = getLogger('test-module');
      const logger2 = getLogger('test-module');
      
      expect(logger1).toBe(logger2);
    });

    test('should return different loggers for different modules', () => {
      const logger1 = getLogger('module1');
      const logger2 = getLogger('module2');
      
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('Production Safety', () => {
    test('should disable console transport in production', () => {
      process.env.NODE_ENV = 'production';
      logger = createLogger();
      
      const consoleTransport = logger.transports.find(t => 
        t.constructor.name === 'Console'
      );
      
      expect(consoleTransport).toBeUndefined();
    });

    test('should always mask sensitive data before logging', () => {
      logger = createLogger();
      
      // Capture log output by temporarily replacing write method
      const writes = [];
      const originalWrite = logger.transports[0].log || logger.transports[0].write;
      if (logger.transports[0].log) {
        logger.transports[0].log = (info, callback) => {
          writes.push(info);
          if (callback) callback();
        };
      }
      
      // Log with sensitive data
      logger.info('User login', {
        username: 'john',
        password: 'secret123',
        apiKey: 'sk-production-key'
      });
      
      // Check that sensitive data was masked
      const loggedInfo = writes[0];
      expect(loggedInfo).toBeDefined();
      expect(JSON.stringify(loggedInfo)).not.toContain('secret123');
      expect(JSON.stringify(loggedInfo)).not.toContain('sk-production-key');
      expect(JSON.stringify(loggedInfo)).toContain('***');
      expect(JSON.stringify(loggedInfo)).toContain('sk-****');
    });
  });
});