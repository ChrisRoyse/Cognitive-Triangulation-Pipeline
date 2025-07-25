//
// pipelineApi.js
//
// API service for managing cognitive triangulation pipeline execution with real-time progress tracking
// Provides endpoints to start pipeline analysis on dynamic directory paths using EntityScout, GraphBuilder, and RelationshipResolver
//

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const os = require('os');
const { PerformanceMonitor } = require('./performanceMonitor');

class PipelineApiService {
    constructor(port = 3002) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });
        this.port = port;
        
        // Track active pipeline runs
        this.activePipelines = new Map(); // pipelineId -> pipeline status
        this.clients = new Set(); // WebSocket clients for real-time updates
        this.pipelineCounter = 0; // Total pipelines created
        
        // Initialize performance monitor
        this.performanceMonitor = new PerformanceMonitor('PipelineAPI');
        this.performanceMonitor.startMonitoring();
        
        // Initialize queue manager reference (will be set when available)
        this.queueManager = null;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        });

        // Start pipeline analysis
        this.app.post('/api/pipeline/start', async (req, res) => {
            try {
                const { targetDirectory, pipelineId } = req.body;
                
                if (!targetDirectory) {
                    return res.status(400).json({ 
                        error: 'targetDirectory is required',
                        example: { targetDirectory: 'C:/code/myproject', pipelineId: 'optional-custom-id' }
                    });
                }

                // Validate directory exists
                try {
                    const stats = await fs.stat(targetDirectory);
                    if (!stats.isDirectory()) {
                        return res.status(400).json({ 
                            error: 'targetDirectory must be a valid directory path',
                            provided: targetDirectory
                        });
                    }
                } catch (error) {
                    return res.status(400).json({ 
                        error: 'Directory does not exist or is not accessible',
                        provided: targetDirectory,
                        details: error.message
                    });
                }

                const id = pipelineId || this.generatePipelineId();
                
                // Check if pipeline is already running
                if (this.activePipelines.has(id)) {
                    return res.status(409).json({ 
                        error: 'Pipeline with this ID is already running',
                        pipelineId: id,
                        status: this.activePipelines.get(id).status
                    });
                }

                // Increment pipeline counter
                this.pipelineCounter++;

                // Start pipeline asynchronously
                this.startPipelineAsync(id, targetDirectory);
                
                res.json({
                    message: 'Cognitive triangulation pipeline started successfully',
                    pipelineId: id,
                    targetDirectory: targetDirectory,
                    status: 'starting',
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                console.error('Error starting pipeline:', error);
                res.status(500).json({ 
                    error: 'Failed to start pipeline',
                    details: error.message
                });
            }
        });

        // Get pipeline status
        this.app.get('/api/pipeline/status/:pipelineId', (req, res) => {
            const { pipelineId } = req.params;
            const pipeline = this.activePipelines.get(pipelineId);
            
            if (!pipeline) {
                return res.status(404).json({ 
                    error: 'Pipeline not found',
                    pipelineId: pipelineId
                });
            }
            
            res.json(pipeline);
        });

        // Get all active pipelines
        this.app.get('/api/pipeline/active', (req, res) => {
            const activePipelines = Array.from(this.activePipelines.entries()).map(([id, data]) => ({
                pipelineId: id,
                ...data
            }));
            
            res.json({
                count: activePipelines.length,
                pipelines: activePipelines
            });
        });

        // Stop pipeline
        this.app.post('/api/pipeline/stop/:pipelineId', (req, res) => {
            const { pipelineId } = req.params;
            const pipeline = this.activePipelines.get(pipelineId);
            
            if (!pipeline) {
                return res.status(404).json({ 
                    error: 'Pipeline not found',
                    pipelineId: pipelineId
                });
            }
            
            // Mark for stopping (actual implementation would need process management)
            pipeline.status = 'stopping';
            pipeline.lastUpdate = new Date().toISOString();
            
            this.broadcastUpdate(pipelineId, pipeline);
            
            res.json({
                message: 'Pipeline stop requested',
                pipelineId: pipelineId,
                status: 'stopping'
            });
        });

        // Clear pipeline history
        this.app.delete('/api/pipeline/clear/:pipelineId', (req, res) => {
            const { pipelineId } = req.params;
            
            if (this.activePipelines.has(pipelineId)) {
                const pipeline = this.activePipelines.get(pipelineId);
                if (pipeline.status === 'running') {
                    return res.status(400).json({ 
                        error: 'Cannot clear running pipeline. Stop it first.',
                        pipelineId: pipelineId
                    });
                }
                this.activePipelines.delete(pipelineId);
            }
            
            res.json({
                message: 'Pipeline cleared',
                pipelineId: pipelineId
            });
        });

        // Metrics endpoint for monitoring tools (Prometheus, Grafana, etc.)
        this.app.get('/metrics', async (req, res) => {
            try {
                const metrics = {
                    timestamp: new Date().toISOString(),
                    system: this.getSystemMetrics(),
                    performance: this.performanceMonitor ? this.performanceMonitor.generateReport() : {},
                    pipelines: {
                        active: this.activePipelines.size,
                        total: this.pipelineCounter || 0,
                        byStatus: this.getPipelineStatusCounts()
                    },
                    queues: await this.getQueueMetrics(),
                    database: await this.getDatabaseMetrics(),
                    workers: this.getWorkerMetrics()
                };
                
                res.json(metrics);
            } catch (error) {
                console.error('Failed to collect metrics:', error);
                res.status(500).json({ 
                    error: 'Failed to collect metrics',
                    details: error.message 
                });
            }
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('New WebSocket client connected');
            this.clients.add(ws);
            
            // Send current active pipelines to new client
            ws.send(JSON.stringify({
                type: 'initial_state',
                pipelines: Array.from(this.activePipelines.entries()).map(([id, data]) => ({
                    pipelineId: id,
                    ...data
                }))
            }));
            
            ws.on('close', () => {
                console.log('WebSocket client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.clients.delete(ws);
            });
        });
    }

    generatePipelineId() {
        return `pipeline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async startPipelineAsync(pipelineId, targetDirectory) {
        const ProductionAgentFactory = require('./productionAgentFactory');
        const factory = new ProductionAgentFactory();
        
        const pipelineStatus = {
            pipelineId: pipelineId,
            targetDirectory: targetDirectory,
            status: 'starting',
            phase: 'initialization',
            startTime: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            progress: {
                entityScout: { status: 'pending', filesProcessed: 0, entitiesFound: 0 },
                graphBuilder: { status: 'pending', nodesCreated: 0, relationshipsCreated: 0 },
                relationshipResolver: { status: 'pending', relationshipsResolved: 0, confidenceScore: 0 }
            },
            logs: []
        };
        
        this.activePipelines.set(pipelineId, pipelineStatus);
        this.broadcastUpdate(pipelineId, pipelineStatus);
        
        try {
            // Phase 1: Clear databases
            this.updatePipelineStatus(pipelineId, {
                phase: 'clearing_databases',
                status: 'running'
            }, '🗑️  Phase 1: Clearing databases for fresh start...');
            
            await factory.clearAllDatabases();
            this.updatePipelineStatus(pipelineId, {}, '✅ Databases cleared and schema initialized');
            
            // Phase 2: Test connections
            this.updatePipelineStatus(pipelineId, {
                phase: 'testing_connections'
            }, '🔗 Phase 2: Testing database and API connections...');
            
            const connections = await factory.testConnections();
            if (!connections.sqlite || !connections.deepseek || !connections.neo4j) {
                throw new Error('Required connections failed');
            }
            this.updatePipelineStatus(pipelineId, {}, '✅ All connections verified');
            
            // Phase 3: Run EntityScout
            this.updatePipelineStatus(pipelineId, {
                phase: 'entity_scout',
                'progress.entityScout.status': 'running'
            }, `🔍 Phase 3: Starting EntityScout analysis of ${targetDirectory}...`);
            
            const entityScout = await factory.createEntityScout(targetDirectory);
            await entityScout.run();
            
            // Get EntityScout results
            const db = await factory.getSqliteConnection();
            const entityReports = await db.all("SELECT COUNT(*) as count FROM entity_reports");
            const totalFiles = await db.all("SELECT COUNT(*) as count FROM files");
            
            this.updatePipelineStatus(pipelineId, {
                'progress.entityScout.status': 'completed',
                'progress.entityScout.filesProcessed': totalFiles[0].count,
                'progress.entityScout.entitiesFound': entityReports[0].count
            }, `✅ Phase 3 Complete: Processed ${totalFiles[0].count} files, found ${entityReports[0].count} entities`);
            
            // Phase 4: Run GraphBuilder
            this.updatePipelineStatus(pipelineId, {
                phase: 'graph_builder',
                'progress.graphBuilder.status': 'running'
            }, `🏗️ Phase 4: Starting GraphBuilder to create knowledge graph...`);
            
            const graphBuilder = await factory.createGraphBuilder();
            await graphBuilder.run();
            
            // Get GraphBuilder results from Neo4j
            const neo4jDriver = require('./neo4jDriver');
            const session = neo4jDriver.session();
            const txConfig = {
                timeout: 30000, // 30 seconds for count queries
                metadata: { operation: 'count-nodes-relationships' }
            };
            
            try {
                const [nodeResult, relationshipResult] = await session.readTransaction(async (tx) => {
                    const nodeRes = await tx.run('MATCH (n) RETURN count(n) as count');
                    const relRes = await tx.run('MATCH ()-[r]->() RETURN count(r) as count');
                    return [nodeRes, relRes];
                }, txConfig);
                
                const nodeCount = nodeResult.records[0].get('count').toNumber();
                const relationshipCount = relationshipResult.records[0].get('count').toNumber();
                
                this.updatePipelineStatus(pipelineId, {
                    'progress.graphBuilder.status': 'completed',
                    'progress.graphBuilder.nodesCreated': nodeCount,
                    'progress.graphBuilder.relationshipsCreated': relationshipCount
                }, `✅ Phase 4 Complete: Created ${nodeCount} nodes and ${relationshipCount} relationships`);
            } finally {
                await session.close();
            }
            
            // Phase 5: Run RelationshipResolver
            this.updatePipelineStatus(pipelineId, {
                phase: 'relationship_resolver',
                'progress.relationshipResolver.status': 'running'
            }, '🔗 Phase 5: Starting RelationshipResolver for cognitive triangulation...');
            
            const relationshipResolver = await factory.createRelationshipResolver();
            await relationshipResolver.run();
            
            // Get final relationship count
            const session2 = neo4jDriver.session();
            const txConfig2 = {
                timeout: 30000, // 30 seconds for count query
                metadata: { operation: 'count-final-relationships' }
            };
            
            try {
                const finalRelationshipResult = await session2.readTransaction(async (tx) => {
                    return await tx.run('MATCH ()-[r]->() RETURN count(r) as count');
                }, txConfig2);
                const finalRelationshipCount = finalRelationshipResult.records[0].get('count').toNumber();
                
                this.updatePipelineStatus(pipelineId, {
                    'progress.relationshipResolver.status': 'completed',
                    'progress.relationshipResolver.relationshipsResolved': finalRelationshipCount,
                    'progress.relationshipResolver.confidenceScore': 95 // Placeholder for actual confidence scoring
                }, `✅ Phase 5 Complete: Resolved ${finalRelationshipCount} total relationships with cognitive triangulation`);
            } finally {
                await session2.close();
            }
            
            // Pipeline completed
            this.updatePipelineStatus(pipelineId, {
                status: 'completed',
                phase: 'completed',
                endTime: new Date().toISOString()
            }, '🎉 Cognitive triangulation pipeline completed successfully!');
            
        } catch (error) {
            console.error(`Pipeline ${pipelineId} failed:`, error);
            this.updatePipelineStatus(pipelineId, {
                status: 'failed',
                phase: 'failed',
                error: error.message,
                endTime: new Date().toISOString()
            }, `❌ Pipeline failed: ${error.message}`);
        } finally {
            await factory.cleanup();
        }
    }

    updatePipelineStatus(pipelineId, updates, logMessage = null) {
        const pipeline = this.activePipelines.get(pipelineId);
        if (!pipeline) return;
        
        // Apply nested updates
        Object.keys(updates).forEach(key => {
            if (key.includes('.')) {
                const parts = key.split('.');
                let target = pipeline;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!target[parts[i]]) target[parts[i]] = {};
                    target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = updates[key];
            } else {
                pipeline[key] = updates[key];
            }
        });
        
        pipeline.lastUpdate = new Date().toISOString();
        
        if (logMessage) {
            // Log to console for real-time monitoring
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [${pipelineId}] ${logMessage}`);
            
            pipeline.logs.push({
                timestamp: timestamp,
                message: logMessage
            });
            
            // Keep only last 50 log entries
            if (pipeline.logs.length > 50) {
                pipeline.logs = pipeline.logs.slice(-50);
            }
        }
        
        this.broadcastUpdate(pipelineId, pipeline);
    }

    broadcastUpdate(pipelineId, pipelineData) {
        const message = JSON.stringify({
            type: 'pipeline_update',
            pipelineId: pipelineId,
            data: pipelineData
        });
        
        this.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                client.send(message);
            }
        });
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`🚀 Cognitive Triangulation Pipeline API Server running on http://localhost:${this.port}`);
            console.log(`📡 WebSocket server ready for real-time updates`);
            console.log(`\n📋 Available endpoints:`);
            console.log(`   POST /api/pipeline/start - Start cognitive triangulation pipeline`);
            console.log(`   GET  /api/pipeline/status/:id - Get pipeline status`);
            console.log(`   GET  /api/pipeline/active - List active pipelines`);
            console.log(`   POST /api/pipeline/stop/:id - Stop pipeline`);
            console.log(`   DELETE /api/pipeline/clear/:id - Clear pipeline history`);
            console.log(`   GET  /health - Health check`);
            console.log(`   GET  /metrics - System and performance metrics for monitoring tools`);
        });

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down Pipeline API Server...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Shutting down Pipeline API Server...');
            this.shutdown();
        });
    }

    shutdown() {
        console.log('Closing WebSocket connections...');
        this.clients.forEach(client => {
            client.close();
        });
        this.clients.clear();
        
        console.log('Stopping performance monitor...');
        if (this.performanceMonitor) {
            this.performanceMonitor.stopMonitoring();
        }
        
        console.log('Closing server...');
        this.server.close();
        
        console.log('Pipeline API Server shutdown complete');
        process.exit(0);
    }

    // Helper methods for metrics collection

    getSystemMetrics() {
        const cpus = os.cpus();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryUsage = process.memoryUsage();

        return {
            cpu: {
                count: cpus.length,
                model: cpus[0]?.model || 'Unknown',
                usage: this.calculateCPUUsage(),
                loadAverage: os.loadavg()
            },
            memory: {
                total: Math.round(totalMemory / (1024 * 1024)), // MB
                free: Math.round(freeMemory / (1024 * 1024)), // MB
                used: Math.round(usedMemory / (1024 * 1024)), // MB
                usagePercent: ((usedMemory / totalMemory) * 100).toFixed(2),
                process: {
                    rss: Math.round(memoryUsage.rss / (1024 * 1024)), // MB
                    heapTotal: Math.round(memoryUsage.heapTotal / (1024 * 1024)), // MB
                    heapUsed: Math.round(memoryUsage.heapUsed / (1024 * 1024)), // MB
                    external: Math.round(memoryUsage.external / (1024 * 1024)) // MB
                }
            },
            disk: this.getDiskUsage(),
            uptime: {
                system: os.uptime(),
                process: process.uptime()
            },
            platform: {
                type: os.type(),
                platform: os.platform(),
                release: os.release(),
                hostname: os.hostname()
            }
        };
    }

    calculateCPUUsage() {
        // Simple CPU usage calculation
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });

        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);

        return {
            percent: usage,
            cores: cpus.map((cpu, i) => ({
                core: i,
                model: cpu.model,
                speed: cpu.speed
            }))
        };
    }

    getDiskUsage() {
        // Note: This is a placeholder. Real implementation would need platform-specific code
        // or a library like 'diskusage' for accurate disk metrics
        return {
            note: 'Disk metrics require platform-specific implementation',
            available: true
        };
    }

    getPipelineStatusCounts() {
        const counts = {
            running: 0,
            completed: 0,
            failed: 0,
            starting: 0,
            stopping: 0
        };

        this.activePipelines.forEach(pipeline => {
            const status = pipeline.status || 'unknown';
            if (counts.hasOwnProperty(status)) {
                counts[status]++;
            }
        });

        return counts;
    }

    async getQueueMetrics() {
        if (!this.queueManager) {
            return {
                available: false,
                message: 'Queue manager not initialized'
            };
        }

        try {
            // This would depend on the actual QueueManager implementation
            return {
                available: true,
                queues: {
                    // Placeholder - actual implementation would query queue manager
                    fileAnalysis: { waiting: 0, active: 0, completed: 0 },
                    relationshipResolution: { waiting: 0, active: 0, completed: 0 },
                    graphBuilder: { waiting: 0, active: 0, completed: 0 }
                }
            };
        } catch (error) {
            return {
                available: false,
                error: error.message
            };
        }
    }

    async getDatabaseMetrics() {
        const metrics = {
            sqlite: { connected: false },
            neo4j: { connected: false }
        };

        try {
            // Check SQLite connection
            const ProductionAgentFactory = require('./productionAgentFactory');
            const factory = new ProductionAgentFactory();
            const db = await factory.getSqliteConnection();
            
            if (db) {
                metrics.sqlite.connected = true;
                
                // Get basic stats
                try {
                    const [fileCount] = await db.all("SELECT COUNT(*) as count FROM files");
                    const [entityCount] = await db.all("SELECT COUNT(*) as count FROM entity_reports");
                    const [jobCount] = await db.all("SELECT COUNT(*) as count FROM jobs");
                    
                    metrics.sqlite.stats = {
                        files: fileCount.count,
                        entities: entityCount.count,
                        jobs: jobCount.count
                    };
                } catch (e) {
                    metrics.sqlite.error = e.message;
                }
            }

            // Check Neo4j connection
            try {
                const neo4jDriver = require('./neo4jDriver');
                const session = neo4jDriver.session();
                const result = await session.run('RETURN 1 as test');
                await session.close();
                
                if (result) {
                    metrics.neo4j.connected = true;
                    
                    // Get basic stats
                    const session2 = neo4jDriver.session();
                    try {
                        const nodeResult = await session2.run('MATCH (n) RETURN count(n) as count');
                        const relResult = await session2.run('MATCH ()-[r]->() RETURN count(r) as count');
                        
                        metrics.neo4j.stats = {
                            nodes: nodeResult.records[0].get('count').toNumber(),
                            relationships: relResult.records[0].get('count').toNumber()
                        };
                    } catch (e) {
                        metrics.neo4j.error = e.message;
                    } finally {
                        await session2.close();
                    }
                }
            } catch (error) {
                metrics.neo4j.error = error.message;
            }
        } catch (error) {
            console.error('Error collecting database metrics:', error);
        }

        return metrics;
    }

    getWorkerMetrics() {
        // Placeholder for worker metrics
        return {
            available: false,
            message: 'Worker metrics not yet implemented',
            suggestion: 'Integrate with worker pool manager for detailed metrics'
        };
    }
}

// Start the service if this file is run directly
if (require.main === module) {
    const service = new PipelineApiService();
    service.start();
}

module.exports = PipelineApiService; 