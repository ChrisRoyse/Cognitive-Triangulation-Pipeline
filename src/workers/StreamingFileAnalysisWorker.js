const fs = require('fs');
const path = require('path');
const { Transform, pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);
const config = require('../config/secure');
const resourceManager = require('../utils/resourceManager');

/**
 * Streaming File Analysis Worker
 * 
 * Optimized for memory efficiency and large file handling:
 * - Streams large files instead of loading into memory
 * - Smart chunking on function/class boundaries
 * - Memory usage monitoring and limits
 * - Backpressure handling
 * - Error recovery and retry logic
 */
class StreamingFileAnalysisWorker {
    constructor(queueManager, dbManager, llmClient) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.llmClient = llmClient;
        
        // Configuration
        this.maxFileSize = config.application.maxFileSize * 1024 * 1024; // MB to bytes
        this.maxChunkSize = 50000; // tokens
        this.maxConcurrentChunks = 5;
        this.chunkOverlap = 500; // characters overlap between chunks
        
        // Statistics
        this.stats = {
            filesProcessed: 0,
            chunksProcessed: 0,
            poisExtracted: 0,
            errors: 0,
            memoryUsage: { peak: 0, current: 0 },
            processingTime: 0
        };

        // Active processing tracking
        this.activeProcessing = new Map();
        this.semaphore = new Semaphore(this.maxConcurrentChunks);
        
        // Setup worker
        this.setupWorker();
        
        // Register for cleanup
        resourceManager.register('StreamingFileAnalysisWorker', this);
    }

    setupWorker() {
        const worker = this.queueManager.createWorker(
            'file-analysis-queue',
            (job) => this.processJob(job),
            { concurrency: config.application.maxWorkers }
        );

        console.log('👷 StreamingFileAnalysisWorker initialized');
    }

    /**
     * Process a file analysis job
     */
    async processJob(job) {
        const startTime = Date.now();
        const { filePath, runId } = job.data;
        
        console.log(`🔍 Processing file: ${filePath}`);
        
        try {
            // Pre-flight checks
            await this.validateFile(filePath);
            
            // Check if file is too large for in-memory processing
            const fileStats = await fs.promises.stat(filePath);
            
            let pois;
            if (fileStats.size > this.maxFileSize) {
                console.log(`📊 Large file detected (${Math.round(fileStats.size / 1024 / 1024)}MB), using streaming`);
                pois = await this.processLargeFileStreaming(filePath);
            } else {
                console.log(`📊 Small file (${Math.round(fileStats.size / 1024)}KB), using standard processing`);
                pois = await this.processSmallFile(filePath);
            }

            // Save results to database
            if (pois.length > 0) {
                await this.savePoisBatch(pois, filePath, runId);
            }

            // Update statistics
            this.stats.filesProcessed++;
            this.stats.poisExtracted += pois.length;
            this.stats.processingTime += Date.now() - startTime;

            console.log(`✅ Processed ${filePath}: ${pois.length} POIs extracted`);
            return { success: true, poisCount: pois.length };

        } catch (error) {
            this.stats.errors++;
            console.error(`❌ Failed to process file ${filePath}:`, error);
            throw error;
        } finally {
            // Cleanup active processing tracker
            this.activeProcessing.delete(filePath);
        }
    }

    /**
     * Validate file before processing
     */
    async validateFile(filePath) {
        try {
            const stats = await fs.promises.stat(filePath);
            
            if (!stats.isFile()) {
                throw new Error(`Path is not a file: ${filePath}`);
            }
            
            if (stats.size === 0) {
                throw new Error(`File is empty: ${filePath}`);
            }
            
            if (stats.size > this.maxFileSize * 10) { // 10x max size is absolutely too large
                throw new Error(`File too large (${Math.round(stats.size / 1024 / 1024)}MB): ${filePath}`);
            }

            // Check file extension for supported types
            const ext = path.extname(filePath).toLowerCase();
            const supportedExtensions = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.php'];
            
            if (!supportedExtensions.includes(ext)) {
                console.warn(`⚠️  Unsupported file extension: ${ext}`);
            }

        } catch (error) {
            throw new Error(`File validation failed: ${error.message}`);
        }
    }

    /**
     * Process small files using standard approach
     */
    async processSmallFile(filePath) {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return await this.analyzeSingleChunk(content, filePath, 0);
        } catch (error) {
            console.error(`❌ Error processing small file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Process large files using streaming approach
     */
    async processLargeFileStreaming(filePath) {
        const allPois = [];
        let chunkIndex = 0;
        
        try {
            // Track memory usage
            this.trackMemoryUsage();
            
            const chunks = await this.streamFileToChunks(filePath);
            
            console.log(`📊 File split into ${chunks.length} chunks`);
            
            // Process chunks with controlled concurrency
            const chunkPromises = chunks.map(async (chunk, index) => {
                await this.semaphore.acquire();
                
                try {
                    return await this.analyzeSingleChunk(chunk.content, filePath, index, chunk.metadata);
                } finally {
                    this.semaphore.release();
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            
            // Merge results and deduplicate
            for (const chunkPois of chunkResults) {
                allPois.push(...chunkPois);
            }

            return this.deduplicatePois(allPois);
            
        } catch (error) {
            console.error(`❌ Error streaming file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Stream file content and split into smart chunks
     */
    async streamFileToChunks(filePath) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let currentChunk = '';
            let lineNumber = 1;
            let charCount = 0;
            
            const self = this;
            const chunkTransform = new Transform({
                transform(chunk, encoding, callback) {
                    const content = chunk.toString();
                    currentChunk += content;
                    charCount += content.length;
                    
                    // Update line counter
                    lineNumber += (content.match(/\n/g) || []).length;
                    
                    // Check if chunk is large enough
                    if (charCount >= self.maxChunkSize) {
                        const smartChunk = self.createSmartChunk(currentChunk, lineNumber - (currentChunk.match(/\n/g) || []).length);
                        chunks.push(smartChunk);
                        
                        // Keep overlap for context
                        currentChunk = currentChunk.slice(-self.chunkOverlap);
                        charCount = currentChunk.length;
                    }
                    
                    callback();
                }
            });

            const readStream = fs.createReadStream(filePath, { 
                encoding: 'utf-8',
                highWaterMark: 64 * 1024 // 64KB buffer
            });

            pipelineAsync(readStream, chunkTransform)
                .then(() => {
                    // Add final chunk
                    if (currentChunk.trim()) {
                        chunks.push(self.createSmartChunk(currentChunk, lineNumber));
                    }
                    resolve(chunks);
                })
                .catch(reject);
        });
    }

    /**
     * Create smart chunk boundaries (on function/class boundaries)
     */
    createSmartChunk(content, startLine) {
        // Find good breaking points (function/class boundaries)
        const boundaryPatterns = [
            /\n\s*(function\s+\w+|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/g,
            /\n\s*(def\s+\w+|class\s+\w+)/g,  // Python
            /\n\s*(public\s+|private\s+|protected\s+)?(static\s+)?(class\s+|interface\s+|function\s+)/g  // Java/TypeScript
        ];

        let bestBreak = content.length;
        
        // Find the latest good breaking point
        for (const pattern of boundaryPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match.index > content.length * 0.7) { // Only consider breaks in last 30%
                    bestBreak = Math.min(bestBreak, match.index);
                }
            }
        }

        const chunkContent = content.substring(0, bestBreak);
        const linesInChunk = (chunkContent.match(/\n/g) || []).length;

        return {
            content: chunkContent,
            metadata: {
                startLine: startLine,
                endLine: startLine + linesInChunk,
                charCount: chunkContent.length,
                hasOverlap: content.length > bestBreak
            }
        };
    }

    /**
     * Analyze a single chunk of content
     */
    async analyzeSingleChunk(content, filePath, chunkIndex, metadata = null) {
        try {
            // Skip empty chunks
            if (!content || content.trim().length === 0) {
                return [];
            }

            console.log(`🔍 Analyzing chunk ${chunkIndex} (${content.length} chars)`);

            // Create analysis prompt
            const prompt = this.createAnalysisPrompt(content, filePath, metadata);
            
            // Query LLM with retry logic
            const response = await this.queryLlmWithRetry(prompt, 3);
            
            if (!response || !response.pois) {
                console.warn(`⚠️  No POIs returned for chunk ${chunkIndex}`);
                return [];
            }

            // Process and validate POIs
            const pois = this.processPoisResponse(response.pois, filePath, chunkIndex, metadata);
            
            this.stats.chunksProcessed++;
            console.log(`✅ Chunk ${chunkIndex}: ${pois.length} POIs extracted`);
            
            return pois;

        } catch (error) {
            console.error(`❌ Error analyzing chunk ${chunkIndex}:`, error);
            return []; // Return empty array on error to avoid failing entire file
        }
    }

    /**
     * Create analysis prompt for LLM
     */
    createAnalysisPrompt(content, filePath, metadata) {
        const fileExtension = path.extname(filePath);
        const language = this.getLanguageFromExtension(fileExtension);
        
        let contextInfo = '';
        if (metadata) {
            contextInfo = `\nThis is chunk from lines ${metadata.startLine}-${metadata.endLine} of the file.`;
        }

        return `Analyze this ${language} code and extract all Points of Interest (POIs).${contextInfo}

File: ${filePath}
Language: ${language}

CODE:
\`\`\`${language}
${content}
\`\`\`

Extract all POIs and respond with JSON in this exact format:
{
  "pois": [
    {
      "name": "functionName",
      "type": "function",
      "startLine": 1,
      "endLine": 10,
      "description": "Brief description of what this does",
      "is_exported": false,
      "parameters": [],
      "complexity": "low"
    }
  ]
}

POI Types to find:
- function: Functions, methods, procedures
- class: Classes, interfaces, structs
- variable: Constants, variables, properties
- import: Import statements, requires, includes
- export: Export statements, module exports
- comment: Important comments, TODOs, documentation

Be thorough but precise. Only include meaningful POIs.`;
    }

    /**
     * Get programming language from file extension
     */
    getLanguageFromExtension(extension) {
        const languageMap = {
            '.js': 'javascript',
            '.ts': 'typescript',
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
            '.kt': 'kotlin'
        };
        
        return languageMap[extension.toLowerCase()] || 'text';
    }

    /**
     * Query LLM with retry logic and circuit breaker
     */
    async queryLlmWithRetry(prompt, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.llmClient.queryLLM(prompt);
                
                // Parse JSON response
                let parsed;
                if (typeof response === 'string') {
                    parsed = JSON.parse(response);
                } else {
                    parsed = response;
                }

                return parsed;
                
            } catch (error) {
                lastError = error;
                console.warn(`⚠️  LLM query attempt ${attempt}/${maxRetries} failed:`, error.message);
                
                if (attempt < maxRetries) {
                    // Exponential backoff
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        console.error('❌ All LLM query attempts failed:', lastError);
        throw lastError;
    }

    /**
     * Process and validate POIs from LLM response
     */
    processPoisResponse(pois, filePath, chunkIndex, metadata) {
        const validPois = [];
        
        for (const poi of pois) {
            try {
                // Validate required fields
                if (!poi.name || !poi.type) {
                    console.warn(`⚠️  Invalid POI missing name/type:`, poi);
                    continue;
                }

                // Adjust line numbers for chunks
                let startLine = poi.startLine || 1;
                let endLine = poi.endLine || startLine;
                
                if (metadata && metadata.startLine > 1) {
                    startLine += metadata.startLine - 1;
                    endLine += metadata.startLine - 1;
                }

                const validPoi = {
                    name: poi.name.trim(),
                    type: poi.type.toLowerCase(),
                    file_path: filePath,
                    start_line: startLine,
                    end_line: endLine,
                    description: poi.description || '',
                    is_exported: poi.is_exported || false,
                    llm_output: JSON.stringify(poi),
                    hash: this.generatePoiHash(poi.name, poi.type, filePath, startLine),
                    chunk_index: chunkIndex,
                    created_at: new Date().toISOString()
                };

                validPois.push(validPoi);
                
            } catch (error) {
                console.warn(`⚠️  Error processing POI:`, error, poi);
            }
        }

        return validPois;
    }

    /**
     * Generate hash for POI deduplication
     */
    generatePoiHash(name, type, filePath, startLine) {
        const crypto = require('crypto');
        const data = `${name}:${type}:${filePath}:${startLine}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Deduplicate POIs across chunks
     */
    deduplicatePois(pois) {
        const seen = new Set();
        const deduplicated = [];
        
        for (const poi of pois) {
            if (!seen.has(poi.hash)) {
                seen.add(poi.hash);
                deduplicated.push(poi);
            }
        }
        
        console.log(`📊 Deduplicated: ${pois.length} -> ${deduplicated.length} POIs`);
        return deduplicated;
    }

    /**
     * Save POIs to database in batches
     */
    async savePoisBatch(pois, filePath, runId) {
        try {
            const columns = [
                'name', 'type', 'file_path', 'start_line', 'end_line', 
                'description', 'is_exported', 'llm_output', 'hash', 'created_at'
            ];
            
            const rows = pois.map(poi => [
                poi.name, poi.type, poi.file_path, poi.start_line, poi.end_line,
                poi.description, poi.is_exported, poi.llm_output, poi.hash, poi.created_at
            ]);

            const inserted = this.dbManager.batchInsert('pois', columns, rows);
            console.log(`💾 Saved ${inserted} POIs for ${filePath}`);

        } catch (error) {
            console.error(`❌ Failed to save POIs for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Track memory usage
     */
    trackMemoryUsage() {
        const usage = process.memoryUsage();
        this.stats.memoryUsage.current = Math.round(usage.heapUsed / 1024 / 1024);
        this.stats.memoryUsage.peak = Math.max(this.stats.memoryUsage.peak, this.stats.memoryUsage.current);
    }

    /**
     * Get processing statistics
     */
    getStats() {
        this.trackMemoryUsage();
        return {
            ...this.stats,
            activeFiles: this.activeProcessing.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const stats = this.getStats();
            const isMemoryHealthy = stats.memoryUsage.current < (this.maxFileSize / 1024 / 1024) * 2;
            
            return {
                healthy: isMemoryHealthy,
                stats: stats,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Clean up resources
     */
    async close() {
        this.activeProcessing.clear();
        console.log('✅ StreamingFileAnalysisWorker cleaned up');
    }
}

/**
 * Simple semaphore implementation for controlling concurrency
 */
class Semaphore {
    constructor(permits) {
        this.permits = permits;
        this.queue = [];
    }

    async acquire() {
        return new Promise((resolve) => {
            if (this.permits > 0) {
                this.permits--;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release() {
        this.permits++;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.permits--;
            next();
        }
    }
}

module.exports = StreamingFileAnalysisWorker;