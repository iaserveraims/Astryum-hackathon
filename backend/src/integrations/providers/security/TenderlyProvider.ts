/**
 * TenderlyProvider — FASE 6 Security Partners
 *
 * Simulation cross-validation and trace analysis via the Tenderly API.
 * Acts as a second opinion on calldata produced by CalldataBuilder, Enso,
 * or any other preparation provider before presenting a TransactionIntent
 * to the user.
 *
 * Cross-validation flow:
 *   1. Another provider (e.g. Enso, 1inch) builds unsigned calldata.
 *   2. `security.crossValidateCalldata` submits that calldata to Tenderly Simulate.
 *   3. Tenderly returns: success/revert, gas estimate, decoded output, call trace.
 *   4. If the simulation reverts, the intent is flagged UNSAFE before user sees it.
 *   5. Significant gas divergence (>30%) also triggers a WARNING flag.
 *
 * Capabilities:
 *   security.simulateTransaction   — simulate any raw tx through Tenderly
 *   security.crossValidateCalldata — validate a prepared-intent calldata object
 *   security.getTrace              — fetch full call trace for a confirmed on-chain tx
 *
 * Env vars:
 *   TENDERLY_API_KEY         — access key (X-Access-Key header). Required.
 *   TENDERLY_ACCOUNT_SLUG    — account slug from dashboard (e.g. "astryum").
 *   TENDERLY_PROJECT_SLUG    — project slug (e.g. "v1").
 *   TENDERLY_API_URL         — base URL (default: https://api.tenderly.co/api/v1)
 */

import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel } from '../../../canonical/types/Source';

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.TENDERLY_API_URL ?? 'https://api.tenderly.co/api/v1';
// Resolved lazily so Jest env overrides in beforeEach() take effect at call time.
const apiKey       = (): string => process.env.TENDERLY_API_KEY        ?? '';
const accountSlug  = (): string => process.env.TENDERLY_ACCOUNT_SLUG   ?? 'astryum';
const projectSlug  = (): string => process.env.TENDERLY_PROJECT_SLUG   ?? 'v1';

const HEALTH_TIMEOUT_MS = 6000;
const FETCH_TIMEOUT_MS  = 30000;

/** If Tenderly gas estimate diverges from provider estimate by more than this fraction, flag WARNING. */
const GAS_DIVERGENCE_THRESHOLD = 0.30;

// ── Domain types ──────────────────────────────────────────────────────────────

export interface TenderlySimulateInput {
  /** Chain ID as a number (e.g. 14 = Flare, 1 = Ethereum). */
  chainId: number;
  /** Transaction sender address. */
  from: string;
  /** Contract address to call. */
  to: string;
  /** ABI-encoded calldata (hex string starting with 0x). */
  input: string;
  /** Native value to send in wei (default: '0'). */
  value?: string;
  /** Gas limit for the simulation (default: 8_000_000). */
  gas?: number;
  /** Save failed simulations in the Tenderly dashboard for debugging. */
  saveIfFails?: boolean;
}

export interface TenderlySimulationResult {
  /** Whether the transaction executed without reverting. */
  success: boolean;
  /** Gas actually used during simulation. */
  gasUsed: number;
  /** EVM revert reason string (undefined if success). */
  revertReason?: string;
  /** Address of the contract that caused the revert. */
  revertingAddress?: string;
  /** Decoded output from the call (if ABI is verified on Tenderly). */
  decodedOutput?: unknown;
  /** Decoded events emitted during the simulation. */
  events?: TenderlyEvent[];
  /** Top-level call trace (first level of the stack). */
  callTrace?: TenderlyCallFrame;
  /** Raw Tenderly simulation ID for linking to dashboard. */
  simulationId?: string;
}

export interface TenderlyEvent {
  name: string;
  inputs: Array<{ name: string; type: string; value: unknown }>;
  address: string;
}

export interface TenderlyCallFrame {
  type: string;       // 'CALL' | 'STATICCALL' | 'DELEGATECALL' | 'CREATE'
  from: string;
  to: string;
  gas: number;
  gasUsed: number;
  input: string;
  output?: string;
  error?: string;
  calls?: TenderlyCallFrame[];
}

export interface CrossValidateCalldataInput {
  chainId: number;
  from: string;
  to: string;
  input: string;
  value?: string;
  /** Gas estimate from the original provider — used for divergence check. */
  providerGasEstimate?: number;
  /** Human-readable label for logging (e.g. 'enso:supply+borrow'). */
  label?: string;
}

export interface CrossValidateCalldataResult {
  /** 'SAFE' = simulated success, no major warnings. */
  verdict: 'SAFE' | 'UNSAFE' | 'WARNING';
  simulation: TenderlySimulationResult;
  warnings: string[];
  /** Dashboard URL for this simulation. */
  dashboardUrl?: string;
}

export interface GetTraceInput {
  chainId: number;
  txHash: string;
}

// ── Capabilities ──────────────────────────────────────────────────────────────

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'security.simulateTransaction',
  'security.crossValidateCalldata',
  'security.getTrace',
]);

// ── Provider ──────────────────────────────────────────────────────────────────

export class TenderlyProvider implements IProvider {
  readonly id = 'tenderly';
  readonly type: ProviderType = 'security';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 90;
  readonly capabilities = CAPS;

  private get headers(): Record<string, string> {
    const key = apiKey();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(key ? { 'X-Access-Key': key } : {}),
    };
  }

  private get projectPath(): string {
    return `${BASE_URL}/account/${accountSlug()}/project/${projectSlug()}`;
  }

  // ── health ──────────────────────────────────────────────────────────────────

  async health(): Promise<ProviderHealth> {
    if (!apiKey()) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'TENDERLY_API_KEY not set',
      };
    }
    const start = Date.now();
    try {
      // Lightweight probe: fetch WETH contract info (always exists on Ethereum)
      const resp = await fetch(`${BASE_URL}/public-contracts/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, {
        headers: this.headers,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return {
        status: resp.status < 500 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.status < 500 ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
  }

  // ── call ────────────────────────────────────────────────────────────────────

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    switch (capability) {
      case 'security.simulateTransaction':
        return { data: await this.simulateTransaction(input as TenderlySimulateInput) as TOut, source, cached: false };

      case 'security.crossValidateCalldata':
        return { data: await this.crossValidateCalldata(input as CrossValidateCalldataInput) as TOut, source, cached: false };

      case 'security.getTrace':
        return { data: await this.getTrace(input as GetTraceInput) as TOut, source, cached: false };

      default:
        throw new Error(`TenderlyProvider: unsupported capability '${capability}'`);
    }
  }

  // ── simulateTransaction ──────────────────────────────────────────────────

  async simulateTransaction(input: TenderlySimulateInput): Promise<TenderlySimulationResult> {
    if (!apiKey()) throw new Error('TENDERLY_API_KEY not set');

    const body = {
      network_id:      String(input.chainId),
      from:            input.from,
      to:              input.to,
      input:           input.input,
      value:           input.value ?? '0',
      gas:             input.gas ?? 8_000_000,
      gas_price:       '0',
      simulation_type: 'full',
      save:            false,
      save_if_fails:   input.saveIfFails ?? true,
    };

    const resp = await fetch(`${this.projectPath}/simulate`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Tenderly simulate HTTP ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    return this.parseSimulationResponse(data);
  }

  // ── crossValidateCalldata ────────────────────────────────────────────────

  async crossValidateCalldata(input: CrossValidateCalldataInput): Promise<CrossValidateCalldataResult> {
    const simulation = await this.simulateTransaction({
      chainId:      input.chainId,
      from:         input.from,
      to:           input.to,
      input:        input.input,
      value:        input.value,
      saveIfFails:  true,
    });

    const warnings: string[] = [];

    if (!simulation.success) {
      return {
        verdict: 'UNSAFE',
        simulation,
        warnings: [`Transaction reverts: ${simulation.revertReason ?? 'unknown reason'}`],
        dashboardUrl: this.buildDashboardUrl(simulation.simulationId),
      };
    }

    // Gas divergence check
    if (input.providerGasEstimate && input.providerGasEstimate > 0) {
      const divergence = Math.abs(simulation.gasUsed - input.providerGasEstimate) / input.providerGasEstimate;
      if (divergence > GAS_DIVERGENCE_THRESHOLD) {
        warnings.push(
          `Gas divergence ${(divergence * 100).toFixed(1)}% ` +
          `(provider estimate: ${input.providerGasEstimate}, Tenderly actual: ${simulation.gasUsed})`,
        );
      }
    }

    // Check for suspicious delegate-calls to unverified contracts
    if (simulation.callTrace) {
      const delegateCalls = this.extractDelegateCalls(simulation.callTrace);
      if (delegateCalls.length > 0) {
        warnings.push(`Detected ${delegateCalls.length} DELEGATECALL(s) — review call trace carefully`);
      }
    }

    const verdict: CrossValidateCalldataResult['verdict'] = warnings.length > 0 ? 'WARNING' : 'SAFE';

    return {
      verdict,
      simulation,
      warnings,
      dashboardUrl: this.buildDashboardUrl(simulation.simulationId),
    };
  }

  // ── getTrace ─────────────────────────────────────────────────────────────

  async getTrace(input: GetTraceInput): Promise<TenderlyCallFrame | null> {
    if (!apiKey()) throw new Error('TENDERLY_API_KEY not set');

    const resp = await fetch(`${this.projectPath}/transactions/${input.txHash}/trace`, {
      headers: this.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (resp.status === 404) return null;
    if (!resp.ok) {
      throw new Error(`Tenderly getTrace HTTP ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    const trace = data.call_trace as Record<string, unknown> | undefined;
    return trace ? this.parseCallFrame(trace) : null;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private parseSimulationResponse(raw: Record<string, unknown>): TenderlySimulationResult {
    // Tenderly wraps the result under `simulation` key
    const sim = (raw.simulation ?? raw) as Record<string, unknown>;
    const tx  = (raw.transaction ?? {}) as Record<string, unknown>;

    const success: boolean = sim.status === true || sim.status === 'pass' || !(sim.error_message);

    const gasUsed: number =
      typeof sim.gas_used === 'number' ? sim.gas_used :
      typeof tx.gas_used  === 'number' ? tx.gas_used  : 0;

    const revertReason: string | undefined =
      !success
        ? String(sim.error_message ?? sim.revert_reason ?? tx.error_message ?? 'Execution reverted')
        : undefined;

    const revertingAddress: string | undefined =
      !success
        ? (((sim.error_info as Record<string, unknown> | undefined)?.address as string | undefined) ??
           ((tx.error_info   as Record<string, unknown> | undefined)?.address as string | undefined))
        : undefined;

    const events: TenderlyEvent[] = [];
    if (Array.isArray(tx.decoded_events)) {
      for (const ev of tx.decoded_events as Record<string, unknown>[]) {
        events.push({
          name:    String(ev.name ?? ''),
          address: String(ev.address ?? ''),
          inputs:  Array.isArray(ev.inputs) ? ev.inputs as TenderlyEvent['inputs'] : [],
        });
      }
    }

    const callTraceRaw = (tx.call_trace ?? sim.call_trace) as Record<string, unknown> | undefined;
    const callTrace    = callTraceRaw ? this.parseCallFrame(callTraceRaw) : undefined;

    return {
      success,
      gasUsed,
      revertReason,
      revertingAddress,
      decodedOutput: tx.decoded_output,
      events,
      callTrace,
      simulationId: sim.id as string | undefined,
    };
  }

  private parseCallFrame(raw: Record<string, unknown>): TenderlyCallFrame {
    return {
      type:    String(raw.type ?? 'CALL'),
      from:    String(raw.from ?? ''),
      to:      String(raw.to ?? ''),
      gas:     Number(raw.gas ?? 0),
      gasUsed: Number(raw.gas_used ?? 0),
      input:   String(raw.input ?? '0x'),
      output:  raw.output as string | undefined,
      error:   raw.error as string | undefined,
      calls:   Array.isArray(raw.calls)
        ? (raw.calls as Record<string, unknown>[]).map((c) => this.parseCallFrame(c))
        : undefined,
    };
  }

  private extractDelegateCalls(frame: TenderlyCallFrame): TenderlyCallFrame[] {
    const found: TenderlyCallFrame[] = [];
    if (frame.type === 'DELEGATECALL') found.push(frame);
    for (const child of frame.calls ?? []) {
      found.push(...this.extractDelegateCalls(child));
    }
    return found;
  }

  private buildDashboardUrl(simulationId?: string): string | undefined {
    if (!simulationId) return undefined;
    return `https://dashboard.tenderly.co/${accountSlug()}/${projectSlug()}/simulator/${simulationId}`;
  }
}

export const tenderlyProvider = new TenderlyProvider();
