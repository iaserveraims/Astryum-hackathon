'use client';

/**
 * /demo-terms — the demo risk notice + how every transaction is built,
 * as PUBLIC reviewable documentation (founder 2026-07-26).
 *
 * The decision: no interruptive modal at sign-up. Instead, the full honest
 * picture lives here — reviewable by anyone, BEFORE creating an account,
 * without one, or never — and the create button carries a one-line notice
 * linking this page. Same doctrine as /about and the live feed: we don't
 * ask for trust, we document and let people verify.
 *
 * Copy rules (extra force — this page IS the risk disclosure): no yields,
 * no promises, no softening. Every claim here must stay true against the
 * code; the tx-builder section describes the prepare→sign→verify pipeline
 * exactly as built (unsigned payloads, simulation, caps, executor role).
 */

import SubpageShell from './SubpageShell';
import { BORDER, GOLD, Reveal } from './interactions';
import { T, type Lang } from './useLang';

const GOLD_SOFT = '#E8C25A';
const CARD: React.CSSProperties = { border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' };

const RISKS = (lang: Lang) => [
  {
    title: T('Software experimental', 'Experimental software', lang),
    body: T(
      'Astryum está en fase de demo pública de validación. Puede contener errores, estar temporalmente caída o dejar una operación a medias. Se ofrece «tal cual», sin garantía de disponibilidad ni de funcionamiento.',
      'Astryum is in a public validation demo phase. It may contain bugs, be temporarily down, or leave an operation half-done. It is provided "as is", with no guarantee of availability or correct operation.',
      lang,
    ),
  },
  {
    title: T('Dinero real, bajo topes', 'Real money, under caps', lang),
    body: T(
      'La demo opera con XRP real en mainnet. Precisamente por eso existe un tope por operación y un límite diario de volumen — la app te muestra los valores vigentes antes de operar. Los topes acotan lo máximo que un fallo puede exponer mientras validamos; son parte del diseño de esta fase, no un ajuste opcional.',
      'The demo operates with real XRP on mainnet. That is exactly why there is a per-operation cap and a daily volume limit — the app shows you the values in force before you act. The caps bound the most a failure can expose while we validate; they are part of this phase by design, not an optional setting.',
      lang,
    ),
  },
  {
    title: T('Tú firmas todo — y es irreversible', 'You sign everything — and it is irreversible', lang),
    body: T(
      'Cada operación la firmas tú, en tu wallet. Una transacción firmada es irreversible por diseño de las cadenas. No tenemos tus claves ni forma de tenerlas — el servidor aborta el arranque si detecta una clave de usuario en su entorno — así que no podemos mover, bloquear ni recuperar tus fondos. Revisa siempre antes de firmar.',
      'You sign every operation yourself, in your wallet. A signed transaction is irreversible by design of the chains. We do not hold your keys and have no way to — the server aborts start-up if it detects a user key in its environment — so we cannot move, freeze or recover your funds. Always review before signing.',
      lang,
    ),
  },
  {
    title: T('Sin garantía de ejecución ni de plazos', 'No guarantee of execution or timing', lang),
    body: T(
      'Cuando conviertes XRP en FXRP, tu firma compromete el hash exacto de la operación y un ejecutor —rol definido por el protocolo de Flare, que hoy opera Astryum— entrega la prueba al contrato. Ese ejecutor no decide nada: o ejecuta exactamente lo que firmaste, o la cadena lo rechaza. Pero si falla (red caída, presupuesto agotado), tu XRP puede quedar temporalmente aparcado sin completar. Tenemos detección automática de esa situación y el tope acota lo expuesto. Aun así: la demo puede fallar en dejarte una operación a medias, y usas la demo aceptando ese riesgo.',
      'When you convert XRP into FXRP, your signature commits the exact hash of the operation and an executor — a role defined by the Flare protocol, operated today by Astryum — delivers the proof to the contract. That executor decides nothing: it either executes exactly what you signed, or the chain rejects it. But if it fails (network down, budget exhausted), your XRP can be temporarily parked without completing. We detect that situation automatically and the cap bounds the exposure. Still: this demo can fail and leave an operation half-done, and by using it you accept that risk.',
      lang,
    ),
  },
  {
    title: T('Nada de esto es consejo', 'None of this is advice', lang),
    body: T(
      'Astryum no da consejo financiero, de inversión, fiscal ni legal. Los rendimientos que ves son datos de los protocolos, con su fuente — nunca una promesa ni una recomendación nuestra. Las opciones se muestran completas y sin ordenar por conveniencia. La decisión es siempre tuya.',
      'Astryum gives no financial, investment, tax or legal advice. The yields you see are protocol data, with their source — never a promise or a recommendation from us. Options are shown complete and unranked by convenience. The decision is always yours.',
      lang,
    ),
  },
  {
    title: T('Los protocolos de destino son de terceros', 'Destination protocols are third parties', lang),
    body: T(
      'Las posiciones que abres viven en protocolos de terceros (Kinetic, Firelight, SparkDEX y otros), con sus propios contratos, sus propios riesgos y sus propios términos, que te aplican. Astryum los integra como venues de ejecución; no los opera ni responde por ellos.',
      'The positions you open live in third-party protocols (Kinetic, Firelight, SparkDEX and others), with their own contracts, their own risks and their own terms, which apply to you. Astryum integrates them as execution venues; it does not operate them and does not answer for them.',
      lang,
    ),
  },
];

const PIPELINE = (lang: Lang) => [
  {
    step: '01',
    title: T('Se construye — sin firmar', 'It is built — unsigned', lang),
    body: T(
      'Astryum compila tu acción en una transacción SIN firmar: qué contrato toca, qué función llama, con qué parámetros. El payload completo es tuyo antes de que exista firma alguna.',
      'Astryum compiles your action into an UNSIGNED transaction: which contract it touches, which function it calls, with which parameters. The full payload is yours before any signature exists.',
      lang,
    ),
  },
  {
    step: '02',
    title: T('Se simula y se enseña', 'It is simulated and shown', lang),
    body: T(
      'Antes de llegar a tu wallet, la operación se simula y se te muestra entera: efecto esperado, costes (incluida la fee del ejecutor, que fija el protocolo, no Astryum) y los chequeos que pasa. Sin sorpresas ni letra pequeña.',
      'Before it reaches your wallet, the operation is simulated and shown to you whole: expected effect, costs (including the executor fee, set by the protocol, not by Astryum) and the checks it passes. No surprises, no small print.',
      lang,
    ),
  },
  {
    step: '03',
    title: T('Firmas tú — o no ocurre nada', 'You sign — or nothing happens', lang),
    body: T(
      'La firma ocurre en tu wallet (Xaman en XRPL, tu wallet EVM en Flare), donde puedes leer exactamente qué autorizas. En los flujos XRP→Flare, tu firma compromete el hash exacto de la operación completa: ni nosotros ni nadie puede alterar un byte sin que la cadena lo rechace.',
      'Signing happens in your wallet (Xaman on XRPL, your EVM wallet on Flare), where you can read exactly what you authorize. In XRP→Flare flows, your signature commits the exact hash of the whole operation: neither we nor anyone can alter a byte without the chain rejecting it.',
      lang,
    ),
  },
  {
    step: '04',
    title: T('La cadena es el recibo', 'The chain is the receipt', lang),
    body: T(
      'Cada operación liquidada queda registrada on-chain con su comprobante público, verificable por cualquiera en los exploradores de XRPL y Flare — y publicada en nuestro feed de transparencia en vivo.',
      'Every settled operation is recorded on-chain with its public receipt, verifiable by anyone on the XRPL and Flare explorers — and published on our live transparency feed.',
      lang,
    ),
  },
];

export default function DemoTermsPage() {
  return (
    <SubpageShell>
      {(lang) => (
        <>
          {/* hero */}
          <section className="px-6 pt-36 pb-14 text-center">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
                {T('Documentación pública · Demo', 'Public documentation · Demo', lang)}
              </p>
              <h1
                className="mx-auto mt-4 max-w-3xl font-bold text-white text-balance"
                style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
              >
                {T('La demo, por escrito.', 'The demo, in writing.', lang)}
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/55">
                {T(
                  'Qué es esta fase, qué riesgos tiene y cómo se construye cada transacción — publicado para que lo revises cuando quieras, con cuenta o sin ella. Preferimos contártelo nosotros a que lo descubras tú.',
                  'What this phase is, what its risks are and how every transaction is built — published so you can review it whenever you want, with an account or without one. We would rather tell you ourselves than have you find out.',
                  lang,
                )}
              </p>
            </Reveal>
          </section>

          {/* the risks, honestly */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <h2 className="text-center font-bold text-white" style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', letterSpacing: '-0.02em' }}>
                  {T('Los riesgos, sin suavizar', 'The risks, unsoftened', lang)}
                </h2>
              </Reveal>
              <div className="mt-8 space-y-4">
                {RISKS(lang).map((r, i) => (
                  <Reveal key={r.title} delay={0.05 * i}>
                    <div className="rounded-2xl p-5" style={CARD}>
                      <h3 className="text-[15px] font-semibold text-white">{r.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-white/55">{r.body}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
              <Reveal delay={0.2}>
                <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-white/40">
                  {T(
                    'Al crear una cuenta y usar la demo confirmas que entiendes y aceptas estos riesgos. Nada en esta página limita derechos que la ley te reconozca como consumidor.',
                    'By creating an account and using the demo you confirm you understand and accept these risks. Nothing on this page limits rights the law grants you as a consumer.',
                    lang,
                  )}
                </p>
              </Reveal>
            </div>
          </section>

          {/* how every transaction is built — the tx data builder, documented */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <h2 className="text-center font-bold text-white" style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', letterSpacing: '-0.02em' }}>
                  {T('Cómo se construye cada transacción', 'How every transaction is built', lang)}
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-white/50">
                  {T(
                    'El circuito completo, revisable: de tu intención a la cadena, sin que ninguna clave tuya toque nuestros servidores.',
                    'The full circuit, reviewable: from your intent to the chain, without any key of yours touching our servers.',
                    lang,
                  )}
                </p>
              </Reveal>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {PIPELINE(lang).map((s, i) => (
                  <Reveal key={s.step} delay={0.05 * i}>
                    <div className="h-full rounded-2xl p-5" style={CARD}>
                      <span className="font-mono text-[11px]" style={{ color: GOLD_SOFT }}>
                        {s.step}
                      </span>
                      <h3 className="mt-1.5 text-[15px] font-semibold text-white">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-white/55">{s.body}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* verify it yourself — the counterweight */}
          <section className="px-6 pb-28 text-center">
            <Reveal>
              <h2
                className="mx-auto max-w-2xl font-bold text-white text-balance"
                style={{ fontSize: 'clamp(1.5rem, 3.2vw, 2.3rem)', lineHeight: 1.1, letterSpacing: '-0.03em' }}
              >
                {T('No te pedimos que nos creas.', "We don't ask you to believe us.", lang)}
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/50">
                {T(
                  'Las operaciones ejecutadas desde Astryum se publican en vivo, cada una con su comprobante verificable en los exploradores públicos de XRPL y Flare.',
                  'Operations executed through Astryum are published live, each with its receipt verifiable on the public XRPL and Flare explorers.',
                  lang,
                )}
              </p>
              <a
                href="/what-we-offer#live"
                className="mt-8 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                style={{ background: GOLD, boxShadow: '0 8px 28px hsl(var(--volt) / 0.3)' }}
              >
                {T('Ver la actividad en vivo', 'Watch the live activity', lang)} →
              </a>
              <p className="mx-auto mt-8 max-w-lg font-mono text-[10.5px] leading-relaxed text-white/30">
                {T(
                  'Dudas o problemas: astryum@astryum.xyz · Si cambiamos esta página de forma material, lo anunciaremos en la app.',
                  'Questions or problems: astryum@astryum.xyz · If we change this page materially, we will announce it in the app.',
                  lang,
                )}
              </p>
            </Reveal>
          </section>
        </>
      )}
    </SubpageShell>
  );
}
