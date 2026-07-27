/**
 * YellowStateChannelProvider — unit tests (FASE 8)
 * Broker mode gate, channel ops, and personal_sign flow.
 */

import { YellowStateChannelProvider } from '../YellowStateChannelProvider';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function httpError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(`error ${status}`),
  } as unknown as Response);
}

function ctx() {
  return { traceId: 'test-yellow', wallet: '0xBroker' };
}

function enableBrokerMode() {
  process.env.YELLOW_PERUN_KEY = 'test-perun-key';
  process.env.YELLOW_BROKER_MODE = 'true';
}

afterEach(() => {
  mockFetch.mockReset();
  delete process.env.YELLOW_PERUN_KEY;
  delete process.env.YELLOW_BROKER_MODE;
});

describe('YellowStateChannelProvider', () => {
  describe('id and capabilities', () => {
    const provider = new YellowStateChannelProvider();
    it('has correct id', () => expect(provider.id).toBe('yellow-state-channel'));
    it('includes settlement.createChannel', () => expect(provider.capabilities).toContain('settlement.createChannel'));
    it('includes settlement.preparePayment', () => expect(provider.capabilities).toContain('settlement.preparePayment'));
    it('includes settlement.getChannelState', () => expect(provider.capabilities).toContain('settlement.getChannelState'));
    it('includes settlement.closeChannel', () => expect(provider.capabilities).toContain('settlement.closeChannel'));
    it('has low priority (30)', () => expect(provider.priority).toBe(30));
  });

  describe('supportsChain()', () => {
    it('false when broker mode not enabled', () => {
      const provider = new YellowStateChannelProvider();
      expect(provider.supportsChain(1)).toBe(false);
      expect(provider.supportsChain(137)).toBe(false);
    });

    it('true for supported EVM chains when broker mode active', () => {
      enableBrokerMode();
      const provider = new YellowStateChannelProvider();
      expect(provider.supportsChain(1)).toBe(true);      // ETH
      expect(provider.supportsChain(10)).toBe(true);     // Optimism
      expect(provider.supportsChain(137)).toBe(true);    // Polygon
      expect(provider.supportsChain(42161)).toBe(true);  // Arbitrum
    });

    it('false for Flare (14) even with broker mode', () => {
      enableBrokerMode();
      const provider = new YellowStateChannelProvider();
      expect(provider.supportsChain(14)).toBe(false);
    });
  });

  describe('health()', () => {
    it('disabled when broker mode not set', async () => {
      const provider = new YellowStateChannelProvider();
      const h = await provider.health();
      expect(h.status).toBe('disabled');
      expect(h.reason).toMatch(/YELLOW_BROKER_MODE/);
    });

    it('disabled when only key set but BROKER_MODE missing', async () => {
      process.env.YELLOW_PERUN_KEY = 'key';
      const provider = new YellowStateChannelProvider();
      const h = await provider.health();
      expect(h.status).toBe('disabled');
    });

    it('healthy when broker mode active and API responds', async () => {
      enableBrokerMode();
      okJson({ status: 'ok' });
      const provider = new YellowStateChannelProvider();
      const h = await provider.health();
      expect(h.status).toBe('healthy');
    });

    it('degraded on HTTP error', async () => {
      enableBrokerMode();
      httpError(503);
      const provider = new YellowStateChannelProvider();
      const h = await provider.health();
      expect(h.status).toBe('degraded');
    });
  });

  describe('createChannel()', () => {
    const channelParams = {
      participantA: '0xUserWallet',
      participantB: '0xBrokerWallet',
      chainId: 1,
      assetToken: '0xUSDC',
      depositAmount: '500000000',
    };

    it('throws when broker mode not enabled', async () => {
      const provider = new YellowStateChannelProvider();
      await expect(provider.createChannel(channelParams)).rejects.toThrow(/broker mode/);
    });

    it('returns IntentPayload for channel open tx', async () => {
      enableBrokerMode();
      okJson({
        channelId: 'ch-abc-001',
        adjudicatorAddress: '0xAdjudicator',
        openCalldata: '0xcafe1234',
        gasLimit: '300000',
      });
      const provider = new YellowStateChannelProvider();
      const intent = await provider.createChannel(channelParams);

      expect(intent.intentId).toBeDefined();
      expect(intent.status).toBe('pending_user_review');
      expect(intent.tx.to).toBe('0xAdjudicator');
      expect(intent.tx.data).toBe('0xcafe1234');
      expect(intent.tx.value).toBe('500000000');
      expect(intent.authorization.defibroRelays).toBe(false);
      expect(intent.policy.warnings).toContainEqual(expect.stringMatching(/personal_sign/));
    });

    it('throws on HTTP error', async () => {
      enableBrokerMode();
      httpError(400);
      const provider = new YellowStateChannelProvider();
      await expect(provider.createChannel(channelParams)).rejects.toThrow(/HTTP 400/);
    });
  });

  describe('preparePayment()', () => {
    it('throws when broker mode not enabled', async () => {
      const provider = new YellowStateChannelProvider();
      await expect(
        provider.preparePayment({ channelId: 'ch-001', amount: '1000' }),
      ).rejects.toThrow(/broker mode/);
    });

    it('returns YellowPaymentResult with state update for personal_sign', async () => {
      enableBrokerMode();
      okJson({
        paymentId: 'pay-001',
        turnNum: 5,
        balanceA: '499000000',
        balanceB: '1000',
        stateHash: '0xStateHash',
        adjudicatorAddress: '0xAdjudicator',
        challengeDuration: 86400,
      });
      const provider = new YellowStateChannelProvider();
      const result = await provider.preparePayment({ channelId: 'ch-001', amount: '1000' });

      expect(result.paymentId).toBe('pay-001');
      expect(result.stateUpdate.turnNum).toBe(5);
      expect(result.stateUpdate.isFinal).toBe(false);
      expect(result.stateHash).toBe('0xStateHash');
      // Critical: this is NOT an eth_sendTransaction — it's an off-chain signature
      expect(result.stateUpdate.appData).toBe('0x');
    });
  });

  describe('getChannelState()', () => {
    it('returns channel state', async () => {
      enableBrokerMode();
      okJson({
        participantA: '0xUserWallet',
        participantB: '0xBroker',
        chainId: 1,
        assetToken: '0xUSDC',
        balanceA: '490000000',
        balanceB: '10000000',
        turnNum: 10,
        status: 'open',
        adjudicatorAddress: '0xAdj',
        openedAt: '2026-01-01T00:00:00.000Z',
      });
      const provider = new YellowStateChannelProvider();
      const state = await provider.getChannelState('ch-001');

      expect(state.channelId).toBe('ch-001');
      expect(state.status).toBe('open');
      expect(state.turnNum).toBe(10);
    });
  });

  describe('closeChannel()', () => {
    it('returns IntentPayload for cooperative close tx', async () => {
      enableBrokerMode();
      okJson({
        adjudicatorAddress: '0xAdjudicator',
        closeCalldata: '0xclose99',
        gasLimit: '200000',
        chainId: 1,
      });
      const provider = new YellowStateChannelProvider();
      const intent = await provider.closeChannel('ch-001');

      expect(intent.tx.to).toBe('0xAdjudicator');
      expect(intent.tx.data).toBe('0xclose99');
      expect(intent.authorization.defibroRelays).toBe(false);
      expect(intent.metadata.action).toBe('unstake');
    });
  });

  describe('call() dispatcher', () => {
    it('throws on unknown capability', async () => {
      const provider = new YellowStateChannelProvider();
      await expect(
        provider.call('swap.getQuote', {}, ctx()),
      ).rejects.toThrow(/unsupported capability/);
    });

    it('routes settlement.getChannelState', async () => {
      enableBrokerMode();
      okJson({
        participantA: '0xA', participantB: '0xB', chainId: 1,
        assetToken: '0xT', balanceA: '100', balanceB: '0',
        turnNum: 1, status: 'open', adjudicatorAddress: '0xAdj', openedAt: null,
      });
      const provider = new YellowStateChannelProvider();
      const result = await provider.call('settlement.getChannelState', { channelId: 'ch-001' }, ctx());
      expect(result.source.providerId).toBe('yellow-state-channel');
    });
  });
});
