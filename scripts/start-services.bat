@echo off
REM Start Services Script for Cognitive Triangulation Pipeline (Windows)
REM This script starts Redis and Neo4j in Docker containers

echo Starting Cognitive Triangulation Pipeline Services...
echo ===============================================================

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)
echo Docker is running

REM Load environment variables from .env file
if not exist .env (
    echo ERROR: .env file not found!
    pause
    exit /b 1
)

REM Cleanup existing containers
echo.
echo Cleaning up existing containers...
docker-compose down -v 2>nul
docker rm -f ctp-redis ctp-neo4j 2>nul

REM Start services
echo.
echo Starting services with docker-compose...
docker-compose up -d redis neo4j

REM Wait a bit for services to start
echo.
echo Waiting for services to start...
timeout /t 10 /nobreak >nul

REM Show service status
echo.
echo Service Status:
docker-compose ps

REM Show connection info
echo.
echo ===============================================================
echo Services are running!
echo.
echo Connection Information:
echo    Redis:    redis://localhost:6379
echo    Neo4j:    bolt://localhost:7687
echo              Browser: http://localhost:7474
echo              User: neo4j
echo              Pass: CTPSecure2024!
echo.
echo Optional Services:
echo    Redis Admin: docker-compose --profile debug up -d redis-commander
echo                 http://localhost:8081
echo    Monitoring:  docker-compose --profile monitoring up -d prometheus
echo                 http://localhost:9090
echo.
echo To stop services: docker-compose down
echo ===============================================================
echo.
pause