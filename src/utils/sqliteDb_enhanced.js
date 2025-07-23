const Database = require('better-sqlite3');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/secure');

/**
 * Enhanced Database Manager with production-ready features:
 * - Proper error handling and recovery
 * - Connection pooling simulation
 * - Transaction management with retries
 * - Performance optimizations
 * - Health checks and monitoring
 * - Graceful shutdown
 */
class EnhancedDatabaseManager {
    constructor(dbPath = config.database.sqlite.path) {
        this.dbPath = dbPath;
        this.db = null;
        this.isConnected = false;
        this.migrations = [];
        this.transactionQueue = [];
        this.isProcessingQueue = false;
        this.stats = {
            queries: 0,
            transactions: 0,
            errors: 0,
            startTime: new Date()
        };
    }

    async initialize() {
        try {
            // Ensure directory exists
            const dbDir = path.dirname(this.dbPath);
            await fs.mkdir(dbDir, { recursive: true });
            
            console.log(`🔗 Initializing SQLite database at: ${this.dbPath}`);
            
            // Create database connection with optimized settings
            this.db = new Database(this.dbPath, config.database.sqlite.options);
            
            // Apply performance optimizations
            this.applyOptimizations();
            
            // Initialize schema
            await this.initializeSchema();
            
            // Run migrations
            await this.runMigrations();
            
            this.isConnected = true;
            console.log('✅ Database initialized successfully');
            
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    applyOptimizations() {
        if (!this.db) return;
        
        try {
            // WAL mode for better concurrency
            this.db.pragma('journal_mode = WAL');
            
            // Normal synchronous mode for better performance
            this.db.pragma('synchronous = NORMAL');
            
            // Increase cache size (in pages, default page size is 4096 bytes)
            this.db.pragma('cache_size = 10000'); // ~40MB cache
            
            // Enable foreign keys
            this.db.pragma('foreign_keys = ON');
            
            // Set reasonable timeout for busy database
            this.db.pragma('busy_timeout = 10000');
            
            // Memory-mapped I/O for better performance
            this.db.pragma('mmap_size = 268435456'); // 256MB
            
            // Set page size for better performance
            this.db.pragma('page_size = 4096');
            
            console.log('✅ Database optimizations applied');
        } catch (error) {
            console.error('❌ Error applying database optimizations:', error);
            throw error;
        }
    }

    async initializeSchema() {
        try {
            const schemaPath = path.join(__dirname, 'schema.sql');
            const schema = await fs.readFile(schemaPath, 'utf-8');
            
            this.db.exec(schema);
            console.log('✅ Database schema initialized');
        } catch (error) {
            console.error('❌ Error initializing database schema:', error);
            throw error;
        }
    }

    async runMigrations() {
        if (!this.db) throw new Error('Database not initialized');
        
        try {
            // Create migrations table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS migrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    checksum TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_migrations_name ON migrations(name);
            `);

            // Add default migrations
            this.addDefaultMigrations();

            // Run pending migrations
            for (const migration of this.migrations) {
                await this.runSingleMigration(migration);
            }
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }

    addDefaultMigrations() {
        // Add performance indexes
        this.addMigration('001_add_performance_indexes', `
            CREATE INDEX IF NOT EXISTS idx_pois_file_path ON pois(file_path);
            CREATE INDEX IF NOT EXISTS idx_pois_type ON pois(type);
            CREATE INDEX IF NOT EXISTS idx_pois_name ON pois(name);
            CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_poi_id);
            CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_poi_id);
            CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
            CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
        `);

        // Add missing tables that might be needed
        this.addMigration('002_add_missing_tables', `
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                aggregate_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed_at DATETIME,
                status TEXT DEFAULT 'pending'
            );
            
            CREATE TABLE IF NOT EXISTS relationship_evidence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_poi_id INTEGER,
                target_poi_id INTEGER,
                relationship_type TEXT,
                evidence_type TEXT,
                confidence REAL,
                evidence_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (source_poi_id) REFERENCES pois (id),
                FOREIGN KEY (target_poi_id) REFERENCES pois (id)
            );

            CREATE TABLE IF NOT EXISTS directory_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                directory_path TEXT NOT NULL UNIQUE,
                summary TEXT,
                file_count INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    async runSingleMigration(migration) {
        const existingMigration = this.db.prepare('SELECT * FROM migrations WHERE name = ?').get(migration.name);
        
        if (!existingMigration) {
            console.log(`Running migration: ${migration.name}`);
            
            const transaction = this.db.transaction(() => {
                try {
                    this.db.exec(migration.sql);
                    this.db.prepare('INSERT INTO migrations (name, checksum) VALUES (?, ?)').run(
                        migration.name,
                        this.calculateChecksum(migration.sql)
                    );
                } catch (error) {
                    console.error(`❌ Migration ${migration.name} failed:`, error);
                    throw error;
                }
            });
            
            transaction();
            console.log(`✅ Migration ${migration.name} completed`);
        }
    }

    calculateChecksum(content) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    addMigration(name, sql) {
        this.migrations.push({ name, sql });
    }

    getDb() {
        if (!this.db || !this.isConnected) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.db;
    }

    // Safe transaction wrapper with retry logic
    transaction(fn, maxRetries = 3) {
        if (!this.db) throw new Error('Database not initialized');
        
        this.stats.transactions++;
        
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return this.db.transaction(fn)();
            } catch (error) {
                this.stats.errors++;
                lastError = error;
                
                if (error.code === 'SQLITE_BUSY' && attempt < maxRetries) {
                    console.warn(`Database busy, retrying... (${attempt}/${maxRetries})`);
                    // Exponential backoff
                    const delay = Math.pow(2, attempt) * 100;
                    const sleepSync = (ms) => {
                        const end = new Date().getTime() + ms;
                        while (new Date().getTime() < end) { /* busy wait */ }
                    };
                    sleepSync(delay);
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    // Batch operations for better performance
    batchInsert(tableName, columns, rows, batchSize = 1000) {
        if (!rows.length) return 0;
        
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT OR IGNORE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
        const stmt = this.db.prepare(sql);
        
        let totalInserted = 0;
        
        const transaction = this.db.transaction((batch) => {
            let batchInserted = 0;
            for (const row of batch) {
                const result = stmt.run(row);
                if (result.changes > 0) batchInserted++;
            }
            return batchInserted;
        });
        
        // Process in batches
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            totalInserted += transaction(batch);
        }
        
        return totalInserted;
    }

    // Batch update operations
    batchUpdate(tableName, updates, whereColumn, batchSize = 1000) {
        if (!updates.length) return 0;
        
        const setClause = Object.keys(updates[0]).filter(k => k !== whereColumn).map(k => `${k} = ?`).join(', ');
        const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereColumn} = ?`;
        const stmt = this.db.prepare(sql);
        
        let totalUpdated = 0;
        
        const transaction = this.db.transaction((batch) => {
            let batchUpdated = 0;
            for (const update of batch) {
                const values = Object.keys(update).filter(k => k !== whereColumn).map(k => update[k]);
                values.push(update[whereColumn]);
                const result = stmt.run(values);
                if (result.changes > 0) batchUpdated++;
            }
            return batchUpdated;
        });
        
        // Process in batches
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            totalUpdated += transaction(batch);
        }
        
        return totalUpdated;
    }

    // Health check method
    async healthCheck() {
        try {
            if (!this.db || !this.isConnected) return { healthy: false, reason: 'Not connected' };
            
            const result = this.db.prepare('SELECT 1 as health').get();
            const isHealthy = result?.health === 1;
            
            return {
                healthy: isHealthy,
                stats: this.getStats(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                reason: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // Get database statistics
    getStats() {
        if (!this.db) return null;
        
        try {
            const uptime = new Date() - this.stats.startTime;
            
            return {
                // Database stats
                pageCount: this.db.pragma('page_count', { simple: true }),
                pageSize: this.db.pragma('page_size', { simple: true }),
                freelist: this.db.pragma('freelist_count', { simple: true }),
                journalMode: this.db.pragma('journal_mode', { simple: true }),
                cacheSize: this.db.pragma('cache_size', { simple: true }),
                
                // Usage stats
                queries: this.stats.queries,
                transactions: this.stats.transactions,
                errors: this.stats.errors,
                uptime: Math.floor(uptime / 1000), // seconds
                
                // File stats
                dbPath: this.dbPath,
                isConnected: this.isConnected
            };
        } catch (error) {
            console.error('Error getting database stats:', error);
            return { error: error.message };
        }
    }

    // Optimize database (maintenance operation)
    async optimize() {
        if (!this.db) return;
        
        try {
            console.log('🔧 Starting database optimization...');
            
            // Analyze all tables for query optimization
            this.db.exec('ANALYZE');
            
            // Update SQLite statistics
            this.db.exec('PRAGMA optimize');
            
            console.log('✅ Database optimization completed');
        } catch (error) {
            console.error('❌ Database optimization failed:', error);
        }
    }

    // Vacuum database (maintenance operation)
    async vacuum() {
        if (!this.db) return;
        
        try {
            console.log('🧹 Starting database vacuum...');
            this.db.exec('VACUUM');
            console.log('✅ Database vacuum completed');
        } catch (error) {
            console.error('❌ Database vacuum failed:', error);
        }
    }

    // Backup database
    async backup(backupPath) {
        if (!this.db) throw new Error('Database not initialized');
        
        try {
            console.log(`📦 Creating database backup at: ${backupPath}`);
            
            const backupDb = new Database(backupPath);
            await this.db.backup(backupDb);
            backupDb.close();
            
            console.log('✅ Database backup completed');
        } catch (error) {
            console.error('❌ Database backup failed:', error);
            throw error;
        }
    }

    // Graceful close with proper cleanup
    async close() {
        if (this.db && this.isConnected) {
            try {
                // Wait for any pending transactions
                while (this.isProcessingQueue) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                // Checkpoint WAL file
                try {
                    this.db.pragma('wal_checkpoint(TRUNCATE)');
                } catch (error) {
                    console.warn('⚠️  Warning: Could not checkpoint WAL file:', error.message);
                }
                
                this.db.close();
                this.isConnected = false;
                console.log('✅ Database connection closed gracefully');
            } catch (error) {
                console.error('❌ Error closing database:', error);
                throw error;
            }
        }
    }

    // Get table information
    getTableInfo(tableName) {
        if (!this.db) return null;
        
        try {
            const info = this.db.pragma(`table_info(${tableName})`);
            const count = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
            
            return {
                columns: info,
                rowCount: count.count,
                tableName
            };
        } catch (error) {
            console.error(`Error getting table info for ${tableName}:`, error);
            return null;
        }
    }

    // Execute raw SQL with logging
    executeRaw(sql, params = []) {
        this.stats.queries++;
        
        try {
            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                return this.db.prepare(sql).all(params);
            } else {
                return this.db.prepare(sql).run(params);
            }
        } catch (error) {
            this.stats.errors++;
            console.error('SQL Error:', error);
            throw error;
        }
    }
}

module.exports = { EnhancedDatabaseManager, DatabaseManager: EnhancedDatabaseManager };