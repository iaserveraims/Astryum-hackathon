/**
 * LegacyCageResolver — whose cage is this?
 *
 * The bug this pins (founder, 2026-08-05): the stack came from env, so EVERY
 * Legacy in the install resolved to the same cage. Reading it was cosmetic;
 * funding it was not — `/vault-fund/prepare` composes a mint that deposits into
 * the vault, and the vault has no function that pays principal to an address.
 * A second council would have signed its own XRP into the first council's cage
 * for good.
 *
 * So the contract under test is blunt: a cage belongs to the ONE council whose
 * address hash the bridge carries as `immutable`, and to nobody else. Every
 * other answer is "this Legacy has no cage" — never a throw, never a fallback
 * to the configured one.
 */

const COUNCIL = 'rsmvJMhhh8Bhr2cTLDbXKrGoCCLptKDmrf';
/** A different Legacy — same shape, one character apart. */
const OTHER_COUNCIL = 'rsmvJMhhh8Bhr2cTLDbXKrGoCCLptKDmrg';
const ANCHOR = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const BRIDGE = '0x02aE9fcB76768e42b8D3Ed9FE842238A6616b26F';
const VAULT = '0xc8379c79779cCE3B738424892709fe0D4339E3b1';

/** What the deployed bridge would answer: keccak256 of the r-address BYTES
 *  (FDC standard address hash — no lowercasing). Computed with the real ethers
 *  so a change in how we hash fails here instead of on mainnet. */
const realEthers = jest.requireActual('ethers').ethers;
const COUNCIL_HASH: string = realEthers.keccak256(realEthers.toUtf8Bytes(COUNCIL));

const ZERO = '0x0000000000000000000000000000000000000000';
const FACTORY = '0xfac7000000000000000000000000000000000001';
/** What the factory registry answers: councilHash → the cage born for it. */
const factoryRegistry = new Map<string, { bridge: string; vault: string }>();

/** Every bridge read the resolver makes, counted — the malformed-account path
 *  must not touch the network at all. */
let contractCalls = 0;
/** null ⇒ the bridge read fails (unreachable RPC / wrong address). */
let bridgeHash: string | null = COUNCIL_HASH;

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        constructor(_url?: string) {}
      },
      Contract: class {
        constructor(
          readonly target: string,
          _abi: unknown,
          _provider: unknown,
        ) {}
        async COUNCIL_ADDRESS_HASH(): Promise<string> {
          contractCalls += 1;
          if (bridgeHash === null) throw new Error('call revert exception');
          return bridgeHash;
        }
        async vaultOf(hash: string): Promise<string> {
          return factoryRegistry.get(hash.toLowerCase())?.vault ?? ZERO;
        }
        async bridgeOf(hash: string): Promise<string> {
          return factoryRegistry.get(hash.toLowerCase())?.bridge ?? ZERO;
        }
      },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const resolver = require('../LegacyCageResolver') as typeof import('../LegacyCageResolver');

const SAVED = { ...process.env };

beforeEach(() => {
  process.env.LEGACY_CHAIN = 'flare';
  process.env.LEGACY_BRIDGE_ADDRESS = BRIDGE;
  process.env.LEGACY_VAULT_ADDRESS = VAULT;
  process.env.LEGACY_ORDER_ANCHOR = ANCHOR;
  delete process.env.LEGACY_FACTORY_ADDRESS;
  bridgeHash = COUNCIL_HASH;
  contractCalls = 0;
  factoryRegistry.clear();
  resolver.__resetCageResolverCacheForTests();
});

/** Register a council's cage in the (mocked) on-chain factory registry. */
function bornFromFactory(council: string, bridge: string, vault: string): void {
  factoryRegistry.set(resolver.councilAddressHash(council), { bridge, vault });
}

afterEach(() => {
  process.env = { ...SAVED };
});

describe('cageForCouncil', () => {
  it('gives the council its own cage', async () => {
    const cage = await resolver.cageForCouncil(COUNCIL);
    expect(cage).not.toBeNull();
    expect(cage!.vault).toBe(VAULT);
    expect(cage!.bridge).toBe(BRIDGE);
  });

  it('gives a SECOND Legacy nothing — the money bug, pinned', async () => {
    // Before this, the same env stack answered here, and the funding route
    // composed a mint into it: another council's cage, no way back out.
    expect(await resolver.cageForCouncil(OTHER_COUNCIL)).toBeNull();
  });

  it('hashes the r-address bytes verbatim (FDC spec — no lowercasing)', async () => {
    // The bridge compares keccak256(bytes(r)). Lowercasing first would make
    // every account miss, and the ceremony would fail after the quorum signed.
    expect(resolver.councilAddressHash(COUNCIL)).toBe(COUNCIL_HASH.toLowerCase());
    expect(await resolver.cageForCouncil(COUNCIL.toLowerCase())).toBeNull();
  });

  it('reads the immutable hash once and caches it', async () => {
    await resolver.cageForCouncil(COUNCIL);
    await resolver.cageForCouncil(COUNCIL);
    await resolver.cageForCouncil(OTHER_COUNCIL);
    expect(contractCalls).toBe(1);
  });

  it('never touches the network for a malformed account', async () => {
    expect(await resolver.cageForCouncil('not-an-xrpl-address')).toBeNull();
    expect(await resolver.cageForCouncil('')).toBeNull();
    expect(contractCalls).toBe(0);
  });

  it('answers "no cage" (never throws) when the stack is unset', async () => {
    delete process.env.LEGACY_VAULT_ADDRESS;
    resolver.__resetCageResolverCacheForTests();
    await expect(resolver.cageForCouncil(COUNCIL)).resolves.toBeNull();
  });

  it('answers "no cage" (never throws) when the bridge cannot be read', async () => {
    bridgeHash = null;
    resolver.__resetCageResolverCacheForTests();
    await expect(resolver.cageForCouncil(COUNCIL)).resolves.toBeNull();
  });
});

describe('cages born from the factory (per-Legacy stacks)', () => {
  const B_BRIDGE = '0x1111111111111111111111111111111111111111';
  const B_VAULT = '0x2222222222222222222222222222222222222222';

  beforeEach(() => {
    process.env.LEGACY_FACTORY_ADDRESS = FACTORY;
    resolver.__resetCageResolverCacheForTests();
  });

  it('gives a second Legacy ITS OWN cage, not the configured one', async () => {
    bornFromFactory(OTHER_COUNCIL, B_BRIDGE, B_VAULT);
    const cage = await resolver.cageForCouncil(OTHER_COUNCIL);
    expect(cage).toMatchObject({ bridge: B_BRIDGE, vault: B_VAULT });
    // The env stack belongs to somebody else and must not leak in.
    expect(cage!.vault).not.toBe(VAULT);
  });

  it('carries the network config the routes need (rpc, chain, order anchor)', async () => {
    bornFromFactory(OTHER_COUNCIL, B_BRIDGE, B_VAULT);
    const cage = await resolver.cageForCouncil(OTHER_COUNCIL);
    expect(cage).toMatchObject({ chain: 'flare', sourceId: 'XRP', orderAnchor: ANCHOR });
    expect(cage!.rpcUrl).toContain('flare');
  });

  it('still gives the hand-deployed Legacy its cage — no migration needed', async () => {
    // The founder's stack was born before the factory: it is not in the
    // registry, and it must keep working exactly as it did.
    const cage = await resolver.cageForCouncil(COUNCIL);
    expect(cage).toMatchObject({ vault: VAULT, bridge: BRIDGE });
  });

  it('a Legacy in neither place has no cage', async () => {
    expect(await resolver.cageForCouncil(OTHER_COUNCIL)).toBeNull();
  });

  it('the registry wins over the env stack when both would answer', async () => {
    bornFromFactory(COUNCIL, B_BRIDGE, B_VAULT);
    const cage = await resolver.cageForCouncil(COUNCIL);
    expect(cage).toMatchObject({ vault: B_VAULT });
  });

  it('falls back to the env stack when the factory address is not set', async () => {
    delete process.env.LEGACY_FACTORY_ADDRESS;
    bornFromFactory(COUNCIL, B_BRIDGE, B_VAULT); // ignored: nothing to ask
    resolver.__resetCageResolverCacheForTests();
    expect(await resolver.cageForCouncil(COUNCIL)).toMatchObject({ vault: VAULT });
  });

  it('says out loud when the factory address is misconfigured', async () => {
    // Otherwise a checksum typo reads as "no Legacy has a cage" — a config
    // error wearing the clothes of a product state.
    process.env.LEGACY_FACTORY_ADDRESS = '0xFAc7000000000000000000000000000000000001'; // bad EIP-55 case
    resolver.__resetCageResolverCacheForTests();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bornFromFactory(OTHER_COUNCIL, B_BRIDGE, B_VAULT);
      expect(await resolver.cageForCouncil(OTHER_COUNCIL)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/LEGACY_FACTORY_ADDRESS/);
      // …once, not on every read.
      await resolver.cageForCouncil(OTHER_COUNCIL);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('requireCageForCouncil', () => {
  it('returns the cage for its own council', async () => {
    await expect(resolver.requireCageForCouncil(COUNCIL)).resolves.toMatchObject({ vault: VAULT });
  });

  it('refuses for a Legacy without one, naming the account and saying nothing moved', async () => {
    await expect(resolver.requireCageForCouncil(OTHER_COUNCIL)).rejects.toThrow(resolver.NoCageForLegacy);
    await expect(resolver.requireCageForCouncil(OTHER_COUNCIL)).rejects.toThrow(
      new RegExp(`${OTHER_COUNCIL}[\\s\\S]*no capital has moved`),
    );
  });
});

describe('noCageResponse', () => {
  it('maps the refusal to a 409 the routes can return verbatim', () => {
    const out = resolver.noCageResponse(new resolver.NoCageForLegacy(OTHER_COUNCIL));
    expect(out).not.toBeNull();
    expect(out!.status).toBe(409);
    expect(out!.body.error).toBe('NO_CAGE_FOR_LEGACY');
  });

  it('passes every other failure through to the route’s own catch', () => {
    expect(resolver.noCageResponse(new Error('RPC timeout'))).toBeNull();
  });
});
