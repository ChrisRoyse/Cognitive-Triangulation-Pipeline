#!/usr/bin/env node

const { getInstance: getQueueManagerInstance } = require('../src/utils/queueManager');
const { DatabaseManager } = require('../src/utils/sqliteDb');
const config = require('../src/config');
const chalk = require('chalk');

/**
 * Production Triangulation Monitoring Script
 * Monitors the triangulated analysis queue and provides real-time insights
 */
class TriangulationMonitor {
    constructor() {
        this.queueManager = getQueueManagerInstance();
        this.dbManager = new DatabaseManager(config.SQLITE_DB_PATH);
        this.refreshInterval = 2000; // 2 seconds
        this.isRunning = false;
    }

    async start() {
        console.log(chalk.blue.bold('\n=== Triangulation Analysis Monitor ===\n'));
        
        try {
            await this.queueManager.connect();
            this.isRunning = true;
            
            // Start monitoring loop
            await this.monitorLoop();
            
        } catch (error) {
            console.error(chalk.red('Error starting monitor:'), error.message);
            process.exit(1);
        }
    }

    async monitorLoop() {
        while (this.isRunning) {
            try {
                await this.displayStatus();
                await new Promise(resolve => setTimeout(resolve, this.refreshInterval));
            } catch (error) {
                console.error(chalk.red('Monitor error:'), error.message);
            }
        }
    }

    async displayStatus() {
        // Clear console
        console.clear();
        console.log(chalk.blue.bold('\n=== Triangulation Analysis Monitor ==='));
        console.log(chalk.gray(`Updated: ${new Date().toLocaleTimeString()}\n`));

        // Get queue statistics
        const queue = this.queueManager.getQueue('triangulated-analysis-queue');
        const queueStats = await queue.getJobCounts();
        
        // Display queue status
        console.log(chalk.cyan('📊 Queue Status:'));
        console.log(`  Active Jobs: ${chalk.yellow(queueStats.active)}`);
        console.log(`  Waiting Jobs: ${chalk.yellow(queueStats.waiting)}`);
        console.log(`  Completed Jobs: ${chalk.green(queueStats.completed)}`);
        console.log(`  Failed Jobs: ${chalk.red(queueStats.failed)}`);
        
        // Get database statistics
        const db = this.dbManager.getDb();
        
        // Active sessions
        const activeSessions = db.prepare(`
            SELECT COUNT(*) as count, status
            FROM triangulated_analysis_sessions
            WHERE created_at > datetime('now', '-1 hour')
            GROUP BY status
        `).all();
        
        console.log(chalk.cyan('\n🔍 Analysis Sessions (Last Hour):'));
        activeSessions.forEach(session => {
            const color = session.status === 'COMPLETED' ? chalk.green :
                         session.status === 'FAILED' ? chalk.red :
                         session.status === 'IN_PROGRESS' ? chalk.yellow :
                         chalk.gray;
            console.log(`  ${session.status}: ${color(session.count)}`);
        });
        
        // Low confidence relationships
        const lowConfidenceStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status LIKE '%TRIANGULATED%' THEN 1 END) as analyzed,
                AVG(confidence) as avg_confidence
            FROM relationships
            WHERE confidence < 0.45
        `).get();
        
        console.log(chalk.cyan('\n🎯 Low Confidence Relationships:'));
        console.log(`  Total: ${chalk.yellow(lowConfidenceStats.total)}`);
        console.log(`  Analyzed: ${chalk.green(lowConfidenceStats.analyzed)}`);
        console.log(`  Pending: ${chalk.red(lowConfidenceStats.total - lowConfidenceStats.analyzed)}`);
        console.log(`  Avg Confidence: ${chalk.blue(lowConfidenceStats.avg_confidence?.toFixed(3) || 'N/A')}`);
        
        // Recent triangulation results
        const recentResults = db.prepare(`
            SELECT 
                tas.session_id,
                tas.initial_confidence,
                tas.final_confidence,
                tas.consensus_score,
                tas.status,
                r.type as relationship_type,
                tas.created_at
            FROM triangulated_analysis_sessions tas
            JOIN relationships r ON tas.relationship_id = r.id
            ORDER BY tas.created_at DESC
            LIMIT 5
        `).all();
        
        if (recentResults.length > 0) {
            console.log(chalk.cyan('\n📋 Recent Triangulation Results:'));
            recentResults.forEach(result => {
                const improved = result.final_confidence > result.initial_confidence;
                const arrow = improved ? chalk.green('↑') : chalk.red('↓');
                const status = result.status === 'COMPLETED' ? chalk.green('✓') :
                              result.status === 'FAILED' ? chalk.red('✗') :
                              chalk.yellow('⋯');
                
                console.log(`  ${status} ${result.relationship_type}: ${result.initial_confidence?.toFixed(3)} → ${result.final_confidence?.toFixed(3)} ${arrow} (consensus: ${result.consensus_score?.toFixed(3)})`);
            });
        }
        
        // Agent performance
        const agentStats = db.prepare(`
            SELECT 
                agent_type,
                COUNT(*) as total,
                AVG(confidence_score) as avg_confidence,
                AVG(evidence_strength) as avg_evidence,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed
            FROM subagent_analyses
            WHERE created_at > datetime('now', '-1 hour')
            GROUP BY agent_type
        `).all();
        
        if (agentStats.length > 0) {
            console.log(chalk.cyan('\n🤖 Agent Performance (Last Hour):'));
            agentStats.forEach(agent => {
                const successRate = agent.total > 0 ? (agent.completed / agent.total * 100).toFixed(1) : 0;
                console.log(`  ${chalk.magenta(agent.agent_type)}:`);
                console.log(`    Success Rate: ${chalk.green(successRate + '%')}`);
                console.log(`    Avg Confidence: ${chalk.blue(agent.avg_confidence?.toFixed(3) || 'N/A')}`);
                console.log(`    Avg Evidence: ${chalk.blue(agent.avg_evidence?.toFixed(3) || 'N/A')}`);
            });
        }
        
        // System health
        const activeJobs = await queue.getActiveCount();
        const waitingJobs = await queue.getWaitingCount();
        const queueHealth = activeJobs > 10 ? chalk.red('HIGH LOAD') :
                           activeJobs > 5 ? chalk.yellow('MODERATE') :
                           chalk.green('HEALTHY');
        
        console.log(chalk.cyan('\n💚 System Health:'));
        console.log(`  Queue Health: ${queueHealth}`);
        console.log(`  Active Workers: ${chalk.blue(activeJobs)}`);
        
        // Instructions
        console.log(chalk.gray('\n[Press Ctrl+C to exit]'));
    }

    async stop() {
        this.isRunning = false;
        await this.queueManager.closeConnections();
        this.dbManager.close();
        console.log(chalk.green('\nMonitor stopped successfully'));
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    if (monitor) {
        await monitor.stop();
    }
    process.exit(0);
});

// Create and start monitor
const monitor = new TriangulationMonitor();
monitor.start().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
});