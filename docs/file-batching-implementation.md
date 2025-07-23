# File Batching Implementation for LLM API Optimization

## Overview

This document describes the file batching feature implemented to optimize LLM API usage for small files in the Code Trail Project (CTP).

## Problem Statement

Processing many small files (< 10KB) individually through the LLM API is inefficient because:
- Each API call has overhead regardless of content size
- Small files often don't utilize the full context window
- API rate limits can be reached quickly with many small files

## Solution: FileBatcher

### Core Components

1. **FileBatcher Class** (`src/utils/fileBatcher.js`)
   - Groups small files into batches
   - Respects character limits (60K default)
   - Maintains file context and metadata
   - Parses batch responses to extract POIs per file

2. **BatchingFileAnalysisWorker** (`src/workers/BatchingFileAnalysisWorker.js`)
   - Enhanced version of FileAnalysisWorker
   - Integrates FileBatcher for small files
   - Maintains backward compatibility for large files
   - Processes batches asynchronously

### Key Features

#### 1. Intelligent File Grouping
```javascript
// Files are grouped based on:
- Size threshold (10KB default)
- Maximum batch size (60K characters)
- Maximum files per batch (20 files)
```

#### 2. Batch Processing Flow
```
1. Job arrives with file path
2. Check if file size < threshold
3. If small: Add to pending batch
4. If large: Process immediately
5. Process batches periodically or when full
```

#### 3. Structured Prompt Format
The batcher creates prompts that clearly delineate files:
```
Analyze the following 3 code files...

===FILE_BOUNDARY===
FILE 1: /path/to/file1.js
```javascript
// file content
```

===FILE_BOUNDARY===
FILE 2: /path/to/file2.py
```python
# file content
```
```

#### 4. Response Parsing
The LLM returns structured JSON with POIs per file:
```json
{
  "files": [
    {
      "filePath": "/path/to/file1.js",
      "pois": [
        {
          "name": "functionName",
          "type": "FunctionDefinition",
          "start_line": 1,
          "end_line": 10
        }
      ]
    }
  ]
}
```

### Configuration Options

```javascript
const batcher = new FileBatcher({
    maxBatchChars: 60000,        // Max characters per batch
    smallFileThreshold: 10240,   // Files under this size are batched (10KB)
    maxFilesPerBatch: 20,        // Max files in a single batch
    fileDelimiter: '===FILE_BOUNDARY===' // Delimiter between files
});
```

### Usage Example

```javascript
// Create batches from file paths
const batches = await fileBatcher.createBatches(filePaths);

// Process each batch
for (const batch of batches) {
    if (batch.isSingleLargeFile) {
        // Process large file individually
        await processSingleFile(batch.files[0].path);
    } else {
        // Construct batch prompt
        const prompt = fileBatcher.constructBatchPrompt(batch);
        
        // Query LLM
        const response = await llmClient.query(prompt);
        
        // Parse response to get POIs per file
        const fileResults = fileBatcher.parseBatchResponse(response, batch);
        
        // Process results for each file
        for (const [filePath, pois] of Object.entries(fileResults)) {
            await savePois(filePath, pois);
        }
    }
}
```

### Performance Benefits

1. **Reduced API Calls**: Multiple small files processed in single request
2. **Better Token Utilization**: Batches approach the context window limit
3. **Maintained Accuracy**: File boundaries preserve context
4. **Flexible Processing**: Large files still processed individually

### Error Handling

- Individual file read errors don't fail the entire batch
- Failed batch processing falls back to individual file processing
- Comprehensive logging at each stage
- Statistics tracking for monitoring

### Statistics and Monitoring

The FileBatcher tracks:
- Files processed
- Batches created
- Total characters batched
- Average files per batch
- Processing errors

Access statistics via:
```javascript
const stats = fileBatcher.getStats();
```

### Testing

Run the test script to validate batching behavior:
```bash
node test/testFileBatching.js
```

This creates sample files, tests batching logic, and validates response parsing.

### Migration Guide

To use the new batching worker instead of the standard FileAnalysisWorker:

1. Import BatchingFileAnalysisWorker:
```javascript
const BatchingFileAnalysisWorker = require('./workers/BatchingFileAnalysisWorker');
```

2. Replace worker instantiation:
```javascript
// Old
const worker = new FileAnalysisWorker(queueManager, dbManager, cacheClient, llmClient);

// New
const worker = new BatchingFileAnalysisWorker(queueManager, dbManager, cacheClient, llmClient);
```

The new worker maintains full backward compatibility while adding batching capabilities.

### Future Enhancements

1. **Dynamic Batch Sizing**: Adjust batch size based on API response times
2. **Priority Batching**: Process high-priority files first
3. **Batch Caching**: Cache batch results for similar file sets
4. **Language-Specific Batching**: Group files by programming language
5. **Incremental Processing**: Process files as they arrive rather than waiting