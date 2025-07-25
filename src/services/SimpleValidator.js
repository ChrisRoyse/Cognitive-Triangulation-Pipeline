/**
 * Simple Validator - Consolidated replacement for enterprise validation services
 * Replaces 7,000+ lines of over-engineered enterprise architecture
 */

class SimpleValidator {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.strictMode = options.strictMode || false;
    }
    
    /**
     * Basic data validation
     */
    async validateData(data) {
        if (!this.enabled) return { valid: true, data };
        
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid data provided');
        }
        return { valid: true, data };
    }
    
    /**
     * Simple relationship validation
     */
    async validateRelationships(relationships) {
        if (!this.enabled) return relationships;
        
        if (!Array.isArray(relationships)) {
            throw new Error('Relationships must be an array');
        }
        
        return relationships.filter(rel => 
            rel && 
            rel.source && 
            rel.target && 
            typeof rel.source === 'string' && 
            typeof rel.target === 'string'
        );
    }
    
    /**
     * Simple conflict resolution using last-write-wins strategy
     */
    async resolveConflicts(items) {
        if (!this.enabled || !Array.isArray(items)) return items;
        
        const seen = new Map();
        const resolved = [];
        
        // Process in reverse to implement last-write-wins
        for (const item of items.reverse()) {
            const key = item.id || item.name || JSON.stringify(item);
            if (!seen.has(key)) {
                seen.set(key, true);
                resolved.unshift(item);
            }
        }
        
        return resolved;
    }
    
    /**
     * Simple evidence validation - just checks for required fields
     */
    async validateEvidence(evidence) {
        if (!this.enabled) return { valid: true, evidence };
        
        if (!evidence || !evidence.data) {
            return { valid: false, reason: 'Missing evidence data' };
        }
        
        return { valid: true, evidence };
    }
    
    /**
     * Simple quality assessment
     */
    async assessQuality(data) {
        if (!this.enabled) return { score: 1.0, passed: true };
        
        const score = data && Object.keys(data).length > 0 ? 0.8 : 0.2;
        return { score, passed: score >= 0.5 };
    }
    
    /**
     * Simple orchestration - just validates in sequence
     */
    async orchestrateValidation(data) {
        if (!this.enabled) return { valid: true, data };
        
        const dataResult = await this.validateData(data);
        if (!dataResult.valid) return dataResult;
        
        const quality = await this.assessQuality(data);
        
        return {
            valid: quality.passed,
            data: dataResult.data,
            quality: quality.score
        };
    }
    
    /**
     * Simple checkpoint creation - just returns a timestamp
     */
    async createCheckpoint(data) {
        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            data: data || {}
        };
    }
    
    /**
     * Simple event publishing - just logs for development
     */
    async publishEvent(event) {
        if (!this.enabled) return;
        
        console.log(`[SimpleValidator] Event: ${event.type || 'unknown'}`, {
            timestamp: new Date().toISOString(),
            data: event.data || {}
        });
        
        return { published: true, eventId: Date.now().toString() };
    }
}

module.exports = { SimpleValidator };