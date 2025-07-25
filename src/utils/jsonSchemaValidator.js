const Ajv = require('ajv');
const ajv = new Ajv();

const analysisSchema = {
  type: 'object',
  properties: {
    pois: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          poiType: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          char: { type: 'integer' },
          context: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['filePath', 'poiType', 'startLine', 'endLine', 'char', 'context', 'description'],
        additionalProperties: false,
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source_poi_id: { type: 'string' },
          target_poi_id: { type: 'string' },
          type: { type: 'string' },
          filePath: { type: 'string' },
        },
        required: ['source_poi_id', 'target_poi_id', 'type', 'filePath'],
        additionalProperties: false,
      },
    },
  },
  required: ['pois', 'relationships'],
  additionalProperties: false,
};

const validate = ajv.compile(analysisSchema);

/**
 * Validates the analysis data against the predefined JSON schema.
 * @param {object} data The data to validate.
 * @returns {{valid: boolean, errors: (import('ajv').ErrorObject[] | null | undefined)}}
 */
function validateAnalysis(data) {
  const valid = validate(data);
  return {
    valid,
    errors: validate.errors,
  };
}

module.exports = {
  validateAnalysis,
  analysisSchema,
};