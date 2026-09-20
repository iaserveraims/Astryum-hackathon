'use client';

/**
 * The ONE authority list the shell reads (ADR-009): every surface that asks
 * "who am I operating as?" consumes this hook, so the switcher, the context
 * bar and the pages can never disagree.
 *
 * Composition:
 *   - overview        — every simple wallet aggregated (today's dashboard).
 *   - single          — one row per wallet from useMyWallets.
 *   - governed        — the councils: the backend registry (/governed-accounts,
 *                       portable across devices) plus the connected XRPL wallet
 *                       when the ledger says it is itself a council.
 * Governed state (council, quorum, health) is read fresh from the ledger and
 * only cached in-memory for a minute — Astryum stores pointers, never state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMyWallets } from './useMyWallets';
import { useAuthorityStore } from '@/stores/authorityStore';
import { useXrplWalletPartner } from '@/lib/wallet/useXrplWalletPartner';
import { hasAuthToken } from '@/lib/authError';
import {
  councilProposalsApi,
  governedAccountsApi,
  xrplLegacy,
  type GovernedAccountRecord,
} from '@/services/v1Api';
import {
  LEGACY_LOCAL_CHANGED_EVENT,
  claimLegacyLocalOwner,
  getLegacyNickname,
  readObservedLegacies,
} from '@/components/legacy/legacyLocal';
import { readPersonalQuorumMarks, staysPersonal } from '@/lib/authority/personalQuorum';
import { useWalletStore } from '@/stores/walletStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode, openLegacyComingSoon } from '@/lib/demoMode';
import {
  OVERVIEW_AUTHORITY_ID,
  addressKey,
  governedAuthorityId,
  isGoverned,
  walletAuthorityId,
  type Authority,
  type GovernedAuthority,
  type GovernedLedgerRead,
  type OverviewAuthority,
} from '@/lib/authority';
import { countProposals, type ProposalCounts } from '@/lib/authority/proposalCounts';
import { isAddressRemoved } from '@/lib/wallet/removedAddresses';
import { keepCandidate } from '@/lib/authority/candidateVisibility';

const OVERVIEW: OverviewAuthority = { id: OVERVIEW_AUTHORITY_ID, kind: 'overview' };

// Continuous sync: legacyLocal is the wizard's LOCAL write-buffer (opening a
// Legacy remembers it on-device); the registry is the portable source the
// switcher reads. Every registry load drains local pointers the registry
// doesn't know yet (idempotent upserts) — localStorage is never deleted, so
// the wizard's readers keep working and the two lists can never diverge.
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

async function syncLocalPointers(known: Set<string>): Promise<boolean> {
  try {
    const missing = readObservedLegacies().filter(
      (a) =>
        XRPL_ADDRESS_RE.test(a) &&
        !known.has(a) &&
        // LO QUE EL USUARIO QUITÓ NO SE VUELVE A DAR DE ALTA (fundador
        // 2026-09-13: «la firma y demás funciona, pero no se borra la wallet,
        // no desaparece de la account»). Este volcado era el camino que lo
        // resucitaba: se borraba la fila Y la entrada del registro, y la
        // siguiente carga del registro volvía a crearla desde el puntero
        // local. El comentario de arriba lo decía sin darse cuenta —
        // «localStorage nunca se borra» es un diseño que da por hecho que
        // nadie quita nada.
        !isAddressRemoved(a),
    );
    if (missing.length === 0) return false;
    await Promise.allSettled(
      missing.map((a) => governedAccountsApi.add(a, getLegacyNickname(a) ?? undefined)),
    );
    return true;
  } catch {
    return false; // offline — retried on the next load
  }
}

// Module-scoped caches (useMyWallets pattern): survive navigation, cleared on
// logout via invalidateAuthorityCache.
let registryCache: GovernedAccountRecord[] | null = null;
// In-flight dedupe + freshness window for the registry (portfolioStore's
// `inflight` pattern): every mounted instance used to fire its own
// governedAccountsApi.list() on mount. One load (list + drain + relist) now
// serves all concurrent instances, and a mount within REGISTRY_FRESH_MS of the
// last completed load skips the revalidate. reload() and the wizard's local
// writes bypass both (force).
const REGISTRY_FRESH_MS = 30_000;
let registryFetchedAt = 0;
let registryInflight: Promise<GovernedAccountRecord[]> | null = null;
const ledgerCache = new Map<string, { at: number; read: GovernedLedgerRead }>();
const LEDGER_TTL_MS = 60_000;
// Un ERROR cacheado 60s clavaba la mala clasificación un minuto entero: la
// wallet seguía en Personal aunque la red ya se hubiera recuperado. Un error
// vale 10s — lo justo para no re-disparar en tormenta, no para fosilizarse.
const LEDGER_ERROR_TTL_MS = 10_000;
function ledgerEntryFresh(entry: { at: number; read: GovernedLedgerRead }, now: number): boolean {
  return now - entry.at < (entry.read.error ? LEDGER_ERROR_TTL_MS : LEDGER_TTL_MS);
}

const proposalCountsCache = new Map<string, { at: number; counts: ProposalCounts }>();

// The result caches above are written only AFTER resolving, so N instances
// mounting together used to fire N identical reads before any entry existed.
// These maps cache the PROMISE at fire time so concurrent mounts share one
// read; a settled/rejected read drops its entry so the next mount can retry.
const ledgerInflight = new Map<string, Promise<GovernedLedgerRead>>();
const proposalCountsInflight = new Map<string, Promise<ProposalCounts>>();
/** Fase 2 en vuelo por dirección — un detalle de rehearsal a la vez. */
const detailInflight = new Map<string, Promise<void>>();

export function invalidateAuthorityCache(): void {
  registryCache = null;
  registryFetchedAt = 0;
  registryInflight = null;
  ledgerCache.clear();
  ledgerInflight.clear();
  proposalCountsCache.clear();
  proposalCountsInflight.clear();
}

function loadRegistry(force: boolean): Promise<GovernedAccountRecord[]> {
  if (!force && registryInflight) return registryInflight;
  const run = (async () => {
    // Ownership gate (2026-08-11): the local write-buffer belongs to ONE
    // signed-in user. Claim it BEFORE reading pointers — a user switch wipes
    // the previous user's pointers here, before the drain below could write
    // them into this user's registry. No resolved user ⇒ no drain at all.
    const userId = useAuthStore.getState().user?.id;
    if (userId) claimLegacyLocalOwner(userId);
    let { accounts } = await governedAccountsApi.list();
    const drained = userId
      ? await syncLocalPointers(new Set(accounts.map((a) => a.address)))
      : false;
    if (drained) ({ accounts } = await governedAccountsApi.list());
    registryCache = accounts;
    registryFetchedAt = Date.now();
    return accounts;
  })().finally(() => {
    if (registryInflight === run) registryInflight = null;
  });
  registryInflight = run;
  return run;
}

// LO BARATO DECIDE, LO CARO SOLO PARA CONSEJOS (fundador 2026-09-12: «va muy
// lento con lo de cargar la info de las wallets en home»). `council` es UN
// account_objects; `rehearsal-status` arrastra ADEMÁS un account_tx con el
// historial ENTERO (actividad de firmantes). Con N wallets enlazadas
// leyéndose a la vez, pagar N escaneos de historial para contestar «no tiene
// consejo» era el atasco — y el atasco tiraba lecturas, y una lectura caída
// clasificaba mal en silencio. Sin SignerList no hay rehearsal que evaluar.
// FASE 1 — la que CLASIFICA: un solo account_objects. hasCouncil, quórum y
// firmantes salen de aquí; nadie espera al historial para saber en qué
// estante vive una cuenta (fundador 2026-09-13: con 4 consejos, los
// escaneos en serie dejaban la pantalla «leyendo 8/17» y media flota sin
// clasificar durante minutos).
async function readCouncilFast(address: string): Promise<GovernedLedgerRead> {
  try {
    const cou = await xrplLegacy.council(address);
    const signers = cou?.council?.signers;
    if (!signers || signers.length === 0) {
      return { loading: false, hasCouncil: false, memberCount: 0 };
    }
    return {
      loading: false,
      hasCouncil: true,
      memberCount: signers.length,
      quorum: cou.council?.quorum,
      signers,
    };
  } catch (e) {
    return { loading: false, error: (e as Error).message };
  }
}

// FASE 2 — el DETALLE de un consejo confirmado (status/health del rehearsal,
// que arrastra el account_tx del historial): llega en segundo plano y se
// FUNDE sobre la fase 1. Solo la pagan los consejos, y sin bloquear a nadie.
async function readRehearsalDetail(address: string, base: GovernedLedgerRead): Promise<GovernedLedgerRead | null> {
  try {
    const reh = await xrplLegacy.rehearsalStatus(address);
    return {
      ...base,
      hasCouncil: reh.status.hasCouncil,
      memberCount: reh.status.memberCount,
      status: reh.status,
      health: reh.health,
    };
  } catch {
    return null; // el detalle no llegó — la fase 1 sigue siendo verdad
  }
}

// El grifo de lecturas (2026-09-12): como mucho CUATRO lecturas de ledger en
// vuelo. La ráfaga de N a la vez peleaba consigo misma y con el portfolio por
// el mismo lector XRPL del backend; goteando, cada una llega antes y ninguna
// se cae por saturación propia.
const LEDGER_MAX_CONCURRENT = 4;
let ledgerSlots = 0;
const ledgerWaiters: Array<() => void> = [];
async function withLedgerSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (ledgerSlots >= LEDGER_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => ledgerWaiters.push(resolve));
  }
  ledgerSlots += 1;
  try {
    return await fn();
  } finally {
    ledgerSlots -= 1;
    ledgerWaiters.shift()?.();
  }
}

/**
 * prosa-y-lectores — FOLD ONE ACCOUNT'S COUNTS IN WITHOUT SPEAKING FOR THE REST.
 *
 * The proposals read is per-account now (see the effect below), so the record
 * is built incrementally. Spreading `next` OVER `prev` keeps every account that
 * has already been read and adds the one that just arrived — and, crucially,
 * says NOTHING about an account whose read failed or was refused: it simply has
 * no key, and `pendingSignatures`/`liveProposals` stay `undefined`, which is
 * the value the surfaces already treat as "not known yet". A merge that seeded
 * missing accounts with 0 would be the same lie the bulk read used to tell.
 *
 * Exported so the rule can be executed by a test without mounting the hook.
 */
export function mergeProposalCounts(prev: ProposalCounts | null, next: ProposalCounts): ProposalCounts {
  return {
    pendingForMe: { ...(prev?.pendingForMe ?? {}), ...next.pendingForMe },
    live: { ...(prev?.live ?? {}), ...next.live },
  };
}

interface GovernedCandidate {
  address: string;
  source: 'connected' | 'registered';
  registryId?: string;
  label?: string;
}

export function useAuthorities(): {
  authorities: Authority[];
  /** Every governed candidate INCLUDING the connected wallet when it is not
   *  (yet) a council — MyLegaciesList renders this raw list; the switcher's
   *  `authorities` hides connected non-councils (they already have their
   *  simple row). */
  governedCandidates: GovernedAuthority[];
  /** The subset of `governedCandidates` that are actually LEGACIES: a
   *  confirmed council, or an account the user deliberately registered. This
   *  is what "My Legacies" renders — a wallet that is merely connected (and is
   *  only a MEMBER of someone else's council) never belongs there. */
  legacies: GovernedAuthority[];
  active: Authority;
  /** The active authority when it is governed, else null — the context bar,
   *  theme and governed-only surfaces key off this. */
  activeGoverned: GovernedAuthority | null;
  setActive: (id: string) => void;
  loading: boolean;
  reload: () => void;
} {
  const { wallets, loading: walletsLoading } = useMyWallets();
  const { address: xrplConnected } = useXrplWalletPartner();
  const activeAuthorityId = useAuthorityStore((s) => s.activeAuthorityId);
  const setActiveId = useAuthorityStore((s) => s.setActiveAuthority);
  const walletStoreWallets = useWalletStore((s) => s.wallets);
  const setActiveWallet = useWalletStore((s) => s.setActiveWallet);

  // Selecting a simple authority also steps walletStore.activeWallet — the
  // signing hooks (useXrplWalletPartner) follow that primitive, so the wallet
  // that signs is always the wallet the switcher says you are (toggle-line
  // unification, kept through the merge).
  const setActive = useCallback(
    (id: string) => {
      // Gated Legacy: any governed selection (switcher row, Summary toggle,
      // Legacy list) opens the coming-soon popup instead of switching. One
      // interception point covers them all. Demo accounts get the showcase
      // copy; real beta accounts without access (LEGACY_ENABLED off and not
      // on LEGACY_ACCESS_EMAILS) get the in-development copy.
      if (id.startsWith('governed:')) {
        if (isDemoMode()) {
          openLegacyComingSoon();
          return;
        }
        if (!useAuthStore.getState().legacyAccess) {
          openLegacyComingSoon('beta');
          return;
        }
      }
      setActiveId(id);
      if (id.startsWith('wallet:')) {
        const key = id.slice('wallet:'.length);
        const match = walletStoreWallets.find(
          (w) => w.address === key || w.address.toLowerCase() === key,
        );
        if (match) setActiveWallet(match);
      }
    },
    [setActiveId, walletStoreWallets, setActiveWallet],
  );

  const [registry, setRegistry] = useState<GovernedAccountRecord[]>(() => registryCache ?? []);
  const [registryLoading, setRegistryLoading] = useState(() => registryCache === null);
  const [ledger, setLedger] = useState<Record<string, GovernedLedgerRead>>({});
  const [nonce, setNonce] = useState(0);
  // reload() and the wizard's local writes must ALWAYS hit the network — they
  // bypass the registry freshness window and the in-flight dedupe (force).
  const forceRef = useRef(false);

  // Registry load, draining any local wizard pointers the registry misses.
  useEffect(() => {
    if (!hasAuthToken()) {
      setRegistryLoading(false);
      return;
    }
    const force = forceRef.current;
    forceRef.current = false;
    // Fresh enough and nothing in flight → keep the cached paint, skip the
    // revalidate for this mount.
    if (
      !force &&
      registryInflight === null &&
      registryCache !== null &&
      Date.now() - registryFetchedAt < REGISTRY_FRESH_MS
    ) {
      setRegistry(registryCache);
      setRegistryLoading(false);
      return;
    }
    let alive = true;
    if (registryCache === null) setRegistryLoading(true);
    loadRegistry(force)
      .then((accounts) => {
        if (alive) setRegistry(accounts);
      })
      .catch(() => {
        /* offline / 401 — keep whatever we had; governed entries just miss */
      })
      .finally(() => {
        if (alive) setRegistryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  // The wizard's local writes (remember/nickname) announce themselves — re-run
  // the load so new pointers drain into the registry and repaint everywhere.
  useEffect(() => {
    const onLocalChange = () => {
      registryCache = null;
      forceRef.current = true;
      setNonce((n) => n + 1);
    };
    window.addEventListener(LEGACY_LOCAL_CHANGED_EVENT, onLocalChange);
    return () => window.removeEventListener(LEGACY_LOCAL_CHANGED_EVENT, onLocalChange);
  }, []);

  // E2 third state: the owner's "this council is my PERSONAL quorum" marks.
  // Same change event as the legacy pointers, so marking re-classifies live.
  const [pqMarks, setPqMarks] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readPersonalQuorumMarks(),
  );
  useEffect(() => {
    const onLocalChange = () => setPqMarks(readPersonalQuorumMarks());
    window.addEventListener(LEGACY_LOCAL_CHANGED_EVENT, onLocalChange);
    return () => window.removeEventListener(LEGACY_LOCAL_CHANGED_EVENT, onLocalChange);
  }, []);
  const pqKeys = useMemo(() => new Set(pqMarks.map(addressKey)), [pqMarks]);

  const candidates = useMemo<GovernedCandidate[]>(() => {
    const out: GovernedCandidate[] = [];
    if (xrplConnected) {
      // The connected wallet may ALSO be a registered pointer. Carry its
      // registry identity so rename/remove work on it, and so `legacies` can
      // tell a DELIBERATE pointer from a wallet that merely happens to be
      // connected (the rNaFf case: a council MEMBER, not a Legacy).
      const reg = registry.find((r) => r.address === xrplConnected);
      out.push({
        address: xrplConnected,
        source: 'connected',
        registryId: reg?.id,
        label: reg?.label ?? undefined,
      });
    }
    for (const r of registry) {
      if (!out.some((c) => c.address === r.address)) {
        out.push({ address: r.address, source: 'registered', registryId: r.id, label: r.label ?? undefined });
      }
    }
    // LA WALLET ENLAZADA TAMBIÉN ES CANDIDATA (fundador 2026-09-12: «he
    // conectado 12 wallets y todas me las detecta como personales» — 3 eran
    // consejos con SignerList en el ledger). El default del 2026-07-18 dice
    // que una cuenta que el ledger confirma como consejo opera como Legacy
    // salvo marca personal — pero los candidatos eran solo la CONECTADA y los
    // punteros del registro, así que un consejo ENLAZADO en Wallets (nunca
    // abierto por el wizard en ESTE navegador → sin puntero local que drenar)
    // caía al lado personal con corona de quórum, o a personal a secas si la
    // lectura no llegaba. Enlazar es un acto tan deliberado como registrar:
    // sus consejos confirmados clasifican como Legacy en TODAS las
    // superficies. `source: 'connected'` a propósito — el filtro de
    // `authorities`/`legacies` ya esconde a esta fuente hasta que el ledger
    // confirma, que es exactamente lo que una wallet personal necesita.
    for (const w of wallets) {
      const a = w.address;
      if (typeof a === 'string' && XRPL_ADDRESS_RE.test(a) && !out.some((c) => c.address === a)) {
        out.push({ address: a, source: 'connected' });
      }
    }
    // LA MARCA LOCAL NO CONTRADICE AL SERVIDOR (fundador 2026-09-14: el mismo
    // Legacy, activo en el registro, se veía en el preview y no en producción
    // — su navegador de producción lo tenía marcado como «quitado»). La marca
    // del sábado frena los caminos AUTOMÁTICOS que resucitan una dirección
    // (el volcado de punteros, la sesión conectada, la wallet enlazada); no
    // esconde lo que el registro tiene activo. Una cuenta del registro se
    // quita quitándola —el servidor la marca retirada y desaparece en todos
    // los navegadores—, no escondiéndola en uno. Regla en
    // lib/authority/candidateVisibility.
    return out.filter((c) => keepCandidate(c, isAddressRemoved));
  }, [xrplConnected, registry, wallets]);

  // Ledger enrichment per candidate — fresh reads, minute-cached in memory.
  //
  // TODA wallet XRPL de la lista se lee, no sólo las MARCADAS (fundador,
  // 22-ago-2026: «me pide sólo un puto QR»).
  //
  // EL FALLO QUE CIERRA. Los candidatos son la cuenta CONECTADA y los punteros
  // del registro. Una cuenta personal reforzada no es ninguna de las dos: está
  // en las wallets del usuario, y —esto es lo importante— NO PUEDE conectarse,
  // porque la ceremonia le deshabilita la llave maestra. Así que su SignerList
  // no se leía jamás, `hardenedQuorum` quedaba vacío, y el envío caía al camino
  // de firma única: un QR sobre una cuenta que sólo puede multifirmar.
  //
  // Antes esto dependía de una marca en `localStorage`. Una marca no es una
  // fuente de verdad: no viaja entre navegadores ni dispositivos, y aquí la
  // pregunta —«¿esta cuenta tiene quórum?»— la contesta la CADENA. La marca se
  // queda para lo único que la cadena no puede decir: de qué lado vive.
  const walletLedgerReads = useMemo<GovernedCandidate[]>(
    () =>
      wallets
        .map((w) => w.address)
        .filter((a) => typeof a === 'string' && a.startsWith('r'))
        .filter((a) => !candidates.some((c) => c.address === a))
        .map((a) => ({ address: a, source: 'connected' as const })),
    [wallets, candidates],
  );
  const enriched = useMemo(() => [...candidates, ...walletLedgerReads], [candidates, walletLedgerReads]);
  const candidatesKey = enriched.map((c) => c.address).join(',');
  // REINTENTO ACOTADO (2026-09-12): una lectura fallida solo se relanzaba al
  // navegar (el efecto no re-corre cuando caduca el TTL del error), así que un
  // fallo puntual dejaba un consejo clavado en Personal toda la visita. Si
  // alguna lectura acaba en error, se agenda UNA pasada más cuando el error
  // caduque — hasta 3 por montaje, jamás una tormenta.
  const [ledgerRetryNonce, setLedgerRetryNonce] = useState(0);
  const ledgerRetryAttempts = useRef(0);
  const ledgerRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    for (const c of enriched) {
      const cached = ledgerCache.get(c.address);
      if (cached && ledgerEntryFresh(cached, now)) {
        setLedger((l) => (l[c.address] === cached.read ? l : { ...l, [c.address]: cached.read }));
        continue;
      }
      setLedger((l) => ({ ...l, [c.address]: { ...(l[c.address] ?? {}), loading: true } }));
      // Share ONE in-flight read per address across every mounted instance
      // (readLedger never rejects — errors come back as an error read).
      let read = ledgerInflight.get(c.address);
      if (!read) {
        const started = withLedgerSlot(() => readCouncilFast(c.address)).then((r) => {
          // CLASIFICACIÓN PEGAJOSA (fundador 2026-09-13: «se me acaba de
          // bugear y han desaparecido los legacy»): un consejo confirmado no
          // deja de serlo porque UNA lectura falle. Un error jamás PISA una
          // lectura buena — se conservan los datos buenos y se anota el error
          // encima: el TTL corto y el reintento salen solos de ese campo, y
          // la UI no parpadea (hasCouncil sigue diciendo lo último sabido).
          const prev = ledgerCache.get(c.address)?.read;
          const keep = r.error && prev && !prev.error ? { ...prev, error: r.error } : r;
          ledgerCache.set(c.address, { at: Date.now(), read: keep });
          if (ledgerInflight.get(c.address) === started) ledgerInflight.delete(c.address);
          return keep;
        });
        ledgerInflight.set(c.address, started);
        read = started;
      }
      void read.then((r) => {
        if (!alive) return;
        setLedger((l) => ({ ...l, [c.address]: r }));
        if (r.error && ledgerRetryAttempts.current < 3 && ledgerRetryTimer.current === null) {
          ledgerRetryTimer.current = setTimeout(() => {
            ledgerRetryTimer.current = null;
            ledgerRetryAttempts.current += 1;
            setLedgerRetryNonce((n) => n + 1);
          }, LEDGER_ERROR_TTL_MS + 500);
        }
        // FASE 2 — el detalle del consejo confirmado, en segundo plano y
        // deduplicado. Si aterriza tras un desmontaje, la caché lo guarda y
        // el siguiente render lo pinta.
        if (r.hasCouncil === true && !r.status && !detailInflight.has(c.address)) {
          const detail = withLedgerSlot(() => readRehearsalDetail(c.address, r)).then((full) => {
            detailInflight.delete(c.address);
            if (!full) return;
            ledgerCache.set(c.address, { at: Date.now(), read: full });
            if (alive) setLedger((l) => ({ ...l, [c.address]: full }));
          });
          detailInflight.set(c.address, detail);
        }
      });
    }
    return () => {
      alive = false;
      if (ledgerRetryTimer.current !== null) {
        clearTimeout(ledgerRetryTimer.current);
        ledgerRetryTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesKey, nonce, ledgerRetryNonce]);

  // ONE proposals read PER ACCOUNT, two facts (countProposals): "your signature
  // is due" (pendingForMe) and "decisions in flight" (live). undefined until a
  // real read exists (never fabricated). Same per-address cache + in-flight
  // pattern as the ledger reads above.
  //
  // prosa-y-lectores — WHY THIS IS NO LONGER ONE BULK CALL. It used to ask
  // `list(candidates, true)` for every candidate at once, and the candidates
  // are the connected wallet PLUS the self-asserted `GovernedAccount` pointers
  // (`POST /governed-accounts` takes any r-address with no proof). The round-4
  // permission floor refuses that whole listing with 403 NOT_A_COUNCIL_MEMBER
  // when NONE of the returned rows is this session's — so one pointer at an
  // account the server does not tie to this user took down the read for every
  // authority in the list, and the `.catch` below said nothing: every "your
  // signature is due" badge silently vanished while the proposals it was
  // counting kept running toward their seven-day deadline. The 403 is the
  // easiest thing in the world to earn — an XRP-Identity session whose Xaman
  // was never registered earns it on its own Legacy.
  //
  // It also removed a smaller lie of the same family: on a MIXED listing the
  // server returns only the readable rows and never says which accounts it
  // withheld, while `countProposals` seeds every account it is handed with 0 —
  // so a withheld account was counted as "nothing in flight". Handing it one
  // account at a time means an account we could not read is simply ABSENT from
  // the record (undefined = unknown), never a fabricated zero.
  const [proposalCounts, setProposalCounts] = useState<ProposalCounts | null>(null);
  /**
   * it. 27 (6): QUÉ CUENTAS SE INTENTARON LEER Y NO SE PUDIERON. `proposalCounts`
   * distingue «leído» de «ausente», pero no distingue las DOS ausencias: todavía
   * no leída, y leída y fallada. Sin esa diferencia la insignia no puede pintar
   * «desconocido» y acaba pareciendo un cero. No sustituye a ningún recuento: solo
   * dice que hubo un intento y que no salió.
   */
  const [proposalsUnread, setProposalsUnread] = useState<Record<string, true>>({});
  const myXrplKey = useMemo(
    () =>
      wallets
        .map((w) => w.address)
        .filter((a) => a.startsWith('r'))
        .concat(xrplConnected ? [xrplConnected] : [])
        .join(','),
    [wallets, xrplConnected],
  );
  // Con las wallets ENLAZADAS ahora en `candidates` (2026-09-12), la lectura
  // de propuestas se acota a lo que puede tenerlas: un puntero del registro
  // (intención deliberada, se lee desde el primer render, como siempre) o una
  // cuenta que el ledger YA confirmó como consejo. Sin el corte, cada wallet
  // personal enlazada dispararía su propia lectura para ganarse un 403.
  const proposalAccountsKey = useMemo(
    () =>
      candidates
        .filter((c) => !!c.registryId || ledger[c.address]?.hasCouncil === true)
        .map((c) => c.address)
        .join(','),
    [candidates, ledger],
  );
  useEffect(() => {
    const accounts = proposalAccountsKey.split(',').filter(Boolean);
    if (accounts.length === 0 || !hasAuthToken()) return;
    let alive = true;
    const mine = new Set(myXrplKey.split(',').filter(Boolean));
    for (const address of accounts) {
      // Keyed per ACCOUNT, so one refused account can neither poison nor
      // invalidate the others' cached counts.
      const cacheKey = `${address}|${myXrplKey}`;
      const cached = proposalCountsCache.get(cacheKey);
      if (cached && Date.now() - cached.at < LEDGER_TTL_MS) {
        setProposalCounts((prev) => mergeProposalCounts(prev, cached.counts));
        continue;
      }
      // Share ONE in-flight read per cacheKey (same fix as the ledger reads: the
      // result cache was only written after resolving, so simultaneous mounts
      // fired N identical reads). A rejection drops the entry to allow retry.
      let read = proposalCountsInflight.get(cacheKey);
      if (!read) {
        const started = councilProposalsApi
          .list([address], true)
          .then(({ proposals, unreadable }) => {
            /**
             * productizer it. 25 (1) — UN RECUENTO SOBRE UNA LECTURA A MEDIAS ES UN
             * NÚMERO FALSO.
             *
             * it. 23 hizo que las filas que el servidor no pudo decidir viajasen en
             * `unreadable[]` dentro del 200. Este contador las ignoraba y publicaba
             * «2 pendientes» sobre una bandeja de la que faltaba una fila — una
             * afirmación que nadie leyó, exactamente igual que el 0 que el `catch` de
             * abajo se niega a escribir. Con filas ilegibles la insignia se queda
             * DESCONOCIDA (undefined), que es lo único honesto, y no se cachea: la
             * siguiente vuelta puede leerlas.
             */
            if (Array.isArray(unreadable) && unreadable.length > 0) {
              throw Object.assign(new Error('COUNCIL_LISTING_PARTIAL'), {
                body: { error: 'COUNCIL_LISTING_PARTIAL', detail: unreadable },
              });
            }
            const counts = countProposals(proposals, [address], mine);
            proposalCountsCache.set(cacheKey, { at: Date.now(), counts });
            return counts;
          })
          .finally(() => {
            if (proposalCountsInflight.get(cacheKey) === started) proposalCountsInflight.delete(cacheKey);
          });
        proposalCountsInflight.set(cacheKey, started);
        read = started;
      }
      void read
        .then((counts) => {
          if (!alive) return;
          setProposalCounts((prev) => mergeProposalCounts(prev, counts));
          // Una lectura que SÍ ocurrió es la única que puede retirar la marca.
          setProposalsUnread((prev) => {
            if (!prev[address]) return prev;
            const next = { ...prev };
            delete next[address];
            return next;
          });
        })
        .catch(() => {
          // Refused or unavailable: this ONE account keeps no entry, so its
          // badges stay UNKNOWN (undefined) rather than being answered with a
          // zero we never read. Its siblings are untouched.
          //
          // it. 27 (6): y ahora se MARCA, porque un `undefined` silencioso se
          // pintaba igual que un cero leído. La marca no afirma cuántas hay — dice
          // que lo intentamos y no pudimos, que es lo único que sabemos.
          if (alive) setProposalsUnread((prev) => (prev[address] ? prev : { ...prev, [address]: true }));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalAccountsKey, myXrplKey, nonce]);

  const governedCandidates = useMemo<GovernedAuthority[]>(
    () =>
      candidates.map((c) => {
        const read = ledger[c.address] ?? { loading: true };
        return {
          id: governedAuthorityId(c.address),
          kind: 'governed',
          ecosystem: 'xrpl',
          address: c.address,
          label: c.label,
          registryId: c.registryId,
          source: c.source,
          pendingSignatures: proposalCounts?.pendingForMe[c.address],
          liveProposals: proposalCounts?.live[c.address],
          // it. 27 (6): solo cuando de verdad se intentó y falló — jamás mientras
          // la primera lectura sigue en vuelo.
          proposalsUnread: proposalsUnread[c.address] === true,
          ...read,
        } satisfies GovernedAuthority;
      }),
    [candidates, ledger, proposalCounts, proposalsUnread],
  );

  // "My Legacies" is a list of LEGACIES, not of accounts that happen to be in
  // scope (founder 2026-07-28). A connected wallet shows there only once the
  // ledger CONFIRMS it is a council, or when the user deliberately pointed at
  // it (a registry entry). Without this, every signer sees their own member
  // account listed as if it were a Legacy it merely helps govern.
  // E2: an account its owner MARKED as a personal quorum is not a Legacy
  // either — unless they also filed it in the registry (the stronger intent).
  const legacies = useMemo<GovernedAuthority[]>(
    () =>
      governedCandidates
        .filter((g) => g.hasCouncil === true || !!g.registryId)
        .filter((g) => !staysPersonal({ marked: pqKeys.has(addressKey(g.address)), registryId: g.registryId })),
    [governedCandidates, pqKeys],
  );

  const authorities = useMemo<Authority[]>(() => {
    // A wallet the ledger confirms as a COUNCIL is not a personal wallet
    // (founder 2026-07-18): it leaves the simples entirely and lives only
    // inside its Legacy on the governed side. E2 third state: unless its
    // owner marked it as a PERSONAL quorum — then it stays a simple wallet
    // and carries its ledger-read quorum (kind single, authority quorum).
    // EL REGISTRO GANA A LA MARCA (fundador 2026-09-13: cuatro consejos
    // clavados en Personal con corona y el estante Legacy VACÍO en su
    // entorno). La regla escrita de staysPersonal siempre lo dijo —
    // «archivarlo en el registro es la intención más fuerte» — pero esta
    // clasificación llamaba a la regla SIN el registryId, así que una cuenta
    // marcada Y archivada como Legacy (lo normal tras semanas de gobernarla)
    // se quedaba en Personal contra la doctrina. El arnés no lo cazó porque
    // simulaba el registro vacío; el entorno real lo tiene poblado.
    const councilKeys = new Set(
      governedCandidates
        .filter(
          (g) =>
            g.hasCouncil === true &&
            !staysPersonal({ marked: pqKeys.has(addressKey(g.address)), registryId: g.registryId }),
        )
        .map((g) => addressKey(g.address)),
    );
    const singles: Authority[] = wallets
      .filter((w) => !councilKeys.has(addressKey(w.address)))
      .map((w) => {
        // La lectura del LEDGER, sin pedirle permiso a la marca (22-ago-2026).
        // Antes esto era `pqKeys.has(...) ? ledger[...] : undefined`, así que
        // una cuenta reforzada sin marca en ESTE navegador se pintaba como si
        // firmara sola — y su envío pedía una firma que la red rechaza. Si una
        // wallet que sigue en el lado personal tiene SignerList, tiene quórum:
        // eso no lo decide una marca local, lo decide la cadena.
        const read = ledger[w.address];
        return {
          id: walletAuthorityId(w.address),
          kind: 'single' as const,
          wallet: w,
          // Sólo una SignerList CONFIRMADA pinta: nunca una marca sola, nunca
          // una lectura en vuelo (`loading`), nunca un error de red.
          ...(read?.hasCouncil === true ? { hardenedQuorum: read } : {}),
        };
      });
    // A connected wallet only shows as governed once the ledger confirms it IS
    // a council (before that it still has its simple row). Registered pointers
    // stay visible in every state — the user placed them on purpose. Marked
    // personal quorums never show here: their row is their simple wallet.
    const governed = governedCandidates.filter(
      (g) =>
        !(g.source === 'connected' && g.hasCouncil !== true) &&
        !staysPersonal({ marked: pqKeys.has(addressKey(g.address)), registryId: g.registryId }),
    );
    return [OVERVIEW, ...singles, ...governed];
  }, [wallets, governedCandidates, pqKeys, ledger]);

  // A stale persisted id (removed wallet, un-observed council) degrades to the
  // overview — never operate a ghost account. The stored id is left alone so a
  // slow load doesn't wipe a valid selection.
  let active: Authority = authorities.find((a) => a.id === activeAuthorityId) ?? OVERVIEW;
  // Transient-gap guard (bug 2026-07-21: "el fondo se queda en blur"): reload()
  // clears the ledger cache, so a CONNECTED council loses its hasCouncil
  // confirmation for a beat and gets filtered out of `authorities` — the
  // active authority fell to OVERVIEW for one render and AppShell fired a
  // spurious Personal↔Legacy crossing (2.2s wash) in each direction. While
  // the read is merely PENDING (hasCouncil unknown, not false) keep operating
  // the candidate; only a confirmed non-council or a truly removed entry
  // degrades to the overview.
  if (!isGoverned(active) && activeAuthorityId?.startsWith('governed:')) {
    const pendingConfirm = governedCandidates.find(
      (g) => g.id === activeAuthorityId && g.source === 'connected' && g.hasCouncil !== false,
    );
    if (pendingConfirm) active = pendingConfirm;
  }

  return {
    authorities,
    governedCandidates,
    legacies,
    active,
    activeGoverned: isGoverned(active) ? active : null,
    setActive,
    loading: walletsLoading || registryLoading,
    reload: useCallback(() => {
      registryCache = null;
      ledgerCache.clear();
      forceRef.current = true;
      setNonce((n) => n + 1);
    }, []),
  };
}
