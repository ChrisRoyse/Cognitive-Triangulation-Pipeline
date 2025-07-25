/**
 * Migration 006: Add expected_count column to relationship_evidence_tracking table
 * 
 * Description: Add expected_count column to track the expected number of evidence items for each relationship
 */

class Migration006 {
    constructor(db) {
        this.db = db;
        this.version = '006';
        this.description = 'Add expected_count column to relationship_evidence_tracking table';
    }

    /**
     * Check if migration is needed
     */
    isNeeded() {
        try {
            // Check if the column already exists
            const tableInfo = this.db.prepare("PRAGMA table_info(relationship_evidence_tracking)").all();
            const hasExpectedCount = tableInfo.some(col => col.name === 'expected_count');
            return !hasExpectedCount;
        } catch (error) {
            // Table might not exist, migration is needed
            return true;
        }
    }

    /**
     * Apply the migration
     */
    up() {
        console.log('🔄 Applying Migration 006: Add expected_count to relationship_evidence_tracking table...');
        
        try {
            // Add the expected_count column
            this.db.exec(`
                ALTER TABLE relationship_evidence_tracking 
                ADD COLUMN expected_count INTEGER NOT NULL DEFAULT 0;
            `);
            
            console.log('✅ Added expected_count column to relationship_evidence_tracking table');
        } catch (error) {
            if (error.message.includes('duplicate column name')) {
                console.log('⏭️  Column expected_count already exists, skipping...');
            } else {
                throw error;
            }
        }
    }

    /**
     * Validate the migration was successful
     */
    validate() {
        const tableInfo = this.db.prepare("PRAGMA table_info(relationship_evidence_tracking)").all();
        const hasExpectedCount = tableInfo.some(col => col.name === 'expected_count');
        
        if (!hasExpectedCount) {
            throw new Error('Migration validation failed: expected_count column not found');
        }
        
        console.log('✅ Migration 006 validation passed');
    }

    /**
     * Rollback the migration (if needed)
     */
    down() {
        console.log('🔄 Rolling back Migration 006: Remove expected_count from relationship_evidence_tracking table...');
        
        // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
        this.db.exec(`
            -- Create temporary table without expected_count
            CREATE TABLE relationship_evidence_tracking_temp AS
            SELECT 
                id, run_id, relationship_hash, relationship_id, evidence_count,
                total_confidence, avg_confidence, status, created_at, updated_at,
                processed_at, error_message
            FROM relationship_evidence_tracking;
            
            -- Drop the original table
            DROP TABLE relationship_evidence_tracking;
            
            -- Recreate the table without expected_count
            CREATE TABLE relationship_evidence_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                relationship_hash TEXT NOT NULL,
                relationship_id INTEGER,
                evidence_count INTEGER DEFAULT 0,
                total_confidence REAL DEFAULT 0.0,
                avg_confidence REAL DEFAULT 0.0,
                status TEXT DEFAULT 'PENDING',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed_at DATETIME,
                error_message TEXT,
                UNIQUE(run_id, relationship_hash),
                FOREIGN KEY (relationship_id) REFERENCES relationships (id) ON DELETE SET NULL
            );
            
            -- Copy data back
            INSERT INTO relationship_evidence_tracking 
            SELECT * FROM relationship_evidence_tracking_temp;
            
            -- Drop temporary table
            DROP TABLE relationship_evidence_tracking_temp;
            
            -- Recreate indexes
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_run_id ON relationship_evidence_tracking(run_id);
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_hash ON relationship_evidence_tracking(relationship_hash);
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_status ON relationship_evidence_tracking(status);
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_created ON relationship_evidence_tracking(created_at);
            CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_relationship_id ON relationship_evidence_tracking(relationship_id);
        `);
        
        console.log('✅ Rolled back migration successfully');
    }
}

// Export the class
module.exports = { Migration006 };