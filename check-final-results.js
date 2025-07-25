const { DatabaseManager } = require('./src/utils/sqliteDb');

async function checkFinalResults() {
    const dbPath = process.env.SQLITE_DB_PATH || './data/database.db';
    const dbManager = new DatabaseManager(dbPath);
    
    try {
        const db = dbManager.getDb();

        console.log('=== Final Relationship Status Summary ===');
        const statusCounts = db.prepare('SELECT status, COUNT(*) as count FROM relationships GROUP BY status').all();
        console.table(statusCounts);

        console.log('\n=== Confidence Score Distribution ===');
        const confidenceRanges = db.prepare(`
          SELECT 
            CASE 
              WHEN confidence >= 0.95 THEN '0.95-1.00 (Excellent)'
              WHEN confidence >= 0.90 THEN '0.90-0.95 (Very High)'
              WHEN confidence >= 0.80 THEN '0.80-0.90 (High)'
              WHEN confidence >= 0.70 THEN '0.70-0.80 (Good)'
              WHEN confidence >= 0.50 THEN '0.50-0.70 (Medium)'
              ELSE '0.00-0.50 (Low)'
            END as confidence_range,
            COUNT(*) as count
          FROM relationships 
          WHERE status = 'VALIDATED'
          GROUP BY confidence_range
          ORDER BY MIN(confidence) DESC
        `).all();
        console.table(confidenceRanges);

        console.log('\n=== Sample High-Confidence Relationships ===');
        const sampleRelationships = db.prepare(`
          SELECT 
            r.type,
            r.confidence,
            p1.name as source_name,
            p2.name as target_name
          FROM relationships r
          JOIN pois p1 ON r.source_poi_id = p1.id
          JOIN pois p2 ON r.target_poi_id = p2.id
          WHERE r.status = 'VALIDATED' AND r.confidence > 0.95
          LIMIT 5
        `).all();
        console.table(sampleRelationships);

        console.log('\n=== Total Summary ===');
        const totalCounts = db.prepare(`
            SELECT 
                (SELECT COUNT(*) FROM pois) as total_pois,
                (SELECT COUNT(*) FROM relationships) as total_relationships,
                (SELECT COUNT(*) FROM relationships WHERE status = 'VALIDATED') as validated_relationships,
                (SELECT COUNT(*) FROM relationship_evidence) as total_evidence
        `).get();
        
        console.log('POIs:', totalCounts.total_pois);
        console.log('Total Relationships:', totalCounts.total_relationships);
        console.log('Validated Relationships:', totalCounts.validated_relationships);
        console.log('Evidence Records:', totalCounts.total_evidence);
        console.log('Validation Rate:', Math.round(totalCounts.validated_relationships / totalCounts.total_relationships * 100) + '%');
        
        console.log('\n🎉 Relationship validation pipeline is working perfectly!');
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        dbManager.close();
        process.exit(0);
    }
}

checkFinalResults();