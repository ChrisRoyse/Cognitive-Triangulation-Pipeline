//
// neo4jDriver.js
//
// This module provides a simplified, mockable interface to the Neo4j database driver.
// In a real-world application, this would be a thin wrapper around the 'neo4j-driver'
// library, managing the driver instance and providing a clean way to get sessions.
// For the purpose of London School TDD, it exposes an interface that can be
// easily mocked by Jest, matching the structure used in the test files.
//

const neo4j = require('neo4j-driver');
const { 
  NEO4J_URI, 
  NEO4J_USER, 
  NEO4J_PASSWORD, 
  NEO4J_DATABASE,
  NEO4J_CONNECTION_TIMEOUT,
  NEO4J_MAX_TRANSACTION_RETRY_TIME,
  NEO4J_CONNECTION_POOL_SIZE,
  NEO4J_CONNECTION_ACQUISITION_TIMEOUT
} = require('../config');

// This is a placeholder for the actual driver instance.
// The real implementation would initialize this based on environment variables.
let driver;

/**
 * Resolves localhost to IPv4 to avoid DNS resolution issues on Windows
 * @param {string} uri - The original Neo4j URI
 * @returns {string} - The URI with localhost resolved to 127.0.0.1
 */
function resolveLocalhostToIPv4(uri) {
  return uri.replace('localhost', '127.0.0.1');
}

/**
 * Returns a singleton instance of the Neo4j driver.
 * This function is designed to be mocked in tests.
 * @returns {neo4j.Driver} The Neo4j driver instance.
 */
function getDriver() {
  if (!driver || driver._closed) {
    // Resolve localhost to IPv4 to avoid DNS resolution issues
    const resolvedURI = resolveLocalhostToIPv4(NEO4J_URI);
    
    // In a real app, connection details would come from environment variables
    // and you'd have more robust error handling and connection management.
    console.log(`[Neo4jDriver] Connecting to Neo4j at ${NEO4J_URI} (resolved to ${resolvedURI}) with user ${NEO4J_USER} and database ${NEO4J_DATABASE}`);
    driver = neo4j.driver(
      resolvedURI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
      {
        connectionTimeout: NEO4J_CONNECTION_TIMEOUT,
        maxTransactionRetryTime: NEO4J_MAX_TRANSACTION_RETRY_TIME,
        connectionPoolSize: NEO4J_CONNECTION_POOL_SIZE,
        connectionAcquisitionTimeout: NEO4J_CONNECTION_ACQUISITION_TIMEOUT,
        logging: {
          level: 'info',
          logger: (level, message) => {
            console.log(`[Neo4j ${level}] ${message}`);
          }
        }
      }
    );
  }
  return driver;
}

// Export an object that always returns a fresh driver if needed
module.exports = {
  getNeo4jDriver: getDriver,
  session: (config = {}) => {
    // Always specify the database from environment variable
    const sessionConfig = { database: NEO4J_DATABASE, ...config };
    return getDriver().session(sessionConfig);
  },
  verifyConnectivity: () => getDriver().verifyConnectivity(),
  close: () => {
    if (driver && !driver._closed) {
      return driver.close();
    }
  },
};