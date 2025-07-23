/**
 * Migration 001: Add run_id columns to POIs and relationships tables
 * 
 * This migration adds the critical run_id column to the pois and relationships
 * tables, enabling proper tracking of pipeline runs and data isolation.
 */

class Migration001 {
    constructor(db) {
        this.db = db;
        this.version = '001';
        this.description = 'Add run_id columns to POIs and relationships tables';
    }

    /**
     * Apply the migration
     */
    up() {
        console.log('🔄 Applying Migration 001: Adding run_id columns...');
        
        // Check current schema first
        const poisColumns = this.getTableColumns('pois');
        const relationshipsColumns = this.getTableColumns('relationships');
        
        console.log('📊 Current pois columns:', poisColumns.map(c => c.name));
        console.log('📊 Current relationships columns:', relationshipsColumns.map(c => c.name));
        
        // Add run_id to pois table if it doesn't exist
        if (!poisColumns.some(col => col.name === 'run_id')) {
            console.log('   ➕ Adding run_id column to pois table...');
            this.db.exec(`
                ALTER TABLE pois ADD COLUMN run_id TEXT;
            `);
            
            // Create index for performance
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_pois_run_id ON pois(run_id);
            `);
            
            console.log('   ✅ Added run_id column to pois table');
        } else {
            console.log('   ✅ run_id column already exists in pois table');
        }
        
        // Add run_id to relationships table if it doesn't exist
        if (!relationshipsColumns.some(col => col.name === 'run_id')) {
            console.log('   ➕ Adding run_id column to relationships table...');
            this.db.exec(`
                ALTER TABLE relationships ADD COLUMN run_id TEXT;
            `);
            
            // Create index for performance
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_relationships_run_id ON relationships(run_id);
            `);
            
            console.log('   ✅ Added run_id column to relationships table');
        } else {
            console.log('   ✅ run_id column already exists in relationships table');
        }
        
        // Fix other column inconsistencies
        this.fixColumnInconsistencies();
        
        console.log('✅ Migration 001 completed successfully');
    }

    /**
     * Rollback the migration (optional - be careful with data loss)
     */
    down() {
        console.log('🔄 Rolling back Migration 001...');
        console.warn('⚠️  Rollback would require table recreation and potential data loss');
        console.warn('⚠️  Rollback not implemented for safety - manual intervention required');
    }

    /**
     * Fix other column inconsistencies found in the schema
     */
    fixColumnInconsistencies() {
        const relationshipsColumns = this.getTableColumns('relationships');
        
        // Check if we have the right columns for relationships
        const hasConfidence = relationshipsColumns.some(col => col.name === 'confidence');
        const hasEvidence = relationshipsColumns.some(col => col.name === 'evidence');
        
        if (!hasConfidence) {
            console.log('   ➕ Adding confidence column to relationships table...');
            this.db.exec(`
                ALTER TABLE relationships ADD COLUMN confidence REAL DEFAULT 0.8;
            `);
        }
        
        if (!hasEvidence) {
            console.log('   ➕ Adding evidence column to relationships table...');
            this.db.exec(`
                ALTER TABLE relationships ADD COLUMN evidence TEXT;
            `);
        }
        
        // Fix column naming inconsistency (confidence_score vs confidence)
        if (relationshipsColumns.some(col => col.name === 'confidence_score') && !hasConfidence) {
            console.log('   🔄 Column confidence_score exists, no need to add confidence');
        }
        
        // Add payload column to pois if missing
        const poisColumns = this.getTableColumns('pois');
        if (!poisColumns.some(col => col.name === 'payload')) {
            console.log('   ➕ Adding payload column to pois table...');
            this.db.exec(`
                ALTER TABLE pois ADD COLUMN payload TEXT;
            `);
        }
    }

    /**
     * Get all columns for a table
     */
    getTableColumns(tableName) {
        return this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    }

    /**
     * Check if migration is needed
     */
    isNeeded() {
        const poisColumns = this.getTableColumns('pois');
        const relationshipsColumns = this.getTableColumns('relationships');
        
        const poisNeedsRunId = !poisColumns.some(col => col.name === 'run_id');
        const relationshipsNeedsRunId = !relationshipsColumns.some(col => col.name === 'run_id');
        
        return poisNeedsRunId || relationshipsNeedsRunId;
    }

    /**
     * Validate migration was successful
     */
    validate() {
        const poisColumns = this.getTableColumns('pois');
        const relationshipsColumns = this.getTableColumns('relationships');
        
        const poisHasRunId = poisColumns.some(col => col.name === 'run_id');
        const relationshipsHasRunId = relationshipsColumns.some(col => col.name === 'run_id');
        
        if (!poisHasRunId) {
            throw new Error('Migration validation failed: pois table missing run_id column');
        }
        
        if (!relationshipsHasRunId) {
            throw new Error('Migration validation failed: relationships table missing run_id column');
        }
        
        console.log('✅ Migration 001 validation successful');
        return true;
    }
}

module.exports = { Migration001 };