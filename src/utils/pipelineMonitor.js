const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PipelineMonitor {
    constructor(dbPath) {
        this.dbPath = dbPath || path.join(process.cwd(), 'codebase_analysis.db');
        this.startTime = Date.now();
        this.lastStats = {
            files: 0,
            pois: 0,
            relationships: 0,
            queues: {}
        };
    }

    async getStats() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    resolve(this.lastStats); // Return last known stats if DB not ready
                    return;
                }

                const stats = {
                    files: 0,
                    pois: 0,
                    relationships: 0,
                    queues: {}
                };

                // Count files
                db.get("SELECT COUNT(*) as count FROM files", (err, row) => {
                    if (!err && row) stats.files = row.count;

                    // Count POIs
                    db.get("SELECT COUNT(*) as count FROM pois", (err, row) => {
                        if (!err && row) stats.pois = row.count;

                        // Count relationships
                        db.get("SELECT COUNT(*) as count FROM relationships", (err, row) => {
                            if (!err && row) stats.relationships = row.count;

                            // Get queue stats
                            db.all(`
                                SELECT queue_name, status, COUNT(*) as count 
                                FROM queue_jobs 
                                GROUP BY queue_name, status
                            `, (err, rows) => {
                                if (!err && rows) {
                                    rows.forEach(row => {
                                        if (!stats.queues[row.queue_name]) {
                                            stats.queues[row.queue_name] = {
                                                pending: 0,
                                                active: 0,
                                                completed: 0,
                                                failed: 0
                                            };
                                        }
                                        stats.queues[row.queue_name][row.status] = row.count;
                                    });
                                }

                                db.close();
                                this.lastStats = stats;
                                resolve(stats);
                            });
                        });
                    });
                });
            });
        });
    }

    async monitor(intervalSeconds = 30) {
        console.log(`\n🔍 Pipeline Monitor Started - Checking every ${intervalSeconds} seconds\n`);
        
        const monitorLoop = async () => {
            const stats = await this.getStats();
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            
            console.log(`\n📊 [${minutes}m ${seconds}s] Pipeline Status:`);
            console.log(`├─ Database Population:`);
            console.log(`│  ├─ Files: ${stats.files}`);
            console.log(`│  ├─ POIs: ${stats.pois}`);
            console.log(`│  └─ Relationships: ${stats.relationships}`);
            
            if (Object.keys(stats.queues).length > 0) {
                console.log(`├─ Queue Status:`);
                Object.entries(stats.queues).forEach(([queue, counts]) => {
                    const total = counts.pending + counts.active + counts.completed + counts.failed;
                    const completionRate = total > 0 ? ((counts.completed / total) * 100).toFixed(1) : 0;
                    console.log(`│  ├─ ${queue}:`);
                    console.log(`│  │  ├─ Pending: ${counts.pending}`);
                    console.log(`│  │  ├─ Active: ${counts.active}`);
                    console.log(`│  │  ├─ Completed: ${counts.completed}`);
                    console.log(`│  │  ├─ Failed: ${counts.failed}`);
                    console.log(`│  │  └─ Completion Rate: ${completionRate}%`);
                });
            }
            
            // Calculate rates
            if (elapsed > 0) {
                const filesPerMinute = (stats.files / (elapsed / 60)).toFixed(2);
                const poisPerMinute = (stats.pois / (elapsed / 60)).toFixed(2);
                console.log(`└─ Processing Rates:`);
                console.log(`   ├─ Files/minute: ${filesPerMinute}`);
                console.log(`   └─ POIs/minute: ${poisPerMinute}`);
            }
            
            console.log(`${'─'.repeat(60)}`);
        };
        
        // Initial check
        await monitorLoop();
        
        // Set up interval
        this.interval = setInterval(monitorLoop, intervalSeconds * 1000);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Monitor stopped');
            clearInterval(this.interval);
            process.exit(0);
        });
    }
}

// Run standalone if executed directly
if (require.main === module) {
    const monitor = new PipelineMonitor();
    const interval = parseInt(process.argv[2]) || 30;
    monitor.monitor(interval);
}

module.exports = PipelineMonitor;