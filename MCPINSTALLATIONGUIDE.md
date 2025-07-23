# MCP Server Installation Guide for Windows - Neo4j Example

This guide documents the complete process of troubleshooting and successfully configuring MCP (Model Context Protocol) servers in Claude Code on Windows, using Neo4j MCP servers as a case study.

## Problem Overview

MCP servers were failing to connect in Claude Code on Windows with the following symptoms:
- Status showing "× failed" for all MCP servers
- Log errors showing "MCP error -32000: Connection closed"
- No tools available despite correct package installation

## Root Cause Analysis

The primary issues identified were:

1. **Windows Command Execution**: `npx` and Python module execution requires special handling on Windows
2. **Environment Variable Handling**: Environment variables weren't properly passed to child processes
3. **Path Escaping**: Windows paths with spaces and backslashes require proper JSON escaping
4. **Executable Discovery**: Need to use direct executable paths rather than module imports

## Step-by-Step Solution

### Step 1: Verify Prerequisites

First, confirm all required components are installed:

```bash
# Check Node.js version (v18.x or newer required)
node --version

# Check npm version (v10.x or newer required) 
npm --version

# Check Python version (v3.8+ required)
python --version

# Verify Neo4j MCP packages are installed
python -m pip list | grep -i neo4j
```

Expected output should show:
```
mcp-neo4j-cypher     0.1.1
mcp-neo4j-memory     0.1.1  
neo4j                5.28.1
```

### Step 2: Test Database Connectivity

Before configuring MCP servers, verify Neo4j database is accessible:

```python
python -c "from neo4j import GraphDatabase; driver = GraphDatabase.driver('bolt://localhost:7687', auth=('neo4j', 'test1234')); driver.verify_connectivity(); print('Neo4j connection successful'); driver.close()"
```

### Step 3: Locate Configuration File

Claude Code configuration is stored at:
- **Windows**: `C:/Users/{username}/.claude.json`

### Step 4: Identify Correct Executables

Find the installed MCP executable paths:

```bash
# Find executable locations
where mcp-neo4j-cypher
where mcp-neo4j-memory

# Check package entry points
python -m pip show -f mcp-neo4j-cypher | grep Scripts
```

Expected locations:
```
C:\Users\{username}\AppData\Roaming\Python\Python313\Scripts\mcp-neo4j-cypher.exe
C:\Users\{username}\AppData\Roaming\Python\Python313\Scripts\mcp-neo4j-memory.exe
```

### Step 5: Check Executable Arguments

Examine the package source to understand argument structure:

```python
# Check argument parser in the package
python -c "import mcp_neo4j_cypher; help(mcp_neo4j_cypher.main)"
```

Key arguments discovered:
- `--db-url`: Neo4j connection URL (default: bolt://localhost:7687)
- `--username`: Neo4j username (default: neo4j)  
- `--password`: Neo4j password (default: password)

### Step 6: Test Manual Execution

Before updating configuration, test the executable manually:

```bash
# Test with timeout to verify it starts properly
cmd /c 'timeout 3 "C:\Users\hotra\AppData\Roaming\Python\Python313\Scripts\mcp-neo4j-cypher.exe" --db-url bolt://localhost:7687 --username neo4j --password test1234'
```

Success indicator: Command runs without immediate exit or authentication errors.

### Step 7: Update Claude Code Configuration

Edit `C:/Users/{username}/.claude.json` and update the `mcpServers` section:

#### ❌ Incorrect Configuration (Common Mistakes)

```json
{
  "mcpServers": {
    "neo4j-cypher": {
      "type": "stdio",
      "command": "python",                    // ❌ Windows can't spawn batch files directly
      "args": ["-m", "mcp_neo4j_cypher"],     // ❌ Module doesn't have __main__.py
      "env": {                                // ❌ Environment variables not passed properly
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_PASSWORD": "test1234"
      }
    }
  }
}
```

```json
{
  "mcpServers": {
    "neo4j-cypher": {
      "type": "stdio", 
      "command": "cmd",                       // ❌ Still has issues with env vars
      "args": ["/c", "python", "-m", "mcp_neo4j_cypher"],
      "env": {
        "NEO4J_PASSWORD": "test1234"
      }
    }
  }
}
```

#### ✅ Correct Configuration

```json
{
  "mcpServers": {
    "neo4j-cypher": {
      "type": "stdio",
      "command": "C:\\\\Users\\\\hotra\\\\AppData\\\\Roaming\\\\Python\\\\Python313\\\\Scripts\\\\mcp-neo4j-cypher.exe",
      "args": [
        "--db-url", "bolt://localhost:7687",
        "--username", "neo4j", 
        "--password", "test1234"
      ]
    },
    "neo4j-memory": {
      "type": "stdio",
      "command": "C:\\\\Users\\\\hotra\\\\AppData\\\\Roaming\\\\Python\\\\Python313\\\\Scripts\\\\mcp-neo4j-memory.exe",
      "args": [
        "--db-url", "bolt://localhost:7687",
        "--username", "neo4j",
        "--password", "test1234"
      ]
    }
  }
}
```

### Step 8: Key Configuration Rules

1. **Path Escaping**: Use `\\\\` for Windows path separators in JSON
2. **Direct Executables**: Use full path to `.exe` files, not Python modules
3. **Command Arguments**: Pass credentials as command arguments, not environment variables
4. **No Environment Section**: Remove `env` section when using arguments

### Step 9: Restart and Verify

1. **Restart Claude Code** completely
2. **Check connection status**: Type `/mcp` to see server status
3. **Verify tools**: Type `/mcp tools` to see available tools

Expected success output:
```
Neo4j-cypher MCP Server
Status: √ connected
Tools: 3 tools

Neo4j-memory MCP Server  
Status: √ connected
Tools: 9 tools
```

## Common Troubleshooting

### Debug Mode
Run Claude Code with debug flags to see detailed error messages:
```bash
claude --debug
```

### Check Log Files
MCP server logs are stored at:
```
C:\Users\{username}\AppData\Local\claude-cli-nodejs\Cache\C--{project-path}\mcp-logs-{server-name}\
```

### Common Error Patterns

| Error | Root Cause | Solution |
|-------|------------|----------|
| `spawn npx ENOENT` | Batch file can't be spawned directly | Use `cmd /c` wrapper or direct executable |
| `No module named __main__` | Python module lacks main entry point | Use installed executable instead |
| `Connection closed` | Process exits immediately | Check authentication and argument passing |
| `Authentication failure` | Wrong credentials or format | Verify database password and argument syntax |

## Best Practices for Windows MCP Setup

1. **Always use full executable paths** - Don't rely on PATH resolution
2. **Prefer command arguments over environment variables** - More reliable on Windows
3. **Test executables manually first** - Verify they work before configuring
4. **Use proper JSON escaping** - Double backslashes for Windows paths
5. **Check package documentation** - Look for argument parsers and entry points
6. **Monitor log files** - Enable debug mode for detailed troubleshooting

## Alternative Approaches

If direct executables don't work, try these alternatives:

### PowerShell Wrapper
```json
{
  "command": "powershell.exe",
  "args": ["-Command", "python", "-m", "mcp_neo4j_cypher", "--password", "test1234"]
}
```

### Batch File Wrapper
Create a `.bat` file with the full command and call that instead.

### Global Package Installation
```bash
npm install -g @modelcontextprotocol/server-filesystem
```

## Summary

The successful configuration required:
1. ✅ Using direct executable paths instead of Python module imports
2. ✅ Passing credentials as command line arguments instead of environment variables  
3. ✅ Proper Windows path escaping with double backslashes
4. ✅ Testing manual execution before configuration
5. ✅ Understanding the package's argument structure

This approach should work for most MCP servers on Windows, though specific argument names may vary by package. Always check the package source or documentation for the correct argument structure.

## Final Working Configuration

```json
{
  "mcpServers": {
    "neo4j-cypher": {
      "type": "stdio",
      "command": "C:\\\\Users\\\\hotra\\\\AppData\\\\Roaming\\\\Python\\\\Python313\\\\Scripts\\\\mcp-neo4j-cypher.exe",
      "args": [
        "--db-url", "bolt://localhost:7687",
        "--username", "neo4j", 
        "--password", "test1234"
      ]
    },
    "neo4j-memory": {
      "type": "stdio", 
      "command": "C:\\\\Users\\\\hotra\\\\AppData\\\\Roaming\\\\Python\\\\Python313\\\\Scripts\\\\mcp-neo4j-memory.exe",
      "args": [
        "--db-url", "bolt://localhost:7687",
        "--username", "neo4j",
        "--password", "test1234"
      ]
    }
  }
}
```

Result: Both servers connecting successfully with full tool availability.