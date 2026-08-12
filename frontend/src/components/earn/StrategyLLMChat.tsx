'use client';

/**
 * StrategyLLMChat — the LLM-backed strategy chat (replaces the old regex chat).
 *
 * Reuses the product-assistant UX (streaming SSE, loading/error states, container)
 * but connects to the SIWE-gated /api/strategy-assistant/chat. The LLM INTERPRETS
 * natural language and streams a conversational reply; the NUMBERS come from the
 * backend (StrategyMetricsService / tested KineticIsoMath) as a STRUCTURED `metrics`
 * object in the `done` event — rendered here as a clean HTML table with a "Preparar"
 * button per option.
 *
 * THE BRIDGE TO SIGNING is preserved: choosing an option calls the SAME
 * `onLaunch(kind, params)` the old chat used → FlareDemoEarn opens the tested
 * prepare→sign modal. This chat never builds or signs a payload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, Workflow, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { TypewriterText } from '../ui/motion';
import { getApiBase } from '../../lib/env';
import { useSmartAccountsOf } from '../../hooks/useSmartAccountsOf';
import type { LaunchStrategy } from './StrategyAgent';
import { CmfReviewModal, type CmfRuleTarget } from './CmfReviewModal';
import type { CanonicalMoneyFlow } from '../../services/v1Api';
import { listMyWallets, type BackendWallet } from '../../services/walletLinkService';
import { transferRailOf } from '../../lib/wallet/nativeBalance';
import { WalletSendModal, type SendPrefill } from '../wallet/WalletTransferModals';
import { formatMoney } from '../../lib/formatMoney';
import { hfWord } from '../../lib/healthScore';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) h['Authorization'] = `Bearer ${token}`;
  }
  return h;
}

// Structured metrics from the backend (numbers from tested math). Kept in sync with
// backend/src/services/StrategyMetricsService.ts.
interface StrategyOption {
  kind: 'lend-only' | 'carry';
  label: string;
  borrowRatio: number | null;
  entryHF: number | null;
  borrowUsd: number | null;
  liquidationPriceUSD: number | null;
  annualBorrowCostUsd: number | null;
  supplyYieldUsdPerYear: number | null;
  noDebt: boolean;
  noLiquidationRisk: boolean;
}
interface StrategyMetrics {
  amountXrp: number;
  collateralValueUSD: number;
  fxrpPriceUSD: number;
  targetUsd: number | null;
  options: StrategyOption[];
  notes: string[];
}

/** Agent-compiled parameters of a simple wallet-to-wallet transfer — the
 *  payload itself is built by /wallet-transfer/prepare inside the modal. */
interface TransferProposal {
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  asset: 'XRP' | 'FLR' | 'FXRP' | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  metrics?: StrategyMetrics | null;
  /** F1 — validated CMF proposal from the moneyflow mode (server-stamped). */
  cmf?: CanonicalMoneyFlow | null;
  /** Readable reasons when the draft did not survive validation/translation. */
  cmfIssues?: Array<{ code: string; message: string }> | null;
  /** Compiled simple transfer — opens the prepare→review→sign modal prefilled. */
  transfer?: TransferProposal | null;
  transferIssues?: Array<{ code: string; message: string }> | null;
}

type ChatMode = 'carry' | 'moneyflow';

/** Parse a human amount like "10.000", "10,000", "10000.5" → number. */
function parseHumanNumber(raw: string): number {
  // Drop . or , used as a thousands separator (followed by exactly 3 digits), keep decimals.
  const cleaned = raw.replace(/[.,](?=\d{3}\b)/g, '');
  const n = parseFloat(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
// F17 — accepts a decimal comma ("5,5 XRP"), no space ("5xrp") and the amount
// before the unit ("xrp 5"), same three shapes covered for extractTargetUsd
// below. Still requires a digit adjacent to "xrp" so plain numbers elsewhere
// in the sentence (dates, HF, ratios) are never mistaken for the amount.
function extractAmountXrp(text: string): number | undefined {
  const m =
    text.match(/(\d[\d.,]*)\s*xrp\b/i) ||
    text.match(/\bxrp\s*(\d[\d.,]*)/i) ||
    text.match(/\b(\d[\d.,]{2,})\b(?=[^%]*xrp)/i);
  if (!m) return undefined;
  const n = parseHumanNumber(m[1]);
  return n > 0 ? n : undefined;
}
function extractTargetUsd(text: string): number | undefined {
  const m =
    text.match(/\$\s*(\d[\d.,]*)/) ||
    text.match(/(\d[\d.,]*)\s*(?:dollars?|d[óo]lares?|usd)\b/i) ||
    text.match(/(?:dollars?|d[óo]lares?|usd)\s*\$?\s*(\d[\d.,]*)/i) ||
    text.match(/need\s+(?:a\s+few\s+|about\s+)?(\d[\d.,]*)/i);
  if (!m) return undefined;
  const n = parseHumanNumber(m[1]);
  return n > 0 ? n : undefined;
}
// F16 — HF target from free text: "HF 1.2", "hf 1,15", "health factor 1.3",
// "salud 1.2", "protección en 1.2", and phrasing with words in between
// ("health factor no baje de 1.3") within a 24-char window. Kept separate
// from extractAmountXrp/extractTargetUsd since it must normalise to a
// decimal-point string (the prepare modal + drafts always store targetHF as
// "1.10"-style text), not a number. A bare HF like "1" or "12" without a
// decimal point is rejected — health factors are always written with a
// decimal in this product's copy, and accepting a bare integer risks
// catching an unrelated amount right after the word "HF" that isn't a ratio
// at all (e.g. "HF y 5 XRP"). The trailing (?!\s*%) also rejects a number
// that's actually a percentage ("hf ronda el 1.5%"), an obvious false
// positive for a ratio field.
function extractTargetHF(text: string): string | undefined {
  const m = text.match(/(?:health\s*factor|hf|salud|protecci[oó]n(?:\s+en)?)\D{0,24}(\d+[.,]\d+)(?!\s*%)/i);
  if (!m) return undefined;
  const raw = m[1].replace(',', '.');
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? raw : undefined;
}

const usd = (n: number | null) => (n == null ? '—' : formatMoney(n));
const price = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

// Suggestions follow the ACTIVE language (they were Spanish-only: EN users got
// Spanish chips inside an English chat) — and they no longer TEACH jargon:
// the app speaks human even when it suggests what to ask.
const SUGGESTED: Record<'es' | 'en', string[]> = {
  es: [
    'Tengo 10000 XRP y quiero sacar $200 sin vender',
    '¿Cuál es la opción con menos riesgo?',
    'Envía 5 XRP de mi Xaman a mi wallet de Flare',
  ],
  en: [
    'I have 10,000 XRP and need $200 without selling',
    'Which option has the least risk?',
    'Send 5 XRP from my Xaman to my Flare wallet',
  ],
};

const SUGGESTED_MONEYFLOW: Record<'es' | 'en', string[]> = {
  es: [
    'Avísame si mi posición se acerca a la liquidación',
    'Cuando mis recompensas pasen de $5, prepara la reinversión',
  ],
  en: [
    'Warn me if my position gets close to liquidation',
    'When my rewards pass $5, prepare the reinvestment',
  ],
};

/**
 * A council's capital only reaches a venue through the cage on Flare, whose
 * whole vocabulary is `directTo` (supply) and `recall` (bring back) — there is
 * no borrow function in it. So under a council the carry route is not something
 * the agent may compile: the flag rides to the backend (which drops the carry
 * rows from the metrics table and tells the model to say so), and the table
 * below refuses the button too, in case an older reply still carries one.
 */
const GOVERNED_NO_CARRY =
  'The vault on Flare has no borrow function, so a council cannot run the borrowing route. The lend-only route does the same supply without debt.';

export function StrategyLLMChat({
  onLaunch,
  governed = false,
}: {
  onLaunch: LaunchStrategy;
  /** True when the active authority is a council (governed account). */
  governed?: boolean;
}) {
  const { t, lang } = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  // 'carry' = the metrics-table strategy chat; 'moneyflow' = compose_moneyflow (F1).
  const [mode, setMode] = useState<ChatMode>('carry');
  // CMF pending user review — the modal owns edit + activate.
  const [reviewCmf, setReviewCmf] = useState<CanonicalMoneyFlow | null>(null);
  // Linked wallets — sent to the transfer compiler so it can resolve "mi
  // Xaman"/"mi MetaMask", and handed to the send modal (source picker).
  const [linkedWallets, setLinkedWallets] = useState<BackendWallet[]>([]);
  useEffect(() => {
    let cancelled = false;
    listMyWallets()
      .then((ws) => {
        if (!cancelled) setLinkedWallets(ws);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Every rule a CMF activates binds to the wallet that HOLDS the position and
  // transacts on Flare (founder 2026-07-24): the Smart Account of each linked
  // Xaman (deterministic resolution — the same read registers it as this
  // user's wallet server-side) or a linked Flare EVM wallet. NEVER the login
  // address: the engine evaluates HF/rewards on the rule wallet's own
  // portfolio, so a rule bound elsewhere silently never fires.
  const xrplAddresses = useMemo(
    () => linkedWallets.filter((w) => transferRailOf(w) === 'xrpl').map((w) => w.address),
    [linkedWallets],
  );
  const { byXrpl } = useSmartAccountsOf(xrplAddresses);
  const ruleTargets = useMemo((): CmfRuleTarget[] => {
    const seen = new Set<string>();
    const out: CmfRuleTarget[] = [];
    for (const w of linkedWallets) {
      const rail = transferRailOf(w);
      if (rail === 'xrpl') {
        const pa = byXrpl[w.address];
        if (pa && !seen.has(pa.toLowerCase())) {
          seen.add(pa.toLowerCase());
          out.push({
            address: pa,
            label: `Smart Account · ${w.nickname || w.walletType || w.address.slice(0, 8)}`,
            kind: 'smart-account',
          });
        }
      } else if (rail === 'evm' && !seen.has(w.address.toLowerCase())) {
        seen.add(w.address.toLowerCase());
        out.push({
          address: w.address,
          label: w.nickname || w.walletType || 'EVM',
          kind: 'evm',
        });
      }
    }
    // Smart Accounts first — the flagship (E1) position lives there.
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'smart-account' ? -1 : 1));
  }, [linkedWallets, byXrpl]);

  // A compiled transfer the user chose to prepare — opens the tested modal.
  const [sendTransfer, setSendTransfer] = useState<{
    wallet: BackendWallet | null;
    initial: SendPrefill;
  } | null>(null);
  // Accumulated context so the calculator can run once the amount is known.
  const [amountXrp, setAmountXrp] = useState<number | undefined>(undefined);
  const [targetUsd, setTargetUsd] = useState<number | undefined>(undefined);
  // F16 — HF the user asked for in the conversation, if any (e.g. "protección
  // en 1.2"). Same persist-across-turns pattern as amount/target above: once
  // said, it stays the starting point for every "Prepare" click in this chat
  // until the user names a different one. Still just a prefill — the review
  // modal keeps targetHF fully editable before signing.
  const [targetHF, setTargetHF] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // The typewriter grows the last bubble without changing `messages` — keep
  // the view pinned to the bottom while the reply writes itself in.
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, 250);
    return () => clearInterval(id);
  }, [streaming]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError('');
      setInput('');

      // Extract the amount/target/HF from this turn; they persist across turns.
      const nextAmount = extractAmountXrp(trimmed) ?? amountXrp;
      const nextTarget = extractTargetUsd(trimmed) ?? targetUsd;
      const nextHF = extractTargetHF(trimmed) ?? targetHF;
      if (nextAmount !== amountXrp) setAmountXrp(nextAmount);
      if (nextTarget !== targetUsd) setTargetUsd(nextTarget);
      if (nextHF !== targetHF) setTargetHF(nextHF);

      const history = messages.map(({ role, content }) => ({ role, content }));
      // True when the previous assistant turn was a transfer proposal — keeps
      // a "5 XRP" follow-up (no verb to regex) in the transfer compiler
      // without re-triggering it on every later strategy question.
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const transferThread =
        !!lastAssistant && (!!lastAssistant.transfer || (lastAssistant.transferIssues?.length ?? 0) > 0);
      // Wallet summaries (public addresses only) so the transfer compiler can
      // resolve "mi Xaman"/"mi MetaMask" to a source among MY wallets.
      const walletSummaries = linkedWallets
        .map((w) => ({ w, rail: transferRailOf(w) }))
        .filter((x) => x.rail !== null)
        .slice(0, 20)
        .map(({ w, rail }) => ({
          label: (w.nickname || w.walletType || 'wallet').slice(0, 80),
          address: w.address,
          rail: rail as 'evm' | 'xrpl',
        }));
      setMessages((m) => [...m, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
      setStreaming(true);
      try {
        const res = await fetch(`${API_BASE}/strategy-assistant/chat`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            message: trimmed,
            history,
            amountXrp: nextAmount,
            targetUsd: nextTarget,
            mode,
            wallets: walletSummaries,
            transferThread,
            governed,
          }),
        });
        if (res.status === 401) {
          setError(t('Connect your wallet to use the strategy assistant.'));
          setMessages((m) => m.slice(0, -1));
          return;
        }
        if (res.status === 429) {
          setError(t('A lot of questions right now — give it a moment and try again.'));
          setMessages((m) => m.slice(0, -1));
          return;
        }
        if (!res.ok || !res.body) throw new Error(t("The assistant didn't respond. Please try again."));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            let payload: {
              type?: string;
              text?: string;
              message?: string;
              metrics?: StrategyMetrics | null;
              cmf?: CanonicalMoneyFlow | null;
              cmfIssues?: Array<{ code: string; message: string }> | null;
              transfer?: TransferProposal | null;
              transferIssues?: Array<{ code: string; message: string }> | null;
            };
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.type === 'delta' && payload.text) {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, content: last.content + payload.text };
                return copy;
              });
            } else if (payload.type === 'done') {
              if (payload.metrics || payload.cmf || payload.cmfIssues || payload.transfer || payload.transferIssues) {
                setMessages((m) => {
                  const copy = [...m];
                  const last = copy[copy.length - 1];
                  copy[copy.length - 1] = {
                    ...last,
                    metrics: payload.metrics ?? last.metrics,
                    cmf: payload.cmf ?? null,
                    cmfIssues: payload.cmfIssues ?? null,
                    transfer: payload.transfer ?? null,
                    transferIssues: payload.transferIssues ?? null,
                  };
                  return copy;
                });
              }
            } else if (payload.type === 'error') {
              setError(payload.message || t("The assistant didn't respond. Please try again."));
            }
          }
        }
      } catch (e) {
        setError((e as Error).message || t("The assistant didn't respond. Please try again."));
        setMessages((m) => (m[m.length - 1]?.content === '' ? m.slice(0, -1) : m));
      } finally {
        setStreaming(false);
      }
    },
    [messages, streaming, amountXrp, targetUsd, targetHF, mode, linkedWallets, governed, t],
  );

  // Compiled transfer → the tested prepare→review→sign modal, prefilled. The
  // agent compiled parameters only; the unsigned payload is built by
  // /wallet-transfer/prepare inside the modal and signed in the user's wallet.
  const launchTransfer = useCallback(
    (p: TransferProposal) => {
      const fromWallet = p.fromAddress
        ? (linkedWallets.find((w) => w.address.toLowerCase() === p.fromAddress!.toLowerCase()) ?? null)
        : null;
      // The modal's asset toggle only applies to an EVM source: FLR stays FLR,
      // and both FXRP and "XRP" prefill FXRP (XRP on Flare IS FXRP) — an XRPL
      // source ignores the toggle entirely, so the remap is harmless there
      // and correct if the user later picks an EVM source in the modal.
      const evmAsset: SendPrefill['asset'] = p.asset === 'FLR' ? 'FLR' : p.asset ? 'FXRP' : undefined;
      setSendTransfer({
        wallet: fromWallet,
        initial: {
          to: p.toAddress ?? undefined,
          amount: p.amount ?? undefined,
          asset: evmAsset,
        },
      });
    },
    [linkedWallets],
  );

  // THE BRIDGE — choosing an option compiles params and opens the tested prepare→sign
  // modal via onLaunch. This chat never builds or signs the payload.
  const launchOption = useCallback(
    (o: StrategyOption, amount: number) => {
      if (o.kind === 'carry' && governed) return; // the cage has no borrow — see GOVERNED_NO_CARRY
      if (o.kind === 'lend-only') {
        onLaunch('e3', { amount: String(amount) });
      } else {
        // F16 — start from the HF the user asked for in this conversation, if
        // any; otherwise the same '1.10' default as before. Always editable
        // in the review modal before signing.
        onLaunch('e1', { amount: String(amount), ratio: String(o.borrowRatio ?? 0.3), targetHF: targetHF ?? '1.10' });
      }
    },
    [onLaunch, targetHF, governed],
  );

  return (
    <div className="flex flex-col h-[min(70vh,620px)] bg-surface-1 border border-ink/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink/5">
        <span className="grid place-items-center w-7 h-7 rounded-full bg-volt/15 text-volt">
          <Sparkles className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink leading-none">{t('Strategy assistant')}</p>
          <p className="text-[10px] text-ink/40 mt-0.5 truncate">
            {mode === 'carry'
              ? t('Shows you the options with real numbers — you decide and sign')
              : t('Drafts an automation you review — every trigger still needs your signature')}
          </p>
        </div>
        {/* Mode toggle — same chat, two cages (design doc §4: NOT a new chat) */}
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setMode('carry')}
            className={`text-[10px] px-2.5 py-1.5 rounded-lg border transition-colors ${
              mode === 'carry'
                ? 'bg-volt/15 text-volt border-volt/30'
                : 'bg-ink/[0.03] text-ink/50 border-ink/10 hover:text-ink'
            }`}
          >
            {t('Strategy')}
          </button>
          <button
            onClick={() => setMode('moneyflow')}
            className={`flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg border transition-colors ${
              mode === 'moneyflow'
                ? 'bg-volt/15 text-volt border-volt/30'
                : 'bg-ink/[0.03] text-ink/50 border-ink/10 hover:text-ink'
            }`}
          >
            <Workflow className="w-3 h-3" />
            MoneyFlow
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="pt-1">
            <p className="text-sm text-ink/70 leading-relaxed">
              {mode === 'carry'
                ? t('Tell me what you have and what you want to do — e.g. "I have 10,000 XRP and need $200 without selling". I\'ll show you the options with their real numbers; the decision is yours.')
                : t('Describe what you want to automate — e.g. "if my health factor drops below 1.5, prepare a repay". You review the draft and every trigger prepares a transaction only you can sign.')}
            </p>
            <div className="flex flex-col gap-1.5 mt-3">
              {(mode === 'carry' ? SUGGESTED : SUGGESTED_MONEYFLOW)[lang === 'es' ? 'es' : 'en'].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-[12px] px-3 py-2 rounded-lg border border-ink/10 bg-ink/[0.03] text-ink/75 hover:bg-ink/[0.07] hover:text-ink transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="space-y-2">
              <div className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-volt text-volt-ink rounded-br-sm'
                      : 'bg-ink/[0.05] text-ink/85 border border-ink/5 rounded-bl-sm'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    m.content ? (
                      /* the assistant types its reply in, live */
                      <TypewriterText text={m.content} done={!(streaming && i === messages.length - 1)} />
                    ) : streaming && i === messages.length - 1 ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-ink/40" />
                    ) : (
                      ''
                    )
                  ) : (
                    m.content
                  )}
                </div>
              </div>
              {/* Structured, neutral options table (numbers from tested math) + per-row bridge */}
              {m.role === 'assistant' && m.metrics && m.metrics.options.length > 0 && (
                <OptionsTable metrics={m.metrics} onPrepare={launchOption} governed={governed} t={t} />
              )}
              {/* F1 — validated CMF proposal: review happens in the modal, nothing persists here */}
              {m.role === 'assistant' && m.cmf && (
                <CmfProposalCard cmf={m.cmf} onReview={() => setReviewCmf(m.cmf!)} disabled={linkedWallets.length === 0} t={t} />
              )}
              {m.role === 'assistant' && !m.cmf && m.cmfIssues && m.cmfIssues.length > 0 && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/80 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{t('The draft did not pass validation — nothing was proposed.')}</div>
                    {m.cmfIssues.slice(0, 4).map((iss, k) => (
                      <div key={k} className="text-amber-200/60">{iss.message}</div>
                    ))}
                  </div>
                </div>
              )}
              {/* Compiled simple transfer — "Preparar" opens the tested modal prefilled */}
              {m.role === 'assistant' && m.transfer && (
                <TransferProposalCard
                  transfer={m.transfer}
                  wallets={linkedWallets}
                  onPrepare={() => launchTransfer(m.transfer!)}
                  t={t}
                />
              )}
              {m.role === 'assistant' && !m.transfer && m.transferIssues && m.transferIssues.length > 0 && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/80 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{t('The transfer could not be compiled — nothing was proposed.')}</div>
                    {m.transferIssues.slice(0, 4).map((iss, k) => (
                      <div key={k} className="text-amber-200/60">{iss.message}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {error && (
          <div className="text-[11px] text-red-300 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
        )}
      </div>

      {/* Composer */}
      <div className="px-3 py-3 border-t border-ink/5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={t('Describe what you want to do…')}
            className="flex-1 resize-none max-h-24 px-3 py-2 bg-ink/5 border border-ink/10 rounded-xl text-ink text-[13px] placeholder-ink/30 focus:outline-none focus:border-volt/50"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || streaming}
            className="shrink-0 grid place-items-center w-9 h-9 rounded-xl bg-volt text-volt-ink disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95 transition-all"
            aria-label={t('Send')}
          >
            {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[9px] text-ink/25 mt-1.5 text-center">
          {t('Numbers are live protocol data. Astryum prepares — you review and sign. No advice.')}
        </p>
      </div>

      {/* F1 — CUSTOM review modal: edit + activate through the existing rules
          path. Rules bind to a POSITION wallet (Smart Account / linked EVM),
          chosen in the modal — never the login address. */}
      {reviewCmf && (
        <CmfReviewModal
          cmf={reviewCmf}
          targets={ruleTargets}
          onClose={() => setReviewCmf(null)}
          onCreated={() => setReviewCmf(null)}
        />
      )}

      {/* Compiled transfer → the SAME tested prepare→review→sign modal used by
          Wallets/Movimientos, prefilled. Every field stays editable; the user
          reviews the disclosure and signs in their own wallet. */}
      {sendTransfer && (
        <WalletSendModal
          wallet={sendTransfer.wallet}
          wallets={linkedWallets}
          initial={sendTransfer.initial}
          onClose={() => setSendTransfer(null)}
        />
      )}
    </div>
  );
}

/** Compact proposal card for a compiled transfer — the real review (disclosure,
 *  fees, signer check) lives in the prepare→sign modal. */
function TransferProposalCard({
  transfer,
  wallets,
  onPrepare,
  t,
}: {
  transfer: TransferProposal;
  wallets: BackendWallet[];
  onPrepare: () => void;
  t: (s: string) => string;
}) {
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const label = (addr: string | null): string => {
    if (!addr) return t('to choose');
    const mine = wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
    return mine ? `${mine.nickname || mine.walletType} · ${short(mine.address)}` : short(addr);
  };
  const complete = !!transfer.toAddress && !!transfer.amount;
  return (
    <div className="rounded-xl border border-volt/25 bg-volt/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-ink/5">
        <ArrowUpRight className="w-3.5 h-3.5 text-volt shrink-0" />
        <span className="text-[12px] font-semibold text-ink truncate">
          {t('Transfer')}
          {transfer.amount ? ` · ${transfer.amount} ${transfer.asset ?? ''}`.trimEnd() : ''}
        </span>
      </div>
      <div className="px-3 py-2 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-ink/35">{t('From')}</div>
          <div className="text-ink/75 font-mono truncate">{label(transfer.fromAddress)}</div>
        </div>
        <div>
          <div className="text-ink/35">{t('To')}</div>
          <div className="text-ink/75 font-mono truncate">{label(transfer.toAddress)}</div>
        </div>
      </div>
      <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
        <span className="text-[9px] text-ink/35">
          {t('Astryum builds the payload unsigned — you review the fees and sign in your own wallet.')}
        </span>
        <button
          onClick={onPrepare}
          disabled={!complete}
          className="shrink-0 text-[10px] px-2.5 py-1.5 rounded-lg bg-volt text-volt-ink font-medium hover:brightness-95 transition-all disabled:opacity-40 whitespace-nowrap"
        >
          {t('Prepare')}
        </button>
      </div>
    </div>
  );
}

/** Compact proposal card for a validated CMF — the real review lives in the modal. */
function CmfProposalCard({
  cmf,
  onReview,
  disabled,
  t,
}: {
  cmf: CanonicalMoneyFlow;
  onReview: () => void;
  disabled: boolean;
  t: (s: string) => string;
}) {
  return (
    <div className="rounded-xl border border-volt/25 bg-volt/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-ink/5">
        <Workflow className="w-3.5 h-3.5 text-volt shrink-0" />
        <span className="text-[12px] font-semibold text-ink truncate">{cmf.name}</span>
        <span className="ml-auto text-[10px] text-ink/40 shrink-0">
          {cmf.steps.length} {cmf.steps.length === 1 ? t('step') : t('steps')}
        </span>
      </div>
      <div className="px-3 py-2 text-[11px] text-ink/60 leading-relaxed">{cmf.description}</div>
      <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
        <span className="text-[9px] text-ink/35">{t('Nothing runs until you review it — each trigger prepares a transaction only you can sign.')}</span>
        <button
          onClick={onReview}
          disabled={disabled}
          className="shrink-0 text-[10px] px-2.5 py-1.5 rounded-lg bg-volt text-volt-ink font-medium hover:brightness-95 transition-all disabled:opacity-40 whitespace-nowrap"
        >
          {t('Review & activate')}
        </button>
      </div>
    </div>
  );
}

/** Neutral options table — all options, unranked, each with its full honest picture. */
function OptionsTable({
  metrics,
  onPrepare,
  governed,
  t,
}: {
  metrics: StrategyMetrics;
  onPrepare: (o: StrategyOption, amount: number) => void;
  /** A council: the carry row is shown as unsupported, never as a button. */
  governed: boolean;
  t: (s: string) => string;
}) {
  const carryBlocked = governed && metrics.options.some((o) => o.kind === 'carry');
  return (
    <div className="rounded-xl border border-ink/10 bg-ink/[0.02] overflow-hidden">
      <div className="px-3 py-2 text-[11px] text-ink/50 border-b border-ink/5">
        {metrics.amountXrp.toLocaleString()} XRP ≈ {usd(metrics.collateralValueUSD)} ·{' '}
        {t('all options, unranked — the decision is yours')}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-ink/40 text-left">
              <th className="px-3 py-1.5 font-medium">{t('Option')}</th>
              <th className="px-3 py-1.5 font-medium text-right">{t('Cash now')}</th>
              <th className="px-3 py-1.5 font-medium text-right">{t('Cushion')}</th>
              <th className="px-3 py-1.5 font-medium text-right">{t('You lose the collateral below')}</th>
              <th className="px-3 py-1.5 font-medium text-right">{t('Interest you pay per year')}</th>
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {metrics.options.map((o, i) => {
              const blocked = governed && o.kind === 'carry';
              return (
              <tr key={i} className={`border-t border-ink/5 text-ink/80 ${blocked ? 'opacity-60' : ''}`}>
                <td className="px-3 py-2">{o.label}</td>
                <td className="px-3 py-2 text-right font-mono">{o.noDebt ? t('yield, no cash') : usd(o.borrowUsd)}</td>
                <td className="px-3 py-2 text-right">
                  {o.entryHF == null || o.entryHF === Infinity || o.entryHF > 1e6 ? (
                    <span className="text-emerald-300">{t('no debt')}</span>
                  ) : (
                    <>
                      {hfWord(o.entryHF, t).label}{' '}
                      <span className="font-mono text-ink/60">({o.entryHF.toFixed(2)})</span>
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {o.noLiquidationRisk ? <span className="text-emerald-300">{t('none')}</span> : price(o.liquidationPriceUSD)}
                </td>
                <td className="px-3 py-2 text-right font-mono">{o.noDebt ? '—' : usd(o.annualBorrowCostUsd)}</td>
                <td className="px-3 py-2 text-right">
                  {blocked ? (
                    <span className="text-[10px] px-2.5 py-1 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning font-medium whitespace-nowrap">
                      {t('Unsupported for a council')}
                    </span>
                  ) : (
                    <button
                      onClick={() => onPrepare(o, metrics.amountXrp)}
                      className="text-[10px] px-2.5 py-1 rounded-lg bg-volt text-volt-ink font-medium hover:brightness-95 transition-all whitespace-nowrap"
                    >
                      {t('Review before signing')}
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {carryBlocked && (
        <div className="px-3 py-2 text-[10px] leading-relaxed text-tone-warning/90 border-t border-ink/5">
          {t(GOVERNED_NO_CARRY)}
        </div>
      )}
      {metrics.notes.length > 0 && (
        <div className="px-3 py-2 text-[10px] text-ink/40 border-t border-ink/5">
          {metrics.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
    </div>
  );
}
