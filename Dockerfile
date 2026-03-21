# ── Stage 1: deps ──────────────────────────────────────────────────────────────
# Install production + dev dependencies so we can build.
FROM node:22-alpine AS deps

LABEL maintainer="Pradhyuman <pradhyuman@pm.me>"
LABEL description="DC Metro Live — autonomous transit simulation by Pradhyuman"

# better-sqlite3 is a native addon — needs build tools
RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

LABEL maintainer="Pradhyuman <pradhyuman@pm.me>"
LABEL description="DC Metro Live — autonomous transit simulation by Pradhyuman"

RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Port the app listens on inside the container
ENV PORT=3009
ENV HOSTNAME=0.0.0.0

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy only what Next.js needs to run.
# Next.js standalone build moves public/ assets into .next/standalone/public,
# so copy from there. Create the dir first in case it is empty.
RUN mkdir -p ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# better-sqlite3 is a native addon marked as serverExternalPackages — Next.js
# standalone does NOT bundle it, so copy it explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Persist the SQLite database in a named volume so simulation state survives restarts.
# Mount a named volume at /app/data when running the container:
#   docker run -v dc-metro-data:/app/data ...
RUN mkdir -p data && chown nextjs:nodejs data

# Declare the data directory as a volume so Docker knows to persist it.
VOLUME ["/app/data"]

USER nextjs

EXPOSE 3009

# Health check — verifies the Next.js server is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3009/api/subway/trains || exit 1

# next start (standalone) reads PORT from env
CMD ["node", "server.js"]
