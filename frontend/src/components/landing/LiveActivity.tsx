'use client';

/**
 * LiveActivity — the public proof-of-life feed (founder 2026-07-26).
 *
 * The counterweight to the sign-up risk disclaimer: the disclaimer says
 * "this is experimental, it can fail" — this section shows, live and
 * verifiable, that operations REALLY execute through Astryum. Every row
 * links to the public explorers (XRPL + Flare), so nobody has to believe
 * us: the chain is the receipt. Same doctrine as /about ("No pedimos
 * confianza. La demostramos.").
 *
 * Data: GET /api/platform/activity (public, no auth) — real settled 0xFE
 * operations from the executor's audit rows. No mock data, ever: an empty
 * feed renders as an honest "no operations in this window", because a
 * transparency section that fakes activity would defeat its own purpose.
 * Amounts and hashes are public chain data; user addresses never travel
 * (aviso de privacidad §3.2).
 */

import { useEffect, useState } from 'react';
import { getApiBase } from '@/lib/env';
import { BORDER, GOLD, Reveal } from './interactions';
import { T, type Lang } from './useLang';

const POLL_MS = 30_000;
const XRPL_TX = (h: string) => `https://livenet.xrpl.org/transactions/${h}`;
const FLARE_TX = (h: string) => `https://flare-explorer.flare.network/tx/${h}`;

interface ActivityItem {
  at: string | null;
  xrp: number | null;
  xrplTxHash: string | null;
  flareTxHash: string | null;
}
interface ActivityFeed {
  total: number;
  recent: ActivityItem[];
  updatedAt: string;
}

/** "hace 4 min" / "4 min ago" — coarse on purpose; the explorer has the exact stamp. */
function timeAgo(iso: string | null, lang: Lang): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return T('ahora mismo', 'just now', lang);
  if (min < 60) return T(`hace ${min} min`, `${min} min ago`, lang);
  const h = Math.floor(min / 60);
  if (h < 24) return T(`hace ${h} h`, `${h} h ago`, lang);
  const d = Math.floor(h / 24);
  return T(`hace ${d} d`, `${d} d ago`, lang);
}

export default function LiveActivity({ lang }: { lang: Lang }) {
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${getApiBase()}/platform/activity`);
        if (!r.ok) throw new Error(`http_${r.status}`);
        const j = (await r.json()) as ActivityFeed;
        if (alive) {
          setFeed(j);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Backend unreachable (e.g. landing served without the API): the section
  // disappears rather than showing a broken promise of transparency.
  if (failed && !feed) return null;

  const rows = feed?.recent ?? [];

  return (
    <section id="live" className="px-6 pb-24">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <div className="flex items-center justify-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ background: GOLD }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: GOLD }} />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              {T('Transparencia · en vivo', 'Transparency · live', lang)}
            </p>
          </div>
          <h2
            className="mx-auto mt-4 max-w-2xl text-center font-bold text-white text-balance"
            style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}
          >
            {T('No nos creas: compruébalo en la cadena.', "Don't take our word for it: check the chain.", lang)}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-white/50">
            {T(
              'Cada operación ejecutada desde Astryum, en tiempo real y con su comprobante público. Ningún dato es nuestro: los enlaces van a los exploradores de XRPL y Flare, donde cualquiera puede verificarlo.',
              'Every operation executed through Astryum, in real time and with its public receipt. None of this data is ours: the links go to the XRPL and Flare explorers, where anyone can verify it.',
              lang,
            )}
          </p>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="mt-8 rounded-2xl p-5" style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}>
            <div className="flex items-baseline justify-between border-b border-white/8 pb-3">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/40" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                {T('Operaciones liquidadas', 'Settled operations', lang)}
              </span>
              <span className="text-xl font-bold tabular-nums text-white">{feed ? feed.total : '·'}</span>
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/40">
                {feed
                  ? T(
                      'Sin operaciones en esta ventana todavía — cuando las haya, aparecerán aquí solas.',
                      'No operations in this window yet — when there are, they will show up here on their own.',
                      lang,
                    )
                  : T('Leyendo la cadena…', 'Reading the chain…', lang)}
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {rows.map((r, i) => (
                  <li key={`${r.flareTxHash ?? r.xrplTxHash ?? i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-white/40">{timeAgo(r.at, lang)}</span>
                    <span className="font-semibold tabular-nums text-white/85">
                      {r.xrp != null ? `${r.xrp.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 6 })} XRP` : '—'}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      {r.xrplTxHash && (
                        <a
                          href={XRPL_TX(r.xrplTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-white/45 underline-offset-2 transition-colors hover:text-white/80 hover:underline"
                        >
                          XRPL ↗
                        </a>
                      )}
                      {r.flareTxHash && (
                        <a
                          href={FLARE_TX(r.flareTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline-offset-2 transition-colors hover:underline"
                          style={{ color: GOLD }}
                        >
                          Flare ↗
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-white/35">
              {T(
                'Datos on-chain públicos (hashes e importes). Nunca mostramos direcciones de usuarios. Se actualiza cada 30 s.',
                'Public on-chain data (hashes and amounts). We never show user addresses. Refreshes every 30 s.',
                lang,
              )}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
