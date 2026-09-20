/**
 * orphanSubOrgLedger — where an ORPHANED Turnkey sub-org is written down.
 *
 * WHAT AN ORPHAN IS. `POST /api/wallets/embedded/create` calls Turnkey first (the
 * widest network window in the repo) and writes our `wallet` row second. When the
 * second half fails — a revoked session, the takeover's lock, a pool timeout, a
 * unique clash — a sub-org EXISTS at Turnkey holding a key whose root
 * authenticator is the USER'S PASSKEY, and nothing in our database points at it.
 * Nobody is locked out of anything (only the user can ever reach that key), but
 * the account is real, it may be billed, and it must be reconciled or retired.
 */

import { kvGetStrict, kvList, kvListStrict, kvUpsert } from '../persistence/backgroundJobKv';

/** Its own namespace: no poller reads it, nothing prunes it. */
export const ORPHAN_SUBORG_JOB_TYPE = 'turnkey-orphan-suborg';
export const ORPHAN_SUBORG_KEY_FIELD = 'subOrgId';

/** Why the wallet row was never written. Machine word, for grouping. */
export type OrphanSubOrgReason =
  /** The session was revoked (signed out, or the account was taken over). */
  | 'session-revoked'
  /** Contention: the row lock, a pool timeout, a deadlock (503 ACCOUNT_BUSY). */
  | 'account-busy'
  /** Anything else — the 500 branch. `errorName`/`errorMessage` carry the rest. */
  | 'write-failed';

export interface OrphanSubOrgRecord {
  subOrgId: string;
  userId: string;
  /** The address Turnkey minted inside the sub-org, when we got that far. */
  address: string;
  reason: OrphanSubOrgReason;
  errorName: string;
  errorMessage: string;
  /** ISO instant we noticed. */
  at: string;
  /** Always false when written here: nobody has reconciled it yet. */
  reconciled: false;
}

/**
 * Pure: does the row we read back carry the record we just wrote? Compares the
 * fields that IDENTIFY the incident — not `reconciled`, which an operator may
 * flip later, and not a field-by-field equality that a future key would break.
 */
export function orphanSubOrgRecordMatches(
  back: Record<string, unknown> | null | undefined,
  record: OrphanSubOrgRecord,
): boolean {
  if (!back) return false;
  return (
    back.subOrgId === record.subOrgId &&
    back.userId === record.userId &&
    back.reason === record.reason &&
    back.at === record.at &&
    back.errorMessage === record.errorMessage
  );
}

/** Pure: the payload persisted for one orphan. Exported so it can be tested. */
export function orphanSubOrgPayload(input: {
  subOrgId: string;
  userId: string;
  address?: string | null;
  reason: OrphanSubOrgReason;
  error?: unknown;
  at?: string;
}): OrphanSubOrgRecord {
  const err = input.error as { name?: unknown; message?: unknown } | null | undefined;
  return {
    subOrgId: String(input.subOrgId ?? ''),
    userId: String(input.userId ?? ''),
    address: typeof input.address === 'string' ? input.address : '',
    reason: input.reason,
    errorName: typeof err?.name === 'string' ? err.name : 'Error',
    errorMessage: typeof err?.message === 'string' ? err.message : 'unknown',
    at: input.at ?? new Date().toISOString(),
    reconciled: false,
  };
}

/** The line an operator is told to act on. Kept next to the record it explains. */
export const ORPHAN_SUBORG_RUNBOOK =
  'A Turnkey sub-org exists with no wallet row pointing at it. Its root authenticator is the user’s passkey, so ' +
  'only they can ever reach the key — nobody is locked out and nothing moved. Reconcile: find the sub-org in the ' +
  'Turnkey dashboard by subOrgId, then either attach it (the user creating the wallet again is the supported way) ' +
  'or retire it. The durable record is in background_jobs, jobType turnkey-orphan-suborg, keyed by subOrgId.';

/**
 * Write the orphan down. Never throws; safe to `await` inside a catch block.
 * Returns whether the DURABLE row could be verified — the caller may say so.
 */
export async function recordOrphanSubOrg(input: {
  subOrgId: string;
  userId: string;
  address?: string | null;
  reason: OrphanSubOrgReason;
  error?: unknown;
}): Promise<{ persisted: boolean }> {
  const record = orphanSubOrgPayload(input);
  if (!record.subOrgId) return { persisted: false };

  // (1) The log line, unchanged and greppable, first and always.
  console.warn(
    `[wallets/embedded/create] orphan-suborg ${record.subOrgId} for user ${record.userId}: Turnkey created it and ` +
      `the wallet row was NOT written (${record.reason}; ${record.errorName}: ${record.errorMessage}). ` +
      `The passkey is its root authenticator, so only the user can reach it — reconcile or retire it.`,
  );

  // (2) The durable row, and then the read-back that proves it exists.
  let persisted = false;
  try {
    await kvUpsert(ORPHAN_SUBORG_JOB_TYPE, ORPHAN_SUBORG_KEY_FIELD, record.subOrgId, record as unknown as Record<string, unknown>);
    // kvUpsert swallows its own failure, so «it returned» is not «it is written».
    // AND «A ROW EXISTS» IS NOT «THIS RECORD WAS WRITTEN» (task 4): the
    // rows are keyed by subOrgId, so a SECOND orphan for the same sub-org whose
    // update was lost reads back as the FIRST one and looked persisted. The
    // read-back compares the payload, so a stale row is «not persisted» and the
    // alert says the log line is the only copy — which is then true.
    const back = await kvGetStrict(ORPHAN_SUBORG_JOB_TYPE, ORPHAN_SUBORG_KEY_FIELD, record.subOrgId);
    persisted = orphanSubOrgRecordMatches(back, record);
    if (back !== null && !persisted) {
      console.error(
        `[orphan-suborg] read-back MISMATCH for ${record.subOrgId}: a row exists but it is not the record we just ` +
          'wrote (the upsert was lost). Treating it as NOT persisted.',
      );
    }
  } catch (e) {
    console.error(`[orphan-suborg] durable record failed for ${record.subOrgId}: ${(e as Error).message}`);
    persisted = false;
  }
  if (!persisted) {
    console.error(
      `[orphan-suborg] NOT PERSISTED: ${record.subOrgId} (user ${record.userId}) exists at Turnkey and the only ` +
        'trace of it is this log. Copy it now.',
    );
  }

  // (3) The alert an admin sees without going to look for it.
  try {
    const { opsAlert } = await import('../OpsAlertService');
    await opsAlert(
      'turnkey',
      'critical',
      persisted
        ? `Orphan embedded wallet sub-org ${record.subOrgId} (user ${record.userId}) — created at Turnkey, no wallet row.`
        : `Orphan embedded wallet sub-org ${record.subOrgId} (user ${record.userId}) — created at Turnkey, no wallet ` +
            'row, AND the durable record could not be written. The log line is the only copy.',
      {
        key: `orphan-suborg:${record.subOrgId}`,
        runbook: ORPHAN_SUBORG_RUNBOOK,
        facts: {
          subOrgId: record.subOrgId,
          userId: record.userId,
          address: record.address || null,
          reason: record.reason,
          error: `${record.errorName}: ${record.errorMessage}`,
          durableRecord: persisted,
        },
      },
    );
  } catch (e) {
    console.error(`[orphan-suborg] alert failed for ${record.subOrgId}: ${(e as Error).message}`);
  }
  return { persisted };
}

/**
 * Every orphan on record, newest first. Best-effort (`kvList`): this is a listing
 * for a human, not an authority decision, and an empty list here never grants or
 * removes anything.
 */
export async function listOrphanSubOrgs(limit = 200): Promise<OrphanSubOrgRecord[]> {
  const rows = await kvList(ORPHAN_SUBORG_JOB_TYPE, limit);
  return onlyOrphanRecords(rows);
}

function onlyOrphanRecords(rows: Record<string, unknown>[]): OrphanSubOrgRecord[] {
  return rows
    .filter((r) => typeof r?.subOrgId === 'string' && (r.subOrgId as string).length > 0)
    .map((r) => r as unknown as OrphanSubOrgRecord);
}

/**
 * The same listing, but a database that cannot answer THROWS instead of looking
 * empty. THE SURFACE THAT SHOWS THIS TO AN ADMIN USES THIS ONE
 * (`GET /api/admin/orphan-suborgs`): «there are no orphan sub-orgs» and «I could
 * not read the ledger» are opposite answers, and the whole point of the durable
 * row is that somebody can act on it. An empty screen that means «Postgres was
 * down» is the failed read dressed up as a fact — the thing this iteration is
 * about (task 5).
 */
export async function listOrphanSubOrgsStrict(limit = 200): Promise<OrphanSubOrgRecord[]> {
  return onlyOrphanRecords(await kvListStrict(ORPHAN_SUBORG_JOB_TYPE, limit));
}
