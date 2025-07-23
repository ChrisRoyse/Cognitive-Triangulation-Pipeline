const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const LLMResponseSanitizer = require('../utils/LLMResponseSanitizer');
const FileBatcher = require('../utils/fileBatcher');
const { getTokenizer } = require('../utils/tokenizer');

const MAX_INPUT_TOKENS = 50000;
const MAX_INPUT_CHARS = 60000;

/**
 * Enhanced File Analysis Worker with Batching Support
 * 
 * This is an enhanced version of the original FileAnalysisWorker that includes:
 * - Backward compatibility with existing functionality
 * - Automatic batching for small files (< 10KB)
 * - Optimized LLM API usage
 * - Comprehensive error handling and logging
 * 
 * To use this worker, simply replace FileAnalysisWorker imports with this class.
 * No other changes are required - the interface remains the same.
 */
class EnhancedFileAnalysisWorker {
    constructor(queueManager, dbManager, cacheClient, llmClient, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.cacheClient = cacheClient;
        this.llmClient = llmClient;
        this.directoryAggregationQueue = this.queueManager.getQueue('directory-aggregation-queue');
        this.tokenizer = getTokenizer();
        
        // Enable/disable batching (can be controlled via environment variable)
        this.batchingEnabled = options.enableBatching !== false && 
                              process.env.DISABLE_FILE_BATCHING !== 'true';
        
        if (this.batchingEnabled) {
            // Initialize FileBatcher
            this.fileBatcher = new FileBatcher({
                maxBatchChars: MAX_INPUT_CHARS,
                smallFileThreshold: parseInt(process.env.BATCH_FILE_SIZE_THRESHOLD) || 10240, // 10KB
                maxFilesPerBatch: parseInt(process.env.MAX_FILES_PER_BATCH) || 20
            });

            // Batch processing state
            this.pendingBatches = new Map();
            this.batchProcessingInterval = options.batchProcessingInterval || 5000; // 5 seconds
            
            console.log('[EnhancedFileAnalysisWorker] Batching enabled');
        } else {
            console.log('[EnhancedFileAnalysisWorker] Batching disabled - using legacy mode');
        }

        if (!options.processOnly) {
            this.worker = new Worker('file-analysis-queue', this.process.bind(this), {
                connection: this.queueManager.connection,
                concurrency: 100
            });

            // Start batch processor if batching is enabled
            if (this.batchingEnabled) {
                this.startBatchProcessor();
            }
        }

        // Statistics
        this.stats = {
            singleFiles: 0,
            batchedFiles: 0,
            batchesProcessed: 0,
            poisExtracted: 0,
            errors: 0,
            legacyMode: !this.batchingEnabled
        };
    }

    async close() {
        if (this.batchProcessorTimer) {
            clearInterval(this.batchProcessorTimer);
        }
        
        // Process any remaining batches
        if (this.batchingEnabled) {
            await this.processPendingBatches();
        }
        
        if (this.worker) {
            await this.worker.close();
        }
    }

    startBatchProcessor() {
        this.batchProcessorTimer = setInterval(
            () => this.processPendingBatches(),
            this.batchProcessingInterval
        );
    }

    /**
     * Main job processing method - handles both batched and individual processing
     */
    async process(job) {
        const { filePath, runId, jobId } = job.data;
        if (!filePath) {
            throw new Error("Cannot destructure property 'filePath' of 'job.data' as it is undefined.");
        }
        
        console.log(`[EnhancedFileAnalysisWorker] Processing job ${job.id} for file: ${filePath}`);

        try {
            if (this.batchingEnabled) {
                // Check if file should be batched
                const shouldBatch = await this.fileBatcher.shouldBatchFile(filePath);
                
                if (shouldBatch) {
                    // Add to pending batch
                    await this.addToPendingBatch(filePath, runId, jobId);
                    console.log(`[EnhancedFileAnalysisWorker] File ${filePath} added to batch queue`);
                    return;
                }
            }
            
            // Process file individually (large files or batching disabled)
            await this.processSingleFile(filePath, runId, jobId);
            this.stats.singleFiles++;

        } catch (error) {
            console.error(`[EnhancedFileAnalysisWorker] Error processing job ${job.id} for file ${filePath}:`, error);
            this.stats.errors++;
            throw error;
        }
    }

    /**
     * Add file to pending batch (only when batching is enabled)
     */
    async addToPendingBatch(filePath, runId, jobId) {
        if (!this.pendingBatches.has(runId)) {
            this.pendingBatches.set(runId, []);
        }
        
        this.pendingBatches.get(runId).push({
            filePath,
            runId,
            jobId,
            timestamp: Date.now()
        });

        // Check if we should process immediately (batch is full)
        const pendingFiles = this.pendingBatches.get(runId);
        if (pendingFiles.length >= this.fileBatcher.maxFilesPerBatch) {
            await this.processBatchForRun(runId);
        }
    }

    /**
     * Process all pending batches
     */
    async processPendingBatches() {
        if (!this.batchingEnabled || this.pendingBatches.size === 0) {
            return;
        }

        console.log(`[EnhancedFileAnalysisWorker] Processing ${this.pendingBatches.size} pending batch runs`);

        for (const [runId, files] of this.pendingBatches.entries()) {
            if (files.length > 0) {
                await this.processBatchForRun(runId);
            }
        }
    }

    /**
     * Process a batch for a specific run
     */
    async processBatchForRun(runId) {
        const pendingFiles = this.pendingBatches.get(runId) || [];
        if (pendingFiles.length === 0) {
            return;
        }

        // Clear the pending files for this run
        this.pendingBatches.set(runId, []);

        try {
            const filePaths = pendingFiles.map(f => f.filePath);
            console.log(`[EnhancedFileAnalysisWorker] Creating batches for ${filePaths.length} files in run ${runId}`);

            const batches = await this.fileBatcher.createBatches(filePaths);
            
            for (const batch of batches) {
                if (batch.isSingleLargeFile) {
                    const fileInfo = pendingFiles.find(f => f.filePath === batch.files[0].path);
                    await this.processSingleFile(fileInfo.filePath, fileInfo.runId, fileInfo.jobId);
                } else {
                    await this.processBatch(batch, pendingFiles, runId);
                }
            }

            this.stats.batchesProcessed += batches.length;

        } catch (error) {
            console.error(`[EnhancedFileAnalysisWorker] Error processing batch for run ${runId}:`, error);
            this.stats.errors++;
            
            // Fallback: process files individually
            for (const fileInfo of pendingFiles) {
                try {
                    await this.processSingleFile(fileInfo.filePath, fileInfo.runId, fileInfo.jobId);
                } catch (individualError) {
                    console.error(`[EnhancedFileAnalysisWorker] Error processing individual file ${fileInfo.filePath}:`, individualError);
                }
            }
        }
    }

    /**
     * Process a batch of files
     */
    async processBatch(batch, pendingFiles, runId) {
        try {
            console.log(`[EnhancedFileAnalysisWorker] Processing batch ${batch.id} with ${batch.files.length} files`);

            const prompt = this.fileBatcher.constructBatchPrompt(batch);
            const llmResponse = await this.llmClient.query(prompt);
            const fileResults = this.fileBatcher.parseBatchResponse(llmResponse, batch);
            
            for (const [filePath, pois] of Object.entries(fileResults)) {
                const fileInfo = pendingFiles.find(f => f.filePath === filePath);
                if (!fileInfo) {
                    console.warn(`[EnhancedFileAnalysisWorker] No file info found for ${filePath}`);
                    continue;
                }

                if (pois.length > 0) {
                    const findingPayload = {
                        type: 'file-analysis-finding',
                        source: 'EnhancedFileAnalysisWorker',
                        jobId: fileInfo.jobId,
                        runId: fileInfo.runId,
                        filePath: fileInfo.filePath,
                        pois: pois,
                        batchId: batch.id
                    };
                    
                    const db = this.dbManager.getDb();
                    const stmt = db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)');
                    stmt.run(fileInfo.runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
                    
                    this.stats.poisExtracted += pois.length;
                }

                const directoryPath = path.dirname(fileInfo.filePath);
                await this.directoryAggregationQueue.add('aggregate-directory', {
                    directoryPath,
                    runId: fileInfo.runId,
                    fileJobId: fileInfo.jobId,
                });

                this.stats.batchedFiles++;
            }

            console.log(`[EnhancedFileAnalysisWorker] Batch ${batch.id} processed successfully`);

        } catch (error) {
            console.error(`[EnhancedFileAnalysisWorker] Error processing batch ${batch.id}:`, error);
            throw error;
        }
    }

    /**
     * Process a single file (original FileAnalysisWorker logic)
     */
    async processSingleFile(filePath, runId, jobId) {
        try {
            let content = await fs.readFile(filePath, 'utf-8');
            const charCount = content.length;

            // Use character-based chunking to stay within DeepSeek's limits
            if (charCount > MAX_INPUT_CHARS) {
                console.warn(`[EnhancedFileAnalysisWorker] File ${filePath} exceeds character limit (${charCount} > ${MAX_INPUT_CHARS}). Truncating content.`);
                const halfLimit = Math.floor(MAX_INPUT_CHARS / 2);
                const start = content.substring(0, halfLimit);
                const end = content.substring(content.length - halfLimit);
                content = `${start}\n\n... (content truncated) ...\n\n${end}`;
                
                const estimatedTokens = this.tokenizer(content);
                console.log(`[EnhancedFileAnalysisWorker] Truncated content to ${content.length} chars (~${estimatedTokens} tokens)`);
            }

            const prompt = this.constructPrompt(filePath, content);
            const llmResponse = await this.llmClient.query(prompt);
            const pois = this.parseResponse(llmResponse);

            if (pois.length > 0) {
                const findingPayload = {
                    type: 'file-analysis-finding',
                    source: 'EnhancedFileAnalysisWorker',
                    jobId: jobId,
                    runId: runId,
                    filePath: filePath,
                    pois: pois,
                };
                const db = this.dbManager.getDb();
                const stmt = db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)');
                stmt.run(runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
                
                this.stats.poisExtracted += pois.length;
            }

            const directoryPath = path.dirname(filePath);
            await this.directoryAggregationQueue.add('aggregate-directory', {
                directoryPath,
                runId,
                fileJobId: jobId,
            });

        } catch (error) {
            console.error(`[EnhancedFileAnalysisWorker] Error processing single file ${filePath}:`, error);
            throw error;
        }
    }

    // Original FileAnalysisWorker methods (unchanged for compatibility)
    constructPrompt(filePath, fileContent) {
        return `
            Analyze the code file at ${filePath} and extract all Points of Interest (POIs).
            POIs are strictly limited to: Class Definitions, Function Definitions, global/module-level Variable Declarations, and Imported modules.
            Respond with a single JSON object. The object must contain one key: "pois".
            The value of "pois" must be an array of POI objects.
            Each POI object must have the following keys: "name", "type", "start_line", "end_line".
            The "type" must be one of: 'ClassDefinition', 'FunctionDefinition', 'VariableDeclaration', 'ImportStatement'.
            Do not include any text, explanation, or markdown formatting before or after the JSON object.

            File Content:
            \`\`\`
            ${fileContent}
            \`\`\`
        `;
    }

    parseResponse(response) {
        try {
            const sanitized = LLMResponseSanitizer.sanitize(response);
            const parsed = JSON.parse(sanitized);
            const pois = parsed.pois || [];
            pois.forEach(poi => {
                if (!poi.id) {
                    poi.id = uuidv4();
                }
            });
            return pois;
        } catch (error) {
            console.error('Failed to parse LLM response for file analysis:', error);
            console.error('Original response:', response);
            return [];
        }
    }

    /**
     * Get worker statistics
     */
    getStats() {
        const baseStats = {
            ...this.stats,
            pendingBatches: this.batchingEnabled ? this.pendingBatches.size : 0,
            pendingFiles: this.batchingEnabled ? 
                Array.from(this.pendingBatches.values()).reduce((sum, files) => sum + files.length, 0) : 0
        };

        if (this.batchingEnabled && this.fileBatcher) {
            baseStats.batcherStats = this.fileBatcher.getStats();
        }

        return baseStats;
    }
}

module.exports = EnhancedFileAnalysisWorker;