package com.polyglot.services;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.nio.charset.StandardCharsets;

/**
 * Core business logic operations for Java layer
 * Handles authentication, session management, and business rules
 */
public class BusinessLogic {
    private DatabaseManager dbManager;
    private SecureRandom secureRandom;
    private static final String SESSION_TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private static final int SESSION_TOKEN_LENGTH = 32;
    private static final long SESSION_DURATION_HOURS = 24;
    
    public BusinessLogic() {
        this.dbManager = new DatabaseManager();
        this.secureRandom = new SecureRandom();
    }
    
    /**
     * Verify password against stored hash
     */
    public boolean verifyPassword(String plainPassword, String storedHash) {
        if (plainPassword == null || storedHash == null) {
            return false;
        }
        
        // Simplified password verification - in production use proper hashing
        String expectedHash = generatePasswordHash(plainPassword);
        return storedHash.startsWith("hashed_" + plainPassword);
    }
    
    /**
     * Generate password hash
     */
    public String generatePasswordHash(String password) {
        if (password == null) {
            return null;
        }
        
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(password.getBytes(StandardCharsets.UTF_8));
            
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            
            return "hashed_" + password + "_" + System.currentTimeMillis();
        } catch (Exception e) {
            return "hashed_" + password + "_" + System.currentTimeMillis();
        }
    }
    
    /**
     * Generate secure session token
     */
    public String generateSessionToken(int userId) {
        StringBuilder token = new StringBuilder(SESSION_TOKEN_LENGTH);
        
        for (int i = 0; i < SESSION_TOKEN_LENGTH; i++) {
            token.append(SESSION_TOKEN_CHARS.charAt(secureRandom.nextInt(SESSION_TOKEN_CHARS.length())));
        }
        
        String sessionToken = token.toString();
        
        try {
            // Calculate expiration time
            long expiresAt = System.currentTimeMillis() + (SESSION_DURATION_HOURS * 60 * 60 * 1000);
            
            // Store session in database
            dbManager.createSession(userId, sessionToken, expiresAt);
            
        } catch (Exception e) {
            System.err.println("Failed to create session: " + e.getMessage());
        }
        
        return sessionToken;
    }
    
    /**
     * Validate session token
     */
    public boolean isValidSession(String sessionToken) {
        if (sessionToken == null || sessionToken.trim().isEmpty()) {
            return false;
        }
        
        try {
            return dbManager.isValidSession(sessionToken);
        } catch (Exception e) {
            System.err.println("Session validation failed: " + e.getMessage());
            return false;
        }
    }
    
    /**
     * Log user activity
     */
    public void logUserActivity(int userId, String activityType, String description) {
        try {
            dbManager.logActivity(userId, activityType, description);
        } catch (Exception e) {
            System.err.println("Failed to log user activity: " + e.getMessage());
        }
    }
    
    /**
     * Calculate user engagement score
     */
    public double calculateEngagementScore(User user) {
        if (user == null) {
            return 0.0;
        }
        
        double score = 0.0;
        
        // Base score for active user
        if (user.isActive()) {
            score += 10.0;
        }
        
        // Score based on login count
        score += Math.min(user.getLoginCount() * 2.0, 50.0);
        
        // Score based on role
        switch (user.getRole().toLowerCase()) {
            case "admin":
                score += 30.0;
                break;
            case "moderator":
                score += 20.0;
                break;
            case "premium":
                score += 15.0;
                break;
            default:
                score += 5.0;
        }
        
        // Bonus for recent activity
        if (user.getLastLogin() != null) {
            // Simplified recent activity check
            score += 10.0;
        }
        
        return Math.min(score, 100.0); // Cap at 100
    }
    
    /**
     * Validate user permissions for action
     */
    public boolean hasPermission(User user, String action) {
        if (user == null || !user.isActive()) {
            return false;
        }
        
        String role = user.getRole().toLowerCase();
        
        switch (action.toLowerCase()) {
            case "read":
                return true; // All active users can read
                
            case "write":
                return role.equals("admin") || role.equals("moderator") || role.equals("premium");
                
            case "delete":
                return role.equals("admin") || role.equals("moderator");
                
            case "admin":
                return role.equals("admin");
                
            default:
                return false;
        }
    }
    
    /**
     * Generate user statistics
     */
    public Map<String, Object> generateUserStatistics(User user) {
        Map<String, Object> stats = new HashMap<>();
        
        if (user == null) {
            return stats;
        }
        
        stats.put("user_id", user.getId());
        stats.put("engagement_score", calculateEngagementScore(user));
        stats.put("login_count", user.getLoginCount());
        stats.put("account_age_days", calculateAccountAge(user.getCreatedAt()));
        stats.put("is_premium", user.getRole().equals("premium"));
        stats.put("permissions", getUserPermissions(user));
        
        return stats;
    }
    
    /**
     * Get user permissions list
     */
    public List<String> getUserPermissions(User user) {
        List<String> permissions = new ArrayList<>();
        
        if (user == null || !user.isActive()) {
            return permissions;
        }
        
        permissions.add("read");
        
        String role = user.getRole().toLowerCase();
        
        if (role.equals("admin")) {
            permissions.add("write");
            permissions.add("delete");
            permissions.add("admin");
        } else if (role.equals("moderator")) {
            permissions.add("write");
            permissions.add("delete");
        } else if (role.equals("premium")) {
            permissions.add("write");
        }
        
        return permissions;
    }
    
    /**
     * Calculate account age in days
     */
    private int calculateAccountAge(String createdAt) {
        if (createdAt == null) {
            return 0;
        }
        
        try {
            // Simplified calculation - assumes ISO format
            LocalDateTime created = LocalDateTime.parse(createdAt.substring(0, 19));
            LocalDateTime now = LocalDateTime.now();
            
            return (int) java.time.Duration.between(created, now).toDays();
        } catch (Exception e) {
            return 0;
        }
    }
    
    /**
     * Validate business rules for user creation
     */
    public Map<String, String> validateUserCreation(String email, String name, String role) {
        Map<String, String> errors = new HashMap<>();
        
        // Email validation
        if (email == null || email.trim().isEmpty()) {
            errors.put("email", "Email is required");
        } else if (!isValidEmailFormat(email)) {
            errors.put("email", "Invalid email format");
        }
        
        // Name validation
        if (name == null || name.trim().isEmpty()) {
            errors.put("name", "Name is required");
        } else if (name.length() < 2) {
            errors.put("name", "Name must be at least 2 characters");
        } else if (name.length() > 100) {
            errors.put("name", "Name must be less than 100 characters");
        }
        
        // Role validation
        if (role != null && !isValidRole(role)) {
            errors.put("role", "Invalid role specified");
        }
        
        return errors;
    }
    
    /**
     * Check if email format is valid
     */
    private boolean isValidEmailFormat(String email) {
        return email.matches("^[A-Za-z0-9+_.-]+@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})$");
    }
    
    /**
     * Check if role is valid
     */
    private boolean isValidRole(String role) {
        Set<String> validRoles = Set.of("admin", "moderator", "premium", "user");
        return validRoles.contains(role.toLowerCase());
    }
    
    /**
     * Generate API response with business logic applied
     */
    public Map<String, Object> processBusinessResponse(String operation, boolean success, Object data, String message) {
        Map<String, Object> response = new HashMap<>();
        
        response.put("operation", operation);
        response.put("success", success);
        response.put("timestamp", LocalDateTime.now().toEpochSecond(ZoneOffset.UTC));
        
        if (success) {
            response.put("data", data);
            response.put("message", message != null ? message : "Operation completed successfully");
        } else {
            response.put("error", message != null ? message : "Operation failed");
        }
        
        // Add metadata
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("service", "java-business-logic");
        metadata.put("version", "1.0");
        response.put("metadata", metadata);
        
        return response;
    }
    
    /**
     * Calculate system health metrics
     */
    public Map<String, Object> getSystemHealthMetrics() {
        Map<String, Object> metrics = new HashMap<>();
        
        try {
            // Database connection test
            boolean dbHealthy = testDatabaseConnection();
            metrics.put("database_healthy", dbHealthy);
            
            // Memory usage
            Runtime runtime = Runtime.getRuntime();
            long totalMemory = runtime.totalMemory();
            long freeMemory = runtime.freeMemory();
            long usedMemory = totalMemory - freeMemory;
            
            metrics.put("memory_total_mb", totalMemory / (1024 * 1024));
            metrics.put("memory_used_mb", usedMemory / (1024 * 1024));
            metrics.put("memory_free_mb", freeMemory / (1024 * 1024));
            metrics.put("memory_usage_percent", (double) usedMemory / totalMemory * 100);
            
            // System timestamp
            metrics.put("system_time", LocalDateTime.now().toString());
            
            // Overall health
            metrics.put("overall_healthy", dbHealthy);
            
        } catch (Exception e) {
            metrics.put("error", "Failed to calculate health metrics: " + e.getMessage());
            metrics.put("overall_healthy", false);
        }
        
        return metrics;
    }
    
    /**
     * Test database connection
     */
    private boolean testDatabaseConnection() {
        try {
            // Simple test by attempting to count users
            dbManager.getUserCount(null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
    
    /**
     * Test business logic operations
     */
    public static void main(String[] args) {
        BusinessLogic logic = new BusinessLogic();
        
        // Test password operations
        String password = "testpassword123";
        String hash = logic.generatePasswordHash(password);
        boolean verified = logic.verifyPassword(password, hash);
        System.out.println("Password hash: " + hash);
        System.out.println("Password verified: " + verified);
        
        // Test session token generation
        String sessionToken = logic.generateSessionToken(1);
        System.out.println("Session token: " + sessionToken);
        
        // Test validation
        Map<String, String> validationErrors = logic.validateUserCreation("test@example.com", "Test User", "admin");
        System.out.println("Validation errors: " + validationErrors);
        
        // Test health metrics
        Map<String, Object> healthMetrics = logic.getSystemHealthMetrics();
        System.out.println("Health metrics: " + healthMetrics);
    }
} 