# Node.js 18 Alpine image for smaller size
# Adapted from the provided Python snippet for Node.js
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Set environment variables
# NODE_ENV: production optimize
# ENV NODE_ENV=production (Moved to after build)

# Install system dependencies (Alpine specific if needed for gRPC/native modules)
# grpc-js implies pure JS but some deps might need python/make/g++
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package*.json ./
# Install ALL dependencies (including dev) to build TypeScript, then prune
RUN npm install

# Copy application code
COPY . .

# Build TypeScript to dist/
RUN npm run build
# Copy static assets (Admin Dashboard)
COPY src/public ./dist/public
COPY protos ./dist/protos

# Set environment variables
# NODE_ENV: production optimize
ENV NODE_ENV=production

# Prune dev dependencies to keep image small
RUN npm prune --production

# Set NODE_ENV to production for runtime
ENV NODE_ENV=production

# Expose ports (gRPC + Statistics API)
EXPOSE 9090
EXPOSE 3001
EXPOSE 8083

# Command to run the application
CMD ["npm", "start"]
