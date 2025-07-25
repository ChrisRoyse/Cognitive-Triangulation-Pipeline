const { getDb, initializeDb } = require('./src/utils/sqliteDb.js');

async function checkTables() {
  await initializeDb();
  const db = await getDb();
  
  console.log('=== Existing Tables ===');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  tables.forEach(table => console.log('- ' + table.name));
  
  console.log('\n=== Files Table Sample ===');
  const files = db.prepare('SELECT * FROM files LIMIT 5').all();
  files.forEach(file => {
    console.log(`- ${file.file_path} (status: ${file.status || 'N/A'})`);
  });
}

checkTables();