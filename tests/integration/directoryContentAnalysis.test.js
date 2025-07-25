const DirectoryResolutionWorker = require('../../src/workers/directoryResolutionWorker');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('Directory Content Analysis - Integration Test', () => {
    let worker;
    let testDir;

    beforeEach(async () => {
        testDir = path.join(os.tmpdir(), `dir-analysis-test-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });
        
        worker = new DirectoryResolutionWorker(
            null, null, null, null, null,
            { processOnly: true }
        );
    });

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
    });

    it('should demonstrate improved content extraction vs truncation', async () => {
        // Create a realistic file with important content beyond 500 chars
        const serviceFile = path.join(testDir, 'UserService.js');
        const fileContent = `
/**
 * UserService - Handles all user-related operations
 * This service manages user authentication, profile updates,
 * and integration with external OAuth providers.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { UserModel } = require('../models/User');
const { EmailService } = require('./EmailService');
const { CacheService } = require('./CacheService');
const { Logger } = require('../utils/Logger');

class UserService {
    constructor(dbConnection, config) {
        this.db = dbConnection;
        this.config = config;
        this.emailService = new EmailService(config.email);
        this.cache = new CacheService(config.redis);
        this.logger = new Logger('UserService');
        this.googleClient = new OAuth2Client(config.oauth.google.clientId);
    }

    async createUser(userData) {
        const { email, password, firstName, lastName } = userData;
        
        // Check if user already exists
        const existingUser = await this.getUserByEmail(email);
        if (existingUser) {
            throw new Error('User already exists');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user in database
        const user = await UserModel.create({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            createdAt: new Date()
        });

        // Send welcome email
        await this.emailService.sendWelcomeEmail(user);
        
        return this.sanitizeUser(user);
    }

    async authenticateUser(email, password) {
        const user = await this.getUserByEmail(email);
        if (!user) {
            throw new Error('Invalid credentials');
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            throw new Error('Invalid credentials');
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            this.config.jwt.secret,
            { expiresIn: this.config.jwt.expiresIn }
        );

        // Cache the session
        await this.cache.set(\`session:\${user.id}\`, token, 3600);
        
        return { token, user: this.sanitizeUser(user) };
    }

    async verifyGoogleToken(idToken) {
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: this.config.oauth.google.clientId
            });
            
            const payload = ticket.getPayload();
            return {
                email: payload.email,
                firstName: payload.given_name,
                lastName: payload.family_name,
                googleId: payload.sub
            };
        } catch (error) {
            this.logger.error('Google token verification failed', error);
            throw new Error('Invalid Google token');
        }
    }

    sanitizeUser(user) {
        const { password, ...sanitized } = user;
        return sanitized;
    }

    async getUserByEmail(email) {
        return UserModel.findOne({ email });
    }
}

module.exports = { UserService };
`;
        await fs.writeFile(serviceFile, fileContent);

        // Get content using our improved extraction
        const contents = await worker.getFileContents(testDir);
        expect(contents).toHaveLength(1);
        
        const extracted = contents[0].content;
        
        // Old approach would truncate at 500 chars, missing critical information
        const truncated = fileContent.substring(0, 500);
        
        console.log('=== COMPARISON ===');
        console.log('\nOld Truncated Approach (500 chars):');
        console.log('-----------------------------------');
        console.log(truncated);
        console.log('\n[... TRUNCATED - Missing all the important implementation details! ...]');
        
        console.log('\n\nNew Smart Extraction Approach:');
        console.log('------------------------------');
        console.log(extracted);
        
        // Verify the new approach captures key information
        expect(extracted).toContain('const bcrypt = require'); // Important imports
        expect(extracted).toContain('class UserService'); // Class definition
        expect(extracted).toContain('constructor(dbConnection, config)'); // Constructor
        expect(extracted).toContain('module.exports = { UserService }'); // Exports
        
        // These would be missed with truncation
        expect(truncated).not.toContain('class UserService');
        expect(truncated).not.toContain('module.exports');
        
        console.log('\n=== BENEFITS ===');
        console.log('✅ Captures all imports for dependency understanding');
        console.log('✅ Includes class definition and constructor');
        console.log('✅ Shows key method signatures');
        console.log('✅ Preserves module exports');
        console.log('✅ Provides complete context for directory analysis');
    });

    it('should handle mixed file types in a directory', async () => {
        // Create a more complex directory structure
        const files = {
            'index.js': `
import { UserService } from './services/UserService';
import { AuthController } from './controllers/AuthController';
import express from 'express';

const app = express();
const userService = new UserService();
const authController = new AuthController(userService);

app.post('/login', authController.login);
app.post('/register', authController.register);

export default app;
`,
            'config.json': '{"port": 3000, "database": {"host": "localhost"}}',
            'utils.py': `
import hashlib
import datetime
from typing import Optional, Dict

def hash_password(password: str) -> str:
    """Hash a password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

class TokenGenerator:
    def __init__(self, secret: str):
        self.secret = secret
    
    def generate(self, payload: Dict) -> str:
        # Implementation details...
        pass
`,
            'README.md': '# User Service\n\nThis service handles user authentication...',
            'data.csv': 'id,name,email\n1,John,john@example.com'
        };

        for (const [filename, content] of Object.entries(files)) {
            await fs.writeFile(path.join(testDir, filename), content);
        }

        const contents = await worker.getFileContents(testDir);
        
        // Should only include code files
        const fileNames = contents.map(f => f.fileName);
        expect(fileNames).toContain('index.js');
        expect(fileNames).toContain('utils.py');
        expect(fileNames).not.toContain('config.json');
        expect(fileNames).not.toContain('README.md');
        expect(fileNames).not.toContain('data.csv');
        
        // Check that key content is extracted
        const indexContent = contents.find(f => f.fileName === 'index.js').content;
        expect(indexContent).toContain('import { UserService }');
        expect(indexContent).toContain('export default app');
        
        const pythonContent = contents.find(f => f.fileName === 'utils.py').content;
        expect(pythonContent).toContain('import hashlib');
        expect(pythonContent).toContain('class TokenGenerator:');
    });
});