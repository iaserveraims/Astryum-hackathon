/**
 * opsAlert dedup — "un canal que grita por todo se silencia".
 *
 * Pins the 2026-08-01 contract: an identical alert (source + key-or-message)
 * inside the window is logged but NOT re-delivered; a level ESCALATION always
 * goes through; suppressed repeats are declared on the next delivery; and
 * dedupe:false (heartbeats) bypasses entirely.
 */

const saveOpsAlert = jest.fn().mockResolvedValue(undefined);
jest.mock('../OpsAlertStore', () => ({
  saveOpsAlert: (...args: unknown[]) => saveOpsAlert(...args),
}));

import { opsAlert, __resetAlertDedupForTests } from '../OpsAlertService';

describe('opsAlert deduplication', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.OPS_ALERT_WEBHOOK_URL; // no external channel — persistence is the observable
    delete process.env.EXECUTOR_ALERT_WEBHOOK_URL;
    saveOpsAlert.mockClear();
    __resetAlertDedupForTests();
  });
  afterEach(() => {
    process.env = env;
  });

  it('an identical repeat inside the window is delivered ONCE', async () => {
    await opsAlert('0xFE-executor', 'warn', 'anchor-feed falló: seed equivocada');
    await opsAlert('0xFE-executor', 'warn', 'anchor-feed falló: seed equivocada');
    await opsAlert('0xFE-executor', 'warn', 'anchor-feed falló: seed equivocada');
    expect(saveOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('different messages (or sources) are different alerts', async () => {
    await opsAlert('0xFE-executor', 'warn', 'fallo A');
    await opsAlert('0xFE-executor', 'warn', 'fallo B');
    await opsAlert('xrpl-watch', 'warn', 'fallo A');
    expect(saveOpsAlert).toHaveBeenCalledTimes(3);
  });

  it('a stable key groups even when the wording varies', async () => {
    await opsAlert('0xFE-executor', 'warn', 'la tx 7BFC lleva 10 min pillada', { key: 'stuck:7BFC' });
    await opsAlert('0xFE-executor', 'warn', 'la tx 7BFC lleva 20 min pillada', { key: 'stuck:7BFC' });
    expect(saveOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('a level ESCALATION always goes through and declares the suppressed repeats', async () => {
    await opsAlert('0xFE-executor', 'warn', 'presupuesto al 80%', { key: 'budget' });
    await opsAlert('0xFE-executor', 'warn', 'presupuesto al 80%', { key: 'budget' }); // suppressed
    await opsAlert('0xFE-executor', 'critical', 'presupuesto AGOTADO', { key: 'budget' });
    expect(saveOpsAlert).toHaveBeenCalledTimes(2);
    const second = saveOpsAlert.mock.calls[1][0] as { message: string };
    expect(second.message).toContain('AGOTADO');
    expect(second.message).toContain('se repitió 1×');
  });

  it('dedupe:false bypasses (heartbeats and periodic summaries)', async () => {
    await opsAlert('sentinel', 'info', 'latido — todo verde', { dedupe: false });
    await opsAlert('sentinel', 'info', 'latido — todo verde', { dedupe: false });
    expect(saveOpsAlert).toHaveBeenCalledTimes(2);
  });

  it('window 0 disables dedup via env', async () => {
    process.env.OPS_ALERT_DEDUP_WINDOW_MIN = '0';
    await opsAlert('0xFE-executor', 'warn', 'mismo fallo');
    await opsAlert('0xFE-executor', 'warn', 'mismo fallo');
    expect(saveOpsAlert).toHaveBeenCalledTimes(2);
  });
});
