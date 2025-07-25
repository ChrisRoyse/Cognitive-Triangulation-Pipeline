const neo4j = require('neo4j-driver');
const config = require('../config');
const { NEO4J_TRANSACTION_TIMEOUT } = config;

class GraphBuilder {
    constructor(db, neo4jDriver, dbName) {
        this.db = db;
        this.neo4jDriver = neo4jDriver;
        this.dbName = dbName;
        this.config = {
            batchSize: 10000, // Increased batch size for bulk operations
            useApoc: true,    // Use APOC for better performance if available
        };
    }

    async run() {
        if (!this.neo4jDriver || !this.db) {
            throw new Error('GraphBuilder requires valid database connections.');
        }

        try {
            console.log('[GraphBuilder] Starting optimized graph building...');
            
            // Data integrity validation before processing
            const validationResult = await this.validateDataIntegrity();
            if (!validationResult.isValid) {
                throw new Error(`Data integrity validation failed: ${validationResult.errors.join(', ')}`);
            }
            
            // First, create indexes for better performance
            await this.createIndexes();
            
            const relCount = this.db.prepare("SELECT COUNT(*) as count FROM relationships WHERE status = 'VALIDATED'").get().count;
            console.log(`[GraphBuilder] Processing ${relCount} validated relationships...`);

            if (relCount === 0) {
                console.log('[GraphBuilder] No validated relationships found. Skipping graph building.');
                return;
            }

            // Check if APOC is available
            const hasApoc = await this.checkApocAvailability();
            
            if (hasApoc && this.config.useApoc) {
                await this._persistWithApoc();
            } else {
                await this._persistWithUnwind();
            }

            console.log('[GraphBuilder] Graph building complete.');
        } catch (error) {
            console.error('[GraphBuilder] Error during graph building:', error);
            throw error;
        }
    }

    /**
     * Validates data integrity before graph building
     * Ensures all validated relationships have proper POI references and confidence scores
     */
    async validateDataIntegrity() {
        console.log('[GraphBuilder] Validating data integrity...');
        const errors = [];
        
        try {
            // Check for validated relationships with missing POI references
            const orphanedRels = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships r
                LEFT JOIN pois sp ON r.source_poi_id = sp.id
                LEFT JOIN pois tp ON r.target_poi_id = tp.id
                WHERE r.status = 'VALIDATED' 
                AND (sp.id IS NULL OR tp.id IS NULL)
            `).get();
            
            if (orphanedRels.count > 0) {
                errors.push(`${orphanedRels.count} validated relationships reference non-existent POIs`);
            }
            
            // Check for validated relationships with invalid confidence scores
            const invalidConfidence = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (confidence IS NULL OR confidence <= 0 OR confidence > 1)
            `).get();
            
            if (invalidConfidence.count > 0) {
                errors.push(`${invalidConfidence.count} validated relationships have invalid confidence scores`);
            }
            
            // Check for validated relationships with missing types
            const missingTypes = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM relationships 
                WHERE status = 'VALIDATED' 
                AND (type IS NULL OR type = '')
            `).get();
            
            if (missingTypes.count > 0) {
                errors.push(`${missingTypes.count} validated relationships are missing relationship types`);
            }
            
            // Check for POIs with missing critical data
            const incompletePois = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM pois p
                INNER JOIN relationships r ON (p.id = r.source_poi_id OR p.id = r.target_poi_id)
                WHERE r.status = 'VALIDATED'
                AND (p.name IS NULL OR p.name = '' OR p.type IS NULL OR p.type = '')
            `).get();
            
            if (incompletePois.count > 0) {
                errors.push(`${incompletePois.count} POIs referenced by validated relationships have missing critical data`);
            }
            
            // If there are errors, attempt to fix them automatically
            if (errors.length > 0) {
                console.warn('[GraphBuilder] Data integrity issues detected. Attempting automatic fixes...');
                
                // Reset invalid validated relationships
                const resetInvalid = this.db.prepare(`
                    UPDATE relationships 
                    SET status = 'FAILED', confidence = 0.0
                    WHERE status = 'VALIDATED' 
                    AND (
                        source_poi_id IS NULL 
                        OR target_poi_id IS NULL 
                        OR confidence IS NULL 
                        OR confidence <= 0 
                        OR confidence > 1
                        OR type IS NULL 
                        OR type = ''
                        OR id IN (
                            SELECT r.id
                            FROM relationships r
                            LEFT JOIN pois sp ON r.source_poi_id = sp.id
                            LEFT JOIN pois tp ON r.target_poi_id = tp.id
                            WHERE r.status = 'VALIDATED' 
                            AND (sp.id IS NULL OR tp.id IS NULL)
                        )
                    )
                `).run();
                
                console.log(`[GraphBuilder] Automatically fixed ${resetInvalid.changes} invalid validated relationships`);
                
                // Re-validate after fixes
                const remainingErrors = [];
                const revalidateOrphaned = this.db.prepare(`
                    SELECT COUNT(*) as count
                    FROM relationships r
                    LEFT JOIN pois sp ON r.source_poi_id = sp.id
                    LEFT JOIN pois tp ON r.target_poi_id = tp.id
                    WHERE r.status = 'VALIDATED' 
                    AND (sp.id IS NULL OR tp.id IS NULL)
                `).get();
                
                if (revalidateOrphaned.count > 0) {
                    remainingErrors.push(`${revalidateOrphaned.count} validated relationships still reference non-existent POIs after fixes`);
                }
                
                if (remainingErrors.length > 0) {
                    return { isValid: false, errors: remainingErrors };
                }
            }
            
            console.log('[GraphBuilder] Data integrity validation passed');
            return { isValid: true, errors: [] };
            
        } catch (error) {
            console.error('[GraphBuilder] Data integrity validation failed:', error);
            return { isValid: false, errors: [`Validation process failed: ${error.message}`] };
        }
    }

    async createIndexes() {
        const session = this.neo4jDriver.session({ database: this.dbName });
        const txConfig = {
            timeout: 60000, // 1 minute for index creation
            metadata: { operation: 'create-indexes' }
        };
        
        try {
            console.log('[GraphBuilder] Creating indexes for better performance...');
            
            await session.writeTransaction(async (tx) => {
                // Create index on POI id for faster lookups
                await tx.run('CREATE INDEX poi_id_index IF NOT EXISTS FOR (p:POI) ON (p.id)');
                
                // Create index on relationship type
                await tx.run('CREATE INDEX rel_type_index IF NOT EXISTS FOR ()-[r:RELATIONSHIP]-() ON (r.type)');
            }, txConfig);
            
            console.log('[GraphBuilder] Indexes created successfully.');
        } catch (error) {
            console.warn('[GraphBuilder] Could not create indexes:', error.message);
        } finally {
            await session.close();
        }
    }

    async checkApocAvailability() {
        const session = this.neo4jDriver.session({ database: this.dbName });
        const txConfig = {
            timeout: 5000, // 5 seconds for version check
            metadata: { operation: 'check-apoc-availability' }
        };
        
        try {
            await session.readTransaction(async (tx) => {
                await tx.run('RETURN apoc.version() as version');
            }, txConfig);
            console.log('[GraphBuilder] APOC is available, using optimized bulk import.');
            return true;
        } catch (error) {
            console.log('[GraphBuilder] APOC not available, falling back to UNWIND method.');
            return false;
        } finally {
            await session.close();
        }
    }

    async _persistWithApoc() {
        console.log('[GraphBuilder] Using APOC periodic.iterate for optimal performance...');
        
        // First, export all validated relationships to a temporary collection
        const relationships = this.db.prepare(`
            SELECT
                r.id as relationship_id,
                r.type as relationship_type,
                r.confidence,
                s.id as source_id,
                s.file_path as source_file_path,
                s.name as source_name,
                s.type as source_type,
                s.start_line as source_start_line,
                s.end_line as source_end_line,
                t.id as target_id,
                t.file_path as target_file_path,
                t.name as target_name,
                t.type as target_type,
                t.start_line as target_start_line,
                t.end_line as target_end_line
            FROM relationships r
            JOIN pois s ON r.source_poi_id = s.id
            JOIN pois t ON r.target_poi_id = t.id
            WHERE r.status = 'VALIDATED'
        `).all();

        // Transform data for Neo4j
        const transformedData = relationships.map(row => ({
            sourceId: this.generateSemanticId({ type: row.source_type, name: row.source_name }, row.source_file_path, row.source_start_line),
            sourceName: row.source_name,
            sourceType: row.source_type,
            sourceFilePath: row.source_file_path,
            sourceStartLine: row.source_start_line,
            sourceEndLine: row.source_end_line,
            targetId: this.generateSemanticId({ type: row.target_type, name: row.target_name }, row.target_file_path, row.target_start_line),
            targetName: row.target_name,
            targetType: row.target_type,
            targetFilePath: row.target_file_path,
            targetStartLine: row.target_start_line,
            targetEndLine: row.target_end_line,
            relType: row.relationship_type,
            confidence: row.confidence || 0.8
        }));

        const session = this.neo4jDriver.session({ database: this.dbName });
        const txConfig = {
            timeout: NEO4J_TRANSACTION_TIMEOUT, // Configurable via environment
            metadata: { operation: 'apoc-bulk-import' }
        };
        
        try {
            // Use APOC periodic.iterate for batch processing
            const result = await session.writeTransaction(async (tx) => {
                const cypher = `
                    CALL apoc.periodic.iterate(
                        'UNWIND $data as row RETURN row',
                        '
                        MERGE (source:POI {id: row.sourceId})
                        ON CREATE SET 
                            source.name = row.sourceName,
                            source.type = row.sourceType,
                            source.file_path = row.sourceFilePath,
                            source.start_line = row.sourceStartLine,
                            source.end_line = row.sourceEndLine
                        MERGE (target:POI {id: row.targetId})
                        ON CREATE SET 
                            target.name = row.targetName,
                            target.type = row.targetType,
                            target.file_path = row.targetFilePath,
                            target.start_line = row.targetStartLine,
                            target.end_line = row.targetEndLine
                        MERGE (source)-[r:RELATIONSHIP {type: row.relType}]->(target)
                        SET r.confidence = row.confidence
                        ',
                        {batchSize: $batchSize, parallel: true, params: {data: $data}}
                    ) YIELD batches, total, errorMessages
                    RETURN batches, total, errorMessages
                `;

                return await tx.run(cypher, { 
                    data: transformedData,
                    batchSize: this.config.batchSize 
                });
            }, txConfig);

            const summary = result.records[0].toObject();
            console.log(`[GraphBuilder] APOC import completed: ${summary.total} items in ${summary.batches} batches`);
            
            if (summary.errorMessages && summary.errorMessages.length > 0) {
                console.error('[GraphBuilder] Errors during import:', summary.errorMessages);
            }
        } finally {
            await session.close();
        }
    }

    async _persistWithUnwind() {
        console.log('[GraphBuilder] Using optimized UNWIND method...');
        
        const relationshipQuery = `
            SELECT
                r.id as relationship_id,
                r.type as relationship_type,
                r.confidence,
                s.id as source_id,
                s.file_path as source_file_path,
                s.name as source_name,
                s.type as source_type,
                s.start_line as source_start_line,
                s.end_line as source_end_line,
                t.id as target_id,
                t.file_path as target_file_path,
                t.name as target_name,
                t.type as target_type,
                t.start_line as target_start_line,
                t.end_line as target_end_line
            FROM relationships r
            JOIN pois s ON r.source_poi_id = s.id
            JOIN pois t ON r.target_poi_id = t.id
            WHERE r.status = 'VALIDATED'
        `;

        const relationships = this.db.prepare(relationshipQuery).all();
        const totalRelationships = relationships.length;
        console.log(`[GraphBuilder] Loading ${totalRelationships} relationships for bulk import...`);

        // Process in larger batches
        for (let i = 0; i < totalRelationships; i += this.config.batchSize) {
            const batch = relationships.slice(i, i + this.config.batchSize).map(row => ({
                source: {
                    id: this.generateSemanticId({ type: row.source_type, name: row.source_name }, row.source_file_path, row.source_start_line),
                    file_path: row.source_file_path,
                    name: row.source_name,
                    type: row.source_type,
                    start_line: row.source_start_line,
                    end_line: row.source_end_line,
                },
                target: {
                    id: this.generateSemanticId({ type: row.target_type, name: row.target_name }, row.target_file_path, row.target_start_line),
                    file_path: row.target_file_path,
                    name: row.target_name,
                    type: row.target_type,
                    start_line: row.target_start_line,
                    end_line: row.target_end_line,
                },
                relationship: {
                    type: row.relationship_type,
                    confidence: row.confidence || 0.8,
                }
            }));

            await this._runOptimizedBatch(batch);
            console.log(`[GraphBuilder] Processed ${Math.min(i + this.config.batchSize, totalRelationships)}/${totalRelationships} relationships`);
        }
    }

    async _runOptimizedBatch(batch) {
        const session = this.neo4jDriver.session({ database: this.dbName });
        const txConfig = {
            timeout: NEO4J_TRANSACTION_TIMEOUT, // Configurable via environment
            metadata: { operation: 'unwind-bulk-import' }
        };
        
        try {
            // Use a single transaction for the entire batch
            await session.writeTransaction(async tx => {
                const cypher = `
                    UNWIND $batch as item
                    MERGE (source:POI {id: item.source.id})
                    ON CREATE SET source = item.source
                    MERGE (target:POI {id: item.target.id})
                    ON CREATE SET target = item.target
                    MERGE (source)-[r:RELATIONSHIP {type: item.relationship.type}]->(target)
                    SET r.confidence = item.relationship.confidence
                `;
                await tx.run(cypher, { batch });
            }, txConfig);
        } catch (error) {
            console.error(`[GraphBuilder] Error processing batch:`, error);
            throw error;
        } finally {
            await session.close();
        }
    }

    generateSemanticId(poi, filePath, startLine) {
        if (poi.type === 'file') return filePath;
        return `${poi.type}:${poi.name}@${filePath}:${startLine}`;
    }
}

module.exports = GraphBuilder;