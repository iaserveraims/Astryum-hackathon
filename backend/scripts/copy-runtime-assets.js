/**
 * copy-runtime-assets — tsc emits only JS; the runtime allowlists are JSON.
 *
 * AllowlistService reads `dist/config/*.runtime.json` at boot (its configDir
 * resolves relative to __dirname). Without this copy the production image
 * ships an EMPTY allowlist and PolicyGuard P6 rejects EVERY prepared intent
 * with `contract_not_allowed` — exactly the silent failure found live on
 * Railway 2026-07-18 (the automation trigger fired, the build was attempted,
 * the guard blocked it). Runs as part of `npm run build` in every environment,
 * including the Docker builder stage.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'config');
const dst = path.join(__dirname, '..', 'dist', 'config');

fs.mkdirSync(dst, { recursive: true });
let copied = 0;
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.runtime.json')) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    copied += 1;
  }
}
console.log(`[build] runtime allowlists copied to dist/config: ${copied}`);
if (copied === 0) {
  console.warn('[build] WARNING: no *.runtime.json found — PolicyGuard P6 will reject every prepared intent');
}
