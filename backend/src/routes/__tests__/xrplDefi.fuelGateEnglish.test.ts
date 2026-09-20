/**
 * EL `fuelGate` DE xrpl-defi SERVÍA
 * `EXECUTOR_FUEL_EXHAUSTED` EN CASTELLANO.
 */
import express from 'express';
import request from 'supertest';
import xrplDefiRouter from '../xrplDefi';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ENV };
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR = '1';
  process.env.LEGACY_DAILY_FEE_RESERVE_FLR = '1';
  _resetFeeLedgerForTests();
});

afterAll(() => {
  process.env = ENV;
});

/** Los marcadores del `detail` viejo, y los que delatarían otro en castellano. */
const SPANISH = /[áéíóúñ¿¡]|\b(tu|para|cuando|hoy|otra|antes|presupuesto|firma|movido|aparcado|executor no tiene)\b/i;

describe('xrpl-defi · fuelGate — la negativa por combustible, en inglés y con la verdad del dinero', () => {
  it('vault-yield/claim/prepare sin presupuesto: 429 EXECUTOR_FUEL_EXHAUSTED, detail en inglés, XRP sin mover', async () => {
    const res = await request(app).post('/api/xrpl-defi/vault-yield/claim/prepare').send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('EXECUTOR_FUEL_EXHAUSTED');
    const detail = String(res.body.detail);
    expect(detail).not.toMatch(SPANISH);
    // La verdad que la frase vieja ya decía, y que no puede perderse al traducirla.
    expect(detail).toMatch(/Your XRP has NOT moved/);
    expect(detail).toMatch(/will not be parked/);
    expect(detail).toMatch(/before asking for your signature/);
    // Sin promesa de cuándo: el presupuesto se repone, y no decimos a qué hora.
    expect(detail).not.toMatch(/in a moment/i);
  });

  it('control: con presupuesto, la misma ruta pasa del gate (400 por el cuerpo, no 429)', async () => {
    delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
    delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
    _resetFeeLedgerForTests();
    const res = await request(app).post('/api/xrpl-defi/vault-yield/claim/prepare').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).not.toBe('EXECUTOR_FUEL_EXHAUSTED');
  });
});
