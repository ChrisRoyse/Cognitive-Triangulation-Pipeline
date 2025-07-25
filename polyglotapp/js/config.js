/**
 * Configuration management for the polyglot test application
 * Shared configuration used across all JavaScript services
 */

const path = require('path');
const os = require('os');

// Database configuration
const DATABASE_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'polyglot_test',
  user: process.env.DB_USER || 'testuser',
  password: process.env.DB_PASSWORD || 'testpass',
  ssl: false,
  maxConnections: 10,
  timeout: 30000
};

// API configuration
const API_CONFIG = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  cors: {
    origin: ['http://localhost:3000', 'https://app.example.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
};

// External service URLs
const SERVICES = {
  pythonService: process.env.PYTHON_SERVICE_URL || 'http://localhost:5000',
  javaService: process.env.JAVA_SERVICE_URL || 'http://localhost:8080',
  mlService: process.env.ML_SERVICE_URL || 'http://localhost:5001',
  authService: process.env.AUTH_SERVICE_URL || 'http://localhost:4000'
};

// Logging configuration
const LOGGING = {
  level: process.env.LOG_LEVEL || 'info',
  format: 'json',
  filename: path.join(__dirname, '..', 'logs', 'app.log'),
  maxsize: 5242880, // 5MB
  maxFiles: 5,
  colorize: true,
  timestamp: true
};

// Security configuration
const SECURITY = {
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret-key',
  jwtExpiresIn: '24h',
  bcryptRounds: 12,
  sessionSecret: process.env.SESSION_SECRET || 'session-secret',
  cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours
  corsOrigins: ['http://localhost:3000', 'https://app.example.com']
};

// Application paths
const PATHS = {
  uploads: path.join(__dirname, '..', 'uploads'),
  temp: path.join(os.tmpdir(), 'polyglot-test'),
  logs: path.join(__dirname, '..', 'logs'),
  static: path.join(__dirname, '..', 'public')
};

// Feature flags
const FEATURES = {
  enableMachineLearning: true,
  enableAnalytics: process.env.NODE_ENV === 'production',
  enableDebugMode: process.env.NODE_ENV === 'development',
  enableMetrics: true,
  enableHealthChecks: true
};

module.exports = {
  DATABASE_CONFIG,
  API_CONFIG,
  SERVICES,
  LOGGING,
  SECURITY,
  PATHS,
  FEATURES,
  
  // Convenience getters
  isDevelopment: () => process.env.NODE_ENV === 'development',
  isProduction: () => process.env.NODE_ENV === 'production',
  getServiceUrl: (serviceName) => SERVICES[serviceName],
  getDatabaseUrl: () => `postgresql://${DATABASE_CONFIG.user}:${DATABASE_CONFIG.password}@${DATABASE_CONFIG.host}:${DATABASE_CONFIG.port}/${DATABASE_CONFIG.database}`
}; 