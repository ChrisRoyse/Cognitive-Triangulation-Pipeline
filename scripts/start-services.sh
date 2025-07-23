#!/bin/bash

# Start Services Script for Cognitive Triangulation Pipeline
# This script starts Redis and Neo4j in Docker containers

set -e

echo "🚀 Starting Cognitive Triangulation Pipeline Services..."

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo "❌ Docker is not running. Please start Docker Desktop first."
        exit 1
    fi
    echo "✅ Docker is running"
}

# Function to stop existing containers
cleanup_existing() {
    echo "🧹 Cleaning up existing containers..."
    docker-compose down -v 2>/dev/null || true
    docker rm -f ctp-redis ctp-neo4j 2>/dev/null || true
}

# Function to wait for service
wait_for_service() {
    local service=$1
    local port=$2
    local max_attempts=30
    local attempt=0
    
    echo "⏳ Waiting for $service to be ready..."
    
    while [ $attempt -lt $max_attempts ]; do
        if nc -z localhost $port 2>/dev/null; then
            echo "✅ $service is ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
    done
    
    echo "❌ $service failed to start in time"
    return 1
}

# Main execution
echo "═══════════════════════════════════════════════════════════════"
echo "    Cognitive Triangulation Pipeline - Service Startup"
echo "═══════════════════════════════════════════════════════════════"

# Check Docker
check_docker

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo "✅ Environment variables loaded"
else
    echo "❌ .env file not found!"
    exit 1
fi

# Cleanup existing containers
cleanup_existing

# Start services
echo ""
echo "🔄 Starting services with docker-compose..."
docker-compose up -d redis neo4j

# Wait for services to be ready
echo ""
wait_for_service "Redis" ${REDIS_PORT:-6379}
wait_for_service "Neo4j" ${NEO4J_BOLT_PORT:-7687}

# Show service status
echo ""
echo "📊 Service Status:"
docker-compose ps

# Show connection info
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Services are running!"
echo ""
echo "📌 Connection Information:"
echo "   Redis:    redis://localhost:${REDIS_PORT:-6379}"
echo "   Neo4j:    bolt://localhost:${NEO4J_BOLT_PORT:-7687}"
echo "             Browser: http://localhost:${NEO4J_HTTP_PORT:-7474}"
echo "             User: ${NEO4J_USER:-neo4j}"
echo "             Pass: ${NEO4J_PASSWORD}"
echo ""
echo "📌 Optional Services:"
echo "   Redis Admin: docker-compose --profile debug up -d redis-commander"
echo "                http://localhost:${REDIS_ADMIN_PORT:-8081}"
echo "   Monitoring:  docker-compose --profile monitoring up -d prometheus"
echo "                http://localhost:${PROMETHEUS_PORT:-9090}"
echo ""
echo "🛑 To stop services: docker-compose down"
echo "═══════════════════════════════════════════════════════════════"