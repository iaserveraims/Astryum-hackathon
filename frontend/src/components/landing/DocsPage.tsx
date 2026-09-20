'use client';

/**
 * /docs — LA BIBLIOTECA, con la carcasa de las demás páginas.
 *
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import SubpageShell from './SubpageShell';
import { BORDER, BORDER_STRONG, EASE, GOLD, Reveal } from './interactions';
import { T, type Lang } from './useLang';
import { DOCS, PAPERS, slideSrc, type DocDeck, type DocPaper } from './docs/docsLibrary';

const GOLD_SOFT = 'hsl(var(--volt-soft, 45 75% 62%))';

/** El deck que pide el hash de la URL, o ninguno. */
function deckFromHash(): DocDeck | null {
  if (typeof window === 'undefined') return null;
  const id = window.location.hash.replace(/^#/, '');
  return DOCS.find((d) => d.id === id) ?? null;
}

export default function DocsPage() {
  return <SubpageShell>{(lang) => <Docs lang={lang} />}</SubpageShell>;
}

function Docs({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState<DocDeck | null>(null);

  // El hash es la fuente de verdad: así un enlace `/docs#legacy` abre Legacy,
  // «atrás» vuelve a la biblioteca, y recargar no pierde el sitio.
  useEffect(() => {
    const sync = () => setOpen(deckFromHash());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const show = useCallback((d: DocDeck | null) => {
    if (d) {
      window.location.hash = d.id;
      // Al abrir, arriba del lector: quien viene de la mitad de la biblioteca
      // no puede aterrizar en la mitad de un deck.
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      // Quitar el hash SIN dejar un `#` colgando en la URL ni saltar.
      history.pushState(null, '', window.location.pathname + window.location.search);
      setOpen(null);
    }
  }, []);

  return (
    <div className="px-6 md:px-10 lg:px-16 pt-32 md:pt-36 pb-24">
      <div className="mx-auto max-w-6xl">{open ? <Reader doc={open} lang={lang} onBack={() => show(null)} /> : <Library lang={lang} onOpen={show} />}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LA BIBLIOTECA
   ══════════════════════════════════════════════════════════════════════ */

function Library({ lang, onOpen }: { lang: Lang; onOpen: (d: DocDeck) => void }) {
  const total = DOCS.reduce((n, d) => n + d.slides.length, 0);
  return (
    <>
      <Reveal>
        <div className="max-w-3xl">
          <div className="text-[11px] font-mono uppercase tracking-[0.22em]" style={{ color: GOLD_SOFT }}>
            {T('Documentación', 'Documentation', lang)}
          </div>
          <h1
            className="mt-4 font-bold text-white text-balance"
            style={{ fontSize: 'clamp(2rem, 4.4vw, 3.4rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
          >
            {T('Todo lo que publicamos sobre Astryum, en un sitio.', 'Everything we publish about Astryum, in one place.', lang)}
          </h1>
          <p className="mt-5 text-white/55 leading-relaxed max-w-xl" style={{ fontSize: 'clamp(15px, 1.2vw, 17px)' }}>
            {T(
              'Se leen aquí, diapositiva a diapositiva y con índice, o se descargan en PDF. Versiones neutras: lo que hay, sin adjetivos.',
              'Read them here, slide by slide and with an index, or download the PDF. Neutral versions: what there is, without adjectives.',
              lang,
            )}
          </p>
        </div>
      </Reveal>

      <div className="mt-10 flex items-center justify-between gap-4 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/40">{T('Biblioteca', 'Library', lang)}</div>
        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/30">
          {DOCS.length + PAPERS.length} {T('documentos', 'documents', lang)} · {total} {T('diapositivas', 'slides', lang)}
        </div>
      </div>

      <ul className="mt-8 grid gap-6 sm:grid-cols-2 m-0 p-0 list-none">
        {DOCS.map((d, i) => (
          <li key={d.id}>
            <Reveal delay={0.06 + i * 0.07}>
              <Card doc={d} lang={lang} onOpen={() => onOpen(d)} />
            </Reveal>
          </li>
        ))}
      </ul>

      {/* ── LOS DOCUMENTOS WEB ───────────────────────────────────────────
          Debajo de los decks y no mezclados: se leen de otra manera (una
          página propia, no el lector de diapositivas), y una rejilla con
          fichas con portada y fichas sin ella se lee como un fallo de carga. */}
      <div className="mt-14 flex items-center justify-between gap-4 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/40">{T('Documentos', 'Papers', lang)}</div>
        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/30">
          {T('Se abren en su propia página', 'They open on their own page', lang)}
        </div>
      </div>

      <ul className="mt-8 grid gap-6 sm:grid-cols-2 m-0 p-0 list-none">
        {PAPERS.map((d, i) => (
          <li key={d.id}>
            <Reveal delay={0.06 + i * 0.07}>
              <PaperCard doc={d} lang={lang} />
            </Reveal>
          </li>
        ))}
      </ul>
    </>
  );
}
/**
 * La ficha de un DOCUMENTO WEB. Misma piel que `Card`, sin portada: un paper
 * no tiene primera diapositiva que enseñar, y fingir una sería mentir sobre lo
 * que hay dentro. «Leer» no abre el lector — abre su propia página.
 */
function PaperCard({ doc, lang }: { doc: DocPaper; lang: Lang }) {
  return (
    <article
      className="relative flex h-full flex-col overflow-hidden rounded-2xl p-5 md:p-6"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.025)' }}
    >
      <span
        className="self-start rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em]"
        style={{ background: 'rgba(12,11,9,0.7)', border: `1px solid ${BORDER_STRONG}`, color: GOLD_SOFT }}
      >
        {doc.kind}
      </span>
      <h2 className="mt-4 text-[19px] font-semibold text-white leading-snug">{doc.title}</h2>
      <p className="mt-2 text-[14px] text-white/55 leading-relaxed">{doc.context}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono uppercase tracking-[0.14em] text-white/35">
        <span>{doc.date}</span>
        {doc.facts.map((f) => (
          <span key={f} className="contents">
            <span aria-hidden>·</span>
            <span>{f}</span>
          </span>
        ))}
        <span aria-hidden>·</span>
        <span>{doc.size}</span>
      </div>

      <div className="mt-auto flex items-center gap-3 pt-5">
        <a
          href={doc.page}
          className="inline-flex items-center rounded-xl px-4 py-2 text-[13px] font-semibold text-black transition hover:brightness-105"
          style={{ background: GOLD }}
        >
          {T('Leer', 'Read', lang)}
        </a>
        <a
          href={doc.pdf}
          download={doc.filename}
          className="inline-flex items-center rounded-xl px-4 py-2 text-[13px] font-medium text-white/75 transition hover:text-white"
          style={{ border: `1px solid ${BORDER_STRONG}` }}
        >
          PDF
        </a>
      </div>
    </article>
  );
}
function Card({ doc, lang, onOpen }: { doc: DocDeck; lang: Lang; onOpen: () => void }) {
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.025)' }}
    >
      {/* LA PORTADA: la primera diapositiva, y es un botón entero. En una
          biblioteca la portada es lo que se coge. */}
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full overflow-hidden text-left"
        style={{ aspectRatio: '16 / 9', background: '#0c0b09' }}
        aria-label={T(`Leer ${doc.title}`, `Read ${doc.title}`, lang)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slideSrc(doc, 1)}
          alt=""
          width={1920}
          height={1080}
          loading="lazy"
          decoding="async"
          className="block h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
          style={{ transitionTimingFunction: `cubic-bezier(${EASE.join(',')})` }}
        />
        {/* un velo suave abajo, para que el pie de la ficha no se pegue a la
            imagen; sin él la portada y la tarjeta son dos bloques */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
          style={{ background: 'linear-gradient(180deg, rgba(12,11,9,0), rgba(12,11,9,0.85))' }}
        />
        <span
          className="absolute left-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em]"
          style={{ background: 'rgba(12,11,9,0.7)', border: `1px solid ${BORDER_STRONG}`, color: GOLD_SOFT }}
        >
          {doc.kind}
        </span>
      </button>

      <div className="flex flex-1 flex-col p-5 md:p-6">
        <h2 className="text-[19px] font-semibold text-white leading-snug">{doc.title}</h2>
        <p className="mt-2 text-[14px] text-white/55 leading-relaxed">{doc.context}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono uppercase tracking-[0.14em] text-white/35">
          <span>{doc.date}</span>
          <span aria-hidden>·</span>
          <span>
            {doc.slides.length} {T('diapositivas', 'slides', lang)}
          </span>
          <span aria-hidden>·</span>
          <span>{doc.size}</span>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center rounded-xl px-4 py-2 text-[13px] font-semibold text-black transition hover:brightness-105"
            style={{ background: GOLD }}
          >
            {T('Leer aquí', 'Read here', lang)}
          </button>
          <a
            href={doc.pdf}
            download={doc.filename}
            className="inline-flex items-center rounded-xl px-4 py-2 text-[13px] font-medium text-white/75 transition hover:text-white"
            style={{ border: `1px solid ${BORDER_STRONG}` }}
          >
            PDF
          </a>
        </div>
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL LECTOR
   ══════════════════════════════════════════════════════════════════════ */

function Reader({ doc, lang, onBack }: { doc: DocDeck; lang: Lang; onBack: () => void }) {
  const [current, setCurrent] = useState(1);

  // La diapositiva en curso, para el índice: la que más ocupa el visor. Un
  // IntersectionObserver con varios umbrales basta; nada de escuchar el
  // scroll a mano.
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-slide]'));
    if (!nodes.length) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.slide), e.intersectionRatio);
        let best = 1;
        let bestR = -1;
        ratios.forEach((r, n) => {
          if (r > bestR) {
            bestR = r;
            best = n;
          }
        });
        setCurrent(best);
      },
      { threshold: [0.25, 0.5, 0.75], rootMargin: '-15% 0px -35% 0px' },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [doc.id]);

  const jump = (n: number) => {
    document.getElementById(`${doc.id}-s${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
      {/* ── LA CABECERA DEL LECTOR ───────────────────────────────────── */}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.18em] text-white/45 transition hover:text-white"
          >
            {/* el galón de la casa, hacia la izquierda: la única flecha de la
                web sigue siendo la del indicador de scroll */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 5L8.6 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {T('Biblioteca', 'Library', lang)}
          </button>
          <div className="mt-4 text-[11px] font-mono uppercase tracking-[0.22em]" style={{ color: GOLD_SOFT }}>
            {doc.kind} · {doc.date} · {doc.lang}
          </div>
          <h1
            className="mt-2 font-bold text-white text-balance"
            style={{ fontSize: 'clamp(1.8rem, 3.4vw, 2.8rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
          >
            {doc.title}
          </h1>
          <p className="mt-3 max-w-2xl text-white/55 leading-relaxed" style={{ fontSize: 'clamp(14px, 1.1vw, 16px)' }}>
            {doc.context}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={doc.pdf}
            download={doc.filename}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-black transition hover:brightness-105"
            style={{ background: GOLD }}
          >
            {T('Descargar PDF', 'Download PDF', lang)}
            <span className="font-mono text-[11px] font-normal opacity-70">{doc.size}</span>
          </a>
        </div>
      </div>

      {/* ── EL SELECTOR DE DOCUMENTO: cambiar de deck sin volver ────────
          Es el «selector» que pedía el fundador: desde dentro de un deck se
          salta a otro en un clic, y el que estás leyendo va marcado. */}
      <div className="mt-8 flex flex-wrap gap-2">
        {DOCS.map((d) => {
          const on = d.id === doc.id;
          return (
            <a
              key={d.id}
              href={`#${d.id}`}
              aria-current={on ? 'page' : undefined}
              className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
              style={
                on
                  ? { background: GOLD, color: '#000', border: `1px solid ${GOLD}` }
                  : { border: `1px solid ${BORDER_STRONG}`, color: 'rgba(255,255,255,0.6)' }
              }
            >
              {d.tab}
            </a>
          );
        })}
      </div>

      {/* ── ÍNDICE + DIAPOSITIVAS ──────────────────────────────────────── */}
      <div className="mt-10 grid gap-10 lg:grid-cols-[260px,minmax(0,1fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">{T('Índice', 'Contents', lang)}</div>
          <nav className="mt-4 space-y-5" aria-label={T('Índice del documento', 'Document contents', lang)}>
            {doc.groups.map(([name, a, b]) => (
              <div key={name}>
                <div className="text-[12px] font-semibold text-white/70">{name}</div>
                <ol className="mt-1.5 m-0 p-0 list-none space-y-0.5">
                  {doc.slides.slice(a - 1, b).map(([head], k) => {
                    const n = a + k;
                    const on = n === current;
                    return (
                      <li key={n}>
                        <button
                          type="button"
                          onClick={() => jump(n)}
                          className="flex w-full items-baseline gap-2.5 rounded-md px-2 py-1 text-left text-[12.5px] leading-snug transition-colors hover:bg-white/[0.04]"
                          style={{ color: on ? GOLD : 'rgba(255,255,255,0.5)' }}
                          aria-current={on ? 'true' : undefined}
                        >
                          <span className="w-5 shrink-0 font-mono text-[10.5px] opacity-60">{String(n).padStart(2, '0')}</span>
                          <span className="truncate">{head}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </nav>
          <div className="mt-6 space-y-1.5 pt-5 text-[12px]" style={{ borderTop: `1px solid ${BORDER}` }}>
            {doc.links.map(([label, href]) => (
              <a key={href} href={href} target="_blank" rel="noreferrer" className="block text-white/45 underline-offset-4 transition hover:text-white hover:underline">
                {label}
              </a>
            ))}
          </div>
        </aside>

        <ol className="m-0 p-0 list-none space-y-12">
          {doc.slides.map(([head, sub], k) => {
            const n = k + 1;
            return (
              <li key={n} id={`${doc.id}-s${n}`} data-slide={n} className="scroll-mt-28">
                <figure className="m-0">
                  <div
                    className="overflow-hidden rounded-xl"
                    style={{ border: `1px solid ${BORDER}`, background: '#0c0b09', aspectRatio: '16 / 9' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={slideSrc(doc, n)}
                      alt={`${T('Diapositiva', 'Slide', lang)} ${n}: ${head}`}
                      width={1920}
                      height={1080}
                      loading={n <= 2 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="block h-full w-full"
                    />
                  </div>
                  <figcaption className="mt-3 flex items-baseline gap-3">
                    <span className="shrink-0 font-mono text-[11px] text-white/35">{String(n).padStart(2, '0')}</span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-white">{head}</span>
                      <span className="block text-[13.5px] text-white/50 leading-snug">{sub}</span>
                    </span>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ol>
      </div>
    </motion.div>
  );
}
