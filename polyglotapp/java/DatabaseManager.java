package com.polyglot.services;

import java.sql.*;
import java.util.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Database operations manager for Java layer
 * Handles SQLite database connections and operations
 */
public class DatabaseManager {
    private static final String DB_URL = "jdbc:sqlite:polyglot_test.db";
    private Connection connection;
    
    public DatabaseManager() {
        initializeDatabase();
    }
    
    /**
     * Initialize database connection and create tables
     */
    private void initializeDatabase() {
        try {
            // Load SQLite JDBC driver
            Class.forName("org.sqlite.JDBC");
            
            // Create database connection
            connection = DriverManager.getConnection(DB_URL);
            
            // Create tables if they don't exist
            createTables();
            
            System.out.println("Database initialized successfully");
            
        } catch (Exception e) {
            System.err.println("Database initialization failed: " + e.getMessage());
            e.printStackTrace();
        }
    }
    
    /**
     * Create required database tables
     */
    private void createTables() throws SQLException {
        Statement stmt = connection.createStatement();
        
        // Users table (extended version)
        String createUsersTable = """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                password_hash TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                login_count INTEGER DEFAULT 0
            )
        """;
        stmt.execute(createUsersTable);
        
        // User activity log table
        String createActivityTable = """
            CREATE TABLE IF NOT EXISTS user_activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                activity_type TEXT NOT NULL,
                description TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """;
        stmt.execute(createActivityTable);
        
        // User sessions table
        String createSessionsTable = """
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                session_token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """;
        stmt.execute(createSessionsTable);
        
        // User preferences table
        String createPreferencesTable = """
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                preference_key TEXT NOT NULL,
                preference_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                UNIQUE(user_id, preference_key)
            )
        """;
        stmt.execute(createPreferencesTable);
        
        stmt.close();
    }
    
    /**
     * Create a new user
     */
    public int createUser(String email, String name, String role) throws SQLException {
        String sql = "INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            pstmt.setString(1, email);
            pstmt.setString(2, name);
            pstmt.setString(3, role);
            pstmt.setString(4, generatePasswordHash("password123")); // Default password
            
            int affectedRows = pstmt.executeUpdate();
            
            if (affectedRows > 0) {
                try (ResultSet generatedKeys = pstmt.getGeneratedKeys()) {
                    if (generatedKeys.next()) {
                        return generatedKeys.getInt(1);
                    }
                }
            }
        }
        
        return -1;
    }
    
    /**
     * Get user by email
     */
    public User getUserByEmail(String email) throws SQLException {
        String sql = "SELECT * FROM users WHERE email = ? AND is_active = TRUE";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setString(1, email);
            
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) {
                    return createUserFromResultSet(rs);
                }
            }
        }
        
        return null;
    }
    
    /**
     * Get user by ID
     */
    public User getUserById(int userId) throws SQLException {
        String sql = "SELECT * FROM users WHERE id = ?";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) {
                    return createUserFromResultSet(rs);
                }
            }
        }
        
        return null;
    }
    
    /**
     * Update user information
     */
    public boolean updateUser(int userId, String name, String role) throws SQLException {
        String sql = "UPDATE users SET name = ?, role = ? WHERE id = ?";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setString(1, name);
            pstmt.setString(2, role);
            pstmt.setInt(3, userId);
            
            return pstmt.executeUpdate() > 0;
        }
    }
    
    /**
     * Update last login timestamp
     */
    public boolean updateLastLogin(int userId) throws SQLException {
        String sql = "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            return pstmt.executeUpdate() > 0;
        }
    }
    
    /**
     * Deactivate user
     */
    public boolean deactivateUser(int userId) throws SQLException {
        String sql = "UPDATE users SET is_active = FALSE WHERE id = ?";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            return pstmt.executeUpdate() > 0;
        }
    }
    
    /**
     * Get users with pagination and filtering
     */
    public List<User> getUsers(int page, int pageSize, String role) throws SQLException {
        List<User> users = new ArrayList<>();
        
        StringBuilder sql = new StringBuilder("SELECT * FROM users WHERE is_active = TRUE");
        
        if (role != null && !role.isEmpty()) {
            sql.append(" AND role = ?");
        }
        
        sql.append(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql.toString())) {
            int paramIndex = 1;
            
            if (role != null && !role.isEmpty()) {
                pstmt.setString(paramIndex++, role);
            }
            
            pstmt.setInt(paramIndex++, pageSize);
            pstmt.setInt(paramIndex, (page - 1) * pageSize);
            
            try (ResultSet rs = pstmt.executeQuery()) {
                while (rs.next()) {
                    users.add(createUserFromResultSet(rs));
                }
            }
        }
        
        return users;
    }
    
    /**
     * Get total user count
     */
    public int getUserCount(String role) throws SQLException {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM users WHERE is_active = TRUE");
        
        if (role != null && !role.isEmpty()) {
            sql.append(" AND role = ?");
        }
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql.toString())) {
            if (role != null && !role.isEmpty()) {
                pstmt.setString(1, role);
            }
            
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) {
                    return rs.getInt(1);
                }
            }
        }
        
        return 0;
    }
    
    /**
     * Log user activity
     */
    public void logActivity(int userId, String activityType, String description) throws SQLException {
        String sql = "INSERT INTO user_activity (user_id, activity_type, description) VALUES (?, ?, ?)";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            pstmt.setString(2, activityType);
            pstmt.setString(3, description);
            pstmt.executeUpdate();
        }
    }
    
    /**
     * Create session token
     */
    public boolean createSession(int userId, String sessionToken, long expiresAt) throws SQLException {
        String sql = "INSERT INTO user_sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            pstmt.setString(2, sessionToken);
            pstmt.setTimestamp(3, new Timestamp(expiresAt));
            
            return pstmt.executeUpdate() > 0;
        }
    }
    
    /**
     * Validate session token
     */
    public boolean isValidSession(String sessionToken) throws SQLException {
        String sql = "SELECT COUNT(*) FROM user_sessions WHERE session_token = ? AND is_active = TRUE AND expires_at > CURRENT_TIMESTAMP";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setString(1, sessionToken);
            
            try (ResultSet rs = pstmt.executeQuery()) {
                return rs.next() && rs.getInt(1) > 0;
            }
        }
    }
    
    /**
     * Set user preference
     */
    public boolean setUserPreference(int userId, String key, String value) throws SQLException {
        String sql = """
            INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """;
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            pstmt.setString(2, key);
            pstmt.setString(3, value);
            
            return pstmt.executeUpdate() > 0;
        }
    }
    
    /**
     * Get user preference
     */
    public String getUserPreference(int userId, String key) throws SQLException {
        String sql = "SELECT preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?";
        
        try (PreparedStatement pstmt = connection.prepareStatement(sql)) {
            pstmt.setInt(1, userId);
            pstmt.setString(2, key);
            
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) {
                    return rs.getString("preference_value");
                }
            }
        }
        
        return null;
    }
    
    // Helper methods
    
    private User createUserFromResultSet(ResultSet rs) throws SQLException {
        User user = new User();
        user.setId(rs.getInt("id"));
        user.setEmail(rs.getString("email"));
        user.setName(rs.getString("name"));
        user.setRole(rs.getString("role"));
        user.setPasswordHash(rs.getString("password_hash"));
        user.setActive(rs.getBoolean("is_active"));
        user.setCreatedAt(rs.getString("created_at"));
        user.setLastLogin(rs.getString("last_login"));
        user.setLoginCount(rs.getInt("login_count"));
        return user;
    }
    
    private String generatePasswordHash(String password) {
        // Simplified password hashing - in production use proper hashing
        return "hashed_" + password + "_" + System.currentTimeMillis();
    }
    
    /**
     * Close database connection
     */
    public void close() {
        try {
            if (connection != null && !connection.isClosed()) {
                connection.close();
            }
        } catch (SQLException e) {
            System.err.println("Error closing database connection: " + e.getMessage());
        }
    }
    
    /**
     * Test database operations
     */
    public static void main(String[] args) {
        DatabaseManager dbManager = new DatabaseManager();
        
        try {
            // Test user creation
            int userId = dbManager.createUser("test@example.com", "Test User", "admin");
            System.out.println("Created user with ID: " + userId);
            
            // Test user retrieval
            User user = dbManager.getUserById(userId);
            if (user != null) {
                System.out.println("Retrieved user: " + user.getName() + " (" + user.getEmail() + ")");
            }
            
            // Test user update
            boolean updated = dbManager.updateUser(userId, "Updated Name", "user");
            System.out.println("User updated: " + updated);
            
            // Test activity logging
            dbManager.logActivity(userId, "TEST", "Database test completed");
            System.out.println("Activity logged");
            
        } catch (SQLException e) {
            e.printStackTrace();
        } finally {
            dbManager.close();
        }
    }
} 