/**
 * Wallet transfer routes — native-asset transfers between the user's own
 * wallets or to an external address, prepared from the Wallets page.
 *
 *   POST /wallet-transfer/prepare
 *     rail 'evm'  → asset 'FLR' (default): native transfer on Flare mainnet
 *                   (chainId 14). asset 'FXRP': plain ERC-20 transfer(to,amount)
 *                   on the FXRP token (resolved live, never hardcoded). Both
 *                   return the same `calls[]` shape the Earn E2 flow uses, so
 *                   the frontend hands it to useWalletPartner().sendIntentCalls
 *                   unchanged.
 *     rail 'xrpl' → XRP Payment. Returns the same `xrplPayment` shape E1 uses
 *                   (no Account field — XamanWalletService injects the signer).
 *
 * Astryum stays PREPARE-ONLY (invariant #1): the response is an unsigned
 * payload + a fee disclosure (#6, disclosedToUser). It never signs, never
 * broadcasts. A native wallet-to-wallet payment is NOT DeFi execution, so this
 * route does not sit behind FLARE_DEFI_ENABLED / the DeFi geofence (#5) — the
 * same way fiat and monitoring stay available everywhere.
 *
 * Cross-ecosystem XRP moves are NOT raw payments — they ride the FAssets
 * bridge, prepared here as well (both prepare-only, user always signs):
 *
 *   POST /wallet-transfer/bridge/xrpl-to-flare/prepare
 *     XRP → FXRP direct minting: ONE XRPL Payment to the Core Vault with the
 *     32-byte recipient memo (prefix 4642505266410018 + padding + EVM address,
 *     dev.flare.network/fassets/developer-guides/fassets-direct-minting). Fees
 *     (minting + executor) are deducted from the payment; a permissionless
 *     executor finalizes on Flare. Signed in Xaman.
 *
 *   POST /wallet-transfer/bridge/flare-to-xrpl/prepare
 *     FXRP → XRP redemption: redeemAmount(amountUBA, xrplAddress, 0x0) on
 *     AssetManagerFXRP (dev.flare.network/fassets/developer-guides/
 *     fassets-redeem-amount). Burns FXRP; the FAssets agent pays XRP to the
 *     destination. Signed in the user's EVM wallet.
 *
 * Both bridge routes touch the FAssets protocol, so they sit behind the same
 * FLARE_DEFI_ENABLED flag + jurisdiction geofence as the Earn demo (#5/#8/#10).
 */
import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { jurisdictionService } from '../services/JurisdictionService';
import {
  readDirectMintParams,
  computeNetMint,
  resolveAssetManagerFxrp,
  resolveFxrpToken,
} from '../connectors/protocols/flare/FlareDirectMintService';
import { withSourceTag } from '../config/xrplSourceTag';

const router = Router();

const FLARE_CHAIN_ID = 14;
const DROPS = 1_000_000; // 1 XRP = 1e6 drops; FXRP UBA == drops

// Direct-minting 32-byte PaymentReference: [8-byte prefix][4 zero bytes][20-byte recipient]
const DIRECT_MINTING_PREFIX = '4642505266410018';

// IAssetManager (FXRP) — redemption surface only. Address resolved live via the
// FlareContractsRegistry (never hardcoded, invariant #9).
const ASSET_MANAGER_REDEEM_ABI = [
  'function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor) returns (uint256)',
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

/**
 * POST /api/wallet-transfer/prepare
 * Body: { rail: 'evm'|'xrpl', from, to, amount, asset? }
 *   amount is in human units (FLR, FXRP or XRP). asset applies to rail 'evm'
 *   only: 'FLR' (default, native) or 'FXRP' (ERC-20 transfer on Flare — an
 *   FXRP→XRP move is NOT this route, it rides bridge/flare-to-xrpl). Returns
 *   the unsigned payload the user's own wallet signs, plus the disclosure
 *   shown before signing.
 */
router.post('/prepare', async (req: Request, res: Response) => {
  try {
    const { rail, from, to, amount, asset } = (req.body ?? {}) as {
      rail?: string;
      from?: string;
      to?: string;
      amount?: string | number;
      asset?: string;
    };

    if (rail !== 'evm' && rail !== 'xrpl') {
      return res.status(400).json({ error: 'INVALID_RAIL', detail: "rail must be 'evm' | 'xrpl'" });
    }

    if (rail === 'evm') {
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

    return res.json({
      rail: 'xrpl',
      // Account is intentionally absent — the Xaman partner injects the signer.
      // Make Waves SourceTag stamped like every Astryum-composed XRPL tx
      // (config/xrplSourceTag rule); no-op while XRPL_SOURCE_TAG is unset.
      xrplPayment: withSourceTag({
        TransactionType: 'Payment' as const,
        Destination: toXrpl,
        Amount: drops.toString(),
      }),
      disclosure: {
        action: 'native-transfer',
        asset: 'XRP',
        network: 'XRPL mainnet',
        amount: Number(drops) / 1_000_000,
        from: fromXrpl,
        to: toXrpl,
        astryumFee: 0,
        networkFee: 'XRPL network fee (~0.000012 XRP), shown in Xaman before you sign',
        disclosedToUser: true,
        astryumSigns: false,
        note: 'Transfers XRP from your wallet to the destination. You sign in Xaman; Astryum never signs, never custodies, never broadcasts. If the destination account is new, XRPL requires the base reserve (1 XRP) to activate it.',
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

    // §3 — the same cap + fuel frontier flareDemo has had since 2026-07-25.
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
    const { evmWallet, xrplDestination, amountXrp, region = null } = (req.body ?? {}) as {
      evmWallet?: string;
      xrplDestination?: string;
      amountXrp?: string | number;
      region?: string | null;
    };

    const fromEvm = safeGetAddress(evmWallet);
    if (!fromEvm) return res.status(400).json({ error: 'INVALID_FROM_ADDRESS' });
    const toXrpl = typeof xrplDestination === 'string' ? xrplDestination.trim() : '';
    if (!XRPL_CLASSIC_RE.test(toXrpl)) return res.status(400).json({ error: 'INVALID_TO_ADDRESS' });
    const amountUBA = parseAmount(amountXrp, 6);
    if (amountUBA == null) return res.status(400).json({ error: 'INVALID_AMOUNT' });

    const gate = gateFlareBridge(region);
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

    const data = am.interface.encodeFunctionData('redeemAmount', [amountUBA, toXrpl, ZERO_ADDR]);

    return res.json({
      rail: 'evm',
      calls: [{ to: assetManager, data, value: '0', chainId: FLARE_CHAIN_ID }],
      disclosure: {
        action: 'bridge-redeem-fxrp',
        asset: 'FXRP → XRP',
        network: 'Flare → XRPL (FAssets redemption)',
        amount: Number(amountUBA) / DROPS,
        from: fromEvm,
        to: toXrpl,
        minimumRedeemXrp: Number(minUBA) / DROPS,
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
