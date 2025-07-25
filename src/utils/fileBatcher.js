const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * FileBatcher - Groups small files into batches for efficient LLM processing
 * 
 * Features:
 * - Automatic batching of files under size threshold
 * - Respects character limits for LLM API
 * - Preserves file context and metadata
 * - Supports per-file POI extraction from batch responses
 * - Comprehensive error handling and logging
 */
class FileBatcher {
    constructor(options = {}) {
        // Configuration
        this.maxBatchChars = options.maxBatchChars || 60000; // Max chars per batch
        this.smallFileThreshold = options.smallFileThreshold || 10240; // 10KB
        this.maxFilesPerBatch = options.maxFilesPerBatch || 20; // Limit files per batch
        this.fileDelimiter = options.fileDelimiter || '\n\n===FILE_BOUNDARY===\n\n';
        
        // Statistics
        this.stats = {
            filesProcessed: 0,
            batchesCreated: 0,
            totalBatchedChars: 0,
            totalBatchedFiles: 0,
            errors: 0
        };
    }

    /**
     * Check if a file should be batched based on size
     * @param {string} filePath - Path to the file
     * @returns {Promise<boolean>} - True if file should be batched
     */
    async shouldBatchFile(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.size <= this.smallFileThreshold;
        } catch (error) {
            console.error(`Error checking file size for ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Create batches from an array of file paths
     * @param {Array<string>} filePaths - Array of file paths to batch
     * @returns {Promise<Array>} - Array of batch objects
     */
    async createBatches(filePaths) {
        const batches = [];
        let currentBatch = {
            files: [],
            totalChars: 0,
            id: this.generateBatchId()
        };

        for (const filePath of filePaths) {
            try {
                // Check if file should be batched
                const shouldBatch = await this.shouldBatchFile(filePath);
                if (!shouldBatch) {
                    // File too large, process individually
                    if (currentBatch.files.length > 0) {
                        batches.push(currentBatch);
                        currentBatch = {
                            files: [],
                            totalChars: 0,
                            id: this.generateBatchId()
                        };
                    }
                    
                    // Add as single-file batch
                    batches.push({
                        files: [{
                            path: filePath,
                            content: null, // Will be loaded on demand
                            metadata: { isLarge: true }
                        }],
                        totalChars: 0,
                        id: this.generateBatchId(),
                        isSingleLargeFile: true
                    });
                    continue;
                }

                // Read file content
                const content = await fs.readFile(filePath, 'utf-8');
                const fileInfo = {
                    path: filePath,
                    content: content,
                    chars: content.length,
                    metadata: {
                        fileName: path.basename(filePath),
                        extension: path.extname(filePath),
                        directory: path.dirname(filePath)
                    }
                };

                // Check if adding this file would exceed batch limits
                const projectedChars = currentBatch.totalChars + fileInfo.chars + this.fileDelimiter.length;
                
                if (projectedChars > this.maxBatchChars || 
                    currentBatch.files.length >= this.maxFilesPerBatch) {
                    // Start new batch
                    if (currentBatch.files.length > 0) {
                        batches.push(currentBatch);
                    }
                    currentBatch = {
                        files: [],
                        totalChars: 0,
                        id: this.generateBatchId()
                    };
                }

                // Add file to current batch
                currentBatch.files.push(fileInfo);
                currentBatch.totalChars += fileInfo.chars;
                this.stats.filesProcessed++;

            } catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
                this.stats.errors++;
            }
        }

        // Add final batch if not empty
        if (currentBatch.files.length > 0) {
            batches.push(currentBatch);
        }

        // Update statistics
        this.stats.batchesCreated += batches.length;
        batches.forEach(batch => {
            if (!batch.isSingleLargeFile) {
                this.stats.totalBatchedFiles += batch.files.length;
                this.stats.totalBatchedChars += batch.totalChars;
            }
        });

        console.log(`Created ${batches.length} batches from ${filePaths.length} files`);
        return batches;
    }

    /**
     * Construct a prompt for batch analysis
     * @param {Object} batch - Batch object containing files
     * @returns {string} - Formatted prompt for LLM
     */
    constructBatchPrompt(batch) {
        if (batch.isSingleLargeFile) {
            // Handle large files separately (backward compatibility)
            return null;
        }

        let prompt = `Analyze the following ${batch.files.length} code files and extract Points of Interest (POIs) for EACH file separately.

For each file, extract POIs including:
- Class Definitions
- Function Definitions
- Global/Module-level Variable Declarations
- Import Statements

Respond with a single JSON object containing a "files" array. Each element in the array should represent one file with its POIs.

FORMAT YOUR RESPONSE EXACTLY AS:
{
  "files": [
    {
      "filePath": "full/path/to/file.js",
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

FILES TO ANALYZE:
`;

        // Add each file with clear boundaries
        batch.files.forEach((file, index) => {
            prompt += `\n${this.fileDelimiter}`;
            prompt += `FILE ${index + 1}: ${file.path}\n`;
            prompt += `\`\`\`${this.getLanguageFromExtension(file.metadata.extension)}\n`;
            prompt += file.content;
            prompt += `\n\`\`\``;
        });

        return prompt;
    }

    /**
     * Parse batch response to extract POIs per file
     * @param {Object} response - LLM response object
     * @param {Object} batch - Original batch object
     * @returns {Object} - Map of filePath to POIs array
     */
    parseBatchResponse(response, batch) {
        const results = {};

        try {
            // Handle various response formats
            let parsedResponse;
            if (typeof response === 'string') {
                parsedResponse = JSON.parse(response);
            } else {
                parsedResponse = response;
            }

            // Extract files array from response
            const files = parsedResponse.files || [];

            // Map POIs to original file paths
            files.forEach(fileResult => {
                const filePath = fileResult.filePath || fileResult.file_path;
                const pois = fileResult.pois || [];

                // Validate and enhance POIs
                const validatedPois = pois.map(poi => ({
                    id: this.generatePoiId(),
                    name: poi.name,
                    type: this.normalizePoiType(poi.type),
                    start_line: poi.start_line || 1,
                    end_line: poi.end_line || poi.start_line || 1
                })).filter(poi => poi.name && poi.type);

                results[filePath] = validatedPois;
            });

            // Ensure all batch files have results (even if empty)
            batch.files.forEach(file => {
                if (!results[file.path]) {
                    results[file.path] = [];
                    console.warn(`No POIs found for file: ${file.path}`);
                }
            });

        } catch (error) {
            console.error('Error parsing batch response:', error);
            
            // Return empty results for all files on error
            batch.files.forEach(file => {
                results[file.path] = [];
            });
        }

        return results;
    }

    /**
     * Normalize POI type to expected format
     * @param {string} type - Raw POI type from LLM
     * @returns {string} - Normalized type
     */
    normalizePoiType(type) {
        const typeMap = {
            'function': 'FunctionDefinition',
            'functiondefinition': 'FunctionDefinition',
            'class': 'ClassDefinition',
            'classdefinition': 'ClassDefinition',
            'variable': 'VariableDeclaration',
            'variabledeclaration': 'VariableDeclaration',
            'import': 'ImportStatement',
            'importstatement': 'ImportStatement'
        };

        const normalized = typeMap[type.toLowerCase()] || type;
        return normalized;
    }

    /**
     * Get programming language from file extension
     * @param {string} extension - File extension
     * @returns {string} - Language identifier
     */
    getLanguageFromExtension(extension) {
        const languageMap = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.cs': 'csharp'
        };
        
        return languageMap[extension.toLowerCase()] || 'text';
    }

    /**
     * Generate unique batch ID
     * @returns {string} - Batch ID
     */
    generateBatchId() {
        return crypto.randomBytes(8).toString('hex');
    }

    /**
     * Generate unique POI ID
     * @returns {string} - POI ID
     */
    generatePoiId() {
        return crypto.randomUUID();
    }

    /**
     * Get batching statistics
     * @returns {Object} - Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            averageFilesPerBatch: this.stats.batchesCreated > 0 
                ? (this.stats.totalBatchedFiles / this.stats.batchesCreated).toFixed(2) 
                : 0,
            averageCharsPerBatch: this.stats.batchesCreated > 0 
                ? Math.round(this.stats.totalBatchedChars / this.stats.batchesCreated) 
                : 0
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            filesProcessed: 0,
            batchesCreated: 0,
            totalBatchedChars: 0,
            totalBatchedFiles: 0,
            errors: 0
        };
    }
}

module.exports = FileBatcher;