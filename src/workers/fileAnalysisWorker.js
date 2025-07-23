const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('bullmq');
const LLMResponseSanitizer = require('../utils/LLMResponseSanitizer');
const { getTokenizer } = require('../utils/tokenizer');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');
const { getLogger } = require('../config/logging');

const MAX_INPUT_TOKENS = 50000; // Leave a buffer for the prompt template
const MAX_INPUT_CHARS = 60000; // Character limit to stay well within DeepSeek's 64K token limit

class FileAnalysisWorker {
    constructor(queueManager, dbManager, cacheClient, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.cacheClient = cacheClient;
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        this.directoryAggregationQueue = this.queueManager.getQueue('directory-aggregation-queue');
        this.tokenizer = getTokenizer();
        
        // Use centralized configuration
        this.config = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = this.config.getWorkerLimit('file-analysis');
        const apiRateLimit = this.config.performance.apiRateLimit;
        
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
                    rateLimitRequests: Math.floor(apiRateLimit / 2), // Reserve half for file analysis
                    rateLimitWindow: 1000,
                    failureThreshold: 3,
                    resetTimeout: 90000,
                    jobTimeout: this.config.performance.maxExecutionTime / 10, // 10% of total time per file
                    retryAttempts: this.config.performance.apiRetryAttempts,
                    retryDelay: this.config.performance.apiRetryDelay,
                    ...options
                });
                
                this.logger.info('FileAnalysisWorker configured', {
                    maxConcurrency: workerLimit,
                    rateLimitRequests: this.managedWorker.options.rateLimitRequests,
                    baseConcurrency: this.managedWorker.options.baseConcurrency
                });
                
                // Initialize the managed worker
                this.initializeWorker();
            } else {
                // Fallback to basic worker with centralized concurrency
                this.worker = new Worker('file-analysis-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: options.concurrency || Math.min(3, workerLimit)
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
            throw new Error("Cannot destructure property 'filePath' of 'job.data' as it is undefined.");
        }
        
        // Create performance logger for this job
        const { createPerformanceLogger } = require('../config/logging');
        const perfLogger = createPerformanceLogger(`file-analysis-${jobId || job.id}`, this.logger);
        perfLogger.start();
        
        jobLogger.info('Processing file analysis job', {
            filePath,
            runId,
            jobId: job.id
        });

        try {
            // Check cache first to avoid redundant API calls
            const cacheTimer = jobLogger.startTimer('cache-check', jobId);
            const cacheKey = `file-analysis:${path.basename(filePath)}:${await this.getFileHash(filePath)}`;
            const cachedResult = await this.cacheClient.get(cacheKey);
            cacheTimer.end('Cache check completed');
            
            if (cachedResult) {
                jobLogger.info('Cache hit for file analysis', {
                    filePath,
                    cacheKey
                });
                const pois = JSON.parse(cachedResult);
                await this.storeFindingsAndTriggerAggregation(pois, filePath, runId, jobId, jobLogger);
                perfLogger.end({ cached: true, poisCount: pois.length, message: 'File analysis completed (cached)' });
                return pois;
            }
            let content = await fs.readFile(filePath, 'utf-8');
            const charCount = content.length;

            // Use character-based chunking to stay within DeepSeek's limits
            if (charCount > MAX_INPUT_CHARS) {
                jobLogger.warn('File exceeds character limit, truncating', {
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
                jobLogger.info('Content truncated', {
                    truncatedLength: content.length,
                    estimatedTokens
                });
            }

            const prompt = this.constructPrompt(filePath, content);
            
            // Use WorkerPoolManager if available for intelligent retry and circuit breaking
            const apiTimer = jobLogger.startTimer('llm-api-call', jobId);
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'file-analysis',
                    () => this.llmClient.query(prompt),
                    { filePath, contentLength: content.length }
                  )
                : await this.llmClient.query(prompt);
            const apiMetrics = apiTimer.end('LLM API call completed');
            
            jobLogger.logApiCall('POST', 'deepseek/analyze', 200, apiMetrics.duration, {
                contentLength: content.length,
                promptTokens: this.tokenizer(prompt)
            });
            
            const pois = this.parseResponse(llmResponse);
            
            // Cache successful results
            if (pois.length > 0) {
                await this.cacheClient.setex(cacheKey, 3600, JSON.stringify(pois)); // Cache for 1 hour
            }

            await this.storeFindingsAndTriggerAggregation(pois, filePath, runId, jobId, jobLogger);
            
            const metrics = perfLogger.end({
                poisCount: pois.length,
                cached: false
            });
            
            // Log performance metrics
            jobLogger.logMetrics({
                fileAnalysis: {
                    duration: metrics.duration,
                    memoryUsage: metrics.memoryUsage,
                    cpuUsage: metrics.cpuUsage,
                    poisCount: pois.length,
                    fileSize: charCount
                }
            });
            
            return pois;

        } catch (error) {
            perfLogger.end({ success: false, error: error.message });
            jobLogger.error('Error processing file analysis job', error, {
                filePath,
                runId,
                jobId: job.id
            });
            
            // Add contextual information to error for better debugging
            error.context = {
                filePath,
                runId,
                jobId,
                workerType: 'file-analysis'
            };
            
            throw error;
        }
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
        const jobLogger = logger || this.logger;
        if (pois.length > 0) {
            const findingPayload = {
                type: 'file-analysis-finding',
                source: 'FileAnalysisWorker',
                jobId: jobId,
                runId: runId,
                filePath: filePath,
                pois: pois,
            };
            const dbTimer = jobLogger.startTimer('database-insert', jobId);
            const db = this.dbManager.getDb();
            const stmt = db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)');
            const result = stmt.run(runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
            const dbMetrics = dbTimer.end('Database insert completed');
            
            jobLogger.logDatabaseOperation('INSERT', 'outbox', dbMetrics.duration, result.changes, {
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
        
        jobLogger.info('Directory aggregation job enqueued', {
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
            // Add a unique ID to each POI, as this is the contract expected by downstream workers.
            pois.forEach(poi => {
                if (!poi.id) {
                    poi.id = uuidv4();
                }
            });
            return pois;
        } catch (error) {
            this.logger.error('Failed to parse LLM response', {
                error,
                responseLength: response?.length,
                responsePreview: response?.substring(0, 200)
            });
            return [];
        }
    }
}

module.exports = FileAnalysisWorker;