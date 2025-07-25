const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');
const ConfidenceScorer = require('../services/ConfidenceScorer');
const EnhancedPromptGenerator = require('../services/EnhancedPromptGenerator');
const ConfidenceMonitoringService = require('../services/ConfidenceMonitoringService');
const { RelationshipConfidence, ConfidenceEvidenceItem, EscalationTriggerConfig, EscalationTriggers } = require('../types/ConfidenceTypes');

class RelationshipResolutionWorker {
    constructor(queueManager, dbManager, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager;
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        
        // Initialize confidence scoring system
        this.confidenceScorer = new ConfidenceScorer(options.confidenceScorer);
        this.confidenceThreshold = options.confidenceThreshold || 0.5;
        this.enableConfidenceScoring = options.enableConfidenceScoring !== false; // Default to true
        
        // Initialize enhanced prompting for low-confidence relationships
        this.enhancedPromptGenerator = new EnhancedPromptGenerator(options.enhancedPrompting);
        this.individualAnalysisThreshold = options.individualAnalysisThreshold || 0.70;
        this.enableEnhancedPrompting = options.enableEnhancedPrompting !== false; // Default to true
        
        // Initialize confidence monitoring
        this.confidenceMonitor = new ConfidenceMonitoringService(options.confidenceMonitoring);
        this.enableMonitoring = options.enableMonitoring !== false; // Default to true
        
        // Configure escalation triggers
        this.escalationTriggers = this.initializeEscalationTriggers(options.escalationTriggers);
        
        // Get centralized configuration
        const pipelineConfig = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = pipelineConfig.getWorkerLimit('relationship-resolution');
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('relationship-resolution-queue', workerPoolManager, {
                    workerType: 'relationship-resolution',
                    baseConcurrency: Math.min(50, workerLimit), // Start with even more workers
                    maxConcurrency: workerLimit, // Use centralized limit (100)
                    minConcurrency: 1,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: Math.floor(workerLimit / 2), // Scale with concurrency
                    // rateLimitWindow: 1000,
                    failureThreshold: 10, // Increased from 3 to be less aggressive
                    resetTimeout: 90000,
                    jobTimeout: 120000, // 2 minutes for relationship resolution
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
                    concurrency: workerLimit // Use centralized config
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
            
            // Start confidence monitoring if enabled
            if (this.enableMonitoring) {
                this.confidenceMonitor.startMonitoring();
                console.log('✅ Confidence monitoring started');
            }
            
            console.log('✅ RelationshipResolutionWorker initialized with managed concurrency');
        } catch (error) {
            console.error('❌ Failed to initialize RelationshipResolutionWorker:', error);
            throw error;
        }
    }

    async close() {
        // Stop confidence monitoring
        if (this.enableMonitoring) {
            this.confidenceMonitor.stopMonitoring();
        }
        
        if (this.managedWorker) {
            await this.managedWorker.shutdown();
        } else if (this.worker) {
            await this.worker.close();
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

    async process(job) {
        const { filePath, poisBatch, allPois, primaryPoi, contextualPois, runId, jobId } = job.data;
        
        // Handle both old single-POI jobs and new batch jobs
        if (poisBatch) {
            console.log(`[RelationshipResolutionWorker] Processing batch job ${job.id} with ${poisBatch.length} POIs in file: ${filePath}`);
            return await this.processBatch(job);
        } else {
            console.log(`[RelationshipResolutionWorker] Processing single POI job ${job.id} for POI: ${primaryPoi.semantic_id || primaryPoi.id} in file: ${filePath}`);
            return await this.processSinglePoi(job);
        }
    }

    async processSinglePoi(job) {
        const { filePath, primaryPoi, contextualPois, runId, jobId } = job.data;

        if (!primaryPoi || !contextualPois) {
            const errorMsg = `[RelationshipResolutionWorker] Invalid single POI job data for job ${job.id}:`;
            const details = {
                jobId: job.id,
                runId,
                filePath,
                hasPrimaryPoi: !!primaryPoi,
                hasContextualPois: !!contextualPois,
                contextualPoisCount: contextualPois ? contextualPois.length : 0,
                action: 'Verify TransactionalOutboxPublisher is correctly creating relationship resolution jobs with complete POI data'
            };
            console.error(errorMsg, details);
            throw new Error(`${errorMsg} Missing ${!primaryPoi ? 'primaryPoi' : 'contextualPois'}. ${JSON.stringify(details)}`);
        }

        try {
            console.log(`[RelationshipResolutionWorker] Constructing prompt for ${filePath} POI ${primaryPoi.semantic_id || primaryPoi.id}`);
            const prompt = this.constructPrompt(filePath, primaryPoi, contextualPois);
            
            console.log(`[RelationshipResolutionWorker] Querying LLM for ${filePath} POI ${primaryPoi.semantic_id || primaryPoi.id}`);
            
            // Use WorkerPoolManager if available for intelligent retry and circuit breaking
            const apiTimeout = 150000; // 2.5 minute timeout for LLM calls
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'relationship-resolution',
                    () => this.executeWithTimeout(this.llmClient.query(prompt), apiTimeout),
                    { filePath, primaryPoiId: primaryPoi.semantic_id || primaryPoi.id, contextualPoisCount: contextualPois.length }
                  )
                : await this.executeWithTimeout(this.llmClient.query(prompt), apiTimeout);

            console.log(`[RelationshipResolutionWorker] Parsing LLM response for ${filePath} POI ${primaryPoi.semantic_id || primaryPoi.id}`);
            const relationships = this.parseResponse(llmResponse);

            // Apply confidence scoring to relationships
            const scoredRelationships = await this.applyConfidenceScoring(relationships, filePath, contextualPois, '', runId);

            if (scoredRelationships.length > 0) {
                const findingPayload = {
                    type: 'relationship-analysis-finding',
                    source: 'RelationshipResolutionWorker',
                    jobId: jobId,
                    runId: runId,
                    filePath: filePath,
                    relationships: scoredRelationships,
                };
                const db = this.dbManager.getDb();
                db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)')
                  .run(runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
                console.log(`[RelationshipResolutionWorker] Wrote ${scoredRelationships.length} relationships for POI ${primaryPoi.id} to outbox.`);
            }
        } catch (error) {
            const errorContext = {
                jobId: job.id,
                runId,
                filePath,
                primaryPoiId: primaryPoi.semantic_id || primaryPoi.id,
                primaryPoiName: primaryPoi.name,
                contextualPoisCount: contextualPois.length,
                errorType: error.name,
                errorCode: error.code,
                attemptNumber: job.attemptsMade,
                action: this.getErrorActionSuggestion(error)
            };
            
            console.error(`[RelationshipResolutionWorker] Failed to process relationships for POI '${primaryPoi.name}' in ${filePath}:`, {
                error: error.message,
                ...errorContext,
                stack: error.stack
            });
            
            const failedQueue = this.queueManager.getQueue('failed-jobs');
            await failedQueue.add('failed-relationship-resolution', {
                jobData: job.data,
                error: error.message,
                errorContext,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        }
    }

    async processBatch(job) {
        const { filePath, poisBatch, allPois, runId, jobId } = job.data;
        
        if (!poisBatch || !allPois) {
            const errorMsg = `[RelationshipResolutionWorker] Invalid batch job data for job ${job.id}:`;
            const details = {
                jobId: job.id,
                runId,
                filePath,
                hasPoisBatch: !!poisBatch,
                hasAllPois: !!allPois,
                batchSize: poisBatch ? poisBatch.length : 0,
                allPoisCount: allPois ? allPois.length : 0,
                action: 'Verify TransactionalOutboxPublisher is correctly creating batch relationship resolution jobs'
            };
            console.error(errorMsg, details);
            throw new Error(`${errorMsg} Missing ${!poisBatch ? 'poisBatch' : 'allPois'}. ${JSON.stringify(details)}`);
        }

        try {
            console.log(`[RelationshipResolutionWorker] Processing batch of ${poisBatch.length} POIs for ${filePath}`);
            
            // Process all POIs in the batch with a single LLM call
            const prompt = this.constructBatchPrompt(filePath, poisBatch, allPois);
            
            console.log(`[RelationshipResolutionWorker] Querying LLM for batch in ${filePath}`);
            
            // Use WorkerPoolManager if available for intelligent retry and circuit breaking
            const apiTimeout = 150000; // 2.5 minute timeout for LLM calls
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'relationship-resolution',
                    () => this.executeWithTimeout(this.llmClient.query(prompt), apiTimeout),
                    { filePath, batchSize: poisBatch.length, allPoisCount: allPois.length }
                  )
                : await this.executeWithTimeout(this.llmClient.query(prompt), apiTimeout);

            console.log(`[RelationshipResolutionWorker] Parsing LLM response for batch in ${filePath}`);
            const relationships = this.parseResponse(llmResponse);

            // Apply confidence scoring to batch relationships
            const scoredRelationships = await this.applyConfidenceScoring(relationships, filePath, poisBatch, '', runId);

            if (scoredRelationships.length > 0) {
                const findingPayload = {
                    type: 'relationship-analysis-finding',
                    source: 'RelationshipResolutionWorker',
                    jobId: jobId,
                    runId: runId,
                    filePath: filePath,
                    relationships: scoredRelationships,
                };
                const db = this.dbManager.getDb();
                db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)')
                  .run(runId, findingPayload.type, JSON.stringify(findingPayload), 'PENDING');
                console.log(`[RelationshipResolutionWorker] Wrote ${scoredRelationships.length} relationships for batch in ${filePath} to outbox.`);
            }
        } catch (error) {
            const errorContext = {
                jobId: job.id,
                runId,
                filePath,
                batchSize: poisBatch.length,
                allPoisCount: allPois.length,
                errorType: error.name,
                errorCode: error.code,
                attemptNumber: job.attemptsMade,
                action: this.getErrorActionSuggestion(error)
            };
            
            console.error(`[RelationshipResolutionWorker] Failed to process batch relationships in ${filePath}:`, {
                error: error.message,
                ...errorContext,
                stack: error.stack
            });
            
            const failedQueue = this.queueManager.getQueue('failed-jobs');
            await failedQueue.add('failed-relationship-resolution', {
                jobData: job.data,
                error: error.message,
                errorContext,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        }
    }

    constructPrompt(filePath, primaryPoi, contextualPois) {
        // Use semantic IDs for better cognitive reasoning - NEVER expose numeric IDs
        const primarySemanticId = primaryPoi.semantic_id;
        if (!primarySemanticId) {
            throw new Error(`[RelationshipResolutionWorker] Primary POI missing semantic_id: ${JSON.stringify(primaryPoi)}`);
        }
        
        const contextualPoiList = contextualPois.map(p => {
            if (!p.semantic_id) {
                console.warn(`[RelationshipResolutionWorker] Contextual POI missing semantic_id, skipping: ${JSON.stringify(p)}`);
                return null;
            }
            return `- ${p.type}: ${p.name} (semantic_id: ${p.semantic_id})`;
        }).filter(Boolean).join('\n');

        return `
            Analyze the primary Point of Interest (POI) from the file "${filePath}" to identify its relationships WITH the contextual POIs from the same file.

            Primary POI:
            - ${primaryPoi.type}: ${primaryPoi.name} (semantic_id: ${primarySemanticId})

            Contextual POIs:
            ${contextualPoiList}

            Identify relationships where the Primary POI is the source (e.g., it "calls" or "uses" a contextual POI).
            Use the semantic identifiers to understand the context and meaning of each POI when analyzing relationships.
            
            CRITICAL: You MUST use the semantic_id values (like "auth_func_validate" or "cfg_var_database_url"), NOT numeric IDs (like "1594" or "1568").
            
            Format the output as a JSON object with a single key "relationships". This key should contain an array of objects where the "from" property is ALWAYS "${primarySemanticId}".
            Each relationship object must have the following keys: "id", "from", "to", "type", "reason", "confidence".
            The "id" must be a unique UUID.
            The "from" value must be the primary POI's semantic_id: "${primarySemanticId}" (NOT a number!)
            The "to" value must be the contextual POI's semantic_id from the list above (NOT a number!)
            The "confidence" must be a float between 0.0 and 1.0 indicating how certain you are about this relationship.

            Example:
            {
              "relationships": [
                {
                  "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
                  "from": "${primarySemanticId}",
                  "to": "auth_func_validate_credentials",
                  "type": "CALLS",
                  "reason": "Function '${primaryPoi.name}' calls function 'validateCredentials' on line 42.",
                  "confidence": 0.9
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
            const relationships = parsed.relationships || [];
            
            // Validate and clean relationships
            const validatedRelationships = [];
            
            for (const rel of relationships) {
                try {
                    // Validate required fields
                    if (!rel.from || !rel.to) {
                        console.warn('[RelationshipResolutionWorker] Invalid relationship missing from/to fields, skipping:', rel);
                        continue;
                    }
                    
                    if (!rel.type || typeof rel.type !== 'string') {
                        console.warn('[RelationshipResolutionWorker] Invalid relationship missing type, skipping:', rel);
                        continue;
                    }

                    // Validate and provide defaults for new required fields
                    let confidence = rel.confidence;
                    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
                        confidence = 0.8; // Default confidence
                        if (rel.confidence !== undefined) {
                            console.warn(`[RelationshipResolutionWorker] Invalid confidence ${rel.confidence} for relationship ${rel.from} -> ${rel.to}, using default 0.8`);
                        }
                    }

                    let reason = rel.reason || rel.evidence;
                    if (!reason || typeof reason !== 'string') {
                        reason = `${rel.type} relationship detected`; // Default reason
                        if (rel.reason !== undefined || rel.evidence !== undefined) {
                            console.warn(`[RelationshipResolutionWorker] Invalid reason/evidence for relationship ${rel.from} -> ${rel.to}, using default`);
                        }
                    }

                    // Create validated relationship object
                    validatedRelationships.push({
                        id: rel.id,
                        from: rel.from,
                        to: rel.to,
                        type: rel.type.toUpperCase(),
                        confidence: confidence,
                        reason: reason.trim(),
                        evidence: rel.evidence || reason.trim()
                    });
                } catch (error) {
                    console.error('[RelationshipResolutionWorker] Error validating relationship:', error, rel);
                }
            }
            
            return validatedRelationships;
        } catch (error) {
            console.error(`[RelationshipResolutionWorker] Failed to parse LLM response for relationship analysis:`, {
                error: error.message,
                errorType: error.name,
                filePath: this.currentJobPath,
                responseLength: response?.length,
                responsePreview: response?.substring(0, 200),
                action: 'Check LLM response format. Expected JSON with "relationships" array. Consider adjusting prompt.'
            });
            return [];
        }
    }

    constructBatchPrompt(filePath, poisBatch, allPois) {
        const batchSemanticIds = poisBatch.map(poi => {
            if (!poi.semantic_id) {
                console.warn(`[RelationshipResolutionWorker] POI in batch missing semantic_id, skipping: ${JSON.stringify(poi)}`);
                return null;
            }
            return `- ${poi.type}: ${poi.name} (semantic_id: ${poi.semantic_id})`;
        }).filter(Boolean).join('\n');

        const allPoiList = allPois.map(p => {
            if (!p.semantic_id) return null;
            return `- ${p.type}: ${p.name} (semantic_id: ${p.semantic_id})`;
        }).filter(Boolean).join('\n');

        return `
            Analyze the batch of Points of Interest (POIs) from the file "${filePath}" to identify their relationships WITH other POIs from the same file.

            POIs to analyze (find relationships FROM these POIs):
            ${batchSemanticIds}

            All available POIs in file (potential relationship targets):
            ${allPoiList}

            For each POI in the batch, identify relationships where that POI is the source (e.g., it "calls" or "uses" another POI).
            Use the semantic identifiers to understand the context and meaning of each POI when analyzing relationships.
            
            CRITICAL: You MUST use the semantic_id values (like "auth_func_validate" or "cfg_var_database_url"), NOT numeric IDs.
            
            Format the output as a JSON object with a single key "relationships". This should contain an array of relationship objects.
            Each relationship object must have the following keys: "id", "from", "to", "type", "reason", "confidence".
            The "id" must be a unique UUID.
            The "from" value must be the source POI's semantic_id from the batch above
            The "to" value must be the target POI's semantic_id from the available POIs list
            The "confidence" must be a float between 0.0 and 1.0 indicating how certain you are about this relationship.

            Example:
            {
              "relationships": [
                {
                  "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
                  "from": "auth_func_validatecredentials",
                  "to": "database_func_getuserbyemail",
                  "type": "CALLS",
                  "reason": "Function 'validateCredentials' calls function 'getUserByEmail' to verify user exists.",
                  "confidence": 0.9
                }
              ]
            }

            If no relationships are found, return an empty array.
        `;
    }
    
    /**
     * Get actionable error suggestion based on error type
     */
    getErrorActionSuggestion(error) {
        if (error.statusCode === 429 || error.message?.includes('rate limit')) {
            return 'API rate limit hit. Reduce concurrency or implement exponential backoff.';
        }
        if (error.statusCode >= 500) {
            return 'LLM API server error. Check service status and retry with backoff.';
        }
        if (error.message?.includes('JSON') || error.message?.includes('parse')) {
            return 'Invalid JSON in LLM response. Review prompt format and response sanitization.';
        }
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            return 'Network timeout. Check connection stability and consider increasing timeout.';
        }
        if (error.message?.includes('token')) {
            return 'Token limit issue. Reduce context size or number of contextual POIs.';
        }
        return 'Review error details and check system logs for more information.';
    }

    /**
     * Initialize escalation triggers configuration
     */
    initializeEscalationTriggers(customTriggers = []) {
        const defaultTriggers = [
            new EscalationTriggerConfig({
                triggerType: EscalationTriggers.LOW_CONFIDENCE,
                threshold: 0.5,
                enabled: true,
                priority: 'HIGH',
                action: 'QUEUE_FOR_REVIEW'
            }),
            new EscalationTriggerConfig({
                triggerType: EscalationTriggers.HIGH_UNCERTAINTY,
                threshold: 0.6,
                enabled: true,
                priority: 'MEDIUM',
                action: 'FLAG_FOR_VALIDATION'
            }),
            new EscalationTriggerConfig({
                triggerType: EscalationTriggers.CONFLICTING_EVIDENCE,
                threshold: 0.7,
                enabled: true,
                priority: 'HIGH',
                action: 'MANUAL_REVIEW'
            })
        ];

        // Merge with custom triggers
        const allTriggers = [...defaultTriggers, ...customTriggers];
        console.log(`[RelationshipResolutionWorker] Initialized ${allTriggers.length} escalation triggers`);
        
        return allTriggers;
    }

    /**
     * Apply confidence scoring to parsed relationships with enhanced analysis
     */
    async applyConfidenceScoring(relationships, filePath, contextualPois = [], sourceCode = '', runId = null) {
        if (!this.enableConfidenceScoring || !relationships || relationships.length === 0) {
            console.log(`[RelationshipResolutionWorker] Confidence scoring disabled or no relationships to score`);
            return relationships;
        }

        console.log(`[RelationshipResolutionWorker] Applying confidence scoring to ${relationships.length} relationships in ${filePath}`);
        
        const scoredRelationships = [];
        const escalatedRelationships = [];
        const lowConfidenceRelationships = [];

        for (const relationship of relationships) {
            const startTime = Date.now();
            let confidenceResult = null;
            let scoredRelationship = null;
            
            try {
                // Create evidence items from relationship data
                const evidenceItems = this.createEvidenceItems(relationship, filePath);
                
                // Calculate initial confidence score
                confidenceResult = this.confidenceScorer.calculateConfidence(relationship, evidenceItems);
                
                // Create enhanced relationship with confidence data
                scoredRelationship = {
                    ...relationship,
                    confidence: confidenceResult.finalConfidence,
                    confidenceLevel: confidenceResult.confidenceLevel,
                    confidenceBreakdown: confidenceResult.breakdown,
                    scoringMetadata: {
                        scoreId: confidenceResult.scoreId,
                        scorerVersion: confidenceResult.scorerVersion,
                        timestamp: confidenceResult.timestamp
                    }
                };

                // Check if enhanced analysis is needed for low-confidence relationships
                if (this.enableEnhancedPrompting && 
                    confidenceResult.finalConfidence < this.individualAnalysisThreshold &&
                    confidenceResult.finalConfidence >= this.confidenceThreshold) {
                    
                    console.log(`[RelationshipResolutionWorker] Triggering enhanced analysis for low-confidence relationship: ${relationship.from} -> ${relationship.to} (confidence: ${confidenceResult.finalConfidence.toFixed(3)})`);
                    
                    const enhancedResult = await this.performEnhancedAnalysis(
                        relationship, 
                        confidenceResult, 
                        filePath, 
                        contextualPois, 
                        sourceCode
                    );
                    
                    if (enhancedResult) {
                        scoredRelationship = enhancedResult.relationship;
                        confidenceResult = enhancedResult.confidenceResult;
                        
                        // Record enhancement metrics
                        if (this.enableMonitoring) {
                            this.confidenceMonitor.recordEnhancedAnalysisEvent({
                                filePath,
                                relationshipId: relationship.id,
                                originalScore: relationship.confidence || 0.8,
                                enhancedScore: enhancedResult.relationship.confidence,
                                confidenceLevel: enhancedResult.relationship.confidenceLevel,
                                focusArea: enhancedResult.focusArea,
                                processingTimeMs: Date.now() - startTime,
                                factorScores: enhancedResult.confidenceResult.breakdown.factorScores
                            });
                        }
                    }
                }

                // Check for escalation triggers
                const triggeredEscalations = this.checkEscalationTriggers(confidenceResult);
                if (triggeredEscalations.length > 0) {
                    scoredRelationship.escalationTriggers = triggeredEscalations;
                    escalatedRelationships.push({
                        relationship: scoredRelationship,
                        confidenceResult,
                        triggers: triggeredEscalations
                    });
                }

                // Record monitoring event
                if (this.enableMonitoring) {
                    this.confidenceMonitor.recordConfidenceEvent({
                        filePath,
                        relationshipId: relationship.id,
                        confidenceScore: scoredRelationship.confidence,
                        confidenceLevel: scoredRelationship.confidenceLevel,
                        factorScores: confidenceResult.breakdown.factorScores,
                        escalated: triggeredEscalations.length > 0,
                        processingTimeMs: Date.now() - startTime,
                        enhancedAnalysis: scoredRelationship.enhancedAnalysis || false
                    });
                }

                // Only include relationships above confidence threshold
                if (confidenceResult.finalConfidence >= this.confidenceThreshold) {
                    scoredRelationships.push(scoredRelationship);
                } else {
                    console.log(`[RelationshipResolutionWorker] Filtered out low-confidence relationship: ${relationship.from} -> ${relationship.to} (confidence: ${confidenceResult.finalConfidence.toFixed(3)})`);
                    lowConfidenceRelationships.push({
                        relationship: scoredRelationship,
                        confidenceResult
                    });
                }

            } catch (error) {
                console.error(`[RelationshipResolutionWorker] Error scoring relationship ${relationship.from} -> ${relationship.to}:`, error);
                
                // Record error in monitoring
                if (this.enableMonitoring) {
                    this.confidenceMonitor.recordConfidenceEvent({
                        filePath,
                        relationshipId: relationship.id,
                        confidenceScore: 0.1,
                        confidenceLevel: 'ERROR',
                        factorScores: { syntax: 0, semantic: 0, context: 0, crossRef: 0 },
                        escalated: true,
                        processingTimeMs: Date.now() - startTime,
                        errors: [error.message]
                    });
                }
                
                // Include relationship with error confidence
                scoredRelationships.push({
                    ...relationship,
                    confidence: 0.1,
                    confidenceLevel: 'ERROR',
                    confidenceError: error.message
                });
            }
        }

        // Handle escalated relationships
        if (escalatedRelationships.length > 0) {
            await this.handleEscalatedRelationships(escalatedRelationships, filePath, runId);
        }

        console.log(`[RelationshipResolutionWorker] Confidence scoring complete: ${scoredRelationships.length}/${relationships.length} relationships passed threshold, ${escalatedRelationships.length} escalated, ${lowConfidenceRelationships.length} filtered out`);
        
        return scoredRelationships;
    }

    /**
     * Create evidence items from relationship data
     */
    createEvidenceItems(relationship, filePath) {
        const evidenceItems = [];

        // Add primary evidence from relationship reason/evidence
        if (relationship.reason) {
            evidenceItems.push(new ConfidenceEvidenceItem({
                evidenceId: uuidv4(),
                type: 'LLM_REASONING',
                text: relationship.reason,
                source: 'RelationshipResolutionWorker',
                confidence: relationship.confidence || 0.8,
                context: { filePath, relationshipType: relationship.type }
            }));
        }

        if (relationship.evidence && relationship.evidence !== relationship.reason) {
            evidenceItems.push(new ConfidenceEvidenceItem({
                evidenceId: uuidv4(),
                type: 'LLM_EVIDENCE',
                text: relationship.evidence,
                source: 'RelationshipResolutionWorker',
                confidence: relationship.confidence || 0.8,
                context: { filePath, relationshipType: relationship.type }
            }));
        }

        // Add contextual evidence based on semantic IDs
        const contextualEvidence = this.extractContextualEvidence(relationship, filePath);
        evidenceItems.push(...contextualEvidence);

        return evidenceItems;
    }

    /**
     * Extract contextual evidence from semantic IDs and file context
     */
    extractContextualEvidence(relationship, filePath) {
        const evidenceItems = [];

        // Analyze semantic ID patterns
        const fromParts = relationship.from.split('_');
        const toParts = relationship.to.split('_');

        if (fromParts.length > 1 && toParts.length > 1) {
            // Same domain evidence
            if (fromParts[0] === toParts[0]) {
                evidenceItems.push(new ConfidenceEvidenceItem({
                    evidenceId: uuidv4(),
                    type: 'SEMANTIC_DOMAIN',
                    text: `Both entities share domain prefix: ${fromParts[0]}`,
                    source: 'SemanticAnalysis',
                    confidence: 0.7,
                    context: { domain: fromParts[0], filePath }
                }));
            }

            // Function type evidence
            if (fromParts.includes('func') && toParts.includes('func')) {
                evidenceItems.push(new ConfidenceEvidenceItem({
                    evidenceId: uuidv4(),
                    type: 'ENTITY_TYPE',
                    text: 'Both entities are functions',
                    source: 'TypeAnalysis',
                    confidence: 0.6,
                    context: { entityType: 'function', filePath }
                }));
            }
        }

        return evidenceItems;
    }

    /**
     * Check escalation triggers against confidence result
     */
    checkEscalationTriggers(confidenceResult) {
        const triggeredEscalations = [];

        for (const trigger of this.escalationTriggers) {
            if (trigger.isTriggered(confidenceResult)) {
                triggeredEscalations.push({
                    triggerType: trigger.triggerType,
                    threshold: trigger.threshold,
                    priority: trigger.priority,
                    action: trigger.action,
                    triggeredAt: new Date().toISOString(),
                    metadata: trigger.metadata
                });

                console.log(`[RelationshipResolutionWorker] Escalation trigger activated: ${trigger.triggerType} (threshold: ${trigger.threshold}, confidence: ${confidenceResult.finalConfidence.toFixed(3)})`);
            }
        }

        return triggeredEscalations;
    }

    /**
     * Handle escalated relationships by queuing them for review
     */
    async handleEscalatedRelationships(escalatedRelationships, filePath, runId = null) {
        console.log(`[RelationshipResolutionWorker] Handling ${escalatedRelationships.length} escalated relationships from ${filePath}`);

        try {
            for (const escalated of escalatedRelationships) {
                const escalationPayload = {
                    type: 'relationship-confidence-escalation',
                    source: 'RelationshipResolutionWorker',
                    filePath: filePath,
                    relationship: escalated.relationship,
                    confidenceResult: escalated.confidenceResult,
                    triggers: escalated.triggers,
                    timestamp: new Date().toISOString()
                };

                // Store escalation in outbox for processing
                const db = this.dbManager.getDb();
                db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)')
                  .run(runId, escalationPayload.type, JSON.stringify(escalationPayload), 'PENDING');

                console.log(`[RelationshipResolutionWorker] Escalated relationship ${escalated.relationship.from} -> ${escalated.relationship.to} for review`);
            }
        } catch (error) {
            console.error('[RelationshipResolutionWorker] Error handling escalated relationships:', error);
        }
    }

    /**
     * Perform enhanced analysis for low-confidence relationships
     */
    async performEnhancedAnalysis(relationship, confidenceResult, filePath, contextualPois = [], sourceCode = '') {
        try {
            console.log(`[RelationshipResolutionWorker] Starting enhanced analysis for ${relationship.from} -> ${relationship.to}`);
            
            // Generate enhanced prompt based on confidence factors
            const enhancedPromptData = this.enhancedPromptGenerator.generateEnhancedPrompt(
                relationship,
                confidenceResult, 
                filePath,
                contextualPois,
                sourceCode
            );

            console.log(`[RelationshipResolutionWorker] Generated ${enhancedPromptData.focusArea}-focused prompt for enhanced analysis`);

            // Query LLM with enhanced prompt
            const startTime = Date.now();
            const apiTimeout = 150000; // 2.5 minute timeout for LLM calls
            const llmResponse = this.workerPoolManager
                ? await this.workerPoolManager.executeWithManagement(
                    'relationship-resolution',
                    () => this.executeWithTimeout(this.llmClient.query(enhancedPromptData.prompt), apiTimeout),
                    { 
                        filePath, 
                        relationshipId: relationship.id,
                        analysisType: 'enhanced',
                        focusArea: enhancedPromptData.focusArea
                    }
                  )
                : await this.executeWithTimeout(this.llmClient.query(enhancedPromptData.prompt), apiTimeout);
            
            const processingTime = Date.now() - startTime;

            // Parse enhanced response
            const enhancedRelationships = this.parseEnhancedResponse(llmResponse, enhancedPromptData);
            
            if (enhancedRelationships.length === 0) {
                console.log(`[RelationshipResolutionWorker] Enhanced analysis returned no valid relationships`);
                return null;
            }

            const enhancedRelationship = enhancedRelationships[0]; // Take the first (should be only one)

            // Re-calculate confidence with enhanced evidence
            const enhancedEvidenceItems = this.createEvidenceItems(enhancedRelationship, filePath);
            const enhancedConfidenceResult = this.confidenceScorer.calculateConfidence(enhancedRelationship, enhancedEvidenceItems);

            // Create final enhanced relationship
            const finalRelationship = {
                ...enhancedRelationship,
                confidence: enhancedConfidenceResult.finalConfidence,
                confidenceLevel: enhancedConfidenceResult.confidenceLevel,
                confidenceBreakdown: enhancedConfidenceResult.breakdown,
                enhancedAnalysis: {
                    originalConfidence: confidenceResult.finalConfidence,
                    originalConfidenceLevel: confidenceResult.confidenceLevel,
                    focusArea: enhancedPromptData.focusArea,
                    promptId: enhancedPromptData.promptId,
                    processingTimeMs: processingTime,
                    improvement: enhancedConfidenceResult.finalConfidence - confidenceResult.finalConfidence,
                    enhancementTimestamp: new Date().toISOString()
                },
                scoringMetadata: {
                    scoreId: enhancedConfidenceResult.scoreId,
                    scorerVersion: enhancedConfidenceResult.scorerVersion,
                    timestamp: enhancedConfidenceResult.timestamp,
                    enhancedAnalysis: true
                }
            };

            console.log(`[RelationshipResolutionWorker] Enhanced analysis complete: ${relationship.from} -> ${relationship.to}, confidence improved from ${confidenceResult.finalConfidence.toFixed(3)} to ${enhancedConfidenceResult.finalConfidence.toFixed(3)}`);

            return {
                relationship: finalRelationship,
                confidenceResult: enhancedConfidenceResult,
                focusArea: enhancedPromptData.focusArea,
                originalConfidence: confidenceResult.finalConfidence
            };

        } catch (error) {
            console.error(`[RelationshipResolutionWorker] Error in enhanced analysis for ${relationship.from} -> ${relationship.to}:`, error);
            
            // Record enhanced analysis failure
            if (this.enableMonitoring) {
                this.confidenceMonitor.recordConfidenceEvent({
                    filePath,
                    relationshipId: relationship.id,
                    confidenceScore: confidenceResult.finalConfidence,
                    confidenceLevel: confidenceResult.confidenceLevel,
                    factorScores: confidenceResult.breakdown.factorScores,
                    escalated: true,
                    processingTimeMs: 0,
                    enhancedAnalysis: true,
                    errors: [`Enhanced analysis failed: ${error.message}`]
                });
            }
            
            return null;
        }
    }

    /**
     * Parse enhanced LLM response with specialized handling
     */
    parseEnhancedResponse(response, enhancedPromptData) {
        try {
            const sanitized = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(sanitized);
            
            // Handle different response formats based on analysis type
            let relationship = null;
            
            if (parsed.relationship) {
                relationship = parsed.relationship;
            } else if (parsed.relationships && parsed.relationships.length > 0) {
                relationship = parsed.relationships[0];
            } else {
                console.warn('[RelationshipResolutionWorker] Enhanced response missing relationship data');
                return [];
            }

            // Validate enhanced response structure
            if (!relationship.from || !relationship.to || !relationship.type) {
                console.warn('[RelationshipResolutionWorker] Invalid enhanced relationship structure:', relationship);
                return [];
            }

            // Add enhanced analysis metadata
            relationship.enhancedReasoning = parsed.enhanced_reasoning || '';
            relationship.analysisType = parsed.analysis_type || enhancedPromptData.focusArea;
            relationship.promptId = enhancedPromptData.promptId;

            // Include specialized analysis data based on focus area
            if (parsed.syntax_analysis) {
                relationship.syntaxAnalysis = parsed.syntax_analysis;
            }
            if (parsed.semantic_analysis) {
                relationship.semanticAnalysis = parsed.semantic_analysis;
            }
            if (parsed.context_analysis) {
                relationship.contextAnalysis = parsed.context_analysis;
            }
            if (parsed.crossref_analysis) {
                relationship.crossrefAnalysis = parsed.crossref_analysis;
            }
            if (parsed.comprehensive_analysis) {
                relationship.comprehensiveAnalysis = parsed.comprehensive_analysis;
            }

            return [relationship];

        } catch (error) {
            console.error('[RelationshipResolutionWorker] Failed to parse enhanced LLM response:', {
                error: error.message,
                promptId: enhancedPromptData.promptId,
                focusArea: enhancedPromptData.focusArea,
                responseLength: response?.length,
                responsePreview: response?.substring(0, 200)
            });
            return [];
        }
    }

    /**
     * Get monitoring dashboard data
     */
    getMonitoringDashboard() {
        if (!this.enableMonitoring) {
            return { error: 'Monitoring not enabled' };
        }
        
        return this.confidenceMonitor.getDashboardData();
    }

    /**
     * Subscribe to confidence alerts
     */
    subscribeToAlerts(callback) {
        if (this.enableMonitoring) {
            this.confidenceMonitor.subscribeToAlerts(callback);
        }
    }

    /**
     * Generate monitoring report
     */
    generateMonitoringReport() {
        if (!this.enableMonitoring) {
            return { error: 'Monitoring not enabled' };
        }
        
        return this.confidenceMonitor.generatePerformanceReport();
    }
}

module.exports = RelationshipResolutionWorker;