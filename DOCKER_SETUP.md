# Docker Setup Guide for Cognitive Triangulation Pipeline

## Overview
This guide helps you set up and run the required services for the Cognitive Triangulation Pipeline using Docker. Neo4j is now run locally via Neo4j Desktop, while Redis and the application run in Docker.

## Prerequisites
- Docker Desktop installed and running
- Node.js 18+ installed
- Git
- Neo4j Desktop installed and running with a local database

## Quick Start

### 1. Environment Configuration
The `.env` file has been configured with:
```env
# Neo4j Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=CTPSecure2024!
NEO4J_DATABASE=ctp

# Redis Configuration
REDIS_URL=redis://localhost:6379

# DeepSeek API Key (already configured)
DEEPSEEK_API_KEY=sk-a67cb9f8a3d741d086bcfd0760de7ad6
```

### 2. Start Services

#### Start Neo4j Desktop:
1. Open Neo4j Desktop
2. Create or start your local database with:
   - Database name: `ctp`
   - Username: `neo4j`
   - Password: `CTPSecure2024!` (or your chosen password)
3. Ensure it's running on `bolt://localhost:7687`

#### Start Docker Services:
##### Windows:
```bash
cd C:\code\ctp
docker-compose up -d
```

##### Linux/Mac:
```bash
cd /path/to/ctp
docker-compose up -d
```

### 3. Verify Services
Services should be running on:
- **Redis** (Docker): `redis://localhost:6379`
- **Neo4j Desktop** (Local):
  - Neo4j Browser: `http://localhost:7474`
  - Neo4j Bolt: `bolt://localhost:7687`
  - Username: `neo4j`
  - Password: `CTPSecure2024!`
- **CTP Application** (Docker): `http://localhost:3002`

### 4. Test Connections
```bash
# Test Redis
docker exec ctp-redis redis-cli ping
# Should return: PONG

# Test Neo4j
docker exec ctp-neo4j cypher-shell -u neo4j -p CTPSecure2024! "RETURN 1"
# Should return: 1
```

### 5. Access Neo4j Browser
1. Open `http://localhost:7474` in your browser
2. Login with:
   - Username: `neo4j`
   - Password: `CTPSecure2024!`
3. Database: `ctp` (or leave as default)

## Running the Pipeline

### Standard Pipeline:
```bash
node src/main.js ./sample_project
```

### Optimized Pipeline (Recommended):
```bash
node src/main_optimized.js ./sample_project
```

### Performance Benchmark:
```bash
node scripts/benchmark_performance.js ./sample_project
```

## Service Management

### View Service Status:
```bash
docker-compose ps
```

### View Logs:
```bash
# All services
docker-compose logs -f

# Specific service
docker logs ctp-redis -f
docker logs ctp-neo4j -f
```

### Stop Services:
```bash
docker-compose down
```

### Remove All Data (Fresh Start):
```bash
docker-compose down -v
```

## Optional Services

### Redis Commander (Admin UI):
```bash
docker-compose --profile debug up -d redis-commander
# Access at: http://localhost:8081
# Login: admin / admin123
```

### Prometheus Monitoring:
```bash
docker-compose --profile monitoring up -d prometheus
# Access at: http://localhost:9090
```

## Troubleshooting

### Neo4j Connection Issues:
1. Wait 30-60 seconds after starting for Neo4j to fully initialize
2. Check logs: `docker logs ctp-neo4j`
3. Ensure no other service is using ports 7474 or 7687

### Redis Connection Issues:
1. Check if Redis is running: `docker ps | grep redis`
2. Ensure port 6379 is not in use
3. Check logs: `docker logs ctp-redis`

### Port Conflicts:
If you have port conflicts, you can change them in `.env`:
```env
NEO4J_HTTP_PORT=7475    # Change from 7474
NEO4J_BOLT_PORT=7688    # Change from 7687
REDIS_PORT=6380         # Change from 6379
```

### Memory Issues:
The services are configured with memory limits. If you encounter issues:
1. Increase Docker Desktop memory allocation
2. Or reduce service memory in `docker-compose.yml`

## Data Persistence
All data is persisted in Docker volumes:
- `ctp_redis-data`: Redis data
- `ctp_neo4j-data`: Neo4j database files
- `ctp_neo4j-logs`: Neo4j logs

To backup data:
```bash
docker run --rm -v ctp_neo4j-data:/data -v $(pwd):/backup alpine tar czf /backup/neo4j-backup.tar.gz -C /data .
```

## Performance Tips
1. **First Run**: The pipeline will analyze all files
2. **Subsequent Runs**: Only changed files are processed (incremental analysis)
3. **Clear Cache**: Delete Redis data to force full re-analysis
4. **Monitor Performance**: Use the benchmark script to measure improvements

## Next Steps
1. Run the optimized pipeline on your codebase
2. View results in Neo4j Browser
3. Use the benchmark script to compare performance
4. Check `docs/performance_optimizations_implemented.md` for details on improvements