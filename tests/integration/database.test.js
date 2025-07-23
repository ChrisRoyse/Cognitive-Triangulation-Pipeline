/**
 * Integration Tests for Database Operations
 * 
 * Tests database operations with the new migration system and centralized configuration.
 */

require('dotenv').config();
const { describe, test, beforeEach, afterEach, expect } = require('@jest/globals');
const { DatabaseManager } = require('../../src/utils/sqliteDb');
const { PipelineConfig } = require('../../src/config/pipelineConfig');
const fs = require('fs');

describe('Database Integration', () => {
    let dbManager;
    let testDbPath;
    let pipelineConfig;

    beforeEach(async () => {
        pipelineConfig = PipelineConfig.createForTesting();
        testDbPath = `./tests/test-db-integration-${Date.now()}.db`;
        dbManager = new DatabaseManager(testDbPath);
    });

    afterEach(async () => {
        if (dbManager) {
            await dbManager.close();
        }
        
        // Clean up test database file
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    describe('Database Initialization', () => {
        test('should initialize database with migrations', async () => {
            await dbManager.initializeDb();
            
            const db = dbManager.getDb();
            
            // Check that all expected tables exist
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            
            expect(tableNames).toContain('pois');
            expect(tableNames).toContain('relationships');
            expect(tableNames).toContain('files');
            expect(tableNames).toContain('directory_summaries');
            expect(tableNames).toContain('outbox');
            expect(tableNames).toContain('relationship_evidence');
            expect(tableNames).toContain('schema_migrations');
            
            console.log(`✅ Found ${tables.length} tables:`, tableNames);
        });

        test('should run migrations successfully', async () => {
            await dbManager.initializeDb();
            
            const migrationManager = dbManager.getMigrationManager();
            const appliedMigrations = migrationManager.getAppliedMigrations();
            
            expect(appliedMigrations.length).toBeGreaterThan(0);
            console.log(`✅ Applied ${appliedMigrations.length} migrations`);
        });

        test('should have run_id columns after migration', async () => {
            await dbManager.initializeDb();
            
            const db = dbManager.getDb();
            
            // Check POIs table has run_id column
            const poisColumns = db.prepare('PRAGMA table_info(pois)').all();
            const poisColumnNames = poisColumns.map(col => col.name);
            expect(poisColumnNames).toContain('run_id');
            
            // Check relationships table has run_id column
            const relationshipsColumns = db.prepare('PRAGMA table_info(relationships)').all();
            const relationshipsColumnNames = relationshipsColumns.map(col => col.name);
            expect(relationshipsColumnNames).toContain('run_id');
            
            console.log(`✅ POIs columns:`, poisColumnNames);
            console.log(`✅ Relationships columns:`, relationshipsColumnNames);
        });
    });

    describe('Database Operations', () => {
        let db;

        beforeEach(async () => {
            await dbManager.initializeDb();
            db = dbManager.getDb();
        });

        test('should insert and retrieve POIs', async () => {
            const testRunId = 'test-pois-' + Date.now();
            
            const insertPoi = db.prepare(`
                INSERT INTO pois (run_id, file_path, type, name, start_line, end_line, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            insertPoi.run(testRunId, '/test/file.js', 'FunctionDefinition', 'testFunc', 1, 5, '{}');
            insertPoi.run(testRunId, '/test/file.js', 'VariableDeclaration', 'testVar', 7, 7, '{}');
            
            const selectPois = db.prepare('SELECT * FROM pois WHERE run_id = ?');
            const pois = selectPois.all(testRunId);
            
            expect(pois.length).toBe(2);
            expect(pois[0].type).toBe('FunctionDefinition');
            expect(pois[1].type).toBe('VariableDeclaration');
            
            console.log(`✅ Inserted and retrieved ${pois.length} POIs`);
        });

        test('should insert and retrieve relationships with foreign keys', async () => {
            const testRunId = 'test-relationships-' + Date.now();
            
            // First insert POIs
            const insertPoi = db.prepare(`
                INSERT INTO pois (run_id, file_path, type, name, start_line, end_line, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            const poiResult1 = insertPoi.run(testRunId, '/test/file.js', 'FunctionDefinition', 'func1', 1, 5, '{}');
            const poiResult2 = insertPoi.run(testRunId, '/test/file.js', 'FunctionDefinition', 'func2', 7, 11, '{}');
            
            // Then insert relationship
            const insertRel = db.prepare(`
                INSERT INTO relationships (run_id, source_poi_id, target_poi_id, type, confidence, evidence, file_path)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            insertRel.run(testRunId, poiResult1.lastInsertRowid, poiResult2.lastInsertRowid, 'CALLS', 0.9, 'test evidence', '/test/file.js');
            
            const selectRels = db.prepare('SELECT * FROM relationships WHERE run_id = ?');
            const relationships = selectRels.all(testRunId);
            
            expect(relationships.length).toBe(1);
            expect(relationships[0].type).toBe('CALLS');
            expect(relationships[0].confidence).toBe(0.9);
            
            console.log(`✅ Inserted and retrieved ${relationships.length} relationships`);
        });

        test('should handle relationship evidence table', async () => {
            const testRunId = 'test-evidence-' + Date.now();
            
            const insertEvidence = db.prepare(`
                INSERT INTO relationship_evidence (run_id, evidence_payload, relationship_hash)
                VALUES (?, ?, ?)
            `);
            
            insertEvidence.run(testRunId, '{"type": "test", "confidence": 0.8}', 'hash123');
            
            const selectEvidence = db.prepare('SELECT * FROM relationship_evidence WHERE run_id = ?');
            const evidence = selectEvidence.all(testRunId);
            
            expect(evidence.length).toBe(1);
            expect(evidence[0].relationship_hash).toBe('hash123');
            
            console.log(`✅ Inserted and retrieved ${evidence.length} evidence records`);
        });
    });

    describe('Configuration Integration', () => {
        test('should use database configuration from pipeline config', async () => {
            const dbConfig = pipelineConfig.getDatabaseConfig('sqlite');
            
            expect(dbConfig).toBeDefined();
            expect(dbConfig.batchSize).toBe(100);
            expect(dbConfig.retryAttempts).toBe(3);
            expect(dbConfig.pragmas).toBeDefined();
            expect(dbConfig.pragmas.journal_mode).toBe('WAL');
            
            console.log(`✅ Database config loaded:`, {
                batchSize: dbConfig.batchSize,
                retryAttempts: dbConfig.retryAttempts,
                journalMode: dbConfig.pragmas.journal_mode
            });
        });

        test('should apply database pragmas correctly', async () => {
            await dbManager.initializeDb();
            const db = dbManager.getDb();
            
            // Check that WAL mode is applied
            const journalMode = db.pragma('journal_mode', { simple: true });
            expect(journalMode).toBe('wal');
            
            // Check that foreign keys are enabled
            const foreignKeys = db.pragma('foreign_keys', { simple: true });
            expect(foreignKeys).toBe(1);
            
            console.log(`✅ Database pragmas applied: journal_mode=${journalMode}, foreign_keys=${foreignKeys}`);
        });
    });

    describe('Migration Management', () => {
        test('should track migration history', async () => {
            await dbManager.initializeDb();
            
            const migrationManager = dbManager.getMigrationManager();
            const applied = migrationManager.getAppliedMigrations();
            
            expect(applied.length).toBeGreaterThan(0);
            
            // Check that migration 001 was applied
            const migration001 = applied.find(m => m.version === '001');
            expect(migration001).toBeDefined();
            expect(migration001.description).toContain('run_id');
            
            console.log(`✅ Migration history:`, applied.map(m => `${m.version}: ${m.description}`));
        });

        test('should show correct migration status', async () => {
            await dbManager.initializeDb();
            
            const migrationManager = dbManager.getMigrationManager();
            
            // Capture console output
            const originalLog = console.log;
            const logs = [];
            console.log = (...args) => logs.push(args.join(' '));
            
            migrationManager.showStatus();
            
            console.log = originalLog;
            
            // Should have logged migration status
            const statusLogs = logs.filter(log => log.includes('Migration Status') || log.includes('Applied'));
            expect(statusLogs.length).toBeGreaterThan(0);
            
            console.log(`✅ Migration status displayed successfully`);
        });
    });

    describe('Error Handling', () => {
        test('should handle duplicate migration gracefully', async () => {
            await dbManager.initializeDb();
            
            const migrationManager = dbManager.getMigrationManager();
            
            // Try to run the same migration again
            const availableMigrations = migrationManager.getAvailableMigrations();
            if (availableMigrations.length > 0) {
                // This should be idempotent
                await expect(migrationManager.runPendingMigrations()).resolves.not.toThrow();
            }
            
            console.log(`✅ Duplicate migration handling works`);
        });

        test('should validate foreign key constraints', async () => {
            await dbManager.initializeDb();
            const db = dbManager.getDb();
            
            const insertRel = db.prepare(`
                INSERT INTO relationships (run_id, source_poi_id, target_poi_id, type, confidence, evidence, file_path)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            // Try to insert relationship with non-existent POI IDs
            expect(() => {
                insertRel.run('test-run', 99999, 99998, 'CALLS', 0.9, 'test', '/test/file.js');
            }).toThrow();
            
            console.log(`✅ Foreign key constraints are enforced`);
        });
    });
});