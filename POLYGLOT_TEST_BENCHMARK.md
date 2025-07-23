# Polyglot Test Pipeline Benchmark

## Overview
This document defines the expected benchmark results when running the Cognitive Triangulation Pipeline on the `polyglot-test` directory. The pipeline should extract all code entities and their relationships from this multi-language codebase and accurately represent them in Neo4j.

## Minimum Success Criteria
- **Minimum Nodes**: 300+
- **Minimum Relationships**: 1600+
- **Minimum Relationship Ratio**: 4+ relationships per node

## Expected Node Counts

### Total Expected Nodes: ~417 entities

### By Entity Type:

#### 1. File Nodes: 15
- SQL Files: 2
  - `database/schema.sql`
  - `database/test_data.sql`
- Java Files: 5
  - `java/User.java`
  - `java/UserService.java`
  - `java/DatabaseManager.java`
  - `java/BusinessLogic.java`
  - `java/ApiClient.java`
- JavaScript Files: 4
  - `js/server.js`
  - `js/config.js`
  - `js/utils.js`
  - `js/auth.js`
- Python Files: 4
  - `python/data_processor.py`
  - `python/database_client.py`
  - `python/ml_service.py`
  - `python/utils.py`

#### 2. Class Definition Nodes: 20
- Java Classes: 6
  - User, UserService, DatabaseManager, BusinessLogic, ApiClient, com.polyglot.services (package)
- JavaScript Classes: 3
  - ApiGateway, AuthManager, (implicit class structures)
- Python Classes: 11
  - DataProcessor, DatabaseClient, MLModel, LinearRegressionModel, ClassificationModel, MLService
  - DataValidator, DataTransformer, CryptoUtils, FileManager, Logger

#### 3. Function Definition Nodes: 163+
- Java Methods: 75
- JavaScript Functions: 32
- Python Functions/Methods: 56
- SQL Procedures/Functions: (if extracted from schema)

#### 4. Variable Declaration Nodes: 63+
- Java Class Fields: 30
- JavaScript Module Variables: 25
- Python Module Variables: 8

#### 5. Import Statement Nodes: 65
- Java Imports: 23
- JavaScript Requires: 13
- Python Imports: 29

#### 6. Export Statement Nodes: 7
- JavaScript Exports only

#### 7. Database Entity Nodes: 56
- Tables: 15
- Views: 5
- Indexes: 32
- Triggers: 4

## Expected Relationship Counts

### Total Expected Relationships: 1600-2000+

### By Relationship Type:

#### 1. DEFINES Relationships: ~300+
- Each file DEFINES its classes, functions, variables
- Each class DEFINES its methods
- Schema file DEFINES database entities

#### 2. IMPORTS Relationships: 65+
- Direct mapping from import statements to imported modules/files

#### 3. EXPORTS Relationships: 7+
- JavaScript module exports

#### 4. CALLS Relationships: 500+
Cross-Service API Calls:
- Java → JavaScript API endpoints
- Java → Python API endpoints
- Python → Java/JavaScript endpoints
- JavaScript → Java/Python proxied requests

Internal Function Calls:
- UserService methods → DatabaseManager methods
- UserService methods → BusinessLogic methods
- UserService methods → ApiClient methods
- DataProcessor methods → DatabaseClient methods
- DataProcessor methods → Utils functions
- ApiGateway methods → Auth middleware
- ApiGateway methods → Utils functions

#### 5. USES Relationships: 600+
- Functions USE variables
- Methods USE class fields
- Functions USE imported modules
- Classes USE other classes
- Code USES database tables

#### 6. EXTENDS Relationships: 2+
- LinearRegressionModel EXTENDS MLModel
- ClassificationModel EXTENDS MLModel

#### 7. INSTANTIATES Relationships: 20+
- Code that creates instances of classes

#### 8. CONTAINS Relationships: 200+
- Files CONTAIN classes, functions, variables
- Classes CONTAIN methods, fields
- Modules CONTAIN subcomponents

#### 9. REFERENCES Relationships: 100+
- General references between entities

#### 10. DEPENDS_ON Relationships: 50+
- Service dependencies
- Module dependencies

#### 11. USES_DATA_FROM Relationships: 50+
- Data flow between services
- Database access patterns

## Cross-Language Relationship Examples

### Critical Cross-Language Relationships to Verify:

1. **Java → Python**
   - `UserService.processUserData()` → `DataProcessor.process_data()`
   - `ApiClient.callPythonService()` → Python endpoints

2. **Java → JavaScript**
   - `ApiClient.callJavaScriptService()` → JavaScript endpoints
   - `UserService.notifyUserCreated()` → `ApiGateway./api/events/user-created`

3. **Python → Java**
   - `DataProcessor._make_cross_service_call()` → Java endpoints

4. **JavaScript → Java/Python**
   - `ApiGateway` proxy methods → Both services

5. **Database Relationships**
   - Java `DatabaseManager` → SQL tables
   - Python `DatabaseClient` → SQL tables
   - Multiple services → shared tables (users, processing_jobs, api_requests)

## Validation Checkpoints

### 1. File Discovery
- ✓ All 15 source files discovered
- ✓ No README.md or non-code files included

### 2. Entity Extraction
- ✓ All 20 classes identified
- ✓ All 163+ functions/methods extracted
- ✓ All 63+ variables captured
- ✓ All 65 imports tracked
- ✓ All 56 database entities found

### 3. Relationship Detection
- ✓ Cross-language API calls detected
- ✓ Inheritance relationships found
- ✓ Database access patterns captured
- ✓ Import/export dependencies mapped
- ✓ Function call chains identified

### 4. Graph Integrity
- ✓ No orphaned nodes
- ✓ Bidirectional relationships where appropriate
- ✓ Proper relationship types assigned
- ✓ All entities have file_path context

## Success Metrics

### Minimum Pass Criteria:
- Nodes: ≥ 300 (actual expected: ~417)
- Relationships: ≥ 1600 (actual expected: ~1876)
- Ratio: ≥ 4.0 relationships per node (expected: ~4.5)

### Performance Grades:
- **A Grade**: 95%+ of expected counts (≥395 nodes, ≥1782 relationships)
- **B Grade**: 90%+ of expected counts (≥375 nodes, ≥1688 relationships)
- **C Grade**: 85%+ of expected counts (≥354 nodes, ≥1595 relationships)
- **D Grade**: 80%+ of expected counts (≥334 nodes, ≥1501 relationships)
- **F Grade**: Below 80%

### Critical Validation Points:
1. **Cross-Language Detection**: Must find relationships between Java, Python, and JavaScript
2. **Inheritance Detection**: Must find MLModel inheritance hierarchy
3. **Database Integration**: Must link code to SQL schema entities
4. **API Communication**: Must track cross-service API calls

## Debugging Guide

If benchmarks are not met, check:

1. **SQLite Database**:
   - entity_extractions table: Are all files processed?
   - relationships table: Are relationships being detected?
   - outbox table: Are events being published?

2. **Redis Queues**:
   - Check for failed jobs
   - Verify all queues are processing

3. **Neo4j Graph**:
   - Verify constraint exists: `CREATE CONSTRAINT poi_id_unique IF NOT EXISTS FOR (p:POI) REQUIRE p.id IS UNIQUE`
   - Check node counts by type: `MATCH (p:POI) RETURN p.type, count(*)`
   - Check relationship counts: `MATCH ()-[r:RELATIONSHIP]->() RETURN r.type, count(*)`

4. **Common Issues**:
   - LLM not extracting all entities → Check prompts
   - Relationships not detected → Check RelationshipResolver
   - Graph not populated → Check GraphBuilder worker
   - Cross-language missed → Verify analysis includes all file types

## Conclusion

The polyglot-test directory serves as a comprehensive validation suite for the Cognitive Triangulation Pipeline. Success requires accurate extraction and relationship detection across multiple programming languages, database schemas, and service boundaries. Meeting these benchmarks confirms the pipeline can handle real-world, complex codebases effectively.