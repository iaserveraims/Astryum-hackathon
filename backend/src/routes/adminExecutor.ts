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

/**
 * GET /anchor — el estado de la cuenta ANCHOR en XRPL (`LEGACY_ORDER_ANCHOR`).
 *
 * Ahí caen las fees de las órdenes del consejo (0,2 XRP cada una), y de ahí las
 * recoge el hop B3: cuando el XRP libre supera el umbral, el anchor acuña su
 * propio XRP a FXRP y se lo pasa al executor, cuyo refuel lo vuelve FLR. Es un
 * bucle de infraestructura PROPIA de Astryum — jamás fondos de usuario.
 *
 * Sin esta pantalla el bucle era invisible: había que leer la cadena a mano para
 * saber si el anchor tenía suficiente para alimentarse, y el gauge operativo
 * pertenece al panel, no a la consola. Solo lecturas.
 */
router.get('/anchor', async (_req: Request, res: Response) => {
  try {
    const anchor = process.env.LEGACY_ORDER_ANCHOR;
    if (!anchor) {
      return res.status(503).json({ error: 'ANCHOR_NOT_CONFIGURED', detail: 'LEGACY_ORDER_ANCHOR sin definir' });
    }
    const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
    const { computeAnchorFeed, anchorReserveXrp, anchorFeedMinXrp, effectiveReserveXrp } = await import(
      '../services/flare/AnchorFeedingService'
    );

    const balance = await xrplProvider.getSpendableBalance(anchor);
    // Los MISMOS helpers que usa el hop, no una copia del parseo de env: si el
    // panel dice «dispara» tiene que ser la tx que el hop mandaría de verdad.
    // Incluye el suelo sobre la reserva del ledger — con el env clavado en la
    // base reserve, el Payment sería un tecUNFUNDED_PAYMENT y el panel pintaba SÍ.
    const reserveXrp = effectiveReserveXrp(anchorReserveXrp(), balance.reserveXrp);
    const minFeedXrp = anchorFeedMinXrp();
    const decision = computeAnchorFeed(balance.balanceXrp, reserveXrp, minFeedXrp);

    // Por qué el hop no dispara aunque haya XRP: la clave del anchor. Se dice QUÉ
    // cuenta abre (dato público) y si es la del anchor — nunca la clave.
    const { diagnoseXrplSecret } = await import('../utils/xrplSecret');
    const seedRaw = process.env.LEGACY_ANCHOR_SEED;
    const seed = seedRaw ? { configured: true, ...diagnoseXrplSecret(seedRaw, anchor) } : { configured: false };

    const feeEnabled = process.env.LEGACY_ORDER_FEE_ENABLED === 'true';
    const feeXrp = Number(process.env.LEGACY_ORDER_FEE_XRP || 0);
    // Cuántas órdenes más hacen falta para que el hop dispare — la pregunta
    // operativa real, no un número abstracto.
    const missingXrp = Math.max(0, minFeedXrp - decision.freeXrp);
    const ordersToTrigger = feeEnabled && feeXrp > 0 ? Math.ceil(missingXrp / feeXrp) : null;

    return res.json({
      anchor,
      balanceXrp: balance.balanceXrp,
      ledgerReserveXrp: balance.reserveXrp,
      ownerCount: balance.ownerCount,
      /** Reserva que el hop deja SIEMPRE (config, no la del ledger). */
      feedReserveXrp: reserveXrp,
      minFeedXrp,
      freeXrp: decision.freeXrp,
      shouldFeed: decision.shouldFeed,
      feedXrp: decision.feedXrp,
      missingXrp,
      ordersToTrigger,
      orderFee: { enabled: feeEnabled, xrp: feeXrp },
      seedConfigured: !!process.env.LEGACY_ANCHOR_SEED,
      /** Diagnóstico de la clave: formato, cuenta que deriva, si casa con el anchor. */
      seed,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: 'ANCHOR_STATUS_FAILED', detail: (e as Error).message });
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
