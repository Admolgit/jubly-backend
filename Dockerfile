# =========================
# Stage 1: Build
# =========================
FROM node:20 AS builder

WORKDIR /src

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy application
COPY . .

# Build NestJS
RUN npm run build


# =========================
# Stage 2: Production
# =========================
FROM node:20

WORKDIR /src

ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy compiled application
COPY --from=builder /src/dist ./dist

# Copy generated Prisma Client
COPY --from=builder /src/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /src/node_modules/@prisma ./node_modules/@prisma

EXPOSE 5000

CMD ["node", "--max-old-space-size=4096", "dist/src/main.js"]