const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('bullmq');
const LLMResponseSanitizer = require('../utils/LLMResponseSanitizer');
const { getTokenizer } = require('../utils/tokenizer');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');
const { getLogger } = require('../config/logging');
const SemanticIdentityService = require('../services/SemanticIdentityService');

const MAX_INPUT_TOKENS = 50000; // Leave a buffer for the prompt template
const MAX_INPUT_CHARS = 60000; // Character limit to stay well within DeepSeek's 64K token limit

class FileAnalysisWorker {
    constructor(queueManager, dbManager, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        this.directoryAggregationQueue = this.queueManager.getQueue('directory-aggregation-queue');
        this.tokenizer = getTokenizer();
        this.semanticIdentityService = new SemanticIdentityService();
        
        // Use centralized configuration
        this.config = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = this.config.getWorkerLimit('file-analysis');
        const apiRateLimit = this.config.performance.apiRateLimit;
        const highPerformanceMode = process.env.HIGH_PERFORMANCE_MODE === 'true';
        
        // Initialize logger
        this.logger = getLogger('FileAnalysisWorker');

        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with centralized configuration
                this.managedWorker = new ManagedWorker('file-analysis-queue', workerPoolManager, {
                    workerType: 'file-analysis',
                    baseConcurrency: Math.min(5, workerLimit), // Conservative starting point
                    maxConcurrency: workerLimit, // Use centralized limit
                    minConcurrency: 1,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: highPerformanceMode ? 100 : Math.floor(apiRateLimit / 2), // Higher in high perf mode
                    // rateLimitWindow: 1000,
                    failureThreshold: 10, // Increased from 3 to be less aggressive
                    resetTimeout: 90000,
                    // No jobTimeout - allow unlimited time for large files
                    retryAttempts: this.config.performance.apiRetryAttempts,
                    retryDelay: this.config.performance.apiRetryDelay,
                    ...options
                });
                
                this.logger.info('FileAnalysisWorker configured', {
                    maxConcurrency: workerLimit,
                    // Rate limiting removed - only global 100 agent limit matters
                    baseConcurrency: this.managedWorker.config.baseConcurrency
                });
                
                // Don't initialize here - let it be initialized explicitly
                this.logger.info('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker with centralized concurrency
                this.worker = new Worker('file-analysis-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: workerLimit // Use centralized config
                });
                
                this.logger.info('FileAnalysisWorker (basic) configured', {
                    concurrency: this.worker.opts.concurrency
                });
            }
        }
    }

    async initializeWorker() {
        try {
            await this.managedWorker.initialize(
                this.queueManager.connection,
                this.process.bind(this)
            );
            
            // Setup event handlers
            this.managedWorker.on('jobCompleted', (event) => {
                this.logger.info('Job completed', {
                    eventType: 'queue-event',
                    queueName: 'file-analysis-queue',
                    jobId: event.jobId,
                    processingTime: event.processingTime
                });
            });
            
            this.managedWorker.on('jobFailed', (event) => {
                this.logger.error('Job failed', {
                    error: event.error,
                    jobId: event.jobId,
                    queueName: 'file-analysis-queue'
                });
            });
            
            this.managedWorker.on('concurrencyChanged', (event) => {
                this.logger.info('Worker pool concurrency changed', {
                    eventType: 'worker-pool-event',
                    workerType: 'file-analysis',
                    newConcurrency: event.newConcurrency,
                    oldConcurrency: event.oldConcurrency,
                    reason: event.reason
                });
            });
            
        } catch (error) {
            this.logger.error('Failed to initialize FileAnalysisWorker', { error });
            throw error;
        }
    }

    async close() {
        if (this.managedWorker) {
            await this.managedWorker.shutdown();
        } else if (this.worker) {
            await this.worker.close();
        }
    }

    async process(job) {
        const { filePath, runId, jobId } = job.data;
        if (!filePath) {
            throw new Error(`[FileAnalysisWorker] Missing required 'filePath' in job data. JobId: ${job.id}, RunId: ${runId || 'undefined'}. Ensure EntityScout properly enqueues file analysis jobs with complete data.`);
        }
        
        // Create performance logger for this job  
        const { createPerformanceLogger } = require('../config/logging');
        const perfLogger = createPerformanceLogger(`file-analysis-${jobId || job.id}`, this.logger);
        perfLogger.start();
        
        this.logger.info('Processing file analysis job', {
            filePath,
            runId,
            jobId: job.id
        });

        try {
            let content = await fs.readFile(filePath, 'utf-8');
            const charCount = content.length;
            
            // Validate file content
            const validationResult = this.validateFileContent(content, filePath);
            if (!validationResult.isValid) {
                this.logger.warn('File content validation failed', {
                    filePath,
                    reason: validationResult.reason,
                    runId
                });
                // Return empty POIs for invalid files
                await this.storeFindingsAndTriggerAggregation([], filePath, runId, jobId, perfLogger);
                perfLogger.end({ 
                    success: true, 
                    skipped: true, 
                    reason: validationResult.reason,
                    message: 'File skipped due to validation failure' 
                });
                return [];
            }

            // Use character-based chunking to stay within DeepSeek's limits
            if (charCount > MAX_INPUT_CHARS) {
                this.logger.warn('File exceeds character limit, truncating', {
                    filePath,
                    originalCharCount: charCount,
                    maxChars: MAX_INPUT_CHARS
                });
                // Truncate from the middle to preserve start and end
                const halfLimit = Math.floor(MAX_INPUT_CHARS / 2);
                const start = content.substring(0, halfLimit);
                const end = content.substring(content.length - halfLimit);
                content = `${start}\n\n... (content truncated) ...\n\n${end}`;
                
                // Log estimated tokens for monitoring
                const estimatedTokens = this.tokenizer(content);
                this.logger.info('Content truncated', {
                    truncatedLength: content.length,
                    estimatedTokens
                });
            }

            const prompt = this.constructPrompt(filePath, content);
            
            // Use WorkerPoolManager if available for intelligent retry and circuit breaking
            const apiStart = Date.now();
            const apiTimeout = 150000; // 2.5 minute timeout for LLM calls
            
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'file-analysis',
                    () => this.executeWithTimeout(this.llmClient.query(prompt), apiTimeout),
                    { filePath, contentLength: content.length }
                  )
                : await this.executeWithTimeout(this.llmClient.query(prompt), apiTimeout);
            perfLogger.checkpoint('llm-api-call', { 
                duration: Date.now() - apiStart,
                contentLength: content.length,
                promptTokens: this.tokenizer(prompt)
            });
            
            const pois = this.parseResponse(llmResponse, filePath);
            

            await this.storeFindingsAndTriggerAggregation(pois, filePath, runId, jobId, perfLogger);
            
            const metrics = perfLogger.end({
                poisCount: pois.length
            });
            
            // Log performance metrics
            this.logger.info('File analysis metrics', {
                duration: metrics.duration,
                memoryDelta: metrics.memoryDelta,
                poisCount: pois.length,
                fileSize: charCount
            });
            
            return pois;

        } catch (error) {
            perfLogger.end({ success: false, error: error.message });
            
            // Categorize errors for better handling
            const errorCategory = this.categorizeError(error);
            
            this.logger.error(`[FileAnalysisWorker] Failed to process file analysis for ${filePath}`, error, {
                filePath,
                runId,
                jobId: job.id,
                errorCategory,
                errorCode: error.code,
                statusCode: error.statusCode,
                attemptNumber: job.attemptsMade,
                fileSize: await this.getFileSizeInfo(filePath),
                action: this.getErrorActionSuggestion(errorCategory, error),
                stack: error.stack
            });
            
            // Add contextual information to error for better debugging
            error.context = {
                filePath,
                runId,
                jobId,
                workerType: 'file-analysis',
                errorCategory
            };
            
            // For certain error types, we might want to handle differently
            if (errorCategory === 'RATE_LIMIT') {
                // Add exponential backoff hint
                error.retryAfter = this.calculateRetryDelay(job.attemptsMade);
            } else if (errorCategory === 'INVALID_FILE') {
                // Don't retry invalid files
                error.noRetry = true;
            }
            
            throw error;
        }
    }
    
    /**
     * Execute operation with timeout to prevent hanging
     */
    async executeWithTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    }
    
    /**
     * Get file hash for caching
     */
    async getFileHash(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return `${stats.size}-${stats.mtimeMs.toString()}`;
        } catch (error) {
            return Date.now().toString(); // Fallback to timestamp
        }
    }
    
    /**
     * Store findings and trigger directory aggregation
     */
    async storeFindingsAndTriggerAggregation(pois, filePath, runId, jobId, logger = null) {
        const perfLogger = logger || this.logger;
        if (pois.length > 0) {
            const findingPayload = {
                type: 'file-analysis-finding',
                source: 'FileAnalysisWorker',
                jobId: jobId,
                runId: runId,
                filePath: filePath,
                pois: pois,
            };
            const dbStart = Date.now();
            const db = this.dbManager.getDb();
            const stmt = db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)');
            const result = stmt.run(runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
            const dbDuration = Date.now() - dbStart;
            
            this.logger.info('Database operation completed', {
                operation: 'INSERT',
                table: 'outbox',
                duration: dbDuration,
                changes: result.changes,
                runId,
                eventType: findingPayload.type
            });
        }

        // Trigger directory aggregation
        const directoryPath = path.dirname(filePath);
        const aggregationJob = await this.directoryAggregationQueue.add('aggregate-directory', {
            directoryPath,
            runId,
            fileJobId: jobId,
        });
        
        this.logger.info('Directory aggregation job enqueued', {
            directoryPath,
            aggregationJobId: aggregationJob.id,
            parentJobId: jobId
        });
    }
    constructPrompt(filePath, fileContent) {
        return `
            Analyze the code file at ${filePath} and extract all Points of Interest (POIs).
            POIs are strictly limited to: Class Definitions, Function Definitions, global/module-level Variable Declarations, and Imported modules.
            Respond with a single JSON object. The object must contain one key: "pois".
            The value of "pois" must be an array of POI objects.
            Each POI object must have the following keys: "name", "type", "start_line", "end_line", "description", "is_exported".
            
            Field requirements:
            - "name": The identifier name (string)
            - "type": Must be one of 'ClassDefinition', 'FunctionDefinition', 'VariableDeclaration', 'ImportStatement'
            - "start_line": Starting line number (integer)
            - "end_line": Ending line number (integer)  
            - "description": Brief semantic description of what this POI does or represents (string)
            - "is_exported": Whether this POI is exported/public from the module (boolean: true/false)
            
            Do not include any text, explanation, or markdown formatting before or after the JSON object.

            File Content:
            \`\`\`
            ${fileContent}
            \`\`\`
        `;
    }

    parseResponse(response, filePath) {
        try {
            const sanitized = LLMResponseSanitizer.sanitize(response);
            const parsed = JSON.parse(sanitized);
            const pois = parsed.pois || [];
            
            // Validate and clean POIs
            const validatedPois = [];
            
            pois.forEach(poi => {
                try {
                    // Validate required fields
                    if (!poi.name || typeof poi.name !== 'string') {
                        this.logger.warn('Invalid POI missing name, skipping', { poi });
                        return;
                    }
                    
                    if (!poi.type || typeof poi.type !== 'string') {
                        this.logger.warn('Invalid POI missing type, skipping', { poi });
                        return;
                    }

                    // Add unique ID if missing
                    if (!poi.id) {
                        poi.id = uuidv4();
                    }

                    // Validate and provide defaults for new required fields
                    let description = poi.description;
                    if (!description || typeof description !== 'string') {
                        description = poi.name; // Use name as fallback
                        this.logger.warn('POI missing description, using name as fallback', { 
                            poiName: poi.name 
                        });
                    }

                    let isExported = poi.is_exported;
                    if (typeof isExported !== 'boolean') {
                        isExported = false; // Default to false
                        if (isExported !== undefined) {
                            this.logger.warn('POI has invalid is_exported value, defaulting to false', { 
                                poiName: poi.name,
                                originalValue: isExported
                            });
                        }
                    }

                    // Create validated POI object with consistent snake_case field names
                    const validatedPoi = {
                        ...poi,
                        name: poi.name.trim(),
                        type: poi.type.toLowerCase(),
                        description: description.trim(),
                        is_exported: isExported,
                        start_line: poi.start_line || poi.startLine || 1,
                        end_line: poi.end_line || poi.endLine || (poi.start_line || poi.startLine || 1)
                    };
                    
                    // Remove any camelCase variants to avoid confusion
                    delete validatedPoi.startLine;
                    delete validatedPoi.endLine;
                    delete validatedPoi.isExported;

                    validatedPois.push(validatedPoi);
                } catch (error) {
                    this.logger.warn('Error validating POI, skipping', { 
                        error: error.message,
                        poi
                    });
                }
            });
            
            // Generate semantic IDs for all validated POIs
            const poisWithSemanticIds = this.semanticIdentityService.generateBatchSemanticIds(filePath, validatedPois);
            
            this.logger.info('Generated semantic IDs for POIs', {
                filePath,
                poisCount: poisWithSemanticIds.length,
                sampleSemanticIds: poisWithSemanticIds.slice(0, 3).map(p => p.semantic_id)
            });
            
            return poisWithSemanticIds;
        } catch (error) {
            this.logger.error(`[FileAnalysisWorker] Failed to parse LLM response for ${filePath}`, {
                error: error.message,
                errorType: error.name,
                filePath,
                responseLength: response?.length,
                responsePreview: response?.substring(0, 200),
                action: 'Check LLM response format. Expected JSON with "pois" array. Consider retry with adjusted prompt.',
                sanitizedResponse: response ? LLMResponseSanitizer.sanitize(response).substring(0, 200) : 'null'
            });
            return [];
        }
    }
    
    /**
     * Categorize errors for better handling and monitoring
     */
    categorizeError(error) {
        // Rate limiting errors
        if (error.statusCode === 429 || error.message?.includes('rate limit')) {
            return 'RATE_LIMIT';
        }
        
        // API errors
        if (error.statusCode >= 500 && error.statusCode < 600) {
            return 'API_SERVER_ERROR';
        }
        
        // File system errors
        if (error.code === 'ENOENT') {
            return 'FILE_NOT_FOUND';
        }
        
        if (error.code === 'EISDIR') {
            return 'INVALID_FILE';
        }
        
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return 'PERMISSION_DENIED';
        }
        
        // Network errors
        if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return 'NETWORK_ERROR';
        }
        
        // Parse errors
        if (error.message?.includes('JSON') || error.message?.includes('parse')) {
            return 'PARSE_ERROR';
        }
        
        // Token limit errors
        if (error.message?.includes('token') && error.message?.includes('limit')) {
            return 'TOKEN_LIMIT_EXCEEDED';
        }
        
        return 'UNKNOWN';
    }
    
    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(attemptNumber) {
        const baseDelay = 1000; // 1 second
        const maxDelay = 60000; // 60 seconds
        const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
        // Add jitter to prevent thundering herd
        return delay + Math.random() * 1000;
    }
    
    /**
     * Get file size information for error reporting
     */
    async getFileSizeInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return {
                bytes: stats.size,
                readable: this.formatBytes(stats.size)
            };
        } catch (error) {
            return { bytes: 0, readable: 'unknown', error: error.message };
        }
    }
    
    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Get actionable error suggestion based on error category
     */
    getErrorActionSuggestion(errorCategory, error) {
        const suggestions = {
            'RATE_LIMIT': `API rate limit hit. Retry after ${this.calculateRetryDelay(1)}ms. Consider reducing concurrency or implementing backoff.`,
            'API_SERVER_ERROR': 'LLM API server error. Check service status. Implement exponential backoff for retries.',
            'FILE_NOT_FOUND': `File not found at ${error.path || 'specified path'}. Verify file exists and path is correct.`,
            'INVALID_FILE': 'File is not a valid code file. Check file type and content. Consider adding to ignore patterns.',
            'PERMISSION_DENIED': `Permission denied accessing file. Check file permissions and process user rights.`,
            'NETWORK_ERROR': 'Network connection issue. Check internet connectivity and API endpoint accessibility.',
            'PARSE_ERROR': 'Failed to parse LLM response. Check response format and consider adjusting prompt for better JSON output.',
            'TOKEN_LIMIT_EXCEEDED': `File content exceeds token limit. Current limit: ${MAX_INPUT_TOKENS} tokens. Consider splitting large files.`,
            'UNKNOWN': 'Unknown error occurred. Check logs for details and consider adding specific error handling.'
        };
        
        return suggestions[errorCategory] || suggestions['UNKNOWN'];
    }
    
    /**
     * Validate file content before processing
     */
    validateFileContent(content, filePath) {
        // Check if file is empty
        if (!content || content.trim().length === 0) {
            return { isValid: false, reason: 'EMPTY_FILE' };
        }
        
        // Check if file is binary (high percentage of non-printable characters)
        const nonPrintableCount = (content.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g) || []).length;
        const binaryThreshold = 0.3; // 30% non-printable characters
        if (nonPrintableCount / content.length > binaryThreshold) {
            return { isValid: false, reason: 'BINARY_FILE' };
        }
        
        // Check for common non-code file patterns
        const firstLines = content.split('\n').slice(0, 5).join('\n').toLowerCase();
        
        // Git files
        if (firstLines.includes('[core]') && firstLines.includes('repositoryformatversion')) {
            return { isValid: false, reason: 'GIT_CONFIG_FILE' };
        }
        
        // Binary file indicators
        if (firstLines.includes('ÿþ') || firstLines.includes('þÿ') || firstLines.includes('\x00\x00')) {
            return { isValid: false, reason: 'BINARY_FILE_MARKER' };
        }
        
        // Check file extension again (in case EntityScout missed it)
        const ext = path.extname(filePath).toLowerCase();
        const nonCodeExtensions = [
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.zip', '.tar', '.gz', '.rar', '.7z',
            '.mp3', '.mp4', '.avi', '.mov', '.wmv',
            '.exe', '.dll', '.so', '.dylib',
            '.bin', '.dat', '.db', '.sqlite',
            '.lock', '.log', '.tmp', '.cache'
        ];
        
        if (nonCodeExtensions.includes(ext)) {
            return { isValid: false, reason: 'NON_CODE_FILE_EXTENSION' };
        }
        
        // Minified file check (single line with > 1000 chars often indicates minified code)
        const lines = content.split('\n');
        const hasVeryLongLines = lines.some(line => line.length > 1000);
        const isSingleLine = lines.length === 1 || lines.filter(l => l.trim()).length === 1;
        if (hasVeryLongLines && isSingleLine && ext === '.js') {
            return { isValid: false, reason: 'MINIFIED_FILE' };
        }
        
        return { isValid: true };
    }
}

module.exports = FileAnalysisWorker;