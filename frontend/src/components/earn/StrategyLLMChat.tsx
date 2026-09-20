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
import { Sparkles, Send, Loader2, Workflow, AlertTriangle, ArrowUpRight, History } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { walletDisplayName } from '../../lib/walletIdentity';
import { ChatMarkdown } from '../ui/ChatMarkdown';
import { loadChats, newChatId, saveChat, type StoredChat } from '../../lib/agent/chatHistory';
import { AgentHistoryPanel } from './AgentHistory';

/**
 * SmoothMarkdown — el texto del stream, alisado. Los deltas llegan a golpes de chunk; esto revela el
 * contenido a caudal constante (rAF, acelerando si se queda atrás) y pinta
 * el markdown sobre la parte revelada — la máquina de escribir de antes,
 * pero con formato. Solo lo usa el mensaje VIVO; los terminados renderizan
 * ChatMarkdown directo, sin coste por frame.
 */
function SmoothMarkdown({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= text.length) return;
    let raf = 0;
    const tick = () => {
      setShown((s2) => {
        if (s2 >= text.length) return s2;
        // Caudal base de ~2 chars/frame; si el modelo va muy por delante,
        // acelera para no quedarse rezagado al terminar.
        return Math.min(text.length, s2 + Math.max(2, Math.ceil((text.length - s2) / 24)));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, shown]);
  return <ChatMarkdown text={text.slice(0, shown)} />;
}
import { getApiBase } from '../../lib/env';
import { useSmartAccountsOf } from '../../hooks/useSmartAccountsOf';
import type { LaunchStrategy } from './StrategyAgent';
import type { VaultKind } from './FlareDemoEarn';
import { ConstellationScene } from './icons';
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
  onBrowseRoutes,
  seed,
  seedKey,
  restoreId,
  restoreKey,
  variant = 'screen',
}: {
  onLaunch: LaunchStrategy;
  /** True when the active authority is a council (governed account). */
  governed?: boolean;
  /**
   * Ir al catálogo. UN enlace, no una lista. Las rutas vivas
   * han estado dentro del chat y en un raíl al lado, y ninguna de las dos
   * gustó: son el contenido de OTRA pantalla, y meterlas aquí obliga al chat a
   * competir con ellas por el mismo alto. Queda la puerta, no el escaparate.
   */
  onBrowseRoutes?: () => void;
  /** La frase de la barra de mando: se envía sola como primer
   *  mensaje al montar — el usuario ya la escribió, repetírsela sería burla. */
  seed?: string;
  /** Una nueva frase de la barra con el chat YA montado (operación viva):
   *  cambiar el número re-envía `seed` como mensaje en la misma conversación. */
  seedKey?: number;
  /** Un chat del historial que abrir ya restaurado (relojito del héroe, sin
   *  chat de por medio); mismo contrato de key que el seed. */
  restoreId?: string;
  restoreKey?: number;
  /** 'inline': desplegado bajo la barra dentro de un menú — alto contenido.
   *  'fill': dentro de una ventana de operación (anclada o flotante) — ocupa
   *  el hueco que le den. 'screen': la vista create de siempre. */
  variant?: 'screen' | 'inline' | 'fill';
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
  // ── Historial local: 30 días en ESTE navegador ──
  const chatIdRef = useRef<string | null>(null);
  const chatStartedRef = useRef<number>(0);
  /** Espejo de `messages` para el flush de desmontaje (un cleanup no ve el
   *  estado actual, ve el del render que lo registró). */
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  messagesRef.current = messages;
  const historyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [historyOpen]);
  // Guardar tras cada turno completado — solo role+content (las tarjetas
  // llevan números vivos y botones: no se restauran, ver chatHistory.ts).
  const persistNow = useCallback(() => {
    const msgs = messagesRef.current;
    const firstUser = msgs.find((m2) => m2.role === 'user');
    if (!firstUser) return;
    if (!chatIdRef.current) {
      chatIdRef.current = newChatId();
      chatStartedRef.current = Date.now();
    }
    saveChat({
      id: chatIdRef.current,
      startedAt: chatStartedRef.current || Date.now(),
      updatedAt: Date.now(),
      title: firstUser.content.slice(0, 64),
      messages: msgs.filter((m2) => m2.content).map((m2) => ({ role: m2.role, content: m2.content })),
    });
  }, []);
  useEffect(() => {
    if (streaming || messages.length === 0) return;
    persistNow();
  }, [streaming, messages, persistNow]);
  // FLUSH al desmontar (revisión): la X del agente cierra a la
  // primera con la promesa de que «la conversación queda en el historial» —
  // pero cerrada A MEDIA RESPUESTA no se había guardado nada (el efecto de
  // arriba calla mientras streaming) y, si era el primer turno, el chat ni
  // existía. Ahora el desmontaje guarda lo que haya (respuesta parcial
  // incluida — es registro honesto de lo que se vio) y ABORTA el stream, que
  // seguía leyéndose contra un componente muerto.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      persistNow();
    },
    [persistNow],
  );
  // Cambiar de conversación LIMPIA el contexto numérico acumulado (revisión:
  // amount/target/HF sobrevivían al «Nueva conversación» y la
  // siguiente pregunta calculaba la tabla —y prellenaba el prepare— con los
  // 10.000 XRP de un chat abandonado). El precio honesto: en un chat
  // restaurado el agente vuelve a preguntar la cantidad en vez de heredar
  // una que quizá era de OTRA conversación.
  const resetConversationContext = () => {
    // Un stream en vuelo pertenece a la conversación que se abandona: sin
    // esto, su cola de deltas caía dentro de la recién abierta (revisión).
    // El catch de send traga el AbortError sin tocar nada.
    abortRef.current?.abort();
    setAmountXrp(undefined);
    setTargetUsd(undefined);
    setTargetHF(undefined);
    setReviewCmf(null);
    setSendTransfer(null);
    setError('');
  };
  const restoreChat = (c: StoredChat) => {
    chatIdRef.current = c.id;
    chatStartedRef.current = c.startedAt;
    setMessages(c.messages.map((m2) => ({ role: m2.role, content: m2.content })));
    resetConversationContext();
    setHistoryOpen(false);
  };
  const startNewChat = () => {
    chatIdRef.current = null;
    chatStartedRef.current = 0;
    setMessages([]);
    resetConversationContext();
    setHistoryOpen(false);
  };
  // Restauración pedida DESDE FUERA (relojito del héroe): por
  // key, como el seed — dos toques a la misma conversación restauran igual.
  const lastRestoreKey = useRef<number | null>(null);
  useEffect(() => {
    const key = restoreKey ?? 0;
    if (!restoreId || lastRestoreKey.current === key) return;
    lastRestoreKey.current = key;
    const c = loadChats().find((x) => x.id === restoreId);
    if (c) restoreChat(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreId, restoreKey]);
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
  // transacts on Flare: the Smart Account of each linked
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
            // La dueña con la regla canónica de nombres: apodo →
            // marca → dirección corta. El walletType crudo jamás es un nombre.
            label: `Smart Account · ${walletDisplayName(w, t)}`,
            kind: 'smart-account',
          });
        }
      } else if (rail === 'evm' && !seen.has(w.address.toLowerCase())) {
        seen.add(w.address.toLowerCase());
        out.push({
          address: w.address,
          label: walletDisplayName(w, t),
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

      // Capada y sin vacíos ANTES de viajar (revisión): el schema
      // rechaza content vacío (min 1) y más de 20 turnos (max 20) — sin este
      // filtro, un turno del asistente sin texto envenenaba TODAS las
      // peticiones siguientes, y la conversación nº12 devolvía 400 a secas.
      // El backend ya recorta a -18 por su lado; aquí igual, para pasar el cap.
      const history = messages
        .filter((m2) => m2.content)
        .slice(-18)
        .map(({ role, content }) => ({ role, content }));
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
          label: walletDisplayName(w, t).slice(0, 80),
          address: w.address,
          rail: rail as 'evm' | 'xrpl',
        }));
      setMessages((m) => [...m, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
      setStreaming(true);
      try {
        // Abortable: si la ventana del agente se cierra a media respuesta, el
        // stream muere con ella (ver el flush de desmontaje).
        abortRef.current = new AbortController();
        const res = await fetch(`${API_BASE}/strategy-assistant/chat`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          signal: abortRef.current.signal,
          body: JSON.stringify({
            message: trimmed,
            history,
            amountXrp: nextAmount,
            targetUsd: nextTarget,
            mode,
            wallets: walletSummaries,
            transferThread,
            governed,
            // El idioma del dashboard — para las notas compuestas del backend
            // (la tarjeta estructurada); la prosa del LLM sigue la regla dura
            // del idioma del último mensaje.
            lang: lang === 'es' ? 'es' : 'en',
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
        // Abortado = la ventana se cerró: no hay nadie a quien contarle nada.
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message || t("The assistant didn't respond. Please try again."));
        setMessages((m) => (m[m.length - 1]?.content === '' ? m.slice(0, -1) : m));
      } finally {
        setStreaming(false);
      }
    },
    [messages, streaming, amountXrp, targetUsd, targetHF, mode, linkedWallets, governed, t, lang],
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

  // El seed de la barra de mando: un disparo por seedKey — al montar, y cada
  // vez que la barra manda una frase NUEVA a un chat ya vivo (operación
  // anclada/minimizada): misma conversación, un mensaje más.
  const lastSeedKey = useRef<number | null>(null);
  useEffect(() => {
    const key = seedKey ?? 0;
    // La key se consume SOLO al despachar de verdad (revisión: se
    // estampaba antes de saber si send haría algo, y send calla mientras
    // `streaming` — la frase de la barra se perdía sin rastro). Con streaming
    // en las dependencias, la frase pendiente sale sola al liberarse el chat;
    // una más nueva la sustituye (gana la última, como en la barra).
    if (seed && lastSeedKey.current !== key && !streaming) {
      lastSeedKey.current = key;
      void send(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, seedKey, streaming]);

  return (
    /* EL CHAT ES LA PANTALLA. Antes era una tarjeta de 700px de alto flotando en una página
       mucho más grande, con el catálogo dentro peleando por ese mismo alto.
       Ahora ocupa el viewport menos el encabezado, con un suelo para que en una
       ventana baja siga siendo un espacio de trabajo y no una ranura. La tabla
       de opciones que el agente devuelve necesita ese ancho y ese alto: es
       donde se leen las cifras que luego se firman. */
    <div
      className={`flex flex-col bg-surface-1 border border-ink/10 rounded-2xl overflow-hidden ${
        variant === 'inline'
          ? 'h-[min(62dvh,34rem)] min-h-[380px]'
          : variant === 'fill'
            ? 'h-full min-h-0 flex-1 border-0 rounded-none'
            : 'h-[calc(100dvh-15rem)] min-h-[540px] max-h-[900px]'
      }`}
    >
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
        {/* Historial local — 30 días en este navegador, jamás en servidor. */}
        <div className="relative shrink-0" ref={historyRef}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            title={t('History')}
            className={`grid h-7 w-7 place-items-center rounded-lg border transition-colors ${
              historyOpen ? 'border-volt/30 bg-volt/10 text-volt' : 'border-ink/10 bg-ink/[0.03] text-ink/50 hover:text-ink'
            }`}
          >
            <History className="h-3.5 w-3.5" />
          </button>
          {historyOpen && (
            /* La MISMA lista que abre el relojito del héroe (AgentHistory,)
               — una pieza, no dos que se parecen. */
            <div className="absolute right-0 z-30 mt-1.5">
              <AgentHistoryPanel onRestore={restoreChat} onNew={startNewChat} />
            </div>
          )}
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
          /* Centrado en el panel, no colgando de arriba: en un contenedor alto
             el contenido pegado al techo deja un vacío que parece un fallo de
             carga. `my-auto` lo sitúa en el medio y lo deja crecer cuando la
             ventana es baja. */
          <div className="flex min-h-full flex-col items-center justify-center px-2 py-6 text-center">
            {/* The agent's own scene — the constellation that compiles itself,
                the same mark its Earn door wears. */}
            <div className="opacity-80" aria-hidden>
              <ConstellationScene width={190} height={140} />
            </div>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink/70">
              {mode === 'carry'
                ? t('Tell me what you have and what you want to do — e.g. "I have 10,000 XRP and need $200 without selling". I\'ll show you the options with their real numbers; the decision is yours.')
                : t('Describe what you want to automate — e.g. "if my health factor drops below 1.5, prepare a repay". You review the draft and every trigger prepares a transaction only you can sign.')}
            </p>
            <div className="mt-6 grid w-full max-w-2xl gap-2.5 sm:grid-cols-2">
              {(mode === 'carry' ? SUGGESTED : SUGGESTED_MONEYFLOW)[lang === 'es' ? 'es' : 'en'].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-3 text-left text-[12.5px] leading-snug text-ink/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-volt/30 hover:bg-volt/[0.06] hover:text-ink hover:shadow-[0_8px_24px_-12px_hsl(var(--volt)/0.35)]"
                >
                  {q}
                </button>
              ))}
            </div>
            {/* La puerta al catálogo: una línea, y solo en modo estrategia —
                la automatización no tiene rutas que ofrecer. */}
            {mode === 'carry' && onBrowseRoutes && (
              <button
                onClick={onBrowseRoutes}
                className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-ink/45 transition-colors hover:text-volt"
              >
                {t('Or browse the ready-made routes')}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* The three honest beats — moved in from the dead rail. */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] text-ink/40">
              {[
                t('Describe what you have and what you want.'),
                t('The agent compiles it with live protocol numbers.'),
                t('You review every figure and sign in your own wallet.'),
              ].map((step, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <span className="w-4 h-4 grid place-items-center rounded-full border border-volt/25 bg-volt/[0.08] text-volt font-mono text-[9px]">
                    {i + 1}
                  </span>
                  {step}
                </span>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="space-y-2">
              <div className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed transition-colors ${
                    m.role === 'user'
                      ? 'max-w-[88%] whitespace-pre-wrap bg-volt text-volt-ink rounded-br-sm'
                      : 'max-w-[95%] bg-ink/[0.05] text-ink/85 border border-ink/5 rounded-bl-sm hover:border-ink/15'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    m.content ? (
                      /* Markdown renderizado en vivo — el mensaje VIVO pasa
                         por el alisador de caudal; los terminados, directos. */
                      streaming && i === messages.length - 1 ? (
                        <SmoothMarkdown text={m.content} />
                      ) : (
                        <ChatMarkdown text={m.content} />
                      )
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
      {/* Ideas de prompt A MANO también en conversación: tres chips discretos sobre el compositor, solo con el
          input vacío y el agente callado — tocar una la envía. */}
      {messages.length > 0 && !streaming && input.trim() === '' && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
          {(mode === 'carry' ? SUGGESTED : SUGGESTED_MONEYFLOW)[lang === 'es' ? 'es' : 'en'].slice(0, 3).map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-1 text-[11px] text-ink/55 transition-all duration-200 hover:-translate-y-px hover:border-volt/30 hover:bg-volt/[0.06] hover:text-ink"
            >
              {q}
            </button>
          ))}
        </div>
      )}
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
            className="flex-1 resize-none max-h-28 px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-[13px] placeholder-ink/30 focus:outline-none focus:border-volt/50"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || streaming}
            className="shrink-0 grid place-items-center w-10 h-10 rounded-xl bg-volt text-volt-ink disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95 transition-all"
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
    return mine ? `${walletDisplayName(mine, t)} · ${short(mine.address)}` : short(addr);
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
  // El backend FILTRA las filas carry para un consejo, así que «hay carry en
  // las opciones» ya no ocurre nunca: la nota se muestra siempre que la
  // cuenta es gobernada y hay tabla — explica por qué solo hay una fila.
  const carryBlocked = governed && metrics.options.length > 0;
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
                <td className="px-3 py-2">
                  {o.noDebt
                    ? t('Supply only (no loan)')
                    : `${t('Carry — using')} ${Math.round((o.borrowRatio ?? 0) * 100)}${t('% of your borrowing capacity')}`}
                </td>
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
