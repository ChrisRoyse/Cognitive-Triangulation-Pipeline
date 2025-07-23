const { getLogger, generateCorrelationId } = require('../config/logging');

/**
 * API Logging Middleware
 * 
 * This module provides middleware for logging HTTP API requests and responses
 * with proper sanitization of sensitive data and performance tracking.
 */

class APILoggingMiddleware {
    constructor(serviceName = 'API') {
        this.logger = getLogger(`${serviceName}Middleware`);
        this.sensitiveHeaders = new Set([
            'authorization',
            'x-api-key',
            'cookie',
            'set-cookie',
            'x-auth-token',
            'x-csrf-token'
        ]);
        this.sensitiveFields = new Set([
            'password',
            'token',
            'apiKey',
            'secret',
            'creditCard',
            'ssn'
        ]);
    }

    /**
     * Express middleware for logging requests and responses
     */
    expressMiddleware() {
        return (req, res, next) => {
            const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
            const logger = this.logger.child(correlationId);
            const timer = logger.startTimer('api-request', correlationId);
            
            // Attach logger to request for use in route handlers
            req.logger = logger;
            req.correlationId = correlationId;
            
            // Log request
            logger.info('Incoming request', {
                method: req.method,
                path: req.path,
                query: this.sanitizeObject(req.query),
                headers: this.sanitizeHeaders(req.headers),
                ip: req.ip,
                userAgent: req.get('user-agent')
            });

            // Capture response
            const originalSend = res.send;
            res.send = function(body) {
                res.body = body;
                return originalSend.call(this, body);
            };

            // Log response when finished
            res.on('finish', () => {
                const metrics = timer.end('Request completed');
                
                logger.logApiCall(
                    req.method,
                    req.path,
                    res.statusCode,
                    metrics.duration,
                    {
                        responseSize: res.get('content-length'),
                        correlationId
                    }
                );

                // Log error details for 4xx and 5xx responses
                if (res.statusCode >= 400) {
                    logger.error('Request failed', null, {
                        statusCode: res.statusCode,
                        method: req.method,
                        path: req.path,
                        error: res.body
                    });
                }
            });

            next();
        };
    }

    /**
     * Generic HTTP client request logger
     */
    logHttpRequest(options, correlationId = null) {
        const logger = correlationId ? this.logger.child(correlationId) : this.logger;
        const timer = logger.startTimer('http-request', correlationId);
        
        logger.info('Outgoing HTTP request', {
            method: options.method || 'GET',
            url: options.url || options.uri,
            headers: this.sanitizeHeaders(options.headers)
        });

        return {
            logResponse: (response, error = null) => {
                const metrics = timer.end('HTTP request completed');
                
                if (error) {
                    logger.error('HTTP request failed', error, {
                        method: options.method || 'GET',
                        url: options.url || options.uri,
                        duration: metrics.duration
                    });
                } else {
                    logger.logApiCall(
                        options.method || 'GET',
                        options.url || options.uri,
                        response.statusCode,
                        metrics.duration,
                        {
                            responseHeaders: this.sanitizeHeaders(response.headers),
                            correlationId
                        }
                    );
                }
            }
        };
    }

    /**
     * Sanitize headers to remove sensitive information
     */
    sanitizeHeaders(headers) {
        if (!headers) return {};
        
        const sanitized = {};
        for (const [key, value] of Object.entries(headers)) {
            if (this.sensitiveHeaders.has(key.toLowerCase())) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    /**
     * Sanitize object to remove sensitive fields
     */
    sanitizeObject(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 5) return obj;
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item, depth + 1));
        }
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (this.sensitiveFields.has(key.toLowerCase())) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object') {
                sanitized[key] = this.sanitizeObject(value, depth + 1);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    /**
     * Log GraphQL operations
     */
    logGraphQLOperation(operation, variables, result, duration) {
        const logger = this.logger.child(generateCorrelationId());
        
        logger.info('GraphQL operation', {
            operationType: operation.operation,
            operationName: operation.name?.value,
            variables: this.sanitizeObject(variables),
            duration,
            hasErrors: !!(result.errors && result.errors.length > 0)
        });

        if (result.errors) {
            logger.error('GraphQL errors', null, {
                errors: result.errors,
                operationName: operation.name?.value
            });
        }
    }
}

// Export singleton instance and class
const defaultMiddleware = new APILoggingMiddleware();

module.exports = {
    APILoggingMiddleware,
    expressMiddleware: defaultMiddleware.expressMiddleware.bind(defaultMiddleware),
    logHttpRequest: defaultMiddleware.logHttpRequest.bind(defaultMiddleware),
    logGraphQLOperation: defaultMiddleware.logGraphQLOperation.bind(defaultMiddleware)
};