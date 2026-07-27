/**
 * preparePreflight — invariant #11's FIRST half ("simulation before signature")
 * for the flare-demo /prepare endpoints. Every prepare that hands the user
 * something to sign attaches a `preflight` verdict so the UI can say, BEFORE
 * the wallet opens, whether the dry-run expects the operation to execute.
 *
 * Posture (same as the council preflight, XrplMultisigCoordinator):
 *   - the preflight NEVER blocks or fails a prepare — any simulator problem
 *     degrades to `available: false`, the response is otherwise identical;
 *   - `willSucceed: false` is only ever a PROVEN verdict (a revert / Compound
 *     error code / XRPL engine result observed in a dry-run), never a guess.
 *
 * EVM reality check: the public Flare RPC has no `eth_simulateV1` (verified
 * 2026-07-25), so calls of one batch CANNOT be simulated with chained state.
 * A step that needs state an EARLIER step of the same batch creates (approve →
 * mint, enterMarkets → borrow) would revert against today's state — a FALSE
 * negative. Those steps are marked `dependsOnPrior` by the route (which knows
 * the batch shape) and reported honestly as 'unverified', never as failures.
 *
 * Everything here is READ-ONLY (eth_call / XRPL `simulate`): Astryum keeps
 * signing nothing and broadcasting nothing.
 */

import { ethers } from 'ethers';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';

export interface PreflightStep {
  label: string;
  verdict: 'ok' | 'fail' | 'unverified';
  reason?: string;
}

export interface PreflightResult {
  /** false = the dry-run itself could not run (node down / unsupported) — say so, never block. */
  available: boolean;
  /** false ONLY on a proven failure; meaningless when available=false. */
  willSucceed: boolean;
  /** first proven failure (or why the dry-run is unavailable), human-readable. */
  reason?: string;
  /** per-step detail — 'unverified' marks batch-dependent steps that cannot be dry-run in isolation. */
  steps?: PreflightStep[];
  /** merged verdicts only: at least one leg could NOT run — the green is INCOMPLETE and says so. */
  partial?: boolean;
}

export interface EvmPreflightCall {
  to: string;
  data: string;
  value?: string;
  label?: string;
  /** Needs state a PRIOR call of this same batch creates → skip (honest 'unverified'), never a false negative. */
  dependsOnPrior?: boolean;
  /** Compound-v2-style call (Kinetic kToken/comptroller): failure is a RETURNED uint error code, not a revert. */
  compoundErrorCode?: boolean;
}

/** Total budget for one preflight — a slow node degrades to available=false, it never hangs the prepare. */
export const PREFLIGHT_TIMEOUT_MS = 8_000;

/** Compound v2 ErrorReporter codes — what a Kinetic kToken RETURNS instead of reverting. */
const COMPOUND_ERRORS = [
  'NO_ERROR',
  'UNAUTHORIZED',
  'BAD_INPUT',
  'COMPTROLLER_REJECTION',
  'COMPTROLLER_CALCULATION_ERROR',
  'INTEREST_RATE_MODEL_ERROR',
  'INVALID_ACCOUNT_PAIR',
  'INVALID_CLOSE_AMOUNT_REQUESTED',
  'INVALID_COLLATERAL_FACTOR',
  'MATH_ERROR',
  'MARKET_NOT_FRESH',
  'MARKET_NOT_LISTED',
  'TOKEN_INSUFFICIENT_ALLOWANCE',
  'TOKEN_INSUFFICIENT_BALANCE',
  'TOKEN_INSUFFICIENT_CASH',
  'TOKEN_TRANSFER_IN_FAILED',
  'TOKEN_TRANSFER_OUT_FAILED',
];

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** A CALL_EXCEPTION is an ANSWER (the call reverts); everything else is transport. */
function isCallException(e: unknown): boolean {
  return (e as { code?: string })?.code === 'CALL_EXCEPTION';
}

function decodeRevertReason(e: unknown): string {
  const err = e as { reason?: string; revert?: { name?: string; args?: unknown[] }; shortMessage?: string; message?: string };
  if (err.revert?.name) {
    const args = (err.revert.args ?? []).map(String).join(', ');
    return `${err.revert.name}(${args})`;
  }
  return err.reason ?? err.shortMessage ?? err.message ?? 'execution reverted';
}

/** Decode a Compound-style return: uint256, or uint256[] (enterMarkets). 0 = success. */
function decodeCompoundCode(ret: string): bigint | null {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  try {
    if (ethers.dataLength(ret) === 32) return coder.decode(['uint256'], ret)[0] as bigint;
    const arr = coder.decode(['uint256[]'], ret)[0] as bigint[];
    return arr.length > 0 ? arr[0] : 0n;
  } catch {
    return null; // not a code-shaped return — treat as no verdict, not a failure
  }
}

function compoundErrorName(code: bigint): string {
  const i = Number(code);
  return COMPOUND_ERRORS[i] ?? `COMPOUND_ERROR_${i}`;
}

/**
 * Dry-run one prepared EVM batch, call by call, `from` = the account that will
 * sign (or the Personal Account that will execute). First PROVEN failure ⇒
 * willSucceed=false with the decoded reason.
 */
export async function preflightEvmCalls(
  provider: ethers.JsonRpcProvider,
  from: string,
  calls: EvmPreflightCall[],
): Promise<PreflightResult> {
  const steps: PreflightStep[] = [];
  let reason: string | undefined;
  const deadline = Date.now() + PREFLIGHT_TIMEOUT_MS;
  try {
    for (const c of calls) {
      const label = c.label || c.to;
      if (c.dependsOnPrior) {
        steps.push({
          label,
          verdict: 'unverified',
          reason: 'depends on an earlier step of this same batch — cannot be dry-run in isolation',
        });
        continue;
      }
      const budget = deadline - Date.now();
      if (budget <= 0) throw new Error('preflight budget exhausted');
      try {
        const ret = await withTimeout(
          provider.call({
            from,
            to: c.to,
            data: c.data,
            ...(c.value && c.value !== '0' ? { value: BigInt(c.value) } : {}),
          }),
          budget,
          `eth_call ${label}`,
        );
        if (c.compoundErrorCode) {
          const code = decodeCompoundCode(ret);
          if (code != null && code !== 0n) {
            const msg = `Kinetic would refuse: ${compoundErrorName(code)}`;
            steps.push({ label, verdict: 'fail', reason: msg });
            reason ??= `${label} — ${msg}`;
            continue;
          }
        }
        steps.push({ label, verdict: 'ok' });
      } catch (e) {
        if (!isCallException(e)) throw e; // transport problem → whole dry-run unavailable
        const msg = decodeRevertReason(e);
        steps.push({ label, verdict: 'fail', reason: msg });
        reason ??= `${label} — ${msg}`;
      }
    }
  } catch (e) {
    return {
      available: false,
      willSucceed: false,
      reason: `dry-run unavailable: ${((e as Error).message ?? String(e)).slice(0, 200)}`,
      steps,
    };
  }
  const failed = steps.some((s) => s.verdict === 'fail');
  const checked = steps.filter((s) => s.verdict === 'ok').length;
  if (!failed && checked === 0) {
    return {
      available: false,
      willSucceed: false,
      reason: 'no step of this batch can be dry-run in isolation on this node',
      steps,
    };
  }
  return { available: true, willSucceed: !failed, reason, steps };
}

/**
 * Dry-run the prepared XRPL Payment via the ledger `simulate` RPC (funds,
 * reserve, destination — the exact engine result WITHOUT submitting). The
 * prepared payment carries no Account (the wallet injects it) — pin the known
 * signer here so the simulation runs against the right balance.
 */
export async function preflightXrplPayment(
  xrplPayment: Record<string, unknown>,
  account: string,
): Promise<PreflightResult> {
  try {
    const sim = await withTimeout(
      xrplProvider.simulateTransaction({ ...xrplPayment, Account: account }),
      PREFLIGHT_TIMEOUT_MS,
      'xrpl simulate',
    );
    if (!sim.available) {
      return {
        available: false,
        willSucceed: false,
        reason: sim.engineResultMessage ?? 'this XRPL node does not support simulate',
      };
    }
    const detail = [sim.engineResult, sim.engineResultMessage].filter(Boolean).join(' — ');
    return {
      available: true,
      willSucceed: sim.willSucceed,
      ...(sim.willSucceed ? {} : { reason: `XRPL dry-run says the Payment would fail: ${detail}` }),
      steps: [
        {
          label: 'XRPL Payment',
          verdict: sim.willSucceed ? 'ok' : 'fail',
          ...(sim.willSucceed ? {} : { reason: detail }),
        },
      ],
    };
  } catch (e) {
    return {
      available: false,
      willSucceed: false,
      reason: `dry-run unavailable: ${((e as Error).message ?? String(e)).slice(0, 200)}`,
    };
  }
}

/**
 * Merge the rails of one prepare (e.g. the XRPL Payment + the inner 0xFE EVM
 * batch it dispatches): available if ANY part could run; a proven failure in
 * ANY available part fails the whole; steps concatenate in order.
 */
export function mergePreflights(...parts: PreflightResult[]): PreflightResult {
  const available = parts.some((p) => p.available);
  const failing = parts.find((p) => p.available && !p.willSucceed);
  const blind = parts.find((p) => !p.available);
  const steps = parts.flatMap((p) => p.steps ?? []);
  if (!available) {
    return {
      available: false,
      willSucceed: false,
      reason: parts.map((p) => p.reason).filter(Boolean)[0],
      ...(steps.length ? { steps } : {}),
    };
  }
  // A blind leg must never be SWALLOWED by the other leg's green (escaneo #4):
  // the verdict stays willSucceed (no PROVEN failure) but is marked partial and
  // names what could not be simulated — the UI degrades its green accordingly.
  return {
    available: true,
    willSucceed: !failing,
    ...(failing?.reason
      ? { reason: failing.reason }
      : blind
        ? { reason: `veredicto parcial — una pierna no pudo simularse: ${blind.reason ?? 'sin detalle'}` }
        : {}),
    ...(blind ? { partial: true } : {}),
    ...(steps.length ? { steps } : {}),
  };
}
