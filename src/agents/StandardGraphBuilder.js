const neo4j = require('neo4j-driver');
const config = require('../config');
const { NEO4J_TRANSACTION_TIMEOUT } = config;

class StandardGraphBuilder {
    constructor(db, neo4jDriver, dbName) {
        this.db = db;
        this.neo4jDriver = neo4jDriver;
        this.dbName = dbName;
        this.config = {
            batchSize: 500,
            maxConcurrentBatches: 1, // Avoid deadlocks by processing batches sequentially
            allowedRelationshipTypes: [
                'CALLS', 'IMPLEMENTS', 'USES', 'DEPENDS_ON', 'INHERITS', 
                'CONTAINS', 'DEFINES', 'REFERENCES', 'EXTENDS',
                'BELONGS_TO', 'RELATED_TO', 'PART_OF', 'USED_BY', 
                'INSTANTIATES', 'RELATED'
            ]
        };
    }

    async run() {
        if (!this.neo4jDriver || !this.db) {
            throw new Error('GraphBuilder requires valid database connections.');
        }

        try {
            console.log('[GraphBuilder] Starting graph building...');
            
            // Create IN clause for allowed relationship types for count query
            const allowedTypes = this.config.allowedRelationshipTypes.map(type => `'${type}'`).join(', ');
            const relCount = this.db.prepare(`SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED' AND type IN (${allowedTypes})`).get().count;
            console.log(`[GraphBuilder] Processing ${relCount} validated relationships...`);

            await this._persistValidatedRelationships();

            console.log('[GraphBuilder] Graph building complete.');
        } catch (error) {
            console.error('[GraphBuilder] Error during graph building:', error);
            throw error;
        }
    }

    async _persistValidatedRelationships() {
        // Create IN clause for allowed relationship types
        const allowedTypes = this.config.allowedRelationshipTypes.map(type => `'${type}'`).join(', ');
        
        const relationshipQuery = `
            SELECT
                r.id as relationship_id,
                r.type as relationship_type,
                r.confidence,
                s.id as source_id,
                s.semantic_id as source_semantic_id,
                s.file_path as source_file_path,
                s.name as source_name,
                s.type as source_type,
                s.start_line as source_start_line,
                s.end_line as source_end_line,
                t.id as target_id,
                t.semantic_id as target_semantic_id,
                t.file_path as target_file_path,
                t.name as target_name,
                t.type as target_type,
                t.start_line as target_start_line,
                t.end_line as target_end_line
            FROM relationships r
            JOIN pois s ON r.source_poi_id = s.id
            JOIN pois t ON r.target_poi_id = t.id
            WHERE r.status = 'VALIDATED' AND r.type IN (${allowedTypes})
        `;

        const relIterator = this.db.prepare(relationshipQuery).iterate();

        let currentBatch = [];
        const activePromises = new Set();
        let processedCount = 0;

        const getSemanticId = (semanticId, poi, filePath) => {
            // Use actual semantic_id from database, fallback to generated if null
            return semanticId || `${filePath}:${poi.name}`;
        };

        const processBatch = async (batch) => {
            const promise = this._runRelationshipBatch(batch)
                .then(() => {
                    processedCount += batch.length;
                    console.log(`[GraphBuilder] Processed batch of ${batch.length}. Total processed: ${processedCount}`);
                })
                .catch(error => {
                    console.error(`[GraphBuilder] Error processing a batch:`, error);
                })
                .finally(() => {
                    activePromises.delete(promise);
                });
            activePromises.add(promise);
        };

        for (const row of relIterator) {
            const sourceNode = {
                id: getSemanticId(row.source_semantic_id, { type: row.source_type, name: row.source_name }, row.source_file_path),
                file_path: row.source_file_path,
                name: row.source_name,
                type: row.source_type,
                start_line: row.source_start_line,
                end_line: row.source_end_line,
            };
            const targetNode = {
                id: getSemanticId(row.target_semantic_id, { type: row.target_type, name: row.target_name }, row.target_file_path),
                file_path: row.target_file_path,
                name: row.target_name,
                type: row.target_type,
                start_line: row.target_start_line,
                end_line: row.target_end_line,
            };

            currentBatch.push({
                source: sourceNode,
                target: targetNode,
                relationship: {
                    type: row.relationship_type,
                    confidence: row.confidence,
                }
            });

            if (currentBatch.length >= this.config.batchSize) {
                if (activePromises.size >= this.config.maxConcurrentBatches) {
                    await Promise.race(activePromises);
                }
                processBatch([...currentBatch]);
                currentBatch = [];
            }
        }

        if (currentBatch.length > 0) {
            processBatch(currentBatch);
        }

        await Promise.allSettled(activePromises);
        console.log(`[GraphBuilder] All relationship batches have been processed.`);
    }

    async _runRelationshipBatch(batch) {
        const session = this.neo4jDriver.session({ database: this.dbName });
        const txConfig = {
            timeout: NEO4J_TRANSACTION_TIMEOUT, // Configurable via environment
            metadata: { operation: 'bulk-relationship-ingestion' }
        };
        
        try {
            await session.writeTransaction(async (tx) => {
                const cypher = `
                    UNWIND $batch as item
                    MERGE (source:POI {id: item.source.id})
                    ON CREATE SET source.type = item.source.type,
                                  source.name = item.source.name,
                                  source.filePath = item.source.file_path,
                                  source.startLine = item.source.start_line,
                                  source.endLine = item.source.end_line
                    MERGE (target:POI {id: item.target.id})
                    ON CREATE SET target.type = item.target.type,
                                  target.name = item.target.name,
                                  target.filePath = item.target.file_path,
                                  target.startLine = item.target.start_line,
                                  target.endLine = item.target.end_line
                    MERGE (source)-[r:RELATIONSHIP]->(target)
                    ON CREATE SET r.type = item.relationship.type,
                                  r.confidence = item.relationship.confidence,
                                  r.filePath = item.source.file_path
                    ON MATCH SET r.type = item.relationship.type,
                                 r.confidence = item.relationship.confidence
                `;
                await tx.run(cypher, { batch });
            }, txConfig);
        } catch (error) {
            console.error(`[GraphBuilder] Error processing relationship batch:`, error);
            throw error;
        } finally {
            await session.close();
        }
    }
}

module.exports = StandardGraphBuilder;