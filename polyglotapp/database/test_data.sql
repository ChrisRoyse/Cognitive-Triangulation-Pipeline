-- Test data for Polyglot Test Application
-- Provides sample data to validate the code analysis system

-- ============================================================================
-- SAMPLE USERS
-- ============================================================================

INSERT OR IGNORE INTO users (id, email, name, role, password_hash, is_active, created_at, login_count) VALUES
(1, 'admin@polyglot.com', 'System Administrator', 'admin', 'hashed_admin123_1640995200', TRUE, '2024-01-01 10:00:00', 25),
(2, 'john.doe@polyglot.com', 'John Doe', 'user', 'hashed_password123_1640995200', TRUE, '2024-01-02 11:30:00', 12),
(3, 'jane.smith@polyglot.com', 'Jane Smith', 'premium', 'hashed_premium456_1640995200', TRUE, '2024-01-03 09:15:00', 8),
(4, 'moderator@polyglot.com', 'Content Moderator', 'moderator', 'hashed_mod789_1640995200', TRUE, '2024-01-04 14:20:00', 15),
(5, 'test.user@polyglot.com', 'Test User', 'user', 'hashed_test999_1640995200', FALSE, '2024-01-05 16:45:00', 3);

-- ============================================================================
-- USER SESSIONS AND ACTIVITY
-- ============================================================================

INSERT OR IGNORE INTO user_sessions (user_id, session_token, expires_at, is_active) VALUES
(1, 'admin_session_token_abc123', '2024-12-31 23:59:59', TRUE),
(2, 'user_session_token_def456', '2024-12-31 23:59:59', TRUE),
(3, 'premium_session_token_ghi789', '2024-12-31 23:59:59', TRUE);

INSERT OR IGNORE INTO user_activity (user_id, activity_type, description, created_at) VALUES
(1, 'USER_LOGIN', 'Administrator logged in', '2024-01-15 09:00:00'),
(1, 'ADMIN_ACTION', 'Created new user account', '2024-01-15 09:30:00'),
(2, 'USER_LOGIN', 'User logged in via web interface', '2024-01-15 10:15:00'),
(2, 'DATA_ACCESS', 'Accessed user dashboard', '2024-01-15 10:16:00'),
(3, 'USER_LOGIN', 'Premium user logged in', '2024-01-15 11:20:00'),
(3, 'PREMIUM_FEATURE', 'Used advanced analytics feature', '2024-01-15 11:25:00'),
(4, 'USER_LOGIN', 'Moderator logged in', '2024-01-15 12:00:00'),
(4, 'MODERATION', 'Reviewed content submissions', '2024-01-15 12:30:00');

INSERT OR IGNORE INTO user_preferences (user_id, preference_key, preference_value) VALUES
(1, 'theme', 'dark'),
(1, 'notifications', 'all'),
(1, 'language', 'en'),
(2, 'theme', 'light'),
(2, 'notifications', 'important'),
(2, 'dashboard_layout', 'compact'),
(3, 'theme', 'dark'),
(3, 'notifications', 'all'),
(3, 'advanced_features', 'enabled'),
(4, 'theme', 'light'),
(4, 'moderation_view', 'detailed');

-- ============================================================================
-- PROCESSING JOBS AND ANALYSIS
-- ============================================================================

INSERT OR IGNORE INTO processing_jobs (id, user_id, job_type, status, input_data, output_data, created_at, completed_at, processing_time_seconds) VALUES
(1, 1, 'data_analysis', 'completed', 
'{"data_points": [1, 2, 3, 4, 5], "analysis_type": "statistical"}',
'{"analysis": {"count": 5, "sum": 15, "average": 3.0, "min": 1, "max": 5, "std_deviation": 1.58}}',
'2024-01-10 14:00:00', '2024-01-10 14:00:15', 15.2),

(2, 2, 'data_transformation', 'completed',
'{"data": [10, 20, 30, 40, 50], "type": "normalize"}',
'{"normalized_data": [0.0, 0.25, 0.5, 0.75, 1.0], "min_value": 10, "max_value": 50}',
'2024-01-11 09:30:00', '2024-01-11 09:30:08', 8.7),

(3, 3, 'ml_prediction', 'completed',
'{"features": [[1.5], [2.3], [3.1]], "model_type": "linear_regression"}',
'{"predictions": [2.35, 3.61, 4.87], "confidence": 0.89, "model_type": "linear_regression"}',
'2024-01-12 11:15:00', '2024-01-12 11:15:12', 12.1),

(4, 1, 'cross_service_call', 'completed',
'{"service": "javascript", "endpoint": "/api/analytics", "method": "GET"}',
'{"status_code": 200, "response": {"analytics": "success"}, "service": "javascript"}',
'2024-01-13 16:20:00', '2024-01-13 16:20:05', 5.3),

(5, 2, 'data_analysis', 'processing',
'{"data_points": [100, 200, 150, 300, 250], "analysis_type": "advanced"}',
NULL, '2024-01-15 13:45:00', NULL, NULL);

INSERT OR IGNORE INTO analysis_results (job_id, analysis_type, metrics, confidence_score) VALUES
(1, 'statistical_analysis', '{"mean": 3.0, "median": 3.0, "mode": null, "variance": 2.5}', 0.95),
(2, 'data_normalization', '{"transformation": "min_max", "scale": "0_to_1", "outliers": 0}', 1.0),
(3, 'ml_prediction', '{"model_accuracy": 0.89, "prediction_variance": 0.12, "feature_importance": [0.87]}', 0.89);

-- ============================================================================
-- MACHINE LEARNING MODELS AND PREDICTIONS
-- ============================================================================

INSERT OR IGNORE INTO ml_models (id, name, model_type, version, parameters, accuracy, is_active) VALUES
(1, 'house_price_predictor', 'linear_regression', '1.0', 
'{"weights": [1.5], "bias": 0.3, "n_samples": 100, "learning_rate": 0.01}', 0.89, TRUE),

(2, 'spam_detector', 'binary_classification', '2.1', 
'{"weights": [0.7, -0.3, 1.2], "bias": 0.1, "threshold": 0.5, "n_features": 3}', 0.94, TRUE),

(3, 'customer_segmentation', 'clustering', '1.5', 
'{"n_clusters": 5, "algorithm": "kmeans", "max_iterations": 300}', 0.76, TRUE),

(4, 'legacy_model', 'linear_regression', '0.9', 
'{"weights": [1.0], "bias": 0.0, "n_samples": 50}', 0.65, FALSE);

INSERT OR IGNORE INTO ml_predictions (model_id, user_id, input_features, prediction_result, confidence_score, created_at) VALUES
(1, 2, '[[1500]]', '{"prediction": 2.55, "confidence": 0.89}', 0.89, '2024-01-10 15:30:00'),
(1, 3, '[[2000]]', '{"prediction": 3.30, "confidence": 0.91}', 0.91, '2024-01-11 10:45:00'),
(2, 1, '[[0.8, -0.2, 1.5]]', '{"prediction": "positive", "probability": 0.87}', 0.87, '2024-01-12 14:20:00'),
(2, 2, '[[0.1, 0.3, -0.5]]', '{"prediction": "negative", "probability": 0.78}', 0.78, '2024-01-13 09:15:00'),
(3, 3, '[[100, 50, 200]]', '{"cluster": 2, "distance": 15.3}', 0.76, '2024-01-14 11:30:00');

-- ============================================================================
-- API REQUESTS AND SERVICE COMMUNICATION
-- ============================================================================

INSERT OR IGNORE INTO api_requests (source_service, target_service, endpoint, method, request_payload, response_payload, status_code, response_time_ms, created_at, success) VALUES
('java', 'javascript', '/api/users/sync', 'POST', 
'{"user_id": 1, "user_data": {"name": "Admin", "role": "admin"}}',
'{"status": "success", "message": "User synced"}', 200, 150, '2024-01-10 10:00:00', TRUE),

('java', 'python', '/api/jobs/submit', 'POST',
'{"user_id": 2, "job_type": "data_analysis", "input_data": {"data": [1,2,3]}}',
'{"job_id": 123, "status": "queued"}', 200, 200, '2024-01-10 11:30:00', TRUE),

('python', 'javascript', '/api/events/job-completed', 'POST',
'{"job_id": 123, "status": "completed", "result": {"analysis": "complete"}}',
'{"status": "received"}', 200, 100, '2024-01-10 11:45:00', TRUE),

('javascript', 'java', '/api/users/1', 'GET',
NULL, '{"user": {"id": 1, "name": "Admin", "email": "admin@polyglot.com"}}', 200, 75, '2024-01-11 09:00:00', TRUE),

('python', 'java', '/api/health', 'GET',
NULL, '{"status": "healthy", "timestamp": "2024-01-11T12:00:00Z"}', 200, 50, '2024-01-11 12:00:00', TRUE),

('java', 'python', '/api/ml/predict', 'POST',
'{"model_name": "house_price_predictor", "features": [[1500]]}',
NULL, 500, 5000, '2024-01-12 14:00:00', FALSE);

INSERT OR IGNORE INTO service_events (event_type, source_service, target_service, event_data, processed, created_at, processed_at) VALUES
('user_created', 'java', 'javascript', '{"user_id": 5, "email": "test.user@polyglot.com"}', TRUE, '2024-01-05 16:45:00', '2024-01-05 16:45:01'),
('user_updated', 'java', 'python', '{"user_id": 2, "changes": {"name": "John Updated"}}', TRUE, '2024-01-10 14:30:00', '2024-01-10 14:30:02'),
('job_completed', 'python', 'javascript', '{"job_id": 1, "status": "completed", "processing_time": 15.2}', TRUE, '2024-01-10 14:00:15', '2024-01-10 14:00:16'),
('ml_model_trained', 'python', NULL, '{"model_name": "spam_detector", "accuracy": 0.94}', FALSE, '2024-01-12 16:00:00', NULL),
('system_alert', 'javascript', 'java', '{"alert_type": "high_cpu", "value": 85.5}', TRUE, '2024-01-13 10:30:00', '2024-01-13 10:30:05');

-- ============================================================================
-- SYSTEM METRICS AND MONITORING
-- ============================================================================

INSERT OR IGNORE INTO system_metrics (service_name, metric_type, metric_value, unit, created_at) VALUES
('javascript', 'cpu', 45.2, 'percent', '2024-01-15 10:00:00'),
('javascript', 'memory', 512.7, 'mb', '2024-01-15 10:00:00'),
('javascript', 'response_time', 120.5, 'ms', '2024-01-15 10:00:00'),
('python', 'cpu', 32.1, 'percent', '2024-01-15 10:00:00'),
('python', 'memory', 256.3, 'mb', '2024-01-15 10:00:00'),
('python', 'response_time', 200.8, 'ms', '2024-01-15 10:00:00'),
('java', 'cpu', 28.7, 'percent', '2024-01-15 10:00:00'),
('java', 'memory', 1024.1, 'mb', '2024-01-15 10:00:00'),
('java', 'response_time', 85.2, 'ms', '2024-01-15 10:00:00');

INSERT OR IGNORE INTO error_log (service_name, error_type, error_message, user_id, created_at) VALUES
('python', 'ValidationError', 'Invalid input data format in job processing', 2, '2024-01-10 12:30:00'),
('javascript', 'AuthenticationError', 'Invalid session token provided', NULL, '2024-01-11 15:45:00'),
('java', 'DatabaseError', 'Connection timeout to database', 1, '2024-01-12 09:15:00'),
('python', 'MLModelError', 'Model prediction failed due to feature mismatch', 3, '2024-01-13 14:20:00');

-- ============================================================================
-- APPLICATION DATA
-- ============================================================================

INSERT OR IGNORE INTO file_uploads (user_id, filename, file_size, file_type, file_path, upload_status, created_at) VALUES
(1, 'data_export.csv', 102400, 'text/csv', '/uploads/data_export_20240110.csv', 'completed', '2024-01-10 11:00:00'),
(2, 'profile_image.jpg', 51200, 'image/jpeg', '/uploads/profile_john_doe.jpg', 'completed', '2024-01-11 14:30:00'),
(3, 'analytics_report.pdf', 204800, 'application/pdf', '/uploads/analytics_20240112.pdf', 'completed', '2024-01-12 16:15:00'),
(1, 'bulk_import.json', 1048576, 'application/json', '/uploads/bulk_import_20240113.json', 'processing', '2024-01-13 10:45:00');

INSERT OR IGNORE INTO cache_entries (cache_key, cache_value, expires_at, created_at) VALUES
('user_1_profile', '{"id": 1, "name": "System Administrator", "last_seen": "2024-01-15 09:00:00"}', '2024-01-16 09:00:00', '2024-01-15 09:00:00'),
('ml_model_1_stats', '{"accuracy": 0.89, "prediction_count": 150, "last_updated": "2024-01-14"}', '2024-01-17 12:00:00', '2024-01-15 12:00:00'),
('system_health', '{"overall": "healthy", "services": {"js": "up", "py": "up", "java": "up"}}', '2024-01-15 23:59:59', '2024-01-15 10:30:00');

INSERT OR IGNORE INTO app_config (config_key, config_value, config_type, description) VALUES
('app_name', 'Polyglot Test Application', 'string', 'Application display name'),
('max_file_size', '10485760', 'number', 'Maximum file upload size in bytes'),
('enable_ml_features', 'true', 'boolean', 'Enable machine learning features'),
('api_rate_limit', '{"requests": 1000, "window": 3600}', 'json', 'API rate limiting configuration'),
('database_pool_size', '10', 'number', 'Database connection pool size'),
('session_timeout', '86400', 'number', 'Session timeout in seconds'),
('supported_languages', '["javascript", "python", "java"]', 'json', 'List of supported programming languages'),
('cross_service_timeout', '30000', 'number', 'Cross-service API call timeout in milliseconds');

-- ============================================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================================

-- These are sample queries to verify the test data
-- Uncomment to run verification

-- SELECT 'User Count' as test, COUNT(*) as result FROM users;
-- SELECT 'Active Sessions' as test, COUNT(*) as result FROM user_sessions WHERE is_active = TRUE;
-- SELECT 'Completed Jobs' as test, COUNT(*) as result FROM processing_jobs WHERE status = 'completed';
-- SELECT 'Active ML Models' as test, COUNT(*) as result FROM ml_models WHERE is_active = TRUE;
-- SELECT 'Successful API Calls' as test, COUNT(*) as result FROM api_requests WHERE success = TRUE;
-- SELECT 'Unprocessed Events' as test, COUNT(*) as result FROM service_events WHERE processed = FALSE;

-- ============================================================================
-- EXPECTED ANALYSIS RESULTS FOR VALIDATION
-- ============================================================================

/*
When analyzing this polyglot test application, the code analysis system should detect:

FILES (12 total):
- 4 JavaScript files (server.js, config.js, utils.js, auth.js)
- 3 Python files (database_client.py, data_processor.py, ml_service.py, utils.py) 
- 4 Java files (UserService.java, DatabaseManager.java, BusinessLogic.java, ApiClient.java)
- 2 SQL files (schema.sql, test_data.sql)

FUNCTIONS (estimated 35-40):
- JavaScript: ~15 functions across 4 files
- Python: ~12 functions across 3 files  
- Java: ~25 methods across 4 classes
- SQL: ~5 procedures/triggers

CLASSES (estimated 8-10):
- JavaScript: ~4 classes/modules
- Python: ~6 classes
- Java: ~4 classes

VARIABLES (estimated 50-60):
- Configuration variables, database connections, API endpoints
- Class properties, function parameters, local variables

RELATIONSHIPS (estimated 25-30):
- IMPORTS: JavaScript requires, Python imports, Java imports
- CALLS: Cross-service API calls between JavaScript/Python/Java
- USES: Database table usage, configuration access
- CONTAINS: File contains functions/classes
- EXPORTS: Module exports and API endpoints

DATABASE RELATIONSHIPS:
- 15 tables with foreign key relationships
- Multiple indexes and triggers
- Cross-table joins in views
*/ 