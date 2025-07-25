const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

/**
 * Production-ready DeepSeek LLM Client
 * Uses OpenAI SDK for compatibility with DeepSeek API
 */
class DeepSeekClient {
    constructor() {
        this.client = new OpenAI({
            baseURL: 'https://api.deepseek.com',
            apiKey: process.env.DEEPSEEK_API_KEY,
            timeout: 600000, // 10 minutes timeout for complex analysis
            dangerouslyAllowBrowser: true, // Allow in test environment
        });
        
        if (!process.env.DEEPSEEK_API_KEY) {
            throw new Error('DEEPSEEK_API_KEY environment variable is required');
        }
        
        // Initialize MCP tools
        this.tools = this._initializeTools();
    }
    
    /**
     * Initialize MCP tools for DeepSeek
     */
    _initializeTools() {
        return [
            {
                type: "function",
                function: {
                    name: "read_file",
                    description: "Read the contents of a file from the filesystem. Use this tool when you need to examine source code, configuration files, or any other file contents.",
                    parameters: {
                        type: "object",
                        properties: {
                            file_path: {
                                type: "string",
                                description: "The absolute path to the file to read. Must be a valid file path."
                            },
                            encoding: {
                                type: "string", 
                                description: "File encoding (default: utf-8)",
                                default: "utf-8"
                            }
                        },
                        required: ["file_path"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "list_directory",
                    description: "List files and directories in a given path. Use this tool to explore directory structure.",
                    parameters: {
                        type: "object",
                        properties: {
                            directory_path: {
                                type: "string",
                                description: "The absolute path to the directory to list"
                            }
                        },
                        required: ["directory_path"]
                    }
                }
            }
        ];
    }
    
    /**
     * Execute MCP tool functions
     */
    async _executeTool(toolName, parameters) {
        try {
            switch (toolName) {
                case 'read_file':
                    return await this._readFile(parameters.file_path, parameters.encoding || 'utf-8');
                    
                case 'list_directory':
                    return await this._listDirectory(parameters.directory_path);
                    
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (error) {
            return {
                error: true,
                message: error.message,
                details: `Failed to execute tool ${toolName}: ${error.message}`
            };
        }
    }
    
    /**
     * Read file contents with security checks
     */
    async _readFile(filePath, encoding = 'utf-8') {
        try {
            // Security check - ensure path is within project directory
            const projectRoot = path.resolve(process.cwd());
            const resolvedPath = path.resolve(filePath);
            
            if (!resolvedPath.startsWith(projectRoot)) {
                throw new Error('File path is outside the allowed project directory');
            }
            
            const content = await fs.readFile(resolvedPath, encoding);
            const stats = await fs.stat(resolvedPath);
            
            return {
                success: true,
                content: content,
                file_path: resolvedPath,
                size: stats.size,
                modified: stats.mtime.toISOString()
            };
        } catch (error) {
            throw new Error(`Cannot read file ${filePath}: ${error.message}`);
        }
    }
    
    /**
     * List directory contents with security checks
     */
    async _listDirectory(dirPath) {
        try {
            // Security check - ensure path is within project directory
            const projectRoot = path.resolve(process.cwd());
            const resolvedPath = path.resolve(dirPath);
            
            if (!resolvedPath.startsWith(projectRoot)) {
                throw new Error('Directory path is outside the allowed project directory');
            }
            
            const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
            const files = [];
            const directories = [];
            
            for (const entry of entries) {
                const fullPath = path.join(resolvedPath, entry.name);
                const stats = await fs.stat(fullPath);
                
                const item = {
                    name: entry.name,
                    path: fullPath,
                    size: stats.size,
                    modified: stats.mtime.toISOString()
                };
                
                if (entry.isDirectory()) {
                    directories.push(item);
                } else {
                    files.push(item);
                }
            }
            
            return {
                success: true,
                directory: resolvedPath,
                files: files,
                directories: directories,
                total_items: files.length + directories.length
            };
        } catch (error) {
            throw new Error(`Cannot list directory ${dirPath}: ${error.message}`);
        }
    }

    /**
     * Makes a call to DeepSeek API with the given prompt and tool support
     * @param {Object} prompt - The prompt object with system and user messages
     * @param {Object} options - Additional options including tool usage
     * @returns {Promise<Object>} - The response from DeepSeek
     */
    async call(prompt, options = {}) {
        try {
            const messages = [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ];

            const requestParams = {
                model: 'deepseek-chat', // Points to DeepSeek-V3-0324 (128K context, March 2025)
                messages: messages,
                temperature: 0.2, // Balanced temperature for natural but consistent output
                max_tokens: 8000, // Maximum allowed for generation
                stream: false
            };

            // Add tools if enabled
            if (options.enableTools !== false) {
                requestParams.tools = this.tools;
                requestParams.tool_choice = "auto";
            }

            const response = await this.client.chat.completions.create(requestParams);
            const choice = response.choices[0];
            
            // Handle tool calls
            if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                return await this._handleToolCalls(messages, choice.message, response.usage);
            }

            return {
                body: choice.message.content,
                usage: response.usage
            };
        } catch (error) {
            console.error('DeepSeek API call failed:', error.message);
            
            // Handle specific error types
            if (error.status === 429) {
                throw new Error(`DeepSeek API rate limit exceeded: ${error.message}`);
            } else if (error.status >= 500) {
                throw new Error(`DeepSeek API server error: ${error.message}`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                throw new Error(`DeepSeek API network timeout: ${error.message}`);
            }
            
            throw new Error(`DeepSeek API call failed: ${error.message}`);
        }
    }
    
    /**
     * Handle tool calls and continue the conversation
     */
    async _handleToolCalls(messages, assistantMessage, previousUsage) {
        // Add the assistant's message with tool calls
        messages.push(assistantMessage);
        
        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            const parameters = JSON.parse(toolCall.function.arguments);
            
            console.log(`Executing tool: ${toolName} with parameters:`, parameters);
            
            const toolResult = await this._executeTool(toolName, parameters);
            
            // Add tool result as a message
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult)
            });
        }
        
        // Make another API call with the tool results
        const followUpResponse = await this.client.chat.completions.create({
            model: 'deepseek-chat',
            messages: messages,
            temperature: 0.0,
            max_tokens: 8000,
            stream: false,
            tools: this.tools,
            tool_choice: "auto"
        });
        
        const followUpChoice = followUpResponse.choices[0];
        
        // Handle potential additional tool calls (recursive)
        if (followUpChoice.message.tool_calls && followUpChoice.message.tool_calls.length > 0) {
            return await this._handleToolCalls(messages, followUpChoice.message, {
                prompt_tokens: previousUsage.prompt_tokens + followUpResponse.usage.prompt_tokens,
                completion_tokens: previousUsage.completion_tokens + followUpResponse.usage.completion_tokens,
                total_tokens: previousUsage.total_tokens + followUpResponse.usage.total_tokens
            });
        }
        
        return {
            body: followUpChoice.message.content,
            usage: {
                prompt_tokens: previousUsage.prompt_tokens + followUpResponse.usage.prompt_tokens,
                completion_tokens: previousUsage.completion_tokens + followUpResponse.usage.completion_tokens,
                total_tokens: previousUsage.total_tokens + followUpResponse.usage.total_tokens
            },
            tool_calls_made: assistantMessage.tool_calls.length
        };
    }

    /**
     * Alternative interface for compatibility with tests and other code
     * @param {Object} options - Chat completion options
     * @returns {Promise<Object>} - The response in OpenAI format
     */
    async createChatCompletion(options) {
        try {
            const response = await this.client.chat.completions.create({
                model: options.model || 'deepseek-chat',
                messages: options.messages,
                temperature: options.temperature || 0.0,
                max_tokens: options.max_tokens || 8000,
                response_format: options.response_format,
                stream: false
            });

            return response;
        } catch (error) {
            console.error('DeepSeek createChatCompletion failed:', error.message);
            throw error;
        }
    }

    /**
     * Test the connection to DeepSeek API
     * @returns {Promise<boolean>} - True if connection is successful
     */
    async testConnection() {
        try {
            const testPrompt = {
                system: 'You are a helpful assistant.',
                user: 'Hello, please respond with "Connection successful"'
            };
            
            const response = await this.call(testPrompt);
            return response.body.includes('Connection successful');
        } catch (error) {
            console.error('DeepSeek connection test failed:', error.message);
            return false;
        }
    }
}

let clientInstance;

function getDeepseekClient() {
    if (!clientInstance) {
        clientInstance = new DeepSeekClient();
    }
    return clientInstance;
}

module.exports = {
    getDeepseekClient,
    DeepSeekClient,
};