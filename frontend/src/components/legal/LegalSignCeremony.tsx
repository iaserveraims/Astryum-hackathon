'use client';

/**
 * LegalSignCeremony — LEER Y FIRMAR, de verdad.
 *
 * Antes había dos casillas y dos enlaces que casi nadie abría. Ahora el
 * documento ESTÁ aquí: se lee en su caja, hay que llegar al final de cada
 * uno de los que toca firmar —el carril lo dice mientras no lo estén— y la
 * firma es el gesto de Xaman, el mismo que el usuario hará después en cada
 * transacción.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, BadgeCheck, Check, FileText, ScrollText, ShieldCheck, X } from 'lucide-react';
import { useMotionLevel } from '../../stores/motionStore';
import { DemoTermsBody } from '../landing/DemoTermsPage';
import { PrivacyNoticeBody } from '../landing/PrivacyPage';
import { T, type Lang } from '../landing/useLang';
import { SlideToSign } from './SlideToSign';

const GOLD_SOFT = '#E8C25A';
export type LegalDocId = 'terms' | 'privacy';
export type LegalGateReason = 'first' | 'terms' | 'privacy' | 'both';

/** Lo que la cuenta tiene firmado, si algo. */
export interface LegalRecord {
  termsVersion: string | null;
  privacyVersion: string | null;
  acceptedAt: string | null;
}

function fmtWhen(iso: string | null | undefined, lang: Lang): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toISOString();
  }
}

/**
 * La caja de lectura: el documento dentro, y la certeza de haber llegado al
 * final. Un solo documento montado a la vez — una caja oculta mide 0 de alto y
 * se daría por leída sola, que es justo el atajo que esto evita.
 */
function DocScroller({
  children,
  onEnd,
  onProgress,
  label,
}: {
  children: ReactNode;
  onEnd: () => void;
  onProgress: (pct: number) => void;
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  const check = useCallback(() => {
    const el = boxRef.current;
    if (!el || el.clientHeight === 0) return; // sin maquetar aún: no se afirma nada
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 8) {
      // Cabe entero: leerlo es verlo.
      onProgress(100);
      onEnd();
      return;
    }
    const pct = Math.min(100, Math.round((el.scrollTop / max) * 100));
    onProgress(pct);
    if (el.scrollTop >= max - 24) onEnd();
  }, [onEnd, onProgress]);

  useEffect(() => {
    check();
    const inner = innerRef.current;
    if (!inner) return;
    // El alto cambia mientras cargan fuentes y tablas: sin observarlo, el
    // «falta un 2%» se queda clavado y la firma no se desbloquea nunca.
    const ro = new ResizeObserver(check);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [check]);

  return (
    <div
      ref={boxRef}
      onScroll={check}
      tabIndex={0}
      role="region"
      aria-label={label}
      className="scrollbar-thin h-[min(48vh,24rem)] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-black/30 px-4 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

export function LegalSignCeremony({
  lang: initialLang,
  heading,
  intro,
  signLabel,
  busy = false,
  error,
  onSigned,
  onCancel,
  signed = false,
  signedAt,
  versionLine,
  require = ['terms', 'privacy'],
  reason,
  accepted,
  currentVersions,
}: {
  lang: Lang;
  heading?: string;
  intro?: string;
  /** Qué se firma, escrito en el propio carril. */
  signLabel?: string;
  busy?: boolean;
  error?: string | null;
  onSigned: () => void;
  /** Sin `onCancel` no hay salida: es el caso de la puerta del panel. */
  onCancel?: () => void;
  signed?: boolean;
  /** Cuándo quedó registrada la firma (el recibo). */
  signedAt?: string | null;
  versionLine?: string;
  /** Qué documentos hay que leer hasta el final para firmar. Los demás se
   *  enseñan como ya firmados, legibles, no obligatorios. */
  require?: LegalDocId[];
  /** Por qué se pide (la puerta del panel lo sabe; el alta no lo necesita). */
  reason?: LegalGateReason | null;
  /** Lo que la cuenta ya tiene firmado, para decirlo. */
  accepted?: LegalRecord | null;
  /** Las versiones vigentes, para el recibo y las marcas. */
  currentVersions?: { terms: string; privacy: string } | null;
}) {
  const level = useMotionLevel();
  const still = level !== 'full';
  // El idioma es del lector, no del que montó la ceremonia: se puede cambiar
  // aquí mismo. Empieza en el de la app.
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => { setLang(initialLang); }, [initialLang]);
  const required = new Set<LegalDocId>(require.length > 0 ? require : ['terms', 'privacy']);
  const [doc, setDoc] = useState<LegalDocId>(required.has('terms') ? 'terms' : 'privacy');
  const [read, setRead] = useState<Record<LegalDocId, boolean>>({ terms: false, privacy: false });
  const [pct, setPct] = useState(0);
  const allRead = [...required].every((id) => read[id]);
  const remaining = [...required].filter((id) => !read[id]);

  const markRead = useCallback((id: LegalDocId) => {
    setRead((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  // Al cambiar de documento (o de idioma: el texto se vuelve a montar), el
  // porcentaje es el del nuevo, salvo que ya estuviera leído.
  useEffect(() => { setPct(read[doc] ? 100 : 0); }, [doc, read, lang]);

  const tabs: Array<{ id: LegalDocId; n: string; label: string; Icon: typeof ScrollText; version?: string | null }> = [
    { id: 'terms', n: '1', label: T('Condiciones de uso', 'Terms of use', lang), Icon: ScrollText, version: accepted?.termsVersion },
    { id: 'privacy', n: '2', label: T('Aviso de privacidad', 'Privacy notice', lang), Icon: FileText, version: accepted?.privacyVersion },
  ];

  const reasonLine = (() => {
    const when = fmtWhen(accepted?.acceptedAt, lang);
    switch (reason) {
      case 'first':
        return T('Es la primera vez en esta cuenta: se piden los dos documentos.', 'First time on this account: both documents are asked for.', lang);
      case 'terms':
        return `${T('Las condiciones de uso cambiaron desde tu firma', 'The terms of use changed since your signature', lang)}${when ? ` (${when})` : ''}${accepted?.termsVersion && currentVersions?.terms ? ` · ${accepted.termsVersion} → ${currentVersions.terms}` : ''}. ${T('El aviso de privacidad que leíste sigue vigente.', 'The privacy notice you read is still current.', lang)}`;
      case 'privacy':
        return `${T('El aviso de privacidad cambió desde tu firma', 'The privacy notice changed since your signature', lang)}${when ? ` (${when})` : ''}${accepted?.privacyVersion && currentVersions?.privacy ? ` · ${accepted.privacyVersion} → ${currentVersions.privacy}` : ''}. ${T('Las condiciones que aceptaste siguen vigentes.', 'The terms you accepted are still current.', lang)}`;
      case 'both':
        return `${T('Los dos documentos cambiaron desde tu firma', 'Both documents changed since your signature', lang)}${when ? ` (${when})` : ''}.`;
      default:
        return null;
    }
  })();

  // Qué se firma, dicho entero y solo lo que toca.
  const signSentence = (() => {
    const terms = T(
      'aceptas las condiciones de uso de la demo —software experimental con XRP real, bajo topes, con responsabilidad limitada a 50 € y las excepciones de ley— y declaras que tienes 18 años o más',
      'you accept the demo terms of use — experimental software with real XRP, under caps, with liability capped at €50 and the legal carve-outs — and you declare that you are 18 or older',
      lang,
    );
    const privacy = T('confirmas haber leído el aviso de privacidad', 'you confirm you have read the privacy notice', lang);
    const tail = T('Se registra con la versión del texto y la fecha.', 'It is recorded with the text version and the date.', lang);
    const head = T('Al firmar', 'By signing', lang);
    if (required.has('terms') && required.has('privacy')) return `${head} ${terms}, ${T('y', 'and', lang)} ${privacy}. ${tail}`;
    if (required.has('terms')) return `${head} ${terms}. ${tail}`;
    return `${head} ${privacy}. ${tail}`;
  })();

  const signedWhen = fmtWhen(signedAt, lang);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[210] flex items-start justify-center overflow-y-auto bg-[#06070c]/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={heading ?? T('Lee y firma', 'Read and sign', lang)}
    >
      <motion.div
        initial={still ? false : { opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24 }}
        className="my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d0f16] p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400/10">
              <ShieldCheck className="h-5 w-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-white">
                {heading ?? T('Lee y firma antes de crear tu cuenta', 'Read and sign before creating your account', lang)}
              </h2>
              <p className="text-xs text-white/45">
                {intro ?? T('Una vez, y queda registrado con la versión y la fecha.', 'Once, and it is recorded with the version and the date.', lang)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* El idioma del lector. */}
            <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[10px] font-semibold" role="radiogroup" aria-label={T('Idioma', 'Language', lang)}>
              {(['es', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={lang === l}
                  onClick={() => setLang(l)}
                  className={`rounded-md px-2 py-1 uppercase transition-colors ${lang === l ? 'bg-amber-300 text-black' : 'text-white/45 hover:text-white/80'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {onCancel ? (
              <button type="button" onClick={onCancel} aria-label={T('Cerrar', 'Close', lang)} className="text-white/40 transition-colors hover:text-white">
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>

        {reasonLine ? (
          <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-amber-100/80">{reasonLine}</p>
        ) : null}

        {/* Los pasos: los documentos, con su marca, y la firma al final. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {tabs.map(({ id, n, label, Icon, version }) => {
            const on = doc === id;
            const must = required.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setDoc(id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                  on ? 'border-amber-300/50 bg-amber-300/10 text-white' : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white/80'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span className="font-mono text-[10px] text-white/40">{n}</span>
                {label}
                {!must ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[9.5px] text-emerald-400/80" title={T('Ya firmado a su versión vigente', 'Already signed at its current version', lang)}>
                    <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
                    {T('firmado', 'signed', lang)}{version ? ` · ${version}` : ''}
                  </span>
                ) : read[id] ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.6} aria-label={T('leído', 'read', lang)} />
                ) : null}
              </button>
            );
          })}
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${
              signed ? 'border-emerald-400/40 text-emerald-300' : allRead ? 'border-amber-300/50 text-white' : 'border-white/10 text-white/35'
            }`}
            aria-current={allRead && !signed ? 'step' : undefined}
          >
            <span className="font-mono text-[10px] text-white/40">3</span>
            {signed ? T('Firmado', 'Signed', lang) : T('Firmar', 'Sign', lang)}
            {signed ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : null}
          </span>
        </div>

        {/* El texto. El mismo que /demo-terms y /privacy publican. */}
        <div className="mt-3">
          <DocScroller
            key={`${doc}:${lang}`}
            label={doc === 'terms' ? T('Condiciones de uso', 'Terms of use', lang) : T('Aviso de privacidad', 'Privacy notice', lang)}
            onEnd={() => markRead(doc)}
            onProgress={setPct}
          >
            {doc === 'terms' ? <DemoTermsBody lang={lang} plain /> : <PrivacyNoticeBody lang={lang} plain />}
          </DocScroller>
        </div>

        {/* Cuánto llevas leído de ESTE documento. */}
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full"
              style={{ background: GOLD_SOFT }}
              animate={{ width: `${read[doc] ? 100 : pct}%` }}
              transition={{ duration: still ? 0 : 0.2 }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-white/35">
            {read[doc] ? T('leído entero', 'read to the end', lang) : `${pct}%`}
          </span>
        </div>

        {/* Lo que falta, dicho: seguir bajando, o pasar al otro documento. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${doc}:${read[doc]}:${allRead}:${signed}`}
            initial={still ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-2 min-h-[1.5rem]"
          >
            {signed ? (
              <p className="text-center text-[11px] text-emerald-400/80">
                {T('Firmado', 'Signed', lang)}{signedWhen ? ` · ${signedWhen}` : ''}
                {currentVersions ? ` · ${T('condiciones', 'terms', lang)} ${currentVersions.terms} · ${T('privacidad', 'privacy', lang)} ${currentVersions.privacy}` : ''}
              </p>
            ) : required.has(doc) && !read[doc] ? (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/40">
                <ArrowDown className="h-3 w-3" strokeWidth={2} />
                {T('Baja hasta el final de este documento.', 'Scroll to the end of this document.', lang)}
              </p>
            ) : !allRead ? (
              <button
                type="button"
                onClick={() => setDoc(remaining[0])}
                className="mx-auto block text-[11.5px] font-medium underline underline-offset-2 transition-colors hover:text-white"
                style={{ color: GOLD_SOFT }}
              >
                {remaining[0] === 'privacy'
                  ? T('Siguiente: el aviso de privacidad →', 'Next: the privacy notice →', lang)
                  : T('Siguiente: las condiciones de uso →', 'Next: the terms of use →', lang)}
              </button>
            ) : (
              <p className="text-center text-[11px] text-emerald-400/80">
                {required.size > 1
                  ? T('Los dos leídos. Ya puedes firmar.', 'Both read. You can sign now.', lang)
                  : T('Leído entero. Ya puedes firmar.', 'Read to the end. You can sign now.', lang)}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {/* QUÉ se firma — entero, encima del carril, nunca en letra escondida. */}
        <p className="mt-3 text-[11.5px] leading-relaxed text-white/55">{signSentence}</p>

        {error ? <p className="mt-2 text-[12px] text-red-400">{error}</p> : null}

        <div className="mt-3">
          <SlideToSign
            lang={lang}
            label={signLabel ?? T('Desliza para firmar', 'Slide to sign', lang)}
            disabled={!allRead}
            hint={
              required.size > 1
                ? T('Lee los dos documentos hasta el final para poder firmar.', 'Read both documents to the end to be able to sign.', lang)
                : T('Lee el documento hasta el final para poder firmar.', 'Read the document to the end to be able to sign.', lang)
            }
            busy={busy}
            done={signed}
            onSign={onSigned}
          />
        </div>

        <p className="mt-3 text-center font-mono text-[10px] text-white/30">
          {versionLine ?? T('La versión firmada es la que acabas de leer.', 'The version you sign is the one you just read.', lang)}
        </p>
      </motion.div>
    </motion.div>
  );
}

export default LegalSignCeremony;
