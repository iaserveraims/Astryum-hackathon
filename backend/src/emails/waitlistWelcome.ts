/**
 * Waitlist welcome email — the boarding-call confirmation.
 *
 * Branded dark HTML (comet lockup, terminal/uplink chrome, telemetry bar),
 * bilingual ES/EN chosen by the `lang` the signup carried. Copy stays honest
 * (no yield promises, no "recommendations" — invariant #9): we confirm the
 * signal and say we'll write again when their wave opens.
 *
 * Sent once, on the FIRST signup only (see routes/waitlist.ts).
 *
 * Links:
 *  - CTA → the site (astryum.xyz)
 *  - secondary → Linktree hub (the one social door — matches the landing)
 *  - unsubscribe → mailto (we send over raw SMTP, no ESP merge tags); upgrade
 *    to a tokenized one-click endpoint if the list ever moves to an ESP.
 */

export interface WelcomeEmailParams {
  email: string;
  lang: 'es' | 'en';
  /** 'early-access' | 'demo' | 'legacy' — which door they came through (labels the header). */
  source: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SITE_URL = 'https://astryum.xyz';
const LINKTREE_URL = 'https://linktr.ee/astryum';
const LOGO_URL = 'https://astryum.xyz/email/astryum-logo.png';
const UNSUB_MAILTO = 'mailto:astryum@astryum.xyz?subject=Unsubscribe%20Astryum';

interface Copy {
  subject: string;
  title: string;
  preheader: string;
  badge: string;
  h1: string;
  p1: string;
  p2: string;
  p3: string;
  cta: string;
  secondaryHtml: string;
  signOff1: string;
  signOff2: string;
  footer1Html: string;
  footer2: string;
  footer3Html: string;
  text: string;
}

function copyFor(lang: 'es' | 'en'): Copy {
  if (lang === 'es') {
    return {
      subject: 'Señal recibida — estás en la lista de Astryum',
      title: 'Señal recibida — Astryum',
      preheader:
        'Estás en la lista de embarque. Astryum abre por oleadas — te llamaremos cuando tu plaza esté lista.',
      badge: 'SEÑAL RECIBIDA &middot; LISTA DE EMBARQUE',
      h1: 'Estás en la lista.',
      p1: 'Tu señal ha llegado. Astryum abre por <strong style="color:#F5F2E9;">oleadas</strong> &mdash; mantenemos el acceso anticipado reducido para que cada plaza tenga una bienvenida de verdad. Cuando la tuya esté lista, te llamaremos aquí.',
      p2: 'Mientras tanto, esto es lo que te espera: <strong style="color:#F5F2E9;">un centro de mando para tu capital</strong> &mdash; ver cada activo que tienes, entender su riesgo y ponerlo a trabajar, con herramientas de nivel institucional hechas para todos.',
      p3: 'Y una promesa que no cambia nunca: <strong style="color:#E8C25A;">tú siempre firmas.</strong> Astryum nunca guarda tus claves, nunca custodia tus fondos, nunca actúa sin ti. Tu capital, tu control &mdash; no es nuestro eslogan, es nuestra arquitectura.',
      cta: 'Sigue la misión&nbsp;&nbsp;&rarr;',
      secondaryHtml: `Construimos en abierto &mdash; síguenos en <a href="${LINKTREE_URL}" style="color:#E8C25A;text-decoration:none;">Linktree&nbsp;&#8599;</a>`,
      signOff1: 'Nos vemos a bordo,',
      signOff2: 'La tripulación de Astryum',
      footer1Html: `Recibes este correo porque solicitaste acceso anticipado en <a href="${SITE_URL}" style="color:#8A8471;">astryum.xyz</a>.`,
      footer2: 'Solo usamos tu email para avisarte del embarque — nada más.',
      footer3Html: `<a href="${UNSUB_MAILTO}" style="color:#8A8471;">Darme de baja</a> y perdemos tu señal — sin preguntas.`,
      text: [
        'Estás en la lista.',
        '',
        'Tu señal ha llegado. Astryum abre por oleadas — mantenemos el acceso anticipado reducido para que cada plaza tenga una bienvenida de verdad. Cuando la tuya esté lista, te llamaremos aquí.',
        '',
        'Mientras tanto, esto es lo que te espera: un centro de mando para tu capital — ver cada activo que tienes, entender su riesgo y ponerlo a trabajar, con herramientas de nivel institucional hechas para todos.',
        '',
        'Y una promesa que no cambia nunca: tú siempre firmas. Astryum nunca guarda tus claves, nunca custodia tus fondos, nunca actúa sin ti. Tu capital, tu control — no es nuestro eslogan, es nuestra arquitectura.',
        '',
        `Sigue la misión: ${SITE_URL}`,
        `Todos nuestros canales: ${LINKTREE_URL}`,
        '',
        'Nos vemos a bordo,',
        'La tripulación de Astryum',
        '',
        'Recibes este correo porque solicitaste acceso anticipado en astryum.xyz. Solo usamos tu email para avisarte del embarque. Para darte de baja, responde a este correo.',
      ].join('\n'),
    };
  }
  return {
    subject: "Signal received — you're on the Astryum list",
    title: 'Signal received — Astryum',
    preheader:
      "You're on the boarding list. Astryum opens in waves — we'll call you when your seat is ready.",
    badge: 'SIGNAL RECEIVED &middot; BOARDING LIST',
    h1: "You're on the list.",
    p1: "Your signal came through. Astryum opens in <strong style=\"color:#F5F2E9;\">waves</strong> &mdash; we keep early access small so every seat gets a real welcome. When yours is ready, this is where we'll call you.",
    p2: "While you wait, here's what you signed up for: <strong style=\"color:#F5F2E9;\">one command center for your capital</strong> &mdash; see every asset you hold, understand its risk, and put it to work, with institutional-grade tools made for everyone.",
    p3: "And one promise that never changes: <strong style=\"color:#E8C25A;\">you always sign.</strong> Astryum never holds your keys, never custodies your funds, never acts without you. Your capital, your control &mdash; that's not our slogan, it's our architecture.",
    cta: 'Follow the mission&nbsp;&nbsp;&rarr;',
    secondaryHtml: `Build-in-public updates on <a href="${LINKTREE_URL}" style="color:#E8C25A;text-decoration:none;">Linktree&nbsp;&#8599;</a>`,
    signOff1: 'See you on board,',
    signOff2: 'The Astryum crew',
    footer1Html: `You're receiving this because you requested early access at <a href="${SITE_URL}" style="color:#8A8471;">astryum.xyz</a>.`,
    footer2: 'We only use your email for the boarding call — nothing else.',
    footer3Html: `<a href="${UNSUB_MAILTO}" style="color:#8A8471;">Unsubscribe</a> and we'll lose your signal — no questions asked.`,
    text: [
      "You're on the list.",
      '',
      "Your signal came through. Astryum opens in waves — we keep early access small so every seat gets a real welcome. When yours is ready, this is where we'll call you.",
      '',
      "While you wait, here's what you signed up for: one command center for your capital — see every asset you hold, understand its risk, and put it to work, with institutional-grade tools made for everyone.",
      '',
      "And one promise that never changes: you always sign. Astryum never holds your keys, never custodies your funds, never acts without you. Your capital, your control — that's not our slogan, it's our architecture.",
      '',
      `Follow the mission: ${SITE_URL}`,
      `All our channels: ${LINKTREE_URL}`,
      '',
      'See you on board,',
      'The Astryum crew',
      '',
      "You're receiving this because you requested early access at astryum.xyz. We only use your email for the boarding call. To unsubscribe, just reply to this email.",
    ].join('\n'),
  };
}

export function renderWaitlistWelcome(p: WelcomeEmailParams): RenderedEmail {
  const c = copyFor(p.lang);
  const doorLabel = p.source === 'demo' ? 'DEMO' : p.source === 'legacy' ? 'LEGACY' : 'ACCESS';

  const html = `<!DOCTYPE html>
<html lang="${p.lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${c.title}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    body { margin:0; padding:0; background:#080808; -webkit-text-size-adjust:100%; }
    a { color:#E8C25A; }
    @media only screen and (max-width:620px){
      .container{ width:100% !important; }
      .px{ padding-left:24px !important; padding-right:24px !important; }
      .h1{ font-size:30px !important; line-height:38px !important; }
      .tele td{ display:block !important; width:100% !important; padding:6px 0 !important; text-align:center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#080808;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${c.preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;">
    <tr><td align="center" style="padding:40px 12px;">

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

        <!-- LOGO -->
        <tr><td align="center" style="padding:0 0 28px;">
          <img src="${LOGO_URL}" width="180" alt="ASTRYUM" style="display:block;border:0;width:180px;height:auto;font-family:Consolas,Menlo,monospace;font-size:20px;letter-spacing:6px;color:#E8C25A;">
        </td></tr>

        <!-- CARD -->
        <tr><td style="background:#0E0D0B;border:1px solid #2A2517;border-radius:14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

            <!-- Terminal top bar -->
            <tr><td class="px" style="padding:20px 40px 0;">
              <table role="presentation" width="100%"><tr>
                <td style="font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#C9A227;">UPLINK&nbsp;&nbsp;&middot;&nbsp;&nbsp;ASTRYUM.RELAY</td>
                <td align="right" style="font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#6B6656;">DOOR&nbsp;&nbsp;&middot;&nbsp;&nbsp;${doorLabel}</td>
              </tr></table>
            </td></tr>

            <!-- Badge -->
            <tr><td align="center" style="padding:36px 40px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="border:1px solid #C9A227;border-radius:999px;padding:8px 18px;font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:3px;color:#E8C25A;">
                  <span style="color:#5BD68A;">&#9679;</span>&nbsp;&nbsp;${c.badge}
                </td>
              </tr></table>
            </td></tr>

            <!-- H1 -->
            <tr><td align="center" class="px h1" style="padding:24px 48px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:36px;line-height:44px;font-weight:800;color:#F5F2E9;">
              ${c.h1}
            </td></tr>

            <!-- Body -->
            <tr><td class="px" style="padding:12px 48px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#B8B2A3;">
              <p style="margin:0 0 18px;">${c.p1}</p>
              <p style="margin:0 0 18px;">${c.p2}</p>
              <p style="margin:0;">${c.p3}</p>
            </td></tr>

            <!-- CTA -->
            <tr><td align="center" style="padding:32px 48px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td align="center" bgcolor="#E8C25A" style="border-radius:10px;">
                  <a href="${SITE_URL}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#141310;text-decoration:none;border-radius:10px;">${c.cta}</a>
                </td>
              </tr></table>
              <div style="padding-top:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#6B6656;">
                ${c.secondaryHtml}
              </div>
            </td></tr>

            <!-- Telemetry bar -->
            <tr><td class="px" style="padding:30px 40px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #221E14;">
                <tr class="tele">
                  <td style="padding:16px 0 0;font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#6B6656;"><span style="color:#5BD68A;">&#9679;</span>&nbsp;CHANNEL&nbsp;<span style="color:#E8C25A;">OPEN</span></td>
                  <td align="center" style="padding:16px 0 0;font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#6B6656;">WAVE&nbsp;<span style="color:#E8C25A;">01</span>&nbsp;&middot;&nbsp;<span style="color:#E8C25A;">FLARE</span></td>
                  <td align="right" style="padding:16px 0 0;font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#6B6656;">CUSTODY&nbsp;<span style="color:#E8C25A;">YOURS</span></td>
                </tr>
              </table>
            </td></tr>

          </table>
        </td></tr>

        <!-- Signature -->
        <tr><td align="center" style="padding:28px 20px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#B8B2A3;">
          ${c.signOff1}<br><span style="color:#F5F2E9;font-weight:600;">${c.signOff2}</span>
        </td></tr>

        <!-- Footer / legal -->
        <tr><td align="center" style="padding:18px 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#6B6656;">
          ${c.footer1Html}<br>
          ${c.footer2}<br>
          ${c.footer3Html}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: c.subject, html, text: c.text };
}
