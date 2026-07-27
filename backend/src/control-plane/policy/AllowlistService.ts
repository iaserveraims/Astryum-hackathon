import * as fs from 'fs';
import * as path from 'path';
import type { ActionType } from '../../canonical/types/Action';

interface RuntimeContractEntry {
  readonly address: string;
  readonly name?: string;
  readonly symbol?: string;
  readonly actions?: ReadonlyArray<string>;
}

interface RuntimeAllowlist {
  readonly chainId: number;
  readonly protocol?: string;
  readonly contracts?: ReadonlyArray<RuntimeContractEntry>;
  readonly comptroller?: string;
  readonly cTokens?: ReadonlyArray<{ readonly address: string }>;
  readonly nfpm?: string;
  readonly router?: string;
  readonly factory?: string;
  readonly staking?: string;
  readonly stXRP?: string;
}

/**
 * Loads `*.runtime.json` files from `backend/src/config/` at boot and exposes
 * O(1) checks of `(protocol, address, action) → allowed`.
 *
 * The Kinetic file uses a `cTokens[]` shape from S2 (verify-kinetic script);
 * other protocols use the canonical `contracts[]` shape. Both are normalized
 * to a `(protocol, address) → Set<action>` index.
 *
 * Spec: docs/POLICY_GUARD.md §5.
 */
export class AllowlistService {
  private readonly index = new Map<string, Map<string, Set<string>>>();
  private readonly chainOf = new Map<string, number>();
  private loaded = false;

  constructor(private readonly configDir: string = path.join(__dirname, '..', '..', 'config')) {}

  /** Idempotent. Re-callable after a file rewrite (admin reload). */
  load(): void {
    this.index.clear();
    this.chainOf.clear();
    if (!fs.existsSync(this.configDir)) {
      this.loaded = true;
      return;
    }
    const files = fs.readdirSync(this.configDir).filter((f) => f.endsWith('.runtime.json'));
    for (const file of files) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(this.configDir, file), 'utf8'),
        ) as RuntimeAllowlist;
        const protocolId = raw.protocol ?? file.replace('.runtime.json', '');
        this.absorb(protocolId, raw);
      } catch (err) {
        console.warn(`[allowlist] failed to load ${file}: ${(err as Error).message}`);
      }
    }
    this.loaded = true;
  }

  private absorb(protocolId: string, raw: RuntimeAllowlist): void {
    const proto = protocolId.toLowerCase();
    let bucket = this.index.get(proto);
    if (!bucket) {
      bucket = new Map();
      this.index.set(proto, bucket);
    }
    this.chainOf.set(proto, raw.chainId);

    if (raw.contracts) {
      for (const c of raw.contracts) {
        addr(bucket, c.address, c.actions ?? []);
      }
    }
    if (raw.comptroller) addr(bucket, raw.comptroller, ['enter_market', 'exit_market']);
    if (raw.cTokens) {
      for (const t of raw.cTokens) {
        addr(bucket, t.address, ['supply', 'withdraw', 'borrow', 'repay']);
      }
    }
    if (raw.nfpm) addr(bucket, raw.nfpm, ['addLiquidity', 'exitLP', 'harvest']);
    if (raw.router) addr(bucket, raw.router, ['swap', 'addLiquidity', 'exitLP']);
    if (raw.factory) addr(bucket, raw.factory, []);
    if (raw.staking) addr(bucket, raw.staking, ['stake', 'unstake', 'claimRewards']);
    if (raw.stXRP) addr(bucket, raw.stXRP, ['stake', 'unstake']);
  }

  isAllowed(protocol: string, address: string, action: ActionType): boolean {
    if (!this.loaded) this.load();
    const bucket = this.index.get(protocol.toLowerCase());
    if (!bucket) return false;
    const acts = bucket.get(address.toLowerCase());
    if (!acts) return false;
    if (acts.size === 0) return true; // entry exists but no action restriction declared
    return acts.has(action) || acts.has(snake(action));
  }

  hasContract(protocol: string, address: string): boolean {
    if (!this.loaded) this.load();
    const bucket = this.index.get(protocol.toLowerCase());
    return Boolean(bucket?.has(address.toLowerCase()));
  }

  chainOfProtocol(protocol: string): number | undefined {
    if (!this.loaded) this.load();
    return this.chainOf.get(protocol.toLowerCase());
  }

  /** P35: returns true if the address appears in ANY allowlisted protocol. */
  knownAddress(address: string): boolean {
    if (!this.loaded) this.load();
    const lower = address.toLowerCase();
    for (const bucket of this.index.values()) {
      if (bucket.has(lower)) return true;
    }
    return false;
  }

  /** Diagnostics for the admin reload endpoint. */
  stats(): Record<string, number> {
    if (!this.loaded) this.load();
    const out: Record<string, number> = {};
    for (const [proto, bucket] of this.index) out[proto] = bucket.size;
    return out;
  }
}

function addr(bucket: Map<string, Set<string>>, address: string, actions: ReadonlyArray<string>): void {
  const k = address.toLowerCase();
  let s = bucket.get(k);
  if (!s) {
    s = new Set();
    bucket.set(k, s);
  }
  for (const a of actions) s.add(a);
}

/** camelCase canonical action → snake_case form found in legacy runtime jsons. */
function snake(action: string): string {
  return action.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export const allowlistService = new AllowlistService();
