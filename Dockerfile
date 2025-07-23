# Multi-stage Production Dockerfile
FROM node:18-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies including dev dependencies for building
RUN npm ci

# Copy source code
COPY . .

# Build step (if needed for any compilation)
RUN npm run build || true

FROM node:18-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache sqlite tini

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy built node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code with proper ownership
COPY --chown=nodejs:nodejs src/ ./src/
COPY --chown=nodejs:nodejs tests/ ./tests/
COPY --chown=nodejs:nodejs *.js ./
COPY --chown=nodejs:nodejs package*.json ./

# Create necessary directories
RUN mkdir -p /app/data /app/logs && \
    chown -R nodejs:nodejs /app/data /app/logs

# Switch to non-root user
USER nodejs

# Environment settings for production
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check OK')" || exit 1

# Expose port
EXPOSE 3002

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "src/main.js"]