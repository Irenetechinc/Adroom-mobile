# Use Node.js 20 LTS
FROM node:20-bookworm-slim

# Set working directory to backend
WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies (deterministic, clean install from package-lock.json)
RUN npm ci

# Copy backend source code
COPY backend/ .

# Build TypeScript code
RUN npm run build

# Expose the port the app runs on
EXPOSE 8000

# Start the server
CMD ["npm", "start"]
