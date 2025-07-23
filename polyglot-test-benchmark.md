# Polyglot Test Directory Benchmark Analysis

## Overview
The polyglot-test directory contains a multi-language application with JavaScript, Python, and Java components that communicate via APIs and share a SQLite database. This document establishes the benchmark for the Cognitive Triangulation Pipeline.

## Expected POI Nodes (Total: ~456)

### By Type:
1. **File Nodes**: 15
   - 4 JavaScript files (server.js, config.js, utils.js, auth.js)
   - 4 Python files (data_processor.py, ml_service.py, database_client.py, utils.py)
   - 5 Java files (UserService.java, DatabaseManager.java, BusinessLogic.java, ApiClient.java, User.java)
   - 2 SQL files (schema.sql, test_data.sql)

2. **ClassDefinition**: 21
   - JavaScript: 2 (ApiGateway, AuthManager)
   - Python: 14 (DataProcessor, DatabaseClient, MLModel, LinearRegressionModel, ClassificationModel, MLService, DataValidator, DataTransformer, CryptoUtils, FileManager, Logger, APIResponse, MetricsCollector)
   - Java: 5 (UserService, DatabaseManager, BusinessLogic, ApiClient, User)

3. **FunctionDefinition**: ~230
   - JavaScript: ~65 functions/methods
   - Python: ~85 functions/methods
   - Java: ~80 methods

4. **VariableDeclaration**: ~120
   - JavaScript: ~50 (constants, configs, exports)
   - Python: ~40 (globals, class attributes)
   - Java: ~30 (fields, constants)

5. **ImportStatement**: ~50
   - JavaScript: ~25
   - Python: ~15
   - Java: ~10

6. **DatabaseTable**: 15
   - users, user_sessions, user_activity, user_preferences, processing_jobs, analysis_results, ml_models, ml_predictions, api_requests, service_events, system_metrics, error_log, file_uploads, cache_entries, app_config

7. **DatabaseView**: 5
   - active_users, job_summary, model_performance, service_stats, system_health

## Expected Relationships (Total: ~955)

### By Type:
1. **IMPORTS**: ~50
   - Module/package import relationships

2. **EXPORTS**: ~30
   - Module export relationships

3. **CONTAINS**: ~400
   - File → Class/Function/Variable containment
   - Class → Method containment

4. **CALLS**: ~150
   - Function-to-function calls
   - Cross-service API calls
   - Database method calls

5. **USES**: ~200
   - Functions using variables
   - Classes using other classes
   - Database queries using tables

6. **EXTENDS**: 5
   - Class inheritance relationships

7. **HAS_COLUMN**: ~100
   - Table → Column relationships

8. **REFERENCES**: ~20
   - Foreign key relationships

## Minimum Success Benchmarks

Based on the analysis and the requirement of >300 nodes and >1600 relationships:

### Primary Benchmarks:
- **Minimum Nodes**: 300 (actual expected: ~456)
- **Minimum Relationships**: 1600 (actual expected: ~955, but with transitive relationships likely >1600)
- **Minimum Ratio**: 4.0 relationships per node

### Secondary Quality Metrics:
- All 15 files should be detected
- At least 20 ClassDefinition nodes
- At least 200 FunctionDefinition nodes
- Cross-language CALLS relationships should be detected (JS→Python, JS→Java, Java→Python)
- Database schema relationships should be fully captured

## Validation Approach

1. **Stage 1 - File Analysis**: Verify all 15 files are processed
2. **Stage 2 - Entity Extraction**: Check POI counts by type in SQLite
3. **Stage 3 - Relationship Detection**: Verify relationship counts in SQLite
4. **Stage 4 - Graph Building**: Confirm Neo4j ingestion matches SQLite
5. **Stage 5 - Final Validation**: Compare Neo4j graph to expected structure

## Known Complex Patterns to Validate

1. **Cross-Language Communication**:
   - ApiGateway (JS) → DataProcessor (Python) via HTTP
   - ApiGateway (JS) → UserService (Java) via HTTP
   - ApiClient (Java) → MLService (Python) via HTTP

2. **Inheritance Chains**:
   - MLModel → LinearRegressionModel
   - MLModel → ClassificationModel

3. **Database Integration**:
   - Multiple services accessing same tables
   - Foreign key relationships between tables
   - Views depending on base tables

## Success Criteria

The pipeline is considered successful when:
1. Neo4j contains ≥300 POI nodes
2. Neo4j contains ≥1600 relationships
3. Relationship/node ratio ≥ 4.0
4. All major code patterns are correctly identified
5. Cross-language relationships are properly captured