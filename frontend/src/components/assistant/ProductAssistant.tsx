'use client';

/**
 * ProductAssistant — a floating "how does this work?" chat for non-crypto users.
 *
 * A living manual + GPS of the Astryum app. It consumes the PUBLIC, stateless SSE
 * endpoint POST /api/product-assistant/chat — still NO required auth, NO tools,
 * NO execution. The agent only explains the app and navigation, and (F29a) if the
 * user is logged in, it also grounds answers about "my health factor" etc. in
 * their REAL data — but strictly READ-ONLY: it never builds/signs anything, that
 * stays in the tested flow, and it never gets closer to signing.
 *
 * Separate from the StrategyAgent regex chat (which parametrises strategies) — this
 * is a clean, welcoming help surface for someone who doesn't know where to start.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Send, Loader2, ArrowRight } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { TypewriterText } from '../ui/motion';
import { getApiBase } from '../../lib/env';
import { useAuthorityStore } from '../../stores/authorityStore';
import { useLegacyJourney } from '../../lib/legacy/guideContext';
// The Guía's starters — the embedded Legacy chat is unmounted (2026-08-04);
// this co-pilot IS the Guía whenever the product toggle sits on Legacy.
import { SUGGESTED_DISCOVER, SUGGESTED_GUIDE } from '../legacy/LegacyDiscovery';

const API_BASE = getApiBase();

// Local pattern (same shape as DefiPositionsBoard.tsx / StrategyLLMChat.tsx):
// attach the logged-in user's token when present so the backend can ground
// answers in their own read-only data (F29a). No token ⇒ unchanged anonymous
// request — the endpoint stays public either way.
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** The guide no longer floats over content — its trigger lives in the app
 *  sidebar. Any surface can open it by dispatching this event. */
export const OPEN_GUIDE_EVENT = 'astryum:open-guide';
export function openProductAssistant() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_GUIDE_EVENT));
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Tappable starters for the user who doesn't know what to ask (KB §7). English
// keys so t() renders them in the user's language (ES translations in dict).
const SUGGESTED = [
  'What is the health factor?',
  'How do I put my XRP to work?',
  'What is a Carry strategy?',
  'Where do I see my positions?',
];

// Client-side mirror of the CAGE's §8 NAVEGACIÓN allowlist
// (backend/src/config/productAssistantPrompt.ts). Deliberately independent —
// the button that ends in router.push must never trust a route OR a label
// the model produced, only this fixed list compiled into the bundle. Label
// text comes from HERE, not from the marker, so a garbled/invented label
// from the model can never reach the screen either.
const GOTO_ALLOWLIST: { path: string; label: string }[] = [
  { path: '/app', label: 'Home' },
  { path: '/app/asset-production', label: 'Earn' },
  { path: '/app/asset-production?view=movements', label: 'Movements' },
  { path: '/app/portfolio', label: 'Portfolio' },
  { path: '/app/portfolio?tab=positions', label: 'Positions' },
  { path: '/app/wallets', label: 'Wallets' },
  { path: '/app/legacy', label: 'Legacy' },
  { path: '/app/settings', label: 'Settings' },
  { path: '/app/intents', label: 'Intents' },
];

const GOTO_MARKER_RE = /\[\[goto:([^|\]]+)\|([^\]]+)\]\]/g;

/**
 * Strip [[goto:ROUTE|LABEL]] markers out of the assistant's streamed text and
 * collect the destinations that survive GOTO_ALLOWLIST — an invented or
 * misspelled route is dropped silently (the prose around it stays, no button
 * appears). Also hides a marker that's still mid-flight: while the SSE
 * stream is still typing it in, "…ve a [[goto:/app/wa" is truncated at the
 * last unterminated "[[goto:" so raw marker syntax never flashes on screen.
 * This is navigation-only plumbing — the route only ever drives router.push,
 * same invariant as the rest of this component (the co-pilot never executes).
 */
function parseAssistantContent(content: string): { text: string; gotos: { path: string; label: string }[] } {
  const gotos: { path: string; label: string }[] = [];
  let text = content.replace(GOTO_MARKER_RE, (_match, route: string) => {
    const hit = GOTO_ALLOWLIST.find((d) => d.path === route.trim());
    if (hit && gotos.length < 2) gotos.push(hit); // CAGE caps at 2 — enforced again here, not just trusted
    return '';
  });

  const openIdx = text.lastIndexOf('[[goto:');
  if (openIdx !== -1 && !text.slice(openIdx).includes(']]')) {
    text = text.slice(0, openIdx);
  }

  return { text, gotos };
}

export default function ProductAssistant() {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // In Legacy product mode this co-pilot IS the Guía (founder 2026-08-04): it
  // talks to the Legacy assistant's public endpoint EXCLUSIVELY, grounded in
  // the abstract journey the panel publishes (ledger flags only — never
  // names, addresses or amounts). In Personal mode, unchanged.
  const productMode = useAuthorityStore((s) => s.productMode);
  const legacyMode = productMode === 'legacy';
  const journey = useLegacyJourney();

  // Flipping the product flips the brain — a conversation started against one
  // knowledge base answers wrong on the other. Fresh chat per side.
  useEffect(() => {
    setMessages([]);
    setError('');
  }, [legacyMode]);

  // F29a: re-check on every open (not just mount) so a login/logout that
  // happened while this component stayed mounted is reflected honestly.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLoggedIn(!!window.localStorage.getItem('auth_token'));
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  // The typewriter grows the last bubble without changing `messages` — keep
  // the view pinned to the bottom while the reply is being written in.
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, 250);
    return () => clearInterval(id);
  }, [streaming]);

  // Opened from the sidebar (AppShell) — no floating trigger of its own.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_GUIDE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, onOpen);
  }, []);

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
        const res = await fetch(
          `${API_BASE}/${legacyMode ? 'legacy-assistant' : 'product-assistant'}/chat`,
          {
            method: 'POST',
            // Personal: optional Bearer (F29a) — omitted when logged out, so
            // the request is byte-for-byte the old anonymous call. Legacy: the
            // Guía stays anonymous BY DESIGN — its promise is "never sees your
            // data"; the journey is abstract ledger flags only.
            headers: legacyMode ? { 'Content-Type': 'application/json' } : authHeaders(),
            body: JSON.stringify(
              legacyMode
                ? { message: trimmed, history, ...(journey ? { journey } : {}) }
                : { message: trimmed, history },
            ),
          },
        );
        if (res.status === 429) {
          setError(t('A lot of questions right now — give it a moment and try again.'));
          setMessages((m) => m.slice(0, -1)); // drop the empty assistant bubble
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
    [messages, streaming, legacyMode, journey, t],
  );

  // Same order as CommandPalette's go() (components/ui/AppShell.tsx): close
  // the panel first, then navigate — the co-pilot only ever opens a screen for
  // the user to act on, it never acts itself (invariant: navigate, don't execute).
  const goTo = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router],
  );

  return (
    <>
      {/* Chat panel — rises from the sidebar's guide button (bottom-left on
          desktop), so it reads as part of the shell instead of covering the
          page's own content in the corner. */}
      {open && (
        <div className="fixed bottom-4 left-4 lg:left-[268px] right-4 sm:right-auto z-40 sm:w-[min(92vw,380px)] h-[min(72vh,540px)] flex flex-col bg-surface-1 border border-ink/10 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink/5">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-volt/15">
                {/* The product's own mark (founder 2026-08-08): gold asteroid
                    as Co-pilot, blue as the Legacy guide. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={legacyMode ? '/astryum-mark-azul-transparente.png' : '/astryum-mark-gold-glow.png'}
                  alt=""
                  aria-hidden
                  style={{ width: 19, height: 19, display: 'block' }}
                />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink leading-none">
                  {legacyMode ? (journey ? t('Your guide on this Legacy') : t('Discover your Legacy')) : t('Co-pilot')}
                </p>
                <p className="text-[10px] text-ink/40 mt-0.5">
                  {legacyMode
                    ? journey
                      ? t('Reads this Legacy’s step from the ledger · never signs')
                      : t('Explains Legacy and finds your setup · never sees your data')
                    : loggedIn
                      ? t('Sees your data (read-only) — never signs or executes')
                      : t('Explains the app · never sees your data')}
                </p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-ink/40 hover:text-ink transition-colors" aria-label={t('Close')}>
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages / empty state */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 ? (
              <div className="pt-2">
                <p className="text-sm text-ink/70 leading-relaxed">
                  {legacyMode
                    ? journey
                      ? t('It knows which step this Legacy is on (read from the ledger) and points you to the next one. It never signs and never sees your data.')
                      : t('Tell me what you want to protect and for whom — I point you to the setup that fits. I never sign and never see your data.')
                    : t("I explain how Astryum works — where things live and what each screen does. Ask me anything about the app.")}
                </p>
                <p className="text-[11px] text-ink/35 mt-3 mb-2">{t('Try one of these:')}</p>
                <div className="flex flex-col gap-1.5">
                  {(legacyMode ? (journey ? SUGGESTED_GUIDE : SUGGESTED_DISCOVER) : SUGGESTED).map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-left text-[12px] px-3 py-2 rounded-lg border border-ink/10 bg-ink/[0.03] text-ink/75 hover:bg-ink/[0.07] hover:text-ink transition-colors"
                    >
                      {t(q)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                const done = !(streaming && isLast);
                // Markers only ever come from the assistant — strip [[goto:…]]
                // before it's ever shown, mid-stream or not (see parseAssistantContent).
                const { text: assistantText, gotos } =
                  m.role === 'assistant' ? parseAssistantContent(m.content) : { text: m.content, gotos: [] };
                return (
                  <div
                    key={i}
                    className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5'}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-volt text-volt-ink rounded-br-sm'
                          : 'bg-ink/[0.05] text-ink/85 border border-ink/5 rounded-bl-sm'
                      }`}
                    >
                      {m.role === 'assistant' ? (
                        assistantText ? (
                          /* the co-pilot types its reply in, live */
                          <TypewriterText text={assistantText} done={done} />
                        ) : streaming && isLast ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-ink/40" />
                        ) : (
                          ''
                        )
                      ) : (
                        m.content
                      )}
                    </div>
                    {/* Navigate buttons — under the bubble, only once the reply
                        is fully in (never mid-type) and only for destinations
                        that survived GOTO_ALLOWLIST. Prepare-only holds here
                        too: this is router.push, nothing signs or executes. */}
                    {m.role === 'assistant' && done && gotos.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 max-w-[85%]">
                        {gotos.map((g) => (
                          <GotoButton key={g.path} path={g.path} label={g.label} onNavigate={goTo} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {error && (
              <div className="text-[11px] text-tone-danger bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
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
                placeholder={legacyMode ? t('Ask about your Legacy…') : t('Ask about the app…')}
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
              {legacyMode
                ? t('This assistant only explains and suggests. It never signs, never sees your data, and gives no financial or legal advice.')
                : loggedIn
                  ? t('Logged in: this guide can read your balance and positions (read-only) to answer — it never signs, executes, or gives financial advice.')
                  : t('This guide only explains the app. It never sees your balance or positions, and gives no financial advice.')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A "go here" chip under a finished co-pilot reply. Same rounded-full pill
 * language as Pill (components/ui/primitives.tsx) but a real <button> — it's
 * interactive, Pill itself is a static span — tinted volt so it reads as an
 * invitation to click rather than a status tag. `label` is always the
 * allowlist's own copy (see GOTO_ALLOWLIST), never text the model wrote.
 */
function GotoButton({
  path,
  label,
  onNavigate,
}: {
  path: string;
  label: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={() => onNavigate(path)}
      className="inline-flex items-center gap-1.5 rounded-full border border-volt/30 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt hover:bg-volt/[0.14] hover:border-volt/45 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
    >
      {t(label)}
      <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
    </button>
  );
}
