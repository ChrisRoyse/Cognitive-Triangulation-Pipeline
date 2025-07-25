#!/usr/bin/env node

/**
 * Debug Script - Relationship Resolution Queue Investigation
 * 
 * This script investigates why relationship resolution jobs are not being created or processed.
 * It checks Redis queues, TransactionalOutboxPublisher behavior, and worker status.
 */

const IORedis = require('ioredis');
const config = require('./config/index.js');
const { getCacheClient } = require('./src/utils/cacheClient');

async function debugRelationshipQueues() {
    console.log('=== RELATIONSHIP RESOLUTION QUEUE DEBUG ===\n');
    
    const redis = new IORedis(config.REDIS_URL);
    
    try {
        // 1. Check Redis connection
        console.log('1. REDIS CONNECTION TEST');
        await redis.ping();
        console.log('✅ Redis connection successful\n');
        
        // 2. Check queue lengths
        console.log('2. QUEUE STATUS');
        const queueNames = config.QUEUE_NAMES || [];
        for (const queueName of queueNames) {
            const length = await redis.llen(queueName);
            const waiting = await redis.llen(`bull:${queueName}:waiting`);
            const active = await redis.llen(`bull:${queueName}:active`);
            const completed = await redis.llen(`bull:${queueName}:completed`);
            const failed = await redis.llen(`bull:${queueName}:failed`);
            
            console.log(`${queueName}:`);
            console.log(`  - Queue length: ${length}`);
            console.log(`  - Waiting: ${waiting}`);
            console.log(`  - Active: ${active}`);
            console.log(`  - Completed: ${completed}`);
            console.log(`  - Failed: ${failed}`);
            console.log('');
        }
        
        // 3. Check specific relationship resolution queue details
        console.log('3. RELATIONSHIP RESOLUTION QUEUE DETAILS');
        const relQueueName = 'relationship-resolution-queue';
        const relWaiting = await redis.lrange(`bull:${relQueueName}:waiting`, 0, -1);
        const relCompleted = await redis.lrange(`bull:${relQueueName}:completed`, 0, 4); // Get last 5
        const relFailed = await redis.lrange(`bull:${relQueueName}:failed`, 0, 4); // Get last 5
        
        console.log(`Waiting jobs in ${relQueueName}: ${relWaiting.length}`);
        if (relWaiting.length > 0) {
            console.log('Sample waiting job IDs:', relWaiting.slice(0, 3));
        }
        
        console.log(`Recent completed jobs: ${relCompleted.length}`);
        if (relCompleted.length > 0) {
            console.log('Recent completed job IDs:', relCompleted);
        }
        
        console.log(`Recent failed jobs: ${relFailed.length}`);
        if (relFailed.length > 0) {
            console.log('Recent failed job IDs:', relFailed);
        }
        console.log('');
        
        // 4. Check outbox events
        console.log('4. OUTBOX EVENTS CHECK');
        const { sqliteDb } = require('./src/utils/sqliteDb');
        const db = sqliteDb.getDb();
        
        const totalEvents = db.prepare('SELECT COUNT(*) as count FROM outbox_events').get().count;
        const poiEvents = db.prepare('SELECT COUNT(*) as count FROM outbox_events WHERE event_type = ?').get('file-analysis-finding').count;
        const publishedEvents = db.prepare('SELECT COUNT(*) as count FROM outbox_events WHERE status = ?').get('PUBLISHED').count;
        const pendingEvents = db.prepare('SELECT COUNT(*) as count FROM outbox_events WHERE status = ?').get('PENDING').count;
        
        console.log(`Total outbox events: ${totalEvents}`);
        console.log(`POI events (file-analysis-finding): ${poiEvents}`);
        console.log(`Published events: ${publishedEvents}`);
        console.log(`Pending events: ${pendingEvents}`);
        
        // Get sample pending events
        const samplePending = db.prepare('SELECT id, event_type, created_at FROM outbox_events WHERE status = ? LIMIT 5').all('PENDING');
        if (samplePending.length > 0) {
            console.log('\nSample pending events:');
            samplePending.forEach(event => {
                console.log(`  - ID: ${event.id}, Type: ${event.event_type}, Created: ${event.created_at}`);
            });
        }
        console.log('');
        
        // 5. Check POIs
        console.log('5. POI DATA CHECK');
        const totalPois = db.prepare('SELECT COUNT(*) as count FROM pois').get().count;
        const recentPois = db.prepare('SELECT COUNT(*) as count FROM pois WHERE created_at > datetime("now", "-1 hour")').get().count;
        
        console.log(`Total POIs in database: ${totalPois}`);
        console.log(`POIs created in last hour: ${recentPois}`);
        
        // Get sample POIs to see what data we have
        const samplePois = db.prepare('SELECT id, name, type, file_path FROM pois ORDER BY created_at DESC LIMIT 5').all();
        if (samplePois.length > 0) {
            console.log('\nSample recent POIs:');
            samplePois.forEach(poi => {
                console.log(`  - ID: ${poi.id}, Name: ${poi.name}, Type: ${poi.type}, File: ${poi.file_path}`);
            });
        }
        console.log('');
        
        // 6. Check relationships
        console.log('6. RELATIONSHIPS CHECK');
        const totalRelationships = db.prepare('SELECT COUNT(*) as count FROM relationships').get().count;
        console.log(`Total relationships in database: ${totalRelationships}`);
        
        if (totalRelationships === 0) {
            console.log('❌ NO RELATIONSHIPS FOUND - This confirms the issue!');
        } else {
            const sampleRels = db.prepare('SELECT source_poi_id, target_poi_id, relationship_type FROM relationships LIMIT 5').all();
            console.log('Sample relationships:');
            sampleRels.forEach(rel => {
                console.log(`  - ${rel.source_poi_id} -> ${rel.target_poi_id} (${rel.relationship_type})`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error during debug:', error.message);
        console.error(error.stack);
    } finally {
        await redis.quit();
    }
}

// Run the debug
debugRelationshipQueues().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});