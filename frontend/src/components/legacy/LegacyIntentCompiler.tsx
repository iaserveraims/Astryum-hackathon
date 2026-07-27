'use client';

/**
 * LegacyIntentCompiler — "Operar": describe the operation in words, the AI
 * compiles it into a deterministic intent, the FORM gets prefilled, you review
 * and sign. Invariant #8 verbatim: the AI compiles, the user signs — the model
 * never builds a transaction and never gains discretion. The verification chain
 * is the one already built: prepare (unsigned) → disclosure → simulate
 * preflight (#11) → your signature (direct or council coordinator).
 *
 * PRIVACY — client-side address scrubbing: any XRPL address typed in the
 * sentence is replaced by a {{DIR_n}} token BEFORE the text leaves the browser;
 * the mapping stays here and the token is re-substituted locally when the
 * intent comes back. The backend schema only admits 'SELF' or a token as
 * destination, so a raw address can never round-trip through the model.
 */

import { useCallback, useMemo, useState } from 'react';
import { ArrowDownToLine, Loader2, Wand2 } from 'lucide-react';
import { GhostButton, Pill, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';

const API_BASE = getApiBase();
const XRPL_ADDRESS_RE = /r[1-9A-HJ-NP-Za-km-z]{24,34}/g;

/** Replace XRPL addresses with {{DIR_n}} tokens; the map stays client-side. */
export function scrubXrplAddresses(text: string): { scrubbed: string; map: Record<string, string> } {
  const map: Record<string, string> = {};
  let n = 0;
  const scrubbed = text.replace(XRPL_ADDRESS_RE, (addr) => {
    const existing = Object.entries(map).find(([, v]) => v === addr)?.[0];
    if (existing) return existing;
    n += 1;
    const token = `{{DIR_${n}}}`;
    map[token] = addr;
    return token;
  });
  return { scrubbed, map };
}

export interface CompiledEscrowIntent {
  action: 'escrow-create';
  amountXrp?: number | null;
  deliveryDateISO?: string | null;
  recoveryDateISO?: string | null;
  destination?: string | null; // 'SELF' | '{{DIR_n}}' | null
  summary?: string | null;
}
type CompiledIntent =
  | CompiledEscrowIntent
  | { action: 'did-amend'; summary?: string | null }
  | { action: 'none'; reason?: string | null };

export interface TransferPrefill {
  destination?: string;
  amountXrp?: string;
  unlockDate?: string;
  expiryDate?: string;
}

export default function LegacyIntentCompiler({
  account,
  onFill,
}: {
  /** The Legacy account — resolves a 'SELF' destination locally. */
  account: string;
  /** Prefills the programmed-transfer form (the user still reviews + signs). */
  onFill: (v: TransferPrefill) => void;
}) {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<CompiledIntent | null>(null);
  const [addrMap, setAddrMap] = useState<Record<string, string>>({});

  const compile = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setIntent(null);
    try {
      // Addresses never leave the browser: tokens out, tokens back.
      const { scrubbed, map } = scrubXrplAddresses(text);
      setAddrMap(map);
      const res = await fetch(`${API_BASE}/legacy-assistant/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: scrubbed }),
      });
      if (res.status === 429) throw new Error(t('A lot of questions right now — give it a moment and try again.'));
      if (!res.ok) throw new Error(t('The compiler could not interpret that — try rephrasing with an amount and a date.'));
      const data = await res.json();
      setIntent(data.intent as CompiledIntent);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [input, busy, t]);

  /** Resolve the destination locally: token → real address, SELF → the account. */
  const resolvedDestination = useMemo(() => {
    if (!intent || intent.action !== 'escrow-create' || !intent.destination) return undefined;
    if (intent.destination === 'SELF') return account;
    return addrMap[intent.destination];
  }, [intent, addrMap, account]);

  const fill = useCallback(() => {
    if (!intent || intent.action !== 'escrow-create') return;
    onFill({
      ...(resolvedDestination ? { destination: resolvedDestination } : {}),
      ...(intent.amountXrp ? { amountXrp: String(intent.amountXrp) } : {}),
      ...(intent.deliveryDateISO ? { unlockDate: intent.deliveryDateISO.slice(0, 10) } : {}),
      ...(intent.recoveryDateISO ? { expiryDate: intent.recoveryDateISO.slice(0, 10) } : {}),
    });
    setIntent(null);
    setInput('');
  }, [intent, resolvedDestination, onFill]);

  return (
    <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
      <div>
        <span className="text-xs font-medium text-ink/60">{t('Or describe it in words')}</span>
        <p className="mt-0.5 text-xs text-ink/40">{t('The AI compiles, you review and sign.')}</p>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void compile();
            }
          }}
          rows={1}
          spellCheck={false}
          placeholder={t('e.g. "Commit 200 XRP to r… deliverable on January 1st, recoverable in a year"')}
          className="max-h-24 flex-1 resize-none rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-[13px] text-ink placeholder-ink/30 outline-none focus:border-ink/25"
        />
        <PrimaryButton onClick={() => void compile()} disabled={!input.trim() || busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {t('Compile')}
        </PrimaryButton>
      </div>

      {intent?.action === 'escrow-create' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="info">{t('programmed transfer')}</Pill>
            <Pill tone={intent.amountXrp ? 'neutral' : 'warning'}>
              {intent.amountXrp ? `${intent.amountXrp} XRP` : t('amount missing')}
            </Pill>
            <Pill tone={intent.deliveryDateISO ? 'neutral' : 'warning'}>
              {intent.deliveryDateISO ? `${t('deliver')} ${intent.deliveryDateISO.slice(0, 10)}` : t('date missing')}
            </Pill>
            {intent.recoveryDateISO && <Pill tone="neutral">{t('recover')} {intent.recoveryDateISO.slice(0, 10)}</Pill>}
            <Pill tone={resolvedDestination ? 'neutral' : 'warning'}>
              {resolvedDestination
                ? `→ ${resolvedDestination.slice(0, 7)}…${resolvedDestination.slice(-4)}`
                : t('beneficiary missing — fill it in the form')}
            </Pill>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={fill}>
              <ArrowDownToLine size={14} /> {t('Fill the form below')}
            </PrimaryButton>
            <GhostButton onClick={() => setIntent(null)}>{t('Discard')}</GhostButton>
            <span className="text-[11px] text-ink/40">
              {t('Nothing is prepared or signed yet — you review every field first.')}
            </span>
          </div>
        </div>
      )}

      {intent?.action === 'did-amend' && (
        <p className="text-[12px] text-ink/60">
          {t('That is a constitution amendment — use "The constitution" card below: paste the new text, and the quorum signs the new anchor.')}
        </p>
      )}

      {intent?.action === 'none' && (
        <p className="text-[12px] text-ink/60">
          {intent.reason || t('I could not map that to an operation — try an amount, a beneficiary and a date.')}
        </p>
      )}

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
    </div>
  );
}
