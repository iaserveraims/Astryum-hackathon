/**
 * Regression: a websocket transport failure must never kill the backend.
 *
 * Production crash: the public Flare gateway answered the WS upgrade
 * with HTTP 429 (shared PaaS egress IP). `ws` emitted an Error, FlareProvider
 * re-emitted it on itself, nobody listens on the singleton — so Node threw it
 * as an uncaughtException from inside a socket callback, outside every
 * try/catch. The socket is OPTIONAL (every read already falls back to HTTP);
 * losing it must cost a log line, not the process.
 */

const mockCreated: any[] = [];
/** Flipped per test: true reproduces the 429 on the upgrade itself. */
const mockCtl = { failHandshake: false };

jest.mock('ethers', () => {
  const { EventEmitter } = require('events');

  class FakeSocket extends EventEmitter {}

  class FakeWebSocketProvider extends EventEmitter {
    websocket = new FakeSocket();
    // Real order on a rejected upgrade: `ws` emits 'error' first, and only
    // then does the awaited call reject.
    getNetwork = jest.fn().mockImplementation(() => {
      if (!mockCtl.failHandshake) return Promise.resolve({ chainId: 14n });
      this.websocket.emit('error', new Error('Unexpected server response: 429'));
      return Promise.reject(new Error('Unexpected server response: 429'));
    });
    destroy = jest.fn().mockResolvedValue(undefined);
    constructor(public url: string) {
      super();
      mockCreated.push(this);
    }
  }

  class FakeJsonRpcProvider extends EventEmitter {
    getNetwork = jest.fn().mockResolvedValue({ chainId: 14n });
  }

  return {
    ethers: {},
    Network: class {
      constructor(public name: string, public chainId: number) {}
    },
    WebSocketProvider: FakeWebSocketProvider,
    JsonRpcProvider: FakeJsonRpcProvider,
  };
});

import { FlareProvider } from '../FlareProvider';

/** The constructor is private by design; tests bypass the singleton. */
function makeProvider(overrides: Record<string, unknown> = {}): any {
  return new (FlareProvider as any)({ reconnectInterval: 1000, ...overrides });
}

const RATE_LIMIT = () => new Error('Unexpected server response: 429');

describe('FlareProvider — websocket failures are not fatal', () => {
  beforeEach(() => {
    mockCreated.length = 0;
    mockCtl.failHandshake = false;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does NOT throw when the socket errors and nothing listens', async () => {
    const provider = makeProvider();
    await provider.initializeWsProvider();

    const socket = mockCreated[0].websocket;
    expect(socket.listenerCount('error')).toBe(1);
    expect(provider.listenerCount('error')).toBe(0);

    // EventEmitter.emit is synchronous: if the error were re-emitted on an
    // emitter with no listener, Node would throw it right out of this call —
    // which in production is an uncaughtException, because there is no frame
    // above a socket callback to catch it.
    expect(() => socket.emit('error', RATE_LIMIT())).not.toThrow();
  });

  it('still delivers the error to a real listener', async () => {
    const provider = makeProvider();
    const seen: Error[] = [];
    provider.on('error', (e: Error) => seen.push(e));

    await provider.initializeWsProvider();
    mockCreated[0].websocket.emit('error', RATE_LIMIT());

    expect(seen.map((e) => e.message)).toEqual(['Unexpected server response: 429']);
  });

  it('survives a 429 on the handshake itself and keeps HTTP reads alive', async () => {
    mockCtl.failHandshake = true;
    const provider = makeProvider();

    // Must resolve, not reject: an optional socket failing is not an error the
    // boot sequence should have to handle.
    await expect(provider.initializeWsProvider()).resolves.toBeUndefined();

    // No dead socket left behind — getProvider() must fall back to HTTP.
    expect(provider.getWsProvider()).toBeNull();
    expect(mockCreated[0].destroy).toHaveBeenCalled();

    await provider.disconnect(); // don't leave the queued retry running
  });
});

describe('FlareProvider — reconnect backoff', () => {
  beforeEach(() => {
    mockCreated.length = 0;
    mockCtl.failHandshake = false;
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('backs off exponentially instead of hammering a rate-limited gateway', () => {
    const provider = makeProvider();
    const delays: number[] = [];
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any, ms: number) => {
      delays.push(ms);
      return { unref: () => undefined } as any;
    }) as any);

    for (let i = 0; i < 4; i++) {
      provider.reconnectTimer = null; // simulate each timer having fired
      provider.scheduleWsReconnect();
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('does not burn two attempts when error and close both fire', () => {
    const provider = makeProvider();
    provider.scheduleWsReconnect();
    provider.scheduleWsReconnect();

    expect(provider.reconnectAttempts).toBe(1);
  });

  it('never opens a socket when the ops kill-switch is off', async () => {
    const provider = makeProvider({ wsEnabled: false });
    await provider.initializeWsProvider();

    expect(mockCreated).toHaveLength(0);
    expect(provider.getWsProvider()).toBeNull();
  });
});
