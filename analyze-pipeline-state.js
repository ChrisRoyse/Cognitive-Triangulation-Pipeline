#!/usr/bin/env node

const { getCacheClient } = require('./src/utils/cacheClient');
const { DatabaseManager } = require('./src/utils/sqliteDb');
const path = require('path');

async function analyzeRedisQueues() {
    const client = getCacheClient();
    const queueNames = [
        'fileAnalysis',
        'relationshipResolution', 
        'directoryResolution',
        'globalResolution',
        'graphBuilder',
        'validation',
        'reconciliation'
    ];
    
    console.log('\n=== REDIS QUEUE ANALYSIS ===\n');
    
    for (const queueName of queueNames) {
        const queueKey = `bull:${queueName}`;
        console.log(`\nQueue: ${queueName}`);
        console.log('-'.repeat(40));
        
        try {
            // Check different job states
            const waiting = await client.llen(`${queueKey}:wait`);
            const active = await client.llen(`${queueKey}:active`);
            const completed = await client.zcard(`${queueKey}:completed`);
            const failed = await client.zcard(`${queueKey}:failed`);
            const delayed = await client.zcard(`${queueKey}:delayed`);
            const paused = await client.llen(`${queueKey}:paused`);
            
            console.log(`  Waiting: ${waiting}`);
            console.log(`  Active: ${active}`);
            console.log(`  Completed: ${completed}`);
            console.log(`  Failed: ${failed}`);
            console.log(`  Delayed: ${delayed}`);
            console.log(`  Paused: ${paused}`);
            
            // Get failed job details if any
            if (failed > 0) {
                console.log('\n  Failed Jobs:');
                const failedJobs = await client.zrange(`${queueKey}:failed`, 0, 4);
                for (const jobId of failedJobs) {
                    const jobData = await client.hgetall(`${queueKey}:${jobId}`);
                    if (jobData.failedReason) {
                        console.log(`    Job ${jobId}: ${jobData.failedReason.substring(0, 100)}...`);
                    }
                }
            }
            
            // Get stuck active jobs (if any)
            if (active > 0) {
                console.log('\n  Active Jobs:');
                const activeJobs = await client.lrange(`${queueKey}:active`, 0, 4);
                for (const jobId of activeJobs) {
                    const jobData = await client.hgetall(`${queueKey}:${jobId}`);
                    if (jobData.timestamp) {
                        const age = Date.now() - parseInt(jobData.timestamp);
                        console.log(`    Job ${jobId}: Active for ${Math.floor(age / 1000)}s`);
                    }
                }
            }
        } catch (err) {
            console.log(`  Error checking queue: ${err.message}`);
        }
    }
}

async function analyzeSQLiteState() {
    const dbPath = path.join(__dirname, 'data', 'database.db');
    const dbManager = new DatabaseManager(dbPath);
    const db = dbManager.getDb();
    
    console.log('\n\n=== SQLITE DATABASE ANALYSIS ===\n');
    
    try {
        // Check outbox table
        console.log('\nOutbox Table (Pending Events):');
        console.log('-'.repeat(40));
        const pendingEvents = db.prepare(`
            SELECT event_type, COUNT(*) as count, MIN(created_at) as oldest
            FROM outbox
            WHERE status = 'PENDING'
            GROUP BY event_type
        `).all();
        
        if (pendingEvents.length === 0) {
            console.log('  No pending events in outbox');
        } else {
            for (const event of pendingEvents) {
                console.log(`  ${event.event_type}: ${event.count} pending (oldest: ${event.oldest})`);
            }
        }
        
        // Check POIs table
        console.log('\n\nPOIs Table Summary:');
        console.log('-'.repeat(40));
        const poisSummary = db.prepare(`
            SELECT type, COUNT(*) as count
            FROM pois
            GROUP BY type
            ORDER BY count DESC
            LIMIT 10
        `).all();
        
        for (const poi of poisSummary) {
            console.log(`  ${poi.type}: ${poi.count}`);
        }
        
        const totalPois = db.prepare('SELECT COUNT(*) as count FROM pois').get();
        console.log(`\n  Total POIs: ${totalPois.count}`);
        
        // Check relationships table
        console.log('\n\nRelationships Table Summary:');
        console.log('-'.repeat(40));
        const relsSummary = db.prepare(`
            SELECT type, COUNT(*) as count
            FROM relationships
            GROUP BY type
            ORDER BY count DESC
            LIMIT 10
        `).all();
        
        for (const rel of relsSummary) {
            console.log(`  ${rel.type}: ${rel.count}`);
        }
        
        const totalRels = db.prepare('SELECT COUNT(*) as count FROM relationships').get();
        console.log(`\n  Total Relationships: ${totalRels.count}`);
        
        // Check for orphaned relationships
        console.log('\n\nData Integrity Checks:');
        console.log('-'.repeat(40));
        const orphanedRels = db.prepare(`
            SELECT COUNT(*) as count
            FROM relationships r
            WHERE NOT EXISTS (SELECT 1 FROM pois WHERE id = r.source_poi_id)
               OR NOT EXISTS (SELECT 1 FROM pois WHERE id = r.target_poi_id)
        `).get();
        console.log(`  Orphaned relationships: ${orphanedRels.count}`);
        
        // Check for recent activity
        console.log('\n\nRecent Activity:');
        console.log('-'.repeat(40));
        // Check if created_at columns exist
        const poisColumns = db.prepare("PRAGMA table_info(pois)").all();
        const hasCreatedAt = poisColumns.some(col => col.name === 'created_at');
        
        if (hasCreatedAt) {
            const recentPois = db.prepare(`
                SELECT COUNT(*) as count, MAX(created_at) as latest
                FROM pois
                WHERE created_at > datetime('now', '-5 minutes')
            `).get();
            console.log(`  POIs created in last 5 min: ${recentPois.count} (latest: ${recentPois.latest})`);
            
            const recentRels = db.prepare(`
                SELECT COUNT(*) as count, MAX(created_at) as latest
                FROM relationships
                WHERE created_at > datetime('now', '-5 minutes')
            `).get();
            console.log(`  Relationships created in last 5 min: ${recentRels.count} (latest: ${recentRels.latest})`);
        } else {
            console.log('  No timestamp columns available for recent activity tracking');
        }
        
    } catch (err) {
        console.error('Error analyzing SQLite:', err);
    }
}

async function main() {
    try {
        await analyzeRedisQueues();
        await analyzeSQLiteState();
        
        // Close connections
        const client = getCacheClient();
        await client.quit();
        
        // Database already closed in analyzeSQLiteState
        
    } catch (err) {
        console.error('Error in analysis:', err);
        process.exit(1);
    }
}

main();