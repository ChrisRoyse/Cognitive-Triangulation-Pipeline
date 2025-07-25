# Pipeline Report Part 5: Agents and Their Roles

## Agent Architecture Overview

The pipeline uses specialized agents for different phases of analysis. Each agent has a specific responsibility and operates independently within the overall orchestration.

## Primary Agents

### 1. EntityScout Agent

**Purpose**: Initial discovery and job creation for the entire pipeline.

**Key Responsibilities**:
- Traverse target directory recursively
- Identify code files for analysis
- Apply ignore patterns (.gitignore)
- Create analysis jobs for files and directories
- Track file changes for incremental processing

**Supported File Types**:
The agent supports 69+ programming languages including:
- JavaScript/TypeScript (.js, .jsx, .ts, .tsx)
- Python (.py, .pyw, .pyx)
- Java/JVM languages (.java, .scala, .kt)
- C/C++ (.c, .cpp, .h, .hpp)
- Go, Rust, Ruby, PHP, Swift, and many more

**Ignore Patterns**:
- Version control: .git/
- Dependencies: node_modules/
- Build artifacts: dist/, build/
- Temporary files: *.tmp, *.cache
- Minified files: *.min.js, *.min.css

**Process Flow**:
1. Load .gitignore patterns
2. Traverse directory structure
3. Filter files by extension and ignore patterns
4. Calculate file hashes for change detection
5. Create file analysis jobs with metadata
6. Create directory resolution jobs
7. Track statistics (new, changed, unchanged files)

**Database Operations**:
- Updates `files` table with discovered files
- Records run status in `run_status` table
- Uses incremental processing based on file hashes

**Output**:
```javascript
{
  fileJobs: [{
    name: 'file-analysis',
    data: {
      filePath: string,
      runId: string,
      jobId: string
    }
  }],
  dirJobs: [{
    name: 'directory-resolution',
    data: {
      directoryPath: string,
      runId: string,
      jobId: string
    }
  }]
}
```

### 2. StandardGraphBuilder Agent

**Purpose**: Constructs the final Neo4j knowledge graph from validated data.

**Key Responsibilities**:
- Read validated relationships from SQLite
- Create Neo4j nodes for POIs
- Create Neo4j edges for relationships
- Handle batch processing for performance
- Ensure graph consistency

**Configuration**:
- Batch size: 500 relationships
- Sequential processing to avoid deadlocks
- Transaction timeout: Configurable
- Allowed relationship types validation

**Allowed Relationship Types**:
- CALLS, IMPLEMENTS, USES, DEPENDS_ON
- INHERITS, CONTAINS, DEFINES, REFERENCES
- EXTENDS, BELONGS_TO, RELATED_TO, PART_OF
- USED_BY, INSTANTIATES, RELATED

**Neo4j Schema**:

**Node Properties**:
```cypher
(:CodeEntity {
  id: string,           // Semantic ID
  file_path: string,    // Source file
  name: string,         // Entity name
  type: string,         // Entity type
  start_line: integer,  // Start position
  end_line: integer     // End position
})
```

**Relationship Properties**:
```cypher
-[:RELATIONSHIP_TYPE {
  confidence: float     // 0.0 to 1.0
}]->
```

**Processing Algorithm**:
1. Query validated relationships with JOIN on POIs
2. Create batches of 500 relationships
3. For each batch:
   - MERGE source and target nodes
   - CREATE relationships with properties
   - Use transactions for atomicity
4. Track progress and handle errors

**Performance Optimizations**:
- Batch processing reduces round trips
- Sequential batches prevent deadlocks
- Semantic IDs for efficient node matching
- Prepared Cypher queries

## Triangulation Analysis Agents

### 3. SyntacticAnalysisAgent

**Purpose**: Analyzes code structure and syntax patterns.

**Analysis Focus**:
- Function call patterns
- Import/export statements
- Type declarations
- Code proximity
- AST-level patterns

**Scoring Factors**:
- Direct invocation detected: +0.9
- Import statement found: +0.8
- Same file location: +0.7
- Parameter type matching: +0.6
- Naming convention match: +0.5

### 4. SemanticAnalysisAgent

**Purpose**: Evaluates meaning and conceptual relationships.

**Analysis Focus**:
- Natural language processing of names
- Description similarity analysis
- Domain terminology matching
- Conceptual relationships
- Business logic patterns

**Scoring Factors**:
- High semantic similarity: +0.85
- Domain term correlation: +0.75
- Description alignment: +0.7
- Related concepts: +0.6
- Contextual relevance: +0.5

### 5. ContextualAnalysisAgent

**Purpose**: Considers broader architectural context.

**Analysis Focus**:
- Module boundaries
- Architectural patterns
- Cross-file dependencies
- Usage patterns
- Project structure

**Scoring Factors**:
- Architectural alignment: +0.8
- Common usage patterns: +0.75
- Module cohesion: +0.7
- Historical correlation: +0.65
- Structural proximity: +0.6

## Agent Coordination

### Orchestration Patterns

**1. Sequential Mode**:
```
EntityScout
    ↓
FileAnalysisWorker (parallel)
    ↓
RelationshipResolutionWorker
    ↓
Low Confidence? → TriangulationAgents (sequential)
    ↓
StandardGraphBuilder
```

**2. Parallel Mode**:
```
EntityScout
    ↓
FileAnalysisWorker (parallel)
    ↓
RelationshipResolutionWorker
    ↓
Low Confidence? → TriangulationAgents (parallel)
                    ├─ SyntacticAgent
                    ├─ SemanticAgent
                    └─ ContextualAgent
    ↓
StandardGraphBuilder
```

### Agent Communication

Agents communicate through:
1. **Database State**: Shared SQLite database
2. **Queue System**: Redis-based job queues
3. **Outbox Pattern**: Transactional event publishing
4. **Direct Invocation**: For specialized analysis

### Error Handling

Each agent implements:
- Retry logic with exponential backoff
- Circuit breaker for persistent failures
- Detailed error logging with context
- Graceful degradation strategies

### Monitoring and Metrics

**Per-Agent Metrics**:
- Processing rate (items/second)
- Success/failure rates
- Average processing time
- Resource utilization
- Error categorization

**System-Wide Metrics**:
- Total entities discovered
- Relationships validated
- Triangulation trigger rate
- Graph construction time
- End-to-end pipeline duration

## Agent Lifecycle

### 1. Initialization
- Load configuration
- Connect to databases
- Set up queue listeners
- Initialize sub-components

### 2. Execution
- Process assigned jobs
- Update database state
- Publish events
- Track metrics

### 3. Cleanup
- Complete pending operations
- Close database connections
- Release resources
- Report final statistics

## Benefits of Agent Architecture

1. **Modularity**: Each agent has single responsibility
2. **Scalability**: Agents can scale independently
3. **Reliability**: Failure isolation between agents
4. **Maintainability**: Clear boundaries and interfaces
5. **Flexibility**: Easy to add new agent types
6. **Observability**: Per-agent monitoring and debugging

This agent-based architecture ensures efficient, reliable processing of codebases while maintaining clear separation of concerns and enabling sophisticated analysis workflows.