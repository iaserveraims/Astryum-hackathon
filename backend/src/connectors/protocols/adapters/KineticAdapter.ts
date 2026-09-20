import { BaseAdapter } from './BaseAdapter';
import { getProtocolAddresses } from '../../../config/protocolAddresses';
import { computeRepayToRestoreHF } from '../flare/KineticIsoMath';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type {
  SimulationResult,
  TransactionIntent,
  IntentBuildContext,
} from '../../../types/domain/Intent';
import type { EncodedAction, EncodeActionParams, PositionDiscovery, UnreadableRead } from '../IProtocolAdapter';

/**
 * Compound-V2-fork (CErc20) entrypoints. All four actions call the per-asset
 * kToken market; supply needs a prior ERC-20 approve(kToken, amount) — handled
 * by the frontend's batch-approve (spender = tx.to) and by moneyflow assembly.
 */
const KTOKEN_ERC20_ABI = [
  'function mint(uint256 mintAmount) returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) returns (uint256)',
  'function redeem(uint256 redeemTokens) returns (uint256)',
  'function borrow(uint256 borrowAmount) returns (uint256)',
  'function repayBorrow(uint256 repayAmount) returns (uint256)',
];

const ACTION_TO_FN: Record<string, string> = {
  supply: 'mint',
  withdraw: 'redeemUnderlying',
  borrow: 'borrow',
  repay: 'repayBorrow',
};

/**
 * «No pude leer la posición» — el error que sustituye al `0n` inventado.
 *
 * . Lo lanza `KineticAdapter.isoRead` y lo traducen las rutas ISO a un
 * rechazo retryable que NOMBRA la lectura caída, en vez de afirmar un hecho
 * sobre el dinero de alguien. Es de OURS-failed, no una política: no gatea
 * ninguna salida, no mueve nada, y se cura reintentando.
 */
export class IsoReadUnavailableError extends Error {
  readonly what: string;
  constructor(what: string, cause?: unknown) {
    const why = cause instanceof Error ? ` (${cause.message})` : '';
    super(`ISO_READ_UNAVAILABLE: ${what}${why}`);
    this.name = 'IsoReadUnavailableError';
    this.what = what;
  }
}

/**
 * «no pude leer la posicion» del TABLERO (discoverPositions). Hermano
 * de IsoReadUnavailableError (rutas /iso-*): un `balanceOf`, `balanceOfUnderlying`
 * o `borrowBalanceCurrent` que no contesta ya no se lee como `0n` — ni una
 * deuda viva como «sin deuda». Sube; el engine deja este adapter fuera de ESE
 * barrido y se lo dice a la persona (`snapshot.unreadable`).
 */
export class KineticPositionUnreadableError extends Error {
  readonly what: string;
  constructor(what: string, cause?: unknown) {
    const why = cause instanceof Error ? ` (${cause.message})` : '';
    super(`KINETIC_POSITION_UNREADABLE: ${what} did not answer${why}`);
    this.name = 'KineticPositionUnreadableError';
    this.what = what;
  }
}

const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const COMPTROLLER_ENTER_ABI = ['function enterMarkets(address[] cTokens) returns (uint256[])'];

// repayBorrowBehalf(address,uint256) — selector 0x2608f818, verified in the
// kUSDT0_ISO bytecode (impl 0xF114…A333). Lets a payer clear another account's
// borrow; A1 uses it to repay the Personal Account's USDT0 debt and lift its HF.
const KTOKEN_REPAY_BEHALF_ABI = [
  'function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)',
];

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Asset symbol → env var holding its kToken (CErc20) market address.
 * Only ERC-20 markets verified as standard CErc20 are listed. The native-FLR
 * market (kFLR) is intentionally absent: its entrypoint shape (CEther mint()
 * payable vs CErc20-over-WFLR) is unverified, and FXRP has no kToken in env yet.
 * Encoding refuses for any unlisted symbol — no guessed calldata (#3, due-diligence).
 */
const KINETIC_KTOKEN_ENV: Record<string, string> = {
  'USDC.E': 'KINETIC_KUSDCE',
  USDCE: 'KINETIC_KUSDCE',
  SFLR: 'KINETIC_KSFLR',
  WETH: 'KINETIC_KWETH',
  FLRETH: 'KINETIC_KFLRETH',
};

const COMPTROLLER_ABI = [
  'function getAssetsIn(address account) view returns (address[])',
  'function getAllMarkets() view returns (address[])',
  'function markets(address cToken) view returns (bool isListed, uint256 collateralFactorMantissa)',
  'function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)',
  'function liquidationIncentiveMantissa() view returns (uint256)',
];

const CTOKEN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function balanceOfUnderlying(address owner) returns (uint256)',
  'function borrowBalanceCurrent(address account) returns (uint256)',
  'function underlying() view returns (address)',
  'function symbol() view returns (string)',
  'function exchangeRateStored() view returns (uint256)',
];

const ERC20_META_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const MANTISSA = 10n ** 18n;

export class KineticAdapter extends BaseAdapter {
  readonly protocolId = 'kinetic';
  readonly chainId = 14;

  private get addresses() {
    return getProtocolAddresses().kinetic;
  }

  override get isActive(): boolean {
    return !!this.addresses.comptroller || !!this.addresses.isoComptroller;
  }

  /**
   * All-or-nothing entry (legacy callers: canonical aggregation, the
   * single-adapter route, the probe script). Any unread market makes the whole
   * answer a throw — a list with silent holes is the bug this file has been
   * removing. The board and the portfolio engine read
   * `discoverPositionsPartial` instead and serve what WAS read.
   */
  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { positions, unreadable } = await this.discoverPositionsPartial(wallet);
    if (unreadable.length > 0) {
      throw new KineticPositionUnreadableError(unreadable.map((u) => u.what).join(', '));
    }
    return positions;
  }

  /**
   * DEGRADE PER MARKET, NOT PER PROTOCOL. Made every
   * money read THROW instead of reading `0n`; right — but inside two
   * `Promise.all`s (~20 reads across two comptrollers), so ONE 429 on the
   * `balanceOf` probe of a market the wallet never touched took the whole
   * adapter down, and the carry holder's FXRP supply, USDT0 debt and «Repay»
   * door vanished from the board under the gateway's routine 429. Before
   * that probe read `0n` and the carry rows were untouched; the fix
   * had traded a hidden lend-only supply for a hidden carry.
   */
  async discoverPositionsPartial(wallet: string): Promise<PositionDiscovery> {
    if (!this.isActive) return { positions: [], unreadable: [] };
    // Scan BOTH the primary comptroller AND the ISO comptroller (where FXRP lives —
    // the E1 supply FXRP + borrow USDT0 position). The ISO market is a DISTINCT
    // comptroller with its own kTokens; without this the FXRP position is invisible.
    const comptrollers = [this.addresses.comptroller, this.addresses.isoComptroller]
      .filter((c, i, arr): c is string => !!c && arr.indexOf(c) === i);

    // Los dos comptrollers a la vez: en serie, el segundo esperaba
    // todas las vueltas del primero. Promise.all conserva el orden.
    const scans = await Promise.all(
      comptrollers.map((comptrollerAddr) =>
        this.scanComptroller(comptrollerAddr, wallet, comptrollerAddr === this.addresses.isoComptroller),
      ),
    );
    return {
      positions: scans.flatMap((s) => s.positions),
      unreadable: scans.flatMap((s) => s.unreadable),
    };
  }

  /** Read open supply/borrow positions for `wallet` under one Compound-fork comptroller. */
  private async scanComptroller(
    comptrollerAddr: string,
    wallet: string,
    iso: boolean,
  ): Promise<PositionDiscovery> {
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const comptroller = new ethers.Contract(comptrollerAddr, COMPTROLLER_ABI, provider);
    const unreadable: UnreadableRead[] = [];
    const reasonOf = (e: unknown) => String((e as Error)?.message ?? e ?? 'no answer').slice(0, 200);

    // getAssetsIn only lists ENTERED markets — and a plain supply (E3 lend-only,
    // carry re-supply) deliberately never calls enterMarkets, so it is invisible
    // there. Borrowing DOES require membership, so debt can't hide THERE. Union
    // the entered set with every market where the wallet holds kToken shares
    // (cheap balanceOf probe over getAllMarkets), or the supply can't be seen —
    // or withdrawn — from the positions board.
    const listRead = (fn: () => Promise<string[]>) =>
      Promise.resolve()
        .then(fn)
        .then(
          (v) => ({ ok: true as const, value: [...v] }),
          (e: unknown) => ({ ok: false as const, reason: reasonOf(e) }),
        );
    const [enteredRead, allRead] = await Promise.all([
      listRead(() => comptroller.getAssetsIn(wallet) as Promise<string[]>),
      listRead(() => comptroller.getAllMarkets() as Promise<string[]>),
    ]);

    let cTokens: string[] = [];
    if (enteredRead.ok === false && allRead.ok === false) {
      unreadable.push({
        what: `getAssetsIn/getAllMarkets on comptroller ${comptrollerAddr}`,
        reason: enteredRead.reason,
        market: comptrollerAddr,
      });
      return { positions: [], unreadable };
    }
    if (enteredRead.ok === false) {
      // Entered set unknown → read every market fully; debt can't hide.
      cTokens = allRead.ok === true ? allRead.value : [];
    } else {
      cTokens = enteredRead.value;
      if (allRead.ok === false) {
        // A lend-only supply lives outside the entered set: with getAllMarkets
        // down we cannot say there is none. The entered markets are still read.
        unreadable.push({
          what: `getAllMarkets on comptroller ${comptrollerAddr}`,
          reason: allRead.reason,
          market: comptrollerAddr,
        });
      } else {
        const entered = new Set(cTokens.map((a: string) => a.toLowerCase()));
        // The probe IS a money read: «could not read whether this
        // wallet holds shares in market M» used to be `0n`, i.e. «it holds
        // none». And it names THAT market only: the others are served.
        const probes = await Promise.all(
          allRead.value
            .filter((m) => !entered.has(m.toLowerCase()))
            .map((m) =>
              (new ethers.Contract(m, CTOKEN_ABI, provider).balanceOf(wallet) as Promise<bigint>).then(
                (bal) => ({ ok: true as const, market: m, held: BigInt(bal) > 0n }),
                (e: unknown) => ({ ok: false as const, market: m, reason: reasonOf(e) }),
              ),
            ),
        );
        for (const p of probes) {
          if (p.ok === false) unreadable.push({ what: `balanceOf on market ${p.market}`, reason: p.reason, market: p.market });
          else if (p.held) cTokens.push(p.market);
        }
      }
    }
    if (cTokens.length === 0) return { positions: [], unreadable };

    const now = new Date();

    // Cada mercado en paralelo: en serie eran dos vueltas al RPC POR
    // mercado, una detrás de otra — con ocho mercados, dieciséis vueltas. Ahora
    // ethers agrupa las lecturas de todos los mercados en un lote. El orden de
    // salida es el de `cTokens`: Promise.all lo conserva.
    const perMarket = await Promise.all(cTokens.map(async (cTokenAddr): Promise<RawPosition[]> => {
      const positions: RawPosition[] = [];
      const cToken = new ethers.Contract(cTokenAddr, CTOKEN_ABI, provider);
      // Supply and DEBT are money reads: `.catch(() => 0n)` on
      // `borrowBalanceCurrent` showed a wallet with live USDT0 debt as
      // debt-free whenever the node 429'd, and the unwind guide read that
      // zero as «nothing to repay». A failed one marks THIS market
      // unreadable (no row for it, named) and leaves the other markets alone;
      // the metadata reads (underlying, symbol) keep their soft fallbacks — a
      // missing label hides no money.
      const [supplyRead, borrowRead, underlying, cTokenSymbol] = await Promise.all([
        (cToken.balanceOfUnderlying.staticCall(wallet) as Promise<bigint>).then(
          (v) => ({ ok: true as const, value: BigInt(v) }),
          (e: unknown) => ({ ok: false as const, what: `balanceOfUnderlying on market ${cTokenAddr}`, reason: reasonOf(e) }),
        ),
        (cToken.borrowBalanceCurrent.staticCall(wallet) as Promise<bigint>).then(
          (v) => ({ ok: true as const, value: BigInt(v) }),
          (e: unknown) => ({ ok: false as const, what: `borrowBalanceCurrent on market ${cTokenAddr}`, reason: reasonOf(e) }),
        ),
        cToken.underlying().catch(() => ethers.ZeroAddress),
        cToken.symbol().catch(() => 'cUNKNOWN'),
      ]);
      for (const r of [supplyRead, borrowRead]) {
        if (r.ok === false) unreadable.push({ what: r.what, reason: r.reason, market: cTokenAddr });
      }
      if (supplyRead.ok === false || borrowRead.ok === false) return positions;
      const supplyAmount = supplyRead.value;
      const borrowAmount = borrowRead.value;
      if (supplyAmount <= 0n && borrowAmount <= 0n) return positions;

      // Amounts are denominated in the UNDERLYING (balanceOfUnderlying /
      // borrowBalanceCurrent) — so symbol and decimals must be the
      // underlying's, read live from its ERC-20. Pricing off the kToken
      // symbol (kFXRP…) hit no FTSO feed and the 18-decimals default
      // collapsed 6-decimal assets (FXRP, USDT0) to $0.00.
      let uSymbol = 'FLR'; // native market (no underlying()) is FLR
      let uDecimals = 18;
      if (underlying !== ethers.ZeroAddress) {
        const erc20 = new ethers.Contract(underlying, ERC20_META_ABI, provider);
        [uSymbol, uDecimals] = await Promise.all([
          erc20.symbol().catch(() => 'UNKNOWN'),
          erc20.decimals().then(Number).catch(() => 18),
        ]);
      }
      const meta = {
        cToken: cTokenAddr,
        cTokenSymbol,
        symbol: uSymbol,
        decimals: uDecimals,
        iso,
        comptroller: comptrollerAddr,
      };

      if (supplyAmount > 0n) {
        positions.push({
          protocolId: this.protocolId,
          chainId: this.chainId,
          wallet,
          kind: 'SUPPLY',
          asset: underlying,
          amount: BigInt(supplyAmount),
          raw: { ...meta, kind: 'supply' },
          discoveredAt: now,
        });
      }
      if (borrowAmount > 0n) {
        positions.push({
          protocolId: this.protocolId,
          chainId: this.chainId,
          wallet,
          kind: 'BORROW',
          asset: underlying,
          amount: BigInt(borrowAmount),
          raw: { ...meta, kind: 'borrow' },
          discoveredAt: now,
        });
      }
      return positions;
    }));

    return { positions: perMarket.flat(), unreadable };
  }

  normalizePosition(raw: RawPosition): NormalizedPosition {
    return {
      protocolId: raw.protocolId,
      chainId: raw.chainId,
      wallet: raw.wallet,
      kind: raw.kind,
      asset: raw.asset,
      amount: raw.amount,
      amountUSD: 0,
      priceUSD: 0,
      metadata: raw.raw,
      takenAt: raw.discoveredAt,
    };
  }

  /**
   * Position-level metrics. Reads Comptroller.getAccountLiquidity(wallet) +
   * markets(cToken).collateralFactorMantissa to compute LTV per position.
   *
   * HF = (totalCollateralUSD * weightedCF) / totalDebtUSD
   * Approximated as: (collateralUSD + liquidityUSD - shortfallUSD) / debtUSD
   * when debt > 0; +Infinity (returned as undefined HF) when debt = 0.
   */
  async getMetrics(position: NormalizedPosition): Promise<PositionMetrics> {
    if (!this.isActive) return {};
    const cTokenAddr = position.metadata?.cToken as string | undefined;
    if (!cTokenAddr) return {};

    // Cable 3: read HF against the comptroller that GOVERNS this position, not the
    // primary one. ISO positions (the E1 FXRP-supply/USDT0-borrow) live under a
    // DISTINCT comptroller recorded in metadata by scanComptroller. Reading the
    // primary would return getAccountLiquidity for a market this account isn't in,
    // yielding a wrong HF and mis-firing (or never firing) the stop-loss trigger.
    const comptrollerAddr =
      (position.metadata?.comptroller as string | undefined) ?? this.addresses.comptroller;
    if (!comptrollerAddr) return {};

    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const comptroller = new ethers.Contract(
      comptrollerAddr,
      COMPTROLLER_ABI,
      provider
    );

    try {
      const [, liquidity, shortfall] = await comptroller.getAccountLiquidity(
        position.wallet
      );
      const market = await comptroller.markets(cTokenAddr);
      const collateralFactor = Number(market[1]) / Number(MANTISSA);

      const debtUSD =
        position.kind === 'BORROW' ? position.amountUSD : 0;
      const collateralUSD =
        position.kind === 'SUPPLY' ? position.amountUSD : 0;

      // getAccountLiquidity returns the ACCOUNT-level margin in USD (1e18):
      //   liquidity − shortfall = Σ(collateral·CF) − Σdebt
      // A position is one leg (SUPPLY xor BORROW), so recovering HF and the
      // liquidation price needs that margin plus this leg's side. Exact for
      // single-collateral/single-borrow accounts (the ISO carry); with more
      // legs the missing Σ is approximated by this leg's, noted in extras.
      const liquidityUSD = Number(liquidity) / 1e18;
      const shortfallUSD = Number(shortfall) / 1e18;
      const marginUSD = liquidityUSD - shortfallUSD;

      let hf: number | undefined;
      let ltv: number | undefined;
      let liquidationPrice: number | undefined;

      if (debtUSD > 0) {
        // BORROW leg: Σ(collateral·CF) = margin + Σdebt; HF = Σ(collateral·CF)/Σdebt.
        const adjCollateralUSD = debtUSD + marginUSD;
        hf = adjCollateralUSD / debtUSD;
        // The collateral's amount/price live on its own SUPPLY leg — LTV and the
        // liquidation price are computed there, never guessed here.
      } else if (collateralUSD > 0) {
        // SUPPLY leg: Σdebt = Σ(collateral·CF) − margin, with Σ(collateral·CF)
        // taken as this leg's collateral·CF (its own market CF was just read).
        const adjCollateralUSD = collateralUSD * collateralFactor;
        const impliedDebtUSD = adjCollateralUSD - marginUSD;
        if (impliedDebtUSD > 1e-9) {
          hf = adjCollateralUSD / impliedDebtUSD;
          ltv = impliedDebtUSD / collateralUSD;
          // Liquidation when collateral·P_liq·CF = Σdebt → P_liq = P_now / HF.
          if (position.priceUSD > 0) {
            liquidationPrice = position.priceUSD / hf;
          }
        } else {
          ltv = 0;
        }
      }

      return {
        hf,
        ltv,
        liquidationPrice,
        extras: {
          collateralFactor,
          liquidityUSD,
          shortfallUSD,
        },
      };
    } catch (err) {
      return {
        extras: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * Encode one Kinetic action into unsigned {to, calldata, value} — the calldata
   * source for BOTH the manual "Entrar" button and moneyflow conditional intents
   * (e.g. "if HF FXRP < X → repay in this market"). Fully deterministic; refuses
   * (throws) rather than guess when the market/shape is unverified.
   */
  async encodeAction(params: EncodeActionParams): Promise<EncodedAction> {
    this.assertActive();
    const fn = ACTION_TO_FN[params.actionType];
    if (!fn) {
      throw new Error(`KINETIC_ACTION_UNSUPPORTED: "${params.actionType}" (supply|withdraw|borrow|repay)`);
    }
    const sym = (params.assetSymbol ?? '').toUpperCase();
    const envKey = KINETIC_KTOKEN_ENV[sym] ?? KINETIC_KTOKEN_ENV[sym.replace(/[^A-Z0-9]/g, '')];
    if (!envKey) {
      throw new Error(
        `KINETIC_MARKET_NOT_CONFIGURED: no verified kToken for asset "${params.assetSymbol ?? '∅'}" ` +
        `(supported: ${Object.keys(KINETIC_KTOKEN_ENV).join(', ')}). Native FLR / FXRP pending address verification.`,
      );
    }
    const kToken = process.env[envKey];
    if (!kToken || !/^0x[a-fA-F0-9]{40}$/.test(kToken)) {
      throw new Error(`KINETIC_MARKET_NOT_CONFIGURED: ${envKey} missing/invalid in env`);
    }
    let amount: bigint;
    try {
      amount = BigInt(params.amount);
    } catch {
      throw new Error(`KINETIC_BAD_AMOUNT: "${params.amount}" is not an integer (smallest units)`);
    }
    if (amount <= 0n) throw new Error('KINETIC_BAD_AMOUNT: amount must be > 0');

    const { ethers } = await import('ethers');
    const iface = new ethers.Interface(KTOKEN_ERC20_ABI);
    return {
      to: kToken,
      calldata: iface.encodeFunctionData(fn, [amount]),
      value: '0', // CErc20 markets are non-payable (native-FLR market handled separately when verified)
    };
  }

  /**
   * E1 batch — the atomic `Call[]` run inside the Smart Account `0xFE` userOp
   * after FXRP is direct-minted into the Personal Account:
   *   [ approve(FXRP → kFXRP_ISO, supplyUBA),
   *     kFXRP_ISO.mint(supplyUBA),
   *     ISO_comptroller.enterMarkets([kFXRP_ISO]),
   *     kUSDT0_ISO.borrow(borrowUsdt0) ]
   *
   * Targets the ISO market exclusively (kUSDT0 ISO ≠ primary kUSDT0 — different
   * contracts). Returns unsigned EncodedAction[] that feeds buildDirectMintHandoff
   * as `innerCalls`. `supplyUBA` MUST be the post-fee net FXRP (NetMintBreakdown.
   * supplyUBA from FlareDirectMintService) — supplying gross reverts on
   * insufficient FXRP. Throws (never guesses) when an ISO address is unconfigured.
   */
  async buildIsoSupplyBorrowBatch(params: {
    supplyUBA: bigint;
    borrowUsdt0: bigint;
  }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    const fxrpToken = getProtocolAddresses().fxrp.token;
    const missing: string[] = [];
    if (!iso.isoComptroller) missing.push('KINETIC_ISO_COMPTROLLER');
    if (!iso.isoKFxrp) missing.push('KINETIC_KFXRP_ISO');
    if (!iso.isoKUsdt0) missing.push('KINETIC_KUSDT0_ISO');
    if (!fxrpToken) missing.push('FXRP_TOKEN');
    if (missing.length) {
      throw new Error(`KINETIC_ISO_NOT_CONFIGURED: missing ${missing.join(', ')}`);
    }
    if (params.supplyUBA <= 0n) throw new Error('KINETIC_ISO_BAD_SUPPLY: must be > 0');
    if (params.borrowUsdt0 <= 0n) throw new Error('KINETIC_ISO_BAD_BORROW: must be > 0');

    const { ethers } = await import('ethers');
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    const comptroller = new ethers.Interface(COMPTROLLER_ENTER_ABI);

    return [
      {
        to: fxrpToken!, // approve the ISO kFXRP market to pull the supplied FXRP
        calldata: erc20.encodeFunctionData('approve', [iso.isoKFxrp!, params.supplyUBA]),
        value: '0',
      },
      {
        to: iso.isoKFxrp!, // supply FXRP as collateral
        calldata: kToken.encodeFunctionData('mint', [params.supplyUBA]),
        value: '0',
      },
      {
        to: iso.isoComptroller!, // mark kFXRP as collateral
        calldata: comptroller.encodeFunctionData('enterMarkets', [[iso.isoKFxrp!]]),
        value: '0',
      },
      {
        to: iso.isoKUsdt0!, // borrow USDT0 against the FXRP collateral
        calldata: kToken.encodeFunctionData('borrow', [params.borrowUsdt0]),
        value: '0',
      },
    ];
  }

  /**
   * Borrow-only batch — the LAST leg of the E1 carry, for completing a
   * half-open position (supply landed, borrow didn't — the sequential-signing
   * gap of). `enterMarket` adds the enterMarkets([kFXRP]) call when
   * the account is not yet a member (checked live by the route, never guessed).
   * Returns unsigned EncodedAction[]; Astryum signs nothing.
   */
  async buildIsoBorrowBatch(params: {
    borrowUsdt0: bigint;
    enterMarket: boolean;
  }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    const missing: string[] = [];
    if (!iso.isoComptroller) missing.push('KINETIC_ISO_COMPTROLLER');
    if (!iso.isoKFxrp) missing.push('KINETIC_KFXRP_ISO');
    if (!iso.isoKUsdt0) missing.push('KINETIC_KUSDT0_ISO');
    if (missing.length) {
      throw new Error(`KINETIC_ISO_NOT_CONFIGURED: missing ${missing.join(', ')}`);
    }
    if (params.borrowUsdt0 <= 0n) throw new Error('KINETIC_ISO_BAD_BORROW: must be > 0');

    const { ethers } = await import('ethers');
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    const comptroller = new ethers.Interface(COMPTROLLER_ENTER_ABI);
    return [
      ...(params.enterMarket
        ? [
            {
              to: iso.isoComptroller!, // mark kFXRP as collateral first
              calldata: comptroller.encodeFunctionData('enterMarkets', [[iso.isoKFxrp!]]),
              value: '0',
            },
          ]
        : []),
      {
        to: iso.isoKUsdt0!, // borrow USDT0 against the FXRP collateral
        calldata: kToken.encodeFunctionData('borrow', [params.borrowUsdt0]),
        value: '0',
      },
    ];
  }

  /**
   * Lend-only (E3) batch — supply FXRP as a plain deposit, NO borrow. The two
   * atomic calls run inside the same `0xFE` userOp as E1:
   *   [ approve(FXRP → kFXRP_ISO, supplyUBA),
   *     kFXRP_ISO.mint(supplyUBA) ]
   *
   * This is the first two legs of buildIsoSupplyBorrowBatch with the borrow — and
   * the `enterMarkets` that only matters for borrowing — dropped: zero debt, zero
   * liquidation. `enterMarkets` is intentionally OMITTED: a plain supply earns the
   * kToken supply rate without marking the asset as collateral. `supplyUBA` MUST be
   * the post-fee net FXRP (NetMintBreakdown.supplyUBA from FlareDirectMintService).
   * Returns unsigned EncodedAction[]; Astryum signs nothing. Throws (never guesses)
   * when an ISO address / token is unconfigured.
   */
  async buildIsoSupplyFxrpBatch(params: { supplyUBA: bigint }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    const fxrpToken = getProtocolAddresses().fxrp.token;
    const missing: string[] = [];
    if (!iso.isoKFxrp) missing.push('KINETIC_KFXRP_ISO');
    if (!fxrpToken) missing.push('FXRP_TOKEN');
    if (missing.length) {
      throw new Error(`KINETIC_ISO_NOT_CONFIGURED: missing ${missing.join(', ')}`);
    }
    if (params.supplyUBA <= 0n) throw new Error('KINETIC_ISO_BAD_SUPPLY: must be > 0');

    const { ethers } = await import('ethers');
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    return [
      {
        to: fxrpToken!, // approve the ISO kFXRP market to pull the supplied FXRP
        calldata: erc20.encodeFunctionData('approve', [iso.isoKFxrp!, params.supplyUBA]),
        value: '0',
      },
      {
        to: iso.isoKFxrp!, // supply FXRP as a plain deposit — earns the supply rate, no debt
        calldata: kToken.encodeFunctionData('mint', [params.supplyUBA]),
        value: '0',
      },
    ];
  }

  /**
   * A1 / protection batch — the atomic `Call[]` that repays USDT0 debt on the ISO
   * market to restore the health factor (the sibling of buildIsoSupplyBorrowBatch):
   *   [ approve(USDT0 → kUSDT0_ISO, repayUsdt0),
   *     kUSDT0_ISO.repayBorrowBehalf(borrower, repayUsdt0) ]
   *
   * `repayBorrowBehalf(address,uint256)` (selector 0x2608f818, verified in the
   * kUSDT0_ISO bytecode) lets the signer repay on behalf of `borrower` — the
   * Personal Account that holds the E1 borrow. The USDT0 pull is approved to the
   * kToken market, never guessed: `usdt0Token` MUST be the ISO market's underlying
   * as resolved on-chain via kUSDT0_ISO.underlying() (invariant #3 — the receipt
   * kToken is not the underlying). Returns unsigned EncodedAction[]; Astryum signs
   * nothing. Throws (never guesses) when an ISO address / token is unconfigured.
   */
  async buildIsoRepayBehalfBatch(params: {
    borrower: string;
    /** Importe del repay. `MaxUint256` = "toda la deuda VIVA al ejecutar" — el
     *  contrato lo resuelve él mismo (`repayAmount == uint(-1) → accountBorrows`,
     *  fuente verificada de CErc20Delegate 0xF114…A333). Es el arma
     *  definitiva contra el blanco móvil del interés: el swap-fill compra
     *  hueco+colchón y el pull toma la deuda exacta del bloque de la firma. */
    repayUsdt0: bigint;
    usdt0Token: string;
    /** Approve FINITO cuando repayUsdt0 = MaxUint256 (jamás un approve infinito):
     *  debe cubrir deuda-de-ahora + colchón de devengo. Default: repayUsdt0. */
    approveUsdt0?: bigint;
  }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    if (!iso.isoKUsdt0) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_KUSDT0_ISO');
    }
    if (!ADDRESS_RE.test(params.borrower)) {
      throw new Error(`KINETIC_ISO_BAD_BORROWER: "${params.borrower}" is not an address`);
    }
    if (!ADDRESS_RE.test(params.usdt0Token)) {
      throw new Error(`KINETIC_ISO_BAD_USDT0_TOKEN: "${params.usdt0Token}" is not an address`);
    }
    if (params.repayUsdt0 <= 0n) throw new Error('KINETIC_ISO_BAD_REPAY: must be > 0');
    const approveAmount = params.approveUsdt0 ?? params.repayUsdt0;
    if (approveAmount <= 0n) throw new Error('KINETIC_ISO_BAD_APPROVE: must be > 0');

    const { ethers } = await import('ethers');
    if (params.repayUsdt0 === ethers.MaxUint256 && params.approveUsdt0 == null) {
      // Un repay-todo sin approve finito sería un approve infinito silencioso.
      throw new Error('KINETIC_ISO_MAX_REPAY_NEEDS_FINITE_APPROVE: pass approveUsdt0');
    }
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    const kToken = new ethers.Interface(KTOKEN_REPAY_BEHALF_ABI);

    return [
      {
        to: params.usdt0Token, // approve the ISO kUSDT0 market to pull the repay
        calldata: erc20.encodeFunctionData('approve', [iso.isoKUsdt0!, approveAmount]),
        value: '0',
      },
      {
        to: iso.isoKUsdt0!, // repay the borrower's (PA's) USDT0 debt → lifts HF
        calldata: kToken.encodeFunctionData('repayBorrowBehalf', [
          ethers.getAddress(params.borrower),
          params.repayUsdt0,
        ]),
        value: '0',
      },
    ];
  }

  /** Cached ISO USDT0 underlying — resolved on-chain via kUSDT0_ISO.underlying()
   *  (invariant #3: the receipt kToken is never confused with the underlying). */
  private isoUsdt0Underlying: string | null = null;

  private async resolveIsoUsdt0Underlying(): Promise<string> {
    if (this.isoUsdt0Underlying) return this.isoUsdt0Underlying;
    const iso = this.addresses;
    if (!iso.isoKUsdt0) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_KUSDT0_ISO');
    }
    const { ethers } = await import('ethers');
    const kToken = new ethers.Contract(iso.isoKUsdt0, CTOKEN_ABI, this.provider.getHttpProvider());
    const underlying: string = await kToken.underlying();
    if (!ADDRESS_RE.test(underlying)) throw new Error('ISO_USDT0_UNDERLYING_UNRESOLVED');
    this.isoUsdt0Underlying = ethers.getAddress(underlying);
    return this.isoUsdt0Underlying;
  }

  /**
   * Live ISO account state of `wallet` for the repay math: FXRP supplied,
   * USDT0 owed, collateral factor of kFXRP ISO, and live FTSO XRP/USD — the
   * SAME inputs /a1/prepare reads, so restore repays are identical either way.
   */
  private async readIsoRepayState(wallet: string): Promise<{
    supplyUBA: bigint;
    debtUsdt0Base: bigint;
    collateralFactor: number;
    fxrpPriceUSD: number;
  }> {
    const iso = this.addresses;
    if (!iso.isoComptroller || !iso.isoKFxrp || !iso.isoKUsdt0) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing ISO comptroller/kFXRP/kUSDT0');
    }
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const kFxrp = new ethers.Contract(iso.isoKFxrp, CTOKEN_ABI, provider);
    const kUsdt0 = new ethers.Contract(iso.isoKUsdt0, CTOKEN_ABI, provider);
    const comptroller = new ethers.Contract(iso.isoComptroller, COMPTROLLER_ABI, provider);
    const [supplyUBA, debtUsdt0Base, market] = await Promise.all([
      kFxrp.balanceOfUnderlying.staticCall(wallet),
      kUsdt0.borrowBalanceCurrent.staticCall(wallet),
      comptroller.markets(iso.isoKFxrp),
    ]);
    const collateralFactor = Number(market[1]) / Number(MANTISSA);
    const { createFTSOPriceProvider } = await import('../../../engines/normalisation/NormalisationEngine');
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) throw new Error('FTSO_PRICE_UNAVAILABLE');
    return { supplyUBA: BigInt(supplyUBA), debtUsdt0Base: BigInt(debtUsdt0Base), collateralFactor, fxrpPriceUSD };
  }

  /**
   * Intent assembly WITH calldata. The default BaseAdapter intent is
   * simulation-only (no txData); PROTECT's automated repay needs a signable
   * payload, so `repay` fills it here with the SAME batch A1 uses:
   *   [ approve(USDT0 → kUSDT0_ISO), repayBorrowBehalf(borrower, amount) ]
   * `borrower` = the wallet holding the borrow (the Personal Account for E1);
   * ANY payer may sign — repayBorrowBehalf clears the borrower's debt and lifts
   * its HF. The approve travels as preState.prerequisiteCalls so the signing
   * surface batches [approve, repay] into one user review.
   */
  override async buildTransactionIntent(
    action: ProtocolAction,
    ctx: IntentBuildContext,
  ): Promise<TransactionIntent> {
    const baseIntent = await super.buildTransactionIntent(action, ctx);
    if (action.kind !== 'repay') return baseIntent;

    // Without the ISO market env there is no calldata to build — degrade to the
    // simulation-only intent WITH an explicit warning (never silently, so a
    // misconfigured prod cannot look healthy). E1 requires the same env, so any
    // environment that opened the position can also repay it.
    if (!this.addresses.isoKUsdt0) {
      return {
        ...baseIntent,
        warnings: [
          ...baseIntent.warnings,
          'ISO market not configured — repay calldata unavailable (set KINETIC_KUSDT0_ISO)',
        ],
      };
    }

    const mode = String(action.inputs?.mode ?? 'fixed');
    let amount: bigint;
    const extraWarnings: string[] = [];
    if (mode === 'restore' || mode === 'full' || mode === 'pct') {
      const state = await this.readIsoRepayState(action.wallet);
      if (mode === 'full') {
        amount = state.debtUsdt0Base;
      } else if (mode === 'pct') {
        // Escalonado: porcentaje de la DEUDA VIVA en el
        // momento del disparo — nunca un importe congelado al crear la regla.
        // Determinista sobre el parámetro firmado (#8), honesto sobre el
        // estado actual: la misma filosofía que 'restore'.
        const pct = Number(action.inputs?.pct ?? 0);
        if (!(pct > 0 && pct <= 100)) {
          return {
            ...baseIntent,
            warnings: [...baseIntent.warnings, `ladder repay: invalid pct "${action.inputs?.pct}" (must be 0<pct≤100) — no calldata built`],
          };
        }
        amount = (state.debtUsdt0Base * BigInt(Math.round(pct * 100))) / 10_000n;
        extraWarnings.push(
          `ladder repay: ${pct}% of the LIVE debt (${Number(state.debtUsdt0Base) / 1e6} USDT0) = ${Number(amount) / 1e6} USDT0`,
        );
      } else {
        const targetHF = Number(action.inputs?.targetHF ?? 1.1);
        const restore = computeRepayToRestoreHF({
          supplyUBA: state.supplyUBA,
          debtUsdt0Base: state.debtUsdt0Base,
          fxrpPriceUSD: state.fxrpPriceUSD,
          collateralFactor: state.collateralFactor,
          targetHF,
        });
        if (!restore.needed) {
          // Price recovered between the trigger tick and this prepare — the
          // honest intent is "nothing to repay", never a stale payload.
          return {
            ...baseIntent,
            warnings: [
              ...baseIntent.warnings,
              `HF ${restore.currentHF.toFixed(3)} already at/above target ${targetHF} — nothing to repay`,
            ],
          };
        }
        amount = restore.repayUsdt0Base;
        extraWarnings.push(
          `restore repay: ${restore.repayUsdt0Human} USDT0 lifts HF from ${restore.currentHF.toFixed(3)} to ${targetHF} at the current FTSO price — not a promise; a falling price lowers the resulting HF`,
        );
      }
      if (amount <= 0n) {
        return {
          ...baseIntent,
          warnings: [...baseIntent.warnings, 'No outstanding USDT0 debt — nothing to repay'],
        };
      }
    } else {
      amount = BigInt(String(action.inputs?.amount ?? '0'));
    }

    const usdt0Token = await this.resolveIsoUsdt0Underlying();
    const [approve, repay] = await this.buildIsoRepayBehalfBatch({
      borrower: action.wallet,
      repayUsdt0: amount,
      usdt0Token,
    });

    return {
      ...baseIntent,
      warnings: [...baseIntent.warnings, ...extraWarnings],
      preState: {
        ...baseIntent.preState,
        prerequisiteCalls: [
          {
            to: approve.to,
            data: approve.calldata,
            value: '0',
            chainId: this.chainId,
            label: 'approve USDT0 → kUSDT0_ISO',
          },
        ],
      },
      txData: {
        to: repay.to,
        data: repay.calldata,
        value: 0n,
        gasLimit: baseIntent.simulation.gasEstimate,
        chainId: this.chainId,
      },
    };
  }

  /**
   * Re-supply borrowed USDT0 into the ISO market (opening step 2 — the carry).
   * Kept a SEPARATE PA action from the E1 open batch (user decision:
   * do not touch the tested `buildIsoSupplyBorrowBatch`). Runs as its own `0xFE`
   * userOp Call[]:  [ approve(USDT0 → kUSDT0_ISO), kUSDT0_ISO.mint(amount) ].
   * `usdt0Token` resolved on-chain via kUSDT0_ISO.underlying() (invariant #3).
   * Unsigned; Astryum signs nothing. Throws (never guesses) when unconfigured.
   */
  async buildIsoSupplyUsdt0Batch(params: {
    amountUsdt0: bigint;
    usdt0Token: string;
  }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    if (!iso.isoKUsdt0) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_KUSDT0_ISO');
    }
    if (!ADDRESS_RE.test(params.usdt0Token)) {
      throw new Error(`KINETIC_ISO_BAD_USDT0_TOKEN: "${params.usdt0Token}" is not an address`);
    }
    if (params.amountUsdt0 <= 0n) throw new Error('KINETIC_ISO_BAD_SUPPLY: must be > 0');

    const { ethers } = await import('ethers');
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    return [
      {
        to: params.usdt0Token, // approve the ISO kUSDT0 market to pull the supply
        calldata: erc20.encodeFunctionData('approve', [iso.isoKUsdt0!, params.amountUsdt0]),
        value: '0',
      },
      {
        to: iso.isoKUsdt0!, // supply USDT0 → earns the ISO supply APY (the carry leg)
        calldata: kToken.encodeFunctionData('mint', [params.amountUsdt0]),
        value: '0',
      },
    ];
  }

  /**
   * Withdraw supplied USDT0 from the ISO market — protection step 3 / DERISK step 1.
   * One Call[]: [ kUSDT0_ISO.redeemUnderlying(amount) ]. Runs in a PA `0xFE` userOp.
   * Unsigned; Astryum signs nothing. Throws (never guesses) when unconfigured.
   */
  async buildIsoWithdrawUsdt0(params: { amountUsdt0: bigint }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    if (!iso.isoKUsdt0) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_KUSDT0_ISO');
    }
    if (params.amountUsdt0 <= 0n) throw new Error('KINETIC_ISO_BAD_WITHDRAW: must be > 0');

    const { ethers } = await import('ethers');
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    return [
      {
        to: iso.isoKUsdt0!,
        calldata: kToken.encodeFunctionData('redeemUnderlying', [params.amountUsdt0]),
        value: '0',
      },
    ];
  }

  /**
   * PA-native repay — the walletless protection leg (pieza 1, founder):
   * everything happens INSIDE the Personal Account as one 0xFE
   * userOp the user signs in Xaman, executor-paid gas, no EVM wallet needed.
   *
   *   withdrawUsdt0 > 0 → [ redeemUnderlying(withdraw), approve, repayBorrowBehalf ]
   *   withdrawUsdt0 = 0 → [ approve, repayBorrowBehalf ]
   *
   * The redeem-then-repay order is the DERISK-validated sequence: supplied
   * USDT0 withdraws freely with debt outstanding (only the FXRP collateral is
   * blocked until the debt clears). Pure composition of the two tested
   * builders — no new encoding. Unsigned; Astryum signs nothing.
   */
  async buildIsoPaRepayBatch(params: {
    borrower: string;
    repayUsdt0: bigint;
    /** USDT0 to pull from the ISO supply first (0n = the PA's free balance covers it). */
    withdrawUsdt0: bigint;
    usdt0Token: string;
  }): Promise<EncodedAction[]> {
    if (params.withdrawUsdt0 < 0n) throw new Error('KINETIC_ISO_BAD_WITHDRAW: must be >= 0');
    const repay = await this.buildIsoRepayBehalfBatch({
      borrower: params.borrower,
      repayUsdt0: params.repayUsdt0,
      usdt0Token: params.usdt0Token,
    });
    if (params.withdrawUsdt0 === 0n) return repay;
    const withdraw = await this.buildIsoWithdrawUsdt0({ amountUsdt0: params.withdrawUsdt0 });
    return [...withdraw, ...repay];
  }

  /**
   * Withdraw FXRP collateral from the ISO market — DERISK step 3. ONLY valid after
   * the whole USDT0 debt is repaid (Compound blocks a collateral redeem that would
   * leave the account under-collateralised — the redeem reverts otherwise). One
   * Call[]: [ kFXRP_ISO.redeemUnderlying(amount) ]. Runs in a PA `0xFE` userOp.
   * Unsigned; Astryum signs nothing. Throws (never guesses) when unconfigured.
   */
  async buildIsoWithdrawFxrp(params: { amountFxrp: bigint }): Promise<EncodedAction[]> {
    const iso = this.addresses;
    if (!iso.isoKFxrp) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_KFXRP_ISO');
    }
    if (params.amountFxrp <= 0n) throw new Error('KINETIC_ISO_BAD_WITHDRAW: must be > 0');

    const { ethers } = await import('ethers');
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    return [
      {
        to: iso.isoKFxrp!,
        calldata: kToken.encodeFunctionData('redeemUnderlying', [params.amountFxrp]),
        value: '0',
      },
    ];
  }

  /**
   * A LIVE position read that either ANSWERED or DID NOT — never a zero
   * invented to stand in for silence (hermano de `readOrUnread`).
   *
   * WHAT THIS EXISTS TO STOP. `balanceOf`, `balanceOfUnderlying` and
   * `borrowBalanceCurrent` were read with `.catch(() => 0n)`, and a public-RPC
   * 429 — the bread of these days — therefore arrived downstream as «this
   * account holds nothing». `readIsoLegs` then turned that zero into `null`,
   * the route served it with HTTP 200, and two screens said it out loud: the
   * guided unwind announced «No FXRP collateral left — the unwind is complete»
   * over a carry with live debt, and `/iso-withdraw/prepare` answered an exit
   * with «This wallet has no FXRP supplied». A read that failed is not a fact
   * about anybody's money (invariant #9).
   */
  private async isoRead(what: string, read: () => Promise<bigint>): Promise<bigint> {
    try {
      return BigInt(await read());
    } catch (e) {
      throw new IsoReadUnavailableError(what, e);
    }
  }

  /** The configured ISO kToken market for an asset, or throws (never guesses). */
  private isoMarketFor(asset: 'usdt0' | 'fxrp'): string {
    const iso = this.addresses;
    const market = asset === 'usdt0' ? iso.isoKUsdt0 : iso.isoKFxrp;
    if (!market) {
      throw new Error(`KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_${asset === 'usdt0' ? 'KUSDT0' : 'KFXRP'}_ISO`);
    }
    return market;
  }

  /**
   * Live ISO supply snapshot of `holder` for one asset: kToken shares held and
   * their current underlying value (balanceOfUnderlying accrues interest on
   * read). Read-only — this is what the withdraw modal shows as "in the vault".
   * `provider` lets route callers reuse their own JsonRpcProvider (the
   * FlareProvider singleton needs initialize() and is absent in route tests).
   */
  async readIsoSupplySnapshot(
    asset: 'usdt0' | 'fxrp',
    holder: string,
    provider?: import('ethers').Provider,
  ): Promise<{ kToken: string; sharesBase: bigint; underlyingBase: bigint }> {
    const market = this.isoMarketFor(asset);
    const { ethers } = await import('ethers');
    const kToken = new ethers.Contract(market, CTOKEN_ABI, provider ?? this.provider.getHttpProvider());
    // THROWS (IsoReadUnavailableError) when the chain does not answer.
    // The old `.catch(() => 0n)` made silence indistinguishable from an empty
    // position, and every caller then asserted the emptiness to the person.
    const [sharesBase, underlyingBase] = await Promise.all([
      this.isoRead(`${asset} kToken balanceOf`, () => kToken.balanceOf(holder) as Promise<bigint>),
      this.isoRead(
        `${asset} balanceOfUnderlying`,
        () => kToken.balanceOfUnderlying.staticCall(holder) as Promise<bigint>,
      ),
    ]);
    return { kToken: market, sharesBase, underlyingBase };
  }

  /**
   * ALL the live ISO legs of one account in base units — what the withdraw
   * modal shows and validates against. Reads the chain NOW (never a cached
   * snapshot: a stale snapshot without these fields made real supplies look
   * unwithdrawable). Read-only.
   */
  async readIsoLegs(
    owner: string,
    provider?: import('ethers').Provider,
  ): Promise<{ supplyFxrpBase: string | null; suppliedUsdt0Base: string | null; debtUsdt0Base: string | null }> {
    const iso = this.addresses;
    if (!iso.isoKFxrp || !iso.isoKUsdt0) {
      throw new Error('KINETIC_ISO_NOT_CONFIGURED: missing KINETIC_KFXRP_ISO / KINETIC_KUSDT0_ISO');
    }
    const { ethers } = await import('ethers');
    const p = provider ?? this.provider.getHttpProvider();
    const kUsdt0 = new ethers.Contract(iso.isoKUsdt0, CTOKEN_ABI, p);
    const [fxrp, usdt0, debt] = await Promise.all([
      this.readIsoSupplySnapshot('fxrp', owner, p),
      this.readIsoSupplySnapshot('usdt0', owner, p),
      // A debt we could not read is NEVER a debt of zero: that zero is
      // what let step 3 of the guided unwind call a carry «complete».
      this.isoRead('USDT0 borrowBalanceCurrent', () => kUsdt0.borrowBalanceCurrent.staticCall(owner) as Promise<bigint>),
    ]);
    const asBase = (v: bigint) => (v > 0n ? v.toString() : null);
    return {
      supplyFxrpBase: asBase(fxrp.underlyingBase),
      suppliedUsdt0Base: asBase(usdt0.underlyingBase),
      debtUsdt0Base: asBase(BigInt(debt)),
    };
  }

  /**
   * EXACT full exit from an ISO supply: redeem by kToken SHARES, not by
   * underlying amount. balanceOfUnderlying grows every second, so a MAX
   * built as redeemUnderlying(snapshot) always strands accruing dust; the
   * share balance is static until the user acts, so redeem(shares) empties
   * the position to zero, interest included. One Call[]:
   * [ kToken.redeem(sharesBase) ]. Unsigned; Astryum signs nothing.
   */
  async buildIsoRedeemSharesBatch(params: {
    asset: 'usdt0' | 'fxrp';
    sharesBase: bigint;
  }): Promise<EncodedAction[]> {
    const market = this.isoMarketFor(params.asset);
    if (params.sharesBase <= 0n) throw new Error('KINETIC_ISO_BAD_REDEEM: shares must be > 0');

    const { ethers } = await import('ethers');
    const kToken = new ethers.Interface(KTOKEN_ERC20_ABI);
    return [
      {
        to: market,
        calldata: kToken.encodeFunctionData('redeem', [params.sharesBase]),
        value: '0',
      },
    ];
  }

  /**
   * Deterministic simulation. Recomputes HF/LTV after applying the action
   * delta to the user's collateral / debt totals reported by getAccountLiquidity.
   *
   * Assumptions (returned in `warnings`):
   * - Single-position simulation (does not re-aggregate full portfolio)
   * - Uses caller-provided amount as the only delta
   * - Gas estimate is fixed-buffer; refined when adapter knows the cToken function
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    this.assertActive();
    const now = new Date();
    const warnings: string[] = [
      'Single-position simulation; portfolio-level effects computed by SimulationEngine',
    ];

    const cTokenAddr = action.inputs?.cToken as string | undefined;
    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;
    const priceUSD = Number(action.inputs?.priceUSD ?? 0);
    const decimals = Number(action.inputs?.decimals ?? 18);
    const humanAmount = Number(amount) / 10 ** decimals;
    const amountUSD = priceUSD * humanAmount;

    let collateralUSDBefore = Number(action.inputs?.collateralUSD ?? 0);
    let debtUSDBefore = Number(action.inputs?.debtUSD ?? 0);
    let collateralFactor = Number(action.inputs?.collateralFactor ?? 0.7);

    // Try live read for ground-truth collateral/debt USD when context is missing.
    // ISO cTokens are listed on the ISO comptroller, not the primary one — honour
    // a caller-provided comptroller (position.metadata.comptroller) when present.
    if (cTokenAddr && (!action.inputs?.collateralUSD || !action.inputs?.debtUSD)) {
      try {
        // Cable 3: same routing as getMetrics — simulate against the comptroller
        // that owns this position (ISO markets carry their own collateral factors),
        // falling back to the primary only when the caller didn't pass one.
        const comptrollerAddr =
          (action.inputs?.comptroller as string | undefined) ?? this.addresses.comptroller;
        if (!comptrollerAddr) throw new Error('no comptroller configured');
        const { ethers } = await import('ethers');
        const provider = this.provider.getHttpProvider();
        const comptroller = new ethers.Contract(
          comptrollerAddr,
          COMPTROLLER_ABI,
          provider
        );
        const market = await comptroller.markets(cTokenAddr);
        if (market?.[1]) {
          collateralFactor = Number(market[1]) / Number(MANTISSA);
        }
      } catch {
        warnings.push('comptroller read failed, using caller-provided values');
      }
    }

    let collateralUSDAfter = collateralUSDBefore;
    let debtUSDAfter = debtUSDBefore;
    let netUSDImpact = 0;

    switch (action.kind) {
      case 'supply':
      case 'addCollateral':
        collateralUSDAfter += amountUSD;
        netUSDImpact = -amountUSD;
        break;
      case 'withdraw':
        collateralUSDAfter = Math.max(0, collateralUSDBefore - amountUSD);
        netUSDImpact = amountUSD;
        break;
      case 'borrow':
        debtUSDAfter += amountUSD;
        netUSDImpact = amountUSD;
        break;
      case 'repay':
        debtUSDAfter = Math.max(0, debtUSDBefore - amountUSD);
        netUSDImpact = -amountUSD;
        break;
      default:
        warnings.push(`Action ${action.kind} not natively modeled by Kinetic adapter`);
    }

    const hfBefore =
      debtUSDBefore > 0
        ? (collateralUSDBefore * collateralFactor) / debtUSDBefore
        : undefined;
    const hfAfter =
      debtUSDAfter > 0
        ? (collateralUSDAfter * collateralFactor) / debtUSDAfter
        : undefined;
    const ltvBefore =
      collateralUSDBefore > 0 ? debtUSDBefore / collateralUSDBefore : 0;
    const ltvAfter =
      collateralUSDAfter > 0 ? debtUSDAfter / collateralUSDAfter : 0;

    // Gas estimate buffer for Compound-fork ops
    const gasEstimate = 250_000n;
    const gasPriceGwei = 25;
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);
    const gasEstimateUSD =
      (Number(gasEstimate) * gasPriceGwei * 1e-9) * flrPriceUSD;

    const riskDelta =
      hfBefore !== undefined && hfAfter !== undefined
        ? (hfBefore - hfAfter) * 100 // negative = improves HF (positive risk reduction)
        : 0;

    if (hfAfter !== undefined && hfAfter < 1.2) {
      warnings.push(`Action results in HF ${hfAfter.toFixed(2)} (< 1.2 critical)`);
    }

    return {
      success: true,
      newHF: hfAfter,
      newLTV: ltvAfter,
      gasEstimate,
      gasEstimateUSD,
      netUSDImpact,
      riskDelta,
      warnings,
      simulatedAt: now,
      priceTimestamp: now,
      isStale: false,
    };
  }
}
