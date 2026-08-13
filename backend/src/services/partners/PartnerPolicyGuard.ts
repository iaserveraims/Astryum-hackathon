/**
 * Partner-domain deterministic policy (S4 subset of the prompt's P19–P27).
 * Separate from the on-chain control-plane PolicyGuard (P1–P18) by design —
 * this governs regulated-partner sessions, not on-chain txData.
 *
 *  P19  intent.astryumExecutes === false        (always)
 *  P20  intent.astryumCustody  === false         (always)
 *  P20b intent.astryumOrderTransmission === false (MiCA, same family)
 *  P21  partner must be enabled in the registry
 *  P26  webhook must be HMAC-verified before processing  (assertWebhookVerified)
 *  P27  webhook must pass idempotency before any state change (assertNotReplayed)
 */

export class PartnerPolicyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PartnerPolicyError';
  }
}

/**
 * A regulated partner is enabled only if registered in PartnerRegistry AND
 * its enabled() predicate (env vars / API keys) is true.
 *
 * Historical note: pre-2026-06-01 this returned only `['moonpay']` from a
 * hardcoded set. The regulatory audit identified this as inadequate — the
 * partner gate was effectively dead because no path consulted it. The
 * registry-backed implementation matches the actual provider catalog and
 * allows the resolver in `partners/PartnerRegistry.ts` to gate every intent.
 */
function enabledPartners(): Set<string> {
  // Lazy-imported to avoid module init order issues in tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { partnerRegistry } = require('../../partners/PartnerRegistry') as {
    partnerRegistry: { enabledIds: () => ReadonlyArray<string> };
  };
  return new Set(partnerRegistry.enabledIds());
}

export interface PartnerIntentInvariants {
  partnerId: string;
  astryumExecutes: boolean;
  astryumCustody: boolean;
  astryumOrderTransmission: boolean;
}

export class PartnerPolicyGuard {
  /** P19/P20/P20b/P21 — must pass before a partner session can be opened. */
  assertSessionAllowed(intent: PartnerIntentInvariants): void {
    if (intent.astryumExecutes !== false) {
      throw new PartnerPolicyError('P19: astryumExecutes must be false', 'p19_astryum_executes');
    }
    if (intent.astryumCustody !== false) {
      throw new PartnerPolicyError('P20: astryumCustody must be false', 'p20_astryum_custody');
    }
    if (intent.astryumOrderTransmission !== false) {
      throw new PartnerPolicyError(
        'P20b: astryumOrderTransmission must be false',
        'p20_order_transmission',
      );
    }
    if (!enabledPartners().has(intent.partnerId)) {
      throw new PartnerPolicyError(
        `P21: partner '${intent.partnerId}' is not enabled`,
        'p21_partner_disabled',
      );
    }
  }

  /** P26 — refuse to process a webhook whose signature didn't verify. */
  assertWebhookVerified(verified: { valid: boolean; reason?: string }): void {
    if (!verified.valid) {
      throw new PartnerPolicyError(
        `P26: webhook signature invalid (${verified.reason ?? 'unknown'})`,
        'p26_webhook_unverified',
      );
    }
  }

  /** P27 — refuse to mutate state if this delivery was already terminal. */
  assertNotReplayed(alreadyTerminal: boolean): void {
    if (alreadyTerminal) {
      throw new PartnerPolicyError(
        'P27: webhook already processed (idempotency)',
        'p27_replayed',
      );
    }
  }
}

export const partnerPolicyGuard = new PartnerPolicyGuard();
