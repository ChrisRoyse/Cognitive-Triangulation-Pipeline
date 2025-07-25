const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const LLMResponseSanitizer = require('../utils/LLMResponseSanitizer');
const { ManagedWorker } = require('./ManagedWorker');
const { PipelineConfig } = require('../config/pipelineConfig');

class DirectoryResolutionWorker {
    constructor(queueManager, dbManager, llmClient, workerPoolManager, options = {}) {
        this.queueManager = queueManager;
        this.dbManager = dbManager; // This is the *central* DB manager
        this.llmClient = llmClient;
        this.workerPoolManager = workerPoolManager;
        
        // Use centralized configuration
        this.config = options.pipelineConfig || PipelineConfig.createDefault();
        const workerLimit = this.config.getWorkerLimit('directory-resolution');
        
        if (!options.processOnly) {
            if (workerPoolManager) {
                // Create managed worker with intelligent concurrency control
                this.managedWorker = new ManagedWorker('directory-resolution-queue', workerPoolManager, {
                    workerType: 'directory-resolution',
                    baseConcurrency: Math.min(5, workerLimit), // Conservative for directory analysis
                    maxConcurrency: workerLimit,
                    minConcurrency: 1,
                    // Rate limiting removed - only global 100 agent limit matters
                    // rateLimitRequests: 6, // Conservative for LLM calls
                    // rateLimitWindow: 1000,
                    failureThreshold: 10, // Increased from 3 to be less aggressive
                    resetTimeout: 90000,
                    jobTimeout: 240000, // 4 minutes for directory analysis
                    retryAttempts: 2,
                    retryDelay: 15000,
                    ...options
                });
                
                // Don't initialize here - let it be initialized explicitly
                console.log('ManagedWorker created, awaiting initialization');
            } else {
                // Fallback to basic worker if no WorkerPoolManager
                this.worker = new Worker('directory-resolution-queue', this.process.bind(this), {
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

            // Write to outbox instead of directly to database to maintain event-sourcing pattern
            const db = this.dbManager.getDb();
            const stmt = db.prepare('INSERT INTO outbox (run_id, event_type, payload, status) VALUES (?, ?, ?, ?)');
            stmt.run(runId, 'directory-analysis-finding', JSON.stringify(findingPayload), 'PENDING');

            console.log(`[DirectoryResolutionWorker] Wrote directory analysis finding for ${directoryPath} to outbox.`);
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
                try {
                    const keyContent = await this.extractKeyContent(fullPath);
                    if (keyContent) {
                        fileContents.push({
                            fileName: entry.name,
                            content: keyContent
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to extract content from ${entry.name}:`, error.message);
                }
            }
        }
        return fileContents;
    }

    async extractKeyContent(filePath) {
        const fileName = path.basename(filePath);
        const ext = path.extname(fileName).toLowerCase();
        
        // Skip non-code files
        const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.rb', '.go', '.php', '.swift', '.kt', '.rs', '.scala', '.r', '.m', '.mm'];
        if (!codeExtensions.includes(ext)) {
            return null;
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        
        // If file is small enough, include it all (under 2000 chars)
        if (content.length < 2000) {
            return content;
        }

        const keyParts = [];
        
        // 1. Extract file header/comments (first 5 non-empty lines)
        const headerLines = [];
        for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i].trim();
            if (line && (line.startsWith('//') || line.startsWith('/*') || line.startsWith('#') || line.startsWith('"""') || line.startsWith("'''"))) {
                headerLines.push(lines[i]);
            }
        }
        if (headerLines.length > 0) {
            keyParts.push('// File header/documentation:');
            keyParts.push(...headerLines.slice(0, 5));
            keyParts.push('');
        }

        // 2. Extract imports/requires (max 15 lines)
        const imports = [];
        for (const line of lines) {
            if (imports.length >= 15) break;
            const trimmed = line.trim();
            if (trimmed.match(/^(import\s|from\s.*\simport|require\(|#include|using\s|package\s)/)) {
                imports.push(line);
            }
        }
        if (imports.length > 0) {
            keyParts.push('// Imports/Dependencies:');
            keyParts.push(...imports);
            keyParts.push('');
        }

        // 3. Extract class/function/interface definitions (max 20)
        const definitions = [];
        const definitionPatterns = [
            /^(export\s+)?(default\s+)?(async\s+)?(class|function|const|let|var|interface|type|enum|struct|def|public\s+class|private\s+class|protected\s+class)\s+(\w+)/,
            /^(module\.exports|exports\.\w+)\s*=/,
            /^(public|private|protected|static|final)?\s*(class|interface|enum)\s+\w+/,
            /^def\s+\w+/,  // Python
            /^func\s+\w+/,  // Go
            /^(pub\s+)?fn\s+\w+/,  // Rust
        ];
        
        for (let i = 0; i < lines.length; i++) {
            if (definitions.length >= 20) break;
            const line = lines[i];
            const trimmed = line.trim();
            
            for (const pattern of definitionPatterns) {
                if (pattern.test(trimmed)) {
                    definitions.push(line);
                    // Include the next 5-7 lines if they're part of the definition (to capture constructors, etc.)
                    let bracketCount = 0;
                    let capturedLines = 0;
                    for (let j = 1; j <= 7 && i + j < lines.length && capturedLines < 5; j++) {
                        const nextLine = lines[i + j];
                        const nextTrimmed = nextLine.trim();
                        
                        // Count brackets to understand nesting
                        bracketCount += (nextLine.match(/\{/g) || []).length;
                        bracketCount -= (nextLine.match(/\}/g) || []).length;
                        
                        // Include the line if it's part of the definition
                        if (nextTrimmed && (bracketCount > 0 || nextTrimmed.match(/^(constructor|super|this\.|def |return |if |for |while )/))) {
                            definitions.push(nextLine);
                            capturedLines++;
                        } else if (bracketCount === 0 && nextTrimmed.match(/^(class|function|const|let|var|interface|type|enum|def|func|fn|export)/)) {
                            // Stop if we hit another definition at the same level
                            break;
                        }
                    }
                    break;
                }
            }
        }
        
        if (definitions.length > 0) {
            keyParts.push('// Key definitions:');
            keyParts.push(...definitions);
            keyParts.push('');
        }

        // 4. Extract exports (last 10 lines that contain export statements)
        const exports = [];
        for (let i = Math.max(0, lines.length - 30); i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.match(/^(export|module\.exports|exports\.\w+)/)) {
                exports.push(line);
            }
        }
        
        if (exports.length > 0) {
            keyParts.push('// Exports:');
            keyParts.push(...exports.slice(-10));
        }

        // Combine all parts, limiting total size to ~3000 chars
        let result = keyParts.join('\n');
        if (result.length > 3000) {
            // Prioritize: imports -> definitions -> exports -> header
            const prioritizedParts = [];
            let currentLength = 0;
            
            // Add imports first
            const importSection = keyParts.slice(0, imports.length + 2).join('\n');
            if (currentLength + importSection.length < 2500) {
                prioritizedParts.push(importSection);
                currentLength += importSection.length;
            }
            
            // Add definitions
            const defStart = keyParts.indexOf('// Key definitions:');
            if (defStart !== -1) {
                const defSection = keyParts.slice(defStart, defStart + Math.min(definitions.length + 2, 15)).join('\n');
                if (currentLength + defSection.length < 2800) {
                    prioritizedParts.push(defSection);
                    currentLength += defSection.length;
                }
            }
            
            // Add exports if space remains
            const exportStart = keyParts.indexOf('// Exports:');
            if (exportStart !== -1 && currentLength < 2500) {
                const exportSection = keyParts.slice(exportStart).join('\n');
                if (currentLength + exportSection.length < 3000) {
                    prioritizedParts.push(exportSection);
                }
            }
            
            result = prioritizedParts.join('\n\n');
        }

        return result || content.substring(0, 1000); // Fallback to first 1000 chars if extraction fails
    }
    constructPrompt(directoryPath, fileContents) {
        const fileSummaries = fileContents.map(f => {
            const sections = [];
            if (f.content.includes('// File header/documentation:')) sections.push('header');
            if (f.content.includes('// Imports/Dependencies:')) sections.push('imports');
            if (f.content.includes('// Key definitions:')) sections.push('definitions');
            if (f.content.includes('// Exports:')) sections.push('exports');
            
            const sectionInfo = sections.length > 0 ? ` [showing: ${sections.join(', ')}]` : '';
            return `File: ${f.fileName}${sectionInfo}\n---\n${f.content}\n---\n`;
        }).join('\n');
        
        return `
            Analyze the files in the directory "${directoryPath}" and provide a concise summary of its purpose.
            Focus on the directory's overall responsibility and the roles of its key files.
            
            Note: For each file, key sections are extracted including imports, main definitions, and exports to provide 
            a comprehensive understanding of the file's purpose without truncation.
            
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