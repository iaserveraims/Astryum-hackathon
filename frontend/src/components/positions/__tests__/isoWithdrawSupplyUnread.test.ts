import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../legacy/__tests__/extractFromSource';
import { describeRetryableRefusal } from '../../../lib/xaman/seatRefusal';
import { preflightSaysFail } from '../../../lib/preflight';

/**
 * Frontend half — «KINETIC REVIERTE» ERA FALSO, and the screen
 * that composes the exact-amount exit had no eye for the admission the route
 * made in, nor a «could not be read» in
 * the withdraw form outside DERISK.
 */

const MODAL = join(__dirname, '..', 'PaActionsModal.tsx');
const src = readFileSync(MODAL, 'utf8');

const isoSupplyUnread = extract<(d: Record<string, unknown> | null | undefined) => boolean>(
  src,
  'function isoSupplyUnread(disclosure: Record<string, unknown> | null | undefined): boolean {',
  'function isoSupplyUnread(disclosure) {',
  'isoSupplyUnread',
);

const vaultFigureState = extract<(i: { legsLoading: boolean; legsReadFailed: boolean }) => 'loading' | 'unread' | 'figure'>(
  src,
  "function vaultFigureState(input: { legsLoading: boolean; legsReadFailed: boolean }): 'loading' | 'unread' | 'figure' {",
  'function vaultFigureState(input) {',
  'vaultFigureState',
);

const t = (s: string) => s;

describe('The review step consumes supplyRead', () => {
  it('The admission is recognised — only by its exact word', () => {
    // What /iso-withdraw/prepare returns with the supply unread (shape).
    expect(isoSupplyUnread({ action: 'iso-withdraw-fxrp', amount: 2, supplyRead: 'unreadable', availableBase: null })).toBe(true);
    // A LIVE read is not an admission.
    expect(isoSupplyUnread({ action: 'iso-withdraw-fxrp', amount: 2, supplyRead: 'live', availableBase: '3000000' })).toBe(false);
    // An older route without the key is not an admission either; neither is garbage.
    expect(isoSupplyUnread({ action: 'pa-withdraw-transfer:fxrp' })).toBe(false);
    expect(isoSupplyUnread({ supplyRead: 'UNREADABLE' })).toBe(false);
    expect(isoSupplyUnread(undefined)).toBe(false);
    expect(isoSupplyUnread(null)).toBe(false);
  });

  it('the dry-run that /iso-withdraw now attaches gates the button: code 9 decoded = a PROVEN failure', () => {
    // The exact `preflight` the route produces when the fake/real node answers
    // MATH_ERROR (preparePreflight decodes the returned uint).
    const preflight = {
      available: true,
      willSucceed: false,
      reason: 'withdraw FXRP from ISO — Kinetic would refuse: MATH_ERROR',
      steps: [{ label: 'withdraw FXRP from ISO', verdict: 'fail' as const, reason: 'Kinetic would refuse: MATH_ERROR' }],
    };
    // «Sign anyway — the dry-run says it will fail» is what the button reads on this.
    expect(preflightSaysFail(preflight)).toBe(true);
    // CONTROL — a green verdict, and a dry-run that could not run, do not gate.
    expect(preflightSaysFail({ available: true, willSucceed: true })).toBe(false);
    expect(preflightSaysFail({ available: false, willSucceed: false, reason: 'dry-run unavailable' })).toBe(false);
  });
});

describe('The withdraw form prints «could not be read», not the stale snapshot — outside DERISK too', () => {
  it('a failed live read is "unread": no figure, no MAX over it', () => {
    expect(vaultFigureState({ legsLoading: false, legsReadFailed: true })).toBe('unread');
  });
  it('loading is loading; a read that answered is a figure', () => {
    expect(vaultFigureState({ legsLoading: true, legsReadFailed: false })).toBe('loading');
    expect(vaultFigureState({ legsLoading: false, legsReadFailed: false })).toBe('figure');
  });
  it('while loading, a previous failure does not print as unread (the retry is in flight)', () => {
    expect(vaultFigureState({ legsLoading: true, legsReadFailed: true })).toBe('loading');
  });
});

describe('The refusal sentence no longer sells «it composes» as the whole story', () => {
  it('ISO_SUPPLY_UNREADABLE says: a code, the tx mines, gas is paid, nothing moves — and points at the dry-run', () => {
    const v = describeRetryableRefusal({ status: 502, error: 'ISO_SUPPLY_UNREADABLE', retryable: true }, t);
    expect(v).not.toBeNull();
    expect(v!.mayRetry).toBe(true);
    const said = v!.text;
    // The door that stays open is still named…
    expect(said).toMatch(/exact amount still composes/i);
    // …with what guards it, said plainly.
    expect(said).toMatch(/does not reject an oversized withdrawal/i);
    expect(said).toMatch(/returns a code/i);
    expect(said).toMatch(/transaction mines/i);
    expect(said).toMatch(/you pay gas/i);
    expect(said).toMatch(/nothing moves/i);
    expect(said).toMatch(/dry-run/i);
    // Never a revert promise, never the code, never a verdict about the person.
    expect(said).not.toMatch(/revert/i);
    expect(said).not.toContain('ISO_SUPPLY_UNREADABLE');
    expect(said).not.toMatch(/you have nothing|no supply/i);
    expect(said).toMatch(/Nothing moved\./);
    // The reader appends the retry line itself — one «try again», not two.
    expect(said.match(/again in a moment/g)?.length ?? 0).toBe(1);
  });
});
