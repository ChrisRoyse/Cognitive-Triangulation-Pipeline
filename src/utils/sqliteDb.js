const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

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
    initializeDb() {
        const db = this.getDb();
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
        db.exec(schema);
        this.applyMigrations();
    }

    /**
     * Deletes and rebuilds the database from the schema.
     * Ensures a clean state, primarily for testing.
     */
    rebuildDb() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        if (fs.existsSync(this.dbPath)) {
            fs.unlinkSync(this.dbPath);
        }
        this.initializeDb();
    }

    /**
     * Applies schema migrations to the database.
     */
    applyMigrations() {
        const db = this.getDb();
        const version = db.pragma('user_version', { simple: true });

        if (version < 1) {
            const migrateToV1 = db.transaction(() => {
                const columns = db.pragma('table_info(relationships)');
                const columnNames = columns.map(col => col.name);
                
                let migrationSql = '';

                if (!columnNames.includes('status')) {
                    migrationSql += 'ALTER TABLE relationships ADD COLUMN status TEXT;';
                }

                if (!columnNames.includes('confidence_score')) {
                    // This is a no-op, as the column already exists in the base schema.
                    // This check is kept for backwards compatibility with older databases.
                }
                
                migrationSql += `
                    CREATE TABLE IF NOT EXISTS relationship_evidence (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        relationshipId INTEGER NOT NULL,
                        runId TEXT NOT NULL,
                        evidencePayload TEXT NOT NULL,
                        FOREIGN KEY (relationshipId) REFERENCES relationships (id) ON DELETE CASCADE
                    );
                `;

                if(migrationSql.trim().length > 0) {
                    db.exec(migrationSql);
                }

                db.pragma('user_version = 1');
            });

            try {
                migrateToV1();
            } catch (error) {
                console.error('Migration to V1 failed:', error);
            }
        }

        if (version < 2) {
            const migrateToV2 = db.transaction(() => {
                // Add relationship_hash column to relationship_evidence table
                const evidenceColumns = db.pragma('table_info(relationship_evidence)');
                const evidenceColumnNames = evidenceColumns.map(col => col.name);
                
                if (!evidenceColumnNames.includes('relationship_hash')) {
                    db.exec('ALTER TABLE relationship_evidence ADD COLUMN relationship_hash TEXT;');
                }

                db.pragma('user_version = 2');
            });

            try {
                migrateToV2();
            } catch (error) {
                console.error('Migration to V2 failed:', error);
            }
        }
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