//
// neo4jDriver.js
//
// This module provides a wrapper around the Neo4j database driver,
// managing the driver instance and providing a clean way to get sessions.
//

const neo4j = require('neo4j-driver');
const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE } = require('../../config');

// Singleton driver instance
let driver;

/**
 * Returns a singleton instance of the Neo4j driver.
 * @returns {neo4j.Driver} The Neo4j driver instance.
 */
function getDriver() {
  if (!driver || driver._closed) {
    console.log(`[Neo4jDriver] Connecting to Neo4j at ${NEO4J_URI} with user ${NEO4J_USER} and database ${NEO4J_DATABASE}`);
    driver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
    );
  }
  return driver;
}

// Export Neo4j driver interface
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