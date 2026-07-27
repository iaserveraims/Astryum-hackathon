'use client';

/**
 * LegacyDiscovery — "Descubrir", the Legacy discovery agent's chat surface.
 *
 * The conversational front door to the Legacy product: it helps a non-expert say
 * what they want to protect and for whom, and points them to the setup that fits.
 * It consumes the PUBLIC, stateless SSE endpoint POST /api/legacy-assistant/chat —
 * NO auth, NO tools, NO execution. It explains and proposes a template; it never
 * builds a payload or reaches the signing path (invariants #1 / #7 / #8), and it
 * works on abstract intent only — real names/addresses stay in the browser and go
 * into the forms, never to the model.
 *
 * Reuses the exact SSE mechanics of ProductAssistant.tsx (proven), inlined here so
 * the discovery agent lives at the top of the Legacy entry instead of a floating
 * corner widget.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { TypewriterText } from '../ui/motion';
import { AsteroidMark, Card } from '../ui/primitives';
import { getApiBase } from '../../lib/env';

const API_BASE = getApiBase();

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * "Guía" — the abstract journey state of the Legacy under inspection: public
 * ledger facts (flags + small counters) the panel already read. NO addresses,
 * NO names, NO amounts ever leave the browser through this chat.
 */
export interface LegacyJourney {
  hasCouncil: boolean;
  memberCount?: number;
  quorum?: number;
  quorumMargin?: number;
  rehearsalComplete?: boolean;
  signedCount?: number;
  masterKeyDisabled?: boolean;
  constitutionAnchored?: boolean;
  escrowCount?: number;
}

// Starters for the person who doesn't know what to ask. English keys → t() renders
// them in the user's language (ES entries in dict.ts). The agent replies in the
// user's language regardless.
const SUGGESTED_DISCOVER = [
  'I want to protect my family — where do I start?',
  'What is the council and the quorum?',
  'I want to leave a fund for my kids with conditions',
  'How do the templates differ?',
];
// Inside a Legacy workspace the question changes: not "what do I need" but
// "what's next here" — the journey state grounds the answer.
const SUGGESTED_GUIDE = [
  'What is my next step?',
  'Why do I need the rehearsal before real capital?',
  'What does closing the door change?',
  'How do I amend the constitution?',
];

export default function LegacyDiscovery({ journey }: { journey?: LegacyJourney }) {
  const { t } = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError('');
      setInput('');
      const history = messages.map(({ role, content }) => ({ role, content }));
      setMessages((m) => [...m, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
      setStreaming(true);
      try {
        const res = await fetch(`${API_BASE}/legacy-assistant/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // journey = abstract ledger flags only ("Guía") — never names/addresses.
          body: JSON.stringify({ message: trimmed, history, ...(journey ? { journey } : {}) }),
        });
        if (res.status === 429) {
          setError(t('A lot of questions right now — give it a moment and try again.'));
          setMessages((m) => m.slice(0, -1));
          return;
        }
        if (!res.ok || !res.body) {
          throw new Error(t("The assistant didn't respond. Please try again."));
        }
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
            let payload: { type?: string; text?: string; message?: string };
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
    [messages, streaming, journey, t],
  );

  const suggested = journey ? SUGGESTED_GUIDE : SUGGESTED_DISCOVER;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-volt/15 text-volt">
          <AsteroidMark size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold leading-none text-ink">
            {journey ? t('Your guide on this Legacy') : t('Discover your Legacy')}
          </p>
          <p className="mt-1 text-[11px] text-ink/45">
            {journey
              ? t('It knows which step this Legacy is on (read from the ledger) and points you to the next one. It never signs and never sees your data.')
              : t('Tell me what you want to protect and for whom — I point you to the setup that fits. I never sign and never see your data.')}
          </p>
        </div>
      </div>

      {messages.length > 0 && (
        <div ref={scrollRef} className="max-h-[42vh] space-y-3 overflow-y-auto rounded-xl border border-ink/5 bg-ink/[0.02] p-3">
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            return (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-volt text-volt-ink'
                      : 'rounded-bl-sm border border-ink/5 bg-ink/[0.05] text-ink/85'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    m.content ? (
                      <TypewriterText text={m.content} done={!(streaming && isLast)} />
                    ) : streaming && isLast ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-ink/40" />
                    ) : (
                      ''
                    )
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            );
          })}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-tone-danger">{error}</div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggested.map((q) => (
            <button
              key={q}
              onClick={() => void send(q)}
              className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-left text-[12px] text-ink/75 transition-colors hover:bg-ink/[0.07] hover:text-ink"
            >
              {t(q)}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder={t('Tell me what you want to protect and for whom…')}
          className="max-h-24 flex-1 resize-none rounded-xl border border-ink/10 bg-ink/5 px-3 py-2 text-[13px] text-ink placeholder-ink/30 outline-none focus:border-volt/50"
        />
        <button
          onClick={() => void send(input)}
          disabled={!input.trim() || streaming}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-volt text-volt-ink transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('Send')}
        >
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-[9px] leading-relaxed text-ink/25">
        {t('This assistant only explains and suggests. It never signs, never sees your data, and gives no financial or legal advice.')}
      </p>
    </Card>
  );
}
