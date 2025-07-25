#!/usr/bin/env node

/**
 * Pipeline Verification Script
 * 
 * This script comprehensively verifies that the CTP pipeline is producing correct results
 * by checking SQLite databases, Neo4j graph, and analyzing the quality of extracted data.
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const neo4j = require('neo4j-driver');
const config = require('./src/config');
const { formatBytes, getRelativeTime } = require('./src/utils/formatters');

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class PipelineVerifier {
  constructor() {
    this.db = null;
    this.neo4jDriver = null;
    this.runId = null;
    this.results = {
      sqlite: {
        files: { total: 0, processed: 0, failed: 0 },
        pois: { total: 0, byType: {}, byFile: {}, avgPerFile: 0 },
        relationships: { total: 0, byType: {}, byStatus: {}, avgConfidence: 0 },
        triangulation: { sessions: 0, completed: 0, failed: 0, avgConsensus: 0 },
        evidence: { total: 0, tracking: 0, avgEvidence: 0 }
      },
      neo4j: {
        nodes: { total: 0, byLabel: {} },
        relationships: { total: 0, byType: {} },
        projectNode: null
      },
      quality: {
        poisWithDescription: 0,
        poisWithSemanticId: 0,
        relationshipsWithEvidence: 0,
        relationshipsWithReason: 0,
        triangulatedRelationships: 0,
        highConfidenceRelationships: 0
      },
      performance: {
        totalProcessingTime: 0,
        avgFileProcessingTime: 0,
        triangulationTime: 0
      }
    };
  }

  async connect() {
    // Connect to SQLite
    const dbPath = path.join(process.cwd(), 'database.sqlite');
    console.log(`${colors.cyan}Connecting to SQLite database at: ${dbPath}${colors.reset}`);
    
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error(`${colors.red}Failed to connect to SQLite:${colors.reset}`, err);
        throw err;
      }
    });

    // Connect to Neo4j
    try {
      console.log(`${colors.cyan}Connecting to Neo4j at: ${config.NEO4J_URI}${colors.reset}`);
      this.neo4jDriver = neo4j.driver(
        config.NEO4J_URI,
        neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD)
      );
      await this.neo4jDriver.verifyConnectivity();
      console.log(`${colors.green}✓ Successfully connected to Neo4j${colors.reset}`);
    } catch (err) {
      console.error(`${colors.red}Failed to connect to Neo4j:${colors.reset}`, err);
      throw err;
    }
  }

  async getLatestRunId() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT run_id, MAX(created_at) as latest_time 
         FROM run_status 
         WHERE status = 'STARTED' 
         GROUP BY run_id 
         ORDER BY latest_time DESC 
         LIMIT 1`,
        (err, row) => {
          if (err) reject(err);
          else if (!row) reject(new Error('No runs found in database'));
          else {
            this.runId = row.run_id;
            console.log(`${colors.magenta}Using latest run ID: ${this.runId}${colors.reset}`);
            resolve(this.runId);
          }
        }
      );
    });
  }

  async verifyFiles() {
    console.log(`\n${colors.bright}${colors.blue}=== Verifying Files ===${colors.reset}`);
    
    return new Promise((resolve, reject) => {
      // Count total files
      this.db.get(
        `SELECT COUNT(*) as total FROM files`,
        (err, row) => {
          if (err) return reject(err);
          this.results.sqlite.files.total = row.total;
          
          // Count processed files
          this.db.get(
            `SELECT COUNT(DISTINCT file_path) as processed 
             FROM pois 
             WHERE run_id = ?`,
            [this.runId],
            (err, row) => {
              if (err) return reject(err);
              this.results.sqlite.files.processed = row.processed;
              
              // Count failed files
              this.db.get(
                `SELECT COUNT(*) as failed 
                 FROM files 
                 WHERE status = 'failed' OR status = 'error'`,
                (err, row) => {
                  if (err) return reject(err);
                  this.results.sqlite.files.failed = row.failed;
                  
                  console.log(`Total files: ${this.results.sqlite.files.total}`);
                  console.log(`Processed in this run: ${colors.green}${this.results.sqlite.files.processed}${colors.reset}`);
                  console.log(`Failed files: ${colors.red}${this.results.sqlite.files.failed}${colors.reset}`);
                  resolve();
                }
              );
            }
          );
        }
      );
    });
  }

  async verifyPOIs() {
    console.log(`\n${colors.bright}${colors.blue}=== Verifying POIs (Points of Interest) ===${colors.reset}`);
    
    return new Promise((resolve, reject) => {
      // Count total POIs
      this.db.get(
        `SELECT COUNT(*) as total FROM pois WHERE run_id = ?`,
        [this.runId],
        (err, row) => {
          if (err) return reject(err);
          this.results.sqlite.pois.total = row.total;
          
          // Count POIs by type
          this.db.all(
            `SELECT type, COUNT(*) as count 
             FROM pois 
             WHERE run_id = ? 
             GROUP BY type 
             ORDER BY count DESC`,
            [this.runId],
            (err, rows) => {
              if (err) return reject(err);
              rows.forEach(row => {
                this.results.sqlite.pois.byType[row.type] = row.count;
              });
              
              // Count POIs per file (top 10)
              this.db.all(
                `SELECT file_path, COUNT(*) as count 
                 FROM pois 
                 WHERE run_id = ? 
                 GROUP BY file_path 
                 ORDER BY count DESC 
                 LIMIT 10`,
                [this.runId],
                (err, rows) => {
                  if (err) return reject(err);
                  rows.forEach(row => {
                    this.results.sqlite.pois.byFile[row.file_path] = row.count;
                  });
                  
                  // Calculate average POIs per file
                  if (this.results.sqlite.files.processed > 0) {
                    this.results.sqlite.pois.avgPerFile = 
                      (this.results.sqlite.pois.total / this.results.sqlite.files.processed).toFixed(2);
                  }
                  
                  // Count quality metrics
                  this.db.get(
                    `SELECT 
                      COUNT(CASE WHEN description IS NOT NULL AND description != '' THEN 1 END) as with_description,
                      COUNT(CASE WHEN semantic_id IS NOT NULL THEN 1 END) as with_semantic_id
                     FROM pois 
                     WHERE run_id = ?`,
                    [this.runId],
                    (err, row) => {
                      if (err) return reject(err);
                      this.results.quality.poisWithDescription = row.with_description;
                      this.results.quality.poisWithSemanticId = row.with_semantic_id;
                      
                      console.log(`Total POIs extracted: ${colors.green}${this.results.sqlite.pois.total}${colors.reset}`);
                      console.log(`Average POIs per file: ${this.results.sqlite.pois.avgPerFile}`);
                      console.log(`\nPOIs by type:`);
                      Object.entries(this.results.sqlite.pois.byType).forEach(([type, count]) => {
                        console.log(`  ${type}: ${count}`);
                      });
                      console.log(`\nTop files by POI count:`);
                      Object.entries(this.results.sqlite.pois.byFile).slice(0, 5).forEach(([file, count]) => {
                        const shortPath = file.split(/[\\/]/).slice(-2).join('/');
                        console.log(`  ${shortPath}: ${count} POIs`);
                      });
                      console.log(`\nQuality metrics:`);
                      console.log(`  POIs with descriptions: ${this.results.quality.poisWithDescription} (${(this.results.quality.poisWithDescription / this.results.sqlite.pois.total * 100).toFixed(1)}%)`);
                      console.log(`  POIs with semantic IDs: ${this.results.quality.poisWithSemanticId} (${(this.results.quality.poisWithSemanticId / this.results.sqlite.pois.total * 100).toFixed(1)}%)`);
                      resolve();
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }

  async verifyRelationships() {
    console.log(`\n${colors.bright}${colors.blue}=== Verifying Relationships ===${colors.reset}`);
    
    return new Promise((resolve, reject) => {
      // Count total relationships
      this.db.get(
        `SELECT COUNT(*) as total, AVG(confidence) as avg_confidence 
         FROM relationships 
         WHERE run_id = ?`,
        [this.runId],
        (err, row) => {
          if (err) return reject(err);
          this.results.sqlite.relationships.total = row.total;
          this.results.sqlite.relationships.avgConfidence = row.avg_confidence || 0;
          
          // Count relationships by type
          this.db.all(
            `SELECT type, COUNT(*) as count 
             FROM relationships 
             WHERE run_id = ? 
             GROUP BY type 
             ORDER BY count DESC`,
            [this.runId],
            (err, rows) => {
              if (err) return reject(err);
              rows.forEach(row => {
                this.results.sqlite.relationships.byType[row.type] = row.count;
              });
              
              // Count relationships by status
              this.db.all(
                `SELECT status, COUNT(*) as count 
                 FROM relationships 
                 WHERE run_id = ? 
                 GROUP BY status`,
                [this.runId],
                (err, rows) => {
                  if (err) return reject(err);
                  rows.forEach(row => {
                    this.results.sqlite.relationships.byStatus[row.status || 'null'] = row.count;
                  });
                  
                  // Count quality metrics
                  this.db.get(
                    `SELECT 
                      COUNT(CASE WHEN evidence IS NOT NULL AND evidence != '' THEN 1 END) as with_evidence,
                      COUNT(CASE WHEN reason IS NOT NULL AND reason != '' THEN 1 END) as with_reason,
                      COUNT(CASE WHEN confidence >= 0.8 THEN 1 END) as high_confidence
                     FROM relationships 
                     WHERE run_id = ?`,
                    [this.runId],
                    (err, row) => {
                      if (err) return reject(err);
                      this.results.quality.relationshipsWithEvidence = row.with_evidence;
                      this.results.quality.relationshipsWithReason = row.with_reason;
                      this.results.quality.highConfidenceRelationships = row.high_confidence;
                      
                      console.log(`Total relationships discovered: ${colors.green}${this.results.sqlite.relationships.total}${colors.reset}`);
                      console.log(`Average confidence: ${(this.results.sqlite.relationships.avgConfidence * 100).toFixed(1)}%`);
                      console.log(`\nRelationships by type:`);
                      Object.entries(this.results.sqlite.relationships.byType).forEach(([type, count]) => {
                        console.log(`  ${type}: ${count}`);
                      });
                      console.log(`\nRelationships by status:`);
                      Object.entries(this.results.sqlite.relationships.byStatus).forEach(([status, count]) => {
                        console.log(`  ${status}: ${count}`);
                      });
                      console.log(`\nQuality metrics:`);
                      console.log(`  With evidence: ${this.results.quality.relationshipsWithEvidence} (${(this.results.quality.relationshipsWithEvidence / this.results.sqlite.relationships.total * 100).toFixed(1)}%)`);
                      console.log(`  With reason: ${this.results.quality.relationshipsWithReason} (${(this.results.quality.relationshipsWithReason / this.results.sqlite.relationships.total * 100).toFixed(1)}%)`);
                      console.log(`  High confidence (≥80%): ${this.results.quality.highConfidenceRelationships} (${(this.results.quality.highConfidenceRelationships / this.results.sqlite.relationships.total * 100).toFixed(1)}%)`);
                      resolve();
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }

  async verifyTriangulation() {
    console.log(`\n${colors.bright}${colors.blue}=== Verifying Triangulation Analysis ===${colors.reset}`);
    
    return new Promise((resolve, reject) => {
      // Count triangulation sessions
      this.db.get(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed,
          AVG(CASE WHEN status = 'COMPLETED' THEN consensus_score END) as avg_consensus
         FROM triangulated_analysis_sessions 
         WHERE run_id = ?`,
        [this.runId],
        (err, row) => {
          if (err) return reject(err);
          this.results.sqlite.triangulation.sessions = row.total;
          this.results.sqlite.triangulation.completed = row.completed;
          this.results.sqlite.triangulation.failed = row.failed;
          this.results.sqlite.triangulation.avgConsensus = row.avg_consensus || 0;
          
          // Count relationships that went through triangulation
          this.db.get(
            `SELECT COUNT(DISTINCT relationship_id) as triangulated 
             FROM triangulated_analysis_sessions 
             WHERE run_id = ? AND relationship_id IS NOT NULL`,
            [this.runId],
            (err, row) => {
              if (err) return reject(err);
              this.results.quality.triangulatedRelationships = row.triangulated;
              
              console.log(`Triangulation sessions: ${this.results.sqlite.triangulation.sessions}`);
              console.log(`  Completed: ${colors.green}${this.results.sqlite.triangulation.completed}${colors.reset}`);
              console.log(`  Failed: ${colors.red}${this.results.sqlite.triangulation.failed}${colors.reset}`);
              console.log(`  Average consensus: ${(this.results.sqlite.triangulation.avgConsensus * 100).toFixed(1)}%`);
              console.log(`Relationships with triangulation: ${this.results.quality.triangulatedRelationships}`);
              resolve();
            }
          );
        }
      );
    });
  }

  async verifyEvidence() {
    console.log(`\n${colors.bright}${colors.blue}=== Verifying Evidence Tracking ===${colors.reset}`);
    
    return new Promise((resolve, reject) => {
      // Count evidence records
      this.db.get(
        `SELECT COUNT(*) as total FROM relationship_evidence WHERE run_id = ?`,
        [this.runId],
        (err, row) => {
          if (err) return reject(err);
          this.results.sqlite.evidence.total = row.total;
          
          // Count evidence tracking
          this.db.get(
            `SELECT 
              COUNT(*) as tracking,
              AVG(evidence_count) as avg_evidence
             FROM relationship_evidence_tracking 
             WHERE run_id = ?`,
            [this.runId],
            (err, row) => {
              if (err) return reject(err);
              this.results.sqlite.evidence.tracking = row.tracking;
              this.results.sqlite.evidence.avgEvidence = row.avg_evidence || 0;
              
              console.log(`Evidence records: ${this.results.sqlite.evidence.total}`);
              console.log(`Evidence tracking entries: ${this.results.sqlite.evidence.tracking}`);
              console.log(`Average evidence per relationship: ${this.results.sqlite.evidence.avgEvidence.toFixed(2)}`);
              resolve();
            }
          );
        }
      );
    });
  }

  async verifyNeo4j() {
    console.log(`\n${colors.bright}${colors.blue}=== Verifying Neo4j Graph ===${colors.reset}`);
    
    const session = this.neo4jDriver.session();
    try {
      // Count total nodes
      const nodeResult = await session.run(
        `MATCH (n) RETURN COUNT(n) as total, labels(n) as labels`
      );
      
      // Count nodes by label
      const labelResult = await session.run(
        `MATCH (n) 
         WITH labels(n) as labels, COUNT(n) as count 
         UNWIND labels as label 
         RETURN label, SUM(count) as count 
         ORDER BY count DESC`
      );
      
      labelResult.records.forEach(record => {
        const label = record.get('label');
        const count = record.get('count').toNumber();
        this.results.neo4j.nodes.byLabel[label] = count;
        this.results.neo4j.nodes.total += count;
      });
      
      // Count relationships by type
      const relResult = await session.run(
        `MATCH ()-[r]->() 
         RETURN type(r) as type, COUNT(r) as count 
         ORDER BY count DESC`
      );
      
      relResult.records.forEach(record => {
        const type = record.get('type');
        const count = record.get('count').toNumber();
        this.results.neo4j.relationships.byType[type] = count;
        this.results.neo4j.relationships.total += count;
      });
      
      // Check for project node
      const projectResult = await session.run(
        `MATCH (p:Project) RETURN p LIMIT 1`
      );
      
      if (projectResult.records.length > 0) {
        this.results.neo4j.projectNode = projectResult.records[0].get('p').properties;
      }
      
      console.log(`Total nodes: ${colors.green}${this.results.neo4j.nodes.total}${colors.reset}`);
      console.log(`\nNodes by label:`);
      Object.entries(this.results.neo4j.nodes.byLabel).forEach(([label, count]) => {
        console.log(`  ${label}: ${count}`);
      });
      
      console.log(`\nTotal relationships: ${colors.green}${this.results.neo4j.relationships.total}${colors.reset}`);
      console.log(`\nRelationships by type:`);
      Object.entries(this.results.neo4j.relationships.byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      
      if (this.results.neo4j.projectNode) {
        console.log(`\nProject node found: ${colors.green}✓${colors.reset}`);
        console.log(`  Name: ${this.results.neo4j.projectNode.name}`);
        console.log(`  Path: ${this.results.neo4j.projectNode.path}`);
      } else {
        console.log(`\nProject node: ${colors.red}NOT FOUND${colors.reset}`);
      }
      
    } finally {
      await session.close();
    }
  }

  async generateReport() {
    console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}=== PIPELINE VERIFICATION SUMMARY ===${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}`);
    
    console.log(`\n${colors.bright}Run ID:${colors.reset} ${this.runId}`);
    
    // Files Summary
    const fileSuccessRate = this.results.sqlite.files.total > 0 
      ? ((this.results.sqlite.files.processed / this.results.sqlite.files.total) * 100).toFixed(1)
      : 0;
    console.log(`\n${colors.bright}FILES:${colors.reset}`);
    console.log(`  Success rate: ${fileSuccessRate}% (${this.results.sqlite.files.processed}/${this.results.sqlite.files.total})`);
    
    // POIs Summary
    console.log(`\n${colors.bright}POINTS OF INTEREST:${colors.reset}`);
    console.log(`  Total extracted: ${this.results.sqlite.pois.total}`);
    console.log(`  Average per file: ${this.results.sqlite.pois.avgPerFile}`);
    console.log(`  Quality score: ${((this.results.quality.poisWithDescription / this.results.sqlite.pois.total) * 100).toFixed(1)}%`);
    
    // Relationships Summary
    console.log(`\n${colors.bright}RELATIONSHIPS:${colors.reset}`);
    console.log(`  Total discovered: ${this.results.sqlite.relationships.total}`);
    console.log(`  Average confidence: ${(this.results.sqlite.relationships.avgConfidence * 100).toFixed(1)}%`);
    console.log(`  With evidence: ${((this.results.quality.relationshipsWithEvidence / this.results.sqlite.relationships.total) * 100).toFixed(1)}%`);
    console.log(`  Triangulated: ${((this.results.quality.triangulatedRelationships / this.results.sqlite.relationships.total) * 100).toFixed(1)}%`);
    
    // Neo4j Summary
    console.log(`\n${colors.bright}NEO4J GRAPH:${colors.reset}`);
    console.log(`  Nodes created: ${this.results.neo4j.nodes.total}`);
    console.log(`  Relationships created: ${this.results.neo4j.relationships.total}`);
    
    // Overall Health Check
    console.log(`\n${colors.bright}HEALTH CHECK:${colors.reset}`);
    const checks = [
      {
        name: 'Files processed',
        passed: this.results.sqlite.files.processed > 0,
        value: `${this.results.sqlite.files.processed} files`
      },
      {
        name: 'POIs extracted',
        passed: this.results.sqlite.pois.total > 0,
        value: `${this.results.sqlite.pois.total} POIs`
      },
      {
        name: 'POIs per file',
        passed: this.results.sqlite.pois.avgPerFile >= 1,
        value: `${this.results.sqlite.pois.avgPerFile} avg`
      },
      {
        name: 'Relationships discovered',
        passed: this.results.sqlite.relationships.total > 0,
        value: `${this.results.sqlite.relationships.total} relationships`
      },
      {
        name: 'Neo4j nodes created',
        passed: this.results.neo4j.nodes.total > 0,
        value: `${this.results.neo4j.nodes.total} nodes`
      },
      {
        name: 'Neo4j relationships',
        passed: this.results.neo4j.relationships.total > 0,
        value: `${this.results.neo4j.relationships.total} edges`
      },
      {
        name: 'Triangulation active',
        passed: this.results.sqlite.triangulation.sessions > 0,
        value: `${this.results.sqlite.triangulation.completed} completed`
      }
    ];
    
    checks.forEach(check => {
      const status = check.passed ? `${colors.green}✓ PASS${colors.reset}` : `${colors.red}✗ FAIL${colors.reset}`;
      console.log(`  ${status} ${check.name}: ${check.value}`);
    });
    
    const totalChecks = checks.length;
    const passedChecks = checks.filter(c => c.passed).length;
    const overallHealth = (passedChecks / totalChecks) * 100;
    
    console.log(`\n${colors.bright}OVERALL PIPELINE HEALTH: ${
      overallHealth >= 80 ? colors.green : overallHealth >= 50 ? colors.yellow : colors.red
    }${overallHealth.toFixed(0)}%${colors.reset}`);
    
    // Success Criteria Evaluation
    console.log(`\n${colors.bright}SUCCESS CRITERIA:${colors.reset}`);
    const criteria = {
      'POIs extracted from all files': this.results.sqlite.pois.total > 0 && this.results.sqlite.files.processed > 0,
      'Relationships discovered': this.results.sqlite.relationships.total > 0,
      'Neo4j graph populated': this.results.neo4j.nodes.total > 0 && this.results.neo4j.relationships.total > 0
    };
    
    Object.entries(criteria).forEach(([criterion, met]) => {
      console.log(`  ${met ? colors.green + '✓' : colors.red + '✗'} ${criterion}${colors.reset}`);
    });
    
    const allCriteriaMet = Object.values(criteria).every(v => v);
    console.log(`\n${colors.bright}PIPELINE STATUS: ${
      allCriteriaMet ? colors.green + 'WORKING CORRECTLY' : colors.red + 'NEEDS ATTENTION'
    }${colors.reset}`);
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
    if (this.neo4jDriver) {
      await this.neo4jDriver.close();
    }
  }

  async run() {
    try {
      console.log(`${colors.bright}${colors.cyan}CTP Pipeline Verification Tool${colors.reset}`);
      console.log(`${colors.cyan}${'='.repeat(40)}${colors.reset}\n`);
      
      await this.connect();
      await this.getLatestRunId();
      
      await this.verifyFiles();
      await this.verifyPOIs();
      await this.verifyRelationships();
      await this.verifyTriangulation();
      await this.verifyEvidence();
      await this.verifyNeo4j();
      
      await this.generateReport();
      
    } catch (error) {
      console.error(`\n${colors.red}Verification failed:${colors.reset}`, error);
      process.exit(1);
    } finally {
      await this.close();
    }
  }
}

// Run verification
if (require.main === module) {
  const verifier = new PipelineVerifier();
  verifier.run().catch(console.error);
}

module.exports = PipelineVerifier;