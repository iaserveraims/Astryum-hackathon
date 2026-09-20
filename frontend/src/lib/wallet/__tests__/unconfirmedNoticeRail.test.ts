import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnconfirmedSignatureNotice } from '../../../components/settlement/UnconfirmedSignatureNotice';
import type { UnconfirmedSignature } from '../signOutcome';

/**
 * The amber ending linked every XRPL hash to Flarescan (`explorerTxUrl(chainId
 * ?? 14, …)`), so «check the hash before signing again» opened a «not found»
 * page — which reads as «it never happened, sign again». And a plain XRPL
 * Payment was painted as the EVM rail (or, with rail 'xrpl', as a 0xFE dispatch
 * with carrier fees and nonce seats it never had).
 */

const XRPL_HASH = 'B'.repeat(64);
const EVM_HASH = '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

function render(props: {
  rail: 'xrpl' | 'evm';
  chainId?: number;
  xrplKind?: 'dispatch' | 'payment' | 'transaction';
  unconfirmed: UnconfirmedSignature;
}): string {
  return renderToStaticMarkup(createElement(UnconfirmedSignatureNotice, { ...props, onClose: () => {} }));
}

describe('UnconfirmedSignatureNotice — the explorer follows the rail', () => {
  it('an XRPL hash links to xrpscan, never to Flarescan — dispatch or payment', () => {
    for (const xrplKind of [undefined, 'dispatch', 'payment'] as const) {
      const html = render({ rail: 'xrpl', xrplKind, unconfirmed: { txHash: XRPL_HASH, trace: null } });
      expect(html).toContain(`https://xrpscan.com/tx/${XRPL_HASH}`);
      expect(html).not.toContain('flarescan');
    }
  });

  it('a chainId passed alongside rail xrpl does not send the hash to an EVM explorer', () => {
    const html = render({ rail: 'xrpl', chainId: 14, unconfirmed: { txHash: XRPL_HASH, trace: null } });
    expect(html).toContain(`https://xrpscan.com/tx/${XRPL_HASH}`);
  });

  it('the EVM rail keeps its chain explorer', () => {
    expect(render({ rail: 'evm', chainId: 1, unconfirmed: { txHash: EVM_HASH, trace: null } })).toContain(
      `https://etherscan.io/tx/${EVM_HASH}`,
    );
    expect(render({ rail: 'evm', unconfirmed: { txHash: EVM_HASH, trace: null } })).toContain(
      `https://flarescan.com/tx/${EVM_HASH}`,
    );
  });
});

describe('UnconfirmedSignatureNotice — what went to Xaman decides the words', () => {
  it('dispatch (the default) names the 0xFE price of a second signature', () => {
    const html = render({ rail: 'xrpl', unconfirmed: { trace: null } });
    expect(html).toMatch(/second carrier fee in XRP/);
    expect(html).toMatch(/nonce seat/);
  });

  it('a plain payment says do NOT sign again, without carrier fees or nonce seats', () => {
    const html = render({ rail: 'xrpl', xrplKind: 'payment', unconfirmed: { txHash: XRPL_HASH, trace: null } });
    expect(html).toContain('The payment went to Xaman and we could not confirm how it ended.');
    expect(html).toContain('Do NOT sign it again');
    expect(html).not.toMatch(/carrier fee/);
    expect(html).not.toMatch(/nonce seat/);
    // Still the amber ending with exactly one action, and it is not signing.
    expect(html).toMatch(/amber-500/);
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/try again/i);
  });

  it('any other XRPL transaction (escrow, DEX order, SignerListSet) says do NOT sign again, with no fees and no «payment»', () => {
    const html = render({ rail: 'xrpl', xrplKind: 'transaction', unconfirmed: { txHash: XRPL_HASH, trace: null } });
    expect(html).toContain('The transaction went to Xaman and we could not confirm how it ended.');
    expect(html).toContain('Do NOT sign it again');
    expect(html).toContain(`https://xrpscan.com/tx/${XRPL_HASH}`);
    expect(html).not.toMatch(/carrier fee|nonce seat|The payment went/);
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
  });

  it('xrplKind never changes the EVM copy', () => {
    const plain = render({ rail: 'evm', unconfirmed: { trace: null } });
    const withKind = render({ rail: 'evm', xrplKind: 'payment', unconfirmed: { trace: null } });
    expect(withKind).toBe(plain);
  });
});
