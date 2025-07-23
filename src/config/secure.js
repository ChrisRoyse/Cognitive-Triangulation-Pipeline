/**
 * Secure Configuration Manager
 * 
 * This module handles all configuration with security best practices:
 * - Validates required environment variables
 * - Provides secure defaults
 * - Prevents startup with insecure configurations
 * - Centralizes all configuration logic
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

class SecureConfig {
    constructor() {
        this.environment = process.env.NODE_ENV || 'development';
        this.validateEnvironment();
        this.validateRequiredVars();
        this.validateSecurityConstraints();
    }

    validateEnvironment() {
        const validEnvs = ['development', 'test', 'production'];
        if (!validEnvs.includes(this.environment)) {
            console.error(`❌ Invalid NODE_ENV: ${this.environment}. Must be one of: ${validEnvs.join(', ')}`);
            process.exit(1);
        }
    }

    validateRequiredVars() {
        const requiredVars = this.getRequiredVars();
        const missing = requiredVars.filter(key => !process.env[key] || process.env[key].trim() === '');
        
        if (missing.length > 0) {
            console.error('❌ Missing required environment variables:');
            missing.forEach(key => {
                console.error(`   - ${key}`);
            });
            console.error('\n💡 Copy .env.example to .env and fill in the required values.');
            process.exit(1);
        }
    }

    getRequiredVars() {
        const baseRequired = ['DEEPSEEK_API_KEY'];
        
        if (this.environment === 'production') {
            return [...baseRequired, 'NEO4J_PASSWORD'];
        }
        
        return baseRequired;
    }

    validateSecurityConstraints() {
        // Validate API key format
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey.startsWith('sk-')) {
            console.error('❌ Invalid DEEPSEEK_API_KEY format. Must start with "sk-"');
            process.exit(1);
        }

        // Validate password strength in production
        if (this.environment === 'production') {
            const neo4jPassword = process.env.NEO4J_PASSWORD;
            if (neo4jPassword === 'password' || neo4jPassword === 'ChangeMeInProduction' || neo4jPassword.length < 12) {
                console.error('❌ Neo4j password is too weak for production environment.');
                console.error('   Password must be at least 12 characters and not use default values.');
                process.exit(1);
            }
        }

        // Validate file paths
        this.validatePaths();
    }

    validatePaths() {
        const sqlitePath = this.database.sqlite.path;
        const sqliteDir = path.dirname(sqlitePath);
        
        // Ensure SQLite directory exists or can be created
        try {
            if (!fs.existsSync(sqliteDir)) {
                fs.mkdirSync(sqliteDir, { recursive: true });
            }
        } catch (error) {
            console.error(`❌ Cannot create SQLite directory: ${sqliteDir}`, error);
            process.exit(1);
        }
    }

    get database() {
        return {
            sqlite: {
                path: process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'database.db'),
                options: {
                    verbose: this.environment === 'development' ? console.log : undefined,
                    readonly: false,
                    fileMustExist: false
                }
            },
            neo4j: {
                uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
                user: process.env.NEO4J_USER || 'neo4j',
                password: process.env.NEO4J_PASSWORD || (this.environment === 'development' ? 'password' : undefined),
                database: process.env.NEO4J_DATABASE || 'ctp',
                maxConnectionPoolSize: parseInt(process.env.NEO4J_MAX_POOL_SIZE) || 50,
                connectionTimeout: parseInt(process.env.NEO4J_CONNECTION_TIMEOUT) || 30000
            },
            redis: {
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: true,
                connectTimeout: 10000,
                commandTimeout: 5000,
                family: 4
            }
        };
    }

    get llm() {
        return {
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
            maxConcurrency: parseInt(process.env.LLM_MAX_CONCURRENCY) || 10,
            timeout: parseInt(process.env.LLM_TIMEOUT_MS) || 30000,
            maxRetries: parseInt(process.env.LLM_MAX_RETRIES) || 3,
            retryDelay: parseInt(process.env.LLM_RETRY_DELAY_MS) || 1000
        };
    }

    get application() {
        return {
            port: parseInt(process.env.APP_PORT) || 3002,
            logLevel: process.env.LOG_LEVEL || 'info',
            maxWorkers: parseInt(process.env.MAX_WORKERS) || 10,
            batchSize: parseInt(process.env.BATCH_SIZE) || 50,
            sourceDirectory: process.env.SOURCE_DIR || './polyglot-test',
            maxFileSize: parseInt(process.env.MAX_FILE_SIZE_MB) || 10, // MB
            maxFiles: parseInt(process.env.MAX_FILES) || 1000,
            processingTimeout: parseInt(process.env.PROCESSING_TIMEOUT_MS) || 300000, // 5 minutes
            healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 30000
        };
    }

    get queues() {
        return {
            names: [
                'file-analysis-queue',
                'directory-aggregation-queue', 
                'directory-resolution-queue',
                'relationship-resolution-queue',
                'reconciliation-queue',
                'failed-jobs',
                'analysis-findings-queue',
                'global-resolution-queue',
                'relationship-validated-queue'
            ],
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
                removeOnComplete: 100,
                removeOnFail: 50
            },
            workerOptions: {
                concurrency: this.application.maxWorkers,
                maxStalledCount: 1,
                stalledInterval: 30000
            }
        };
    }

    get monitoring() {
        return {
            prometheus: {
                port: parseInt(process.env.PROMETHEUS_PORT) || 9090,
                enabled: process.env.PROMETHEUS_ENABLED === 'true' || this.environment === 'production'
            },
            metrics: {
                collectInterval: parseInt(process.env.METRICS_INTERVAL_MS) || 10000,
                retentionDays: parseInt(process.env.METRICS_RETENTION_DAYS) || 7
            }
        };
    }

    // Get configuration summary for logging (without secrets)
    getSummary() {
        return {
            environment: this.environment,
            database: {
                sqlite: { path: this.database.sqlite.path },
                neo4j: { 
                    uri: this.database.neo4j.uri,
                    user: this.database.neo4j.user,
                    database: this.database.neo4j.database
                },
                redis: { url: this.database.redis.url }
            },
            application: this.application,
            llm: {
                baseURL: this.llm.baseURL,
                maxConcurrency: this.llm.maxConcurrency,
                timeout: this.llm.timeout
            }
        };
    }
}

// Export singleton instance
module.exports = new SecureConfig();