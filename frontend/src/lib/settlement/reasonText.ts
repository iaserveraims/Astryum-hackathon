'use client';

/**
 * settlementReasonText — settlement failure/stall REASONS travel as CODES and
 * become sentences only here (Fase 2b). Before this the tracker emitted
 * hardcoded Spanish prose under English headlines: both languages saw a mix,
 * in the most anxious moment of the flow.
 */

export function settlementReasonText(
  reason: string | undefined,
  t: (s: string) => string,
): string | undefined {
  if (!reason) return undefined;
  const MAP: Record<string, string> = {
    BATCH_FAILED: 'The batch failed on the network — your money did not move.',
    NO_AUTOCONFIRM:
      'Your wallet does not let us confirm automatically — open it and check with the receipt below.',
    REVERTED:
      'The network rejected the transaction. Your money did not move; only the network fee was spent.',
    // The stalled HEADLINE already says this — no second sentence needed.
    STALLED_SLOW: '',
  };
  const step = reason.match(/^BATCH_CALL_REVERTED:(\d+)$/);
  if (step) {
    return `${t('Batch step')} ${step[1]} ${t('of the batch was rejected by the network — nothing was applied.')}`;
  }
  if (reason in MAP) return MAP[reason] ? t(MAP[reason]) : undefined;
  return reason; // pre-code or backend-worded reasons pass through
}
