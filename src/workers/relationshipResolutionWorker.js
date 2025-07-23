const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const { ManagedWorker } = require('./ManagedWorker');

class RelationshipResolutionWorker {
    constructor(queueManager, dbManager, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('relationship-resolution-queue', workerPoolManager, {
                    workerType: 'relationship-resolution',
                    baseConcurrency: 2, // Conservative for LLM calls
                    maxConcurrency: 12,
                    minConcurrency: 1,
                    rateLimitRequests: 6, // Conservative for relationship analysis
                    rateLimitWindow: 1000,
                    failureThreshold: 3,
                    resetTimeout: 90000,
                    jobTimeout: 300000, // 5 minutes for relationship resolution
                    retryAttempts: 2,
                    retryDelay: 12000,
                    ...options
                });
                
                // Don't initialize here - let it be initialized explicitly
                console.log('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('relationship-resolution-queue', this.process.bind(this), {
                    connection: this.queueManager.connection,
                    concurrency: 2 // Reduced concurrency to avoid overwhelming the API
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
            
            console.log('✅ RelationshipResolutionWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize RelationshipResolutionWorker:', error);
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
        const { filePath, primaryPoi, contextualPois, runId, jobId } = job.data;
        console.log(`[RelationshipResolutionWorker] Processing job ${job.id} for POI: ${primaryPoi.id} in file: ${filePath}`);

        if (!primaryPoi || !contextualPois) {
            console.log(`[RelationshipResolutionWorker] Skipping job ${job.id}, missing primary or contextual POIs.`);
            return;
        }

        try {
            console.log(`[RelationshipResolutionWorker] Constructing prompt for ${filePath} POI ${primaryPoi.id}`);
            const prompt = this.constructPrompt(filePath, primaryPoi, contextualPois);
            
            console.log(`[RelationshipResolutionWorker] Querying LLM for ${filePath} POI ${primaryPoi.id}`);
            
            // Use WorkerPoolManager if available for intelligent retry and circuit breaking
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'relationship-resolution',
                    () => this.llmClient.query(prompt),
                    { filePath, primaryPoiId: primaryPoi.id, contextualPoisCount: contextualPois.length }
                  )
                : await this.llmClient.query(prompt);

            console.log(`[RelationshipResolutionWorker] Parsing LLM response for ${filePath} POI ${primaryPoi.id}`);
            const relationships = this.parseResponse(llmResponse);

            if (relationships.length > 0) {
                const findingPayload = {
                    type: 'relationship-analysis-finding',
                    source: 'RelationshipResolutionWorker',
                    jobId: jobId,
                    runId: runId,
                    filePath: filePath,
                    relationships: relationships,
                };
                const db = this.dbManager.getDb();
                db.prepare('INSERT INTO outbox (event_type, payload, status) VALUES (?, ?, ?)')
                  .run(findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
                console.log(`[RelationshipResolutionWorker] Wrote ${relationships.length} relationships for POI ${primaryPoi.id} to outbox.`);
            }
        } catch (error) {
            console.error(`[RelationshipResolutionWorker] FINAL ERROR processing job ${job.id} for POI ${primaryPoi.id}:`, error.message);
            const failedQueue = this.queueManager.getQueue('failed-jobs');
            await failedQueue.add('failed-relationship-resolution', {
                jobData: job.data,
                error: error.message,
                stack: error.stack,
            });
        }
    }

    constructPrompt(filePath, primaryPoi, contextualPois) {
        const contextualPoiList = contextualPois.map(p => `- ${p.type}: ${p.name} (id: ${p.id})`).join('\n');

        return `
            Analyze the primary Point of Interest (POI) from the file "${filePath}" to identify its relationships WITH the contextual POIs from the same file.

            Primary POI:
            - ${primaryPoi.type}: ${primaryPoi.name} (id: ${primaryPoi.id})

            Contextual POIs:
            ${contextualPoiList}

            Identify relationships where the Primary POI is the source (e.g., it "calls" or "uses" a contextual POI).
            Format the output as a JSON object with a single key "relationships". This key should contain an array of objects where the "from" property is ALWAYS "${primaryPoi.id}".
            Each relationship object must have the following keys: "id", "from", "to", "type", "evidence".
            The "id" must be a unique UUID.

            Example:
            {
              "relationships": [
                {
                  "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
                  "from": "${primaryPoi.id}",
                  "to": "contextual-poi-id-2",
                  "type": "CALLS",
                  "evidence": "Function '${primaryPoi.name}' calls function 'beta' on line 42."
                }
              ]
            }

            If no relationships are found, return an empty array.
        `;
    }

    parseResponse(response) {
        try {
            const sanitized = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(sanitized);
            return parsed.relationships || [];
        } catch (error) {
            console.error(`Failed to parse LLM response for relationship analysis in ${this.currentJobPath}:`, error);
            console.error('Original response:', response);
            return [];
        }
    }
}

module.exports = RelationshipResolutionWorker;