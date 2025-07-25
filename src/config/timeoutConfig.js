/**
 * Centralized Timeout Configuration System
 * 
 * This module provides comprehensive timeout configuration management with:
 * - Environment variable support
 * - Configuration file integration
 * - Runtime configuration updates
 * - Validation of timeout ranges
 * - Different timeout categories with appropriate defaults
 */

class TimeoutConfig {
    constructor(options = {}) {
        // Initialize default timeout values (in milliseconds)
        this.defaults = {
            // Pipeline timeouts
            pipeline: {
                maxWait: 30 * 60 * 1000,      // 30 minutes - main pipeline execution
                checkInterval: 5000,           // 5 seconds - monitoring check interval  
                idleTimeout: 10 * 60 * 1000,   // 10 minutes - idle detection timeout
                gracefulShutdown: 60000,       // 1 minute - graceful shutdown timeout
            },
            
            // Worker timeouts
            worker: {
                execution: 90000,              // 90 seconds - worker task execution
                slotAcquisition: 60000,        // 60 seconds - worker slot acquisition
                initialization: 30000,         // 30 seconds - worker initialization
                heartbeat: 15000,              // 15 seconds - worker heartbeat interval
                shutdown: 15000,               // 15 seconds - worker shutdown timeout
            },
            
            // Queue timeouts
            queue: {
                jobProcessing: 300000,         // 5 minutes - job processing timeout
                connection: 10000,             // 10 seconds - queue connection timeout
                cleanup: 30000,                // 30 seconds - queue cleanup operations
                staleJobCheck: 5 * 60 * 1000,  // 5 minutes - stale job detection
                maxJobAge: 30 * 60 * 1000,     // 30 minutes - maximum job age
            },
            
            // Database timeouts
            database: {
                connection: 30000,             // 30 seconds - database connection
                transaction: 300000,           // 5 minutes - database transaction
                query: 60000,                  // 60 seconds - database query
                batch: 120000,                 // 2 minutes - batch operations
                migration: 600000,             // 10 minutes - migration operations
                shutdown: 60000,               // 1 minute - database shutdown
            },
            
            // Circuit breaker timeouts
            circuitBreaker: {
                timeout: 60000,                // 60 seconds - circuit breaker timeout
                resetTimeout: 30000,           // 30 seconds - circuit reset timeout
                monitoringWindow: 60000,       // 60 seconds - monitoring window
                healthCheck: 10000,            // 10 seconds - health check timeout
            },
            
            // LLM/API timeouts
            llm: {
                request: 60000,                // 60 seconds - LLM API request
                retry: 5000,                   // 5 seconds - retry delay
                rateLimit: 1000,               // 1 second - rate limit interval
                connectionPool: 30000,         // 30 seconds - connection pool timeout
            },
            
            // Monitoring timeouts
            monitoring: {
                healthCheck: 10000,            // 10 seconds - health check timeout
                metricCollection: 5000,        // 5 seconds - metric collection
                reportGeneration: 30000,       // 30 seconds - report generation
                alertProcessing: 15000,        // 15 seconds - alert processing
            },
            
            // Reliability monitor timeouts
            reliability: {
                timeout: 30 * 60 * 1000,       // 30 minutes - reliability timeout threshold
                slowRecovery: 5 * 60 * 1000,   // 5 minutes - slow recovery threshold
                criticalRecovery: 15 * 60 * 1000, // 15 minutes - critical recovery threshold
                failureWindow: 60000,          // 1 minute - failure rate window
            }
        };
        
        // Validation ranges (min, max in milliseconds)
        this.validationRanges = {
            pipeline: {
                maxWait: [60000, 7200000],         // 1 minute to 2 hours
                checkInterval: [1000, 60000],      // 1 second to 1 minute
                idleTimeout: [60000, 1800000],     // 1 minute to 30 minutes
                gracefulShutdown: [10000, 300000], // 10 seconds to 5 minutes
            },
            worker: {
                execution: [10000, 600000],        // 10 seconds to 10 minutes
                slotAcquisition: [5000, 300000],   // 5 seconds to 5 minutes
                initialization: [5000, 120000],    // 5 seconds to 2 minutes
                heartbeat: [1000, 60000],          // 1 second to 1 minute
                shutdown: [1000, 120000],          // 1 second to 2 minutes
            },
            queue: {
                jobProcessing: [30000, 1800000],   // 30 seconds to 30 minutes
                connection: [1000, 60000],         // 1 second to 1 minute
                cleanup: [5000, 300000],           // 5 seconds to 5 minutes
                staleJobCheck: [60000, 1800000],   // 1 minute to 30 minutes
                maxJobAge: [300000, 7200000],      // 5 minutes to 2 hours
            },
            database: {
                connection: [1000, 120000],        // 1 second to 2 minutes
                transaction: [10000, 1800000],     // 10 seconds to 30 minutes
                query: [1000, 300000],             // 1 second to 5 minutes
                batch: [10000, 600000],            // 10 seconds to 10 minutes
                migration: [60000, 3600000],       // 1 minute to 1 hour
                shutdown: [5000, 300000],          // 5 seconds to 5 minutes
            },
            circuitBreaker: {
                timeout: [1000, 300000],           // 1 second to 5 minutes
                resetTimeout: [1000, 300000],      // 1 second to 5 minutes
                monitoringWindow: [10000, 600000], // 10 seconds to 10 minutes
                healthCheck: [1000, 60000],        // 1 second to 1 minute
            },
            llm: {
                request: [5000, 300000],           // 5 seconds to 5 minutes
                retry: [100, 30000],               // 100ms to 30 seconds
                rateLimit: [100, 10000],           // 100ms to 10 seconds
                connectionPool: [5000, 120000],    // 5 seconds to 2 minutes
            },
            monitoring: {
                healthCheck: [1000, 60000],        // 1 second to 1 minute
                metricCollection: [1000, 30000],   // 1 second to 30 seconds
                reportGeneration: [5000, 300000],  // 5 seconds to 5 minutes
                alertProcessing: [1000, 60000],    // 1 second to 1 minute
            },
            reliability: {
                timeout: [300000, 7200000],        // 5 minutes to 2 hours
                slowRecovery: [60000, 1800000],    // 1 minute to 30 minutes
                criticalRecovery: [300000, 3600000], // 5 minutes to 1 hour
                failureWindow: [10000, 600000],    // 10 seconds to 10 minutes
            }
        };
        
        // Load configuration from environment variables and options
        this.config = this._loadConfiguration(options);
        
        // Validate all timeout values
        this._validateConfiguration();
        
        // Set up runtime update capability
        this._setupRuntimeUpdates();
    }
    
    /**
     * Load configuration from environment variables with fallback to defaults
     */
    _loadConfiguration(options = {}) {
        const config = {};
        
        // Load each category
        Object.keys(this.defaults).forEach(category => {
            config[category] = {};
            Object.keys(this.defaults[category]).forEach(timeoutType => {
                const envVarName = this._getEnvVarName(category, timeoutType);
                const envValue = process.env[envVarName];
                const optionValue = options[category]?.[timeoutType];
                const defaultValue = this.defaults[category][timeoutType];
                
                // Priority: explicit option > environment variable > default
                let value = defaultValue;
                if (envValue !== undefined) {
                    const parsed = parseInt(envValue, 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        value = parsed;
                    } else {
                        console.warn(`⚠️  Invalid environment variable ${envVarName}="${envValue}". Using default: ${defaultValue}ms`);
                    }
                }
                if (optionValue !== undefined) {
                    value = optionValue;
                }
                
                config[category][timeoutType] = value;
            });
        });
        
        return config;
    }
    
    /**
     * Generate environment variable name for a timeout configuration
     */
    _getEnvVarName(category, timeoutType) {
        const categoryUpper = category.toUpperCase();
        const typeUpper = timeoutType.replace(/([A-Z])/g, '_$1').toUpperCase();
        return `${categoryUpper}_${typeUpper}_TIMEOUT_MS`;
    }
    
    /**
     * Validate all timeout configurations against their ranges
     */
    _validateConfiguration() {
        const errors = [];
        
        Object.keys(this.config).forEach(category => {
            Object.keys(this.config[category]).forEach(timeoutType => {
                const value = this.config[category][timeoutType];
                const range = this.validationRanges[category]?.[timeoutType];
                
                if (range) {
                    const [min, max] = range;
                    if (value < min || value > max) {
                        errors.push(
                            `${category}.${timeoutType} timeout (${value}ms) is outside valid range [${min}-${max}ms]`
                        );
                    }
                }
            });
        });
        
        if (errors.length > 0) {
            throw new Error(`Timeout configuration validation failed:\n${errors.join('\n')}`);
        }
    }
    
    /**
     * Set up runtime configuration updates
     */
    _setupRuntimeUpdates() {
        // Store original configuration for reset capability
        this._originalConfig = JSON.parse(JSON.stringify(this.config));
        
        // Track configuration changes
        this._changeHistory = [];
    }
    
    /**
     * Get timeout value for a specific category and type
     */
    get(category, timeoutType) {
        if (!this.config[category]) {
            throw new Error(`Unknown timeout category: ${category}`);
        }
        if (!this.config[category][timeoutType]) {
            throw new Error(`Unknown timeout type '${timeoutType}' in category '${category}'`);
        }
        return this.config[category][timeoutType];
    }
    
    /**
     * Update timeout value at runtime
     */
    set(category, timeoutType, value) {
        if (!this.config[category]) {
            throw new Error(`Unknown timeout category: ${category}`);
        }
        if (!this.config[category][timeoutType]) {
            throw new Error(`Unknown timeout type '${timeoutType}' in category '${category}'`);
        }
        
        // Validate the new value
        const range = this.validationRanges[category]?.[timeoutType];
        if (range) {
            const [min, max] = range;
            if (value < min || value > max) {
                throw new Error(
                    `Timeout value ${value}ms for ${category}.${timeoutType} is outside valid range [${min}-${max}ms]`
                );
            }
        }
        
        // Record the change
        const oldValue = this.config[category][timeoutType];
        this._changeHistory.push({
            timestamp: new Date().toISOString(),
            category,
            timeoutType,
            oldValue,
            newValue: value
        });
        
        // Update the configuration
        this.config[category][timeoutType] = value;
        
        console.log(`🔧 Updated timeout ${category}.${timeoutType}: ${oldValue}ms → ${value}ms`);
        
        return true;
    }
    
    /**
     * Get all timeouts for a specific category
     */
    getCategory(category) {
        if (!this.config[category]) {
            throw new Error(`Unknown timeout category: ${category}`);
        }
        return { ...this.config[category] };
    }
    
    /**
     * Update multiple timeouts for a category
     */
    setCategory(category, timeouts) {
        if (!this.config[category]) {
            throw new Error(`Unknown timeout category: ${category}`);
        }
        
        Object.keys(timeouts).forEach(timeoutType => {
            this.set(category, timeoutType, timeouts[timeoutType]);
        });
    }
    
    /**
     * Reset all timeouts to defaults
     */
    resetToDefaults() {
        this.config = JSON.parse(JSON.stringify(this._originalConfig));
        this._changeHistory.push({
            timestamp: new Date().toISOString(),
            action: 'reset_to_defaults'
        });
        console.log('🔄 Reset all timeouts to default values');
    }
    
    /**
     * Get configuration summary for logging
     */
    getSummary() {
        return {
            categories: Object.keys(this.config),
            totalTimeouts: Object.values(this.config).reduce((sum, category) => sum + Object.keys(category).length, 0),
            changes: this._changeHistory.length,
            environment: process.env.NODE_ENV || 'development'
        };
    }
    
    /**
     * Get detailed configuration for debugging
     */
    getDetailedConfig() {
        return {
            config: JSON.parse(JSON.stringify(this.config)),
            defaults: JSON.parse(JSON.stringify(this.defaults)),
            validationRanges: JSON.parse(JSON.stringify(this.validationRanges)),
            changeHistory: [...this._changeHistory],
            environmentVariables: this._getEnvironmentVariables()
        };
    }
    
    /**
     * Get all related environment variables
     */
    _getEnvironmentVariables() {
        const envVars = {};
        Object.keys(this.defaults).forEach(category => {
            Object.keys(this.defaults[category]).forEach(timeoutType => {
                const envVarName = this._getEnvVarName(category, timeoutType);
                envVars[envVarName] = process.env[envVarName] || undefined;
            });
        });
        return envVars;
    }
    
    /**
     * Export configuration for saving to file
     */
    exportConfig() {
        return {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            config: this.config,
            metadata: {
                totalTimeouts: Object.values(this.config).reduce((sum, category) => sum + Object.keys(category).length, 0),
                changes: this._changeHistory.length
            }
        };
    }
    
    /**
     * Create timeout configuration instance
     */
    static create(options = {}) {
        return new TimeoutConfig(options);
    }
    
    /**
     * Create test configuration with shorter timeouts
     */
    static createForTesting() {
        const testOptions = {
            pipeline: {
                maxWait: 5 * 60 * 1000,        // 5 minutes for tests
                checkInterval: 2000,            // 2 seconds for tests
                idleTimeout: 2 * 60 * 1000,     // 2 minutes for tests
                gracefulShutdown: 10000,        // 10 seconds for tests
            },
            worker: {
                execution: 30000,               // 30 seconds for tests
                slotAcquisition: 15000,         // 15 seconds for tests
                initialization: 10000,          // 10 seconds for tests
                heartbeat: 5000,                // 5 seconds for tests
                shutdown: 5000,                 // 5 seconds for tests
            },
            queue: {
                jobProcessing: 60000,           // 1 minute for tests
                connection: 5000,               // 5 seconds for tests
                cleanup: 10000,                 // 10 seconds for tests
                staleJobCheck: 60000,           // 1 minute for tests
                maxJobAge: 5 * 60 * 1000,       // 5 minutes for tests
            }
        };
        
        return new TimeoutConfig(testOptions);
    }
    
    /**
     * Create debug configuration with extended timeouts
     */
    static createForDebugging() {
        const debugOptions = {
            pipeline: {
                maxWait: 60 * 60 * 1000,        // 1 hour for debugging
                checkInterval: 10000,            // 10 seconds for debugging
                idleTimeout: 30 * 60 * 1000,     // 30 minutes for debugging
                gracefulShutdown: 120000,        // 2 minutes for debugging
            },
            worker: {
                execution: 300000,               // 5 minutes for debugging
                slotAcquisition: 180000,         // 3 minutes for debugging
                initialization: 60000,           // 1 minute for debugging
                heartbeat: 30000,                // 30 seconds for debugging
                shutdown: 30000,                 // 30 seconds for debugging
            }
        };
        
        return new TimeoutConfig(debugOptions);
    }
}

module.exports = { TimeoutConfig };