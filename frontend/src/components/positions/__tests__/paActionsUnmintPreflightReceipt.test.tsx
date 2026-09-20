/**
 * it. 34 — «CONVERT TO XRP» FROM AN EVM WALLET, AND THE RECEIPT OF A CODE THAT
 * MINED — THE CONSUMER, NOT THE PIECES.
 *
 * What it. 31 proved and what it left: Kinetic (Compound v2) does not revert an
 * oversized redeem — `redeemUnderlying(1e12)` from an empty account RETURNS
 * 0x…09 (MATH_ERROR): the tx mines with status 1, gas is paid, nothing moves.
 * it. 31 attached the dry-run to `/iso-withdraw/prepare` and pulled two pure
 * functions out of this file to test them. Nobody ran the SCREEN:
 *
 *   (a) the `unmint` EVM branch called `/iso-withdraw/prepare` and the bridge,
 *       joined the calls and `setPrepared` WITHOUT `preflight` and WITHOUT
 *       `disclosure.supplyRead` — the review had no verdict to show and the
 *       button stayed green; `withdrawHuman = Math.min(want, supplyFxrpHuman)`
 *       sized the Kinetic leg over the props' snapshot when the live read had
 *       failed; the form still printed «FXRP in this position: 10» and offered
 *       «Position (10)» as MAX over that stale figure.
 *   (b) a receipt with status 1 and a Compound `Failure` log reached
 *       `SettlementIndicator` as SETTLED: «Done. The funds are back in your
 *       account.» over gas paid for nothing.
 *   (c) with `available: false` the amber said «the dry-run verdict below is the
 *       check» while PreflightNotice said there was none — and the button was
 *       the usual green.
 *
 * Here the REAL PaActionsModal is mounted on the hooks runtime that executes
 * effects (`miniReact`, it. 31): the live-legs fetch fails or answers, the
 * amount is typed through the input's onChange, «Review before signing» is
 * PRESSED, the two prepares are served by a fake network, and what is asserted
 * is the element tree the person would see: the amber, the absent MAX, the
 * PreflightNotice's prop and words, the button's posture. For (b) the wallet
 * partner is faked to return EXACTLY the handle useWalletPartner's single-call
 * rail returns on `receipt.status === 'success'` — a settled handle — and the
 * REAL tracker re-reads the receipt, logs included, before the real
 * SettlementIndicator prints anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const OWNER = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const XRPL_DEST = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const HASH = '0x' + 'ab'.repeat(32);
const t = (s: string) => s;

/* ── the boundary: hooks, shell, wallets, i18n, the network ─────────────────── */

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const { miniHooks } = await import('../../../lib/xrpl/__tests__/miniReact');
  // miniReact has no context; the modal reads ONE (the operation window) and
  // its default (null) is what a modal mounted outside a window sees.
  const useContext = (ctx: { _currentValue?: unknown }) => ctx?._currentValue ?? null;
  const dflt = (actual as unknown as { default?: object }).default ?? {};
  return { ...actual, ...miniHooks, useContext, default: { ...dflt, ...miniHooks, useContext } };
});
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const strip = (p: Record<string, unknown>) => {
    const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = p;
    void _i; void _a; void _e; void _t; void _l;
    return rest;
  };
  return {
    motion: new Proxy({}, { get: (_o, tag) => (props: Record<string, unknown>) => createElement(String(tag), strip(props)) }),
    AnimatePresence: ({ children }: { children?: unknown }) => children ?? null,
  };
});
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement('a', { href, ...rest }, children as never) };
});
vi.mock('@/components/ui/OperationSurface', async () => {
  const { createContext, createElement } = await import('react');
  return {
    OpWindowContext: createContext(null),
    OperationSurface: ({ children, title }: { children?: unknown; title?: string }) => createElement('div', { 'data-surface': title }, children as never),
    CloseOperationButton: ({ onClose }: { onClose: () => void }) => createElement('button', { onClick: onClose }, 'Close'),
  };
});
vi.mock('@/stores/operationStore', () => ({ useOperationStore: (sel: (s: unknown) => unknown) => sel({ minimizeActive: () => {} }) }));
vi.mock('@/stores/dockStore', () => ({ useDockStore: (sel: (s: unknown) => unknown) => sel({ docked: false, setDocked: () => {} }) }));
vi.mock('@/stores/motionStore', () => ({ useReducedMotion: () => true }));
vi.mock('@/i18n/LanguageProvider', () => ({ useT: () => ({ t, lang: 'en', setLang: () => {} }) }));
vi.mock('@/lib/env', () => ({ getApiBase: () => 'http://api.test' }));
vi.mock('@/lib/region', () => ({ getUserRegion: () => 'ES' }));
vi.mock('@/lib/wallet/useXrplWalletPartner', () => ({
  useXrplWalletPartner: () => ({ address: XRPL_DEST, isConnected: false, sendIntent: async () => ({ txHash: 'X' }) }),
}));
const sendIntentCalls = vi.fn();
vi.mock('@/lib/wallet/useWalletPartner', () => ({
  useWalletPartner: () => ({
    address: OWNER,
    isConnected: true,
    sendIntentCalls: (...a: unknown[]) => sendIntentCalls(...a),
  }),
}));
vi.mock('@/hooks/useMyWallets', () => ({
  useMyWallets: () => ({ wallets: [{ address: OWNER, chainId: 14, label: 'MetaMask', ecosystem: 'evm' }], loading: false, reload: () => {} }),
}));
vi.mock('@/lib/wallet/paOwnership', () => ({ useOwningXrpl: () => ({ owningXrpl: null, loading: false }) }));
vi.mock('@/lib/flare/carrier', () => ({ useCarrierXrp: () => 1 }));
vi.mock('@/hooks/useXrpUsdPrice', () => ({ useXrpUsdPrice: () => null }));
vi.mock('@/lib/wallet/handoffRelease', () => ({ releaseHandoffSeat: () => {} }));
vi.mock('@/lib/xaman/liveRequests', () => ({ noteFlareInstructionDelivery: () => {} }));
vi.mock('@/lib/errors/translateError', () => ({ translateError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) }) }));
vi.mock('@/lib/xaman/seatRefusal', () => ({ refusalHeadline: (r: { error?: string } | null) => r?.error ?? null, serverDetailIfEnglish: (d: unknown) => (typeof d === 'string' ? d : null) }));
vi.mock('@/components/wallet/SeatRefusalNotice', () => ({ SeatRefusalNotice: () => null, seatRefusalSentence: () => null }));
vi.mock('@/components/settlement/UnconfirmedSignatureNotice', () => ({ UnconfirmedSignatureNotice: () => null }));
vi.mock('@/components/settlement/SignedMark', () => ({ SignedMark: () => null }));
vi.mock('@/lib/fassets/RedemptionFeeNotice', () => ({ RedemptionFeeNotice: () => null }));
vi.mock('@/components/positions/DestinationField', () => ({ DestinationField: () => null }));
vi.mock('@/components/positions/DispatchXrpField', () => ({ DispatchXrpField: () => null }));
vi.mock('@/components/wallet/WalletSelect', () => ({ WalletSelect: () => null }));

/** The receipt the chain answers when the tracker asks (the ONE read of it. 34). */
let receiptOnChain: { status: unknown; logs?: Array<{ topics: string[]; data: string; address?: string }> } | null = null;
// useSettlement's React shell needs wagmi; here it is the same contract over the
// REAL tracker (trackSettlement) with the chain read faked at the edge.
vi.mock('@/lib/settlement/useSettlement', async () => {
  const { miniHooks } = await import('../../../lib/xrpl/__tests__/miniReact');
  const { trackSettlement } = await import('../../../lib/settlement/tracker');
  return {
    useSettlement: () => {
      const [state, setState] = miniHooks.useState<unknown>(null);
      const cancel = miniHooks.useRef<(() => void) | null>(null);
      return {
        state,
        track: (
          handle: import('../../../lib/settlement/settlement').SettlementState,
          cbs?: { onSettled?: (s: unknown) => void; onFailed?: (r: unknown, s: unknown) => void },
          opts?: { opKey?: string },
        ) => {
          cancel.current?.();
          cancel.current = trackSettlement(
            handle,
            {
              getCallsStatus: async () => ({ status: 'PENDING' }),
              getTxReceipt: async () => receiptOnChain,
              getMintStatus: async () => null,
              getXrplTxVerdict: async () => ({ kind: 'unreadable' }) as never,
              getCouncilOrderExecuted: async () => null,
              now: () => Date.now(),
              setTimer: (fn, ms) => setTimeout(fn, ms),
              clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
            },
            {
              opKey: opts?.opKey,
              onUpdate: (s) => {
                setState(s);
                if (s.status === 'settled') cbs?.onSettled?.(s);
                if (s.status === 'failed') cbs?.onFailed?.(s.reason, s);
              },
            },
          );
        },
        adopt: () => {},
        reset: () => {
          cancel.current?.();
          cancel.current = null;
          setState(null);
        },
      };
    },
  };
});

import { PaActionsModal } from '../PaActionsModal';
import { PreflightNotice } from '../../preflight/PreflightNotice';
import { SettlementIndicator } from '../../settlement/SettlementIndicator';
import { AmountSliderUsd } from '../AmountSliderUsd';
import { COMPOUND_FAILURE_TOPIC, startPending, toSettled } from '../../../lib/settlement/settlement';
import { findButton, findElement, mount, press, settle, textOf, type MiniInstance } from '../../../lib/xrpl/__tests__/miniReact';

/* ── the network, faked at the edge ─────────────────────────────────────────── */

interface Served {
  status: number;
  body: unknown;
}
let legs: Served;
let isoWithdraw: Served;
let bridge: Served;
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubNetwork(): void {
  calls = [];
  global.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: u, body });
    const answer = (s: Served) => ({ ok: s.status >= 200 && s.status < 300, status: s.status, json: async () => s.body });
    if (u.includes('/flare-demo/iso-legs/')) return answer(legs);
    if (u.includes('/flare-demo/pa-fxrp/')) return answer({ status: 200, body: { freeFxrp: 0, redeemMinimumXrp: 5 } });
    if (u.endsWith('/flare-demo/iso-withdraw/prepare')) return answer(isoWithdraw);
    if (u.endsWith('/wallet-transfer/bridge/flare-to-xrpl/prepare')) return answer(bridge);
    return answer({ status: 404, body: { error: 'UNMOCKED_ROUTE', url: u } });
  }) as unknown as typeof fetch;
}
const called = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix));

/** kFXRP_ISO's log on a refused redeem: Failure(9 MATH_ERROR, 45, 0). */
const KINETIC_FAILURE_LOG = {
  address: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3',
  topics: [COMPOUND_FAILURE_TOPIC],
  data: '0x' + '9'.padStart(64, '0') + '2d'.padStart(64, '0') + '0'.repeat(64),
};

/** What /iso-withdraw/prepare answers when its own supply read failed (it. 29/31 shape). */
const ISO_WITHDRAW_UNREAD = (preflight: unknown) => ({
  status: 200,
  body: {
    rail: 'evm',
    chainId: 14,
    account: OWNER,
    calls: [{ to: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3', data: '0x852a12e3' + '0'.repeat(64), value: '0', chainId: 14, label: 'Withdraw FXRP' }],
    preflight,
    disclosure: { action: 'iso-withdraw-fxrp', asset: 'fxrp', amount: 12, all: false, availableBase: null, available: null, supplyRead: 'unreadable' },
  },
});
const PREFLIGHT_FAIL_9 = {
  available: true,
  willSucceed: false,
  reason: 'withdraw FXRP from ISO — Kinetic would refuse: MATH_ERROR',
  steps: [{ label: 'withdraw FXRP from ISO', verdict: 'fail', reason: 'Kinetic would refuse: MATH_ERROR' }],
};
const PREFLIGHT_UNAVAILABLE = { available: false, willSucceed: false, reason: 'dry-run unavailable: eth_call timed out after 8000ms', steps: [] };
/** What the bridge answers when told `dependsOnPrior` (it. 34): blind by design. */
const BRIDGE_BLIND = {
  status: 200,
  body: {
    rail: 'evm',
    calls: [{ to: '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8', data: '0xdeadbeef', value: '0', chainId: 14 }],
    preflight: {
      available: false,
      willSucceed: false,
      reason: 'no step of this batch can be dry-run in isolation on this node',
      steps: [{ label: 'redeem FXRP to XRP', verdict: 'unverified', reason: 'depends on an earlier step of this same batch — cannot be dry-run in isolation' }],
    },
    disclosure: { action: 'bridge-redeem-fxrp', amount: 12, redemptionFeeBips: 18, redemptionFeeFxrp: 0.0216 },
  },
};

/* ── driving the screen ─────────────────────────────────────────────────────── */

let root: MiniInstance | null = null;
const onChanged = vi.fn();
const onClose = vi.fn();

function open(action: 'unmint' | 'withdraw' | 'repay'): MiniInstance {
  root = mount(
    PaActionsModal as never,
    // The props are the portfolio SNAPSHOT — 10 FXRP that may be stale.
    { owner: OWNER, legs: { supplyFxrpBase: '10000000', debtUsdt0Base: '2000000' }, action, onClose, onChanged },
    [PreflightNotice as never, SettlementIndicator as never],
  );
  return root;
}
const tree = () => root!.tree;
const text = () => textOf(tree());
function typeAmount(value: string): void {
  const input = findElement(tree(), (el) => el.type === 'input' && (el.props as { type?: string }).type === 'number');
  if (!input) throw new Error('no amount input on screen');
  (input.props as { onChange: (e: { target: { value: string } }) => void }).onChange({ target: { value } });
}
const preflightNoticeEl = () => findElement(tree(), (el) => el.type === PreflightNotice);
const preflightNoticeText = () => textOf(root!.child(PreflightNotice as never)?.tree ?? null);
const signButton = () => findElement(tree(), (el) => typeof (el.props as { 'data-posture'?: string })['data-posture'] === 'string');
const indicatorText = () => textOf(root!.child(SettlementIndicator as never)?.tree ?? null);

beforeEach(() => {
  stubNetwork();
  sendIntentCalls.mockReset();
  onChanged.mockReset();
  onClose.mockReset();
  receiptOnChain = null;
  legs = { status: 200, body: { supplyFxrpBase: '10000000', suppliedUsdt0Base: null, debtUsdt0Base: '2000000' } };
  isoWithdraw = ISO_WITHDRAW_UNREAD(PREFLIGHT_FAIL_9);
  bridge = BRIDGE_BLIND;
});
afterEach(() => {
  root?.unmount();
  root = null;
});

/* ── (a) «Convert to XRP», EVM wallet, live legs unread ─────────────────────── */

describe('(a) Convert to XRP from an EVM wallet with the live legs UNREAD', () => {
  beforeEach(() => {
    legs = { status: 502, body: { error: 'ISO_LEGS_UNREADABLE' } };
  });

  it('the form says «could not be read», offers NO «Position (10)» MAX over the snapshot, and the slider has no ceiling', async () => {
    open('unmint');
    await settle();
    expect(text()).toContain('could not be read');
    expect(text()).toContain('Kinetic does not reject a withdrawal larger than your position');
    expect(text()).not.toContain('10 FXRP'); // the stale snapshot is not printed as a figure
    expect(findButton(tree(), 'Position (')).toBeNull();
    expect(findButton(tree(), 'Try again')).not.toBeNull();
    const slider = findElement(tree(), (el) => el.type === AmountSliderUsd);
    expect((slider?.props as { max: number }).max).toBe(0);
  });

  it('prepare sizes the Kinetic leg over the amount TYPED (never min(want, stale 10)), tells the bridge it depends on it, and the review carries the merged preflight', async () => {
    open('unmint');
    await settle();
    typeAmount('12');
    await settle();
    press(findButton(tree(), 'Review before signing'), 'Review before signing');
    await settle(12);

    // The Kinetic leg: 12 FXRP, the figure typed — not Math.min(12, 10-from-props).
    const w = called('/flare-demo/iso-withdraw/prepare');
    expect(w).toHaveLength(1);
    expect(w[0].body).toMatchObject({ evmAddress: OWNER, asset: 'fxrp', amountBase: '12000000' });
    // The redeem leg is told it rides after the withdraw (no false «would FAIL»).
    const b = called('/wallet-transfer/bridge/flare-to-xrpl/prepare');
    expect(b).toHaveLength(1);
    expect(b[0].body).toMatchObject({ evmWallet: OWNER, xrplDestination: XRPL_DEST, amountXrp: '12', dependsOnPrior: true });

    // The review is on screen with the verdict — the prop PreflightNotice receives…
    const notice = preflightNoticeEl();
    expect(notice).not.toBeNull();
    const pf = (notice!.props as { preflight: { available: boolean; willSucceed: boolean; reason?: string; steps?: unknown[] } }).preflight;
    expect(pf.available).toBe(true);
    expect(pf.willSucceed).toBe(false);
    expect(pf.reason).toMatch(/MATH_ERROR/);
    expect(pf.steps).toHaveLength(2); // the Kinetic verdict + the blind redeem leg
    // …and the words the person reads.
    expect(preflightNoticeText()).toMatch(/it would FAIL/);
    // The it. 29 admission travelled too: the amber points at the verdict that exists.
    expect(text()).toContain('Your live supply could not be read');
    expect(text()).toContain('The dry-run verdict below is the check');
    // And the button is the red «sign anyway», not the green.
    const btn = signButton();
    expect((btn!.props as { 'data-posture': string })['data-posture']).toBe('fail');
    expect(textOf(btn)).toContain('Sign anyway — the dry-run says it will fail');
  });

  it('(c) with the dry-run UNAVAILABLE the amber says NOTHING checked this, and the button is not the green of a verified operation', async () => {
    isoWithdraw = ISO_WITHDRAW_UNREAD(PREFLIGHT_UNAVAILABLE);
    open('unmint');
    await settle();
    typeAmount('12');
    await settle();
    press(findButton(tree(), 'Review before signing'), 'Review before signing');
    await settle(12);

    const pf = (preflightNoticeEl()!.props as { preflight: { available: boolean } }).preflight;
    expect(pf.available).toBe(false);
    expect(preflightNoticeText()).toMatch(/We couldn't test this operation in advance/);
    expect(text()).toContain('NOTHING has checked this operation');
    expect(text()).not.toContain('The dry-run verdict below is the check');
    const btn = signButton();
    expect((btn!.props as { 'data-posture': string })['data-posture']).toBe('unchecked');
    expect(textOf(btn)).toContain('Sign without a dry-run');
    expect(textOf(btn)).not.toBe('Sign in wallet');
  });

  it('CONTROL — legs READ: the figure and «Position (10)» are back, and a 12 over a 10 position is refused before any prepare', async () => {
    legs = { status: 200, body: { supplyFxrpBase: '10000000', suppliedUsdt0Base: null, debtUsdt0Base: null } };
    open('unmint');
    await settle();
    expect(text()).toContain('10 FXRP');
    expect(findButton(tree(), 'Position (')).not.toBeNull();
    typeAmount('12');
    await settle();
    press(findButton(tree(), 'Review before signing'), 'Review before signing');
    await settle(12);
    expect(text()).toContain('More than you can redeem:');
    expect(called('/flare-demo/iso-withdraw/prepare')).toHaveLength(0);
  });

  it('CONTROL — legs READ and 8 of 10: the Kinetic leg is min(want, position) = 8 and the merged verdict is a PARTIAL green', async () => {
    legs = { status: 200, body: { supplyFxrpBase: '10000000', suppliedUsdt0Base: null, debtUsdt0Base: null } };
    isoWithdraw = {
      status: 200,
      body: {
        ...ISO_WITHDRAW_UNREAD(null).body,
        preflight: { available: true, willSucceed: true, steps: [{ label: 'withdraw FXRP from ISO', verdict: 'ok' }] },
        disclosure: { action: 'iso-withdraw-fxrp', asset: 'fxrp', amount: 8, availableBase: '10000000', supplyRead: 'live' },
      },
    };
    open('unmint');
    await settle();
    typeAmount('8');
    await settle();
    press(findButton(tree(), 'Review before signing'), 'Review before signing');
    await settle(12);
    expect(called('/flare-demo/iso-withdraw/prepare')[0].body.amountBase).toBe('8000000');
    const pf = (preflightNoticeEl()!.props as { preflight: { available: boolean; willSucceed: boolean; partial?: boolean } }).preflight;
    expect(pf).toMatchObject({ available: true, willSucceed: true, partial: true });
    expect(preflightNoticeText()).toMatch(/Partial dry-run/);
    expect(text()).not.toContain('Your live supply could not be read');
    expect((signButton()!.props as { 'data-posture': string })['data-posture']).toBe('ok');
  });
});

/* ── repay: the same «could not be read» ────────────────────────────────────── */

describe('repay form with the live legs UNREAD', () => {
  it('prints «could not be read» with a retry instead of the snapshot figures', async () => {
    legs = { status: 502, body: { error: 'ISO_LEGS_UNREADABLE' } };
    open('repay');
    await settle();
    expect(text()).toContain('could not be read');
    // The tiles carry a dash, not the snapshot's 10 FXRP / 2 USDT0.
    expect(text()).toContain('FXRP collateral—');
    expect(text()).toContain('USDT0 debt—');
    expect(text()).not.toContain('FXRP collateral10');
    expect(findButton(tree(), 'Try again')).not.toBeNull();
  });
  it('CONTROL — legs read: the figures print', async () => {
    open('repay');
    await settle();
    expect(text()).not.toContain('could not be read');
    expect(text()).toContain('FXRP collateral10');
    expect(text()).toContain('USDT0 debt2');
  });
});

/* ── (b) the receipt of a code that mined ───────────────────────────────────── */

describe('(b) a status-1 receipt with a Compound Failure never reaches the screen as «Done»', () => {
  const ISO_WITHDRAW_OK = {
    status: 200,
    body: {
      rail: 'evm',
      chainId: 14,
      account: OWNER,
      calls: [{ to: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3', data: '0x852a12e3' + '0'.repeat(64), value: '0', chainId: 14, label: 'Withdraw FXRP' }],
      preflight: { available: true, willSucceed: true, steps: [{ label: 'withdraw FXRP from ISO', verdict: 'ok' }] },
      disclosure: { action: 'iso-withdraw-fxrp', asset: 'fxrp', amount: 3, availableBase: '10000000', supplyRead: 'live' },
    },
  };

  async function signWithdraw(): Promise<void> {
    isoWithdraw = ISO_WITHDRAW_OK;
    // EXACTLY what useWalletPartner's single-call rail hands back once
    // `waitForTransactionReceipt` answered `status: 'success'`: a SETTLED handle.
    sendIntentCalls.mockResolvedValue({ txHash: HASH, handle: toSettled(startPending('evm', HASH, undefined, 14)) });
    open('withdraw');
    await settle();
    typeAmount('3');
    await settle();
    press(findButton(tree(), 'Review before signing'), 'Review before signing');
    await settle(12);
    press(findButton(tree(), 'Sign in wallet'), 'Sign in wallet');
    await settle(12);
  }

  it('mined without effect: the receipt says FAILED with the Kinetic code, not «Done. The funds are back in your account.» — and the parent is not told anything changed', async () => {
    receiptOnChain = { status: 'success', logs: [KINETIC_FAILURE_LOG] };
    await signWithdraw();
    expect(sendIntentCalls).toHaveBeenCalledTimes(1);
    const said = indicatorText();
    expect(said).toContain('The signed operation failed on-chain.');
    expect(said).toContain('was mined and the network fee was spent');
    expect(said).toContain('Kinetic code 9 · MATH_ERROR');
    expect(said).not.toContain('Done. The funds are back in your account.');
    // The close button under a final failure is «Close», never «Done» nor «Keep waiting».
    expect(findButton(tree(), 'Done')).toBeNull();
    expect(findButton(tree(), 'Keep waiting in the background')).toBeNull();
    expect(findButton(tree(), 'Close')).not.toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('CONTROL — a clean status-1 receipt still reads «Done. The funds are back in your account.» and refreshes the parent', async () => {
    receiptOnChain = { status: 'success', logs: [] };
    await signWithdraw();
    expect(indicatorText()).toContain('Done. The funds are back in your account.');
    expect(findButton(tree(), 'Done')).not.toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

// Keep the type import alive for the element helpers above.
export type _El = ReactElement;
