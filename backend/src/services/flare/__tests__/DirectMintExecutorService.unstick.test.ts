/**
 * Desatasco del watcher 0xFE (modal de /app/admin) — comportamiento real de la
 * clase, sin RPC ni DB (sin DATABASE_URL los helpers del store son no-ops y
 * findHandoffByUserOpHash devuelve null: exactamente el fallback que el modal
 * tiene que sobrevivir).
 *
 * Qué se prueba y por qué:
 *  1. directionForAction: el mapa acción→dirección que etiqueta el modal
 *     (entrante = deposita, saliente = retira, otra = interna). Si una acción
 *     nueva cae en 'desconocida' el modal no miente — solo deja de etiquetar.
 *  2. park → listStuck: aparcar a mano deja el dispatch visible con su motivo
 *     y SIN reintentos (la ausencia de coste es la promesa del botón).
 *  3. retry: des-aparca y limpia contadores; con el watcher APAGADO no lanza
 *     barrido (kicked=false) — jamás un tick sin clave.
 *  4. skip-list del env: retry avisa (envSkipListed) y NO lanza barrido — el
 *     próximo tick lo re-aparcaría; mentir con un "reintentando" sería el
 *     patrón 'éxito no ganado'.
 */
import {
  DirectMintExecutorWatcher,
  directionForAction,
} from '../DirectMintExecutorService';

const HASH = 'B'.repeat(64);
const ORIGINAL_DB = process.env.DATABASE_URL;
const ORIGINAL_SKIP = process.env.FLARE_EXECUTOR_SKIP_TXS;
const ORIGINAL_PK = process.env.FLARE_EXECUTOR_PK;

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.FLARE_EXECUTOR_SKIP_TXS;
  delete process.env.FLARE_EXECUTOR_PK;
});

afterAll(() => {
  if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB;
  if (ORIGINAL_SKIP === undefined) delete process.env.FLARE_EXECUTOR_SKIP_TXS;
  else process.env.FLARE_EXECUTOR_SKIP_TXS = ORIGINAL_SKIP;
  if (ORIGINAL_PK === undefined) delete process.env.FLARE_EXECUTOR_PK;
  else process.env.FLARE_EXECUTOR_PK = ORIGINAL_PK;
});

describe('directionForAction — la etiqueta entrante/saliente del modal', () => {
  it('entradas: e1/e3/vault:*/supply-usdt0/bridge*', () => {
    expect(directionForAction('e1')).toBe('entrante');
    expect(directionForAction('e3')).toBe('entrante');
    expect(directionForAction('vault:firelight')).toBe('entrante');
    expect(directionForAction('supply-usdt0')).toBe('entrante');
  });

  it('salidas: vault-withdraw/vault-claim/pa-withdraw-transfer', () => {
    expect(directionForAction('vault-withdraw:earnxrp')).toBe('saliente');
    expect(directionForAction('vault-claim')).toBe('saliente');
    expect(directionForAction('pa-withdraw-transfer:fxrp')).toBe('saliente');
  });

  it('internas: pa-repay y la rotación; null/desconocida no inventa', () => {
    expect(directionForAction('pa-repay')).toBe('otra');
    expect(directionForAction('vault-rotate:firelight->earnxrp')).toBe('otra');
    expect(directionForAction(null)).toBe('desconocida');
    expect(directionForAction('accion-futura')).toBe('desconocida');
  });
});

describe('unstick — park y retry sobre la clase real', () => {
  it('park deja el dispatch en listStuck con su motivo; retry lo limpia', async () => {
    const w = new DirectMintExecutorWatcher();

    const parkRes = await w.unstick(HASH, 'park', 'lo miro mañana');
    expect(parkRes.ok).toBe(true);
    expect(parkRes.op).toBe('park');

    const afterPark = await w.listStuck();
    expect(afterPark.parked).toHaveLength(1);
    expect(afterPark.parked[0].hash.toUpperCase()).toBe(HASH);
    expect(afterPark.parked[0].reason).toBe('lo miro mañana');
    // Sin fila de handoff (sin DB) la acción es null y la dirección no inventa.
    expect(afterPark.parked[0].direction).toBe('desconocida');

    const retryRes = await w.unstick(HASH, 'retry');
    expect(retryRes.ok).toBe(true);
    // Watcher jamás arrancado + sin FLARE_EXECUTOR_PK → nada de barridos.
    expect(retryRes.kicked).toBe(false);
    expect((await w.listStuck()).parked).toHaveLength(0);
  });

  it('park sin motivo usa el texto del operador por defecto', async () => {
    const w = new DirectMintExecutorWatcher();
    await w.unstick(HASH, 'park');
    const { parked } = await w.listStuck();
    expect(parked[0].reason).toContain('operador');
  });

  it('retry de un hash en FLARE_EXECUTOR_SKIP_TXS avisa y NO lanza barrido', async () => {
    process.env.FLARE_EXECUTOR_SKIP_TXS = `deadbeef, ${HASH.toLowerCase()}`;
    const w = new DirectMintExecutorWatcher();
    await w.unstick(HASH, 'park', 'previa');

    const res = await w.unstick(HASH, 'retry');
    expect(res.envSkipListed).toBe(true);
    expect(res.kicked).toBe(false);
    expect(res.detail).toContain('FLARE_EXECUTOR_SKIP_TXS');
  });

  it('kickSweep con el watcher parado o sin clave devuelve false', () => {
    const w = new DirectMintExecutorWatcher();
    expect(w.kickSweep()).toBe(false); // stopped=true de fábrica
  });
});
