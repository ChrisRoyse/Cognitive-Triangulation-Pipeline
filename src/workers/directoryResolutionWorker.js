const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const LLMResponseSanitizer = require('../utils/LLMResponseSanitizer');
const { ManagedWorker } = require('./ManagedWorker');

class DirectoryResolutionWorker {
    constructor(queueManager, dbManager, cacheClient, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager; // This is the *central* DB manager
        this.cacheClient = cacheClient;
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('directory-resolution-queue', workerPoolManager, {
                    workerType: 'directory-resolution',
                    baseConcurrency: 2, // Conservative for directory analysis
                    maxConcurrency: 8,
                    minConcurrency: 1,
                    rateLimitRequests: 6, // Conservative for LLM calls
                    rateLimitWindow: 1000,
                    failureThreshold: 3,
                    resetTimeout: 90000,
                    jobTimeout: 240000, // 4 minutes for directory analysis
                    retryAttempts: 2,
                    retryDelay: 15000,
                    ...options
                });
                
                // Initialize the managed worker
                this.initializeWorker();
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('directory-resolution-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: 2 // Lower concurrency for directory analysis
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
            
            console.log('✅ DirectoryResolutionWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize DirectoryResolutionWorker:', error);
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
        const { directoryPath, runId, jobId } = job.data;
        console.log(`[DirectoryResolutionWorker] Processing job ${job.id} for directory: ${directoryPath}`, { data: job.data });

        try {
            const fileContents = await this.getFileContents(directoryPath);
            const prompt = this.constructPrompt(directoryPath, fileContents);
            
            // Use WorkerPoolManager if available for intelligent retry and circuit breaking
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'directory-resolution',
                    () => this.llmClient.query(prompt),
                    { directoryPath, fileCount: fileContents.length }
                  )
                : await this.llmClient.query(prompt);
                
            const summary = this.parseResponse(llmResponse);

            const findingPayload = {
                type: 'directory-analysis-finding',
                source: 'DirectoryResolutionWorker',
                jobId: jobId,
                runId: runId,
                directoryPath: directoryPath,
                summary: summary,
            };

            const db = this.dbManager.getDb();
            const stmt = db.prepare(
                'INSERT INTO directory_summaries (run_id, directory_path, summary_text) VALUES (?, ?, ?)'
            );
            stmt.run(runId, directoryPath, summary);

            console.log(`[DirectoryResolutionWorker] Wrote finding for ${directoryPath} to outbox.`);
        } catch (error) {
            console.error(`[DirectoryResolutionWorker] Error processing job ${job.id} for directory ${directoryPath}:`, error);
            throw error;
        }
    }

    async getFileContents(directoryPath) {
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });
        const fileContents = [];
        for (const entry of entries) {
            if (entry.isFile()) {
                const fullPath = path.join(directoryPath, entry.name);
                const content = await fs.readFile(fullPath, 'utf-8');
                fileContents.push({
                    fileName: entry.name,
                    content: content.substring(0, 500) // Truncate for prompt
                });
            }
        }
        return fileContents;
    }
    constructPrompt(directoryPath, fileContents) {
        const fileSummaries = fileContents.map(f => `File: ${f.fileName}\n---\n${f.content}\n---\n`).join('\n');
        return `
            Analyze the files in the directory "${directoryPath}" and provide a concise summary of its purpose.
            Focus on the directory's overall responsibility and the roles of its key files.
            Respond with a single JSON object with one key: "summary".
            Do not include any text, explanation, or markdown formatting before or after the JSON object.

            ${fileSummaries}
        `;
    }

    parseResponse(response) {
        try {
            const sanitized = LLMResponseSanitizer.sanitize(response);
            const parsed = JSON.parse(sanitized);
            return parsed.summary || 'No summary available.';
        } catch (error) {
            console.error('Failed to parse LLM response for directory analysis:', error);
            console.error('Original response:', response);
            return 'Summary generation failed.';
        }
    }
}

module.exports = DirectoryResolutionWorker;