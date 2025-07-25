const { DatabaseManager } = require('./src/utils/sqliteDb');

async function testSingleRelationship() {
    const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
    const dbManager = new DatabaseManager(dbPath);
    
    try {
        const db = dbManager.getDb();
        
        // Get a sample evidence record
        const evidence = db.prepare('SELECT * FROM relationship_evidence LIMIT 1').get();
        const payload = JSON.parse(evidence.evidence_payload);
        
        console.log('=== Sample Evidence ===');
        console.log('From:', payload.from);
        console.log('To:', payload.to);
        console.log('Type:', payload.type);
        console.log('Run ID:', evidence.run_id);
        
        // Find the source and target POIs
        const sourcePoi = db.prepare('SELECT id, name FROM pois WHERE semantic_id = ? AND run_id = ?').get(payload.from, evidence.run_id);
        const targetPoi = db.prepare('SELECT id, name FROM pois WHERE semantic_id = ? AND run_id = ?').get(payload.to, evidence.run_id);
        
        console.log('\n=== POI Resolution ===');
        console.log('Source POI:', sourcePoi);
        console.log('Target POI:', targetPoi);
        
        if (sourcePoi && targetPoi) {
            // Insert the relationship
            const insertResult = db.prepare(`
                INSERT INTO relationships (source_poi_id, target_poi_id, type, file_path, status, confidence, reason, run_id)
                VALUES (?, ?, ?, '', 'PENDING', ?, ?, ?)
            `).run(
                sourcePoi.id,
                targetPoi.id,
                payload.type.toUpperCase(),
                payload.confidence || 0.8,
                payload.reason || (payload.type + ' relationship detected'),
                evidence.run_id
            );
            
            console.log('\n=== Relationship Created ===');
            console.log('Relationship ID:', insertResult.lastInsertRowid);
            
            // Update the evidence record
            db.prepare('UPDATE relationship_evidence SET relationship_id = ? WHERE id = ?').run(insertResult.lastInsertRowid, evidence.id);
            
            console.log('Evidence record linked to relationship');
            
            // Verify the relationship was created
            const createdRelationship = db.prepare('SELECT * FROM relationships WHERE id = ?').get(insertResult.lastInsertRowid);
            console.log('\n=== Verification ===');
            console.log('Created relationship:', createdRelationship);
            
        } else {
            console.log('\n❌ Could not resolve POI IDs');
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        dbManager.close();
    }
}

testSingleRelationship();