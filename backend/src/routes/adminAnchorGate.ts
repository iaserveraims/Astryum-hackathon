/**
 * Admin anchor-gate ops — la puerta del ancla v2 (DepositAuth + preauth por
 * credencial) desde /app/admin, pestaña Sistema.
 */
import { Router, Request, Response } from 'express';
import { requireAdmin } from './adminPanel';

const router = Router();
router.use(requireAdmin);

function fail(res: Response, e: unknown, fallback: string): void {
  const code = (e as { code?: string })?.code;
  const detail = (e as Error)?.message ?? String(e);
  const status = code === 'ANCHOR_NOT_CONFIGURED' || code === 'SEED_NOT_CONFIGURED' || code === 'NO_GATE_CONFIG' ? 503 : code ? 409 : 500;
  res.status(status).json({ error: code ?? fallback, detail });
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { anchorGateConfig, readAnchorGateState, configuredGateSets, anchorGateDrift } = await import('../services/XrplAnchorGateOps');
    const { planAnchorGateArm } = await import('../services/XrplAnchorGateService');
    // La config puede faltar a medias (ancla sin seed): se enseña lo que hay.
    const anchor = (process.env.ASTRYUM_ORDER_ANCHOR ?? '').trim();
    if (!anchor) return void res.status(503).json({ error: 'ANCHOR_NOT_CONFIGURED', detail: 'ASTRYUM_ORDER_ANCHOR sin definir' });
    let configError: string | null = null;
    try {
      anchorGateConfig();
    } catch (e) {
      configError = (e as Error).message;
    }
    const state = await readAnchorGateState(anchor);
    const configSets = configuredGateSets();
    const drift = anchorGateDrift(state);
    const plan = planAnchorGateArm({
      state,
      configSets,
      balanceXrp: state.balanceXrp,
      ownerCount: state.ownerCount,
      baseReserveXrp: state.baseReserveXrp,
      ownerReserveXrp: state.ownerReserveXrp,
    });
    const { diagnoseXrplSecret } = await import('../utils/xrplSecret');
    const seedRaw = process.env.ASTRYUM_ANCHOR_SEED;
    const seed = seedRaw ? { configured: true, ...diagnoseXrplSecret(seedRaw, anchor) } : { configured: false };
    res.json({
      state,
      configSets,
      drift,
      plan,
      seed,
      configError,
      /** Lo que un juez comprueba, sin fiarse de nosotros. */
      verify: {
        accountInfo: `account_info ${anchor} → Flags & 0x01000000 (lsfDepositAuth)`,
        accountObjects: `account_objects ${anchor} type=deposit_preauth → AuthorizeCredentials`,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    fail(res, e, 'ANCHOR_GATE_STATUS_FAILED');
  }
});

router.post('/arm', async (req: Request, res: Response) => {
  const dryRun = req.body?.dryRun !== false; // por defecto SECO: armar de verdad es { dryRun: false } explícito
  try {
    const { armAnchorGate } = await import('../services/XrplAnchorGateOps');
    const report = await armAnchorGate({ dryRun, objectsOnly: req.body?.objectsOnly === true });
    res.json(report);
  } catch (e) {
    fail(res, e, 'ANCHOR_GATE_ARM_FAILED');
  }
});

router.post('/disarm', async (req: Request, res: Response) => {
  const dryRun = req.body?.dryRun !== false;
  try {
    const { disarmAnchorGate } = await import('../services/XrplAnchorGateOps');
    const report = await disarmAnchorGate({ dryRun });
    res.json(report);
  } catch (e) {
    fail(res, e, 'ANCHOR_GATE_DISARM_FAILED');
  }
});

export default router;
