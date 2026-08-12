/**
 * FTSO Provider Registry — names + delegation addresses of the LISTED data
 * providers, read from the public TowoLabs/ftso-signal-providers list. The
 * Flare Developer Hub tells every entity to PR that repo to appear on the
 * explorers, so this is the same neutral directory Flarescan et al. render —
 * served A–Z, never ranked (invariant #9: a directory, not a recommendation).
 *
 * Read-only metadata with an empty-list failure mode: the delegate form keeps
 * its manual address input, so this registry is never load-bearing.
 */

export interface ListedProvider {
  /** Delegation address (the address WNat.delegate targets). */
  address: string;
  /** Display name as published in the registry (sanitized, capped). */
  name: string;
}

interface RegistryLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface FtsoProviderRegistryConfig {
  network?: 'flare' | 'songbird';
  /** Override the registry URL (tests / incident response). Never a secret. */
  url?: string;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Cache lifetime; after it expires a refresh is attempted, stale on error. */
  cacheTTLMs?: number;
  logger?: RegistryLogger;
}

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/TowoLabs/ftso-signal-providers/master/bifrost-wallet.providerlist.json';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_NAME_LENGTH = 64;
const CHAIN_IDS: Record<'flare' | 'songbird', number> = { flare: 14, songbird: 19 };

export class FtsoProviderRegistry {
  private readonly chainId: number;
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly cacheTTLMs: number;
  private readonly logger?: RegistryLogger;

  private cache: ListedProvider[] | null = null;
  private cacheAt = 0;

  constructor(config: FtsoProviderRegistryConfig = {}) {
    this.chainId = CHAIN_IDS[config.network ?? 'flare'];
    this.url = config.url || process.env.FTSO_PROVIDER_REGISTRY_URL || DEFAULT_REGISTRY_URL;
    this.fetchFn = config.fetchFn ?? fetch;
    this.cacheTTLMs = config.cacheTTLMs ?? DEFAULT_CACHE_TTL_MS;
    this.logger = config.logger;
  }

  /** Listed providers for this network, alphabetical. Never throws. */
  async getListedProviders(): Promise<ListedProvider[]> {
    if (this.cache && Date.now() - this.cacheAt < this.cacheTTLMs) {
      return this.cache;
    }
    try {
      const fresh = await this.fetchRegistry();
      this.cache = fresh;
      this.cacheAt = Date.now();
      return fresh;
    } catch (error) {
      this.logger?.warn('FTSO provider registry fetch failed — serving stale/empty', {
        error: (error as Error).message
      });
      // Stale beats empty: the last good list stays valid until a refresh lands.
      return this.cache ?? [];
    }
  }

  private async fetchRegistry(): Promise<ListedProvider[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(this.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
      const body = (await res.json()) as { providers?: Array<Record<string, unknown>> };
      const seen = new Set<string>();
      const providers: ListedProvider[] = [];
      for (const raw of body.providers ?? []) {
        if (raw.chainId !== this.chainId || raw.listed !== true) continue;
        const address = typeof raw.address === 'string' ? raw.address.trim() : '';
        if (!ADDRESS_RE.test(address) || seen.has(address.toLowerCase())) continue;
        // External strings end up in a <select>: collapse whitespace, cap length.
        const name =
          typeof raw.name === 'string'
            ? raw.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
            : '';
        if (!name) continue;
        seen.add(address.toLowerCase());
        providers.push({ address, name });
      }
      providers.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
      return providers;
    } finally {
      clearTimeout(timer);
    }
  }
}
