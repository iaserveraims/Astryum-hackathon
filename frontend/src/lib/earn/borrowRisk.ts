/**
 * borrowRisk — el riesgo de un préstamo dicho en la unidad en la que se decide.
 *
 * El mercado habla en health factor (HF = maxBorrow / deuda, liquidable por
 * debajo de 1). Es exacto y es inservible para decidir: nadie sabe si 2,41 está
 * cerca o lejos, y el número se mueve al revés que el riesgo (más alto = más
 * seguro). Quien pide prestado piensa en dos cosas:
 *
 *   1. «¿qué parte de mi colateral me estoy llevando?»  → LTV, en %
 *   2. «¿cuánto puede caer el XRP antes de que esto duela?» → caída, en %
 *
 * Las tres magnitudes son la MISMA, y la conversión es exacta (no es una
 * aproximación de UI). Con LLTV el techo de liquidación del mercado:
 *
 *     HF = LLTV / LTV          LTV = LLTV / HF
 *     caída soportada = 1 − LTV/LLTV = 1 − 1/HF
 *
 * Esa última identidad es la razón de este módulo: la distancia a la
 * liquidación NO depende del precio actual ni del tamaño de la posición, solo
 * del HF. Un HF de 2 aguanta una caída del 50 %, uno de 1,25 aguanta el 20 %.
 *
 * Todo aquí es lógica pura y determinista: se testea sin red y sin cadena, y
 * la misma función alimenta el gráfico, el texto y el umbral del stop-loss —
 * un gráfico que calcule su propia versión del riesgo es un gráfico que puede
 * contradecir a la letra pequeña.
 *
 * La verdad de la matemática vive en el mercado, no aquí: `lltv` SIEMPRE se
 * pasa desde la lectura on-chain (`disclosure.lltvPct` del prepare), nunca se
 * asume — el mercado insignia es 0,77 hoy y eso puede cambiar.
 */

/** LTV y LLTV como fracción (0,30 = 30 %). HF como número (Infinity = sin deuda). */
export type Fraction = number;

/** Valor de la deuda ÷ valor del colateral. Ambos en la misma moneda. */
export function ltvOf(debtValue: number, collateralValue: number): Fraction {
  if (collateralValue <= 0) return debtValue > 0 ? Infinity : 0;
  return debtValue / collateralValue;
}

/** Techo de deuda que el mercado permite sobre este colateral. */
export function maxBorrowFor(collateralValue: number, lltv: Fraction): number {
  return collateralValue * lltv;
}

/** HF equivalente a un LTV. Sin deuda (LTV 0) el HF es Infinity, no un número grande. */
export function hfFromLtv(ltv: Fraction, lltv: Fraction): number {
  if (ltv <= 0) return Infinity;
  return lltv / ltv;
}

/** LTV equivalente a un HF. El inverso exacto de `hfFromLtv`. */
export function ltvFromHf(hf: number, lltv: Fraction): Fraction {
  if (!Number.isFinite(hf)) return 0;
  if (hf <= 0) return Infinity;
  return lltv / hf;
}

/**
 * La cifra que hace decidible el riesgo: qué fracción puede perder el colateral
 * antes de que el LTV alcance `target` (por defecto, la liquidación).
 *
 * Devuelve 0 cuando ya se está en el umbral o por encima — nunca un negativo
 * que se lea como «aún queda margen».
 */
export function priceDropToReach(ltvNow: Fraction, target: Fraction): Fraction {
  if (ltvNow <= 0) return 1;           // sin deuda: no hay caída que lo dispare
  if (target <= 0) return 0;
  if (ltvNow >= target) return 0;
  return 1 - ltvNow / target;
}

/** La caída que aguanta una posición antes de ser liquidable, leída del HF. */
export function priceDropFromHf(hf: number): Fraction {
  if (!Number.isFinite(hf)) return 1;
  if (hf <= 1) return 0;
  return 1 - 1 / hf;
}

/* ── Los dos «porcentajes» que NO son el mismo ──────────────────────────────
 *
 * «Pedir un 30 %» significa dos cosas distintas, y confundirlas mueve el riesgo
 * real casi diez puntos:
 *
 *   · LTV 30 %          → 30 % del VALOR del colateral   → aguanta 61 % de caída
 *   · margen usado 30 % → 30 % de la CAPACIDAD del mercado → aguanta 70 %
 *
 * El segundo es `borrowRatio`, el campo que la entrada ya usa hoy (se teclea
 * «0.30» bajo una etiqueta que dice «%»). Tiene una propiedad que ningún otro
 * tiene, y que lo hace el mejor candidato para lo que se enseña en grande:
 *
 *     margen usado + caída que aguantas = 100 %
 *
 * Pides el 30 %, te queda el 70 %. Sin dividir, sin LLTV, sin health factor —
 * y es EXACTO, no una regla del pulgar: `borrowRatio = LTV/LLTV = 1/HF`, así
 * que `1 − borrowRatio` es la misma cifra que `1 − 1/HF`, que es lo que ya se
 * pinta hoy en /app/strategies («protegido si el precio cae un 41 %»).
 */

/** Fracción de la capacidad del mercado que se está usando. Idéntico a 1/HF. */
export function borrowRatioOf(debtValue: number, collateralValue: number, lltv: Fraction): Fraction {
  const max = maxBorrowFor(collateralValue, lltv);
  if (max <= 0) return debtValue > 0 ? Infinity : 0;
  return debtValue / max;
}

/** «Uso el 30 % de mi margen» → el LTV que eso significa. */
export function ltvFromBorrowRatio(borrowRatio: Fraction, lltv: Fraction): Fraction {
  return borrowRatio * lltv;
}

/** El inverso: qué parte de la capacidad supone un LTV dado. */
export function borrowRatioFromLtv(ltv: Fraction, lltv: Fraction): Fraction {
  if (lltv <= 0) return Infinity;
  return ltv / lltv;
}

/**
 * La aritmética que el usuario puede hacer de cabeza: lo que pides y lo que
 * aguantas suman uno. Es la MISMA cifra que `priceDropFromHf`, por otro camino.
 */
export function dropFromBorrowRatio(borrowRatio: Fraction): Fraction {
  if (borrowRatio <= 0) return 1;
  if (borrowRatio >= 1) return 0;
  return 1 - borrowRatio;
}

export type RiskLevel = 'comfortable' | 'tight' | 'exposed' | 'liquidatable';

/**
 * Las bandas del gráfico, expresadas por el colchón de caída que dejan — que es
 * lo que separa una posición tranquila de una que hay que mirar a diario:
 *
 *   comfortable  aguanta más del 40 %      (LTV < 0,60·LLTV · HF > 1,67)
 *   tight        aguanta entre 20 y 40 %   (LTV < 0,80·LLTV · HF > 1,25)
 *   exposed      aguanta menos del 20 %
 *   liquidatable ya en el techo del mercado
 *
 * Los cortes son fracciones del LLTV a propósito: así las bandas siguen al
 * mercado si cambia su techo, en vez de quedarse fijas en porcentajes que
 * dejarían de significar lo mismo.
 */
export const BAND_EDGES: ReadonlyArray<{ level: RiskLevel; shareOfLltv: number }> = Object.freeze([
  { level: 'comfortable', shareOfLltv: 0.6 },
  { level: 'tight', shareOfLltv: 0.8 },
  { level: 'exposed', shareOfLltv: 1 },
]);

export function riskLevelOf(ltv: Fraction, lltv: Fraction): RiskLevel {
  if (ltv >= lltv) return 'liquidatable';
  for (const edge of BAND_EDGES) {
    if (ltv < lltv * edge.shareOfLltv) return edge.level;
  }
  return 'liquidatable';
}

export interface RiskBand {
  level: RiskLevel;
  /** Extremos en LTV (fracción), para pintar la banda y para etiquetarla. */
  fromLtv: Fraction;
  toLtv: Fraction;
  /** Colchón de caída en el extremo MÁS arriesgado de la banda. */
  dropAtEnd: Fraction;
}

/** Las bandas listas para pintar, de menos a más riesgo. */
export function riskBands(lltv: Fraction): RiskBand[] {
  let from = 0;
  const bands: RiskBand[] = [];
  for (const edge of BAND_EDGES) {
    const to = lltv * edge.shareOfLltv;
    bands.push({ level: edge.level, fromLtv: from, toLtv: to, dropAtEnd: priceDropToReach(to, lltv) });
    from = to;
  }
  return bands;
}

export interface BorrowRisk {
  ltv: Fraction;
  healthFactor: number;
  /** Cuánto puede caer el colateral antes de ser liquidable. */
  dropToLiquidation: Fraction;
  level: RiskLevel;
  /** Deuda máxima que el mercado admite sobre este colateral. */
  maxBorrow: number;
}

/** La lectura completa de una posición proyectada, en una sola pasada. */
export function borrowRisk(
  debtValue: number,
  collateralValue: number,
  lltv: Fraction,
): BorrowRisk {
  const ltv = ltvOf(debtValue, collateralValue);
  return {
    ltv,
    healthFactor: hfFromLtv(ltv, lltv),
    dropToLiquidation: priceDropToReach(ltv, lltv),
    level: riskLevelOf(ltv, lltv),
    maxBorrow: maxBorrowFor(collateralValue, lltv),
  };
}

/**
 * El umbral del stop-loss, dicho en la MISMA unidad que el préstamo (LTV %) en
 * lugar de en HF. Un stop por debajo del LTV de entrada ya estaría disparado al
 * firmar, así que el suelo es el propio LTV de entrada.
 */
export function stopLossFloor(entryLtv: Fraction): Fraction {
  return entryLtv;
}

/**
 * Lo que de verdad hay que enseñar junto al stop-loss: con cuánta caída salta.
 * Un stop 2 puntos por encima de un LTV del 30 % suena prudente y salta con una
 * caída del 6,3 % — que el XRP hace en una tarde.
 */
export function stopLossTriggerDrop(entryLtv: Fraction, stopLtv: Fraction): Fraction {
  return priceDropToReach(entryLtv, stopLtv);
}
