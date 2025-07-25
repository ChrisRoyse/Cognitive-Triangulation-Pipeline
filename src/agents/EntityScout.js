const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const ignore = require('ignore');

class EntityScout {
    constructor(queueManager, targetDirectory, runId, dbManager = null) {
        this.queueManager = queueManager;
        this.targetDirectory = targetDirectory;
        this.runId = runId;
        this.dbManager = dbManager;
        this.fileAnalysisQueue = this.queueManager.getQueue('file-analysis-queue');
        this.directoryResolutionQueue = this.queueManager.getQueue('directory-resolution-queue');
        this.ig = ignore();
        
        // Statistics for deduplication
        this.stats = {
            totalFiles: 0,
            changedFiles: 0,
            unchangedFiles: 0,
            newFiles: 0
        };
        
        // Define supported code file extensions
        this.supportedExtensions = new Set([
            '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',  // JavaScript/TypeScript
            '.py', '.pyw', '.pyx',                          // Python
            '.java', '.scala', '.kt', '.kts',               // JVM languages
            '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',      // C/C++
            '.cs', '.fs', '.vb',                            // .NET languages
            '.go',                                           // Go
            '.rs',                                           // Rust
            '.rb', '.erb',                                   // Ruby
            '.php', '.phtml',                                // PHP
            '.swift',                                        // Swift
            '.m', '.mm',                                     // Objective-C
            '.r', '.R',                                      // R
            '.lua',                                          // Lua
            '.pl', '.pm',                                    // Perl
            '.sh', '.bash', '.zsh',                          // Shell scripts
            '.sql',                                          // SQL
            '.vue',                                          // Vue
            '.svelte',                                       // Svelte
            '.elm',                                          // Elm
            '.ex', '.exs',                                   // Elixir
            '.erl', '.hrl',                                  // Erlang
            '.clj', '.cljs', '.cljc',                        // Clojure
            '.dart',                                         // Dart
            '.zig',                                          // Zig
            '.nim',                                          // Nim
            '.jl',                                           // Julia
            '.ml', '.mli',                                   // OCaml
            '.fs', '.fsx', '.fsi',                           // F#
            '.pas', '.pp',                                   // Pascal
            '.d',                                            // D
            '.groovy', '.gradle',                            // Groovy
            '.vala',                                         // Vala
            '.cr',                                           // Crystal
            '.hx',                                           // Haxe
            '.rkt',                                          // Racket
            '.scm', '.ss',                                   // Scheme
            '.lisp', '.lsp', '.cl',                          // Lisp
            '.coffee',                                       // CoffeeScript
            '.asm', '.s',                                    // Assembly
            '.f90', '.f95', '.f03',                          // Fortran
            '.cob', '.cbl',                                  // COBOL
            '.ada', '.adb', '.ads',                          // Ada
        ]);
        
        // Additional patterns to always ignore
        this.ig.add([
            '.git/',
            'node_modules/',
            '*.min.js',
            '*.min.css',
            'dist/',
            'build/',
            'coverage/',
            '*.log',
            '*.tmp',
            '*.temp',
            '*.cache',
            '*.swp',
            '*.swo',
            '.DS_Store',
            'Thumbs.db'
        ]);
    }

    async _loadIgnoreFile() {
        const ignoreFilePath = path.join(this.targetDirectory, '.gitignore');
        try {
            const ignoreFileContent = await fs.readFile(ignoreFilePath, 'utf-8');
            this.ig.add(ignoreFileContent);
            console.log(`[EntityScout] Loaded .gitignore patterns from ${ignoreFilePath}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`[EntityScout] No .gitignore file found in ${this.targetDirectory}. Proceeding without ignore patterns.`);
            } else {
                console.error(`[EntityScout] Error reading .gitignore file:`, {
                    path: ignoreFilePath,
                    error: error.message,
                    errorCode: error.code,
                    action: 'Check file permissions and path validity. EntityScout will continue without ignore patterns.',
                    stack: error.stack
                });
            }
        }
    }

    async run() {
        console.log(`[EntityScout] Starting run ID: ${this.runId} for directory ${this.targetDirectory}`);
        await this._loadIgnoreFile();

        try {
            const { fileJobs, dirJobs } = await this._discoverAndCreateJobs();

            if (fileJobs.length === 0 && dirJobs.length === 0) {
                console.log(`[EntityScout] No files or directories discovered for analysis. Run ${this.runId} complete.`);
                await this._updateRunStatus('completed');
                return { totalJobs: 0 };
            }

            await this.fileAnalysisQueue.addBulk(fileJobs);
            await this.directoryResolutionQueue.addBulk(dirJobs);
            
            const totalJobs = fileJobs.length + dirJobs.length;
            console.log(`[EntityScout] Enqueued ${totalJobs} initial jobs for run ${this.runId}.`);
            
            await this._updateRunStatus('processing');

            return { totalJobs };

        } catch (error) {
            const errorContext = {
                runId: this.runId,
                targetDirectory: this.targetDirectory,
                error: error.message,
                errorType: error.name,
                errorCode: error.code,
                phase: 'discovery_and_job_creation',
                action: 'Check directory permissions, path validity, and queue connectivity. Ensure Redis/BullMQ services are running.',
                stack: error.stack
            };
            
            console.error(`[EntityScout] Failed to complete file discovery for directory ${this.targetDirectory}:`, errorContext);
            
            await this._updateRunStatus('failed');
            
            // Add more context to the thrown error
            error.context = errorContext;
            throw error;
        }
    }

    async _discoverAndCreateJobs() {
        const fileJobs = [];
        const dirFileMap = new Map();
        
        // Reset statistics
        this.stats = {
            totalFiles: 0,
            changedFiles: 0,
            unchangedFiles: 0,
            newFiles: 0
        };
        
        const recursiveDiscover = async (currentDir) => {
            const relativePath = path.relative(this.targetDirectory, currentDir);
            if (relativePath && this.ig.ignores(relativePath)) {
                return;
            }

            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            if (!dirFileMap.has(currentDir)) {
                dirFileMap.set(currentDir, []);
            }

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                const entryRelativePath = path.relative(this.targetDirectory, fullPath);

                if (this.ig.ignores(entryRelativePath)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await recursiveDiscover(fullPath);
                } else {
                    // Check if file has a supported extension
                    const fileExt = path.extname(fullPath).toLowerCase();
                    if (!this.supportedExtensions.has(fileExt)) {
                        console.log(`[EntityScout] Skipping non-code file: ${fullPath}`);
                        continue;
                    }
                    
                    this.stats.totalFiles++;
                    
                    // Check if file should be processed (new or changed)
                    const shouldProcess = await this._shouldProcessFile(fullPath);
                    
                    if (shouldProcess) {
                        const fileJobId = `file-job-${uuidv4()}`;
                        fileJobs.push({
                            name: 'analyze-file',
                            data: { filePath: fullPath, runId: this.runId, jobId: fileJobId },
                        });
                        dirFileMap.get(currentDir).push(fileJobId);
                    }
                }
            }
        };

        await recursiveDiscover(this.targetDirectory);
        
        // Log deduplication statistics
        console.log(`[EntityScout] Found ${this.stats.totalFiles} files total`);
        console.log(`[EntityScout] New files: ${this.stats.newFiles}, Changed files: ${this.stats.changedFiles}, Unchanged files: ${this.stats.unchangedFiles}`);
        console.log(`[EntityScout] Enqueued ${fileJobs.length} jobs for new/changed files (skipped ${this.stats.unchangedFiles} unchanged)`);

        // Store directory-file mappings in the database
        await this._storeDirectoryFileMappings(dirFileMap);

        return { fileJobs, dirJobs: [] };
    }
    
    /**
     * Calculate MD5 hash for a file's content
     * @param {string} filePath - Path to the file
     * @returns {Promise<string>} MD5 hash of the file content
     */
    async _calculateFileHash(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return crypto.createHash('md5').update(content).digest('hex');
        } catch (error) {
            console.error(`[EntityScout] Error calculating file hash:`, {
                filePath,
                error: error.message,
                errorCode: error.code,
                fileSize: await this._getFileSizeInfo(filePath),
                action: 'Check file readability and permissions. File will be processed without hash verification.',
                stack: error.stack
            });
            return null;
        }
    }
    
    /**
     * Check if a file has changed since last processing
     * @param {string} filePath - Path to the file
     * @param {string} currentHash - Current hash of the file
     * @returns {Promise<boolean>} True if file has changed or is new
     */
    async _hasFileChanged(filePath, currentHash) {
        if (!this.dbManager || !currentHash) {
            return true; // If no database manager or hash calculation failed, process the file
        }
        
        try {
            const db = this.dbManager.getDb();
            const existing = db.prepare('SELECT hash FROM files WHERE file_path = ?').get(filePath);
            return !existing || existing.hash !== currentHash;
        } catch (error) {
            console.error(`[EntityScout] Error checking file change status:`, {
                filePath,
                error: error.message,
                errorType: error.name,
                errorCode: error.code,
                currentHash,
                action: 'Check database connectivity and schema. File will be processed as a precaution.',
                dbTable: 'files',
                expectedColumns: 'file_path, hash',
                stack: error.stack
            });
            return true; // On error, process the file to be safe
        }
    }
    
    /**
     * Update file record in database with new hash and timestamp
     * @param {string} filePath - Path to the file
     * @param {string} hash - Hash of the file content
     */
    async _updateFileRecord(filePath, hash) {
        if (!this.dbManager || !hash) {
            return;
        }
        
        try {
            const db = this.dbManager.getDb();
            db.prepare(`INSERT OR REPLACE INTO files (file_path, hash, last_processed, status) 
                       VALUES (?, ?, datetime('now'), 'processed')`).run(filePath, hash);
        } catch (error) {
            console.error(`[EntityScout] Error updating file record:`, {
                filePath,
                hash,
                error: error.message,
                errorType: error.name,
                errorCode: error.code,
                action: 'Check database write permissions and table structure. File processing will continue.',
                dbTable: 'files',
                operation: 'INSERT OR REPLACE',
                stack: error.stack
            });
        }
    }
    
    /**
     * Determine if a file should be processed based on change detection
     * @param {string} filePath - Path to the file
     * @returns {Promise<boolean>} True if file should be processed
     */
    async _shouldProcessFile(filePath) {
        // Calculate current file hash
        const currentHash = await this._calculateFileHash(filePath);
        
        if (!currentHash) {
            // If hash calculation failed, don't process but don't count as unchanged
            return false;
        }
        
        // Check if file has changed
        const hasChanged = await this._hasFileChanged(filePath, currentHash);
        
        if (hasChanged) {
            // Check if this is a new file or changed file
            if (this.dbManager) {
                try {
                    const db = this.dbManager.getDb();
                    const existing = db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath);
                    if (existing) {
                        this.stats.changedFiles++;
                    } else {
                        this.stats.newFiles++;
                    }
                } catch (error) {
                    this.stats.newFiles++; // Assume new on error
                }
            } else {
                this.stats.newFiles++;
            }
            
            // Update file record for future runs
            await this._updateFileRecord(filePath, currentHash);
            return true;
        } else {
            this.stats.unchangedFiles++;
            return false;
        }
    }
    
    /**
     * Get file size information for error reporting
     * @param {string} filePath - Path to the file
     * @returns {Promise<Object>} File size info
     */
    async _getFileSizeInfo(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return {
                bytes: stats.size,
                readable: this._formatBytes(stats.size)
            };
        } catch (error) {
            return { bytes: 0, readable: 'unknown', error: error.message };
        }
    }
    
    /**
     * Format bytes to human readable string
     * @param {number} bytes - Number of bytes
     * @returns {string} Formatted string
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Update run status in the database
     * @param {string} status - The status to set
     * @param {Object} metadata - Optional metadata to store with the status
     */
    async _updateRunStatus(status, metadata = null) {
        if (!this.dbManager) {
            console.warn(`[EntityScout] No database manager available, cannot update run status to '${status}'`);
            return;
        }
        
        try {
            const db = this.dbManager.getDb();
            const metadataStr = metadata ? JSON.stringify(metadata) : null;
            
            db.prepare(`
                INSERT INTO run_status (run_id, status, metadata) 
                VALUES (?, ?, ?)
            `).run(this.runId, status, metadataStr);
            
            console.log(`[EntityScout] Updated run ${this.runId} status to '${status}'`);
        } catch (error) {
            console.error(`[EntityScout] Error updating run status:`, {
                runId: this.runId,
                status,
                error: error.message,
                errorType: error.name,
                action: 'Check database connectivity and run_status table existence',
                stack: error.stack
            });
        }
    }
    
    /**
     * Store directory-file mappings in the database
     * @param {Map} dirFileMap - Map of directories to file job IDs
     */
    async _storeDirectoryFileMappings(dirFileMap) {
        if (!this.dbManager) {
            console.warn(`[EntityScout] No database manager available, cannot store directory-file mappings`);
            return;
        }
        
        try {
            const db = this.dbManager.getDb();
            
            // Create a table to store directory-file mappings if it doesn't exist
            db.exec(`
                CREATE TABLE IF NOT EXISTS directory_file_mappings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    directory_path TEXT NOT NULL,
                    file_job_ids TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(run_id, directory_path)
                )
            `);
            
            // Prepare the insert statement
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO directory_file_mappings (run_id, directory_path, file_job_ids)
                VALUES (?, ?, ?)
            `);
            
            // Insert all mappings in a transaction
            const insertMappings = db.transaction((mappings) => {
                for (const [dir, files] of mappings) {
                    if (files.length > 0) {
                        stmt.run(this.runId, dir, JSON.stringify(files));
                    }
                }
            });
            
            insertMappings(dirFileMap);
            
            console.log(`[EntityScout] Stored ${dirFileMap.size} directory-file mappings for run ${this.runId}`);
        } catch (error) {
            console.error(`[EntityScout] Error storing directory-file mappings:`, {
                runId: this.runId,
                mappingCount: dirFileMap.size,
                error: error.message,
                errorType: error.name,
                action: 'Check database write permissions and table structure',
                stack: error.stack
            });
        }
    }
}

module.exports = EntityScout;
