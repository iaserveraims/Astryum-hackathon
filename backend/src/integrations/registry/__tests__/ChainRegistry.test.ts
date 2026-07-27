import {
  CHAIN_REGISTRY,
  getChain,
  getChainOrNull,
  enabledChainIds,
  enabledEvmChainIds,
  tier1ChainIds,
  isChainSupported,
  chainIdFromDefiLlamaSlug,
  toCaip2,
  enabledDefiLlamaSlugs,
} from '../ChainRegistry';

describe('ChainRegistry', () => {
  describe('CHAIN_REGISTRY entries', () => {
    it('contains all required P15 chains', () => {
      expect(CHAIN_REGISTRY[1]).toBeDefined();      // Ethereum
      expect(CHAIN_REGISTRY[296]).toBeDefined();    // Hedera (P15)
      expect(CHAIN_REGISTRY[50]).toBeDefined();     // XDC (P15)
      expect(CHAIN_REGISTRY[900]).toBeDefined();    // Solana (P14)
      expect(CHAIN_REGISTRY[1440002]).toBeDefined();// XRPL (P16, disabled)
      expect(CHAIN_REGISTRY[14]).toBeDefined();     // Flare
    });

    it('Hedera entry has correct metadata', () => {
      const chain = CHAIN_REGISTRY[296];
      expect(chain.name).toBe('Hedera');
      expect(chain.caip2).toBe('eip155:296');
      expect(chain.isEvm).toBe(true);
      expect(chain.nativeCurrency.symbol).toBe('HBAR');
      expect(chain.nativeCurrency.decimals).toBe(8);
      expect(chain.rpcUrl).toBe('https://mainnet.hashio.io/api');
      expect(chain.explorerUrl).toBe('https://hashscan.io');
      expect(chain.defiLlamaSlug).toBe('Hedera');
      expect(chain.enabled).toBe(true);
      expect(chain.tier).toBe(1);
    });

    it('XDC entry has correct metadata', () => {
      const chain = CHAIN_REGISTRY[50];
      expect(chain.name).toBe('XDC');
      expect(chain.caip2).toBe('eip155:50');
      expect(chain.isEvm).toBe(true);
      expect(chain.nativeCurrency.symbol).toBe('XDC');
      expect(chain.nativeCurrency.decimals).toBe(18);
      expect(chain.rpcUrl).toBe('https://erpc.xinfin.network');
      expect(chain.explorerUrl).toBe('https://xdcscan.io');
      expect(chain.defiLlamaSlug).toBe('XDC');
      expect(chain.enabled).toBe(true);
      expect(chain.tier).toBe(1);
    });

    it('Solana entry is tier 2 and non-EVM', () => {
      const chain = CHAIN_REGISTRY[900];
      expect(chain.name).toBe('Solana');
      expect(chain.tier).toBe(2);
      expect(chain.isEvm).toBe(false);
      expect(chain.caip2).toBe('solana:mainnet');
      expect(chain.defiLlamaSlug).toBe('Solana');
      expect(chain.enabled).toBe(true);
    });

    it('XRPL entry is tier 3 and enabled (P16 activated)', () => {
      const chain = CHAIN_REGISTRY[1440002];
      expect(chain.tier).toBe(3);
      expect(chain.enabled).toBe(true);
      expect(chain.caip2).toBe('xrpl:mainnet');
      expect(chain.requiresCustomProvider).toBe('xrpl-rpc');
    });

    it('Flare has featureFlag set', () => {
      const chain = CHAIN_REGISTRY[14];
      expect(chain.featureFlag).toBe('FLARE_DEFI_ENABLED');
      expect(chain.enabled).toBe(true);
    });

    it('all enabled chains have required fields', () => {
      for (const chain of Object.values(CHAIN_REGISTRY)) {
        if (!chain.enabled) continue;
        expect(chain.chainId).toBeGreaterThan(0);
        expect(chain.name).toBeTruthy();
        expect(chain.caip2).toBeTruthy();
        expect(chain.explorerUrl).toMatch(/^https:\/\//);
        expect(chain.defiLlamaSlug).toBeTruthy();
        expect([1, 2, 3]).toContain(chain.tier);
      }
    });
  });

  describe('getChain()', () => {
    it('returns chain metadata for valid chainId', () => {
      const chain = getChain(1);
      expect(chain.name).toBe('Ethereum');
    });

    it('throws for unknown chainId', () => {
      expect(() => getChain(99999)).toThrow(/unknown chainId/);
    });
  });

  describe('getChainOrNull()', () => {
    it('returns chain metadata for valid chainId', () => {
      expect(getChainOrNull(137)?.name).toBe('Polygon');
    });

    it('returns null for unknown chainId', () => {
      expect(getChainOrNull(99999)).toBeNull();
    });
  });

  describe('enabledChainIds()', () => {
    it('returns only enabled chains', () => {
      const ids = enabledChainIds();
      expect(ids).toContain(1);
      expect(ids).toContain(296);     // Hedera (P15)
      expect(ids).toContain(50);      // XDC (P15)
      expect(ids).toContain(900);     // Solana
      expect(ids).toContain(1440002); // XRPL (P16 activated)
    });

    it('contains XRPL (P16 activated)', () => {
      expect(enabledChainIds()).toContain(1440002);
    });
  });

  describe('enabledEvmChainIds()', () => {
    it('includes EVM chains only', () => {
      const ids = enabledEvmChainIds();
      expect(ids).toContain(1);     // Ethereum
      expect(ids).toContain(296);   // Hedera (EVM-compatible)
      expect(ids).toContain(50);    // XDC (EVM-compatible)
      expect(ids).not.toContain(900);    // Solana is non-EVM
      expect(ids).not.toContain(1440002); // XRPL is non-EVM
    });
  });

  describe('tier1ChainIds()', () => {
    it('includes all enabled tier-1 chains', () => {
      const ids = tier1ChainIds();
      expect(ids).toContain(1);   // Ethereum
      expect(ids).toContain(296); // Hedera
      expect(ids).toContain(50);  // XDC
      expect(ids).toContain(14);  // Flare
      expect(ids).not.toContain(900);     // Solana is tier 2
      expect(ids).not.toContain(1440002); // XRPL is tier 3
    });
  });

  describe('isChainSupported()', () => {
    it('returns true for enabled chains', () => {
      expect(isChainSupported(1)).toBe(true);
      expect(isChainSupported(296)).toBe(true);
      expect(isChainSupported(50)).toBe(true);
      expect(isChainSupported(900)).toBe(true);
    });

    it('returns true for XRPL (P16 activated)', () => {
      expect(isChainSupported(1440002)).toBe(true); // XRPL enabled in P16
    });

    it('returns false for unknown chains', () => {
      expect(isChainSupported(99999)).toBe(false);
    });
  });

  describe('chainIdFromDefiLlamaSlug()', () => {
    it('resolves known slugs to chainIds', () => {
      expect(chainIdFromDefiLlamaSlug('Ethereum')).toBe(1);
      expect(chainIdFromDefiLlamaSlug('Hedera')).toBe(296);
      expect(chainIdFromDefiLlamaSlug('XDC')).toBe(50);
      expect(chainIdFromDefiLlamaSlug('Solana')).toBe(900);
      expect(chainIdFromDefiLlamaSlug('Flare')).toBe(14);
    });

    it('returns undefined for unknown slugs', () => {
      expect(chainIdFromDefiLlamaSlug('UnknownChain')).toBeUndefined();
    });
  });

  describe('toCaip2()', () => {
    it('returns correct CAIP-2 for known chains', () => {
      expect(toCaip2(1)).toBe('eip155:1');
      expect(toCaip2(296)).toBe('eip155:296');
      expect(toCaip2(50)).toBe('eip155:50');
      expect(toCaip2(900)).toBe('solana:mainnet');
      expect(toCaip2(1440002)).toBe('xrpl:mainnet');
    });

    it('falls back to eip155 format for unknown chainIds', () => {
      expect(toCaip2(12345)).toBe('eip155:12345');
    });
  });

  describe('enabledDefiLlamaSlugs()', () => {
    it('includes slugs for all enabled chains', () => {
      const slugs = enabledDefiLlamaSlugs();
      expect(slugs).toContain('Ethereum');
      expect(slugs).toContain('Hedera');
      expect(slugs).toContain('XDC');
      expect(slugs).toContain('Solana');
      expect(slugs).toContain('Flare');
    });

    it('all slugs are non-empty strings', () => {
      for (const slug of enabledDefiLlamaSlugs()) {
        expect(typeof slug).toBe('string');
        expect(slug.length).toBeGreaterThan(0);
      }
    });
  });
});
