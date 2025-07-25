#!/bin/bash

# Polyglot Test Application Startup Script
# Runs JavaScript, Python, and Java services together

echo "🚀 Starting Polyglot Test Application..."

# Check if dependencies are installed
echo "📦 Checking dependencies..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "❌ Python is not installed. Please install Python 3.8+ and try again."
    exit 1
fi

# Check Java
if ! command -v java &> /dev/null; then
    echo "❌ Java is not installed. Please install Java 11+ and try again."
    exit 1
fi

# Setup database
echo "🗄️  Setting up database..."
if [ ! -f "polyglot_test.db" ]; then
    sqlite3 polyglot_test.db < database/schema.sql
    sqlite3 polyglot_test.db < database/test_data.sql
    echo "✅ Database created and populated with test data"
else
    echo "✅ Database already exists"
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
fi

# Install Python dependencies
echo "🐍 Installing Python dependencies..."
pip install -r requirements.txt 2>/dev/null || pip3 install -r requirements.txt

# Compile Java files
echo "☕ Compiling Java files..."
mkdir -p lib
# Download required JARs if they don't exist
if [ ! -f "lib/json-20230618.jar" ]; then
    echo "📥 Downloading JSON library for Java..."
    curl -L "https://repo1.maven.org/maven2/org/json/json/20230618/json-20230618.jar" -o "lib/json-20230618.jar" 2>/dev/null || echo "⚠️  JSON library download failed. Java service may not work."
fi

if [ ! -f "lib/sqlite-jdbc-3.44.1.0.jar" ]; then
    echo "📥 Downloading SQLite JDBC driver..."
    curl -L "https://repo1.maven.org/maven2/org/xerial/sqlite-jdbc/3.44.1.0/sqlite-jdbc-3.44.1.0.jar" -o "lib/sqlite-jdbc-3.44.1.0.jar" 2>/dev/null || echo "⚠️  SQLite JDBC download failed. Java service may not work."
fi

javac -cp ".:lib/*" java/*.java 2>/dev/null || echo "⚠️  Java compilation failed. Java service may not work."

echo "🎯 All services ready!"
echo ""
echo "🌐 Starting services:"
echo "  - JavaScript API: http://localhost:3000"
echo "  - Python Service: http://localhost:5000"  
echo "  - Java Service: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Start all services concurrently
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# Start JavaScript service
echo "🟨 Starting JavaScript service..."
cd js && node server.js &
JS_PID=$!

# Start Python service  
echo "🟩 Starting Python service..."
cd python && python3 data_processor.py &
PY_PID=$!

# Start Java service
echo "🟧 Starting Java service..."
java -cp ".:lib/*" com.polyglot.services.UserService &
JAVA_PID=$!

# Wait for services to start
sleep 3

echo ""
echo "✅ All services started!"
echo "   JavaScript PID: $JS_PID"
echo "   Python PID: $PY_PID" 
echo "   Java PID: $JAVA_PID"
echo ""
echo "🔗 Service URLs:"
echo "   JavaScript: http://localhost:3000/api/status"
echo "   Python: http://localhost:5000/health"
echo "   Java: http://localhost:8080/health"

# Keep script running
wait 