package com.polyglot.services;

import java.sql.*;
import java.util.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import org.json.JSONObject;
import org.json.JSONArray;

/**
 * User management service for Java layer
 * Handles user operations, authentication, and business logic
 */
public class UserService {
    private DatabaseManager dbManager;
    private BusinessLogic businessLogic;
    private ApiClient apiClient;
    
    public UserService() {
        this.dbManager = new DatabaseManager();
        this.businessLogic = new BusinessLogic();
        this.apiClient = new ApiClient();
    }
    
    /**
     * Create a new user in the system
     */
    public JSONObject createUser(String email, String name, String role) {
        JSONObject response = new JSONObject();
        
        try {
            // Validate input
            if (!isValidEmail(email)) {
                return createErrorResponse("Invalid email format");
            }
            
            if (name == null || name.trim().isEmpty()) {
                return createErrorResponse("Name is required");
            }
            
            // Check if user already exists
            if (getUserByEmail(email) != null) {
                return createErrorResponse("User with this email already exists");
            }
            
            // Create user in database
            int userId = dbManager.createUser(email, name, role != null ? role : "user");
            
            if (userId > 0) {
                response.put("status", "success");
                response.put("message", "User created successfully");
                response.put("user_id", userId);
                response.put("timestamp", getCurrentTimestamp());
                
                // Log user creation
                businessLogic.logUserActivity(userId, "USER_CREATED", 
                    String.format("User %s created with email %s", name, email));
                
                // Notify other services
                notifyUserCreated(userId, email, name);
            } else {
                response = createErrorResponse("Failed to create user");
            }
            
        } catch (Exception e) {
            response = createErrorResponse("User creation failed: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    /**
     * Authenticate user credentials
     */
    public JSONObject authenticateUser(String email, String password) {
        JSONObject response = new JSONObject();
        
        try {
            User user = getUserByEmail(email);
            
            if (user == null) {
                return createErrorResponse("User not found");
            }
            
            // Verify password (simplified - in production use proper hashing)
            if (businessLogic.verifyPassword(password, user.getPasswordHash())) {
                // Update last login
                dbManager.updateLastLogin(user.getId());
                
                // Generate session token
                String sessionToken = businessLogic.generateSessionToken(user.getId());
                
                response.put("status", "success");
                response.put("message", "Authentication successful");
                response.put("user_id", user.getId());
                response.put("session_token", sessionToken);
                response.put("user_role", user.getRole());
                response.put("timestamp", getCurrentTimestamp());
                
                // Log authentication
                businessLogic.logUserActivity(user.getId(), "USER_LOGIN", 
                    "User authenticated successfully");
                
            } else {
                response = createErrorResponse("Invalid credentials");
                
                // Log failed attempt
                businessLogic.logUserActivity(user.getId(), "LOGIN_FAILED", 
                    "Invalid password attempt");
            }
            
        } catch (Exception e) {
            response = createErrorResponse("Authentication failed: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    /**
     * Get user information by ID
     */
    public JSONObject getUserInfo(int userId) {
        JSONObject response = new JSONObject();
        
        try {
            User user = dbManager.getUserById(userId);
            
            if (user != null) {
                JSONObject userData = new JSONObject();
                userData.put("id", user.getId());
                userData.put("email", user.getEmail());
                userData.put("name", user.getName());
                userData.put("role", user.getRole());
                userData.put("created_at", user.getCreatedAt());
                userData.put("last_login", user.getLastLogin());
                userData.put("is_active", user.isActive());
                
                response.put("status", "success");
                response.put("data", userData);
                response.put("timestamp", getCurrentTimestamp());
            } else {
                response = createErrorResponse("User not found");
            }
            
        } catch (Exception e) {
            response = createErrorResponse("Failed to get user info: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    /**
     * Update user information
     */
    public JSONObject updateUser(int userId, String name, String role) {
        JSONObject response = new JSONObject();
        
        try {
            User existingUser = dbManager.getUserById(userId);
            
            if (existingUser == null) {
                return createErrorResponse("User not found");
            }
            
            // Update user in database
            boolean updated = dbManager.updateUser(userId, name, role);
            
            if (updated) {
                response.put("status", "success");
                response.put("message", "User updated successfully");
                response.put("timestamp", getCurrentTimestamp());
                
                // Log update
                businessLogic.logUserActivity(userId, "USER_UPDATED", 
                    String.format("User profile updated: name=%s, role=%s", name, role));
                
                // Notify other services
                notifyUserUpdated(userId, name, role);
            } else {
                response = createErrorResponse("Failed to update user");
            }
            
        } catch (Exception e) {
            response = createErrorResponse("User update failed: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    /**
     * List all users with pagination
     */
    public JSONObject listUsers(int page, int pageSize, String role) {
        JSONObject response = new JSONObject();
        
        try {
            List<User> users = dbManager.getUsers(page, pageSize, role);
            int totalUsers = dbManager.getUserCount(role);
            
            JSONArray userArray = new JSONArray();
            for (User user : users) {
                JSONObject userData = new JSONObject();
                userData.put("id", user.getId());
                userData.put("email", user.getEmail());
                userData.put("name", user.getName());
                userData.put("role", user.getRole());
                userData.put("created_at", user.getCreatedAt());
                userData.put("is_active", user.isActive());
                userArray.put(userData);
            }
            
            JSONObject pagination = new JSONObject();
            pagination.put("page", page);
            pagination.put("page_size", pageSize);
            pagination.put("total_users", totalUsers);
            pagination.put("total_pages", (int) Math.ceil((double) totalUsers / pageSize));
            
            response.put("status", "success");
            response.put("data", userArray);
            response.put("pagination", pagination);
            response.put("timestamp", getCurrentTimestamp());
            
        } catch (Exception e) {
            response = createErrorResponse("Failed to list users: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    /**
     * Deactivate user account
     */
    public JSONObject deactivateUser(int userId) {
        JSONObject response = new JSONObject();
        
        try {
            boolean deactivated = dbManager.deactivateUser(userId);
            
            if (deactivated) {
                response.put("status", "success");
                response.put("message", "User deactivated successfully");
                response.put("timestamp", getCurrentTimestamp());
                
                // Log deactivation
                businessLogic.logUserActivity(userId, "USER_DEACTIVATED", 
                    "User account deactivated");
                
                // Notify other services
                notifyUserDeactivated(userId);
            } else {
                response = createErrorResponse("Failed to deactivate user");
            }
            
        } catch (Exception e) {
            response = createErrorResponse("User deactivation failed: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    /**
     * Process user data with Python service
     */
    public JSONObject processUserData(int userId, String processType) {
        JSONObject response = new JSONObject();
        
        try {
            User user = dbManager.getUserById(userId);
            
            if (user == null) {
                return createErrorResponse("User not found");
            }
            
            // Prepare data for Python service
            JSONObject userData = new JSONObject();
            userData.put("user_id", userId);
            userData.put("email", user.getEmail());
            userData.put("name", user.getName());
            userData.put("role", user.getRole());
            userData.put("created_at", user.getCreatedAt());
            
            // Call Python data processing service
            JSONObject processingRequest = new JSONObject();
            processingRequest.put("user_id", userId);
            processingRequest.put("job_type", "data_analysis");
            processingRequest.put("input_data", userData);
            
            JSONObject pythonResponse = apiClient.callPythonService("/process", processingRequest);
            
            if (pythonResponse.getString("status").equals("success")) {
                response.put("status", "success");
                response.put("message", "User data processing initiated");
                response.put("processing_result", pythonResponse);
                response.put("timestamp", getCurrentTimestamp());
                
                // Log processing
                businessLogic.logUserActivity(userId, "DATA_PROCESSING", 
                    String.format("User data processing initiated: %s", processType));
            } else {
                response = createErrorResponse("Python service call failed");
            }
            
        } catch (Exception e) {
            response = createErrorResponse("Data processing failed: " + e.getMessage());
            e.printStackTrace();
        }
        
        return response;
    }
    
    // Helper methods
    
    private User getUserByEmail(String email) {
        return dbManager.getUserByEmail(email);
    }
    
    private boolean isValidEmail(String email) {
        return email != null && email.matches("^[A-Za-z0-9+_.-]+@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})$");
    }
    
    private JSONObject createErrorResponse(String message) {
        JSONObject response = new JSONObject();
        response.put("status", "error");
        response.put("message", message);
        response.put("timestamp", getCurrentTimestamp());
        return response;
    }
    
    private String getCurrentTimestamp() {
        return LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    }
    
    private void notifyUserCreated(int userId, String email, String name) {
        try {
            // Notify JavaScript service
            JSONObject notification = new JSONObject();
            notification.put("event", "user_created");
            notification.put("user_id", userId);
            notification.put("email", email);
            notification.put("name", name);
            
            apiClient.callJavaScriptService("/api/events/user-created", notification);
        } catch (Exception e) {
            System.err.println("Failed to notify user creation: " + e.getMessage());
        }
    }
    
    private void notifyUserUpdated(int userId, String name, String role) {
        try {
            JSONObject notification = new JSONObject();
            notification.put("event", "user_updated");
            notification.put("user_id", userId);
            notification.put("name", name);
            notification.put("role", role);
            
            apiClient.callJavaScriptService("/api/events/user-updated", notification);
        } catch (Exception e) {
            System.err.println("Failed to notify user update: " + e.getMessage());
        }
    }
    
    private void notifyUserDeactivated(int userId) {
        try {
            JSONObject notification = new JSONObject();
            notification.put("event", "user_deactivated");
            notification.put("user_id", userId);
            
            apiClient.callJavaScriptService("/api/events/user-deactivated", notification);
        } catch (Exception e) {
            System.err.println("Failed to notify user deactivation: " + e.getMessage());
        }
    }
    
    /**
     * Main method for testing
     */
    public static void main(String[] args) {
        UserService userService = new UserService();
        
        // Test user creation
        JSONObject createResult = userService.createUser("test@example.com", "Test User", "user");
        System.out.println("Create User Result: " + createResult.toString(2));
        
        // Test user authentication
        JSONObject authResult = userService.authenticateUser("test@example.com", "password123");
        System.out.println("Auth Result: " + authResult.toString(2));
        
        // Test user listing
        JSONObject listResult = userService.listUsers(1, 10, null);
        System.out.println("List Users Result: " + listResult.toString(2));
    }
} 