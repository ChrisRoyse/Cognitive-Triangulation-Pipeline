# Pipeline Report Part 3: Database Schema and Data Flow

## Database Architecture Overview

The pipeline uses a multi-database architecture:
1. **SQLite**: Primary data store for entities, relationships, and processing state
2. **Redis**: Queue management and job processing
3. **Neo4j**: Final knowledge graph output

## SQLite Database Schema

### Core Entity Tables

#### 1. `files` Table
Tracks all processed source files.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| file_path | TEXT NOT NULL UNIQUE | Absolute file path |
| hash | TEXT | File content hash |
| last_processed | DATETIME | Last processing timestamp |
| status | TEXT | Processing status |

#### 2. `pois` (Points of Interest) Table
Stores all discovered code entities.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| file_id | INTEGER NOT NULL | Foreign key to files table |
| file_path | TEXT NOT NULL | Redundant for performance |
| name | TEXT NOT NULL | Entity name (function, class, etc.) |
| type | TEXT NOT NULL | Entity type (ClassDefinition, FunctionDefinition, etc.) |
| start_line | INTEGER NOT NULL | Starting line in file |
| end_line | INTEGER NOT NULL | Ending line in file |
| description | TEXT | Semantic description from LLM |
| is_exported | BOOLEAN DEFAULT 0 | Whether entity is exported/public |
| semantic_id | TEXT | Unique semantic identifier |
| llm_output | TEXT | Raw LLM response JSON |
| hash | TEXT UNIQUE | MD5 hash for deduplication |
| run_id | TEXT | Pipeline run UUID |

**Indexes**:
- `idx_pois_file_id` on file_id
- `idx_pois_run_id` on run_id
- `idx_pois_type` on type
- `idx_pois_name` on name
- `idx_pois_semantic_id` on semantic_id

#### 3. `relationships` Table
Stores connections between POIs.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| source_poi_id | INTEGER | Foreign key to source POI |
| target_poi_id | INTEGER | Foreign key to target POI |
| type | TEXT NOT NULL | Relationship type (USES, CALLS, IMPORTS, etc.) |
| file_path | TEXT | File where relationship exists |
| status | TEXT | Validation status |
| confidence | REAL DEFAULT 0.8 | Confidence score (0.0-1.0) |
| reason | TEXT | LLM reasoning for relationship |
| run_id | TEXT | Pipeline run UUID |
| evidence | TEXT | Supporting evidence |

**Indexes**:
- `idx_relationships_status` on status
- `idx_relationships_run_id` on run_id
- `idx_relationships_type` on type

### Aggregation Tables

#### 4. `directory_summaries` Table
Stores directory-level analysis results.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| run_id | TEXT NOT NULL | Pipeline run UUID |
| directory_path | TEXT NOT NULL | Directory path |
| summary_text | TEXT | LLM-generated summary |

**Unique Constraint**: (run_id, directory_path)

#### 5. `directory_file_mappings` Table
Maps directories to their processed files.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| run_id | TEXT NOT NULL | Pipeline run UUID |
| directory_path | TEXT NOT NULL | Directory path |
| file_job_ids | TEXT NOT NULL | Comma-separated job IDs |
| created_at | DATETIME | Creation timestamp |

### Event Sourcing Tables

#### 6. `outbox` Table
Transactional outbox for event publishing.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| run_id | TEXT | Pipeline run UUID |
| event_type | TEXT NOT NULL | Event type identifier |
| payload | TEXT NOT NULL | JSON event payload |
| status | TEXT DEFAULT 'PENDING' | PENDING, PUBLISHED, FAILED |
| created_at | DATETIME | Creation timestamp |

#### 7. `relationship_evidence` Table
Stores detailed evidence for relationships.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| relationship_id | INTEGER | Foreign key to relationships |
| run_id | TEXT NOT NULL | Pipeline run UUID |
| evidence_payload | TEXT NOT NULL | JSON evidence data |
| relationship_hash | TEXT | Relationship hash for tracking |

### Triangulation Analysis Tables

#### 8. `triangulated_analysis_sessions` Table
Tracks low-confidence relationship analysis sessions.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| session_id | TEXT NOT NULL UNIQUE | Session UUID |
| relationship_id | INTEGER | Foreign key to relationships |
| relationship_from | TEXT NOT NULL | Source entity |
| relationship_to | TEXT NOT NULL | Target entity |
| relationship_type | TEXT NOT NULL | Relationship type |
| file_path | TEXT NOT NULL | Source file |
| run_id | TEXT NOT NULL | Pipeline run UUID |
| orchestrator_id | TEXT | Orchestrator ID for parallel mode |
| status | TEXT DEFAULT 'PENDING' | Session status |
| initial_confidence | REAL | Starting confidence |
| final_confidence | REAL | Final confidence after analysis |
| consensus_score | REAL | Consensus between agents |
| created_at | DATETIME | Creation timestamp |
| completed_at | DATETIME | Completion timestamp |
| error_message | TEXT | Error details if failed |
| escalated_to_human | BOOLEAN DEFAULT 0 | Whether escalated |

#### 9. `subagent_analyses` Table
Individual agent analysis results.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| session_id | TEXT NOT NULL | Foreign key to session |
| agent_type | TEXT NOT NULL | syntactic, semantic, contextual |
| analysis_id | TEXT NOT NULL UNIQUE | Analysis UUID |
| status | TEXT DEFAULT 'PENDING' | Analysis status |
| confidence_score | REAL | Agent's confidence |
| evidence_strength | REAL | Evidence quality score |
| reasoning | TEXT | Agent's reasoning |
| analysis_data | TEXT | JSON detailed analysis |
| processing_time_ms | INTEGER | Processing duration |
| created_at | DATETIME | Creation timestamp |
| completed_at | DATETIME | Completion timestamp |
| error_message | TEXT | Error details if failed |

#### 10. `consensus_decisions` Table
Consensus building results.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| session_id | TEXT NOT NULL | Foreign key to session |
| consensus_algorithm | TEXT | Algorithm used |
| syntactic_weight | REAL DEFAULT 0.35 | Weight for syntactic |
| semantic_weight | REAL DEFAULT 0.40 | Weight for semantic |
| contextual_weight | REAL DEFAULT 0.25 | Weight for contextual |
| syntactic_confidence | REAL | Syntactic agent confidence |
| semantic_confidence | REAL | Semantic agent confidence |
| contextual_confidence | REAL | Contextual agent confidence |
| weighted_consensus | REAL | Final weighted score |
| conflict_detected | BOOLEAN DEFAULT 0 | Whether conflicts found |
| conflict_severity | REAL DEFAULT 0.0 | Conflict severity |
| resolution_method | TEXT | How conflicts resolved |
| final_decision | TEXT | ACCEPT, REJECT, ESCALATE |
| decision_reasoning | TEXT | Decision explanation |
| created_at | DATETIME | Creation timestamp |

### System Tables

#### 11. `run_status` Table
Tracks pipeline run status changes.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| run_id | TEXT NOT NULL | Pipeline run UUID |
| status | TEXT NOT NULL | Status value |
| timestamp | DATETIME | Status change time |
| metadata | TEXT | Additional metadata JSON |

#### 12. `relationship_evidence_tracking` Table
Tracks expected vs actual evidence counts.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| run_id | TEXT NOT NULL | Pipeline run UUID |
| relationship_hash | TEXT NOT NULL | Relationship hash |
| expected_count | INTEGER NOT NULL | Expected evidence count |
| actual_count | INTEGER DEFAULT 0 | Actual evidence count |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

## Data Flow Through the Pipeline

### 1. File Analysis Flow

```
EntityScout → file-analysis-queue → FileAnalysisWorker
                                          ↓
                                    POIs → outbox table
                                          ↓
                            TransactionalOutboxPublisher
                                          ↓
                                    pois table (batch insert)
                                          ↓
                            directory-aggregation-queue
```

### 2. Relationship Discovery Flow (No-Cache Mode)

```
TransactionalOutboxPublisher → relationship-resolution-queue
                                          ↓
                            RelationshipResolutionWorker
                                          ↓
                              relationships → outbox table
                                          ↓
                            TransactionalOutboxPublisher
                                          ↓
                            relationships table (batch insert)
                                          ↓
                          Confidence Scoring & Triangulation
                                          ↓
                            ValidationWorker (Direct Processing)
                                          ↓
                        Evidence → relationship_evidence table
                                          ↓
                    Bulk Reconciliation Jobs (No Redis Cache)
```

### 3. Triangulation Flow (Low Confidence)

```
Relationships (confidence < 0.45) → triangulated-analysis-queue
                                          ↓
                                TriangulatedAnalysisOrchestrator
                                          ↓
                        Parallel execution of 3 agents:
                        - SyntacticAnalysisAgent
                        - SemanticAnalysisAgent
                        - ContextualAnalysisAgent
                                          ↓
                              subagent_analyses table
                                          ↓
                            ConsensusBuilder (weighted voting)
                                          ↓
                              consensus_decisions table
                                          ↓
                        Update relationships table confidence
```

### 4. Graph Building Flow

```
All POIs + Validated Relationships → StandardGraphBuilder
                                          ↓
                                    Neo4j Graph Database
                                    - Nodes: POIs
                                    - Edges: Relationships
                                    - Properties: All metadata
```

## Transaction Patterns

### 1. Batch Writing
Uses `BatchedDatabaseWriter` for efficient inserts:
- Batches up to 100 operations
- Flushes every 500ms or when batch full
- Uses SQLite transactions for atomicity
- WAL mode for concurrent reads

### 2. Outbox Pattern
Ensures reliable event publishing:
1. Write to outbox with status='PENDING'
2. Poll and process events
3. Update status to 'PUBLISHED' or 'FAILED'
4. Guarantees at-least-once delivery

### 3. Optimistic Locking
For concurrent updates:
- Version columns on critical tables
- Retry on conflicts
- Circuit breaker for persistent failures

## Performance Optimizations

1. **Indexes**: Strategic indexes on frequently queried columns
2. **Batch Operations**: Minimize database round trips
3. **WAL Mode**: Write-Ahead Logging for concurrency
4. **Connection Pooling**: Reuse database connections
5. **Prepared Statements**: Compiled SQL for performance
6. **Pragmas**: Optimized SQLite settings (cache size, synchronous mode)

## Data Integrity

1. **Foreign Keys**: Enforced referential integrity
2. **Unique Constraints**: Prevent duplicates
3. **Transactions**: Atomic operations
4. **Check Constraints**: Data validation at DB level
5. **Cascade Deletes**: Maintain consistency

This database architecture ensures reliable, performant processing of large codebases while maintaining data integrity and supporting sophisticated analysis workflows.