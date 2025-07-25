const https = require('https');
require('dotenv').config();
const config = require('../config');
const { getLogger } = require('../config/logging');

/**
 * Pure DeepSeek LLM Client
 * Native implementation using HTTPS requests to DeepSeek API
 * No OpenAI SDK dependencies - fully dynamic, no caching
 */
class DeepSeekClient {
    constructor() {
        this.baseURL = 'https://api.deepseek.com';
        this.timeout = 150000; // 2.5 minute timeout - matching worker LLM call timeouts
        this.agent = new https.Agent({ keepAlive: false, maxSockets: 100 });
        this.maxConcurrentRequests = 4; // Global limit for concurrent requests
        this.activeRequests = 0;
        this.requestQueue = [];
        
        this._apiKey = null;
        this.logger = getLogger('DeepSeekClient');
        
        this.logger.info('DeepSeekClient initialized for dynamic analysis (no caching)', {
            baseURL: this.baseURL,
            timeout: this.timeout,
            maxConcurrentRequests: this.maxConcurrentRequests
        });
    }

    get apiKey() {
        if (!this._apiKey) {
            this._apiKey = config.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
            if (!this._apiKey) {
                throw new Error('DEEPSEEK_API_KEY environment variable is required');
            }
            this.logger.info('DeepSeek API key loaded successfully');
        }
        return this._apiKey;
    }

    async call(prompt, options = {}) {
        const requestBody = JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ],
            temperature: 0.0,
            max_tokens: 8000,
            stream: false,
            response_format: { type: 'json_object' }
        });

        try {
            // Always make fresh API call for dynamic analysis
            this.logger.debug('Making fresh API call for dynamic analysis');
            const response = await this._scheduleRequest('/chat/completions', 'POST', requestBody);
            
            const result = {
                body: response.choices[0].message.content,
                usage: response.usage,
                cached: false
            };
            
            return result;
        } catch (error) {
            this.logger.error('DeepSeek API call failed after retries', error);
            throw new Error(`DeepSeek API call failed: ${error.message}`);
        }
    }

    async query(promptString, options = {}) {
        const prompt = {
            system: 'You are an expert software engineer specializing in code analysis.',
            user: promptString
        };
        const response = await this.call(prompt, options);
        return response.body;
    }

    async createChatCompletion(options, extraOptions = {}) {
        const requestBody = JSON.stringify({
            model: options.model || 'deepseek-chat',
            messages: options.messages,
            temperature: options.temperature || 0.0,
            max_tokens: options.max_tokens || 8000,
            response_format: options.response_format || { type: 'json_object' },
            stream: false
        });

        try {
            // Always make fresh API call for dynamic analysis
            this.logger.debug('createChatCompletion making fresh API call');
            const response = await this._scheduleRequest('/chat/completions', 'POST', requestBody);

            return response;
        } catch (error) {
            this.logger.error('createChatCompletion failed after all retries', error);
            throw error;
        }
    }

    _scheduleRequest(endpoint, method, body) {
        return new Promise((resolve, reject) => {
            this.logger.debug('Scheduling request', {
                activeRequests: this.activeRequests,
                queuedRequests: this.requestQueue.length
            });
            this.requestQueue.push({ endpoint, method, body, resolve, reject });
            this._processQueue();
        });
    }

    _processQueue() {
        if (this.activeRequests >= this.maxConcurrentRequests || this.requestQueue.length === 0) {
            return;
        }

        this.activeRequests++;
        const { endpoint, method, body, resolve, reject } = this.requestQueue.shift();
        
        this.logger.debug('Starting request', {
            activeRequests: this.activeRequests
        });

        this._makeRequestWithRetry(endpoint, method, body)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                this.activeRequests--;
                this.logger.debug('Finished request', {
                    activeRequests: this.activeRequests
                });
                this._processQueue();
            });
    }

    _isRetryableError(error) {
        return error.status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code);
    }

    async _makeRequestWithRetry(endpoint, method, body, retries = 5, delay = 2000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await this._makeRequest(endpoint, method, body);
                return response;
            } catch (error) {
                this.logger.error('Request attempt failed', error, {
                    attempt: i + 1,
                    code: error.code,
                    status: error.status
                });
                if (this._isRetryableError(error) && i < retries - 1) {
                    const backoffDelay = delay * Math.pow(2, i);
                    this.logger.warn('Retrying request', {
                        backoffDelay,
                        nextAttempt: i + 2
                    });
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                } else {
                    this.logger.error('FINAL request failure after all attempts', error, {
                        endpoint,
                        totalAttempts: i + 1
                    });
                    throw error;
                }
            }
        }
    }

    _makeRequest(endpoint, method, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseURL + endpoint);
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Length': Buffer.byteLength(body)
                },
                agent: this.agent,
                timeout: this.timeout
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsedData = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsedData);
                        } else {
                            const error = new Error(parsedData.error?.message || `HTTP ${res.statusCode}`);
                            error.status = res.statusCode;
                            reject(error);
                        }
                    } catch (parseError) {
                        reject(new Error(`Failed to parse response: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => reject(error));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(body);
            req.end();
        });
    }

    async testConnection() {
        try {
            const testPrompt = {
                system: 'You are a helpful assistant.',
                user: 'Hello, please respond with "Connection successful"'
            };
            
            // Don't cache test connections
            const response = await this.call(testPrompt, { ttl: 60 }); // Short TTL for test
            return response.body.includes('Connection successful');
        } catch (error) {
            this.logger.error('DeepSeek connection test failed', error);
            return false;
        }
    }

}

let clientInstance;

function getDeepseekClient() {
    if (!clientInstance) {
        clientInstance = new DeepSeekClient();
    }
    return clientInstance;
}

module.exports = {
    getDeepseekClient,
    DeepSeekClient,
};