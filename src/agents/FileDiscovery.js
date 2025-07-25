const { getDeepseekClient } = require('../utils/deepseekClient');
const { Queue } = require('bullmq');
const { createClient } = require('redis');
const path = require('path');

/**
 * AI-Powered File Discovery Agent
 * Uses DeepSeek with MCP tools to intelligently identify core program files
 * and queue them for analysis in the processing pipeline
 */
class FileDiscoveryAgent {
    constructor(config = {}) {
        this.llmClient = getDeepseekClient();
        
        // Redis and queue configuration
        this.redisConfig = config.redisConfig || {
            host: 'localhost',
            port: 6379,
            db: 0
        };
        
        this.queueName = config.queueName || 'codebase-analysis-discovered-files';
        this.redis = null;
        this.queue = null;
        
        // Processing stats
        this.stats = {
            totalFilesFound: 0,
            coreFilesIdentified: 0,
            filesQueued: 0,
            startTime: null,
            endTime: null
        };
    }

    async initialize() {
        try {
            this.redis = createClient(this.redisConfig);
            await this.redis.connect();
            
            this.queue = new Queue(this.queueName, {
                connection: this.redisConfig
            });
            
            // Clear any existing jobs in the queue for a fresh start
            await this._clearQueue();
            
            console.log('FileDiscoveryAgent initialized with Redis connection');
        } catch (error) {
            console.error('Failed to initialize FileDiscoveryAgent:', error.message);
            throw error;
        }
    }

    async _clearQueue() {
        try {
            // Get all job types
            const jobCounts = await this.queue.getJobCounts();
            console.log(`Clearing queue: ${this.queueName}`);
            console.log(`Current job counts:`, jobCounts);
            
            // Remove all jobs in different states
            if (jobCounts.waiting > 0) {
                await this.queue.drain();
                console.log(`Drained ${jobCounts.waiting} waiting jobs`);
            }
            
            if (jobCounts.prioritized > 0) {
                const prioritizedJobs = await this.queue.getJobs(['prioritized']);
                for (const job of prioritizedJobs) {
                    await job.remove();
                }
                console.log(`Removed ${prioritizedJobs.length} prioritized jobs`);
            }
            
            if (jobCounts.completed > 0) {
                await this.queue.clean(0, 0, 'completed');
                console.log(`Cleaned completed jobs`);
            }
            
            if (jobCounts.failed > 0) {
                await this.queue.clean(0, 0, 'failed');
                console.log(`Cleaned failed jobs`);
            }
            
            console.log('Queue cleared successfully');
        } catch (error) {
            console.error('Error clearing queue:', error.message);
            // Don't throw - continue with initialization even if clearing fails
        }
    }

    async cleanup() {
        if (this.redis) {
            await this.redis.disconnect();
        }
        if (this.queue) {
            await this.queue.close();
        }
    }

    /**
     * Main method: Discover and queue core program files
     */
    async discoverAndQueueFiles(targetDirectory) {
        this.stats.startTime = new Date();
        console.log(`Starting AI-powered file discovery for: ${targetDirectory}`);
        
        try {
            if (!this.queue) {
                throw new Error('FileDiscoveryAgent not initialized. Call initialize() first.');
            }

            // Security check
            const projectRoot = path.resolve(process.cwd());
            const resolvedDirectory = path.resolve(targetDirectory);
            
            if (!resolvedDirectory.startsWith(projectRoot)) {
                throw new Error('Directory path is outside the allowed project directory.');
            }

            // Use AI agent to discover and analyze files
            const discoveryResult = await this._aiDiscoverFiles(resolvedDirectory);
            
            // Queue the identified core files
            const queuedCount = await this._queueCoreFiles(discoveryResult.coreFiles);
            
            // Update stats
            this.stats.totalFilesFound = discoveryResult.totalFiles;
            this.stats.coreFilesIdentified = discoveryResult.coreFiles.length;
            this.stats.filesQueued = queuedCount;
            this.stats.endTime = new Date();
            
            console.log(`File discovery completed: ${queuedCount}/${discoveryResult.coreFiles.length} core files queued`);
            
            return {
                success: true,
                totalFiles: discoveryResult.totalFiles,
                coreFiles: discoveryResult.coreFiles.length,
                queuedFiles: queuedCount,
                detectedLanguages: discoveryResult.detectedLanguages,
                projectType: discoveryResult.projectType,
                stats: this.stats,
                files: discoveryResult.coreFiles
            };
            
        } catch (error) {
            console.error(`FileDiscoveryAgent error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Use AI agent to intelligently discover and filter files
     */
    async _aiDiscoverFiles(targetDirectory) {
        const prompt = {
            system: `You are an expert File Discovery Agent specialized in identifying core program files for code analysis.

MISSION: Analyze the project structure and identify ONLY the core files that contain:
- Classes, functions, variables, methods
- Database schemas, table definitions
- API endpoints, routes, handlers
- Business logic, services, models
- Configuration that affects program behavior
- Core application entry points

STRICT FILTERING RULES - EXCLUDE these files:
1. Documentation: .md, .txt, .rst, .adoc, README*, CHANGELOG*, LICENSE*
2. Version control: .gitignore, .gitattributes, .git/*
3. Test files: *test*, *spec*, __tests__/*, *mock*, *fixture*
4. Build artifacts: dist/, build/, target/, bin/, obj/, *.min.js, *.bundle.js
5. Dependencies: node_modules/, vendor/, packages/, *.lock files
6. IDE files: .vscode/, .idea/, *.swp, *.tmp
7. Logs and temp: *.log, tmp/, temp/, .cache/
8. Images/assets: *.png, *.jpg, *.gif, *.svg, *.ico, *.woff, *.ttf

INCLUDE these core files:
1. Source code: *.js, *.ts, *.py, *.java, *.go, *.rs, *.cpp, *.c, *.cs, *.php, *.rb
2. Database schemas: *.sql, migrations/*, schema files
3. Essential configs: package.json, pom.xml, Cargo.toml, requirements.txt, go.mod
4. Application configs: config.js, settings.py, application.properties (NOT build configs)

PROCESS:
1. Start by listing the target directory to see the overall project structure
2. Based on file names and extensions, intelligently identify the project type
3. Use list_directory tool efficiently - explore subdirectories only when needed, don't read files unnecessarily
4. Apply filtering rules based on file names and extensions (you don't need to read file contents to filter)
5. Return a structured list of core files with clear reasoning

EFFICIENCY RULES:
- Make minimal tool calls - list directories efficiently, don't read files unless absolutely necessary
- You can identify most file types from names/extensions without reading contents
- Only use read_file if you need to determine project type from package.json/requirements.txt etc.
- Don't read every single file - use your intelligence to filter based on names and patterns

BE VERY STRICT about filtering - when in doubt, EXCLUDE the file. Only include files that definitely contain program logic, data structures, or essential configuration.`,

            user: `Please analyze the project at: ${targetDirectory}

Start by exploring the directory structure and identifying the project type. Then systematically discover and filter files to identify ONLY the core program files that would be needed for code analysis and relationship mapping.

IMPORTANT: In your final response, provide a clear numbered list of INCLUDED CORE FILES with their FULL ABSOLUTE PATHS, like this:

## CORE FILES TO INCLUDE:
1. C:\\full\\path\\to\\file1.js
2. C:\\full\\path\\to\\file2.py
3. C:\\full\\path\\to\\file3.java

Provide your analysis and reasoning for inclusion/exclusion decisions, but make sure the file paths are clearly listed.`
        };

        console.log('AI Agent analyzing project structure...');
        const response = await this.llmClient.call(prompt, { 
            temperature: 0.1  // Low temperature for consistent, focused file discovery
        });
        
        // Parse the AI response to extract structured data
        return this._parseAIResponse(response.body, targetDirectory);
    }

    /**
     * Parse AI response and extract file list
     */
    _parseAIResponse(aiResponse, targetDirectory) {
        console.log('AI Discovery Analysis:');
        console.log('='.repeat(50));
        console.log(aiResponse);
        console.log('='.repeat(50));
        
        // Extract structured data from AI response
        // The AI should have used the MCP tools and provided analysis
        
        // For now, we'll extract basic info and let the AI do the heavy lifting
        // In a production system, you might want more structured output from the AI
        
        const lines = aiResponse.split('\n');
        const coreFiles = [];
        let totalFiles = 0;
        let detectedLanguages = [];
        let projectType = 'unknown';
        
        // Extract project type
        const projectTypeMatch = aiResponse.match(/Project Type:\s*([^\n]+)/i) || 
                                aiResponse.match(/Type:\s*([^\n]+)/i) ||
                                aiResponse.match(/This is a[n]?\s*([^\n]+?)\s*project/i);
        if (projectTypeMatch) {
            projectType = projectTypeMatch[1].trim();
        }
        
        // Extract languages
        const languageMatch = aiResponse.match(/Languages?[:\s]+([^\n]+)/i);
        if (languageMatch) {
            detectedLanguages = languageMatch[1].split(/[,\s]+/).filter(lang => lang.length > 0);
        }
        
        // Extract file paths - look for various path patterns in the response
        const pathPatterns = [
            // Full paths with backslashes
            new RegExp(targetDirectory.replace(/\\/g, '\\\\') + '[^\\s]*\\.[a-zA-Z]+', 'g'),
            // Full paths with forward slashes  
            new RegExp(targetDirectory.replace(/\\/g, '/') + '[^\\s]*\\.[a-zA-Z]+', 'g'),
            // Relative paths mentioned in context
            /[^\\s]*\.(js|ts|py|java|sql|go|rs|cpp|c|h|php|rb|cs|fs|scala|kt|swift|dart)[^\\s]*/g
        ];
        
        let allMatches = [];
        pathPatterns.forEach(pattern => {
            const matches = aiResponse.match(pattern) || [];
            allMatches = allMatches.concat(matches);
        });
        
        // Also look for files mentioned in bullet points or lists
        const responseLines = aiResponse.split('\n');
        responseLines.forEach(line => {
            // Look for file mentions in various formats
            const fileMatches = line.match(/[`"']?([^`"'\s]*\.(js|ts|py|java|sql|go|rs|cpp|c|h|php|rb|cs|fs|scala|kt|swift|dart))[`"']?/g);
            if (fileMatches) {
                allMatches = allMatches.concat(fileMatches.map(match => match.replace(/[`"']/g, '')));
            }
        });
        
        // Remove duplicates and convert to full paths
        const uniquePaths = [...new Set(allMatches)];
        
        uniquePaths.forEach(filePath => {
            // Convert to full path if it's relative
            let fullPath = filePath;
            if (!path.isAbsolute(filePath)) {
                fullPath = path.resolve(targetDirectory, filePath);
            }
            
            if (this._isValidCoreFile(fullPath) && fullPath.startsWith(targetDirectory)) {
                coreFiles.push({
                    path: fullPath,
                    name: path.basename(fullPath),
                    extension: path.extname(fullPath),
                    directory: path.dirname(fullPath),
                    priority: this._calculateFilePriority(fullPath),
                    language: this._detectLanguage(path.extname(fullPath))
                });
            }
        });
        
        // If still no files found, we need to parse the AI response more carefully
        if (coreFiles.length === 0) {
            console.log('Attempting to extract files from AI analysis text...');
            const extractedFiles = this._extractFilesFromAnalysis(aiResponse, targetDirectory);
            coreFiles.push(...extractedFiles);
        }
        
        totalFiles = Math.max(coreFiles.length, this._extractTotalFilesCount(aiResponse));
        
        return {
            coreFiles,
            totalFiles,
            detectedLanguages,
            projectType,
            aiAnalysis: aiResponse
        };
    }

    /**
     * Validate that a file is truly a core file
     */
    _isValidCoreFile(filePath) {
        const fileName = path.basename(filePath).toLowerCase();
        const ext = path.extname(filePath).toLowerCase();
        
        // Exclude patterns - be more specific to avoid false positives
        const excludePatterns = [
            /\/test\//, /\\test\\/, /_test\./, /\.test\./, /test_/,
            /\/spec\//, /\\spec\\/, /_spec\./, /\.spec\./, /spec_/,
            /\/mock\//, /\\mock\\/, /_mock\./, /\.mock\./,
            /\/fixture\//, /\\fixture\\/, /_fixture\./, /\.fixture\./,
            /\.md$/, /\.txt$/, /\.log$/,
            /readme/, /changelog/, /license/,
            /\.min\./, /\.bundle\./,
            /node_modules/, /vendor/, /dist/, /build/
        ];
        
        if (excludePatterns.some(pattern => pattern.test(fileName) || pattern.test(filePath))) {
            return false;
        }
        
        // Include patterns
        const coreExtensions = [
            '.js', '.ts', '.jsx', '.tsx',
            '.py', '.pyi', '.pyw',
            '.java', '.scala', '.kt',
            '.go', '.rs', '.swift',
            '.cpp', '.c', '.h', '.hpp',
            '.cs', '.fs',
            '.php', '.rb',
            '.sql', '.ddl', '.dml'
        ];
        
        return coreExtensions.includes(ext);
    }

    /**
     * Calculate file priority for processing order
     */
    _calculateFilePriority(filePath) {
        const fileName = path.basename(filePath).toLowerCase();
        const dirName = path.basename(path.dirname(filePath)).toLowerCase();
        
        // Entry points get highest priority
        if (['main.js', 'index.js', 'app.js', 'server.js', 'main.py', 'app.py'].includes(fileName)) {
            return 95;
        }
        
        // Core business logic
        if (['service', 'model', 'controller', 'handler', 'manager'].some(term => fileName.includes(term))) {
            return 85;
        }
        
        // Source directories
        if (['src', 'lib', 'core'].includes(dirName)) {
            return 70;
        }
        
        // Database files
        if (fileName.includes('schema') || fileName.includes('.sql')) {
            return 75;
        }
        
        // Configuration
        if (['package.json', 'pom.xml', 'cargo.toml'].includes(fileName)) {
            return 60;
        }
        
        // Utilities
        if (fileName.includes('util') || fileName.includes('helper')) {
            return 30;
        }
        
        return 50; // Default priority
    }

    /**
     * Detect programming language from file extension
     */
    _detectLanguage(extension) {
        const languageMap = {
            '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
            '.ts': 'typescript', '.tsx': 'typescript',
            '.py': 'python', '.pyi': 'python', '.pyw': 'python',
            '.java': 'java', '.scala': 'scala', '.kt': 'kotlin',
            '.go': 'go', '.rs': 'rust', '.swift': 'swift',
            '.cpp': 'cpp', '.c': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
            '.cs': 'csharp', '.fs': 'fsharp',
            '.php': 'php', '.rb': 'ruby',
            '.sql': 'sql', '.ddl': 'sql', '.dml': 'sql'
        };
        
        return languageMap[extension.toLowerCase()] || 'unknown';
    }

    /**
     * Extract total files count from AI response
     */
    _extractTotalFilesCount(aiResponse) {
        const countMatch = aiResponse.match(/(\d+)\s*(?:total\s*)?files?/i);
        return countMatch ? parseInt(countMatch[1]) : 0;
    }

    /**
     * Extract files from AI analysis text when path extraction fails
     */
    _extractFilesFromAnalysis(aiResponse, targetDirectory) {
        const coreFiles = [];
        const lines = aiResponse.split('\n');
        
        console.log('Extracting files from AI analysis...');
        
        for (const line of lines) {
            // Look for the CORE FILES TO INCLUDE section specifically
            if (line.includes('CORE FILES TO INCLUDE:')) {
                console.log('Found CORE FILES TO INCLUDE section');
                continue;
            }
            
            // Look for numbered lists with full paths
            const patterns = [
                // Full Windows paths in numbered lists
                /^\d+\.\s*([C-Z]:\\[^\\]+\\[^\\]+\\[^\\]*\.(js|ts|py|java|sql|go|rs|cpp|c|h|php|rb|cs|fs|scala|kt|swift|dart))/i,
                // Numbered list with any file path
                /^\d+\.\s*(.+\.(js|ts|py|java|sql|go|rs|cpp|c|h|php|rb|cs|fs|scala|kt|swift|dart))\s*$/i,
                // Bullet points
                /^[-*]\s*(.+\.(js|ts|py|java|sql|go|rs|cpp|c|h|php|rb|cs|fs|scala|kt|swift|dart))\s*$/i
            ];
            
            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match) {
                    let filePath = match[1].trim();
                    
                    console.log(`Extracted potential file: ${filePath}`);
                    
                    // Clean up the path
                    filePath = filePath.replace(/[`"']/g, '');
                    
                    // Convert to full path if needed
                    let fullPath;
                    if (path.isAbsolute(filePath)) {
                        fullPath = filePath;
                    } else {
                        fullPath = path.resolve(targetDirectory, filePath);
                    }
                    
                    console.log(`Full path: ${fullPath}`);
                    
                    // Debug validation
                    const isValid = this._isValidCoreFile(fullPath);
                    console.log(`Validation result for ${path.basename(fullPath)}: ${isValid}`);
                    
                    // Validate and add
                    if (isValid) {
                        const fileInfo = {
                            path: fullPath,
                            name: path.basename(fullPath),
                            extension: path.extname(fullPath),
                            directory: path.dirname(fullPath),
                            priority: this._calculateFilePriority(fullPath),
                            language: this._detectLanguage(path.extname(fullPath))
                        };
                        
                        // Check for duplicates
                        const isDuplicate = coreFiles.some(existing => existing.path === fullPath);
                        if (!isDuplicate) {
                            coreFiles.push(fileInfo);
                            console.log(`✅ Added: ${path.basename(fullPath)} (${fileInfo.language})`);
                        }
                    } else {
                        console.log(`❌ Rejected: ${path.basename(fullPath)} (failed validation)`);
                    }
                    
                    break; // Found a match, move to next line
                }
            }
        }
        
        console.log(`Extracted ${coreFiles.length} files from AI analysis`);
        return coreFiles;
    }

    /**
     * Queue core files for processing
     */
    async _queueCoreFiles(coreFiles) {
        let queuedCount = 0;
        
        console.log(`Queueing ${coreFiles.length} core files for processing...`);
        
        for (const file of coreFiles) {
            try {
                const job = await this.queue.add('analyze-source-file', {
                    ...file,
                    discoveredAt: new Date().toISOString(),
                    discoveryAgent: 'FileDiscoveryAgent-AI'
                }, {
                    priority: file.priority
                    // Don't auto-remove so we can inspect the queue
                    // removeOnComplete: 100,
                    // removeOnFail: 50
                });
                
                console.log(`Queued job ${job.id} for ${file.name}`);
                queuedCount++;
            } catch (queueError) {
                console.error(`Failed to queue file ${file.path}:`, queueError.message);
            }
        }
        
        console.log(`Successfully queued ${queuedCount}/${coreFiles.length} files`);
        
        // Debug: Check queue status immediately
        const waiting = await this.queue.getWaitingCount();
        const active = await this.queue.getActiveCount();
        const completed = await this.queue.getCompletedCount();
        console.log(`Queue status - Waiting: ${waiting}, Active: ${active}, Completed: ${completed}`);
        
        return queuedCount;
    }

    /**
     * Get processing statistics
     */
    getStats() {
        const duration = this.stats.endTime && this.stats.startTime ? 
            this.stats.endTime - this.stats.startTime : null;
            
        return {
            ...this.stats,
            durationMs: duration,
            processingRate: duration ? (this.stats.filesQueued / (duration / 1000)).toFixed(2) + ' files/sec' : null
        };
    }
}

module.exports = FileDiscoveryAgent;