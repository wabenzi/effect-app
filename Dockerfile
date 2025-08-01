# Production-ready Dockerfile for pre-compiled Effect-TS HTTP API
FROM amazonlinux:2023

# Install only runtime dependencies
RUN dnf update -y && \
    dnf install -y \
    nodejs \
    shadow-utils \
    && dnf clean all && \
    rm -rf /var/cache/dnf

# Create non-root user for security
RUN groupadd -r appuser && \
    useradd -r -g appuser -s /bin/false appuser

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy pre-compiled JavaScript (build locally first with: npm run build)
COPY dist/ ./dist/

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

# Change ownership of app files to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check using Node.js
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application using pre-compiled JavaScript
CMD ["node", "dist/main.js"]
