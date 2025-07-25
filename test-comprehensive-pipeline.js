#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const sqliteDb = require('./src/utils/sqliteDb');
const neo4jDriver = require('./src/utils/neo4jDriver');
const QueueManager = require('./src/utils/queueManager');
const logger = require('./src/utils/logger');
const chalk = require('chalk');
const { Table } = require('console-table-printer');

class ComprehensivePipelineTest {
  constructor() {
    this.startTime = Date.now();
    this.results = {
      setup: { success: false, errors: [] },
      fileAnalysis: { success: false, count: 0, errors: [] },
      poiExtraction: { success: false, count: 0, errors: [] },
      relationshipDiscovery: { success: false, count: 0, errors: [] },
      confidenceScoring: { success: false, avgScore: 0, errors: [] },
      triangulation: { success: false, count: 0, errors: [] },
      evidenceTracking: { success: false, count: 0, errors: [] },
      neo4j: { available: false, errors: [] },
      overall: { success: false, duration: 0 }
    };
  }

  async run() {
    console.log(chalk.blue.bold('\n🚀 COMPREHENSIVE CTP PIPELINE TEST\n'));
    console.log(chalk.gray(`Started at: ${new Date().toISOString()}`));
    console.log(chalk.gray('=' .repeat(80)));

    try {
      // 1. Setup and cleanup
      await this.setupEnvironment();
      
      // 2. Test Neo4j availability
      await this.testNeo4jConnection();
      
      // 3. Run the pipeline
      await this.runPipeline();
      
      // 4. Wait for processing
      await this.waitForProcessing();
      
      // 5. Verify results
      await this.verifyResults();
      
      // 6. Generate report
      await this.generateReport();
      
    } catch (error) {
      console.error(chalk.red('\n❌ Test failed with error:'), error);
      this.results.overall.errors = [error.message];
    } finally {
      await this.cleanup();
    }
  }

  async setupEnvironment() {
    console.log(chalk.yellow('\n📋 Setting up test environment...'));
    
    try {
      // Clean database
      console.log('  • Cleaning database...');
      await sqliteDb.run('DELETE FROM file_analysis');
      await sqliteDb.run('DELETE FROM poi_discovery');
      await sqliteDb.run('DELETE FROM relationship_discovery');
      await sqliteDb.run('DELETE FROM agent_communication');
      await sqliteDb.run('DELETE FROM reconciliation_events');
      await sqliteDb.run('DELETE FROM validation_events');
      await sqliteDb.run('DELETE FROM global_resolution_events');
      await sqliteDb.run('DELETE FROM relationship_evidence_tracking');
      await sqliteDb.run('DELETE FROM transactional_outbox');
      
      // Clean Redis queues
      console.log('  • Cleaning Redis queues...');
      const queueManager = QueueManager.getInstance();
      const queues = [
        'file-analysis',
        'directory-resolution',
        'relationship-resolution',
        'validation',
        'reconciliation',
        'global-resolution'
      ];
      
      for (const queueName of queues) {
        const queue = queueManager.getQueue(queueName);
        await queue.drain();
        await queue.clean(0, 'completed');
        await queue.clean(0, 'failed');
        await queue.clean(0, 'active');
        await queue.clean(0, 'wait');
      }
      
      this.results.setup.success = true;
      console.log(chalk.green('  ✓ Environment setup complete'));
      
    } catch (error) {
      this.results.setup.errors.push(error.message);
      throw new Error(`Setup failed: ${error.message}`);
    }
  }

  async testNeo4jConnection() {
    console.log(chalk.yellow('\n🔌 Testing Neo4j connection...'));
    
    try {
      const driver = neo4jDriver.getDriver();
      const session = driver.session();
      await session.run('RETURN 1');
      await session.close();
      
      this.results.neo4j.available = true;
      console.log(chalk.green('  ✓ Neo4j is available'));
      
    } catch (error) {
      this.results.neo4j.errors.push(error.message);
      console.log(chalk.yellow('  ⚠ Neo4j is not available (will continue without graph building)'));
    }
  }

  async runPipeline() {
    console.log(chalk.yellow('\n🏃 Running pipeline on polyglot-test...'));
    
    try {
      // Check if polyglot-test exists
      const testPath = path.join(process.cwd(), 'polyglot-test');
      await fs.access(testPath);
      
      // Run the main pipeline
      console.log('  • Starting main.js...');
      const mainProcess = require('child_process').spawn('node', ['src/main.js'], {
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: 'pipe'
      });
      
      // Capture output
      let output = '';
      mainProcess.stdout.on('data', (data) => {
        output += data.toString();
        process.stdout.write(chalk.gray('  > ') + data.toString());
      });
      
      mainProcess.stderr.on('data', (data) => {
        console.error(chalk.red('  ! ') + data.toString());
      });
      
      // Wait for initial processing
      await new Promise((resolve) => {
        setTimeout(resolve, 5000); // Give it 5 seconds to start
      });
      
      // Let it run for a bit then terminate
      setTimeout(() => {
        mainProcess.kill('SIGTERM');
      }, 30000); // Run for 30 seconds max
      
      console.log(chalk.green('  ✓ Pipeline started successfully'));
      
    } catch (error) {
      throw new Error(`Pipeline start failed: ${error.message}`);
    }
  }

  async waitForProcessing() {
    console.log(chalk.yellow('\n⏳ Waiting for processing to complete...'));
    
    const maxWaitTime = 60000; // 60 seconds
    const checkInterval = 2000; // Check every 2 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const queueManager = QueueManager.getInstance();
      
      // Check if queues are empty
      let allEmpty = true;
      const queueStats = {};
      
      for (const queueName of ['file-analysis', 'directory-resolution', 'relationship-resolution']) {
        const queue = queueManager.getQueue(queueName);
        const counts = await queue.getJobCounts();
        queueStats[queueName] = counts;
        
        if (counts.active > 0 || counts.waiting > 0) {
          allEmpty = false;
        }
      }
      
      // Display queue status
      console.log(chalk.gray(`  Queue status: ${JSON.stringify(queueStats)}`));
      
      if (allEmpty) {
        console.log(chalk.green('  ✓ All queues empty, processing complete'));
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  async verifyResults() {
    console.log(chalk.yellow('\n🔍 Verifying results...'));
    
    // 1. Check file analysis
    console.log('\n  📁 File Analysis:');
    const fileAnalysis = await sqliteDb.all(`
      SELECT COUNT(*) as count, 
             COUNT(DISTINCT file_path) as unique_files,
             AVG(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_rate
      FROM file_analysis
    `);
    
    this.results.fileAnalysis.count = fileAnalysis[0].count;
    this.results.fileAnalysis.success = fileAnalysis[0].count > 0;
    console.log(`    • Total analyses: ${fileAnalysis[0].count}`);
    console.log(`    • Unique files: ${fileAnalysis[0].unique_files}`);
    console.log(`    • Success rate: ${(fileAnalysis[0].success_rate * 100).toFixed(1)}%`);
    
    // 2. Check POI extraction
    console.log('\n  🎯 POI Extraction:');
    const pois = await sqliteDb.all(`
      SELECT COUNT(*) as count,
             COUNT(DISTINCT name) as unique_pois,
             AVG(confidence_score) as avg_confidence
      FROM poi_discovery
    `);
    
    this.results.poiExtraction.count = pois[0].count;
    this.results.poiExtraction.success = pois[0].count > 0;
    console.log(`    • Total POIs: ${pois[0].count}`);
    console.log(`    • Unique POIs: ${pois[0].unique_pois}`);
    console.log(`    • Avg confidence: ${(pois[0].avg_confidence || 0).toFixed(3)}`);
    
    // 3. Check relationship discovery
    console.log('\n  🔗 Relationship Discovery:');
    const relationships = await sqliteDb.all(`
      SELECT COUNT(*) as count,
             AVG(confidence_score) as avg_confidence,
             COUNT(DISTINCT source_poi_id || '-' || target_poi_id) as unique_relationships
      FROM relationship_discovery
    `);
    
    this.results.relationshipDiscovery.count = relationships[0].count;
    this.results.relationshipDiscovery.success = relationships[0].count > 0;
    this.results.confidenceScoring.avgScore = relationships[0].avg_confidence || 0;
    console.log(`    • Total relationships: ${relationships[0].count}`);
    console.log(`    • Unique relationships: ${relationships[0].unique_relationships}`);
    console.log(`    • Avg confidence: ${(relationships[0].avg_confidence || 0).toFixed(3)}`);
    
    // 4. Check triangulation (low confidence relationships)
    console.log('\n  🔺 Triangulation Analysis:');
    const lowConfidence = await sqliteDb.all(`
      SELECT COUNT(*) as count
      FROM relationship_discovery
      WHERE confidence_score < 0.5
    `);
    
    const triangulated = await sqliteDb.all(`
      SELECT COUNT(DISTINCT rd.id) as count
      FROM relationship_discovery rd
      JOIN validation_events ve ON ve.entity_id = rd.id
      WHERE rd.confidence_score < 0.5
    `);
    
    this.results.triangulation.count = triangulated[0].count;
    this.results.triangulation.success = lowConfidence[0].count > 0;
    console.log(`    • Low confidence relationships: ${lowConfidence[0].count}`);
    console.log(`    • Triangulated: ${triangulated[0].count}`);
    
    // 5. Check evidence tracking
    console.log('\n  📊 Evidence Tracking:');
    const evidence = await sqliteDb.all(`
      SELECT COUNT(*) as count,
             COUNT(DISTINCT relationship_id) as tracked_relationships
      FROM relationship_evidence_tracking
    `);
    
    this.results.evidenceTracking.count = evidence[0].count;
    this.results.evidenceTracking.success = evidence[0].count > 0;
    console.log(`    • Total evidence records: ${evidence[0].count}`);
    console.log(`    • Tracked relationships: ${evidence[0].tracked_relationships}`);
    
    // 6. Check for errors
    console.log('\n  ❌ Error Analysis:');
    const errors = await sqliteDb.all(`
      SELECT 
        (SELECT COUNT(*) FROM file_analysis WHERE status = 'failed') as file_errors,
        (SELECT COUNT(*) FROM agent_communication WHERE message_type = 'error') as comm_errors,
        (SELECT COUNT(*) FROM transactional_outbox WHERE status = 'failed') as outbox_errors
    `);
    
    console.log(`    • File analysis errors: ${errors[0].file_errors}`);
    console.log(`    • Communication errors: ${errors[0].comm_errors}`);
    console.log(`    • Outbox errors: ${errors[0].outbox_errors}`);
  }

  async generateReport() {
    const duration = Date.now() - this.startTime;
    this.results.overall.duration = duration;
    
    console.log(chalk.blue.bold('\n📈 COMPREHENSIVE TEST REPORT\n'));
    console.log(chalk.gray('=' .repeat(80)));
    
    // Summary table
    const summaryTable = new Table({
      columns: [
        { name: 'Component', alignment: 'left' },
        { name: 'Status', alignment: 'center' },
        { name: 'Details', alignment: 'left' }
      ]
    });
    
    // Add rows
    summaryTable.addRow({
      Component: 'Environment Setup',
      Status: this.results.setup.success ? '✅' : '❌',
      Details: this.results.setup.errors.length > 0 ? this.results.setup.errors.join(', ') : 'Clean setup'
    });
    
    summaryTable.addRow({
      Component: 'File Analysis',
      Status: this.results.fileAnalysis.success ? '✅' : '❌',
      Details: `${this.results.fileAnalysis.count} files analyzed`
    });
    
    summaryTable.addRow({
      Component: 'POI Extraction',
      Status: this.results.poiExtraction.success ? '✅' : '❌',
      Details: `${this.results.poiExtraction.count} POIs discovered`
    });
    
    summaryTable.addRow({
      Component: 'Relationship Discovery',
      Status: this.results.relationshipDiscovery.success ? '✅' : '❌',
      Details: `${this.results.relationshipDiscovery.count} relationships found`
    });
    
    summaryTable.addRow({
      Component: 'Confidence Scoring',
      Status: this.results.confidenceScoring.avgScore > 0 ? '✅' : '❌',
      Details: `Avg score: ${this.results.confidenceScoring.avgScore.toFixed(3)}`
    });
    
    summaryTable.addRow({
      Component: 'Triangulation',
      Status: this.results.triangulation.success ? '✅' : '❌',
      Details: `${this.results.triangulation.count} relationships triangulated`
    });
    
    summaryTable.addRow({
      Component: 'Evidence Tracking',
      Status: this.results.evidenceTracking.success ? '✅' : '❌',
      Details: `${this.results.evidenceTracking.count} evidence records`
    });
    
    summaryTable.addRow({
      Component: 'Neo4j Integration',
      Status: this.results.neo4j.available ? '✅' : '⚠️',
      Details: this.results.neo4j.available ? 'Connected' : 'Offline (pipeline continues)'
    });
    
    summaryTable.printTable();
    
    // Overall assessment
    const workingComponents = Object.values(this.results)
      .filter(r => r.success || r.available)
      .length - 1; // Subtract 'overall'
    
    const totalComponents = Object.keys(this.results).length - 1;
    const healthPercentage = (workingComponents / totalComponents * 100).toFixed(1);
    
    console.log(chalk.bold('\n🏁 OVERALL SYSTEM HEALTH'));
    console.log(chalk.gray('=' .repeat(80)));
    
    if (healthPercentage >= 80) {
      console.log(chalk.green.bold(`✅ SYSTEM HEALTHY: ${healthPercentage}% components working`));
    } else if (healthPercentage >= 60) {
      console.log(chalk.yellow.bold(`⚠️  SYSTEM PARTIALLY WORKING: ${healthPercentage}% components working`));
    } else {
      console.log(chalk.red.bold(`❌ SYSTEM UNHEALTHY: Only ${healthPercentage}% components working`));
    }
    
    // Issues summary
    console.log(chalk.bold('\n🔧 ISSUES SUMMARY'));
    console.log(chalk.gray('=' .repeat(80)));
    
    const issues = [];
    
    if (!this.results.neo4j.available) {
      issues.push('• Neo4j is offline - graph building disabled');
    }
    
    if (this.results.confidenceScoring.avgScore < 0.5) {
      issues.push(`• Low average confidence scores (${this.results.confidenceScoring.avgScore.toFixed(3)}) - triangulation needed`);
    }
    
    if (this.results.triangulation.count === 0 && this.results.relationshipDiscovery.count > 0) {
      issues.push('• Triangulation not processing low confidence relationships');
    }
    
    if (issues.length > 0) {
      issues.forEach(issue => console.log(chalk.yellow(issue)));
    } else {
      console.log(chalk.green('✅ No critical issues detected'));
    }
    
    // Recommendations
    console.log(chalk.bold('\n💡 RECOMMENDATIONS'));
    console.log(chalk.gray('=' .repeat(80)));
    
    if (!this.results.neo4j.available) {
      console.log('1. Start Neo4j to enable graph visualization');
    }
    
    if (this.results.confidenceScoring.avgScore < 0.5) {
      console.log('2. Review LLM prompts to improve initial confidence scores');
    }
    
    if (this.results.triangulation.count < this.results.relationshipDiscovery.count * 0.5) {
      console.log('3. Ensure triangulation workers are processing low confidence relationships');
    }
    
    console.log(chalk.gray(`\nTest completed in ${(duration / 1000).toFixed(1)} seconds`));
  }

  async cleanup() {
    console.log(chalk.gray('\n🧹 Cleaning up...'));
    
    try {
      await QueueManager.getInstance().closeConnections();
      await sqliteDb.close();
      console.log(chalk.green('  ✓ Cleanup complete'));
    } catch (error) {
      console.error(chalk.red('  ❌ Cleanup error:'), error);
    }
  }
}

// Run the test
if (require.main === module) {
  const test = new ComprehensivePipelineTest();
  test.run().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = ComprehensivePipelineTest;