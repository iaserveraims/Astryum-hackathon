/**
 * EL GEMELO LATENTE DENTRO DE LA PUERTA.
 *
 * `releaseAbandonedCeremonySeat` suelta el asiento de nonce de un 0xFE ANTES de
 * que caduque su payload, y todo su argumento de seguridad es que esos bytes los
 * pinó el coordinador multifirma (`prepareCouncilMultisig`: `Sequence` FIJADA).
 * Con la Sequence fijada, dos Payments del mismo consejo llevan el MISMO número y
 * como mucho uno puede aplicar — el otro muere `tefPAST_SEQ` sin llegar al Core
 * Vault, así que el gemelo (dos Payments dentro y un userOp en `InvalidNonce` con
 * el XRP del cliente ya pagado) es imposible.
 */
const mockRows: Array<{ id: number; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date }> = [];
const mockDb = { down: false };
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      findFirst: async ({
        where,
      }: {
        where: { jobType: string; status?: string; payload?: { path: string[]; equals: unknown } };
      }) => {
        if (mockDb.down) throw new Error('db down');
        return (
          mockRows.find(
            (r) =>
              r.jobType === where.jobType &&
              (where.status === undefined || r.status === where.status) &&
              (!where.payload || r.payload[where.payload.path[0]] === where.payload.equals),
          ) ?? null
        );
      },
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        if (mockDb.down) throw new Error('db down');
        const row = mockRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import {
  __resetUnwrittenCeremonyPins,
  ceremonyPinOf,
  ceremonySittingIsStale,
  releaseAbandonedCeremonySeat,
  seatReleaseAnswer,
  stampCeremonyPin,
  unwrittenCeremonyPinOf,
} from '../DirectMintHandoffStore';
import { handoffCeremonyExpiryMin, handoffPayloadExpiryMin } from '../handoffAuthority';

const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const OTHER = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const ENV = { ...process.env };

/** Una fila de ceremonia recién compuesta: ventana larga, sin firmar, sin pin. */
function queueCeremonyRow(over: Record<string, unknown> = {}): void {
  mockRows.length = 0;
  mockRows.push({
    id: 1,
    jobType: '0xfe-handoff',
    status: 'queued',
    createdAt: new Date(Date.now() - 60_000),
    payload: {
      memoHex: MEMO,
      xrplAddress: COUNCIL,
      userOpHash: '0x' + 'aa'.repeat(32),
      payloadExpiryMin: handoffCeremonyExpiryMin(),
      lastLedgerSequence: 90_021_600,
      composedLedgerIndex: 90_000_000,
      ...over,
    },
  });
}

const row = () => mockRows[0].payload;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, DATABASE_URL: 'postgres://test' };
  mockDb.down = false;
  __resetUnwrittenCeremonyPins();
  queueCeremonyRow();
});
afterAll(() => {
  process.env = ENV;
});

describe('ceremonyPinOf — qué cuenta como prueba de que estos bytes los pinamos', () => {
  it('una Sequence entera y positiva es la prueba; nada más lo es', () => {
    expect(ceremonyPinOf({ ceremonyPinnedSequence: 42 })).toBe(42);
    expect(ceremonyPinOf({ ceremonyPinnedSequence: 0 })).toBeNull();
    expect(ceremonyPinOf({ ceremonyPinnedSequence: -1 })).toBeNull();
    expect(ceremonyPinOf({ ceremonyPinnedSequence: 4.5 })).toBeNull();
    expect(ceremonyPinOf({ ceremonyPinnedSequence: null })).toBeNull();
    expect(ceremonyPinOf({ ceremonyPinnedSequence: '42' as unknown as number })).toBeNull();
    expect(ceremonyPinOf(null)).toBeNull();
  });
});

describe('la puerta del asiento abandonado exige la marca del coordinador', () => {
  /**
   * SIN MARCA NO HAY PARED: HAY LA REGLA ORDINARIA. Devolvía
   * aquí un `not-pinned-by-us` seco y paraba, así que una fila sin marca — la de
   * una BD que parpadeó al sellar, o cualquiera anterior a — no tenía
   * NINGUNA regla, ni la que `/handoff/release` aplica a cualquier borrador.
   * Ahora cae a esa regla: con el payload VIVO no se suelta (el reloj no se
   * sustituye sin prueba de Sequence fijada) y se contesta la cuenta atrás REAL.
   */
  it('SIN pin y con el payload vivo: no suelta, y dice cuánto queda en vez de una pared', async () => {
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { validatedLedgerIndex: 90_000_100 });

    expect(out.released).toBe(false);
    expect(out.reason).toBe('not-pinned-by-us');
    expect(out.pin).toBe('none');
    expect(out.verdict?.code).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
    expect(out.verdict?.secondsLeft).toBeGreaterThan(0);
    expect(mockRows[0].status).toBe('queued'); // nada se movió
  });

  it('SIN pin y con el payload muerto por su propio reloj y la ventana vacía, el asiento vuelve', async () => {
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, {
      nowMs: Date.now() + 25 * 60 * 60 * 1000,
      validatedLedgerIndex: 90_000_100,
      readWindow: async () => ({ state: 'absent' }) as never,
    });

    expect(out.released).toBe(true);
    expect(out.pin).toBe('none');
    expect(out.verdict?.reason).toBe('payload-expired'); // el reloj, no el titular
    expect(mockRows[0].status).toBe('superseded');
  });

  /**
   * EL PIN QUE LA BASE NO DEJÓ ESCRIBIR. El coordinador pinó (el
   * hecho existe) y la BD rechazó la marca. Ese hecho vive en la memoria del
   * proceso, así que la puerta actúa como con la marca en la fila — y de paso la
   * escribe, ahora que la BD volvió.
   */
  it('un pin que no se pudo escribir se recupera de memoria y la puerta actúa como con pin', async () => {
    mockDb.down = true;
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204)).toEqual({ stamped: false, reason: 'store' });
    expect(unwrittenCeremonyPinOf(MEMO, COUNCIL)).toBe(771_204);
    expect(ceremonyPinOf(row())).toBeNull(); // la fila sigue sin marca

    mockDb.down = false;
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, {
      validatedLedgerIndex: 90_000_100,
      readWindow: async () => ({ state: 'absent' }) as never,
    });

    expect(out.released).toBe(true);
    expect(out.pin).toBe('recovered');
    expect(out.verdict?.reason).toBe('ceremony-ended'); // el titular, no el reloj
    expect(ceremonyPinOf(row())).toBe(771_204); // …y la marca quedó escrita al fin
    expect(unwrittenCeremonyPinOf(MEMO, COUNCIL)).toBeNull();
  });

  it('la memoria del pin es de (memo, cuenta): otra cuenta no hereda la prueba', async () => {
    mockDb.down = true;
    await stampCeremonyPin(MEMO, COUNCIL, 771_204);
    mockDb.down = false;
    expect(unwrittenCeremonyPinOf(MEMO, OTHER)).toBeNull();
  });

  it('CON pin —y con la ventana leída y vacía— el asiento vuelve', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204);
    expect(ceremonyPinOf(row())).toBe(771_204);

    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, {
      validatedLedgerIndex: 90_000_100,
      readWindow: async () => ({ state: 'absent' }) as never,
    });

    expect(out.released).toBe(true);
    expect(out.verdict?.reason).toBe('ceremony-ended');
    expect(mockRows[0].status).toBe('superseded');
  });

  /**
   * LOS TRES CERROJOS QUE YA HABÍA, INTACTOS. El nuevo se añade, no sustituye.
   */
  it('un memo de OTRA cuenta no abre el asiento de nadie, ni con pin', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204);
    expect(await releaseAbandonedCeremonySeat(MEMO, OTHER)).toEqual({ released: false, reason: 'other-account' });
  });

  it('una fila que no es de una ceremonia no pasa por esta puerta', async () => {
    queueCeremonyRow({ payloadExpiryMin: handoffPayloadExpiryMin() });
    await stampCeremonyPin(MEMO, COUNCIL, 771_204);
    expect(await releaseAbandonedCeremonySeat(MEMO, COUNCIL)).toEqual({ released: false, reason: 'not-a-ceremony' });
  });

  it('una fila FIRMADA no se suelta: su asiento está consumido, no libre', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204);
    row().signedAt = new Date().toISOString();

    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, {
      validatedLedgerIndex: 90_000_100,
      readWindow: async () => ({ state: 'absent' }) as never,
    });
    expect(out.released).toBe(false);
    expect(mockRows[0].status).toBe('queued');
  });

  /**
   * «NO PUDE LEER» NO ES «NO HABÍA NADA». Una lectura fallida de la fila SUBE como
   * error tipado (`strict`), nunca como «ese memo no existe» — que es lo que
   * dejaría soltar un asiento a ciegas.
   */
  it('una BD caída lanza en vez de contestar «no hay fila»', async () => {
    mockDb.down = true;
    await expect(releaseAbandonedCeremonySeat(MEMO, COUNCIL)).rejects.toThrow();
  });

  /**
   * Y la mitad que la marca NO sustituye: con la ventana ilegible el asiento
   * sigue retenido, pinado o no. La ceremonia terminada reemplaza el RELOJ del
   * payload, jamás la lectura del ledger (conservado).
   */
  it('con pin pero sin poder leer la ventana, el asiento NO se suelta', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204);

    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, {
      validatedLedgerIndex: 90_000_100,
      readWindow: async () => {
        throw new Error('xrpl node down');
      },
    });

    expect(out.released).toBe(false);
    expect(out.verdict?.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(mockRows[0].status).toBe('queued');
  });
});

/**
 * LA CARRERA DEL BUS, VISTA DESDE EL PIN.
 *
 * Dos sittings de la misma sesión sobre los mismos bytes re-estampan el mismo
 * memo con la misma Sequence. La liberación TARDÍA del primero pasaba por aquí
 * con el pin presente y soltaba el asiento bajo el segundo. El pin lleva ahora el
 * id del sitting que lo puso; el más reciente manda, esté en la fila o en la nota
 * en memoria (una BD que rechazó el último sellado); y una liberación con otro id
 * es un no-op que no toca la fila. Mutación: quitar la comparación
 * (`ceremonySittingIsStale` en `releaseAbandonedCeremonySeat`) → rojo.
 */
describe('El pin distingue sittings: una liberación obsoleta no toca la fila', () => {
  const window = { validatedLedgerIndex: 90_000_100, readWindow: async () => ({ state: 'absent' }) as never };

  it('ceremonySittingIsStale — la tabla de verdad', () => {
    expect(ceremonySittingIsStale('B', 'A')).toBe(true); // otro sitting puso el pin
    expect(ceremonySittingIsStale('B', null)).toBe(true); // un sitting sin nombre no alcanza uno con nombre
    expect(ceremonySittingIsStale('B', 'B')).toBe(false); // el mismo
    expect(ceremonySittingIsStale('B', undefined)).toBe(false); // cliente anterior al campo: no se compara
    expect(ceremonySittingIsStale(null, 'A')).toBe(false); // pin sin nombre (anterior al campo): no hay con qué comparar
    expect(ceremonySittingIsStale(undefined, 'A')).toBe(false);
    expect(ceremonySittingIsStale('', 'A')).toBe(false);
    expect(ceremonySittingIsStale(null, null)).toBe(false);
    expect(ceremonySittingIsStale(42 as unknown as string, 'A')).toBe(false); // basura no es un nombre
  });

  it('el sellado escribe el id del sitting; un sellado posterior con otro id lo SUSTITUYE', async () => {
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-1' })).toEqual({ stamped: true });
    expect(row().ceremonySittingId).toBe('sitting-1');
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-2' })).toEqual({ stamped: true });
    expect(row().ceremonySittingId).toBe('sitting-2');
    expect(ceremonyPinOf(row())).toBe(771_204);
  });

  it('LA FASE: pin del sitting #2, liberación con el id del #1 → stale-sitting, la fila sigue `queued` y la ventana ni se lee', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-1' });
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-2' });
    const readWindow = jest.fn(async () => ({ state: 'absent' }) as never);

    const late = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { validatedLedgerIndex: 90_000_100, readWindow, sittingId: 'sitting-1' });

    expect(late).toEqual({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(mockRows[0].status).toBe('queued');
    expect(row().ceremonySittingId).toBe('sitting-2');
    expect(readWindow).not.toHaveBeenCalled();

    // …y el sitting vivo sí puede soltar.
    const own = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-2' });
    expect(own.released).toBe(true);
    expect(own.verdict?.reason).toBe('ceremony-ended');
    expect(mockRows[0].status).toBe('superseded');
  });

  it('un sitting sin nombre (`null`) no alcanza un pin con nombre', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-1' });
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: null });
    expect(out).toEqual({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(mockRows[0].status).toBe('queued');
  });

  /**
   * «El más reciente manda» también cuando la BD rechazó el último sellado: la
   * fila dice #1 y la nota en memoria dice #2 (más nueva). Comparar solo con la
   * fila daría por vigente al #1 — el agujero por otra puerta.
   */
  it('con la fila en #1 y la nota (más nueva) en #2: el #1 es obsoleto y el #2 suelta — y la fila queda re-sellada con #2', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-1' });
    // La nota tiene que ser estrictamente posterior a `ceremonyPinnedAt` de la fila.
    row().ceremonyPinnedAt = new Date(Date.now() - 5_000).toISOString();
    mockDb.down = true;
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-2' })).toEqual({ stamped: false, reason: 'store' });
    mockDb.down = false;
    expect(row().ceremonySittingId).toBe('sitting-1'); // la fila no se enteró

    const stale = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-1' });
    expect(stale.released).toBe(false);
    expect(stale.reason).toBe('stale-sitting');
    expect(mockRows[0].status).toBe('queued');

    const own = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-2' });
    expect(own.released).toBe(true);
    expect(own.pin).toBe('row');
    expect(row().ceremonySittingId).toBe('sitting-2'); // el reintento escribió el nombre vigente
    expect(unwrittenCeremonyPinOf(MEMO, COUNCIL)).toBeNull();
  });

  it('con la fila SIN pin y la nota en #2 (recuperado): el #1 es obsoleto, el #2 suelta', async () => {
    mockDb.down = true;
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-2' });
    mockDb.down = false;
    expect(ceremonyPinOf(row())).toBeNull();

    const stale = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-1' });
    expect(stale).toEqual({ released: false, reason: 'stale-sitting', pin: 'recovered' });
    expect(mockRows[0].status).toBe('queued');

    const own = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-2' });
    expect(own.released).toBe(true);
    expect(own.pin).toBe('recovered');
    expect(row().ceremonySittingId).toBe('sitting-2');
  });

  it('la #1 falló (nota) y la #2 entró (fila): el sellado que entra borra la nota vieja, y manda la fila', async () => {
    mockDb.down = true;
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-1' });
    mockDb.down = false;
    await new Promise((r) => setTimeout(r, 5));
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-2' }); // borra la nota al escribir
    expect(unwrittenCeremonyPinOf(MEMO, COUNCIL)).toBeNull();

    const stale = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-1' });
    expect(stale.reason).toBe('stale-sitting');
    const own = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'sitting-2' });
    expect(own.released).toBe(true);
  });

  /**
   * LO QUE NO CAMBIA (controles). Un llamador anterior no manda id y la puerta es
   * la de antes; un pin anterior al campo no tiene nombre y lo suelta cualquier id;
   * y una fila sin pin ni nota sigue cayendo a la regla ordinaria, id o no.
   */
  it('control: sin `sittingId` (llamador anterior) la puerta es la de siempre', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204, { sittingId: 'sitting-2' });
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, window);
    expect(out.released).toBe(true);
    expect(mockRows[0].status).toBe('superseded');
  });

  it('control: un pin anterior al campo (sin nombre) lo suelta cualquier id', async () => {
    await stampCeremonyPin(MEMO, COUNCIL, 771_204); // sin opts: como antes
    expect(row().ceremonySittingId).toBeNull();
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { ...window, sittingId: 'whoever' });
    expect(out.released).toBe(true);
  });

  it('control: sin pin ni nota, un id no inventa nada — regla ordinaria, con su cuenta atrás', async () => {
    const out = await releaseAbandonedCeremonySeat(MEMO, COUNCIL, { validatedLedgerIndex: 90_000_100, sittingId: 'sitting-1' });
    expect(out.released).toBe(false);
    expect(out.reason).toBe('not-pinned-by-us');
    expect(out.verdict?.code).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
    expect(mockRows[0].status).toBe('queued');
  });

  it('seatReleaseAnswer — `stale-sitting` se dice como lo que es: nada cambió, otro sitting tiene el asiento', () => {
    const seat = seatReleaseAnswer({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(seat).toMatchObject({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(String(seat.detail)).toMatch(/newer sitting/i);
    expect(String(seat.detail)).toMatch(/nothing was changed/i);
    expect(seat.secondsLeft).toBeUndefined(); // no hay cuenta atrás que inventar
  });
});

describe('stampCeremonyPin — quién puede escribir esa prueba, y sobre qué', () => {
  it('escribe la Sequence y la hora sobre la fila de ESTA cuenta', async () => {
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204)).toEqual({ stamped: true });
    expect(row().ceremonyPinnedSequence).toBe(771_204);
    expect(typeof row().ceremonyPinnedAt).toBe('string');
  });

  it('jamás marca la fila de otra cuenta — sería fabricar una prueba falsa', async () => {
    expect(await stampCeremonyPin(MEMO, OTHER, 771_204)).toEqual({ stamped: false, reason: 'other-account' });
    expect(ceremonyPinOf(row())).toBeNull();
  });

  it('jamás marca una fila ya firmada', async () => {
    row().signedAt = new Date().toISOString();
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204)).toEqual({ stamped: false, reason: 'signed' });
    expect(ceremonyPinOf(row())).toBeNull();
  });

  it('una Sequence que no es una Sequence no se escribe', async () => {
    expect(await stampCeremonyPin(MEMO, COUNCIL, 0)).toEqual({ stamped: false, reason: 'bad-sequence' });
    expect(await stampCeremonyPin(MEMO, COUNCIL, NaN)).toEqual({ stamped: false, reason: 'bad-sequence' });
    expect(ceremonyPinOf(row())).toBeNull();
  });

  /**
   * Best-effort a propósito: una escritura que no entra deja la puerta de
   * liberación tan cerrada como estaba antes. Lo que NUNCA hace es tirar la ceremonia entera.
   */
  it('una BD caída no lanza: informa, y el asiento se seguirá soltando solo', async () => {
    mockDb.down = true;
    expect(await stampCeremonyPin(MEMO, COUNCIL, 771_204)).toEqual({ stamped: false, reason: 'store' });
  });
});


/**
 * LO QUE SE DICE, DICHO EN INDICATIVO SOLO CUANDO SE COMPROBÓ.
 * `seatReleaseAnswer` es la única gramática del campo `seat` en las dos puertas
 * (la ceremonia y la retirada de una propuesta).
 */
describe('seatReleaseAnswer — el campo `seat`, con las palabras justas', () => {
  it('sin marca: dice «no consta», nunca «no pasó por aquí», y lleva la cuenta atrás', () => {
    const seat = seatReleaseAnswer({
      released: false,
      reason: 'not-pinned-by-us',
      pin: 'none',
      verdict: { release: false, code: 'WAIT_FOR_PAYLOAD_EXPIRY', retryable: true, secondsLeft: 86_000, lastLedgerSequence: 90_021_600, detail: 'That dispatch is still signable in Xaman.' },
    });
    expect(seat).toMatchObject({ released: false, reason: 'not-pinned-by-us', pin: 'none', code: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 86_000, lastLedgerSequence: 90_021_600, retryable: true });
    const detail = String(seat.detail);
    expect(detail).toMatch(/no record/i);
    expect(detail).not.toMatch(/was not pinned by/i);
    expect(detail).toContain('That dispatch is still signable in Xaman.');
  });

  it('soltado: dice el motivo del veredicto y de dónde salió la prueba', () => {
    expect(seatReleaseAnswer({ released: true, pin: 'recovered', verdict: { release: true, reason: 'ceremony-ended' } })).toEqual({
      released: true,
      reason: 'ceremony-ended',
      pin: 'recovered',
    });
  });

  it('los cerrojos que no son el pin se contestan tal cual', () => {
    expect(seatReleaseAnswer({ released: false, reason: 'other-account' })).toEqual({ released: false, reason: 'other-account' });
    expect(seatReleaseAnswer({ released: false, reason: 'not-a-ceremony' })).toEqual({ released: false, reason: 'not-a-ceremony' });
  });

  it('con pin y una ventana ilegible: el veredicto viaja entero', () => {
    const seat = seatReleaseAnswer({
      released: false,
      pin: 'row',
      verdict: { release: false, code: 'NONCE_SEAT_UNREADABLE', retryable: true, needsWindow: false, lastLedgerSequence: 90_021_600, detail: 'no node could confirm' },
    });
    expect(seat).toEqual({ released: false, pin: 'row', code: 'NONCE_SEAT_UNREADABLE', retryable: true, lastLedgerSequence: 90_021_600, detail: 'no node could confirm' });
  });
});
