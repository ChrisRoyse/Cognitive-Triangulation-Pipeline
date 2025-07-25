/**
 * Authentication middleware and utilities
 * Handles JWT tokens, session management, and user authentication
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { SECURITY, API_CONFIG } = require('./config');
const { logger, generateId, httpRequest } = require('./utils');

/**
 * User authentication class
 */
class AuthManager {
  constructor() {
    this.jwtSecret = SECURITY.jwtSecret;
    this.jwtExpiresIn = SECURITY.jwtExpiresIn;
    this.bcryptRounds = SECURITY.bcryptRounds;
    this.activeSessions = new Map();
  }

  /**
   * Hashes a password using bcrypt
   * @param {string} password - Plain text password
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(password) {
    try {
      return await bcrypt.hash(password, this.bcryptRounds);
    } catch (error) {
      logger.error('Password hashing failed', { error: error.message });
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verifies a password against a hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} True if password matches
   */
  async verifyPassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error('Password verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Generates a JWT token for a user
   * @param {Object} user - User object
   * @returns {string} JWT token
   */
  generateToken(user) {
    try {
      const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: generateId()
      };

      const token = jwt.sign(payload, this.jwtSecret, {
        expiresIn: this.jwtExpiresIn,
        issuer: 'polyglot-test-app',
        audience: 'polyglot-test-users'
      });

      // Store session info
      this.activeSessions.set(payload.sessionId, {
        userId: user.id,
        email: user.email,
        createdAt: new Date(),
        lastActivity: new Date()
      });

      logger.info('JWT token generated', { userId: user.id, sessionId: payload.sessionId });
      return token;
    } catch (error) {
      logger.error('Token generation failed', { error: error.message, userId: user.id });
      throw new Error('Token generation failed');
    }
  }

  /**
   * Verifies a JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object|null} Decoded token payload or null if invalid
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      // Check if session is still active
      const session = this.activeSessions.get(decoded.sessionId);
      if (!session) {
        logger.warn('Token verification failed: session not found', { sessionId: decoded.sessionId });
        return null;
      }

      // Update last activity
      session.lastActivity = new Date();
      
      logger.debug('Token verified successfully', { userId: decoded.userId, sessionId: decoded.sessionId });
      return decoded;
    } catch (error) {
      logger.warn('Token verification failed', { error: error.message });
      return null;
    }
  }

  /**
   * Invalidates a session
   * @param {string} sessionId - Session ID to invalidate
   * @returns {boolean} True if session was found and invalidated
   */
  invalidateSession(sessionId) {
    const existed = this.activeSessions.has(sessionId);
    this.activeSessions.delete(sessionId);
    
    if (existed) {
      logger.info('Session invalidated', { sessionId });
    }
    
    return existed;
  }

  /**
   * Cleans up expired sessions
   */
  cleanupExpiredSessions() {
    const now = new Date();
    const maxAge = SECURITY.cookieMaxAge;
    let cleanedCount = 0;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      const sessionAge = now - session.lastActivity;
      if (sessionAge > maxAge) {
        this.activeSessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up expired sessions', { count: cleanedCount });
    }
  }
}

// Global auth manager instance
const authManager = new AuthManager();

/**
 * Express middleware for JWT authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    logger.warn('Authentication failed: no token provided', { 
      ip: req.ip, 
      userAgent: req.get('User-Agent') 
    });
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = authManager.verifyToken(token);
  if (!decoded) {
    logger.warn('Authentication failed: invalid token', { 
      ip: req.ip, 
      userAgent: req.get('User-Agent') 
    });
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

/**
 * Express middleware for role-based authorization
 * @param {string|Array<string>} allowedRoles - Roles allowed to access the resource
 * @returns {Function} Express middleware function
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  
  return (req, res, next) => {
    if (!req.user) {
      logger.warn('Authorization failed: no user in request');
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Authorization failed: insufficient role', { 
        userId: req.user.userId, 
        userRole: req.user.role, 
        requiredRoles: roles 
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

/**
 * Validates user credentials against external auth service
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object|null>} User object if valid, null otherwise
 */
async function validateUserCredentials(email, password) {
  try {
    const authServiceUrl = `${API_CONFIG.authService}/validate`;
    const response = await httpRequest(authServiceUrl, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.valid) {
      logger.info('User credentials validated', { email });
      return response.user;
    } else {
      logger.warn('Invalid user credentials', { email });
      return null;
    }
  } catch (error) {
    logger.error('Credential validation error', { error: error.message, email });
    return null;
  }
}

/**
 * Logout handler that invalidates session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function logout(req, res) {
  if (req.user && req.user.sessionId) {
    authManager.invalidateSession(req.user.sessionId);
    logger.info('User logged out', { userId: req.user.userId, sessionId: req.user.sessionId });
  }
  
  res.json({ message: 'Logged out successfully' });
}

// Set up periodic session cleanup
setInterval(() => {
  authManager.cleanupExpiredSessions();
}, 5 * 60 * 1000); // Every 5 minutes

module.exports = {
  AuthManager,
  authManager,
  authenticateToken,
  requireRole,
  validateUserCredentials,
  logout
}; 