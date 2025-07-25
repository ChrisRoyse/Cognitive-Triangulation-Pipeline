const SemanticIdentityService = require('../src/services/SemanticIdentityService');

/**
 * Migration: Add semantic_id column to pois table and populate existing POIs
 */
class Migration003AddSemanticIdColumn {
    constructor(db) {
        this.db = db;
        this.version = '003';
        this.description = 'Add semantic_id column to pois table and populate existing POIs';
        this.semanticService = new SemanticIdentityService();
    }

    async up(db) {
        console.log(`[${this.version}] Starting migration: Add semantic_id column`);

        try {
            // Use the instance database if no db parameter provided
            const database = db || this.db;
            
            // Check if column already exists
            const tableInfo = database.prepare("PRAGMA table_info(pois)").all();
            const hasSemanticId = tableInfo.some(col => col.name === 'semantic_id');

            if (hasSemanticId) {
                console.log(`[${this.version}] semantic_id column already exists, skipping schema update`);
            } else {
                // Add the semantic_id column
                console.log(`[${this.version}] Adding semantic_id column to pois table`);
                database.exec('ALTER TABLE pois ADD COLUMN semantic_id TEXT;');

                // Add index for semantic_id
                console.log(`[${this.version}] Creating index for semantic_id`);
                database.exec('CREATE INDEX IF NOT EXISTS idx_pois_semantic_id ON pois(semantic_id);');
            }

            // Populate semantic IDs for existing POIs that don't have them
            const poisWithoutSemanticId = database.prepare(`
                SELECT id, file_path, name, type, start_line, end_line, description, is_exported 
                FROM pois 
                WHERE semantic_id IS NULL OR semantic_id = ''
                ORDER BY file_path, id
            `).all();

            if (poisWithoutSemanticId.length > 0) {
                console.log(`[${this.version}] Found ${poisWithoutSemanticId.length} POIs without semantic IDs`);

                // Group POIs by file path for efficient batch processing
                const poisByFile = {};
                for (const poi of poisWithoutSemanticId) {
                    if (!poisByFile[poi.file_path]) {
                        poisByFile[poi.file_path] = [];
                    }
                    poisByFile[poi.file_path].push(poi);
                }

                // Load existing semantic IDs to avoid conflicts
                const existingSemanticIds = database.prepare(`
                    SELECT semantic_id FROM pois 
                    WHERE semantic_id IS NOT NULL AND semantic_id != ''
                `).all().map(row => row.semantic_id);
                
                this.semanticService.importExistingIds(existingSemanticIds);

                const updateStmt = database.prepare('UPDATE pois SET semantic_id = ? WHERE id = ?');

                // Process each file's POIs
                let totalUpdated = 0;
                for (const [filePath, pois] of Object.entries(poisByFile)) {
                    try {
                        console.log(`[${this.version}] Processing ${pois.length} POIs from ${filePath}`);
                        
                        const poisWithSemanticIds = this.semanticService.generateBatchSemanticIds(filePath, pois);
                        
                        // Update database with semantic IDs
                        for (const poi of poisWithSemanticIds) {
                            if (poi.semantic_id) {
                                updateStmt.run(poi.semantic_id, poi.id);
                                totalUpdated++;
                            }
                        }
                    } catch (error) {
                        console.error(`[${this.version}] Error processing POIs from ${filePath}:`, error.message);
                        // Continue with other files even if one fails
                    }
                }

                console.log(`[${this.version}] Updated ${totalUpdated} POIs with semantic IDs`);
            } else {
                console.log(`[${this.version}] No POIs found without semantic IDs`);
            }

            console.log(`[${this.version}] Migration completed successfully`);
            return true;

        } catch (error) {
            console.error(`[${this.version}] Migration failed:`, error);
            throw error;
        }
    }

    async down(db) {
        console.log(`[${this.version}] Rolling back migration: Remove semantic_id column`);

        try {
            // Drop the index first
            db.exec('DROP INDEX IF EXISTS idx_pois_semantic_id;');

            // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
            console.log(`[${this.version}] Recreating pois table without semantic_id column`);

            // Create new table without semantic_id
            db.exec(`
                CREATE TABLE pois_backup (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER NOT NULL,
                    file_path TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    start_line INTEGER NOT NULL,
                    end_line INTEGER NOT NULL,
                    description TEXT,
                    is_exported BOOLEAN DEFAULT 0,
                    llm_output TEXT,
                    hash TEXT UNIQUE,
                    run_id TEXT,
                    FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
                );
            `);

            // Copy data (excluding semantic_id)
            db.exec(`
                INSERT INTO pois_backup (
                    id, file_id, file_path, name, type, start_line, end_line, 
                    description, is_exported, llm_output, hash, run_id
                )
                SELECT 
                    id, file_id, file_path, name, type, start_line, end_line,
                    description, is_exported, llm_output, hash, run_id
                FROM pois;
            `);

            // Replace old table
            db.exec('DROP TABLE pois;');
            db.exec('ALTER TABLE pois_backup RENAME TO pois;');

            // Recreate indexes (excluding semantic_id index)
            db.exec('CREATE INDEX IF NOT EXISTS idx_pois_file_id ON pois(file_id);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_pois_run_id ON pois(run_id);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_pois_type ON pois(type);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_pois_name ON pois(name);');

            console.log(`[${this.version}] Rollback completed successfully`);
            return true;

        } catch (error) {
            console.error(`[${this.version}] Rollback failed:`, error);
            throw error;
        }
    }
}

module.exports = { Migration003: Migration003AddSemanticIdColumn };