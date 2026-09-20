/**
 * softDomain — el eje vertical de la curva del Portfolio, DINÁMICO.
 *
 * Los dos extremos que se descartan:
 *   · `['auto','auto']` (lo de ayer): el dominio se ciñe al mín/máx de los
 *     datos, así que un 0,3 % de variación llena los 240 px de alto y una
 *     cartera tranquila parece un desplome.
 *   · `[0, max]` (lo de antes): el dominio arranca en cero, así que cualquier
 *     variación real es una raya plana sobre un rectángulo.
 */

export function softDomain(
  values: number[],
  { minSpanRatio = 0.05, pad = 0.12 }: { minSpanRatio?: number; pad?: number } = {},
): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mid = (min + max) / 2;
  // El suelo se mide sobre el valor, no sobre la variación: es lo que hace que
  // un movimiento pequeño se vea pequeño.
  const floor = Math.abs(mid) * minSpanRatio;
  const span = Math.max(max - min, floor) || 1;
  const half = (span / 2) * (1 + pad);
  return [mid - half, mid + half];
}
