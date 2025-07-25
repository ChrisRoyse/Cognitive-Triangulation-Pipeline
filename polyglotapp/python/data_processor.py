"""
Main data processing service for Python layer
Handles data analysis, transformation, and processing tasks
"""

import json
import time
import asyncio
import requests
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
from database_client import db_client
from utils import logger, validator, transformer, APIResponse, MetricsCollector
import threading
from queue import Queue, Empty

class DataProcessor:
    """Main data processing service"""
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.js_api_url = self.config.get('js_api_url', 'http://localhost:3000')
        self.java_api_url = self.config.get('java_api_url', 'http://localhost:8080')
        self.processing_queue = Queue()
        self.results_cache = {}
        self.is_running = False
        
    def start_processing(self):
        """Start the processing service"""
        self.is_running = True
        logger.info("Data processing service started")
        
        # Start worker threads
        for i in range(3):
            worker_thread = threading.Thread(target=self._worker, daemon=True)
            worker_thread.start()
            logger.info(f"Started worker thread {i+1}")
    
    def stop_processing(self):
        """Stop the processing service"""
        self.is_running = False
        logger.info("Data processing service stopped")
    
    def _worker(self):
        """Worker thread for processing jobs"""
        while self.is_running:
            try:
                job = self.processing_queue.get(timeout=1)
                self._process_job(job)
                self.processing_queue.task_done()
            except Empty:
                continue
            except Exception as e:
                logger.error(f"Worker error: {e}")
    
    def _process_job(self, job: Dict[str, Any]):
        """Process a single job"""
        job_id = job.get('id')
        job_type = job.get('job_type')
        
        try:
            logger.info(f"Processing job {job_id} of type {job_type}")
            start_time = datetime.now(timezone.utc)
            
            if job_type == 'data_analysis':
                result = self._analyze_data(job)
            elif job_type == 'data_transformation':
                result = self._transform_data(job)
            elif job_type == 'cross_service_call':
                result = self._make_cross_service_call(job)
            elif job_type == 'ml_prediction':
                result = self._make_ml_prediction(job)
            else:
                result = {'error': f'Unknown job type: {job_type}'}
            
            end_time = datetime.now(timezone.utc)
            processing_time = MetricsCollector.calculate_processing_time(start_time, end_time)
            
            # Store result in cache
            self.results_cache[job_id] = {
                'result': result,
                'processing_time': processing_time,
                'completed_at': end_time.isoformat()
            }
            
            logger.info(f"Completed job {job_id} in {processing_time:.2f} seconds")
            
        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            self.results_cache[job_id] = {
                'error': str(e),
                'failed_at': datetime.now(timezone.utc).isoformat()
            }
    
    def submit_job(self, job_data: Dict[str, Any]) -> int:
        """Submit a job for processing"""
        # Create job in database
        user_id = job_data.get('user_id', 1)
        job_type = job_data.get('job_type', 'data_analysis')
        input_data = job_data.get('input_data', {})
        
        job_id = db_client.create_processing_job(user_id, job_type, input_data)
        
        # Add to processing queue
        job_data['id'] = job_id
        self.processing_queue.put(job_data)
        
        logger.info(f"Submitted job {job_id} for processing")
        return job_id
    
    def get_job_result(self, job_id: int) -> Dict[str, Any]:
        """Get job result from cache or database"""
        if job_id in self.results_cache:
            return APIResponse.success(self.results_cache[job_id])
        
        # Check database for completed jobs
        job = self._get_job_from_database(job_id)
        if job:
            return APIResponse.success(job)
        
        return APIResponse.error("Job not found or still processing")
    
    def _get_job_from_database(self, job_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve job from database"""
        try:
            query = "SELECT * FROM processing_jobs WHERE id = ?"
            results = db_client.execute_query(query, (job_id,))
            return results[0] if results else None
        except Exception as e:
            logger.error(f"Database query failed: {e}")
            return None
    
    def _analyze_data(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Perform data analysis"""
        input_data = job.get('input_data', {})
        data_points = input_data.get('data_points', [])
        
        if not data_points:
            return {'error': 'No data points provided'}
        
        # Calculate basic statistics
        numeric_data = [x for x in data_points if isinstance(x, (int, float))]
        
        if not numeric_data:
            return {'error': 'No numeric data found'}
        
        analysis = {
            'count': len(numeric_data),
            'sum': sum(numeric_data),
            'average': sum(numeric_data) / len(numeric_data),
            'min': min(numeric_data),
            'max': max(numeric_data),
            'range': max(numeric_data) - min(numeric_data)
        }
        
        # Calculate variance and standard deviation
        mean = analysis['average']
        variance = sum((x - mean) ** 2 for x in numeric_data) / len(numeric_data)
        analysis['variance'] = variance
        analysis['std_deviation'] = variance ** 0.5
        
        # Categorize data
        analysis['categories'] = {
            'below_average': len([x for x in numeric_data if x < mean]),
            'above_average': len([x for x in numeric_data if x > mean]),
            'at_average': len([x for x in numeric_data if x == mean])
        }
        
        return {'analysis': analysis}
    
    def _transform_data(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Transform data according to specifications"""
        input_data = job.get('input_data', {})
        transformation_type = input_data.get('type', 'normalize')
        data = input_data.get('data', [])
        
        if transformation_type == 'normalize':
            return self._normalize_data(data)
        elif transformation_type == 'flatten':
            return self._flatten_data(data)
        elif transformation_type == 'aggregate':
            return self._aggregate_data(data)
        else:
            return {'error': f'Unknown transformation type: {transformation_type}'}
    
    def _normalize_data(self, data: List[Any]) -> Dict[str, Any]:
        """Normalize numeric data to 0-1 range"""
        numeric_data = [x for x in data if isinstance(x, (int, float))]
        
        if not numeric_data:
            return {'error': 'No numeric data to normalize'}
        
        min_val = min(numeric_data)
        max_val = max(numeric_data)
        range_val = max_val - min_val
        
        if range_val == 0:
            normalized = [0.5] * len(numeric_data)
        else:
            normalized = [(x - min_val) / range_val for x in numeric_data]
        
        return {
            'original_data': numeric_data,
            'normalized_data': normalized,
            'min_value': min_val,
            'max_value': max_val,
            'range': range_val
        }
    
    def _flatten_data(self, data: Any) -> Dict[str, Any]:
        """Flatten nested data structures"""
        if isinstance(data, dict):
            flattened = transformer.flatten_dict(data)
        elif isinstance(data, list):
            flattened = {}
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    for k, v in item.items():
                        flattened[f"item_{i}_{k}"] = v
                else:
                    flattened[f"item_{i}"] = item
        else:
            flattened = {'value': data}
        
        return {'flattened_data': flattened}
    
    def _aggregate_data(self, data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Aggregate data by grouping and calculating metrics"""
        if not data or not isinstance(data, list):
            return {'error': 'Invalid data for aggregation'}
        
        # Group by common fields
        groups = {}
        for item in data:
            if isinstance(item, dict):
                group_key = item.get('category', 'default')
                if group_key not in groups:
                    groups[group_key] = []
                groups[group_key].append(item)
        
        aggregated = {}
        for group_name, items in groups.items():
            # Calculate aggregations for numeric fields
            numeric_fields = {}
            for item in items:
                for key, value in item.items():
                    if isinstance(value, (int, float)):
                        if key not in numeric_fields:
                            numeric_fields[key] = []
                        numeric_fields[key].append(value)
            
            group_stats = {}
            for field, values in numeric_fields.items():
                if values:
                    group_stats[f"{field}_sum"] = sum(values)
                    group_stats[f"{field}_avg"] = sum(values) / len(values)
                    group_stats[f"{field}_count"] = len(values)
            
            aggregated[group_name] = group_stats
        
        return {'aggregated_data': aggregated}
    
    def _make_cross_service_call(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Make call to JavaScript or Java service"""
        input_data = job.get('input_data', {})
        service = input_data.get('service', 'javascript')
        endpoint = input_data.get('endpoint', '/api/status')
        method = input_data.get('method', 'GET')
        payload = input_data.get('payload', {})
        
        try:
            if service == 'javascript':
                url = f"{self.js_api_url}{endpoint}"
            elif service == 'java':
                url = f"{self.java_api_url}{endpoint}"
            else:
                return {'error': f'Unknown service: {service}'}
            
            logger.info(f"Making {method} request to {url}")
            
            if method.upper() == 'GET':
                response = requests.get(url, timeout=10)
            elif method.upper() == 'POST':
                response = requests.post(url, json=payload, timeout=10)
            else:
                return {'error': f'Unsupported method: {method}'}
            
            return {
                'service': service,
                'endpoint': endpoint,
                'status_code': response.status_code,
                'response': response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
            }
            
        except requests.RequestException as e:
            logger.error(f"Cross-service call failed: {e}")
            return {'error': f'Service call failed: {str(e)}'}
    
    def _make_ml_prediction(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Make ML prediction (simulated)"""
        input_data = job.get('input_data', {})
        features = input_data.get('features', [])
        model_type = input_data.get('model_type', 'linear_regression')
        
        # Simulate ML processing time
        time.sleep(0.5)
        
        if model_type == 'linear_regression':
            # Simple linear prediction simulation
            if len(features) > 0:
                prediction = sum(features) * 0.7 + 0.3
                confidence = min(0.95, max(0.6, 1.0 - abs(prediction - sum(features)) / 10))
            else:
                prediction = 0.5
                confidence = 0.5
        elif model_type == 'classification':
            # Simple classification simulation
            score = sum(features) if features else 0
            prediction = 'positive' if score > 0 else 'negative'
            confidence = min(0.95, max(0.6, abs(score) / 10))
        else:
            return {'error': f'Unknown model type: {model_type}'}
        
        return {
            'model_type': model_type,
            'prediction': prediction,
            'confidence': confidence,
            'features_used': len(features)
        }

# Global processor instance
processor = DataProcessor()

if __name__ == "__main__":
    # Start the processing service
    processor.start_processing()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down data processor...")
        processor.stop_processing() 