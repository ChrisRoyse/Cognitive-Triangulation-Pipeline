//
// config.js
//
// This file centralizes the configuration management for the application.
// It reads environment variables, providing default values for local development
// and ensuring that critical settings are available to all modules.
//

require('dotenv').config();

const config = {
  // SQLite Database Configuration
  SQLITE_DB_PATH: process.env.SQLITE_DB_PATH || './db.sqlite',

  // Neo4j Database Configuration
  NEO4J_URI: process.env.NEO4J_URI || 'bolt://localhost:7687',
  NEO4J_USER: process.env.NEO4J_USER || 'neo4j',
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || 'test1234',
  NEO4J_DATABASE: process.env.NEO4J_DATABASE || 'neo4j',

  // Agent-specific Configuration
  INGESTOR_BATCH_SIZE: parseInt(process.env.INGESTOR_BATCH_SIZE, 10) || 100,
  INGESTOR_INTERVAL_MS: parseInt(process.env.INGESTOR_INTERVAL_MS, 10) || 10000,

  // Redis Configuration
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  REDIS_ENABLED: process.env.REDIS_ENABLED !== 'false',

  // Cache Configuration
  CACHE_ENABLED: process.env.CACHE_ENABLED !== 'false',
  CACHE_DEFAULT_TTL: parseInt(process.env.CACHE_DEFAULT_TTL, 10) || 24 * 60 * 60, // 24 hours
  CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE, 10) || 1000000, // 1MB default

  // BullMQ Queue Names
  QUEUE_NAMES: [
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
};

// Dynamically create and export queue name constants
config.QUEUE_NAMES.forEach(queueName => {
    const constantName = queueName.replace(/-/g, '_').toUpperCase() + '_QUEUE_NAME';
    config[constantName] = queueName;
});


// Security Hardening: Prevent startup with default password in production
if (process.env.NODE_ENV === 'production' && config.NEO4J_PASSWORD === 'password') {
  console.error('FATAL ERROR: Default Neo4j password is being used in a production environment.');
  console.error('Set the NEO4J_PASSWORD environment variable to a secure password before starting.');
  process.exit(1);
}

module.exports = config;