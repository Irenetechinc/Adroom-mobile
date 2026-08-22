# Use official Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDeps needed for tsc)
RUN npm install --legacy-peer-deps

# Copy source code
COPY src ./src

# Build TypeScript code
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Expose the port the app runs on
EXPOSE 8000

# Start the server
CMD ["node", "dist/server.js"]
