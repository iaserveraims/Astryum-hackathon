/**
 * XrplOrderSequencePin — una orden firmable por asiento de Sequence.
 *
 * Puro: el lector de `account_info` se inyecta. Fija que la Sequence sale del ledger
 * validado, que la firma simple lleva LastLedgerSequence = validado + ventana, que una
 * cuenta con SignerList (ceremonia multisig de días) NO la lleva, y que «no pude leer»
 * nunca se convierte en una orden sin fijar.
 */
import {
  ORDER_LEDGER_WINDOW,
  OrderSequenceUnreadableError,
  pinOrderPayment,
  readOrderSequencePin,
} from '../XrplOrderSequencePin';

const ACCOUNT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const info = (extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
  async () => ({ validated: true, ledger_index: 90_000_000, account_data: { Sequence: 4242, ...data }, ...extra });

describe('readOrderSequencePin', () => {
  it('firma simple: Sequence del ledger validado y LastLedgerSequence = validado + ventana', async () => {
    const pin = await readOrderSequencePin(ACCOUNT, info());
    expect(pin).toEqual({
      account: ACCOUNT,
      sequence: 4242,
      validatedLedgerIndex: 90_000_000,
      lastLedgerSequence: 90_000_000 + ORDER_LEDGER_WINDOW,
      multisigCouncil: false,
    });
    expect(ORDER_LEDGER_WINDOW).toBe(150);
  });

  it.each([
    ['v2 (raíz)', { signer_lists: [{ SignerEntries: [{ SignerEntry: { Account: 'rX', SignerWeight: 1 } }] }] }, {}],
    ['v1 (en account_data)', {}, { signer_lists: [{ SignerEntries: [{ SignerEntry: { Account: 'rX', SignerWeight: 1 } }] }] }],
  ])('cuenta con SignerList %s: Sequence fijada, SIN LastLedgerSequence', async (_label, extra, data) => {
    const pin = await readOrderSequencePin(ACCOUNT, info(extra, data));
    expect(pin.sequence).toBe(4242);
    expect(pin.multisigCouncil).toBe(true);
    expect(pin.lastLedgerSequence).toBeNull();
  });

  it('una lista vacía no es consejo', async () => {
    const pin = await readOrderSequencePin(ACCOUNT, info({ signer_lists: [] }));
    expect(pin.multisigCouncil).toBe(false);
  });

  it.each([
    ['el lector lanza', async () => { throw new Error('xrpl_endpoint_stale'); }],
    ['sin Sequence', async () => ({ validated: true, ledger_index: 5, account_data: {} })],
    ['sin ledger_index', async () => ({ validated: true, account_data: { Sequence: 3 } })],
    ['ledger no validado', async () => ({ validated: false, ledger_index: 5, account_data: { Sequence: 3 } })],
  ])('%s → OrderSequenceUnreadableError (ORDER_SEQUENCE_UNREADABLE)', async (_label, reader) => {
    const err = await readOrderSequencePin(ACCOUNT, reader as never).catch((e) => e);
    expect(err).toBeInstanceOf(OrderSequenceUnreadableError);
    expect(err.code).toBe('ORDER_SEQUENCE_UNREADABLE');
  });
});

describe('pinOrderPayment', () => {
  const tx = { TransactionType: 'Payment', Account: ACCOUNT, Destination: 'rAnchor', Amount: '1' };

  it('estampa Sequence y LastLedgerSequence sin tocar el resto', async () => {
    const pin = await readOrderSequencePin(ACCOUNT, info());
    expect(pinOrderPayment(tx, pin)).toEqual({ ...tx, Sequence: 4242, LastLedgerSequence: 90_000_150 });
  });

  it('en una cuenta de consejo retira un LastLedgerSequence previo en vez de conservarlo', async () => {
    const pin = await readOrderSequencePin(ACCOUNT, info({ signer_lists: [{ SignerEntries: [{}] }] }));
    const out = pinOrderPayment({ ...tx, LastLedgerSequence: 12 }, pin) as Record<string, unknown>;
    expect(out.Sequence).toBe(4242);
    expect(out).not.toHaveProperty('LastLedgerSequence');
  });

  it('se niega si el pin se leyó para otra cuenta', async () => {
    const pin = await readOrderSequencePin(ACCOUNT, info());
    expect(() => pinOrderPayment({ ...tx, Account: 'rOther' }, pin)).toThrow(/pin was read for/);
  });
});
