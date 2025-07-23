const { spawn } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class ManualPipelineTest {
    constructor() {
        this.dbPath = path.join(__dirname, 'database.db');
        this.intervalHandle = null;
        this.startTime = Date.now();
    }

    async getStats() {
        return new Promise((resolve) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    resolve({ files: 0, pois: 0, relationships: 0, error: err.message });
                    return;
                }

                const stats = {};
                
                db.get("SELECT COUNT(*) as count FROM files", (err, row) => {
                    stats.files = err ? 0 : (row ? row.count : 0);
                    
                    db.get("SELECT COUNT(*) as count FROM pois", (err, row) => {
                        stats.pois = err ? 0 : (row ? row.count : 0);
                        
                        db.get("SELECT COUNT(*) as count FROM relationships", (err, row) => {
                            stats.relationships = err ? 0 : (row ? row.count : 0);
                            
                            db.close();
                            resolve(stats);
                        });
                    });
                });
            });
        });
    }

    async monitorProgress() {
        const stats = await this.getStats();
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;

        console.log(`\n📊 [${minutes}m ${seconds}s] Progress:`);
        console.log(`├─ Files: ${stats.files}`);
        console.log(`├─ POIs: ${stats.pois}`);
        console.log(`└─ Relationships: ${stats.relationships}`);
        
        if (elapsed > 0) {
            const filesPerMin = (stats.files / (elapsed / 60)).toFixed(2);
            const poisPerMin = (stats.pois / (elapsed / 60)).toFixed(2);
            console.log(`   Rates: ${filesPerMin} files/min, ${poisPerMin} POIs/min`);
        }
    }

    async runTest(target, timeoutMinutes) {
        console.log(`\n🚀 Testing pipeline: ${target}`);
        console.log(`⏰ Timeout: ${timeoutMinutes} minutes`);
        console.log(`${'='.repeat(50)}\n`);

        // Start monitoring
        this.intervalHandle = setInterval(() => {
            this.monitorProgress();
        }, 30000); // Every 30 seconds

        // Initial stats
        await this.monitorProgress();

        return new Promise((resolve) => {
            const process = spawn('node', ['src/main.js', '--target', target], {
                stdio: 'pipe',
                env: { ...process.env, NODE_ENV: 'production' }
            });

            let output = '';

            process.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                
                // Show important lines
                const lines = text.split('\n');
                lines.forEach(line => {
                    if (line.includes('Queue Monitor') || 
                        line.includes('completed') ||
                        line.includes('failed') ||
                        line.includes('error') ||
                        line.includes('ERROR')) {
                        console.log(`[PIPELINE] ${line.trim()}`);
                    }
                });
            });

            process.stderr.on('data', (data) => {
                console.error(`[ERROR] ${data.toString().trim()}`);
            });

            // Set timeout
            const timeout = setTimeout(() => {
                console.log(`\n⏰ Timeout reached after ${timeoutMinutes} minutes`);
                process.kill('SIGTERM');
            }, timeoutMinutes * 60 * 1000);

            process.on('close', async (code) => {
                clearTimeout(timeout);
                clearInterval(this.intervalHandle);
                
                // Final stats
                console.log('\n📋 FINAL RESULTS:');
                await this.monitorProgress();
                
                const duration = Math.floor((Date.now() - this.startTime) / 1000);
                console.log(`\nDuration: ${Math.floor(duration/60)}m ${duration%60}s`);
                console.log(`Exit code: ${code}`);
                
                resolve({
                    exitCode: code,
                    duration,
                    finalStats: await this.getStats(),
                    completed: code === 0
                });
            });
        });
    }

    async clearDatabase() {
        return new Promise((resolve) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.log('Database does not exist, will be created fresh');
                    resolve();
                    return;
                }

                // Clear all tables
                db.serialize(() => {
                    db.run("DELETE FROM relationships", () => {
                        db.run("DELETE FROM pois", () => {
                            db.run("DELETE FROM files", () => {
                                console.log('🗑️ Database cleared');
                                db.close();
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    }
}

async function main() {
    const tester = new ManualPipelineTest();
    
    try {
        // Test 1: Small JS test
        await tester.clearDatabase();
        console.log('\n🧪 TEST 1: Small JS files (4 files, 10 minute timeout)');
        const result1 = await tester.runTest('./polyglot-test/js', 10);
        
        console.log('\n📊 Test 1 Results:');
        console.log(`├─ Completed: ${result1.completed}`);
        console.log(`├─ Files processed: ${result1.finalStats.files}`);
        console.log(`├─ POIs discovered: ${result1.finalStats.pois}`);
        console.log(`└─ Relationships: ${result1.finalStats.relationships}`);
        
        if (result1.finalStats.files > 2) {
            // Test 2: Medium test if first succeeded reasonably
            await tester.clearDatabase();
            console.log('\n🧪 TEST 2: Java files (5 files, 15 minute timeout)');
            const result2 = await tester.runTest('./polyglot-test/java', 15);
            
            console.log('\n📊 Test 2 Results:');
            console.log(`├─ Completed: ${result2.completed}`);
            console.log(`├─ Files processed: ${result2.finalStats.files}`);
            console.log(`├─ POIs discovered: ${result2.finalStats.pois}`);
            console.log(`└─ Relationships: ${result2.finalStats.relationships}`);
        } else {
            console.log('\n⏭️ Skipping Test 2 - Test 1 processed insufficient files');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = ManualPipelineTest;