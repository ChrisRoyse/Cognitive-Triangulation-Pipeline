# Redis Eviction Policy Configuration

## Overview

The CTP pipeline requires Redis to be configured with the `noeviction` policy to ensure that data is not automatically removed when memory limits are reached. This is critical for maintaining job queue integrity.

## Automatic Configuration

The `cacheClient.js` module automatically configures Redis with the correct eviction policy when it connects. When the Redis client establishes a connection, it:

1. Checks the current eviction policy
2. If not set to `noeviction`, automatically updates it
3. Persists the configuration to disk (if permissions allow)
4. Logs the configuration status

## Manual Configuration Options

### Option 1: Using the Configuration Script

Run the provided configuration script:

```bash
node scripts/configure-redis.js [redis-url]
```

Example:
```bash
node scripts/configure-redis.js redis://localhost:6379
```

### Option 2: Using Redis CLI

```bash
redis-cli CONFIG SET maxmemory-policy noeviction
redis-cli CONFIG REWRITE
```

### Option 3: Docker Compose

If using Docker, the policy is already configured in `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server 
    --maxmemory-policy noeviction
```

### Option 4: Redis Configuration File

Add to your `redis.conf`:

```
maxmemory-policy noeviction
```

## Testing the Configuration

To verify that Redis is correctly configured:

```bash
node scripts/test-redis-config.js
```

This will connect to Redis and verify that the eviction policy is set correctly.

## Troubleshooting

### CONFIG Commands Disabled

If you see errors about CONFIG commands being disabled, you may need to:

1. Enable CONFIG commands in your Redis configuration
2. Use a Redis configuration file with the setting pre-configured
3. Use Docker with the command-line parameter

### Permission Denied

If the automatic configuration fails due to permissions:

1. Run the configuration script with appropriate permissions
2. Manually configure Redis using one of the methods above
3. Ensure your Redis user has CONFIG permissions

## Why NoEviction?

The `noeviction` policy ensures that:

- Job queues are never automatically pruned
- Critical pipeline data is preserved
- Memory issues result in explicit errors rather than silent data loss
- The pipeline maintains consistency and reliability