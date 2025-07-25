# Polyglot Test Application

This is a comprehensive test application designed to validate the code analysis pipeline. It consists of multiple programming languages working together to create a complete system.

## Architecture

**Languages Used:**
- **JavaScript/Node.js**: API Gateway and main server
- **Python**: Data processing and ML services  
- **Java**: Business logic and database operations
- **SQLite Database**: Shared data storage

## Components

### 1. JavaScript Layer (`/js/`)
- `server.js` - Express.js API gateway
- `config.js` - Configuration management
- `utils.js` - Utility functions
- `auth.js` - Authentication middleware

### 2. Python Layer (`/python/`)
- `data_processor.py` - Main data processing service
- `ml_service.py` - Machine learning operations
- `database_client.py` - Python database interface
- `utils.py` - Python utility functions

### 3. Java Layer (`/java/`)
- `UserService.java` - User management service
- `DatabaseManager.java` - Java database operations  
- `BusinessLogic.java` - Core business operations
- `ApiClient.java` - External API integration

### 4. Database (`/database/`)
- `schema.sql` - Database schema definition
- `test_data.sql` - Sample data for testing

## Expected Analysis Results

**Total Expected Entities:**
- Functions: ~25-30
- Classes: ~8-10  
- Variables: ~40-50
- Files: 12
- Database Tables: 3-4

**Expected Relationships:**
- IMPORTS: ~20-25 (cross-language API calls)
- EXPORTS: ~15-20  
- CONTAINS: ~50-60 (file contains functions/classes)
- USES: ~30-40 (function calls, variable usage)
- CALLS: ~15-20 (inter-service communication)

## Testing Validation

This application will test:
1. **Multi-language detection**: JavaScript, Python, Java
2. **Cross-language relationships**: API calls between services
3. **Database relationships**: Multiple languages accessing same DB
4. **Complex inheritance**: Java classes with inheritance
5. **Module imports**: Various import patterns across languages
6. **Configuration sharing**: Config files used by multiple services

## Usage

Each service can be run independently:
- JavaScript: `node js/server.js`
- Python: `python python/data_processor.py`  
- Java: `javac java/*.java && java UserService` 