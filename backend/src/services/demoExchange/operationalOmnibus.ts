/**
 * operationalOmnibus — the omnibus a RUN declares, as the 0xFE nonce-seat
 * guard's own list (productizer it. 16, R5 5.1).
 *
 * WHAT THIS FIXES. `buildDirectMintHandoff` refuses a hand-off against an
 * account Astryum operates unless the action is one of its own server flows (or
 * an exit prepared by a session that proved the account): otherwise any stranger
 * could compose against the omnibus and sit on the Personal Account's nonce
 * seat. That guard read ONE source — `attributionForSigner`, i.e. an
 * environment list — so `POST /runs` refused to create a run whose omnibus was
 * not in `ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS`. Nobody can edit a Railway variable
 * from the setup wizard, so the last station of the exchange sign-up died, and
 * the only workaround (adding the operator's account to the env list) ALSO made
 * it operational for SourceTag purposes, stripping the project tag off an
 * account that is not ours.
 *
 * WHAT REPLACES IT. The run DECLARES its omnibus when it is created. `POST
 * /runs` is admin-only, so the declaration IS the authorization — nothing else
 * is asked of the operator. This module turns those declarations into the async
 * predicate the builder consults ALONGSIDE `attributionForSigner`, so the seat
 * guard covers every run's omnibus with no environment variable at all.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never widens
 * `astryumOperationalXrplAccounts()`. A declared omnibus is the exchange's own
 * operational key for the desk's 0xFE — the desk, payout and autopilot paths
 * already pass `attribution: 'operational'` explicitly — but a transaction the
 * CLIENT signs (their deposit) keeps carrying the project SourceTag, as it
 * must: the tag attributes activity to its SIGNER, and the client is a real
 * user. Declaring an omnibus here changes the seat guard, never the tag.
 *
 * READING FAILURES NEVER INVENT. A database outage returns the last snapshot we
 * actually read (plus whatever this process registered by hand); it never
 * promotes an unknown account, and it never forgets one it already knew.
 *
 * ── productizer it. 19 (R1 1.4) — «NO PUDE LEER» YA NO REGALA EL ASIENTO ────
 * Hasta la it. 18 este módulo sabía distinguir «nunca leí las runs» de «leí y
 * esta cuenta no está» (`declaredOmnibusEverRead`) y aun así contestaba lo
 * mismo a las dos: `false`. Un proceso recién arrancado cuyo primer `listRuns`
 * fallara declaraba NO OPERATIVO el omnibus de la mesa, y con eso cualquier
 * sesión podía componer un 0xFE contra él y sentarse en el asiento de nonce de
 * su Personal Account — el asiento que esta guarda existe para proteger.
 *
 * Ahora el veredicto es TRIESTADO (`declaredRunOmnibusVerdict`):
 *   · 'yes'     — una run la declara (snapshot fresco o registro de este proceso).
 *   · 'no'      — SOLO con una lectura buena y reciente que no la contiene.
 *   · 'unknown' — nunca leímos, o la última lectura buena ya es demasiado vieja.
 *
 * Y ESO es lo que se le registra al constructor: su `OperationalAccountResolver`
 * admite `'unknown'` (contrato it. 19 del 0xFE), y lo trata como debe — una
 * ENTRADA ajena espera con `SEAT_STATE_UNREADABLE` («no puedo saberlo ahora»,
 * que es la verdad) y una SALIDA se compone igual, porque «no pude leer» jamás
 * es castigo sobre una salida. Nunca se contesta «no» de más: contestarlo sería
 * regalar el asiento del omnibus a cualquiera durante el apagón, y ese daño —con
 * el XRP del cliente ya en el Core Vault— no es reversible.
 *
 * También viaja `declaredOmnibusEverRead` como `ready`: con él, hasta un `false`
 * accidental de este módulo se lee como «no lo sé» mientras no haya habido una
 * lectura buena.
 *
 * La ventana de «unknown» se mantiene mínima: la instalación del resolver
 * CALIENTA la primera lectura, y cada consulta reintenta mientras no haya una
 * buena.
 */

import { listRuns } from './DemoExchangeStore';

/** How long a successful read of the runs is reused before the store is asked again. */
export const DECLARED_OMNIBUS_TTL_MS = 15_000;

/**
 * Past this, a snapshot we could not refresh stops counting as «what the runs
 * say»: a run declared elsewhere in those minutes would not be in it, so
 * answering «not an omnibus» from it could hand out a seat. 10 min is far longer
 * than the 15 s TTL — it only triggers on a sustained outage.
 */
export const DECLARED_OMNIBUS_STALE_MS = 10 * 60_000;

/** What this process can tell about one account. See the header for why 'unknown' reads as operational. */
export type DeclaredOmnibusVerdict = 'yes' | 'no' | 'unknown';

/** How current the knowledge is: never read at all, a good recent read, or a read too old to trust. */
export type DeclaredOmnibusReadState = 'never' | 'fresh' | 'stale';

/**
 * Accounts registered by hand in THIS process (a run created or updated a
 * moment ago). They close the window between `saveRun` and the next snapshot:
 * a run created at second 0 must be covered at second 0, not at second 15.
 *
 * The value is WHEN it was registered, so a successful snapshot can forget the
 * ones no run declares any more (it. 19, finding 3.5) without ever forgetting
 * one mid-flight: only an entry registered BEFORE that read started is pruned,
 * and only if the read — which would have seen its run — did not list it.
 */
const registered = new Map<string, number>();
/** The last snapshot the store actually served. `at = 0` → never read. */
let snapshot: { at: number; accounts: Set<string> } = { at: 0, accounts: new Set() };
let everRead = false;
let inflight: Promise<void> | null = null;

/** A run's omnibus is covered from the instant the run exists, not from the next snapshot. */
export function rememberDeclaredOmnibus(account: string | null | undefined, atMs = Date.now()): void {
  const a = String(account ?? '').trim();
  if (a) registered.set(a, atMs);
}

/** Test hook: forget every declaration and snapshot of this process. */
export function _resetDeclaredOmnibusForTests(): void {
  registered.clear();
  snapshot = { at: 0, accounts: new Set() };
  everRead = false;
  inflight = null;
}

async function refresh(nowMs: number): Promise<void> {
  if (inflight) return inflight;
  // Cuándo EMPEZÓ la lectura: una run declarada después de este instante puede
  // no estar en el resultado, así que su registro a mano no se poda.
  const startedAt = Date.now();
  inflight = (async () => {
    try {
      const runs = await listRuns();
      const accounts = new Set<string>();
      for (const r of runs) {
        const a = String(r.omnibusAddress ?? '').trim();
        if (a) accounts.add(a);
      }
      snapshot = { at: nowMs, accounts };
      everRead = true;
      // EL OLVIDO (finding 3.5): la cuenta de una run RETIRADA deja de ser
      // operativa. El snapshot ya se reconstruye entero desde el almacén; lo que
      // no se olvidaba era el registro a mano de este proceso, así que el
      // omnibus de una run borrada seguía bajo la guarda para siempre — y una
      // salida desde esa cuenta, sin prueba, recibía 403 eternamente.
      for (const [account, at] of [...registered]) {
        if (at <= startedAt && !accounts.has(account)) registered.delete(account);
      }
    } catch {
      // «No pude leer» no es «no existe»: se conserva el último snapshot bueno y
      // NO se sella la marca de tiempo, así que la próxima consulta reintenta.
      // Tampoco se poda nada: una lectura fallida no retira ninguna cuenta.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Every XRPL account a run declares as its omnibus, as far as this process can
 * tell. Stale before it is wrong: an unreadable store keeps the previous answer.
 */
export async function declaredRunOmnibusAccounts(nowMs = Date.now()): Promise<Set<string>> {
  if (nowMs - snapshot.at >= DECLARED_OMNIBUS_TTL_MS) await refresh(nowMs);
  const out = new Set(snapshot.accounts);
  for (const a of registered.keys()) out.add(a);
  return out;
}

/** Has any run ever been read? (false before the first successful snapshot.) */
export function declaredOmnibusEverRead(): boolean {
  return everRead;
}

/** How current this process's knowledge of the declarations is. */
export function declaredOmnibusReadState(nowMs = Date.now()): DeclaredOmnibusReadState {
  if (!everRead) return 'never';
  return nowMs - snapshot.at <= DECLARED_OMNIBUS_STALE_MS ? 'fresh' : 'stale';
}

/**
 * Re-read the declarations NOW, ignoring the TTL. Called right after a run is
 * deleted so a retired omnibus stops being operational within the same request
 * instead of at the next snapshot. Best-effort: a failed read changes nothing.
 */
export async function resyncDeclaredOmnibus(nowMs = Date.now()): Promise<void> {
  await refresh(nowMs);
}

/**
 * The tri-state answer. 'no' is said ONLY from a good, recent read that does not
 * contain the account — never from an outage and never from an empty process.
 */
export async function declaredRunOmnibusVerdict(account: string, nowMs = Date.now()): Promise<DeclaredOmnibusVerdict> {
  const a = String(account ?? '').trim();
  // Una cadena vacía no es una cuenta: no hay nada que proteger ni que dudar.
  if (!a) return 'no';
  if (registered.has(a)) return 'yes';
  if (nowMs - snapshot.at >= DECLARED_OMNIBUS_TTL_MS || !everRead) await refresh(nowMs);
  if (snapshot.accounts.has(a) || registered.has(a)) return 'yes';
  return declaredOmnibusReadState(nowMs) === 'fresh' ? 'no' : 'unknown';
}

/**
 * What the 0xFE builder's resolver returns: `true` / `false` / `'unknown'`.
 * `'unknown'` is NEVER collapsed to `false` — that is the whole point of 1.4.
 */
export async function declaredRunOmnibusForBuilder(account: string): Promise<boolean | 'unknown'> {
  try {
    const verdict = await declaredRunOmnibusVerdict(account);
    return verdict === 'yes' ? true : verdict === 'no' ? false : 'unknown';
  } catch {
    // Ni siquiera pudimos preguntarnos: eso es «no lo sé», jamás «no lo es».
    return 'unknown';
  }
}

/**
 * Plain boolean: does a run declare this account as its omnibus, as far as we
 * KNOW? `'unknown'` is not a yes — callers that need to tell «I could not read»
 * apart from «it is not one» must ask `declaredRunOmnibusVerdict`, which is
 * exactly what the builder's resolver does.
 */
export async function isDeclaredRunOmnibus(account: string): Promise<boolean> {
  try {
    return (await declaredRunOmnibusVerdict(account)) === 'yes';
  } catch {
    return false;
  }
}

/**
 * The seam with the 0xFE builder (it. 17, contrato C1):
 * `setOperationalAccountResolver` takes an async predicate consulted IN
 * ADDITION to `attributionForSigner`.
 *
 * The type is TAKEN FROM THE BUILDER (`typeof import`, erased at runtime), so
 * renaming or dropping that export fails the build here instead of leaving a
 * silent warning in production. `Partial` keeps the runtime guard honest: a
 * test that mocks the builder without the hook must not crash the router at
 * import time.
 */
type MintService = typeof import('../../connectors/protocols/flare/FlareDirectMintService');
type ResolverHost = Partial<Pick<MintService, 'setOperationalAccountResolver'>>;

let installed: 'yes' | 'no' | 'pending' = 'pending';
let installing: Promise<void> | null = null;

/** Whether the resolver actually reached the builder (diagnostics / tests). */
export function declaredOmnibusResolverInstalled(): 'yes' | 'no' | 'pending' {
  return installed;
}

/**
 * Register the declaration as the builder's extra operational-account source.
 * Called once when this router is mounted (startup) — from then on every run's
 * omnibus is covered by the nonce-seat guard without any environment list.
 */
export function registerRunOmnibusOperationalResolver(): Promise<void> {
  // CALENTAR SIEMPRE, instalar una vez. La instalación se memoiza (el router
  // puede importarse más de una vez y el constructor solo admite un resolver),
  // pero la primera LECTURA no puede quedar atrapada en esa memoización: es lo
  // que hace que «nunca leí las runs» dure lo que tarda el arranque y no lo que
  // tarda el primer prepare (it. 19, 1.4). Respeta el TTL: con un snapshot
  // fresco no relee nada.
  const install = installing ?? startInstall();
  return install.then(() => declaredRunOmnibusAccounts()).then(() => undefined);
}

function startInstall(): Promise<void> {
  installing = (async () => {
    try {
      const mod = (await import('../../connectors/protocols/flare/FlareDirectMintService')) as unknown as ResolverHost;
      if (typeof mod.setOperationalAccountResolver !== 'function') {
        installed = 'no';
        // eslint-disable-next-line no-console
        console.warn(
          '[demo-exchange] the 0xFE builder exposes no setOperationalAccountResolver — a run omnibus is covered by the nonce-seat guard only if it is also in the operational env list',
        );
        return;
      }
      // TRIESTADO (it. 19, R1 1.4): el constructor admite `'unknown'` y lo trata
      // como debe — una ENTRADA ajena espera, una SALIDA se compone igual. Nunca
      // se le contesta «no» sobre una cuenta que no hemos podido comprobar: eso
      // regalaría el asiento de nonce del omnibus durante un apagón de BD.
      // `ready` (`declaredOmnibusEverRead`) es el cinturón: hasta un `false`
      // accidental se lee como «no lo sé» mientras no haya una lectura buena.
      mod.setOperationalAccountResolver((account: string) => declaredRunOmnibusForBuilder(account), {
        ready: declaredOmnibusEverRead,
      });
      installed = 'yes';
    } catch (e) {
      installed = 'no';
      // eslint-disable-next-line no-console
      console.warn(`[demo-exchange] the run-omnibus seat resolver could not be registered: ${(e as Error).message.slice(0, 120)}`);
    }
  })();
  return installing;
}
