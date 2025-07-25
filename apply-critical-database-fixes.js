#!/usr/bin/env node

/**
 * Apply Critical Database Fixes
 * 
 * This script manually applies Migration 005 to fix critical database issues
 * including the missing relationship_evidence_tracking table.
 */

const path = require('path');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const { MigrationManager } = require('./src/utils/migrationManager');

async function applyFixes() {
    console.log('🔧 Applying critical database fixes...');
    
    try {
        // Initialize database manager
        const dbPath = path.join(__dirname, 'data', 'database.db');
        console.log(`📁 Using database: ${dbPath}`);
        
        const dbManager = new DatabaseManager(dbPath);
        const db = dbManager.getDb();
        
        // Initialize migration manager
        const migrationManager = new MigrationManager(db);
        
        // Show current migration status
        console.log('\n📋 Current Migration Status:');
        migrationManager.showStatus();
        
        // Run pending migrations
        console.log('\n🔄 Running pending migrations...');
        await migrationManager.runPendingMigrations();
        
        // Show final status
        console.log('\n📋 Final Migration Status:');
        migrationManager.showStatus();
        
        // Verify the table exists
        console.log('\n🔍 Verifying database schema...');
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relationship_evidence_tracking'").all();
        
        if (tables.length > 0) {
            console.log('✅ relationship_evidence_tracking table found');
        } else {
            console.error('❌ relationship_evidence_tracking table still missing');
            process.exit(1);
        }
        
        console.log('\n✅ Critical database fixes applied successfully!');
        
    } catch (error) {
        console.error('❌ Failed to apply database fixes:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the fixes
applyFixes();