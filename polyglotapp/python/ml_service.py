"""
Machine Learning service for Python layer
Handles ML model management, training, and prediction operations
"""

import json
import pickle
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timezone
import os
from database_client import db_client
from utils import logger, validator, file_manager, APIResponse

class MLModel:
    """Base ML model class"""
    
    def __init__(self, name: str, model_type: str, version: str = "1.0"):
        self.name = name
        self.model_type = model_type
        self.version = version
        self.parameters = {}
        self.is_trained = False
        self.accuracy = None
        self.created_at = datetime.now(timezone.utc)
    
    def train(self, X: List[List[float]], y: List[float]) -> Dict[str, Any]:
        """Train the model - to be implemented by subclasses"""
        raise NotImplementedError("Subclasses must implement train method")
    
    def predict(self, X: List[List[float]]) -> List[float]:
        """Make predictions - to be implemented by subclasses"""
        raise NotImplementedError("Subclasses must implement predict method")
    
    def save(self, file_path: str) -> bool:
        """Save model to file"""
        try:
            model_data = {
                'name': self.name,
                'model_type': self.model_type,
                'version': self.version,
                'parameters': self.parameters,
                'is_trained': self.is_trained,
                'accuracy': self.accuracy,
                'created_at': self.created_at.isoformat()
            }
            
            with open(file_path, 'wb') as f:
                pickle.dump(model_data, f)
            
            logger.info(f"Model {self.name} saved to {file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return False
    
    def load(self, file_path: str) -> bool:
        """Load model from file"""
        try:
            with open(file_path, 'rb') as f:
                model_data = pickle.load(f)
            
            self.name = model_data['name']
            self.model_type = model_data['model_type']
            self.version = model_data['version']
            self.parameters = model_data['parameters']
            self.is_trained = model_data['is_trained']
            self.accuracy = model_data['accuracy']
            
            logger.info(f"Model {self.name} loaded from {file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False

class LinearRegressionModel(MLModel):
    """Simple linear regression model"""
    
    def __init__(self, name: str = "linear_regression", version: str = "1.0"):
        super().__init__(name, "linear_regression", version)
        self.weights = None
        self.bias = 0.0
    
    def train(self, X: List[List[float]], y: List[float]) -> Dict[str, Any]:
        """Train linear regression model using simple calculations"""
        if not X or not y or len(X) != len(y):
            return {'error': 'Invalid training data'}
        
        # Simple linear regression for single feature
        if len(X[0]) == 1:
            x_vals = [row[0] for row in X]
            
            # Calculate slope and intercept
            n = len(x_vals)
            sum_x = sum(x_vals)
            sum_y = sum(y)
            sum_xy = sum(x_vals[i] * y[i] for i in range(n))
            sum_x2 = sum(x * x for x in x_vals)
            
            # Slope (weight)
            slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
            # Intercept (bias)
            intercept = (sum_y - slope * sum_x) / n
            
            self.weights = [slope]
            self.bias = intercept
            self.is_trained = True
            
            # Calculate R-squared
            y_pred = [slope * x + intercept for x in x_vals]
            y_mean = sum_y / n
            ss_res = sum((y[i] - y_pred[i]) ** 2 for i in range(n))
            ss_tot = sum((y_val - y_mean) ** 2 for y_val in y)
            self.accuracy = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0
            
            self.parameters = {
                'weights': self.weights,
                'bias': self.bias,
                'n_samples': n
            }
            
            return {
                'status': 'success',
                'accuracy': self.accuracy,
                'parameters': self.parameters
            }
        else:
            return {'error': 'Multi-feature regression not implemented'}
    
    def predict(self, X: List[List[float]]) -> List[float]:
        """Make predictions using trained model"""
        if not self.is_trained or self.weights is None:
            raise ValueError("Model must be trained before making predictions")
        
        predictions = []
        for row in X:
            if len(row) == 1:
                pred = self.weights[0] * row[0] + self.bias
                predictions.append(pred)
            else:
                predictions.append(0.0)  # Default for unsupported features
        
        return predictions

class ClassificationModel(MLModel):
    """Simple binary classification model"""
    
    def __init__(self, name: str = "binary_classifier", version: str = "1.0"):
        super().__init__(name, "binary_classification", version)
        self.weights = None
        self.bias = 0.0
        self.threshold = 0.5
    
    def sigmoid(self, z: np.ndarray) -> np.ndarray:
        """Sigmoid activation function"""
        # Clip z to prevent overflow
        z = np.clip(z, -500, 500)
        return 1 / (1 + np.exp(-z))
    
    def train(self, X: List[List[float]], y: List[float]) -> Dict[str, Any]:
        """Train classification model using logistic regression"""
        if not X or not y or len(X) != len(y):
            return {'error': 'Invalid training data'}
        
        # Convert to numpy arrays
        X_array = np.array(X)
        y_array = np.array(y)
        
        # Add bias column
        X_with_bias = np.column_stack([np.ones(len(X)), X_array])
        
        # Initialize weights
        n_features = X_with_bias.shape[1]
        weights = np.random.normal(0, 0.01, n_features)
        
        # Training parameters
        learning_rate = 0.01
        epochs = 1000
        
        # Training loop
        for epoch in range(epochs):
            # Forward pass
            z = X_with_bias.dot(weights)
            predictions = self.sigmoid(z)
            
            # Calculate loss (binary cross-entropy)
            epsilon = 1e-15  # Small value to prevent log(0)
            predictions = np.clip(predictions, epsilon, 1 - epsilon)
            loss = -np.mean(y_array * np.log(predictions) + (1 - y_array) * np.log(1 - predictions))
            
            # Backward pass
            gradients = (1 / len(X)) * X_with_bias.T.dot(predictions - y_array)
            
            # Update weights
            weights -= learning_rate * gradients
            
            if epoch % 100 == 0:
                logger.debug(f"Epoch {epoch}, Loss: {loss:.4f}")
        
        # Store model parameters
        self.bias = weights[0]
        self.weights = weights[1:].tolist()
        self.is_trained = True
        
        # Calculate accuracy
        final_predictions = self.sigmoid(X_with_bias.dot(weights))
        binary_predictions = (final_predictions > self.threshold).astype(int)
        self.accuracy = np.mean(binary_predictions == y_array)
        
        self.parameters = {
            'weights': self.weights,
            'bias': self.bias,
            'threshold': self.threshold,
            'learning_rate': learning_rate,
            'epochs': epochs,
            'final_loss': float(loss)
        }
        
        logger.info(f"Classification model trained with accuracy: {self.accuracy:.4f}")
        
        return {
            'status': 'success',
            'accuracy': self.accuracy,
            'parameters': self.parameters
        }
    
    def predict(self, X: List[List[float]]) -> List[float]:
        """Make predictions using trained model"""
        if not self.is_trained or self.weights is None:
            raise ValueError("Model must be trained before making predictions")
        
        X_array = np.array(X)
        X_with_bias = np.column_stack([np.ones(len(X)), X_array])
        z = X_with_bias.dot(np.concatenate([[self.bias], self.weights]))
        probabilities = self.sigmoid(z)
        return probabilities.tolist()
    
    def predict_binary(self, X: List[List[float]]) -> List[int]:
        """Make binary predictions"""
        probabilities = self.predict(X)
        return [1 if p > self.threshold else 0 for p in probabilities]

class MLService:
    """Machine Learning service manager"""
    
    def __init__(self):
        self.models = {}
        self.model_directory = "models"
        file_manager.ensure_directory(self.model_directory)
    
    def create_model(self, model_type: str, name: str, version: str = "1.0") -> Dict[str, Any]:
        """Create a new ML model"""
        if name in self.models:
            return APIResponse.error(f"Model {name} already exists")
        
        try:
            if model_type == 'linear_regression':
                model = LinearRegressionModel(name, version)
            elif model_type == 'binary_classification':
                model = ClassificationModel(name, version)
            else:
                return APIResponse.error(f"Unsupported model type: {model_type}")
            
            self.models[name] = model
            
            # Save to database
            db_client.create_ml_model(name, model_type, version, model.parameters)
            
            logger.info(f"Created model: {name} ({model_type})")
            return APIResponse.success({"model_name": name, "model_type": model_type})
            
        except Exception as e:
            logger.error(f"Failed to create model: {e}")
            return APIResponse.error(f"Model creation failed: {str(e)}")
    
    def train_model(self, model_name: str, training_data: Dict[str, Any]) -> Dict[str, Any]:
        """Train a model with provided data"""
        if model_name not in self.models:
            return APIResponse.error(f"Model {model_name} not found")
        
        try:
            model = self.models[model_name]
            X = training_data.get('features', [])
            y = training_data.get('labels', [])
            
            if not X or not y:
                return APIResponse.error("Training data must include 'features' and 'labels'")
            
            # Train the model
            result = model.train(X, y)
            
            if 'error' in result:
                return APIResponse.error(result['error'])
            
            logger.info(f"Model {model_name} trained successfully")
            return APIResponse.success(result)
            
        except Exception as e:
            logger.error(f"Training failed for model {model_name}: {e}")
            return APIResponse.error(f"Training failed: {str(e)}")
    
    def predict(self, model_name: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Make predictions using trained model"""
        if model_name not in self.models:
            return APIResponse.error(f"Model {model_name} not found")
        
        try:
            model = self.models[model_name]
            
            if not model.is_trained:
                return APIResponse.error(f"Model {model_name} is not trained")
            
            features = input_data.get('features', [])
            if not features:
                return APIResponse.error("Input data must include 'features'")
            
            # Make predictions
            predictions = model.predict(features)
            
            result = {
                'model_name': model_name,
                'model_type': model.model_type,
                'predictions': predictions,
                'num_samples': len(features)
            }
            
            # Add binary predictions for classification models
            if isinstance(model, ClassificationModel):
                result['binary_predictions'] = model.predict_binary(features)
            
            logger.info(f"Made {len(predictions)} predictions with model {model_name}")
            return APIResponse.success(result)
            
        except Exception as e:
            logger.error(f"Prediction failed for model {model_name}: {e}")
            return APIResponse.error(f"Prediction failed: {str(e)}")
    
    def list_models(self) -> Dict[str, Any]:
        """List all available models"""
        model_list = []
        
        for name, model in self.models.items():
            model_list.append({
                'name': name,
                'model_type': model.model_type,
                'version': model.version,
                'is_trained': model.is_trained,
                'accuracy': model.accuracy
            })
        
        return APIResponse.success({'models': model_list})

# Global ML service instance
ml_service = MLService()

if __name__ == "__main__":
    # Example usage
    logger.info("ML Service started")
    
    # Create sample model
    ml_service.create_model("linear_regression", "test_model")
    
    # Sample training data
    training_data = {
        'features': [[1], [2], [3], [4], [5]],
        'labels': [2.1, 3.9, 6.1, 8.0, 10.2]
    }
    
    # Train model
    result = ml_service.train_model("test_model", training_data)
    print("Training result:", result)
    
    # Make prediction
    pred_data = {'features': [[6], [7]]}
    pred_result = ml_service.predict("test_model", pred_data)
    print("Prediction result:", pred_result) 