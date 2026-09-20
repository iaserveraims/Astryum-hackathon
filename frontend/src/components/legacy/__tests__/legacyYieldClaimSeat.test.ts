import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extractFromSource';
import { signOutcome } from '@/lib/wallet/signOutcome';
import { describeSeatRefusal, type SeatRefusalLike } from '@/lib/xaman/seatRefusal';
import {
  describeStaleSignature,
  normalizeSeatRefusal,
} from '@/components/wallet/SeatRefusalNotice';

/**
 * R5 1.7 — EL ASIENTO QUE SE QUEDABA TOMADO POR DECIR QUE SÍ
 * DEMASIADO PRONTO.
 *
 * LegacyYieldPanel marked the claim as «handed to Xaman» BEFORE calling the
 * wallet, so declining the request on the phone left the nonce seat of that 0xFE
 * taken until its TTL: the heir could not prepare another claim, «Back» refused
 * to free it, and nothing on screen said why. The rule is now the wallet's
 * answer, not the click — and these run the SHIPPING functions, extracted from
 * the .tsx (the vitest env is `node`: importing the component drags the wallet
 * stack in).
 */

const src = readFileSync(join(__dirname, '..', 'LegacyYieldPanel.tsx'), 'utf8');

type ClaimSeatFate = 'still-unsigned' | 'stale' | 'maybe-signed';

const claimSeatAfterSignFailure = extract<(err: unknown) => ClaimSeatFate>(
  src,
  'function claimSeatAfterSignFailure(err: unknown): ClaimSeatFate {',
  'function claimSeatAfterSignFailure(err) {',
  'claimSeatAfterSignFailure',
  // The stale reader is the REAL one: passing it in is what proves this panel
  // delegates the «too late» verdict instead of keeping a copy that can drift.
  { signOutcome, describeStaleSignature },
);

interface Refs {
  handed: { current: boolean };
  inFlight: { current: boolean };
  mounted: { current: boolean };
}
type ClaimSignResult =
  | { kind: 'signed'; txHash: string }
  | { kind: 'still-unsigned'; error: unknown }
  | { kind: 'stale'; error: unknown }
  | { kind: 'maybe-signed'; error: unknown };

const runClaimSignature = extract<
  (
    handoff: { xrplPayment: unknown; memoHex: string },
    send: (tx: unknown) => Promise<{ txHash: string }>,
    refs: Refs,
    release: (memoHex: string) => void,
  ) => Promise<ClaimSignResult>
>(
  src,
  'async function runClaimSignature(handoff: { xrplPayment: unknown; memoHex: string }, send: (tx: unknown) => Promise<{ txHash: string }>, refs: ClaimSignRefs, release: (memoHex: string) => void): Promise<ClaimSignResult> {',
  'async function runClaimSignature(handoff, send, refs, release) {',
  'runClaimSignature',
  { claimSeatAfterSignFailure },
);

const seatRefusalText = extract<
  (body: SeatRefusalLike | undefined, t: (s: string) => string) => string | null
>(
  src,
  'function seatRefusalText(body: SeatRefusalLike | undefined, t: (s: string) => string): string | null {',
  'function seatRefusalText(body, t) {',
  'seatRefusalText',
  // The sentences belong to the shared reader: passing the REAL one in is what
  // proves this panel delegates instead of keeping a copy that can drift.
  { describeSeatRefusal, normalizeSeatRefusal },
);

const t = (s: string) => s;
const handoff = { xrplPayment: { TransactionType: 'Payment' }, memoHex: 'DEADBEEF' };
const refs = (over: Partial<{ handed: boolean; inFlight: boolean; mounted: boolean }> = {}): Refs => ({
  handed: { current: over.handed ?? false },
  inFlight: { current: over.inFlight ?? false },
  mounted: { current: over.mounted ?? true },
});

/* ── which failures leave an unsigned draft ───────────────────────────────── */

describe('claimSeatAfterSignFailure', () => {
  it('a «no» in Xaman, an expired payload or a wallet that was never there leave the draft unsigned', () => {
    // The literal Xaman throws (XamanWalletService.submitTransaction) when the
    // user declines or lets the code die.
    expect(claimSeatAfterSignFailure(new Error('Transaction submission failed: User cancelled transaction submission or payload expired'))).toBe('still-unsigned');
    expect(claimSeatAfterSignFailure(new Error('Transaction submission failed: Failed to create transaction submission payload'))).toBe('still-unsigned');
    expect(claimSeatAfterSignFailure(new Error('XRPL_WALLET_PARTNER_NOT_CONNECTED'))).toBe('still-unsigned');
  });

  /**
   * FIRMADA TARDE NO ES «NO PUDE LEER».
   *
   * Xaman submits the payload itself and re-wraps the node's answer into a plain
   * Error whose text carries the code. tefMAX_LEDGER / tefPAST_SEQ are verdicts
   * we READ: that payload can never validate, so there is no dispatch to protect
   * and its seat can be released — the opposite of 'maybe-signed'.
   */
  it('a payload signed past its ledger window is «stale», not «maybe-signed»', () => {
    expect(
      claimSeatAfterSignFailure(
        new Error(
          'Transaction submission failed: The network refused this transaction (tefMAX_LEDGER). It never entered the ledger and it cost nothing.',
        ),
      ),
    ).toBe('stale');
    expect(
      claimSeatAfterSignFailure(
        new Error('Transaction submission failed: The network refused this transaction (tefPAST_SEQ).'),
      ),
    ).toBe('stale');
  });

  it('another tef* that is NOT about the window keeps the seat', () => {
    expect(
      claimSeatAfterSignFailure(
        new Error('Transaction submission failed: The network refused this transaction (tefBAD_AUTH).'),
      ),
    ).toBe('maybe-signed');
  });

  it('anything we could NOT read keeps the seat: it may carry a signature', () => {
    // Xaman already submitted and only the read of the hash failed.
    expect(claimSeatAfterSignFailure(new Error('Transaction submission failed: Failed to retrieve transaction hash from payload'))).toBe('maybe-signed');
    expect(claimSeatAfterSignFailure(new Error('Transaction submission failed: Payload timeout - user did not complete action in time'))).toBe('maybe-signed');
    expect(claimSeatAfterSignFailure(new Error('Failed to fetch'))).toBe('maybe-signed');
  });
});

/* ── what the signature does to the seat ──────────────────────────────────── */

describe('runClaimSignature — el asiento lo decide la respuesta de la wallet', () => {
  it('signed: «handed» is marked and nothing is released', async () => {
    const r = refs();
    const release = vi.fn();
    const out = await runClaimSignature(handoff, async () => ({ txHash: 'A'.repeat(64) }), r, release);
    expect(out).toEqual({ kind: 'signed', txHash: 'A'.repeat(64) });
    expect(r.handed.current).toBe(true);
    expect(r.inFlight.current).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  it('THE REGRESSION: declining in Xaman leaves the draft releasable', async () => {
    const r = refs();
    const release = vi.fn();
    const out = await runClaimSignature(
      handoff,
      async () => {
        throw new Error('Transaction submission failed: User cancelled transaction submission or payload expired');
      },
      r,
      release,
    );
    expect(out.kind).toBe('still-unsigned');
    // The panel is still on screen: «Back» is what frees it, exactly as for a
    // draft that was never sent.
    expect(r.handed.current).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  it('a rejection that lands after the heir left the screen frees the seat there', async () => {
    const r = refs({ mounted: false });
    const release = vi.fn();
    await runClaimSignature(
      handoff,
      async () => {
        throw new Error('Transaction submission failed: User cancelled transaction submission or payload expired');
      },
      r,
      release,
    );
    expect(release).toHaveBeenCalledWith('DEADBEEF');
  });

  it('a failure we could not read never frees the seat — not even off screen', async () => {
    const r = refs({ mounted: false });
    const release = vi.fn();
    const out = await runClaimSignature(
      handoff,
      async () => {
        throw new Error('Transaction submission failed: Failed to retrieve transaction hash from payload');
      },
      r,
      release,
    );
    expect(out.kind).toBe('maybe-signed');
    expect(r.handed.current).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });

  /**
   * A stale signature leaves NOTHING on the ledger, so the
   * draft is releasable — «handed» stays false and an unmount frees the seat,
   * exactly as for a rejection.
   */
  it('a signature past its ledger window leaves the draft releasable', async () => {
    const r = refs();
    const release = vi.fn();
    const out = await runClaimSignature(
      handoff,
      async () => {
        throw new Error('Transaction submission failed: The network refused this transaction (tefMAX_LEDGER).');
      },
      r,
      release,
    );
    expect(out.kind).toBe('stale');
    expect(r.handed.current).toBe(false);
    // Still on screen: «Back» (or the unmount) is what frees it.
    expect(release).not.toHaveBeenCalled();
  });

  it('a stale signature that lands after the heir left frees the seat there', async () => {
    const r = refs({ mounted: false });
    const release = vi.fn();
    await runClaimSignature(
      handoff,
      async () => {
        throw new Error('Transaction submission failed: The network refused this transaction (tefPAST_SEQ).');
      },
      r,
      release,
    );
    expect(release).toHaveBeenCalledWith('DEADBEEF');
  });

  it('while Xaman holds the payload nothing is released and nothing is claimed signed', async () => {
    const r = refs();
    let resolveSend: (v: { txHash: string }) => void = () => {};
    const pending = runClaimSignature(
      handoff,
      () => new Promise<{ txHash: string }>((res) => { resolveSend = res; }),
      r,
      vi.fn(),
    );
    // This is the instant an unmount used to decide the seat's fate on a guess.
    expect(r.inFlight.current).toBe(true);
    expect(r.handed.current).toBe(false);
    resolveSend({ txHash: 'B'.repeat(64) });
    await pending;
    expect(r.inFlight.current).toBe(false);
    expect(r.handed.current).toBe(true);
  });
});

/* ── the seat refusals, in words ──────────────────────────────────────────── */

describe('seatRefusalText — NONCE_SEAT_* dicho por el lector compartido', () => {
  it('a signed seat is never answered with the words of an unsigned draft', () => {
    expect(seatRefusalText({ error: 'NONCE_SEAT_TAKEN', retryable: true }, t)).toBe(
      describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN', retryable: true }, t)!.text,
    );
    expect(seatRefusalText({ error: 'NONCE_SEAT_TAKEN_SIGNED' }, t)).toMatch(/already signed/);
    expect(seatRefusalText({ error: 'NONCE_SEAT_TAKEN_REPORTED' }, t)).toMatch(/ledger has not validated it yet/);
    expect(seatRefusalText({ error: 'NONCE_SEAT_UNREADABLE' }, t)).toMatch(/could not be read/);
  });

  it('Reads the code the Legacy route still wraps in its own error — and DROPS the Spanish detail (R5 5.4)', () => {
    const text = seatRefusalText(
      {
        error: 'VAULT_YIELD_CLAIM_PREPARE_FAILED',
        detail: 'NONCE_SEAT_TAKEN_SIGNED: el PA 0xPA tiene una orden 0xFE YA FIRMADA esperando ejecutar en el nonce 7',
      },
      t,
    );
    expect(text).toMatch(/already signed/);
    // The paragraph the server writes for itself is Spanish and full of hashes:
    // it used to be pasted behind the sentence, on a screen written in English.
    expect(text).not.toContain('nonce 7');
    expect(text).not.toMatch(/tiene una orden/);
  });

  it('says nothing about seats for refusals that are not about one', () => {
    expect(seatRefusalText({ error: 'NOTHING_TO_CLAIM', detail: 'no yield' }, t)).toBeNull();
    expect(seatRefusalText({ error: 'VAULT_YIELD_CLAIM_PREPARE_FAILED', detail: 'LEGACY_VAULT missing' }, t)).toBeNull();
    expect(seatRefusalText(undefined, t)).toBeNull();
  });

  it('never promises that cancelling always frees the seat', () => {
    for (const code of ['NONCE_SEAT_TAKEN', 'NONCE_SEAT_TAKEN_SIGNED', 'NONCE_SEAT_TAKEN_REPORTED', 'NONCE_SEAT_UNREADABLE']) {
      expect(seatRefusalText({ error: code }, t)).not.toMatch(/always|siempre/i);
    }
  });
});
