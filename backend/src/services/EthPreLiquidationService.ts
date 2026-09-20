/**
 * EthPreLiquidationService — la protección que funciona MIENTRAS DUERMES.
 *
 * El stop-loss que teníamos es `sign-at-trigger`: el tick detecta, avisa, y el
 * dueño tiene que despertarse y firmar. De madrugada eso es infinito, y el
 * mercado de Morpho liquida en minutos.
 */
import { Interface } from 'ethers';
import { MORPHO_BLUE_SINGLETON, FXRP_RLUSD_MARKET_ID, EvmLeg } from '../connectors/protocols/adapters/MorphoBlueEthAdapter';

/** Factory en Ethereum mainnet. Verificada: MORPHO() y isPreLiquidation(). */
export const PRELIQUIDATION_FACTORY_ETH = '0x6FF33615e792E35ed1026ea7cACCf42D9BF83476';

const WAD = 10n ** 18n;

const FACTORY_ABI = [
  'function createPreLiquidation(bytes32 id, (uint256 preLltv,uint256 preLCF1,uint256 preLCF2,uint256 preLIF1,uint256 preLIF2,address preLiquidationOracle) preLiquidationParams) returns (address)',
  'function isPreLiquidation(address) view returns (bool)',
];
const MORPHO_AUTH_ABI = ['function setAuthorization(address authorized, bool newIsAuthorized)'];

const factoryIface = new Interface(FACTORY_ABI);
const morphoIface = new Interface(MORPHO_AUTH_ABI);

export interface PreLiquidationParams {
  /** LTV a partir del cual se puede pre-liquidar. DEBE ser < LLTV del mercado. */
  preLltv: bigint;
  /** Factor de cierre inicial (qué porción se puede cerrar al cruzar el umbral). */
  preLCF1: bigint;
  /** Factor de cierre en el extremo (crece linealmente con el deterioro). */
  preLCF2: bigint;
  /** Incentivo del liquidador al cruzar el umbral (1e18 = 0%). */
  preLIF1: bigint;
  /** Incentivo en el extremo. */
  preLIF2: bigint;
  /** El oráculo con el que se mide. Vacío ⇒ el del propio mercado. */
  preLiquidationOracle: string;
}

/** Las restricciones que el CONTRATO impone. Puras: testeables sin cadena. */
export type ParamCheck = { ok: true } | { ok: false; code: string; message: string };

export function validatePreLiquidationParams(
  p: PreLiquidationParams,
  marketLltv: bigint,
): ParamCheck {
  if (p.preLltv >= marketLltv) {
    return {
      ok: false,
      code: 'PRELLTV_TOO_HIGH',
      message: 'The protection must trigger BEFORE the market can liquidate you (preLltv < LLTV)',
    };
  }
  if (p.preLltv === 0n) {
    return { ok: false, code: 'PRELLTV_ZERO', message: 'The trigger threshold cannot be zero' };
  }
  if (p.preLCF1 > p.preLCF2) {
    return { ok: false, code: 'PRELCF_ORDER', message: 'preLCF1 must not exceed preLCF2' };
  }
  if (p.preLCF1 > WAD) {
    return { ok: false, code: 'PRELCF1_TOO_HIGH', message: 'preLCF1 cannot exceed 100%' };
  }
  if (p.preLIF1 < WAD) {
    return { ok: false, code: 'PRELIF1_TOO_LOW', message: 'The liquidator incentive cannot be below zero' };
  }
  if (p.preLIF1 > p.preLIF2) {
    return { ok: false, code: 'PRELIF_ORDER', message: 'preLIF1 must not exceed preLIF2' };
  }
  // preLIF2 <= 1/LLTV — el techo que impide que una pre-liquidación empeore la
  // salud de la posición. Con LLTV 0,77 el máximo es 1,2987.
  const maxLif = (WAD * WAD) / marketLltv;
  if (p.preLIF2 > maxLif) {
    return {
      ok: false,
      code: 'PRELIF2_TOO_HIGH',
      message: 'That incentive is above what the contract allows for this market',
    };
  }
  return { ok: true };
}

/**
 * Umbrales sugeridos, DERIVADOS del LLTV del mercado — no copiados de otros.
 *
 * Los seis contratos vivos en Ethereum usan `preLltv` entre 0,898 y 0,958, pero
 * esos son mercados con LLTV alto (0,915-0,965). Copiar esas cifras a un mercado
 * de LLTV 0,77 daría un `preLltv` por encima del LLTV y el contrato lo
 * rechazaría. Se calculan como fracción del LLTV real.
 *
 * `preLIF1` en el rango que usa el mercado (1,01-1,03): es lo que le cuesta al
 * usuario que salte, y hay que decírselo en voz alta.
 */
export type Aggressiveness = 'early' | 'balanced' | 'late';

export function suggestParams(marketLltv: bigint, mode: Aggressiveness, oracle: string): PreLiquidationParams {
  const frac = mode === 'early' ? 80n : mode === 'balanced' ? 88n : 94n;
  const preLltv = (marketLltv * frac) / 100n;
  // Incentivo: cuanto más tarde salta, más caro sale (menos margen para el
  // liquidador), igual que hacen los mercados reales.
  const lif = mode === 'early' ? 1_010_000_000_000_000_000n
    : mode === 'balanced' ? 1_017_000_000_000_000_000n
      : 1_026_000_000_000_000_000n;
  return {
    preLltv,
    // Arranca cerrando poco y crece con el deterioro: el patrón de los seis
    // contratos vivos (preLCF1 ~0,0007 → preLCF2 ~0,24).
    preLCF1: 10n ** 15n,           // 0,1%
    preLCF2: 250n * 10n ** 15n,    // 25%
    preLIF1: lif,
    preLIF2: lif,
    preLiquidationOracle: oracle,
  };
}

export interface ArmPreLiquidationRequest {
  user: string;
  marketId?: string;
  params: PreLiquidationParams;
  /** Instancia ya existente para estos params, si el llamante la encontró. */
  existingInstance?: string | null;
}

export interface ArmPreLiquidationResult {
  chainId: 1;
  marketId: string;
  legs: EvmLeg[];
  /** El plan, en cifras, para que la pantalla no invente nada. */
  plan: {
    factory: string;
    /** La instancia que se va a autorizar, si ya existe. */
    instance: string | null;
    /** true = hay que crearla primero; la autorización va en un SEGUNDO paso. */
    mustCreate: boolean;
    preLltvPct: number;
    marketLltvPct: number;
    /** Lo que le cuesta al usuario que salte, en %. */
    incentivePct: number;
    /** Cuánto de la posición se puede cerrar, de inicio y en el extremo. */
    closeFactorFromPct: number;
    closeFactorToPct: number;
    oracle: string;
  };
  preflight: { ok: boolean; checks: Array<{ name: string } & ({ ok: true } | { ok: false; code: string; message: string })> };
  disclosure: {
    disclosedToUser: true;
    astryumFeeBase: '0';
    whoExecutes: string;
    costNote: string;
    revokeNote: string;
    signerNote: string;
  };
}

/**
 * Compone el armado de la protección.
 *
 * Dos caminos, y la diferencia importa para la pantalla:
 *   · la instancia YA EXISTE (params compartidos) → UNA pata: autorizar.
 *   · no existe → UNA pata: crearla. La autorización va después, porque su
 *     dirección no se conoce hasta que la transacción se mina. Nada de
 *     autorizar una dirección adivinada.
 */
export function prepareArmPreLiquidation(
  req: ArmPreLiquidationRequest,
  marketLltv: bigint,
): ArmPreLiquidationResult {
  const marketId = req.marketId ?? FXRP_RLUSD_MARKET_ID;
  const p = req.params;
  const check = validatePreLiquidationParams(p, marketLltv);
  const checks: ArmPreLiquidationResult['preflight']['checks'] = [{ name: 'params', ...check }];

  const legs: EvmLeg[] = [];
  const mustCreate = !req.existingInstance;
  if (check.ok) {
    if (req.existingInstance) {
      legs.push({
        to: MORPHO_BLUE_SINGLETON,
        data: morphoIface.encodeFunctionData('setAuthorization', [req.existingInstance, true]),
        value: '0x0',
        description: 'Authorize the pre-liquidation contract to protect this position',
      });
    } else {
      legs.push({
        to: PRELIQUIDATION_FACTORY_ETH,
        data: factoryIface.encodeFunctionData('createPreLiquidation', [
          marketId,
          [p.preLltv, p.preLCF1, p.preLCF2, p.preLIF1, p.preLIF2, p.preLiquidationOracle],
        ]),
        value: '0x0',
        description: 'Create the pre-liquidation contract with your thresholds',
      });
    }
  }

  const pct = (v: bigint) => Number((v * 10_000n) / WAD) / 100;
  return {
    chainId: 1,
    marketId,
    legs,
    plan: {
      factory: PRELIQUIDATION_FACTORY_ETH,
      instance: req.existingInstance ?? null,
      mustCreate,
      preLltvPct: pct(p.preLltv),
      marketLltvPct: pct(marketLltv),
      incentivePct: pct(p.preLIF1 - WAD),
      closeFactorFromPct: pct(p.preLCF1),
      closeFactorToPct: pct(p.preLCF2),
      oracle: p.preLiquidationOracle,
    },
    preflight: { ok: checks.every((c) => c.ok), checks },
    disclosure: {
      disclosedToUser: true,
      astryumFeeBase: '0',
      whoExecutes:
        'Anyone can execute it — it is permissionless. Astryum does not run it, does not need to be up, and cannot stop it.',
      costNote:
        'When it fires you pay the liquidator incentive shown, taken from your collateral. Repaying by hand is cheaper — but only works if you are awake.',
      revokeNote:
        'You can revoke the authorization at any time from here; the contract can never move your collateral anywhere but back to your own position.',
      signerNote: 'Signed by your own wallet on Ethereum — Astryum never signs or broadcasts',
    },
  };
}

/** Retirar la protección: una pata, y el usuario la firma. */
export function prepareDisarmPreLiquidation(instance: string): EvmLeg[] {
  return [
    {
      to: MORPHO_BLUE_SINGLETON,
      data: morphoIface.encodeFunctionData('setAuthorization', [instance, false]),
      value: '0x0',
      description: 'Revoke the pre-liquidation authorization',
    },
  ];
}

/* ── Qué pre-liquidaciones existen YA para este mercado ─────────────────────── */

export interface LivePreLiquidation {
  address: string;
  preLltv: bigint;
  preLCF1: bigint;
  preLCF2: bigint;
  preLIF1: bigint;
  preLIF2: bigint;
  preLiquidationOracle: string;
}

/**
 * Las instancias vivas, leídas del indexador de Morpho.
 *
 * Importa por una razón concreta: el factory despliega con `salt: 0`, así que
 * el mismo (mercado, params) SIEMPRE da la misma dirección y **crear una que ya
 * existe revierte sin datos**. Buscar antes convierte ese revert en una pata de
 * autorización, que es más barata y más rápida.
 *
 * Best-effort a propósito: si el indexador no contesta, se devuelve lista vacía
 * y el flujo intenta crear. Un fallo de lectura no puede impedir protegerse.
 */
export async function fetchLivePreLiquidations(marketId: string): Promise<LivePreLiquidation[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query: `query { markets(first: 200, where: {chainId_in: [1]}) { items { marketId preLiquidations { items { address preLltv preLCF1 preLCF2 preLIF1 preLIF2 preLiquidationOracle } } } } }`,
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    // GraphQL responde 200 CON errors[] cuando rechaza — `resp.ok` no basta
    // (la lección de `parseVaultApy`, que costó días de nulls silenciosos).
    const body = (await resp.json()) as {
      data?: { markets?: { items?: Array<{ marketId?: string; preLiquidations?: { items?: unknown[] } }> } };
      errors?: Array<{ message?: string }>;
    };
    if (body.errors?.length) {
      console.warn('[preliquidation] indexer refused:', body.errors.map((e) => e?.message).join('; '));
      return [];
    }
    const market = (body.data?.markets?.items ?? []).find(
      (m) => String(m.marketId ?? '').toLowerCase() === marketId.toLowerCase(),
    );
    const items = (market?.preLiquidations?.items ?? []) as Array<Record<string, string>>;
    return items.map((x) => ({
      address: x.address,
      preLltv: BigInt(x.preLltv),
      preLCF1: BigInt(x.preLCF1),
      preLCF2: BigInt(x.preLCF2),
      preLIF1: BigInt(x.preLIF1),
      preLIF2: BigInt(x.preLIF2),
      preLiquidationOracle: x.preLiquidationOracle,
    }));
  } catch (e) {
    console.warn('[preliquidation] indexer unreachable:', (e as Error).message);
    return [];
  }
}

/** ¿Hay ya una instancia con EXACTAMENTE estos params? (misma dirección por CREATE2) */
export function findMatching(
  live: LivePreLiquidation[],
  p: PreLiquidationParams,
): LivePreLiquidation | null {
  return (
    live.find(
      (x) =>
        x.preLltv === p.preLltv &&
        x.preLCF1 === p.preLCF1 &&
        x.preLCF2 === p.preLCF2 &&
        x.preLIF1 === p.preLIF1 &&
        x.preLIF2 === p.preLIF2 &&
        x.preLiquidationOracle.toLowerCase() === p.preLiquidationOracle.toLowerCase(),
    ) ?? null
  );
}
