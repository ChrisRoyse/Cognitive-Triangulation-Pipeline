# Cross-File Relationship Analysis Implementation

## Overview

This document describes the implementation of cross-file relationship analysis capability for true cognitive triangulation. The system now analyzes relationships that span multiple files, enabling detection of architectural patterns, import/export dependencies, API calls, and inheritance relationships across the entire codebase.

## Problem Solved

**Previous Limitation**: The RelationshipResolutionWorker only analyzed relationships within single files, missing the most important architectural relationships that exist across file boundaries.

**Solution**: Added a comprehensive cross-file analysis system that:
- Detects import/export relationships
- Identifies API calls across files  
- Finds inheritance patterns spanning files
- Discovers configuration dependencies
- Enables true cognitive triangulation

## Architecture Components

### 1. GlobalRelationshipAnalysisWorker

**Location**: `src/workers/GlobalRelationshipAnalysisWorker.js`

**Purpose**: Analyzes relationships across ALL files in a run using LLM-powered semantic analysis.

**Key Features**:
- Groups POIs by semantic patterns (exports, imports, API calls, classes, etc.)
- Generates specialized LLM prompts for different relationship types
- Processes cross-file analysis in batches by directory
- Validates and enriches relationship data with cross-file evidence

**Process Flow**:
```
1. Get all POIs for run/directory
2. Group POIs by semantic patterns
3. Analyze import-export relationships 
4. Analyze API call relationships
5. Analyze inheritance relationships
6. Analyze configuration dependencies
7. Publish findings to outbox
```

### 2. CrossFileRelationshipResolver

**Location**: `src/services/CrossFileRelationshipResolver.js`

**Purpose**: Service for finding relationships between POIs in different files using heuristic matching.

**Key Features**:
- Name-based matching algorithms
- Semantic pattern recognition
- Cross-file relationship validation
- Statistical analysis capabilities

**Relationship Types Detected**:
- **IMPORTS**: Import statements → Exported items
- **CALLS**: Function calls → Exported functions  
- **INHERITS**: Child classes → Parent classes
- **COMPOSES**: Classes using other classes
- **USES_CONFIG**: Code → Configuration variables

### 3. Enhanced TransactionalOutboxPublisher

**Location**: `src/services/TransactionalOutboxPublisher.js`

**New Capabilities**:
- Detects when all files in a run are processed
- Automatically triggers global cross-file analysis
- Handles global relationship analysis findings
- Coordinates pipeline orchestration for cross-file phase

**Key Methods**:
- `_checkAndTriggerGlobalAnalysis()`: Detects completion and triggers analysis
- `_triggerGlobalAnalysisForRun()`: Creates global analysis jobs
- `_handleBatchedGlobalRelationshipFindings()`: Processes cross-file relationships

## Pipeline Integration

### Updated Pipeline Flow

```
Previous Flow:
File Analysis → Intra-File Relationships → Done

New Flow:
File Analysis → Intra-File Relationships → Cross-File Relationships → Done
```

### Queue Configuration

Added new queue: `global-relationship-analysis-queue`

**Location**: `config/index.js`

### Worker Integration

**Location**: `src/main.js`

The GlobalRelationshipAnalysisWorker is now integrated into the main pipeline and initialized with other workers.

## Cross-File Analysis Examples

### Example 1: Import-Export Relationships

**File A (auth.js)**:
```javascript
export function authenticate(credentials) {
    // Authentication logic
}
```

**File B (user.js)**:
```javascript
import { authenticate } from './auth.js';

function login(user, password) {
    return authenticate({ user, password });
}
```

**Detected Relationship**:
```json
{
    "from": "user_import_authenticate",
    "to": "auth_func_authenticate", 
    "type": "IMPORTS",
    "cross_file_evidence": "Import in user.js references exported function from auth.js",
    "confidence": 0.95
}
```

### Example 2: API Call Relationships

**File A (utils.js)**:
```javascript
export function validateEmail(email) {
    return /\S+@\S+\.\S+/.test(email);
}
```

**File B (service.js)**:
```javascript
import { validateEmail } from './utils.js';

function createUser(userData) {
    if (!validateEmail(userData.email)) {
        throw new Error('Invalid email');
    }
    // ...
}
```

**Detected Relationship**:
```json
{
    "from": "service_func_createUser",
    "to": "utils_func_validateEmail",
    "type": "CALLS", 
    "cross_file_evidence": "Function call in service.js invokes exported function from utils.js",
    "confidence": 0.90
}
```

### Example 3: Inheritance Relationships

**File A (base.js)**:
```javascript
export class BaseUser {
    constructor(name) {
        this.name = name;
    }
}
```

**File B (admin.js)**:
```javascript
import { BaseUser } from './base.js';

export class AdminUser extends BaseUser {
    constructor(name, permissions) {
        super(name);
        this.permissions = permissions;
    }
}
```

**Detected Relationship**:
```json
{
    "from": "admin_class_AdminUser",
    "to": "base_class_BaseUser",
    "type": "INHERITS",
    "cross_file_evidence": "AdminUser in admin.js inherits from BaseUser class in base.js", 
    "confidence": 0.95
}
```

## LLM Prompts for Cross-File Analysis

### Import-Export Analysis Prompt

```
Analyze cross-file import-export relationships between exported functions/classes and import statements.

EXPORTED ITEMS:
- function: authenticate (file: src/auth.js, semantic_id: auth_func_authenticate)
- function: hashPassword (file: src/auth.js, semantic_id: auth_func_hashPassword)

IMPORT STATEMENTS:  
- import: import { authenticate } (file: src/user.js, semantic_id: user_import_authenticate)
- import: import { hashPassword } (file: src/service.js, semantic_id: service_import_hashPassword)

Find relationships where import statements are importing the exported items from other files.
Look for:
1. Direct imports (import { functionName } from './file')
2. Namespace imports (import * as module from './file') 
3. Default imports (import defaultExport from './file')
4. CommonJS requires (const { item } = require('./file'))

Format output as JSON with "relationships" array...
```

### API Call Analysis Prompt

```
Analyze cross-file API call relationships between exported functions/methods and function calls in different files.

EXPORTED FUNCTIONS/METHODS:
- function: authenticate (file: src/auth.js, semantic_id: auth_func_authenticate)
- function: validateEmail (file: src/utils.js, semantic_id: utils_func_validateEmail)

FUNCTION CALLS:
- function_call: authenticate(credentials) (file: src/user.js, semantic_id: user_call_authenticate)  
- function_call: validateEmail(email) (file: src/service.js, semantic_id: service_call_validateEmail)

Find relationships where function calls in one file are calling exported functions from other files...
```

## Database Schema Updates

### New Relationship Status

Added `CROSS_FILE_VALIDATED` status for relationships detected through cross-file analysis.

### Relationship Metadata

Cross-file relationships include additional metadata:
- `cross_file`: Boolean flag indicating cross-file nature
- `from_file`: Source file path
- `to_file`: Target file path
- `analysis_type`: Type of analysis that detected the relationship

## Testing

### Integration Tests

**Location**: `tests/integration/cross-file-relationship-analysis.test.js`

**Coverage**:
- CrossFileRelationshipResolver functionality
- GlobalRelationshipAnalysisWorker processing
- TransactionalOutboxPublisher integration
- End-to-end cross-file analysis workflow

**Test Scenarios**:
- Import-export relationship detection
- API call relationship detection  
- Inheritance relationship detection
- Configuration dependency detection
- Statistical analysis
- Pipeline orchestration

## Performance Considerations

### Concurrency Settings

- **GlobalRelationshipAnalysisWorker**: Lower concurrency (5 workers) due to complex analysis
- **Rate Limiting**: Conservative limits to prevent API overload
- **Timeout**: 10 minutes for complex cross-file analysis

### Optimization Strategies

1. **Directory Batching**: Analysis batched by directory to reduce scope
2. **Semantic Grouping**: POIs grouped by patterns to optimize LLM queries
3. **Heuristic Pre-filtering**: CrossFileRelationshipResolver provides quick matches
4. **Intelligent Triggering**: Analysis only starts after all intra-file work is complete

## Success Criteria Achieved

✅ **Cross-file relationships detected**: Import/export, API calls, inheritance relationships  
✅ **Global relationship analysis worker implemented**: Full LLM-powered cross-file analysis  
✅ **Pipeline orchestration updated**: Automatic triggering after intra-file analysis complete  
✅ **Semantic IDs enable meaningful reasoning**: Uses semantic IDs for cross-file matching  
✅ **True cognitive triangulation achieved**: Analysis spans entire codebase architecture  

## Usage Example

```javascript
// The system automatically detects and analyzes these cross-file relationships:

// auth.js
export function authenticate(credentials) { /* ... */ }

// user.js  
import { authenticate } from './auth.js';
function login(user, pass) {
    return authenticate({ user, pass }); // CALLS relationship detected
}

// config.js
export const JWT_SECRET = process.env.JWT_SECRET;

// auth.js
import { JWT_SECRET } from './config.js'; // IMPORTS relationship detected
```

The system will automatically:
1. Detect the import of `authenticate` from auth.js to user.js
2. Detect the function call from `login` to `authenticate`  
3. Detect the configuration dependency on `JWT_SECRET`
4. Create semantic relationships in the knowledge graph
5. Enable architectural analysis across the entire codebase

This completes the cognitive triangulation system by enabling analysis of the most important relationships - those that span multiple files and define the system's architecture.