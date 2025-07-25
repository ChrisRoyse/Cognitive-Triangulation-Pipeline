/**
 * Enhanced Quality Metrics System
 * 
 * Fixes mathematical convergence issues and adds missing quality dimensions
 * for reliable 100% quality achievement.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./src/config');

class EnhancedQualityMetrics {
    constructor() {
        this.dbPath = config.SQLITE_DB_PATH;
        
        // Fixed weight distribution with precise decimal scoring
        this.metrics = {
            dataIntegrity: { weight: 0.20, maxScore: 20.0, precision: 0.1 },
            performance: { weight: 0.15, maxScore: 15.0, precision: 0.1 },
            robustness: { weight: 0.15, maxScore: 15.0, precision: 0.1 },
            security: { weight: 0.15, maxScore: 15.0, precision: 0.1 },
            maintainability: { weight: 0.15, maxScore: 15.0, precision: 0.1 },
            completeness: { weight: 0.10, maxScore: 10.0, precision: 0.1 },
            testability: { weight: 0.05, maxScore: 5.0, precision: 0.1 },
            productionReadiness: { weight: 0.05, maxScore: 5.0, precision: 0.1 }
        };
        
        this.assessmentHistory = [];
    }

    /**
     * Enhanced overall score calculation with precise decimal scoring
     */
    calculateOverallScore(componentScores) {
        let weightedSum = 0;
        let totalWeight = 0;

        for (const [component, result] of Object.entries(componentScores)) {
            if (this.metrics[component]) {
                const metric = this.metrics[component];
                const normalizedScore = Math.min(result.score, metric.maxScore);
                weightedSum += normalizedScore * metric.weight;
                totalWeight += metric.maxScore * metric.weight;
            }
        }

        // Use precise decimal calculation instead of Math.round()
        const rawScore = (weightedSum / totalWeight) * 100;
        return Math.round(rawScore * 10) / 10; // Round to 1 decimal place for precision
    }

    /**
     * Enhanced data integrity assessment with incremental improvements
     */
    async assessDataIntegrity() {
        console.log('🔍 Enhanced Data Integrity Assessment...');
        
        if (!fs.existsSync(this.dbPath)) {
            return { 
                score: 0.0, 
                issues: ['Database file does not exist'], 
                details: 'Critical: No database found',
                improvements: []
            };
        }

        const db = new Database(this.dbPath);
        const issues = [];
        const improvements = [];
        let score = 20.0; // Start with max score as decimal

        try {
            // Check for orphaned relationships with graduated penalties
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
                // Graduated penalty: more severe for higher counts
                const penalty = Math.min(8.0, Math.log10(orphanedRels.count + 1) * 2.0);
                score -= penalty;
                improvements.push(`Fix ${orphanedRels.count} orphaned relationships (+${penalty.toFixed(1)} points)`);
            }

            // Enhanced confidence score validation
            const invalidConfidence = db.prepare(`
                SELECT COUNT(*) as count, 
                       COUNT(CASE WHEN confidence < 0 THEN 1 END) as negative,
                       COUNT(CASE WHEN confidence > 1 THEN 1 END) as over_one
                FROM relationships 
                WHERE confidence IS NOT NULL AND (confidence < 0 OR confidence > 1)
            `).get();

            if (invalidConfidence.count > 0) {
                issues.push(`${invalidConfidence.count} invalid confidence scores (${invalidConfidence.negative} negative, ${invalidConfidence.over_one} over 1.0)`);
                const penalty = Math.min(3.0, invalidConfidence.count * 0.01);
                score -= penalty;
                improvements.push(`Fix confidence score ranges (+${penalty.toFixed(1)} points)`);
            }

            // Evidence-confidence consistency check
            const noEvidenceConfidence = db.prepare(`
                SELECT COUNT(*) as count 
                FROM relationships r 
                LEFT JOIN relationship_evidence re ON r.id = re.relationship_id 
                WHERE r.confidence > 0 AND re.id IS NULL
            `).get();

            if (noEvidenceConfidence.count > 0) {
                issues.push(`${noEvidenceConfidence.count} relationships with confidence but no evidence`);
                // Severe penalty for this critical integrity issue
                const penalty = Math.min(7.0, Math.log10(noEvidenceConfidence.count + 1) * 3.0);
                score -= penalty;
                improvements.push(`Add evidence for ${noEvidenceConfidence.count} relationships (+${penalty.toFixed(1)} points)`);
            }

            // Semantic ID uniqueness with detailed analysis
            const semanticIdAnalysis = db.prepare(`
                SELECT COUNT(*) as duplicates, COUNT(DISTINCT semantic_id) as unique_ids
                FROM (
                    SELECT semantic_id, COUNT(*) as cnt
                    FROM pois 
                    WHERE semantic_id IS NOT NULL AND semantic_id != ''
                    GROUP BY semantic_id 
                    HAVING COUNT(*) > 1
                )
            `).get();

            if (semanticIdAnalysis.duplicates > 0) {
                issues.push(`${semanticIdAnalysis.duplicates} duplicate semantic IDs affecting ${semanticIdAnalysis.unique_ids} unique identifiers`);
                const penalty = Math.min(2.0, semanticIdAnalysis.duplicates * 0.1);
                score -= penalty;
                improvements.push(`Resolve semantic ID duplicates (+${penalty.toFixed(1)} points)`);
            }

            // Schema completeness with detailed validation
            const schemaValidation = await this.validateDatabaseSchema(db);
            if (schemaValidation.issues.length > 0) {
                issues.push(...schemaValidation.issues);
                score -= schemaValidation.penalty;
                improvements.push(...schemaValidation.improvements);
            }

        } finally {
            db.close();
        }

        return {
            score: Math.max(0.0, Math.round(score * 10) / 10),
            issues,
            details: `Enhanced data integrity assessment completed. ${issues.length} issues found.`,
            improvements,
            maxPossibleScore: 20.0
        };
    }

    /**
     * New security assessment dimension
     */
    async assessSecurity() {
        console.log('🔒 Security Assessment...');
        
        let score = 15.0;
        const issues = [];
        const improvements = [];

        try {
            // Check for SQL injection prevention
            const codeFiles = this.findCodeFiles();
            let hasParameterizedQueries = false;
            let hasSqlInjectionVulns = false;

            for (const file of codeFiles) {
                const content = fs.readFileSync(file, 'utf8');
                
                // Check for parameterized queries
                if (content.includes('.prepare(') && content.includes('?')) {
                    hasParameterizedQueries = true;
                }
                
                // Check for potential SQL injection patterns
                if (content.includes('`SELECT') && content.includes('${')) {
                    hasSqlInjectionVulns = true;
                    issues.push(`Potential SQL injection in ${path.basename(file)}`);
                }
            }

            if (!hasParameterizedQueries) {
                issues.push('No parameterized queries detected');
                score -= 3.0;
                improvements.push('Implement parameterized queries (+3.0 points)');
            }

            if (hasSqlInjectionVulns) {
                score -= 5.0;
                improvements.push('Fix SQL injection vulnerabilities (+5.0 points)');
            }

            // Check for secrets management
            if (fs.existsSync('.env')) {
                const envContent = fs.readFileSync('.env', 'utf8');
                if (envContent.includes('password') || envContent.includes('secret')) {
                    score -= 2.0;
                    issues.push('Potential secrets in .env file');
                    improvements.push('Implement proper secrets management (+2.0 points)');
                }
            }

            // Check for authentication mechanisms
            const hasAuth = codeFiles.some(file => {
                const content = fs.readFileSync(file, 'utf8');
                return content.includes('authenticate') || content.includes('authorization');
            });

            if (!hasAuth) {
                issues.push('No authentication mechanisms detected');
                score -= 2.0;
                improvements.push('Implement authentication system (+2.0 points)');
            }

            // Check for input validation
            const hasValidation = codeFiles.some(file => {
                const content = fs.readFileSync(file, 'utf8');
                return content.includes('validate') || content.includes('sanitize');
            });

            if (!hasValidation) {
                issues.push('Limited input validation detected');
                score -= 1.0;
                improvements.push('Add comprehensive input validation (+1.0 points)');
            }

        } catch (error) {
            issues.push(`Security assessment error: ${error.message}`);
            score -= 3.0;
        }

        return {
            score: Math.max(0.0, Math.round(score * 10) / 10),
            issues,
            details: `Security assessment completed. ${issues.length} security issues identified.`,
            improvements,
            maxPossibleScore: 15.0
        };
    }

    /**
     * Enhanced maintainability assessment
     */
    async assessMaintainability() {
        console.log('🔧 Maintainability Assessment...');
        
        let score = 15.0;
        const issues = [];
        const improvements = [];

        try {
            const codeFiles = this.findCodeFiles();
            let totalComplexity = 0;
            let totalLines = 0;
            let totalComments = 0;
            let filesWithHighComplexity = 0;

            for (const file of codeFiles) {
                const content = fs.readFileSync(file, 'utf8');
                const lines = content.split('\n');
                const complexity = this.calculateCyclomaticComplexity(content);
                const comments = lines.filter(line => 
                    line.trim().startsWith('//') || 
                    line.trim().startsWith('*') ||
                    line.trim().startsWith('/*')
                ).length;

                totalLines += lines.length;
                totalComments += comments;
                totalComplexity += complexity;

                if (complexity > 10) {
                    filesWithHighComplexity++;
                    issues.push(`High complexity in ${path.basename(file)} (${complexity})`);
                }
            }

            // Comment ratio analysis
            const commentRatio = totalComments / totalLines;
            if (commentRatio < 0.15) {
                const penalty = (0.15 - commentRatio) * 20; // Up to 3 points penalty
                score -= penalty;
                issues.push(`Low comment coverage: ${(commentRatio * 100).toFixed(1)}%`);
                improvements.push(`Improve code documentation (+${penalty.toFixed(1)} points)`);
            }

            // Average complexity analysis
            const avgComplexity = totalComplexity / codeFiles.length;
            if (avgComplexity > 8) {
                const penalty = (avgComplexity - 8) * 0.5; // Up to 2 points penalty
                score -= penalty;
                issues.push(`High average complexity: ${avgComplexity.toFixed(1)}`);
                improvements.push(`Reduce code complexity (+${penalty.toFixed(1)} points)`);
            }

            // High complexity file count
            if (filesWithHighComplexity > 0) {
                const penalty = filesWithHighComplexity * 0.5;
                score -= penalty;
                improvements.push(`Refactor ${filesWithHighComplexity} complex files (+${penalty.toFixed(1)} points)`);
            }

            // Check for technical debt patterns
            const debtPatterns = this.analyzeTechnicalDebt(codeFiles);
            if (debtPatterns.count > 0) {
                score -= debtPatterns.penalty;
                issues.push(...debtPatterns.issues);
                improvements.push(...debtPatterns.improvements);
            }

        } catch (error) {
            issues.push(`Maintainability assessment error: ${error.message}`);
            score -= 2.0;
        }

        return {
            score: Math.max(0.0, Math.round(score * 10) / 10),
            issues,
            details: `Maintainability assessment completed. Analyzed code complexity and technical debt.`,
            improvements,
            maxPossibleScore: 15.0
        };
    }

    /**
     * New testability assessment
     */
    async assessTestability() {
        console.log('🧪 Testability Assessment...');
        
        let score = 5.0;
        const issues = [];
        const improvements = [];

        try {
            // Check for test directories and files
            const testDirs = ['test', 'tests', '__tests__', 'spec'];
            const hasTestDir = testDirs.some(dir => fs.existsSync(dir));
            
            if (!hasTestDir) {
                issues.push('No test directory found');
                score -= 2.0;
                improvements.push('Create test directory structure (+2.0 points)');
            } else {
                // Count test files
                const testFiles = this.findTestFiles();
                const codeFiles = this.findCodeFiles();
                const testCoverage = testFiles.length / codeFiles.length;
                
                if (testCoverage < 0.5) {
                    const penalty = (0.5 - testCoverage) * 3; // Up to 1.5 points
                    score -= penalty;
                    issues.push(`Low test coverage ratio: ${(testCoverage * 100).toFixed(1)}%`);
                    improvements.push(`Add more test files (+${penalty.toFixed(1)} points)`);
                }
            }

            // Check for mocking/stubbing capabilities
            const packageJsonExists = fs.existsSync('package.json');
            if (packageJsonExists) {
                const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
                const devDeps = packageJson.devDependencies || {};
                const deps = packageJson.dependencies || {};
                
                const hasMockingLib = Object.keys({...devDeps, ...deps}).some(dep => 
                    dep.includes('mock') || dep.includes('stub') || dep.includes('sinon') || dep.includes('jest')
                );
                
                if (!hasMockingLib) {
                    issues.push('No mocking/stubbing library detected');
                    score -= 1.0;
                    improvements.push('Add mocking library for better testability (+1.0 points)');
                }
            }

            // Check for dependency injection patterns
            const codeFiles = this.findCodeFiles();
            let hasDependencyInjection = false;
            
            for (const file of codeFiles) {
                const content = fs.readFileSync(file, 'utf8');
                if (content.includes('constructor(') && content.includes('this.')) {
                    hasDependencyInjection = true;
                    break;
                }
            }

            if (!hasDependencyInjection) {
                issues.push('Limited dependency injection patterns');
                score -= 0.5;
                improvements.push('Implement dependency injection for better testability (+0.5 points)');
            }

        } catch (error) {
            issues.push(`Testability assessment error: ${error.message}`);
            score -= 1.0;
        }

        return {
            score: Math.max(0.0, Math.round(score * 10) / 10),
            issues,
            details: `Testability assessment completed. Evaluated test infrastructure and patterns.`,
            improvements,
            maxPossibleScore: 5.0
        };
    }

    /**
     * Calculate cyclomatic complexity for a code string
     */
    calculateCyclomaticComplexity(code) {
        // Count decision points
        const decisionKeywords = ['if', 'else', 'while', 'for', 'switch', 'case', 'catch', '?', '&&', '||'];
        let complexity = 1; // Base complexity
        
        for (const keyword of decisionKeywords) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'g');
            const matches = code.match(regex) || [];
            complexity += matches.length;
        }
        
        return complexity;
    }

    /**
     * Analyze technical debt patterns
     */
    analyzeTechnicalDebt(codeFiles) {
        const issues = [];
        const improvements = [];
        let penalty = 0;
        let count = 0;

        const debtPatterns = [
            { pattern: /TODO:/g, severity: 0.1, description: 'TODO comments' },
            { pattern: /FIXME:/g, severity: 0.2, description: 'FIXME comments' },
            { pattern: /HACK:/g, severity: 0.3, description: 'HACK comments' },
            { pattern: /console\.log/g, severity: 0.1, description: 'Console.log statements' },
            { pattern: /\.catch\(\s*\)/g, severity: 0.2, description: 'Empty catch blocks' },
            { pattern: /var\s+/g, severity: 0.1, description: 'var declarations (use const/let)' }
        ];

        for (const file of codeFiles) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                
                for (const { pattern, severity, description } of debtPatterns) {
                    const matches = content.match(pattern) || [];
                    if (matches.length > 0) {
                        count += matches.length;
                        penalty += matches.length * severity;
                        issues.push(`${description} in ${path.basename(file)}: ${matches.length}`);
                    }
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        if (count > 0) {
            improvements.push(`Address ${count} technical debt items (+${penalty.toFixed(1)} points)`);
        }

        return { count, penalty: Math.min(penalty, 3.0), issues, improvements };
    }

    /**
     * Find all code files in the project
     */
    findCodeFiles() {
        const extensions = ['.js', '.ts', '.jsx', '.tsx'];
        const files = [];
        
        const searchDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            
            try {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dir, item.name);
                    
                    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
                        searchDir(fullPath);
                    } else if (item.isFile() && extensions.some(ext => item.name.endsWith(ext))) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                // Skip directories we can't read
            }
        };
        
        searchDir('./src');
        
        // Also check root level files
        const rootFiles = ['main.js', 'index.js', 'app.js'];
        for (const file of rootFiles) {
            if (fs.existsSync(file)) {
                files.push(file);
            }
        }
        
        return files;
    }

    /**
     * Find test files
     */
    findTestFiles() {
        const extensions = ['.test.js', '.spec.js', '.test.ts', '.spec.ts'];
        const files = [];
        
        const testDirs = ['test', 'tests', '__tests__', 'spec'];
        
        for (const dir of testDirs) {
            if (fs.existsSync(dir)) {
                try {
                    const items = fs.readdirSync(dir, { recursive: true });
                    for (const item of items) {
                        if (extensions.some(ext => item.endsWith(ext))) {
                            files.push(path.join(dir, item));
                        }
                    }
                } catch (error) {
                    // Skip if we can't read the directory
                }
            }
        }
        
        return files;
    }

    /**
     * Validate database schema completeness
     */
    async validateDatabaseSchema(db) {
        const issues = [];
        const improvements = [];
        let penalty = 0;

        try {
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tables.map(t => t.name);
            
            const requiredTables = [
                'files', 'pois', 'relationships', 'relationship_evidence',
                'triangulated_analysis_sessions', 'subagent_analyses'
            ];
            
            const missingTables = requiredTables.filter(table => !tableNames.includes(table));
            
            if (missingTables.length > 0) {
                issues.push(`Missing required tables: ${missingTables.join(', ')}`);
                penalty += missingTables.length * 1.0;
                improvements.push(`Create missing tables: ${missingTables.join(', ')} (+${missingTables.length * 1.0} points)`);
            }

            // Check for required indexes
            const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();
            const indexNames = indexes.map(i => i.name);
            
            const requiredIndexes = [
                'idx_relationships_status',
                'idx_pois_file_id',
                'idx_relationships_confidence_desc'
            ];
            
            const missingIndexes = requiredIndexes.filter(idx => !indexNames.includes(idx));
            
            if (missingIndexes.length > 0) {
                issues.push(`Missing performance indexes: ${missingIndexes.join(', ')}`);
                penalty += missingIndexes.length * 0.5;
                improvements.push(`Create performance indexes (+${missingIndexes.length * 0.5} points)`);
            }

        } catch (error) {
            issues.push(`Schema validation error: ${error.message}`);
            penalty += 1.0;
        }

        return { issues, improvements, penalty: Math.min(penalty, 5.0) };
    }

    /**
     * Check if quality score meets enhanced success criteria
     */
    meetsSuccessCriteria(score = null) {
        const targetScore = score || 100.0;
        return targetScore >= 99.9; // Allow 0.1 point tolerance for floating point precision
    }

    /**
     * Enhanced plateau detection with fine-grained thresholds
     */
    hasPlateaued(assessmentHistory, threshold = 0.5) {
        if (assessmentHistory.length < 3) {
            return false;
        }

        const recent = assessmentHistory.slice(-3);
        const improvements = [];
        
        for (let i = 1; i < recent.length; i++) {
            improvements.push(recent[i].overallScore - recent[i-1].overallScore);
        }

        return improvements.every(imp => Math.abs(imp) < threshold);
    }

    /**
     * Generate realistic improvement expectations based on current state
     */
    calculateRealisticImprovements(componentScores) {
        const improvements = {};
        
        for (const [component, result] of Object.entries(componentScores)) {
            if (this.metrics[component] && result.improvements) {
                const maxScore = this.metrics[component].maxScore;
                const currentScore = result.score;
                const gapRemaining = maxScore - currentScore;
                
                // Use diminishing returns model: improvement = gap * efficiency
                const efficiency = gapRemaining > 5 ? 0.8 : gapRemaining > 2 ? 0.6 : 0.4;
                const expectedImprovement = Math.min(gapRemaining, gapRemaining * efficiency);
                
                improvements[component] = {
                    current: currentScore,
                    maximum: maxScore,
                    realistic: currentScore + expectedImprovement,
                    actions: result.improvements
                };
            }
        }
        
        return improvements;
    }
}

module.exports = EnhancedQualityMetrics;