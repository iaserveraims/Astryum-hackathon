# syntax=docker/dockerfile:1
# Bump CACHEBUST to force a clean Docker layer rebuild when shipping fixes
# whose code changes don't otherwise alter the build inputs Railway sees.
ARG CACHEBUST=2026-05-06-01
FROM node:20-alpine AS builder
WORKDIR /app
ARG CACHEBUST
RUN echo "cachebust=$CACHEBUST"

# Prisma's query engine is dynamically linked against libssl. The default
# alpine image lacks it; without this `apk add openssl` the runtime crashes
# with "Error loading shared library libssl.so.1.1" or "libssl.so.3" when
# any prisma client call runs.
RUN apk add --no-cache openssl

# Install full deps (incl. devDeps for tsc). Scripts disabled because the
# `prepare` lifecycle calls `husky install`, which fails inside Docker (no
# .git dir). Prisma's postinstall is replaced by the explicit
# `npx prisma generate` step below.
ENV HUSKY=0
COPY backend/package*.json ./
RUN npm install --ignore-scripts

# Copy backend source. prisma/ comes with it for `prisma generate`.
COPY backend/ .

# Generate Prisma client BEFORE compiling, so the build sees correct types
# and the runner image can ship the generated client at /app/node_modules/.prisma.
RUN npx prisma generate

# Compile TypeScript. Do NOT swallow failures with `|| true` — a failed build
# previously fell back to a cached dist/, which is how stale code reached prod.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Same reason as in the builder stage: Prisma's runtime engine needs libssl.
RUN apk add --no-cache openssl

COPY backend/package*.json ./
# Production deps only. --ignore-scripts is required here: husky is a devDep
# but the `prepare` lifecycle still tries to run `husky install`, which fails
# in the runner image (and isn't needed in production anyway). The Prisma
# client doesn't need a postinstall here either — we COPY the already-
# generated client from the builder stage below.
ENV HUSKY=0
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

# Bring the Prisma client generated in the builder stage. Without this the
# runtime fails with `Cannot find module '.prisma/client/default'`.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
# Prisma CLI for `migrate deploy` at boot (see start.sh). Without it npx
# downloads the CLI from the npm registry on EVERY container start — tens of
# seconds of cold boot, a registry dependency just to boot, and an unpinned
# (latest) CLI running our 5.x migrations. @prisma/engines already ships via
# the @prisma COPY above.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
RUN mkdir -p /app/logs

EXPOSE 3001
# Entrypoint script runs `prisma migrate deploy` then `exec node …`.
# See scripts/start.sh for the rationale (Railway swallows shell chains).
CMD ["sh", "scripts/start.sh"]
