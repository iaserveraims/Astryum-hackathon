import { FtsoProviderRegistry } from '../ProviderRegistry';

const ADDR_A = '0x9A46864A3b0a7805B266C445289C3fAD1E48f18e';
const ADDR_B = '0x47B6EfFE71ABD4e8CdCC56f2341BEb404f804b87';
const ADDR_C = '0x1E8F916CE03F4ce86186531a8994d366581Ed4be';

function registryResponse(providers: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ providers })
  } as unknown as Response;
}

const SAMPLE = [
  { chainId: 14, name: 'Zebra Oracle', address: ADDR_A, listed: true },
  { chainId: 14, name: '  Alpha\n Oracle  ', address: ADDR_B, listed: true },
  // Dropped: Songbird entry, unlisted entry, bad address, missing name, dupe.
  { chainId: 19, name: 'Songbird Twin', address: ADDR_C, listed: true },
  { chainId: 14, name: 'Not Listed', address: ADDR_C, listed: false },
  { chainId: 14, name: 'Bad Address', address: '0x1234', listed: true },
  { chainId: 14, name: '', address: ADDR_C, listed: true },
  { chainId: 14, name: 'Zebra Duplicate', address: ADDR_A.toLowerCase(), listed: true }
];

describe('FtsoProviderRegistry', () => {
  it('keeps only listed providers of the network, sanitized and A–Z', async () => {
    const fetchFn = jest.fn().mockResolvedValue(registryResponse(SAMPLE));
    const registry = new FtsoProviderRegistry({ network: 'flare', fetchFn: fetchFn as typeof fetch });

    const providers = await registry.getListedProviders();

    expect(providers).toEqual([
      { address: ADDR_B, name: 'Alpha Oracle' }, // whitespace collapsed
      { address: ADDR_A, name: 'Zebra Oracle' }
    ]);
  });

  it('serves the cache within the TTL — one upstream fetch', async () => {
    const fetchFn = jest.fn().mockResolvedValue(registryResponse(SAMPLE));
    const registry = new FtsoProviderRegistry({ network: 'flare', fetchFn: fetchFn as typeof fetch });

    await registry.getListedProviders();
    await registry.getListedProviders();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the first fetch fails, stale list when a later one does', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(registryResponse(SAMPLE))
      .mockRejectedValueOnce(new Error('network down again'));
    // TTL 0 → every call refreshes, exercising the stale-on-error path.
    const registry = new FtsoProviderRegistry({
      network: 'flare',
      fetchFn: fetchFn as typeof fetch,
      cacheTTLMs: 0
    });

    expect(await registry.getListedProviders()).toEqual([]);
    expect(await registry.getListedProviders()).toHaveLength(2);
    expect(await registry.getListedProviders()).toHaveLength(2); // stale beats empty
  });

  it('treats a non-OK upstream response as a failure', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    const registry = new FtsoProviderRegistry({ network: 'flare', fetchFn: fetchFn as typeof fetch });

    expect(await registry.getListedProviders()).toEqual([]);
  });
});
