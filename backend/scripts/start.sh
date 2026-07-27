#!/bin/sh
# Start script run by the container at boot.
# Runs Prisma migrations (idempotent — no-op if already applied) and then
# launches the Node server. We use a script instead of chaining commands in
# Railway's startCommand because Railway's parser was dropping the second
# command of `&&`/`;` chains, leaving the server unstarted.
set -e

echo "[start.sh] running prisma migrate deploy..."
# Fail-fast: a server booting against an out-of-date schema causes partial,
# silent data corruption. If migrations fail we abort the deploy instead of
# starting on a stale schema. `set -e` already aborts on a non-zero exit; the
# explicit check keeps the log message and intent clear.
if ! npx prisma migrate deploy; then
  echo "[start.sh] FATAL: prisma migrate deploy failed — aborting boot (refusing to run on a stale schema)"
  exit 1
fi
echo "[start.sh] migrate deploy OK"

echo "[start.sh] launching node dist/index-simple.js"
exec node dist/index-simple.js
