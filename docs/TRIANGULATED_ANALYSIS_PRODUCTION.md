# Production-Ready Triangulated Analysis System

## Overview

The Triangulated Analysis System is a production-ready implementation that automatically analyzes low-confidence relationships using three specialized AI agents. When the main pipeline identifies relationships with confidence scores below 0.45, they are automatically queued for deeper analysis through triangulated cognitive assessment.

## Architecture

### Core Components

1. **TriangulatedAnalysisQueue** - Main orchestrator that manages the analysis workflow
2. **TriangulationLLMClient** - Production LLM client with retry logic and monitoring
3. **Three Specialized Analysis Agents**:
   - **SyntacticAnalysisAgent** - Focuses on code structure and patterns
   - **SemanticAnalysisAgent** - Analyzes meaning and conceptual relationships
   - **ContextualAnalysisAgent** - Evaluates architectural and contextual coherence

### Production Features

#### 1. Real DeepSeek API Integration
- Full production LLM client with timeout handling
- Exponential backoff retry logic
- Network error resilience
- Request queuing and rate limiting
- Comprehensive error tracking

#### 2. Worker Lifecycle Management
- Automatic worker initialization in main pipeline
- Graceful shutdown handling
- Health monitoring and recovery
- Configurable concurrency limits

#### 3. Performance Optimization
- Limited concurrency (2 workers) for resource-intensive analysis
- 5-minute timeout per analysis
- Batch processing of relationships
- Caching of analysis results

#### 4. Monitoring & Observability
- Real-time queue statistics
- Agent performance metrics
- Success/failure tracking
- Processing time analytics

## Configuration

### Environment Variables

```bash
# Core Triangulation Settings
TRIANGULATION_ENABLED=true              # Enable/disable the system
TRIANGULATION_THRESHOLD=0.45            # Confidence threshold for triggering
TRIANGULATION_CONCURRENCY=2             # Number of concurrent analyses
TRIANGULATION_TIMEOUT=300000            # Analysis timeout (5 minutes)
TRIANGULATION_AUTO_TRIGGER=true         # Enable automatic triggering
TRIANGULATION_AUTO_INTERVAL=30000       # Auto-trigger check interval

# Agent-Specific Timeouts
SYNTACTIC_TIMEOUT=30000                 # Syntactic agent timeout
SEMANTIC_TIMEOUT=35000                  # Semantic agent timeout  
CONTEXTUAL_TIMEOUT=40000                # Contextual agent timeout

# Consensus Configuration
CONSENSUS_MIN_AGREEMENT=0.6             # Minimum agreement for consensus
CONSENSUS_ESCALATION=0.4                # Threshold for human escalation
WEIGHT_SYNTACTIC=0.3                    # Syntactic analysis weight
WEIGHT_SEMANTIC=0.4                     # Semantic analysis weight
WEIGHT_CONTEXTUAL=0.3                   # Contextual analysis weight

# LLM Configuration
DEEPSEEK_API_KEY=your-api-key-here     # Required for production
```

### Pipeline Configuration

The system is integrated into `PipelineConfig`:

```javascript
triangulation: {
    enabled: true,
    confidenceThreshold: 0.45,
    concurrency: 2,
    processingTimeout: 300000,
    enableAutoTrigger: true,
    agents: {
        syntactic: { timeout: 30000, temperature: 0.0 },
        semantic: { timeout: 35000, temperature: 0.1 },
        contextual: { timeout: 40000, temperature: 0.05 }
    },
    consensus: {
        minimumAgreement: 0.6,
        escalationThreshold: 0.4,
        weights: { syntactic: 0.3, semantic: 0.4, contextual: 0.3 }
    }
}
```

## Usage

### Automatic Triggering

The system automatically monitors for low-confidence relationships:

1. Relationships with confidence < 0.45 are flagged
2. Auto-trigger runs every 30 seconds
3. Flagged relationships are queued for analysis
4. Results update the original relationship records

### Manual Triggering

```javascript
const relationships = [/* low confidence relationships */];
const result = await triangulatedQueue.triggerTriangulatedAnalysis(
    relationships,
    runId,
    'high' // priority: urgent, high, normal, low
);
```

### Monitoring

Use the production monitoring script:

```bash
node scripts/monitor-triangulation.js
```

This provides real-time insights into:
- Queue status and job counts
- Active analysis sessions
- Agent performance metrics
- Recent triangulation results

## Database Schema

### triangulated_analysis_sessions
- Tracks each analysis session
- Links to original relationship
- Records initial/final confidence scores
- Stores consensus results

### subagent_analyses
- Individual agent analysis results
- Confidence scores and evidence strength
- Processing status and timing
- Detailed analysis data

### triangulated_analysis_results
- Consensus decisions
- Final recommendations
- Human escalation flags

## Testing

### Unit Testing
```bash
npm test -- tests/triangulation/
```

### Production Test
```bash
node tests/triangulation/test-production-triangulation.js
```

This verifies:
- LLM connectivity
- Agent coordination
- Consensus building
- Database updates

## Error Handling

### Network Failures
- Automatic retry with exponential backoff
- Maximum 3 retry attempts
- Timeout protection (60s per request)

### Agent Failures
- Individual agent failures don't block analysis
- Consensus adapts to available results
- Failed analyses are logged and tracked

### System Overload
- Queue depth monitoring
- Automatic backpressure
- Emergency cleanup if needed

## Performance Characteristics

### Expected Metrics
- Processing time: 30-120 seconds per relationship
- Success rate: >90% with stable network
- Confidence improvement: Average +0.15-0.25
- Escalation rate: <5% of analyses

### Resource Usage
- Memory: ~50-100MB per active analysis
- CPU: Moderate (mostly waiting for LLM)
- Network: 3-5 API calls per analysis

## Troubleshooting

### Common Issues

1. **LLM Timeouts**
   - Check network connectivity
   - Verify API key is valid
   - Increase timeout settings

2. **High Failure Rate**
   - Monitor API rate limits
   - Check for malformed prompts
   - Verify file content accessibility

3. **Queue Backup**
   - Reduce auto-trigger frequency
   - Increase concurrency limit
   - Check for stuck jobs

### Debug Commands

```bash
# Check queue health
node scripts/check-db-status.js

# View recent failures
sqlite3 data/database.db "SELECT * FROM triangulated_analysis_sessions WHERE status='FAILED' ORDER BY created_at DESC LIMIT 10"

# Reset stuck sessions
sqlite3 data/database.db "UPDATE triangulated_analysis_sessions SET status='FAILED' WHERE status='IN_PROGRESS' AND created_at < datetime('now', '-1 hour')"
```

## Best Practices

1. **Monitor Queue Depth** - Keep active jobs under 100
2. **Set Appropriate Thresholds** - Default 0.45 works for most cases
3. **Review Escalated Cases** - Human review for consensus < 0.4
4. **Regular Health Checks** - Use monitoring script during operations
5. **Backup Analysis Data** - Archive completed sessions periodically

## Integration Points

The triangulated analysis system integrates seamlessly with:
- Main file analysis pipeline
- Relationship resolution workers
- Graph building process
- Monitoring infrastructure

Results are automatically incorporated into the knowledge graph with enhanced confidence scores and detailed evidence trails.