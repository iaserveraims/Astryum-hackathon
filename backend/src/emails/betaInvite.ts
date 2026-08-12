/**
 * Beta invite email — the boarding pass (founder 2026-08-01, beta opens 08-06).
 *
 * Sent when a founder APPROVES a waitlist email (POST /api/admin-beta/approve).
 * Same branded dark template as waitlistWelcome; the copy changes from "you're
 * on the list" to "your seat is ready — come aboard". Honest by doctrine
 * (invariant #9): no yield promises, no recommendations — we open the door and
 * restate the custody promise.
 *
 * The ONE operative line: the door recognises exactly the approved email, so
 * the CTA copy tells them to create their account WITH THIS email.
 */

import { RenderedEmail } from './waitlistWelcome';

export interface BetaInviteParams {
  email: string;
  lang: 'es' | 'en';
}

const SITE_URL = 'https://astryum.xyz';
const LOGIN_URL = 'https://astryum.xyz/login';
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

function copyFor(lang: 'es' | 'en', email: string): Copy {
  if (lang === 'es') {
    return {
      subject: 'Tu plaza está lista — embarque abierto en Astryum',
      title: 'Embarque abierto — Astryum',
      preheader: 'Tu acceso a la beta está aprobado. Crea tu cuenta con este email y sube a bordo.',
      badge: 'ACCESO APROBADO &middot; TARJETA DE EMBARQUE',
      h1: 'Tu plaza está lista.',
      p1: `Tu ola ha abierto. Crea tu cuenta con <strong style="color:#F5F2E9;">este mismo email</strong> (<span style="color:#E8C25A;">${email}</span>) &mdash; la puerta reconoce exactamente esta dirección.`,
      p2: 'Dentro te espera lo prometido: <strong style="color:#F5F2E9;">un centro de mando para tu capital</strong> &mdash; ver cada activo que tienes, entender su riesgo y ponerlo a trabajar. Es una beta: vamos por oleadas, con topes prudentes, y tu feedback pesa de verdad.',
      p3: 'La promesa de siempre no cambia al entrar: <strong style="color:#E8C25A;">tú siempre firmas.</strong> Astryum nunca guarda tus claves, nunca custodia tus fondos, nunca actúa sin ti.',
      cta: 'Embarcar&nbsp;&nbsp;&rarr;',
      secondaryHtml: `Construimos en abierto &mdash; síguenos en <a href="${LINKTREE_URL}" style="color:#E8C25A;text-decoration:none;">Linktree&nbsp;&#8599;</a>`,
      signOff1: 'Nos vemos a bordo,',
      signOff2: 'La tripulación de Astryum',
      footer1Html: `Recibes este correo porque tu solicitud de acceso anticipado en <a href="${SITE_URL}" style="color:#8A8471;">astryum.xyz</a> fue aprobada.`,
      footer2: 'Solo usamos tu email para el embarque — nada más.',
      footer3Html: `<a href="${UNSUB_MAILTO}" style="color:#8A8471;">Darme de baja</a> y perdemos tu señal — sin preguntas.`,
      text: [
        'Tu plaza está lista.',
        '',
        `Tu ola ha abierto. Crea tu cuenta con este mismo email (${email}) — la puerta reconoce exactamente esta dirección.`,
        '',
        'Dentro te espera lo prometido: un centro de mando para tu capital — ver cada activo que tienes, entender su riesgo y ponerlo a trabajar. Es una beta: vamos por oleadas, con topes prudentes, y tu feedback pesa de verdad.',
        '',
        'La promesa de siempre no cambia al entrar: tú siempre firmas. Astryum nunca guarda tus claves, nunca custodia tus fondos, nunca actúa sin ti.',
        '',
        `Embarca: ${LOGIN_URL}`,
        `Todos nuestros canales: ${LINKTREE_URL}`,
        '',
        'Nos vemos a bordo,',
        'La tripulación de Astryum',
        '',
        'Recibes este correo porque tu solicitud de acceso anticipado en astryum.xyz fue aprobada. Solo usamos tu email para el embarque. Para darte de baja, responde a este correo.',
      ].join('\n'),
    };
  }
  return {
    subject: 'Your seat is ready — boarding is open at Astryum',
    title: 'Boarding open — Astryum',
    preheader: 'Your beta access is approved. Create your account with this email and come aboard.',
    badge: 'ACCESS APPROVED &middot; BOARDING PASS',
    h1: 'Your seat is ready.',
    p1: `Your wave has opened. Create your account with <strong style="color:#F5F2E9;">this exact email</strong> (<span style="color:#E8C25A;">${email}</span>) &mdash; the door recognises this address and no other.`,
    p2: "Inside is what you signed up for: <strong style=\"color:#F5F2E9;\">one command center for your capital</strong> &mdash; see every asset you hold, understand its risk, and put it to work. It's a beta: we open in waves, under prudent caps, and your feedback genuinely shapes the ship.",
    p3: 'And the promise that never changes: <strong style="color:#E8C25A;">you always sign.</strong> Astryum never holds your keys, never custodies your funds, never acts without you.',
    cta: 'Board now&nbsp;&nbsp;&rarr;',
    secondaryHtml: `Build-in-public updates on <a href="${LINKTREE_URL}" style="color:#E8C25A;text-decoration:none;">Linktree&nbsp;&#8599;</a>`,
    signOff1: 'See you on board,',
    signOff2: 'The Astryum crew',
    footer1Html: `You're receiving this because your early-access request at <a href="${SITE_URL}" style="color:#8A8471;">astryum.xyz</a> was approved.`,
    footer2: 'We only use your email for boarding — nothing else.',
    footer3Html: `<a href="${UNSUB_MAILTO}" style="color:#8A8471;">Unsubscribe</a> and we'll lose your signal — no questions asked.`,
    text: [
      'Your seat is ready.',
      '',
      `Your wave has opened. Create your account with this exact email (${email}) — the door recognises this address and no other.`,
      '',
      "Inside is what you signed up for: one command center for your capital — see every asset you hold, understand its risk, and put it to work. It's a beta: we open in waves, under prudent caps, and your feedback genuinely shapes the ship.",
      '',
      'And the promise that never changes: you always sign. Astryum never holds your keys, never custodies your funds, never acts without you.',
      '',
      `Board now: ${LOGIN_URL}`,
      `All our channels: ${LINKTREE_URL}`,
      '',
      'See you on board,',
      'The Astryum crew',
      '',
      "You're receiving this because your early-access request at astryum.xyz was approved. We only use your email for boarding. To unsubscribe, just reply to this email.",
    ].join('\n'),
  };
}

export function renderBetaInvite(p: BetaInviteParams): RenderedEmail {
  const c = copyFor(p.lang, p.email);

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
                <td align="right" style="font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#6B6656;">DOOR&nbsp;&nbsp;&middot;&nbsp;&nbsp;BOARDING</td>
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
                  <a href="${LOGIN_URL}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#141310;text-decoration:none;border-radius:10px;">${c.cta}</a>
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
                  <td style="padding:16px 0 0;font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:2px;color:#6B6656;"><span style="color:#5BD68A;">&#9679;</span>&nbsp;GATE&nbsp;<span style="color:#E8C25A;">OPEN</span></td>
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
