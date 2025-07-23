/**
 * Benchmark Comparator and Advanced Reporting System
 * 
 * Provides detailed analysis of pipeline performance against established benchmarks,
 * trend analysis, regression detection, and actionable insights.
 */

const fs = require('fs');
const path = require('path');

class BenchmarkComparator {
    constructor(options = {}) {
        this.options = {
            historyDir: options.historyDir || './test-history',
            thresholds: {
                regression: 0.15, // 15% score drop considered regression
                warning: 0.10,    // 10% score drop triggers warning
                improvement: 0.05  // 5% score increase considered improvement
            },
            ...options
        };
        
        // Polyglot-test benchmark expectations
        this.polyglotBenchmark = {
            sqlite: {
                files: { min: 13, expected: 15, max: 17 },
                pois: { min: 375, expected: 417, max: 460 },
                relationships: { min: 697, expected: 870, max: 1050 },
                poiTypes: {
                    'function': { min: 200, expected: 235, max: 270 },
                    'class': { min: 18, expected: 21, max: 25 },
                    'variable': { min: 35, expected: 41, max: 50 },
                    'import': { min: 55, expected: 66, max: 75 }
                },
                relationshipTypes: {
                    'CONTAINS': { min: 360, expected: 402, max: 450 },
                    'CALLS': { min: 120, expected: 150, max: 200 },
                    'USES': { min: 80, expected: 100, max: 150 },
                    'IMPORTS': { min: 55, expected: 66, max: 75 }
                }
            },
            neo4j: {
                totalNodes: { min: 375, expected: 417, max: 460 },
                totalRelationships: { min: 697, expected: 870, max: 1050 },
                relationshipRatio: { min: 1.8, expected: 2.1, max: 3.0 },
                crossLanguage: {
                    js_to_py_calls: { min: 2, expected: 3, max: 5 },
                    sql_references: { min: 15, expected: 20, max: 30 },
                    inheritance_chains: { min: 1, expected: 2, max: 3 }
                }
            },
            performance: {
                executionTime: { min: 30000, expected: 60000, max: 120000 }, // ms
                memoryUsage: { min: 0, expected: 512, max: 1024 }, // MB
                errorRate: { min: 0, expected: 0, max: 0.05 } // 5% max error rate
            }
        };
        
        this.setupHistoryDir();
    }
    
    setupHistoryDir() {
        if (!fs.existsSync(this.options.historyDir)) {
            fs.mkdirSync(this.options.historyDir, { recursive: true });
        }
    }
    
    async compareResults(currentResults, testConfig = {}) {
        const comparison = {
            timestamp: new Date().toISOString(),
            testConfig,
            benchmarkAnalysis: this.analyzeBenchmarkCompliance(currentResults),
            historicalAnalysis: await this.analyzeHistoricalTrends(currentResults),
            regressionAnalysis: await this.detectRegressions(currentResults),
            performanceAnalysis: this.analyzePerformance(currentResults),
            recommendations: [],
            alerts: [],
            score: 0
        };
        
        // Generate recommendations and alerts
        this.generateRecommendations(comparison, currentResults);
        this.generateAlerts(comparison, currentResults);
        
        // Calculate overall benchmark compliance score
        comparison.score = this.calculateBenchmarkScore(comparison);
        
        // Save results to history
        await this.saveToHistory(currentResults, comparison);
        
        return comparison;
    }
    
    analyzeBenchmarkCompliance(results) {
        const analysis = {
            sqlite: this.analyzeSQLiteBenchmark(results.sqliteValidation),
            neo4j: this.analyzeNeo4jBenchmark(results.neo4jValidation),
            overall: { compliant: false, score: 0, issues: [] }
        };
        
        // Calculate overall compliance
        const sqliteScore = analysis.sqlite?.score || 0;
        const neo4jScore = analysis.neo4j?.score || 0;
        analysis.overall.score = Math.round((sqliteScore + neo4jScore) / 2);
        analysis.overall.compliant = analysis.overall.score >= 85;
        
        // Collect all issues
        if (analysis.sqlite?.issues) {
            analysis.overall.issues.push(...analysis.sqlite.issues);
        }
        if (analysis.neo4j?.issues) {
            analysis.overall.issues.push(...analysis.neo4j.issues);
        }
        
        return analysis;
    }
    
    analyzeSQLiteBenchmark(sqliteResults) {
        if (!sqliteResults) return null;
        
        const analysis = {
            tableCompliance: {},
            distributionCompliance: {},
            issues: [],
            score: sqliteResults.score || 0
        };
        
        // Analyze table counts against benchmark
        if (sqliteResults.tableValidations) {
            for (const [table, validation] of Object.entries(sqliteResults.tableValidations)) {
                const benchmark = this.polyglotBenchmark.sqlite[table];
                if (benchmark) {
                    analysis.tableCompliance[table] = {
                        actual: validation.actual,
                        expected: benchmark.expected,
                        deviation: ((validation.actual - benchmark.expected) / benchmark.expected * 100).toFixed(1),
                        compliant: validation.passed,
                        severity: this.getSeverity(validation.actual, benchmark)
                    };
                    
                    if (!validation.passed) {
                        analysis.issues.push({
                            type: 'table_count',
                            table,
                            message: `${table} count ${validation.actual} outside acceptable range ${benchmark.min}-${benchmark.max}`,
                            severity: analysis.tableCompliance[table].severity
                        });
                    }
                }
            }
        }
        
        // Analyze POI type distribution
        if (sqliteResults.poiDistribution) {
            for (const [type, distribution] of Object.entries(sqliteResults.poiDistribution)) {
                const benchmark = this.polyglotBenchmark.sqlite.poiTypes[type];
                if (benchmark) {
                    analysis.distributionCompliance[`poi_${type}`] = {
                        actual: distribution.actual,
                        expected: benchmark.expected,
                        deviation: ((distribution.actual - benchmark.expected) / benchmark.expected * 100).toFixed(1),
                        compliant: distribution.passed,
                        severity: this.getSeverity(distribution.actual, benchmark)
                    };
                    
                    if (!distribution.passed) {
                        analysis.issues.push({
                            type: 'poi_distribution',
                            poiType: type,
                            message: `${type} POI count ${distribution.actual} outside expected range`,
                            severity: analysis.distributionCompliance[`poi_${type}`].severity
                        });
                    }
                }
            }
        }
        
        return analysis;
    }
    
    analyzeNeo4jBenchmark(neo4jResults) {
        if (!neo4jResults) return null;
        
        const analysis = {
            graphCompliance: {},
            crossLanguageCompliance: {},
            issues: [],
            score: neo4jResults.score || 0
        };
        
        // Analyze total counts
        const totalNodes = neo4jResults.summary?.totalNodes || 0;
        const totalRels = neo4jResults.summary?.totalRelationships || 0;
        const ratio = neo4jResults.summary?.relationshipRatio || 0;
        
        analysis.graphCompliance.nodes = {
            actual: totalNodes,
            expected: this.polyglotBenchmark.neo4j.totalNodes.expected,
            compliant: totalNodes >= this.polyglotBenchmark.neo4j.totalNodes.min,
            severity: this.getSeverity(totalNodes, this.polyglotBenchmark.neo4j.totalNodes)
        };
        
        analysis.graphCompliance.relationships = {
            actual: totalRels,
            expected: this.polyglotBenchmark.neo4j.totalRelationships.expected,
            compliant: totalRels >= this.polyglotBenchmark.neo4j.totalRelationships.min,
            severity: this.getSeverity(totalRels, this.polyglotBenchmark.neo4j.totalRelationships)
        };
        
        analysis.graphCompliance.ratio = {
            actual: ratio,
            expected: this.polyglotBenchmark.neo4j.relationshipRatio.expected,
            compliant: ratio >= this.polyglotBenchmark.neo4j.relationshipRatio.min,
            severity: this.getSeverity(ratio, this.polyglotBenchmark.neo4j.relationshipRatio)
        };
        
        // Check for critical graph issues
        if (!analysis.graphCompliance.nodes.compliant) {
            analysis.issues.push({
                type: 'graph_nodes',
                message: `Node count ${totalNodes} below minimum threshold`,
                severity: analysis.graphCompliance.nodes.severity
            });
        }
        
        if (!analysis.graphCompliance.relationships.compliant) {
            analysis.issues.push({
                type: 'graph_relationships',
                message: `Relationship count ${totalRels} below minimum threshold`,
                severity: analysis.graphCompliance.relationships.severity
            });
        }
        
        // Analyze cross-language patterns
        if (neo4jResults.crossLanguageValidations) {
            for (const [pattern, validation] of Object.entries(neo4jResults.crossLanguageValidations)) {
                const benchmark = this.polyglotBenchmark.neo4j.crossLanguage[pattern];
                if (benchmark) {
                    analysis.crossLanguageCompliance[pattern] = {
                        actual: validation.actual,
                        expected: benchmark.expected,
                        compliant: validation.passed,
                        severity: validation.passed ? 'info' : 'warning'
                    };
                    
                    if (!validation.passed) {
                        analysis.issues.push({
                            type: 'cross_language',
                            pattern,
                            message: `Cross-language pattern ${pattern} not detected as expected`,
                            severity: 'warning'
                        });
                    }
                }
            }
        }
        
        return analysis;
    }
    
    getSeverity(actual, benchmark) {
        if (actual < benchmark.min) {
            const deviation = (benchmark.min - actual) / benchmark.expected;
            if (deviation > 0.3) return 'critical';
            if (deviation > 0.15) return 'error';
            return 'warning';
        } else if (actual > benchmark.max) {
            const deviation = (actual - benchmark.max) / benchmark.expected;
            if (deviation > 0.5) return 'warning';
            return 'info';
        }
        return 'info';
    }
    
    async analyzeHistoricalTrends(currentResults) {
        const historyFiles = this.getHistoryFiles();
        if (historyFiles.length < 2) {
            return { 
                available: false, 
                message: 'Insufficient historical data for trend analysis' 
            };
        }
        
        const historicalData = await this.loadHistoricalData(historyFiles.slice(-10)); // Last 10 runs
        
        const trends = {
            available: true,
            scoreProgress: this.calculateTrend(historicalData.map(d => d.overallScore)),
            sqliteProgress: this.calculateTrend(historicalData.map(d => d.sqliteValidation?.score).filter(Boolean)),
            neo4jProgress: this.calculateTrend(historicalData.map(d => d.neo4jValidation?.score).filter(Boolean)),
            executionTimeProgress: this.calculateTrend(historicalData.map(d => d.pipelineExecution?.duration).filter(Boolean)),
            reliability: this.calculateReliability(historicalData)
        };
        
        return trends;
    }
    
    calculateTrend(values) {
        if (values.length < 2) return { trend: 'stable', change: 0 };
        
        const recent = values.slice(-3); // Last 3 values
        const older = values.slice(-6, -3); // Previous 3 values
        
        if (recent.length === 0 || older.length === 0) return { trend: 'stable', change: 0 };
        
        const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
        const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;
        
        const change = ((recentAvg - olderAvg) / olderAvg) * 100;
        
        let trend = 'stable';
        if (change > this.options.thresholds.improvement * 100) trend = 'improving';
        else if (change < -this.options.thresholds.warning * 100) trend = 'declining';
        
        return { trend, change: parseFloat(change.toFixed(2)), recentAvg, olderAvg };
    }
    
    calculateReliability(historicalData) {
        if (historicalData.length < 3) return { reliable: true, message: 'Insufficient data' };
        
        const passRate = historicalData.filter(d => d.passed).length / historicalData.length;
        const scores = historicalData.map(d => d.overallScore);
        const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const scoreVariance = this.calculateVariance(scores);
        
        const reliable = passRate >= 0.9 && scoreVariance < 100; // 90% pass rate, low variance
        
        return {
            reliable,
            passRate: (passRate * 100).toFixed(1),
            averageScore: avgScore.toFixed(1),
            scoreVariance: scoreVariance.toFixed(1),
            consistency: scoreVariance < 50 ? 'high' : scoreVariance < 100 ? 'medium' : 'low'
        };
    }
    
    calculateVariance(values) {
        if (values.length <= 1) return 0;
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    }
    
    async detectRegressions(currentResults) {
        const historyFiles = this.getHistoryFiles();
        if (historyFiles.length < 2) {
            return { detected: false, message: 'No baseline available for regression detection' };
        }
        
        const baseline = await this.loadHistoricalData([historyFiles[historyFiles.length - 2]]); // Previous run
        if (baseline.length === 0) {
            return { detected: false, message: 'Cannot load baseline data' };
        }
        
        const baselineResult = baseline[0];
        const regressions = [];
        const improvements = [];
        
        // Check overall score regression
        const scoreDiff = (currentResults.overallScore - baselineResult.overallScore) / baselineResult.overallScore;
        if (scoreDiff < -this.options.thresholds.regression) {
            regressions.push({
                type: 'overall_score',
                severity: 'critical',
                current: currentResults.overallScore,
                baseline: baselineResult.overallScore,
                change: (scoreDiff * 100).toFixed(1),
                message: `Overall score dropped ${Math.abs(scoreDiff * 100).toFixed(1)}% from previous run`
            });
        } else if (scoreDiff > this.options.thresholds.improvement) {
            improvements.push({
                type: 'overall_score',
                current: currentResults.overallScore,
                baseline: baselineResult.overallScore,
                change: (scoreDiff * 100).toFixed(1),
                message: `Overall score improved ${(scoreDiff * 100).toFixed(1)}% from previous run`
            });
        }
        
        // Check component-specific regressions
        this.checkComponentRegression(currentResults.sqliteValidation, baselineResult.sqliteValidation, 'sqlite', regressions, improvements);
        this.checkComponentRegression(currentResults.neo4jValidation, baselineResult.neo4jValidation, 'neo4j', regressions, improvements);
        
        return {
            detected: regressions.length > 0,
            regressions,
            improvements,
            baseline: {
                timestamp: baselineResult.timestamp || 'unknown',
                score: baselineResult.overallScore
            }
        };
    }
    
    checkComponentRegression(current, baseline, component, regressions, improvements) {
        if (!current || !baseline || !current.score || !baseline.score) return;
        
        const scoreDiff = (current.score - baseline.score) / baseline.score;
        
        if (scoreDiff < -this.options.thresholds.regression) {
            regressions.push({
                type: `${component}_score`,
                severity: scoreDiff < -0.3 ? 'critical' : 'error',
                current: current.score,
                baseline: baseline.score,
                change: (scoreDiff * 100).toFixed(1),
                message: `${component} score dropped ${Math.abs(scoreDiff * 100).toFixed(1)}%`
            });
        } else if (scoreDiff > this.options.thresholds.improvement) {
            improvements.push({
                type: `${component}_score`,
                current: current.score,
                baseline: baseline.score,
                change: (scoreDiff * 100).toFixed(1),
                message: `${component} score improved ${(scoreDiff * 100).toFixed(1)}%`
            });
        }
    }
    
    analyzePerformance(results) {
        const analysis = {
            executionTime: null,
            memoryUsage: null,
            errorRate: null,
            efficiency: null
        };
        
        if (results.pipelineExecution) {
            const duration = results.pipelineExecution.duration;
            const benchmark = this.polyglotBenchmark.performance.executionTime;
            
            analysis.executionTime = {
                actual: duration,
                expected: benchmark.expected,
                acceptable: duration <= benchmark.max,
                efficiency: duration <= benchmark.expected ? 'optimal' : duration <= benchmark.max ? 'acceptable' : 'slow',
                score: Math.max(0, 100 - ((duration - benchmark.expected) / benchmark.expected) * 50)
            };
        }
        
        // Calculate processing efficiency
        if (results.sqliteValidation?.tableValidations?.pois && results.pipelineExecution?.duration) {
            const poisProcessed = results.sqliteValidation.tableValidations.pois.actual;
            const timeMs = results.pipelineExecution.duration;
            const poisPerSecond = (poisProcessed / (timeMs / 1000)).toFixed(2);
            
            analysis.efficiency = {
                poisPerSecond: parseFloat(poisPerSecond),
                throughput: poisPerSecond > 5 ? 'high' : poisPerSecond > 2 ? 'medium' : 'low'
            };
        }
        
        return analysis;
    }
    
    generateRecommendations(comparison, currentResults) {
        const recommendations = [];
        
        // Benchmark compliance recommendations
        if (comparison.benchmarkAnalysis?.sqlite?.issues) {
            for (const issue of comparison.benchmarkAnalysis.sqlite.issues) {
                if (issue.severity === 'critical' || issue.severity === 'error') {
                    recommendations.push({
                        priority: 'high',
                        category: 'data_extraction',
                        issue: issue.type,
                        message: `Critical SQLite issue: ${issue.message}`,
                        action: this.getRecommendationAction(issue)
                    });
                }
            }
        }
        
        if (comparison.benchmarkAnalysis?.neo4j?.issues) {
            for (const issue of comparison.benchmarkAnalysis.neo4j.issues) {
                if (issue.severity === 'critical' || issue.severity === 'error') {
                    recommendations.push({
                        priority: 'high',
                        category: 'graph_building',
                        issue: issue.type,
                        message: `Critical Neo4j issue: ${issue.message}`,
                        action: this.getRecommendationAction(issue)
                    });
                }
            }
        }
        
        // Historical trend recommendations
        if (comparison.historicalAnalysis?.available) {
            const trends = comparison.historicalAnalysis;
            
            if (trends.scoreProgress?.trend === 'declining') {
                recommendations.push({
                    priority: 'medium',
                    category: 'performance',
                    issue: 'declining_performance',
                    message: `Performance declining over time (${trends.scoreProgress.change}% change)`,
                    action: 'Review recent code changes and identify performance regressions'
                });
            }
            
            if (trends.reliability && !trends.reliability.reliable) {
                recommendations.push({
                    priority: 'high',
                    category: 'reliability',
                    issue: 'low_reliability',
                    message: `Low test reliability (${trends.reliability.passRate}% pass rate)`,
                    action: 'Investigate flaky tests and environmental issues'
                });
            }
        }
        
        // Regression recommendations
        if (comparison.regressionAnalysis?.detected) {
            for (const regression of comparison.regressionAnalysis.regressions) {
                recommendations.push({
                    priority: regression.severity === 'critical' ? 'critical' : 'high',
                    category: 'regression',
                    issue: regression.type,
                    message: regression.message,
                    action: 'Investigate recent changes and consider rollback if necessary'
                });
            }
        }
        
        // Performance recommendations
        if (comparison.performanceAnalysis?.executionTime?.efficiency === 'slow') {
            recommendations.push({
                priority: 'medium',
                category: 'performance',
                issue: 'slow_execution',
                message: `Pipeline execution slower than expected (${comparison.performanceAnalysis.executionTime.actual}ms)`,
                action: 'Profile pipeline performance and optimize bottlenecks'
            });
        }
        
        comparison.recommendations = recommendations;
    }
    
    getRecommendationAction(issue) {
        const actions = {
            table_count: 'Review file processing logic and ensure all test files are being analyzed',
            poi_distribution: 'Check POI extraction patterns and LLM analysis quality',
            graph_nodes: 'Verify SQLite to Neo4j data synchronization',
            graph_relationships: 'Review relationship resolution algorithms',
            cross_language: 'Check cross-language relationship detection logic'
        };
        
        return actions[issue.type] || 'Review the specific component mentioned in the issue';
    }
    
    generateAlerts(comparison, currentResults) {
        const alerts = [];
        
        // Critical benchmark failures
        if (comparison.benchmarkAnalysis?.overall?.score < 50) {
            alerts.push({
                severity: 'critical',
                type: 'benchmark_failure',
                message: `Benchmark compliance critically low (${comparison.benchmarkAnalysis.overall.score}/100)`,
                timestamp: new Date().toISOString()
            });
        }
        
        // Pipeline execution failures
        if (!currentResults.pipelineExecution?.success) {
            alerts.push({
                severity: 'critical',
                type: 'execution_failure',
                message: 'Pipeline execution failed',
                details: currentResults.pipelineExecution?.error,
                timestamp: new Date().toISOString()
            });
        }
        
        // Critical regressions
        if (comparison.regressionAnalysis?.regressions) {
            for (const regression of comparison.regressionAnalysis.regressions) {
                if (regression.severity === 'critical') {
                    alerts.push({
                        severity: 'critical',
                        type: 'regression',
                        message: regression.message,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
        
        // Data quality alerts
        const sqliteErrors = currentResults.sqliteValidation?.errors?.length || 0;
        const neo4jErrors = currentResults.neo4jValidation?.errors?.length || 0;
        
        if (sqliteErrors > 5 || neo4jErrors > 5) {
            alerts.push({
                severity: 'warning',
                type: 'data_quality',
                message: `High error count detected (SQLite: ${sqliteErrors}, Neo4j: ${neo4jErrors})`,
                timestamp: new Date().toISOString()
            });
        }
        
        comparison.alerts = alerts;
    }
    
    calculateBenchmarkScore(comparison) {
        let score = 0;
        let components = 0;
        
        if (comparison.benchmarkAnalysis?.sqlite?.score) {
            score += comparison.benchmarkAnalysis.sqlite.score * 0.4;
            components++;
        }
        
        if (comparison.benchmarkAnalysis?.neo4j?.score) {
            score += comparison.benchmarkAnalysis.neo4j.score * 0.4;
            components++;
        }
        
        // Performance score
        if (comparison.performanceAnalysis?.executionTime?.score) {
            score += comparison.performanceAnalysis.executionTime.score * 0.2;
            components++;
        }
        
        return components > 0 ? Math.round(score / components) : 0;
    }
    
    getHistoryFiles() {
        if (!fs.existsSync(this.options.historyDir)) return [];
        
        return fs.readdirSync(this.options.historyDir)
            .filter(file => file.startsWith('pipeline-result-') && file.endsWith('.json'))
            .sort()
            .map(file => path.join(this.options.historyDir, file));
    }
    
    async loadHistoricalData(files) {
        const data = [];
        
        for (const file of files) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const result = JSON.parse(content);
                data.push(result);
            } catch (error) {
                console.warn(`Failed to load historical data from ${file}:`, error.message);
            }
        }
        
        return data.reverse(); // Most recent first
    }
    
    async saveToHistory(results, comparison) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `pipeline-result-${timestamp}.json`;
        const filepath = path.join(this.options.historyDir, filename);
        
        const historyEntry = {
            timestamp: new Date().toISOString(),
            results,
            comparison,
            benchmark: this.polyglotBenchmark
        };
        
        fs.writeFileSync(filepath, JSON.stringify(historyEntry, null, 2));
        
        // Clean up old history files (keep last 50)
        const historyFiles = this.getHistoryFiles();
        if (historyFiles.length > 50) {
            const filesToDelete = historyFiles.slice(0, historyFiles.length - 50);
            for (const file of filesToDelete) {
                try {
                    fs.unlinkSync(file);
                } catch (error) {
                    console.warn(`Failed to delete old history file ${file}:`, error.message);
                }
            }
        }
    }
    
    generateComprehensiveReport(comparison, currentResults) {
        const report = {
            summary: {
                timestamp: comparison.timestamp,
                overallStatus: comparison.benchmarkAnalysis?.overall?.compliant ? 'COMPLIANT' : 'NON_COMPLIANT',
                benchmarkScore: comparison.score,
                criticalIssues: comparison.alerts.filter(a => a.severity === 'critical').length,
                recommendations: comparison.recommendations.length
            },
            benchmarkCompliance: comparison.benchmarkAnalysis,
            historicalTrends: comparison.historicalAnalysis,
            regressionAnalysis: comparison.regressionAnalysis,
            performanceAnalysis: comparison.performanceAnalysis,
            recommendations: comparison.recommendations,
            alerts: comparison.alerts,
            actionItems: this.generateActionItems(comparison)
        };
        
        return report;
    }
    
    generateActionItems(comparison) {
        const actionItems = [];
        
        // High priority items from recommendations
        for (const rec of comparison.recommendations.filter(r => r.priority === 'critical' || r.priority === 'high')) {
            actionItems.push({
                priority: rec.priority,
                category: rec.category,
                action: rec.action,
                dueDate: this.calculateDueDate(rec.priority),
                owner: 'pipeline_team'
            });
        }
        
        // Immediate actions from critical alerts
        for (const alert of comparison.alerts.filter(a => a.severity === 'critical')) {
            actionItems.push({
                priority: 'immediate',
                category: 'incident_response',
                action: `Address critical alert: ${alert.message}`,
                dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
                owner: 'on_call_engineer'
            });
        }
        
        return actionItems;
    }
    
    calculateDueDate(priority) {
        const now = Date.now();
        const durations = {
            critical: 4 * 60 * 60 * 1000,  // 4 hours
            high: 24 * 60 * 60 * 1000,     // 1 day
            medium: 3 * 24 * 60 * 60 * 1000, // 3 days
            low: 7 * 24 * 60 * 60 * 1000   // 1 week
        };
        
        return new Date(now + (durations[priority] || durations.low)).toISOString();
    }
}

module.exports = BenchmarkComparator;

// CLI interface for direct usage
if (require.main === module) {
    const resultFile = process.argv[2];
    if (!resultFile) {
        console.error('Usage: node benchmark_comparator.js <result-file.json>');
        process.exit(1);
    }
    
    if (!fs.existsSync(resultFile)) {
        console.error(`Result file not found: ${resultFile}`);
        process.exit(1);
    }
    
    const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const comparator = new BenchmarkComparator();
    
    comparator.compareResults(results)
        .then(comparison => {
            const report = comparator.generateComprehensiveReport(comparison, results);
            console.log(JSON.stringify(report, null, 2));
        })
        .catch(error => {
            console.error('Benchmark comparison failed:', error);
            process.exit(1);
        });
}