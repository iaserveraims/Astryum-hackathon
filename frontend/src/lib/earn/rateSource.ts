/**
 * rateSource — de dónde sale un número, dicho para cualquiera.
 *
 * EL PROBLEMA. Debajo de cada tasa se leía esto:
 */

/** Lo que ve una persona, y lo que puede comprobar quien quiera hacerlo. */
export interface ReadableSource {
  /** La frase que se pinta. English IS the i18n key. */
  text: string;
  /** La cadena técnica original, para el tooltip. Nunca se pierde. */
  tech: string;
}

/**
 * Cada regla es un trozo reconocible de la cadena técnica → la frase humana.
 * Se evalúan en orden y la PRIMERA que casa manda, así que lo más específico va
 * antes: «borrowRate» tiene que ganar a «RatePerTimestamp».
 */
const RULES: Array<{ match: RegExp; text: string }> = [
  // Kinetic, interés base leído en cadena + la capa de incentivos de DeFiLlama.
  {
    match: /supplyRatePerTimestamp.*DeFiLlama|DeFiLlama.*supplyRatePerTimestamp/i,
    text: 'Read from Kinetic on the chain, plus the rewards DeFiLlama reports',
  },
  // El coste de pedir prestado, leído del propio mercado.
  {
    match: /borrowRatePerTimestamp|borrowRate/i,
    text: 'The cost Kinetic charges right now, read from the chain',
  },
  // Kinetic, solo el interés base.
  { match: /supplyRatePerTimestamp/i, text: 'Read from Kinetic on the chain' },
  // Posición viva del usuario, leída del contrato.
  {
    match: /balanceOfUnderlying|borrowBalanceCurrent/i,
    text: 'Read from your position on the chain',
  },
  { match: /Upshift/i, text: 'Upshift, the platform that runs the vault' },
  { match: /Sentora|Morpho/i, text: 'The Morpho market, read from the chain' },
  { match: /DeFiLlama/i, text: 'DeFiLlama, which tracks these markets' },
  { match: /FTSO/i, text: 'The Flare network itself' },
  { match: /on-chain|onchain/i, text: 'Read from the chain' },
];

/**
 * Traduce una cadena de procedencia. Si no se reconoce, se devuelve TAL CUAL:
 * más vale una fuente técnica que nadie entienda que ninguna fuente — lo que no
 * puede pasar es que un número quede huérfano (#9).
 */
export function readableSource(source: string | null | undefined): ReadableSource | null {
  const tech = (source ?? '').trim();
  if (!tech) return null;
  const hit = RULES.find((r) => r.match.test(tech));
  return { text: hit ? hit.text : tech, tech };
}

/**
 * La hora de una lectura, sin segundos.
 *
 * «as of 22:53:28» sugiere una precisión que el dato no tiene: la tasa se
 * refresca cada pocos minutos, así que el segundo exacto es ruido con aspecto
 * de rigor.
 */
export function readableAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // hourCycle fijo: sin él, una máquina en locale 12h devuelve «10:53 PM» y
  // el contrato de esta función (HH:MM, fijado por su propio test) se rompe
  // según dónde corra. La hora del dato no cambia de formato por país.
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * La nota que desglosa una tasa. Traduce el vocabulario y deja los números,
 * que son el dato: «Base 0.05% + rewards 0.80% (WFLR incentives).» pasa a
 * hablar de interés y premios.
 */
export function readableNote(note: string | null | undefined): string | null {
  const n = (note ?? '').trim();
  if (!n) return null;
  return n
    .replace(/\bBase\b/g, 'Interest')
    .replace(/\brewards\b/gi, 'rewards in')
    .replace(/\s*\(WFLR incentives\)\.?/i, ' (WFLR)')
    .replace(/\s+/g, ' ')
    .trim();
}
