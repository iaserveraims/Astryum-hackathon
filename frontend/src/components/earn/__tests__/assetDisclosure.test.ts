import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_NOTICES, assetNoticeOf } from '../assetDisclosure';
import { translate } from '../../../i18n/dict';

/**
 * «El carry de Kinetic pide USDT0 y la card no lo decía».
 *
 * The e1 pack shows a live borrow APR, a profitability calculator and a Start
 * button for a loan taken in USDT0 — the omnichain USDT — which is exactly the
 * asset INVARIANTS.md #9 keeps out of Astryum's EU-facing strategies («EMTs
 * only: USDC, EURC, RLUSD. USDT is read-only»). The entry stays available (the
 * loan is Kinetic's, prepared unsigned, signed by the user), but the reader has
 * to be told WHAT they are borrowing before they sign it.
 */

const COMPONENT = join(__dirname, '..', 'FlareDemoEarn.tsx');
const src = readFileSync(COMPONENT, 'utf8');

/** Packs with nothing to disclose on this axis — RLUSD is an EMT, FXRP/FLR/
 *  stXRP are not e-money at all. Listed explicitly so a NEW pack cannot ship
 *  without someone deciding which side of the rule it falls on. */
const NO_NOTICE = ['e2', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'em-carry', 'em-lend'];

/** The pack kinds the surface actually ships, read from the union it declares. */
function shippedKinds(): string[] {
  const at = src.indexOf('export type VaultKind =');
  expect(at, 'VaultKind must be declared — update this test if it moved').toBeGreaterThan(-1);
  const union = src.slice(at, src.indexOf(';', at));
  return [...union.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

describe('the borrowed asset is disclosed on the card', () => {
  it('the Kinetic carry says what it borrows and where that asset stands', () => {
    const notice = assetNoticeOf('e1');
    expect(notice, 'the carry borrows USDT0 — it cannot ship without its notice').not.toBeNull();
    expect(notice!.asset).toBe('USDT0');
    expect(notice!.headline).toMatch(/MiCA/);
    expect(notice!.body).toMatch(/USDT0/);
    // The way out is named: the same FXRP works with no borrow at all.
    expect(notice!.body).toMatch(/lend-only/);
  });

  it('The card FACE says it — real product, not MiCA-compliant, because of USDT0', () => {
    const face = assetNoticeOf('e1')!.face;
    // Both halves of the sentence, in this order: it is real, and it does not
    // comply. Dropping either turns a disclosure into either a warning about a
    // fake or a badge on a product nobody said was live.
    expect(face).toMatch(/real product/i);
    expect(face).toMatch(/MiCA/);
    expect(face).toMatch(/USDT0/);
    // Short enough to live on a 13rem card without clamping the point away.
    expect(face.length).toBeLessThanOrEqual(64);
  });

  it('the catalogue card actually wears the face — not only the opened detail', () => {
    // The desktop cards are built in FlareDemoEarn and drawn by StrategyFan's
    // CardFace; the mobile accordion draws its own row. All three must carry
    // it, at source level — the same technique as the rest of this file.
    expect(src, 'FlareDemoEarn must hand the face to the catalogue cards').toMatch(/notice:\s*assetNoticeOf\(v\.kind\)\?\.face/);
    expect(src, 'the mobile accordion row must show the face').toMatch(/t\(notice\.face\)/);
    const fan = readFileSync(join(__dirname, '..', 'StrategyFan.tsx'), 'utf8');
    expect(fan, 'FanCard must declare the notice').toMatch(/notice\?: string/);
    // Every face the fan draws: the shared CardFace (hand, grid, shelf) and the
    // list row, which has its own markup.
    expect(fan.match(/\{t\(card\.notice\)\}/g)?.length ?? 0, 'CardFace and RouteRow both render it').toBeGreaterThanOrEqual(2);
  });

  it('never turns the disclosure into a promise or a verdict (invariant #10)', () => {
    const words = Object.values(ASSET_NOTICES).flatMap((n) => [n!.face, n!.headline, n!.body]);
    for (const w of words) {
      expect(w).not.toMatch(/guaranteed|we recommend|risk-free/i);
      // Astryum discloses; it never claims the asset is illegal or the venue
      // fraudulent — a fact about authorisation, not a judgement.
      expect(w).not.toMatch(/illegal|banned|scam/i);
    }
  });

  it('every shipped pack has decided whether it discloses', () => {
    const kinds = shippedKinds();
    expect(kinds.length).toBeGreaterThan(1);
    for (const k of kinds) {
      const decided = k in ASSET_NOTICES || NO_NOTICE.includes(k);
      expect(decided, `pack "${k}" ships without deciding if it needs an asset notice`).toBe(true);
    }
    // …and the packs listed as clean really render nothing (never an empty box).
    for (const k of NO_NOTICE) expect(assetNoticeOf(k as never)).toBeNull();
  });

  it('speaks Spanish too — a disclosure that only exists in English is half a disclosure', () => {
    for (const n of Object.values(ASSET_NOTICES)) {
      for (const s of [n!.face, n!.headline, n!.body]) {
        // Through translate(), the same door the surface uses — asserting the
        // raw ES map would have passed on a key parked in an unmerged table.
        expect(translate('es', s), `missing Spanish for: ${s.slice(0, 48)}…`).not.toBe(s);
      }
    }
  });
});

describe('the three surfaces that must show it', () => {
  it('imports the notice instead of keeping a copy of the sentence', () => {
    expect(src).toContain("from './assetDisclosure'");
    for (const n of Object.values(ASSET_NOTICES)) {
      expect(src, 'the sentence must live in ONE place').not.toContain(n!.body);
    }
  });

  it('renders it on the card, on the info sheet and before the signature', () => {
    const renders = [...src.matchAll(/<AssetNoticeBox\b/g)].length;
    expect(renders, 'pick card + info sheet + review step').toBeGreaterThanOrEqual(3);
    // The review step is the decisive one: the last screen before the wallet
    // opens. It must sit inside the disclosure column, next to the custody note.
    const review = src.indexOf("{t('Astryum does not custody your funds.')}");
    expect(review).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, review - 600), review);
    expect(before, 'the notice must precede the sign button, not follow it').toContain('<AssetNoticeBox');
  });

  it('is never hidden behind the device-local region', () => {
    // getUserRegion() is unset for most people (fail-closed by design), so a
    // region-gated notice would hide from exactly the reader it is written for.
    for (const m of src.matchAll(/([sS]{80})<AssetNoticeBox/g)) {
      expect(m[1]).not.toContain('getUserRegion');
      expect(m[1]).not.toMatch(/region\s*===/);
    }
  });
});
