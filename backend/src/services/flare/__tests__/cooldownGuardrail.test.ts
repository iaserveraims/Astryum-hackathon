import {
  cooldownCoversQueue,
  queuedVenueMinCooldownSeconds,
  ERC4626_QUEUED_KIND,
} from '../cooldownGuardrail';

const SYNC = 0; // ERC4626
const COMP = 1; // CompoundV2
const QUEUED = ERC4626_QUEUED_KIND; // 2
const MIN = 72 * 3600;

describe('cooldownCoversQueue — el cooldown debe cubrir la cola de salida', () => {
  it('sin venue encolado, cualquier cooldown vale (no hay cola que cubrir)', () => {
    expect(cooldownCoversQueue(0, [SYNC], MIN).ok).toBe(true);
    expect(cooldownCoversQueue(0, [SYNC, COMP], MIN).ok).toBe(true);
  });

  it('con venue encolado, cooldown ≥ piso pasa (72h cubre la cola de Firelight)', () => {
    expect(cooldownCoversQueue(MIN, [QUEUED], MIN).ok).toBe(true);
    expect(cooldownCoversQueue(MIN, [SYNC, QUEUED], MIN).ok).toBe(true);
    expect(cooldownCoversQueue(MIN + 1, [QUEUED], MIN).ok).toBe(true);
  });

  it('con venue encolado, cooldown 0 o más corto que la cola se rechaza con motivo', () => {
    const zero = cooldownCoversQueue(0, [QUEUED], MIN);
    expect(zero.ok).toBe(false);
    expect(zero.minSeconds).toBe(MIN);
    expect(zero.reason).toMatch(/claimRedeem reverts/);

    const short = cooldownCoversQueue(24 * 3600, [QUEUED], MIN);
    expect(short.ok).toBe(false);
    expect(short.reason).toMatch(/72h/);
  });
});

describe('queuedVenueMinCooldownSeconds — el piso configurable, con default seguro', () => {
  const prev = process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS;
    else process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS = prev;
  });

  it('sin entorno, el default es 72h', () => {
    delete process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS;
    expect(queuedVenueMinCooldownSeconds()).toBe(72 * 3600);
  });

  it('un entorno válido lo sube; uno malformado cae al default (fail-safe)', () => {
    process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS = String(96 * 3600);
    expect(queuedVenueMinCooldownSeconds()).toBe(96 * 3600);
    process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS = 'no-soy-un-numero';
    expect(queuedVenueMinCooldownSeconds()).toBe(72 * 3600);
    process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS = '-5';
    expect(queuedVenueMinCooldownSeconds()).toBe(72 * 3600);
  });
});
