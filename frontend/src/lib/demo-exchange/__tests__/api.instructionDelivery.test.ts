import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetLiveRequests, flareInstructionDeliveryWord } from '../../xaman/liveRequests';
import { demoApi } from '../api';

/**
 * EL 0xFE DE LA MESA TAMBIÉN
 * ENTRA EN EL REGISTRO DE PETICIONES VIVAS.
 */

const MEMO = 'FE' + '01'.repeat(40);
const xrplPayment = (memo = MEMO) => ({
  TransactionType: 'Payment',
  Account: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7',
  Memos: [{ Memo: { MemoData: memo } }],
});
const word = () => flareInstructionDeliveryWord(JSON.stringify(xrplPayment()));

function respond(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
}

beforeEach(() => __resetLiveRequests());
afterEach(() => vi.unstubAllGlobals());

describe('a desk 0xFE carries the server word about its carrier', () => {
  it('«the executor runs» reaches the registry through the nested handoff', async () => {
    respond({ deskPayment: { id: 'dp1' }, run: {}, handoff: { xrplPayment: xrplPayment(), serverDelivery: { executorEnabled: true } } });
    expect((await demoApi.preparePutToWork('run1', 'dp1')).ok).toBe(true);
    expect(word()).toBe('delivers');
  });

  it('«the executor is stopped» is said too — that one IS an accusation the server made', async () => {
    respond({ handoff: { xrplPayment: xrplPayment(), serverDelivery: { executorEnabled: false } } });
    await demoApi.preparePutToWork('run1', 'dp1');
    expect(word()).toBe('stopped');
  });

  it('a flat `executorEnabled` on the body is read too (routes differ)', async () => {
    respond({ handoff: { xrplPayment: xrplPayment() }, executorEnabled: true });
    await demoApi.preparePutToWork('run1', 'dp1');
    expect(word()).toBe('delivers');
  });

  it('a route that does not send the field yet stays «unknown» — never «stopped»', async () => {
    respond({ handoff: { xrplPayment: xrplPayment() } });
    await demoApi.preparePutToWork('run1', 'dp1');
    expect(word()).toBe('unknown');
  });

  it('a body that is not a 0xFE writes nothing (a client deposit is not an instruction)', async () => {
    respond({ xrplTx: { TransactionType: 'Payment', Destination: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', DestinationTag: 101 } });
    await demoApi.depositInstructions('run1', 'c1', '2');
    expect(word()).toBe('unknown');
  });
});
