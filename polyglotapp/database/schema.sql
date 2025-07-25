-- Database schema for Polyglot Test Application
-- SQLite schema supporting JavaScript, Python, and Java services

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- ============================================================================
-- USERS AND AUTHENTICATION TABLES
-- ============================================================================

-- Main users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'moderator', 'premium', 'user')),
    password_hash TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0
);

-- User sessions for authentication
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- User activity log
CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    activity_type TEXT NOT NULL,
    description TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(user_id, preference_key)
);

-- ============================================================================
-- DATA PROCESSING TABLES
-- ============================================================================

-- Processing jobs table (used by Python service)
CREATE TABLE IF NOT EXISTS processing_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    input_data TEXT, -- JSON string
    output_data TEXT, -- JSON string
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    processing_time_seconds REAL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Analysis results table
CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    analysis_type TEXT NOT NULL,
    metrics TEXT, -- JSON string
    confidence_score REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES processing_jobs (id) ON DELETE CASCADE
);

-- ============================================================================
-- MACHINE LEARNING TABLES
-- ============================================================================

-- ML models registry
CREATE TABLE IF NOT EXISTS ml_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    model_type TEXT NOT NULL,
    version TEXT NOT NULL,
    parameters TEXT, -- JSON string
    accuracy REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- ML predictions log
CREATE TABLE IF NOT EXISTS ml_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER,
    user_id INTEGER,
    input_features TEXT, -- JSON string
    prediction_result TEXT, -- JSON string
    confidence_score REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (model_id) REFERENCES ml_models (id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- ============================================================================
-- API AND COMMUNICATION TABLES
-- ============================================================================

-- API request log (cross-service communication)
CREATE TABLE IF NOT EXISTS api_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_service TEXT NOT NULL, -- 'javascript', 'python', 'java'
    target_service TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT DEFAULT 'POST',
    request_payload TEXT, -- JSON string
    response_payload TEXT, -- JSON string
    status_code INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT FALSE
);

-- Event notifications between services
CREATE TABLE IF NOT EXISTS service_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    source_service TEXT NOT NULL,
    target_service TEXT,
    event_data TEXT, -- JSON string
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- ============================================================================
-- SYSTEM MONITORING TABLES
-- ============================================================================

-- System health metrics
CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    metric_type TEXT NOT NULL, -- 'cpu', 'memory', 'response_time', 'error_rate'
    metric_value REAL NOT NULL,
    unit TEXT, -- 'percent', 'mb', 'ms', 'count'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Error log
CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    user_id INTEGER,
    request_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- ============================================================================
-- APPLICATION-SPECIFIC TABLES
-- ============================================================================

-- File upload tracking
CREATE TABLE IF NOT EXISTS file_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT NOT NULL,
    file_size INTEGER,
    file_type TEXT,
    file_path TEXT,
    upload_status TEXT DEFAULT 'pending' CHECK (upload_status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Cache entries (for cross-service data sharing)
CREATE TABLE IF NOT EXISTS cache_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    cache_value TEXT, -- JSON string
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Configuration settings
CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT UNIQUE NOT NULL,
    config_value TEXT,
    config_type TEXT DEFAULT 'string' CHECK (config_type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- User-related indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(activity_type);

-- Processing-related indexes
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_type ON processing_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_analysis_results_job_id ON analysis_results(job_id);

-- ML-related indexes
CREATE INDEX IF NOT EXISTS idx_ml_models_name ON ml_models(name);
CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(is_active);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_model_id ON ml_predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_user_id ON ml_predictions(user_id);

-- API and system indexes
CREATE INDEX IF NOT EXISTS idx_api_requests_source ON api_requests(source_service);
CREATE INDEX IF NOT EXISTS idx_api_requests_target ON api_requests(target_service);
CREATE INDEX IF NOT EXISTS idx_api_requests_created ON api_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_service_events_type ON service_events(event_type);
CREATE INDEX IF NOT EXISTS idx_service_events_processed ON service_events(processed);

-- System monitoring indexes
CREATE INDEX IF NOT EXISTS idx_system_metrics_service ON system_metrics(service_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_type ON system_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_system_metrics_created ON system_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_service ON error_log(service_name);
CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);

-- Cache and config indexes
CREATE INDEX IF NOT EXISTS idx_cache_entries_key ON cache_entries(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_config_key ON app_config(config_key);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Update user_preferences.updated_at on modification
CREATE TRIGGER IF NOT EXISTS update_user_preferences_timestamp
    AFTER UPDATE ON user_preferences
    BEGIN
        UPDATE user_preferences 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

-- Update ml_models.updated_at on modification
CREATE TRIGGER IF NOT EXISTS update_ml_models_timestamp
    AFTER UPDATE ON ml_models
    BEGIN
        UPDATE ml_models 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

-- Update app_config.updated_at on modification
CREATE TRIGGER IF NOT EXISTS update_app_config_timestamp
    AFTER UPDATE ON app_config
    BEGIN
        UPDATE app_config 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

-- Update cache_entries.accessed_at when cache is read
CREATE TRIGGER IF NOT EXISTS update_cache_access_timestamp
    AFTER UPDATE ON cache_entries
    WHEN NEW.cache_value != OLD.cache_value
    BEGIN
        UPDATE cache_entries 
        SET accessed_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active users view
CREATE VIEW IF NOT EXISTS active_users AS
SELECT 
    id, email, name, role, created_at, last_login, login_count
FROM users 
WHERE is_active = TRUE;

-- Processing job summary view
CREATE VIEW IF NOT EXISTS job_summary AS
SELECT 
    pj.id,
    pj.job_type,
    pj.status,
    u.name as user_name,
    u.email as user_email,
    pj.created_at,
    pj.completed_at,
    pj.processing_time_seconds
FROM processing_jobs pj
LEFT JOIN users u ON pj.user_id = u.id;

-- ML model performance view
CREATE VIEW IF NOT EXISTS model_performance AS
SELECT 
    m.name,
    m.model_type,
    m.accuracy,
    COUNT(p.id) as prediction_count,
    AVG(p.confidence_score) as avg_confidence,
    m.created_at,
    m.updated_at
FROM ml_models m
LEFT JOIN ml_predictions p ON m.id = p.model_id
WHERE m.is_active = TRUE
GROUP BY m.id, m.name, m.model_type, m.accuracy, m.created_at, m.updated_at;

-- Service communication stats view
CREATE VIEW IF NOT EXISTS service_stats AS
SELECT 
    source_service,
    target_service,
    COUNT(*) as request_count,
    AVG(response_time_ms) as avg_response_time,
    SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as success_count,
    ROUND(100.0 * SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM api_requests
GROUP BY source_service, target_service;

-- System health overview
CREATE VIEW IF NOT EXISTS system_health AS
SELECT 
    service_name,
    metric_type,
    AVG(metric_value) as avg_value,
    MIN(metric_value) as min_value,
    MAX(metric_value) as max_value,
    COUNT(*) as sample_count,
    MAX(created_at) as last_updated
FROM system_metrics
WHERE created_at > datetime('now', '-1 hour')
GROUP BY service_name, metric_type; 