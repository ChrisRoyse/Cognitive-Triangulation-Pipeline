"""
Python utility functions for data processing and validation
"""

import json
import hashlib
import re
import os
import logging
from typing import Dict, List, Any, Optional, Union
from datetime import datetime, timezone
import sqlite3

class DataValidator:
    """Validates data formats and types"""
    
    @staticmethod
    def validate_email(email: str) -> bool:
        """Validate email format"""
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return bool(re.match(pattern, email))
    
    @staticmethod
    def validate_json(data: str) -> bool:
        """Validate JSON string"""
        try:
            json.loads(data)
            return True
        except (json.JSONDecodeError, TypeError):
            return False
    
    @staticmethod
    def sanitize_input(text: str) -> str:
        """Sanitize user input"""
        if not isinstance(text, str):
            return str(text)
        
        # Remove potential SQL injection patterns
        dangerous_patterns = [';', '--', '/*', '*/', 'xp_', 'sp_']
        sanitized = text
        for pattern in dangerous_patterns:
            sanitized = sanitized.replace(pattern, '')
        
        return sanitized.strip()

class DataTransformer:
    """Transforms data between different formats"""
    
    @staticmethod
    def dict_to_json(data: Dict[str, Any]) -> str:
        """Convert dictionary to JSON string"""
        return json.dumps(data, default=str, indent=2)
    
    @staticmethod
    def json_to_dict(json_str: str) -> Dict[str, Any]:
        """Convert JSON string to dictionary"""
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            return {}
    
    @staticmethod
    def flatten_dict(d: Dict[str, Any], parent_key: str = '', sep: str = '_') -> Dict[str, Any]:
        """Flatten nested dictionary"""
        items = []
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, dict):
                items.extend(DataTransformer.flatten_dict(v, new_key, sep=sep).items())
            else:
                items.append((new_key, v))
        return dict(items)

class CryptoUtils:
    """Cryptographic utilities"""
    
    @staticmethod
    def hash_password(password: str, salt: str = None) -> str:
        """Hash password with salt"""
        if salt is None:
            salt = os.urandom(32).hex()
        
        pwdhash = hashlib.pbkdf2_hmac('sha256', 
                                     password.encode('utf-8'), 
                                     salt.encode('utf-8'), 
                                     100000)
        return salt + pwdhash.hex()
    
    @staticmethod
    def verify_password(stored_password: str, provided_password: str) -> bool:
        """Verify password against stored hash"""
        salt = stored_password[:64]
        stored_hash = stored_password[64:]
        
        pwdhash = hashlib.pbkdf2_hmac('sha256',
                                     provided_password.encode('utf-8'),
                                     salt.encode('utf-8'),
                                     100000)
        return pwdhash.hex() == stored_hash
    
    @staticmethod
    def generate_api_key() -> str:
        """Generate secure API key"""
        return hashlib.sha256(os.urandom(32)).hexdigest()

class FileManager:
    """File operations and management"""
    
    @staticmethod
    def ensure_directory(path: str) -> bool:
        """Ensure directory exists"""
        try:
            os.makedirs(path, exist_ok=True)
            return True
        except OSError:
            return False
    
    @staticmethod
    def read_config_file(file_path: str) -> Dict[str, Any]:
        """Read configuration from JSON file"""
        try:
            with open(file_path, 'r') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
    
    @staticmethod
    def write_config_file(file_path: str, config: Dict[str, Any]) -> bool:
        """Write configuration to JSON file"""
        try:
            with open(file_path, 'w') as f:
                json.dump(config, f, indent=2)
            return True
        except OSError:
            return False

class Logger:
    """Centralized logging utility"""
    
    def __init__(self, name: str = __name__, level: str = 'INFO'):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper()))
        
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
    
    def info(self, message: str):
        """Log info message"""
        self.logger.info(message)
    
    def warning(self, message: str):
        """Log warning message"""
        self.logger.warning(message)
    
    def error(self, message: str):
        """Log error message"""
        self.logger.error(message)
    
    def debug(self, message: str):
        """Log debug message"""
        self.logger.debug(message)

class APIResponse:
    """Standardized API response utility"""
    
    @staticmethod
    def success(data: Any = None, message: str = "Success") -> Dict[str, Any]:
        """Create success response"""
        return {
            "status": "success",
            "message": message,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    
    @staticmethod
    def error(message: str, error_code: str = None, details: Any = None) -> Dict[str, Any]:
        """Create error response"""
        response = {
            "status": "error",
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        if error_code:
            response["error_code"] = error_code
        if details:
            response["details"] = details
            
        return response

class MetricsCollector:
    """Collect and calculate metrics"""
    
    @staticmethod
    def calculate_processing_time(start_time: datetime, end_time: datetime = None) -> float:
        """Calculate processing time in seconds"""
        if end_time is None:
            end_time = datetime.now(timezone.utc)
        
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        if end_time.tzinfo is None:
            end_time = end_time.replace(tzinfo=timezone.utc)
            
        return (end_time - start_time).total_seconds()
    
    @staticmethod
    def calculate_success_rate(successful: int, total: int) -> float:
        """Calculate success rate percentage"""
        if total == 0:
            return 0.0
        return (successful / total) * 100
    
    @staticmethod
    def calculate_throughput(processed_items: int, time_seconds: float) -> float:
        """Calculate throughput (items per second)"""
        if time_seconds == 0:
            return 0.0
        return processed_items / time_seconds

# Global utilities instances
validator = DataValidator()
transformer = DataTransformer()
crypto_utils = CryptoUtils()
file_manager = FileManager()
logger = Logger('polyglot_python') 