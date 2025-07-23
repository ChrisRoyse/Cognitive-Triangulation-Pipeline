import sqlite3
import json

def analyze_database():
    conn = sqlite3.connect('./data/database.db')
    cursor = conn.cursor()
    
    print("=== DATABASE ANALYSIS ===\n")
    
    # Check files table
    cursor.execute("SELECT COUNT(*) FROM files")
    file_count = cursor.fetchone()[0]
    print(f"Files processed: {file_count}")
    if file_count > 0:
        cursor.execute("SELECT file_path, status FROM files LIMIT 5")
        print("Sample files:")
        for row in cursor.fetchall():
            print(f"  - {row[0]} [{row[1]}]")
    
    print("\n" + "="*50 + "\n")
    
    # Check POIs table
    cursor.execute("SELECT COUNT(*) FROM pois")
    poi_count = cursor.fetchone()[0]
    print(f"POIs extracted: {poi_count}")
    if poi_count > 0:
        cursor.execute("SELECT type, COUNT(*) FROM pois GROUP BY type")
        print("POI types:")
        for row in cursor.fetchall():
            print(f"  - {row[0]}: {row[1]}")
        
        # Sample POIs
        cursor.execute("SELECT file_path, name, type, start_line, end_line FROM pois LIMIT 5")
        print("\nSample POIs:")
        for row in cursor.fetchall():
            print(f"  - {row[0]} | {row[1]} ({row[2]}) | Lines {row[3]}-{row[4]}")
    
    print("\n" + "="*50 + "\n")
    
    # Check relationships table
    cursor.execute("SELECT COUNT(*) FROM relationships")
    rel_count = cursor.fetchone()[0]
    print(f"Relationships discovered: {rel_count}")
    if rel_count > 0:
        cursor.execute("SELECT type, COUNT(*) FROM relationships GROUP BY type")
        print("Relationship types:")
        for row in cursor.fetchall():
            print(f"  - {row[0]}: {row[1]}")
        
        cursor.execute("SELECT status, COUNT(*) FROM relationships GROUP BY status")
        print("\nRelationship statuses:")
        for row in cursor.fetchall():
            print(f"  - {row[0]}: {row[1]}")
        
        # Check validated relationships
        cursor.execute("SELECT COUNT(*) FROM relationships WHERE status = 'validated'")
        validated_count = cursor.fetchone()[0]
        print(f"\nValidated relationships: {validated_count}")
    
    print("\n" + "="*50 + "\n")
    
    # Check relationship_evidence table
    cursor.execute("SELECT COUNT(*) FROM relationship_evidence")
    evidence_count = cursor.fetchone()[0]
    print(f"Relationship evidence entries: {evidence_count}")
    
    # Check transactional_outbox
    cursor.execute("SELECT COUNT(*) FROM transactional_outbox")
    outbox_count = cursor.fetchone()[0]
    print(f"Transactional outbox entries: {outbox_count}")
    if outbox_count > 0:
        cursor.execute("SELECT event_type, processed, COUNT(*) FROM transactional_outbox GROUP BY event_type, processed")
        print("Outbox status:")
        for row in cursor.fetchall():
            print(f"  - {row[0]} [processed={row[1]}]: {row[2]}")
    
    print("\n" + "="*50 + "\n")
    
    # Check if POIs have proper data
    if poi_count > 0:
        cursor.execute("SELECT COUNT(*) FROM pois WHERE name IS NULL OR name = ''")
        empty_names = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM pois WHERE type IS NULL OR type = ''")
        empty_types = cursor.fetchone()[0]
        print(f"POIs with empty names: {empty_names}")
        print(f"POIs with empty types: {empty_types}")
        
        # Check a sample POI's data
        cursor.execute("SELECT * FROM pois LIMIT 1")
        row = cursor.fetchone()
        if row:
            print("\nSample POI full data:")
            columns = [desc[0] for desc in cursor.description]
            for i, col in enumerate(columns):
                print(f"  {col}: {row[i]}")
    
    conn.close()

if __name__ == "__main__":
    analyze_database()