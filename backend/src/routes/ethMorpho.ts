/**
 * /api/eth-morpho — the FXRP/RLUSD lend-borrow flow on Ethereum (W3, plan §13).
 *
 * Prepare-only, rail A1 (the user's OWN wallet signs on chain 1; Astryum never
 * signs, never broadcasts). Mounted behind requireSiweAuth; every ENTRY
 * prepare additionally sits behind the hard invariant frontier shared with
 * flareDemo: feature flag (#10, ETH_RLUSD_FXRP_ENABLED) + per-jurisdiction
 * geofence (#5). EXIT prepares and every READ are flag-only — «LA SALIDA JAMÁS
 * SE GATEA» (gateEthMorphoExit / gateEthMorphoRead). The flag ships OFF and does
 * not turn on until the 4-contract risk scan passes (BuildSpec B5).
 *
 * Surface:
 *   GET  /status  → { active }              (the Earn cards ask before showing)
 *   GET  /market  → live market snapshot    (flag-only read; protocol data with source)
 *   POST /prepare → unsigned legs + pre-flights + simulation + disclosure
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { jurisdictionService } from '../services/JurisdictionService';
import {
  readMarketSnapshot,
  computeUserPosition,
} from '../services/EthMorphoMarketService';
import {
  prepareEthMorpho,
  prepareSentoraVault,
  prepareFxrpBridge,
  prepareFxrpBridgeBack,
  prepareCloseCarry,
  SimulateFn,
} from '../services/EthMorphoPrepareService';
// Los lectores on-chain viven en UN sitio (services/ethMorphoReaders) para que
// el ensayo en seco ejercite EXACTAMENTE los mismos que firma el usuario: una
// copia que diverge verificaría un carril que no existe.
import {
  makeMorphoReader as reader,
  makeSentoraReader as sentoraReader,
  makeBridgeReader as bridgeReader,
  makeBridgeBackReader as bridgeBackReader,
  makeEthFillQuoter,
} from '../services/ethMorphoReaders';
import {
  FXRP_RLUSD_MARKET_ID,
  FXRP_ETH,
  RLUSD_ETH,
} from '../connectors/protocols/adapters/MorphoBlueEthAdapter';
import { goPlusProvider } from '../integrations/providers/security/GoPlusProvider';
import { SENTORA_RLUSD_VAULT } from '../connectors/protocols/adapters/SentoraRlusdVaultAdapter';
import { TenderlyProvider } from '../integrations/providers/security/TenderlyProvider';
import {
  prepareArmPreLiquidation,
  prepareDisarmPreLiquidation,
  fetchLivePreLiquidations,
  findMatching,
  suggestParams,
  PRELIQUIDATION_FACTORY_ETH,
  type Aggressiveness,
} from '../services/EthPreLiquidationService';

const router = Router();

/** Same frontier shape as gateFlareDemo — flag (#10) + geofence (#5). */
function gateEthMorpho(region: string | null): { status: number; error: string } | null {
  if (process.env.ETH_RLUSD_FXRP_ENABLED !== 'true') {
    return { status: 503, error: 'ETH_RLUSD_FXRP_DISABLED' };
  }
  const geo = jurisdictionService.isDefiExecutionAllowed(region);
  if (!geo.allowed) {
    return { status: 451, error: `GEOFENCE_BLOCKED: ${geo.reason ?? 'region not allowed'}` };
  }
  return null;
}

/**
 * THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA», 2026-09-13).
 *
 * The gate for EXITS on this rail: flag-only (#10), NO geofence. Repaying debt,
 * withdrawing one's own collateral, closing the whole carry, redeeming from the
 * Sentora vault and bridging FXRP back to Flare all unwind a position the holder
 * already has. The geofence (#5) exists to stop OPENING exposure from a blocked
 * region; applied to an unwind it leaves someone with a leveraged position and no
 * way down while liquidation runs. The flag stays (module kill-switch, pending
 * founder decision). Entries keep `gateEthMorpho(region)`.
 */
function gateEthMorphoExit(): { status: number; error: string } | null {
  if (process.env.ETH_RLUSD_FXRP_ENABLED !== 'true') {
    return { status: 503, error: 'ETH_RLUSD_FXRP_DISABLED' };
  }
  return null;
}

/**
 * The gate for READS on this rail (GET /position, /balances, /market, /vault,
 * /preliquidation): flag-only (#10), NO geofence — «LA SALIDA JAMÁS SE GATEA».
 *
 * A read opens no exposure, so the geofence (#5) has nothing to stop here; what a
 * 451 on a read DID stop was the exit. Every exit modal reads before it prepares:
 * EmExitModal reads /position and /market, EmRepayModal and EmBridgeModal read
 * /market for the decimals, the lend-only withdraw reads /vault, the positions
 * board reads /position. With the reads geofenced, the (already ungated) exit
 * prepares were unreachable from the app in a blocked region — someone with a
 * leveraged position could not even SEE it, let alone unwind it. Monitoring is
 * always available (#5). The module flag stays (kill-switch, founder decision).
 */
function gateEthMorphoRead(): { status: number; error: string } | null {
  return gateEthMorphoExit();
}

/** Tenderly wired only when configured — the service is honest either way. */
function simulateFn(): SimulateFn | undefined {
  if (!process.env.TENDERLY_API_KEY) return undefined;
  const tenderly = new TenderlyProvider();
  return (input) => tenderly.simulateTransaction(input);
}

export interface VaultApyRate {
  apyPct: number | null;
  netApyPct: number | null;
  performanceFeePct: number | null;
  source: string;
}

/**
 * Reads the rate out of Morpho's GraphQL answer — pure, so the shape this route
 * depends on is pinned by tests instead of by a live call.
 *
 * Two ways the answer says "no" that a naive read takes for a yes: GraphQL
 * replies **200 with an `errors` array** on a refusal, and a query aimed at the
 * wrong entry point returns `data: null` just as calmly. Both used to fall
 * through to `undefined` and degrade to nulls with nothing logged — which is how
 * a V1 query against a V2 vault sat here serving "source unavailable" without
 * leaving a trace. The degrade is right; the silence was the bug.
 *
 * `refusal` is the reason to log; `rate` is always safe to serve (nulls beat
 * invented figures — invariant #9).
 */
export function parseVaultApy(body: unknown, source: string): { rate: VaultApyRate; refusal?: string } {
  const empty: VaultApyRate = { apyPct: null, netApyPct: null, performanceFeePct: null, source };
  const json = body as {
    data?: { vaultV2ByAddress?: { apy?: unknown; netApy?: unknown; performanceFee?: unknown } | null };
    errors?: Array<{ message?: string }>;
  } | null;

  if (json?.errors?.length) {
    return { rate: empty, refusal: json.errors.map((e) => e?.message ?? 'unknown').join('; ') };
  }
  const v = json?.data?.vaultV2ByAddress;
  if (!v) return { rate: empty, refusal: 'no vault returned for this address' };

  // Fractions on the wire (0.0816 = 8.16%), two decimals on screen.
  const asPct = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10_000) / 100 : null;

  return {
    rate: {
      apyPct: asPct(v.apy),
      netApyPct: asPct(v.netApy),
      performanceFeePct: asPct(v.performanceFee),
      source,
    },
  };
}

/**
 * Best-effort netApy from Morpho's public API (works for chain 1, NOT 14).
 * Protocol data with source; on any failure → nulls, never invented figures.
 * The base/net split matters: net includes incentives (invariant #9 breakdown).
 */
async function fetchVaultApy(): Promise<{
  apyPct: number | null; netApyPct: number | null; performanceFeePct: number | null; source: string;
}> {
  const source = 'Morpho API (blue-api.morpho.org) — netApy includes incentives';
  const empty = { apyPct: null, netApyPct: null, performanceFeePct: null, source };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      // `vaultV2ByAddress`, not `vaultByAddress`: this vault is a Morpho Vault
      // V2 (senRLUSDv2) and the V1 entry point answers NOT_FOUND for it — which
      // is why the card showed "source unavailable" instead of a rate. V2 also
      // returns the fields FLAT (no `state` wrapper) and names the fee
      // `performanceFee`.
      body: JSON.stringify({
        query: `query { vaultV2ByAddress(address: "${SENTORA_RLUSD_VAULT.toLowerCase()}", chainId: 1) { apy netApy performanceFee } }`,
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn(`[eth-morpho/vault] APY source HTTP ${resp.status}`);
      return empty;
    }
    const parsed = parseVaultApy(await resp.json(), source);
    if (parsed.refusal) console.warn(`[eth-morpho/vault] APY source refused: ${parsed.refusal}`);
    return parsed.rate;
  } catch (err) {
    console.warn(`[eth-morpho/vault] APY source unreachable: ${(err as Error).message}`);
    return empty;
  }
}

/* GET /status — is the module on? (cards use this; no geofence for a boolean) */
router.get('/status', (_req: Request, res: Response) => {
  res.json({ active: process.env.ETH_RLUSD_FXRP_ENABLED === 'true' });
});

/**
 * GET /position?wallet=0x… — la posición VIVA del usuario en el mercado
 * FXRP/RLUSD (H1: hasta ahora el carril no la exponía por HTTP, así que el
 * board no tenía de dónde leerla y la plantilla PROTECT_EM y la puerta de
 * repago eran inalcanzables).
 *
 * Read-only y SOLO flag (gateEthMorphoRead): es la lectura con la que el tablero y
 * el modal de salida ven la posición — geofencearla dejaba sin salida a quien ya
 * estaba dentro («LA SALIDA JAMÁS SE GATEA»). Devuelve base units
 * + los decimales LEÍDOS (asimetría 6/18, familia F4) para que el cliente
 * jamás asuma; `hasPosition:false` cuando no hay nada — un cero legítimo, no
 * un fallo. El HF viene del mismo cálculo que usa el tick (una matemática,
 * una superficie de bug).
 */
router.get('/position', async (req: Request, res: Response) => {
  const gate = gateEthMorphoRead(); // a read never takes the geofence — see gateEthMorphoRead
  if (gate) return res.status(gate.status).json({ error: gate.error });
  const wallet = String(req.query.wallet ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'INVALID_WALLET' });
  }
  try {
    const r = reader();
    const snap = await readMarketSnapshot(r, FXRP_RLUSD_MARKET_ID);
    const raw = await r.position(FXRP_RLUSD_MARKET_ID, wallet);
    const position = computeUserPosition(raw, snap);

    // LA PATA LEND-ONLY. Sin esto, el RLUSD que entra en la bóveda desaparecía
    // de la aplicación entera: ni fila en el tablero, ni saldo en la salida, ni
    // manera de saber cuánto tienes. Y la pantalla de éxito prometía que
    // aparecería en Positions. El usuario que no ve su dinero vuelve a
    // depositar (auditoría 2026-08-17, hallazgo crítico).
    //
    // Best-effort A PROPÓSITO: si la bóveda no se puede leer, la posición del
    // MERCADO sigue saliendo. Meterlas en el mismo try haría que un fallo de la
    // bóveda borrase también el colateral y la deuda — que es exactamente el
    // bug que se cerró esta mañana, reentrando por otra puerta.
    let lentReadOk = false;
    let lentSharesBase = '0';
    let lentAssetsBase = '0';
    let lentDecimals = 18;
    let vaultAvailableNowBase = '0';
    try {
      const v = sentoraReader();
      const shares = v.sharesOf ? await v.sharesOf(wallet) : 0n;
      const assets = shares > 0n && v.previewRedeem ? await v.previewRedeem(shares) : 0n;
      lentDecimals = await v.assetDecimals();
      vaultAvailableNowBase = v.idleAssets ? (await v.idleAssets()).toString() : '0';
      lentSharesBase = shares.toString();
      lentAssetsBase = assets.toString();
      lentReadOk = true;
    } catch (e) {
      // `lentReadOk:false` NO es «no tienes nada prestado»: es «no lo sé». El
      // cliente debe decirlo, jamás pintar un cero.
      console.warn('[eth-morpho] vault leg unreadable:', (e as Error).message);
    }

    const hasPosition =
      position.collateral > 0n || position.borrowAssets > 0n || BigInt(lentAssetsBase) > 0n;
    return res.json({
      wallet,
      marketId: FXRP_RLUSD_MARKET_ID,
      chainId: 1,
      hasPosition,
      // La pata lend-only (bóveda Sentora), en base units con SUS decimales.
      lentReadOk,
      lentSharesBase,
      lentAssetsBase,
      lentSymbol: 'RLUSD',
      lentDecimals,
      /** Techo DURO de una retirada hoy: la bóveda no desasigna al vuelo. */
      vaultAvailableNowBase,
      vault: SENTORA_RLUSD_VAULT,
      collateralBase: position.collateral.toString(),
      collateralSymbol: 'FXRP',
      collateralDecimals: snap.collateralDecimals,
      debtBase: position.borrowAssets.toString(),
      debtSymbol: 'RLUSD',
      debtDecimals: snap.loanDecimals,
      collateralValueBase: position.collateralValue.toString(),
      maxBorrowBase: position.maxBorrow.toString(),
      // Infinity no sobrevive a JSON.stringify (se serializa como null) — sin
      // deuda se dice con null y el cliente lo lee como "no hay riesgo", que
      // es la verdad, en vez de recibir un 0 que parecería liquidación.
      healthFactor: Number.isFinite(position.healthFactor) ? position.healthFactor : null,
      lltvPct: Number(snap.params.lltv) / 1e16,
      readAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = (e as Error).message ?? 'read failed';
    const status = /UNSUPPORTED_CHAIN|rpc|network/i.test(msg) ? 503 : 502;
    return res.status(status).json({ error: 'POSITION_READ_FAILED', detail: msg });
  }
});

/**
 * GET /balances?wallet=0x… — dónde está el FXRP de esta wallet, y cuánto.
 *
 * La entrada al mercado ocurre en Ethereum, pero el FXRP puede estar en Flare.
 * Sin esta lectura el cliente no podía saberlo: la línea de disponible y el
 * botón MAX estaban ocultos a propósito para este carril (el endpoint de saldo
 * nativo solo sabe leer Flare), así que el usuario escribía la cantidad a
 * ciegas y el único aviso llegaba del pre-flight, ya con el formulario relleno.
 *
 * Es además lo que permite DECIDIR el camino en vez de preguntarlo: con FXRP
 * suficiente en Ethereum se entra directo; si está en Flare hace falta el
 * puente. El cliente no tiene que adivinar cuál, y el usuario tampoco.
 *
 * Cada cadena se lee por separado y a propósito: si una falla, la otra sigue
 * contestando. Un fallo devuelve `null`, NUNCA 0 — «no pude leer» y «no tienes»
 * llevan a decisiones opuestas, y confundirlos aquí manda a alguien a puentear
 * un FXRP que ya tenía, o a creer que no tiene nada.
 */
router.get('/balances', async (req: Request, res: Response) => {
  const gate = gateEthMorphoRead(); // a read never takes the geofence — see gateEthMorphoRead
  if (gate) return res.status(gate.status).json({ error: gate.error });
  const wallet = String(req.query.wallet ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'INVALID_WALLET' });
  }

  const readOr = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[eth-morpho/balances] ${label} unreadable: ${(e as Error).message}`);
      return null;
    }
  };

  const [fxrpEthereum, fxrpFlare, rlusdEthereum, decimals] = await Promise.all([
    readOr('FXRP@ethereum', async () => (await bridgeBackReader().fxrpBalanceOf(wallet)).toString()),
    readOr('FXRP@flare', async () => (await bridgeReader().fxrpBalanceOf(wallet)).toString()),
    readOr('RLUSD@ethereum', async () => (await sentoraReader().assetBalanceOf(wallet)).toString()),
    // Decimales LEÍDOS, nunca asumidos: FXRP 6 / RLUSD 18 es la asimetría que
    // ya ha costado bugs (familia F4).
    readOr('decimals', async () => {
      const snap = await readMarketSnapshot(reader(), FXRP_RLUSD_MARKET_ID);
      return { fxrp: snap.collateralDecimals, rlusd: snap.loanDecimals };
    }),
  ]);

  return res.json({
    wallet,
    fxrp: {
      ethereumBase: fxrpEthereum,
      flareBase: fxrpFlare,
      decimals: decimals?.fxrp ?? null,
      symbol: 'FXRP',
    },
    rlusd: {
      ethereumBase: rlusdEthereum,
      decimals: decimals?.rlusd ?? null,
      symbol: 'RLUSD',
    },
    readAt: new Date().toISOString(),
  });
});

/* GET /market — live snapshot for the Earn cards (protocol data with source). */
router.get('/market', async (req: Request, res: Response) => {
  const gate = gateEthMorphoRead(); // a read never takes the geofence — see gateEthMorphoRead
  if (gate) return res.status(gate.status).json({ error: gate.error });
  try {
    const snap = await readMarketSnapshot(reader(), FXRP_RLUSD_MARKET_ID);
    return res.json({
      marketId: FXRP_RLUSD_MARKET_ID,
      chainId: 1,
      lltvPct: Number(snap.params.lltv / 10n ** 14n) / 100,
      utilizationPct: Math.round(snap.utilization * 10_000) / 100,
      availableLiquidityBase: snap.availableLiquidity.toString(),
      totalSupplyAssetsBase: snap.state.totalSupplyAssets.toString(),
      totalBorrowAssetsBase: snap.state.totalBorrowAssets.toString(),
      decimals: { collateral: snap.collateralDecimals, loan: snap.loanDecimals },
      borrowAprPct: snap.borrowAprPct ?? null,
      borrowAprSource: snap.borrowAprSource,
    });
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

/* GET /vault — the lend-only card's live data (on-chain + API with source). */
router.get('/vault', async (req: Request, res: Response) => {
  const gate = gateEthMorphoRead(); // a read never takes the geofence — see gateEthMorphoRead
  if (gate) return res.status(gate.status).json({ error: gate.error });
  try {
    const vault = sentoraReader();
    const [asset, totalAssets, decimals, apy] = await Promise.all([
      vault.asset(),
      vault.totalAssets(),
      vault.assetDecimals(),
      fetchVaultApy(),
    ]);
    return res.json({
      vault: SENTORA_RLUSD_VAULT,
      chainId: 1,
      asset,
      assetDecimals: decimals,
      totalAssetsBase: totalAssets.toString(),
      // Base vs net split surfaced so the UI can show the incentives breakdown
      // (invariant #9) — nulls mean "source unavailable", the UI says so.
      apyPct: apy.apyPct,
      netApyPct: apy.netApyPct,
      performanceFeePct: apy.performanceFeePct,
      apySource: apy.source,
    });
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

const prepareSchema = z.object({
  action: z.enum(['supply_collateral', 'borrow', 'repay', 'withdraw_collateral', 'open_carry']),
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountBase: z.string().regex(/^\d+$/).optional(),
  borrowBase: z.string().regex(/^\d+$/).optional(),
  repayMode: z.enum(['partial', 'full']).optional(),
  /** open_carry: lend the borrowed RLUSD into the Sentora vault, same signature. */
  lendBorrowed: z.boolean().optional(),
  /** repay: redeem the exact shortfall from the Sentora vault, same signature. */
  fromVault: z.boolean().optional(),
  region: z.string().trim().min(2).max(8).nullable().optional(),
});

/**
 * The /prepare actions that UNWIND the holder's own position — THE EXIT IS NEVER
 * GATED: flag-only, and a scanner DANGER is a warning, not a refusal. Everything
 * else on /prepare opens exposure and keeps the geofence + the 409.
 */
const ETH_MORPHO_EXIT_ACTIONS = new Set<string>(['repay', 'withdraw_collateral']);

const bridgePrepareSchema = z.object({
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountBase: z.string().regex(/^\d+$/),
  /** H3: 'to-flare' es la VUELTA. Por defecto la ida, para no romper clientes. */
  direction: z.enum(['to-ethereum', 'to-flare']).default('to-ethereum'),
  region: z.string().trim().min(2).max(8).nullable().optional(),
});

/* POST /bridge/prepare — FXRP entre Flare y Ethereum (B6 ida · H3 vuelta):
   legs + comisión LZ viva + pre-flights de saldo y de comisión en su moneda. */
router.post('/bridge/prepare', async (req: Request, res: Response) => {
  const parsed = bridgePrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  // 'to-flare' is the way BACK (FXRP home to Flare): an exit, flag-only — and the
  // KWYH scan of the token it moves (FXRP) runs and travels as `riskWarnings`,
  // never as a refusal (THE EXIT IS NEVER GATED; EmBridgeModal renders it).
  // 'to-ethereum' carries capital INTO the Ethereum market: an entry, geofenced.
  const isExit = parsed.data.direction === 'to-flare';
  const gate = isExit ? gateEthMorphoExit() : gateEthMorpho(parsed.data.region ?? null);
  if (gate) return res.status(gate.status).json({ error: gate.error });
  const riskWarnings = isExit ? await scanTokensAsWarnings(parsed.data.user, [['FXRP', FXRP_ETH]]) : [];
  try {
    const input = { user: parsed.data.user, amountBase: parsed.data.amountBase };
    const result = isExit
      ? await prepareFxrpBridgeBack(bridgeBackReader(), input, simulateFn())
      : await prepareFxrpBridge(bridgeReader(), input, simulateFn());
    return res.json(withRiskWarnings(result, riskWarnings));
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

const vaultPrepareSchema = z.object({
  action: z.enum(['vault_deposit', 'vault_withdraw']),
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountBase: z.string().regex(/^\d+$/),
  region: z.string().trim().min(2).max(8).nullable().optional(),
});

/* POST /vault/prepare — lend-only legs + pre-flight + simulation + disclosure
   (+ `riskWarnings` on vault_withdraw when the scanner flags RLUSD). */
router.post('/vault/prepare', async (req: Request, res: Response) => {
  const parsed = vaultPrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  // vault_withdraw redeems the holder's own RLUSD: an exit, flag-only — the KWYH
  // scan of the token it hands back (RLUSD) runs and travels as `riskWarnings`,
  // never as a refusal (THE EXIT IS NEVER GATED; EmExitModal renders it).
  // vault_deposit opens exposure: an entry, geofenced.
  const isExit = parsed.data.action === 'vault_withdraw';
  const gate = isExit ? gateEthMorphoExit() : gateEthMorpho(parsed.data.region ?? null);
  if (gate) return res.status(gate.status).json({ error: gate.error });
  const riskWarnings = isExit ? await scanTokensAsWarnings(parsed.data.user, [['RLUSD', RLUSD_ETH]]) : [];
  try {
    const result = await prepareSentoraVault(
      sentoraReader(),
      { action: parsed.data.action, user: parsed.data.user, amountBase: parsed.data.amountBase },
      simulateFn(),
    );
    return res.json(withRiskWarnings(result, riskWarnings));
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

/**
 * H9 — el escáner KWYH (invariante 10: «nada se enchufa sin su scanner»).
 *
 * En el carril de Flare esto es un GATE de código (`flareDemo`: verdict
 * `danger` ⇒ 409 antes de componer). Aquí era un paso MANUAL del runbook, que
 * es tanto como decir que no existe: nadie lo corre en el momento de firmar.
 * Best-effort por diseño — un escáner caído no puede bloquear el carril—, pero
 * un DANGER sí para la firma en seco.
 */
export interface KwyhRiskWarning {
  /** Same code an entry would be refused with (KWYH_DANGER_FXRP / KWYH_DANGER_RLUSD). */
  code: string;
  token: string;
  address: string;
  flags: string[];
  note: string;
}

/** The GoPlus DANGER findings for these tokens. Best-effort: a scanner down yields none. */
async function scanTokens(wallet: string, tokens: Array<[string, string]>): Promise<KwyhRiskWarning[]> {
  const findings: KwyhRiskWarning[] = [];
  for (const [label, address] of tokens) {
    try {
      const { data } = await goPlusProvider.call<
        { chainId: number; address: string },
        { verdict: string; flags: string[] }
      >('security.tokenSafety', { chainId: 1, address }, { traceId: 'eth-morpho', wallet });
      if (data?.verdict === 'danger') {
        findings.push({
          code: `KWYH_DANGER_${label}`,
          token: label,
          address,
          flags: data.flags ?? [],
          note:
            `GoPlus flags ${label} as dangerous. This operation takes your own capital OUT, so it is not blocked — ` +
            'review the flags before you sign.',
        });
      }
    } catch {
      /* escáner caído: no se bloquea el carril por su indisponibilidad */
    }
  }
  return findings;
}

/** ENTRIES: a DANGER verdict refuses the prepare (409) before anything is composed. */
async function scanTokensOrBlock(
  res: Response,
  wallet: string,
  tokens: Array<[string, string]>,
): Promise<boolean> {
  const [danger] = await scanTokens(wallet, tokens);
  if (danger) {
    res.status(409).json({ error: danger.code, flags: danger.flags });
    return false;
  }
  return true;
}

/**
 * EXITS: THE EXIT IS NEVER GATED. A token flagged DANGER is exactly when a holder
 * wants out — refusing the unwind would trap them inside the thing the scanner
 * warns about. The scan still runs (#10) and its verdict travels in the response
 * as `riskWarnings`, so the disclosure shows it before signing; it never blocks.
 */
async function scanTokensAsWarnings(wallet: string, tokens: Array<[string, string]>): Promise<KwyhRiskWarning[]> {
  return scanTokens(wallet, tokens);
}

/** Attach exit scan warnings to a prepare result — shape unchanged when there are none. */
function withRiskWarnings<T>(result: T, riskWarnings: KwyhRiskWarning[]): T | (T & { riskWarnings: KwyhRiskWarning[] }) {
  return riskWarnings.length > 0 ? { ...(result as T & object), riskWarnings } : result;
}

const closePrepareSchema = z.object({
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /**
   * Cómo cubrir el hueco del interés. Se omite a propósito en la primera
   * llamada: la respuesta trae el hueco y sus opciones, y el usuario ELIGE
   * (doctrina del 31-jul — un default silencioso que vende su colateral, no).
   */
  coverGap: z.enum(['swap-collateral', 'wallet']).optional(),
  region: z.string().trim().min(2).max(8).nullable().optional(),
});

/**
 * POST /close/prepare — cancelar la posición ENTERA en un lote.
 *
 * Cerrar cuesta más de lo que se pidió prestado (el interés), y hasta hoy ese
 * hueco obligaba a traer RLUSD de otra cadena. Aquí se cubre desde la propia
 * posición: la bóveda primero, y el resto comprando el hueco EXACTO con el
 * colateral sobrante dentro del mismo lote.
 */
router.post('/close/prepare', async (req: Request, res: Response) => {
  const parsed = closePrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  // Closing the whole position is the purest EXIT on this rail: flag-only, and the
  // scanner warns instead of refusing (THE EXIT IS NEVER GATED).
  const gate = gateEthMorphoExit();
  if (gate) return res.status(gate.status).json({ error: gate.error });
  const riskWarnings = await scanTokensAsWarnings(parsed.data.user, [
    ['FXRP', FXRP_ETH],
    ['RLUSD', RLUSD_ETH],
  ]);
  try {
    const result = await prepareCloseCarry(
      reader(),
      sentoraReader(),
      { user: parsed.data.user, coverGap: parsed.data.coverGap },
      makeEthFillQuoter(),
      simulateFn(),
    );
    return res.json(withRiskWarnings(result, riskWarnings));
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

const preLiqSchema = z.object({
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Cuándo quieres que salte. Se derivan del LLTV REAL del mercado. */
  mode: z.enum(['early', 'balanced', 'late']).default('balanced'),
  /** Retirar una protección ya armada. */
  disarm: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  region: z.string().trim().min(2).max(8).nullable().optional(),
});

/**
 * GET /preliquidation — qué protecciones EXISTEN para este mercado.
 *
 * El factory despliega con `salt: 0`, así que el mismo (mercado, params) da
 * siempre la misma dirección y crear una que ya existe REVIERTE SIN DATOS.
 * Leer antes convierte ese revert en una simple autorización.
 */
router.get('/preliquidation', async (req: Request, res: Response) => {
  const gate = gateEthMorphoRead(); // a read never takes the geofence — see gateEthMorphoRead
  if (gate) return res.status(gate.status).json({ error: gate.error });
  try {
    const snap = await readMarketSnapshot(reader(), FXRP_RLUSD_MARKET_ID);
    const live = await fetchLivePreLiquidations(FXRP_RLUSD_MARKET_ID);
    const wad = 10n ** 18n;
    return res.json({
      chainId: 1,
      marketId: FXRP_RLUSD_MARKET_ID,
      factory: PRELIQUIDATION_FACTORY_ETH,
      marketLltvPct: Number((snap.params.lltv * 10_000n) / wad) / 100,
      /** Los tres presets, ya validados contra el LLTV de HOY. */
      presets: (['early', 'balanced', 'late'] as Aggressiveness[]).map((mode) => {
        const p = suggestParams(snap.params.lltv, mode, snap.params.oracle);
        const found = findMatching(live, p);
        return {
          mode,
          preLltvPct: Number((p.preLltv * 10_000n) / wad) / 100,
          incentivePct: Number(((p.preLIF1 - wad) * 10_000n) / wad) / 100,
          alreadyDeployed: found ? found.address : null,
        };
      }),
      live: live.map((x) => ({
        address: x.address,
        preLltvPct: Number((x.preLltv * 10_000n) / wad) / 100,
        incentivePct: Number(((x.preLIF1 - wad) * 10_000n) / wad) / 100,
      })),
      readAt: new Date().toISOString(),
    });
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

/**
 * POST /preliquidation/prepare — armar (o retirar) la protección sin firma en
 * el disparo. El contrato es de Morpho, auditado; nosotros solo componemos.
 */
router.post('/preliquidation/prepare', async (req: Request, res: Response) => {
  const parsed = preLiqSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  const gate = gateEthMorpho(parsed.data.region ?? null);
  if (gate) return res.status(gate.status).json({ error: gate.error });
  try {
    if (parsed.data.disarm) {
      return res.json({
        chainId: 1,
        legs: prepareDisarmPreLiquidation(parsed.data.disarm),
        disclosure: {
          disclosedToUser: true,
          signerNote: 'Signed by your own wallet on Ethereum — Astryum never signs or broadcasts',
          note: 'After this, nothing watches the position on your behalf.',
        },
      });
    }
    const snap = await readMarketSnapshot(reader(), FXRP_RLUSD_MARKET_ID);
    const params = suggestParams(snap.params.lltv, parsed.data.mode, snap.params.oracle);
    const live = await fetchLivePreLiquidations(FXRP_RLUSD_MARKET_ID);
    const existing = findMatching(live, params);
    const result = prepareArmPreLiquidation(
      { user: parsed.data.user, params, existingInstance: existing?.address ?? null },
      snap.params.lltv,
    );
    return res.json(result);
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

/* POST /prepare — unsigned legs + pre-flights + simulation + disclosure. */
router.post('/prepare', async (req: Request, res: Response) => {
  const parsed = prepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  // repay / withdraw_collateral unwind the holder's own position: EXITS — flag-only,
  // and a scanner DANGER travels as `riskWarnings` instead of refusing.
  // supply_collateral / borrow / open_carry open exposure: ENTRIES — geofence + 409.
  const isExit = ETH_MORPHO_EXIT_ACTIONS.has(parsed.data.action);
  const gate = isExit ? gateEthMorphoExit() : gateEthMorpho(parsed.data.region ?? null);
  if (gate) return res.status(gate.status).json({ error: gate.error });
  const tokens: Array<[string, string]> = [
    ['FXRP', FXRP_ETH],
    ['RLUSD', RLUSD_ETH],
  ];
  let riskWarnings: KwyhRiskWarning[] = [];
  if (isExit) {
    riskWarnings = await scanTokensAsWarnings(parsed.data.user, tokens);
  } else {
    const safe = await scanTokensOrBlock(res, parsed.data.user, tokens);
    if (!safe) return;
  }

  try {
    const result = await prepareEthMorpho(
      reader(),
      {
        action: parsed.data.action,
        user: parsed.data.user,
        amountBase: parsed.data.amountBase,
        borrowBase: parsed.data.borrowBase,
        repayMode: parsed.data.repayMode,
        lendBorrowed: parsed.data.lendBorrowed,
        fromVault: parsed.data.fromVault,
      },
      simulateFn(),
      // The vault reader rides along for the two flows that touch Sentora
      // (lend the borrowed RLUSD · repay from the vault) — the SAME reader the
      // lend-only route uses, so both doors read one truth.
      sentoraReader(),
    );
    return res.json(withRiskWarnings(result, riskWarnings));
  } catch (e) {
    return sendPrepareError(res, e);
  }
});

function sendPrepareError(res: Response, e: unknown): Response {
  const err = e as Error & { code?: string; data?: unknown };
  const code = err.code ?? '';
  if (code === 'MARKET_PARAMS_DRIFT' || code === 'VAULT_ASSET_MISMATCH' ||
      code === 'BRIDGE_TOKEN_DRIFT' || code === 'BRIDGE_PEER_DRIFT') {
    // The chain no longer matches what we pinned — refuse loudly, never build.
    return res.status(409).json({ error: code, detail: err.message });
  }
  if (code.startsWith('INVALID_') || code === 'NO_DEBT' || code === 'NO_POSITION' || code === 'REPAY_EXCEEDS_DEBT') {
    return res.status(400).json({ error: code, detail: err.message, data: err.data });
  }
  if (err.message?.startsWith('UNSUPPORTED_CHAIN')) {
    return res.status(503).json({ error: 'ETH_RPC_UNAVAILABLE', detail: err.message });
  }
  return res.status(502).json({ error: 'PREPARE_FAILED', detail: err.message?.slice(0, 200) });
}

export default router;
