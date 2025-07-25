/**
 * Timeout utility for preventing hanging operations
 * Shared by all workers to ensure consistent timeout behavior
 */

/**
 * Execute a promise with a timeout to prevent hanging
 * @param {Promise} promise - The promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} context - Optional context for better error messages
 * @returns {Promise} Promise that resolves with the result or rejects with timeout error
 */
async function executeWithTimeout(promise, timeoutMs = 60000, context = '') {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms${context ? ` - ${context}` : ''}`)), timeoutMs)
        )
    ]);
}

/**
 * Execute a function with timeout and retry logic
 * @param {Function} fn - The function to execute
 * @param {number} timeout - Timeout in milliseconds
 * @param {Object} options - Additional options
 * @returns {Promise} - Result of the function or timeout error
 */
async function executeWithTimeoutAndRetry(fn, timeout, options = {}) {
    const {
        retries = 3,
        retryDelay = 5000,
        onTimeout = null,
        context = ''
    } = options;
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await executeWithTimeout(
                fn(),
                timeout,
                context
            );
        } catch (error) {
            lastError = error;
            
            if (error.message.includes('timed out')) {
                console.warn(`[TimeoutUtil] Timeout on attempt ${attempt}/${retries}${context ? ` for ${context}` : ''}`);
                
                if (onTimeout) {
                    await onTimeout(attempt, error);
                }
                
                if (attempt < retries) {
                    console.log(`[TimeoutUtil] Retrying after ${retryDelay}ms delay...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            } else {
                // Non-timeout error, throw immediately
                throw error;
            }
        }
    }
    
    throw lastError;
}

/**
 * Create a timeout-aware slot acquisition function for worker pool management
 * @param {Object} workerPoolManager - The worker pool manager instance
 * @param {string} workerType - Type of worker
 * @param {number} timeout - Timeout for slot acquisition
 * @returns {Function} - Wrapped execution function
 */
function createTimeoutAwareExecution(workerPoolManager, workerType, timeout = 90000) {
    return async function(fn, metadata = {}) {
        // Add timeout context to help debug issues
        const context = `${workerType} slot acquisition`;
        
        try {
            return await executeWithTimeoutAndRetry(
                () => workerPoolManager.executeWithManagement(workerType, fn, metadata),
                timeout,
                {
                    context,
                    retries: 2,
                    retryDelay: 10000,
                    onTimeout: async (attempt) => {
                        console.warn(`[TimeoutUtil] Slot acquisition timeout for ${workerType}, attempt ${attempt}`);
                        // Log current pool status if available
                        if (workerPoolManager.getPoolStatus) {
                            const status = workerPoolManager.getPoolStatus(workerType);
                            console.log(`[TimeoutUtil] Pool status for ${workerType}:`, status);
                        }
                    }
                }
            );
        } catch (error) {
            if (error.message.includes('timed out') && error.message.includes('slot acquisition')) {
                // Convert to more specific error
                throw new Error(`Unable to acquire worker slot for ${workerType} - pool may be saturated. Original error: ${error.message}`);
            }
            throw error;
        }
    };
}

module.exports = {
    executeWithTimeout,
    executeWithTimeoutAndRetry,
    createTimeoutAwareExecution
};