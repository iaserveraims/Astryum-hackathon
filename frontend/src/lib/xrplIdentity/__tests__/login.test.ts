/**
 * The front door's re-ask behaviour.
 *
 * XRP Identity keeps its own SSO cookie: without `prompt=login` a second visit
 * walks straight back into whichever account is still signed in there — which
 * is wrong after an explicit logout, and impossible to escape on a shared
 * machine. These tests pin the three states of that decision.
 *
 * `prompt=select_account` is NOT an option: probed against account.xrpl.in on
 * 2026-08-17 it answers `unsupported prompt value requested` (node-oidc-provider
 * ships only the default prompt set). `login` is the strongest re-ask available.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginXrplIdentityLogin,
  isXrplIdentityPopupCallback,
  openXrplIdentityPopup,
  requestAccountChoiceOnNextLogin,
  runXrplIdentityPopupLogin,
  stateSaysPopup,
  XRPLID_MESSAGE,
} from '../login';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

const CONFIG = {
  clientId: 'test-client',
  authorizeUrl: 'https://account.xrpl.in/auth',
  scopes: 'openid profile email',
  redirectUris: ['https://astryum.xyz/auth/xrpl-identity/callback'],
};

let assign: ReturnType<typeof vi.fn>;
let listeners: Set<(e: unknown) => void>;

/** A stand-in for the window we opened, plus the ability to answer as it. */
function fakePopup() {
  return { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
}

/** Deliver a message event to whatever the module is listening with. */
function deliver(event: Record<string, unknown>) {
  for (const fn of listeners) fn(event);
}

/** The URL the popup was actually sent to. */
async function popupNavigated(popup: ReturnType<typeof fakePopup>): Promise<URL> {
  for (let i = 0; i < 60; i++) {
    if (popup.location.href !== 'about:blank') return new URL(popup.location.href);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the popup was never navigated');
}

/** The authorize URL the module tried to leave for. */
async function authorizeUrl(opts?: { forceAccountChoice?: boolean }): Promise<URL> {
  assign.mockClear();
  await beginXrplIdentityLogin('/app', opts);
  expect(assign).toHaveBeenCalledTimes(1);
  return new URL(assign.mock.calls[0][0] as string);
}

beforeEach(() => {
  assign = vi.fn();
  listeners = new Set();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', {
    location: { origin: 'https://astryum.xyz', assign },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'message') listeners.delete(fn);
    },
    open: vi.fn(),
    opener: null as unknown,
    screenX: 0,
    screenY: 0,
    outerWidth: 1440,
    outerHeight: 900,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => CONFIG }) as unknown as Response),
  );
});

describe('beginXrplIdentityLogin', () => {
  it('rides the provider SSO by default — no prompt on the plain path', async () => {
    const url = await authorizeUrl();
    expect(url.searchParams.get('prompt')).toBeNull();
    // and the PKCE contract stays intact
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('test-client');
  });

  it('asks again when the caller forces the choice ("use a different account")', async () => {
    const url = await authorizeUrl({ forceAccountChoice: true });
    expect(url.searchParams.get('prompt')).toBe('login');
  });

  it('asks again on the first login after a logout, then only once', async () => {
    requestAccountChoiceOnNextLogin();

    const first = await authorizeUrl();
    expect(first.searchParams.get('prompt')).toBe('login');

    // The flag is one-shot: a user who logged out, came back and signed in
    // should not be re-challenged forever.
    const second = await authorizeUrl();
    expect(second.searchParams.get('prompt')).toBeNull();
  });

  it('consumes the flag even when the caller already forced the choice', async () => {
    requestAccountChoiceOnNextLogin();

    const forced = await authorizeUrl({ forceAccountChoice: true });
    expect(forced.searchParams.get('prompt')).toBe('login');

    const next = await authorizeUrl();
    expect(next.searchParams.get('prompt')).toBeNull();
  });

  it('survives storage being unavailable (private mode) without blocking the door', async () => {
    const denied = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    vi.stubGlobal('localStorage', denied);

    expect(() => requestAccountChoiceOnNextLogin()).not.toThrow();
    const url = await authorizeUrl();
    expect(url.searchParams.get('prompt')).toBeNull();
  });
});

describe('the popup journey', () => {
  it('reports a blocked popup instead of pretending it opened', () => {
    (window.open as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(openXrplIdentityPopup()).toBeNull();

    // A window that opens already closed is blocked too (some blockers do this).
    (window.open as ReturnType<typeof vi.fn>).mockReturnValue({ closed: true });
    expect(openXrplIdentityPopup()).toBeNull();
  });

  it('sends the popup to the provider and brings the code home', async () => {
    const popup = fakePopup();
    const pending = runXrplIdentityPopupLogin(popup as unknown as Window, '/app/home');

    const url = await popupNavigated(popup);
    expect(url.origin + url.pathname).toBe('https://account.xrpl.in/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    deliver({
      origin: 'https://astryum.xyz',
      source: popup,
      data: { type: XRPLID_MESSAGE, code: 'abc', state: url.searchParams.get('state') },
    });

    const handed = await pending;
    expect(handed?.code).toBe('abc');
    expect(handed?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(handed?.returnTo).toBe('/app/home');
    expect(popup.close).toHaveBeenCalled();
  });

  it('refuses a code that comes from anywhere but the window we opened', async () => {
    const popup = fakePopup();
    const pending = runXrplIdentityPopupLogin(popup as unknown as Window, '/app/home');
    const url = await popupNavigated(popup);
    const state = url.searchParams.get('state');

    // Right shape, wrong origin — someone else's page trying to seed us a code.
    deliver({ origin: 'https://evil.example', source: popup, data: { type: XRPLID_MESSAGE, code: 'evil', state } });
    // Right origin, wrong window.
    deliver({ origin: 'https://astryum.xyz', source: {}, data: { type: XRPLID_MESSAGE, code: 'evil', state } });

    // Neither settled it: the user closing the window is what ends this.
    popup.closed = true;
    await expect(pending).resolves.toBeNull();
  });

  it('rejects a state that does not match the request that left this browser', async () => {
    const popup = fakePopup();
    const pending = runXrplIdentityPopupLogin(popup as unknown as Window, '/app/home');
    await popupNavigated(popup);

    deliver({
      origin: 'https://astryum.xyz',
      source: popup,
      data: { type: XRPLID_MESSAGE, code: 'abc', state: 'not-the-state-we-sent' },
    });

    await expect(pending).rejects.toThrow('state_mismatch');
  });

  it('surfaces a provider error rather than hanging on a window that will never answer', async () => {
    const popup = fakePopup();
    const pending = runXrplIdentityPopupLogin(popup as unknown as Window, '/app/home');
    await popupNavigated(popup);

    deliver({ origin: 'https://astryum.xyz', source: popup, data: { type: XRPLID_MESSAGE, error: 'access_denied' } });

    await expect(pending).rejects.toThrow('access_denied');
  });
});

describe('isXrplIdentityPopupCallback', () => {
  it('needs BOTH the popup state and an opener — a /login tab opened with target=_blank is not a popup', () => {
    expect(isXrplIdentityPopupCallback('p-abc')).toBe(false); // opener is null

    (window as unknown as { opener: unknown }).opener = {};
    expect(isXrplIdentityPopupCallback('p-abc')).toBe(true);

    // A tab that HAS an opener but was never our popup: it must log in itself,
    // not post its code into whatever page happened to open it.
    expect(isXrplIdentityPopupCallback('r-abc')).toBe(false);
    expect(isXrplIdentityPopupCallback(null)).toBe(false);
  });

  /**
   * REGRESSION (broke production 2026-08-18). The marker used to live in
   * sessionStorage, written after `window.open`. A popup's storage is a COPY
   * taken AT open, so the popup came home to a snapshot that never contained
   * it: it decided it was not a popup, tried to redeem the code with PKCE
   * material it did not have either, and died showing a CSRF warning while the
   * opener waited forever. The fix is that the marker travels in the URL.
   */
  it('survives a popup whose storage is a snapshot from before the attempt', async () => {
    const openerStorage = memoryStorage();
    vi.stubGlobal('sessionStorage', openerStorage);

    // The clone the popup will get: taken NOW, before anything is written.
    const popupStorageSnapshot = memoryStorage();

    const popup = fakePopup();
    const pending = runXrplIdentityPopupLogin(popup as unknown as Window, '/app');
    const url = await popupNavigated(popup);
    const state = url.searchParams.get('state');

    // Everything the attempt wrote lives in the opener, invisible to the popup.
    expect(openerStorage.getItem('xrplid_pkce_verifier')).toBeTruthy();
    expect(popupStorageSnapshot.getItem('xrplid_pkce_verifier')).toBeNull();

    // Now BE the popup: empty storage, an opener, and the state from the URL.
    vi.stubGlobal('sessionStorage', popupStorageSnapshot);
    (window as unknown as { opener: unknown }).opener = {};
    expect(stateSaysPopup(state)).toBe(true);
    expect(isXrplIdentityPopupCallback(state)).toBe(true);

    // And the opener, with its own storage back, still redeems the answer.
    vi.stubGlobal('sessionStorage', openerStorage);
    deliver({
      origin: 'https://astryum.xyz',
      source: popup,
      data: { type: XRPLID_MESSAGE, code: 'abc', state },
    });
    await expect(pending).resolves.toMatchObject({ code: 'abc' });
  });

  it('marks the two journeys apart in the state itself', async () => {
    const popup = fakePopup();
    const pending = runXrplIdentityPopupLogin(popup as unknown as Window, '/app');
    const popupUrl = await popupNavigated(popup);
    expect(popupUrl.searchParams.get('state')).toMatch(/^p-/);
    popup.closed = true;
    await pending;

    const redirectUrl = await authorizeUrl();
    expect(redirectUrl.searchParams.get('state')).toMatch(/^r-/);
  });
});
