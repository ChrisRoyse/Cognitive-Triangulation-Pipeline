const https = require('https');
const config = require('../config/secure');
const resourceManager = require('./resourceManager');

/**
 * Optimized LLM Client with Production Features
 * 
 * Key optimizations:
 * - Connection pooling with keep-alive
 * - Circuit breaker pattern
 * - Request queuing with priority
 * - Rate limiting with token bucket
 * - Automatic retry with exponential backoff
 * - Memory-efficient request handling
 * - Health monitoring and metrics
 */
class OptimizedLLMClient {
    constructor() {
        this.baseURL = config.llm.baseURL || 'https://api.deepseek.com';
        this.apiKey = config.llm.apiKey;
        this.timeout = config.llm.timeout || 30000;
        this.maxRetries = config.llm.maxRetries || 3;
        
        // Connection pooling - OPTIMIZED
        this.agent = new https.Agent({
            keepAlive: true,                    // Enable connection reuse
            maxSockets: 20,                     // Max connections per host
            maxFreeSockets: 5,                  // Keep 5 connections idle
            timeout: 60000,                     // Socket timeout
            freeSocketTimeout: 30000,           // How long to keep idle sockets
            scheduling: 'fifo'                  // Fair scheduling
        });
        
        // Concurrency and rate limiting
        this.maxConcurrentRequests = config.llm.maxConcurrency || 10;
        this.activeRequests = 0;
        this.requestQueue = [];
        
        // Circuit breaker
        this.circuitBreaker = {
            failures: 0,
            maxFailures: 5,
            resetTime: 60000, // 1 minute
            state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
            lastFailureTime: null
        };
        
        // Rate limiting - Token bucket algorithm
        this.rateLimiter = {
            tokens: 100,               // Current tokens
            maxTokens: 100,            // Bucket capacity
            refillRate: 10,            // Tokens per second
            lastRefill: Date.now()
        };
        
        // Statistics and monitoring
        this.stats = {
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                retries: 0,
                circuitBreakerHits: 0
            },
            timing: {
                total: 0,
                average: 0,
                min: Infinity,
                max: 0
            },
            rateLimiting: {
                tokensConsumed: 0,
                requestsQueued: 0,
                requestsRejected: 0
            },
            errors: new Map(),
            startTime: Date.now()
        };
        
        // Setup token bucket refill
        this.startTokenRefill();
        
        // Register for cleanup
        resourceManager.register('OptimizedLLMClient', this);
        
        console.log('🚀 OptimizedLLMClient initialized with connection pooling');
    }

    /**
     * Start token bucket refill process
     */
    startTokenRefill() {
        this.refillInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = now - this.rateLimiter.lastRefill;
            const tokensToAdd = Math.floor((elapsed / 1000) * this.rateLimiter.refillRate);
            
            if (tokensToAdd > 0) {
                this.rateLimiter.tokens = Math.min(
                    this.rateLimiter.maxTokens,
                    this.rateLimiter.tokens + tokensToAdd
                );
                this.rateLimiter.lastRefill = now;
            }
        }, 1000);
    }

    /**
     * Main query method with all optimizations
     */
    async queryLLM(prompt, options = {}) {
        const startTime = Date.now();
        
        try {
            // Check circuit breaker
            if (this.isCircuitBreakerOpen()) {
                this.stats.requests.circuitBreakerHits++;
                throw new Error('Circuit breaker is open - LLM service unavailable');
            }

            // Apply rate limiting
            await this.acquireToken();
            
            // Queue request if at concurrency limit
            await this.waitForSlot();

            this.activeRequests++;
            this.stats.requests.total++;

            // Execute request with retries
            const result = await this.executeWithRetry(prompt, options);
            
            // Update success statistics
            this.stats.requests.successful++;
            this.updateTiming(Date.now() - startTime);
            this.circuitBreakerSuccess();
            
            return result;
            
        } catch (error) {
            this.stats.requests.failed++;
            this.circuitBreakerFailure();
            this.recordError(error);
            throw error;
        } finally {
            this.activeRequests--;
            this.processQueue();
        }
    }

    /**
     * Execute request with retry logic and exponential backoff
     */
    async executeWithRetry(prompt, options, attempt = 1) {
        try {
            return await this.makeRequest(prompt, options);
        } catch (error) {
            if (attempt >= this.maxRetries) {
                throw error;
            }

            // Check if error is retryable
            if (!this.isRetryableError(error)) {
                throw error;
            }

            this.stats.requests.retries++;
            
            // Exponential backoff with jitter
            const baseDelay = Math.pow(2, attempt) * 1000;
            const jitter = Math.random() * 1000;
            const delay = baseDelay + jitter;
            
            console.warn(`⚠️  LLM request failed (attempt ${attempt}/${this.maxRetries}), retrying in ${Math.round(delay)}ms:`, error.message);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.executeWithRetry(prompt, options, attempt + 1);
        }
    }

    /**
     * Make the actual HTTP request
     */
    async makeRequest(prompt, options) {
        const requestBody = JSON.stringify({
            model: options.model || 'deepseek-chat',
            messages: this.formatMessages(prompt),
            temperature: options.temperature || 0.1,
            max_tokens: options.maxTokens || 8000,
            stream: false,
            response_format: { type: 'json_object' }
        });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'api.deepseek.com',
                port: 443,
                path: '/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody),
                    'Authorization': `Bearer ${this.apiKey}`,
                    'User-Agent': 'CTP-OptimizedClient/1.0'
                },
                agent: this.agent,
                timeout: this.timeout
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            const error = new Error(`HTTP ${res.statusCode}: ${data}`);
                            error.statusCode = res.statusCode;
                            error.response = data;
                            reject(error);
                            return;
                        }

                        const response = JSON.parse(data);
                        
                        if (!response.choices || !response.choices[0]) {
                            reject(new Error('Invalid response format from LLM API'));
                            return;
                        }

                        // Parse JSON content
                        let parsedContent;
                        try {
                            parsedContent = JSON.parse(response.choices[0].message.content);
                        } catch (parseError) {
                            // Fallback: return raw content
                            parsedContent = { raw: response.choices[0].message.content };
                        }

                        resolve({
                            ...parsedContent,
                            usage: response.usage,
                            model: response.model
                        });

                    } catch (error) {
                        reject(new Error(`Failed to parse LLM response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${this.timeout}ms`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Format prompt into messages array
     */
    formatMessages(prompt) {
        if (typeof prompt === 'string') {
            return [
                { role: 'system', content: 'You are a code analysis expert. Provide accurate JSON responses.' },
                { role: 'user', content: prompt }
            ];
        }
        
        if (Array.isArray(prompt)) {
            return prompt;
        }
        
        if (prompt.system && prompt.user) {
            return [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ];
        }
        
        throw new Error('Invalid prompt format');
    }

    /**
     * Rate limiting - acquire token from bucket
     */
    async acquireToken() {
        return new Promise((resolve, reject) => {
            const checkToken = () => {
                if (this.rateLimiter.tokens > 0) {
                    this.rateLimiter.tokens--;
                    this.stats.rateLimiting.tokensConsumed++;
                    resolve();
                } else {
                    // Queue the request
                    this.stats.rateLimiting.requestsQueued++;
                    setTimeout(checkToken, 100); // Check every 100ms
                }
            };
            
            checkToken();
        });
    }

    /**
     * Wait for available concurrency slot
     */
    async waitForSlot() {
        if (this.activeRequests < this.maxConcurrentRequests) {
            return;
        }

        return new Promise((resolve) => {
            this.requestQueue.push(resolve);
        });
    }

    /**
     * Process queued requests
     */
    processQueue() {
        if (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
            const next = this.requestQueue.shift();
            next();
        }
    }

    /**
     * Circuit breaker logic
     */
    isCircuitBreakerOpen() {
        if (this.circuitBreaker.state === 'CLOSED') {
            return false;
        }
        
        if (this.circuitBreaker.state === 'OPEN') {
            const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
            if (timeSinceFailure > this.circuitBreaker.resetTime) {
                this.circuitBreaker.state = 'HALF_OPEN';
                console.log('🔄 Circuit breaker half-open - testing service');
                return false;
            }
            return true;
        }
        
        // HALF_OPEN state - allow one request through
        return false;
    }

    circuitBreakerFailure() {
        this.circuitBreaker.failures++;
        this.circuitBreaker.lastFailureTime = Date.now();
        
        if (this.circuitBreaker.failures >= this.circuitBreaker.maxFailures) {
            this.circuitBreaker.state = 'OPEN';
            console.warn('⚠️  Circuit breaker opened - LLM service marked as unavailable');
        }
    }

    circuitBreakerSuccess() {
        if (this.circuitBreaker.state === 'HALF_OPEN') {
            this.circuitBreaker.state = 'CLOSED';
            this.circuitBreaker.failures = 0;
            console.log('✅ Circuit breaker closed - LLM service recovered');
        }
    }

    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        // Retry on network errors, timeouts, and 5xx status codes
        if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return true;
        }
        
        if (error.statusCode >= 500 && error.statusCode < 600) {
            return true;
        }
        
        if (error.statusCode === 429) { // Rate limited
            return true;
        }
        
        return false;
    }

    /**
     * Record error for analysis
     */
    recordError(error) {
        const errorType = error.statusCode ? `HTTP_${error.statusCode}` : error.code || 'UNKNOWN';
        const count = this.stats.errors.get(errorType) || 0;
        this.stats.errors.set(errorType, count + 1);
    }

    /**
     * Update timing statistics
     */
    updateTiming(duration) {
        this.stats.timing.total += duration;
        this.stats.timing.average = this.stats.timing.total / this.stats.requests.successful;
        this.stats.timing.min = Math.min(this.stats.timing.min, duration);
        this.stats.timing.max = Math.max(this.stats.timing.max, duration);
    }

    /**
     * Get comprehensive statistics
     */
    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        
        return {
            uptime: Math.floor(uptime / 1000), // seconds
            requests: this.stats.requests,
            timing: {
                ...this.stats.timing,
                min: this.stats.timing.min === Infinity ? 0 : this.stats.timing.min
            },
            rateLimiting: {
                ...this.stats.rateLimiting,
                currentTokens: this.rateLimiter.tokens,
                maxTokens: this.rateLimiter.maxTokens
            },
            concurrency: {
                active: this.activeRequests,
                max: this.maxConcurrentRequests,
                queued: this.requestQueue.length
            },
            circuitBreaker: {
                state: this.circuitBreaker.state,
                failures: this.circuitBreaker.failures,
                maxFailures: this.circuitBreaker.maxFailures
            },
            errors: Object.fromEntries(this.stats.errors),
            connectionPool: {
                keepAlive: true,
                maxSockets: this.agent.maxSockets,
                maxFreeSockets: this.agent.maxFreeSockets
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const isCircuitBreakerHealthy = this.circuitBreaker.state !== 'OPEN';
            const hasTokens = this.rateLimiter.tokens > 0;
            const notOverloaded = this.activeRequests < this.maxConcurrentRequests;
            
            return {
                healthy: isCircuitBreakerHealthy && hasTokens && notOverloaded,
                circuit_breaker: this.circuitBreaker.state,
                rate_limit_tokens: this.rateLimiter.tokens,
                active_requests: this.activeRequests,
                stats: this.getStats(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Test connectivity
     */
    async testConnection() {
        try {
            const testPrompt = 'Return JSON: {"test": "ok"}';
            const response = await this.queryLLM(testPrompt, { maxTokens: 100 });
            return { success: true, response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Clean up resources
     */
    async close() {
        // Clear token refill interval
        if (this.refillInterval) {
            clearInterval(this.refillInterval);
        }
        
        // Close connection pool
        this.agent.destroy();
        
        // Clear queues
        this.requestQueue = [];
        
        console.log('✅ OptimizedLLMClient cleaned up');
    }

    /**
     * Reset circuit breaker (manual intervention)
     */
    resetCircuitBreaker() {
        this.circuitBreaker.state = 'CLOSED';
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.lastFailureTime = null;
        console.log('🔄 Circuit breaker manually reset');
    }

    /**
     * Adjust rate limits dynamically
     */
    adjustRateLimit(newMaxTokens, newRefillRate) {
        this.rateLimiter.maxTokens = newMaxTokens;
        this.rateLimiter.refillRate = newRefillRate;
        this.rateLimiter.tokens = Math.min(this.rateLimiter.tokens, newMaxTokens);
        console.log(`📏 Rate limit adjusted: ${newMaxTokens} tokens, ${newRefillRate}/sec refill`);
    }

    /**
     * Adjust concurrency limits
     */
    adjustConcurrency(newMaxConcurrent) {
        this.maxConcurrentRequests = newMaxConcurrent;
        console.log(`👥 Concurrency limit adjusted: ${newMaxConcurrent}`);
    }
}

// Singleton instance
let instance = null;

function getOptimizedLLMClient() {
    if (!instance) {
        instance = new OptimizedLLMClient();
    }
    return instance;
}

module.exports = { OptimizedLLMClient, getOptimizedLLMClient };