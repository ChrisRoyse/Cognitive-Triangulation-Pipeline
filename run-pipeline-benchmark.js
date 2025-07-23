#!/usr/bin/env node

/**
 * Simplified pipeline runner for benchmark testing
 * Runs the pipeline with optimized settings for the polyglot-test directory
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const neo4j = require('neo4j-driver');

// Load environment variables
require('dotenv').config();

class BenchmarkRunner {
    constructor() {
        this.targetDir = './polyglot-test';
        this.dbPath = './database.db';
        this.neo4jUri = process.env.NEO4J_URI || 'bolt://localhost:7687';
        this.neo4jUser = process.env.NEO4J_USER || 'neo4j';
        this.neo4jPassword = process.env.NEO4J_PASSWORD || 'password';
        this.startTime = Date.now();
        this.checkInterval = null;
    }

    async clearDatabases() {
        console.log('🧹 Clearing databases...');
        
        // Clear SQLite
        if (fs.existsSync(this.dbPath)) {
            fs.unlinkSync(this.dbPath);
            console.log('✅ SQLite database cleared');
        }
        
        // Clear Neo4j
        const driver = neo4j.driver(
            this.neo4jUri,
            neo4j.auth.basic(this.neo4jUser, this.neo4jPassword)
        );
        
        try {
            const session = driver.session();
            await session.run('MATCH (n) DETACH DELETE n');
            await session.close();
            console.log('✅ Neo4j database cleared');
        } catch (error) {
            console.error('⚠️  Failed to clear Neo4j:', error.message);
        } finally {
            await driver.close();
        }
    }

    async checkProgress() {
        try {
            // Check SQLite
            const db = new Database(this.dbPath, { readonly: true });
            
            const fileCount = db.prepare('SELECT COUNT(*) as count FROM file_metadata').get().count;
            const poiCount = db.prepare('SELECT COUNT(*) as count FROM points_of_interest').get().count;
            const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get().count;
            
            db.close();
            
            // Check Neo4j
            const driver = neo4j.driver(
                this.neo4jUri,
                neo4j.auth.basic(this.neo4jUser, this.neo4jPassword)
            );
            
            const session = driver.session();
            const nodeResult = await session.run('MATCH (n) RETURN COUNT(n) as count');
            const relResult = await session.run('MATCH ()-[r]->() RETURN COUNT(r) as count');
            
            const neo4jNodes = nodeResult.records[0].get('count').toNumber();
            const neo4jRels = relResult.records[0].get('count').toNumber();
            
            await session.close();
            await driver.close();
            
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            console.log(`\n📊 Progress Report [${elapsed}s]:`);
            console.log(`├─ SQLite Files: ${fileCount}`);
            console.log(`├─ SQLite POIs: ${poiCount}`);
            console.log(`├─ SQLite Relationships: ${relCount}`);
            console.log(`├─ Neo4j Nodes: ${neo4jNodes}`);
            console.log(`└─ Neo4j Relationships: ${neo4jRels}`);
            
            // Check if we've hit the benchmarks
            if (neo4jNodes >= 300 && neo4jRels >= 1600) {
                console.log('\n🎯 BENCHMARK ACHIEVED!');
                return true;
            }
            
            return false;
        } catch (error) {
            // Database might not be ready yet
            return false;
        }
    }

    async runPipeline() {
        console.log('🚀 Starting Cognitive Triangulation Pipeline');
        console.log(`📁 Target directory: ${this.targetDir}`);
        console.log(`🎯 Minimum benchmarks: 300+ nodes, 1600+ relationships`);
        
        await this.clearDatabases();
        
        // Set up progress monitoring
        this.checkInterval = setInterval(async () => {
            const achieved = await this.checkProgress();
            if (achieved) {
                clearInterval(this.checkInterval);
            }
        }, 10000); // Check every 10 seconds
        
        return new Promise((resolve, reject) => {
            const args = ['src/main.js', '--target', this.targetDir];
            
            console.log('\n🔧 Running command: node', args.join(' '));
            
            const child = spawn('node', args, {
                env: {
                    ...process.env,
                    // Optimize settings for better performance
                    MAX_GLOBAL_CONCURRENCY: '5',
                    MAX_FILE_ANALYSIS_WORKERS: '3',
                    MAX_RELATIONSHIP_WORKERS: '2',
                    API_RATE_LIMIT: '10',
                    BATCH_SIZE: '10',
                    FILE_BATCHING_ENABLED: 'false',
                    ADAPTIVE_CONCURRENCY: 'false',
                    CIRCUIT_BREAKER_ENABLED: 'false'
                },
                stdio: 'pipe'
            });
            
            child.stdout.on('data', (data) => {
                const output = data.toString();
                // Only show important messages
                if (output.includes('✅') || output.includes('🎉') || output.includes('❌') || output.includes('Critical')) {
                    process.stdout.write(output);
                }
            });
            
            child.stderr.on('data', (data) => {
                process.stderr.write(data);
            });
            
            child.on('close', async (code) => {
                clearInterval(this.checkInterval);
                
                console.log(`\n🏁 Pipeline finished with code ${code}`);
                
                // Final check
                await this.checkProgress();
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Pipeline failed with code ${code}`));
                }
            });
            
            // Handle timeout
            setTimeout(() => {
                child.kill();
                reject(new Error('Pipeline timed out after 5 minutes'));
            }, 300000); // 5 minutes timeout
        });
    }

    async generateReport() {
        console.log('\n📝 Generating final report...');
        
        try {
            const db = new Database(this.dbPath, { readonly: true });
            
            // Get detailed stats
            const stats = {
                files: db.prepare('SELECT COUNT(*) as count FROM file_metadata').get().count,
                pois: db.prepare('SELECT COUNT(*) as count FROM points_of_interest').get().count,
                relationships: db.prepare('SELECT COUNT(*) as count FROM relationships').get().count,
                poiTypes: db.prepare('SELECT poi_type, COUNT(*) as count FROM points_of_interest GROUP BY poi_type').all(),
                relTypes: db.prepare('SELECT relationship_type, COUNT(*) as count FROM relationships GROUP BY relationship_type').all()
            };
            
            db.close();
            
            // Check Neo4j
            const driver = neo4j.driver(
                this.neo4jUri,
                neo4j.auth.basic(this.neo4jUser, this.neo4jPassword)
            );
            
            const session = driver.session();
            const nodeResult = await session.run('MATCH (n) RETURN COUNT(n) as count');
            const relResult = await session.run('MATCH ()-[r]->() RETURN COUNT(r) as count');
            
            stats.neo4jNodes = nodeResult.records[0].get('count').toNumber();
            stats.neo4jRels = relResult.records[0].get('count').toNumber();
            
            await session.close();
            await driver.close();
            
            console.log('\n📊 FINAL RESULTS:');
            console.log('================');
            console.log(`Files Processed: ${stats.files}`);
            console.log(`POIs Extracted: ${stats.pois}`);
            console.log(`Relationships Found: ${stats.relationships}`);
            console.log(`Neo4j Nodes: ${stats.neo4jNodes}`);
            console.log(`Neo4j Relationships: ${stats.neo4jRels}`);
            
            console.log('\nPOI Types:');
            stats.poiTypes.forEach(({ poi_type, count }) => {
                console.log(`  ${poi_type}: ${count}`);
            });
            
            console.log('\nRelationship Types:');
            stats.relTypes.forEach(({ relationship_type, count }) => {
                console.log(`  ${relationship_type}: ${count}`);
            });
            
            // Check benchmarks
            const passedNodes = stats.neo4jNodes >= 300;
            const passedRels = stats.neo4jRels >= 1600;
            const ratio = stats.neo4jRels / stats.neo4jNodes;
            
            console.log('\n🎯 BENCHMARK RESULTS:');
            console.log(`├─ Minimum Nodes (300+): ${passedNodes ? '✅ PASSED' : '❌ FAILED'} (${stats.neo4jNodes})`);
            console.log(`├─ Minimum Relationships (1600+): ${passedRels ? '✅ PASSED' : '❌ FAILED'} (${stats.neo4jRels})`);
            console.log(`└─ Relationship Ratio (4+): ${ratio >= 4 ? '✅ PASSED' : '❌ FAILED'} (${ratio.toFixed(2)})`);
            
            const success = passedNodes && passedRels && ratio >= 4;
            console.log(`\nOVERALL: ${success ? '✅ SUCCESS' : '❌ FAILURE'}`);
            
            return success;
        } catch (error) {
            console.error('❌ Error generating report:', error.message);
            return false;
        }
    }
}

// Main execution
async function main() {
    const runner = new BenchmarkRunner();
    
    try {
        await runner.runPipeline();
        const success = await runner.generateReport();
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('❌ Pipeline error:', error.message);
        await runner.generateReport();
        process.exit(1);
    }
}

main().catch(console.error);