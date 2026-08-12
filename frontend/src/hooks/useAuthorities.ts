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
      (a) => XRPL_ADDRESS_RE.test(a) && !known.has(a),
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

const pendingSigCache = new Map<string, { at: number; counts: Record<string, number> }>();

// The result caches above are written only AFTER resolving, so N instances
// mounting together used to fire N identical reads before any entry existed.
// These maps cache the PROMISE at fire time so concurrent mounts share one
// read; a settled/rejected read drops its entry so the next mount can retry.
const ledgerInflight = new Map<string, Promise<GovernedLedgerRead>>();
const pendingSigInflight = new Map<string, Promise<Record<string, number>>>();

export function invalidateAuthorityCache(): void {
  registryCache = null;
  registryFetchedAt = 0;
  registryInflight = null;
  ledgerCache.clear();
  ledgerInflight.clear();
  pendingSigCache.clear();
  pendingSigInflight.clear();
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

async function readLedger(address: string): Promise<GovernedLedgerRead> {
  try {
    const [reh, cou] = await Promise.all([
      xrplLegacy.rehearsalStatus(address),
      xrplLegacy.council(address).catch(() => null),
    ]);
    return {
      loading: false,
      hasCouncil: reh.status.hasCouncil,
      memberCount: reh.status.memberCount,
      quorum: cou?.council?.quorum,
      signers: cou?.council?.signers,
      status: reh.status,
      health: reh.health,
    };
  } catch (e) {
    return { loading: false, error: (e as Error).message };
  }
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
    return out;
  }, [xrplConnected, registry]);

  // Ledger enrichment per candidate — fresh reads, minute-cached in memory.
  const candidatesKey = candidates.map((c) => c.address).join(',');
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    for (const c of candidates) {
      const cached = ledgerCache.get(c.address);
      if (cached && now - cached.at < LEDGER_TTL_MS) {
        setLedger((l) => (l[c.address] === cached.read ? l : { ...l, [c.address]: cached.read }));
        continue;
      }
      setLedger((l) => ({ ...l, [c.address]: { ...(l[c.address] ?? {}), loading: true } }));
      // Share ONE in-flight read per address across every mounted instance
      // (readLedger never rejects — errors come back as an error read).
      let read = ledgerInflight.get(c.address);
      if (!read) {
        const started = readLedger(c.address).then((r) => {
          ledgerCache.set(c.address, { at: Date.now(), read: r });
          if (ledgerInflight.get(c.address) === started) ledgerInflight.delete(c.address);
          return r;
        });
        ledgerInflight.set(c.address, started);
        read = started;
      }
      void read.then((r) => {
        if (alive) setLedger((l) => ({ ...l, [c.address]: r }));
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesKey, nonce]);

  // "Your signature is due" — live proposals where one of MY r-addresses is a
  // listed signer that has not signed yet. undefined until a real read exists
  // (the badge is never fabricated). Same minute-cache pattern as the ledger.
  const [pendingSig, setPendingSig] = useState<Record<string, number> | null>(null);
  const myXrplKey = useMemo(
    () =>
      wallets
        .map((w) => w.address)
        .filter((a) => a.startsWith('r'))
        .concat(xrplConnected ? [xrplConnected] : [])
        .join(','),
    [wallets, xrplConnected],
  );
  useEffect(() => {
    const accounts = candidates.map((c) => c.address);
    if (accounts.length === 0 || !hasAuthToken()) return;
    const cacheKey = `${accounts.join(',')}|${myXrplKey}`;
    const cached = pendingSigCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LEDGER_TTL_MS) {
      setPendingSig(cached.counts);
      return;
    }
    let alive = true;
    const mine = new Set(myXrplKey.split(',').filter(Boolean));
    // Share ONE in-flight read per cacheKey (same fix as the ledger reads: the
    // result cache was only written after resolving, so simultaneous mounts
    // fired N identical reads). A rejection drops the entry to allow retry.
    let read = pendingSigInflight.get(cacheKey);
    if (!read) {
      const started = councilProposalsApi
        .list(accounts, true)
        .then(({ proposals }) => {
          const counts: Record<string, number> = {};
          for (const a of accounts) counts[a] = 0;
          for (const p of proposals) {
            if (p.status !== 'collecting') continue;
            const signed = new Set(p.signatures.map((s) => s.signerAccount));
            if (p.signerList.some((s) => mine.has(s.account) && !signed.has(s.account))) {
              counts[p.account] = (counts[p.account] ?? 0) + 1;
            }
          }
          pendingSigCache.set(cacheKey, { at: Date.now(), counts });
          return counts;
        })
        .finally(() => {
          if (pendingSigInflight.get(cacheKey) === started) pendingSigInflight.delete(cacheKey);
        });
      pendingSigInflight.set(cacheKey, started);
      read = started;
    }
    void read
      .then((counts) => {
        if (alive) setPendingSig(counts);
      })
      .catch(() => {
        /* endpoint unavailable — the badge simply stays unknown */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesKey, myXrplKey, nonce]);

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
          pendingSignatures: pendingSig?.[c.address],
          ...read,
        } satisfies GovernedAuthority;
      }),
    [candidates, ledger, pendingSig],
  );

  // "My Legacies" is a list of LEGACIES, not of accounts that happen to be in
  // scope (founder 2026-07-28). A connected wallet shows there only once the
  // ledger CONFIRMS it is a council, or when the user deliberately pointed at
  // it (a registry entry). Without this, every signer sees their own member
  // account listed as if it were a Legacy it merely helps govern.
  const legacies = useMemo<GovernedAuthority[]>(
    () => governedCandidates.filter((g) => g.hasCouncil === true || !!g.registryId),
    [governedCandidates],
  );

  const authorities = useMemo<Authority[]>(() => {
    // A wallet the ledger confirms as a COUNCIL is not a personal wallet
    // (founder 2026-07-18): it leaves the simples entirely and lives only
    // inside its Legacy on the governed side.
    const councilKeys = new Set(
      governedCandidates.filter((g) => g.hasCouncil === true).map((g) => addressKey(g.address)),
    );
    const singles: Authority[] = wallets
      .filter((w) => !councilKeys.has(addressKey(w.address)))
      .map((w) => ({
        id: walletAuthorityId(w.address),
        kind: 'single',
        wallet: w,
      }));
    // A connected wallet only shows as governed once the ledger confirms it IS
    // a council (before that it still has its simple row). Registered pointers
    // stay visible in every state — the user placed them on purpose.
    const governed = governedCandidates.filter(
      (g) => !(g.source === 'connected' && g.hasCouncil !== true),
    );
    return [OVERVIEW, ...singles, ...governed];
  }, [wallets, governedCandidates]);

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
