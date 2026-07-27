/**
 * Network status — public, read-only chain telemetry for the dashboard header.
 *
 * GET /api/network/status → live gas/fee + liveness for the two rails Astryum
 * prepares intents on today:
 *   - Flare (chainId 14): eth_gasPrice + latest block via the public RPC.
 *   - XRPL: `fee` JSON-RPC (base fee + open-ledger fee in drops) + ledger index.
 *
 * GET /api/network/balance?kind=evm|xrpl&address=… → native balance of ONE
 * public address (FLR on Flare, XRP on XRPL). Feeds the Wallets cards, which
 * previously pointed at a non-existent /api/data/balance and always rendered
 * "Balance not loaded".
 *
 * Only public chain data is read — no user context, no auth, no secrets
 * (public RPC endpoints, overridable via FLARE_RPC_URL / XRPL_RPC_URL).
 * Status is cached in-process for 30s so a dashboard full of tabs cannot
 * hammer the public endpoints.
 */
import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';

const router = Router();

const FLARE_RPC_URL = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';

// XRPL JSON-RPC must be HTTP(S) — some envs (and the old .env.example) carry a
// wss:// URL meant for the websocket client, which fetch() cannot speak. Coerce
// ws schemes to https and keep public fallbacks so one bad env var can't take
// the whole reading down.
function httpsify(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}
const XRPL_RPC_URLS: string[] = [
  ...(process.env.XRPL_RPC_URL ? [httpsify(process.env.XRPL_RPC_URL)] : []),
  'https://xrplcluster.com',
  'https://s1.ripple.com:51234',
].filter((v, i, a) => a.indexOf(v) === i);

const CACHE_TTL_MS = 30_000;
const RPC_TIMEOUT_MS = 6_000;

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export interface NetworkStatusPayload {
  flare: { ok: boolean; gasGwei?: number; blockNumber?: number };
  xrpl: { ok: boolean; baseFeeXrp?: number; openLedgerFeeXrp?: number; ledgerIndex?: number };
  takenAt: string;
}

let cache: { payload: NetworkStatusPayload; at: number } | null = null;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('rpc_timeout')), RPC_TIMEOUT_MS)),
  ]);
}

async function readFlare(): Promise<NetworkStatusPayload['flare']> {
  try {
    const provider = new ethers.JsonRpcProvider(
      FLARE_RPC_URL,
      { name: 'flare', chainId: 14 },
      { staticNetwork: true },
    );
    const [feeData, blockNumber] = await withTimeout(
      Promise.all([provider.getFeeData(), provider.getBlockNumber()]),
    );
    const gasWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? null;
    return {
      ok: true,
      gasGwei: gasWei != null ? Number(gasWei) / 1e9 : undefined,
      blockNumber,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * POST one XRPL JSON-RPC command, walking the fallback endpoints in order.
 * Returns the raw `result` object (which carries status/error, e.g.
 * actNotFound for unfunded accounts) or null when no endpoint answered.
 */
async function xrplRpc<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<(T & { status?: string; error?: string }) | null> {
  for (const url of XRPL_RPC_URLS) {
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params: [params] }),
        }),
      );
      if (!res.ok) continue;
      const body = (await res.json()) as { result?: T & { status?: string; error?: string } };
      if (body.result) return body.result;
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}

/**
 * Live XRPL reserve requirements (XRP locked to keep an account/objects on
 * ledger — NOT spendable). Read from server_info and cached 1h; falls back to
 * the current mainnet values (1 XRP base + 0.2 XRP per owned object) if the
 * read fails, so the balance endpoint never over-reports what is spendable.
 */
const XRPL_RESERVE_FALLBACK = { base: 1, inc: 0.2 };
let reserveCache: { base: number; inc: number; at: number } | null = null;

async function xrplReserves(): Promise<{ base: number; inc: number }> {
  if (reserveCache && Date.now() - reserveCache.at < 3_600_000) return reserveCache;
  const result = await xrplRpc<{
    info?: { validated_ledger?: { reserve_base_xrp?: number; reserve_inc_xrp?: number } };
  }>('server_info', {});
  const vl = result?.status === 'success' ? result.info?.validated_ledger : undefined;
  const base = Number(vl?.reserve_base_xrp);
  const inc = Number(vl?.reserve_inc_xrp);
  if (Number.isFinite(base) && base >= 0 && Number.isFinite(inc) && inc >= 0) {
    reserveCache = { base, inc, at: Date.now() };
    return reserveCache;
  }
  return XRPL_RESERVE_FALLBACK;
}

async function readXrpl(): Promise<NetworkStatusPayload['xrpl']> {
  const result = await xrplRpc<{
    drops?: { base_fee?: string; open_ledger_fee?: string };
    ledger_current_index?: number;
  }>('fee', {});
  const drops = result?.status === 'success' ? result.drops : undefined;
  if (!result || !drops) return { ok: false };
  const toXrp = (d?: string) => {
    const n = Number(d);
    return Number.isFinite(n) ? n / 1_000_000 : undefined;
  };
  return {
    ok: true,
    baseFeeXrp: toXrp(drops.base_fee),
    openLedgerFeeXrp: toXrp(drops.open_ledger_fee),
    ledgerIndex: result.ledger_current_index,
  };
}

router.get('/status', async (_req: Request, res: Response) => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return res.json(cache.payload);
  }
  const [flare, xrpl] = await Promise.all([readFlare(), readXrpl()]);
  const payload: NetworkStatusPayload = { flare, xrpl, takenAt: new Date().toISOString() };
  // Only cache when at least one rail answered — a fully failed read should
  // retry on the next request instead of pinning "down" for 30s.
  if (flare.ok || xrpl.ok) cache = { payload, at: Date.now() };
  res.json(payload);
});

/**
 * GET /api/network/balance?kind=evm|xrpl&address=…
 * Native balance of one public address — FLR (Flare C-chain) or XRP.
 * For XRPL, `balance` is the SPENDABLE amount (total minus the ledger-locked
 * reserve); `totalBalance` + `reservedXrp` carry the breakdown.
 * Read-only public chain data; balances are returned as decimal strings,
 * never invented (any RPC failure → ok:false).
 */
router.get('/balance', async (req: Request, res: Response) => {
  const kind = String(req.query.kind ?? '');
  const address = String(req.query.address ?? '');

  if (kind === 'evm') {
    if (!EVM_ADDRESS_RE.test(address)) {
      return res.status(400).json({ ok: false, error: 'invalid_evm_address' });
    }
    try {
      const provider = new ethers.JsonRpcProvider(
        FLARE_RPC_URL,
        { name: 'flare', chainId: 14 },
        { staticNetwork: true },
      );
      const wei = await withTimeout(provider.getBalance(address));
      return res.json({ ok: true, symbol: 'FLR', balance: ethers.formatEther(wei) });
    } catch {
      return res.json({ ok: false, symbol: 'FLR' });
    }
  }

  // FXRP (ERC-20 on Flare) balance of an EVM address — used by the Send modal
  // when preparing a Flare→XRPL redemption. Same public-read posture as evm/xrpl.
  if (kind === 'fxrp') {
    if (!EVM_ADDRESS_RE.test(address)) {
      return res.status(400).json({ ok: false, error: 'invalid_evm_address' });
    }
    try {
      // Lazy require keeps the public /status endpoint immune to a connector
      // load failure (mountRouter would otherwise drop the whole router).
      const { resolveAssetManagerFxrp } = require('../connectors/protocols/flare/FlareDirectMintService');
      const provider = new ethers.JsonRpcProvider(
        FLARE_RPC_URL,
        { name: 'flare', chainId: 14 },
        { staticNetwork: true },
      );
      const amAddr: string = await withTimeout(resolveAssetManagerFxrp(provider));
      const am = new ethers.Contract(amAddr, ['function fAsset() view returns (address)'], provider);
      const fxrpToken: string = await withTimeout(am.fAsset());
      const erc20 = new ethers.Contract(
        fxrpToken,
        ['function balanceOf(address) view returns (uint256)'],
        provider,
      );
      const uba = BigInt(await withTimeout(erc20.balanceOf(address)));
      return res.json({ ok: true, symbol: 'FXRP', balance: String(Number(uba) / 1_000_000) });
    } catch {
      return res.json({ ok: false, symbol: 'FXRP' });
    }
  }

  if (kind === 'xrpl') {
    if (!XRPL_CLASSIC_RE.test(address)) {
      return res.status(400).json({ ok: false, error: 'invalid_xrpl_address' });
    }
    const result = await xrplRpc<{ account_data?: { Balance?: string; OwnerCount?: number } }>(
      'account_info',
      {
        account: address,
        ledger_index: 'validated',
      },
    );
    if (!result) return res.json({ ok: false, symbol: 'XRP' });
    // Unfunded accounts answer actNotFound — that is a REAL zero, not a failure.
    if (result.error === 'actNotFound') return res.json({ ok: true, symbol: 'XRP', balance: '0' });
    const drops = Number(result.account_data?.Balance);
    if (result.status !== 'success' || !Number.isFinite(drops)) {
      return res.json({ ok: false, symbol: 'XRP' });
    }
    // `balance` is the SPENDABLE amount: total minus the XRPL reserve (base +
    // per-object). The reserve is locked by the ledger, not usable capital —
    // showing it as balance overstates what the user can actually move.
    const ownerCount = Math.max(0, Number(result.account_data?.OwnerCount) || 0);
    const reserves = await xrplReserves();
    const totalXrp = drops / 1_000_000;
    const reservedXrp = reserves.base + ownerCount * reserves.inc;
    const spendableXrp = Math.max(0, totalXrp - reservedXrp);
    return res.json({
      ok: true,
      symbol: 'XRP',
      balance: String(spendableXrp),
      totalBalance: String(totalXrp),
      reservedXrp,
    });
  }

  return res.status(400).json({ ok: false, error: 'kind_must_be_evm_or_xrpl' });
});

export default router;
