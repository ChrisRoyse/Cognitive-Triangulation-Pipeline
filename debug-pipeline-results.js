#!/usr/bin/env node

/**
 * Pipeline Debug Script
 * 
 * This script provides detailed debugging queries to inspect pipeline results
 * and diagnose issues with POI extraction and relationship discovery.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class PipelineDebugger {
  constructor() {
    this.db = null;
  }

  async connect() {
    const dbPath = path.join(process.cwd(), 'database.sqlite');
    console.log(`${colors.cyan}Connecting to: ${dbPath}${colors.reset}\n`);
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async runQuery(title, query, params = []) {
    console.log(`${colors.bright}${colors.blue}${title}${colors.reset}`);
    console.log(`${colors.dim}Query: ${query}${colors.reset}`);
    
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
          reject(err);
        } else {
          console.log(`${colors.green}Results: ${rows.length} rows${colors.reset}`);
          if (rows.length > 0) {
            console.table(rows);
          }
          console.log('');
          resolve(rows);
        }
      });
    });
  }

  async debugRuns() {
    console.log(`\n${colors.bright}${colors.cyan}=== PIPELINE RUNS ===${colors.reset}\n`);
    
    // Recent runs
    await this.runQuery(
      'Recent Pipeline Runs (Last 10)',
      `SELECT 
        run_id,
        status,
        datetime(timestamp, 'localtime') as local_time,
        metadata
       FROM run_status
       WHERE status = 'STARTED'
       ORDER BY timestamp DESC
       LIMIT 10`
    );
    
    // Run summary
    await this.runQuery(
      'Run Status Summary',
      `SELECT 
        run_id,
        COUNT(DISTINCT CASE WHEN status = 'STARTED' THEN 1 END) as started,
        COUNT(DISTINCT CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
        MIN(timestamp) as first_event,
        MAX(timestamp) as last_event
       FROM run_status
       GROUP BY run_id
       ORDER BY MAX(timestamp) DESC
       LIMIT 5`
    );
  }

  async debugFiles() {
    console.log(`\n${colors.bright}${colors.cyan}=== FILES PROCESSED ===${colors.reset}\n`);
    
    // File processing status
    await this.runQuery(
      'File Processing Status',
      `SELECT 
        status,
        COUNT(*) as count
       FROM files
       GROUP BY status`
    );
    
    // Recently processed files
    await this.runQuery(
      'Recently Processed Files (Last 10)',
      `SELECT 
        file_path,
        status,
        datetime(last_processed, 'localtime') as processed_time
       FROM files
       WHERE last_processed IS NOT NULL
       ORDER BY last_processed DESC
       LIMIT 10`
    );
    
    // Files with most POIs
    await this.runQuery(
      'Files with Most POIs (Top 10)',
      `SELECT 
        f.file_path,
        COUNT(p.id) as poi_count,
        GROUP_CONCAT(DISTINCT p.type) as poi_types
       FROM files f
       LEFT JOIN pois p ON f.id = p.file_id
       GROUP BY f.id
       HAVING poi_count > 0
       ORDER BY poi_count DESC
       LIMIT 10`
    );
  }

  async debugPOIs(runId) {
    console.log(`\n${colors.bright}${colors.cyan}=== POINTS OF INTEREST (POIs) ===${colors.reset}\n`);
    
    // POI type distribution
    await this.runQuery(
      'POI Type Distribution',
      `SELECT 
        type,
        COUNT(*) as count,
        COUNT(DISTINCT file_path) as files_with_type
       FROM pois
       ${runId ? 'WHERE run_id = ?' : ''}
       GROUP BY type
       ORDER BY count DESC`,
      runId ? [runId] : []
    );
    
    // Sample POIs
    await this.runQuery(
      'Sample POIs (First 10)',
      `SELECT 
        name,
        type,
        file_path,
        start_line,
        end_line,
        is_exported,
        SUBSTR(description, 1, 50) || '...' as description_preview
       FROM pois
       ${runId ? 'WHERE run_id = ?' : ''}
       ORDER BY id DESC
       LIMIT 10`,
      runId ? [runId] : []
    );
    
    // POIs with semantic IDs
    await this.runQuery(
      'POIs with Semantic IDs (Sample)',
      `SELECT 
        name,
        type,
        semantic_id,
        file_path
       FROM pois
       WHERE semantic_id IS NOT NULL
       ${runId ? 'AND run_id = ?' : ''}
       LIMIT 10`,
      runId ? [runId] : []
    );
  }

  async debugRelationships(runId) {
    console.log(`\n${colors.bright}${colors.cyan}=== RELATIONSHIPS ===${colors.reset}\n`);
    
    // Relationship type distribution
    await this.runQuery(
      'Relationship Type Distribution',
      `SELECT 
        type,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence,
        MIN(confidence) as min_confidence,
        MAX(confidence) as max_confidence
       FROM relationships
       ${runId ? 'WHERE run_id = ?' : ''}
       GROUP BY type
       ORDER BY count DESC`,
      runId ? [runId] : []
    );
    
    // Sample relationships with POI details
    await this.runQuery(
      'Sample Relationships with Details (First 10)',
      `SELECT 
        r.type as relationship_type,
        sp.name as source_name,
        sp.type as source_type,
        tp.name as target_name,
        tp.type as target_type,
        r.confidence,
        r.status,
        SUBSTR(r.reason, 1, 50) || '...' as reason_preview
       FROM relationships r
       JOIN pois sp ON r.source_poi_id = sp.id
       JOIN pois tp ON r.target_poi_id = tp.id
       ${runId ? 'WHERE r.run_id = ?' : ''}
       ORDER BY r.confidence DESC
       LIMIT 10`,
      runId ? [runId] : []
    );
    
    // Relationships by status
    await this.runQuery(
      'Relationships by Status',
      `SELECT 
        status,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence
       FROM relationships
       ${runId ? 'WHERE run_id = ?' : ''}
       GROUP BY status`,
      runId ? [runId] : []
    );
    
    // High confidence relationships
    await this.runQuery(
      'High Confidence Relationships (≥ 0.9)',
      `SELECT 
        r.type,
        sp.name || ' -> ' || tp.name as connection,
        r.confidence,
        r.file_path
       FROM relationships r
       JOIN pois sp ON r.source_poi_id = sp.id
       JOIN pois tp ON r.target_poi_id = tp.id
       WHERE r.confidence >= 0.9
       ${runId ? 'AND r.run_id = ?' : ''}
       LIMIT 10`,
      runId ? [runId] : []
    );
  }

  async debugTriangulation(runId) {
    console.log(`\n${colors.bright}${colors.cyan}=== TRIANGULATION ANALYSIS ===${colors.reset}\n`);
    
    // Triangulation session summary
    await this.runQuery(
      'Triangulation Session Summary',
      `SELECT 
        status,
        COUNT(*) as count,
        AVG(final_confidence) as avg_final_confidence,
        AVG(consensus_score) as avg_consensus
       FROM triangulated_analysis_sessions
       ${runId ? 'WHERE run_id = ?' : ''}
       GROUP BY status`,
      runId ? [runId] : []
    );
    
    // Subagent performance
    await this.runQuery(
      'Subagent Analysis Performance',
      `SELECT 
        agent_type,
        status,
        COUNT(*) as count,
        AVG(confidence_score) as avg_confidence,
        AVG(processing_time_ms) as avg_time_ms
       FROM subagent_analyses
       GROUP BY agent_type, status`,
    );
    
    // Consensus decisions
    await this.runQuery(
      'Consensus Decision Distribution',
      `SELECT 
        final_decision,
        COUNT(*) as count,
        AVG(weighted_consensus) as avg_consensus,
        SUM(conflict_detected) as conflicts
       FROM consensus_decisions
       GROUP BY final_decision`
    );
  }

  async debugEvidence(runId) {
    console.log(`\n${colors.bright}${colors.cyan}=== EVIDENCE TRACKING ===${colors.reset}\n`);
    
    // Evidence summary
    await this.runQuery(
      'Evidence Tracking Summary',
      `SELECT 
        status,
        COUNT(*) as relationships,
        SUM(evidence_count) as total_evidence,
        AVG(evidence_count) as avg_evidence_per_rel,
        AVG(avg_confidence) as avg_confidence
       FROM relationship_evidence_tracking
       ${runId ? 'WHERE run_id = ?' : ''}
       GROUP BY status`,
      runId ? [runId] : []
    );
    
    // Relationships with most evidence
    await this.runQuery(
      'Relationships with Most Evidence (Top 10)',
      `SELECT 
        ret.relationship_hash,
        ret.evidence_count,
        ret.avg_confidence,
        r.type as relationship_type,
        sp.name || ' -> ' || tp.name as connection
       FROM relationship_evidence_tracking ret
       LEFT JOIN relationships r ON ret.relationship_id = r.id
       LEFT JOIN pois sp ON r.source_poi_id = sp.id
       LEFT JOIN pois tp ON r.target_poi_id = tp.id
       ${runId ? 'WHERE ret.run_id = ?' : ''}
       ORDER BY ret.evidence_count DESC
       LIMIT 10`,
      runId ? [runId] : []
    );
  }

  async debugOutbox() {
    console.log(`\n${colors.bright}${colors.cyan}=== OUTBOX EVENTS ===${colors.reset}\n`);
    
    // Outbox event summary
    await this.runQuery(
      'Outbox Event Summary',
      `SELECT 
        event_type,
        status,
        COUNT(*) as count
       FROM outbox
       GROUP BY event_type, status
       ORDER BY count DESC`
    );
    
    // Recent pending events
    await this.runQuery(
      'Recent Pending Events',
      `SELECT 
        id,
        event_type,
        run_id,
        datetime(created_at, 'localtime') as created_time
       FROM outbox
       WHERE status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 10`
    );
  }

  async findIssues() {
    console.log(`\n${colors.bright}${colors.red}=== POTENTIAL ISSUES ===${colors.reset}\n`);
    
    // Files without POIs
    await this.runQuery(
      'Files Without POIs',
      `SELECT 
        f.file_path,
        f.status,
        f.last_processed
       FROM files f
       LEFT JOIN pois p ON f.id = p.file_id
       WHERE p.id IS NULL
       AND f.status != 'failed'
       LIMIT 10`
    );
    
    // POIs without relationships
    await this.runQuery(
      'POIs Without Any Relationships',
      `SELECT 
        p.name,
        p.type,
        p.file_path
       FROM pois p
       LEFT JOIN relationships r1 ON p.id = r1.source_poi_id
       LEFT JOIN relationships r2 ON p.id = r2.target_poi_id
       WHERE r1.id IS NULL AND r2.id IS NULL
       AND p.type IN ('class', 'function', 'export')
       LIMIT 10`
    );
    
    // Low confidence relationships
    await this.runQuery(
      'Very Low Confidence Relationships (< 0.3)',
      `SELECT 
        r.type,
        r.confidence,
        sp.name as source,
        tp.name as target,
        r.reason
       FROM relationships r
       JOIN pois sp ON r.source_poi_id = sp.id
       JOIN pois tp ON r.target_poi_id = tp.id
       WHERE r.confidence < 0.3
       LIMIT 10`
    );
    
    // Failed triangulation sessions
    await this.runQuery(
      'Failed Triangulation Sessions',
      `SELECT 
        session_id,
        relationship_from,
        relationship_to,
        relationship_type,
        error_message
       FROM triangulated_analysis_sessions
       WHERE status = 'FAILED'
       LIMIT 10`
    );
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
  }

  async run(options = {}) {
    try {
      await this.connect();
      
      const runId = options.runId;
      if (runId) {
        console.log(`${colors.yellow}Filtering by run_id: ${runId}${colors.reset}\n`);
      }
      
      if (options.section === 'all' || options.section === 'runs') {
        await this.debugRuns();
      }
      
      if (options.section === 'all' || options.section === 'files') {
        await this.debugFiles();
      }
      
      if (options.section === 'all' || options.section === 'pois') {
        await this.debugPOIs(runId);
      }
      
      if (options.section === 'all' || options.section === 'relationships') {
        await this.debugRelationships(runId);
      }
      
      if (options.section === 'all' || options.section === 'triangulation') {
        await this.debugTriangulation(runId);
      }
      
      if (options.section === 'all' || options.section === 'evidence') {
        await this.debugEvidence(runId);
      }
      
      if (options.section === 'all' || options.section === 'outbox') {
        await this.debugOutbox();
      }
      
      if (options.section === 'all' || options.section === 'issues') {
        await this.findIssues();
      }
      
    } catch (error) {
      console.error(`${colors.red}Debug failed:${colors.reset}`, error);
    } finally {
      await this.close();
    }
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    section: 'all',
    runId: null
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--section':
      case '-s':
        options.section = args[++i];
        break;
      case '--run-id':
      case '-r':
        options.runId = args[++i];
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
${colors.bright}Pipeline Debug Tool${colors.reset}

Usage: node debug-pipeline-results.js [options]

Options:
  -s, --section <name>   Debug specific section (default: all)
                         Available sections:
                         - all           : Show everything
                         - runs          : Pipeline runs
                         - files         : File processing
                         - pois          : Points of Interest
                         - relationships : Discovered relationships
                         - triangulation : Triangulation analysis
                         - evidence      : Evidence tracking
                         - outbox        : Outbox events
                         - issues        : Potential issues
                         
  -r, --run-id <id>     Filter by specific run ID
  -h, --help            Show this help message

Examples:
  node debug-pipeline-results.js                    # Show all debug info
  node debug-pipeline-results.js -s relationships   # Show only relationships
  node debug-pipeline-results.js -r run_12345       # Filter by run ID
  node debug-pipeline-results.js -s issues          # Show potential issues
`);
}

// Run debugger
if (require.main === module) {
  const options = parseArgs();
  const debugger = new PipelineDebugger();
  debugger.run(options).catch(console.error);
}

module.exports = PipelineDebugger;