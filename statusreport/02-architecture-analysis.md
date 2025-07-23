# System Architecture Analysis

## Overall Design Pattern

The Cognitive Triangulation Pipeline implements a **sophisticated distributed processing architecture** with the following core patterns:

- **Event-Driven Architecture**: Asynchronous job processing using Redis/BullMQ
- **Microservices Pattern**: Loosely coupled services with clear boundaries
- **Worker Pool Pattern**: Intelligent concurrency management and load balancing
- **Transactional Outbox**: Reliable message delivery and eventual consistency
- **Circuit Breaker**: Fault tolerance for external dependencies
- **CQRS**: Separate read/write models across different data stores

## Component Architecture

### Core Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   EntityScout   │───▶│  Worker Queues   │───▶│    Neo4j Graph  │
│  (Discovery)    │    │   (Processing)   │    │   (Final Store) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       ▲
         ▼                       ▼                       │
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│     SQLite      │    │      Redis       │    │ TransactionalO  │
│ (State/ACID)    │    │  (Cache/Queue)   │    │    utbox        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Data Flow Architecture

1. **Discovery Phase** (`src/agents/EntityScout.js`)
   - Recursively scans directory structures
   - Creates analysis jobs for discovered files
   - Maintains directory-file relationship tracking in Redis

2. **Analysis Phase** (Worker System)
   - Multiple worker types process different job categories
   - LLM-powered analysis extracts Points of Interest (POIs)
   - Results cached in Redis for performance

3. **Relationship Resolution** (`src/workers/relationshipResolutionWorker.js`)
   - Analyzes POIs to identify semantic relationships
   - Cross-references entities across files
   - Validates relationship strength and accuracy

4. **Graph Construction** (Neo4j Integration)
   - Builds final knowledge graph representation
   - Enforces graph constraints and relationships
   - Provides query interface for analysis results

## Entry Points Analysis

### Standard Pipeline (`src/main.js`)
- **Lines 1-150**: Full-featured implementation with complete worker pool
- **Features**: Comprehensive monitoring, full concurrency control, complete error handling
- **Use Case**: Production deployment with maximum reliability

### Optimized Pipeline (`src/main_optimized.js`)
- **Lines 1-200**: Performance-enhanced with incremental processing
- **Features**: Streaming analysis, content-based caching, reduced memory footprint
- **Use Case**: Large codebase analysis with resource constraints

## Service Layer Architecture

### TransactionalOutboxPublisher (`src/services/TransactionalOutboxPublisher.js`)
**Lines 6-241**: Implements reliable messaging pattern
- **Event Publishing**: Atomic writes to SQLite with message queue publishing
- **Super-batching**: Bulk processing for performance (lines 134-183)
- **Retry Logic**: Exponential backoff for failed message delivery
- **Dead Letter Queue**: Failed message isolation and analysis

**Key Methods:**
- `publishEvent()` (lines 52-87): Atomic event publishing
- `processOutboxBatch()` (lines 134-183): Bulk message processing
- `handleFailedEvent()` (lines 214-241): Error recovery logic

## Worker System Architecture

### WorkerPoolManager (`src/utils/workerPoolManager.js`)
**Lines 17-763**: Sophisticated concurrency management system

**Core Features:**
- **Adaptive Scaling**: CPU/memory-aware worker allocation (lines 97-123)
- **Priority-Based Processing**: Different worker types with priorities (lines 54-62)
- **Rate Limiting**: Token bucket algorithm prevents API overwhelm (lines 300-356)
- **Circuit Breakers**: Automatic failure detection and recovery (lines 637-651)
- **Health Monitoring**: Continuous worker health assessment (lines 399-536)

**Worker Types:**
1. **File Analysis**: Primary content analysis workers
2. **Relationship Resolution**: Entity relationship processing
3. **Directory Aggregation**: Bulk directory operations
4. **Validation**: Quality assurance and verification
5. **Reconciliation**: Data consistency enforcement

### ManagedWorker Pattern (`src/workers/ManagedWorker.js`)
**Lines 11-554**: Base class for all worker implementations

**Capabilities:**
- **Lifecycle Management**: Proper initialization and cleanup (lines 32-89)
- **Health Monitoring**: Real-time worker status tracking (lines 363-420)
- **Metrics Collection**: Performance data gathering (lines 423-461)
- **Timeout Handling**: Job-level timeout enforcement (lines 196-214)
- **Graceful Shutdown**: Clean termination with job completion (lines 482-529)

## Database Architecture Strategy

### Multi-Database Approach (Polyglot Persistence)

1. **SQLite** (Primary ACID Store)
   - **Schema**: `src/utils/schema.sql`
   - **Tables**: files, pois, relationships, outbox, relationship_evidence
   - **Optimizations**: WAL mode, foreign key constraints, batched writes
   - **Usage**: Transactional consistency, workflow state management

2. **Redis** (Cache and Queue Layer)
   - **Caching**: LLM responses, directory mappings, intermediate results
   - **Queues**: BullMQ job distribution and processing
   - **TTL Management**: Configurable expiration policies
   - **Usage**: High-performance temporary storage and messaging

3. **Neo4j** (Graph Database)
   - **Purpose**: Final knowledge graph representation
   - **Relationships**: Semantic connections between code entities
   - **Queries**: Complex graph traversal and analysis
   - **Usage**: End-user query interface and visualization

### Database Interaction Patterns

**SQLite Integration** (`src/utils/sqliteDb.js`):
- **Connection Management**: Single connection with WAL mode (line 29)
- **Transaction Handling**: Explicit transaction boundaries
- **Migration Support**: Schema versioning (lines 63-106)
- **Prepared Statements**: Performance optimization for repeated queries

**Redis Integration** (`src/utils/cacheClient.js`):
- **Connection Pooling**: Efficient connection reuse (lines 7-17)
- **Error Handling**: Graceful degradation on cache failures (lines 28-35)
- **Serialization**: JSON-based value serialization
- **Monitoring**: Connection health checking (lines 18-26)

## Configuration Management

### Configuration Architecture (`src/config.js`)
**Lines 11-63**: Centralized configuration with environment support

**Key Areas:**
- **Database Connections**: Multi-database connection strings (lines 14-20)
- **Queue Configuration**: BullMQ settings and Redis connection (lines 21-27)
- **Worker Settings**: Concurrency limits and resource allocation (lines 28-35)
- **Security Configuration**: Authentication and encryption settings (lines 36-45)
- **Performance Tuning**: Cache TTL, batch sizes, timeout values (lines 46-53)

**Environment Handling:**
- **Development**: Relaxed constraints, verbose logging
- **Production**: Security hardening, optimized performance (lines 57-61)
- **Testing**: Isolated resources, deterministic behavior

## Caching Strategy

### Multi-Level Caching Architecture

1. **Application Level** (In-Memory)
   - **Worker State**: Current job status and metrics
   - **Configuration**: Parsed settings and computed values
   - **Connection Pools**: Database and external service connections

2. **Redis Level** (Distributed)
   - **LLM Responses**: Content-hash-based caching (TTL: 24h)
   - **Directory Mappings**: File-directory relationship caches
   - **Intermediate Results**: Processing pipeline state
   - **Session Data**: User and run-specific temporary data

3. **Database Level** (Persistent)
   - **SQLite**: Computed aggregations and derived data
   - **Neo4j**: Cached query results and graph views

## Performance Optimization Features

### Intelligent Concurrency Control
- **CPU-Aware Scaling**: Dynamic worker allocation based on system capacity
- **Memory Monitoring**: Automatic scale-down on memory pressure
- **Queue Balancing**: Priority-based job distribution across worker types

### Batching Strategies
- **Database Operations**: Bulk inserts and updates reduce I/O overhead
- **Message Publishing**: Super-batching in transactional outbox
- **File Processing**: Bulk job creation for directory scanning

### Resource Management
- **Circuit Breakers**: Prevent cascade failures in external dependencies
- **Rate Limiting**: Token bucket algorithm protects downstream services
- **Connection Pooling**: Efficient database connection reuse

## Integration Points

### External Dependencies
1. **LLM APIs**: OpenAI/Anthropic integration for content analysis
2. **Neo4j Database**: Graph database for final storage
3. **Redis**: Caching and message queuing infrastructure
4. **File System**: Local file access and monitoring

### API Design Patterns
- **RESTful Endpoints**: Standard HTTP interface for external integration
- **Event-Driven Notifications**: Webhook-style event publishing
- **GraphQL Support**: Flexible query interface for graph data
- **Batch Processing APIs**: Bulk operation endpoints for efficiency

## Architectural Strengths

1. **Scalability**: Horizontal scaling through worker pool expansion
2. **Reliability**: Transactional outbox ensures message delivery
3. **Performance**: Multi-level caching and intelligent batching
4. **Fault Tolerance**: Circuit breakers and graceful degradation
5. **Maintainability**: Clear separation of concerns and modular design
6. **Observability**: Comprehensive metrics and health monitoring

## Architectural Concerns

1. **Complexity**: High learning curve for new developers
2. **Configuration**: Multiple configuration files with unclear precedence
3. **Dependencies**: Complex dependency graph between components
4. **Resource Usage**: Intensive memory and CPU requirements
5. **Debugging**: Distributed system debugging challenges