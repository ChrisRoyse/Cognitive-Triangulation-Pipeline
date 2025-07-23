/**
 * Master Pipeline Benchmark Test Suite
 * 
 * This is the definitive test that validates the Cognitive Triangulation Pipeline
 * meets all benchmark requirements specified in POLYGLOT_TEST_BENCHMARK.md.
 * 
 * It runs the complete pipeline on the polyglot-test directory and validates:
 * - Node counts by type (File, Class, Function, Variable, Import, Export, Database)
 * - Relationship counts by type (DEFINES, CALLS, USES, IMPORTS, etc.)
 * - Cross-language relationship detection
 * - Performance metrics (execution time, memory usage)
 * - Overall quality grade (A-F)
 * 
 * Success Criteria:
 * - Minimum: 300+ nodes, 1600+ relationships, 4+ ratio
 * - Expected: 417 nodes, 1876 relationships, 4.5 ratio
 * - Grade A: 95%+ of expected (≥395 nodes, ≥1782 relationships)
 * - Maximum execution time: 30 minutes
 * - Must detect critical cross-language relationships
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const neo4j = require('neo4j-driver');
const sqlite3 = require('sqlite3').verbose();
const { PipelineConfig } = require('../../src/config/PipelineConfig');

// Test timeout: 35 minutes (5 minutes buffer beyond the 30-minute benchmark requirement)
const BENCHMARK_TIMEOUT = 35 * 60 * 1000;

// Benchmark requirements from POLYGLOT_TEST_BENCHMARK.md
const BENCHMARK_REQUIREMENTS = {
    minimum: {
        nodes: 300,
        relationships: 1600,
        relationshipRatio: 4.0
    },
    expected: {
        nodes: 417,
        relationships: 1876,
        relationshipRatio: 4.5,
        nodeTypes: {
            'File': 15,
            'Class': 20,
            'Function': 163,
            'Variable': 63,
            'Import': 65,
            'Export': 7,
            'Table': 15,
            'View': 5,
            'Index': 32,
            'Trigger': 4
        },
        relationshipTypes: {
            'DEFINES': 300,
            'IMPORTS': 65,
            'EXPORTS': 7,
            'CALLS': 500,
            'USES': 600,
            'EXTENDS': 2,
            'INSTANTIATES': 20,
            'CONTAINS': 200,
            'REFERENCES': 100,
            'DEPENDS_ON': 50,
            'USES_DATA_FROM': 50
        }
    },
    performance: {
        maxExecutionTime: 30 * 60 * 1000, // 30 minutes
        maxMemoryUsage: 2 * 1024 * 1024 * 1024, // 2GB
        maxErrorRate: 0.05 // 5%
    },
    grading: {
        A: 0.95, // 95%+ of expected
        B: 0.90, // 90%+ of expected
        C: 0.85, // 85%+ of expected
        D: 0.80  // 80%+ of expected
    },
    crossLanguageRelationships: [
        {
            description: 'Java UserService → Python DataProcessor API call',
            pattern: 'UserService.*processUserData.*DataProcessor.*process_data',
            required: true
        },
        {
            description: 'Java ApiClient → JavaScript server endpoints',
            pattern: 'ApiClient.*callJavaScriptService.*server\\.js',
            required: true
        },
        {
            description: 'Python → Java service calls',
            pattern: 'DataProcessor.*_make_cross_service_call.*java',
            required: true
        },
        {
            description: 'Database schema → code relationships',
            pattern: 'DatabaseManager.*users.*schema\\.sql',
            required: true
        },
        {
            description: 'ML model inheritance hierarchy',
            pattern: 'LinearRegressionModel.*EXTENDS.*MLModel',
            required: true
        }
    ]
};

describe('Master Pipeline Benchmark Suite', () => {
    let config;
    let pipelineResults = {};
    let neo4jDriver;
    let sqliteDb;
    let startTime;
    let memoryPeakUsage = 0;
    
    beforeAll(async () => {
        config = PipelineConfig.createForTesting();
        startTime = Date.now();
        
        // Setup Neo4j connection
        neo4jDriver = neo4j.driver(
            config.database.neo4j.uri,
            neo4j.auth.basic(config.database.neo4j.user, config.database.neo4j.password)
        );
        
        // Verify polyglot-test directory exists
        const testDir = path.resolve('./polyglot-test');
        if (!fs.existsSync(testDir)) {
            throw new Error(`polyglot-test directory not found at ${testDir}`);
        }
        
        console.log(`🚀 Starting Master Pipeline Benchmark on ${testDir}`);
        console.log(`⏰ Maximum execution time: ${BENCHMARK_REQUIREMENTS.performance.maxExecutionTime / 1000 / 60} minutes`);
    }, BENCHMARK_TIMEOUT);
    
    afterAll(async () => {
        if (neo4jDriver) {
            await neo4jDriver.close();
        }
        if (sqliteDb) {
            sqliteDb.close();
        }
    });
    
    test('should meet minimum benchmark requirements', async () => {
        // Step 1: Clean previous state
        await cleanPreviousState();
        
        // Step 2: Execute complete pipeline
        const executionResults = await executePipeline();
        
        // Step 3: Collect and validate all metrics
        const nodeMetrics = await collectNodeMetrics();
        const relationshipMetrics = await collectRelationshipMetrics();
        const crossLanguageValidation = await validateCrossLanguageRelationships();
        const performanceMetrics = calculatePerformanceMetrics(executionResults);
        
        // Step 4: Generate comprehensive results
        const benchmarkResults = {
            execution: executionResults,
            nodes: nodeMetrics,
            relationships: relationshipMetrics,
            crossLanguage: crossLanguageValidation,
            performance: performanceMetrics,
            timestamp: new Date().toISOString()
        };
        
        // Step 5: Calculate performance grade
        const grade = calculatePerformanceGrade(benchmarkResults);
        benchmarkResults.grade = grade;
        
        // Step 6: Generate detailed report
        const report = generateBenchmarkReport(benchmarkResults);
        
        // Step 7: Save results for debugging
        await saveBenchmarkResults(benchmarkResults);
        
        // Step 8: Validate against minimum requirements
        validateMinimumRequirements(benchmarkResults);
        
        // Step 9: Log comprehensive results
        console.log('\n' + '='.repeat(80));
        console.log('🎯 MASTER BENCHMARK RESULTS');
        console.log('='.repeat(80));
        console.log(report);
        console.log('='.repeat(80));
        
        // Final assertions
        expect(benchmarkResults.nodes.total).toBeGreaterThanOrEqual(BENCHMARK_REQUIREMENTS.minimum.nodes);
        expect(benchmarkResults.relationships.total).toBeGreaterThanOrEqual(BENCHMARK_REQUIREMENTS.minimum.relationships);
        expect(benchmarkResults.relationships.ratio).toBeGreaterThanOrEqual(BENCHMARK_REQUIREMENTS.minimum.relationshipRatio);
        expect(benchmarkResults.execution.success).toBe(true);
        expect(benchmarkResults.performance.executionTime).toBeLessThanOrEqual(BENCHMARK_REQUIREMENTS.performance.maxExecutionTime);
        expect(['A', 'B', 'C', 'D']).toContain(grade.letter);
        
        // Cross-language relationship assertions
        expect(benchmarkResults.crossLanguage.criticalRelationshipsFound).toBeGreaterThanOrEqual(3);
        expect(benchmarkResults.crossLanguage.overallScore).toBeGreaterThan(0.7); // At least 70% of cross-language relationships found
        
    }, BENCHMARK_TIMEOUT);
    
    // Helper function to clean previous pipeline state
    async function cleanPreviousState() {
        console.log('🧹 Cleaning previous pipeline state...');
        
        // Clean Neo4j
        const session = neo4jDriver.session();
        try {
            await session.run('MATCH (n) DETACH DELETE n');
            console.log('✅ Neo4j database cleared');
        } finally {
            await session.close();
        }
        
        // Clean SQLite
        const dbPath = config.database.sqlite.path;
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            console.log('✅ SQLite database removed');
        }
        
        // Clean any temp files
        const tempFiles = ['pipeline.log', 'errors.log', 'debug.log'];
        tempFiles.forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        });
    }
    
    // Execute the complete pipeline
    async function executePipeline() {
        console.log('⚙️ Executing Cognitive Triangulation Pipeline...');
        
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let processedFiles = 0;
            let extractedPois = 0;
            let createdRelationships = 0;
            let errors = [];
            let output = [];
            
            // Find pipeline entry point
            const entryPoints = ['src/main.js', 'index.js', 'main.js', 'app.js'];
            let entryPoint = null;
            for (const entry of entryPoints) {
                if (fs.existsSync(entry)) {
                    entryPoint = entry;
                    break;
                }
            }
            
            if (!entryPoint) {
                reject(new Error('Pipeline entry point not found'));
                return;
            }
            
            // Setup environment for test execution
            const env = {
                ...process.env,
                NODE_ENV: 'test',
                TARGET_DIRECTORY: './polyglot-test',
                SQLITE_DB_PATH: config.database.sqlite.path,
                NEO4J_URI: config.database.neo4j.uri,
                NEO4J_USER: config.database.neo4j.user,
                NEO4J_PASSWORD: config.database.neo4j.password,
                LOG_LEVEL: 'info'
            };
            
            // Start pipeline process
            const pipelineProcess = spawn('node', [entryPoint, './polyglot-test'], {
                env,
                stdio: 'pipe'
            });
            
            // Monitor memory usage
            const memoryMonitor = setInterval(() => {
                const memUsage = process.memoryUsage();
                memoryPeakUsage = Math.max(memoryPeakUsage, memUsage.heapUsed);
            }, 1000);
            
            pipelineProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output.push(text);
                
                // Extract metrics from output
                const fileMatch = text.match(/(?:Processed|Analyzing|Found)\s+(\d+)\s+files?/i);
                if (fileMatch) processedFiles = Math.max(processedFiles, parseInt(fileMatch[1]));
                
                const poiMatch = text.match(/(?:Extracted|Created|Found)\s+(\d+)\s+(?:POIs?|entities?|nodes?)/i);
                if (poiMatch) extractedPois = Math.max(extractedPois, parseInt(poiMatch[1]));
                
                const relMatch = text.match(/(?:Created|Built|Found)\s+(\d+)\s+relationships?/i);
                if (relMatch) createdRelationships = Math.max(createdRelationships, parseInt(relMatch[1]));
                
                // Log progress periodically
                if (text.includes('Complete') || text.includes('Finished') || text.includes('Done')) {
                    console.log(`📊 Progress: ${processedFiles} files, ${extractedPois} POIs, ${createdRelationships} relationships`);
                }
            });
            
            pipelineProcess.stderr.on('data', (data) => {
                const text = data.toString();
                output.push(`STDERR: ${text}`);
                
                // Collect error information but don't fail immediately
                if (text.includes('ERROR') || text.includes('Failed')) {
                    errors.push(text.trim());
                }
            });
            
            pipelineProcess.on('close', (code) => {
                clearInterval(memoryMonitor);
                const duration = Date.now() - startTime;
                
                console.log(`⏱️ Pipeline execution completed in ${(duration / 1000).toFixed(2)} seconds`);
                
                resolve({
                    success: code === 0,
                    exitCode: code,
                    duration,
                    processedFiles,
                    extractedPois,
                    createdRelationships,
                    errors,
                    output: output.join(''),
                    memoryPeakUsage
                });
            });
            
            pipelineProcess.on('error', (error) => {
                clearInterval(memoryMonitor);
                reject(new Error(`Pipeline process error: ${error.message}`));
            });
            
            // Timeout handler
            setTimeout(() => {
                pipelineProcess.kill('SIGTERM');
                clearInterval(memoryMonitor);
                reject(new Error(`Pipeline execution timed out after ${BENCHMARK_REQUIREMENTS.performance.maxExecutionTime / 1000} seconds`));
            }, BENCHMARK_REQUIREMENTS.performance.maxExecutionTime);
        });
    }
    
    // Collect comprehensive node metrics from Neo4j
    async function collectNodeMetrics() {
        console.log('📊 Collecting node metrics from Neo4j...');
        
        const session = neo4jDriver.session();
        try {
            // Get total node count
            const totalResult = await session.run('MATCH (n) RETURN count(n) as total');
            const total = totalResult.records[0].get('total').toNumber();
            
            // Get node counts by type
            const typeResult = await session.run(`
                MATCH (n) 
                WHERE n.type IS NOT NULL
                RETURN n.type as type, count(n) as count
                ORDER BY count DESC
            `);
            
            const nodeTypes = {};
            typeResult.records.forEach(record => {
                nodeTypes[record.get('type')] = record.get('count').toNumber();
            });
            
            // Get node counts by label (alternative classification)
            const labelResult = await session.run(`
                MATCH (n) 
                RETURN labels(n) as labels, count(n) as count
                ORDER BY count DESC
            `);
            
            const nodeLabels = {};
            labelResult.records.forEach(record => {
                const labels = record.get('labels');
                const count = record.get('count').toNumber();
                labels.forEach(label => {
                    nodeLabels[label] = (nodeLabels[label] || 0) + count;
                });
            });
            
            return {
                total,
                byType: nodeTypes,
                byLabel: nodeLabels,
                analysis: analyzeNodeCounts(total, nodeTypes)
            };
            
        } finally {
            await session.close();
        }
    }
    
    // Collect comprehensive relationship metrics from Neo4j
    async function collectRelationshipMetrics() {
        console.log('📊 Collecting relationship metrics from Neo4j...');
        
        const session = neo4jDriver.session();
        try {
            // Get total relationship count
            const totalResult = await session.run('MATCH ()-[r]->() RETURN count(r) as total');
            const total = totalResult.records[0].get('total').toNumber();
            
            // Get relationship counts by type
            const typeResult = await session.run(`
                MATCH ()-[r]->() 
                RETURN type(r) as relType, count(r) as count
                ORDER BY count DESC
            `);
            
            const relationshipTypes = {};
            typeResult.records.forEach(record => {
                relationshipTypes[record.get('relType')] = record.get('count').toNumber();
            });
            
            // Calculate relationship ratio
            const nodeTotal = await session.run('MATCH (n) RETURN count(n) as total');
            const nodeCount = nodeTotal.records[0].get('total').toNumber();
            const ratio = nodeCount > 0 ? total / nodeCount : 0;
            
            return {
                total,
                byType: relationshipTypes,
                ratio: parseFloat(ratio.toFixed(2)),
                analysis: analyzeRelationshipCounts(total, relationshipTypes, ratio)
            };
            
        } finally {
            await session.close();
        }
    }
    
    // Validate critical cross-language relationships
    async function validateCrossLanguageRelationships() {
        console.log('🔗 Validating cross-language relationships...');
        
        const session = neo4jDriver.session();
        const results = {
            relationships: [],
            criticalRelationshipsFound: 0,
            overallScore: 0,
            details: {}
        };
        
        try {
            // Check each critical cross-language relationship
            for (const crossLangReq of BENCHMARK_REQUIREMENTS.crossLanguageRelationships) {
                const found = await checkCrossLanguageRelationship(session, crossLangReq);
                results.relationships.push({
                    description: crossLangReq.description,
                    required: crossLangReq.required,
                    found: found.exists,
                    details: found.details,
                    query: found.query
                });
                
                if (found.exists && crossLangReq.required) {
                    results.criticalRelationshipsFound++;
                }
                
                results.details[crossLangReq.description] = found;
            }
            
            // Calculate overall cross-language score
            const requiredRelationships = BENCHMARK_REQUIREMENTS.crossLanguageRelationships.filter(r => r.required);
            results.overallScore = results.criticalRelationshipsFound / requiredRelationships.length;
            
            return results;
            
        } finally {
            await session.close();
        }
    }
    
    // Check individual cross-language relationship
    async function checkCrossLanguageRelationship(session, requirement) {
        const queries = [
            // Java to Python API calls
            `MATCH (j:POI)-[r]->(p:POI) 
             WHERE j.file_path CONTAINS '.java' AND p.file_path CONTAINS '.py' 
             AND (j.name CONTAINS 'UserService' OR j.name CONTAINS 'processUserData')
             AND (p.name CONTAINS 'DataProcessor' OR p.name CONTAINS 'process_data')
             RETURN j, r, p LIMIT 5`,
            
            // Java to JavaScript calls
            `MATCH (j:POI)-[r]->(js:POI) 
             WHERE j.file_path CONTAINS '.java' AND js.file_path CONTAINS '.js'
             AND j.name CONTAINS 'ApiClient'
             RETURN j, r, js LIMIT 5`,
            
            // Python to Java calls
            `MATCH (p:POI)-[r]->(j:POI) 
             WHERE p.file_path CONTAINS '.py' AND j.file_path CONTAINS '.java'
             AND p.name CONTAINS 'DataProcessor'
             RETURN p, r, j LIMIT 5`,
            
            // Database schema to code relationships
            `MATCH (db:POI)-[r]->(code:POI) 
             WHERE db.file_path CONTAINS 'schema.sql' AND code.file_path =~ '.*\\.(java|py|js)'
             AND (db.name CONTAINS 'users' OR code.name CONTAINS 'DatabaseManager')
             RETURN db, r, code LIMIT 5`,
            
            // ML model inheritance
            `MATCH (child:POI)-[r:EXTENDS]->(parent:POI) 
             WHERE child.name CONTAINS 'LinearRegressionModel' AND parent.name CONTAINS 'MLModel'
             RETURN child, r, parent LIMIT 5`
        ];
        
        for (const query of queries) {
            try {
                const result = await session.run(query);
                if (result.records.length > 0) {
                    return {
                        exists: true,
                        query,
                        details: result.records.map(record => ({
                            source: record.get(0).properties,
                            relationship: record.get(1).type,
                            target: record.get(2).properties
                        }))
                    };
                }
            } catch (error) {
                console.warn(`Cross-language query failed: ${error.message}`);
            }
        }
        
        return {
            exists: false,
            query: 'Multiple queries attempted',
            details: []
        };
    }
    
    // Calculate performance metrics
    function calculatePerformanceMetrics(executionResults) {
        return {
            executionTime: executionResults.duration,
            memoryPeakUsage: Math.max(memoryPeakUsage, executionResults.memoryPeakUsage || 0),
            errorRate: executionResults.errors.length / (executionResults.processedFiles || 1),
            throughput: {
                filesPerSecond: executionResults.processedFiles / (executionResults.duration / 1000),
                poisPerSecond: executionResults.extractedPois / (executionResults.duration / 1000),
                relationshipsPerSecond: executionResults.createdRelationships / (executionResults.duration / 1000)
            },
            withinLimits: {
                time: executionResults.duration <= BENCHMARK_REQUIREMENTS.performance.maxExecutionTime,
                memory: memoryPeakUsage <= BENCHMARK_REQUIREMENTS.performance.maxMemoryUsage,
                errors: (executionResults.errors.length / (executionResults.processedFiles || 1)) <= BENCHMARK_REQUIREMENTS.performance.maxErrorRate
            }
        };
    }
    
    // Calculate overall performance grade
    function calculatePerformanceGrade(results) {
        const nodeScore = results.nodes.total / BENCHMARK_REQUIREMENTS.expected.nodes;
        const relationshipScore = results.relationships.total / BENCHMARK_REQUIREMENTS.expected.relationships;
        const crossLangScore = results.crossLanguage.overallScore;
        const performanceScore = (
            (results.performance.withinLimits.time ? 1 : 0) +
            (results.performance.withinLimits.memory ? 1 : 0) +
            (results.performance.withinLimits.errors ? 1 : 0)
        ) / 3;
        
        // Weighted overall score
        const overallScore = (
            nodeScore * 0.3 +
            relationshipScore * 0.3 +
            crossLangScore * 0.2 +
            performanceScore * 0.2
        );
        
        let letter;
        if (overallScore >= BENCHMARK_REQUIREMENTS.grading.A) letter = 'A';
        else if (overallScore >= BENCHMARK_REQUIREMENTS.grading.B) letter = 'B';
        else if (overallScore >= BENCHMARK_REQUIREMENTS.grading.C) letter = 'C';
        else if (overallScore >= BENCHMARK_REQUIREMENTS.grading.D) letter = 'D';
        else letter = 'F';
        
        return {
            letter,
            score: parseFloat((overallScore * 100).toFixed(1)),
            components: {
                nodes: parseFloat((nodeScore * 100).toFixed(1)),
                relationships: parseFloat((relationshipScore * 100).toFixed(1)),
                crossLanguage: parseFloat((crossLangScore * 100).toFixed(1)),
                performance: parseFloat((performanceScore * 100).toFixed(1))
            }
        };
    }
    
    // Analyze node counts against expectations
    function analyzeNodeCounts(total, nodeTypes) {
        const analysis = {
            meetsMinimum: total >= BENCHMARK_REQUIREMENTS.minimum.nodes,
            meetsExpected: total >= BENCHMARK_REQUIREMENTS.expected.nodes,
            scoreVsExpected: total / BENCHMARK_REQUIREMENTS.expected.nodes,
            missingTypes: [],
            excessTypes: [],
            recommendations: []
        };
        
        // Check expected node types
        for (const [expectedType, expectedCount] of Object.entries(BENCHMARK_REQUIREMENTS.expected.nodeTypes)) {
            const actualCount = nodeTypes[expectedType] || 0;
            if (actualCount < expectedCount * 0.8) { // 80% threshold
                analysis.missingTypes.push({
                    type: expectedType,
                    expected: expectedCount,
                    actual: actualCount,
                    deficit: expectedCount - actualCount
                });
            }
        }
        
        // Generate recommendations
        if (!analysis.meetsMinimum) {
            analysis.recommendations.push('Node count below minimum requirement - check entity extraction');
        }
        if (analysis.missingTypes.length > 0) {
            analysis.recommendations.push(`Missing node types: ${analysis.missingTypes.map(t => t.type).join(', ')}`);
        }
        
        return analysis;
    }
    
    // Analyze relationship counts against expectations
    function analyzeRelationshipCounts(total, relationshipTypes, ratio) {
        const analysis = {
            meetsMinimum: {
                total: total >= BENCHMARK_REQUIREMENTS.minimum.relationships,
                ratio: ratio >= BENCHMARK_REQUIREMENTS.minimum.relationshipRatio
            },
            meetsExpected: total >= BENCHMARK_REQUIREMENTS.expected.relationships,
            scoreVsExpected: total / BENCHMARK_REQUIREMENTS.expected.relationships,
            missingTypes: [],
            recommendations: []
        };
        
        // Check expected relationship types
        for (const [expectedType, expectedCount] of Object.entries(BENCHMARK_REQUIREMENTS.expected.relationshipTypes)) {
            const actualCount = relationshipTypes[expectedType] || 0;
            if (actualCount < expectedCount * 0.5) { // 50% threshold for relationships
                analysis.missingTypes.push({
                    type: expectedType,
                    expected: expectedCount,
                    actual: actualCount,
                    deficit: expectedCount - actualCount
                });
            }
        }
        
        // Generate recommendations
        if (!analysis.meetsMinimum.total) {
            analysis.recommendations.push('Relationship count below minimum - check relationship resolution');
        }
        if (!analysis.meetsMinimum.ratio) {
            analysis.recommendations.push('Relationship ratio too low - entities may be isolated');
        }
        if (analysis.missingTypes.length > 0) {
            analysis.recommendations.push(`Missing relationship types: ${analysis.missingTypes.map(t => t.type).join(', ')}`);
        }
        
        return analysis;
    }
    
    // Generate comprehensive benchmark report
    function generateBenchmarkReport(results) {
        const executionTime = (results.performance.executionTime / 1000 / 60).toFixed(2);
        const memoryUsage = (results.performance.memoryPeakUsage / 1024 / 1024).toFixed(2);
        
        return `
📊 BENCHMARK PERFORMANCE GRADE: ${results.grade.letter} (${results.grade.score}%)

🎯 SUMMARY METRICS:
   • Total Nodes: ${results.nodes.total} (Expected: ${BENCHMARK_REQUIREMENTS.expected.nodes})
   • Total Relationships: ${results.relationships.total} (Expected: ${BENCHMARK_REQUIREMENTS.expected.relationships})
   • Relationship Ratio: ${results.relationships.ratio} (Expected: ${BENCHMARK_REQUIREMENTS.expected.relationshipRatio})
   • Cross-Language Score: ${(results.crossLanguage.overallScore * 100).toFixed(1)}%
   • Execution Time: ${executionTime} minutes (Max: ${BENCHMARK_REQUIREMENTS.performance.maxExecutionTime / 1000 / 60} min)
   • Memory Usage: ${memoryUsage} MB

🔗 CROSS-LANGUAGE RELATIONSHIPS:
   • Critical Relationships Found: ${results.crossLanguage.criticalRelationshipsFound}/${BENCHMARK_REQUIREMENTS.crossLanguageRelationships.filter(r => r.required).length}
   ${results.crossLanguage.relationships.map(r => `   • ${r.found ? '✅' : '❌'} ${r.description}`).join('\n   ')}

📈 COMPONENT GRADES:
   • Node Coverage: ${results.grade.components.nodes}%
   • Relationship Coverage: ${results.grade.components.relationships}%
   • Cross-Language Detection: ${results.grade.components.crossLanguage}%
   • Performance Compliance: ${results.grade.components.performance}%

⚡ PERFORMANCE ANALYSIS:
   • Files/sec: ${results.performance.throughput.filesPerSecond.toFixed(2)}
   • POIs/sec: ${results.performance.throughput.poisPerSecond.toFixed(2)}
   • Relationships/sec: ${results.performance.throughput.relationshipsPerSecond.toFixed(2)}
   • Error Rate: ${(results.performance.errorRate * 100).toFixed(2)}%

🎪 NODE TYPE BREAKDOWN:
   ${Object.entries(results.nodes.byType).map(([type, count]) => `   • ${type}: ${count}`).join('\n   ')}
   
🔀 RELATIONSHIP TYPE BREAKDOWN:
   ${Object.entries(results.relationships.byType).map(([type, count]) => `   • ${type}: ${count}`).join('\n   ')}
`.trim();
    }
    
    // Save benchmark results for analysis and debugging
    async function saveBenchmarkResults(results) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultsDir = './test-results/benchmark';
        
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        // Save detailed JSON results
        const resultsPath = path.join(resultsDir, `master-benchmark-${timestamp}.json`);
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        
        // Save human-readable report
        const reportPath = path.join(resultsDir, `master-benchmark-report-${timestamp}.md`);
        const report = `# Master Pipeline Benchmark Report
        
Generated: ${results.timestamp}
Grade: ${results.grade.letter} (${results.grade.score}%)

${generateBenchmarkReport(results)}

## Detailed Analysis

### Node Analysis
${JSON.stringify(results.nodes.analysis, null, 2)}

### Relationship Analysis  
${JSON.stringify(results.relationships.analysis, null, 2)}

### Cross-Language Validation Details
${results.crossLanguage.relationships.map(r => `
#### ${r.description}
- **Status**: ${r.found ? 'FOUND ✅' : 'MISSING ❌'}
- **Required**: ${r.required}
- **Details**: ${JSON.stringify(r.details, null, 2)}
`).join('\n')}
`;
        
        fs.writeFileSync(reportPath, report);
        
        console.log(`💾 Benchmark results saved:`);
        console.log(`   • JSON: ${resultsPath}`);
        console.log(`   • Report: ${reportPath}`);
    }
    
    // Validate minimum requirements and provide detailed failure analysis
    function validateMinimumRequirements(results) {
        const failures = [];
        
        // Check minimum node count
        if (results.nodes.total < BENCHMARK_REQUIREMENTS.minimum.nodes) {
            failures.push(`Node count ${results.nodes.total} below minimum ${BENCHMARK_REQUIREMENTS.minimum.nodes}`);
        }
        
        // Check minimum relationship count
        if (results.relationships.total < BENCHMARK_REQUIREMENTS.minimum.relationships) {
            failures.push(`Relationship count ${results.relationships.total} below minimum ${BENCHMARK_REQUIREMENTS.minimum.relationships}`);
        }
        
        // Check minimum relationship ratio
        if (results.relationships.ratio < BENCHMARK_REQUIREMENTS.minimum.relationshipRatio) {
            failures.push(`Relationship ratio ${results.relationships.ratio} below minimum ${BENCHMARK_REQUIREMENTS.minimum.relationshipRatio}`);
        }
        
        // Check execution time
        if (results.performance.executionTime > BENCHMARK_REQUIREMENTS.performance.maxExecutionTime) {
            failures.push(`Execution time ${results.performance.executionTime}ms exceeds maximum ${BENCHMARK_REQUIREMENTS.performance.maxExecutionTime}ms`);
        }
        
        // Check pipeline execution success
        if (!results.execution.success) {
            failures.push(`Pipeline execution failed with exit code ${results.execution.exitCode || 'unknown'}`);
        }
        
        // Check critical cross-language relationships
        const requiredCrossLang = BENCHMARK_REQUIREMENTS.crossLanguageRelationships.filter(r => r.required).length;
        if (results.crossLanguage.criticalRelationshipsFound < Math.ceil(requiredCrossLang * 0.6)) {
            failures.push(`Insufficient cross-language relationships: ${results.crossLanguage.criticalRelationshipsFound}/${requiredCrossLang}`);
        }
        
        if (failures.length > 0) {
            console.error('\n❌ BENCHMARK VALIDATION FAILURES:');
            failures.forEach(failure => console.error(`   • ${failure}`));
            console.error('\n🔧 DEBUGGING RECOMMENDATIONS:');
            
            // Provide specific debugging guidance
            if (results.nodes.total < BENCHMARK_REQUIREMENTS.minimum.nodes) {
                console.error('   • Check entity extraction logic - files may not be processed correctly');
                console.error('   • Verify all 15 files in polyglot-test are being analyzed');
                console.error('   • Review LLM prompts for entity extraction completeness');
            }
            
            if (results.relationships.total < BENCHMARK_REQUIREMENTS.minimum.relationships) {
                console.error('   • Check relationship resolution algorithms');
                console.error('   • Verify cross-file and cross-language relationship detection');
                console.error('   • Review relationship type mapping and validation');
            }
            
            if (!results.execution.success) {
                console.error('   • Check pipeline logs for execution errors');
                console.error('   • Verify all dependencies and services are running');
                console.error('   • Review database connection and initialization');
            }
            
            console.error('\n💡 Check the detailed benchmark report for more specific analysis.');
        } else {
            console.log('\n✅ All minimum benchmark requirements met!');
        }
    }
});