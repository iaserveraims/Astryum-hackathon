/**
 * XrplEcosystemWatch — the XRPL ecosystem "vigía" (Fase 1 of the XRPL plan).
 *
 * Answers, from PUBLIC read-only APIs, the three gate questions that decide
 * which XRPL phases are buildable and which stay parked:
 *
 *   1. Amendments — are `SmartEscrow` (XLS-100), `LendingProtocol` (XLS-66)
 *      and `SingleAssetVault` (XLS-65) live on mainnet? (XRPScan API)
 *   2. RLUSD escrow — does the RLUSD issuer have `lsfAllowTrustLineLocking`
 *      ON? While OFF, RLUSD is NOT escrowable and the savings-escrow flow is
 *      XRP-only. (XRPScan account API)
 *   3. Sidechain venue — does the XRPL EVM Sidechain have a real money
 *      market/yield venue? While it doesn't, the cross-chain leveraged flow
 *      stays venue-gated. (DefiLlama /v2/chains + /protocols)
 *
 * Run it at the start of every XRPL session (`npx ts-node src/scripts/xrpl-watch.ts`).
 * Read-only public GETs — no keys, no signing, no invariant surface.
 * Parametrisable so the amendment list / issuer / thresholds can evolve
 * without touching the logic.
 */

// ── Config (values separated from logic — extractable) ───────────────────────

export interface XrplWatchConfig {
  /** XRPScan API base. */
  xrpscanBase: string;
  /** DefiLlama API base. */
  defillamaBase: string;
  /** Amendment names whose activation unlocks a parked phase. */
  watchedAmendments: readonly string[];
  /** Issuers whose lsfAllowTrustLineLocking gates the IOU escrow flow. */
  escrowGatedIssuers: ReadonlyArray<{ label: string; address: string }>;
  /** lsfAllowTrustLineLocking bit (XLS-85 issuer opt-in). */
  trustLineLockingMask: number;
  /** DefiLlama chain-name fragments that identify the XRPL EVM Sidechain. */
  sidechainNameFragments: readonly string[];
  /** DefiLlama categories that count as a "real venue" for the gated flow. */
  venueCategories: readonly string[];
  fetchTimeoutMs: number;
}

export const DEFAULT_XRPL_WATCH_CONFIG: XrplWatchConfig = {
  xrpscanBase: 'https://api.xrpscan.com/api/v1',
  defillamaBase: 'https://api.llama.fi',
  // Los tres primeros gatean fases aparcadas de Astryum; los cuatro siguientes
  // son la pasada Legacy (Astryum_Legacy_Investigacion_Verificada_2026-07-13 §6):
  // PermissionDelegation/Batch reportan la votación en vivo; DynamicMPT/Firewall
  // saldrán como "NOT on mainnet" hasta que existan.
  watchedAmendments: [
    'SmartEscrow',
    'LendingProtocol',
    'SingleAssetVault',
    'PermissionDelegation',
    // El gate real del roadmap (ADR-010 / switcher 2026-07-17) es la V1_1:
    // la V1 se desactivó en sep-2025 por bug de fees y jamás llegó a mainnet.
    'PermissionDelegationV1_1',
    'Batch',
    'DynamicMPT',
    'Firewall',
    // XLS-82 — MPTs negociables en el DEX/AMM nativo. Gatea la liquidez
    // secundaria de las "tokenized credit shares" de XLS-65/66 (análisis
    // 2026-07-18). No existe en mainnet aún → "NOT on mainnet" hasta entonces.
    'MPTokensV2',
  ],
  escrowGatedIssuers: [
    {
      label: 'RLUSD',
      address: process.env.RLUSD_XRPL_ISSUER ?? 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    },
    {
      // EURØP (Schuman) — verificado 2026-07-13 (doc Legacy §6): flag OFF hoy.
      label: 'EURØP',
      address: process.env.EUROP_XRPL_ISSUER ?? 'rMkEuRii9w9uBMQDnWV5AA43gvYZR9JxVK',
    },
  ],
  trustLineLockingMask: 0x40000000,
  sidechainNameFragments: ['xrpl evm', 'xrp evm', 'xrplevm'],
  venueCategories: ['Lending', 'CDP', 'Yield', 'Yield Aggregator', 'Liquid Staking'],
  fetchTimeoutMs: 15_000,
};

// ── Result types ──────────────────────────────────────────────────────────────

export interface AmendmentStatus {
  name: string;
  /** false when the amendment does not even exist on mainnet yet. */
  exists: boolean;
  enabled: boolean;
  /** Validators voting yes / total, when the API reports a live vote. */
  count?: number;
  validations?: number;
  threshold?: number;
  /** count/validations as a percentage (0-100), when known. */
  supportPct?: number;
}

export interface IssuerEscrowStatus {
  label: string;
  address: string;
  /** lsfAllowTrustLineLocking — true means the IOU is escrowable. */
  trustLineLockingEnabled: boolean;
  rawFlags: number;
}

export interface SidechainVenueStatus {
  /** DefiLlama chain entry found (name + TVL), if any. */
  chain?: { name: string; tvlUSD: number };
  /** Protocols on the sidechain in venue categories (money markets, yield). */
  venues: Array<{ name: string; category: string; tvlUSD: number }>;
  /** true when at least one venue category protocol exists on the sidechain. */
  hasRealVenue: boolean;
}

export interface XrplWatchResult {
  checkedAt: string;
  amendments: AmendmentStatus[];
  issuerEscrows: IssuerEscrowStatus[];
  sidechain: SidechainVenueStatus;
  /** Sections that could not be checked (network error) — never silently green. */
  errors: string[];
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

// ── Checks (each independently callable) ─────────────────────────────────────

export async function fetchAmendmentsStatus(
  cfg: XrplWatchConfig = DEFAULT_XRPL_WATCH_CONFIG,
): Promise<AmendmentStatus[]> {
  const data = (await getJson(`${cfg.xrpscanBase}/amendments`, cfg.fetchTimeoutMs)) as Array<
    Record<string, unknown>
  >;
  return cfg.watchedAmendments.map((name) => {
    const found = data.find((a) => String(a.name).toLowerCase() === name.toLowerCase());
    if (!found) return { name, exists: false, enabled: false };
    const count = typeof found.count === 'number' ? found.count : undefined;
    const validations = typeof found.validations === 'number' ? found.validations : undefined;
    return {
      name,
      exists: true,
      enabled: found.enabled === true,
      count,
      validations,
      threshold: typeof found.threshold === 'number' ? found.threshold : undefined,
      supportPct:
        count !== undefined && validations ? Math.round((count / validations) * 1000) / 10 : undefined,
    };
  });
}

export async function fetchIssuerEscrowStatuses(
  cfg: XrplWatchConfig = DEFAULT_XRPL_WATCH_CONFIG,
): Promise<IssuerEscrowStatus[]> {
  return Promise.all(
    cfg.escrowGatedIssuers.map(async (issuer) => {
      const data = (await getJson(
        `${cfg.xrpscanBase}/account/${issuer.address}`,
        cfg.fetchTimeoutMs,
      )) as Record<string, unknown>;
      const rawFlags = typeof data.Flags === 'number' ? data.Flags : 0;
      return {
        label: issuer.label,
        address: issuer.address,
        trustLineLockingEnabled: (rawFlags & cfg.trustLineLockingMask) !== 0,
        rawFlags,
      };
    }),
  );
}

export async function fetchSidechainVenueStatus(
  cfg: XrplWatchConfig = DEFAULT_XRPL_WATCH_CONFIG,
): Promise<SidechainVenueStatus> {
  const matchesSidechain = (name: string): boolean => {
    const n = name.toLowerCase();
    return cfg.sidechainNameFragments.some((frag) => n.includes(frag));
  };

  const [chains, protocols] = await Promise.all([
    getJson(`${cfg.defillamaBase}/v2/chains`, cfg.fetchTimeoutMs) as Promise<
      Array<Record<string, unknown>>
    >,
    getJson(`${cfg.defillamaBase}/protocols`, cfg.fetchTimeoutMs) as Promise<
      Array<Record<string, unknown>>
    >,
  ]);

  const chainEntry = chains.find((c) => matchesSidechain(String(c.name ?? '')));
  const venues = protocols
    .filter((p) => {
      const onSidechain = (Array.isArray(p.chains) ? p.chains : []).some((c) =>
        matchesSidechain(String(c)),
      );
      return onSidechain && cfg.venueCategories.includes(String(p.category ?? ''));
    })
    .map((p) => ({
      name: String(p.name ?? '?'),
      category: String(p.category ?? '?'),
      tvlUSD: typeof p.tvl === 'number' ? p.tvl : 0,
    }));

  return {
    chain: chainEntry
      ? {
          name: String(chainEntry.name),
          tvlUSD: typeof chainEntry.tvl === 'number' ? chainEntry.tvl : 0,
        }
      : undefined,
    venues,
    hasRealVenue: venues.length > 0,
  };
}

// ── The watch ────────────────────────────────────────────────────────────────

export async function runXrplEcosystemWatch(
  cfg: XrplWatchConfig = DEFAULT_XRPL_WATCH_CONFIG,
): Promise<XrplWatchResult> {
  const errors: string[] = [];

  const [amendments, issuerEscrows, sidechain] = await Promise.all([
    fetchAmendmentsStatus(cfg).catch((err): AmendmentStatus[] => {
      errors.push(`amendments: ${(err as Error).message}`);
      return cfg.watchedAmendments.map((name) => ({ name, exists: false, enabled: false }));
    }),
    fetchIssuerEscrowStatuses(cfg).catch((err): IssuerEscrowStatus[] => {
      errors.push(`issuers: ${(err as Error).message}`);
      return cfg.escrowGatedIssuers.map((i) => ({
        label: i.label,
        address: i.address,
        trustLineLockingEnabled: false,
        rawFlags: 0,
      }));
    }),
    fetchSidechainVenueStatus(cfg).catch((err): SidechainVenueStatus => {
      errors.push(`sidechain: ${(err as Error).message}`);
      return { venues: [], hasRealVenue: false };
    }),
  ]);

  return { checkedAt: new Date().toISOString(), amendments, issuerEscrows, sidechain, errors };
}

/** Human-readable session report ("SmartEscrow sigue en X%, RLUSD sigue no-escrowable…"). */
export function formatWatchReport(result: XrplWatchResult): string {
  const lines: string[] = [`XRPL ecosystem watch — ${result.checkedAt}`, ''];

  for (const a of result.amendments) {
    if (!a.exists) {
      lines.push(`  ${a.name}: NOT on mainnet (amendment does not exist yet) → phase stays parked`);
    } else if (a.enabled) {
      lines.push(`  ${a.name}: ✅ ENABLED → gated phase UNLOCKED — re-plan before building`);
    } else {
      const pct = a.supportPct !== undefined ? `${a.supportPct}%` : 'unknown %';
      const vote =
        a.count !== undefined && a.validations !== undefined
          ? ` (${a.count}/${a.validations}, threshold ${a.threshold ?? '?'})`
          : '';
      lines.push(`  ${a.name}: voting at ${pct}${vote} → still parked`);
    }
  }

  for (const esc of result.issuerEscrows) {
    lines.push(
      esc.trustLineLockingEnabled
        ? `  ${esc.label} escrow: ✅ issuer flag ON → ${esc.label} is now escrowable — re-plan the savings flow`
        : `  ${esc.label} escrow: issuer lsfAllowTrustLineLocking OFF → savings-escrow stays XRP-only`,
    );
  }

  const sc = result.sidechain;
  if (sc.hasRealVenue) {
    const list = sc.venues.map((v) => `${v.name} [${v.category}] $${Math.round(v.tvlUSD).toLocaleString()}`);
    lines.push(`  Sidechain venue: ✅ FOUND → ${list.join(', ')} — leveraged flow may unlock, verify manually`);
  } else {
    const tvl = sc.chain ? ` (chain TVL $${Math.round(sc.chain.tvlUSD).toLocaleString()})` : '';
    lines.push(`  Sidechain venue: none${tvl} → cross-chain leveraged flow stays venue-gated`);
  }

  if (result.errors.length > 0) {
    lines.push('', '  ⚠ Checks that FAILED (do not treat as green):');
    for (const e of result.errors) lines.push(`    - ${e}`);
  }

  return lines.join('\n');
}
