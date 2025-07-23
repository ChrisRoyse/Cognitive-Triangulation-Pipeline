const fg = require('fast-glob');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const crypto = require('crypto');
const ignore = require('ignore');

class EntityScout {
    constructor(queueManager, cacheClient, targetDirectory, runId, dbManager) {
        this.queueManager = queueManager;
        this.cacheClient = cacheClient;
        this.targetDirectory = targetDirectory;
        this.runId = runId;
        this.dbManager = dbManager;
        this.fileAnalysisQueue = this.queueManager.getQueue('file-analysis-queue');
        this.directoryResolutionQueue = this.queueManager.getQueue('directory-resolution-queue');
        this.ig = ignore();
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
                console.error(`[EntityScout] Error reading .gitignore file: ${error.message}`);
            }
        }
    }

    /**
     * Calculate MD5 hash of file content for change detection
     */
    async calculateFileHash(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return crypto.createHash('md5').update(content).digest('hex');
        } catch (error) {
            console.error(`[EntityScout] Error hashing file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Check if file has changed since last analysis
     */
    async hasFileChanged(filePath, currentHash) {
        const db = this.dbManager.getDb();
        const fileRecord = db.prepare('SELECT hash FROM files WHERE file_path = ?').get(filePath);
        
        if (!fileRecord) {
            // New file
            return true;
        }
        
        // Compare hashes
        return fileRecord.hash !== currentHash;
    }

    /**
     * Update or insert file record with new hash
     */
    async updateFileRecord(filePath, hash) {
        const db = this.dbManager.getDb();
        const stmt = db.prepare(`
            INSERT INTO files (file_path, hash, status, created_at, updated_at) 
            VALUES (?, ?, 'pending', datetime('now'), datetime('now'))
            ON CONFLICT(file_path) DO UPDATE SET 
                hash = excluded.hash,
                status = 'pending',
                updated_at = datetime('now')
        `);
        stmt.run(filePath, hash);
    }

    async run() {
        console.log(`[EntityScout] Starting incremental run ID: ${this.runId} for directory ${this.targetDirectory}`);
        await this._loadIgnoreFile();

        try {
            const { fileJobs, dirJobs, stats } = await this._discoverAndCreateJobs();

            console.log(`[EntityScout] Incremental analysis stats:
                - Total files found: ${stats.totalFiles}
                - New files: ${stats.newFiles}
                - Changed files: ${stats.changedFiles}
                - Unchanged files (skipped): ${stats.unchangedFiles}`);

            if (fileJobs.length === 0 && dirJobs.length === 0) {
                console.log(`[EntityScout] No files require analysis. Run ${this.runId} complete.`);
                await this.cacheClient.set(`run:${this.runId}:status`, 'completed');
                return { totalJobs: 0, stats };
            }

            // Use bulk operations for better performance
            if (fileJobs.length > 0) {
                await this.fileAnalysisQueue.addBulk(fileJobs);
            }
            if (dirJobs.length > 0) {
                await this.directoryResolutionQueue.addBulk(dirJobs);
            }
            
            const totalJobs = fileJobs.length + dirJobs.length;
            console.log(`[EntityScout] Enqueued ${totalJobs} jobs for incremental analysis.`);
            
            await this.cacheClient.set(`run:${this.runId}:status`, 'processing');
            await this.cacheClient.set(`run:${this.runId}:stats`, JSON.stringify(stats));

            return { totalJobs, stats };

        } catch (error) {
            console.error(`[EntityScout] Run failed: ${error.message}`, error.stack);
            await this.cacheClient.set(`run:${this.runId}:status`, 'failed');
            throw error;
        }
    }

    async _discoverAndCreateJobs() {
        const fileJobs = [];
        const dirFileMap = new Map();
        const stats = {
            totalFiles: 0,
            newFiles: 0,
            changedFiles: 0,
            unchangedFiles: 0
        };
        
        // Use fast-glob for optimized file discovery
        const files = await fg('**/*', {
            cwd: this.targetDirectory,
            absolute: true,
            onlyFiles: true,
            ignore: this.ig.patterns || [],
            dot: false
        });

        console.log(`[EntityScout] Found ${files.length} files, checking for changes...`);

        // Process files in parallel batches for hash calculation
        const batchSize = 50;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (filePath) => {
                stats.totalFiles++;
                
                const hash = await this.calculateFileHash(filePath);
                if (!hash) return; // Skip if hash calculation failed
                
                const hasChanged = await this.hasFileChanged(filePath, hash);
                
                if (hasChanged) {
                    if (!await this.fileExistsInDb(filePath)) {
                        stats.newFiles++;
                    } else {
                        stats.changedFiles++;
                    }
                    
                    // Update file record with new hash
                    await this.updateFileRecord(filePath, hash);
                    
                    const dir = path.dirname(filePath);
                    if (!dirFileMap.has(dir)) {
                        dirFileMap.set(dir, []);
                    }

                    const fileJobId = `file-job-${uuidv4()}`;
                    fileJobs.push({
                        name: 'analyze-file',
                        data: { 
                            filePath, 
                            runId: this.runId, 
                            jobId: fileJobId,
                            hash 
                        },
                    });
                    dirFileMap.get(dir).push(fileJobId);
                } else {
                    stats.unchangedFiles++;
                }
            }));
        }

        // Mark deleted files
        await this.markDeletedFiles(files);

        // Use Redis pipeline for bulk operations
        const pipeline = this.cacheClient.pipeline();
        for (const [dir, fileIds] of dirFileMap.entries()) {
            if (fileIds.length > 0) {
                const directoryFilesKey = `run:${this.runId}:dir:${dir}:files`;
                pipeline.sadd(directoryFilesKey, fileIds);
            }
        }
        await pipeline.exec();

        return { fileJobs, dirJobs: [], stats };
    }

    async fileExistsInDb(filePath) {
        const db = this.dbManager.getDb();
        const result = db.prepare('SELECT 1 FROM files WHERE file_path = ?').get(filePath);
        return !!result;
    }

    async markDeletedFiles(currentFiles) {
        const db = this.dbManager.getDb();
        const currentFileSet = new Set(currentFiles);
        
        // Get all files from database for this directory
        const dbFiles = db.prepare(`
            SELECT file_path FROM files 
            WHERE file_path LIKE ?
            AND status != 'deleted'
        `).all(`${this.targetDirectory}%`);
        
        const deletedFiles = dbFiles.filter(row => !currentFileSet.has(row.file_path));
        
        if (deletedFiles.length > 0) {
            console.log(`[EntityScout] Marking ${deletedFiles.length} deleted files`);
            
            const markDeletedStmt = db.prepare(`
                UPDATE files SET status = 'deleted', updated_at = datetime('now') 
                WHERE file_path = ?
            `);
            
            const transaction = db.transaction((files) => {
                for (const file of files) {
                    markDeletedStmt.run(file.file_path);
                }
            });
            
            transaction(deletedFiles);
        }
    }
}

module.exports = EntityScout;