# ============================================================
# ITAM-NextJS Docker Image — Self-host deployment
# ============================================================

# ── Stage 1: Build ──
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Set env for build
ENV NODE_ENV=production
ENV SANDBOX_PREVIEW=1

# Generate Prisma client
RUN bun run db:generate

# Build Next.js
RUN bun run next build --webpack

# ── Stage 2: Production ──
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# Copy migration
COPY --from=builder /app/prisma/migrations ./prisma/migrations

# Copy package.json for scripts
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start
CMD ["node", "server.js"]
