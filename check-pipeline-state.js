const { getDb, initializeDb } = require('./src/utils/sqliteDb.js');

async function checkPipelineState() {
  await initializeDb();
  const db = await getDb();
  
  console.log('=== Pipeline State Analysis ===');
  
  // Table counts
  console.log('\n📊 Record Counts:');
  const tableQueries = {
    'files': 'SELECT COUNT(*) as count FROM files',
    'pois': 'SELECT COUNT(*) as count FROM pois', 
    'relationships': 'SELECT COUNT(*) as count FROM relationships',
    'directory_summaries': 'SELECT COUNT(*) as count FROM directory_summaries',
    'outbox': 'SELECT COUNT(*) as count FROM outbox',
    'subagent_analyses': 'SELECT COUNT(*) as count FROM subagent_analyses',
    'relationship_confidence_scores': 'SELECT COUNT(*) as count FROM relationship_confidence_scores'
  };
  
  for (const [table, query] of Object.entries(tableQueries)) {
    try {
      const result = db.prepare(query).get();
      console.log(`${table}: ${result.count} records`);
    } catch (e) {
      console.log(`${table}: Error - ${e.message}`);
    }
  }
  
  // File processing status
  console.log('\n📁 File Processing Status:');
  const fileStatus = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM files 
    GROUP BY status 
    ORDER BY count DESC
  `).all();
  
  fileStatus.forEach(row => {
    console.log(`- ${row.status}: ${row.count} files`);
  });
  
  // POI types
  console.log('\n🎯 Points of Interest by Type:');
  const poiTypes = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM pois 
    GROUP BY type 
    ORDER BY count DESC
  `).all();
  
  poiTypes.forEach(row => {
    console.log(`- ${row.type}: ${row.count}`);
  });
  
  // Relationship types
  console.log('\n🔗 Relationships by Type:');
  const relTypes = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM relationships 
    GROUP BY type 
    ORDER BY count DESC
  `).all();
  
  relTypes.forEach(row => {
    console.log(`- ${row.type}: ${row.count}`);
  });
  
  // Outbox events
  console.log('\n📮 Outbox Events:');
  const outboxEvents = db.prepare(`
    SELECT event_type, status, COUNT(*) as count 
    FROM outbox 
    GROUP BY event_type, status 
    ORDER BY event_type, status
  `).all();
  
  outboxEvents.forEach(row => {
    console.log(`- ${row.event_type} (${row.status}): ${row.count}`);
  });
  
  // Recent activity
  console.log('\n🕒 Recent Activity:');
  const recentFiles = db.prepare(`
    SELECT file_path, status, updated_at 
    FROM files 
    WHERE updated_at IS NOT NULL
    ORDER BY updated_at DESC 
    LIMIT 10
  `).all();
  
  recentFiles.forEach(row => {
    console.log(`- ${row.file_path}: ${row.status} (${row.updated_at})`);
  });
}

checkPipelineState();