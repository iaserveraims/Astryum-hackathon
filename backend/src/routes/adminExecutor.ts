/**
 * Admin executor ops — el modal de desatasco de /app/admin (pestaña Sistema).
 *
 * Mismo par de puertas que el panel (requireAdmin de adminPanel.ts: sesión de
 * panel / x-admin-key / SIWE+ADMIN_EMAILS) y, como platformStatus, vive en su
 * PROPIO router para que adminPanel siga siendo read-only por construcción.
 *
 * Qué toca y qué no (invariantes #1/#8): el POST solo mueve ESTADO DE
 * REINTENTO del watcher (aparcar / des-aparcar + barrido inmediato). Jamás
 * firma, jamás construye bytes nuevos — lo único ejecutable sigue siendo el
 * Payment exacto que el usuario firmó en Xaman. Un dispatch aparcado como
 * INEJECUTABLE (bytes con sender/nonce imposibles) no se cura aquí: necesita
 * re-prepare + nueva firma del usuario, y el modal lo dice.
 */
import { Router, Request, Response } from 'express';
import { requireAdmin } from './adminPanel';

const router = Router();
router.use(requireAdmin);

const XRPL_TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

// GET /stuck — pendientes (contadores de reintento/backoff) + aparcados (motivo),
// etiquetados con la acción del prepare y su dirección entrante/saliente.
router.get('/stuck', async (_req: Request, res: Response) => {
  try {
    const { directMintExecutorWatcher } = await import('../services/flare/DirectMintExecutorService');
    const snapshot = await directMintExecutorWatcher.listStuck();
    res.json({ ...snapshot, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'STUCK_LIST_FAILED', detail: (e as Error).message });
  }
});

// POST /unstick — { hash, op: 'retry'|'park', reason? }.
router.post('/unstick', async (req: Request, res: Response) => {
  const { hash, op, reason } = (req.body ?? {}) as { hash?: string; op?: string; reason?: string };
  if (typeof hash !== 'string' || !XRPL_TX_HASH_RE.test(hash.trim())) {
    return res.status(400).json({ error: 'INVALID_HASH', detail: 'hash must be a 64-hex XRPL tx hash' });
  }
  if (op !== 'retry' && op !== 'park') {
    return res.status(400).json({ error: 'INVALID_OP', detail: "op must be 'retry' | 'park'" });
  }
  try {
    const { directMintExecutorWatcher } = await import('../services/flare/DirectMintExecutorService');
    const result = await directMintExecutorWatcher.unstick(hash.trim(), op, reason);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: 'UNSTICK_FAILED', detail: (e as Error).message });
  }
});

export default router;
