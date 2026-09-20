/**
 * it. 23 (1.4) — EL LIBRO DE GASTO DEL DÍA SE ESCRIBE ESTRICTO, O NO SE ESCRIBE.
 *
 * `kvUpsert` se traga su propio fallo (es best-effort por diseño), así que una
 * escritura perdida devolvía el tope entero a una llave que firma: 150 de 200
 * gastados → se pierde la escritura → el siguiente tick lee el total viejo y
 * autoriza otros 80. Ahora cada mutación es un compare-and-set atómico y un
 * fallo LANZA. La reserva se puede devolver; un gasto ya asentado, jamás.
 */

const kv = new Map<string, Record<string, unknown>>();
let casImpl: ((key: string, payload: Record<string, unknown>, expected: number) => 'written' | 'conflict') | null = null;

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGetStrict: jest.fn(async (jobType: string, _kf: string, key: string) => kv.get(`${jobType}:${key}`) ?? null),
  kvCompareAndSet: jest.fn(async (jobType: string, _kf: string, key: string, payload: Record<string, unknown>, cas: { expectedVersion: number }) => {
    const k = `${jobType}:${key}`;
    if (casImpl) return casImpl(k, payload, cas.expectedVersion);
    const stored = kv.get(k);
    const current = Number(stored?.version ?? 0);
    if (stored && current !== cas.expectedVersion) return 'conflict';
    if (!stored && cas.expectedVersion !== 0) return 'conflict';
    kv.set(k, JSON.parse(JSON.stringify(payload)));
    return 'written';
  }),
}));

import { SPEND_JOB_TYPE, __resetSpendMemory, assessPayment, recordSpend, releaseSpend, reserveSpend, spentToday, sweepStaleReservations, todayKey } from '../DemoExchangeSigner';

const NOW = new Date('2026-09-15T10:00:00.000Z');
const KEY = `${SPEND_JOB_TYPE}:${todayKey(NOW)}`;
const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);

const ORIGINAL_DB = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://spend-ledger-test';
});
afterAll(() => {
  if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB;
});

beforeEach(() => {
  kv.clear();
  casImpl = null;
  __resetSpendMemory();
});

describe('el libro de gasto del día', () => {
  it('reservar cuenta una sola vez por hash, y asentar no vuelve a sumar', async () => {
    await reserveSpend(BigInt(150_000_000), HASH_A, 'put-to-work', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(150_000_000));

    await reserveSpend(BigInt(150_000_000), HASH_A, 'put-to-work', NOW); // idempotente
    expect(await spentToday(NOW)).toBe(BigInt(150_000_000));

    await recordSpend(BigInt(150_000_000), HASH_A, 'put-to-work', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(150_000_000));

    await recordSpend(BigInt(150_000_000), HASH_A, 'put-to-work', NOW); // un replay del journal
    expect(await spentToday(NOW)).toBe(BigInt(150_000_000));
  });

  it('una ESCRITURA perdida LANZA — el tope no se reabre en silencio', async () => {
    casImpl = () => 'conflict';
    await expect(reserveSpend(BigInt(50_000_000), HASH_A, 'put-to-work', NOW)).rejects.toThrow(/could not be written/);
    expect(await spentToday(NOW)).toBe(BigInt(0));
  });

  it('un lector estricto que no puede leer LANZA, nunca «0 gastado hoy»', async () => {
    const kvMod = jest.requireMock('../../persistence/backgroundJobKv') as { kvGetStrict: jest.Mock };
    kvMod.kvGetStrict.mockRejectedValueOnce(new Error('P1001 database unreachable'));
    await expect(spentToday(NOW)).rejects.toThrow(/P1001/);
  });

  it('devolver una RESERVA suelta su importe; un gasto ASENTADO no se des-gasta', async () => {
    await reserveSpend(BigInt(30_000_000), HASH_A, 'put-to-work', NOW);
    await reserveSpend(BigInt(20_000_000), HASH_B, 'put-to-work', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(50_000_000));

    // B entró en un ledger: deja de ser devolvible.
    await recordSpend(BigInt(20_000_000), HASH_B, 'put-to-work', NOW);
    await releaseSpend(HASH_B, NOW);
    expect(await spentToday(NOW)).toBe(BigInt(50_000_000));

    // A quedó probadamente muerto: su reserva vuelve al tope.
    await releaseSpend(HASH_A, NOW);
    expect(await spentToday(NOW)).toBe(BigInt(20_000_000));

    // Y un hash que nadie reservó no descuenta nada.
    await releaseSpend('F'.repeat(64), NOW);
    expect(await spentToday(NOW)).toBe(BigInt(20_000_000));
  });

  it('una fila ANTERIOR a la it. 23 (sin `phase`) se lee como gasto asentado', async () => {
    kv.set(KEY, { day: todayKey(NOW), spentDrops: '10000000', entries: [{ at: NOW.toISOString(), drops: '10000000', txHash: HASH_A, purpose: 'put-to-work' }] });
    await releaseSpend(HASH_A, NOW);
    expect(await spentToday(NOW)).toBe(BigInt(10_000_000));
  });

  it('dos escritores a la vez: el que pierde el CAS relee y suma encima del otro, jamás lo borra', async () => {
    let firstWrite = true;
    casImpl = (key, payload, expected) => {
      const stored = kv.get(key);
      const current = Number(stored?.version ?? 0);
      if (firstWrite) {
        // Otro proceso metió su pago entre nuestra lectura y nuestra escritura.
        firstWrite = false;
        kv.set(key, { day: todayKey(NOW), spentDrops: '7000000', entries: [{ at: NOW.toISOString(), drops: '7000000', txHash: HASH_B, purpose: 'put-to-work', phase: 'reserved' }], version: 1 });
        return 'conflict';
      }
      if (stored && current !== expected) return 'conflict';
      kv.set(key, JSON.parse(JSON.stringify(payload)));
      return 'written';
    };

    await reserveSpend(BigInt(3_000_000), HASH_A, 'put-to-work', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(10_000_000));
  });
});

/**
 * it. 25 (B.4) — LA MEDIANOCHE UTC NO PUEDE DESCUADRAR LA CONTABILIDAD.
 *
 * `reserveSpend` escribía en el día de la reserva y `recordSpend`/`releaseSpend`
 * volvían a evaluar `todayKey(now)`: una reserva de las 23:59:59 se liquidaba
 * contra el día SIGUIENTE (importe contado dos veces en D+1, reserva huérfana
 * comiéndose el tope de D) y la devolución no encontraba nada que devolver.
 */
describe('la medianoche UTC', () => {
  const LATE = new Date('2026-09-15T23:59:59.000Z');
  const JUST_AFTER = new Date('2026-09-16T00:00:02.000Z');
  const KEY_D = `${SPEND_JOB_TYPE}:${todayKey(LATE)}`;
  const KEY_D1 = `${SPEND_JOB_TYPE}:${todayKey(JUST_AFTER)}`;

  it('una reserva de las 23:59:59 se LIQUIDA contra su propio día — ni doble conteo ni huérfana', async () => {
    await reserveSpend(BigInt(5_000_000), HASH_A, 'put-to-work', LATE);
    await recordSpend(BigInt(5_000_000), HASH_A, 'put-to-work', JUST_AFTER);

    expect(await spentToday(LATE)).toBe(BigInt(5_000_000)); // una vez, en SU día
    expect(await spentToday(JUST_AFTER)).toBe(BigInt(0)); // el día nuevo nace limpio
    expect(kv.get(KEY_D1)).toBeUndefined();
    const entries = (kv.get(KEY_D)?.entries ?? []) as Array<{ txHash: string; phase?: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].phase).toBe('settled');
  });

  it('una reserva de ayer se DEVUELVE a su propio día (antes no se devolvía nunca)', async () => {
    await reserveSpend(BigInt(5_000_000), HASH_A, 'put-to-work', LATE);
    await releaseSpend(HASH_A, JUST_AFTER);

    expect(await spentToday(LATE)).toBe(BigInt(0));
    expect(await spentToday(JUST_AFTER)).toBe(BigInt(0));
  });
});

/**
 * it. 25 (B.4) — EL BARRIDO DE RESERVAS HUÉRFANAS. Una reserva que nadie
 * liquidó ni devolvió (el proceso murió entre la firma y el veredicto del
 * ledger) se come el tope para siempre. Solo puede ABRIR tope: jamás niega nada,
 * y menos una salida.
 */
describe('el barrido de reservas huérfanas', () => {
  const RESERVED_AT = new Date('2026-09-15T10:00:00.000Z');
  const TWO_HOURS_LATER = new Date('2026-09-15T12:00:00.000Z');
  const TEN_MINUTES_LATER = new Date('2026-09-15T10:10:00.000Z');

  it('devuelve al tope una reserva que nadie resolvió, y dice cuál era', async () => {
    await reserveSpend(BigInt(40_000_000), HASH_A, 'put-to-work', RESERVED_AT);
    expect(await spentToday(RESERVED_AT)).toBe(BigInt(40_000_000));

    const swept = await sweepStaleReservations(TWO_HOURS_LATER);

    expect(swept).toHaveLength(1);
    expect(swept[0]).toMatchObject({ txHash: HASH_A, drops: '40000000', purpose: 'put-to-work', day: todayKey(RESERVED_AT) });
    expect(await spentToday(TWO_HOURS_LATER)).toBe(BigInt(0));
  });

  it('no toca una reserva RECIENTE (el ledger todavía puede hablar)', async () => {
    await reserveSpend(BigInt(40_000_000), HASH_A, 'put-to-work', RESERVED_AT);
    expect(await sweepStaleReservations(TEN_MINUTES_LATER)).toEqual([]);
    expect(await spentToday(TEN_MINUTES_LATER)).toBe(BigInt(40_000_000));
  });

  it('un gasto ASENTADO no se des-gasta jamás, por viejo que sea', async () => {
    await reserveSpend(BigInt(40_000_000), HASH_A, 'put-to-work', RESERVED_AT);
    await recordSpend(BigInt(40_000_000), HASH_A, 'put-to-work', RESERVED_AT);

    expect(await sweepStaleReservations(TWO_HOURS_LATER)).toEqual([]);
    expect(await spentToday(TWO_HOURS_LATER)).toBe(BigInt(40_000_000));
  });

  it('alcanza la víspera: una reserva huérfana de ayer no estrangula el tope de hoy', async () => {
    const YESTERDAY = new Date('2026-09-14T23:00:00.000Z');
    await reserveSpend(BigInt(40_000_000), HASH_B, 'put-to-work', YESTERDAY);

    const swept = await sweepStaleReservations(new Date('2026-09-15T01:00:00.000Z'));

    expect(swept.map((r) => r.day)).toEqual([todayKey(YESTERDAY)]);
    expect(await spentToday(YESTERDAY)).toBe(BigInt(0));
  });
});

/**
 * it. 27 — EL PAYOUT DE UN CLIENTE NO GASTA EL TOPE QUE ESTRANGULA LAS ENTRADAS.
 *
 * La it. 25 quitó el tope de la POLÍTICA del payout (`capApplies`), pero el pago
 * seguía sumando a `spentDrops`, que es el número exacto que `spentToday()`
 * devuelve y con el que la política mide las ENTRADAS. Con el tope por defecto de
 * 200 XRP, una retirada de 120 dejaba a TODOS los clientes de TODAS las tomas sin
 * poder entrar hasta la medianoche UTC. El dinero de un cliente volviendo a su
 * casa no es gasto de la casa.
 *
 * El apunte se escribe igual —con hash, importe, propósito y fase— porque la
 * auditoría tiene que ver TODO lo que esta llave firmó.
 */
describe('el payout no consume el tope, pero deja su rastro', () => {
  const entriesOf = (now: Date) => ((kv.get(`${SPEND_JOB_TYPE}:${todayKey(now)}`)?.entries ?? []) as Array<Record<string, string>>);

  it('reservar y asentar un payout no mueve el contador — y su apunte queda escrito', async () => {
    await reserveSpend(BigInt(120_000_000), HASH_A, 'payout', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(0));
    expect(entriesOf(NOW)).toEqual([expect.objectContaining({ txHash: HASH_A, drops: '120000000', purpose: 'payout', phase: 'reserved' })]);

    await recordSpend(BigInt(120_000_000), HASH_A, 'payout', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(0));
    expect(entriesOf(NOW)).toEqual([expect.objectContaining({ txHash: HASH_A, purpose: 'payout', phase: 'settled' })]);
  });

  it('una entrada posterior conserva TODO su tope detrás de una retirada grande', async () => {
    await reserveSpend(BigInt(120_000_000), HASH_A, 'payout', NOW);
    await reserveSpend(BigInt(20_000_000), HASH_B, 'put-to-work', NOW);
    // Solo la entrada cuenta: 20, no 140.
    expect(await spentToday(NOW)).toBe(BigInt(20_000_000));
  });

  it('devolver o barrer un payout no deja el contador por debajo de lo gastado', async () => {
    await reserveSpend(BigInt(20_000_000), HASH_B, 'put-to-work', NOW);
    await reserveSpend(BigInt(120_000_000), HASH_A, 'payout', NOW);
    expect(await spentToday(NOW)).toBe(BigInt(20_000_000));

    await releaseSpend(HASH_A, NOW); // el ledger probó que el payout nunca entró
    expect(await spentToday(NOW)).toBe(BigInt(20_000_000));

    await reserveSpend(BigInt(90_000_000), 'C'.repeat(64), 'payout', NOW);
    const swept = await sweepStaleReservations(new Date(NOW.getTime() + 2 * 3_600_000));
    expect(swept.map((r) => r.purpose).sort()).toEqual(['payout', 'put-to-work']);
    expect(await spentToday(NOW)).toBe(BigInt(0));
  });
});

/**
 * it. 27, LA CADENA ENTERA: el XRP de un cliente sale por el libro de gasto y
 * llega a la puerta que acota las ENTRADAS. No se comprueba una función suelta:
 * se reserva un payout de verdad, se lee el total con `spentToday()` —el mismo
 * número que el autopiloto pasa a la política— y se le pregunta a `assessPayment`
 * si la siguiente entrada puede firmarse.
 *
 * Con el comportamiento anterior este test falla: 120 (payout) + 90 (entrada)
 * sobrepasan el tope de 200 y la entrada moriría en `ABOVE_DAILY_CAP` — para
 * ESTE cliente y para todos los demás de todas las tomas, hasta medianoche.
 */
describe('la cadena: una retirada no estrangula la entrada siguiente', () => {
  const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
  const CORE_VAULT = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
  const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
  const signer = { enabled: true, address: OMNIBUS, maxTxDrops: BigInt(100_000_000), dailyCapDrops: BigInt(200_000_000), allowUngatedPote: true };
  const run = { omnibusAddress: OMNIBUS, clients: [{ id: 'c1', passkeyAccount: PASSKEY }] } as unknown as Parameters<typeof assessPayment>[0]['run'];

  const entryOf = (drops: bigint, spentTodayDrops: bigint) =>
    assessPayment({
      tx: { Account: OMNIBUS, Destination: CORE_VAULT, Amount: drops.toString() },
      purpose: 'put-to-work',
      run,
      signer,
      coreVaultAddress: CORE_VAULT,
      receiver: PASSKEY,
      spentTodayDrops,
      spendLedgerPersisted: true,
    });

  it('120 XRP pagados a un cliente + 90 XRP de entrada caben bajo un tope de 200', async () => {
    await reserveSpend(BigInt(120_000_000), HASH_A, 'payout', NOW);
    await recordSpend(BigInt(120_000_000), HASH_A, 'payout', NOW);

    const spent = await spentToday(NOW);
    expect(spent).toBe(BigInt(0)); // el payout no es gasto de la casa

    expect(entryOf(BigInt(90_000_000), spent).ok).toBe(true);
    // Y el tope sigue existiendo para lo que si acota: sumado a esos 90, un
    // segundo 90 ya no cabe.
    expect(entryOf(BigInt(90_000_000), BigInt(120_000_000)).code).toBe('ABOVE_DAILY_CAP');
  });
});
