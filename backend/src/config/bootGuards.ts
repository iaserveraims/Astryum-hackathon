/**
 * Boot guards — hard invariant enforcement at process startup.
 *
 * Invariant #1 (CLAUDE.md): "Ninguna clave privada del usuario toca el backend
 * ni el cliente. Astryum construye payloads SIN firmar; la firma es siempre de
 * la wallet del usuario." Astryum NEVER signs, NEVER custodies, NEVER executes.
 *
 * A pre-V1 relic (`connectors/protocols/FlareFinanceConnector.ts`, @ts-nocheck,
 * deprecated) still contains a `getSigner()` that would build an
 * `ethers.Wallet(process.env.WALLET_PRIVATE_KEY_EVM)` and broadcast. The relic
 * is inert (never imported by any live route — see the Demos Mainnet plan §5),
 * and per the "never delete built code" rule we leave it in place. But to make
 * the invariant un-bypassable we refuse to BOOT if a custodial EVM signing key
 * is present in the environment: with no key reachable, even the relic cannot
 * custody or sign.
 *
 * This deliberately does NOT block Turnkey credentials. Turnkey is the embedded
 * passkey-only / treasury rail (keys live in Turnkey's TEE, never in our env)
 * and is explicitly allowed by CLAUDE.md §"Módulos aislados".
 */

/** Env var names that, if set to a real private key, would let the backend sign. */
const CUSTODIAL_KEY_ENV_VARS = [
  'WALLET_PRIVATE_KEY_EVM',
  'EVM_PRIVATE_KEY',
  'SIGNER_PRIVATE_KEY',
  'DEPLOYER_PRIVATE_KEY',
  'PRIVATE_KEY',
];

/** A raw secp256k1 private key: 64 hex chars, optionally 0x-prefixed. */
const PRIVATE_KEY_RE = /^(0x)?[a-fA-F0-9]{64}$/;

/**
 * Returns the names of env vars that hold a real custodial private key.
 * Empty values, whitespace, and obvious placeholders are ignored so an empty
 * `.env` slot never trips the guard.
 */
export function detectCustodialKeys(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const offenders: string[] = [];
  for (const name of CUSTODIAL_KEY_ENV_VARS) {
    const raw = env[name];
    if (!raw) continue;
    const value = raw.trim();
    if (!value) continue;
    // Ignore placeholders like "changeme", "<your-key>", "0x..." stubs.
    if (!PRIVATE_KEY_RE.test(value)) continue;
    offenders.push(name);
  }
  return offenders;
}

/**
 * Throws if any custodial private key is present in the environment. Call this
 * first thing at boot (before binding the listener) so the process exits loudly
 * rather than running in a state that violates invariant #1.
 */
export function assertNoCustodialKeys(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const offenders = detectCustodialKeys(env);
  if (offenders.length === 0) return;
  throw new Error(
    `BOOT REFUSED — invariant #1 violation: custodial EVM private key(s) present in env: ${offenders.join(
      ', ',
    )}. Astryum is non-custodial and NEVER signs; remove these from the ` +
      `environment. Signing belongs to the user's wallet (Xaman / MetaMask / ` +
      `Ledger) or Turnkey's TEE — never a raw key in our process env.`,
  );
}

/* ------------------------------------------------------------------ */
/* Prod-DB guard — "seguridad no ganada": the env is named local but IS prod  */
/* ------------------------------------------------------------------ */

/**
 * Substrings that identify the PRODUCTION database host. Astryum's prod DB is
 * Supabase; extend this list if the prod host ever changes. A local/dev DB
 * (localhost, 127.0.0.1, a docker `postgres` host) matches none of these.
 */
const PROD_DB_HOST_MARKERS = ['supabase.com', 'supabase.co'];

/** The prod-host marker DATABASE_URL matches, or null when it does not. */
export function productionDatabaseMarker(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const url = env.DATABASE_URL ?? '';
  return PROD_DB_HOST_MARKERS.find((m) => url.includes(m)) ?? null;
}

/**
 * Refuse to BOOT when a DEV/LOCAL process is pointed at the PRODUCTION database.
 *
 * "Seguridad no ganada" (2026-07-22): a `localhost` backend booted with
 * `ALLOW_NO_AUTH=1` was found connected to the prod Supabase DB — the only thing
 * that kept it from touching real user data was that someone noticed and stuck to
 * GETs. That is discipline, not a guard. And the tests are NOT hermetic (the
 * XRPLProvider WS→HTTPS fallback makes real network calls), so a write test, a
 * seed, or a stray migration would hit prod. This is the same disease inverted —
 * an environment that is named "local", looks local, and is production: a signal
 * asserting safety it never verified.
 *
 * Un-bypassable: the prod DB is allowed ONLY when NODE_ENV=production (the genuine
 * deploy — backend/Dockerfile sets `ENV NODE_ENV=production`) or when
 * CONFIRM_PROD_DB=1 declares deliberate, eyes-open (read-only) intent. Likely
 * origin: the .env was refreshed with prod creds after the Supabase password
 * rotation (credential incident) and stayed.
 */
export function assertNotProductionDatabase(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const marker = productionDatabaseMarker(env);
  if (!marker) return; // local/dev DB — fine
  if (env.NODE_ENV === 'production') return; // the genuine prod deploy
  if (env.CONFIRM_PROD_DB === '1') return; // deliberate, eyes-open opt-in
  throw new Error(
    `BOOT REFUSED — DATABASE_URL points at the PRODUCTION database (${marker}) but ` +
      `this is not a production process (NODE_ENV=${env.NODE_ENV ?? 'unset'}). A ` +
      `local/dev boot must never touch prod: a write test, a seed, or a migration ` +
      `would hit real user data. Point DATABASE_URL at a local database, or set ` +
      `CONFIRM_PROD_DB=1 to override deliberately (read-only intent only).`,
  );
}
