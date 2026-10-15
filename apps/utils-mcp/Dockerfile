# Stage 1: Build TypeScript bundle
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src/ ./src/
RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist

# Run as non-root
USER node

EXPOSE 4002

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4002/healthz || exit 1

CMD ["node", "dist/index.js"]
