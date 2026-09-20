import { describe, expect, it } from 'vitest';
import { decideEmitReport, unreportedPanel } from '../councilEmitReport';

const HASH = 'A'.repeat(64);

describe('DecideEmitReport: only a validated tesSUCCESS is reported', () => {
  it('validated tesSUCCESS → report', () => {
    expect(decideEmitReport({ engine: 'tesSUCCESS', hash: HASH, validated: true, finalResult: 'tesSUCCESS' })).toEqual({
      kind: 'report',
      hash: HASH,
    });
  });

  it('a PRELIMINARY tesSUCCESS that validated as tec* is never reported', () => {
    expect(
      decideEmitReport({ engine: 'tesSUCCESS', hash: HASH, validated: true, finalResult: 'tecUNFUNDED_PAYMENT' }),
    ).toEqual({ kind: 'failed-on-ledger', hash: HASH, result: 'tecUNFUNDED_PAYMENT' });
  });

  it('accepted but not validated (timed out) → hold the hash, do not report', () => {
    expect(decideEmitReport({ engine: 'tesSUCCESS', hash: HASH, validated: false })).toEqual({ kind: 'hold', hash: HASH });
  });

  it('validated without a result code is unknown → hold, never report and never "failed"', () => {
    expect(decideEmitReport({ engine: 'tesSUCCESS', hash: HASH, validated: true })).toEqual({ kind: 'hold', hash: HASH });
    expect(decideEmitReport({ engine: 'tesSUCCESS', hash: HASH, validated: true, finalResult: '' })).toEqual({
      kind: 'hold',
      hash: HASH,
    });
  });

  it('refused by the node, or no hash at all → nothing to report', () => {
    expect(decideEmitReport({ engine: 'tefPAST_SEQ', hash: HASH, validated: false })).toEqual({ kind: 'none' });
    expect(decideEmitReport({ engine: 'tesSUCCESS', validated: false })).toEqual({ kind: 'none' });
  });
});

describe('unreportedPanel — the panel never offers a registration the backend refuses for ever', () => {
  it('TX_FAILED_ON_LEDGER: says it failed, no «Register it now»', () => {
    expect(unreportedPanel('TX_FAILED_ON_LEDGER')).toEqual({ voice: 'failed-on-ledger', canRegister: false });
  });

  it('TX_NOT_THIS_PROPOSAL: no «Register it now»', () => {
    expect(unreportedPanel('TX_NOT_THIS_PROPOSAL')).toEqual({ voice: 'not-this-proposal', canRegister: false });
  });

  it('never reported, a network error or TX_NOT_VALIDATED: registering later can still work', () => {
    expect(unreportedPanel(undefined)).toEqual({ voice: 'broadcast', canRegister: true });
    expect(unreportedPanel(null)).toEqual({ voice: 'broadcast', canRegister: true });
    expect(unreportedPanel('TX_NOT_VALIDATED')).toEqual({ voice: 'broadcast', canRegister: true });
    expect(unreportedPanel('UNREACHABLE')).toEqual({ voice: 'broadcast', canRegister: true });
  });
});
