# Pipeline Report Part 4: Confidence Scoring and Triangulation System

## Overview

The pipeline implements a sophisticated hybrid cognitive triangulation system to validate relationships between code entities. This system is crucial for ensuring high-quality knowledge graph construction.

## Confidence Scoring System

### Core Formula

The confidence score is calculated using the mathematical formula:
```
C = Σ(Wi × Si) × (1 - P) × √(N/N+k)
```

Where:
- **C**: Final confidence score (0.0 to 1.0)
- **Wi**: Weight for factor i
- **Si**: Score for factor i
- **P**: Cumulative penalty
- **N**: Number of evidence items
- **k**: Smoothing constant (default: 10)

### Factor Weights and Scores

#### 1. Syntax Score (S1, Weight: 0.3)
Analyzes code patterns and structural elements:
- Direct function calls: +0.35
- Method chaining patterns: +0.25
- Clear function naming: +0.15
- Import statements: +0.4
- Class inheritance: +0.35
- Interface implementation: +0.3

#### 2. Semantic Score (S2, Weight: 0.3)
Evaluates meaning and context:
- Naming similarity analysis
- Description correlation
- Type compatibility
- Semantic distance calculation
- Domain-specific patterns

#### 3. Context Score (S3, Weight: 0.2)
Considers surrounding code context:
- File proximity (same file, same directory)
- Module boundaries
- Namespace alignment
- Logical grouping
- Project structure patterns

#### 4. Cross-Reference Score (S4, Weight: 0.2)
Validates through multiple evidence sources:
- Multiple evidence items
- Consistent patterns
- Bidirectional references
- Transitive relationships
- External validations

### Penalty System

Penalties reduce confidence for problematic patterns:
- **Dynamic Import**: -0.15 (runtime resolution)
- **Indirect Reference**: -0.1 (through intermediaries)
- **Conflicting Evidence**: -0.2 (contradictory signals)
- **Ambiguous Reference**: -0.05 (unclear intent)

### Confidence Levels

| Level | Range | Description |
|-------|-------|-------------|
| HIGH | > 0.85 | Strong evidence, direct references |
| MEDIUM | 0.65 - 0.85 | Good evidence, some uncertainty |
| LOW | 0.45 - 0.65 | Weak evidence, needs validation |
| VERY_LOW | < 0.45 | Triggers triangulation analysis |

## Triangulated Analysis System

### Architecture

The triangulation system activates for relationships with confidence < 0.45:

```
Low Confidence Relationship
        ↓
TriangulatedAnalysisQueue
        ↓
AdvancedTriangulationOrchestrator (Parallel Mode)
or SubagentCoordinator (Sequential Mode)
        ↓
Three Specialized Agents:
├─ SyntacticAnalysisAgent
├─ SemanticAnalysisAgent
└─ ContextualAnalysisAgent
        ↓
ConsensusBuilder
        ↓
Final Decision: ACCEPT/REJECT/ESCALATE
```

### Analysis Modes

#### 1. Parallel Mode (Default)
- Uses `AdvancedTriangulationOrchestrator`
- Agents run concurrently
- Real-time monitoring
- Cross-agent validation
- Maximum 6 parallel agents
- Faster but resource-intensive

#### 2. Sequential Mode
- Uses `SubagentCoordinator`
- Agents run one at a time
- Lower resource usage
- Simpler conflict resolution
- Better for constrained environments

### Specialized Agents

#### SyntacticAnalysisAgent
**Focus**: Code structure and patterns

**Analysis includes**:
- AST-level pattern matching
- Import/export analysis
- Function signature matching
- Type system validation
- Code proximity metrics

**Confidence Factors**:
- Direct invocation: +0.9
- Import presence: +0.8
- Same file location: +0.7
- Parameter matching: +0.6

#### SemanticAnalysisAgent
**Focus**: Meaning and relationships

**Analysis includes**:
- Natural language processing
- Description similarity
- Domain terminology matching
- Conceptual relationships
- Business logic patterns

**Confidence Factors**:
- High semantic similarity: +0.85
- Domain term matching: +0.75
- Description correlation: +0.7
- Related concepts: +0.6

#### ContextualAnalysisAgent
**Focus**: Broader code context

**Analysis includes**:
- Module boundaries
- Architectural patterns
- Cross-file dependencies
- Usage patterns
- Historical changes

**Confidence Factors**:
- Architectural alignment: +0.8
- Common usage patterns: +0.75
- Module cohesion: +0.7
- Historical correlation: +0.65

### Consensus Building

The ConsensusBuilder combines agent results using weighted voting:

```
Consensus = (W1 × C1) + (W2 × C2) + (W3 × C3)
```

Default weights:
- Syntactic: 0.35
- Semantic: 0.40
- Contextual: 0.25

### Conflict Resolution

When agents disagree significantly:

1. **Variance Detection**: Calculate confidence variance
2. **Severity Assessment**: Determine conflict severity
3. **Resolution Strategies**:
   - **Re-analysis**: Agents review each other's findings
   - **Weighted Override**: Higher-weight agent prevails
   - **Evidence Correlation**: Find common ground
   - **Human Escalation**: For critical conflicts

### Decision Making

Final decisions based on consensus:

| Consensus Score | Decision | Action |
|----------------|----------|---------|
| > 0.85 | ACCEPT | Update relationship confidence |
| 0.6 - 0.85 | ACCEPT (Conditional) | Accept with monitoring |
| 0.4 - 0.6 | ESCALATE | Require human review |
| < 0.4 | REJECT | Mark as invalid |

## Queue Management

### Job Priorities

Triangulation jobs are prioritized:
- **Urgent** (1): Confidence < 0.2
- **High** (5): Confidence 0.2 - 0.35
- **Normal** (10): Confidence 0.35 - 0.45
- **Low** (15): Re-analysis requests

### Processing Limits

- Concurrency: 2 workers (configurable)
- Timeout: 5 minutes per analysis
- Max retries: 2
- Stalled job recovery: 30 seconds

## Database Storage

### Analysis Session Tracking

```sql
triangulated_analysis_sessions:
- session_id: Unique identifier
- relationship details
- initial/final confidence
- consensus score
- status tracking
- escalation flag
```

### Agent Results

```sql
subagent_analyses:
- Individual agent scores
- Evidence strength
- Processing time
- Detailed reasoning
- Error tracking
```

### Consensus Decisions

```sql
consensus_decisions:
- Algorithm used
- Individual weights
- Final decision
- Conflict details
- Resolution method
```

## Performance Monitoring

### Key Metrics

1. **Analysis Rate**: Sessions/minute
2. **Success Rate**: Accepted/Total
3. **Escalation Rate**: Human reviews needed
4. **Processing Time**: Average per session
5. **Agent Agreement**: Consensus variance

### Health Indicators

- Queue depth monitoring
- Worker utilization
- Memory usage tracking
- Timeout frequency
- Error rates by type

## Integration Points

### 1. TransactionalOutboxPublisher
- Triggers analysis for low-confidence relationships
- Batches relationships by priority
- Monitors completion status

### 2. Relationship Resolution Workers
- Generate initial relationships
- Provide evidence for scoring
- Update based on triangulation results

### 3. Graph Builder
- Only includes validated relationships
- Uses final confidence scores
- Respects escalation decisions

## Benefits

1. **Quality Assurance**: Ensures only high-confidence relationships in final graph
2. **Automated Validation**: Reduces manual review needs
3. **Explainable Decisions**: Detailed reasoning for each relationship
4. **Scalable Analysis**: Handles large codebases efficiently
5. **Adaptive System**: Learns from patterns over time

This sophisticated system ensures the knowledge graph contains only validated, high-quality relationships while providing transparency and control over the analysis process.