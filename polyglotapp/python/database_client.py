"""
Database client for Python services
"""

import sqlite3
import json
import logging
from typing import Dict, Any, Optional, List
from contextlib import contextmanager

class DatabaseClient:
    def __init__(self, db_path: str = "polyglot_test.db"):
        self.db_path = db_path
        self.logger = logging.getLogger(__name__)
        self._initialize_database()
    
    def _initialize_database(self):
        """Initialize database with required tables"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    role TEXT DEFAULT 'user',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS processing_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    job_type TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    input_data TEXT,
                    output_data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            """)
            
            conn.commit()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            yield conn
        except sqlite3.Error as e:
            if conn:
                conn.rollback()
            self.logger.error(f"Database error: {e}")
            raise
        finally:
            if conn:
                conn.close()
    
    def execute_query(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        """Execute SELECT query"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    
    def create_user(self, email: str, name: str, role: str = 'user') -> int:
        """Create new user"""
        query = "INSERT INTO users (email, name, role) VALUES (?, ?, ?)"
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (email, name, role))
            conn.commit()
            return cursor.lastrowid
    
    def create_processing_job(self, user_id: int, job_type: str, input_data: dict) -> int:
        """Create processing job"""
        query = "INSERT INTO processing_jobs (user_id, job_type, input_data) VALUES (?, ?, ?)"
        input_json = json.dumps(input_data)
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (user_id, job_type, input_json))
            conn.commit()
            return cursor.lastrowid

# Global instance
db_client = DatabaseClient()
