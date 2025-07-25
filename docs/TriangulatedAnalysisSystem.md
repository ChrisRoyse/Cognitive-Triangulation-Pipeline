# Independent Analysis Trigger System - Triangulated Analysis Architecture

## Overview

The Independent Analysis Trigger System implements hybrid cognitive triangulation for low-confidence relationship detection. This system handles the most challenging relationship analysis cases through specialized multi-agent analysis and consensus building.

## Architecture Components

### 1. System Trigger (TransactionalOutboxPublisher Integration)

**Location:** `src/services/TransactionalOutboxPublisher.js`

**Responsibilities:**
- Performs confidence scoring on all relationships using `ConfidenceScorer`
- Identifies relationships requiring triangulated analysis (confidence < 0.45)
- Prioritizes relationships by confidence level:
  - Urgent: < 0.2 confidence
  - High: 0.2 - 0.35 confidence  
  - Normal: 0.35 - 0.45 confidence
- Triggers triangulated analysis queue

**Key Methods:**
- `_performConfidenceScoringAndTriangulation(runId)` - Main integration point
- `getTriangulatedAnalysisStats()` - System monitoring

### 2. Triangulated Analysis Queue

**Location:** `src/services/triangulation/TriangulatedAnalysisQueue.js`

**Responsibilities:**
- Manages queue for low-confidence relationships
- Coordinates analysis workflow with SubagentCoordinator
- Handles job prioritization and retry logic
- Updates relationship status based on consensus results
- Auto-monitors for new low-confidence relationships

**Configuration:**
```javascript
{
  queueName: 'triangulated-analysis-queue',
  concurrency: 2, // Limited for resource-intensive analysis
  confidenceThreshold: 0.45,
  processingTimeout: 300000, // 5 minutes per analysis
  priorities: {
    urgent: 1,    // < 0.2 confidence
    high: 5,      // 0.2 - 0.35 confidence
    normal: 10,   // 0.35 - 0.45 confidence
    low: 15       // Background analysis
  }
}
```

**Key Methods:**
- `triggerTriangulatedAnalysis(relationships, runId, priority)` - Trigger analysis
- `processTriangulatedAnalysis(job)` - Main job processor
- `checkForLowConfidenceRelationships()` - Auto-trigger monitoring

### 3. Subagent Coordinator

**Location:** `src/services/triangulation/SubagentCoordinator.js`

**Responsibilities:**
- Manages three specialized analysis agents
- Executes parallel or sequential analysis
- Handles agent timeouts and failures
- Validates agent results and success rates
- Enriches analysis context with directory and project data

**Agent Configuration:**
```javascript
{
  syntacticWeight: 0.35,  // Code pattern analysis
  semanticWeight: 0.40,   // Meaning and intent analysis  
  contextualWeight: 0.25, // Architectural context analysis
  coordinationTimeout: 120000, // 2 minutes total
  agentTimeout: 45000,    // 45 seconds per agent
  errorThreshold: 0.67    // 67% failure threshold
}
```

**Key Methods:**
- `coordinateAnalysis(sessionId, analysisContext)` - Main coordination
- `executeAgentsInParallel(sessionId, context, coordinationId)` - Parallel execution
- `executeAgentsSequentially(sessionId, context, coordinationId)` - Sequential execution

### 4. Specialized Analysis Agents

#### SyntacticAnalysisAgent
**Location:** `src/services/triangulation/SyntacticAnalysisAgent.js`

**Focus Areas:**
- Direct function calls and method invocations
- Import/require statements and module references
- Variable assignments and references
- Method chaining patterns
- Class inheritance and composition
- Structural code patterns

**Analysis Output:**
```javascript
{
  confidence: 0.0-1.0,
  evidenceStrength: 0.0-1.0,
  reasoning: "detailed syntactic evidence",
  analysisData: {
    syntacticPatterns: [...],
    codeStructures: [...],
    directEvidence: [...],
    indirectEvidence: [...],
    conflictingEvidence: [...]
  }
}
```

#### SemanticAnalysisAgent
**Location:** `src/services/triangulation/SemanticAnalysisAgent.js`

**Focus Areas:**
- Conceptual meaning and purpose
- Domain-specific logic and business rules
- Functional intent and operational purpose
- Data flow semantics and information meaning
- Architectural purpose and design intent
- Naming consistency and semantic coherence

**Analysis Output:**
```javascript
{
  confidence: 0.0-1.0,
  evidenceStrength: 0.0-1.0,
  reasoning: "detailed semantic evidence",
  analysisData: {
    conceptualMeaning: {...},
    domainLogic: {...},
    functionalPurpose: {...},
    dataFlowSemantics: {...},
    businessContext: {...},
    semanticConsistency: {...}
  }
}
```

#### ContextualAnalysisAgent
**Location:** `src/services/triangulation/ContextualAnalysisAgent.js`

**Focus Areas:**
- File organization and co-location patterns
- Directory structure and module boundaries
- Architectural patterns and design principles
- Project conventions and naming patterns
- Module separation and responsibility boundaries
- Cross-cutting concerns and architectural layers

**Analysis Output:**
```javascript
{
  confidence: 0.0-1.0,
  evidenceStrength: 0.0-1.0,
  reasoning: "detailed contextual evidence",
  analysisData: {
    fileOrganization: {...},
    directoryStructure: {...},
    architecturalPatterns: {...},
    moduleBoundaries: {...},
    projectConventions: {...},
    contextualCoherence: {...}
  }
}
```

### 5. Consensus Builder

**Location:** `src/services/triangulation/ConsensusBuilder.js`

**Responsibilities:**
- Implements weighted consensus algorithm
- Detects and analyzes conflicts between agents
- Makes final decisions (ACCEPT/REJECT/ESCALATE)
- Handles conflict resolution and human escalation

**Consensus Formula:**
```javascript
Consensus = Σ(Wi × Ci × Ai) / Σ(Wi)

Where:
- Wi = Agent weight (syntactic: 0.35, semantic: 0.40, contextual: 0.25)
- Ci = Agent confidence score (0.0-1.0)
- Ai = Agent evidence strength (0.0-1.0)
```

**Decision Thresholds:**
```javascript
{
  acceptanceThreshold: 0.65,   // Accept relationship
  rejectionThreshold: 0.35,    // Reject relationship  
  conflictThreshold: 0.3,      // Conflict detection
  severityThreshold: 0.5,      // Escalation trigger
  escalationThreshold: 0.7     // Human review required
}
```

**Decision Logic:**
1. **Severe Conflicts** (severity ≥ 0.5) → ESCALATE
2. **high Consensus** (≥ 0.65) → ACCEPT
3. **Low Consensus** (≤ 0.35) → REJECT
4. **Moderate + Conflict** → ESCALATE
5. **Moderate + No Conflict** → ACCEPT

## Database Schema

### Triangulated Analysis Sessions
```sql
CREATE TABLE triangulated_analysis_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    relationship_id INTEGER NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, FAILED
    initial_confidence REAL NOT NULL,
    final_confidence REAL,
    consensus_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    escalated_to_human BOOLEAN DEFAULT 0,
    FOREIGN KEY (relationship_id) REFERENCES relationships (id)
);
```

### Subagent Analyses
```sql
CREATE TABLE subagent_analyses (
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
    FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id)
);
```

### Consensus Decisions
```sql
CREATE TABLE consensus_decisions (
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
    FOREIGN KEY (session_id) REFERENCES triangulated_analysis_sessions (session_id)
);
```

## System Flow

### 1. Relationship Processing Flow
```
1. TransactionalOutboxPublisher processes relationship events
2. ConfidenceScorer calculates confidence for each relationship
3. Relationships with confidence < 0.45 trigger triangulated analysis
4. TriangulatedAnalysisQueue creates prioritized analysis jobs
5. SubagentCoordinator executes specialized agent analysis
6. ConsensusBuilder creates weighted consensus decision
7. Relationship status updated based on consensus result
```

### 2. Agent Analysis Flow
```
1. SubagentCoordinator prepares enriched analysis context
2. Three agents analyze relationship independently:
   - SyntacticAnalysisAgent: Code patterns and structure
   - SemanticAnalysisAgent: Meaning and purpose
   - ContextualAnalysisAgent: Architecture and organization
3. Each agent produces confidence score and detailed evidence
4. Results stored in subagent_analyses table
5. ConsensusBuilder processes agent results for final decision
```

### 3. Consensus Building Flow
```
1. Extract confidence scores and evidence strengths from agents
2. Detect conflicts using variance analysis (threshold: 0.3)
3. Calculate weighted consensus: Σ(Wi × Ci × Ai) / Σ(Wi)
4. Apply decision logic based on consensus score and conflicts
5. Store decision in consensus_decisions table
6. Update relationship status and confidence
```

## Performance Targets

### Analysis Distribution (Architecture Specification)
- **Batch Analysis**: 80% (high confidence ≥ 0.65)
- **Individual Analysis**: 15% (medium confidence 0.45-0.65)
- **Triangulated Analysis**: 5% (low confidence < 0.45)

### Performance Metrics
- **Processing Time**: ≤ 5 minutes per triangulated analysis
- **Success Rate**: ≥ 67% agent success required for consensus
- **Conflict Detection**: Standard deviation > 0.3 triggers conflict analysis
- **Escalation Rate**: Target ≤ 10% of triangulated analyses

### Resource Management
- **Queue Concurrency**: 2 concurrent triangulated analyses
- **Agent Timeout**: 45 seconds per specialized agent
- **Total Timeout**: 2 minutes per coordination session
- **Retry Logic**: 2 retries with exponential backoff

## Error Handling

### Agent Failure Scenarios
1. **Individual Agent Timeout**: Continue with remaining agents if ≥ 2 successful
2. **Coordination Failure**: Mark session as FAILED, escalate for retry
3. **Consensus Building Error**: Default to ESCALATE decision
4. **Database Errors**: Detailed logging with retry mechanisms

### Fallback Mechanisms
1. **Insufficient Agents**: Escalate to human review if < 2 agents succeed
2. **High Conflicts**: Automatic escalation for unresolvable disagreements
3. **Processing Timeout**: Session marked as FAILED, relationship remains PENDING
4. **Queue Overload**: Priority-based processing with older jobs taking precedence

## Usage Example

### Basic Integration
```javascript
const publisher = new TransactionalOutboxPublisher(dbManager, queueManager, cacheClient, {
  triangulationOptions: {
    confidenceThreshold: 0.45,
    concurrency: 2,
    enableAutoTrigger: true
  }
});

await publisher.start();

// System automatically triggers triangulated analysis for low-confidence relationships
// Monitor with:
const stats = await publisher.getTriangulatedAnalysisStats();
console.log('Triangulation Stats:', stats);
```

### Manual Triggering
```javascript
const triangulatedQueue = new TriangulatedAnalysisQueue(dbManager, queueManager, cacheClient);
await triangulatedQueue.start();

const lowConfidenceRelationships = [
  { id: 123, confidence: 0.25 },
  { id: 124, confidence: 0.31 }
];

await triangulatedQueue.triggerTriangulatedAnalysis(
  lowConfidenceRelationships, 
  'run-id-123', 
  'high'
);
```

## Testing

Run the integration test:
```bash
node scripts/test-triangulated-analysis.js
```

This test demonstrates:
- Confidence scoring of test relationships
- Triangulated analysis triggering
- Agent coordination simulation
- Database schema validation
- Statistics collection

## Monitoring and Observability

### Key Metrics to Monitor
1. **Triangulation Rate**: % of relationships requiring triangulation
2. **Agent Success Rates**: Individual agent completion rates
3. **Consensus Decisions**: Distribution of ACCEPT/REJECT/ESCALATE
4. **Processing Times**: Average and 95th percentile analysis times
5. **Conflict Rates**: Frequency and severity of agent disagreements

### Database Queries for Monitoring
```sql
-- Triangulation rate by run
SELECT 
  run_id,
  COUNT(*) as total_relationships,
  COUNT(CASE WHEN confidence < 0.45 THEN 1 END) as triangulated,
  ROUND(100.0 * COUNT(CASE WHEN confidence < 0.45 THEN 1 END) / COUNT(*), 2) as triangulation_rate
FROM relationships 
GROUP BY run_id;

-- Agent success rates
SELECT 
  agent_type,
  COUNT(*) as total_analyses,
  COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as successful,
  ROUND(100.0 * COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) / COUNT(*), 2) as success_rate
FROM subagent_analyses 
GROUP BY agent_type;

-- Consensus decision distribution
SELECT 
  final_decision,
  COUNT(*) as count,
  ROUND(AVG(weighted_consensus), 3) as avg_consensus,
  ROUND(AVG(conflict_severity), 3) as avg_conflict_severity
FROM consensus_decisions 
GROUP BY final_decision;
```

## System Health Checks

The system provides comprehensive health monitoring through:

1. **Component Health**: Each component exposes `getHealthStatus()` method
2. **Queue Monitoring**: Job counts, processing rates, failure rates
3. **Database Metrics**: Session statuses, decision distributions
4. **Performance Tracking**: Processing times, success rates, escalation rates

Use `publisher.getTriangulatedAnalysisStats()` for complete system health overview.

## Architecture Benefits

1. **Specialized Analysis**: Each agent focuses on specific analysis dimensions
2. **Conflict Resolution**: Systematic handling of agent disagreements
3. **Scalable Processing**: Queue-based system with configurable concurrency
4. **Comprehensive Logging**: Full audit trail of analysis decisions
5. **Fallback Mechanisms**: Graceful handling of failures and edge cases
6. **Performance Optimization**: Only 5% of relationships require expensive triangulation

This system ensures that the most challenging relationship detection cases receive thorough analysis while maintaining overall system performance and reliability.