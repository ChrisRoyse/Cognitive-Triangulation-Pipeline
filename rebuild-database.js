#!/usr/bin/env node

const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');
require('dotenv').config();

async function rebuildDatabase() {
    console.log('🔧 Rebuilding database with latest schema...');
    
    const dbPath = path.join(process.cwd(), process.env.SQLITE_DB_PATH || './data/database.db');
    const dbManager = new DatabaseManager(dbPath);
    
    try {
        dbManager.rebuildDb();
        console.log('✅ Database rebuilt successfully');
        
        // Verify the relationship_evidence table has the correct schema
        const db = dbManager.getDb();
        const columns = db.pragma('table_info(relationship_evidence)');
        console.log('📊 relationship_evidence columns:', columns.map(col => col.name));
        
        dbManager.close();
    } catch (error) {
        console.error('❌ Error rebuilding database:', error);
    }
}

rebuildDatabase();