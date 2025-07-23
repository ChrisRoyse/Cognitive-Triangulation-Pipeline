#!/bin/bash

# Simple database monitoring script
DB_PATH="database.db"

echo "🔍 Database Monitor Started"
echo "Database: $DB_PATH"
echo "Checking every 30 seconds..."
echo ""

counter=0
while true; do
    counter=$((counter + 1))
    timestamp=$(date '+%H:%M:%S')
    
    # Get counts
    files=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM files;" 2>/dev/null || echo "0")
    pois=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pois;" 2>/dev/null || echo "0")
    relationships=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM relationships;" 2>/dev/null || echo "0")
    outbox_pending=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM outbox WHERE status='pending';" 2>/dev/null || echo "0")
    
    echo "[$timestamp] Check #$counter:"
    echo "  Files: $files | POIs: $pois | Relationships: $relationships | Outbox Pending: $outbox_pending"
    
    # Check if we have progress
    if [ "$files" -gt 0 ] || [ "$pois" -gt 0 ]; then
        echo "  ✅ Progress detected!"
    fi
    
    sleep 30
done