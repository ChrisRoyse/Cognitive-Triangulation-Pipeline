#!/bin/bash

# Java compilation script for Polyglot Test Application

echo "☕ Compiling Java components..."

# Create lib directory for dependencies
mkdir -p lib

# Download required JAR files if they don't exist
echo "📥 Checking Java dependencies..."

# JSON library
if [ ! -f "lib/json-20230618.jar" ]; then
    echo "Downloading JSON library..."
    curl -L "https://repo1.maven.org/maven2/org/json/json/20230618/json-20230618.jar" -o "lib/json-20230618.jar"
fi

# SQLite JDBC driver
if [ ! -f "lib/sqlite-jdbc-3.44.1.0.jar" ]; then
    echo "Downloading SQLite JDBC driver..."
    curl -L "https://repo1.maven.org/maven2/org/xerial/sqlite-jdbc/3.44.1.0/sqlite-jdbc-3.44.1.0.jar" -o "lib/sqlite-jdbc-3.44.1.0.jar"
fi

# Compile Java files
echo "🔨 Compiling Java source files..."
javac -cp ".:lib/*" *.java

if [ $? -eq 0 ]; then
    echo "✅ Java compilation successful!"
    echo ""
    echo "🚀 Run services with:"
    echo "   java -cp \".:lib/*\" com.polyglot.services.UserService"
    echo "   java -cp \".:lib/*\" com.polyglot.services.DatabaseManager"
    echo "   java -cp \".:lib/*\" com.polyglot.services.BusinessLogic"
    echo "   java -cp \".:lib/*\" com.polyglot.services.ApiClient"
else
    echo "❌ Java compilation failed!"
    exit 1
fi 