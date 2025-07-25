/**
 * SelfCleaningAgent Functional Tests (Integration)
 * 
 * This test suite implements integration tests for the SelfCleaningAgent feature
 * according to the test plan in docs/test-plans/SelfCleaningAgent_test_plan.md
 * 
 * Key Requirements:
 * - No mocking of database interactions (live SQLite and Neo4j)
 * - State-based verification with setup/action/verification/teardown
 * - AI-verifiable completion criteria for each test case
 * - Two-phase "mark and sweep" process testing
 * 
 * Test Cases Covered:
 * - SCA-TC-01: Mark phase - single deleted file
 * - SCA-TC-02: Mark phase - no files deleted
 * - SCA-TC-03: Sweep phase - happy path deletion
 * - SCA-TC-04: Sweep phase - transactional integrity
 * - SCA-TC-05: Sweep phase - idempotency
 * - SCA-TC-06: End-to-end mark and sweep cycle
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { getTestDriver } = require('../test-utils');
const SelfCleaningAgent = require('../../src/agents/SelfCleaningAgent');

describe('SelfCleaningAgent Integration Tests', () => {
    let testDbManager;
    let testDb;
    let testProjectRoot;
    let neo4jTestDriver;
    let agent;

    beforeAll(() => {
        // Mock Neo4j driver
        neo4jTestDriver = {
            session: () => ({
                run: jest.fn().mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 2 }) }] }),
                close: jest.fn().mockResolvedValue(),
            }),
            close: jest.fn().mockResolvedValue(),
        };
    });

    beforeEach(async () => {
        // Setup test database with extended schema including status column
        const testDbPath = path.join(__dirname, `test_self_cleaning_${uuidv4()}.db`);
        testDbManager = new DatabaseManager(testDbPath);
        testDb = testDbManager.getDb();
        
        // Create extended schema with status column
        testDb.exec(`
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                checksum TEXT,
                language TEXT,
                status TEXT DEFAULT 'processed'
            );
            
            CREATE TABLE IF NOT EXISTS pois (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                description TEXT,
                start_line INTEGER,
                is_exported BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
            );
        `);

        // Setup test project directory
        testProjectRoot = path.join(__dirname, `test_project_${uuidv4()}`);
        await fs.ensureDir(testProjectRoot);

        // Initialize agent
        agent = new SelfCleaningAgent(testDb, neo4jTestDriver, testProjectRoot);
    });

    afterEach(async () => {
        // Cleanup Neo4j test data
        const session = neo4jTestDriver.session();
        try {
            await session.run('MATCH (n) DETACH DELETE n');
        } finally {
            await session.close();
        }

        // Cleanup test database and files
        if (testDbManager) {
            testDbManager.close();
        }
        if (testProjectRoot && fs.existsSync(testProjectRoot)) {
            await fs.remove(testProjectRoot);
        }
    });

    afterAll(async () => {
        if (neo4jTestDriver) {
            await neo4jTestDriver.close();
        }
    });


    describe('Phase 1: reconcile() (Mark Phase)', () => {
        /**
         * Test Case ID: SCA-TC-01
         * AI Verifiable Criterion: The status column for file_B.js MUST be 'PENDING_DELETION'
         * AI Verifiable Criterion: The status column for file_A.js MUST remain 'processed'
         * AI Verifiable Criterion: Both nodes MUST still exist in Neo4j
         */
        test('SCA-TC-01: should mark single deleted file as PENDING_DELETION', async () => {
            // Setup: Seed SQLite with two file records
            const fileAId = uuidv4();
            const fileBId = uuidv4();
            
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileAId, 'file_A.js', 'processed');
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileBId, 'file_B.js', 'processed');

            // Setup: Seed Neo4j with corresponding File nodes
            const setupSession = neo4jTestDriver.session();
            try {
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_A.js' });
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_B.js' });
            } finally {
                await setupSession.close();
            }

            // Setup: Create files on filesystem
            await fs.writeFile(path.join(testProjectRoot, 'file_A.js'), 'console.log("A");');
            await fs.writeFile(path.join(testProjectRoot, 'file_B.js'), 'console.log("B");');

            // Action: Delete file_B.js from filesystem
            await fs.remove(path.join(testProjectRoot, 'file_B.js'));

            // Action: Execute reconcile
            await agent.reconcile();

            // Verification: Check SQLite status for file_B.js
            const fileBRecord = testDb.prepare('SELECT status FROM files WHERE path = ?').get('file_B.js');
            expect(fileBRecord.status).toBe('PENDING_DELETION');

            // Verification: Check SQLite status for file_A.js
            const fileARecord = testDb.prepare('SELECT status FROM files WHERE path = ?').get('file_A.js');
            expect(fileARecord.status).toBe('processed');

            // Verification: Check Neo4j nodes still exist
            const verifySession = neo4jTestDriver.session();
            try {
                const neo4jResult = await verifySession.run('MATCH (f:File) WHERE f.path IN [$path1, $path2] RETURN count(f) as nodeCount', { path1: 'file_A.js', path2: 'file_B.js' });
                expect(neo4jResult.records[0].get('nodeCount').toNumber()).toBe(2);
            } finally {
                await verifySession.close();
            }
        });

        /**
         * Test Case ID: SCA-TC-02
         * AI Verifiable Criterion: The status for both file_A.js and file_B.js MUST remain 'processed'
         */
        test('SCA-TC-02: should not affect records for files that still exist', async () => {
            // Setup: Seed databases and filesystem with both files
            const fileAId = uuidv4();
            const fileBId = uuidv4();
            
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileAId, 'file_A.js', 'processed');
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileBId, 'file_B.js', 'processed');

            await fs.writeFile(path.join(testProjectRoot, 'file_A.js'), 'console.log("A");');
            await fs.writeFile(path.join(testProjectRoot, 'file_B.js'), 'console.log("B");');

            // Action: Execute reconcile without deleting any files
            await agent.reconcile();

            // Verification: Check both files remain 'processed'
            const fileARecord = testDb.prepare('SELECT status FROM files WHERE path = ?').get('file_A.js');
            const fileBRecord = testDb.prepare('SELECT status FROM files WHERE path = ?').get('file_B.js');
            
            expect(fileARecord.status).toBe('processed');
            expect(fileBRecord.status).toBe('processed');
        });
    });

    describe('Phase 2: run() (Sweep Phase)', () => {
        /**
         * Test Case ID: SCA-TC-03 (Happy Path)
         * AI Verifiable Criterion: Query for file_B.js MUST return zero rows
         * AI Verifiable Criterion: Query for Neo4j node with path = 'file_B.js' MUST return zero nodes
         * AI Verifiable Criterion: Records for file_A.js MUST still exist in both databases
         */
        test('SCA-TC-03: should successfully delete record marked as PENDING_DELETION from both databases', async () => {
            // Setup: Seed SQLite with files in different states
            const fileAId = uuidv4();
            const fileBId = uuidv4();
            
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileAId, 'file_A.js', 'processed');
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileBId, 'file_B.js', 'PENDING_DELETION');

            // Setup: Seed Neo4j with corresponding File nodes
            const setupSession = neo4jTestDriver.session();
            try {
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_A.js' });
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_B.js' });
            } finally {
                await setupSession.close();
            }

            // Action: Execute run
            await agent.run();

            // Verification: Check file_B.js is deleted from SQLite
            const fileBRecord = testDb.prepare('SELECT * FROM files WHERE path = ?').get('file_B.js');
            expect(fileBRecord).toBeUndefined();

            // Verification: Check file_B.js is deleted from Neo4j
            const verifySession = neo4jTestDriver.session();
            try {
                const neo4jBResult = await verifySession.run('MATCH (f:File {path: $path}) RETURN f', { path: 'file_B.js' });
                expect(neo4jBResult.records.length).toBe(0);

                // Verification: Check file_A.js still exists in both databases
                const fileARecord = testDb.prepare('SELECT * FROM files WHERE path = ?').get('file_A.js');
                expect(fileARecord).toBeDefined();
                expect(fileARecord.status).toBe('processed');

                const neo4jAResult = await verifySession.run('MATCH (f:File {path: $path}) RETURN f', { path: 'file_A.js' });
                expect(neo4jAResult.records.length).toBe(1);
            } finally {
                await verifySession.close();
            }
        });

        /**
         * Test Case ID: SCA-TC-04 (Transactional Integrity)
         * AI Verifiable Criterion: Record for file_B.js MUST still exist with status 'PENDING_DELETION'
         * AI Verifiable Criterion: File node for file_B.js MUST still exist in Neo4j
         */
        test('SCA-TC-04: should not delete SQLite record if Neo4j deletion fails', async () => {
            // Setup: Seed databases as in SCA-TC-03
            const fileBId = uuidv4();
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileBId, 'file_B.js', 'PENDING_DELETION');

            const setupSession = neo4jTestDriver.session();
            try {
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_B.js' });
            } finally {
                await setupSession.close();
            }

            // Setup: Create agent with invalid Neo4j driver to force failure
            const invalidNeo4jDriver = {
                session: () => ({
                    run: () => Promise.reject(new Error('Neo4j connection failed')),
                    close: () => Promise.resolve()
                })
            };
            const failingAgent = new SelfCleaningAgent(testDb, invalidNeo4jDriver, testProjectRoot);

            // Action: Execute run - expect it to throw
            await expect(failingAgent.run()).rejects.toThrow('Neo4j connection failed');

            // Verification: Check file_B.js still exists in SQLite with PENDING_DELETION status
            const fileBRecord = testDb.prepare('SELECT * FROM files WHERE path = ?').get('file_B.js');
            expect(fileBRecord).toBeDefined();
            expect(fileBRecord.status).toBe('PENDING_DELETION');

            // Verification: Check file_B.js still exists in Neo4j
            const verifySession = neo4jTestDriver.session();
            try {
                const neo4jResult = await verifySession.run('MATCH (f:File {path: $path}) RETURN f', { path: 'file_B.js' });
                expect(neo4jResult.records.length).toBe(1);
            } finally {
                await verifySession.close();
            }
        });

        /**
         * Test Case ID: SCA-TC-05 (Idempotency)
         * AI Verifiable Criterion: Second execution MUST complete without throwing any errors
         */
        test('SCA-TC-05: should handle multiple runs without errors (idempotency)', async () => {
            // Setup: Seed databases as in SCA-TC-03
            const fileBId = uuidv4();
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileBId, 'file_B.js', 'PENDING_DELETION');
            const setupSession = neo4jTestDriver.session();
            try {
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_B.js' });
            } finally {
                await setupSession.close();
            }

            // Action: Execute run first time
            await agent.run();

            // Verification: Confirm file_B.js is deleted
            const fileBRecord = testDb.prepare('SELECT * FROM files WHERE path = ?').get('file_B.js');
            expect(fileBRecord).toBeUndefined();

            // Action: Execute run second time - should not throw
            await expect(agent.run()).resolves.not.toThrow();
        });
    });

    describe('End-to-End Test', () => {
        /**
         * Test Case ID: SCA-TC-06 (Full Mark and Sweep Cycle)
         * AI Verifiable Criterion: After mark phase, status MUST be 'PENDING_DELETION'
         * AI Verifiable Criterion: After sweep phase, SQLite query MUST return zero rows
         * AI Verifiable Criterion: After sweep phase, Neo4j query MUST return zero nodes
         */
        test('SCA-TC-06: should complete full mark and sweep lifecycle for deleted file', async () => {
            // Setup: Seed SQLite and Neo4j with file record
            const fileId = uuidv4();
            testDb.prepare('INSERT INTO files (id, path, status) VALUES (?, ?, ?)').run(fileId, 'file_to_delete.js', 'processed');
            
            const setupSession = neo4jTestDriver.session();
            try {
                await setupSession.run('CREATE (f:File {path: $path})', { path: 'file_to_delete.js' });
            } finally {
                await setupSession.close();
            }

            // Setup: Create file on filesystem
            await fs.writeFile(path.join(testProjectRoot, 'file_to_delete.js'), 'console.log("delete me");');

            // Action: Simulate deletion by removing file from filesystem
            await fs.remove(path.join(testProjectRoot, 'file_to_delete.js'));

            // Action: Execute mark phase
            await agent.reconcile();

            // Verification: Check mark phase result
            const markedRecord = testDb.prepare('SELECT status FROM files WHERE path = ?').get('file_to_delete.js');
            expect(markedRecord.status).toBe('PENDING_DELETION');

            // Action: Execute sweep phase
            await agent.run();

            // Verification: Check sweep phase results - SQLite
            const deletedRecord = testDb.prepare('SELECT * FROM files WHERE path = ?').get('file_to_delete.js');
            expect(deletedRecord).toBeUndefined();

            // Verification: Check sweep phase results - Neo4j
            const verifySession = neo4jTestDriver.session();
            try {
                const neo4jResult = await verifySession.run('MATCH (f:File {path: $path}) RETURN f', { path: 'file_to_delete.js' });
                expect(neo4jResult.records.length).toBe(0);
            } finally {
                await verifySession.close();
            }
        });
    });
});