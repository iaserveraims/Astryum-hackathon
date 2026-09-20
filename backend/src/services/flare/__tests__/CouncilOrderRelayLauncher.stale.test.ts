/**
 * El vigía ante una orden CADUCADA: dos órdenes con el
 * nonce superado se reintentaron 185 veces en un día. Un veredicto `stale`
 * del relé la saca de la cola para siempre y la anota como abandonada — y la
 * pasada del vigía no la vuelve a adoptar aunque siga en la lista.
 */
const relayCouncilOrder = jest.fn();
class RelayAbort extends Error {}
jest.mock('../LegacyOrderRelayService', () => ({
  relayCouncilOrder: (...args: unknown[]) => relayCouncilOrder(...args),
  RelayAbort,
}));
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

const kvRows: Array<Record<string, unknown> & { __job: string }> = [];
jest.mock('../../persistence/backgroundJobKv', () => ({
  kvList: async (job: string) => kvRows.filter((r) => r.__job === job).map(({ __job: _j, ...r }) => r),
  kvListStrict: async (job: string) => kvRows.filter((r) => r.__job === job).map(({ __job: _j, ...r }) => r),
  kvUpsert: async (job: string, _f: string, key: string, payload: Record<string, unknown>) => {
    const i = kvRows.findIndex((r) => r.__job === job && r.xrplTxHash === key);
    if (i >= 0) kvRows[i] = { ...payload, __job: job };
    else kvRows.push({ ...payload, __job: job });
  },
  kvDelete: async (job: string, _f: string, key: string) => {
    const i = kvRows.findIndex((r) => r.__job === job && r.xrplTxHash === key);
    if (i >= 0) kvRows.splice(i, 1);
  },
}));

import { getCouncilOrderRelayState, launchCouncilOrderRelay, retryPendingCouncilOrders } from '../CouncilOrderRelayLauncher';

const HASH = '1'.repeat(64);

async function waitForState(hash: string, state: string, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getCouncilOrderRelayState(hash)?.state === state) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`state never reached ${state}: ${JSON.stringify(getCouncilOrderRelayState(hash))}`);
}

describe('a stale order (nonce behind the bridge)', () => {
  beforeEach(() => {
    relayCouncilOrder.mockReset();
    kvRows.length = 0;
  });

  it('is abandoned for good: error state with stale, out of the pending list, remembered as abandoned', async () => {
    const stale = Object.assign(new RelayAbort('order nonce 0 is behind the bridge (next is 3)'), { stale: true, expected: 3, actual: 0 });
    relayCouncilOrder.mockRejectedValue(stale);
    launchCouncilOrderRelay(HASH);
    await waitForState(HASH, 'error');
    await new Promise((r) => setTimeout(r, 30));
    const st = getCouncilOrderRelayState(HASH);
    expect(st?.stale).toBe(true);
    expect(st?.detail).toContain('behind the bridge');
    expect(kvRows.filter((r) => r.__job === 'legacy-order-pending')).toHaveLength(0);
    expect(kvRows.filter((r) => r.__job === 'legacy-order-abandoned').map((r) => r.xrplTxHash)).toEqual([HASH]);
    expect(relayCouncilOrder).toHaveBeenCalledTimes(1);
  });

  it('the watcher never relaunches an abandoned hash, even if the pending list still carries it', async () => {
    kvRows.push({ __job: 'legacy-order-abandoned', xrplTxHash: HASH, detail: 'behind', abandonedAt: new Date().toISOString() });
    kvRows.push({ __job: 'legacy-order-pending', xrplTxHash: HASH, firstSeenAt: new Date().toISOString(), attempts: 3 });
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    const out = await retryPendingCouncilOrders();
    expect(out.relaunched).toBe(0);
    expect(relayCouncilOrder).not.toHaveBeenCalled();
    expect(kvRows.filter((r) => r.__job === 'legacy-order-pending')).toHaveLength(0);
  });

  it('an ordinary failure still stays in the queue for the watcher (unchanged behaviour)', async () => {
    relayCouncilOrder.mockRejectedValue(new RelayAbort('bridge.execute would revert: something else'));
    launchCouncilOrderRelay('2'.repeat(64));
    await waitForState('2'.repeat(64), 'error');
    await new Promise((r) => setTimeout(r, 30));
    expect(getCouncilOrderRelayState('2'.repeat(64))?.stale).toBeUndefined();
    expect(kvRows.filter((r) => r.__job === 'legacy-order-pending').map((r) => r.xrplTxHash)).toEqual(['2'.repeat(64)]);
  });
});
