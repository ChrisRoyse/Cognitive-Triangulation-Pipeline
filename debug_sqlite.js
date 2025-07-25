#!/usr/bin/env node

/**
 * Debug SQLite Database State
 * Analyzes all tables and their data
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function debugSQLite() {
    console.log('=== SQLITE DATABASE ANALYSIS ===\n');
    
    const dbPath = path.join(__dirname, 'data', 'database.db');
    console.log(`Database path: ${dbPath}\n`);
    
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
                return;
            }
            
            console.log('✅ Connected to SQLite database\n');
            
            // Get all tables
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
                if (err) {
                    console.error('Error getting tables:', err.message);
                    reject(err);
                    return;
                }
                
                console.log(`Found ${tables.length} tables:\n`);
                
                let pendingQueries = 0;
                
                tables.forEach((table, index) => {
                    const tableName = table.name;
                    console.log(`=== TABLE: ${tableName.toUpperCase()} ===`);
                    
                    // Get table schema
                    pendingQueries++;
                    db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                        if (err) {
                            console.error(`Error getting schema for ${tableName}:`, err.message);
                        } else {
                            console.log('Schema:');
                            columns.forEach(col => {
                                console.log(`  ${col.name} (${col.type}${col.notnull ? ', NOT NULL' : ''}${col.pk ? ', PRIMARY KEY' : ''})`);
                            });
                        }
                        
                        // Get row count and sample data
                        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, countResult) => {
                            if (err) {
                                console.error(`Error counting rows in ${tableName}:`, err.message);
                            } else {
                                console.log(`Row count: ${countResult.count}`);
                                
                                if (countResult.count > 0) {
                                    // Get sample rows
                                    db.all(`SELECT * FROM ${tableName} LIMIT 3`, (err, rows) => {
                                        if (err) {
                                            console.error(`Error getting sample data from ${tableName}:`, err.message);
                                        } else if (rows.length > 0) {
                                            console.log('Sample data:');
                                            rows.forEach((row, i) => {
                                                console.log(`  Row ${i + 1}:`, JSON.stringify(row, null, 2));
                                            });
                                        }
                                        
                                        pendingQueries--;
                                        if (pendingQueries === 0) {
                                            console.log('\n=== ANALYSIS COMPLETE ===');
                                            db.close((err) => {
                                                if (err) {
                                                    console.error('Error closing database:', err.message);
                                                } else {
                                                    console.log('Database connection closed.');
                                                }
                                                resolve();
                                            });
                                        }
                                    });
                                } else {
                                    pendingQueries--;
                                    if (pendingQueries === 0) {
                                        console.log('\n=== ANALYSIS COMPLETE ===');
                                        db.close((err) => {
                                            if (err) {
                                                console.error('Error closing database:', err.message);
                                            } else {
                                                console.log('Database connection closed.');
                                            }
                                            resolve();
                                        });
                                    }
                                }
                            }
                            console.log('');
                        });
                    });
                });
                
                if (tables.length === 0) {
                    console.log('No tables found in database.');
                    db.close();
                    resolve();
                }
            });
        });
    });
}

debugSQLite().catch(console.error);