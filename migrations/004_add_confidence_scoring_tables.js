/**
 * Migration: Add confidence scoring tables and columns
 * Adds support for storing confidence scoring data and escalation information
 */

const fs = require('fs');
const path = require('path');

function up(db) {
    console.log('[Migration 004] Adding confidence scoring support...');

    // Add confidence-related columns to relationships table
    try {
        db.exec(`
            ALTER TABLE relationships ADD COLUMN confidence_level TEXT;
        `);
        console.log('✅ Added confidence_level column to relationships table');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            throw error;
        }
        console.log('⚠️  confidence_level column already exists');
    }

    try {
        db.exec(`
            ALTER TABLE relationships ADD COLUMN confidence_breakdown TEXT;
        `);
        console.log('✅ Added confidence_breakdown column to relationships table');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            throw error;
        }
        console.log('⚠️  confidence_breakdown column already exists');
    }

    try {
        db.exec(`
            ALTER TABLE relationships ADD COLUMN scoring_metadata TEXT;
        `);
        console.log('✅ Added scoring_metadata column to relationships table');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            throw error;
        }
        console.log('⚠️  scoring_metadata column already exists');
    }

    try {
        db.exec(`
            ALTER TABLE relationships ADD COLUMN escalation_triggers TEXT;
        `);
        console.log('✅ Added escalation_triggers column to relationships table');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            throw error;
        }
        console.log('⚠️  escalation_triggers column already exists');
    }

    // Create relationship_confidence_scores table for detailed scoring data
    db.exec(`
        CREATE TABLE IF NOT EXISTS relationship_confidence_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            score_id TEXT UNIQUE NOT NULL,
            relationship_id INTEGER,
            from_semantic_id TEXT NOT NULL,
            to_semantic_id TEXT NOT NULL,
            relationship_type TEXT NOT NULL,
            final_confidence REAL NOT NULL,
            confidence_level TEXT NOT NULL,
            escalation_needed BOOLEAN DEFAULT 0,
            
            -- Factor scores breakdown
            factor_scores TEXT NOT NULL, -- JSON: {syntax, semantic, context, crossRef}
            weighted_sum REAL NOT NULL,
            penalty_factor REAL NOT NULL,
            uncertainty_adjustment REAL NOT NULL,
            raw_score REAL NOT NULL,
            
            -- Evidence and penalties
            applied_penalties TEXT, -- JSON array of applied penalties
            evidence_count INTEGER DEFAULT 0,
            
            -- Escalation information
            escalation_triggers TEXT, -- JSON array of triggered escalations
            escalation_metadata TEXT, -- JSON object with escalation details
            
            -- Metadata
            timestamp TEXT NOT NULL,
            scorer_version TEXT DEFAULT '1.0.0',
            calculation_duration INTEGER, -- milliseconds
            run_id TEXT,
            
            FOREIGN KEY (relationship_id) REFERENCES relationships (id) ON DELETE CASCADE
        );
    `);
    console.log('✅ Created relationship_confidence_scores table');

    // Create confidence_escalations table for tracking escalated relationships
    db.exec(`
        CREATE TABLE IF NOT EXISTS confidence_escalations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            escalation_id TEXT UNIQUE NOT NULL,
            relationship_id INTEGER,
            score_id TEXT,
            
            -- Escalation details
            trigger_type TEXT NOT NULL,
            trigger_threshold REAL,
            priority TEXT DEFAULT 'MEDIUM',
            action TEXT DEFAULT 'QUEUE_FOR_REVIEW',
            
            -- Relationship context
            from_semantic_id TEXT NOT NULL,
            to_semantic_id TEXT NOT NULL,
            file_path TEXT,
            
            -- Status tracking
            status TEXT DEFAULT 'PENDING', -- PENDING, IN_REVIEW, RESOLVED, IGNORED
            assigned_to TEXT,
            resolution_notes TEXT,
            resolved_at TEXT,
            
            -- Metadata
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            run_id TEXT,
            
            FOREIGN KEY (relationship_id) REFERENCES relationships (id) ON DELETE CASCADE,
            FOREIGN KEY (score_id) REFERENCES relationship_confidence_scores (score_id) ON DELETE CASCADE
        );
    `);
    console.log('✅ Created confidence_escalations table');

    // Create evidence_items table for storing confidence evidence
    db.exec(`
        CREATE TABLE IF NOT EXISTS confidence_evidence_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            evidence_id TEXT UNIQUE NOT NULL,
            score_id TEXT NOT NULL,
            
            -- Evidence details
            type TEXT NOT NULL, -- LLM_REASONING, SYNTAX_PATTERN, SEMANTIC_DOMAIN, etc.
            text TEXT NOT NULL,
            source TEXT NOT NULL, -- RelationshipResolutionWorker, SemanticAnalysis, etc.
            confidence REAL DEFAULT 0.5,
            weight REAL DEFAULT 1.0,
            
            -- Context information
            context TEXT, -- JSON object with context details
            
            -- Metadata
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            run_id TEXT,
            
            FOREIGN KEY (score_id) REFERENCES relationship_confidence_scores (score_id) ON DELETE CASCADE
        );
    `);
    console.log('✅ Created confidence_evidence_items table');

    // Create indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_relationship_confidence_scores_score_id 
        ON relationship_confidence_scores(score_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_relationship_confidence_scores_relationship_id 
        ON relationship_confidence_scores(relationship_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_relationship_confidence_scores_confidence_level 
        ON relationship_confidence_scores(confidence_level);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_relationship_confidence_scores_escalation_needed 
        ON relationship_confidence_scores(escalation_needed);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_relationship_confidence_scores_run_id 
        ON relationship_confidence_scores(run_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_escalations_escalation_id 
        ON confidence_escalations(escalation_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_escalations_status 
        ON confidence_escalations(status);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_escalations_trigger_type 
        ON confidence_escalations(trigger_type);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_escalations_priority 
        ON confidence_escalations(priority);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_escalations_run_id 
        ON confidence_escalations(run_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_evidence_items_evidence_id 
        ON confidence_evidence_items(evidence_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_evidence_items_score_id 
        ON confidence_evidence_items(score_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_evidence_items_type 
        ON confidence_evidence_items(type);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_confidence_evidence_items_run_id 
        ON confidence_evidence_items(run_id);
    `);

    console.log('✅ Created indexes for confidence scoring tables');

    // Update existing relationships with default confidence data
    const updateCount = db.prepare(`
        UPDATE relationships 
        SET confidence_level = 'MEDIUM',
            confidence_breakdown = '{}',
            scoring_metadata = '{}',
            escalation_triggers = '[]'
        WHERE confidence_level IS NULL
    `).run().changes;

    console.log(`✅ Updated ${updateCount} existing relationships with default confidence data`);

    console.log('[Migration 004] Confidence scoring support added successfully');
}

function down(db) {
    console.log('[Migration 004] Removing confidence scoring support...');

    // Drop tables in reverse order
    db.exec('DROP TABLE IF EXISTS confidence_evidence_items;');
    db.exec('DROP TABLE IF EXISTS confidence_escalations;');
    db.exec('DROP TABLE IF EXISTS relationship_confidence_scores;');

    // Remove columns from relationships table (SQLite doesn't support DROP COLUMN directly)
    // We'll need to recreate the table without the confidence columns
    console.log('⚠️  Note: SQLite does not support DROP COLUMN. Confidence columns will remain but be unused.');

    console.log('[Migration 004] Confidence scoring support removed');
}

class Migration004 {
    constructor(db) {
        this.db = db;
        this.description = 'Add confidence scoring tables and columns';
    }

    up() {
        up(this.db);
    }

    down() {
        down(this.db);
    }
}

module.exports = { Migration004 };