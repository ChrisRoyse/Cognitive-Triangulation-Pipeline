/**
 * Continuous Improvement Monitor
 * 
 * Tracks progress over iterations, monitors improvement velocity,
 * detects plateau conditions, and provides real-time feedback.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ContinuousImprovementMonitor extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map(); // Track improvement sessions
        this.metrics = new Map(); // Store various metrics
        this.alerts = [];
        this.monitoringActive = false;
        this.config = {
            plateauThreshold: 2, // Points improvement threshold
            plateauIterations: 3, // Number of iterations to consider plateau
            velocityWarningThreshold: 0.5, // Points per minute warning
            maxIterationTime: 600000, // 10 minutes max per iteration
            alertRetentionPeriod: 3600000 // 1 hour
        };
    }

    /**
     * Start monitoring an improvement session
     */
    startSession(sessionId, initialScore, targetScore = 100) {
        console.log(`📊 [Monitor] Starting improvement session: ${sessionId}`);
        
        const session = {
            id: sessionId,
            startTime: Date.now(),
            initialScore,
            targetScore,
            currentScore: initialScore,
            iterations: [],
            status: 'active',
            velocity: 0,
            plateauDetected: false,
            alerts: []
        };

        this.sessions.set(sessionId, session);
        this.monitoringActive = true;
        
        this.emit('sessionStarted', session);
        return session;
    }

    /**
     * Record an iteration result
     */
    recordIteration(sessionId, iterationNumber, qualityAssessment, taskResults, duration) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const iteration = {
            number: iterationNumber,
            timestamp: Date.now(),
            duration,
            qualityScore: qualityAssessment.overallScore,
            componentScores: qualityAssessment.componentScores,
            improvements: taskResults.improvements || [],
            tasksCompleted: taskResults.completed || 0,
            tasksFailed: taskResults.failed || 0,
            scoreImprovement: qualityAssessment.overallScore - session.currentScore
        };

        session.iterations.push(iteration);
        session.currentScore = qualityAssessment.overallScore;
        
        // Update velocity calculation
        this.updateVelocity(session);
        
        // Check for plateau
        this.checkPlateau(session);
        
        // Check for alerts
        this.checkAlerts(session, iteration);
        
        this.emit('iterationCompleted', session, iteration);
        
        console.log(`📈 [Monitor] Iteration ${iterationNumber}: Score ${iteration.qualityScore}/100 (${iteration.scoreImprovement > 0 ? '+' : ''}${iteration.scoreImprovement})`);
        
        return this.getSessionStatus(sessionId);
    }

    /**
     * Update velocity calculation for a session
     */
    updateVelocity(session) {
        if (session.iterations.length < 2) {
            session.velocity = 0;
            return;
        }

        const recentIterations = session.iterations.slice(-3); // Use last 3 iterations
        let totalImprovement = 0;
        let totalTime = 0;

        for (let i = 1; i < recentIterations.length; i++) {
            totalImprovement += recentIterations[i].scoreImprovement;
            totalTime += recentIterations[i].duration;
        }

        session.velocity = totalTime > 0 ? (totalImprovement / (totalTime / 60000)) : 0; // points per minute
    }

    /**
     * Check for plateau conditions
     */
    checkPlateau(session) {
        if (session.iterations.length < this.config.plateauIterations) {
            return;
        }

        const recentIterations = session.iterations.slice(-this.config.plateauIterations);
        const improvementSum = recentIterations.reduce((sum, iter) => sum + iter.scoreImprovement, 0);
        const avgImprovement = improvementSum / recentIterations.length;

        if (Math.abs(avgImprovement) < this.config.plateauThreshold) {
            if (!session.plateauDetected) {
                session.plateauDetected = true;
                this.addAlert(session, 'plateau', `Quality improvement has plateaued. Average improvement over last ${this.config.plateauIterations} iterations: ${avgImprovement.toFixed(2)} points`);
                this.emit('plateauDetected', session);
            }
        } else {
            session.plateauDetected = false;
        }
    }

    /**
     * Check for various alert conditions
     */
    checkAlerts(session, iteration) {
        // Check for declining quality
        if (iteration.scoreImprovement < -5) {
            this.addAlert(session, 'quality_decline', `Quality score decreased significantly: ${iteration.scoreImprovement} points`);
        }

        // Check for slow velocity
        if (session.velocity < this.config.velocityWarningThreshold && session.iterations.length > 2) {
            this.addAlert(session, 'low_velocity', `Improvement velocity is low: ${session.velocity.toFixed(2)} points/min`);
        }

        // Check for long iteration time
        if (iteration.duration > this.config.maxIterationTime) {
            this.addAlert(session, 'long_iteration', `Iteration took ${(iteration.duration / 60000).toFixed(2)} minutes (exceeds ${this.config.maxIterationTime / 60000} min limit)`);
        }

        // Check for task failures
        if (iteration.tasksFailed > 0) {
            this.addAlert(session, 'task_failures', `${iteration.tasksFailed} tasks failed in this iteration`);
        }

        // Check for stagnation (no improvement for multiple iterations)
        if (session.iterations.length >= 3) {
            const lastThree = session.iterations.slice(-3);
            const hasImprovement = lastThree.some(iter => iter.scoreImprovement > 0);
            
            if (!hasImprovement) {
                this.addAlert(session, 'stagnation', 'No positive improvement in last 3 iterations');
            }
        }
    }

    /**
     * Add an alert to session and global alerts
     */
    addAlert(session, type, message) {
        const alert = {
            timestamp: Date.now(),
            sessionId: session.id,
            type,
            message,
            level: this.getAlertLevel(type)
        };

        session.alerts.push(alert);
        this.alerts.push(alert);
        
        // Clean up old alerts
        this.cleanupOldAlerts();
        
        console.log(`⚠️ [Monitor] ${alert.level.toUpperCase()} Alert: ${message}`);
        this.emit('alert', alert);
    }

    /**
     * Get alert level based on type
     */
    getAlertLevel(type) {
        const levels = {
            plateau: 'warning',
            quality_decline: 'error',
            low_velocity: 'warning',
            long_iteration: 'warning',
            task_failures: 'error',
            stagnation: 'warning'
        };
        return levels[type] || 'info';
    }

    /**
     * Clean up old alerts
     */
    cleanupOldAlerts() {
        const cutoffTime = Date.now() - this.config.alertRetentionPeriod;
        this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffTime);
        
        // Also clean up session alerts
        for (const session of this.sessions.values()) {
            session.alerts = session.alerts.filter(alert => alert.timestamp > cutoffTime);
        }
    }

    /**
     * End a monitoring session
     */
    endSession(sessionId, reason = 'completed') {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        session.status = 'ended';
        session.endTime = Date.now();
        session.endReason = reason;
        session.totalDuration = session.endTime - session.startTime;
        session.totalImprovement = session.currentScore - session.initialScore;

        console.log(`🏁 [Monitor] Session ended: ${sessionId} (${reason})`);
        console.log(`   Final Score: ${session.currentScore}/100 (${session.totalImprovement > 0 ? '+' : ''}${session.totalImprovement})`);
        console.log(`   Duration: ${(session.totalDuration / 60000).toFixed(2)} minutes`);
        console.log(`   Iterations: ${session.iterations.length}`);

        this.emit('sessionEnded', session);
        
        // Save session data
        this.persistSessionData(session);
        
        return session;
    }

    /**
     * Get current status of a session
     */
    getSessionStatus(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        const currentTime = Date.now();
        const runningTime = currentTime - session.startTime;
        const progress = session.targetScore > 0 ? (session.currentScore / session.targetScore) * 100 : 0;

        return {
            sessionId: session.id,
            status: session.status,
            currentScore: session.currentScore,
            targetScore: session.targetScore,
            progress: Math.min(100, progress),
            totalImprovement: session.currentScore - session.initialScore,
            iterations: session.iterations.length,
            velocity: session.velocity,
            plateauDetected: session.plateauDetected,
            runningTime,
            activeAlerts: session.alerts.filter(a => Date.now() - a.timestamp < 300000), // Last 5 minutes
            lastIteration: session.iterations[session.iterations.length - 1] || null
        };
    }

    /**
     * Get comprehensive monitoring report
     */
    generateReport(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const report = {
            session: {
                id: session.id,
                status: session.status,
                duration: session.endTime ? session.endTime - session.startTime : Date.now() - session.startTime,
                iterations: session.iterations.length
            },
            progress: {
                initialScore: session.initialScore,
                currentScore: session.currentScore,
                targetScore: session.targetScore,
                totalImprovement: session.currentScore - session.initialScore,
                progressPercentage: (session.currentScore / session.targetScore) * 100
            },
            performance: {
                averageVelocity: this.calculateAverageVelocity(session),
                bestIteration: this.findBestIteration(session),
                worstIteration: this.findWorstIteration(session),
                iterationTrend: this.calculateIterationTrend(session)
            },
            quality: {
                componentBreakdown: this.getComponentBreakdown(session),
                improvementAreas: this.getImprovementAreas(session),
                consistencyScore: this.calculateConsistencyScore(session)
            },
            alerts: {
                total: session.alerts.length,
                byType: this.groupAlertsByType(session.alerts),
                recent: session.alerts.filter(a => Date.now() - a.timestamp < 600000) // Last 10 minutes
            },
            recommendations: this.generateRecommendations(session)
        };

        return report;
    }

    /**
     * Calculate average velocity over all iterations
     */
    calculateAverageVelocity(session) {
        if (session.iterations.length < 2) return 0;
        
        let totalImprovement = 0;
        let totalTime = 0;
        
        for (let i = 1; i < session.iterations.length; i++) {
            totalImprovement += session.iterations[i].scoreImprovement;
            totalTime += session.iterations[i].duration;
        }
        
        return totalTime > 0 ? totalImprovement / (totalTime / 60000) : 0;
    }

    /**
     * Find the iteration with the best improvement
     */
    findBestIteration(session) {
        if (session.iterations.length === 0) return null;
        
        return session.iterations.reduce((best, current) => 
            current.scoreImprovement > best.scoreImprovement ? current : best
        );
    }

    /**
     * Find the iteration with the worst performance
     */
    findWorstIteration(session) {
        if (session.iterations.length === 0) return null;
        
        return session.iterations.reduce((worst, current) => 
            current.scoreImprovement < worst.scoreImprovement ? current : worst
        );
    }

    /**
     * Calculate iteration trend (improving, declining, stable)
     */
    calculateIterationTrend(session) {
        if (session.iterations.length < 3) return 'insufficient_data';
        
        const recentIterations = session.iterations.slice(-3);
        const improvements = recentIterations.map(iter => iter.scoreImprovement);
        const avgImprovement = improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
        
        if (avgImprovement > 1) return 'improving';
        if (avgImprovement < -1) return 'declining';
        return 'stable';
    }

    /**
     * Get component score breakdown from latest iteration
     */
    getComponentBreakdown(session) {
        if (session.iterations.length === 0) return {};
        
        const latestIteration = session.iterations[session.iterations.length - 1];
        return latestIteration.componentScores || {};
    }

    /**
     * Identify areas that need the most improvement
     */
    getImprovementAreas(session) {
        const componentScores = this.getComponentBreakdown(session);
        const areas = [];
        
        for (const [component, result] of Object.entries(componentScores)) {
            areas.push({
                component,
                currentScore: result.score,
                issues: result.issues.length,
                priority: result.issues.length > 0 ? 'high' : 'medium'
            });
        }
        
        return areas.sort((a, b) => a.currentScore - b.currentScore);
    }

    /**
     * Calculate consistency score (how consistent are the improvements)
     */
    calculateConsistencyScore(session) {
        if (session.iterations.length < 3) return 100;
        
        const improvements = session.iterations.slice(1).map(iter => iter.scoreImprovement);
        const avg = improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
        const variance = improvements.reduce((sum, imp) => sum + Math.pow(imp - avg, 2), 0) / improvements.length;
        const stdDev = Math.sqrt(variance);
        
        // Lower standard deviation = higher consistency
        return Math.max(0, 100 - (stdDev * 10));
    }

    /**
     * Group alerts by type for analysis
     */
    groupAlertsByType(alerts) {
        const grouped = {};
        for (const alert of alerts) {
            grouped[alert.type] = (grouped[alert.type] || 0) + 1;
        }
        return grouped;
    }

    /**
     * Generate recommendations based on session analysis
     */
    generateRecommendations(session) {
        const recommendations = [];
        
        // Velocity-based recommendations
        if (session.velocity < 0.5) {
            recommendations.push({
                type: 'performance',
                priority: 'medium',
                message: 'Consider increasing parallelism or optimizing task execution to improve velocity'
            });
        }
        
        // Plateau-based recommendations
        if (session.plateauDetected) {
            recommendations.push({
                type: 'strategy',
                priority: 'high',
                message: 'Quality improvement has plateaued. Consider exploring different improvement strategies'
            });
        }
        
        // Alert-based recommendations
        const recentErrors = session.alerts.filter(a => a.level === 'error' && Date.now() - a.timestamp < 600000);
        if (recentErrors.length > 0) {
            recommendations.push({
                type: 'stability',
                priority: 'high',
                message: 'Multiple errors detected. Focus on stability improvements before continuing'
            });
        }
        
        // Progress-based recommendations
        const progress = (session.currentScore / session.targetScore) * 100;
        if (progress > 90) {
            recommendations.push({
                type: 'completion',
                priority: 'low',
                message: 'Very close to target. Consider fine-tuning remaining issues'
            });
        }
        
        return recommendations;
    }

    /**
     * Persist session data to disk
     */
    persistSessionData(session) {
        const monitoringDir = './monitoring-data';
        if (!fs.existsSync(monitoringDir)) {
            fs.mkdirSync(monitoringDir, { recursive: true });
        }

        const filename = `session-${session.id}-${Date.now()}.json`;
        const filepath = path.join(monitoringDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(session, null, 2));
        console.log(`💾 [Monitor] Session data saved to: ${filepath}`);
    }

    /**
     * Get all active sessions
     */
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter(session => session.status === 'active');
    }

    /**
     * Get global monitoring statistics
     */
    getGlobalStats() {
        const sessions = Array.from(this.sessions.values());
        const activeCount = sessions.filter(s => s.status === 'active').length;
        const completedCount = sessions.filter(s => s.status === 'ended').length;
        
        return {
            totalSessions: sessions.length,
            activeSessions: activeCount,
            completedSessions: completedCount,
            totalAlerts: this.alerts.length,
            monitoringActive: this.monitoringActive
        };
    }
}

module.exports = ContinuousImprovementMonitor;