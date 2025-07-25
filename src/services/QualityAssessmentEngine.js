/**
 * Quality Assessment Engine
 * 
 * Automated quality scoring (1-100) for data consistency with comprehensive metrics.
 * Implements gap identification algorithms and quality tracking across iterations.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

class QualityAssessmentEngine {
    constructor() {
        this.dbPath = config.SQLITE_DB_PATH;
        this.metrics = {
            dataIntegrity: { weight: 0.25, maxScore: 25 },
            performance: { weight: 0.20, maxScore: 20 },
            robustness: { weight: 0.20, maxScore: 20 },
            completeness: { weight: 0.15, maxScore: 15 },
            productionReadiness: { weight: 0.10, maxScore: 10 },
            documentation: { weight: 0.10, maxScore: 10 }
        };
        this.assessmentHistory = [];
    }

    /**
     * Main assessment method - calculates overall quality score
     */
    async assessDataConsistency() {
        const timestamp = new Date().toISOString();
        console.log(`🎯 [QualityAssessment] Starting comprehensive quality assessment at ${timestamp}`);

        const scores = {
            dataIntegrity: await this.assessDataIntegrity(),
            performance: await this.assessPerformance(),
            robustness: await this.assessRobustness(),
            completeness: await this.assessCompleteness(),
            productionReadiness: await this.assessProductionReadiness(),
            documentation: await this.assessDocumentation()
        };

        const overallScore = this.calculateOverallScore(scores);
        const gaps = this.identifyQualityGaps(scores);

        const assessment = {
            timestamp,
            overallScore,
            componentScores: scores,
            qualityGaps: gaps,
            recommendations: this.generateRecommendations(gaps),
            iterationMetrics: this.calculateIterationMetrics()
        };

        this.assessmentHistory.push(assessment);
        await this.persistAssessment(assessment);

        console.log(`📊 [QualityAssessment] Overall Score: ${overallScore}/100`);
        return assessment;
    }

    /**
     * Data Integrity Assessment (25% weight)
     * Checks for orphaned records, valid constraints, schema consistency
     */
    async assessDataIntegrity() {
        console.log('🔍 Assessing Data Integrity...');
        
        if (!fs.existsSync(this.dbPath)) {
            return { score: 0, issues: ['Database file does not exist'], details: 'Critical: No database found' };
        }

        const db = new Database(this.dbPath);
        const issues = [];
        let score = 25; // Start with max score

        try {
            // Check for orphaned relationships (most critical)
            const orphanedRels = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND (sp.id IS NULL OR tp.id IS NULL)
            `).get();

            if (orphanedRels.count > 0) {
                issues.push(`${orphanedRels.count} orphaned relationships`);
                score -= Math.min(10, orphanedRels.count * 0.5); // Max 10 points deduction
            }

            // Check confidence score validity
            const invalidConfidence = db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE confidence IS NOT NULL AND (confidence < 0 OR confidence > 1)
            `).get();

            if (invalidConfidence.count > 0) {
                issues.push(`${invalidConfidence.count} invalid confidence scores`);
                score -= Math.min(5, invalidConfidence.count * 0.2);
            }

            // Check for relationships with confidence but no evidence
            const noEvidenceConfidence = db.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships r 
                LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                WHERE r.confidence > 0 AND re.id IS NULL
            `).get();

            if (noEvidenceConfidence.count > 0) {
                issues.push(`${noEvidenceConfidence.count} relationships with confidence but no evidence`);
                score -= Math.min(5, noEvidenceConfidence.count * 0.1);
            }

            // Check for duplicate semantic IDs
            const duplicateSemanticIds = db.prepare(`
                SELECT COUNT(*) as count FROM (
                    SELECT semantic_id
                    FROM pois 
                    WHERE semantic_id IS NOT NULL AND semantic_id != ''
                    GROUP BY semantic_id 
                    HAVING COUNT(*) > 1
                )
            `).get();

            if (duplicateSemanticIds.count > 0) {
                issues.push(`${duplicateSemanticIds.count} duplicate semantic IDs`);
                score -= Math.min(3, duplicateSemanticIds.count * 0.1);
            }

            // Check schema completeness
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const requiredTables = [
                'files', 'pois', 'relationships', 'relationship_evidence',
                'triangulated_analysis_sessions', 'subagent_analyses'
            ];
            
            const missingTables = requiredTables.filter(table => 
                !tables.some(t => t.name === table)
            );

            if (missingTables.length > 0) {
                issues.push(`Missing tables: ${missingTables.join(', ')}`);
                score -= missingTables.length * 2;
            }

        } finally {
            db.close();
        }

        return {
            score: Math.max(0, score),
            issues,
            details: `Data integrity check completed. ${issues.length} issues found.`
        };
    }

    /**
     * Performance Assessment (20% weight)
     * Measures processing speed, memory usage, query performance
     */
    async assessPerformance() {
        console.log('⚡ Assessing Performance...');
        
        let score = 20;
        const issues = [];
        const startTime = Date.now();

        if (!fs.existsSync(this.dbPath)) {
            return { score: 0, issues: ['No database to assess'], details: 'Cannot assess performance without database' };
        }

        const db = new Database(this.dbPath);

        try {
            // Test query performance on relationships
            const perfStart = Date.now();
            const relCount = db.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get();
            const queryTime = Date.now() - perfStart;

            if (queryTime > 1000) {
                issues.push(`Slow relationship query: ${queryTime}ms`);
                score -= Math.min(5, queryTime / 200); // Deduct based on slowness
            }

            // Check for missing indexes
            const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();
            const criticalIndexes = [
                'idx_relationships_status',
                'idx_pois_file_id',
                'idx_relationships_confidence_desc'
            ];

            const missingIndexes = criticalIndexes.filter(idx => 
                !indexes.some(i => i.name === idx)
            );

            if (missingIndexes.length > 0) {
                issues.push(`Missing performance indexes: ${missingIndexes.join(', ')}`);
                score -= missingIndexes.length * 2;
            }

            // Check database size efficiency
            const dbStats = fs.statSync(this.dbPath);
            const dbSizeMB = dbStats.size / (1024 * 1024);
            
            if (relCount.count > 0) {
                const avgSizePerRel = dbSizeMB / relCount.count;
                if (avgSizePerRel > 0.1) { // More than 100KB per relationship seems excessive
                    issues.push(`High storage overhead: ${avgSizePerRel.toFixed(3)}MB per relationship`);
                    score -= Math.min(3, avgSizePerRel * 10);
                }
            }

            // Test transaction performance
            const txnStart = Date.now();
            db.transaction(() => {
                db.prepare("SELECT 1").get();
            })();
            const txnTime = Date.now() - txnStart;

            if (txnTime > 100) {
                issues.push(`Slow transaction performance: ${txnTime}ms`);
                score -= Math.min(2, txnTime / 50);
            }

        } finally {
            db.close();
        }

        const totalTime = Date.now() - startTime;
        
        return {
            score: Math.max(0, score),
            issues,
            details: `Performance assessment completed in ${totalTime}ms. Database size: ${(fs.statSync(this.dbPath).size / (1024 * 1024)).toFixed(2)}MB`
        };
    }

    /**
     * Robustness Assessment (20% weight)
     * Tests edge case handling, error recovery, fault tolerance
     */
    async assessRobustness() {
        console.log('🛡️ Assessing Robustness...');
        
        let score = 20;
        const issues = [];

        // Check error handling in consistency fixes
        const DataConsistencyFixer = require('../../fix-data-consistency-issues.js');
        
        try {
            // Test with edge cases
            const tempDbPath = './test-robustness-' + Date.now() + '.db';
            const tempDb = new Database(tempDbPath);
            
            // Create minimal schema for testing
            tempDb.exec(`
                CREATE TABLE relationships (id INTEGER PRIMARY KEY, status TEXT, confidence REAL);
                CREATE TABLE pois (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO relationships (status, confidence) VALUES ('VALIDATED', -0.5);
                INSERT INTO relationships (status, confidence) VALUES ('VALIDATED', 1.5);
            `);
            tempDb.close();

            // Test if fixer handles edge cases gracefully
            const originalDbPath = config.SQLITE_DB_PATH;
            config.SQLITE_DB_PATH = tempDbPath;
            
            const fixer = new DataConsistencyFixer();
            await fixer.analyzeAndFixConfidenceScoring();
            
            config.SQLITE_DB_PATH = originalDbPath;
            
            // Clean up test database
            if (fs.existsSync(tempDbPath)) {
                fs.unlinkSync(tempDbPath);
            }

            // Check for proper error handling patterns in source code
            const fixerSource = fs.readFileSync('../../fix-data-consistency-issues.js', 'utf8');
            
            if (!fixerSource.includes('try {') || !fixerSource.includes('catch')) {
                issues.push('Missing proper error handling in data consistency fixer');
                score -= 5;
            }

            if (!fixerSource.includes('finally {')) {
                issues.push('Missing resource cleanup in database operations');
                score -= 3;
            }

        } catch (error) {
            issues.push(`Robustness test failed: ${error.message}`);
            score -= 7;
        }

        // Check for circuit breaker patterns
        if (fs.existsSync('./src/utils/circuitBreaker.js')) {
            score += 2; // Bonus for having circuit breaker
        } else {
            issues.push('Missing circuit breaker for external service calls');
            score -= 2;
        }

        // Check for retry mechanisms
        const configSource = fs.readFileSync('./src/config.js', 'utf8');
        if (!configSource.includes('RETRY') && !configSource.includes('retry')) {
            issues.push('Missing retry configuration');
            score -= 2;
        }

        return {
            score: Math.max(0, score),
            issues,
            details: `Robustness assessment completed. Tested error handling, edge cases, and fault tolerance.`
        };
    }

    /**
     * Completeness Assessment (15% weight)
     * Ensures all requirements are addressed
     */
    async assessCompleteness() {
        console.log('📋 Assessing Completeness...');
        
        let score = 15;
        const issues = [];

        // Check if all required components exist
        const requiredFiles = [
            './fix-data-consistency-issues.js',
            './validate-consistency-fixes.js',
            './src/agents/GraphBuilder_optimized.js'
        ];

        for (const file of requiredFiles) {
            if (!fs.existsSync(file)) {
                issues.push(`Missing required file: ${file}`);
                score -= 3;
            }
        }

        // Check if database consistency features are implemented
        if (fs.existsSync(this.dbPath)) {
            const db = new Database(this.dbPath);
            
            try {
                // Check for evidence tracking
                const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
                const hasEvidenceTracking = tables.some(t => t.name === 'relationship_evidence');
                
                if (!hasEvidenceTracking) {
                    issues.push('Missing evidence tracking system');
                    score -= 4;
                }

                // Check for triangulation support
                const hasTriangulation = tables.some(t => t.name === 'triangulated_analysis_sessions');
                
                if (!hasTriangulation) {
                    issues.push('Missing triangulation system');
                    score -= 3;
                }

            } finally {
                db.close();
            }
        }

        // Check for iterative improvement components (that we're implementing)
        const iterativeComponents = [
            './src/services/QualityAssessmentEngine.js',
            './src/services/ParallelTaskCoordinator.js',
            './src/services/IterativeQualitySystem.js',
            './src/monitoring/ContinuousImprovementMonitor.js'
        ];

        const missingIterativeComponents = iterativeComponents.filter(comp => !fs.existsSync(comp));
        if (missingIterativeComponents.length > 0) {
            issues.push(`Missing iterative improvement components: ${missingIterativeComponents.length}/${iterativeComponents.length}`);
            score -= missingIterativeComponents.length;
        }

        return {
            score: Math.max(0, score),
            issues,
            details: `Completeness assessment finished. ${requiredFiles.length - issues.length}/${requiredFiles.length} core files present.`
        };
    }

    /**
     * Production Readiness Assessment (10% weight)
     * Checks monitoring, deployment safety, configuration
     */
    async assessProductionReadiness() {
        console.log('🚀 Assessing Production Readiness...');
        
        let score = 10;
        const issues = [];

        // Check for configuration management
        if (!fs.existsSync('./src/config.js')) {
            issues.push('Missing configuration management');
            score -= 3;
        }

        // Check for environment variable usage
        if (fs.existsSync('./.env.example')) {
            score += 1; // Bonus for having environment template
        } else {
            issues.push('Missing environment configuration template');
            score -= 1;
        }

        // Check for logging capabilities
        const hasLogging = fs.existsSync('./src/utils/logger.js') || 
                          fs.readFileSync('./src/config.js', 'utf8').includes('LOG_LEVEL');
        
        if (!hasLogging) {
            issues.push('Missing logging configuration');
            score -= 2;
        }

        // Check for monitoring/health checks
        const hasMonitoring = fs.existsSync('./src/monitoring/') ||
                             fs.existsSync('./src/utils/healthCheck.js');
        
        if (!hasMonitoring) {
            issues.push('Missing monitoring capabilities');
            score -= 2;
        }

        // Check for graceful shutdown handling
        const mainFiles = ['./src/main.js', './main.js'];
        let hasGracefulShutdown = false;
        
        for (const mainFile of mainFiles) {
            if (fs.existsSync(mainFile)) {
                const content = fs.readFileSync(mainFile, 'utf8');
                if (content.includes('SIGTERM') || content.includes('SIGINT')) {
                    hasGracefulShutdown = true;
                    break;
                }
            }
        }

        if (!hasGracefulShutdown) {
            issues.push('Missing graceful shutdown handling');
            score -= 1;
        }

        // Check for database migration system
        const hasMigrations = fs.existsSync('./migrations/') ||
                             fs.existsSync('./src/utils/migrationManager.js');
        
        if (!hasMigrations) {
            issues.push('Missing database migration system');
            score -= 1;
        }

        return {
            score: Math.max(0, score),
            issues,
            details: `Production readiness assessment completed. Key infrastructure components evaluated.`
        };
    }

    /**
     * Documentation Assessment (10% weight)
     * Evaluates documentation quality and completeness
     */
    async assessDocumentation() {
        console.log('📚 Assessing Documentation...');
        
        let score = 10;
        const issues = [];

        // Check for README
        if (!fs.existsSync('./README.md')) {
            issues.push('Missing README.md');
            score -= 3;
        }

        // Check for API documentation
        if (!fs.existsSync('./docs/') && !fs.existsSync('./API.md')) {
            issues.push('Missing API documentation');
            score -= 2;
        }

        // Check for inline code comments in critical files
        const criticalFiles = [
            './fix-data-consistency-issues.js',
            './validate-consistency-fixes.js'
        ];

        for (const file of criticalFiles) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf8');
                const commentLines = (content.match(/^\s*(\*|\/\/)/gm) || []).length;
                const totalLines = content.split('\n').length;
                const commentRatio = commentLines / totalLines;

                if (commentRatio < 0.1) {
                    issues.push(`Low comment coverage in ${path.basename(file)}`);
                    score -= 1;
                }
            }
        }

        // Check for troubleshooting guides
        const hasTroubleshooting = fs.existsSync('./TROUBLESHOOTING.md') ||
                                  fs.existsSync('./docs/troubleshooting/') ||
                                  fs.readdirSync('./docs/', { withFileTypes: true })
                                    .some(dirent => dirent.isFile() && dirent.name.toLowerCase().includes('troubleshoot'));

        if (!hasTroubleshooting) {
            issues.push('Missing troubleshooting documentation');
            score -= 1;
        }

        // Check for examples
        const hasExamples = fs.existsSync('./examples/') ||
                           fs.existsSync('./EXAMPLES.md');

        if (!hasExamples) {
            issues.push('Missing usage examples');
            score -= 1;
        }

        return {
            score: Math.max(0, score),
            issues,
            details: `Documentation assessment completed. Evaluated README, API docs, comments, and examples.`
        };
    }

    /**
     * Calculate overall score from component scores
     */
    calculateOverallScore(scores) {
        let totalScore = 0;
        let totalWeight = 0;

        for (const [component, result] of Object.entries(scores)) {
            if (this.metrics[component]) {
                totalScore += result.score;
                totalWeight += this.metrics[component].maxScore;
            }
        }

        return Math.round((totalScore / totalWeight) * 100);
    }

    /**
     * Identify quality gaps that need attention
     */
    identifyQualityGaps(scores) {
        const gaps = [];

        for (const [component, result] of Object.entries(scores)) {
            const metric = this.metrics[component];
            if (metric && result.score < metric.maxScore * 0.8) { // Less than 80% of max
                gaps.push({
                    component,
                    currentScore: result.score,
                    maxScore: metric.maxScore,
                    gap: metric.maxScore - result.score,
                    priority: this.calculateGapPriority(component, result),
                    issues: result.issues
                });
            }
        }

        return gaps.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Calculate priority for addressing a quality gap
     */
    calculateGapPriority(component, result) {
        const weight = this.metrics[component].weight;
        const gapSize = this.metrics[component].maxScore - result.score;
        const issueCount = result.issues.length;
        
        return (weight * 100) + (gapSize * 10) + issueCount;
    }

    /**
     * Generate recommendations based on quality gaps
     */
    generateRecommendations(gaps) {
        const recommendations = [];

        for (const gap of gaps) {
            switch (gap.component) {
                case 'dataIntegrity':
                    recommendations.push({
                        priority: 'HIGH',
                        action: 'Run data consistency fixes immediately',
                        component: gap.component,
                        expectedImprovement: gap.gap * 0.8,
                        automated: true
                    });
                    break;
                    
                case 'performance':
                    recommendations.push({
                        priority: 'MEDIUM',
                        action: 'Create missing database indexes and optimize queries',
                        component: gap.component,
                        expectedImprovement: gap.gap * 0.6,
                        automated: true
                    });
                    break;
                    
                case 'robustness':
                    recommendations.push({
                        priority: 'MEDIUM',
                        action: 'Implement additional error handling and circuit breakers',
                        component: gap.component,
                        expectedImprovement: gap.gap * 0.5,
                        automated: false
                    });
                    break;
                    
                case 'completeness':
                    recommendations.push({
                        priority: 'HIGH',
                        action: 'Implement missing components identified in assessment',
                        component: gap.component,
                        expectedImprovement: gap.gap * 0.9,
                        automated: false
                    });
                    break;
                    
                case 'productionReadiness':
                    recommendations.push({
                        priority: 'LOW',
                        action: 'Add monitoring, logging, and deployment safety features',
                        component: gap.component,
                        expectedImprovement: gap.gap * 0.4,
                        automated: false
                    });
                    break;
                    
                case 'documentation':
                    recommendations.push({
                        priority: 'LOW',
                        action: 'Create missing documentation and improve code comments',
                        component: gap.component,
                        expectedImprovement: gap.gap * 0.3,
                        automated: false
                    });
                    break;
            }
        }

        return recommendations.sort((a, b) => {
            const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });
    }

    /**
     * Calculate iteration metrics for progress tracking
     */
    calculateIterationMetrics() {
        if (this.assessmentHistory.length < 2) {
            return { improvement: 0, velocity: 0, trend: 'initial' };
        }

        const current = this.assessmentHistory[this.assessmentHistory.length - 1];
        const previous = this.assessmentHistory[this.assessmentHistory.length - 2];
        
        const improvement = current.overallScore - previous.overallScore;
        const timeElapsed = new Date(current.timestamp) - new Date(previous.timestamp);
        const velocity = timeElapsed > 0 ? improvement / (timeElapsed / 1000 / 60) : 0; // points per minute

        let trend = 'stable';
        if (improvement > 2) trend = 'improving';
        else if (improvement < -2) trend = 'declining';

        return { improvement, velocity, trend, timeElapsed };
    }

    /**
     * Persist assessment results to disk for tracking
     */
    async persistAssessment(assessment) {
        const assessmentDir = './quality-assessments';
        if (!fs.existsSync(assessmentDir)) {
            fs.mkdirSync(assessmentDir, { recursive: true });
        }

        const filename = `assessment-${Date.now()}.json`;
        const filepath = path.join(assessmentDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(assessment, null, 2));
        
        // Also update the latest assessment
        fs.writeFileSync(
            path.join(assessmentDir, 'latest.json'),
            JSON.stringify(assessment, null, 2)
        );

        console.log(`📄 Assessment saved to: ${filepath}`);
    }

    /**
     * Load assessment history from disk
     */
    async loadAssessmentHistory() {
        const assessmentDir = './quality-assessments';
        if (!fs.existsSync(assessmentDir)) {
            return;
        }

        const files = fs.readdirSync(assessmentDir)
            .filter(f => f.startsWith('assessment-') && f.endsWith('.json'))
            .sort();

        this.assessmentHistory = files.map(file => {
            const content = fs.readFileSync(path.join(assessmentDir, file), 'utf8');
            return JSON.parse(content);
        });

        console.log(`📚 Loaded ${this.assessmentHistory.length} previous assessments`);
    }

    /**
     * Get the latest assessment results
     */
    getLatestAssessment() {
        if (this.assessmentHistory.length === 0) {
            return null;
        }
        return this.assessmentHistory[this.assessmentHistory.length - 1];
    }

    /**
     * Check if quality score meets success criteria
     */
    meetsSuccessCriteria(score = null) {
        const targetScore = score || this.getLatestAssessment()?.overallScore || 0;
        return targetScore >= 100;
    }

    /**
     * Check if quality score has plateaued (stopped improving)
     */
    hasPlateaued(threshold = 1) {
        if (this.assessmentHistory.length < 3) {
            return false;
        }

        const recent = this.assessmentHistory.slice(-3);
        const improvements = [];
        
        for (let i = 1; i < recent.length; i++) {
            improvements.push(recent[i].overallScore - recent[i-1].overallScore);
        }

        return improvements.every(imp => Math.abs(imp) < threshold);
    }
}

module.exports = QualityAssessmentEngine;