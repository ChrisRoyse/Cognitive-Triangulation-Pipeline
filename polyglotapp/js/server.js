/**
 * Main Express.js API Gateway Server
 * Coordinates between JavaScript, Python, and Java services
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Import our custom modules
const { API_CONFIG, SERVICES, isDevelopment } = require('./config');
const { logger, httpRequest, validateEmail, formatDate } = require('./utils');
const { authenticateToken, requireRole, validateUserCredentials, logout, authManager } = require('./auth');

class ApiGateway {
  constructor() {
    this.app = express();
    this.pythonServiceUrl = SERVICES.pythonService;
    this.javaServiceUrl = SERVICES.javaService;
    this.mlServiceUrl = SERVICES.mlService;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors(API_CONFIG.cors));
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info('API Request', { method: req.method, url: req.url });
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', this.healthCheck.bind(this));
    
    // Authentication
    this.app.post('/api/auth/login', this.login.bind(this));
    this.app.post('/api/auth/logout', authenticateToken, logout);
    
    // User management (Java service)
    this.app.get('/api/users', authenticateToken, this.getUsers.bind(this));
    this.app.post('/api/users', authenticateToken, requireRole(['admin']), this.createUser.bind(this));
    
    // Data processing (Python service)
    this.app.post('/api/data/process', authenticateToken, this.processData.bind(this));
    this.app.get('/api/data/analyze/:id', authenticateToken, this.getAnalysis.bind(this));
    
    // Machine learning (Python ML service)
    this.app.post('/api/ml/predict', authenticateToken, this.makePrediction.bind(this));
    this.app.get('/api/ml/models', authenticateToken, this.getModels.bind(this));
    
    // Business logic (Java service)
    this.app.post('/api/business/calculate', authenticateToken, this.calculateMetrics.bind(this));
    this.app.get('/api/business/reports/:type', authenticateToken, this.generateReport.bind(this));
  }

  async healthCheck(req, res) {
    const health = {
      status: 'healthy',
      timestamp: formatDate(new Date()),
      uptime: process.uptime(),
      services: await this.checkServices()
    };
    res.json(health);
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      
      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email' });
      }
      
      const user = await validateUserCredentials(email, password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = authManager.generateToken(user);
      res.json({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
      logger.error('Login failed', { error: error.message });
      res.status(500).json({ error: 'Login failed' });
    }
  }

  async getUsers(req, res) {
    try {
      const response = await httpRequest(`${this.javaServiceUrl}/api/users`, {
        headers: { 'Authorization': req.headers.authorization }
      });
      res.json(response);
    } catch (error) {
      logger.error('Failed to get users', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  async createUser(req, res) {
    try {
      const response = await httpRequest(`${this.javaServiceUrl}/api/users`, {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: {
          'Authorization': req.headers.authorization,
          'Content-Type': 'application/json'
        }
      });
      res.status(201).json(response);
    } catch (error) {
      logger.error('Failed to create user', { error: error.message });
      res.status(500).json({ error: 'Failed to create user' });
    }
  }

  async processData(req, res) {
    try {
      const response = await httpRequest(`${this.pythonServiceUrl}/api/process`, {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: {
          'Authorization': req.headers.authorization,
          'Content-Type': 'application/json'
        }
      });
      res.json(response);
    } catch (error) {
      logger.error('Data processing failed', { error: error.message });
      res.status(500).json({ error: 'Processing failed' });
    }
  }

  async getAnalysis(req, res) {
    try {
      const { id } = req.params;
      const response = await httpRequest(`${this.pythonServiceUrl}/api/analysis/${id}`, {
        headers: { 'Authorization': req.headers.authorization }
      });
      res.json(response);
    } catch (error) {
      logger.error('Failed to get analysis', { error: error.message });
      res.status(500).json({ error: 'Analysis fetch failed' });
    }
  }

  async makePrediction(req, res) {
    try {
      const response = await httpRequest(`${this.mlServiceUrl}/api/predict`, {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: {
          'Authorization': req.headers.authorization,
          'Content-Type': 'application/json'
        }
      });
      res.json(response);
    } catch (error) {
      logger.error('Prediction failed', { error: error.message });
      res.status(500).json({ error: 'Prediction failed' });
    }
  }

  async getModels(req, res) {
    try {
      const response = await httpRequest(`${this.mlServiceUrl}/api/models`, {
        headers: { 'Authorization': req.headers.authorization }
      });
      res.json(response);
    } catch (error) {
      logger.error('Failed to get models', { error: error.message });
      res.status(500).json({ error: 'Model fetch failed' });
    }
  }

  async calculateMetrics(req, res) {
    try {
      const response = await httpRequest(`${this.javaServiceUrl}/api/business/calculate`, {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: {
          'Authorization': req.headers.authorization,
          'Content-Type': 'application/json'
        }
      });
      res.json(response);
    } catch (error) {
      logger.error('Calculation failed', { error: error.message });
      res.status(500).json({ error: 'Calculation failed' });
    }
  }

  async generateReport(req, res) {
    try {
      const { type } = req.params;
      const response = await httpRequest(`${this.javaServiceUrl}/api/reports/${type}`, {
        headers: { 'Authorization': req.headers.authorization }
      });
      res.json(response);
    } catch (error) {
      logger.error('Report generation failed', { error: error.message });
      res.status(500).json({ error: 'Report failed' });
    }
  }

  async checkServices() {
    const services = {};
    const checks = [
      { name: 'python', url: `${this.pythonServiceUrl}/health` },
      { name: 'java', url: `${this.javaServiceUrl}/health` },
      { name: 'ml', url: `${this.mlServiceUrl}/health` }
    ];
    
    for (const service of checks) {
      try {
        await httpRequest(service.url, { timeout: 5000 });
        services[service.name] = { status: 'healthy' };
      } catch (error) {
        services[service.name] = { status: 'unhealthy', error: error.message };
      }
    }
    
    return services;
  }

  async start() {
    this.app.listen(API_CONFIG.port, API_CONFIG.host, () => {
      logger.info('API Gateway started', { port: API_CONFIG.port });
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const gateway = new ApiGateway();
  gateway.start().catch(error => {
    logger.error('Server start failed', { error: error.message });
    process.exit(1);
  });
}

module.exports = { ApiGateway }; 