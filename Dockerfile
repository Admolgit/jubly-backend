# Stage 1: Build
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /src

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Build the project
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /src

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Expose app port
EXPOSE 5000

# Start the app
CMD ["node", "--max-old-space-size=4096", "dist/"]
