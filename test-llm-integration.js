// Test LLM integration directly

const { getDeepseekClient } = require('./src/utils/deepseekClient');
const fs = require('fs').promises;

async function testLLMIntegration() {
    console.log('🧪 Testing LLM integration...');
    
    try {
        // Get LLM client
        const llmClient = getDeepseekClient();
        console.log('✅ LLM client initialized');
        
        // Read a simple test file
        const testFile = './polyglot-test/js/utils.js';
        const fileContent = await fs.readFile(testFile, 'utf-8');
        console.log('📄 Read test file:', testFile);
        console.log('File size:', fileContent.length, 'characters');
        
        // Create a simple prompt
        const prompt = `
Analyze this JavaScript file and extract Points of Interest (POIs).
Return a JSON object with a "pois" array.
Each POI should have: name, type (FunctionDefinition or VariableDeclaration), start_line, end_line.

File content:
\`\`\`javascript
${fileContent.substring(0, 1000)}... // truncated for test
\`\`\`
`;
        
        console.log('\\n📤 Sending request to LLM...');
        const startTime = Date.now();
        
        const completion = await llmClient.createChatCompletion({
            model: 'deepseek-coder',
            messages: [
                {
                    role: 'system',
                    content: 'You are a code analysis assistant. Extract POIs from code and return valid JSON.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.1,
            max_tokens: 2000
        });
        
        const responseTime = Date.now() - startTime;
        console.log('⏱️ Response time:', responseTime, 'ms');
        
        const response = completion.choices[0].message.content;
        console.log('\\n📥 LLM Response:');
        console.log(response);
        
        // Try to parse the response
        try {
            const parsed = JSON.parse(response);
            console.log('\\n✅ Successfully parsed JSON response');
            console.log('POIs found:', parsed.pois?.length || 0);
            if (parsed.pois && parsed.pois.length > 0) {
                console.log('Sample POI:', parsed.pois[0]);
            }
        } catch (e) {
            console.log('\\n❌ Failed to parse JSON:', e.message);
        }
        
    } catch (error) {
        console.error('\\n❌ LLM Integration Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

testLLMIntegration().catch(console.error);