/**
 * productizer-it23 §Q1 1.1 / 1.3 / 1.6 — LAS TRES REGLAS DE ESTA COSTURA.
 *
 *  · 1.1 Las dos marcas del asiento se llenan en un solo sitio, y lo que no
 *        consta NO se escribe como «pregunté y no la tiene»: esa frase es la que
 *        vuelve una fila desplazable, y escribirla sin haber preguntado es como
 *        un parpadeo de base de datos entregaba el asiento de una SALIDA.
 *  · 1.3 El 0xFE de una ceremonia multifirma se mide con SU payload (24 h), no
 *        con el de una firma simple: si la ventana no lo cubre, el quórum acaba
 *        firmando bytes que el ledger ya no admite.
 *  · 1.6 Si ni el módulo de pruebas carga, la respuesta es un 503 reintentable
 *        sobre una salida — jamás un 403 que cuenta una avería nuestra como «no
 *        has probado esa cuenta».
 */
import type { Request } from 'express';

const mockProve = jest.fn();
jest.mock('../../identity/provenAddresses', () => {
  const actual = jest.requireActual('../../identity/provenAddresses');
  return { ...actual, proveAddress: (...a: unknown[]) => mockProve(...a) };
});

import {
  seatProofFieldsFrom,
  sessionAuthorityOnXrplAccount,
  handoffCeremonyExpiryMin,
  clampPayloadExpiryMin,
  handoffPayloadExpiresAt,
  handoffPayloadExpiryMsOf,
  seatWindowLedgersFor,
  classifySeatSignability,
  clampStampedPayloadExpiry,
  DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN,
  MAX_CEREMONY_PAYLOAD_EXPIRY_MIN,
} from '../handoffAuthority';

const MIN = 60_000;
const ENV = { ...process.env };
const req = (userId: string | null = 'u-1'): Request =>
  ({ siwe: userId ? { userId, walletAddress: '' } : undefined }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.DATABASE_URL; // sin la puerta del fundador: aquí se prueba la otra
  delete process.env.HANDOFF_PAYLOAD_EXPIRY_MIN;
  delete process.env.HANDOFF_CEREMONY_EXPIRY_MIN;
});
afterAll(() => {
  process.env = ENV;
});

describe('seatProofFieldsFrom — una sola forma de llenar las dos marcas (§Q1 1.1)', () => {
  const UNKNOWN = { preparedByProven: false, preparedByProofUnreadable: true };
  const NOT_PROVEN = { preparedByProven: false, preparedByProofUnreadable: false };
  const PROVEN = { preparedByProven: true, preparedByProofUnreadable: false };

  it('un booleano `false` NO afirma «no la tiene»: colapsa los dos noes, así que es DESCONOCIDO', () => {
    expect(seatProofFieldsFrom(false)).toEqual(UNKNOWN);
    expect(seatProofFieldsFrom(true)).toEqual(PROVEN);
  });

  it('sin veredicto ninguno, el lado seguro', () => {
    expect(seatProofFieldsFrom(undefined)).toEqual(UNKNOWN);
    expect(seatProofFieldsFrom(null)).toEqual(UNKNOWN);
    expect(seatProofFieldsFrom({})).toEqual(UNKNOWN);
  });

  it('el veredicto COMPLETO sí distingue los tres estados', () => {
    expect(seatProofFieldsFrom({ proven: true, storeReadable: true })).toEqual(PROVEN);
    expect(seatProofFieldsFrom({ proven: false, storeReadable: true })).toEqual(NOT_PROVEN);
    expect(seatProofFieldsFrom({ proven: false, storeReadable: false })).toEqual(UNKNOWN);
  });

  it('la autoridad de esta capa viaja igual (`outcome`), incluida la puerta del fundador', () => {
    expect(seatProofFieldsFrom({ mayAct: true, outcome: 'proven' })).toEqual(PROVEN);
    expect(seatProofFieldsFrom({ mayAct: false, outcome: 'not-proven' })).toEqual(NOT_PROVEN);
    expect(seatProofFieldsFrom({ mayAct: false, outcome: 'could-not-read' })).toEqual(UNKNOWN);
  });

  it('un claim ya hecho por `seatProofFromVerdict` pasa tal cual', () => {
    expect(seatProofFieldsFrom({ preparedByProven: true, preparedByProofUnreadable: false })).toEqual(PROVEN);
    expect(seatProofFieldsFrom({ preparedByProven: false, preparedByProofUnreadable: true })).toEqual(UNKNOWN);
    expect(seatProofFieldsFrom({ preparedByProven: false, preparedByProofUnreadable: false })).toEqual(NOT_PROVEN);
  });
});

describe('«no pude ni preguntar» no es un 403 sobre una salida (§Q1 1.6)', () => {
  it('si el módulo de pruebas revienta, una SALIDA recibe el 503 reintentable', async () => {
    mockProve.mockRejectedValue(new Error('module load failed'));
    const out = await sessionAuthorityOnXrplAccount(req(), 'rOwner', 'exit');
    expect(out.mayAct).toBe(false);
    expect(out.outcome).toBe('could-not-read');
    expect(out.refusal).toMatchObject({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true });
    expect(out.refusal?.detail).toMatch(/try again in a moment/i);
    // y la fila que se componga con esto no nace desplazable
    expect(seatProofFieldsFrom(out)).toEqual({ preparedByProven: false, preparedByProofUnreadable: true });
  });

  it('en una ENTRADA sigue fallando cerrado, y sin prometer un reintento que no arregla nada', async () => {
    mockProve.mockRejectedValue(new Error('module load failed'));
    const out = await sessionAuthorityOnXrplAccount(req(), 'rOwner', 'entry');
    expect(out.refusal).toMatchObject({ status: 403, error: 'ADDRESS_NOT_PROVEN', retryable: false });
  });

  it('el refusal del propio veredicto (409 determinista) se conserva, no se inventa otro', async () => {
    const refusal = { status: 409, error: 'ACCOUNT_RECORD_MISSING', detail: 'no row', retryable: false };
    mockProve.mockResolvedValue({ proven: false, storeReadable: false, failure: 'no-user-row', addresses: [], refusal });
    const out = await sessionAuthorityOnXrplAccount(req(), 'rOwner', 'exit');
    expect(out.refusal).toEqual(refusal);
    expect(out.outcome).toBe('could-not-read');
  });
});

describe('la ventana de una CEREMONIA se mide con su propio payload (§Q1 1.3)', () => {
  it('24 h por defecto, acotadas por el servidor y nunca por debajo de una firma simple', () => {
    expect(handoffCeremonyExpiryMin()).toBe(MAX_CEREMONY_PAYLOAD_EXPIRY_MIN);
    process.env.HANDOFF_CEREMONY_EXPIRY_MIN = '120';
    expect(handoffCeremonyExpiryMin()).toBe(120);
    process.env.HANDOFF_CEREMONY_EXPIRY_MIN = '1'; // por debajo de la firma simple
    expect(handoffCeremonyExpiryMin()).toBe(DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN);
    process.env.HANDOFF_CEREMONY_EXPIRY_MIN = '99999';
    expect(handoffCeremonyExpiryMin()).toBe(MAX_CEREMONY_PAYLOAD_EXPIRY_MIN);
  });

  it('nadie declara una vida absurda: se acota a [1 min, 24 h]', () => {
    expect(clampPayloadExpiryMin(undefined)).toBe(DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN);
    expect(clampPayloadExpiryMin(0)).toBe(DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN);
    expect(clampPayloadExpiryMin(-7)).toBe(DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN);
    expect(clampPayloadExpiryMin(10)).toBe(10);
    expect(clampPayloadExpiryMin(10_000)).toBe(MAX_CEREMONY_PAYLOAD_EXPIRY_MIN);
  });

  it('la ventana de ledger CUBRE el payload declarado, con su minuto de margen', () => {
    expect(seatWindowLedgersFor(5)).toBe(5 * 15 + 15);
    const ceremony = seatWindowLedgersFor(1440);
    expect(ceremony).toBe(1440 * 15 + 15);
    expect(ceremony * 4 * 1000).toBeGreaterThanOrEqual(1440 * MIN); // ~4 s por ledger
  });

  it('una fila de ceremonia se fecha con SU vida, no con la de una firma simple', () => {
    const createdAt = new Date(Date.now() - 30 * MIN);
    expect(handoffPayloadExpiryMsOf({ createdAt })).toBeLessThan(Date.now()); // firma simple: muerta
    expect(handoffPayloadExpiryMsOf({ createdAt, payloadExpiryMin: 1440 })).toBeGreaterThan(Date.now());
    expect(Date.parse(handoffPayloadExpiresAt(0, 1440))).toBe(1440 * MIN);
  });

  it('y su asiento NO se suelta por el reloj mientras el quórum firma', () => {
    const row = {
      createdAt: new Date(Date.now() - 30 * MIN),
      composedLedgerIndex: 90_000_000,
      lastLedgerSequence: 90_021_615,
      payloadExpiryMin: 1440,
    };
    const verdict = classifySeatSignability(row, {
      nowMs: Date.now(),
      validatedLedgerIndex: 90_000_500,
      windowState: 'absent',
    });
    expect(verdict).toMatchObject({ unsignable: false, reason: 'payload-live' });
    expect(verdict.secondsLeft).toBeGreaterThan(60 * 60); // queda más de una hora de firma
  });

  it('el sello de `payload-opened` puede mover el reloj de una ceremonia, no solo cinco minutos', () => {
    const row = {
      createdAt: new Date(),
      composedLedgerIndex: 90_000_000,
      lastLedgerSequence: 90_021_615,
      payloadExpiryMin: 1440,
      payloadExpiresAt: new Date(Date.now() + 60 * MIN).toISOString(),
    };
    const wanted = new Date(Date.now() + 10 * 60 * MIN).toISOString(); // Xaman dice 10 h
    const out = clampStampedPayloadExpiry(row, wanted, { nowMs: Date.now(), fallbackWindowLedgers: 90 });
    expect(out.accepted).toBe(true);
    expect(Date.parse(out.expiresAt as string)).toBe(Date.parse(wanted));

    // …y la misma fila SIN declarar su vida sigue acotada a los 5 min de siempre
    const simple = clampStampedPayloadExpiry({ ...row, payloadExpiryMin: undefined }, wanted, {
      nowMs: Date.now(),
      fallbackWindowLedgers: 90,
    });
    expect(simple.accepted).toBe(false); // el techo queda por detrás de lo que ya tenía
  });
});
