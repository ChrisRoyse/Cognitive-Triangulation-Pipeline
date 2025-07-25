# Pipeline Report Part 1: Overview and Architecture

## Pipeline Overview

The Cognitive Triangulation Pipeline (CTP) is a sophisticated code analysis system that processes source code repositories to extract entities (Points of Interest - POIs) and relationships between them, ultimately building a knowledge graph in Neo4j.

## Core Architecture Components

### 1. Main Pipeline Class (CognitiveTriangulationPipeline)

Located in `src/main.js`, this is the orchestrator of the entire pipeline.

**Constructor Parameters:**
- `targetDirectory`: The directory to analyze
- `dbPath`: SQLite database path (optional, defaults from config)
- `options`: Configuration options including `pipelineConfig`

**Key Properties:**
- `runId`: Unique UUID for each pipeline run
- `queueManager`: Redis-based queue system for job distribution
- `dbManager`: SQLite database manager
- `llmClient`: DeepSeek API client for LLM analysis
- `workerPoolManager`: Manages worker concurrency and resource allocation
- `outboxPublisher`: Transactional outbox pattern for reliable event publishing
- `triangulatedAnalysisQueue`: Special queue for low-confidence relationship analysis

### 2. Pipeline Initialization Flow

The `initialize()` method performs these steps:

1. **Database Setup** (`dbManager.initializeDb()`):
   - Creates SQLite tables from schema.sql
   - Runs any pending migrations
   - Sets up indexes for performance

2. **Outbox Publisher Setup**:
   - Initializes TransactionalOutboxPublisher for reliable event publishing
   - Ensures database transactions and queue operations are synchronized

3. **Triangulated Analysis Queue Setup**:
   - Creates specialized queue for relationships with confidence < 0.45
   - Configures with concurrency limit (default: 2)
   - Enables auto-triggering for continuous processing

4. **Queue Manager Connection**:
   - Connects to Redis server
   - Validates queue health

5. **Database Cleanup**:
   - Clears all SQLite tables
   - Removes all Redis queue jobs
   - Deletes all Neo4j nodes and relationships

### 3. Main Execution Flow (`run()` method)

1. **Initialization Phase**:
   - Records start time
   - Initializes all components
   - Clears databases for fresh run

2. **Worker Startup Phase**:
   - Creates and initializes all worker types
   - Registers workers with WorkerPoolManager
   - **Circuit Breaker Reset**: Automatically resets all circuit breakers to handle timeout issues
   - Starts outbox publisher
   - Starts triangulated analysis queue

3. **Job Production Phase**:
   - EntityScout scans target directory
   - Creates file analysis jobs for each source file
   - Returns total job count

4. **Processing Phase**:
   - Workers process jobs concurrently with timeout protection
   - Monitor queues for completion
   - Circuit breakers prevent cascade failures
   - Handles timeouts and failure thresholds

5. **Graph Building Phase**:
   - StandardGraphBuilder creates Neo4j graph
   - Processes all discovered entities and relationships

6. **Cleanup Phase**:
   - Stops all workers gracefully
   - Closes database connections
   - Prints final report

### 4. Worker System Architecture

The pipeline uses 7 different worker types:

1. **FileAnalysisWorker**: Analyzes individual files for POIs
2. **DirectoryResolutionWorker**: Processes directory-level relationships
3. **DirectoryAggregationWorker**: Aggregates directory summaries
4. **RelationshipResolutionWorker**: Resolves relationships between POIs
5. **GlobalRelationshipAnalysisWorker**: Cross-file relationship analysis
6. **ValidationWorker**: Validates discovered entities and relationships
7. **ReconciliationWorker**: Reconciles conflicts and duplicates

### 5. Queue System

Uses Bull queue (Redis-based) with these queues:
- `file-analysis-queue`
- `relationship-resolution-queue`
- `directory-resolution-queue`
- `directory-aggregation-queue`
- `validation-queue`
- `reconciliation-queue`
- `graph-ingestion-queue`
- `triangulated-analysis-queue`

### 6. Database Schema Overview

**SQLite Tables:**
- `files`: Tracked source files
- `pois`: Points of Interest (functions, classes, etc.)
- `relationships`: Connections between POIs
- `directory_summaries`: Aggregated directory information
- `relationship_evidence`: Evidence supporting relationships
- `outbox`: Transactional outbox for events
- `triangulated_analysis_sessions`: Low-confidence analysis sessions
- `subagent_analyses`: Individual agent analysis results
- `consensus_decisions`: Consensus building results
- `parallel_coordination_results`: Parallel agent coordination
- `agent_review_matrix`: Cross-agent review results
- `conflict_resolutions`: Conflict resolution records
- `run_status`: Pipeline run status tracking
- `directory_file_mappings`: Directory to file job mappings

### 7. Configuration System

Centralized configuration via `PipelineConfig` class:

**Key Configuration Areas:**
- Worker concurrency limits
- Performance thresholds (CPU, memory)
- Database connections (SQLite, Neo4j, Redis)
- LLM settings (model, tokens, rate limits)
- Triangulation thresholds and settings
- Queue cleanup policies
- Monitoring and alerting

### 8. Error Handling

Comprehensive error handling with:
- Contextual error information
- Specific action suggestions based on error type
- Pipeline context in thrown errors
- Graceful shutdown on failures
- Worker-level error recovery

### 9. Monitoring and Completion

**Queue Monitoring**:
- Checks every 5 seconds
- Tracks active, waiting, completed, failed jobs
- Monitors failure rate (max 50%)
- Enforces maximum wait time (10 minutes)
- Requires 3 consecutive idle checks for completion

**Performance Monitoring**:
- CPU and memory thresholds
- Execution time limits
- Queue depth monitoring
- Worker pool status tracking

### 10. Triangulated Analysis System

Special system for low-confidence relationships:
- Threshold: confidence < 0.45
- Uses three specialized agents (syntactic, semantic, contextual)
- Weighted voting for consensus
- Automatic escalation for unresolved conflicts
- Stores analysis sessions and results

This architecture ensures reliable, scalable processing of large codebases with comprehensive error handling and monitoring.