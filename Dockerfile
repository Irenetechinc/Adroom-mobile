# Use Node.js LTS
FROM node:18-alpine

# Set working directory to backend
WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install

# Copy backend source code
COPY backend/ .

# Build TypeScript code
RUN npm run build

# Expose the port the app runs on
EXPOSE 8000

# Start the server
CMD ["npm", "start"]
