const { DatabaseManager } = require('./src/utils/sqliteDb');
const crypto = require('crypto');

async function createMissingRelationships() {
    console.log('🔧 Creating missing relationships from existing evidence...');
    
    const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
    const dbManager = new DatabaseManager(dbPath);
    
    try {
        const db = dbManager.getDb();
        
        // Get all evidence records
        const evidenceRecords = db.prepare(`
            SELECT id, relationship_hash, evidence_payload, run_id
            FROM relationship_evidence 
            WHERE relationship_id IS NULL
        `).all();
        
        console.log(`Found ${evidenceRecords.length} evidence records without relationships`);
        
        const relationshipsByHash = {};
        
        // Group evidence by relationship hash and extract relationship data
        for (const evidence of evidenceRecords) {
            const payload = JSON.parse(evidence.evidence_payload);
            const hash = evidence.relationship_hash;
            
            if (!relationshipsByHash[hash]) {
                relationshipsByHash[hash] = {
                    hash: hash,
                    runId: evidence.run_id,
                    from: payload.from,
                    to: payload.to,
                    type: payload.type,
                    confidence: payload.confidence || 0.8,
                    reason: payload.reason || `${payload.type} relationship detected`,
                    evidenceIds: []
                };
            }
            
            relationshipsByHash[hash].evidenceIds.push(evidence.id);
        }
        
        console.log(`Found ${Object.keys(relationshipsByHash).length} unique relationships to create`);
        
        // Create relationships and link evidence
        let createdCount = 0;
        let linkedCount = 0;
        
        const insertRelationship = db.prepare(`
            INSERT INTO relationships (source_poi_id, target_poi_id, type, file_path, status, confidence, reason, run_id)
            VALUES (?, ?, ?, '', 'PENDING', ?, ?, ?)
        `);
        
        const updateEvidence = db.prepare(`
            UPDATE relationship_evidence 
            SET relationship_id = ? 
            WHERE id = ?
        `);
        
        const transaction = db.transaction(() => {
            for (const [hash, rel] of Object.entries(relationshipsByHash)) {
                try {
                    // Find source and target POI IDs
                    let sourcePoi = db.prepare('SELECT id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(rel.from, rel.runId);
                    if (!sourcePoi) {
                        sourcePoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(rel.from, rel.runId);
                    }
                    
                    let targetPoi = db.prepare('SELECT id FROM pois WHERE semantic_id = ? AND run_id = ? LIMIT 1').get(rel.to, rel.runId);
                    if (!targetPoi) {
                        targetPoi = db.prepare('SELECT id FROM pois WHERE name = ? AND run_id = ? LIMIT 1').get(rel.to, rel.runId);
                    }
                    
                    if (sourcePoi && targetPoi) {
                        // Create relationship
                        const result = insertRelationship.run(
                            sourcePoi.id,
                            targetPoi.id,
                            rel.type.toUpperCase(),
                            rel.confidence,
                            rel.reason,
                            rel.runId
                        );
                        
                        const relationshipId = result.lastInsertRowid;
                        createdCount++;
                        
                        // Link evidence records to this relationship
                        for (const evidenceId of rel.evidenceIds) {
                            updateEvidence.run(relationshipId, evidenceId);
                            linkedCount++;
                        }
                        
                        console.log(`✅ Created relationship ${rel.from} -> ${rel.to} (ID: ${relationshipId}) with ${rel.evidenceIds.length} evidence records`);
                    } else {
                        console.warn(`⚠️  Could not resolve POI IDs for relationship ${rel.from} -> ${rel.to}`);
                        if (!sourcePoi) console.warn(`   Source POI '${rel.from}' not found`);
                        if (!targetPoi) console.warn(`   Target POI '${rel.to}' not found`);
                    }
                } catch (error) {
                    console.error(`❌ Error creating relationship ${rel.from} -> ${rel.to}:`, error.message);
                }
            }
        });
        
        transaction();
        
        console.log(`✅ Created ${createdCount} relationships and linked ${linkedCount} evidence records`);
        
        // Check final state
        const finalCounts = db.prepare(`
            SELECT 
                (SELECT COUNT(*) FROM relationships) as total_relationships,
                (SELECT COUNT(*) FROM relationships WHERE status = 'PENDING') as pending_relationships,
                (SELECT COUNT(*) FROM relationship_evidence WHERE relationship_id IS NOT NULL) as linked_evidence
        `).get();
        
        console.log('\\n=== Final State ===');
        console.log('Total relationships:', finalCounts.total_relationships);
        console.log('Pending relationships:', finalCounts.pending_relationships);
        console.log('Linked evidence records:', finalCounts.linked_evidence);
        
        console.log('🎉 Missing relationships created successfully!');
        
    } catch (error) {
        console.error('❌ Error creating missing relationships:', error);
    } finally {
        dbManager.close();
        process.exit(0);
    }
}

createMissingRelationships();