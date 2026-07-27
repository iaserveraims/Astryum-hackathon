'use client';

/**
 * /what-we-offer — "Qué ofrecemos" (founder 2026-07-25): the platform told
 * longer and more technically than the journey allows, in the same astral
 * grammar (MaskLines, Reveal, SpotlightCard, the starfield via SubpageShell).
 *
 * Copy rules apply HERE with extra force (this page is the technical pitch):
 * no yields, no promises, no "we recommend" — capabilities and boundaries,
 * stated as facts about how the system works. Rates are only ever protocol
 * data with a source, and none are quoted on this page at all.
 */

import { motion } from 'framer-motion';
import SubpageShell from './SubpageShell';
import LiveActivity from './LiveActivity';
import { BORDER, GOLD, MaskLines, Reveal, SpotlightCard } from './interactions';
import { T, type Lang } from './useLang';

const GOLD_SOFT = '#E8C25A';
const CARD_STYLE = { border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' } as const;

// ── The instruments — each card: what it is, technically, and its boundary ──
const INSTRUMENTS = (lang: Lang) => [
  {
    num: '01',
    title: T('Mapa de capital', 'Capital map', lang),
    body: T(
      'Una lectura agregada y en vivo de tus wallets — XRPL y Flare hoy — con saldos, posiciones abiertas y su salud, en una sola pantalla. Solo lectura: conectar una wallet no da permisos de movimiento; vigilar una dirección ni siquiera requiere conectarla.',
      'One live, aggregated reading of your wallets — XRPL and Flare today — with balances, open positions and their health on a single screen. Read-only: connecting a wallet grants no movement permissions; watching an address does not even require connecting it.',
      lang,
    ),
    points: [
      T('Multi-wallet y multi-red, con identidad por wallet (nombre y color)', 'Multi-wallet and multi-rail, with per-wallet identity (name and colour)', lang),
      T('Posiciones DeFi con factor de salud y distancia a liquidación', 'DeFi positions with health factor and liquidation distance', lang),
      T('Modo vigilancia: cualquier dirección, sin firmar nada', 'Watch mode: any address, without signing anything', lang),
    ],
  },
  {
    num: '02',
    title: T('Acciones preparadas, nunca ejecutadas', 'Actions prepared, never executed', lang),
    body: T(
      'Astryum compila cada acción — poner a trabajar, reforzar colateral, repagar, salir — en una transacción SIN firmar, la simula, y te la entrega con sus costes a la vista. La firma ocurre siempre en tu wallet: Xaman en XRPL, tu wallet EVM en Flare. Nada se ejecuta sin tu firma, y la red solo acepta exactamente lo que firmaste.',
      'Astryum compiles every action — deploy, top up collateral, repay, exit — into an UNSIGNED transaction, simulates it, and hands it over with its costs in plain sight. Signing always happens in your wallet: Xaman on XRPL, your EVM wallet on Flare. Nothing executes without your signature, and the network only accepts exactly what you signed.',
      lang,
    ),
    points: [
      T('Payloads sin firmar: la clave nunca sale de tu wallet', 'Unsigned payloads: the key never leaves your wallet', lang),
      T('Simulación previa y costes visibles antes de firmar', 'Pre-flight simulation and costs visible before you sign', lang),
      T('Recibo de ejecución tras liquidarse — trazabilidad completa', 'Execution receipt after settlement — full traceability', lang),
    ],
  },
  {
    num: '03',
    title: T('Protecciones deterministas', 'Deterministic protections', lang),
    body: T(
      'Reglas que defienden una posición — repagar o salir antes de la liquidación — definidas por ti, con umbral, importe y cooldown editables. La regla es determinista: hace exactamente lo que firmaste, cuando se cumple la condición que fijaste. Ninguna IA decide por ti; el agente solo compila, tú revisas y firmas.',
      'Rules that defend a position — repay or exit before liquidation — defined by you, with editable threshold, amount and cooldown. The rule is deterministic: it does exactly what you signed, when the condition you set is met. No AI decides for you; the agent only compiles, you review and sign.',
      lang,
    ),
    points: [
      T('Umbrales sobre el factor de salud, con alertas primero', 'Health-factor thresholds, with alerts first', lang),
      T('El disparo llega a tu wallet para firmar — un toque en Xaman', 'The trigger reaches your wallet to sign — one tap in Xaman', lang),
      T('Cero discreción: sin condición cumplida, nada se mueve', 'Zero discretion: no condition met, nothing moves', lang),
    ],
  },
  {
    num: '04',
    title: T('Earn: estrategias con los ojos abiertos', 'Earn: strategies with open eyes', lang),
    body: T(
      'Estrategias listas sobre protocolos en mainnet, explicadas antes de entrar: qué hace cada paso con tus tokens, qué riesgos tiene y cómo se sale. Los tipos se muestran siempre como dato del protocolo con su fuente — nunca como promesa nuestra. Tu registro guarda lo que corre y lo que dejaste en borrador.',
      'Ready-made strategies on mainnet protocols, explained before you enter: what each step does with your tokens, what its risks are and how you exit. Rates always shown as protocol data with their source — never as our promise. Your registry keeps what runs and what you drafted.',
      lang,
    ),
    points: [
      T('Cada estrategia declara sus pasos y su camino de salida', 'Every strategy declares its steps and its exit path', lang),
      T('Describe lo que quieres y el agente lo compila — tú firmas', 'Describe what you want and the agent compiles it — you sign', lang),
      T('Registro propio: activa, pausa o retoma tus estrategias', 'Your own registry: activate, pause or resume your strategies', lang),
    ],
  },
  {
    num: '05',
    title: T('Legacy: capital bajo consejo', 'Legacy: capital under council', lang),
    body: T(
      'Una cuenta gobernada donde la autoridad es un consejo con quórum, anclado en las reglas nativas de XRPL. Tú propones; las firmas necesarias ejecutan. Pensada para capital familiar o compartido que no debe depender de una sola llave — ni de nosotros.',
      'A governed account where authority is a council with quorum, anchored in XRPL-native rules. You propose; the required signatures execute. Built for family or shared capital that must not depend on a single key — nor on us.',
      lang,
    ),
    points: [
      T('Quórum on-ledger: las reglas viven en XRPL, no en nuestra base de datos', 'On-ledger quorum: the rules live on XRPL, not in our database', lang),
      T('Bandeja de propuestas con estado de firmas en vivo', 'Proposal tray with live signature status', lang),
      T('Acta inmutable de cada decisión del consejo', 'An immutable record of every council decision', lang),
    ],
  },
  {
    num: '06',
    title: T('La frontera de seguridad', 'The security boundary', lang),
    body: T(
      'El límite que hace todo lo demás creíble: nunca custodiamos, nunca firmamos, nunca ejecutamos con discreción. Ninguna clave privada toca nuestros servidores. Si Astryum desapareciera mañana, cada posición sigue siendo tuya, operable directamente en cada protocolo.',
      'The boundary that makes everything else credible: we never custody, never sign, never execute with discretion. No private key touches our servers. If Astryum vanished tomorrow, every position remains yours, operable directly on each protocol.',
      lang,
    ),
    points: [
      T('Preparar ≠ ejecutar: la frontera está en el código, línea a línea', 'Preparing ≠ executing: the boundary lives in the code, line by line', lang),
      T('EU-first: stablecoins de dinero electrónico para flujos europeos', 'EU-first: e-money stablecoins for European flows', lang),
      T('Cada acción deja prueba: simulación, autorización y recibo', 'Every action leaves proof: simulation, authorization and receipt', lang),
    ],
  },
];

const RAILS = (lang: Lang) => [
  {
    k: 'XRPL',
    body: T(
      'Donde vive la autoridad: tus cuentas, las reglas del consejo y la firma con Xaman. Liquidación en segundos y costes de red mínimos.',
      'Where authority lives: your accounts, council rules and Xaman signing. Settlement in seconds with minimal network costs.',
      lang,
    ),
  },
  {
    k: 'Flare',
    body: T(
      'Donde el capital trabaja: XRP entra en DeFi como FXRP (FAssets) y los precios llegan del oráculo nativo de la red (FTSO), sin oráculos de terceros.',
      'Where capital works: XRP enters DeFi as FXRP (FAssets) and prices come from the network’s native oracle (FTSO), no third-party feeds.',
      lang,
    ),
  },
  {
    k: T('Tu wallet', 'Your wallet', lang),
    body: T(
      'La única pieza que firma. Astryum habla con ella por los canales estándar — payloads de Xaman, transacciones EVM — y espera tu decisión.',
      'The only piece that signs. Astryum speaks to it over standard channels — Xaman payloads, EVM transactions — and waits for your decision.',
      lang,
    ),
  },
];

function CheckRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug text-white/65">
      <svg className="mt-[3px] shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
        <circle cx="6.5" cy="6.5" r="6" stroke={GOLD} strokeOpacity="0.5" />
        <path d="M4 6.7l1.8 1.8L9.2 4.9" stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {text}
    </li>
  );
}

export default function WhatWeOfferPage() {
  return (
    <SubpageShell>
      {(lang) => (
        <>
          {/* hero */}
          <section className="px-6 pt-40 pb-14 text-center md:pt-44">
            <Reveal>
              <div className="mb-5 text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                {T('La plataforma · en detalle', 'The platform · in detail', lang)}
              </div>
            </Reveal>
            <h1
              className="mx-auto max-w-3xl font-bold text-white text-balance"
              style={{ fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
            >
              <MaskLines
                lines={[
                  T('Un plano de control', 'A control plane', lang),
                  <span key="l2" style={{ color: GOLD_SOFT }}>
                    {T('para tu capital.', 'for your capital.', lang)}
                  </span>,
                ]}
                delay={0.1}
              />
            </h1>
            <Reveal delay={0.3}>
              <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-white/55" style={{ fontSize: 'clamp(15px, 1.4vw, 18px)' }}>
                {T(
                  'Seis instrumentos sobre una sola frontera: Astryum observa, prepara y coordina — y tu wallet firma. Esto es lo que hace cada pieza, y el límite exacto que ninguna cruza.',
                  'Six instruments over a single boundary: Astryum observes, prepares and coordinates — and your wallet signs. This is what each piece does, and the exact line none of them crosses.',
                  lang,
                )}
              </p>
            </Reveal>
          </section>

          {/* the instruments */}
          <section className="px-6 pb-20">
            <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
              {INSTRUMENTS(lang).map((inst, i) => (
                <Reveal key={inst.num} delay={0.08 + (i % 2) * 0.08}>
                  <SpotlightCard className="h-full rounded-2xl p-6" style={CARD_STYLE}>
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[11px]" style={{ color: GOLD }}>
                        {inst.num}
                      </span>
                      <h2 className="text-lg font-semibold text-white">{inst.title}</h2>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-white/55">{inst.body}</p>
                    <ul className="mt-4 space-y-2">
                      {inst.points.map((p) => (
                        <CheckRow key={p} text={p} />
                      ))}
                    </ul>
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </section>

          {/* how it is built — the three rails as one line of flight */}
          <section className="px-6 pb-24">
            <div className="mx-auto max-w-5xl">
              <Reveal>
                <div className="mb-8 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('Cómo está construido', 'How it is built', lang)}
                </div>
              </Reveal>
              <div className="relative grid gap-4 md:grid-cols-3">
                {/* the connecting flight line, drawn as the section enters */}
                <motion.div
                  aria-hidden
                  className="absolute left-[10%] right-[10%] top-1/2 hidden h-px md:block"
                  style={{ background: `linear-gradient(90deg, transparent, ${GOLD}55, transparent)`, transformOrigin: 'left' }}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true, margin: '-20%' }}
                  transition={{ duration: 1.1, ease: 'easeOut' }}
                />
                {RAILS(lang).map((rail, i) => (
                  <Reveal key={rail.k} delay={0.12 + i * 0.14}>
                    <SpotlightCard className="relative h-full rounded-2xl p-6 text-center" style={CARD_STYLE}>
                      <div
                        className="mx-auto flex h-9 w-9 items-center justify-center rounded-full font-mono text-[11px] font-bold text-black"
                        style={{ background: `radial-gradient(circle at 35% 30%, #FFF3D0, ${GOLD_SOFT} 45%, ${GOLD} 100%)` }}
                        aria-hidden
                      >
                        {i + 1}
                      </div>
                      <h3 className="mt-3 text-[15px] font-semibold text-white">{rail.k}</h3>
                      <p className="mt-2.5 text-sm leading-relaxed text-white/55">{rail.body}</p>
                    </SpotlightCard>
                  </Reveal>
                ))}
              </div>
              <Reveal delay={0.3}>
                <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-white/40">
                  {T(
                    'Observar es ancho; ejecutar es estrecho. Astryum lee todas tus redes, pero cada acción se prepara en la red donde vive el activo — nunca desviamos tu capital por caminos que no pediste.',
                    'Observing is wide; executing is narrow. Astryum reads all your rails, but every action is prepared on the rail where the asset lives — we never route your capital through paths you did not ask for.',
                    lang,
                  )}
                </p>
              </Reveal>
            </div>
          </section>

          {/* live transparency — real settled operations, verifiable on the
              public explorers; the counterweight to the sign-up disclaimer */}
          <LiveActivity lang={lang} />

          {/* door */}
          <section className="px-6 pb-28 text-center">
            <Reveal>
              <h2
                className="mx-auto max-w-2xl font-bold text-white text-balance"
                style={{ fontSize: 'clamp(1.6rem, 3.4vw, 2.6rem)', lineHeight: 1.1, letterSpacing: '-0.03em' }}
              >
                {T('Compruébalo con tu propio capital.', 'See it with your own capital.', lang)}
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/50">
                {T(
                  'El acceso anticipado abre el plano de control con tus wallets reales — leyendo desde el primer minuto, firmando solo cuando tú quieras.',
                  'Early access opens the control plane with your real wallets — reading from the first minute, signing only when you choose to.',
                  lang,
                )}
              </p>
              <a
                href="/early-access"
                className="mt-9 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                style={{ background: GOLD, boxShadow: '0 8px 28px hsl(var(--volt) / 0.3)' }}
              >
                {T('Solicita acceso anticipado', 'Request early access', lang)} →
              </a>
            </Reveal>
          </section>
        </>
      )}
    </SubpageShell>
  );
}
