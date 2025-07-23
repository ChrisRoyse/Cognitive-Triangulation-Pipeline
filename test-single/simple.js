
// Simple test file for pipeline
class DataProcessor {
    constructor() {
        this.data = [];
    }
    
    process(input) {
        return this.transform(input);
    }
    
    transform(data) {
        return data.map(item => item.toUpperCase());
    }
}

function createProcessor() {
    return new DataProcessor();
}

const processor = createProcessor();
module.exports = processor;
