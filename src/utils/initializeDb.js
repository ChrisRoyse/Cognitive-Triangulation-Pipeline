#!/usr/bin/env node

const { DatabaseManager } = require('./sqliteDb');
const path = require('path');

async function initializeDatabase() {
    console.log('🚀 Initializing database...');
    
    try {
        const dbPath = process.env.SQLITE_DB_PATH || './database.db';
        console.log(`📍 Database path: ${dbPath}`);
        
        const dbManager = new DatabaseManager(dbPath);
        await dbManager.initializeDb();
        
        console.log('✅ Database initialized successfully!');
        console.log('📊 Tables created: files, pois, relationships, directory_summaries, relationship_evidence, outbox');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        process.exit(1);
    }
}

// Only run if this file is executed directly
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase };