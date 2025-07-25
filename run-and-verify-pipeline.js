#!/usr/bin/env node

/**
 * Pipeline Execution and Verification Script
 * 
 * This script demonstrates how to:
 * 1. Run the CTP pipeline on a small test directory
 * 2. Wait for completion
 * 3. Verify the results
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

async function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${colors.cyan}Running: ${command} ${args.join(' ')}${colors.reset}`);
    
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}`));
      } else {
        resolve();
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function checkServices() {
  console.log(`${colors.bright}${colors.blue}Checking required services...${colors.reset}`);
  
  // Check if Redis is running
  try {
    const redis = require('redis');
    const client = redis.createClient();
    await client.connect();
    await client.ping();
    await client.quit();
    console.log(`${colors.green}✓ Redis is running${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}✗ Redis is not running. Please start Redis first.${colors.reset}`);
    console.log(`  Run: redis-server`);
    process.exit(1);
  }
  
  // Check if Neo4j is running
  try {
    const neo4j = require('neo4j-driver');
    const config = require('./src/config');
    const driver = neo4j.driver(
      config.NEO4J_URI,
      neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD)
    );
    await driver.verifyConnectivity();
    await driver.close();
    console.log(`${colors.green}✓ Neo4j is running${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}✗ Neo4j is not running. Please start Neo4j first.${colors.reset}`);
    console.log(`  Check http://localhost:7474`);
    process.exit(1);
  }
}

async function selectTestDirectory() {
  // Look for some common test directories
  const testDirs = [
    './src/utils',      // Small directory with utility files
    './src/workers',    // Worker implementations
    './src/agents',     // Agent implementations
    './tests/fixtures', // Test fixtures if available
    './examples'        // Example files
  ];
  
  for (const dir of testDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
      if (files.length > 0 && files.length < 20) { // Good size for testing
        return path.resolve(dir);
      }
    }
  }
  
  // Default to a small directory
  return path.resolve('./src/utils');
}

async function main() {
  try {
    console.log(`${colors.bright}${colors.cyan}CTP Pipeline Test Runner${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(40)}${colors.reset}\n`);
    
    // 1. Check services
    await checkServices();
    
    // 2. Select test directory
    const testDir = await selectTestDirectory();
    console.log(`\n${colors.bright}Test directory:${colors.reset} ${testDir}`);
    
    // 3. Run the pipeline
    console.log(`\n${colors.bright}${colors.blue}Starting pipeline...${colors.reset}`);
    console.log(`This will process all JavaScript files in the test directory.`);
    
    await runCommand('node', ['src/main.js', testDir]);
    
    // 4. Wait a moment for any async operations to complete
    console.log(`\n${colors.yellow}Waiting for pipeline to complete...${colors.reset}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 5. Run verification
    console.log(`\n${colors.bright}${colors.blue}Running verification...${colors.reset}`);
    await runCommand('node', ['verify-pipeline-results.js']);
    
    console.log(`\n${colors.bright}${colors.green}Pipeline test completed!${colors.reset}`);
    
  } catch (error) {
    console.error(`\n${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// Show usage
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node run-and-verify-pipeline.js [options]

This script runs the CTP pipeline on a small test directory and verifies the results.

Options:
  -h, --help     Show this help message

Prerequisites:
  - Redis must be running (redis-server)
  - Neo4j must be running (http://localhost:7474)
  - Dependencies installed (npm install)

The script will:
  1. Check that required services are running
  2. Run the pipeline on a small test directory
  3. Wait for completion
  4. Verify the results using the verification tool
  `);
  process.exit(0);
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}