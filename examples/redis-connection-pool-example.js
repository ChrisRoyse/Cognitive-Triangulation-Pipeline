/**
 * Redis Connection Pool Example
 * Demonstrates how to use the enhanced QueueManager with connection pooling
 * for high-concurrency workloads (100 total workers distributed across 7 types)
 */

const { getInstance } = require('../src/utils/queueManager.js');

async function demonstrateConnectionPooling() {
  console.log('🔗 Redis Connection Pool Example - High Concurrency Support\n');

  const queueManager = getInstance();
  
  try {
    // Initialize the primary connection
    await queueManager.connect();
    console.log('✅ QueueManager primary connection established');

    // Get initial pool statistics
    console.log('\n📊 Initial Connection Pool Stats:');
    console.log(JSON.stringify(queueManager.getConnectionPoolStats(), null, 2));

    // Simulate creating multiple workers (representing the 100 total worker scenario)
    console.log('\n🔧 Creating multiple workers to demonstrate pool usage...');
    
    const workers = [];
    const queues = ['file-analysis', 'relationship-resolution', 'directory-resolution'];
    
    // Create workers for each queue type (simulating high concurrency)
    for (const queueName of queues) {
      console.log(`Creating workers for ${queueName} queue...`);
      
      for (let i = 0; i < 5; i++) { // Create 5 workers per queue for demonstration
        const worker = await queueManager.createWorker(
          queueName, 
          async (job) => {
            // Simulate work
            await new Promise(resolve => setTimeout(resolve, 100));
            return { processed: job.id, worker: `${queueName}-${i}` };
          },
          { 
            concurrency: 10,
            removeOnComplete: 10,
            removeOnFail: 5
          }
        );
        
        workers.push(worker);
        console.log(`  ✅ Created worker ${i + 1} for ${queueName}`);
      }
    }

    // Show pool statistics after worker creation
    console.log('\n📊 Pool Stats After Worker Creation:');
    console.log(JSON.stringify(queueManager.getConnectionPoolStats(), null, 2));

    // Demonstrate health checking
    console.log('\n🩺 Performing connection health check...');
    const healthResult = await queueManager.performConnectionHealthCheck();
    console.log('Health check result:', JSON.stringify(healthResult, null, 2));

    // Add some jobs to demonstrate the system working
    console.log('\n📝 Adding test jobs to queues...');
    for (const queueName of queues) {
      const queue = queueManager.getQueue(queueName);
      
      for (let i = 0; i < 3; i++) {
        await queue.add(`test-job-${i}`, {
          message: `Test job ${i} for ${queueName}`,
          timestamp: new Date().toISOString()
        });
      }
      console.log(`  ✅ Added 3 test jobs to ${queueName}`);
    }

    // Monitor system for a brief period
    console.log('\n⏱️  Monitoring system for 10 seconds...');
    
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const systemHealth = await queueManager.getSystemHealth();
      
      console.log(`[${i + 1}s] Pool Utilization: ${systemHealth.connectionPool.poolUtilization}, ` +
                  `Jobs Waiting: ${systemHealth.queues.jobCounts.waiting}, ` +
                  `Jobs Active: ${systemHealth.queues.jobCounts.active}`);
    }

    // Show final statistics
    console.log('\n📊 Final System Health:');
    const finalHealth = await queueManager.getSystemHealth();
    console.log(JSON.stringify(finalHealth, null, 2));

    // Test retry logic by simulating a Redis operation
    console.log('\n🔄 Testing enhanced retry logic...');
    try {
      await queueManager.retryWithBackoff(async () => {
        // Simulate operation that might fail
        if (Math.random() < 0.3) { // 30% chance of failure
          throw new Error('Simulated Redis timeout');
        }
        return 'Operation successful';
      }, 3);
      console.log('✅ Retry operation completed successfully');
    } catch (error) {
      console.log('❌ Retry operation failed after max attempts:', error.message);
    }

  } catch (error) {
    console.error('❌ Error during demonstration:', error);
  } finally {
    // Clean shutdown
    console.log('\n🔚 Shutting down connection pool and workers...');
    await queueManager.closeConnections();
    console.log('✅ Shutdown complete');
  }
}

async function demonstrateScaling() {
  console.log('\n🚀 Connection Pool Scaling Demonstration\n');
  
  const queueManager = getInstance();
  
  try {
    await queueManager.connect();
    
    // Simulate scaling up to support more workers
    console.log('📈 Simulating scale-up scenario (adding more workers)...');
    
    const scaleSteps = [10, 25, 50, 75, 100]; // Simulate scaling to different worker counts
    
    for (const workerCount of scaleSteps) {
      console.log(`\n🔧 Scaling to ${workerCount} workers...`);
      
      const startTime = Date.now();
      const connections = [];
      
      // Simulate multiple workers requesting connections simultaneously
      const connectionPromises = Array.from({ length: workerCount }, async (_, i) => {
        try {
          const connection = await queueManager.createConnection(`scale-test-${i}`);
          connections.push(connection);
          return connection;
        } catch (error) {
          console.error(`Failed to create connection ${i}:`, error.message);
          return null;
        }
      });
      
      const results = await Promise.allSettled(connectionPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
      const failed = results.length - successful;
      
      const endTime = Date.now();
      const poolStats = queueManager.getConnectionPoolStats();
      
      console.log(`  ✅ Created ${successful} connections in ${endTime - startTime}ms`);
      console.log(`  ❌ Failed: ${failed} connections`);
      console.log(`  📊 Pool Utilization: ${poolStats.poolUtilization}`);
      console.log(`  🔄 Connections Reused: ${poolStats.connectionsReused}`);
      
      // Release connections
      for (const connection of connections.filter(c => c)) {
        queueManager.releaseConnection(connection);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause between scale steps
    }
    
  } catch (error) {
    console.error('❌ Error during scaling demonstration:', error);
  } finally {
    await queueManager.closeConnections();
  }
}

// Run the demonstrations
if (require.main === module) {
  (async () => {
    try {
      await demonstrateConnectionPooling();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Brief pause
      await demonstrateScaling();
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  })();
}

module.exports = {
  demonstrateConnectionPooling,
  demonstrateScaling
};