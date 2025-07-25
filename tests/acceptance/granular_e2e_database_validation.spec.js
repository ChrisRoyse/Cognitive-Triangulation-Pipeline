const Database = require('better-sqlite3');
const Redis = require('ioredis');
const neo4j = require('neo4j-driver');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

// --- Database Connection Details ---
const SQLITE_DB_PATH = path.join(__dirname, '..', '..', 'database.sqlite');
const REDIS_URL = 'redis://localhost:6379';
const NEO4J_URL = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'test1234';

// --- Test Configuration ---
const TARGET_DIRECTORY = 'polyglot-test';

// --- Helper Functions ---
const runPipeline = (targetDir) => {
    return new Promise((resolve, reject) => {
        const command = `node src/main.js --target ${targetDir}`;
        const pipelineProcess = exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Pipeline Error: ${stderr}`);
                return reject(new Error(`Pipeline process exited with code ${error.code}`));
            }
            resolve(stdout);
        });
        pipelineProcess.stdout.pipe(process.stdout);
    });
};

const getTableInfo = (db, tableName) => db.pragma(`table_info('${tableName}')`);
const getForeignKeys = (db, tableName) => db.pragma(`foreign_key_list('${tableName}')`);

// --- Test Suite ---
describe('Granular E2E Database Validation - Production Style', () => {
    let db;

    beforeAll(async () => {
        // Run the pipeline once to generate the data to be tested
        await runPipeline(TARGET_DIRECTORY);
    }, 300000); // 5-minute timeout

    beforeEach(() => {
        // Open a fresh connection for each test
        db = new Database(SQLITE_DB_PATH, { readonly: true });
    });

    afterEach(() => {
        db.close();
    });

    test('E2E-DB-VALID-01: Validates the schema and constraints of the `pois` table', () => {
        const columns = getTableInfo(db, 'pois');
        expect(columns).toEqual(expect.arrayContaining([
            { cid: 0, name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
            { cid: 1, name: 'file_path', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
            { cid: 2, name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
            { cid: 3, name: 'type', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        ]));
    });

    test('E2E-DB-VALID-02: Validates the schema and constraints of the `relationships` table', () => {
        const columns = getTableInfo(db, 'relationships');
        expect(columns).toEqual(expect.arrayContaining([
            { cid: 0, name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
            { cid: 1, name: 'source_poi_id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
            { cid: 2, name: 'target_poi_id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
            { cid: 3, name: 'type', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
            { cid: 5, name: 'confidence', type: 'REAL', notnull: 0, dflt_value: null, pk: 0 },
        ]));
        
        const fks = getForeignKeys(db, 'relationships');
        expect(fks).toEqual(expect.arrayContaining([
            expect.objectContaining({ table: 'pois', from: 'source_poi_id', to: 'id', on_delete: 'CASCADE' }),
            expect.objectContaining({ table: 'pois', from: 'target_poi_id', to: 'id', on_delete: 'CASCADE' }),
        ]));
    });

    test('E2E-DB-VALID-03: Validates the semantic correctness of persisted `relationships` data', () => {
        const callRelationship = db.prepare(`
            SELECT p1.type as source_type, p2.type as target_type, r.confidence
            FROM relationships r
            JOIN pois p1 ON r.source_poi_id = p1.id
            JOIN pois p2 ON r.target_poi_id = p2.id
            WHERE r.type = 'CALLS' AND p1.name = 'authenticateUser'
        `).get();

        expect(callRelationship.source_type).toBe('Function');
        expect(callRelationship.target_type).toBe('Function');
        expect(callRelationship.confidence).toBeGreaterThan(0.5);
        expect(callRelationship.confidence).toBeLessThanOrEqual(1);
    });
    
    test('E2E-DB-VALID-04: Validates the schema and constraints of the `relationship_evidence` table', () => {
        const columns = getTableInfo(db, 'relationship_evidence');
        expect(columns.find(c => c.name === 'evidence_payload' && c.type === 'TEXT' && c.notnull === 1)).toBeDefined();
        
        const fks = getForeignKeys(db, 'relationship_evidence');
        expect(fks[0]).toMatchObject({ table: 'relationships', from: 'relationship_id', to: 'id', on_delete: 'CASCADE' });
    });
});