/**
 * /api/dry-run — el ensayo en seco del producto de gestores.
 *
 * SOLO existe con `DRY_RUN_MODE=true` (no se monta sin él, y cada handler lo
 * re-comprueba) y SOLO habla con un RPC local (anvil). Ver DryRunExecutor para
 * las guardas. Nada de esto firma, custodia ni toca una clave: impersona en un
 * fork que no existe fuera de la máquina del ensayo.
 */

import { Router, type Request, type Response } from 'express';
import { ethers } from 'ethers';
import { DryRunError, DryRunExecutor, dryRunEnabled, type DryCall } from '../services/dryRun/DryRunExecutor';
import { safeErrorDetail } from '../utils/safeError';

const router = Router();

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function refuse(res: Response, e: unknown): void {
  if (e instanceof DryRunError) {
    res.status(e.code === 'DISABLED' || e.code === 'NOT_LOCAL' ? 403 : 409).json({ error: e.code, detail: e.message });
    return;
  }
  res.status(500).json({ error: 'DRY_RUN_FAILED', detail: safeErrorDetail(e) });
}

function guarded(handler: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response) => void {
  return (req, res) => {
    if (!dryRunEnabled()) {
      res.status(403).json({ error: 'DISABLED', detail: 'DRY_RUN_MODE no está activo.' });
      return;
    }
    handler(req, res).catch((e) => refuse(res, e));
  };
}

/** El reparto de papeles del ensayo, con saldos vivos. */
router.get('/actors', guarded(async (_req, res) => {
  const x = new DryRunExecutor();
  res.json({ mode: 'dry-run', rpc: x.provider._getConnection().url, actors: await x.actors() });
}));

/** FXRP del whale del fork + gas para un actor. */
router.post('/fund', guarded(async (req, res) => {
  const address = String(req.body?.address ?? '').trim();
  const fxrpBase = String(req.body?.fxrpBase ?? '0').trim();
  if (!EVM_RE.test(address)) throw new DryRunError('BAD_ADDRESS', 'address debe ser 0x…');
  if (!/^[0-9]{1,30}$/.test(fxrpBase)) throw new DryRunError('BAD_AMOUNT', 'fxrpBase debe ser un entero en unidades base');
  const x = new DryRunExecutor();
  res.json(await x.fund(address, BigInt(fxrpBase)));
}));

/** El nacimiento de la jaula del consejo, como lo haría su PA tras el 0xFE. */
router.post('/cage-create', guarded(async (req, res) => {
  const council = String(req.body?.council ?? '').trim();
  if (!XRPL_RE.test(council)) throw new DryRunError('BAD_COUNCIL', 'council debe ser una r-address');
  const x = new DryRunExecutor();
  res.json(await x.createCage(council));
}));

/**
 * Una orden de consejo YA COMPUESTA (`order.orderData` de /cage-order/prepare),
 * ejecutada como la ejecutaría el bridge tras la prueba FDC. La jaula y el
 * bridge se RESUELVEN del consejo (los mismos registros que usa el relay):
 * nunca se aceptan del cliente.
 */
router.post('/order', guarded(async (req, res) => {
  const council = String(req.body?.council ?? '').trim();
  const orderData = String(req.body?.orderData ?? '').trim();
  if (!XRPL_RE.test(council)) throw new DryRunError('BAD_COUNCIL', 'council debe ser una r-address');
  // Directo contra la factory de JAULAS, no el resolver multi-registro: en el
  // ensayo la misma cuenta puede gobernar un pote v1 (heredado del fork) y una
  // jaula v2, y el resolver devuelve el primero — ejecutaría la orden contra el
  // vault equivocado (pasó: `require(false)` mudo del v1).
  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const { resolveAstryumCage } = await import('../services/flare/AstryumCageCreationService');
  const factory = astryumCageFactoryAddress();
  if (!factory) throw new DryRunError('NO_FACTORY', 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.');
  const x = new DryRunExecutor();
  const found = await resolveAstryumCage(x.provider, factory, council);
  if (!found) throw new DryRunError('NO_CAGE', 'Este consejo no tiene jaula en la factory del fork.');
  res.json(await x.executeCageOrder({ cage: found.cage, bridge: found.bridge, orderData }));
}));

/** `UnsignedCall[]` de cualquier prepare, ejecutadas como si las firmara `from`. */
router.post('/execute', guarded(async (req, res) => {
  const from = String(req.body?.from ?? '').trim();
  const calls = req.body?.calls as DryCall[] | undefined;
  if (!EVM_RE.test(from)) throw new DryRunError('BAD_FROM', 'from debe ser 0x… (el actor que firmaría)');
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 10) {
    throw new DryRunError('BAD_CALLS', 'calls debe ser una lista de 1 a 10 llamadas {to, data, value?}');
  }
  for (const c of calls) {
    if (!EVM_RE.test(String(c?.to ?? ''))) throw new DryRunError('BAD_CALLS', 'cada call lleva to 0x…');
    if (!/^0x[0-9a-fA-F]*$/.test(String(c?.data ?? ''))) throw new DryRunError('BAD_CALLS', 'cada call lleva data hex');
  }
  const x = new DryRunExecutor();
  res.json(await x.executeCalls(from, calls));
}));

/** El ExchangeKycRegistry del partner, desplegado del artifact de forge. */
router.post('/kyc-registry', guarded(async (req, res) => {
  const admin = String(req.body?.admin ?? '').trim();
  if (!EVM_RE.test(admin)) throw new DryRunError('BAD_ADMIN', 'admin debe ser 0x… (el partner)');
  const x = new DryRunExecutor();
  res.json(await x.deployKycRegistry(admin));
}));

/** Lectura simple para la pantalla del partner: ¿está este user aprobado? */
router.get('/kyc-status', guarded(async (req, res) => {
  const registry = String(req.query.registry ?? '').trim();
  const user = String(req.query.user ?? '').trim();
  if (!EVM_RE.test(registry) || !EVM_RE.test(user)) throw new DryRunError('BAD_ADDRESS', 'registry y user deben ser 0x…');
  const x = new DryRunExecutor();
  const c = new ethers.Contract(registry, ['function isApproved(address) view returns (bool)'], x.provider);
  res.json({ registry, user, approved: Boolean(await c.isApproved(user)) });
}));

export default router;
