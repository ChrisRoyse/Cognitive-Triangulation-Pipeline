/**
 * Real-time performance monitoring for the parallel triangulation system
 * Displays comparative metrics between parallel and sequential modes
 */

const { DatabaseManager } = require('../src/utils/sqliteDb');
const redis = require('../src/utils/cacheClient');
const chalk = require('chalk');
const Table = require('cli-table3');

class TriangulationMonitor {
    constructor() {
        this.dbManager = null;
        this.metrics = {
            parallel: this.initMetrics(),
            sequential: this.initMetrics()
        };
        this.startTime = Date.now();
        this.refreshInterval = 5000; // 5 seconds
    }
    
    initMetrics() {
        return {
            totalSessions: 0,
            completedSessions: 0,
            failedSessions: 0,
            averageProcessingTime: 0,
            averageConfidenceImprovement: 0,
            escalationRate: 0,
            accuracyScore: 0,
            agentMetrics: {},
            lastUpdated: null
        };
    }
    
    async initialize() {
        console.log(chalk.blue('🚀 Initializing triangulation performance monitor...'));
        
        // Initialize database connection
        this.dbManager = new DatabaseManager({
            dbPath: process.env.DB_PATH || './pipeline.db',
            enableWAL: true
        });
        
        console.log(chalk.green('✓ Monitor initialized'));
    }
    
    async start() {
        console.clear();
        console.log(chalk.cyan.bold('📊 COGNITIVE TRIANGULATION PERFORMANCE MONITOR\n'));
        
        // Start monitoring loop
        this.monitoringInterval = setInterval(() => {
            this.updateMetrics();
        }, this.refreshInterval);
        
        // Initial update
        await this.updateMetrics();
        
        // Handle graceful shutdown
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
    }
    
    async updateMetrics() {
        try {
            // Clear console for fresh display
            console.clear();
            console.log(chalk.cyan.bold('📊 COGNITIVE TRIANGULATION PERFORMANCE MONITOR\n'));
            console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
            console.log(chalk.gray(`Uptime: ${this.formatUptime()}\n`));
            
            // Fetch metrics from database
            await this.fetchDatabaseMetrics();
            
            // Fetch Redis metrics
            await this.fetchRedisMetrics();
            
            // Display comparison table
            this.displayComparisonTable();
            
            // Display agent performance
            this.displayAgentPerformance();
            
            // Display real-time activity
            await this.displayRealtimeActivity();
            
            // Display recommendations
            this.displayRecommendations();
            
        } catch (error) {
            console.error(chalk.red('Error updating metrics:'), error.message);
        }
    }
    
    async fetchDatabaseMetrics() {
        const db = this.dbManager.getDb();
        
        // Fetch parallel mode metrics
        const parallelStats = db.prepare(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_sessions,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_sessions,
                AVG(CASE WHEN status = 'COMPLETED' THEN 
                    CAST((julianday(completed_at) - julianday(created_at)) * 24 * 60 * 60 * 1000 AS INTEGER)
                END) as avg_processing_time,
                AVG(final_confidence - initial_confidence) as avg_confidence_improvement
            FROM triangulated_analysis_sessions
            WHERE orchestrator_id IS NOT NULL
            AND created_at >= datetime('now', '-1 hour')
        `).get();
        
        // Fetch sequential mode metrics (sessions without orchestrator_id)
        const sequentialStats = db.prepare(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_sessions,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_sessions,
                AVG(CASE WHEN status = 'COMPLETED' THEN 
                    CAST((julianday(completed_at) - julianday(created_at)) * 24 * 60 * 60 * 1000 AS INTEGER)
                END) as avg_processing_time,
                AVG(final_confidence - initial_confidence) as avg_confidence_improvement
            FROM triangulated_analysis_sessions
            WHERE orchestrator_id IS NULL
            AND created_at >= datetime('now', '-1 hour')
        `).get();
        
        // Update metrics
        this.updateModeMetrics('parallel', parallelStats);
        this.updateModeMetrics('sequential', sequentialStats);
        
        // Fetch agent-specific metrics for parallel mode
        const agentStats = db.prepare(`
            SELECT 
                agent_type,
                COUNT(*) as total_analyses,
                AVG(confidence_score) as avg_confidence,
                AVG(evidence_strength) as avg_evidence_strength,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as successful_analyses
            FROM agent_analyses
            WHERE created_at >= datetime('now', '-1 hour')
            GROUP BY agent_type
        `).all();
        
        this.metrics.parallel.agentMetrics = {};
        agentStats.forEach(stat => {
            this.metrics.parallel.agentMetrics[stat.agent_type] = stat;
        });
    }
    
    updateModeMetrics(mode, stats) {
        if (!stats) return;
        
        const metrics = this.metrics[mode];
        metrics.totalSessions = stats.total_sessions || 0;
        metrics.completedSessions = stats.completed_sessions || 0;
        metrics.failedSessions = stats.failed_sessions || 0;
        metrics.averageProcessingTime = stats.avg_processing_time || 0;
        metrics.averageConfidenceImprovement = stats.avg_confidence_improvement || 0;
        
        // Calculate rates
        if (metrics.totalSessions > 0) {
            metrics.successRate = (metrics.completedSessions / metrics.totalSessions) * 100;
            metrics.failureRate = (metrics.failedSessions / metrics.totalSessions) * 100;
        }
        
        // Fetch escalation rate
        const db = this.dbManager.getDb();
        const escalations = db.prepare(`
            SELECT COUNT(*) as count
            FROM consensus_decisions
            WHERE final_decision = 'ESCALATE'
            AND created_at >= datetime('now', '-1 hour')
        `).get();
        
        metrics.escalationRate = metrics.completedSessions > 0 
            ? (escalations.count / metrics.completedSessions) * 100 
            : 0;
        
        metrics.lastUpdated = new Date();
    }
    
    async fetchRedisMetrics() {
        try {
            // Fetch queue metrics
            const queueInfo = await redis.info('stats');
            
            // Parse relevant metrics
            const lines = queueInfo.split('\r\n');
            lines.forEach(line => {
                if (line.includes('instantaneous_ops_per_sec')) {
                    const ops = parseFloat(line.split(':')[1]);
                    // Store for display
                    this.redisOpsPerSec = ops;
                }
            });
        } catch (error) {
            // Redis metrics are optional
        }
    }
    
    displayComparisonTable() {
        const table = new Table({
            head: [
                chalk.white('Metric'),
                chalk.yellow('Sequential'),
                chalk.cyan('Parallel'),
                chalk.green('Improvement')
            ],
            colWidths: [30, 20, 20, 20],
            style: { head: [], border: [] }
        });
        
        // Add comparison rows
        const seq = this.metrics.sequential;
        const par = this.metrics.parallel;
        
        // Processing Time
        const timeImprovement = seq.averageProcessingTime > 0 
            ? ((seq.averageProcessingTime - par.averageProcessingTime) / seq.averageProcessingTime) * 100 
            : 0;
        table.push([
            'Avg Processing Time',
            `${seq.averageProcessingTime.toFixed(0)}ms`,
            `${par.averageProcessingTime.toFixed(0)}ms`,
            this.formatImprovement(timeImprovement, true) // inverse for time
        ]);
        
        // Success Rate
        const successImprovement = seq.successRate > 0 
            ? ((par.successRate - seq.successRate) / seq.successRate) * 100 
            : 0;
        table.push([
            'Success Rate',
            `${(seq.successRate || 0).toFixed(1)}%`,
            `${(par.successRate || 0).toFixed(1)}%`,
            this.formatImprovement(successImprovement)
        ]);
        
        // Confidence Improvement
        const confImprovement = seq.averageConfidenceImprovement > 0 
            ? ((par.averageConfidenceImprovement - seq.averageConfidenceImprovement) / seq.averageConfidenceImprovement) * 100 
            : 0;
        table.push([
            'Avg Confidence Gain',
            `+${(seq.averageConfidenceImprovement || 0).toFixed(3)}`,
            `+${(par.averageConfidenceImprovement || 0).toFixed(3)}`,
            this.formatImprovement(confImprovement)
        ]);
        
        // Escalation Rate
        const escalationImprovement = seq.escalationRate > 0 
            ? ((seq.escalationRate - par.escalationRate) / seq.escalationRate) * 100 
            : 0;
        table.push([
            'Escalation Rate',
            `${seq.escalationRate.toFixed(1)}%`,
            `${par.escalationRate.toFixed(1)}%`,
            this.formatImprovement(escalationImprovement, true) // inverse for escalation
        ]);
        
        // Throughput
        const seqThroughput = seq.averageProcessingTime > 0 ? 3600000 / seq.averageProcessingTime : 0;
        const parThroughput = par.averageProcessingTime > 0 ? 3600000 / par.averageProcessingTime : 0;
        const throughputImprovement = seqThroughput > 0 
            ? ((parThroughput - seqThroughput) / seqThroughput) * 100 
            : 0;
        table.push([
            'Throughput (per hour)',
            `${seqThroughput.toFixed(0)}`,
            `${parThroughput.toFixed(0)}`,
            this.formatImprovement(throughputImprovement)
        ]);
        
        console.log(table.toString());
    }
    
    displayAgentPerformance() {
        if (Object.keys(this.metrics.parallel.agentMetrics).length === 0) {
            return;
        }
        
        console.log(chalk.cyan('\n🤖 PARALLEL AGENT PERFORMANCE\n'));
        
        const agentTable = new Table({
            head: [
                chalk.white('Agent Type'),
                chalk.white('Analyses'),
                chalk.white('Success Rate'),
                chalk.white('Avg Confidence'),
                chalk.white('Avg Evidence')
            ],
            colWidths: [20, 15, 15, 15, 15],
            style: { head: [], border: [] }
        });
        
        Object.entries(this.metrics.parallel.agentMetrics).forEach(([agentType, stats]) => {
            const successRate = stats.total_analyses > 0 
                ? (stats.successful_analyses / stats.total_analyses) * 100 
                : 0;
            
            agentTable.push([
                this.capitalizeAgent(agentType),
                stats.total_analyses,
                `${successRate.toFixed(1)}%`,
                `${(stats.avg_confidence || 0).toFixed(3)}`,
                `${(stats.avg_evidence_strength || 0).toFixed(3)}`
            ]);
        });
        
        console.log(agentTable.toString());
    }
    
    async displayRealtimeActivity() {
        const db = this.dbManager.getDb();
        
        // Get recent activity
        const recentSessions = db.prepare(`
            SELECT 
                tas.session_id,
                tas.status,
                tas.created_at,
                r.type as relationship_type,
                cd.final_decision,
                cd.weighted_consensus
            FROM triangulated_analysis_sessions tas
            LEFT JOIN relationships r ON tas.relationship_id = r.id
            LEFT JOIN consensus_decisions cd ON tas.session_id = cd.session_id
            WHERE tas.created_at >= datetime('now', '-5 minutes')
            ORDER BY tas.created_at DESC
            LIMIT 5
        `).all();
        
        if (recentSessions.length > 0) {
            console.log(chalk.cyan('\n📈 RECENT ACTIVITY\n'));
            
            recentSessions.forEach(session => {
                const timestamp = new Date(session.created_at).toLocaleTimeString();
                const status = this.formatStatus(session.status);
                const decision = session.final_decision || 'PENDING';
                const consensus = session.weighted_consensus 
                    ? `${(session.weighted_consensus * 100).toFixed(1)}%` 
                    : 'N/A';
                
                console.log(
                    chalk.gray(`[${timestamp}]`) + ' ' +
                    `${session.relationship_type || 'UNKNOWN'} → ` +
                    status + ' ' +
                    chalk.gray(`Decision: ${decision}, Consensus: ${consensus}`)
                );
            });
        }
    }
    
    displayRecommendations() {
        console.log(chalk.cyan('\n💡 RECOMMENDATIONS\n'));
        
        const seq = this.metrics.sequential;
        const par = this.metrics.parallel;
        
        // Performance recommendations
        if (par.averageProcessingTime > seq.averageProcessingTime && par.totalSessions > 10) {
            console.log(chalk.yellow('⚠️  Parallel mode is slower than sequential. Consider:'));
            console.log(chalk.gray('   - Reducing max parallel agents'));
            console.log(chalk.gray('   - Checking system resource constraints'));
            console.log(chalk.gray('   - Reviewing agent implementation efficiency'));
        }
        
        // Accuracy recommendations
        if (par.escalationRate > 20 && par.completedSessions > 10) {
            console.log(chalk.yellow('⚠️  High escalation rate detected. Consider:'));
            console.log(chalk.gray('   - Reviewing consensus threshold settings'));
            console.log(chalk.gray('   - Improving agent analysis algorithms'));
            console.log(chalk.gray('   - Adding more specialized agents'));
        }
        
        // Success recommendations
        if (par.successRate < 80 && par.totalSessions > 10) {
            console.log(chalk.yellow('⚠️  Low success rate in parallel mode. Consider:'));
            console.log(chalk.gray('   - Checking for agent timeout issues'));
            console.log(chalk.gray('   - Reviewing error logs for patterns'));
            console.log(chalk.gray('   - Adjusting session timeout settings'));
        }
        
        // All good
        if (par.averageProcessingTime < seq.averageProcessingTime && 
            par.successRate > 90 && 
            par.escalationRate < 10) {
            console.log(chalk.green('✅ Parallel coordination is performing optimally!'));
            console.log(chalk.gray(`   - ${((seq.averageProcessingTime - par.averageProcessingTime) / seq.averageProcessingTime * 100).toFixed(1)}% faster processing`));
            console.log(chalk.gray(`   - ${par.escalationRate.toFixed(1)}% escalation rate`));
            console.log(chalk.gray(`   - ${par.successRate.toFixed(1)}% success rate`));
        }
    }
    
    formatImprovement(percentage, inverse = false) {
        if (inverse) percentage = -percentage;
        
        if (percentage > 0) {
            return chalk.green(`+${percentage.toFixed(1)}%`);
        } else if (percentage < 0) {
            return chalk.red(`${percentage.toFixed(1)}%`);
        } else {
            return chalk.gray('0.0%');
        }
    }
    
    formatStatus(status) {
        switch (status) {
            case 'COMPLETED':
                return chalk.green('✓ Completed');
            case 'FAILED':
                return chalk.red('✗ Failed');
            case 'IN_PROGRESS':
                return chalk.yellow('⟳ Processing');
            case 'PENDING':
                return chalk.gray('◌ Pending');
            default:
                return chalk.gray(status);
        }
    }
    
    capitalizeAgent(agentType) {
        return agentType.charAt(0).toUpperCase() + agentType.slice(1);
    }
    
    formatUptime() {
        const uptime = Date.now() - this.startTime;
        const hours = Math.floor(uptime / 3600000);
        const minutes = Math.floor((uptime % 3600000) / 60000);
        const seconds = Math.floor((uptime % 60000) / 1000);
        
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    
    async stop() {
        console.log(chalk.yellow('\n\n⏹️  Stopping monitor...'));
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        console.log(chalk.green('✓ Monitor stopped'));
        process.exit(0);
    }
}

// Run the monitor
async function main() {
    const monitor = new TriangulationMonitor();
    
    try {
        await monitor.initialize();
        await monitor.start();
    } catch (error) {
        console.error(chalk.red('❌ Monitor failed:'), error);
        process.exit(1);
    }
}

// Execute if run directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TriangulationMonitor;