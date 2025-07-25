#!/usr/bin/env node

/**
 * Iterative Quality System - Main Entry Point
 * 
 * Implements automated iterative quality improvement system for data consistency.
 * 
 * This system provides:
 * 1. Self-Assessment: Automated quality scoring (1-100) with gap identification
 * 2. Parallel Task Delegation: Concurrent improvements with dependency management  
 * 3. Verification Loop: Automated validation and regression testing
 * 4. Iteration Control: Continues until 100% quality or max iterations reached
 * 
 * Usage:
 *   node iterative-quality-system.js [options]
 * 
 * Options:
 *   --max-iterations <number>    Maximum iterations (default: 10)
 *   --target-score <number>      Target quality score (default: 100)
 *   --min-improvement <number>   Minimum improvement per iteration (default: 5)
 *   --timeout <number>           Timeout per iteration in minutes (default: 10)
 *   --help                       Show help
 */

const IterativeQualitySystem = require('./src/services/IterativeQualitySystem');

class IterativeQualitySystemCLI {
    constructor() {
        this.options = this.parseArguments();
    }

    /**
     * Parse command line arguments
     */
    parseArguments() {
        const args = process.argv.slice(2);
        const options = {
            maxIterations: 10,
            targetScore: 100,
            minimumImprovement: 5,
            timeoutPerIteration: 600000, // 10 minutes
            help: false
        };

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            
            switch (arg) {
                case '--max-iterations':
                    options.maxIterations = parseInt(args[++i], 10);
                    break;
                case '--target-score':
                    options.targetScore = parseInt(args[++i], 10);
                    break;
                case '--min-improvement':
                    options.minimumImprovement = parseInt(args[++i], 10);
                    break;
                case '--timeout':
                    options.timeoutPerIteration = parseInt(args[++i], 10) * 60000; // Convert minutes to ms
                    break;
                case '--help':
                case '-h':
                    options.help = true;
                    break;
                default:
                    console.warn(`Unknown option: ${arg}`);
            }
        }

        return options;
    }

    /**
     * Show help information
     */
    showHelp() {
        console.log(`
ITERATIVE QUALITY SYSTEM
========================

Automated iterative quality improvement system for data consistency.

USAGE:
    node iterative-quality-system.js [options]

OPTIONS:
    --max-iterations <number>    Maximum iterations (default: 10)
    --target-score <number>      Target quality score (default: 100)
    --min-improvement <number>   Minimum improvement per iteration (default: 5)
    --timeout <number>           Timeout per iteration in minutes (default: 10)
    --help, -h                   Show this help

QUALITY DIMENSIONS ASSESSED:
    • Data Integrity (25%)       - No orphaned records, valid constraints
    • Performance (20%)          - Minimal overhead, good response times
    • Robustness (20%)           - Edge case handling, error recovery
    • Completeness (15%)         - All requirements addressed
    • Production Readiness (10%) - Monitoring, deployment safety
    • Documentation (10%)        - Clear docs, examples, troubleshooting

PROCESS OVERVIEW:
    1. Initial quality assessment to establish baseline
    2. Identify quality gaps and generate improvement tasks
    3. Execute tasks in parallel with dependency management
    4. Validate improvements and check for regressions
    5. Continue iterations until target score achieved or max iterations reached
    6. Generate comprehensive improvement report

EXAMPLES:
    # Run with default settings (max 10 iterations, target 100%)
    node iterative-quality-system.js

    # Run with custom settings
    node iterative-quality-system.js --max-iterations 15 --target-score 95

    # Quick improvement run with 5 iterations
    node iterative-quality-system.js --max-iterations 5 --timeout 5

EXIT CODES:
    0  - Success: Target quality score achieved
    1  - Partial success: Improvements made but target not reached
    2  - Failure: No improvements or system error
        `);
    }

    /**
     * Validate configuration options
     */
    validateOptions() {
        const errors = [];

        if (this.options.maxIterations < 1 || this.options.maxIterations > 50) {
            errors.push('Max iterations must be between 1 and 50');
        }

        if (this.options.targetScore < 1 || this.options.targetScore > 100) {
            errors.push('Target score must be between 1 and 100');
        }

        if (this.options.minimumImprovement < 0 || this.options.minimumImprovement > 20) {
            errors.push('Minimum improvement must be between 0 and 20');
        }

        if (this.options.timeoutPerIteration < 60000 || this.options.timeoutPerIteration > 3600000) {
            errors.push('Timeout must be between 1 and 60 minutes');
        }

        if (errors.length > 0) {
            console.error('Configuration validation errors:');
            errors.forEach(error => console.error(`  - ${error}`));
            process.exit(2);
        }
    }

    /**
     * Print startup banner
     */
    printBanner() {
        console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ITERATIVE QUALITY SYSTEM                             ║
║                    Automated Data Consistency Improvement                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Configuration:                                                              ║
║   Max Iterations: ${String(this.options.maxIterations).padEnd(10)}                                           ║
║   Target Score:   ${String(this.options.targetScore).padEnd(10)}                                           ║
║   Min Improvement: ${String(this.options.minimumImprovement).padEnd(10)}                                          ║
║   Timeout/Iter:   ${String(this.options.timeoutPerIteration / 60000).padEnd(10)} minutes                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
        `);
    }

    /**
     * Main execution method
     */
    async run() {
        try {
            // Show help if requested
            if (this.options.help) {
                this.showHelp();
                return;
            }

            // Validate options
            this.validateOptions();

            // Print banner
            this.printBanner();

            // Initialize the iterative quality system
            const qualitySystem = new IterativeQualitySystem(this.options);

            // Set up graceful shutdown
            this.setupGracefulShutdown(qualitySystem);

            // Run the improvement process
            console.log('🚀 Starting automated quality improvement process...\n');
            const startTime = Date.now();

            const report = await qualitySystem.run();

            const duration = Date.now() - startTime;
            console.log(`\n⏱️  Total execution time: ${(duration / 60000).toFixed(2)} minutes`);

            // Print summary
            this.printSummary(report);

            // Determine exit code
            const exitCode = this.determineExitCode(report);
            process.exit(exitCode);

        } catch (error) {
            console.error('\n❌ Iterative Quality System failed with error:');
            console.error(error.message);
            
            if (process.env.NODE_ENV === 'development') {
                console.error('\nStack trace:');
                console.error(error.stack);
            }

            process.exit(2);
        }
    }

    /**
     * Print summary of results
     */
    printSummary(report) {
        console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                              IMPROVEMENT SUMMARY                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Quality Score:    ${String(report.results.initialScore).padEnd(3)} → ${String(report.results.finalScore).padEnd(3)} (${report.results.totalImprovement > 0 ? '+' : ''}${String(report.results.totalImprovement).padEnd(3)})                                ║
║ Target Achieved:  ${report.results.targetAchieved ? 'YES ✅' : 'NO ❌ '}                                                   ║
║ Iterations Used:  ${String(report.session.iterations).padEnd(2)}/${String(report.session.maxIterations).padEnd(2)}                                                        ║
║ Improvements:     ${String(report.improvements.total).padEnd(10)}                                           ║
║ Duration:         ${String((report.performance.totalDuration / 60000).toFixed(1)).padEnd(10)} minutes                              ║
║ Efficiency:       ${String(report.performance.efficiency.toFixed(1)).padEnd(10)} points/iteration                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Component Breakdown:                                                        ║`);

        for (const [component, result] of Object.entries(report.quality.componentScores)) {
            const maxScore = report.quality.qualityDistribution[component]?.maxScore || 'N/A';
            const percentage = report.quality.qualityDistribution[component]?.percentage.toFixed(0) || '0';
            const status = result.issues.length === 0 ? '✅' : result.issues.length <= 2 ? '⚠️ ' : '❌';
            
            console.log(`║   ${component.padEnd(18)}: ${String(result.score).padEnd(2)}/${String(maxScore).padEnd(2)} (${String(percentage).padEnd(3)}%) ${status}                     ║`);
        }

        console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);

        // Show improvements by component
        if (report.improvements.total > 0) {
            console.log('\n📋 IMPROVEMENTS MADE:');
            for (const [component, improvements] of Object.entries(report.improvements.byComponent)) {
                console.log(`   ${component}:`);
                improvements.forEach(improvement => {
                    console.log(`     • ${improvement}`);
                });
            }
        }

        // Show remaining issues
        if (report.quality.remainingGaps.length > 0) {
            console.log('\n⚠️  REMAINING QUALITY GAPS:');
            report.quality.remainingGaps.forEach(gap => {
                console.log(`   ${gap.component} (${gap.currentScore}/${gap.maxScore}):`);
                gap.issues.forEach(issue => {
                    console.log(`     • ${issue}`);
                });
            });
        }

        // Show recommendations
        if (report.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            report.recommendations.forEach(rec => {
                const icon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
                console.log(`   ${icon} [${rec.priority.toUpperCase()}] ${rec.message}`);
            });
        }

        // Show next steps
        if (report.nextSteps.length > 0) {
            console.log('\n🎯 NEXT STEPS:');
            report.nextSteps.forEach((step, index) => {
                console.log(`   ${index + 1}. ${step}`);
            });
        }
    }

    /**
     * Determine appropriate exit code based on results
     */
    determineExitCode(report) {
        // Success: Target achieved
        if (report.results.targetAchieved) {
            console.log('\n🎉 SUCCESS: Target quality score achieved!');
            return 0;
        }

        // Partial success: Some improvement made
        if (report.results.totalImprovement > 0) {
            console.log('\n⚠️  PARTIAL SUCCESS: Improvements made but target not fully achieved');
            return 1;
        }

        // Failure: No improvement or regression
        console.log('\n❌ FAILURE: No quality improvement achieved');
        return 2;
    }

    /**
     * Setup graceful shutdown handling
     */
    setupGracefulShutdown(qualitySystem) {
        const shutdown = (signal) => {
            console.log(`\n⚠️  Received ${signal}. Gracefully shutting down...`);
            
            const status = qualitySystem.getStatus();
            if (status.isRunning) {
                console.log(`📊 Current status: Iteration ${status.currentIteration}/${status.maxIterations}, Score: ${status.lastScore || 'N/A'}`);
                console.log('💾 Session data will be preserved for later analysis');
            }
            
            process.exit(1);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }
}

// Run the CLI if this file is executed directly
if (require.main === module) {
    const cli = new IterativeQualitySystemCLI();
    cli.run();
}

module.exports = IterativeQualitySystemCLI;