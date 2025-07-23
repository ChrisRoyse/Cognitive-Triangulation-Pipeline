const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err) {
  console.warn('Warning: Could not create logs directory:', err.message);
}

// Cache for singleton loggers
const loggerCache = new Map();

/**
 * Deep copy an object while checking for circular references
 * @param {*} obj - Object to copy
 * @param {WeakSet} seen - Set of already seen objects
 * @returns {*} - Deep copy of the object
 */
function deepCopyWithCircularCheck(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (seen.has(obj)) {
    return '[Circular Reference]';
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  if (obj instanceof Array) {
    seen.add(obj);
    const arrCopy = obj.map(item => deepCopyWithCircularCheck(item, seen));
    seen.delete(obj);
    return arrCopy;
  }
  
  if (obj instanceof Object) {
    seen.add(obj);
    const objCopy = {};
    for (const [key, value] of Object.entries(obj)) {
      objCopy[key] = deepCopyWithCircularCheck(value, seen);
    }
    seen.delete(obj);
    return objCopy;
  }
  
  return obj;
}

/**
 * Masks sensitive data in log objects
 * @param {*} data - Data to mask
 * @returns {*} - Data with sensitive values masked
 */
function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Handle circular references
  const seen = new WeakSet();
  
  // Create a deep copy to avoid modifying the original
  let masked;
  try {
    masked = JSON.parse(JSON.stringify(data));
  } catch (err) {
    // Handle circular references by creating a manual copy
    masked = deepCopyWithCircularCheck(data, seen);
  }

  const sensitivePatterns = {
    // API Keys - mask all but first few chars
    apiKey: /^(sk-|pk_|gho_|api_)?(.+)$/i,
    // Passwords - always fully mask
    password: /.+/,
    // Tokens - mask all but first few chars
    token: /^(.{3})(.+)$/,
    // Secrets - always fully mask
    secret: /.+/
  };

  function maskValue(key, value) {
    const lowerKey = key.toLowerCase();
    
    // Check for password-like keys
    if (lowerKey.includes('password') || lowerKey.includes('pwd')) {
      return '***';
    }
    
    // Check for secret-like keys
    if (lowerKey.includes('secret')) {
      return '***';
    }
    
    // Check for API key patterns
    if (lowerKey.includes('apikey') || lowerKey.includes('api_key')) {
      if (typeof value === 'string') {
        if (value.startsWith('sk-') || value.startsWith('pk_') || value.startsWith('gho_')) {
          return value.substring(0, 3) + '****';
        }
        return value.substring(0, 3) + '****';
      }
    }
    
    // Check for token patterns
    if (lowerKey.includes('token')) {
      if (typeof value === 'string' && value.length > 7) {
        return value.substring(0, 3) + '****';
      }
    }
    
    return value;
  }

  function maskObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(item => {
        if (typeof item === 'object' && item !== null) {
          return maskObject(item);
        }
        // Check if string items in arrays need masking (e.g., API keys)
        if (typeof item === 'string') {
          // Check for common API key patterns
          if (item.startsWith('sk-') || item.startsWith('pk_') || item.startsWith('gho_')) {
            return item.substring(0, 3) + '****';
          }
        }
        return item;
      });
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        result[key] = value;
      } else if (typeof value === 'object') {
        result[key] = maskObject(value);
      } else {
        result[key] = maskValue(key, value);
      }
    }
    return result;
  }

  return maskObject(masked);
}

/**
 * Custom format that masks sensitive data
 */
const maskFormat = winston.format((info) => {
  // Mask sensitive data in the info object
  const { level, message, timestamp, ...meta } = info;
  const maskedMeta = maskSensitiveData(meta);
  
  return {
    ...info,
    ...maskedMeta
  };
})();

/**
 * Creates a Winston logger with production-ready configuration
 * @param {Object} options - Logger options
 * @returns {winston.Logger} - Configured logger instance
 */
function createLogger(options = {}) {
  const {
    level = process.env.LOG_LEVEL || 'info',
    module = 'app'
  } = options;

  const formats = [
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    maskFormat,
    winston.format.metadata({ fillWith: ['module'] }),
    winston.format.json()
  ];

  const transports = [];

  // Console transport (disabled in production)
  if (process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} [${module}] ${level}: ${message} ${metaStr}`;
          })
        )
      })
    );
  }

  // File transports with rotation
  let maxsize = 10 * 1024 * 1024; // 10MB default
  if (process.env.LOG_MAX_SIZE) {
    const sizeStr = process.env.LOG_MAX_SIZE.toLowerCase();
    const sizeMatch = sizeStr.match(/^(\d+)([kmg])?$/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      const unit = sizeMatch[2] || 'm';
      const multipliers = { k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };
      maxsize = size * multipliers[unit];
    }
  }
  
  const maxFiles = process.env.LOG_MAX_FILES 
    ? parseInt(process.env.LOG_MAX_FILES) 
    : 5;

  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize,
      maxFiles,
      tailable: true
    })
  );

  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize,
      maxFiles,
      tailable: true
    })
  );

  const logger = winston.createLogger({
    level,
    format: winston.format.combine(...formats),
    defaultMeta: { module },
    transports,
    exitOnError: false
  });

  // Add error handling for file permission issues
  logger.on('error', (err) => {
    console.warn('Logger error:', err.message);
  });

  return logger;
}

/**
 * Creates a performance logger for tracking operation metrics
 * @param {string} operation - Name of the operation
 * @param {winston.Logger} logger - Logger instance to use
 * @returns {Object} - Performance logger interface
 */
function createPerformanceLogger(operation, logger = createLogger()) {
  const startTime = Date.now();
  const checkpoints = [];
  let startMemory = process.memoryUsage();

  return {
    start() {
      startMemory = process.memoryUsage();
      logger.info(`Starting ${operation}`, {
        operation,
        timestamp: new Date().toISOString()
      });
    },

    checkpoint(name, metadata = {}) {
      const checkpoint = {
        name,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        ...metadata
      };
      checkpoints.push(checkpoint);
      
      logger.info(`Performance checkpoint: ${name}`, {
        operation,
        checkpoint
      });
    },

    end(metadata = {}) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const endMemory = process.memoryUsage();
      
      const memoryDelta = {
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        external: endMemory.external - startMemory.external,
        rss: endMemory.rss - startMemory.rss
      };

      logger.info(`Performance: ${operation} completed`, {
        operation,
        duration,
        checkpoints,
        memoryUsage: endMemory,
        memoryDelta,
        ...metadata
      });

      return {
        duration,
        checkpoints,
        memoryDelta
      };
    }
  };
}

/**
 * Gets or creates a logger for a specific module
 * @param {string} moduleName - Name of the module
 * @returns {winston.Logger} - Logger instance
 */
function getLogger(moduleName) {
  if (!loggerCache.has(moduleName)) {
    loggerCache.set(moduleName, createLogger({ module: moduleName }));
  }
  return loggerCache.get(moduleName);
}

// Expose cache for testing
getLogger.cache = loggerCache;

module.exports = {
  createLogger,
  maskSensitiveData,
  createPerformanceLogger,
  getLogger
};