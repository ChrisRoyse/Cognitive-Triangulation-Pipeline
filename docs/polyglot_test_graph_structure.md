# Polyglot Test - Expected Graph Structure

## Visual Overview of Key Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Polyglot Test Application                     │
│                                                                      │
│  ┌─────────────┐     API Calls      ┌─────────────┐                │
│  │ JavaScript  │ ◄─────────────────► │    Java     │                │
│  │  (Express)  │                     │  Services   │                │
│  │  Port 3000  │ ◄───┐               │  Port 8080  │                │
│  └─────────────┘     │               └─────────────┘                │
│         │            │                      │                        │
│         │            │                      │                        │
│         ▼            ▼                      ▼                        │
│  ┌─────────────┐  ┌─────────────┐   ┌─────────────┐                │
│  │   Python    │  │   Python    │   │   SQLite    │                │
│  │Data Process │  │ ML Service  │   │  Database   │                │
│  │  Port 5000  │  │  Port 5001  │   │   Tables    │                │
│  └─────────────┘  └─────────────┘   └─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Node Clusters

### 1. JavaScript Ecosystem
```
js/
├── server.js
│   └── ApiGateway class
│       ├── constructor()
│       ├── setupMiddleware()
│       ├── setupRoutes()
│       └── ... (11 more methods)
├── auth.js
│   ├── AuthManager class
│   │   └── ... (9 methods)
│   └── authenticateToken()
├── config.js
│   └── (configuration objects)
└── utils.js
    └── (utility functions)
```

### 2. Java Ecosystem
```
java/
├── User.java (Entity)
│   └── 22 methods
├── UserService.java (Service Layer)
│   ├── USES → DatabaseManager
│   ├── USES → BusinessLogic
│   └── USES → ApiClient
├── DatabaseManager.java (Data Layer)
│   └── 22 database methods
├── BusinessLogic.java (Business Layer)
│   └── 19 business methods
└── ApiClient.java (Integration Layer)
    └── 20 API methods
```

### 3. Python Ecosystem
```
python/
├── data_processor.py
│   └── DataProcessor class
│       └── 15 methods
├── ml_service.py
│   ├── MLModel (base)
│   ├── LinearRegressionModel EXTENDS MLModel
│   ├── ClassificationModel EXTENDS MLModel
│   └── MLService
├── database_client.py
│   └── DatabaseClient class
└── utils.py
    ├── DataValidator
    ├── DataTransformer
    ├── CryptoUtils
    └── ... (4 more classes)
```

### 4. Database Schema
```
SQLite Database
├── User Management
│   ├── users
│   ├── user_sessions
│   ├── user_activity
│   └── user_preferences
├── Processing Pipeline
│   ├── processing_jobs
│   └── analysis_results
├── ML System
│   ├── ml_models
│   └── ml_predictions
└── System Infrastructure
    ├── api_requests
    ├── service_events
    ├── system_metrics
    └── ... (4 more tables)
```

## Critical Cross-Language Relationships

### 1. Authentication Flow
```
JavaScript (auth.js) 
    → authenticateToken()
    → CALLS → Java UserService.authenticateUser()
    → USES → SQLite users table
```

### 2. Data Processing Pipeline
```
JavaScript (server.js)
    → /api/process endpoint
    → CALLS → Python DataProcessor.process_data()
    → USES → SQLite processing_jobs table
    → RETURNS → analysis_results
```

### 3. ML Prediction Flow
```
JavaScript (server.js)
    → /api/predict endpoint
    → CALLS → Python MLService.predict()
    → USES → ml_models table
    → CREATES → ml_predictions record
```

### 4. Business Logic Integration
```
Java UserService
    → USES → BusinessLogic.validateUserData()
    → CALLS → ApiClient.notifyJavaScriptService()
    → TRIGGERS → JavaScript webhook
```

## Validation Checkpoints

### ✓ Must-Have Relationships
1. **Cross-Service Communication**
   - [ ] Java ApiClient → JavaScript API endpoints
   - [ ] JavaScript server → Python services
   - [ ] All services → SQLite database

2. **Inheritance Hierarchy**
   - [ ] LinearRegressionModel EXTENDS MLModel
   - [ ] ClassificationModel EXTENDS MLModel

3. **Module Dependencies**
   - [ ] JavaScript modules IMPORT config
   - [ ] Python modules IMPORT utils
   - [ ] Java classes IMPORT java.sql.*

4. **Database Foreign Keys**
   - [ ] user_sessions.user_id → users.id
   - [ ] processing_jobs.user_id → users.id
   - [ ] ml_predictions.model_id → ml_models.id

### Graph Complexity Indicators
- **Node Density**: ~417 nodes across 15 files = ~28 nodes/file
- **Relationship Density**: ~870 relationships = ~58 relationships/file
- **Cross-Language Connections**: >25 relationships
- **Inheritance Depth**: 2 levels (base class + derivatives)
- **Module Coupling**: High (shared database, API calls)

## Success Metrics

```cypher
// Minimum viable graph
MATCH (n:POI) WITH count(n) as nodes
MATCH ()-[r:RELATIONSHIP]->() WITH nodes, count(r) as rels
RETURN 
  nodes >= 375 as nodesPass,
  rels >= 697 as relsPass,
  nodes >= 375 AND rels >= 697 as overallPass
```

This benchmark represents a complex, real-world microservices architecture that thoroughly tests the pipeline's ability to:
- Extract entities across multiple languages
- Detect cross-language dependencies
- Map database schemas
- Identify inheritance patterns
- Build a comprehensive knowledge graph