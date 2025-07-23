/**
 * Mock implementations for testing
 */

// Mock logger to prevent file system issues during tests
jest.mock('../src/config/logging', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock QueueManager to prevent Redis connection issues
jest.mock('../src/utils/queueManager', () => ({
    QueueManager: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(true),
        shutdown: jest.fn().mockResolvedValue(true),
        createWorker: jest.fn(),
        createQueue: jest.fn()
    }))
}));

// Mock services that aren't needed for unit tests
jest.mock('../src/services/llmService', () => ({
    LLMService: jest.fn().mockImplementation(() => ({
        analyze: jest.fn(),
        generateRelationships: jest.fn()
    }))
}));

jest.mock('../src/db/neo4jClient', () => ({
    Neo4jClient: jest.fn().mockImplementation(() => ({
        session: jest.fn(),
        verifyConnectivity: jest.fn()
    }))
}));

jest.mock('../src/cache/redisClient', () => ({
    RedisCache: jest.fn().mockImplementation(() => ({
        get: jest.fn(),
        set: jest.fn()
    }))
}));

module.exports = {};