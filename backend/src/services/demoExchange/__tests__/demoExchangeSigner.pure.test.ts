/**
 * The policy of the simulated exchange key — pure. What it refuses is the
 * product: wrong signer, wrong destination, unapproved receiver, a tag on the
 * mint, caps. No seed, no RPC.
 */

import { assessPayment, capApplies, todayKey } from '../DemoExchangeSigner';

const OMNIBUS = 'rExchangeOmnibus111111111111111111';
const CORE_VAULT = 'rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj';
const CLIENT_R = 'rClientWallet1111111111111111111111';
const CLIENT_ACCOUNT = '0x4011015268644de37061D6C9b734b1738A8933C8';
const STRANGER = '0x00000000000000000000000000000000deadbeef';
const signer = { enabled: true, address: OMNIBUS, maxTxDrops: BigInt(50_000_000), dailyCapDrops: BigInt(200_000_000) };
const run = { omnibusAddress: OMNIBUS, clients: [{ id: 'c1', xrplAddress: CLIENT_R, passkeyAccount: CLIENT_ACCOUNT } as never] };
const mint = (over: Record<string, unknown> = {}) => ({ TransactionType: 'Payment', Account: OMNIBUS, Destination: CORE_VAULT, Amount: '10000000', Memos: [{ Memo: { MemoData: 'FE00' } }], ...over });

describe('assessPayment — put-to-work (0xFE to the Core Vault)', () => {
  const base = { purpose: 'put-to-work' as const, run, signer, coreVaultAddress: CORE_VAULT, receiver: CLIENT_ACCOUNT, spentTodayDrops: BigInt(0) };
  test('accepts a mint to the account of a client of the run, under the caps', () => {
    expect(assessPayment({ ...base, tx: mint() })).toEqual({ ok: true });
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: true, approved: true } })).toEqual({ ok: true });
  });

  // ── Lo que la llave no firma «por defecto» (endurecido) ────────────
  //
  // Las tres de abajo son negativas que faltaban en un firmante DESATENDIDO.
  // Ninguna cambia lo que el fundador quiso poder hacer: cambian que hacerlo
  // tenga que decirse en voz alta, y que no poder comprobar algo no cuente como
  // haberlo comprobado.

  test('refuses an ungated pote unless it is opted into on purpose', () => {
    // Sin puerta on-chain, la única barrera es `run.clients` — estado que
    // escribe una sesión de admin. Puede ser lo que se quiere (el KYC es del
    // exchange), pero es una decisión, no un default.
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: false, approved: false } }).code).toBe('POTE_NOT_GATED');
    expect(
      assessPayment({
        ...base,
        tx: mint(),
        onChainGate: { configured: false, approved: false },
        signer: { ...signer, allowUngatedPote: true },
      }),
    ).toEqual({ ok: true });
  });

  test('refuses when the gate could not be read — that is not the same as having no gate', () => {
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: false, approved: false, readFailed: true } }).code).toBe('GATE_UNREADABLE');
    // Y ni siquiera el opt-in de pote abierto tapa una lectura fallida.
    expect(
      assessPayment({
        ...base,
        tx: mint(),
        onChainGate: { configured: false, approved: false, readFailed: true },
        signer: { ...signer, allowUngatedPote: true },
      }).code,
    ).toBe('GATE_UNREADABLE');
  });

  test('refuses when today’s spend is not persisted — a cap that resets on restart is not a cap', () => {
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: true, approved: true }, spendLedgerPersisted: false }).code).toBe('SPEND_LEDGER_NOT_PERSISTED');
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: true, approved: true }, spendLedgerPersisted: true })).toEqual({ ok: true });
  });
  test('refuses when the key is disabled or opens another account', () => {
    expect(assessPayment({ ...base, tx: mint(), signer: { ...signer, enabled: false } }).code).toBe('SIGNER_DISABLED');
    expect(assessPayment({ ...base, tx: mint({ Account: CLIENT_R }) }).code).toBe('WRONG_SIGNER');
    expect(assessPayment({ ...base, tx: mint(), run: { ...run, omnibusAddress: CLIENT_R } }).code).toBe('WRONG_SIGNER');
  });
  test('refuses a destination other than the Core Vault', () => {
    expect(assessPayment({ ...base, tx: mint({ Destination: CLIENT_R }) }).code).toBe('DESTINATION_NOT_ALLOWED');
  });
  test('refuses minting shares to anyone who is not a client of this run', () => {
    expect(assessPayment({ ...base, tx: mint(), receiver: STRANGER }).code).toBe('RECEIVER_NOT_A_CLIENT');
    expect(assessPayment({ ...base, tx: mint(), receiver: undefined }).code).toBe('RECEIVER_NOT_A_CLIENT');
    // case-insensitive on the address, as EIP-55 checksums differ per source
    expect(assessPayment({ ...base, tx: mint(), receiver: CLIENT_ACCOUNT.toLowerCase() })).toEqual({ ok: true });
  });
  test('respects an on-chain gate when the pote carries one (the deposit would revert)', () => {
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: true, approved: false } }).code).toBe('RECEIVER_NOT_APPROVED');
    expect(assessPayment({ ...base, tx: mint(), onChainGate: { configured: true, approved: true } })).toEqual({ ok: true });
  });
  test('refuses a destination tag on the mint (FAssets would misroute it)', () => {
    expect(assessPayment({ ...base, tx: mint({ DestinationTag: 301 }) }).code).toBe('TAG_ON_MINT');
  });
  test('refuses above the per-payment cap and past the daily cap', () => {
    expect(assessPayment({ ...base, tx: mint({ Amount: '60000000' }) }).code).toBe('ABOVE_MAX_TX');
    expect(assessPayment({ ...base, tx: mint({ Amount: '20000000' }), spentTodayDrops: BigInt(190_000_000) }).code).toBe('ABOVE_DAILY_CAP');
  });

  test('Un gasto de hoy AUSENTE no es cero: una entrada sin el número no se firma', () => {
    expect(assessPayment({ ...base, tx: mint(), spentTodayDrops: undefined }).code).toBe('SPEND_TODAY_UNKNOWN');
  });
  test('refuses a malformed amount', () => {
    expect(assessPayment({ ...base, tx: mint({ Amount: { currency: 'USD' } }) }).code).toBe('BAD_AMOUNT');
  });
});

describe('assessPayment — la DESIGNACIÓN (Enmienda §10: la caja solo opera nombrada por su raíz)', () => {
  const base = { purpose: 'put-to-work' as const, run, signer, coreVaultAddress: CORE_VAULT, receiver: CLIENT_ACCOUNT, spentTodayDrops: BigInt(0) };
  test('con el flag apagado (required:false) nada cambia — held ni se mira', () => {
    expect(assessPayment({ ...base, tx: mint(), appointment: { required: false, held: false } })).toEqual({ ok: true });
  });
  test('required + nombrada por el consejo → firma', () => {
    expect(assessPayment({ ...base, tx: mint(), appointment: { required: true, held: true } })).toEqual({ ok: true });
  });
  test('required + SIN nombramiento → OMNIBUS_NOT_APPOINTED en la ENTRADA', () => {
    expect(assessPayment({ ...base, tx: mint(), appointment: { required: true, held: false } }).code).toBe('OMNIBUS_NOT_APPOINTED');
  });
  // Este test afirmaba lo contrario, y afirmaba de paso un comentario
  // que era falso («las salidas van por passkey y no pasan por aquí»: pasan,
  // con purpose 'payout' y esta misma llave). Una designación caducada es
  // papeleo NUESTRO; congelar con ella la retirada de alguien que no hizo nada
  // es castigarle por lo que no controla. Y no compra seguridad: el destino de
  // un payout ya está clavado a la wallet propia registrada del cliente, así
  // que lo único que esta llave puede hacer en la pierna de salida es
  // devolverle lo suyo.
  test('required + SIN nombramiento → el payout del cliente SALE igual', () => {
    expect(
      assessPayment({
        purpose: 'payout',
        run,
        signer,
        coreVaultAddress: CORE_VAULT,
        spentTodayDrops: BigInt(0),
        tx: { TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '5000000' },
        appointment: { required: true, held: false },
      }),
    ).toEqual({ ok: true });
  });
  test('no poder LEER el nombramiento no es estar nombrado (fail-closed) — en la ENTRADA', () => {
    expect(assessPayment({ ...base, tx: mint(), appointment: { required: true, held: false, readFailed: true } }).code).toBe('APPOINTMENT_UNREADABLE');
  });
  test('no poder leer el nombramiento tampoco detiene una salida', () => {
    expect(
      assessPayment({
        purpose: 'payout',
        run,
        signer,
        coreVaultAddress: CORE_VAULT,
        spentTodayDrops: BigInt(0),
        tx: { TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '5000000' },
        appointment: { required: true, held: false, readFailed: true },
      }),
    ).toEqual({ ok: true });
  });
});

describe('assessPayment — payout (omnibus → client own wallet)', () => {
  const base = { purpose: 'payout' as const, run, signer, coreVaultAddress: CORE_VAULT, spentTodayDrops: BigInt(0) };
  test('accepts a payout to a registered client wallet', () => {
    expect(assessPayment({ ...base, tx: { TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '5000000' } })).toEqual({ ok: true });
  });
  test('refuses any other destination — including the Core Vault', () => {
    expect(assessPayment({ ...base, tx: { TransactionType: 'Payment', Account: OMNIBUS, Destination: CORE_VAULT, Amount: '5000000' } }).code).toBe('DESTINATION_NOT_ALLOWED');
    expect(assessPayment({ ...base, tx: { TransactionType: 'Payment', Account: OMNIBUS, Destination: 'rSomebodyElse1111111111111111111111', Amount: '5000000' } }).code).toBe('DESTINATION_NOT_ALLOWED');
  });

  // El tope diario y el tope por transacción son protecciones de
  // la llave operativa de Astryum: aplican a ENTRADAS y operativa propia. El
  // payout del cliente es SU dinero y sale. La arregló solo la lectura.
  const payout = (over: Record<string, unknown> = {}) => ({ TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '5000000', ...over });

  test('el tope POR TRANSACCIÓN no habla en una salida', () => {
    expect(assessPayment({ ...base, tx: payout({ Amount: '60000000' }) })).toEqual({ ok: true });
  });

  test('el tope DIARIO no habla en una salida — ni al límite ni pasado', () => {
    expect(assessPayment({ ...base, tx: payout(), spentTodayDrops: BigInt(199_000_000) })).toEqual({ ok: true });
    expect(assessPayment({ ...base, tx: payout(), spentTodayDrops: BigInt(500_000_000) })).toEqual({ ok: true });
  });

  test('un libro de gasto sin persistir tampoco retiene una salida', () => {
    expect(assessPayment({ ...base, tx: payout(), spendLedgerPersisted: false })).toEqual({ ok: true });
  });

  test('y sin número de gasto siquiera (no se pudo leer), la salida sale', () => {
    expect(assessPayment({ ...base, tx: payout({ Amount: '60000000' }), spentTodayDrops: undefined })).toEqual({ ok: true });
  });

  test('lo que SÍ la detiene sigue en pie: importe imposible y destino no registrado', () => {
    expect(assessPayment({ ...base, tx: payout({ Amount: '0' }) }).code).toBe('BAD_AMOUNT');
    expect(assessPayment({ ...base, tx: payout({ Destination: 'rStranger111111111111111111111111' }) }).code).toBe('DESTINATION_NOT_ALLOWED');
  });
});

describe('capApplies — a quién acota el tope', () => {
  test('a la operativa propia sí; a la salida de un cliente jamás', () => {
    expect(capApplies('put-to-work')).toBe(true);
    expect(capApplies('payout')).toBe(false);
  });
});

describe('spend day key', () => {
  test('is the UTC date', () => {
    expect(todayKey(new Date('2026-08-26T23:59:59Z'))).toBe('2026-08-26');
  });
});
