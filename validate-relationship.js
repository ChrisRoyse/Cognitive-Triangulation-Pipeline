// Validate relationship manually to trigger GraphBuilder

const { DatabaseManager } = require('./src/utils/sqliteDb');

async function validateRelationship() {
    const dbManager = new DatabaseManager('./data/database.db');
    await dbManager.initializeDb();
    const db = dbManager.getDb();
    
    console.log('📝 Creating relationship evidence to trigger validation...');
    
    // Get the relationship
    const relationship = db.prepare("SELECT * FROM relationships WHERE status = 'PENDING'").get();
    if (!relationship) {
        console.log('❌ No pending relationships found');
        return;
    }
    
    console.log('Found relationship:', relationship.id, relationship.type);
    
    // Create evidence for this relationship
    const evidenceHash = 'evidence-' + Date.now();
    db.prepare(`
        INSERT INTO relationship_evidence (relationship_id, relationship_hash, evidence_payload, run_id)
        VALUES (?, ?, ?, ?)
    `).run(
        relationship.id,
        evidenceHash,
        JSON.stringify({
            type: 'direct_reference',
            content: 'Manual evidence for validation',
            confidence: 0.9
        }),
        'manual-validation'
    );
    
    console.log('✅ Created relationship evidence');
    
    // Now manually validate the relationship
    console.log('🔍 Validating relationship...');
    
    const updateResult = db.prepare(`
        UPDATE relationships 
        SET status = 'VALIDATED', confidence_score = ?
        WHERE id = ?
    `).run(0.9, relationship.id);
    
    console.log('✅ Relationship validated:', updateResult.changes, 'rows updated');
    
    // Check final state
    const validated = db.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get();
    console.log('Validated relationships:', validated.count);
    
    dbManager.close();
}

validateRelationship().catch(console.error);