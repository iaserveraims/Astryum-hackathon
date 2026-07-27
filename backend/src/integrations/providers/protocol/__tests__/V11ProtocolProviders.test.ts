jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({ getHttpProvider: () => ({}) }),
  },
}));

import { ethers } from 'ethers';
import { IntegrationRegistry } from '../../../registry/IntegrationRegistry';
import { bootstrapRegistry } from '../../../registry/bootstrap';
import {
  bootstrapV11ProtocolProviders,
  WflrProvider,
  FtsoProtocolProvider,
  SceptreProvider,
} from '..';
import type { CanonicalAction } from '../../../../canonical/types/Action';
import type { ProviderCallContext } from '../../../interfaces/IProvider';

const WALLET = '0x000000000000000000000000000000000000abcd';
const FTSO_PROVIDER_ADDR = '0x000000000000000000000000000000000000beef';
const WNAT = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const SFLR = '0x12e605bc104e93B45e1aD99F9e555f659051c2BB';

function makeCtx(overrides: Partial<ProviderCallContext> = {}): ProviderCallContext {
  return { traceId: 'trace-1', wallet: WALLET, sessionId: 'sess-1', ...overrides };
}

describe('V1.1 protocol providers (wflr / ftso / sceptre)', () => {
  test('bootstrap replaces stubs with real providers', () => {
    const reg = new IntegrationRegistry();
    bootstrapRegistry(reg);
    const stubW = reg.get('wflr');
    expect(stubW).toBeTruthy();
    bootstrapV11ProtocolProviders(reg);
    expect(reg.get('wflr')).toBeInstanceOf(WflrProvider);
    expect(reg.get('ftso')).toBeInstanceOf(FtsoProtocolProvider);
    expect(reg.get('sceptre')).toBeInstanceOf(SceptreProvider);
  });

  test('WflrProvider.prepareIntent returns CanonicalIntent with SourceRecord', async () => {
    const p = new WflrProvider();
    const action: CanonicalAction = {
      type: 'wrap',
      targetProtocol: 'wflr',
      targetChain: 14,
      params: { amount: '1000000000000000000', flrPriceUSD: 0.02 },
    };
    const r = await p.prepareIntent(action, makeCtx());

    // Canonical intent shape
    expect(r.data.action.type).toBe('wrap');
    expect(r.data.protocol).toBe('wflr');
    expect(r.data.txData?.to.toLowerCase()).toBe(WNAT.toLowerCase());
    expect(r.data.txData?.value).toBe('1000000000000000000');
    expect(typeof r.data.simulation.gasEstimate).toBe('string'); // bigint serialized

    // SourceRecord stamped
    expect(r.source.providerId).toBe('wflr');
    expect(r.source.providerType).toBe('protocol');
    expect(r.source.trustLevel).toBe('protocol_native');
    expect(r.source.traceId).toBe('trace-1');
    expect(r.cached).toBe(false);
  });

  test('FtsoProtocolProvider.prepareIntent delegate emits canonical with correct calldata', async () => {
    const p = new FtsoProtocolProvider();
    const action: CanonicalAction = {
      type: 'delegate',
      targetProtocol: 'ftso',
      targetChain: 14,
      params: { provider: FTSO_PROVIDER_ADDR, bips: 5000, flrPriceUSD: 0.02 },
    };
    const r = await p.prepareIntent(action, makeCtx());
    expect(r.data.action.type).toBe('delegate');
    expect(r.data.txData?.to.toLowerCase()).toBe(WNAT.toLowerCase());

    const decoded = new ethers.Interface([
      'function delegate(address to, uint256 bips)',
    ]).parseTransaction({ data: r.data.txData!.data });
    expect(decoded?.name).toBe('delegate');
    expect(decoded?.args[0].toLowerCase()).toBe(FTSO_PROVIDER_ADDR.toLowerCase());

    expect(r.source.providerId).toBe('ftso');
  });

  test('SceptreProvider.prepareIntent stake emits canonical sFLR.submit() with value', async () => {
    const p = new SceptreProvider();
    const action: CanonicalAction = {
      type: 'stake',
      targetProtocol: 'sceptre',
      targetChain: 14,
      params: { amount: '5000000000000000000', flrPriceUSD: 0.02 },
    };
    const r = await p.prepareIntent(action, makeCtx());
    expect(r.data.action.type).toBe('stake');
    expect(r.data.protocol).toBe('sceptre');
    expect(r.data.txData?.to.toLowerCase()).toBe(SFLR.toLowerCase());
    expect(r.data.txData?.value).toBe('5000000000000000000');
    expect(r.source.providerId).toBe('sceptre');
    expect(r.source.trustLevel).toBe('protocol_native');
  });

  test('generic call() routes capability protocol.prepareIntent', async () => {
    const p = new WflrProvider();
    const action: CanonicalAction = {
      type: 'unwrap',
      targetProtocol: 'wflr',
      targetChain: 14,
      params: { amount: '2000000000000000000', flrPriceUSD: 0.02 },
    };
    const r = await p.call<CanonicalAction, unknown>(
      'protocol.prepareIntent',
      action,
      makeCtx(),
    );
    const data = r.data as { action: { type: string }; protocol: string };
    expect(data.action.type).toBe('unwrap');
    expect(data.protocol).toBe('wflr');
    expect(r.source.providerId).toBe('wflr');
  });

  test('prepareIntent rejects without wallet/sessionId', async () => {
    const p = new WflrProvider();
    const action: CanonicalAction = {
      type: 'wrap',
      targetProtocol: 'wflr',
      targetChain: 14,
      params: { amount: '1' },
    };
    await expect(
      p.prepareIntent(action, { traceId: 't', wallet: WALLET } as ProviderCallContext),
    ).rejects.toThrow(/sessionId/);
    await expect(
      p.prepareIntent(action, { traceId: 't', sessionId: 's' } as ProviderCallContext),
    ).rejects.toThrow(/wallet/);
  });

  test('health() reports healthy for active adapters', async () => {
    const wflr = new WflrProvider();
    const ftso = new FtsoProtocolProvider();
    const sceptre = new SceptreProvider();
    const [hW, hF, hS] = await Promise.all([wflr.health(), ftso.health(), sceptre.health()]);
    expect(hW.status).toBe('healthy');
    expect(hF.status).toBe('healthy');
    expect(hS.status).toBe('healthy');
  });
});
