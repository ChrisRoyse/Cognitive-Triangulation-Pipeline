const neo4j = require('neo4j-driver');

class GraphIngestionWorker {
    constructor(options) {
        this.driver = neo4j.driver(
            options.neo4jUri, 
            neo4j.auth.basic(options.neo4jUser, options.neo4jPassword)
        );
    }

    async processJob(job) {
        if (!job.data.graphJson) {
            throw new Error('Job data is missing graphJson.');
        }
        if (!job.data.graphJson.pois) {
            throw new Error('Job data is missing pois.');
        }

        const { pois, relationships } = job.data.graphJson;

        const ingestionQuery = `
// CRITICAL: For this query to be performant, a unique constraint on POI ID must exist.
// CREATE CONSTRAINT poi_id_unique IF NOT EXISTS FOR (p:POI) ON (p.id) IS UNIQUE;

// Phase 1: Bulk-load all POIs (Nodes)
CALL apoc.periodic.iterate(
  "UNWIND $pois AS poi RETURN poi",
  "MERGE (p:POI {id: poi.id})
   ON CREATE SET p += {type: poi.type, name: poi.name, filePath: poi.filePath, startLine: poi.startLine, endLine: poi.endLine}
   ON MATCH SET p += {type: poi.type, name: poi.name, filePath: poi.filePath, startLine: poi.startLine, endLine: poi.endLine}",
  {batchSize: 1000, parallel: true, params: {pois: $pois}}
)
YIELD batches, total, timeTaken, committedOperations

// Phase 2: Bulk-load all Relationships
CALL apoc.periodic.iterate(
  "UNWIND $relationships AS rel RETURN rel",
  "MATCH (source:POI {id: rel.source})
   MATCH (target:POI {id: rel.target})
   MERGE (source)-[r:RELATIONSHIP {type: rel.type, filePath: rel.filePath}]->(target)",
  {batchSize: 1000, parallel: true, params: {relationships: $relationships}}
)
YIELD batches AS rel_batches, total AS rel_total, timeTaken AS rel_timeTaken, committedOperations AS rel_committedOperations

RETURN batches, total, timeTaken, committedOperations, rel_batches, rel_total, rel_timeTaken, rel_committedOperations
`;

        const session = this.driver.session();
        try {
            await session.run(ingestionQuery, {
                pois,
                relationships: relationships || [],
            });
        } finally {
            await session.close();
        }
    }

    async close() {
        await this.driver.close();
    }
}

module.exports = GraphIngestionWorker;