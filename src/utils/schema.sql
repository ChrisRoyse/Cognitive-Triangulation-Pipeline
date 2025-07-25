CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    hash TEXT,
    last_processed DATETIME,
    status TEXT
);

CREATE TABLE IF NOT EXISTS pois (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    description TEXT,
    is_exported BOOLEAN DEFAULT 0,
    semantic_id TEXT,
    llm_output TEXT,
    hash TEXT UNIQUE,
    run_id TEXT,
    FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_poi_id INTEGER,
    target_poi_id INTEGER,
    type TEXT NOT NULL,
    file_path TEXT,
    status TEXT,
    confidence REAL DEFAULT 0.8,
    reason TEXT,
    run_id TEXT,
    evidence TEXT,
    FOREIGN KEY (source_poi_id) REFERENCES pois (id) ON DELETE CASCADE,
    FOREIGN KEY (target_poi_id) REFERENCES pois (id) ON DELETE CASCADE
);
    
    CREATE INDEX IF NOT EXISTS idx_relationships_status ON relationships(status);
CREATE INDEX IF NOT EXISTS idx_pois_file_id ON pois(file_id);
CREATE INDEX IF NOT EXISTS idx_pois_run_id ON pois(run_id);
CREATE INDEX IF NOT EXISTS idx_pois_type ON pois(type);
CREATE INDEX IF NOT EXISTS idx_pois_name ON pois(name);
CREATE INDEX IF NOT EXISTS idx_pois_semantic_id ON pois(semantic_id);
CREATE INDEX IF NOT EXISTS idx_relationships_run_id ON relationships(run_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);

-- Enhanced performance indexes for relationship_evidence
CREATE INDEX IF NOT EXISTS idx_relationship_evidence_hash ON relationship_evidence(relationship_hash);
CREATE INDEX IF NOT EXISTS idx_relationship_evidence_run_id ON relationship_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_relationship_evidence_composite ON relationship_evidence(run_id, relationship_hash);
CREATE INDEX IF NOT EXISTS idx_relationship_evidence_relationship_id ON relationship_evidence(relationship_id);

-- Enhanced indexes for relationships table
CREATE INDEX IF NOT EXISTS idx_relationships_source_target ON relationships(source_poi_id, target_poi_id);
CREATE INDEX IF NOT EXISTS idx_relationships_status_type ON relationships(status, type);
CREATE INDEX IF NOT EXISTS idx_relationships_confidence_desc ON relationships(confidence DESC);

-- Enhanced indexes for pois table
CREATE INDEX IF NOT EXISTS idx_pois_semantic_hash ON pois(semantic_id, hash);
CREATE INDEX IF NOT EXISTS idx_pois_type_name ON pois(type, name);
CREATE INDEX IF NOT EXISTS idx_pois_file_type ON pois(file_id, type);

-- Indexes for relationship_evidence_tracking table
CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_run_id ON relationship_evidence_tracking(run_id);
CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_hash ON relationship_evidence_tracking(relationship_hash);
CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_status ON relationship_evidence_tracking(status);
CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_created ON relationship_evidence_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_rel_evidence_tracking_relationship_id ON relationship_evidence_tracking(relationship_id);

CREATE TABLE IF NOT EXISTS directory_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    directory_path TEXT NOT NULL,
    summary_text TEXT,
    UNIQUE(run_id, directory_path)
);

CREATE TABLE IF NOT EXISTS relationship_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relationship_id INTEGER,
    run_id TEXT NOT NULL,
    evidence_payload TEXT NOT NULL,
    relationship_hash TEXT,
    FOREIGN KEY (relationship_id) REFERENCES relationships (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationship_evidence_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    relationship_hash TEXT NOT NULL,
    relationship_id INTEGER,
    evidence_count INTEGER DEFAULT 0,
    expected_count INTEGER NOT NULL DEFAULT 0,
    total_confidence REAL DEFAULT 0.0,
    avg_confidence REAL DEFAULT 0.0,
    status TEXT DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    error_message TEXT,
    
    -- Composite unique constraint
    UNIQUE(run_id, relationship_hash),
    
    -- Foreign key to relationships table
    FOREIGN KEY (relationship_id) REFERENCES relationships (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Triangulated Analysis Tables
CREATE TABLE IF NOT EXISTS triangulated_analysis_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    relationship_id INTEGER,
    relationship_from TEXT NOT NULL,
    relationship_to TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    run_id TEXT NOT NULL,
    orchestrator_id TEXT,
    status TEXT DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, FAILED
    initial_confidence REAL,
    final_confidence REAL,
    consensus_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    escalated_to_human BOOLEAN DEFAULT 0,
    FOREIGN KEY (relationship_id) REFERENCES relationships (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subagent_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL, -- syntactic, semantic, contextual
    analysis_id TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, FAILED, TIMEOUT
    confidence_score REAL,
    evidence_strength REAL,
    reasoning TEXT,
    analysis_data TEXT, -- JSON containing detailed analysis
    processing_time_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS consensus_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    consensus_algorithm TEXT DEFAULT 'weighted_voting',
    syntactic_weight REAL DEFAULT 0.35,
    semantic_weight REAL DEFAULT 0.40,
    contextual_weight REAL DEFAULT 0.25,
    syntactic_confidence REAL,
    semantic_confidence REAL,
    contextual_confidence REAL,
    weighted_consensus REAL,
    conflict_detected BOOLEAN DEFAULT 0,
    conflict_severity REAL DEFAULT 0.0,
    resolution_method TEXT,
    final_decision TEXT, -- ACCEPT, REJECT, ESCALATE
    decision_reasoning TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id) ON DELETE CASCADE
);

-- Indexes for triangulated analysis tables
CREATE INDEX IF NOT EXISTS idx_triangulated_sessions_status ON triangulated_analysis_sessions(status);
CREATE INDEX IF NOT EXISTS idx_triangulated_sessions_run_id ON triangulated_analysis_sessions(run_id);
CREATE INDEX IF NOT EXISTS idx_triangulated_sessions_relationship_id ON triangulated_analysis_sessions(relationship_id);
CREATE INDEX IF NOT EXISTS idx_subagent_analyses_session_id ON subagent_analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_subagent_analyses_agent_type ON subagent_analyses(agent_type);
CREATE INDEX IF NOT EXISTS idx_subagent_analyses_status ON subagent_analyses(status);
CREATE INDEX IF NOT EXISTS idx_consensus_decisions_session_id ON consensus_decisions(session_id);

-- Parallel Coordination Tables
CREATE TABLE IF NOT EXISTS parallel_coordination_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coordination_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    coordinator_id TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING', -- PENDING, ANALYZING, REVIEWING, RESOLVING_CONFLICTS, COMPLETED, FAILED
    consensus_confidence REAL,
    consensus_strength REAL,
    agreement_level REAL,
    processing_time_ms INTEGER,
    agent_count INTEGER,
    conflicts_detected INTEGER DEFAULT 0,
    conflicts_resolved INTEGER DEFAULT 0,
    result_data TEXT, -- JSON containing full coordination result
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_review_matrix (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coordination_id TEXT NOT NULL,
    reviewer_agent TEXT NOT NULL,
    target_agent TEXT NOT NULL,
    agreement BOOLEAN,
    confidence_delta REAL,
    review_confidence REAL,
    review_reasoning TEXT,
    concerns TEXT, -- JSON array of concerns
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coordination_id) REFERENCES parallel_coordination_results (coordination_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conflict_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coordination_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL, -- confidence_variance, review_disagreement, etc.
    severity TEXT NOT NULL, -- critical, high, medium, low
    resolved BOOLEAN DEFAULT 0,
    resolution_strategy TEXT,
    original_variance REAL,
    resolved_confidence REAL,
    resolution_details TEXT, -- JSON containing detailed resolution data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coordination_id) REFERENCES parallel_coordination_results (coordination_id) ON DELETE CASCADE
);

-- Indexes for parallel coordination tables
CREATE INDEX IF NOT EXISTS idx_parallel_coordination_status ON parallel_coordination_results(status);
CREATE INDEX IF NOT EXISTS idx_parallel_coordination_session_id ON parallel_coordination_results(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_review_coordination_id ON agent_review_matrix(coordination_id);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_coordination_id ON conflict_resolutions(coordination_id);

-- Run Status Table
CREATE TABLE IF NOT EXISTS run_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    UNIQUE(run_id, status, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_run_status_run_id ON run_status(run_id);
CREATE INDEX IF NOT EXISTS idx_run_status_status ON run_status(status);
CREATE INDEX IF NOT EXISTS idx_run_status_timestamp ON run_status(timestamp);

-- Directory File Mappings Table
CREATE TABLE IF NOT EXISTS directory_file_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    directory_path TEXT NOT NULL,
    file_job_ids TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, directory_path)
);

CREATE INDEX IF NOT EXISTS idx_directory_file_mappings_run_id ON directory_file_mappings(run_id);