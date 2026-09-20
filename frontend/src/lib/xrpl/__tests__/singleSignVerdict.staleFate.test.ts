import { describe, expect, it } from 'vitest';
import {
  STALE_ALREADY_OUT_MESSAGE,
  STALE_CHECKING_MESSAGE,
  STALE_OUT_FAILED_MESSAGE,
  STALE_TX_MESSAGE,
  STALE_UNCHECKED_MESSAGE,
  blocksRetreat,
  councilOrderMemoOf,
  decideAfterSigned,
  isStaleDispatch,
  nextStaleOrderLock,
  staleOffersPrepareAgain,
  staleOrderFate,
  staleSentence,
} from '../singleSignVerdict';

/**
 * The double order after 'stale'.
 *
 * Payload A of an order stays live in the banner; the person prepares B (same
 * pinned Sequence, same memo). A is signed and relayed; B answers tefPAST_SEQ and
 * «prepare it again» composed a NEW order: capital moved twice. Now a stale
 * council order asks the server what became of the ORDER before offering that.
 */

const MEMO = 'ab'.repeat(32);
const HASH = 'C'.repeat(64);
const order = (memo: string, type = 'Payment') => ({ TransactionType: type, Account: 'rCouncil', Memos: [{ Memo: { MemoData: memo } }] });

describe('councilOrderMemoOf — which transactions are council orders', () => {
  it('a Payment whose first memo is exactly 32 bytes: its memo, uppercase', () => {
    expect(councilOrderMemoOf(order(MEMO))).toBe(MEMO.toUpperCase());
    expect(councilOrderMemoOf(JSON.stringify(order(MEMO)))).toBe(MEMO.toUpperCase());
  });

  it('anything else is not: a 0xFE instruction, another type, a short memo, no memo, bad JSON', () => {
    expect(councilOrderMemoOf(order('FE' + '01'.repeat(40)))).toBeNull();
    expect(councilOrderMemoOf(order(MEMO, 'CredentialAccept'))).toBeNull();
    expect(councilOrderMemoOf(order('AB12'))).toBeNull();
    expect(councilOrderMemoOf({ TransactionType: 'Payment' })).toBeNull();
    expect(councilOrderMemoOf('not json')).toBeNull();
    expect(councilOrderMemoOf(null)).toBeNull();
  });
});

describe('staleOrderFate — what a stale council order may offer', () => {
  it.each(['validated', 'relaying', 'executed'])('%s → another request already went out: never «prepare it again»', (state) => {
    const fate = staleOrderFate({ ok: true, fate: { state, xrplTxHash: HASH } });
    expect(fate).toEqual({ kind: 'already-out', txHash: HASH });
    expect(staleOffersPrepareAgain(fate)).toBe(false);
    expect(staleSentence(fate)).toBe(STALE_ALREADY_OUT_MESSAGE);
  });

  it.each(['composed', 'unknown'])('%s → nothing of this order went out: prepare it again', (state) => {
    const fate = staleOrderFate({ ok: true, fate: { state } });
    expect(fate).toEqual({ kind: 'prepare-again' });
    expect(staleOffersPrepareAgain(fate)).toBe(true);
    expect(staleSentence(fate)).toBe(STALE_TX_MESSAGE);
  });

  it('failed → a sibling went out and did not complete: check it first', () => {
    const fate = staleOrderFate({ ok: true, fate: { state: 'failed', xrplTxHash: HASH, detail: 'relay reverted' } });
    expect(fate).toEqual({ kind: 'out-failed', txHash: HASH, detail: 'relay reverted' });
    expect(staleOffersPrepareAgain(fate)).toBe(false);
    expect(staleSentence(fate)).toBe(STALE_OUT_FAILED_MESSAGE);
  });

  it('503 / unreadable / a state outside the vocabulary → «could not check», no silent re-prepare', () => {
    for (const read of [{ ok: false as const }, { ok: true as const, fate: { state: 'teleported' } }]) {
      const fate = staleOrderFate(read);
      expect(fate).toEqual({ kind: 'unchecked' });
      expect(staleOffersPrepareAgain(fate)).toBe(false);
      expect(staleSentence(fate)).toBe(STALE_UNCHECKED_MESSAGE);
    }
  });

  it('while the fate is being read it says so, and offers nothing yet', () => {
    expect(staleSentence({ kind: 'checking' })).toBe(STALE_CHECKING_MESSAGE);
    expect(staleOffersPrepareAgain({ kind: 'checking' })).toBe(false);
  });

  it('not a council order (no fate): the plain «prepare it again»', () => {
    expect(staleSentence(undefined)).toBe(STALE_TX_MESSAGE);
    expect(staleOffersPrepareAgain(undefined)).toBe(true);
  });
});

/**
 * «no la prepares otra vez» ERA SOLO TEXTO.
 *
 * `staleOffersPrepareAgain` no se usaba en producción y 'stale' no bloquea al
 * padre (a propósito: el padre es quien prepara). Resultado: la tarjeta decía
 * que una hermana de esta orden ya iba camino de Flare y el padre seguía libre
 * para componer otra — el mismo capital, movido dos veces. El destino ahora
 * viaja al padre y este candado sobrevive al desmontaje de la tarjeta.
 */
describe('nextStaleOrderLock — el candado del padre tras un stale que ya salió', () => {
  const OUT = { kind: 'already-out' as const, txHash: HASH };

  it('checking abre el candado, y el veredicto lo mantiene', () => {
    const checking = nextStaleOrderLock(null, { kind: 'checking' });
    expect(checking).toEqual({ kind: 'checking' });
    expect(nextStaleOrderLock(checking, OUT)).toEqual(OUT);
  });

  it.each([
    ['already-out', OUT],
    ['out-failed', { kind: 'out-failed' as const, txHash: HASH }],
    ['unchecked', { kind: 'unchecked' as const }],
  ])('%s cierra la puerta: solo la persona la abre', (_n, fate) => {
    expect(nextStaleOrderLock(null, fate)).toEqual(fate);
    expect(staleOffersPrepareAgain(fate)).toBe(false);
  });

  it('prepare-again tras checking la abre — nada de esta orden llegó al ledger', () => {
    expect(nextStaleOrderLock({ kind: 'checking' }, { kind: 'prepare-again' })).toBeNull();
    expect(nextStaleOrderLock(null, { kind: 'prepare-again' })).toBeNull();
  });

  it('pero NUNCA levanta un candado que puso un veredicto', () => {
    // Otra firma de la misma pantalla no puede desmentir lo que ya se leyó.
    expect(nextStaleOrderLock(OUT, { kind: 'prepare-again' })).toEqual(OUT);
    expect(nextStaleOrderLock({ kind: 'unchecked' }, { kind: 'prepare-again' })).toEqual({ kind: 'unchecked' });
  });

  it('un «checking» posterior no degrada un veredicto ya sostenido', () => {
    expect(nextStaleOrderLock(OUT, { kind: 'checking' })).toEqual(OUT);
  });

  it('sin novedad (undefined) el candado se queda exactamente como estaba', () => {
    expect(nextStaleOrderLock(OUT, undefined)).toEqual(OUT);
    expect(nextStaleOrderLock(null, undefined)).toBeNull();
  });
});

describe('isStaleDispatch — la ceremonia lee los mismos dos códigos que la firma única', () => {
  it('tefPAST_SEQ y tefMAX_LEDGER: esta tx no puede validar jamás', () => {
    expect(isStaleDispatch('tefPAST_SEQ')).toBe(true);
    expect(isStaleDispatch(' tefMAX_LEDGER ')).toBe(true);
  });

  it('cualquier otra cosa no lo es (y el broadcast que sí entra, tampoco)', () => {
    for (const code of ['tesSUCCESS', 'tefALREADY', 'terQUEUED', 'tecNO_LINE', '', null, undefined]) {
      expect(isStaleDispatch(code)).toBe(false);
    }
  });
});

describe("'stale' still frees the parent (R5 left it unverified)", () => {
  it('tefPAST_SEQ is stale and stale never blocks retreat — onBlockedChange(false) fires on the transition', () => {
    const v = decideAfterSigned({ txid: HASH, dispatched: 'tefPAST_SEQ' });
    expect(v.kind).toBe('stale');
    // 'waiting' blocked → 'stale' does not: the component's [blocked] effect reports false.
    expect(blocksRetreat('waiting', false)).toBe(true);
    expect(blocksRetreat('stale', false)).toBe(false);
  });
});
