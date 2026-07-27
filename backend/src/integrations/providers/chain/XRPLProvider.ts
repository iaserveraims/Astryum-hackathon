/**
 * XRPLProvider — P16
 *
 * Read-only access to XRP Ledger via xrpl.js (wss://xrplcluster.com, public, free).
 * Covers: XRP balance, trust lines (IOUs), DEX offers, AMM LP positions, Soil vaults.
 *
 * XRPL uses pseudo chainId 1440002 internally (not a real EVM chainId).
 * Signing is done by Xaman (XUMM) — Astryum never signs or submits XRPL transactions.
 *
 * Soil/RLUSD:
 *   - RLUSD is Ripple's USD stablecoin (IOU on XRPL, ERC-20 on Ethereum).
 *   - Soil vaults deposit RLUSD into AMM pools (XLS-30d) for yield.
 *   - SOIL_VAULT_ISSUER env var enables Soil position detection.
 *   - XLS-66 is pending mainnet; this implementation is forward-compatible.
 *
 * BROADCAST_FORBIDDEN — Astryum never signs or broadcasts XRPL transactions.
 */

import { Client, getBalanceChanges } from 'xrpl';
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../../canonical/types/Source';

// ── Constants ────────────────────────────────────────────────────────────────

/** Pseudo chainId used internally for XRPL (not an EVM chainId). */
export const XRPL_CHAIN_ID = 1440002;

const XRPL_WS_URL = process.env.XRPL_WS_URL ?? 'wss://xrplcluster.com';

/**
 * HTTPS JSON-RPC fallback endpoints. Some hosts (Railway) can't hold the
 * websocket the xrpl.js Client speaks — every read then failed silently and
 * the portfolio showed $0 while /api/network/balance (already HTTPS) worked.
 * Same endpoint-walking pattern as routes/networkStatus.ts.
 */
function httpsify(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}
const XRPL_HTTP_URLS: string[] = [
  ...(process.env.XRPL_RPC_URL ? [httpsify(process.env.XRPL_RPC_URL)] : []),
  ...(process.env.XRPL_WS_URL ? [httpsify(process.env.XRPL_WS_URL)] : []),
  'https://s1.ripple.com:51234',
  'https://s2.ripple.com:51234',
  'https://xrplcluster.com',
].filter((v, i, a) => /^https?:\/\//.test(v) && a.indexOf(v) === i);

/**
 * rippled errors that describe the SERVER's state, not the ledger's.
 * `amendmentBlocked` (node running an outdated rippled), `tooBusy`, `noNetwork`…
 * are properties of the one server that answered — a healthy server answers the
 * same query fine. They must trigger the endpoint walk, NOT be propagated as an
 * answer. Ledger errors (actNotFound…) stay answers and keep propagating with
 * `err.data`, which is how callers distinguish them.
 *
 * Not theoretical: xrplcluster.com is a round-robin pool that currently rotates
 * amendment-blocked nodes — verified 2026-07-12, the same query returned
 * `amendmentBlocked` on one call and succeeded on the next.
 */
const SERVER_STATE_ERRORS = new Set([
  'amendmentBlocked',
  'tooBusy',
  'noNetwork',
  'noCurrent',
  'noClosed',
  'notSynced',
  'backendError',
  'internal',
  'timeout',
  'slowDown',
  'failedToForward',
]);

/** How long to keep routing reads over HTTPS after a websocket failure. */
const WS_RETRY_MS = 60_000;

/**
 * RLUSD issuer on XRPL mainnet (Ripple's official issuer).
 * Override via RLUSD_XRPL_ISSUER env var if the address is updated.
 */
const RLUSD_ISSUER = process.env.RLUSD_XRPL_ISSUER ?? 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';

/**
 * Soil vault issuer on XRPL.
 * Empty until Soil mainnet deploys with XLS-66. Override via SOIL_VAULT_ISSUER env var.
 */
const SOIL_VAULT_ISSUER = process.env.SOIL_VAULT_ISSUER ?? '';

// ── Domain types ──────────────────────────────────────────────────────────────

export interface XRPBalance {
  /** Raw drops of XRP (1 XRP = 1_000_000 drops). */
  drops: string;
  /** Human-readable XRP with 6 decimal places. */
  xrp: string;
}

export interface TrustLine {
  /** Issuer account address. */
  issuer: string;
  /** Currency code (3-char ISO or 40-char hex). */
  currency: string;
  /** Current balance (positive = we hold, negative = we owe). */
  balance: string;
  /** Our trust limit with this issuer. */
  limit: string;
}

export interface XRPLPosition {
  type: 'trust_line' | 'offer' | 'amm_lp' | 'escrow';
  currency: string;
  issuer?: string;
  balance: string;
  details: Record<string, unknown>;
}

/** Pool snapshot from `amm_info` (XLS-30) — protocol data, disclosed with source. */
export interface AmmPoolInfo {
  /** The AMM's ledger account. */
  ammAccount: string;
  /** Pool reserves (drops string for XRP, IOU object otherwise). */
  amount: unknown;
  amount2: unknown;
  /** LP token descriptor (currency/issuer/value outstanding). */
  lpToken: { currency: string; issuer: string; value: string };
  /** Trading fee in units of 1/100_000 (500 = 0.5%). */
  tradingFee: number;
  assetFrozen: boolean;
}

export interface SoilPosition {
  vaultIssuer: string;
  /** Soil vault share balance. */
  shareBalance: string;
  /** Underlying asset (RLUSD). */
  underlyingCurrency: 'RLUSD';
  /**
   * Estimated value in RLUSD (1:1 until Soil publishes NAV endpoint).
   * Will be updated to use Soil's pricing API when available.
   */
  estimatedValueRLUSD: string;
}

// ── Capabilities ──────────────────────────────────────────────────────────────

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'chain.getBalance',
  'chain.getTokenBalances',
  'chain.getDeFiPositions',
  'xrpl.getAccountLines',
  'xrpl.getAccountObjects',
  'xrpl.getAmmInfo',
]);

// ── Provider ──────────────────────────────────────────────────────────────────

export class XRPLProvider implements IProvider {
  readonly id = 'xrpl-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 65;
  readonly capabilities = CAPS;

  private _client: Client | null = null;
  private _connecting: Promise<void> | null = null;
  /** Last websocket transport failure — while fresh, reads go over HTTPS. */
  private _wsFailedAt = 0;

  /** Returns (and lazily connects) the shared xrpl.js Client. */
  private async _getClient(): Promise<Client> {
    if (this._client?.isConnected()) return this._client;

    // If a connection is already in progress, await it.
    if (this._connecting) {
      await this._connecting;
      return this._client!;
    }

    this._client = new Client(XRPL_WS_URL, { connectionTimeout: 10000 });
    this._connecting = this._client.connect().finally(() => {
      this._connecting = null;
    });
    await this._connecting;
    return this._client;
  }

  /**
   * One XRPL command over HTTPS JSON-RPC, walking the fallback endpoints.
   * Mirrors xrpl.js semantics: a ledger-level error result (actNotFound…)
   * THROWS with `err.data` carrying the result — callers already distinguish
   * ledger errors that way. Transport failures AND server-state errors
   * (amendmentBlocked… — see SERVER_STATE_ERRORS) try the next endpoint: a sick
   * server is not an answer. Note a server-state error arrives as HTTP 200 with
   * `status:'error'`, so `res.ok` alone would not catch it.
   */
  private async _httpRpc<T>(command: string, params: Record<string, unknown>): Promise<T> {
    let lastErr: unknown = new Error('xrpl_http_rpc_unreachable');
    for (const url of XRPL_HTTP_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: command, params: [params] }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          lastErr = new Error(`xrpl_http_${res.status}`);
          continue;
        }
        const body = (await res.json()) as {
          result?: T & { status?: string; error?: string };
        };
        const result = body.result;
        if (!result) {
          lastErr = new Error('xrpl_http_empty_result');
          continue;
        }
        if (result.status === 'error') {
          if (SERVER_STATE_ERRORS.has(result.error ?? '')) {
            lastErr = new Error(`xrpl_server_state_${result.error}`);
            continue;
          }
          const err = new Error(result.error ?? 'xrpl_rpc_error') as Error & { data: unknown };
          err.data = result;
          throw err;
        }
        return result;
      } catch (err) {
        // A ledger error is a REAL answer — propagate, don't retry elsewhere.
        if ((err as { data?: unknown })?.data) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Run one read command: websocket first (streaming client, local dev),
   * HTTPS JSON-RPC when the socket can't be established (PaaS egress, bad
   * XRPL_WS_URL). A websocket failure switches reads to HTTPS for a minute
   * instead of re-paying the connect timeout on every call.
   */
  private async _request<T>(req: { command: string } & Record<string, unknown>): Promise<T> {
    const { command, ...params } = req;
    if (Date.now() - this._wsFailedAt > WS_RETRY_MS) {
      try {
        const client = await this._getClient();
        const res = await client.request(req as never);
        return (res as { result: T }).result;
      } catch (err) {
        // Ledger-level errors (actNotFound…) are answers, not transport
        // failures — the connection works, so keep it and propagate.
        // A server-state error (amendmentBlocked…) is NOT an answer: this node
        // is sick, so fall through to the HTTPS walk and find a healthy one.
        const code = (err as { data?: { error?: string } })?.data?.error;
        if (code && !SERVER_STATE_ERRORS.has(code)) throw err;
        this._wsFailedAt = Date.now();
      }
    }
    return this._httpRpc<T>(command, params);
  }

  supportsChain(chainId: number): boolean {
    return chainId === XRPL_CHAIN_ID;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const result = await this._request<{ info?: unknown }>({ command: 'server_info' });
      const latencyMs = Date.now() - start;
      return {
        status: result?.info ? 'healthy' : 'degraded',
        latencyMs,
        lastCheckAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        status: 'down',
        lastCheckAt: new Date().toISOString(),
        reason: err?.message ?? String(err),
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    // ── BROADCAST_FORBIDDEN ───────────────────────────────────────────────
    if (
      capability === 'chain.sendTransaction' ||
      capability === 'chain.broadcastTransaction' ||
      capability === 'chain.sendRawTransaction' ||
      capability === 'xrpl.submit' ||
      capability === 'xrpl.submitAndWait'
    ) {
      throw new Error(
        'BROADCAST_FORBIDDEN: XRPLProvider is read-only. ' +
          'XRPL transactions must be signed and submitted by Xaman (XUMM). ' +
          'Astryum never signs or broadcasts.',
      );
    }

    const inp = input as Record<string, unknown>;

    // Reject requests for wrong chainId (undefined is allowed — chain-agnostic callers).
    if (inp.chainId !== undefined && inp.chainId !== XRPL_CHAIN_ID) {
      throw new Error(
        `XRPLProvider: only handles chainId ${XRPL_CHAIN_ID} (XRPL), got ${inp.chainId}`,
      );
    }

    const address = inp.address as string;
    const source = this._source(ctx.traceId);

    switch (capability) {
      case 'chain.getBalance': {
        const data = await this.getBalance(address);
        return { data: data as unknown as TOut, source, cached: false };
      }

      case 'chain.getTokenBalances':
      case 'xrpl.getAccountLines': {
        const data = await this.getTokenBalances(address);
        return { data: data as unknown as TOut, source, cached: false };
      }

      case 'chain.getDeFiPositions': {
        const data = await this.getDeFiPositions(address);
        return { data: data as unknown as TOut, source, cached: false };
      }

      case 'xrpl.getAccountObjects': {
        const data = await this._request<TOut>({
          command: 'account_objects',
          account: address,
          ledger_index: 'validated',
        });
        return { data, source, cached: false };
      }

      case 'xrpl.getAmmInfo': {
        const data = await this.getAmmInfo(
          inp.asset as { currency: string; issuer?: string },
          inp.asset2 as { currency: string; issuer?: string },
        );
        return { data: data as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`XRPLProvider: unknown capability '${capability}'`);
    }
  }

  // ── Public domain methods (used directly by CapitalMapService etc.) ─────────

  /** Returns the XRP balance for an account in drops and human-readable form. */
  async getBalance(address: string): Promise<XRPBalance> {
    const result = await this._request<{ account_data: { Balance: string } }>({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    const drops: string = result.account_data.Balance;
    const xrp = (Number(drops) / 1_000_000).toFixed(6);
    return { drops, xrp };
  }

  /**
   * Returns all trust lines (IOU balances) for an account.
   * Filters out zero-balance lines.
   */
  async getTokenBalances(address: string): Promise<TrustLine[]> {
    const result = await this._request<{ lines?: any[] }>({
      command: 'account_lines',
      account: address,
      ledger_index: 'validated',
    });
    const lines: any[] = result.lines ?? [];
    return lines.map((line) => ({
      issuer: line.account,
      currency: line.currency,
      balance: line.balance,
      limit: line.limit,
    }));
  }

  /**
   * Aggregates all DeFi-relevant positions:
   * - Non-zero trust lines (IOUs, RLUSD, LP tokens, etc.)
   * - Open DEX offers
   * - AMM LP positions (XLS-30d)
   */
  async getDeFiPositions(address: string): Promise<XRPLPosition[]> {
    const [linesRes, objRes] = await Promise.all([
      this._request<{ lines?: any[] }>({ command: 'account_lines', account: address, ledger_index: 'validated' }),
      this._request<{ account_objects?: any[] }>({ command: 'account_objects', account: address, ledger_index: 'validated' }),
    ]);

    const positions: XRPLPosition[] = [];

    // Trust lines with non-zero balance
    for (const line of linesRes.lines ?? []) {
      if (parseFloat(line.balance) === 0) continue;
      positions.push({
        type: 'trust_line',
        currency: line.currency,
        issuer: line.account,
        balance: line.balance,
        details: { limit: line.limit, limitPeer: line.limit_peer },
      });
    }

    // Account objects: DEX offers + AMM LP tokens (XLS-30d)
    for (const obj of objRes.account_objects ?? []) {
      if (obj.LedgerEntryType === 'Offer') {
        const takerGets = obj.TakerGets;
        positions.push({
          type: 'offer',
          currency: typeof takerGets === 'object' ? takerGets.currency : 'XRP',
          issuer: typeof takerGets === 'object' ? takerGets.issuer : undefined,
          balance: typeof takerGets === 'object' ? takerGets.value : String(takerGets),
          details: { takerGets: obj.TakerGets, takerPays: obj.TakerPays },
        });
      }

      // AMM LP token position (XLS-30d AMM)
      if (obj.LedgerEntryType === 'AMM') {
        const lpBal = obj.LPTokenBalance;
        positions.push({
          type: 'amm_lp',
          currency: lpBal?.currency ?? 'LP',
          issuer: lpBal?.issuer,
          balance: lpBal?.value ?? '0',
          details: {
            asset: obj.Asset,
            asset2: obj.Asset2,
            tradingFee: obj.TradingFee,
          },
        });
      }

      // Escrow (native XRP escrow / XLS-85 token escrow). account_objects
      // returns escrows where this account is owner OR destination; Amount is
      // a drops string for XRP, an IOU object for token escrows.
      if (obj.LedgerEntryType === 'Escrow') {
        const amt = obj.Amount;
        const isXrp = typeof amt === 'string';
        positions.push({
          type: 'escrow',
          currency: isXrp ? 'XRP' : (amt?.currency ?? '?'),
          issuer: isXrp ? undefined : amt?.issuer,
          balance: isXrp ? (Number(amt) / 1_000_000).toFixed(6) : (amt?.value ?? '0'),
          details: {
            owner: obj.Account,
            destination: obj.Destination,
            isOutgoing: obj.Account === address,
            finishAfter: obj.FinishAfter,
            cancelAfter: obj.CancelAfter,
            hasCondition: obj.Condition !== undefined,
            previousTxnID: obj.PreviousTxnID,
          },
        });
      }
    }

    return positions;
  }

  /**
   * Spendable XRP after the ledger reserves (read-only): balance minus the
   * base reserve plus one owner-reserve increment per owned object — the
   * number the savings form must validate against BEFORE preparing an
   * EscrowCreate (which itself adds one more owner increment, included here
   * as `nextObjectReserveXrp`). Reserves are read live from server_info, not
   * hardcoded (they changed in 2024 and can change again by amendment).
   */
  async getSpendableBalance(address: string): Promise<{
    balanceXrp: number;
    spendableXrp: number;
    reserveXrp: number;
    ownerCount: number;
    nextObjectReserveXrp: number;
  }> {
    const [acct, srv] = await Promise.all([
      this._request<{ account_data: any }>({ command: 'account_info', account: address, ledger_index: 'validated' }),
      this._request<{ info?: { validated_ledger?: any } }>({ command: 'server_info' }),
    ]);
    const data = acct.account_data;
    const ledger = srv?.info?.validated_ledger ?? {};
    const baseReserve = Number(ledger.reserve_base_xrp ?? 1);
    const incReserve = Number(ledger.reserve_inc_xrp ?? 0.2);
    const ownerCount = Number(data.OwnerCount ?? 0);
    const balanceXrp = Number(data.Balance) / 1_000_000;
    const reserveXrp = baseReserve + ownerCount * incReserve;
    return {
      balanceXrp,
      spendableXrp: Math.max(0, balanceXrp - reserveXrp),
      reserveXrp,
      ownerCount,
      nextObjectReserveXrp: incReserve,
    };
  }

  /**
   * Live per-object owner reserve (server_info `reserve_inc_xrp`) — the extra
   * XRP an EscrowCreate immobilizes in the account while the escrow exists.
   * Same live-read posture as getSpendableBalance: never hardcoded.
   */
  async getOwnerReserveXrp(): Promise<number> {
    const srv = await this._request<{ info?: { validated_ledger?: any } }>({ command: 'server_info' });
    return Number(srv?.info?.validated_ledger?.reserve_inc_xrp ?? 0.2);
  }

  /**
   * Resolves the OfferSequence an EscrowFinish needs: the Sequence of the
   * EscrowCreate transaction. The Escrow ledger object does not carry it, but
   * its PreviousTxnID points at the creating tx (for an untouched escrow) —
   * one read-only `tx` lookup recovers it. Returns null when the tx is not an
   * EscrowCreate (the escrow was modified) or cannot be found.
   */
  async getEscrowCreateSequence(previousTxnID: string): Promise<number | null> {
    try {
      const result = await this._request<{ tx_json?: any } & Record<string, any>>({
        command: 'tx',
        transaction: previousTxnID,
      });
      const tx = result?.tx_json ?? result;
      if (!tx || tx.TransactionType !== 'EscrowCreate') return null;
      return typeof tx.Sequence === 'number' ? tx.Sequence : null;
    } catch {
      return null;
    }
  }

  /**
   * The account's DID object (XLS-40, read-only) — the Legacy constitution
   * anchor. Returns the raw hex fields (Data/URI/DIDDocument) or null when the
   * account has no DID.
   */
  async getDidObject(
    address: string,
  ): Promise<{ dataHex?: string; uriHex?: string; didDocumentHex?: string } | null> {
    try {
      const res = await this._request<{ node?: Record<string, unknown> }>({
        command: 'ledger_entry',
        did: address,
        ledger_index: 'validated',
      });
      const node = res?.node;
      if (!node || node.LedgerEntryType !== 'DID') return null;
      return {
        dataHex: typeof node.Data === 'string' ? node.Data : undefined,
        uriHex: typeof node.URI === 'string' ? node.URI : undefined,
        didDocumentHex: typeof node.DIDDocument === 'string' ? node.DIDDocument : undefined,
      };
    } catch (err) {
      // entryNotFound/actNotFound = "no DID" — a real answer, not a failure.
      const code = (err as { data?: { error?: string } })?.data?.error;
      if (code === 'entryNotFound' || code === 'actNotFound') return null;
      throw err;
    }
  }

  /**
   * The account's DIDSet transactions, newest first (read-only) — for a
   * council-governed account this is the constitution's amendment history:
   * every entry was signed by the quorum of its day. `signers` is true when
   * the tx carried a multisig Signers array.
   */
  async getDidSetHistory(address: string, limit = 20): Promise<
    Array<{
      txHash: string;
      dateISO?: string;
      dataHex?: string;
      uriHex?: string;
      signedByQuorum: boolean;
    }>
  > {
    const res = await this._request<{ transactions?: any[] }>({
      command: 'account_tx',
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 200,
      forward: false,
    });
    const out: Array<{
      txHash: string;
      dateISO?: string;
      dataHex?: string;
      uriHex?: string;
      signedByQuorum: boolean;
    }> = [];
    for (const entry of res.transactions ?? []) {
      const tx = entry.tx_json ?? entry.tx;
      if (!tx || tx.TransactionType !== 'DIDSet' || tx.Account !== address) continue;
      if (entry.validated === false) continue;
      // Result-code guard (same bug family): a `tec`-class DIDSet is validated
      // and burns a fee but changes NO DID object. Rendering it as a ratified
      // constitution amendment would make this history and the live anchor
      // (getDidObject) silently disagree. Count ONLY what actually settled.
      // account_tx puts metadata under `meta` (verified against the real rsmv…
      // response: keys are meta/tx/validated). `metaData` is read too so an
      // api_version variance can never make the guard fall through silently.
      const meta = entry.meta ?? entry.metaData;
      const result = typeof meta === 'object' && meta ? meta.TransactionResult : undefined;
      if (result !== 'tesSUCCESS') continue;
      const closeTime = entry.close_time_iso ?? undefined;
      const rippleDate = typeof tx.date === 'number' ? tx.date : undefined;
      out.push({
        txHash: String(entry.hash ?? tx.hash ?? ''),
        dateISO:
          closeTime ??
          (rippleDate !== undefined
            ? new Date((rippleDate + 946_684_800) * 1000).toISOString()
            : undefined),
        dataHex: typeof tx.Data === 'string' ? tx.Data : undefined,
        uriHex: typeof tx.URI === 'string' ? tx.URI : undefined,
        signedByQuorum: Array.isArray(tx.Signers) && tx.Signers.length > 0,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * On-chain multisig activity of an account (read-only) — the REHEARSAL
   * verifier. A validated multisig tx carries a `Signers` array naming every
   * account that actually signed: that is the only truthful, per-member
   * record of who can sign (signature collection itself happens OFF-ledger,
   * so live progress is unknowable — this is the honest post-hoc read).
   */
  async getMultisigSignerActivity(address: string): Promise<{
    /** Every account seen signing a validated multisig tx of this account. */
    signersSeen: string[];
    /** Validated multisig EscrowCreate count (the rehearsal tx). */
    multisigEscrowCreates: number;
    /** A finish/cancel for one of this account's escrows was validated
     *  (permissionless — any sender counts; the rehearsal's second half). */
    escrowResolved: boolean;
  }> {
    const res = await this._request<{ transactions?: any[] }>({
      command: 'account_tx',
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 200,
      forward: false,
    });
    const signersSeen = new Set<string>();
    let multisigEscrowCreates = 0;
    let escrowResolved = false;
    for (const entry of res.transactions ?? []) {
      if (entry.validated === false) continue;
      // Result-code guard (bug family "lectura ciega al código de resultado"): a
      // `tec`-class multisig tx is validated and burns a fee but the OPERATION
      // never happened (e.g. tecINSUFFICIENT_RESERVE on the rehearsal
      // EscrowCreate, or tecNEED_MASTER_KEY on a multisig AccountSet). Counting
      // it would let a FAILED ceremony read as "rehearsal complete" and offer to
      // disable the master key (irreversible). Count ONLY what actually settled.
      // Verified against the test council rsmv…KDmrf: 6 validated-but-tec txs in
      // one ceremony — the gate was intact only by luck of which tx type failed.
      // account_tx puts metadata under `meta` (verified against the real rsmv…
      // response: keys are meta/tx/validated). `metaData` is read too so an
      // api_version variance can never make the guard fall through silently.
      const meta = entry.meta ?? entry.metaData;
      const result = typeof meta === 'object' && meta ? meta.TransactionResult : undefined;
      if (result !== 'tesSUCCESS') continue;
      const tx = entry.tx_json ?? entry.tx;
      if (!tx) continue;
      if (
        (tx.TransactionType === 'EscrowFinish' || tx.TransactionType === 'EscrowCancel') &&
        tx.Owner === address
      ) {
        escrowResolved = true;
      }
      if (tx.Account !== address || !Array.isArray(tx.Signers)) continue;
      for (const s of tx.Signers) {
        const signer = s?.Signer?.Account;
        if (typeof signer === 'string') signersSeen.add(signer);
      }
      if (tx.TransactionType === 'EscrowCreate') multisigEscrowCreates++;
    }
    return { signersSeen: [...signersSeen], multisigEscrowCreates, escrowResolved };
  }

  /**
   * The account's signer list ("el consejo", read-only): members with weights,
   * the quorum, and whether the master key is disabled (lsfDisableMaster,
   * 0x00100000) — disabled master + signer list = the account is governed ONLY
   * by its quorum. Returns null when the account has no signer list.
   */
  async getSignerCouncil(address: string): Promise<{
    quorum: number;
    masterKeyDisabled: boolean;
    signers: Array<{ account: string; weight: number }>;
  } | null> {
    const res = await this._request<{ account_data?: any; signer_lists?: any }>({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
      signer_lists: true,
    });
    const data = res?.account_data;
    if (!data) return null;
    // api_version variance, verified live against the real council rsmv…KDmrf:
    // v1 (the HTTPS JSON-RPC fallback, no api_version in the body) nests
    // `signer_lists` UNDER account_data; v2 — what xrpl.js ≥4 negotiates over
    // the websocket, i.e. the DEFAULT transport — returns it at the ROOT of the
    // result. Reading only one place made a genuinely multisig-only council read
    // as `null` = "not a council" on whichever transport won: silently on the
    // websocket, correctly over HTTPS. Same failure class the account_tx guards
    // above defend against, and the same disease as the bug family: a read that
    // cannot fail loudly answers with a determinate, wrong "no".
    const lists = res?.signer_lists ?? data.signer_lists ?? [];
    const list = Array.isArray(lists) ? lists[0] : undefined;
    if (!list || !Array.isArray(list.SignerEntries) || list.SignerEntries.length === 0) return null;
    return {
      quorum: Number(list.SignerQuorum ?? 0),
      masterKeyDisabled: (Number(data.Flags ?? 0) & 0x00100000) !== 0,
      signers: list.SignerEntries.map((e: any) => ({
        account: String(e?.SignerEntry?.Account ?? ''),
        weight: Number(e?.SignerEntry?.SignerWeight ?? 0),
      })),
    };
  }

  /**
   * The account's current Sequence on the validated ledger. A multisig tx must
   * fix its Sequence before ANY member signs, so every member signs identical
   * bytes — that is why the coordinator reads it once, up front.
   */
  async getAccountSequence(address: string): Promise<number> {
    const res = await this._request<{ account_data?: { Sequence?: number } }>({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    const seq = res?.account_data?.Sequence;
    if (typeof seq !== 'number') {
      throw new Error(`No Sequence for ${address} — is the account funded?`);
    }
    return seq;
  }

  /**
   * Network base fee in drops (validated ledger). A multisig transaction pays
   * `base x (1 + signerCount)`; the caller applies the multiplier. Never throws
   * on a metrics read — falls back to the XRPL protocol default of 10 drops.
   */
  async getBaseFeeDrops(): Promise<number> {
    try {
      const res = await this._request<{ info?: { validated_ledger?: { base_fee_xrp?: number } } }>({
        command: 'server_info',
      });
      const xrp = res?.info?.validated_ledger?.base_fee_xrp;
      if (typeof xrp !== 'number') return 10;
      return Math.max(10, Math.round(xrp * 1_000_000));
    } catch {
      return 10;
    }
  }

  /**
   * Dry-run a transaction against the validated ledger via the `simulate` RPC —
   * the XRPL half of invariant #11 (Tenderly covers EVM; this covers XRPL). It
   * returns the engine result and the EXACT balance deltas WITHOUT submitting
   * (`applied:false` on the network). Degrades to `available:false` on nodes
   * that do not implement `simulate` — a preflight must never block preparing.
   */
  async simulateTransaction(txjson: Record<string, unknown>): Promise<{
    available: boolean;
    willSucceed: boolean;
    engineResult?: string;
    engineResultMessage?: string;
    balanceChanges: Array<{ account: string; value: string; currency: string; issuer?: string }>;
  }> {
    try {
      const res = await this._request<any>({ command: 'simulate', tx_json: txjson });
      const engineResult: string | undefined = res?.engine_result;
      const meta = res?.meta ?? res?.metadata;
      const balanceChanges: Array<{ account: string; value: string; currency: string; issuer?: string }> = [];
      if (meta) {
        for (const c of getBalanceChanges(meta as never)) {
          for (const b of c.balances) {
            balanceChanges.push({
              account: c.account,
              value: b.value,
              currency: b.currency,
              ...(b.issuer ? { issuer: b.issuer } : {}),
            });
          }
        }
      }
      return {
        available: true,
        willSucceed: engineResult === 'tesSUCCESS',
        engineResult,
        engineResultMessage: res?.engine_result_message,
        balanceChanges,
      };
    } catch (err: any) {
      // Older rippled without `simulate` → preflight unavailable, not a failure.
      const code = err?.data?.error ?? err?.message ?? 'simulate_unavailable';
      return { available: false, willSucceed: false, engineResultMessage: String(code), balanceChanges: [] };
    }
  }

  /**
   * Reads an XLS-30 pool via `amm_info` (read-only). Assets are Currency
   * descriptors: `{currency:'XRP'}` or `{currency, issuer}`. Returns null when
   * the pool does not exist ("actNotFound"/"ammNotFound" from rippled).
   */
  async getAmmInfo(
    asset: { currency: string; issuer?: string },
    asset2: { currency: string; issuer?: string },
  ): Promise<AmmPoolInfo | null> {
    try {
      const result = await this._request<{ amm?: any }>({
        command: 'amm_info',
        asset,
        asset2,
        ledger_index: 'validated',
      });
      const amm = result?.amm;
      if (!amm) return null;
      return {
        ammAccount: amm.account,
        amount: amm.amount,
        amount2: amm.amount2,
        lpToken: amm.lp_token,
        tradingFee: amm.trading_fee,
        assetFrozen: amm.asset_frozen === true || amm.asset2_frozen === true,
      };
    } catch (err: any) {
      const code = err?.data?.error ?? err?.message ?? '';
      if (String(code).includes('NotFound')) return null;
      throw err;
    }
  }

  /**
   * Returns a Soil vault position if the user holds Soil vault shares.
   * Returns null if SOIL_VAULT_ISSUER is not configured or no position found.
   *
   * XLS-66 is pending mainnet — this is forward-compatible.
   * Once Soil deploys, set SOIL_VAULT_ISSUER to the vault contract account.
   */
  async getSoilVaultPosition(address: string): Promise<SoilPosition | null> {
    if (!SOIL_VAULT_ISSUER) return null;
    try {
      const lines = await this.getTokenBalances(address);
      const soilLine = lines.find(
        (l) => l.issuer === SOIL_VAULT_ISSUER && parseFloat(l.balance) > 0,
      );
      if (!soilLine) return null;
      return {
        vaultIssuer: SOIL_VAULT_ISSUER,
        shareBalance: soilLine.balance,
        underlyingCurrency: 'RLUSD',
        // 1:1 estimate until Soil publishes a NAV endpoint
        estimatedValueRLUSD: soilLine.balance,
      };
    } catch {
      return null;
    }
  }

  /** Returns whether the account holds RLUSD (Ripple USD stablecoin on XRPL). */
  async getRLUSDBalance(address: string): Promise<string | null> {
    const lines = await this.getTokenBalances(address);
    const rlusd = lines.find(
      (l) => l.issuer === RLUSD_ISSUER && l.currency === 'RLUSD' && parseFloat(l.balance) > 0,
    );
    return rlusd?.balance ?? null;
  }

  private _source(traceId: string): SourceRecord {
    return {
      providerId: this.id,
      providerType: 'chain',
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };
  }
}

export const xrplProvider = new XRPLProvider();
