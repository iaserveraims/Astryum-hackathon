#!/bin/sh
# Start script run by the container at boot.
# Runs Prisma migrations (idempotent — no-op if already applied) and then
# launches the Node server. We use a script instead of chaining commands in
# Railway's startCommand because Railway's parser was dropping the second
# command of `&&`/`;` chains, leaving the server unstarted.
set -e

# ── Guard: a preview must never migrate — or run against — the production
# database.
#
# The danger is not the migration. `migrate deploy` is additive and Prisma
# selects explicit columns, so a column production does not know about is
# invisible to it. The danger is everything that boots AFTER it:
# index-simple.ts starts the sentinel, the XRPL watcher, the escrow keeper,
# the direct-mint executor watcher and the automation tick. Pointed at the
# production database, an unreleased branch would compose real council
# proposals, write into real users' alert trays, and — with real credentials —
# spend real FLR. That is a shared-database problem, not a schema one, and no
# amount of care in the migration prevents it.
#
# So the rule is about IDENTITY, not about SQL: a deployment that declares
# itself production may touch the production database; anything else must
# carry its own. `DEPLOY_ENV` is the declaration (production | preview | …),
# and `PRODUCTION_DB_HOST_MARKER` is the substring that identifies the
# production instance in `DATABASE_URL` (set it on the PREVIEW service so the
# guard has something to compare against; leave it unset and the guard simply
# does not fire).
#
# Fail-closed on purpose: the cost of a preview refusing to boot is a red log
# line. The cost of the opposite is a branch engine writing into real trays.
if [ -n "$PRODUCTION_DB_HOST_MARKER" ] \
  && [ "${DEPLOY_ENV:-production}" != "production" ] \
  && [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    *"$PRODUCTION_DB_HOST_MARKER"*)
      echo "[start.sh] FATAL: DEPLOY_ENV='${DEPLOY_ENV}' but DATABASE_URL points at the production database."
      echo "[start.sh]        A preview needs its OWN database: it does not just migrate, it RUNS —"
      echo "[start.sh]        keeper, executor and automation tick would act on real data."
      echo "[start.sh]        Give this service its own Postgres, or unset PRODUCTION_DB_HOST_MARKER"
      echo "[start.sh]        if you have decided to share it deliberately."
      exit 1
      ;;
  esac
fi

echo "[start.sh] running prisma migrate deploy..."
# Prefer the Prisma CLI baked into the image (copied from the builder stage in
# the Dockerfile). Bare `npx prisma` downloaded the CLI from the npm registry
# on every boot; the pinned npx form is only a fallback for images built
# before the COPY existed.
if [ -f node_modules/prisma/build/index.js ]; then
  PRISMA="node node_modules/prisma/build/index.js"
else
  echo "[start.sh] WARN: bundled prisma CLI not found — falling back to npx prisma@5.22.0"
  PRISMA="npx prisma@5.22.0"
fi
# Fail-fast: a server booting against an out-of-date schema causes partial,
# silent data corruption. If migrations fail we abort the deploy instead of
# starting on a stale schema. `set -e` already aborts on a non-zero exit; the
# explicit check keeps the log message and intent clear.
if ! $PRISMA migrate deploy; then
  echo "[start.sh] FATAL: prisma migrate deploy failed — aborting boot (refusing to run on a stale schema)"
  exit 1
fi
echo "[start.sh] migrate deploy OK"

echo "[start.sh] launching node dist/index-simple.js"
exec node dist/index-simple.js
