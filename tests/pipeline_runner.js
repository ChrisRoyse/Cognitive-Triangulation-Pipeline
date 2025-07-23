/**
 * Pipeline Runner with State Testing
 * 
 * Orchestrates the complete Cognitive Triangulation Pipeline execution
 * and validates the resulting database states against established benchmarks.
 * 
 * This runner:
 * 1. Cleans previous state
 * 2. Runs the pipeline on polyglot-test directory
 * 3. Validates SQLite and Neo4j states
 * 4. Generates comprehensive reports
 * 5. Determines pass/fail status
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const util = require('util');
const SQLiteStateValidator = require('./sqlite_state_validator');
const Neo4jStateValidator = require('./neo4j_state_validator');

const execAsync = util.promisify(exec);

class PipelineRunner {
    constructor(options = {}) {
        this.options = {
            testDirectory: options.testDirectory || './polyglot-test',
            sqliteDbPath: options.sqliteDbPath || './cognitive_graph.db',
            neo4jUri: options.neo4jUri || 'bolt://localhost:7687',
            neo4jUsername: options.neo4jUsername || 'neo4j',
            neo4jPassword: options.neo4jPassword || process.env.NEO4J_PASSWORD || 'test1234',
            outputDir: options.outputDir || './test-results',
            timeout: options.timeout || 300000, // 5 minutes
            verbose: options.verbose || false,
            skipCleanup: options.skipCleanup || false,
            ...options
        };
        
        this.results = {
            pipelineExecution: {
                started: null,
                completed: null,
                duration: 0,
                success: false,
                error: null,
                output: [],
                processedFiles: 0,
                extractedPois: 0,
                createdRelationships: 0
            },
            sqliteValidation: null,
            neo4jValidation: null,
            overallScore: 0,
            passed: false,
            recommendations: []
        };
        
        this.setupOutputDirectory();
    }
    
    setupOutputDirectory() {
        if (!fs.existsSync(this.options.outputDir)) {
            fs.mkdirSync(this.options.outputDir, { recursive: true });
        }
    }
    
    async run() {
        try {
            this.log('🚀 Starting Cognitive Triangulation Pipeline State Testing');
            
            // Step 1: Pre-flight checks
            await this.preflightChecks();
            
            // Step 2: Clean previous state
            if (!this.options.skipCleanup) {
                await this.cleanPreviousState();
            }
            
            // Step 3: Run the pipeline
            await this.executePipeline();
            
            // Step 4: Validate SQLite state
            await this.validateSqliteState();
            
            // Step 5: Validate Neo4j state  
            await this.validateNeo4jState();
            
            // Step 6: Calculate overall results
            await this.calculateOverallResults();
            
            // Step 7: Generate reports
            await this.generateReports();
            
            this.log(`✅ Pipeline testing completed with score: ${this.results.overallScore}/100`);
            return this.results;
            
        } catch (error) {
            this.log(`❌ Pipeline testing failed: ${error.message}`);
            this.results.passed = false;
            this.results.error = error.message;
            await this.generateReports();
            throw error;
        }
    }
    
    async preflightChecks() {
        this.log('🔍 Running preflight checks...');
        
        // Check test directory exists
        if (!fs.existsSync(this.options.testDirectory)) {
            throw new Error(`Test directory not found: ${this.options.testDirectory}`);
        }
        
        // Check for required files in test directory
        const requiredFiles = [
            'js/server.js',
            'python/ml_service.py', 
            'java/ApiClient.java',
            'database/schema.sql'
        ];
        
        for (const file of requiredFiles) {
            const filePath = path.join(this.options.testDirectory, file);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Required test file not found: ${filePath}`);
            }
        }
        
        // Check Neo4j connectivity
        try {
            const neo4jValidator = new Neo4jStateValidator(
                this.options.neo4jUri, 
                this.options.neo4jUsername, 
                this.options.neo4jPassword
            );
            await neo4jValidator.connect();
            await neo4jValidator.disconnect();
            this.log('✅ Neo4j connectivity confirmed');
        } catch (error) {
            throw new Error(`Neo4j connection failed: ${error.message}`);
        }
        
        // Check pipeline entry point exists
        const entryPoints = ['src/main.js', 'index.js', 'main.js', 'app.js'];
        let entryPoint = null;
        for (const entry of entryPoints) {
            if (fs.existsSync(entry)) {
                entryPoint = entry;
                break;
            }
        }
        
        if (!entryPoint) {
            throw new Error('Pipeline entry point not found (index.js, main.js, or app.js)');
        }
        
        this.pipelineEntryPoint = entryPoint;
        this.log(`✅ Pipeline entry point: ${entryPoint}`);
    }
    
    async cleanPreviousState() {
        this.log('🧹 Cleaning previous state...');
        
        try {
            // Remove SQLite database
            if (fs.existsSync(this.options.sqliteDbPath)) {
                fs.unlinkSync(this.options.sqliteDbPath);
                this.log(`Removed SQLite database: ${this.options.sqliteDbPath}`);
            }
            
            // Clean Neo4j database
            const neo4jValidator = new Neo4jStateValidator(
                this.options.neo4jUri,
                this.options.neo4jUsername,
                this.options.neo4jPassword
            );
            
            await neo4jValidator.connect();
            await neo4jValidator.session.run('MATCH (n) DETACH DELETE n');
            await neo4jValidator.disconnect();
            this.log('Cleared Neo4j database');
            
            // Clean any temporary files or logs
            const tempFiles = ['pipeline.log', 'errors.log', 'debug.log'];
            for (const tempFile of tempFiles) {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            }
            
        } catch (error) {
            this.log(`Warning: Cleanup failed: ${error.message}`);
        }
    }
    
    async executePipeline() {
        this.log('⚙️ Executing Cognitive Triangulation Pipeline...');
        
        this.results.pipelineExecution.started = new Date();
        
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            // Prepare environment variables
            const env = {
                ...process.env,
                NODE_ENV: 'test',
                TEST_MODE: 'true',
                TARGET_DIRECTORY: this.options.testDirectory,
                DB_PATH: this.options.sqliteDbPath,
                NEO4J_URI: this.options.neo4jUri,
                NEO4J_USERNAME: this.options.neo4jUsername,
                NEO4J_PASSWORD: this.options.neo4jPassword
            };
            
            // Start pipeline process
            const pipelineProcess = spawn('node', [this.pipelineEntryPoint, this.options.testDirectory], {
                env,
                stdio: 'pipe',
                timeout: this.options.timeout
            });
            
            let output = '';
            let errorOutput = '';
            
            pipelineProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                this.results.pipelineExecution.output.push(text);
                
                if (this.options.verbose) {
                    process.stdout.write(text);
                }
                
                // Extract progress metrics from output
                this.extractMetricsFromOutput(text);
            });
            
            pipelineProcess.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                this.results.pipelineExecution.output.push(`STDERR: ${text}`);
                
                if (this.options.verbose) {
                    process.stderr.write(text);
                }
            });
            
            pipelineProcess.on('close', (code) => {
                this.results.pipelineExecution.completed = new Date();
                this.results.pipelineExecution.duration = Date.now() - startTime;
                
                if (code === 0) {
                    this.results.pipelineExecution.success = true;
                    this.log(`✅ Pipeline completed successfully in ${this.results.pipelineExecution.duration}ms`);
                    resolve();
                } else {
                    this.results.pipelineExecution.success = false;
                    this.results.pipelineExecution.error = `Pipeline exited with code ${code}`;
                    this.log(`❌ Pipeline failed with exit code ${code}`);
                    this.log(`Error output: ${errorOutput}`);
                    reject(new Error(`Pipeline execution failed with code ${code}`));
                }
            });
            
            pipelineProcess.on('error', (error) => {
                this.results.pipelineExecution.success = false;
                this.results.pipelineExecution.error = error.message;
                this.log(`❌ Pipeline process error: ${error.message}`);
                reject(error);
            });
            
            // Handle timeout
            setTimeout(() => {
                if (!this.results.pipelineExecution.completed) {
                    pipelineProcess.kill('SIGTERM');
                    reject(new Error(`Pipeline execution timed out after ${this.options.timeout}ms`));
                }
            }, this.options.timeout);
        });
    }
    
    extractMetricsFromOutput(output) {
        // Extract file processing count
        const fileMatch = output.match(/Processed (\d+) files?/i);
        if (fileMatch) {
            this.results.pipelineExecution.processedFiles = parseInt(fileMatch[1]);
        }
        
        // Extract POI extraction count
        const poiMatch = output.match(/Extracted (\d+) POIs?/i);
        if (poiMatch) {
            this.results.pipelineExecution.extractedPois = parseInt(poiMatch[1]);
        }
        
        // Extract relationship count
        const relMatch = output.match(/Created (\d+) relationships?/i);
        if (relMatch) {
            this.results.pipelineExecution.createdRelationships = parseInt(relMatch[1]);
        }
    }
    
    async validateSqliteState() {
        this.log('🗃️ Validating SQLite database state...');
        
        if (!fs.existsSync(this.options.sqliteDbPath)) {
            throw new Error(`SQLite database not created: ${this.options.sqliteDbPath}`);
        }
        
        const validator = new SQLiteStateValidator(this.options.sqliteDbPath);
        this.results.sqliteValidation = await validator.validate();
        
        this.log(`SQLite validation score: ${this.results.sqliteValidation.score}/100`);
        
        if (!this.results.sqliteValidation.passed) {
            this.log(`⚠️ SQLite validation failed with ${this.results.sqliteValidation.errors.length} errors`);
            for (const error of this.results.sqliteValidation.errors) {
                this.log(`  - ${error}`);
            }
        }
    }
    
    async validateNeo4jState() {
        this.log('🕸️ Validating Neo4j graph state...');
        
        const validator = new Neo4jStateValidator(
            this.options.neo4jUri,
            this.options.neo4jUsername,
            this.options.neo4jPassword
        );
        
        this.results.neo4jValidation = await validator.validate();
        
        this.log(`Neo4j validation score: ${this.results.neo4jValidation.score}/100`);
        
        if (!this.results.neo4jValidation.passed) {
            this.log(`⚠️ Neo4j validation failed with ${this.results.neo4jValidation.errors.length} errors`);
            for (const error of this.results.neo4jValidation.errors) {
                this.log(`  - ${error}`);
            }
        }
    }
    
    async calculateOverallResults() {
        // Weight the scores: Pipeline execution (20%), SQLite (40%), Neo4j (40%)
        let overallScore = 0;
        
        // Pipeline execution score
        const pipelineScore = this.results.pipelineExecution.success ? 100 : 0;
        overallScore += pipelineScore * 0.2;
        
        // SQLite validation score
        const sqliteScore = this.results.sqliteValidation?.score || 0;
        overallScore += sqliteScore * 0.4;
        
        // Neo4j validation score
        const neo4jScore = this.results.neo4jValidation?.score || 0;
        overallScore += neo4jScore * 0.4;
        
        this.results.overallScore = Math.round(overallScore);
        this.results.passed = this.results.overallScore >= 85 && 
                             this.results.pipelineExecution.success &&
                             (this.results.sqliteValidation?.passed || false) &&
                             (this.results.neo4jValidation?.passed || false);
        
        // Generate recommendations
        this.generateRecommendations();
    }
    
    generateRecommendations() {
        this.results.recommendations = [];
        
        if (!this.results.pipelineExecution.success) {
            this.results.recommendations.push('Fix pipeline execution errors before proceeding with validation');
        }
        
        if (this.results.sqliteValidation && !this.results.sqliteValidation.passed) {
            this.results.recommendations.push('Review SQLite database schema and POI extraction logic');
            
            if (this.results.sqliteValidation.errors.some(e => e.includes('Missing table'))) {
                this.results.recommendations.push('Ensure database initialization scripts are running correctly');
            }
            
            if (this.results.sqliteValidation.errors.some(e => e.includes('count') && e.includes('below minimum'))) {
                this.results.recommendations.push('Investigate low extraction counts - check file processing and POI detection');
            }
        }
        
        if (this.results.neo4jValidation && !this.results.neo4jValidation.passed) {
            this.results.recommendations.push('Review Neo4j graph building and relationship creation logic');
            
            if (this.results.neo4jValidation.errors.some(e => e.includes('ratio'))) {
                this.results.recommendations.push('Check relationship resolution algorithms - ratio may indicate missing relationships');
            }
        }
        
        if (this.results.overallScore < 85) {
            this.results.recommendations.push('Overall score below passing threshold - review all validation errors');
        }
        
        // Specific polyglot-test recommendations
        if (this.results.neo4jValidation?.crossLanguageValidations) {
            const crossLang = this.results.neo4jValidation.crossLanguageValidations;
            
            if (!crossLang.js_to_py_api_calls?.passed) {
                this.results.recommendations.push('JavaScript to Python API call detection needs improvement');
            }
            
            if (!crossLang.sql_to_code_references?.passed) {
                this.results.recommendations.push('SQL schema to code relationship detection needs enhancement');
            }
        }
    }
    
    async generateReports() {
        this.log('📊 Generating comprehensive reports...');
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Main summary report
        const summaryReport = {
            timestamp: new Date().toISOString(),
            testConfiguration: {
                testDirectory: this.options.testDirectory,
                sqliteDbPath: this.options.sqliteDbPath,
                neo4jUri: this.options.neo4jUri,
                timeout: this.options.timeout
            },
            results: this.results,
            benchmarkComparison: this.generateBenchmarkComparison()
        };
        
        const summaryPath = path.join(this.options.outputDir, `pipeline-test-summary-${timestamp}.json`);
        fs.writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
        
        // Detailed validation reports
        if (this.results.sqliteValidation) {
            const sqliteReport = {
                timestamp: new Date().toISOString(),
                ...this.results.sqliteValidation
            };
            const sqlitePath = path.join(this.options.outputDir, `sqlite-validation-${timestamp}.json`);
            fs.writeFileSync(sqlitePath, JSON.stringify(sqliteReport, null, 2));
        }
        
        if (this.results.neo4jValidation) {
            const neo4jReport = {
                timestamp: new Date().toISOString(),
                ...this.results.neo4jValidation
            };
            const neo4jPath = path.join(this.options.outputDir, `neo4j-validation-${timestamp}.json`);
            fs.writeFileSync(neo4jPath, JSON.stringify(neo4jReport, null, 2));
        }
        
        // Generate human-readable summary
        const readableReport = this.generateReadableReport();
        const readablePath = path.join(this.options.outputDir, `test-summary-${timestamp}.md`);
        fs.writeFileSync(readablePath, readableReport);
        
        this.log(`📄 Reports generated in ${this.options.outputDir}/`);
    }
    
    generateBenchmarkComparison() {
        const comparison = {
            expectedVsActual: {},
            deviations: [],
            criticalIssues: []
        };
        
        // SQLite comparisons
        if (this.results.sqliteValidation?.tableValidations) {
            comparison.expectedVsActual.sqlite = {};
            
            for (const [table, validation] of Object.entries(this.results.sqliteValidation.tableValidations)) {
                comparison.expectedVsActual.sqlite[table] = {
                    expected: validation.expected,
                    actual: validation.actual,
                    deviation: ((validation.actual - validation.expected) / validation.expected * 100).toFixed(1) + '%'
                };
                
                const deviationPercent = Math.abs((validation.actual - validation.expected) / validation.expected * 100);
                if (deviationPercent > 20) {
                    comparison.deviations.push(`${table}: ${deviationPercent.toFixed(1)}% deviation from expected`);
                }
                
                if (!validation.passed) {
                    comparison.criticalIssues.push(`${table}: validation failed`);
                }
            }
        }
        
        // Neo4j comparisons
        if (this.results.neo4jValidation) {
            comparison.expectedVsActual.neo4j = {
                totalNodes: {
                    expected: 417,
                    actual: this.results.neo4jValidation.summary?.totalNodes || 0
                },
                totalRelationships: {
                    expected: 870,
                    actual: this.results.neo4jValidation.summary?.totalRelationships || 0
                },
                relationshipRatio: {
                    expected: 2.1,
                    actual: this.results.neo4jValidation.summary?.relationshipRatio || 0
                }
            };
        }
        
        return comparison;
    }
    
    generateReadableReport() {
        const status = this.results.passed ? '✅ PASSED' : '❌ FAILED';
        const score = this.results.overallScore;
        
        let report = `# Cognitive Triangulation Pipeline Test Report\n\n`;
        report += `**Status:** ${status} (Score: ${score}/100)\n`;
        report += `**Timestamp:** ${new Date().toISOString()}\n`;
        report += `**Test Directory:** ${this.options.testDirectory}\n\n`;
        
        // Pipeline Execution Summary
        report += `## Pipeline Execution\n\n`;
        report += `- **Status:** ${this.results.pipelineExecution.success ? '✅ Success' : '❌ Failed'}\n`;
        report += `- **Duration:** ${this.results.pipelineExecution.duration}ms\n`;
        report += `- **Processed Files:** ${this.results.pipelineExecution.processedFiles}\n`;
        report += `- **Extracted POIs:** ${this.results.pipelineExecution.extractedPois}\n`;
        report += `- **Created Relationships:** ${this.results.pipelineExecution.createdRelationships}\n\n`;
        
        // SQLite Validation Summary
        if (this.results.sqliteValidation) {
            report += `## SQLite Database Validation\n\n`;
            report += `- **Score:** ${this.results.sqliteValidation.score}/100\n`;
            report += `- **Status:** ${this.results.sqliteValidation.passed ? '✅ Passed' : '❌ Failed'}\n`;
            report += `- **Errors:** ${this.results.sqliteValidation.errors.length}\n`;
            report += `- **Warnings:** ${this.results.sqliteValidation.warnings.length}\n\n`;
            
            if (this.results.sqliteValidation.tableValidations) {
                report += `### Table Counts\n\n`;
                for (const [table, validation] of Object.entries(this.results.sqliteValidation.tableValidations)) {
                    const status = validation.passed ? '✅' : '❌';
                    report += `- **${table}:** ${status} ${validation.actual} (expected: ${validation.expected})\n`;
                }
                report += '\n';
            }
        }
        
        // Neo4j Validation Summary
        if (this.results.neo4jValidation) {
            report += `## Neo4j Graph Validation\n\n`;
            report += `- **Score:** ${this.results.neo4jValidation.score}/100\n`;
            report += `- **Status:** ${this.results.neo4jValidation.passed ? '✅ Passed' : '❌ Failed'}\n`;
            report += `- **Total Nodes:** ${this.results.neo4jValidation.summary?.totalNodes || 0}\n`;
            report += `- **Total Relationships:** ${this.results.neo4jValidation.summary?.totalRelationships || 0}\n`;
            report += `- **Relationship Ratio:** ${this.results.neo4jValidation.summary?.relationshipRatio?.toFixed(2) || 0}\n\n`;
        }
        
        // Recommendations
        if (this.results.recommendations.length > 0) {
            report += `## Recommendations\n\n`;
            for (const recommendation of this.results.recommendations) {
                report += `- ${recommendation}\n`;
            }
            report += '\n';
        }
        
        // Errors and Warnings
        if (this.results.sqliteValidation?.errors.length > 0 || this.results.neo4jValidation?.errors.length > 0) {
            report += `## Critical Issues\n\n`;
            
            if (this.results.sqliteValidation?.errors) {
                for (const error of this.results.sqliteValidation.errors) {
                    report += `- **SQLite:** ${error}\n`;
                }
            }
            
            if (this.results.neo4jValidation?.errors) {
                for (const error of this.results.neo4jValidation.errors) {
                    report += `- **Neo4j:** ${error}\n`;
                }
            }
        }
        
        return report;
    }
    
    log(message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
    }
}

module.exports = PipelineRunner;

// CLI interface for direct usage
if (require.main === module) {
    const testDirectory = process.argv[2] || './polyglot-test';
    const verbose = process.argv.includes('--verbose');
    const skipCleanup = process.argv.includes('--skip-cleanup');
    
    const runner = new PipelineRunner({
        testDirectory,
        verbose,
        skipCleanup
    });
    
    runner.run()
        .then(results => {
            console.log('\n🎯 Test Results Summary:');
            console.log(`Overall Score: ${results.overallScore}/100`);
            console.log(`Status: ${results.passed ? 'PASSED' : 'FAILED'}`);
            
            if (results.recommendations.length > 0) {
                console.log('\n💡 Recommendations:');
                for (const rec of results.recommendations) {
                    console.log(`  - ${rec}`);
                }
            }
            
            process.exit(results.passed ? 0 : 1);
        })
        .catch(error => {
            console.error('\n💥 Test execution failed:', error.message);
            process.exit(1);
        });
}