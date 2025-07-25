const { v4: uuidv4 } = require('uuid');
const os = require('os');

/**
 * Enhanced Pipeline Error with comprehensive context and correlation support
 */
class PipelineError extends Error {
    constructor(options) {
        // Handle both string and object constructors
        if (typeof options === 'string') {
            options = { message: options };
        }

        super(options.message || 'Pipeline error occurred');
        
        this.name = 'PipelineError';
        this.type = options.type || 'UNKNOWN_ERROR';
        this.code = options.code || null;
        this.timestamp = new Date().toISOString();
        this.correlationId = options.correlationId || uuidv4();
        
        // Context information for debugging
        this.context = {
            ...options.context,
            type: this.type,
            correlationId: this.correlationId,
            timestamp: this.timestamp,
            
            // Worker context (if applicable)
            workerId: options.workerId || options.context?.workerId,
            workerType: options.workerType || options.context?.workerType,
            
            // Job context (if applicable)
            jobId: options.jobId || options.context?.jobId,
            jobType: options.jobType || options.context?.jobType,
            
            // Pipeline context
            runId: options.runId || options.context?.runId,
            stage: options.stage || options.context?.stage,
            
            // Timing information
            duration: options.duration || options.context?.duration,
            retryCount: options.retryCount || options.context?.retryCount || 0,
            
            // System context
            processId: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            
            // Original error details (if wrapping)
            originalError: options.originalError ? {
                message: options.originalError.message,
                name: options.originalError.name,
                code: options.originalError.code,
                stack: options.originalError.stack
            } : null
        };
        
        // Metrics for analysis
        this.metrics = {
            category: this._categorizeError(),
            severity: this._determineSeverity(),
            recoverable: this._isRecoverable(),
            requiresImmedateAttention: this._requiresImmediateAttention()
        };
        
        // Ensure stack trace is captured
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PipelineError);
        }
    }

    /**
     * Categorize error based on type and context
     */
    _categorizeError() {
        const type = this.type.toUpperCase();
        
        // Infrastructure errors
        if (type.includes('CONNECTION') || type.includes('NETWORK') || 
            type.includes('REDIS') || type.includes('NEO4J') || type.includes('DATABASE')) {
            return 'INFRASTRUCTURE';
        }
        
        // Worker/Processing errors
        if (type.includes('WORKER') || type.includes('PROCESSING') || 
            type.includes('JOB') || type.includes('QUEUE')) {
            return 'PROCESSING';
        }
        
        // API/LLM errors
        if (type.includes('API') || type.includes('LLM') || type.includes('RATE_LIMIT') ||
            this.code === 429 || this.code === 'ECONNRESET') {
            return 'API';
        }
        
        // Validation/Data errors
        if (type.includes('VALIDATION') || type.includes('SCHEMA') || 
            type.includes('PARSE') || type.includes('FORMAT')) {
            return 'VALIDATION';
        }
        
        // System/Resource errors
        if (type.includes('MEMORY') || type.includes('CPU') || type.includes('DISK') ||
            type.includes('TIMEOUT') || type.includes('RESOURCE')) {
            return 'SYSTEM';
        }
        
        // Configuration errors
        if (type.includes('CONFIG') || type.includes('AUTH') || type.includes('PERMISSION')) {
            return 'CONFIGURATION';
        }
        
        return 'UNKNOWN';
    }

    /**
     * Determine error severity level
     */
    _determineSeverity() {
        const type = this.type.toUpperCase();
        const category = this.metrics?.category;
        
        // Critical - Pipeline cannot continue
        if (type.includes('FATAL') || type.includes('CRITICAL') || 
            type.includes('SHUTDOWN') || category === 'INFRASTRUCTURE') {
            return 'CRITICAL';
        }
        
        // High - Significant impact but may be recoverable
        if (type.includes('WORKER_FAILURE') || type.includes('EXCESSIVE_FAILURES') ||
            type.includes('PIPELINE_TIMEOUT') || category === 'SYSTEM') {
            return 'HIGH';
        }
        
        // Medium - Affects processing but not critical
        if (type.includes('API') || type.includes('VALIDATION') || 
            type.includes('RATE_LIMIT') || category === 'PROCESSING') {
            return 'MEDIUM';
        }
        
        // Low - Minor issues that can be retried
        if (type.includes('RETRY') || type.includes('TEMPORARY') ||
            this.context?.retryCount > 0) {
            return 'LOW';
        }
        
        return 'MEDIUM';
    }

    /**
     * Determine if error is likely recoverable
     */
    _isRecoverable() {
        const type = this.type.toUpperCase();
        const category = this.metrics?.category;
        
        // Generally non-recoverable
        if (type.includes('FATAL') || type.includes('PERMISSION') || 
            type.includes('AUTH') || type.includes('CONFIG')) {
            return false;
        }
        
        // Infrastructure issues might be recoverable
        if (category === 'INFRASTRUCTURE' || category === 'API') {
            return true;
        }
        
        // Processing errors usually recoverable with retry
        if (category === 'PROCESSING' || category === 'VALIDATION') {
            return true;
        }
        
        // System errors depend on severity
        if (category === 'SYSTEM') {
            return this.metrics?.severity !== 'CRITICAL';
        }
        
        return true;
    }

    /**
     * Determine if error requires immediate attention
     */
    _requiresImmediateAttention() {
        return this.metrics?.severity === 'CRITICAL' || 
               this.type.includes('SECURITY') ||
               this.type.includes('DATA_LOSS') ||
               (this.context?.retryCount > 3 && !this._isRecoverable());
    }

    /**
     * Create a correlation chain for related errors
     */
    correlateWith(parentError) {
        if (parentError instanceof PipelineError) {
            this.context.parentCorrelationId = parentError.correlationId;
            this.context.errorChain = [
                ...(parentError.context.errorChain || []),
                {
                    correlationId: parentError.correlationId,
                    type: parentError.type,
                    timestamp: parentError.timestamp
                }
            ];
        }
        return this;
    }

    /**
     * Add additional context after creation
     */
    addContext(additionalContext) {
        this.context = {
            ...this.context,
            ...additionalContext
        };
        return this;
    }

    /**
     * Get structured log object for logging
     */
    toLogObject() {
        return {
            error: this.message,
            errorType: this.name,
            errorCode: this.code,
            errorCategory: this.metrics.category,
            severity: this.metrics.severity,
            correlationId: this.correlationId,
            recoverable: this.metrics.recoverable,
            requiresAttention: this.metrics.requiresImmedateAttention,
            timestamp: this.timestamp,
            context: this.context,
            stack: this.stack
        };
    }

    /**
     * Get metrics object for monitoring
     */
    toMetricsObject() {
        return {
            type: this.type,
            category: this.metrics.category,
            severity: this.metrics.severity,
            correlationId: this.correlationId,
            workerId: this.context.workerId,
            workerType: this.context.workerType,
            jobId: this.context.jobId,
            runId: this.context.runId,
            duration: this.context.duration,
            retryCount: this.context.retryCount,
            recoverable: this.metrics.recoverable,
            timestamp: this.timestamp,
            processId: this.context.processId
        };
    }

    /**
     * Generate action suggestions based on error type
     */
    getActionSuggestions() {
        const suggestions = [];
        const type = this.type.toUpperCase();
        const category = this.metrics.category;

        switch (category) {
            case 'INFRASTRUCTURE':
                suggestions.push('Check service connectivity and configuration');
                suggestions.push('Verify Redis and Neo4j services are running');
                suggestions.push('Check network connectivity and firewall settings');
                break;
                
            case 'API':
                suggestions.push('Check API rate limits and quotas');
                suggestions.push('Verify API credentials and permissions');
                suggestions.push('Consider implementing exponential backoff');
                break;
                
            case 'PROCESSING':
                suggestions.push('Review job data and processing logic');
                suggestions.push('Check worker health and resource availability');
                suggestions.push('Consider adjusting concurrency settings');
                break;
                
            case 'VALIDATION':
                suggestions.push('Review input data format and schema');
                suggestions.push('Check data transformation logic');
                suggestions.push('Verify data integrity and completeness');
                break;
                
            case 'SYSTEM':
                suggestions.push('Check system resources (CPU, memory, disk)');
                suggestions.push('Review timeout and resource limit settings');
                suggestions.push('Monitor system health metrics');
                break;
                
            case 'CONFIGURATION':
                suggestions.push('Review configuration files and environment variables');
                suggestions.push('Check file and directory permissions');
                suggestions.push('Verify authentication and authorization settings');
                break;
                
            default:
                suggestions.push('Review error details and system logs');
                suggestions.push('Check all services are running and properly configured');
        }

        // Add specific suggestions based on error type
        if (type.includes('TIMEOUT')) {
            suggestions.push('Consider increasing timeout values');
            suggestions.push('Check for blocking operations or deadlocks');
        }
        
        if (type.includes('MEMORY')) {
            suggestions.push('Monitor memory usage and consider increasing limits');
            suggestions.push('Check for memory leaks in worker processes');
        }
        
        if (this.context.retryCount > 0) {
            suggestions.push(`This is retry attempt ${this.context.retryCount} - consider alternative approach if retries continue failing`);
        }

        return suggestions;
    }

    /**
     * Static factory methods for common error types
     */
    static workerFailure(workerId, workerType, jobId, originalError, additionalContext = {}) {
        return new PipelineError({
            type: 'WORKER_FAILURE',
            message: `Worker ${workerType} (${workerId}) failed processing job ${jobId}: ${originalError?.message}`,
            workerId,
            workerType,
            jobId,
            originalError,
            context: additionalContext
        });
    }

    static timeout(operation, duration, context = {}) {
        return new PipelineError({
            type: 'OPERATION_TIMEOUT',
            message: `Operation '${operation}' timed out after ${duration}ms`,
            duration,
            context: {
                ...context,
                operation,
                timeoutDuration: duration
            }
        });
    }

    static circuitBreakerOpen(service, failureCount, context = {}) {
        return new PipelineError({
            type: 'CIRCUIT_BREAKER_OPEN',
            message: `Circuit breaker opened for service '${service}' after ${failureCount} failures`,
            context: {
                ...context,
                service,
                failureCount
            }
        });
    }

    static validationFailure(validationType, details, context = {}) {
        return new PipelineError({
            type: 'VALIDATION_FAILURE',
            message: `Validation failed: ${validationType}`,
            context: {
                ...context,
                validationType,
                validationDetails: details
            }
        });
    }

    static apiError(apiName, statusCode, responseText, context = {}) {
        return new PipelineError({
            type: 'API_ERROR',
            message: `API call to ${apiName} failed with status ${statusCode}`,
            code: statusCode,
            context: {
                ...context,
                apiName,
                statusCode,
                responseText
            }
        });
    }

    static databaseError(operation, database, originalError, context = {}) {
        return new PipelineError({
            type: 'DATABASE_ERROR',
            message: `Database operation '${operation}' failed on ${database}: ${originalError?.message}`,
            originalError,
            context: {
                ...context,
                operation,
                database
            }
        });
    }
}

module.exports = { PipelineError };