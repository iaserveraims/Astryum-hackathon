/**
 * /api/account-mirror — el espejo de cuentas producción → preview, a demanda.
 *
 *   GET  /status   qué dice el veredicto, el ámbito, y la última pasada.
 *   POST /run      una pasada ahora. Body opcional: { prune: true } para
 *                  igualar también las filas hijas que solo existen aquí.
 *
 * Solo fundadores (requireAdmin de adminPanel: la misma puerta que el resto
 * del panel). El servicio se niega solo en producción, así que esta ruta
 * contesta 409 allí con el motivo, sin tocar nada. Ver
 * services/accountMirror/plan.ts.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAdmin } from './adminPanel';
import { accountMirrorStatus, runAccountMirror } from '../services/accountMirror/AccountMirrorService';

const router = Router();
router.use(requireAdmin);

router.get('/status', (_req: Request, res: Response) => {
  const s = accountMirrorStatus();
  // La URL del origen lleva credenciales: fuera de cualquier respuesta.
  const verdict = s.verdict.ok ? { ok: true, everyMs: s.verdict.everyMs } : s.verdict;
  res.json({ ...s, verdict });
});

router.post('/run', asyncHandler(async (req: Request, res: Response) => {
  const prune = req.body?.prune === true;
  try {
    const report = await runAccountMirror({ prune });
    res.json({ ok: true, prune, report });
  } catch (e) {
    const message = (e as Error).message;
    res.status(message.startsWith('mirror refused') ? 409 : 500).json({ ok: false, error: message });
  }
}));

export default router;
