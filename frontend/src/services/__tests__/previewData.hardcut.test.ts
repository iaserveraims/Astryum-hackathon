import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isPreviewActive } from '../previewData';
import { DEMO_FLAG_KEY, LIVE_FLAG_KEY, markLiveWalletSession } from '../../lib/demoMode';

/**
 * R2 HARD CUT — a session with a real wallet connected must NEVER receive fixtures.
 * isPreviewActive() is the single gate the fixture-serving paths (v1Api jget/jpost,
 * walletLinkService.listMyWallets) use.
 */
const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  delete process.env.NEXT_PUBLIC_PREVIEW_DATA;
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
    dispatchEvent: () => true,
  });
});

describe('R2 hard cut — isPreviewActive()', () => {
  it('serves fixtures in the public demo with NO wallet connected', () => {
    store[DEMO_FLAG_KEY] = '1';
    expect(isPreviewActive()).toBe(true);
  });

  it('KILLS fixtures the moment a real wallet is connected (live flag) — even in demo mode', () => {
    store[DEMO_FLAG_KEY] = '1';
    store[LIVE_FLAG_KEY] = '1';
    expect(isPreviewActive()).toBe(false); // a real-wallet session never sees sample data
  });

  it('honours the local-design env flag, but the wallet still wins', () => {
    process.env.NEXT_PUBLIC_PREVIEW_DATA = 'true';
    expect(isPreviewActive()).toBe(true);
    store[LIVE_FLAG_KEY] = '1';
    expect(isPreviewActive()).toBe(false);
  });

  it('no demo, no wallet → live (never fixtures by default)', () => {
    expect(isPreviewActive()).toBe(false);
  });

  it('§1.1 — the live mark is PERSISTED (localStorage), so it survives a reload with the wallet restored', () => {
    store[DEMO_FLAG_KEY] = '1';
    markLiveWalletSession(); // the real connect path writes the flag to localStorage
    expect(store[LIVE_FLAG_KEY]).toBe('1'); // it lives in localStorage, NOT in memory
    // "reload": localStorage (our `store`) persists; a fresh isPreviewActive() still sees it
    expect(isPreviewActive()).toBe(false); // demo + restored wallet ⇒ NO fixtures
  });
});
