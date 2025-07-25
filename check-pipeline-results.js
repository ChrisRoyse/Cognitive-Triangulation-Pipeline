const Database = require('better-sqlite3');
const db = new Database('data/database.db');

console.log('=== PIPELINE RELATIONSHIP DETECTION REPORT ===\n');

// 1. Check relationships
const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
console.log(`1. Total relationships detected: ${relCount.count}`);

// 2. Check confidence scores
const confCount = db.prepare('SELECT COUNT(*) as count FROM relationship_confidence_scores').get();
console.log(`2. Relationships with confidence scores: ${confCount.count}`);

// 3. Get confidence distribution
const confDist = db.prepare(`
  SELECT 
    CASE 
      WHEN confidence_score >= 0.8 THEN 'High (>=0.8)'
      WHEN confidence_score >= 0.6 THEN 'Medium (0.6-0.8)'
      WHEN confidence_score >= 0.45 THEN 'Low (0.45-0.6)'
      ELSE 'Very Low (<0.45)'
    END as category,
    COUNT(*) as count
  FROM relationship_confidence_scores
  GROUP BY category
`).all();

console.log('\n3. Confidence score distribution:');
confDist.forEach(d => {
  console.log(`   ${d.category}: ${d.count}`);
});

// 4. Check batch processing
const fileJobCount = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM pois 
  GROUP BY status
`).all();

console.log('\n4. POI processing status:');
fileJobCount.forEach(s => {
  console.log(`   ${s.status || 'pending'}: ${s.count}`);
});

// 5. Check triangulated analysis
const triangCount = db.prepare('SELECT COUNT(*) as count FROM triangulated_analysis_sessions').get();
console.log(`\n5. Triangulated analysis sessions: ${triangCount.count}`);

if (triangCount.count > 0) {
  const triangSessions = db.prepare(`
    SELECT relationship_id, agent_type, status 
    FROM triangulated_analysis_sessions 
    ORDER BY created_at DESC 
    LIMIT 5
  `).all();
  
  console.log('   Recent triangulated analyses:');
  triangSessions.forEach(t => {
    console.log(`   - Relationship ${t.relationship_id}: ${t.agent_type} (${t.status})`);
  });
}

// 6. Sample relationships with details
console.log('\n6. Sample detected relationships:');
const sampleRels = db.prepare(`
  SELECT 
    r.source_poi_id,
    r.target_poi_id,
    r.relationship_type,
    rcs.confidence_score,
    rcs.confidence_components
  FROM relationships r
  LEFT JOIN relationship_confidence_scores rcs ON r.id = rcs.relationship_id
  WHERE r.source_poi_id IS NOT NULL
  ORDER BY r.created_at DESC
  LIMIT 5
`).all();

sampleRels.forEach(r => {
  console.log(`   - ${r.source_poi_id} -> ${r.target_poi_id}`);
  console.log(`     Type: ${r.relationship_type}, Confidence: ${r.confidence_score || 'Not calculated'}`);
  if (r.confidence_components) {
    try {
      const components = JSON.parse(r.confidence_components);
      console.log(`     Components: Syntax=${components.syntax}, Semantic=${components.semantic}, Context=${components.context}`);
    } catch (e) {}
  }
});

db.close();

console.log('\n=== END REPORT ===');