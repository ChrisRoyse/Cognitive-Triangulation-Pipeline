const fs = require('fs-extra');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

function createDb() {
    const dbPath = path.join(__dirname, `${uuidv4()}.sqlite`);
    const db = new Database(dbPath);
    const schema = fs.readFileSync(path.join(__dirname, '../src/utils/schema.sql'), 'utf-8');
    db.exec(schema);
    return { db, dbPath };
}

function seedData(db, { files, pois, relationships }) {
    if (files) {
        // Map file IDs for relationship tests that expect custom IDs
        const fileIdMap = new Map();
        
        const insert = db.prepare('INSERT INTO files (file_path, hash) VALUES (?, ?)');
        db.transaction(() => {
            files.forEach(f => {
                // Support both 'file_path' and 'path' for backward compatibility with existing tests
                const filePath = f.file_path || f.path;
                if (!filePath) {
                    throw new Error('File must have either file_path or path property');
                }
                // Support both 'hash' and 'checksum' for backward compatibility
                const hash = f.hash || f.checksum || 'default_hash';
                const result = insert.run(filePath, hash);
                if (f.id) {
                    fileIdMap.set(f.id, result.lastInsertRowid);
                }
            });
        })();
        
        // Store file ID mapping for POI insertion
        files._fileIdMap = fileIdMap;
    }
    if (pois) {
        // Use file ID mapping if available
        const fileIdMap = files?._fileIdMap || new Map();
        
        const insert = db.prepare('INSERT INTO pois (file_id, file_path, name, type, start_line, end_line, description, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        db.transaction(() => {
            pois.forEach(p => {
                const actualFileId = fileIdMap.get(p.file_id) || p.file_id;
                const filePath = p.file_path || 'default_file.js';
                insert.run(
                    actualFileId, 
                    filePath,
                    p.name, 
                    p.type, 
                    p.start_line || 1, 
                    p.end_line || p.start_line || 1, 
                    p.description || 'Default description', 
                    p.is_exported ? 1 : 0
                );
            });
        })();
    }
    if (relationships) {
        const insert = db.prepare('INSERT INTO relationships (source_poi_id, target_poi_id, type, confidence, reason) VALUES (?, ?, ?, ?, ?)');
        db.transaction(() => {
            relationships.forEach(r => insert.run(r.source_poi_id, r.target_poi_id, r.type, r.confidence || 0.8, r.reason));
        })();
    }
}

function cleanup(db, dbPath) {
    if (db) {
        db.close();
    }
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
    }
}

const neo4j = require('neo4j-driver');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function getDriver() {
    return neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    );
}

module.exports = { createDb, seedData, cleanup, getDriver };