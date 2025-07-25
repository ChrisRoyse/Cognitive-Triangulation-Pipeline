/**
 * Utility functions for the polyglot test application
 * Shared utilities used across JavaScript services
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { PATHS, LOGGING } = require('./config');

/**
 * Generates a unique identifier
 * @param {number} length - Length of the ID to generate
 * @returns {string} Generated unique ID
 */
function generateId(length = 16) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Validates an email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if email is valid
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Formats a date to ISO string
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return null;
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) return null;
  return dateObj.toISOString();
}

/**
 * Safely parses JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed object or default value
 */
function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('JSON parsing failed:', error.message);
    return defaultValue;
  }
}

/**
 * Delays execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Promise with function result
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delayMs = baseDelay * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, error.message);
      await delay(delayMs);
    }
  }
  
  throw lastError;
}

/**
 * Ensures a directory exists, creating it if necessary
 * @param {string} dirPath - Directory path to ensure
 * @returns {Promise<boolean>} True if directory exists or was created
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.access(dirPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
      } catch (mkdirError) {
        console.error('Failed to create directory:', mkdirError.message);
        return false;
      }
    }
    throw error;
  }
}

/**
 * Reads a file with error handling
 * @param {string} filePath - Path to file to read
 * @param {string} encoding - File encoding (default: utf8)
 * @returns {Promise<string|null>} File contents or null if error
 */
async function safeReadFile(filePath, encoding = 'utf8') {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    console.error(`Failed to read file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Writes data to file with error handling
 * @param {string} filePath - Path to file to write
 * @param {string} data - Data to write
 * @param {string} encoding - File encoding (default: utf8)
 * @returns {Promise<boolean>} True if write succeeded
 */
async function safeWriteFile(filePath, data, encoding = 'utf8') {
  try {
    const dir = path.dirname(filePath);
    await ensureDirectory(dir);
    await fs.writeFile(filePath, data, encoding);
    return true;
  } catch (error) {
    console.error(`Failed to write file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Logs a message with timestamp and level
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - Message to log
 * @param {*} data - Additional data to log
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data })
  };
  
  console.log(JSON.stringify(logEntry));
  
  // Also write to log file if in production
  if (process.env.NODE_ENV === 'production') {
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFile(LOGGING.filename, logLine).catch(err => {
      console.error('Failed to write to log file:', err.message);
    });
  }
}

/**
 * Convenience logging functions
 */
const logger = {
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),
  debug: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      log('debug', message, data);
    }
  }
};

/**
 * Makes an HTTP request with timeout and retries
 * @param {string} url - URL to request
 * @param {Object} options - Request options
 * @returns {Promise<Object>} Response object
 */
async function httpRequest(url, options = {}) {
  const { default: fetch } = await import('node-fetch');
  
  const defaultOptions = {
    timeout: 10000,
    retries: 3,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'polyglot-test-app/1.0'
    }
  };
  
  const mergedOptions = { ...defaultOptions, ...options };
  
  return retryWithBackoff(async () => {
    const response = await fetch(url, {
      method: mergedOptions.method,
      headers: mergedOptions.headers,
      body: mergedOptions.body,
      timeout: mergedOptions.timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.json();
  }, mergedOptions.retries);
}

module.exports = {
  generateId,
  validateEmail,
  formatDate,
  safeJsonParse,
  delay,
  retryWithBackoff,
  ensureDirectory,
  safeReadFile,
  safeWriteFile,
  log,
  logger,
  httpRequest
}; 