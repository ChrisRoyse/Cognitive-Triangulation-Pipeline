const SemanticIdentityService = require('../../../src/services/SemanticIdentityService');
const path = require('path');

describe('SemanticIdentityService', () => {
    let service;

    beforeEach(() => {
        service = new SemanticIdentityService();
    });

    describe('generateSemanticId', () => {
        it('should generate semantic ID with correct format', () => {
            const filePath = '/path/to/auth.js';
            const poi = {
                name: 'validateCredentials',
                type: 'FunctionDefinition',
                start_line: 10,
                end_line: 20
            };

            const semanticId = service.generateSemanticId(filePath, poi);
            
            expect(semanticId).toBe('auth_func_validatecredentials');
            expect(service.usedIds.has(semanticId)).toBe(true);
        });

        it('should handle naming conflicts with suffixes', () => {
            const filePath = '/path/to/user.js';
            const poi1 = { name: 'UserManager', type: 'ClassDefinition' };
            const poi2 = { name: 'UserManager', type: 'ClassDefinition' };

            const id1 = service.generateSemanticId(filePath, poi1);
            const id2 = service.generateSemanticId(filePath, poi2);

            expect(id1).toBe('user_class_usermanager');
            expect(id2).toBe('user_class_usermanager_1');
        });

        it('should normalize different POI types correctly', () => {
            const filePath = '/path/to/config.js';
            const testCases = [
                { type: 'ClassDefinition', expected: 'class' },
                { type: 'FunctionDefinition', expected: 'func' },
                { type: 'VariableDeclaration', expected: 'var' },
                { type: 'ImportStatement', expected: 'import' }
            ];

            testCases.forEach(({ type, expected }) => {
                const poi = { name: 'test', type };
                const semanticId = service.generateSemanticId(filePath, poi);
                expect(semanticId).toContain(`_${expected}_`);
            });
        });

        it('should handle camelCase names correctly', () => {
            const filePath = '/path/to/api.js';
            const poi = {
                name: 'getUserProfile',
                type: 'FunctionDefinition'
            };

            const semanticId = service.generateSemanticId(filePath, poi);
            expect(semanticId).toBe('api_func_getuserprofile');
        });

        it('should generate file prefixes correctly', () => {
            const testCases = [
                { path: '/path/to/index.js', expected: 'idx' },
                { path: '/path/to/config.js', expected: 'cfg' },
                { path: '/path/to/utils.js', expected: 'util' },
                { path: '/path/to/server.js', expected: 'srv' }
            ];

            testCases.forEach(({ path: filePath, expected }) => {
                const poi = { name: 'test', type: 'FunctionDefinition' };
                const semanticId = service.generateSemanticId(filePath, poi);
                expect(semanticId.startsWith(expected)).toBe(true);
            });
        });
    });

    describe('parseSemanticId', () => {
        it('should parse semantic ID correctly', () => {
            const semanticId = 'auth_func_validatecredentials';
            const parsed = service.parseSemanticId(semanticId);

            expect(parsed).toEqual({
                filePrefix: 'auth',
                poiType: 'func',
                semanticName: 'validatecredentials',
                suffix: null
            });
        });

        it('should parse semantic ID with suffix', () => {
            const semanticId = 'user_class_usermanager_2';
            const parsed = service.parseSemanticId(semanticId);

            expect(parsed).toEqual({
                filePrefix: 'user',
                poiType: 'class',
                semanticName: 'usermanager',
                suffix: 2
            });
        });

        it('should handle names with underscores', () => {
            const semanticId = 'config_var_database_url';
            const parsed = service.parseSemanticId(semanticId);

            expect(parsed).toEqual({
                filePrefix: 'config',
                poiType: 'var',
                semanticName: 'database_url',
                suffix: null
            });
        });

        it('should throw error for invalid format', () => {
            expect(() => service.parseSemanticId('invalid')).toThrow();
            expect(() => service.parseSemanticId('a_b')).toThrow();
            expect(() => service.parseSemanticId('')).toThrow();
            expect(() => service.parseSemanticId(null)).toThrow();
        });
    });

    describe('generateBatchSemanticIds', () => {
        it('should generate semantic IDs for multiple POIs', () => {
            const filePath = '/path/to/auth.js';
            const pois = [
                { name: 'validateCredentials', type: 'FunctionDefinition' },
                { name: 'hashPassword', type: 'FunctionDefinition' },
                { name: 'AuthManager', type: 'ClassDefinition' }
            ];

            const result = service.generateBatchSemanticIds(filePath, pois);

            expect(result).toHaveLength(3);
            expect(result[0].semantic_id).toBe('auth_func_validatecredentials');
            expect(result[1].semantic_id).toBe('auth_func_hashpassword');
            expect(result[2].semantic_id).toBe('auth_class_authmanager');
            
            // Ensure original POI data is preserved
            expect(result[0].name).toBe('validateCredentials');
            expect(result[0].type).toBe('FunctionDefinition');
        });

        it('should handle conflicts within batch', () => {
            const filePath = '/path/to/test.js';
            const pois = [
                { name: 'helper', type: 'FunctionDefinition' },
                { name: 'helper', type: 'FunctionDefinition' },
                { name: 'helper', type: 'VariableDeclaration' }
            ];

            const result = service.generateBatchSemanticIds(filePath, pois);

            expect(result[0].semantic_id).toBe('test_func_helper');
            expect(result[1].semantic_id).toBe('test_func_helper_1');
            expect(result[2].semantic_id).toBe('test_var_helper');
        });

        it('should generate fallback IDs for invalid POIs', () => {
            const filePath = '/path/to/test.js';
            const pois = [
                { name: 'validPoi', type: 'FunctionDefinition' },
                { name: '', type: 'FunctionDefinition' }, // Invalid: empty name
                { name: 'anotherValid', type: 'ClassDefinition' }
            ];

            const result = service.generateBatchSemanticIds(filePath, pois);

            expect(result).toHaveLength(3);
            expect(result[0].semantic_id).toBe('test_func_validpoi');
            expect(result[1].semantic_id).toMatch(/^fallback_/);
            expect(result[2].semantic_id).toBe('test_class_anothervalid');
        });
    });

    describe('isValidSemanticId', () => {
        it('should validate correct semantic IDs', () => {
            const validIds = [
                'auth_func_validate',
                'user_class_manager_1',
                'config_var_database_url',
                'api_import_express'
            ];

            validIds.forEach(id => {
                expect(service.isValidSemanticId(id)).toBe(true);
            });
        });

        it('should reject invalid semantic IDs', () => {
            const invalidIds = [
                'invalid',
                'a_b',
                '',
                null,
                undefined,
                'only_two_parts'
            ];

            invalidIds.forEach(id => {
                expect(service.isValidSemanticId(id)).toBe(false);
            });
        });
    });

    describe('cache management', () => {
        it('should cache file prefixes for consistency', () => {
            const filePath = '/path/to/auth.js';
            const poi1 = { name: 'func1', type: 'FunctionDefinition' };
            const poi2 = { name: 'func2', type: 'FunctionDefinition' };

            const id1 = service.generateSemanticId(filePath, poi1);
            const id2 = service.generateSemanticId(filePath, poi2);

            expect(id1.startsWith('auth_')).toBe(true);
            expect(id2.startsWith('auth_')).toBe(true);
            expect(service.filePrefixCache.has(filePath)).toBe(true);
        });

        it('should clear cache properly', () => {
            const filePath = '/path/to/test.js';
            const poi = { name: 'test', type: 'FunctionDefinition' };

            service.generateSemanticId(filePath, poi);
            expect(service.usedIds.size).toBeGreaterThan(0);
            expect(service.filePrefixCache.size).toBeGreaterThan(0);

            service.clearCache();
            expect(service.usedIds.size).toBe(0);
            expect(service.filePrefixCache.size).toBe(0);
        });

        it('should import existing IDs to prevent conflicts', () => {
            const existingIds = ['auth_func_test', 'user_class_manager'];
            service.importExistingIds(existingIds);

            const filePath = '/path/to/auth.js';
            const poi = { name: 'test', type: 'FunctionDefinition' };

            const semanticId = service.generateSemanticId(filePath, poi);
            expect(semanticId).toBe('auth_func_test_1'); // Should add suffix to avoid conflict
        });
    });

    describe('getStats', () => {
        it('should return correct statistics', () => {
            const filePath = '/path/to/test.js';
            const poi = { name: 'test', type: 'FunctionDefinition' };

            service.generateSemanticId(filePath, poi);
            const stats = service.getStats();

            expect(stats.totalGeneratedIds).toBe(1);
            expect(stats.cachedFilePrefixes).toBe(1);
            expect(stats.typeMapping).toBeGreaterThan(0);
        });
    });
});