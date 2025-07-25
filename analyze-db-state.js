const { getDb, initializeDb } = require('./src/utils/sqliteDb.js');

async function analyzeDatabaseState() {
  console.log('=== SQLite Database Analysis ===');
  
  try {
    await initializeDb();
    const db = await getDb();
    
    // Get table counts
    console.log('\n📊 Table Record Counts:');
    const tables = ['files', 'points_of_interest', 'relationships', 'analysis_results', 'outbox_events'];
    
    for (const table of tables) {
      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        console.log(`${table}: ${result.count} records`);
      } catch (e) {
        console.log(`${table}: Error - ${e.message}`);
      }
    }
    
    // Recent analysis results
    console.log('\n🔍 Recent Analysis Results:');
    const recentAnalysis = db.prepare(`
      SELECT file_path, status, created_at, error_message 
      FROM analysis_results 
      ORDER BY created_at DESC 
      LIMIT 10
    `).all();
    
    recentAnalysis.forEach(row => {
      console.log(`- ${row.file_path}: ${row.status} (${row.created_at})`);
      if (row.error_message) console.log(`  Error: ${row.error_message}`);
    });
    
    // Points of interest summary
    console.log('\n🎯 Points of Interest by Type:');
    const poiTypes = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM points_of_interest 
      GROUP BY type 
      ORDER BY count DESC
    `).all();
    
    poiTypes.forEach(row => {
      console.log(`- ${row.type}: ${row.count}`);
    });
    
    // Relationships summary
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
    
    // Outbox events status
    console.log('\n📮 Outbox Events Status:');
    const outboxStatus = db.prepare(`
      SELECT event_type, status, COUNT(*) as count 
      FROM outbox_events 
      GROUP BY event_type, status 
      ORDER BY event_type, status
    `).all();
    
    outboxStatus.forEach(row => {
      console.log(`- ${row.event_type} (${row.status}): ${row.count}`);
    });
    
  } catch (error) {
    console.error('Error analyzing database:', error.message);
  }
}

analyzeDatabaseState();