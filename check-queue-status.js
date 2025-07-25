const { Queue } = require('bullmq');
const redis = require('ioredis');

const redisClient = new redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null
});

async function checkQueues() {
  const queues = [
    'file-analysis-queue',
    'relationship-resolution-queue',
    'directory-resolution-queue',
    'triangulated-analysis-queue'
  ];
  
  for (const queueName of queues) {
    const queue = new Queue(queueName, { connection: redisClient });
    
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    const completed = await queue.getCompletedCount();
    const failed = await queue.getFailedCount();
    
    console.log(`\n${queueName}:`);
    console.log(`  Waiting: ${waiting}`);
    console.log(`  Active: ${active}`);
    console.log(`  Completed: ${completed}`);
    console.log(`  Failed: ${failed}`);
  }
  
  await redisClient.quit();
}

checkQueues().catch(console.error);