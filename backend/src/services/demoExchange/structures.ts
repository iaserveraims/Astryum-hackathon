/**
 * demoExchange/structures — the registry of STRUCTURES a tenant gave birth to,
 * and the gate that decides which ceremony step may be composed next.
 *
 * A structure is a COMMANDED XRPL account: the user's PERSONAL account is seated
 * in its signer list — alone, or as one of a quorum — and that is what makes it
 * "a subwallet". The authority tree is the USER's, not the exchange's; the
 * exchange only funnels money. Design and seat chart in
 * `docs/context/Astryum_Exchange_2_Estructuras_Bajo_El_Omnibus_2026-09-18.md`;
 * the verdicts (who can bind it, reserve figure, door lock) are pure and live in
 * `connectors/protocols/xrpl/XrplStructureBirth.ts`.
 *
 * WHAT THIS STORES AND WHAT IT NEVER STORES. Rows here are POINTERS plus the
 * hash of each act: the kind, the governance, the address, the seat chart and
 * one record per ceremony step. The STATE is never stored — whether the signer
 * list exists, whether the master key is disabled, whether the credential is
 * still valid is read fresh from the ledger on every paint (getSignerCouncil).
 * Losing this table loses pointers, never governance.
 *
 * THE GATE THIS FILE EXISTS FOR. `planStructureBirth` says a step waits for
 * others; that is a plan, not enforcement. `stepBlockedBy` is the enforcement:
 * a step is composed ONLY when every step it waits for is recorded as validated
 * on the ledger, with its hash. Without it the irreversible one — the door,
 * `AccountSet(asfDisableMaster)` — could be composed before the rehearsal and
 * strand the account forever. Pure, so it is testable.
 */
import type { BirthStep, BirthStepId, StructureGovernance, StructureKind, StructureSeat } from '../../connectors/protocols/xrpl/XrplStructureBirth';

/** One ceremony step, once the ledger validated it. Written only after a read. */
export interface StructureStepRecord {
  step: BirthStepId;
  txHash: string;
  /** The validated ledger index the transaction entered. */
  ledgerIndex?: number;
  at: string;
  /** What was read to accept the hash (so a reviewer can re-read it). */
  observed?: string;
}

export interface DemoStructure {
  id: string;
  runId: string;
  /** What the holder calls it ("Familia Ortega", "Acme SL"). Never PII. */
  label: string;
  kind: StructureKind;
  governance: StructureGovernance;
  /** The captive account. Born in its holder's own wallet app — never here. */
  address: string;
  /** The declared seat chart. The LEDGER is the truth; this is what was asked for. */
  seats: StructureSeat[];
  quorum: number;
  designation: boolean;
  carriesOwnCredentials: boolean;
  /** Does this account pay, by itself, into a credential-gated destination? */
  paysThroughCredentialGate: boolean;
  /** The user's PERSONAL account: the one seated here that commands it. */
  rootAddress: string;
  /** Which exchange client (casilla) this structure belongs to, when it has one. */
  clientId?: string;
  /** What the omnibus was told to sponsor, frozen at declaration time. */
  fundingXrp: number;
  steps: StructureStepRecord[];
  createdAt: string;
  /** Set when the door validated: from here the account has no key at all. */
  doorClosedAt?: string;
}

export function structuresOf(run: { structures?: DemoStructure[] }): DemoStructure[] {
  if (!run.structures) run.structures = [];
  return run.structures;
}

export function findStructure(
  run: { structures?: DemoStructure[] },
  structureId: string,
): DemoStructure | undefined {
  return structuresOf(run).find((s) => s.id === structureId);
}

/** An address is one structure per tenant: two rows would fork its book of acts. */
export function structureByAddress(
  run: { structures?: DemoStructure[] },
  address: string,
): DemoStructure | undefined {
  return structuresOf(run).find((s) => s.address === address);
}

export function stepsDone(structure: Pick<DemoStructure, 'steps'>): Set<BirthStepId> {
  return new Set((structure.steps ?? []).filter((s) => !!s.txHash).map((s) => s.step));
}

export interface StepBlock {
  /** Steps this one waits for that are not recorded as validated yet. */
  missing: BirthStepId[];
  /** Already done — composing it again would pay a fee for nothing. */
  alreadyDone: boolean;
  /** Not part of this structure's plan at all (e.g. designate when none was asked). */
  notInPlan: boolean;
  reason?: string;
}

/**
 * May this step be composed right now? The only answer that matters is the one
 * that says NO before the bytes exist.
 */
export function stepBlockedBy(
  plan: { steps: BirthStep[] },
  structure: Pick<DemoStructure, 'steps'>,
  step: BirthStepId,
): StepBlock {
  const planned = plan.steps.find((s) => s.id === step);
  if (!planned) {
    return {
      missing: [],
      alreadyDone: false,
      notInPlan: true,
      reason: `This structure's ceremony has no step "${step}" — the plan is ${plan.steps.map((s) => s.id).join(' → ')}.`,
    };
  }
  const done = stepsDone(structure);
  if (done.has(step)) {
    return {
      missing: [],
      alreadyDone: true,
      notInPlan: false,
      reason: `Step "${step}" already validated on the ledger — composing it again would pay a fee for nothing.`,
    };
  }
  const missing = planned.after.filter((prev) => !done.has(prev));
  if (missing.length > 0) {
    const tail = planned.irreversible
      ? ' This step cannot be undone: once the master key is disabled, an unconvenable quorum is final.'
      : '';
    return {
      missing,
      alreadyDone: false,
      notInPlan: false,
      reason: `Step "${step}" waits for ${missing.join(' and ')} to be validated on the ledger first.${tail}`,
    };
  }
  return { missing: [], alreadyDone: false, notInPlan: false };
}

/** Human progress for a surface: which steps are done, which is next. */
export function structureProgress(
  plan: { steps: BirthStep[] },
  structure: Pick<DemoStructure, 'steps'>,
): { done: BirthStepId[]; next: BirthStepId | null; total: number } {
  const done = stepsDone(structure);
  const next = plan.steps.find((s) => !done.has(s.id) && s.after.every((p) => done.has(p)));
  return {
    done: plan.steps.filter((s) => done.has(s.id)).map((s) => s.id),
    next: next ? next.id : null,
    total: plan.steps.length,
  };
}

/** Stable, readable id: `st-<seq>-<ordinal>` within the tenant. */
export function nextStructureId(run: { seq: number; structures?: DemoStructure[] }): string {
  const ordinal = structuresOf(run).length + 1;
  return `st-${run.seq}-${ordinal}`;
}
