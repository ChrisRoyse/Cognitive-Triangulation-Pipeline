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
 * Batching File Analysis Worker
 * 
 * Enhanced version of FileAnalysisWorker that uses FileBatcher to:
 * - Group small files into batches for efficient LLM processing
 * - Maintain backward compatibility for large files
 * - Extract POIs per file from batch responses
 * - Provide comprehensive logging and error handling
 */
class BatchingFileAnalysisWorker {
    constructor(queueManager, dbManager, cacheClient, llmClient, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.cacheClient = cacheClient;
        this.llmClient = llmClient;
        this.directoryAggregationQueue = this.queueManager.getQueue('directory-aggregation-queue');
        this.tokenizer = getTokenizer();
        
        // Initialize FileBatcher
        this.fileBatcher = new FileBatcher({
            maxBatchChars: MAX_INPUT_CHARS,
            smallFileThreshold: 10240, // 10KB
            maxFilesPerBatch: 20
        });

        // Batch processing state
        this.pendingBatches = new Map(); // jobId -> batch files
        this.batchProcessingInterval = options.batchProcessingInterval || 5000; // 5 seconds
        
        if (!options.processOnly) {
            this.worker = new Worker('file-analysis-queue', this.process.bind(this), {
                connection: this.queueManager.connection,
                concurrency: 100
            });

            // Start batch processor
            this.startBatchProcessor();
        }

        // Statistics
        this.stats = {
            singleFiles: 0,
            batchedFiles: 0,
            batchesProcessed: 0,
            poisExtracted: 0,
            errors: 0
        };
    }

    async close() {
        if (this.batchProcessorTimer) {
            clearInterval(this.batchProcessorTimer);
        }
        
        // Process any remaining batches
        await this.processPendingBatches();
        
        if (this.worker) {
            await this.worker.close();
        }
    }

    /**
     * Start the batch processor timer
     */
    startBatchProcessor() {
        this.batchProcessorTimer = setInterval(
            () => this.processPendingBatches(),
            this.batchProcessingInterval
        );
    }

    /**
     * Main job processing method
     */
    async process(job) {
        const { filePath, runId, jobId } = job.data;
        if (!filePath) {
            throw new Error("Cannot destructure property 'filePath' of 'job.data' as it is undefined.");
        }
        
        console.log(`[BatchingFileAnalysisWorker] Processing job ${job.id} for file: ${filePath}`);

        try {
            // Check if file should be batched
            const shouldBatch = await this.fileBatcher.shouldBatchFile(filePath);
            
            if (shouldBatch) {
                // Add to pending batch
                await this.addToPendingBatch(filePath, runId, jobId);
                console.log(`[BatchingFileAnalysisWorker] File ${filePath} added to batch queue`);
            } else {
                // Process large file immediately (backward compatibility)
                await this.processSingleFile(filePath, runId, jobId);
                this.stats.singleFiles++;
            }

        } catch (error) {
            console.error(`[BatchingFileAnalysisWorker] Error processing job ${job.id} for file ${filePath}:`, error);
            this.stats.errors++;
            throw error;
        }
    }

    /**
     * Add file to pending batch
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
        if (this.pendingBatches.size === 0) {
            return;
        }

        console.log(`[BatchingFileAnalysisWorker] Processing ${this.pendingBatches.size} pending batch runs`);

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
            console.log(`[BatchingFileAnalysisWorker] Creating batches for ${filePaths.length} files in run ${runId}`);

            // Create batches
            const batches = await this.fileBatcher.createBatches(filePaths);
            
            // Process each batch
            for (const batch of batches) {
                if (batch.isSingleLargeFile) {
                    // Process large file individually
                    const fileInfo = pendingFiles.find(f => f.filePath === batch.files[0].path);
                    await this.processSingleFile(fileInfo.filePath, fileInfo.runId, fileInfo.jobId);
                } else {
                    // Process batch
                    await this.processBatch(batch, pendingFiles, runId);
                }
            }

            this.stats.batchesProcessed += batches.length;

        } catch (error) {
            console.error(`[BatchingFileAnalysisWorker] Error processing batch for run ${runId}:`, error);
            this.stats.errors++;
            
            // Fallback: process files individually
            for (const fileInfo of pendingFiles) {
                try {
                    await this.processSingleFile(fileInfo.filePath, fileInfo.runId, fileInfo.jobId);
                } catch (individualError) {
                    console.error(`[BatchingFileAnalysisWorker] Error processing individual file ${fileInfo.filePath}:`, individualError);
                }
            }
        }
    }

    /**
     * Process a batch of files
     */
    async processBatch(batch, pendingFiles, runId) {
        try {
            console.log(`[BatchingFileAnalysisWorker] Processing batch ${batch.id} with ${batch.files.length} files`);

            // Construct batch prompt
            const prompt = this.fileBatcher.constructBatchPrompt(batch);
            
            // Query LLM
            const llmResponse = await this.llmClient.query(prompt);
            
            // Parse response to get POIs per file
            const fileResults = this.fileBatcher.parseBatchResponse(llmResponse, batch);
            
            // Process results for each file
            for (const [filePath, pois] of Object.entries(fileResults)) {
                const fileInfo = pendingFiles.find(f => f.filePath === filePath);
                if (!fileInfo) {
                    console.warn(`[BatchingFileAnalysisWorker] No file info found for ${filePath}`);
                    continue;
                }

                if (pois.length > 0) {
                    // Save POIs to database
                    const findingPayload = {
                        type: 'file-analysis-finding',
                        source: 'BatchingFileAnalysisWorker',
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

                // Trigger directory aggregation
                const directoryPath = path.dirname(fileInfo.filePath);
                await this.directoryAggregationQueue.add('aggregate-directory', {
                    directoryPath,
                    runId: fileInfo.runId,
                    fileJobId: fileInfo.jobId,
                });

                this.stats.batchedFiles++;
            }

            console.log(`[BatchingFileAnalysisWorker] Batch ${batch.id} processed successfully`);

        } catch (error) {
            console.error(`[BatchingFileAnalysisWorker] Error processing batch ${batch.id}:`, error);
            throw error;
        }
    }

    /**
     * Process a single large file (backward compatibility)
     */
    async processSingleFile(filePath, runId, jobId) {
        try {
            let content = await fs.readFile(filePath, 'utf-8');
            const charCount = content.length;

            // Use character-based chunking to stay within limits
            if (charCount > MAX_INPUT_CHARS) {
                console.warn(`[BatchingFileAnalysisWorker] File ${filePath} exceeds character limit (${charCount} > ${MAX_INPUT_CHARS}). Truncating content.`);
                // Truncate from the middle to preserve start and end
                const halfLimit = Math.floor(MAX_INPUT_CHARS / 2);
                const start = content.substring(0, halfLimit);
                const end = content.substring(content.length - halfLimit);
                content = `${start}\n\n... (content truncated) ...\n\n${end}`;
                
                // Log estimated tokens for monitoring
                const estimatedTokens = this.tokenizer(content);
                console.log(`[BatchingFileAnalysisWorker] Truncated content to ${content.length} chars (~${estimatedTokens} tokens)`);
            }

            const prompt = this.constructSingleFilePrompt(filePath, content);
            const llmResponse = await this.llmClient.query(prompt);
            const pois = this.parseSingleFileResponse(llmResponse);

            if (pois.length > 0) {
                const findingPayload = {
                    type: 'file-analysis-finding',
                    source: 'BatchingFileAnalysisWorker',
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

            // Trigger directory aggregation
            const directoryPath = path.dirname(filePath);
            await this.directoryAggregationQueue.add('aggregate-directory', {
                directoryPath,
                runId,
                fileJobId: jobId,
            });

        } catch (error) {
            console.error(`[BatchingFileAnalysisWorker] Error processing single file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Construct prompt for single file (backward compatibility)
     */
    constructSingleFilePrompt(filePath, fileContent) {
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

    /**
     * Parse response for single file (backward compatibility)
     */
    parseSingleFileResponse(response) {
        try {
            const sanitized = LLMResponseSanitizer.sanitize(response);
            const parsed = JSON.parse(sanitized);
            const pois = parsed.pois || [];
            // Add a unique ID to each POI
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
        return {
            ...this.stats,
            batcherStats: this.fileBatcher.getStats(),
            pendingBatches: this.pendingBatches.size,
            pendingFiles: Array.from(this.pendingBatches.values()).reduce((sum, files) => sum + files.length, 0)
        };
    }
}

module.exports = BatchingFileAnalysisWorker;