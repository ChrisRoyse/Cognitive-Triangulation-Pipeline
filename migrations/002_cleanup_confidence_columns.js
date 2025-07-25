/**
 * Migration 002: Cleanup Confidence Columns
 * 
 * Description: Remove duplicate confidence_score column from relationships table
 * 
 * Issues Fixed:
 * 1. Remove deprecated confidence_score column from relationships table
 * 2. Migrate any existing data from confidence_score to confidence if needed
 * 3. Ensure only the confidence column exists for future consistency
 * 4. Validate the cleanup was successful
 */

class Migration002 {
    constructor(db) {
        this.db = db;
        this.version = '002';
        this.description = 'Cleanup Confidence Columns';
    }

    /**
     * Apply the migration
     */
    up() {
        console.log('🔄 Applying Migration 002: Cleanup Confidence Columns...');
        
        // Step 1: Check current schema
        const relColumns = this.db.prepare("PRAGMA table_info(relationships)").all();
        const hasConfidence = relColumns.some(col => col.name === 'confidence');
        const hasConfidenceScore = relColumns.some(col => col.name === 'confidence_score');
        
        console.log(`📊 Current state: confidence=${hasConfidence}, confidence_score=${hasConfidenceScore}`);
        
        if (!hasConfidenceScore) {
            console.log('✅ No confidence_score column found, migration not needed');
            return;
        }
        
        // Step 2: Migrate data from confidence_score to confidence if needed
        if (hasConfidenceScore && hasConfidence) {
            console.log('📝 Migrating data from confidence_score to confidence...');
            
            // Check if there's any data in confidence_score that's not in confidence
            const needsMigration = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships 
                WHERE confidence_score IS NOT NULL 
                AND (confidence IS NULL OR confidence = 0.8)
            `).get().count;
            
            if (needsMigration > 0) {
                console.log(`📝 Migrating ${needsMigration} rows with confidence_score data...`);
                this.db.prepare(`
                    UPDATE relationships 
                    SET confidence = confidence_score 
                    WHERE confidence_score IS NOT NULL 
                    AND (confidence IS NULL OR confidence = 0.8)
                `).run();
                console.log('✅ Data migration completed');
            } else {
                console.log('✅ No data migration needed');
            }
        }
        
        // Step 3: Create new table without confidence_score column
        console.log('📝 Creating new relationships table without confidence_score...');
        
        // Create temporary table with correct schema
        this.db.exec(`
            CREATE TABLE relationships_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_poi_id INTEGER,
                target_poi_id INTEGER,
                type TEXT NOT NULL,
                file_path TEXT,
                status TEXT,
                confidence REAL DEFAULT 0.8,
                reason TEXT,
                run_id TEXT,
                evidence TEXT,
                FOREIGN KEY (source_poi_id) REFERENCES pois (id) ON DELETE CASCADE,
                FOREIGN KEY (target_poi_id) REFERENCES pois (id) ON DELETE CASCADE
            )
        `);
        
        // Step 4: Copy data from old table to new table
        console.log('📝 Copying data to new table...');
        this.db.exec(`
            INSERT INTO relationships_new (
                id, source_poi_id, target_poi_id, type, file_path, 
                status, confidence, reason, run_id, evidence
            )
            SELECT 
                id, source_poi_id, target_poi_id, type, file_path,
                status, confidence, reason, run_id, evidence
            FROM relationships
        `);
        
        // Step 5: Drop old table and rename new table
        console.log('📝 Replacing old table with new table...');
        this.db.exec('DROP TABLE relationships');
        this.db.exec('ALTER TABLE relationships_new RENAME TO relationships');
        
        // Step 6: Recreate indexes
        console.log('📝 Recreating indexes...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_relationships_status ON relationships(status)',
            'CREATE INDEX IF NOT EXISTS idx_relationships_run_id ON relationships(run_id)',
            'CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type)',
            'CREATE INDEX IF NOT EXISTS idx_relationships_confidence ON relationships(confidence)'
        ];
        
        indexes.forEach(indexSql => {
            try {
                this.db.exec(indexSql);
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    console.warn(`⚠️  Index creation warning: ${error.message}`);
                }
            }
        });
        
        console.log('✅ Migration 002 completed successfully');
    }

    /**
     * Rollback the migration (optional)
     */
    down() {
        console.log('🔄 Rolling back Migration 002...');
        
        console.log('📝 Adding confidence_score column back to relationships table...');
        
        try {
            this.db.exec('ALTER TABLE relationships ADD COLUMN confidence_score REAL');
            console.log('✅ Migration 002 rollback completed');
        } catch (error) {
            if (error.message.includes('duplicate column name')) {
                console.log('✅ confidence_score column already exists, rollback not needed');
            } else {
                throw error;
            }
        }
    }

    /**
     * Check if migration is needed
     */
    isNeeded() {
        try {
            const relColumns = this.db.prepare("PRAGMA table_info(relationships)").all();
            const hasConfidenceScore = relColumns.some(col => col.name === 'confidence_score');
            
            console.log(`🔍 Migration 002 needed: ${hasConfidenceScore}`);
            return hasConfidenceScore;
        } catch (error) {
            console.error('Error checking if migration is needed:', error);
            return false;
        }
    }

    /**
     * Validate migration was successful
     */
    validate() {
        console.log('🔍 Validating Migration 002...');
        
        // Check that confidence_score column no longer exists
        const relColumns = this.db.prepare("PRAGMA table_info(relationships)").all();
        const hasConfidence = relColumns.some(col => col.name === 'confidence');
        const hasConfidenceScore = relColumns.some(col => col.name === 'confidence_score');
        
        if (hasConfidenceScore) {
            throw new Error('Migration failed: confidence_score column still exists');
        }
        
        if (!hasConfidence) {
            throw new Error('Migration failed: confidence column is missing');
        }
        
        // Check that indexes still exist
        const indexes = this.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
        const requiredIndexes = ['idx_relationships_status', 'idx_relationships_type', 'idx_relationships_confidence'];
        
        for (const indexName of requiredIndexes) {
            if (!indexes.some(idx => idx.name === indexName)) {
                console.warn(`⚠️  Missing index: ${indexName}`);
            }
        }
        
        // Verify table structure is correct
        const schema = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='relationships'").get();
        if (!schema || !schema.sql.includes('confidence REAL DEFAULT 0.8')) {
            throw new Error('Migration failed: relationships table schema is incorrect');
        }
        
        console.log('✅ Migration 002 validation successful');
        return true;
    }
}

module.exports = { Migration002 };