const GraphIngestionWorker = require('../../../src/workers/GraphIngestionWorker');
const neo4j = require('neo4j-driver');

// Mock neo4j-driver
jest.mock('neo4j-driver');

describe('GraphIngestionWorker - Production Hardening Tests', () => {
    let mockDriver;
    let mockSession;
    let mockRun;
    let worker;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup mock session
        mockRun = jest.fn();
        mockSession = {
            run: mockRun,
            close: jest.fn().mockResolvedValue(undefined)
        };

        // Setup mock driver
        mockDriver = {
            session: jest.fn().mockReturnValue(mockSession),
            close: jest.fn().mockResolvedValue(undefined)
        };

        // Mock neo4j.driver to return our mock driver
        neo4j.driver.mockReturnValue(mockDriver);
        neo4j.session = { WRITE: 'WRITE' };
        neo4j.auth = {
            basic: jest.fn().mockReturnValue({ username: 'neo4j', password: 'password' })
        };
    });

    afterEach(() => {
        if (worker) {
            worker.close();
        }
    });

    describe('Constructor Validation', () => {
        test('should throw ValidationError when options is missing', () => {
            expect(() => new GraphIngestionWorker()).toThrow('GraphIngestionWorker requires options object');
        });

        test('should throw ValidationError when neo4jUri is missing', () => {
            expect(() => new GraphIngestionWorker({})).toThrow('neo4jUri is required');
        });

        test('should throw ValidationError when credentials are missing', () => {
            expect(() => new GraphIngestionWorker({ neo4jUri: 'bolt://localhost:7687' }))
                .toThrow('neo4jUser and neo4jPassword are required');
        });

        test('should initialize successfully with valid options', () => {
            const options = {
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            };
            
            worker = new GraphIngestionWorker(options);
            expect(worker).toBeDefined();
            expect(worker.maxRetries).toBe(3);
            expect(worker.baseRetryDelay).toBe(1000);
            expect(worker.batchSize).toBe(1000);
        });

        test('should use custom retry configuration', () => {
            const options = {
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password',
                maxRetries: 5,
                baseRetryDelay: 2000,
                maxRetryDelay: 30000,
                batchSize: 2000
            };
            
            worker = new GraphIngestionWorker(options);
            expect(worker.maxRetries).toBe(5);
            expect(worker.baseRetryDelay).toBe(2000);
            expect(worker.maxRetryDelay).toBe(30000);
            expect(worker.batchSize).toBe(2000);
        });
    });

    describe('Input Validation', () => {
        beforeEach(() => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            });
        });

        test('should validate job object', () => {
            expect(() => worker.validateJobData(null))
                .toThrow('Invalid job object');
            expect(() => worker.validateJobData('invalid'))
                .toThrow('Invalid job object');
        });

        test('should validate job.data exists', () => {
            expect(() => worker.validateJobData({}))
                .toThrow('Job data is missing or invalid');
        });

        test('should validate graphJson exists', () => {
            expect(() => worker.validateJobData({ data: {} }))
                .toThrow('Job data is missing graphJson object');
        });

        test('should validate pois array', () => {
            expect(() => worker.validateJobData({ data: { graphJson: {} } }))
                .toThrow('Job data is missing pois array');
            
            expect(() => worker.validateJobData({ data: { graphJson: { pois: 'invalid' } } }))
                .toThrow('Job data is missing pois array');
            
            expect(() => worker.validateJobData({ data: { graphJson: { pois: [] } } }))
                .toThrow('POIs array cannot be empty');
        });

        test('should validate POI structure', () => {
            const invalidPoi = {
                data: {
                    graphJson: {
                        pois: [{ invalid: 'poi' }]
                    }
                }
            };
            expect(() => worker.validateJobData(invalidPoi))
                .toThrow("POI at index 0 is missing required field 'id'");
        });

        test('should validate POI fields', () => {
            const testCases = [
                { field: 'id', value: null, error: "POI at index 0 is missing required field 'id'" },
                { field: 'type', value: null, error: "POI at index 0 is missing required field 'type'" },
                { field: 'name', value: null, error: "POI at index 0 is missing required field 'name'" },
                { field: 'filePath', value: null, error: "POI at index 0 is missing required field 'filePath'" },
                { field: 'startLine', value: -1, error: "POI at index 0 has invalid startLine" },
                { field: 'endLine', value: 0, error: "POI at index 0 has invalid endLine" }
            ];

            testCases.forEach(({ field, value, error }) => {
                const poi = {
                    id: 'test-id',
                    type: 'Function',
                    name: 'testFunc',
                    filePath: '/test.js',
                    startLine: 1,
                    endLine: 10
                };
                poi[field] = value;

                const job = {
                    data: {
                        graphJson: {
                            pois: [poi]
                        }
                    }
                };

                expect(() => worker.validateJobData(job)).toThrow(error);
            });
        });

        test('should validate relationships structure', () => {
            const validPoi = {
                id: 'test-id',
                type: 'Function',
                name: 'testFunc',
                filePath: '/test.js',
                startLine: 1,
                endLine: 10
            };

            const job = {
                data: {
                    graphJson: {
                        pois: [validPoi],
                        relationships: 'invalid'
                    }
                }
            };

            expect(() => worker.validateJobData(job))
                .toThrow('Relationships must be an array');
        });

        test('should validate relationship fields', () => {
            const validPoi = {
                id: 'test-id',
                type: 'Function',
                name: 'testFunc',
                filePath: '/test.js',
                startLine: 1,
                endLine: 10
            };

            const testCases = [
                { field: 'source', value: null, error: "Relationship at index 0 is missing required field 'source'" },
                { field: 'target', value: null, error: "Relationship at index 0 is missing required field 'target'" },
                { field: 'type', value: null, error: "Relationship at index 0 is missing required field 'type'" },
                { field: 'filePath', value: null, error: "Relationship at index 0 is missing required field 'filePath'" }
            ];

            testCases.forEach(({ field, value, error }) => {
                const rel = {
                    source: 'src-id',
                    target: 'tgt-id',
                    type: 'calls',
                    filePath: '/test.js'
                };
                rel[field] = value;

                const job = {
                    data: {
                        graphJson: {
                            pois: [validPoi],
                            relationships: [rel]
                        }
                    }
                };

                expect(() => worker.validateJobData(job)).toThrow(error);
            });
        });

        test('should accept valid job data', () => {
            const validJob = {
                data: {
                    graphJson: {
                        pois: [{
                            id: 'test-id',
                            type: 'Function',
                            name: 'testFunc',
                            filePath: '/test.js',
                            startLine: 1,
                            endLine: 10
                        }],
                        relationships: [{
                            source: 'src-id',
                            target: 'tgt-id',
                            type: 'calls',
                            filePath: '/test.js'
                        }]
                    }
                }
            };

            const result = worker.validateJobData(validJob);
            expect(result.pois).toHaveLength(1);
            expect(result.relationships).toHaveLength(1);
        });
    });

    describe('Error Classification', () => {
        beforeEach(() => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            });
        });

        test('should identify retryable Neo4j errors', () => {
            const retryableErrors = [
                { code: 'ServiceUnavailable' },
                { code: 'SessionExpired' },
                { code: 'TransientError' },
                { code: 'DeadlockDetected' },
                { code: 'Neo.TransientError.Transaction.Terminated' },
                { code: 'Neo.TransientError.Transaction.LockClientStopped' },
                { code: 'Neo.ClientError.Transaction.TransactionTimedOut' }
            ];

            retryableErrors.forEach(error => {
                expect(worker.isRetryableError(error)).toBe(true);
            });
        });

        test('should identify retryable network errors', () => {
            const networkErrors = [
                { message: 'ECONNREFUSED: Connection refused' },
                { message: 'ECONNRESET: Connection reset by peer' },
                { message: 'ETIMEDOUT: Connection timed out' },
                { message: 'ENOTFOUND: DNS lookup failed' },
                { message: 'Socket closed unexpectedly' },
                { message: 'Connection was refused' },
                { message: 'Connection reset' },
                { message: 'Request timeout' }
            ];

            networkErrors.forEach(error => {
                expect(worker.isRetryableError(error)).toBe(true);
            });
        });

        test('should identify non-retryable errors', () => {
            const nonRetryableErrors = [
                { code: 'SyntaxError' },
                { code: 'ConstraintViolation' },
                { message: 'Invalid query syntax' },
                { message: 'Permission denied' }
            ];

            nonRetryableErrors.forEach(error => {
                expect(worker.isRetryableError(error)).toBe(false);
            });
        });
    });

    describe('Retry Logic', () => {
        beforeEach(() => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password',
                maxRetries: 2,
                baseRetryDelay: 100,
                maxRetryDelay: 400
            });

            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('should retry on transient errors', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce({ code: 'ServiceUnavailable', message: 'Service unavailable' })
                .mockRejectedValueOnce({ code: 'TransientError', message: 'Transient error' })
                .mockResolvedValueOnce('success');

            const promise = worker.executeWithRetry(operation, { test: 'retry' });
            
            // First retry after 100ms
            await jest.advanceTimersByTimeAsync(100);
            // Second retry after 200ms (exponential backoff)
            await jest.advanceTimersByTimeAsync(200);
            
            const result = await promise;
            
            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(3);
        });

        test('should not retry validation errors', async () => {
            const { ValidationError } = require('../../../src/workers/GraphIngestionWorker');
            const validationError = new ValidationError('Validation failed');
            
            const operation = jest.fn().mockRejectedValue(validationError);

            await expect(worker.executeWithRetry(operation)).rejects.toThrow('Validation failed');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        test('should respect max retries', async () => {
            const error = { code: 'ServiceUnavailable', message: 'Service unavailable' };
            const operation = jest.fn().mockRejectedValue(error);

            const promise = worker.executeWithRetry(operation, { test: 'max-retries' });
            
            // Advance through all retry delays
            await jest.advanceTimersByTimeAsync(100); // First retry
            await jest.advanceTimersByTimeAsync(200); // Second retry
            await jest.advanceTimersByTimeAsync(400); // Would be third, but max is 2
            
            await expect(promise).rejects.toMatchObject({
                message: expect.stringContaining('Operation failed after 3 attempts')
            });
            expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
        });

        test('should apply exponential backoff', async () => {
            const error = { code: 'ServiceUnavailable', message: 'Service unavailable' };
            const operation = jest.fn().mockRejectedValue(error);

            const promise = worker.executeWithRetry(operation);
            
            // Check timing of retries
            let elapsedTime = 0;
            
            // Initial attempt - immediate
            expect(operation).toHaveBeenCalledTimes(1);
            
            // First retry - after 100ms
            await jest.advanceTimersByTimeAsync(100);
            elapsedTime += 100;
            expect(operation).toHaveBeenCalledTimes(2);
            
            // Second retry - after 200ms more (exponential backoff)
            await jest.advanceTimersByTimeAsync(200);
            elapsedTime += 200;
            expect(operation).toHaveBeenCalledTimes(3);
            
            // Let it fail
            await expect(promise).rejects.toBeDefined();
        });
    });

    describe('Neo4j Connectivity', () => {
        beforeEach(() => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            });
        });

        test('should verify connectivity successfully', async () => {
            mockRun.mockResolvedValueOnce({ records: [{ get: () => 1 }] });
            
            const result = await worker.verifyConnectivity();
            
            expect(result).toBe(true);
            expect(mockSession.run).toHaveBeenCalledWith('RETURN 1 as ping');
            expect(mockSession.close).toHaveBeenCalled();
        });

        test('should handle connectivity failure', async () => {
            mockRun.mockRejectedValueOnce(new Error('Connection failed'));
            
            await expect(worker.verifyConnectivity()).rejects.toThrow('Failed to connect to Neo4j');
            expect(mockSession.close).toHaveBeenCalled();
        });
    });

    describe('Job Processing', () => {
        let validJob;

        beforeEach(() => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            });

            validJob = {
                id: 'job-123',
                attemptsMade: 1,
                data: {
                    graphJson: {
                        pois: [{
                            id: 'poi-1',
                            type: 'Function',
                            name: 'testFunc',
                            filePath: '/test.js',
                            startLine: 1,
                            endLine: 10
                        }],
                        relationships: [{
                            source: 'poi-1',
                            target: 'poi-2',
                            type: 'calls',
                            filePath: '/test.js'
                        }]
                    }
                }
            };

            // Mock successful connectivity check
            mockRun.mockImplementation((query) => {
                if (query === 'RETURN 1 as ping') {
                    return Promise.resolve({ records: [{ get: () => 1 }] });
                }
                // Mock successful ingestion
                return Promise.resolve({
                    records: [{
                        get: () => ({
                            pois: {
                                batches: 1,
                                total: 1,
                                timeTaken: 100,
                                committedOperations: 1,
                                failedOperations: 0,
                                failedBatches: 0,
                                errorMessages: []
                            },
                            relationships: {
                                batches: 1,
                                total: 1,
                                timeTaken: 50,
                                committedOperations: 1,
                                failedOperations: 0,
                                failedBatches: 0,
                                errorMessages: []
                            }
                        })
                    }]
                });
            });
        });

        test('should process valid job successfully', async () => {
            const result = await worker.processJob(validJob);
            
            expect(result).toBeDefined();
            expect(result.pois.committedOperations).toBe(1);
            expect(result.relationships.committedOperations).toBe(1);
            expect(mockSession.run).toHaveBeenCalledTimes(2); // connectivity + ingestion
        });

        test('should handle validation errors', async () => {
            delete validJob.data.graphJson.pois;
            
            await expect(worker.processJob(validJob)).rejects.toThrow('Job data is missing pois array');
            expect(mockSession.run).not.toHaveBeenCalled();
        });

        test('should retry on connection errors', async () => {
            jest.useFakeTimers();
            
            // First call fails connectivity, second succeeds
            mockRun
                .mockRejectedValueOnce({ code: 'ServiceUnavailable' })
                .mockResolvedValueOnce({ records: [{ get: () => 1 }] })
                .mockResolvedValueOnce({
                    records: [{
                        get: () => ({
                            pois: {
                                batches: 1,
                                total: 1,
                                timeTaken: 100,
                                committedOperations: 1,
                                failedOperations: 0,
                                failedBatches: 0,
                                errorMessages: []
                            },
                            relationships: {
                                batches: 1,
                                total: 1,
                                timeTaken: 50,
                                committedOperations: 1,
                                failedOperations: 0,
                                failedBatches: 0,
                                errorMessages: []
                            }
                        })
                    }]
                });

            const promise = worker.processJob(validJob);
            await jest.advanceTimersByTimeAsync(1000); // Wait for retry
            const result = await promise;
            
            expect(result).toBeDefined();
            expect(mockSession.run).toHaveBeenCalledTimes(3);
            
            jest.useRealTimers();
        });

        test('should handle partial failures', async () => {
            mockRun.mockImplementation((query) => {
                if (query === 'RETURN 1 as ping') {
                    return Promise.resolve({ records: [{ get: () => 1 }] });
                }
                return Promise.resolve({
                    records: [{
                        get: () => ({
                            pois: {
                                batches: 2,
                                total: 10,
                                timeTaken: 200,
                                committedOperations: 9,
                                failedOperations: 1,
                                failedBatches: 0,
                                errorMessages: ['Failed to process POI']
                            },
                            relationships: {
                                batches: 1,
                                total: 5,
                                timeTaken: 100,
                                committedOperations: 5,
                                failedOperations: 0,
                                failedBatches: 0,
                                errorMessages: []
                            }
                        })
                    }]
                });
            });

            // Create job with 10 POIs
            validJob.data.graphJson.pois = Array(10).fill(null).map((_, i) => ({
                id: `poi-${i}`,
                type: 'Function',
                name: `func${i}`,
                filePath: '/test.js',
                startLine: i * 10,
                endLine: (i + 1) * 10
            }));

            const result = await worker.processJob(validJob);
            
            // Should succeed because failure rate is < 10%
            expect(result).toBeDefined();
            expect(result.pois.failedOperations).toBe(1);
        });

        test('should throw on high failure rate', async () => {
            mockRun.mockImplementation((query) => {
                if (query === 'RETURN 1 as ping') {
                    return Promise.resolve({ records: [{ get: () => 1 }] });
                }
                return Promise.resolve({
                    records: [{
                        get: () => ({
                            pois: {
                                batches: 2,
                                total: 10,
                                timeTaken: 200,
                                committedOperations: 5,
                                failedOperations: 5,
                                failedBatches: 1,
                                errorMessages: ['Multiple failures']
                            },
                            relationships: {
                                batches: 1,
                                total: 5,
                                timeTaken: 100,
                                committedOperations: 5,
                                failedOperations: 0,
                                failedBatches: 0,
                                errorMessages: []
                            }
                        })
                    }]
                });
            });

            await expect(worker.processJob(validJob)).rejects.toThrow('High failure rate in ingestion');
        });
    });

    describe('Driver Lifecycle', () => {
        test('should close driver successfully', async () => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            });

            mockDriver.close.mockResolvedValueOnce();
            
            await worker.close();
            
            expect(mockDriver.close).toHaveBeenCalled();
        });

        test('should handle close errors', async () => {
            worker = new GraphIngestionWorker({
                neo4jUri: 'bolt://localhost:7687',
                neo4jUser: 'neo4j',
                neo4jPassword: 'password'
            });

            mockDriver.close.mockRejectedValueOnce(new Error('Close failed'));
            
            await expect(worker.close()).rejects.toThrow('Failed to close Neo4j driver');
        });
    });
});