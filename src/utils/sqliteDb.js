const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { MigrationManager } = require('./migrationManager');

/**
 * Manages a connection to a SQLite database.
 * This class removes the singleton pattern, allowing for multiple, isolated
 * database connections, which is crucial for testing and modularity.
 */
class DatabaseManager {
    /**
     * @param {string} dbPath - The path to the SQLite database file.
     */
    constructor(dbPath) {
        if (!dbPath) {
            throw new Error('Database path is required.');
        }
        this.dbPath = dbPath;
        this.db = null;
    }

    /**
     * Establishes and returns the database connection.
     * @returns {Database} The better-sqlite3 database instance.
     */
    getDb() {
        if (!this.db) {
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('foreign_keys = ON');
        }
        return this.db;
    }

    /**
     * Initializes the database with the schema.
     */
    async initializeDb() {
        const db = this.getDb();
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
        db.exec(schema);
        await this.applyMigrations();
    }

    /**
     * Deletes and rebuilds the database from the schema.
     * Ensures a clean state, primarily for testing.
     */
    async rebuildDb() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        if (fs.existsSync(this.dbPath)) {
            fs.unlinkSync(this.dbPath);
        }
        await this.initializeDb();
    }

    /**
     * Applies schema migrations to the database using the new migration system.
     */
    async applyMigrations() {
        try {
            const migrationManager = new MigrationManager(this.getDb());
            await migrationManager.runPendingMigrations();
        } catch (error) {
            console.error('❌ Database migration failed:', error.message);
            throw error;
        }
    }

    /**
     * Get migration manager instance for manual migration operations
     */
    getMigrationManager() {
        return new MigrationManager(this.getDb());
    }

    /**
     * Closes the database connection.
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * Loads all Points of Interest (POIs) for a given directory, with pagination.
     * @param {string} directoryPath - The path of the directory to load POIs for.
     * @param {number} limit - The number of POIs to retrieve.
     * @param {number} offset - The starting offset for retrieval.
     * @returns {Array<object>} A promise that resolves to an array of POI objects.
     */
    loadPoisForDirectory(directoryPath, limit, offset) {
        const db = this.getDb();
        const sql = `
            SELECT * FROM pois
            WHERE file_path LIKE ?
            LIMIT ? OFFSET ?;
        `;
        const statement = db.prepare(sql);
        return statement.all(`${directoryPath}%`, limit, offset);
    }

    loadDirectorySummaries(runId, limit, offset) {
        const db = this.getDb();
        const sql = `
            SELECT * FROM directory_summaries
            WHERE run_id = ?
            LIMIT ? OFFSET ?;
        `;
        const statement = db.prepare(sql);
        return statement.all(runId, limit, offset);
    }
}

// Global database manager instance
let globalDbManager = null;

/**
 * Initialize the global database connection
 */
async function initializeDb() {
    const dbPath = process.env.SQLITE_DB_PATH || './database.db';
    globalDbManager = new DatabaseManager(dbPath);
    globalDbManager.initializeDb();
}

/**
 * Get the global database connection
 */
async function getDb() {
    if (!globalDbManager) {
        throw new Error('Database not initialized. Call initializeDb() first.');
    }
    return globalDbManager.getDb();
}

module.exports = {
    DatabaseManager,
    initializeDb,
    getDb
};