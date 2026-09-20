/**
 * Wallet transfer routes — native-asset transfers between the user's own
 * wallets or to an external address, prepared from the Wallets page.
 */
import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { jurisdictionService } from '../services/JurisdictionService';
import {
  readDirectMintParams,
  computeNetMint,
  resolveAssetManagerFxrp,
  resolveFxrpToken,
  readRedemptionFeeBips,
  estimateRedemptionFee,
  redemptionFeeDisclosureLine,
} from '../connectors/protocols/flare/FlareDirectMintService';
import { withSourceTag } from '../config/xrplSourceTag';
import { preflightEvmCalls, type EvmPreflightCall, type PreflightResult } from '../services/flare/preparePreflight';

const router = Router();

const FLARE_CHAIN_ID = 14;
const DROPS = 1_000_000; // 1 XRP = 1e6 drops; FXRP UBA == drops

// Direct-minting 32-byte PaymentReference: [8-byte prefix][4 zero bytes][20-byte recipient]
const DIRECT_MINTING_PREFIX = '4642505266410018';

// IAssetManager (FXRP) — redemption surface only. Address resolved live via the
// FlareContractsRegistry (never hardcoded, invariant #9).
const ASSET_MANAGER_REDEEM_ABI = [
  'function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor) returns (uint256)',
  // Con tag el agente paga al destino CON el número de cuenta dentro — la vía
  // para salir hacia un exchange (verificado on-chain: redeemWithTagSupported()
  // es true en el FXRP de mainnet).
  'function redeemWithTag(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor, uint256 _destinationTag) returns (uint256)',
  'function minimumRedeemAmountUBA() view returns (uint256)',
];
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function flareProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    { name: 'flare', chainId: FLARE_CHAIN_ID },
    { staticNetwork: true },
  );
}

/** Same hard frontier as the Earn demo: feature flag (#8) + geofence (#5). */
function gateFlareBridge(region: string | null): { status: number; error: string } | null {
  if (process.env.FLARE_DEFI_ENABLED !== 'true') {
    return { status: 503, error: 'FLARE_DEFI_DISABLED' };
  }
  const geo = jurisdictionService.isDefiExecutionAllowed(region);
  if (!geo.allowed) {
    return { status: 451, error: `GEOFENCE_BLOCKED: ${geo.reason ?? 'region not allowed'}` };
  }
  return null;
}

/**
 * THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA»).
 *
 * FXRP → XRP (redeemAmount) burns the signer's OWN FXRP and brings the value back
 * to XRPL — the way home the DERISK flow (PaActionsModal) and WalletTransferModals
 * send people down. The geofence (#5) exists to stop OPENING DeFi exposure from a
 * blocked region, never to hold capital already there: under it a holder could
 * enter FXRP and then be refused the way out. So this direction is flag-only (#10);
 * the flag stays. The mint direction
 * (xrpl-to-flare) is an entry and keeps `gateFlareBridge(region)`.
 */
function gateFlareBridgeExit(): { status: number; error: string } | null {
  if (process.env.FLARE_DEFI_ENABLED !== 'true') {
    return { status: 503, error: 'FLARE_DEFI_DISABLED' };
  }
  return null;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// XRPL classic address (base58, no 0/O/I/l). Rejects EVM/garbage before any RPC call.
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** EIP-55-normalised address or null (never throws — bad checksum → null → 400). */
function safeGetAddress(addr: unknown): string | null {
  if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) return null;
  try {
    return ethers.getAddress(addr);
  } catch {
    return null;
  }
}

/** Decimal amount (string|number) → base units, or null on any bad input. */
function parseAmount(amount: unknown, decimals: number): bigint | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const s = String(amount).trim();
  // parseUnits accepts plain decimals only — pre-reject exponents/Infinity/NaN.
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  try {
    const v = ethers.parseUnits(s, decimals);
    return v > 0n ? v : null;
  } catch {
    return null; // too many decimals for the asset, overflow, etc.
  }
}

/* ── La nota del usuario: DestinationTag y Memo (XRPL) ──────────────────────
 *
 * Dos cosas DISTINTAS que el rail XRPL sabe llevar, las dos OPCIONALES y las
 * dos palabras del usuario — se validan, jamás se inventan, y viajan a la
 * pantalla de revisión antes de la firma (#6):
 */
const MEMO_MAX_BYTES = 128;
const XRPL_MAX_DESTINATION_TAG = 4_294_967_295; // uint32
const MEMO_FORMAT_TEXT_HEX = Buffer.from('text/plain', 'utf8').toString('hex').toUpperCase();

type ReadResult<T> = { ok: true; value?: T } | { ok: false; detail: string };

/** Guardián explícito: este tsconfig no estrecha la unión por `!r.ok`. */
function noteReadFailed<T>(r: ReadResult<T>): r is { ok: false; detail: string } {
  return r.ok === false;
}

/** Vacío (ausente, null o '') = el usuario no puso nota; no es un error. */
function isBlankNote(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

function readDestinationTag(raw: unknown): ReadResult<number> {
  if (isBlankNote(raw)) return { ok: true };
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+$/.test(s)) {
    return { ok: false, detail: 'destinationTag must be a whole number with no sign, decimals or spaces.' };
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > XRPL_MAX_DESTINATION_TAG) {
    return { ok: false, detail: `destinationTag must be between 0 and ${XRPL_MAX_DESTINATION_TAG}.` };
  }
  return { ok: true, value: n };
}

function readMemo(raw: unknown): ReadResult<string> {
  if (isBlankNote(raw)) return { ok: true };
  if (typeof raw !== 'string') return { ok: false, detail: 'memo must be text.' };
  const text = raw.trim();
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MEMO_MAX_BYTES) {
    return { ok: false, detail: `memo is ${bytes} bytes; the maximum is ${MEMO_MAX_BYTES}.` };
  }
  return { ok: true, value: text };
}

/**
 * POST /api/wallet-transfer/prepare
 * Body: { rail: 'evm'|'xrpl', from, to, amount, asset?, destinationTag?, memo? }
 *   destinationTag (uint32) and memo (≤128 bytes of text) ride the xrpl rail
 *   only, both optional; on the evm rail either one is a 400.
 *   amount is in human units (FLR, FXRP or XRP). asset applies to rail 'evm'
 *   only: 'FLR' (default, native) or 'FXRP' (ERC-20 transfer on Flare — an
 *   FXRP→XRP move is NOT this route, it rides bridge/flare-to-xrpl). Returns
 *   the unsigned payload the user's own wallet signs, plus the disclosure
 *   shown before signing.
 */
router.post('/prepare', async (req: Request, res: Response) => {
  try {
    const { rail, from, to, amount, asset, destinationTag, memo } = (req.body ?? {}) as {
      rail?: string;
      from?: string;
      to?: string;
      amount?: string | number;
      asset?: string;
      destinationTag?: string | number;
      memo?: string;
    };

    if (rail !== 'evm' && rail !== 'xrpl') {
      return res.status(400).json({ error: 'INVALID_RAIL', detail: "rail must be 'evm' | 'xrpl'" });
    }

    if (rail === 'evm') {
      // Se rechaza, no se ignora: una nota escrita que no viaja es peor que
      // no poder escribirla.
      if (!isBlankNote(destinationTag) || !isBlankNote(memo)) {
        return res.status(400).json({
          error: 'NOTE_NOT_SUPPORTED_ON_EVM',
          detail:
            'A destination tag and a memo are XRPL fields. A native Flare transfer carries no note — send the reference to the recipient another way.',
        });
      }
      const evmAsset = asset === undefined || asset === 'FLR' ? 'FLR' : asset === 'FXRP' ? 'FXRP' : null;
      if (!evmAsset) {
        return res.status(400).json({ error: 'INVALID_ASSET', detail: "asset must be 'FLR' | 'FXRP' on the evm rail" });
      }
      const fromAddr = safeGetAddress(from);
      if (!fromAddr) return res.status(400).json({ error: 'INVALID_FROM_ADDRESS' });
      // A destination that parses as an XRPL address is a bridging attempt, not a typo.
      if (typeof to === 'string' && XRPL_CLASSIC_RE.test(to.trim())) {
        return res.status(400).json({
          error: 'CROSS_ECOSYSTEM_NOT_SUPPORTED',
          detail:
            evmAsset === 'FXRP'
              ? 'An FXRP→XRPL move is a FAssets redemption, not a token transfer — use bridge/flare-to-xrpl/prepare.'
              : 'FLR cannot be sent to an XRPL address. Cross-ecosystem moves use a bridge flow, not a payment.',
        });
      }
      const toAddr = safeGetAddress(to);
      if (!toAddr) return res.status(400).json({ error: 'INVALID_TO_ADDRESS' });
      if (fromAddr === toAddr) return res.status(400).json({ error: 'SAME_ADDRESS' });

      if (evmAsset === 'FXRP') {
        // FXRP has 6 decimals (UBA == XRP drops). Validation above runs before
        // this single RPC-backed resolution, so bad input never touches the chain.
        const uba = parseAmount(amount, 6);
        if (uba == null) return res.status(400).json({ error: 'INVALID_AMOUNT' });
        const fxrpToken = await resolveFxrpToken(flareProvider());
        const erc20 = new ethers.Interface(['function transfer(address to, uint256 value) returns (bool)']);
        const data = erc20.encodeFunctionData('transfer', [toAddr, uba]);

        return res.json({
          rail: 'evm',
          calls: [{ to: fxrpToken, data, value: '0', chainId: FLARE_CHAIN_ID }],
          disclosure: {
            action: 'token-transfer',
            asset: 'FXRP',
            network: 'Flare mainnet',
            amount: Number(uba) / DROPS,
            from: fromAddr,
            to: toAddr,
            astryumFee: 0,
            networkFee: 'Gas in FLR, shown by your wallet before you confirm',
            disclosedToUser: true,
            astryumSigns: false,
            note: 'Transfers FXRP (the FAssets representation of XRP on Flare) from your wallet to the destination — a plain ERC-20 transfer, nothing is minted or redeemed. You sign in your own EVM wallet; Astryum never signs, never custodies, never broadcasts.',
          },
        });
      }

      const wei = parseAmount(amount, 18);
      if (wei == null) return res.status(400).json({ error: 'INVALID_AMOUNT' });

      return res.json({
        rail: 'evm',
        calls: [{ to: toAddr, data: '0x', value: wei.toString(), chainId: FLARE_CHAIN_ID }],
        disclosure: {
          action: 'native-transfer',
          asset: 'FLR',
          network: 'Flare mainnet',
          amount: Number(ethers.formatEther(wei)),
          from: fromAddr,
          to: toAddr,
          astryumFee: 0,
          networkFee: 'Gas in FLR, shown by your wallet before you confirm',
          disclosedToUser: true,
          astryumSigns: false,
          note: 'Transfers native FLR from your wallet to the destination. You sign in your own EVM wallet; Astryum never signs, never custodies, never broadcasts.',
        },
      });
    }

    // rail === 'xrpl'
    if (asset !== undefined && asset !== 'XRP') {
      return res.status(400).json({ error: 'INVALID_ASSET', detail: "asset must be 'XRP' on the xrpl rail" });
    }
    const fromXrpl = typeof from === 'string' ? from.trim() : '';
    if (!XRPL_CLASSIC_RE.test(fromXrpl)) return res.status(400).json({ error: 'INVALID_FROM_ADDRESS' });
    if (typeof to === 'string' && ADDRESS_RE.test(to.trim())) {
      return res.status(400).json({
        error: 'CROSS_ECOSYSTEM_NOT_SUPPORTED',
        detail: 'XRP cannot be sent to an EVM address. Cross-ecosystem moves use a bridge flow, not a payment.',
      });
    }
    const toXrpl = typeof to === 'string' ? to.trim() : '';
    if (!XRPL_CLASSIC_RE.test(toXrpl)) return res.status(400).json({ error: 'INVALID_TO_ADDRESS' });
    if (fromXrpl === toXrpl) return res.status(400).json({ error: 'SAME_ADDRESS' });
    const drops = parseAmount(amount, 6); // 1 XRP = 1e6 drops
    if (drops == null) return res.status(400).json({ error: 'INVALID_AMOUNT' });

    const tagRead = readDestinationTag(destinationTag);
    if (noteReadFailed(tagRead)) {
      return res.status(400).json({ error: 'INVALID_DESTINATION_TAG', detail: tagRead.detail });
    }
    const memoRead = readMemo(memo);
    if (noteReadFailed(memoRead)) {
      return res.status(400).json({ error: 'INVALID_MEMO', detail: memoRead.detail });
    }
    const noteFields = {
      ...(tagRead.value !== undefined ? { DestinationTag: tagRead.value } : {}),
      ...(memoRead.value
        ? {
            Memos: [
              {
                Memo: {
                  MemoData: Buffer.from(memoRead.value, 'utf8').toString('hex').toUpperCase(),
                  MemoFormat: MEMO_FORMAT_TEXT_HEX,
                },
              },
            ],
          }
        : {}),
    };

    return res.json({
      rail: 'xrpl',
      // El estado REAL del executor de Astryum,
      // con el mismo nombre que usan las órdenes de consejo, para que la pantalla
      // deje de dar por supuesto lo peor. Aquí, además, nada depende de él: un
      // Payment XRP nativo firmado entra en el ledger solo.
      serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' },
      // Account is intentionally absent — the Xaman partner injects the signer.
      // Make Waves SourceTag stamped like every Astryum-composed XRPL tx
      // (config/xrplSourceTag rule); no-op while XRPL_SOURCE_TAG is unset.
      xrplPayment: withSourceTag({
        TransactionType: 'Payment' as const,
        Destination: toXrpl,
        Amount: drops.toString(),
        ...noteFields,
      }),
      disclosure: {
        action: 'native-transfer',
        asset: 'XRP',
        network: 'XRPL mainnet',
        amount: Number(drops) / 1_000_000,
        from: fromXrpl,
        to: toXrpl,
        // La nota se DEVUELVE para que la pantalla la enseñe tal cual va a
        // firmarse: el tag mal tecleado es el error que pierde el dinero.
        ...(tagRead.value !== undefined ? { destinationTag: tagRead.value } : {}),
        ...(memoRead.value ? { memo: memoRead.value } : {}),
        astryumFee: 0,
        networkFee: 'XRPL network fee (~0.000012 XRP), shown in Xaman before you sign',
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Transfers XRP from your wallet to the destination. You sign in Xaman; Astryum never signs, never custodies, never broadcasts. If the destination account is new, XRPL requires the base reserve (1 XRP) to activate it.' +
          (memoRead.value ? ' The memo travels with the payment and stays public on the ledger forever.' : '') +
          (tagRead.value !== undefined
            ? ' The destination tag identifies the account inside the destination — check it against what the recipient gave you.'
            : ''),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'WALLET_TRANSFER_PREPARE_FAILED', detail: (e as Error).message });
  }
});

/**
 * POST /api/wallet-transfer/bridge/xrpl-to-flare/prepare
 * Body: { xrplAddress, evmDestination, amountXrp, region? }
 *   amountXrp = GROSS XRP the user pays; minting + executor fees come out of
 *   it and the destination receives the net as FXRP on Flare. Returns the
 *   unsigned XRPL Payment (Core Vault + recipient memo) the user signs in Xaman.
 */
router.post('/bridge/xrpl-to-flare/prepare', async (req: Request, res: Response) => {
  try {
    const { xrplAddress, evmDestination, amountXrp, region = null } = (req.body ?? {}) as {
      xrplAddress?: string;
      evmDestination?: string;
      amountXrp?: string | number;
      region?: string | null;
    };

    const fromXrpl = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!XRPL_CLASSIC_RE.test(fromXrpl)) return res.status(400).json({ error: 'INVALID_FROM_ADDRESS' });
    const recipient = safeGetAddress(evmDestination);
    if (!recipient) return res.status(400).json({ error: 'INVALID_TO_ADDRESS' });
    const grossDrops = parseAmount(amountXrp, 6);
    if (grossDrops == null) return res.status(400).json({ error: 'INVALID_AMOUNT' });

    const gate = gateFlareBridge(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // §3 — the same cap + fuel frontier flareDemo has had.
    // This rail mints too: without it, the XRP leaves and parks with no reclaim
    // when the executor cannot pay for the attestation.
    const { demoCapFromBody } = await import('../config/demoCap');
    const capErr = await demoCapFromBody(req.body, req.siwe?.userId);
    if (capErr) return res.status(capErr.status).json(capErr.body);
    const { hasFeeBudgetForOneMint } = await import('../services/flare/ExecutorFuelService');
    if (!hasFeeBudgetForOneMint()) {
      return res.status(429).json({
        error: 'EXECUTOR_FUEL_EXHAUSTED',
        detail:
          'El executor no tiene presupuesto para atestiguar otro puente en Flare hoy. Tu XRP NO se ha ' +
          'movido: se ha parado antes de pedirte la firma. Inténtalo cuando se reponga el presupuesto.',
      });
    }

    const params = await readDirectMintParams(flareProvider());
    // No inner batch here — the buffer/supply fields don't apply; net = gross − fees.
    let net;
    try {
      net = computeNetMint(grossDrops, params, 0n);
    } catch (e) {
      return res.status(400).json({
        error: 'AMOUNT_BELOW_MINT_FEES',
        detail: `The XRP paid must exceed the minting + executor fees, or the whole payment is forfeited. ${(e as Error).message}`,
      });
    }

    // 32-byte direct-minting PaymentReference: prefix + 4 zero bytes + recipient.
    const memoHex = (DIRECT_MINTING_PREFIX + '00000000' + recipient.slice(2)).toUpperCase();

    return res.json({
      rail: 'xrpl',
      // Este SÍ lo finaliza un executor en Flare:
      // la pantalla necesita saber si el de Astryum está corriendo en vez de
      // avisar siempre de lo mismo. Mismo nombre que las órdenes de consejo.
      serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' },
      xrplPayment: withSourceTag({
        TransactionType: 'Payment' as const,
        Destination: params.paymentAddress, // FXRP Core Vault — resolved live
        Amount: grossDrops.toString(),
        Memos: [{ Memo: { MemoData: memoHex } }],
        // No DestinationTag by design — a tag would misroute the direct mint.
      }),
      disclosure: {
        action: 'bridge-mint-fxrp',
        asset: 'XRP → FXRP',
        network: 'XRPL → Flare (FAssets direct minting)',
        amount: Number(grossDrops) / DROPS,
        from: fromXrpl,
        to: recipient,
        mintingFeeXrp: Number(net.mintingFeeUBA) / DROPS,
        executorFeeXrp: Number(net.executorFeeUBA) / DROPS,
        netFxrp: Number(net.netToPersonalAccountUBA) / DROPS,
        astryumFee: 0,
        networkFee: 'XRPL network fee (~0.000012 XRP), shown in Xaman before you sign',
        disclosedToUser: true,
        astryumSigns: false,
        note: 'One XRPL Payment to the FXRP Core Vault with your destination encoded in the memo. Minting + executor fees are deducted from the payment; a permissionless executor finalizes the mint on Flare (rate limits can delay it, never reject it). You sign in Xaman; Astryum never signs, never custodies, never broadcasts.',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'BRIDGE_MINT_PREPARE_FAILED', detail: (e as Error).message });
  }
});

/**
 * POST /api/wallet-transfer/bridge/flare-to-xrpl/prepare
 * Body: { evmWallet, xrplDestination, amountXrp, region? }
 *   Burns amountXrp of FXRP from the EVM wallet via redeemAmount; the FAssets
 *   agent pays XRP (minus the protocol redemption fee) to the XRPL destination.
 *   Returns the unsigned EVM call the user signs in their own wallet.
 */
router.post('/bridge/flare-to-xrpl/prepare', async (req: Request, res: Response) => {
  try {
    // `region` may still arrive in the body; it is deliberately not read — an exit.
    const { evmWallet, xrplDestination, amountXrp, destinationTag, dependsOnPrior } = (req.body ?? {}) as {
      evmWallet?: string;
      xrplDestination?: string;
      amountXrp?: string | number;
      destinationTag?: string | number;
      region?: string | null;
      /**
       * The caller composes this redeem AFTER another call of the same
       * signature that puts the FXRP in the wallet (PaActionsModal «Convert to
       * XRP»: Kinetic withdraw → redeem). Dry-run against TODAY's state the burn
       * would revert for lack of balance — a FALSE negative. `true` marks the
       * step 'unverified' instead (same rule as `dependsOnPrior` in flareDemo).
       */
      dependsOnPrior?: boolean;
    };

    const fromEvm = safeGetAddress(evmWallet);
    if (!fromEvm) return res.status(400).json({ error: 'INVALID_FROM_ADDRESS' });
    const toXrpl = typeof xrplDestination === 'string' ? xrplDestination.trim() : '';
    if (!XRPL_CLASSIC_RE.test(toXrpl)) return res.status(400).json({ error: 'INVALID_TO_ADDRESS' });
    const amountUBA = parseAmount(amountXrp, 6);
    if (amountUBA == null) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    // En una redención el XRP lo paga el AGENTE, no el usuario: su pago lleva
    // la referencia del protocolo y no admite texto libre. Lo único que cabe
    // dentro es el tag del destino — justo lo que pide un exchange para
    // acreditar el ingreso. Se valida AQUÍ, con el resto de la entrada, antes
    // del interruptor y antes de tocar la cadena.
    const tagRead = readDestinationTag(destinationTag);
    if (noteReadFailed(tagRead)) {
      return res.status(400).json({ error: 'INVALID_DESTINATION_TAG', detail: tagRead.detail });
    }

    // THE EXIT IS NEVER GATED: flag-only, no geofence (see gateFlareBridgeExit).
    const gate = gateFlareBridgeExit();
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const provider = flareProvider();
    const assetManager = await resolveAssetManagerFxrp(provider);
    const am = new ethers.Contract(assetManager, ASSET_MANAGER_REDEEM_ABI, provider);
    const minUBA = BigInt(await am.minimumRedeemAmountUBA());
    if (amountUBA < minUBA) {
      return res.status(400).json({
        error: 'AMOUNT_BELOW_MINIMUM_REDEEM',
        detail: `Minimum redemption is ${Number(minUBA) / DROPS} XRP (enforced on-chain).`,
        minimumXrp: Number(minUBA) / DROPS,
      });
    }

    // Con tag, el agente paga al destino con el número de cuenta dentro.
    const data =
      tagRead.value !== undefined
        ? am.interface.encodeFunctionData('redeemWithTag', [amountUBA, toXrpl, ZERO_ADDR, tagRead.value])
        : am.interface.encodeFunctionData('redeemAmount', [amountUBA, toXrpl, ZERO_ADDR]);
    // The FAssets redemption fee as a LIVE figure on the
    // amount this call redeems (invariants #6/#9). Unreadable → null plus a line
    // that says so: never rendered as a 0% fee.
    const redemptionFee = estimateRedemptionFee(amountUBA, await readRedemptionFeeBips(provider));

    // Invariant #11 — dry-run BEFORE the wallet opens, `from` = the wallet that
    // signs. This route was the second half of «Convert to XRP» in
    // PaActionsModal and carried no verdict at all, so the screen composed the
    // pair with no `preflight` to show. A redeem that reverts (not enough FXRP,
    // below the agent's lot, paused) is a CALL_EXCEPTION here — a proven
    // failure; a node that does not answer degrades to `available: false`
    // and never blocks the prepare. Nothing is signed, nothing is broadcast.
    const redeemLabel = tagRead.value !== undefined ? 'redeem FXRP to XRP (with destination tag)' : 'redeem FXRP to XRP';
    const preflight: PreflightResult = await preflightEvmCalls(provider, fromEvm, [
      {
        to: assetManager,
        data,
        label: redeemLabel,
        dependsOnPrior: dependsOnPrior === true,
      } satisfies EvmPreflightCall,
    ]);

    return res.json({
      rail: 'evm',
      calls: [{ to: assetManager, data, value: '0', chainId: FLARE_CHAIN_ID }],
      preflight,
      disclosure: {
        action: 'bridge-redeem-fxrp',
        asset: 'FXRP → XRP',
        network: 'Flare → XRPL (FAssets redemption)',
        amount: Number(amountUBA) / DROPS,
        from: fromEvm,
        to: toXrpl,
        ...(tagRead.value !== undefined ? { destinationTag: tagRead.value } : {}),
        minimumRedeemXrp: Number(minUBA) / DROPS,
        redemptionFeeBips: redemptionFee.redemptionFeeBips,
        redemptionFeeFxrp: redemptionFee.redemptionFeeFxrp,
        redemptionFeeLine: redemptionFeeDisclosureLine(redemptionFee),
        astryumFee: 0,
        networkFee: 'Gas in FLR, shown by your wallet before you confirm',
        disclosedToUser: true,
        astryumSigns: false,
        note: 'Burns your FXRP on Flare via AssetManagerFXRP.redeemAmount; the FAssets agent then pays the XRP (minus the protocol redemption fee) to your XRPL address. Large requests can be fulfilled partially or by several agents; if an agent misses its payment window, the redemption default process reimburses you from its collateral. You sign in your own EVM wallet; Astryum never signs, never custodies, never broadcasts.',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'BRIDGE_REDEEM_PREPARE_FAILED', detail: (e as Error).message });
  }
});

export default router;
