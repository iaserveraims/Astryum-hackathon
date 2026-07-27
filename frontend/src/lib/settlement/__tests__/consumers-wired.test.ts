import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Wiring guard — the 2026-07-25 review found settlement.ts with 17 green tests
 * and ZERO consumers while ≥6 surfaces painted success from an unconfirmed
 * bundle id. This suite pins the cable at the SOURCE level so it cannot
 * silently regress: every surface that hands calls to a wallet must consume
 * the settlement machine, and none may keep a local success poll of its own.
 * (The state machine itself is covered by tracker.test.ts; success being
 * unfabricatable is enforced by the brand symbol in settlement.ts.)
 */

const SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const CONSUMERS = [
  'components/earn/FlareDemoEarn.tsx',
  'components/positions/DefiPositionsBoard.tsx',
  'components/positions/PaActionsModal.tsx',
  'components/positions/VaultClaimModal.tsx',
  'components/positions/VaultWithdrawModal.tsx',
  'components/wallet/WalletTransferModals.tsx',
  'components/intents/useIntentSigning.ts',
];

describe('every wallet-signing surface consumes the settlement machine', () => {
  for (const rel of CONSUMERS) {
    it(`${rel} uses useSettlement and tracks the handle`, () => {
      const src = read(rel);
      expect(src).toMatch(/useSettlement\(/);
      expect(src).toMatch(/settlement\.track\(/);
    });
  }

  it('sendIntentCalls returns a settlement handle on every rail', () => {
    const src = read('lib/wallet/useWalletPartner.ts');
    expect(src).toMatch(/SendIntentCallsResult/);
    expect(src).toMatch(/startPending\('evm-5792'/); // 5792 hands back PENDING, never done
    // No rail returns a bare hash any more:
    expect(src).not.toMatch(/return \{ txHash \};?\s*\n\s*\}\s*,?\s*\n\s*\/\/ EIP-5792/);
  });

  it('FlareDemoEarn no longer keeps its own mint-status poll (promoted to the machine)', () => {
    const src = read('components/earn/FlareDemoEarn.tsx');
    expect(src).not.toMatch(/flare-demo\/mint-status/); // the fetch lives in useSettlement now
    expect(src).not.toMatch(/mintExecuted/);
  });

  it('useIntentSigning reports submitted ONLY from a confirmed handle', () => {
    const src = read('components/intents/useIntentSigning.ts');
    // The confirm helper is the only call site of intentsApi.submitted…
    const calls = src.match(/intentsApi\.submitted\(/g) ?? [];
    expect(calls.length).toBe(1);
    // …and it is gated on the machine: settled handle or onSettled callback.
    expect(src).toMatch(/handle\.status === 'settled'/);
    expect(src).toMatch(/onSettled/);
  });

  it('loadAllPending has a REAL consumer — the resume path is wired into the shell', () => {
    // The 2026-07-25 scan found loadAllPending with zero consumers (the same
    // hole R1 had): pin the whole rehydration cable at the source level.
    expect(read('lib/settlement/resume.ts')).toMatch(/loadAllPending\(/);
    expect(read('lib/settlement/resume.ts')).toMatch(/startedAt: p\.startedAt/); // ceiling from the SIGNATURE
    expect(read('lib/settlement/useResumePendingSettlements.ts')).toMatch(/resumeAllPending\(/);
    expect(read('components/settlement/ResumedSettlements.tsx')).toMatch(/useResumePendingSettlements\(/);
    expect(read('components/ui/AppShell.tsx')).toMatch(/<ResumedSettlements \/>/);
  });

  it('done-views render success through SettlementIndicator, not a hardcoded green', () => {
    for (const rel of CONSUMERS.filter((f) => f.endsWith('.tsx'))) {
      const src = read(rel);
      expect(src).toMatch(/SettlementIndicator/);
    }
  });

  it('transfers: BOTH rails track — the XRPL Payment settles on LEDGER VALIDATION, no exemptions left', () => {
    const src = read('components/wallet/WalletTransferModals.tsx');
    expect(src).toMatch(/settlement\.track\(handle\)/); // EVM rail
    expect(src).toMatch(/startPending\('xrpl-tx'/); // XRPL rail — the last premature green
    expect(src).not.toMatch(/Transfer signed and submitted/); // the old unconditional copy is gone
  });

  it('CouncilOrderCard: DONE comes ONLY from the machine (rail council-order), never from the preliminary broadcast', () => {
    const src = read('components/legacy/CouncilOrderCard.tsx');
    expect(src).toMatch(/useSettlement\(/);
    expect(src).toMatch(/startPending\('council-order'/);
    // the enrichment poll must no longer decide success on its own:
    expect(src).not.toMatch(/if \(st\.executed\)/);
  });
});
