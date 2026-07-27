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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
const ledgerCache = new Map<string, { at: number; read: GovernedLedgerRead }>();
const LEDGER_TTL_MS = 60_000;

const pendingSigCache = new Map<string, { at: number; counts: Record<string, number> }>();

export function invalidateAuthorityCache(): void {
  registryCache = null;
  ledgerCache.clear();
  pendingSigCache.clear();
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

  // Registry load, draining any local wizard pointers the registry misses.
  useEffect(() => {
    if (!hasAuthToken()) {
      setRegistryLoading(false);
      return;
    }
    let alive = true;
    if (registryCache === null) setRegistryLoading(true);
    void (async () => {
      try {
        let { accounts } = await governedAccountsApi.list();
        const drained = await syncLocalPointers(new Set(accounts.map((a) => a.address)));
        if (drained) ({ accounts } = await governedAccountsApi.list());
        registryCache = accounts;
        if (alive) setRegistry(accounts);
      } catch {
        /* offline / 401 — keep whatever we had; governed entries just miss */
      } finally {
        if (alive) setRegistryLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

  // The wizard's local writes (remember/nickname) announce themselves — re-run
  // the load so new pointers drain into the registry and repaint everywhere.
  useEffect(() => {
    const onLocalChange = () => {
      registryCache = null;
      setNonce((n) => n + 1);
    };
    window.addEventListener(LEGACY_LOCAL_CHANGED_EVENT, onLocalChange);
    return () => window.removeEventListener(LEGACY_LOCAL_CHANGED_EVENT, onLocalChange);
  }, []);

  const candidates = useMemo<GovernedCandidate[]>(() => {
    const out: GovernedCandidate[] = [];
    if (xrplConnected) out.push({ address: xrplConnected, source: 'connected' });
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
      void readLedger(c.address).then((read) => {
        ledgerCache.set(c.address, { at: Date.now(), read });
        if (alive) setLedger((l) => ({ ...l, [c.address]: read }));
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
    void councilProposalsApi
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
    active,
    activeGoverned: isGoverned(active) ? active : null,
    setActive,
    loading: walletsLoading || registryLoading,
    reload: useCallback(() => {
      registryCache = null;
      ledgerCache.clear();
      setNonce((n) => n + 1);
    }, []),
  };
}
