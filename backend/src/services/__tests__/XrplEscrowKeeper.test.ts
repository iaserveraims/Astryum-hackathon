import { isoTimeToRippleTime } from 'xrpl';
import {
  decideEscrowAction,
  safeSeedReason,
  XrplEscrowKeeper,
  type KeeperEscrow,
} from '../XrplEscrowKeeper';
import { _resetAgentTicksForTests, agentTicks } from '../ops/agentHeartbeats';
import { opsAlert } from '../OpsAlertService';

// El canal de ops se intercepta: aquí se comprueba QUÉ se grita, no que Discord conteste.
jest.mock('../OpsAlertService', () => ({ opsAlert: jest.fn().mockResolvedValue(undefined) }));
const opsAlertMock = opsAlert as jest.MockedFunction<typeof opsAlert>;

const OWNER = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const NOW = Date.now();

function rt(offsetMs: number): number {
  return isoTimeToRippleTime(new Date(NOW + offsetMs).toISOString());
}

function escrow(partial: Partial<KeeperEscrow>): KeeperEscrow {
  return { owner: OWNER, previousTxnID: 'A'.repeat(64), hasCondition: false, ...partial };
}

const HOUR = 3_600_000;

describe('decideEscrowAction — la política determinista del keeper (reglas del ledger)', () => {
  test('antes de FinishAfter: nada', () => {
    expect(decideEscrowAction(escrow({ finishAfter: rt(+HOUR) }), NOW)).toBeNull();
  });

  test('entre FinishAfter y CancelAfter: finish (entrega al Destination)', () => {
    expect(
      decideEscrowAction(escrow({ finishAfter: rt(-HOUR), cancelAfter: rt(+HOUR) }), NOW),
    ).toBe('finish');
  });

  test('sin CancelAfter, pasado FinishAfter: finish', () => {
    expect(decideEscrowAction(escrow({ finishAfter: rt(-HOUR) }), NOW)).toBe('finish');
  });

  test('pasado CancelAfter: cancel (el ledger ya no permite finish — tecNO_PERMISSION)', () => {
    expect(
      decideEscrowAction(escrow({ finishAfter: rt(-2 * HOUR), cancelAfter: rt(-HOUR) }), NOW),
    ).toBe('cancel');
  });

  test('con Condition: JAMÁS finish (el preimage no vive en el backend) — solo cancel al expirar', () => {
    // finishable en tiempo, pero condicionado → nada
    expect(
      decideEscrowAction(
        escrow({ finishAfter: rt(-HOUR), cancelAfter: rt(+HOUR), hasCondition: true }),
        NOW,
      ),
    ).toBeNull();
    // expirado → cancel (devuelve al Owner, la recuperación diseñada)
    expect(
      decideEscrowAction(
        escrow({ finishAfter: rt(-2 * HOUR), cancelAfter: rt(-HOUR), hasCondition: true }),
        NOW,
      ),
    ).toBe('cancel');
  });

  test('sin tiempos aplicables: nada', () => {
    expect(decideEscrowAction(escrow({}), NOW)).toBeNull();
  });
});

describe('XrplEscrowKeeper.start — flags y guardas (#10: nada sin flag)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  const isRunning = (k: XrplEscrowKeeper): boolean =>
    (k as unknown as { timer: unknown }).timer !== null;

  test('no arranca sin XRPL_KEEPER_ENABLED=true', () => {
    delete process.env.XRPL_KEEPER_ENABLED;
    const k = new XrplEscrowKeeper();
    k.start();
    expect(isRunning(k)).toBe(false);
    k.stop();
  });

  test('no arranca con flag pero sin seed propia o sin cuentas vigiladas', () => {
    process.env.XRPL_KEEPER_ENABLED = 'true';
    delete process.env.XRPL_KEEPER_SEED;
    process.env.XRPL_KEEPER_ACCOUNTS = OWNER;
    const noSeed = new XrplEscrowKeeper();
    noSeed.start();
    expect(isRunning(noSeed)).toBe(false);
    noSeed.stop();

    process.env.XRPL_KEEPER_SEED = 'sEdTM1uX8pu2do5XvTnutH6HsouMaM2'; // seed de ejemplo xrpl.js, no fondos
    process.env.XRPL_KEEPER_ACCOUNTS = 'not-an-address';
    const noAccounts = new XrplEscrowKeeper();
    noAccounts.start();
    expect(isRunning(noAccounts)).toBe(false);
    noAccounts.stop();
  });

  test('arranca con flag + seed + cuentas válidas (y stop lo apaga)', () => {
    process.env.XRPL_KEEPER_ENABLED = 'true';
    process.env.XRPL_KEEPER_SEED = 'sEdTM1uX8pu2do5XvTnutH6HsouMaM2';
    process.env.XRPL_KEEPER_ACCOUNTS = `${OWNER}, rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe`;
    const k = new XrplEscrowKeeper();
    k.start();
    expect(isRunning(k)).toBe(true);
    k.stop();
    expect(isRunning(k)).toBe(false);
  });
});

/**
 * G11 — el flag encendido y el keeper que no arranca.
 *
 * Antes: `start()` hacía console.error y volvía SIN registrar latido, así que un
 * keeper que el operador quiso encender era indistinguible de un carril apagado
 * a propósito (agentHeartbeats solo vigila a quien se anunció alguna vez). Los
 * tests de aquí fijan la señal: latido FALLANDO que se repite + un aviso a ops
 * con el env que hay que tocar, y ni una letra de la clave por el camino.
 */
describe('G11 — que el keeper no arranque no puede ser un silencio', () => {
  const env = { ...process.env };
  const ID = 'xrpl-escrow-keeper';
  /** Seed de ejemplo de xrpl.js (ed25519, sin fondos) — deriva cuenta de verdad. */
  const GOOD_SEED = 'sEdTM1uX8pu2do5XvTnutH6HsouMaM2';

  const beat = () => agentTicks().find((a) => a.id === ID);

  beforeEach(() => {
    _resetAgentTicksForTests();
    opsAlertMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  test('apagado por flag: sigue sin vigilarse — el silencio POR DISEÑO se conserva', () => {
    delete process.env.XRPL_KEEPER_ENABLED;
    const k = new XrplEscrowKeeper();
    k.start();
    expect(beat()).toBeUndefined();
    expect(opsAlertMock).not.toHaveBeenCalled();
    k.stop();
  });

  test('flag ON sin seed: late FALLANDO, avisa a ops y dice qué env tocar', () => {
    process.env.XRPL_KEEPER_ENABLED = 'true';
    delete process.env.XRPL_KEEPER_SEED;
    process.env.XRPL_KEEPER_ACCOUNTS = OWNER;
    const k = new XrplEscrowKeeper();
    k.start();

    expect(beat()).toMatchObject({ ok: false, failures: 1 });
    expect(beat()?.detail).toContain('XRPL_KEEPER_SEED');
    expect(opsAlertMock).toHaveBeenCalledTimes(1);
    const [source, level, message, opts] = opsAlertMock.mock.calls[0];
    expect(source).toBe(ID);
    expect(level).toBe('warn');
    expect(message).toContain('XRPL_KEEPER_SEED');
    expect(opts?.runbook).toContain('XRPL_KEEPER_SEED');
    // El keeper NO corre: la alarma late, pero nada aquí firma ni finge estar vivo.
    expect((k as unknown as { timer: unknown }).timer).toBeNull();
    expect(k.status()).toMatchObject({ enabled: true, running: false });
    expect(k.status().notStartedReason).toContain('XRPL_KEEPER_SEED');
    k.stop();
  });

  test('flag ON con seed ilegible: tampoco arranca, y el motivo no lleva ni una letra de la clave', () => {
    process.env.XRPL_KEEPER_ENABLED = 'true';
    process.env.XRPL_KEEPER_SEED = 'esto-no-es-una-seed'; // xrpl.js contesta «Unknown letter: "-"»
    process.env.XRPL_KEEPER_ACCOUNTS = OWNER;
    const k = new XrplEscrowKeeper();
    k.start();

    // Antes esto ARRANCABA: la seed solo se tocaba el día que hubiera un escrow
    // que vencer, y hasta entonces el keeper latía en verde sin poder firmar nada.
    expect((k as unknown as { timer: unknown }).timer).toBeNull();
    expect(beat()).toMatchObject({ ok: false });
    const said = `${beat()?.detail} ${String(opsAlertMock.mock.calls[0]?.[2])}`;
    expect(said).toContain('XRPL_KEEPER_SEED');
    expect(said).not.toContain('esto-no-es-una-seed');
    expect(said).not.toContain('Unknown letter'); // el error de xrpl.js cita UN carácter de la clave
    k.stop();
  });

  test('flag ON sin cuentas vigiladas válidas: misma señal', () => {
    process.env.XRPL_KEEPER_ENABLED = 'true';
    process.env.XRPL_KEEPER_SEED = GOOD_SEED;
    process.env.XRPL_KEEPER_ACCOUNTS = 'not-an-address';
    const k = new XrplEscrowKeeper();
    k.start();

    expect(beat()).toMatchObject({ ok: false });
    expect(beat()?.detail).toContain('XRPL_KEEPER_ACCOUNTS');
    expect(opsAlertMock).toHaveBeenCalledTimes(1);
    k.stop();
  });

  test('la alarma se REPITE: el probe ve «falla», nunca el falso «su ciclo se ha parado»', () => {
    jest.useFakeTimers();
    try {
      process.env.XRPL_KEEPER_ENABLED = 'true';
      delete process.env.XRPL_KEEPER_SEED;
      process.env.XRPL_KEEPER_ACCOUNTS = OWNER;
      process.env.XRPL_KEEPER_INTERVAL_MIN = '5';
      const k = new XrplEscrowKeeper();
      k.start();
      expect(beat()).toMatchObject({ failures: 1 });

      // Justo pasada la tolerancia del probe `agentes` (3× cadencia + 1 min de gracia):
      // ahí es donde un latido único habría degenerado en «lleva N min sin dar señal».
      const everyMs = 5 * 60_000;
      jest.advanceTimersByTime(everyMs * 3 + 61_000);
      const b = beat();
      expect(b).toBeDefined();
      expect(b!.failures).toBeGreaterThanOrEqual(4); // sigue fallando, tick tras tick
      expect(Date.now() - b!.atMs).toBeLessThanOrEqual(b!.everyMs * 3 + 60_000); // y sigue FRESCO
      // Un aviso por arranque, no uno por latido: un canal que grita por todo se silencia.
      expect(opsAlertMock).toHaveBeenCalledTimes(1);
      k.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  test('config buena: ni alarma ni latido de fallo (el keeper corre y late en su tick)', () => {
    process.env.XRPL_KEEPER_ENABLED = 'true';
    process.env.XRPL_KEEPER_SEED = GOOD_SEED;
    process.env.XRPL_KEEPER_ACCOUNTS = OWNER;
    const k = new XrplEscrowKeeper();
    k.start();
    expect(beat()).toBeUndefined();
    expect(opsAlertMock).not.toHaveBeenCalled();
    expect(k.status()).toMatchObject({ enabled: true, running: true, notStartedReason: null });
    k.stop();
  });
});

describe('safeSeedReason — el motivo, jamás la clave (invariante #2)', () => {
  test('los códigos propios pasan enteros: son accionables y no citan la clave', () => {
    const own = 'XRPL_SECRET_NUMBERS_CHECKSUM: el grupo 3 no cuadra su dígito de control';
    expect(safeSeedReason(own)).toBe(own);
  });

  test('lo que venga de xrpl.js se colapsa: cita caracteres de la propia seed', () => {
    const leaky = 'Unknown letter: "-". Allowed: rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
    const safe = safeSeedReason(leaky);
    expect(safe).not.toContain('Unknown letter');
    expect(safe).toContain('family seed');
  });

  test('sin error tampoco se inventa nada', () => {
    expect(safeSeedReason(undefined)).toContain('family seed');
  });
});
