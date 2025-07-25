/**
 * Database Migration Manager
 * 
 * Handles database schema migrations in a systematic way,
 * ensuring proper versioning and rollback capabilities.
 */

const fs = require('fs');
const path = require('path');

class MigrationManager {
    constructor(db) {
        this.db = db;
        this.migrationPath = path.join(__dirname, '../../migrations');
        this.migrationsTable = 'schema_migrations';
        
        this.initializeMigrationsTable();
    }

    /**
     * Initialize the migrations tracking table
     */
    initializeMigrationsTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version TEXT UNIQUE NOT NULL,
                description TEXT,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    /**
     * Get all available migration files
     */
    getAvailableMigrations() {
        try {
            const files = fs.readdirSync(this.migrationPath)
                .filter(file => file.endsWith('.js'))
                .sort();
            
            return files.map(file => {
                const version = file.split('_')[0];
                const fullPath = path.join(this.migrationPath, file);
                return { version, file, fullPath };
            });
        } catch (error) {
            console.warn('⚠️  Migrations directory not found, creating it...');
            fs.mkdirSync(this.migrationPath, { recursive: true });
            return [];
        }
    }

    /**
     * Get all applied migrations from database
     */
    getAppliedMigrations() {
        return this.db.prepare(`
            SELECT version, description, applied_at 
            FROM ${this.migrationsTable} 
            ORDER BY version
        `).all();
    }

    /**
     * Get pending migrations that haven't been applied
     */
    getPendingMigrations() {
        const available = this.getAvailableMigrations();
        const applied = this.getAppliedMigrations();
        const appliedVersions = new Set(applied.map(m => m.version));
        
        return available.filter(migration => !appliedVersions.has(migration.version));
    }

    /**
     * Run all pending migrations
     */
    async runPendingMigrations() {
        const pending = this.getPendingMigrations();
        
        if (pending.length === 0) {
            console.log('✅ No pending migrations to run');
            return;
        }
        
        console.log(`🔄 Running ${pending.length} pending migrations...`);
        
        for (const migration of pending) {
            await this.runMigration(migration);
        }
        
        console.log('✅ All pending migrations completed');
    }

    /**
     * Run a specific migration
     */
    async runMigration(migration) {
        console.log(`🔄 Running migration ${migration.version}...`);
        
        try {
            // Load and instantiate the migration
            const MigrationClass = require(migration.fullPath);
            const className = `Migration${migration.version}`;
            const migrationInstance = new MigrationClass[className](this.db);
            
            // Check if migration is needed
            if (typeof migrationInstance.isNeeded === 'function' && !migrationInstance.isNeeded()) {
                console.log(`⏭️  Migration ${migration.version} not needed, skipping...`);
                this.recordMigration(migration.version, migrationInstance.description || 'No description');
                return;
            }
            
            // Start transaction for safety
            const transaction = this.db.transaction(() => {
                // Run the migration
                migrationInstance.up();
                
                // Validate if validation method exists
                if (typeof migrationInstance.validate === 'function') {
                    migrationInstance.validate();
                }
                
                // Record migration as applied
                this.recordMigration(migration.version, migrationInstance.description || 'No description');
            });
            
            transaction();
            
            console.log(`✅ Migration ${migration.version} completed successfully`);
            
        } catch (error) {
            console.error(`❌ Migration ${migration.version} failed:`, error.message);
            throw error;
        }
    }

    /**
     * Record a migration as applied
     */
    recordMigration(version, description) {
        this.db.prepare(`
            INSERT OR REPLACE INTO ${this.migrationsTable} (version, description) 
            VALUES (?, ?)
        `).run(version, description);
    }

    /**
     * Run a specific migration by version
     */
    async runSpecificMigration(version) {
        const available = this.getAvailableMigrations();
        const migration = available.find(m => m.version === version);
        
        if (!migration) {
            throw new Error(`Migration ${version} not found`);
        }
        
        await this.runMigration(migration);
    }

    /**
     * Show migration status
     */
    showStatus() {
        const available = this.getAvailableMigrations();
        const applied = this.getAppliedMigrations();
        const appliedVersions = new Set(applied.map(m => m.version));
        
        console.log('\n📋 Migration Status:');
        console.log('='.repeat(60));
        
        if (available.length === 0) {
            console.log('No migrations found');
            return;
        }
        
        available.forEach(migration => {
            const isApplied = appliedVersions.has(migration.version);
            const status = isApplied ? '✅ Applied' : '⏳ Pending';
            console.log(`${status} ${migration.version} (${migration.file})`);
        });
        
        console.log('='.repeat(60));
        console.log(`Total: ${available.length} migrations, ${applied.length} applied, ${available.length - applied.length} pending`);
    }

    /**
     * Reset all migrations (DANGEROUS - for development only)
     */
    resetAllMigrations() {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Cannot reset migrations in production environment');
        }
        
        console.warn('⚠️  DANGER: Resetting all migrations...');
        this.db.exec(`DELETE FROM ${this.migrationsTable}`);
        console.log('✅ All migration records cleared');
    }

    /**
     * Create a new migration file template
     */
    createMigration(name) {
        const migrations = this.getAvailableMigrations();
        const nextVersion = String(migrations.length + 1).padStart(3, '0');
        const filename = `${nextVersion}_${name.toLowerCase().replace(/\s+/g, '_')}.js`;
        const filepath = path.join(this.migrationPath, filename);
        
        const template = `/**
 * Migration ${nextVersion}: ${name}
 * 
 * Description: Add your migration description here
 */

class Migration${nextVersion} {
    constructor(db) {
        this.db = db;
        this.version = '${nextVersion}';
        this.description = '${name}';
    }

    /**
     * Apply the migration
     */
    up() {
        console.log('🔄 Applying Migration ${nextVersion}: ${name}...');
        
        // Add your migration code here
        
        console.log('✅ Migration ${nextVersion} completed successfully');
    }

    /**
     * Rollback the migration (optional)
     */
    down() {
        console.log('🔄 Rolling back Migration ${nextVersion}...');
        
        // Add your rollback code here
        
        console.log('✅ Migration ${nextVersion} rollback completed');
    }

    /**
     * Check if migration is needed
     */
    isNeeded() {
        // Add logic to check if migration should run
        return true;
    }

    /**
     * Validate migration was successful
     */
    validate() {
        // Add validation logic here
        console.log('✅ Migration ${nextVersion} validation successful');
        return true;
    }
}

module.exports = { Migration${nextVersion} };`;
        
        fs.writeFileSync(filepath, template);
        console.log(`✅ Created migration file: ${filename}`);
        return filepath;
    }
}

module.exports = { MigrationManager };