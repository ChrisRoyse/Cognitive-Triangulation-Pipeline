const { getDriver } = require('../test-utils');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

describe('Acceptance Test A-01-- Comprehensive Graph Generation', () => {
    let driver;
    let session;

    // Establish a connection to the Neo4j database before all tests
    beforeAll(async () => {
        // NOTE-- This assumes the Neo4j instance is running and accessible.
        // Configuration should be externalized in a real-world scenario.
        driver = getDriver();
        session = driver.session();
        
        // Ensure the database is in a clean state before the test run
        await session.run('MATCH (n) DETACH DELETE n');
    }, 30000); // 30-second timeout for setup

    // Close the database connection after all tests have run
    afterAll(async () => {
        if (session) {
            await session.close();
        }
        if (driver) {
            await driver.close();
        }
    });

    // The core test case
    test('should process a polyglot codebase and generate an accurate knowledge graph', async () => {
        // --- Test Step 1-- Execute the full analysis pipeline ---
        // We execute the main script targeting our controlled test directory.
        // This command kicks off the EntityScout, RelationshipResolver, and GraphBuilder agents in sequence.
        const { stdout, stderr } = await execPromise('node src/main.js --target polyglot-test', {
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer to handle large output
        });
        
        console.log('Pipeline STDOUT--', stdout);
        if (stderr && !stderr.includes('It is highly recommended to use a minimum Redis version')) {
            console.error('Pipeline STDERR--', stderr);
        }
        expect(stderr.replace(/It is highly recommended to use a minimum Redis version of 6.2.0\s+Current: 6.0.16\s+/g, '')).toBe('');

        // --- Verification Step 1-- Verify Node Counts ---
        // This query checks if the correct number and types of nodes (POIs) were created.
        const nodeCountsResult = await session.run(`
            MATCH (p:POI)
            RETURN p.type AS nodeType, count(*) AS count
        `);
        
        const actualNodeCounts = nodeCountsResult.records.map(record => ({
            type: record.get('nodeType'),
            count: record.get('count').toNumber()
        }));

        // This represents the "ground truth" for our test codebase.
        // These values must be updated if the `polyglot-test` directory changes.
        const expectedNodeCounts = [
            { type: 'FunctionDefinition', count: 5 }, // e.g., foo, bar, getUser, logic_A_func, logic_B_func
            { type: 'VariableDeclaration', count: 1 }, // e.g., API_KEY
            { type: 'ImportStatement', count: 2 }
        ];

        expect(actualNodeCounts).toEqual(expect.arrayContaining(expectedNodeCounts));

        // --- Verification Step 2-- Verify Relationship Counts ---
        const relCountsResult = await session.run(`
            MATCH ()-[r:RELATIONSHIP]->()
            RETURN r.type AS relationshipType, count(*) AS count
        `);

        const actualRelCounts = relCountsResult.records.map(record => ({
            type: record.get('relationshipType'),
            count: record.get('count').toNumber()
        }));
        
        const expectedRelCounts = [
            { type: 'CALLS', count: 3 }, // foo->bar, logic_A->getUser, logic_B->getUser
            { type: 'IMPORTS', count: 2 }
        ];

        expect(actualRelCounts).toEqual(expect.arrayContaining(expectedRelCounts));

        // --- Verification Step 3-- Verify a Specific Cross-Language Relationship ---
        // This is the most critical assertion-- it proves that the system connected
        // a POI from a Python file to a POI in a JavaScript file.
        const crossLanguageRelResult = await session.run(`
            MATCH (source:POI {name: 'foo'})-[r:RELATIONSHIP {type: 'CALLS'}]->(target:POI {name: 'bar'})
            RETURN count(r) as count
        `);
        
        const crossLanguageRelCount = crossLanguageRelResult.records[0].get('count').toNumber();
        expect(crossLanguageRelCount).toBe(1);

    }, 600000); // 10-minute timeout for this long-running E2E test
});