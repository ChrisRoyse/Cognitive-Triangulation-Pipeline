package com.polyglot.services;

import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.HashMap;

/**
 * API client for cross-service communication
 * Handles HTTP requests to JavaScript and Python services
 */
public class ApiClient {
    private static final String JAVASCRIPT_BASE_URL = "http://localhost:3000";
    private static final String PYTHON_BASE_URL = "http://localhost:5000";
    private static final int CONNECTION_TIMEOUT = 10000; // 10 seconds
    private static final int READ_TIMEOUT = 30000; // 30 seconds
    
    /**
     * Call JavaScript service endpoint
     */
    public JSONObject callJavaScriptService(String endpoint, JSONObject payload) {
        return makeHttpRequest(JAVASCRIPT_BASE_URL + endpoint, "POST", payload);
    }
    
    /**
     * Call Python service endpoint
     */
    public JSONObject callPythonService(String endpoint, JSONObject payload) {
        return makeHttpRequest(PYTHON_BASE_URL + endpoint, "POST", payload);
    }
    
    /**
     * Make HTTP GET request
     */
    public JSONObject makeGetRequest(String fullUrl) {
        return makeHttpRequest(fullUrl, "GET", null);
    }
    
    /**
     * Make HTTP POST request
     */
    public JSONObject makePostRequest(String fullUrl, JSONObject payload) {
        return makeHttpRequest(fullUrl, "POST", payload);
    }
    
    /**
     * Generic HTTP request method
     */
    private JSONObject makeHttpRequest(String urlString, String method, JSONObject payload) {
        JSONObject response = new JSONObject();
        HttpURLConnection connection = null;
        
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            
            // Set request properties
            connection.setRequestMethod(method);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "Java-ApiClient/1.0");
            connection.setConnectTimeout(CONNECTION_TIMEOUT);
            connection.setReadTimeout(READ_TIMEOUT);
            
            // Set up for POST requests
            if ("POST".equals(method) || "PUT".equals(method)) {
                connection.setDoOutput(true);
                
                if (payload != null) {
                    try (OutputStream os = connection.getOutputStream()) {
                        byte[] input = payload.toString().getBytes(StandardCharsets.UTF_8);
                        os.write(input, 0, input.length);
                    }
                }
            }
            
            // Get response
            int responseCode = connection.getResponseCode();
            response.put("status_code", responseCode);
            
            // Read response body
            String responseBody;
            if (responseCode >= 200 && responseCode < 300) {
                responseBody = readInputStream(connection.getInputStream());
            } else {
                responseBody = readInputStream(connection.getErrorStream());
            }
            
            // Try to parse as JSON, fallback to plain text
            try {
                JSONObject jsonResponse = new JSONObject(responseBody);
                response.put("body", jsonResponse);
                response.put("success", true);
            } catch (Exception e) {
                response.put("body", responseBody);
                response.put("success", responseCode >= 200 && responseCode < 300);
            }
            
            // Add request metadata
            response.put("url", urlString);
            response.put("method", method);
            response.put("timestamp", System.currentTimeMillis());
            
        } catch (IOException e) {
            response.put("success", false);
            response.put("error", "Network error: " + e.getMessage());
            response.put("url", urlString);
            response.put("method", method);
            
        } catch (Exception e) {
            response.put("success", false);
            response.put("error", "Request failed: " + e.getMessage());
            response.put("url", urlString);
            response.put("method", method);
            
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
        
        return response;
    }
    
    /**
     * Read input stream to string
     */
    private String readInputStream(InputStream inputStream) throws IOException {
        if (inputStream == null) {
            return "";
        }
        
        StringBuilder response = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line).append('\n');
            }
        }
        
        return response.toString().trim();
    }
    
    /**
     * Test JavaScript service connectivity
     */
    public JSONObject testJavaScriptService() {
        JSONObject testPayload = new JSONObject();
        testPayload.put("test", true);
        testPayload.put("timestamp", System.currentTimeMillis());
        
        try {
            return callJavaScriptService("/api/health", testPayload);
        } catch (Exception e) {
            JSONObject errorResponse = new JSONObject();
            errorResponse.put("success", false);
            errorResponse.put("error", "JavaScript service test failed: " + e.getMessage());
            return errorResponse;
        }
    }
    
    /**
     * Test Python service connectivity
     */
    public JSONObject testPythonService() {
        JSONObject testPayload = new JSONObject();
        testPayload.put("test", true);
        testPayload.put("timestamp", System.currentTimeMillis());
        
        try {
            return callPythonService("/health", testPayload);
        } catch (Exception e) {
            JSONObject errorResponse = new JSONObject();
            errorResponse.put("success", false);
            errorResponse.put("error", "Python service test failed: " + e.getMessage());
            return errorResponse;
        }
    }
    
    /**
     * Submit data processing job to Python service
     */
    public JSONObject submitProcessingJob(int userId, String jobType, JSONObject inputData) {
        JSONObject jobRequest = new JSONObject();
        jobRequest.put("user_id", userId);
        jobRequest.put("job_type", jobType);
        jobRequest.put("input_data", inputData);
        
        return callPythonService("/api/jobs/submit", jobRequest);
    }
    
    /**
     * Get processing job result from Python service
     */
    public JSONObject getJobResult(int jobId) {
        String endpoint = "/api/jobs/" + jobId + "/result";
        return makeGetRequest(PYTHON_BASE_URL + endpoint);
    }
    
    /**
     * Send event notification to JavaScript service
     */
    public JSONObject sendEventNotification(String eventType, JSONObject eventData) {
        JSONObject notification = new JSONObject();
        notification.put("event_type", eventType);
        notification.put("event_data", eventData);
        notification.put("source", "java-service");
        notification.put("timestamp", System.currentTimeMillis());
        
        return callJavaScriptService("/api/events", notification);
    }
    
    /**
     * Get user analytics from JavaScript service
     */
    public JSONObject getUserAnalytics(int userId) {
        String endpoint = "/api/analytics/user/" + userId;
        return makeGetRequest(JAVASCRIPT_BASE_URL + endpoint);
    }
    
    /**
     * Request ML prediction from Python service
     */
    public JSONObject requestMLPrediction(String modelName, JSONObject features) {
        JSONObject predictionRequest = new JSONObject();
        predictionRequest.put("model_name", modelName);
        predictionRequest.put("features", features);
        
        return callPythonService("/api/ml/predict", predictionRequest);
    }
    
    /**
     * Sync user data across services
     */
    public Map<String, JSONObject> syncUserData(int userId, JSONObject userData) {
        Map<String, JSONObject> results = new HashMap<>();
        
        // Sync with JavaScript service
        JSONObject jsPayload = new JSONObject();
        jsPayload.put("user_id", userId);
        jsPayload.put("user_data", userData);
        jsPayload.put("action", "sync");
        
        JSONObject jsResult = callJavaScriptService("/api/users/sync", jsPayload);
        results.put("javascript", jsResult);
        
        // Sync with Python service
        JSONObject pyPayload = new JSONObject();
        pyPayload.put("user_id", userId);
        pyPayload.put("user_data", userData);
        pyPayload.put("sync_type", "user_profile");
        
        JSONObject pyResult = callPythonService("/api/sync/user", pyPayload);
        results.put("python", pyResult);
        
        return results;
    }
    
    /**
     * Get system status from all services
     */
    public Map<String, JSONObject> getSystemStatus() {
        Map<String, JSONObject> status = new HashMap<>();
        
        // JavaScript service status
        try {
            JSONObject jsStatus = makeGetRequest(JAVASCRIPT_BASE_URL + "/api/status");
            status.put("javascript", jsStatus);
        } catch (Exception e) {
            JSONObject error = new JSONObject();
            error.put("success", false);
            error.put("error", e.getMessage());
            status.put("javascript", error);
        }
        
        // Python service status
        try {
            JSONObject pyStatus = makeGetRequest(PYTHON_BASE_URL + "/status");
            status.put("python", pyStatus);
        } catch (Exception e) {
            JSONObject error = new JSONObject();
            error.put("success", false);
            error.put("error", e.getMessage());
            status.put("python", error);
        }
        
        return status;
    }
    
    /**
     * Batch API call to multiple endpoints
     */
    public Map<String, JSONObject> batchApiCalls(Map<String, String> endpoints, JSONObject payload) {
        Map<String, JSONObject> results = new HashMap<>();
        
        for (Map.Entry<String, String> entry : endpoints.entrySet()) {
            String key = entry.getKey();
            String url = entry.getValue();
            
            try {
                JSONObject result = makePostRequest(url, payload);
                results.put(key, result);
            } catch (Exception e) {
                JSONObject error = new JSONObject();
                error.put("success", false);
                error.put("error", e.getMessage());
                results.put(key, error);
            }
        }
        
        return results;
    }
    
    /**
     * Test API client functionality
     */
    public static void main(String[] args) {
        ApiClient client = new ApiClient();
        
        System.out.println("Testing API Client...");
        
        // Test JavaScript service
        System.out.println("\nTesting JavaScript service:");
        JSONObject jsTest = client.testJavaScriptService();
        System.out.println("JS Test Result: " + jsTest.toString(2));
        
        // Test Python service
        System.out.println("\nTesting Python service:");
        JSONObject pyTest = client.testPythonService();
        System.out.println("PY Test Result: " + pyTest.toString(2));
        
        // Test system status
        System.out.println("\nGetting system status:");
        Map<String, JSONObject> systemStatus = client.getSystemStatus();
        for (Map.Entry<String, JSONObject> entry : systemStatus.entrySet()) {
            System.out.println(entry.getKey() + ": " + entry.getValue().toString(2));
        }
    }
} 