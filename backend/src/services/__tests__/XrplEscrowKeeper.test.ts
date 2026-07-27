import { isoTimeToRippleTime } from 'xrpl';
import { decideEscrowAction, XrplEscrowKeeper, type KeeperEscrow } from '../XrplEscrowKeeper';

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
