/**
 * policyCatalog — the data model of F1: named policies, each carrying its own
 * EXIT SPEED, shown at decision time («tú decides qué puede hacer tu dinero;
 * el operador trabaja dentro de eso»). Pure module: addresses come from env,
 * everything else is derivable or on-chain.
 *
 * A policy without a deployed pote address simply does not appear — the
 * catalog never paints a door that leads nowhere (familia «éxito no ganado»).
 */

export interface PolicyCard {
  /** 'conservadora' | 'rendimiento' para las dos formas fijas por env; la dirección del pote cuando viene de la cadena. */
  key: string;
  poteAddress: string;
  /** English copy keys — translated at paint time (check-i18n sweep B). */
  title: string;
  strategyLine: string;
  exitLine: string;
  /** Seconds the EXIT takes by policy design (confirmed on-chain via COOLDOWN). */
  exitSeconds: number;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function envAddress(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return EVM_ADDRESS_RE.test(v) ? v : null;
}

/** The catalog — only policies whose pote EXISTS on chain (address configured). */
export function availablePolicies(): PolicyCard[] {
  const cards: PolicyCard[] = [];
  const poteA = envAddress(process.env.NEXT_PUBLIC_POTE_A_ADDRESS);
  if (poteA) {
    cards.push({
      key: 'conservadora',
      poteAddress: poteA,
      title: 'Conservative policy',
      strategyLine: 'FXRP lending on Kinetic (isolated market) — synchronous venues only.',
      exitLine: 'Exit: immediate',
      exitSeconds: 0,
    });
  }
  const poteB = envAddress(process.env.NEXT_PUBLIC_POTE_B_ADDRESS);
  if (poteB) {
    cards.push({
      key: 'rendimiento',
      poteAddress: poteB,
      title: 'Yield policy',
      strategyLine: 'FXRP across two venues — Kinetic (immediate) and Firelight staking (24h-period exit queue). The operator splits the capital between them.',
      exitLine: 'Exit: 3 days',
      exitSeconds: 72 * 3600,
    });
  }
  return cards;
}

/** «salida inmediata» / «salida en 3 días» — the label of the decision slot. */
export function exitSpeedLabel(cooldownSeconds: number): string {
  if (cooldownSeconds === 0) return 'Exit: immediate';
  const hours = Math.round(cooldownSeconds / 3600);
  if (hours % 24 === 0) return `Exit: ${hours / 24} day(s)`;
  return `Exit: ${hours} h`;
}

/** Display formatting of base units — exact division, trimmed to 4 dp. */
export function fmtBase(units: string | bigint, decimals: number, maxDp = 4): string {
  const v = typeof units === 'bigint' ? units : BigInt(units || '0');
  // BigInt(...) instead of `n` literals: the frontend tsconfig targets ES2017.
  const div = BigInt(10) ** BigInt(decimals);
  const whole = v / div;
  const frac = (v % div).toString().padStart(decimals, '0').slice(0, maxDp).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Exact base-unit parsing — Number would round money away. */
export function parseAmountToBase(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) return null; // more precision than the asset has
  const base = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  return base > BigInt(0) ? base : null;
}
