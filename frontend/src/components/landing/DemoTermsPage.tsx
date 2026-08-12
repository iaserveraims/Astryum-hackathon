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
      'La demo opera con XRP real en mainnet. Por eso los carriles de estrategia llevan un tope por operación y un límite diario de volumen, y el panel te muestra cuánto llevas consumido. Los topes acotan lo que un fallo puede exponer mientras validamos; son parte del diseño de esta fase, no un ajuste opcional.',
      'The demo operates with real XRP on mainnet. That is why the strategy rails carry a per-operation cap and a daily volume limit, and the dashboard shows how much of it you have used. The caps bound what a failure can expose while we validate; they are part of this phase by design, not an optional setting.',
      lang,
    ),
  },
  {
    title: T('Tú firmas todo — y es irreversible', 'You sign everything — and it is irreversible', lang),
    body: T(
      'Cada operación la firmas tú, en tu wallet. Una transacción firmada es irreversible por diseño de las cadenas. No tenemos tus claves ni forma de tenerlas — el servidor aborta el arranque si encuentra una clave privada EVM en su entorno — así que no podemos mover, bloquear ni recuperar tus fondos. Revisa siempre antes de firmar.',
      'You sign every operation yourself, in your wallet. A signed transaction is irreversible by design of the chains. We do not hold your keys and have no way to — the server aborts start-up if it finds a raw EVM private key in its environment — so we cannot move, freeze or recover your funds. Always review before signing.',
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
  {
    title: T('Las reglas preparan — jamás firman, y no son un seguro', 'Rules prepare — they never sign, and they are no insurance', lang),
    body: T(
      'Las reglas que configures (protecciones, cosechas, movimientos programados) preparan transacciones cuando se cumple tu condición — nunca las firman ni las envían: te llegan a ti, a la wallet dueña de la posición, para que las firmes. Ninguna automatización tiene discreción: el sistema no elige importes, destinos ni momentos fuera de los parámetros que tú fijaste. No garantizamos que una regla se dispare a tiempo ni que llegue antes que el mercado: si nuestros sistemas están caídos cuando tu condición se cumple, la transacción puede llegar tarde o no llegar, y el riesgo de la posición sigue siendo tuyo. En cuentas gobernadas por varias firmas (consejo), una orden solo sale con el quórum que vosotros configurasteis en la propia cadena; esa orden lleva incluida una fee de servicio de 0,2 XRP que se paga en el momento de la firma —no cuando la prueba se entrega después— y es visible antes de firmar: si la entrega posterior falla, la fee ya está pagada.',
      'The rules you configure (protections, harvests, scheduled moves) prepare transactions when your condition is met — they never sign or send them: they reach you, at the wallet that owns the position, for you to sign. No automation has discretion: the system picks no amounts, destinations or timing outside the parameters you set. We do not guarantee a rule fires on time or beats the market: if our systems are down when your condition is met, the prepared transaction may arrive late or not at all, and the position risk remains yours. On accounts governed by several signers (a council), an order only leaves with the quorum you configured on-chain; that order carries a 0.2 XRP service fee paid at the moment of signing — not when the proof is delivered afterwards — and visible before you sign: if the later delivery fails, the fee is already paid.',
      lang,
    ),
  },
  {
    title: T('Tus datos, y lo que la cadena hace imborrable', 'Your data, and what the chain makes indelible', lang),
    body: T(
      'Queda registrada tu aceptación de estas condiciones con la versión del texto y la fecha — al crear la cuenta, y también al entrar al panel si accediste con wallet o si cambiamos un texto de forma material. Lo que firmas se publica en cadenas públicas para siempre — ni nosotros ni nadie puede borrarlo — y, para completar ciertas operaciones, cuentas operativas nuestras publican transacciones que referencian la tuya: cualquiera que analice la cadena puede ver que tu dirección operó a través de Astryum. El detalle completo de qué tratamos, quién lo recibe y cómo ejercer tus derechos está en el Aviso de privacidad.',
      'Your acceptance of these terms is recorded with the text version and date — when you create the account, and also on entering the dashboard if you signed in with a wallet or if we change a text materially. What you sign is published on public chains forever — neither we nor anyone can erase it — and, to complete certain operations, operational accounts of ours publish transactions referencing yours: anyone analysing the chain can see your address operated through Astryum. The full detail of what we process, who receives it and how to exercise your rights lives in the Privacy notice.',
      lang,
    ),
  },
  {
    title: T('Responsabilidad: limitada a 50 €, con las excepciones de ley', 'Liability: capped at €50, with the legal carve-outs', lang),
    body: T(
      'Dentro de los límites que la ley permite, nuestra responsabilidad total por esta demo se limita a 50 €. La demo no tiene coste de suscripción ni de acceso; las únicas fees que existen se muestran antes de firmar. Este límite no se aplica en casos de dolo o negligencia grave, ni donde la ley de consumo no permita limitarla — nada en esta página limita derechos que la ley te reconozca como consumidor. Tampoco respondemos del comportamiento de los protocolos de terceros, de la variación de precio de tus activos, de las decisiones que tomes con la información que mostramos, ni de la indisponibilidad de redes, nodos o wallets ajenas.',
      'Within the limits the law allows, our total liability for this demo is capped at €50. The demo has no subscription or access cost; the only fees that exist are shown before you sign. This cap does not apply in cases of wilful misconduct or gross negligence, nor where consumer law does not allow limiting it — nothing on this page limits rights the law grants you as a consumer. Nor do we answer for third-party protocol behaviour, price movements of your assets, decisions you make with the information we show, or the unavailability of networks, nodes or third-party wallets.',
      lang,
    ),
  },
];

/**
 * Rules of use — added 2026-08-01. The audit (legal/16) found the published
 * page was a risk notice without the protective clauses every benchmarked
 * product carries: minimum age, excluded territories, suspension right and
 * tax responsibility. Applicable law and forum stay DELIBERATELY absent —
 * that clause is the lawyer's (Rome I / Brussels I bis nuance, legal/02 §12).
 */
const RULES = (lang: Lang) => [
  {
    title: T('Solo mayores de edad', 'Adults only', lang),
    body: T(
      'La demo es para mayores de 18 años. Al crear una cuenta o aceptar estas condiciones declaras que los tienes. No hacemos verificación de identidad en esta fase — precisamente por eso te lo preguntamos y registramos tu declaración; si eres menor, no uses la demo.',
      'The demo is for people 18 or older. By creating an account or accepting these terms you declare that you are. We do no identity verification in this phase — which is exactly why we ask and record your declaration; if you are a minor, do not use the demo.',
      lang,
    ),
  },
  {
    title: T('Desde dónde no se puede usar', 'Where it cannot be used from', lang),
    body: T(
      'La demo no puede usarse desde territorios sujetos a sanciones internacionales (entre otros: Corea del Norte, Irán, Siria, Cuba, Rusia, Bielorrusia y las regiones de Crimea, Donetsk y Luhansk), ni por personas incluidas en listas de sanciones. Al usarla declaras que no es tu caso. Hoy no aplicamos bloqueo por localización — la región que operas la declaras tú — así que esta regla funciona por declaración, y te la contamos tal cual. Además, los protocolos de destino imponen sus propias restricciones territoriales en sus términos, que te aplican al usarlos.',
      'The demo cannot be used from territories under international sanctions (among others: North Korea, Iran, Syria, Cuba, Russia, Belarus and the regions of Crimea, Donetsk and Luhansk), nor by persons on sanctions lists. By using it you declare that this is not your case. We do not geoblock by location today — you declare the region you operate — so this rule works by declaration, and we tell you so plainly. Destination protocols additionally impose their own territorial restrictions in their terms, which apply to you when you use them.',
      lang,
    ),
  },
  {
    title: T('Podemos suspender cuentas — tu capital no se toca', 'We can suspend accounts — your capital is untouched', lang),
    body: T(
      'Podemos suspender o cerrar una cuenta ante abuso del servicio, fraude, incumplimiento de estas reglas o requerimiento legal. Y aquí la arquitectura juega a tu favor: como nunca custodiamos, suspender una cuenta jamás retiene tu dinero — tu capital sigue en tus wallets y en los protocolos, operable sin nosotros.',
      'We can suspend or close an account for service abuse, fraud, breach of these rules or legal requirement. And here the architecture works in your favour: since we never hold custody, suspending an account never withholds your money — your capital stays in your wallets and in the protocols, operable without us.',
      lang,
    ),
  },
  {
    title: T('Tus impuestos y el uso del servicio', 'Your taxes and use of the service', lang),
    body: T(
      'Las obligaciones fiscales derivadas de tus operaciones son tuyas: no hacemos cálculo ni retención de impuestos. La demo se ofrece para tu uso personal; no está permitido atacar el servicio, sondearlo en busca de vulnerabilidades sin avisarnos, ni usarlo para actividades ilícitas. El nombre y el contenido de Astryum son del operador; el código publicado en nuestro repositorio mantiene la licencia que lo acompaña.',
      'Tax obligations arising from your operations are yours: we do no tax calculation or withholding. The demo is offered for your personal use; attacking the service, probing it for vulnerabilities without telling us, or using it for unlawful activity is not permitted. The Astryum name and content belong to the operator; the code published in our repository keeps the license that accompanies it.',
      lang,
    ),
  },
];

const PIPELINE = (lang: Lang) => [
  {
    step: '01',
    title: T('Se prepara — sin firmar', 'It is prepared — unsigned', lang),
    // GLOSSARY reconciliation 2026-07-29: "prepara" / "transacción", never
    // "compila" / "payload".
    body: T(
      'Astryum prepara tu acción en una transacción SIN firmar: qué contrato toca, qué función llama, con qué parámetros. La transacción completa es tuya antes de que exista firma alguna.',
      'Astryum prepares your action as an UNSIGNED transaction: which contract it touches, which function it calls, with which parameters. The full transaction is yours before any signature exists.',
      lang,
    ),
  },
  {
    step: '02',
    title: T('Se simula y se enseña', 'It is simulated and shown', lang),
    body: T(
      'Antes de llegar a tu wallet se te muestra entera: efecto esperado, costes (incluida la fee del ejecutor, que fija el protocolo, no Astryum) y los chequeos que pasa. En los carriles de estrategia de Flare y en las órdenes de consejo, además, se simula contra la cadena antes de que firmes. Sin sorpresas ni letra pequeña.',
      'Before it reaches your wallet it is shown to you whole: expected effect, costs (including the executor fee, set by the protocol, not by Astryum) and the checks it passes. On the Flare strategy rails and on council orders it is additionally simulated against the chain before you sign. No surprises, no small print.',
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
              {/* The version stamp is not decoration: the acceptance recorded on
                  each account stores THIS string, so a user can check which text
                  they accepted. Must match DEMO_TERMS_VERSION (routes/auth.ts). */}
              <p className="mx-auto mt-4 font-mono text-[11px] text-white/35">
                {T(
                  'Última actualización: 1 de agosto de 2026 · Versión 2026-08-01.1',
                  'Last updated: 1 August 2026 · Version 2026-08-01.1',
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

          {/* the rules of use — the clauses that protect both sides */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <h2 className="text-center font-bold text-white" style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', letterSpacing: '-0.02em' }}>
                  {T('Las reglas de uso', 'The rules of use', lang)}
                </h2>
              </Reveal>
              <div className="mt-8 space-y-4">
                {RULES(lang).map((r, i) => (
                  <Reveal key={r.title} delay={0.05 * i}>
                    <div className="rounded-2xl p-5" style={CARD}>
                      <h3 className="text-[15px] font-semibold text-white">{r.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-white/55">{r.body}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
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
              <p className="mx-auto mt-3 max-w-lg font-mono text-[10.5px] leading-relaxed text-white/30">
                {T(
                  'Astryum lo opera una persona física establecida en el Principat d’Andorra. Identificación completa del operador, tratamiento de datos y representante en la UE: ',
                  'Astryum is operated by a natural person established in the Principality of Andorra. Full operator identification, data processing and EU representative: ',
                  lang,
                )}
                <a href="/privacy" className="underline" style={{ color: GOLD_SOFT }}>
                  {T('Aviso de privacidad', 'Privacy notice', lang)}
                </a>
              </p>
            </Reveal>
          </section>
        </>
      )}
    </SubpageShell>
  );
}
