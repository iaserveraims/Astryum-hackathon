/**
 * cooldownGuardrail — «el cooldown del pote debe cubrir la cola de salida».
 *
 * El contrato (AstryumVault) fija la forma de salida al nacer con COOLDOWN, y su
 * propia nota lo dice: «Governance must size COOLDOWN ≥ the slowest venue
 * queue». Pero SOLO fuerza dos cosas: `cooldown ≤ MAX_COOLDOWN` y, para un venue
 * encolado, `cooldown > 0` (QueuedVenueNeedsCooldown). No fuerza el ≥ la cola.
 */

/** AstryumVault.VenueKind.ERC4626Queued — el venue con cola de salida. */
export const ERC4626_QUEUED_KIND = 2;

/**
 * El piso del cooldown, en segundos, para un pote que toca un venue encolado.
 * Por defecto 72h = la cola de Firelight medida en vivo (24h/periodo, peor caso
 * 48h) + 24h de margen — el MISMO número que `POTE_B_COOLDOWN_SECONDS`. Si un
 * venue encolado resulta más lento, se sube por entorno sin tocar código ni
 * redeploy. Un valor malformado cae al default (fail-safe hacia lo más seguro).
 */
export function queuedVenueMinCooldownSeconds(): number {
  const raw = Number(process.env.MANAGER_MIN_COOLDOWN_QUEUED_SECONDS);
  return Number.isInteger(raw) && raw > 0 ? raw : 72 * 3600;
}

export interface CooldownGuardResult {
  ok: boolean;
  /** Motivo legible cuando `ok` es false — va tal cual al refusal/disclosure. */
  reason?: string;
  /** El piso aplicado, en segundos (para que la UI lo muestre). */
  minSeconds?: number;
}

/**
 * ¿El `cooldownSeconds` cubre la cola de salida de los venues presentes? Si
 * ninguno es encolado, no hay cola que cubrir y pasa. Puro: no lee red ni
 * entorno — el piso entra como argumento.
 */
export function cooldownCoversQueue(
  cooldownSeconds: number,
  venueKinds: readonly number[],
  minQueuedCooldownSeconds: number
): CooldownGuardResult {
  const hasQueued = venueKinds.some((k) => k === ERC4626_QUEUED_KIND);
  if (!hasQueued) return { ok: true };
  if (cooldownSeconds >= minQueuedCooldownSeconds) return { ok: true };
  const h = Math.round(minQueuedCooldownSeconds / 3600);
  return {
    ok: false,
    minSeconds: minQueuedCooldownSeconds,
    reason:
      `a queued venue (Firelight-shaped) needs a cooldown of at least ${h}h to cover its ` +
      `withdrawal queue: with less, a redeem ticket matures before the recalled assets arrive ` +
      `and claimRedeem reverts (UnwindShortfall), stranding the depositor. Set the pote's ` +
      `cooldown to ≥ ${h}h.`,
  };
}
