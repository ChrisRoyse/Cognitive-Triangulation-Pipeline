// Disable Redis and logging for concurrency tests
process.env.NODE_ENV = 'test';
process.env.DISABLE_REDIS = 'true';
process.env.LOG_LEVEL = 'error';

// Mock winston to prevent file system errors
jest.mock('winston', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    })),
    format: {
        timestamp: jest.fn(),
        errors: jest.fn(),
        combine: jest.fn(),
        printf: jest.fn(),
        colorize: jest.fn()
    },
    transports: {
        Console: jest.fn(),
        File: jest.fn()
    }
}));