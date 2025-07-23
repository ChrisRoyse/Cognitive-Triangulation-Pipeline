CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    hash TEXT,
    last_processed DATETIME,
    status TEXT
);

CREATE TABLE IF NOT EXISTS pois (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    llm_output TEXT,
    hash TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_poi_id INTEGER,
    target_poi_id INTEGER,
    type TEXT NOT NULL,
    file_path TEXT,
    status TEXT,
    confidence_score REAL,
    FOREIGN KEY (source_poi_id) REFERENCES pois (id) ON DELETE CASCADE,
    FOREIGN KEY (target_poi_id) REFERENCES pois (id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_relationships_status ON relationships(status);

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

CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);