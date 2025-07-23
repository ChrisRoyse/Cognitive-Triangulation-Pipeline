#!/usr/bin/env node
/**
 * Pre-Deployment Checklist
 * 
 * Comprehensive checks before deploying to production
 * Includes smoke tests plus additional deployment validations
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

const checks = {
    passed: [],
    failed: [],
    warnings: []
};

async function runCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { shell: true });
        let output = '';
        let errorOutput = '';
        
        proc.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(errorOutput || output));
            }
        });
    });
}

async function checkGitStatus() {
    console.log(chalk.blue('\n📋 Checking Git status...'));
    
    try {
        const status = await runCommand('git', ['status', '--porcelain']);
        
        if (status.trim()) {
            checks.warnings.push({
                name: 'Git Status',
                message: 'Uncommitted changes detected'
            });
            console.log(chalk.yellow('  ⚠️  Uncommitted changes found'));
        } else {
            checks.passed.push({ name: 'Git Status' });
            console.log(chalk.green('  ✓ Working directory clean'));
        }
    } catch (error) {
        checks.failed.push({
            name: 'Git Status',
            error: 'Failed to check git status'
        });
    }
}

async function checkEnvironmentFile() {
    console.log(chalk.blue('\n🔐 Checking environment configuration...'));
    
    try {
        const envPath = path.join(process.cwd(), '.env');
        const envContent = await fs.readFile(envPath, 'utf8');
        
        // Check for default/placeholder values
        const issues = [];
        
        if (envContent.includes('your-api-key-here')) {
            issues.push('Default API key detected');
        }
        
        if (envContent.includes('password123') || envContent.includes('test1234')) {
            issues.push('Weak password detected');
        }
        
        if (envContent.includes('NODE_ENV=development')) {
            issues.push('Development environment set');
        }
        
        if (issues.length > 0) {
            checks.warnings.push({
                name: 'Environment Config',
                message: issues.join(', ')
            });
            issues.forEach(issue => {
                console.log(chalk.yellow(`  ⚠️  ${issue}`));
            });
        } else {
            checks.passed.push({ name: 'Environment Config' });
            console.log(chalk.green('  ✓ Environment configuration looks good'));
        }
    } catch (error) {
        checks.failed.push({
            name: 'Environment Config',
            error: 'Missing .env file'
        });
        console.log(chalk.red('  ✗ .env file not found'));
    }
}

async function checkDependencies() {
    console.log(chalk.blue('\n📦 Checking dependencies...'));
    
    try {
        // Check for outdated packages
        const outdated = await runCommand('npm', ['outdated', '--json']).catch(() => '{}');
        const outdatedPackages = JSON.parse(outdated || '{}');
        const criticalOutdated = Object.keys(outdatedPackages).filter(pkg => 
            outdatedPackages[pkg].current !== outdatedPackages[pkg].wanted
        );
        
        if (criticalOutdated.length > 0) {
            checks.warnings.push({
                name: 'Dependencies',
                message: `${criticalOutdated.length} packages need updates`
            });
            console.log(chalk.yellow(`  ⚠️  ${criticalOutdated.length} packages have available updates`));
        } else {
            checks.passed.push({ name: 'Dependencies' });
            console.log(chalk.green('  ✓ All dependencies up to date'));
        }
        
        // Check for security vulnerabilities
        console.log(chalk.blue('\n🔒 Checking for vulnerabilities...'));
        const audit = await runCommand('npm', ['audit', '--json']).catch(() => '{}');
        const auditData = JSON.parse(audit || '{}');
        
        if (auditData.metadata && auditData.metadata.vulnerabilities) {
            const vulns = auditData.metadata.vulnerabilities;
            const total = vulns.high + vulns.critical;
            
            if (total > 0) {
                checks.failed.push({
                    name: 'Security Audit',
                    error: `${total} high/critical vulnerabilities found`
                });
                console.log(chalk.red(`  ✗ ${total} high/critical vulnerabilities found`));
            } else if (vulns.moderate > 0) {
                checks.warnings.push({
                    name: 'Security Audit',
                    message: `${vulns.moderate} moderate vulnerabilities`
                });
                console.log(chalk.yellow(`  ⚠️  ${vulns.moderate} moderate vulnerabilities`));
            } else {
                checks.passed.push({ name: 'Security Audit' });
                console.log(chalk.green('  ✓ No security vulnerabilities'));
            }
        }
    } catch (error) {
        checks.warnings.push({
            name: 'Dependencies',
            message: 'Could not check dependencies'
        });
    }
}

async function checkDiskSpace() {
    console.log(chalk.blue('\n💾 Checking disk space...'));
    
    try {
        const checkSpace = process.platform === 'win32' 
            ? 'wmic logicaldisk get size,freespace,caption'
            : 'df -h .';
            
        const output = await runCommand(checkSpace);
        
        // Simple check - warn if less than 1GB free
        if (output.includes('G') || output.includes('T')) {
            checks.passed.push({ name: 'Disk Space' });
            console.log(chalk.green('  ✓ Adequate disk space available'));
        } else {
            checks.warnings.push({
                name: 'Disk Space',
                message: 'Low disk space detected'
            });
            console.log(chalk.yellow('  ⚠️  Low disk space detected'));
        }
    } catch (error) {
        checks.warnings.push({
            name: 'Disk Space',
            message: 'Could not check disk space'
        });
    }
}

async function runSmokeTests() {
    console.log(chalk.blue('\n🔥 Running smoke tests...\n'));
    
    return new Promise((resolve) => {
        const smokeTests = spawn('npm', ['run', 'test:smoke'], {
            stdio: 'inherit',
            shell: true
        });
        
        smokeTests.on('close', (code) => {
            if (code === 0) {
                checks.passed.push({ name: 'Smoke Tests' });
            } else {
                checks.failed.push({
                    name: 'Smoke Tests',
                    error: 'Smoke tests failed'
                });
            }
            resolve();
        });
    });
}

async function generateReport() {
    console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('PRE-DEPLOYMENT CHECK SUMMARY'));
    console.log(chalk.blue.bold('═'.repeat(60) + '\n'));
    
    const totalChecks = checks.passed.length + checks.failed.length + checks.warnings.length;
    
    console.log(chalk.green(`✅ Passed: ${checks.passed.length}/${totalChecks}`));
    console.log(chalk.yellow(`⚠️  Warnings: ${checks.warnings.length}`));
    console.log(chalk.red(`❌ Failed: ${checks.failed.length}\n`));
    
    if (checks.failed.length > 0) {
        console.log(chalk.red.bold('FAILED CHECKS:'));
        checks.failed.forEach(check => {
            console.log(chalk.red(`  ✗ ${check.name}: ${check.error}`));
        });
        console.log();
    }
    
    if (checks.warnings.length > 0) {
        console.log(chalk.yellow.bold('WARNINGS:'));
        checks.warnings.forEach(check => {
            console.log(chalk.yellow(`  ⚠️  ${check.name}: ${check.message}`));
        });
        console.log();
    }
    
    // Deployment recommendation
    console.log(chalk.blue.bold('RECOMMENDATION:'));
    if (checks.failed.length > 0) {
        console.log(chalk.red.bold('  ❌ DO NOT DEPLOY - Critical issues must be resolved\n'));
        return false;
    } else if (checks.warnings.length > 3) {
        console.log(chalk.yellow.bold('  ⚠️  DEPLOY WITH CAUTION - Review warnings before proceeding\n'));
        return true;
    } else {
        console.log(chalk.green.bold('  ✅ READY FOR DEPLOYMENT\n'));
        return true;
    }
}

async function main() {
    console.log(chalk.blue.bold('\n🚀 PRE-DEPLOYMENT CHECKLIST'));
    console.log(chalk.gray('Running comprehensive system checks...\n'));
    
    const startTime = Date.now();
    
    try {
        // Run all checks
        await checkGitStatus();
        await checkEnvironmentFile();
        await checkDependencies();
        await checkDiskSpace();
        await runSmokeTests();
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(chalk.gray(`\nTotal time: ${duration}s`));
        
        // Generate report and exit with appropriate code
        const canDeploy = await generateReport();
        process.exit(canDeploy ? 0 : 1);
        
    } catch (error) {
        console.error(chalk.red('\n❌ Pre-deployment check failed:'), error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { runChecks: main };