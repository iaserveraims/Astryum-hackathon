'use client';

/**
 * /privacy — the privacy notice, published as a living page (C1 of the legal
 * implementation checklist, founder go 2026-07-30).
 *
 * Single source of truth: legal/12-aviso-privacidad.md — every section here
 * mirrors that document, which is itself written against the code (inventory
 * at commit f121511, revisions 2026-07-29/30). If a treatment changes, the md
 * changes first, then this page.
 *
 * Identity by env (NEXT_PUBLIC_LEGAL_HOLDER_NAME / _NRT / _ADDRESS): the
 * holder's data never enters git history — the page reads it at build time
 * from Vercel. ADDRESS is deliberately optional (founder decision 30-jul: the
 * personal address is NOT published; the row renders only when a professional
 * address exists). The page is served with robots noindex (see app/privacy/
 * page.tsx): visible to anyone who visits — the legal requirement — without
 * feeding the holder's name to search engines.
 */

import SubpageShell from './SubpageShell';
import { BORDER, Reveal } from './interactions';
import { T, type Lang } from './useLang';

const CARD: React.CSSProperties = { border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' };
const GOLD_SOFT = '#E8C25A';

const HOLDER_NAME = process.env.NEXT_PUBLIC_LEGAL_HOLDER_NAME || '[pendiente de publicación]';
const HOLDER_NRT = process.env.NEXT_PUBLIC_LEGAL_HOLDER_NRT || '[pendiente de publicación]';
const HOLDER_ADDRESS = process.env.NEXT_PUBLIC_LEGAL_HOLDER_ADDRESS || '';

const PRIGHTER_URL = 'https://app.prighter.com/portal/astryum';
const CONTACT = 'astryum@astryum.xyz';

/** Section shell: numbered title + prose children. */
function Sec({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section className="mt-10">
        <h2 className="text-[17px] font-bold text-white" style={{ letterSpacing: '-0.01em' }}>
          <span className="font-mono text-[13px] mr-2" style={{ color: GOLD_SOFT }}>
            {n}
          </span>
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-white/60">{children}</div>
      </section>
    </Reveal>
  );
}

function Table({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="overflow-x-auto rounded-xl" style={CARD}>
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} style={{ borderTop: i === 0 ? 'none' : `1px solid rgba(255,255,255,0.06)` }}>
              <td className="px-3.5 py-2.5 font-semibold text-white/75 align-top whitespace-nowrap">{k}</td>
              <td className="px-3.5 py-2.5 text-white/55 align-top">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <SubpageShell>
      {(lang: Lang) => (
        <div className="px-6 pt-36 pb-24">
          <div className="mx-auto max-w-3xl">
            {/* hero */}
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
                {T('Documentación pública · Demo', 'Public documentation · Demo', lang)}
              </p>
              <h1
                className="mt-4 font-bold text-white text-balance"
                style={{ fontSize: 'clamp(1.8rem, 4.5vw, 2.8rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}
              >
                {T('Aviso de privacidad', 'Privacy notice', lang)}
              </h1>
              <p className="mt-4 text-[14px] leading-relaxed text-white/55">
                {T(
                  'Qué datos tratamos, por qué, quién los recibe y qué derechos tienes — escrito contra el código real del producto: cada afirmación se corresponde con algo verificable en nuestro repositorio. Preferimos decirte lo que aún no está resuelto antes que prometerte lo que el sistema no hace.',
                  'What data we process, why, who receives it and what rights you have — written against the actual product code: every claim here corresponds to something verifiable in our repository. We would rather tell you what is not solved yet than promise what the system does not do.',
                  lang,
                )}
              </p>
              <p className="mt-2 font-mono text-[11px] text-white/35">
                {T(
                  'Última actualización: 11 de agosto de 2026 · Versión 2026-08-11',
                  'Last updated: 11 August 2026 · Version 2026-08-11',
                  lang,
                )}
              </p>
            </Reveal>

            {/* 0 */}
            <Sec n="0" title={T('Dónde estás: una demo pública acotada', 'Where you are: a bounded public demo', lang)}>
              <p>
                {T(
                  'Astryum está en fase de demo pública de validación: cualquiera puede registrarse y probar el producto con XRP real en mainnet, dentro de límites deliberados — un tope máximo por operación y límites diarios cuyos valores vigentes te muestra la propia app antes de operar. Es software experimental en desarrollo activo, construido en abierto durante los programas de builders de XRPL y Flare.',
                  'Astryum is in a public validation demo phase: anyone can register and try the product with real XRP on mainnet, inside deliberate limits — a per-operation cap and daily limits whose current values the app shows you before you act. It is experimental software in active development, built in the open during the XRPL and Flare builder programs.',
                  lang,
                )}
              </p>
              <p>
                {T(
                  'Este aviso te explica, con el detalle que exige el Reglamento (UE) 2016/679 («RGPD»), qué tratamos y qué derechos tienes.',
                  'This notice explains, with the detail Regulation (EU) 2016/679 (“GDPR”) requires, what we process and what rights you have.',
                  lang,
                )}
              </p>
            </Sec>

            {/* 1 */}
            <Sec n="1" title={T('Quién es el responsable', 'Who the controller is', lang)}>
              <Table
                rows={[
                  [
                    T('Responsable', 'Controller', lang),
                    <>
                      {HOLDER_NAME} —{' '}
                      {T('persona física, establecida en el Principat d’Andorra', 'natural person, established in the Principality of Andorra', lang)}
                    </>,
                  ],
                  [T('NRT (id. fiscal andorrana)', 'NRT (Andorran tax id)', lang), HOLDER_NRT],
                  ...(HOLDER_ADDRESS
                    ? ([[T('Domicilio profesional', 'Professional address', lang), HOLDER_ADDRESS]] as Array<[string, React.ReactNode]>)
                    : []),
                  [
                    T('Contacto (privacidad y derechos)', 'Contact (privacy & rights)', lang),
                    <>
                      <a href={`mailto:${CONTACT}`} className="underline" style={{ color: GOLD_SOFT }}>
                        {CONTACT}
                      </a>{' '}
                      {T(
                        '— el domicilio del responsable se facilita a las autoridades y ante requerimiento legítimo',
                        '— the controller’s address is provided to authorities and upon legitimate request',
                        lang,
                      )}
                    </>,
                  ],
                  [
                    T('Representante en la UE (art. 27 RGPD)', 'EU representative (art. 27 GDPR)', lang),
                    <>
                      Prighter EU Rep GmbH, Schellinggasse 3/10, 1010 {T('Viena', 'Vienna', lang)}, Austria —{' '}
                      {T(
                        'puedes dirigirte a él para ejercer tus derechos (p. ej. acceso o supresión); designación verificable públicamente en',
                        'you can address it to exercise your rights (e.g. access or erasure); appointment publicly verifiable at',
                        lang,
                      )}{' '}
                      <a href={PRIGHTER_URL} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: GOLD_SOFT }}>
                        app.prighter.com/portal/astryum
                      </a>
                    </>,
                  ],
                ]}
              />
              <p>
                {T(
                  'El responsable está establecido en el Principado de Andorra, que no forma parte de la UE ni del EEE: es un tercer país al que la Comisión Europea reconoce un nivel adecuado de protección de datos (Decisión 2010/625/UE, confirmada vigente en la revisión de la Comisión de enero de 2024). En la práctica: nos aplica la ley andorrana de protección de datos (Llei 29/2021) con la supervisión de la APDA — y, porque ofrecemos el servicio a residentes en la Unión Europea, nos aplica además el RGPD por su artículo 3.2. Los derechos que este aviso te reconoce son los del RGPD, sin recortes.',
                  'The controller is established in the Principality of Andorra, which is not part of the EU or the EEA: a third country whose data-protection level the European Commission recognises as adequate (Decision 2010/625/EU, confirmed in the Commission’s January 2024 review). In practice: Andorran data-protection law (Llei 29/2021) applies to us under the supervision of the APDA — and, because we offer the service to EU residents, the GDPR also applies to us via its Article 3.2. The rights this notice grants you are full GDPR rights.',
                  lang,
                )}
              </p>
              <p>
                {T(
                  'No hay delegado de protección de datos designado: por el tamaño y la naturaleza de esta fase, no es obligatorio.',
                  'No data protection officer is appointed: given the size and nature of this phase, it is not mandatory.',
                  lang,
                )}
              </p>
            </Sec>

            {/* 2 */}
            <Sec n="2" title={T('Qué datos tratamos y de dónde salen', 'What data we process and where it comes from', lang)}>
              <h3 className="text-[14px] font-semibold text-white/80">{T('Los que nos das tú', 'What you give us', lang)}</h3>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>{T('Email — al apuntarte a la lista de espera o crear cuenta (único dato que pide la lista).', 'Email — when joining the waitlist or creating an account (the only field the waitlist asks for).', lang)}</li>
                <li>{T('Contraseña — guardada solo como hash (scrypt), nunca en claro.', 'Password — stored only as a hash (scrypt), never in clear text.', lang)}</li>
                <li>{T('Nombre de usuario, nombre y avatar — opcionales; el avatar es una imagen reducida en nuestra base, nunca una URL externa.', 'Username, name and avatar — optional; the avatar is a downsized image in our database, never an external URL.', lang)}</li>
                <li>{T('Direcciones de wallet — al conectar o vincular: dirección, tipo, red y el apodo que le pongas.', 'Wallet addresses — when connecting or binding: address, type, network and the nickname you give it.', lang)}</li>
                <li>{T('Mensajes a los asistentes de IA — lo que escribes viaja a nuestro proveedor de IA (sección 4).', 'Messages to the AI assistants — what you write travels to our AI provider (section 4).', lang)}</li>
                <li>{T('Región — si la eliges en Ajustes, se queda en tu navegador; solo viaja adjunta a peticiones de ejecución DeFi y no la almacenamos.', 'Region — if you pick it in Settings it stays in your browser; it only travels attached to DeFi execution requests and we do not store it.', lang)}</li>
              </ul>
              <h3 className="text-[14px] font-semibold text-white/80 pt-2">{T('Los que se generan al usar el servicio', 'What using the service generates', lang)}</h3>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>{T('IP y navegador (User-Agent) — la IP de tu sesión se guarda con ella; todas las peticiones quedan en los registros técnicos del servidor.', 'IP and browser (User-Agent) — your session IP is stored with it; all requests land in the server’s technical logs.', lang)}</li>
                <li>{T('Posiciones y saldos — instantáneas de cartera leídas de las cadenas públicas.', 'Positions and balances — portfolio snapshots read from the public chains.', lang)}</li>
                <li>{T('Registros de auditoría — qué se preparó, cuándo y la dirección implicada; nunca la transacción firmada.', 'Audit records — what was prepared, when, and the address involved; never the signed transaction.', lang)}</li>
                <li>{T('Firma de vinculación — la firma criptográfica que prueba que la dirección es tuya.', 'Binding signature — the cryptographic signature proving the address is yours.', lang)}</li>
                <li>{T('Conversaciones del Agente — es el único asistente que guarda historial; puedes borrarlo tú.', 'Agent conversations — the only assistant that keeps history; you can delete it yourself.', lang)}</li>
                <li>{T('Registro de tu aceptación — la versión de las condiciones, la versión de este aviso y la fecha. No solo al registrarte: si entraste con wallet o si cambiamos un texto de forma material, te lo volvemos a presentar al entrar al panel.', 'Record of your acceptance — the terms version, this notice’s version and the date. Not only at sign-up: if you came in with a wallet, or if we change a text materially, we present it again when you enter the dashboard.', lang)}</li>
                <li>{T('Métricas de visita — al navegar por la web, si la analítica está activa: página vista, referencia de origen, tipo de dispositivo y país aproximado derivado de la IP, agregadas y sin cookies; el identificador es un hash que rota a diario y no permite seguirte entre días ni entre sitios.', 'Visit metrics — while browsing the site, when analytics is on: page viewed, referrer, device type and approximate country derived from the IP, aggregated and cookieless; the identifier is a daily-rotating hash that cannot follow you across days or across sites.', lang)}</li>
              </ul>
              <h3 className="text-[14px] font-semibold text-white/80 pt-2">{T('Datos de terceros que introduces tú', 'Third-party data you enter', lang)}</h3>
              <p>
                {T(
                  'Si añades una dirección ajena a tu lista de vigilancia (watchlist), tratamos esa dirección y tu etiqueta. Esa dirección puede pertenecer a otra persona: al añadirla, te corresponde a ti tener una razón legítima para vigilarla. La tratamos como parte del servicio que nos pides, no la enriquecemos ni cruzamos con otras fuentes, y la borramos cuando la quitas de tu lista.',
                  'If you add someone else’s address to your watchlist, we process that address and your label. That address may belong to another person: by adding it, it is on you to have a legitimate reason to watch it. We process it as part of the service you request, never enrich or cross it with other sources, and delete it when you remove it.',
                  lang,
                )}
              </p>
              <p className="text-white/45">
                {T(
                  'Lo que NO recogemos: sin píxeles de marketing, sin rastreo entre sitios, sin geolocalización precisa, sin documentos de identidad. La única medición es la métrica de visitas agregada y sin cookies de la lista anterior. El detalle, en la sección 10.',
                  'What we do NOT collect: no marketing pixels, no cross-site tracking, no precise geolocation, no identity documents. The only measurement is the aggregated, cookieless visit metric listed above. Details in section 10.',
                  lang,
                )}
              </p>
            </Sec>

            {/* 3 */}
            <Sec n="3" title={T('Para qué y con qué base jurídica', 'Purposes and legal bases', lang)}>
              <Table
                rows={[
                  [T('Cuenta y autenticación', 'Account & authentication', lang), T('Ejecución del contrato (6.1.b) — sin cuenta no hay servicio.', 'Contract performance (6.1.b) — no account, no service.', lang)],
                  [T('Aceptación de condiciones y constancia de que se te mostró este aviso', 'Terms acceptance and record that this notice was shown to you', lang), T('Obligación de prueba (6.1.c) + interés legítimo (6.1.f).', 'Evidence obligation (6.1.c) + legitimate interest (6.1.f).', lang)],
                  [T('Wallets y lectura de cartera', 'Wallets & portfolio', lang), T('Ejecución del contrato (6.1.b) — es la petición expresa del servicio.', 'Contract performance (6.1.b) — the express request of the service.', lang)],
                  [T('Sesiones con IP · logs · rate-limit · captcha', 'Sessions with IP · logs · rate-limit · captcha', lang), T('Interés legítimo (6.1.f) — seguridad y protección frente a abuso; contadores de rate-limit en memoria, no persistidos.', 'Legitimate interest (6.1.f) — security and abuse protection; rate-limit counters in memory, not persisted.', lang)],
                  [T('Auditoría de operaciones preparadas', 'Audit of prepared operations', lang), T('Interés legítimo (6.1.f) — la prueba de que solo preparamos y tú firmas.', 'Legitimate interest (6.1.f) — the proof that we only prepare and you sign.', lang)],
                  [T('Asistentes de IA', 'AI assistants', lang), T('Ejecución del contrato (6.1.b) — solo cuando invocas al asistente.', 'Contract performance (6.1.b) — only when you invoke the assistant.', lang)],
                  [T('Lista de espera', 'Waitlist', lang), T('Consentimiento (6.1.a) — lo retiras escribiéndonos y te damos de baja.', 'Consent (6.1.a) — withdraw by writing to us and we remove you.', lang)],
                  [T('Watchlist de terceros', 'Third-party watchlist', lang), T('Interés legítimo (6.1.f) — tú aportas la legitimidad sobre esa dirección.', 'Legitimate interest (6.1.f) — you supply the legitimacy over that address.', lang)],
                  [T('Métricas de visita', 'Visit metrics', lang), T('Interés legítimo (6.1.f) — saber si la web se visita y desde dónde, con datos agregados, sin cookies y sin identificador persistente; nunca para perfilado ni publicidad. Puedes oponerte (art. 21).', 'Legitimate interest (6.1.f) — knowing whether the site is visited and from where, with aggregated, cookieless data and no persistent identifier; never for profiling or advertising. You can object (art. 21).', lang)],
                ]}
              />
              <p>
                {T(
                  'No usamos el consentimiento como comodín: donde la base es el contrato o el interés legítimo, lo decimos y lo justificamos. Puedes oponerte a los tratamientos basados en interés legítimo (art. 21) escribiéndonos.',
                  'We do not use consent as a catch-all: where the basis is contract or legitimate interest, we say so and justify it. You can object to legitimate-interest processing (art. 21) by writing to us.',
                  lang,
                )}
              </p>
            </Sec>

            {/* 4 */}
            <Sec n="4" title={T('Quién recibe tus datos', 'Who receives your data', lang)}>
              <Table
                rows={[
                  ['Vercel', T('Aloja la web: toda petición web (IP, navegador, páginas). Fráncfort (EEE). Además, si la analítica está activa, Vercel Inc. (EE. UU.) procesa las métricas de visita de la sección 2 — página, referencia, dispositivo, país aproximado — de forma agregada y sin cookies; garantías en la sección 5.', 'Hosts the web: every web request (IP, browser, pages). Frankfurt (EEA). Additionally, when analytics is on, Vercel Inc. (USA) processes the section-2 visit metrics — page, referrer, device, approximate country — aggregated and cookieless; safeguards in section 5.', lang)],
                  ['Railway', T('Aloja backend y base de datos: los datos de la sección 2 y los registros técnicos. Ámsterdam (EEE).', 'Hosts backend and database: the data in section 2 and the technical logs. Amsterdam (EEA).', lang)],
                  [
                    'Anthropic',
                    T(
                      'Proveedor de los asistentes de IA (EE. UU.). Recibe tu mensaje y el contexto según el asistente — en varios, tus direcciones de wallet y valores; el asistente Legacy las anonimiza en tu navegador antes de enviar. Nunca viajan claves, tokens ni credenciales. Usamos su API comercial: el contenido no se usa para entrenar sus modelos y las entradas/salidas se eliminan en ~30 días.',
                      'Provider of the AI assistants (USA). Receives your message and context depending on the assistant — in several, your wallet addresses and values; the Legacy assistant anonymises them in your browser before sending. Keys, tokens and credentials never travel. We use their commercial API: content is not used to train their models and inputs/outputs are deleted in ~30 days.',
                      lang,
                    ),
                  ],
                  [
                    T('Nodos y exploradores de cadena', 'Chain nodes & explorers', lang),
                    T(
                      'Flare Networks, Ankr, Ripple, XRPL Cluster, exploradores y el Flare Data Connector. El matiz honesto: esas consultas salen de nuestro servidor — el proveedor ve la dirección consultada y nuestra IP, no la tuya. Pero no todo sale del servidor: lo que pide tu propio navegador va en la fila siguiente.',
                      'Flare Networks, Ankr, Ripple, XRPL Cluster, explorers and the Flare Data Connector. The honest nuance: those queries leave from our server — the provider sees the queried address and our IP, not yours. But not everything leaves from the server: what your own browser requests is in the next row.',
                      lang,
                    ),
                  ],
                  [
                    T('Lo que pide tu navegador (ve tu IP)', 'What your browser requests (sees your IP)', lang),
                    T(
                      'CoinGecko, para precios y logos: ve tu IP y qué activos consultas, nunca tu dirección. Nodos públicos de XRPL (xrplcluster.com, xrpl.link, s1.ripple.com) al difundir una orden de consejo firmada y al comprobar su liquidación: ven tu IP y la transacción, porque no pasa por nuestro servidor. Los RPC públicos por defecto de cada red EVM en algunas lecturas. El relay de WalletConnect, solo si conectas por ahí. Y los CDN de logos e iconos (cryptologos, icons.llama.fi, jsdelivr, Wikimedia, icons.duckduckgo.com), que por la imagen que pides ven qué activo o protocolo miras. Nada de esto lleva analítica ni perfilado — pero lleva tu IP, y preferimos que lo sepas. Servir esos logos desde nuestro dominio quitaría la mayoría: está en la lista y ha empezado — FXRP ya se sirve desde el nuestro, así que mirar una posición en FXRP no se lo cuenta a ningún CDN; el resto sigue saliendo fuera.',
                      'CoinGecko, for prices and logos: it sees your IP and which assets you look up, never your address. Public XRPL nodes (xrplcluster.com, xrpl.link, s1.ripple.com) when broadcasting a signed council order and checking its settlement: they see your IP and the transaction, because it does not go through our server. Each EVM network’s default public RPC on some reads. The WalletConnect relay, only if you connect that way. And the logo and icon CDNs (cryptologos, icons.llama.fi, jsdelivr, Wikimedia, icons.duckduckgo.com), which from the image you request can tell which asset or protocol you are looking at. None of this carries analytics or profiling — but it carries your IP, and we would rather you knew. Serving those logos from our own domain would remove most of it: it is on the list and it has started — FXRP is already served from ours, so looking at an FXRP position tells no CDN anything; the rest still goes out.',
                      lang,
                    ),
                  ],
                  ['GoPlus · DefiLlama', T('GoPlus recibe direcciones de contratos que evaluamos por seguridad (nunca la tuya); DefiLlama, consultas de pools sin datos personales.', 'GoPlus receives contract addresses we screen for safety (never yours); DefiLlama, pool queries with no personal data.', lang)],
                  ['Cloudflare', T('Solo al validar el captcha de los formularios: tu IP y el token del reto (EE. UU.).', 'Only when validating the form captcha: your IP and the challenge token (USA).', lang)],
                  [T('Correo (Resend o Zoho)', 'Email (Resend or Zoho)', lang), T('Tu email y el contenido del correo de la lista de espera, según el transporte activo.', 'Your email and the waitlist message content, depending on the active transport.', lang)],
                  ['Google / Apple', T('Solo si eliges entrar con OAuth: nos devuelven tu email verificado.', 'Only if you choose OAuth sign-in: they return your verified email.', lang)],
                  ['Xaman (XRPL Labs)', T('Al firmar con Xaman: el payload de firma, a través de nuestro servidor; la app en tu móvil te lo muestra a ti.', 'When signing with Xaman: the signing payload, via our server; the app on your phone shows it to you.', lang)],
                ]}
              />
              <p className="font-semibold text-white/70">
                {T('No vendemos ni cedemos tus datos a nadie para publicidad. No hay más destinatarios que los listados.', 'We do not sell or share your data with anyone for advertising. There are no recipients beyond those listed.', lang)}
              </p>
            </Sec>

            {/* 5 */}
            <Sec n="5" title={T('Transferencias fuera del EEE', 'Transfers outside the EEA', lang)}>
              <p>
                {T(
                  'Tus datos en reposo se quedan en el EEE (Fráncfort y Ámsterdam). El responsable accede desde Andorra para operar el servicio: esa transferencia está amparada por la decisión de adecuación de la Comisión sobre Andorra (art. 45). Las demás se limitan a cuatro flujos, cada uno con su garantía:',
                  'Your data at rest stays in the EEA (Frankfurt and Amsterdam). The controller accesses it from Andorra to operate the service: that transfer is covered by the Commission’s adequacy decision on Andorra (art. 45). The rest are limited to four flows, each with its safeguard:',
                  lang,
                )}
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>{T('Anthropic (EE. UU.) — mensajes y contexto de los asistentes. Garantía: Cláusulas Contractuales Tipo de su acuerdo de tratamiento (art. 46), más los compromisos de la sección 4.', 'Anthropic (USA) — assistant messages and context. Safeguard: Standard Contractual Clauses in its data-processing agreement (art. 46), plus the section-4 commitments.', lang)}</li>
                <li>{T('Cloudflare (EE. UU.) — IP del captcha. Garantía: participante activo del EU-U.S. Data Privacy Framework (art. 45).', 'Cloudflare (USA) — captcha IP. Safeguard: active participant of the EU-U.S. Data Privacy Framework (art. 45).', lang)}</li>
                <li>{T('Vercel Inc. (EE. UU.) — las métricas de visita de la sección 2, si la analítica está activa. Garantía: certificación en el EU-U.S. Data Privacy Framework (art. 45), con Cláusulas Contractuales Tipo en su acuerdo de tratamiento como garantía adicional (art. 46).', 'Vercel Inc. (USA) — the section-2 visit metrics, when analytics is on. Safeguard: EU-U.S. Data Privacy Framework certification (art. 45), with Standard Contractual Clauses in its data-processing agreement as an additional safeguard (art. 46).', lang)}</li>
                <li>{T('Resend o Zoho — el email de la lista de espera, con la garantía del acuerdo del proveedor activo.', 'Resend or Zoho — the waitlist email, under the active provider’s agreement.', lang)}</li>
              </ul>
              <p className="text-white/45">
                {T(
                  'Aparte de esas tres, las peticiones que hace tu propio navegador a terceros (sección 4) pueden acabar en servidores fuera del EEE, según dónde esté el nodo o el CDN que responde. No las controlamos como transferencia nuestra —salen de tu dispositivo, no de nuestros servidores— pero llevan tu IP, así que te lo decimos igual.',
                  'Beyond those three, the requests your own browser makes to third parties (section 4) may land on servers outside the EEA, depending on which node or CDN answers. We do not control those as a transfer of ours — they leave your device, not our servers — but they carry your IP, so we tell you anyway.',
                  lang,
                )}
              </p>
            </Sec>

            {/* 6 */}
            <Sec n="6" title={T('Cuánto tiempo guardamos tus datos — la respuesta honesta', 'How long we keep your data — the honest answer', lang)}>
              <p>
                {T(
                  'En esta fase de demo no hemos implementado todavía borrados automáticos: no hay una tarea que purgue sesiones caducadas ni un botón de eliminar cuenta. En la práctica, si no nos pides lo contrario, tus datos se conservan mientras dure la fase de demo. Lo que sí te garantizamos:',
                  'In this demo phase we have not yet implemented automatic deletion: there is no job purging expired sessions and no delete-account button. In practice, unless you ask us otherwise, your data is kept for the duration of the demo phase. What we do guarantee:',
                  lang,
                )}
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>{T('Si nos pides la supresión, eliminamos manualmente tu cuenta y todo lo asociado, y respondemos en el plazo máximo de un mes (art. 12.3).', 'If you request erasure, we manually delete your account and everything tied to it, and respond within one month at most (art. 12.3).', lang)}</li>
                <li>{T('Lo que borras tú, se borra: wallets desvinculadas, conversaciones y documentos del Agente, y tu email de la lista si te das de baja.', 'What you delete is deleted: unbound wallets, Agent conversations and documents, and your waitlist email if you opt out.', lang)}</li>
                <li>{T('Al cerrar la fase de demo fijaremos plazos definitivos y los publicaremos aquí antes de aplicarlos.', 'When the demo phase closes we will set definitive retention periods and publish them here before applying them.', lang)}</li>
              </ul>
            </Sec>

            {/* 7 */}
            <Sec n="7" title={T('Los datos en las cadenas públicas — lo que nadie puede borrar', 'Data on public chains — what nobody can erase', lang)}>
              <p className="font-semibold text-white/70">
                {T('Lo que firmas se publica para siempre.', 'What you sign is published forever.', lang)}{' '}
                {T(
                  'Cuando firmas una transacción, tu dirección, el importe, el activo, la contraparte y el momento quedan replicados en miles de nodos, de forma permanente e irreversible. Ni nosotros, ni tú, ni una autoridad pueden borrarlos: los derechos de supresión y rectificación no alcanzan a lo ya escrito en una cadena pública — prometerte lo contrario sería mentirte.',
                  'When you sign a transaction, your address, amount, asset, counterparty and timing are replicated across thousands of nodes, permanently and irreversibly. Neither we, nor you, nor an authority can erase them: erasure and rectification rights do not reach what is already written on a public chain — promising otherwise would be lying to you.',
                  lang,
                )}
              </p>
              <p>
                {T(
                  'Lo que sí está en nuestra mano: mantenemos el vínculo entre tu dirección y tu identidad (cuenta, email, wallets vinculadas) — y ese vínculo sí es suprimible. Si borras tu cuenta, tu rastro on-chain sigue existiendo, pero deja de estar conectado a tu identidad en nuestra base.',
                  'What is in our hands: we hold the link between your address and your identity (account, email, bound wallets) — and that link IS erasable. If you delete your account, your on-chain trail still exists, but it is no longer connected to your identity in our database.',
                  lang,
                )}
              </p>
              <p>
                {T(
                  'Dos marcas públicas que preferimos contarte nosotros: (1) para completar ciertas operaciones, cuentas operativas nuestras publican transacciones que referencian la que tú firmaste — cualquiera que analice la cadena puede ver que tu dirección operó a través de Astryum; (2) cada transacción XRPL que preparamos lleva una etiqueta de origen pública (SourceTag) que identifica al proyecto — requisito del programa de builders en el que participamos. Cualquiera puede filtrar la cadena por esa etiqueta y encontrar el conjunto de transacciones hechas a través de Astryum, incluida la tuya. La etiqueta va solo en lo que firmas tú; nuestras cuentas operativas van sin ella.',
                  'Two public marks we would rather tell you about ourselves: (1) to complete certain operations, operational accounts of ours publish transactions referencing the one you signed — anyone analysing the chain can see your address operated through Astryum; (2) every XRPL transaction we prepare carries a public origin tag (SourceTag) identifying the project — a requirement of the builder program we take part in. Anyone can filter the chain by that tag and find the set of transactions made through Astryum, including yours. The tag goes only on what you sign; our own operational accounts go without it.',
                  lang,
                )}
              </p>
              <p>
                {T('Nuestro feed público de transparencia (/proof) muestra lo que la cadena ya enseña — hashes, importes, momentos — y nunca tu dirección: un test automatizado lo garantiza.', 'Our public transparency feed (/proof) shows what the chain already shows — hashes, amounts, timing — and never your address: an automated test guarantees it.', lang)}
              </p>
            </Sec>

            {/* 8 */}
            <Sec n="8" title={T('Tus derechos', 'Your rights', lang)}>
              <p>
                {T(
                  'Tienes derecho de acceso, rectificación, supresión (con el límite on-chain de la sección 7), oposición, limitación y portabilidad, y a retirar el consentimiento de la lista de espera en cualquier momento. Escríbenos a',
                  'You have the rights of access, rectification, erasure (with the on-chain limit of section 7), objection, restriction and portability, and to withdraw the waitlist consent at any time. Write to',
                  lang,
                )}{' '}
                <a href={`mailto:${CONTACT}`} className="underline" style={{ color: GOLD_SOFT }}>
                  {CONTACT}
                </a>{' '}
                {T('desde el email de tu cuenta (o aportando prueba de control de la wallet). Respondemos en el plazo máximo de un mes.', 'from your account email (or with proof of wallet control). We respond within one month at most.', lang)}
              </p>
              <p className="font-semibold text-white/70">{T('Ante quién reclamar — tienes dos puertas, no una:', 'Where to complain — you have two doors, not one:', lang)}</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  {T('Ante la Agència Andorrana de Protecció de Dades (APDA), la autoridad que nos supervisa:', 'Before the Andorran Data Protection Agency (APDA), the authority supervising us:', lang)}{' '}
                  <a href="https://www.apda.ad" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: GOLD_SOFT }}>
                    www.apda.ad
                  </a>
                </li>
                <li>
                  {T(
                    'Y, si resides en la Unión Europea, ante la autoridad de tu propio país (en España, la AEPD). Como no tenemos establecimiento en la UE, no existe «ventanilla única»: la autoridad de tu país es competente para atenderte. También puedes dirigirte a nuestro representante en la UE (sección 1).',
                    'And, if you live in the European Union, before your own country’s authority (in Spain, the AEPD). As we have no EU establishment, there is no “one-stop-shop”: your country’s authority is competent to hear you. You can also address our EU representative (section 1).',
                    lang,
                  )}
                </li>
              </ul>
            </Sec>

            {/* 9 */}
            <Sec n="9" title={T('Decisiones automatizadas', 'Automated decisions', lang)}>
              <p>
                {T(
                  'Ninguna decisión automatizada produce efectos jurídicos sobre ti ni te afecta significativamente (art. 22): toda operación sobre tu capital requiere tu firma; los indicadores de riesgo que calculamos son información que se te muestra, no decisiones que se te aplican; y el módulo de ejecución puede estar limitado por región, pero la región la declaras tú — no la deducimos de tu IP.',
                  'No automated decision produces legal effects on you or significantly affects you (art. 22): every operation on your capital requires your signature; the risk indicators we compute are information shown to you, not decisions applied to you; and the execution module may be region-limited, but you declare the region yourself — we do not infer it from your IP.',
                  lang,
                )}
              </p>
            </Sec>

            {/* 10 */}
            <Sec n="10" title={T('Lo que NO hacemos — y puedes comprobar', 'What we do NOT do — and you can verify', lang)}>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>{T('Analítica mínima, sin cookies y sin rastreo: la única medición es Vercel Web Analytics — página vista, referencia, dispositivo y país aproximado, agregados; el identificador es un hash que rota a diario y no permite seguirte entre días ni entre sitios. Sin Google Analytics, sin píxeles de marketing, sin publicidad. No usa cookies — por eso sigue sin haber banner.', 'Minimal analytics, cookieless and tracking-free: the only measurement is Vercel Web Analytics — page viewed, referrer, device and approximate country, aggregated; the identifier is a daily-rotating hash that cannot follow you across days or across sites. No Google Analytics, no marketing pixels, no advertising. It uses no cookies — which is why there is still no banner.', lang)}</li>
                <li>{T('Cero geolocalización precisa y ninguna decisión por IP: no deducimos tu país de tu IP para decidir nada sobre ti; tu región la eliges tú. La única excepción es el recuento de visitas del punto anterior, que deriva el país aproximado para la estadística agregada — un dato de recuento, nunca un atributo de tu cuenta.', 'Zero precise geolocation and no IP-based decisions: we do not infer your country from your IP to decide anything about you; you pick your region yourself. The only exception is the visit count above, which derives the approximate country for the aggregated statistic — a counting datum, never an attribute of your account.', lang)}</li>
                <li>{T('Cero claves privadas: el servidor se niega a arrancar si detecta una clave de usuario en su entorno.', 'Zero private keys: the server refuses to boot if it detects a user key in its environment.', lang)}</li>
                <li>{T('Cero documentos de identidad: no almacenamos DNI, pasaportes ni selfies.', 'Zero identity documents: we store no IDs, passports or selfies.', lang)}</li>
                <li>{T('La lista de espera no es legible desde fuera, y reenviar un email no revela si ya estaba apuntado.', 'The waitlist is not readable from outside, and resubmitting an email does not reveal whether it was already on it.', lang)}</li>
                <li>{T('El contexto de IA está minimizado por diseño: nunca incluye claves, tokens ni credenciales.', 'The AI context is minimised by design: it never includes keys, tokens or credentials.', lang)}</li>
                <li>{T('Tu avatar no genera peticiones a terceros: es una imagen local, nunca una URL remota.', 'Your avatar triggers no third-party requests: a local image, never a remote URL.', lang)}</li>
                <li>{T('Dos cookies, las dos técnicas: la de la puerta de acceso (httpOnly, firmada, sin identificador de usuario, 7 días) y la que recuerda el estado de conexión de tu wallet EVM, que sí es legible por tu navegador y contiene la dirección conectada, para que al recargar sigas conectado. Sin cookies de rastreo ni de publicidad — por eso no verás un banner: las dos son necesarias para lo que pides, y para eso no se pide consentimiento.', 'Two cookies, both technical: the access-gate one (httpOnly, signed, no user identifier, 7 days) and the one remembering your EVM wallet connection state, which your browser can read and which holds the connected address, so a reload keeps you connected. No tracking or advertising cookies — that is why you see no banner: both are necessary for what you asked for, and that needs no consent.', lang)}</li>
              </ul>
            </Sec>

            {/* 11 */}
            <Sec n="11" title={T('Cambios en este aviso', 'Changes to this notice', lang)}>
              <p>
                {T(
                  'Si cambiamos este aviso, actualizaremos la fecha de arriba; si el cambio es material (nuevos destinatarios, nuevas finalidades), lo anunciaremos en la app antes de que entre en vigor. La versión publicada en cada momento es la que aplica.',
                  'If we change this notice we will update the date above; if the change is material (new recipients, new purposes), we will announce it in the app before it takes effect. The published version at any given time is the one that applies.',
                  lang,
                )}
              </p>
              <p className="font-mono text-[11px] text-white/35">
                {T(
                  'Este aviso se redactó contra el código del producto y se revisa con cada cambio que afecte a un tratamiento descrito.',
                  'This notice was written against the product code and is revised with every change affecting a described treatment.',
                  lang,
                )}
              </p>
            </Sec>
          </div>
        </div>
      )}
    </SubpageShell>
  );
}
