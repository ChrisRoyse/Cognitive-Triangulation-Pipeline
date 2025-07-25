const Database = require('better-sqlite3');
const db = new Database('data/database.db');

// Check relationships count
const relCount = db.prepare('SELECT COUNT(*) as count FROM agent_communication WHERE message_type = ?').get('relationships');
console.log('Total relationships stored:', relCount ? relCount.count : 0);

// Get recent relationships with confidence scores
const relationships = db.prepare(`
  SELECT ac.*, rs.confidence_score 
  FROM agent_communication ac
  LEFT JOIN relationship_scores rs ON ac.semantic_id = rs.semantic_id
  WHERE ac.message_type = 'relationships' 
  ORDER BY ac.created_at DESC 
  LIMIT 10
`).all();

console.log('\nRecent relationships with confidence scores:');
relationships.forEach(rel => {
  try {
    const data = JSON.parse(rel.data);
    if (data.relationships && data.relationships.length > 0) {
      console.log(`\nFile: ${rel.source_file}`);
      console.log(`Relationships: ${data.relationships.length}`);
      console.log(`Confidence: ${rel.confidence_score || 'Not calculated'}`);
      // Show first few relationships
      data.relationships.slice(0, 3).forEach(r => {
        console.log(`  - ${r.source} -> ${r.target} (${r.type})`);
      });
    }
  } catch (e) {
    console.log('Error parsing relationship:', e.message);
  }
});

// Check for low confidence relationships
const lowConfidence = db.prepare(`
  SELECT COUNT(*) as count 
  FROM relationship_scores 
  WHERE confidence_score < 0.45
`).get();

console.log(`\nLow confidence relationships (<0.45): ${lowConfidence.count}`);

// Check triangulation queue
const triangulated = db.prepare(`
  SELECT COUNT(*) as count 
  FROM triangulated_analysis_jobs
`).get();

console.log(`Triangulated analysis jobs: ${triangulated ? triangulated.count : 0}`);

db.close();