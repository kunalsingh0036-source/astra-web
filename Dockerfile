# Astra web — Next.js 16 production image.
#
# Multi-stage build:
#   1. deps   — install npm deps (cached unless package-lock changes)
#   2. build  — run `next build` to produce the .next/ output
#   3. runner — minimal runtime; just node, .next/, and node_modules
#
# Why not the standalone output target (Next's recommended): we use
# a few server-side imports (NextAuth, our own /api proxies) that
# read environment at runtime; standalone trims node_modules in ways
# that have surprised this codebase before. Plain `next start` is
# 30MB heavier in the image but predictable.
#
# Build context: astra-web/ root. Railway uploads this dir verbatim.

# ── 1. deps ──────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

# Install only what package-lock.json says — reproducible.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 2. build ─────────────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build needs at least the public env vars at build time
# (NEXT_PUBLIC_*). Pass them through Railway's build-time env.
RUN npm run build

# ── 3. runner ────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Bring only what `next start` needs: built output, public assets,
# package metadata, and the production node_modules.
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

# Railway injects $PORT; default to 3100 for parity with local dev.
ENV PORT=3100
EXPOSE 3100

# `next start` honors $PORT automatically when set; we still pass
# it explicitly so a misconfigured PORT (empty string) defaults
# correctly rather than binding 0.
CMD ["sh", "-c", "npx next start -p ${PORT:-3100} -H 0.0.0.0"]
