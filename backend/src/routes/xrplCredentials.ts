/**
 * /api/xrpl-credentials — la bandeja de credenciales XLS-70 de una cuenta XRPL.
 *
 * Astryum **no emite**. Este router hace exactamente dos cosas:
 *   1. LEER del ledger las credenciales que sostiene una cuenta (público).
 *   2. COMPONER, sin firmar, el `CredentialAccept` que el SUJETO firma en su
 *      Xaman — esa firma ES el consentimiento (invariante #1).
 *
 * No hay endpoint de emisión aquí a propósito: el título lo concede un tercero
 * (decisión del fundador 24-ago y 27-ago). Si algún día hiciera falta componer
 * el `CredentialCreate` de un emisor que use nuestra UI, vive en la ceremonia
 * institucional, no aquí — para que esta superficie no pueda confundirse con
 * «Astryum verifica».
 *
 * Una credencial sin `Accepted` existe pero NO vale: mientras no se acepta, la
 * reserva la sostiene el emisor y ninguna puerta del ledger la reconoce. Por eso
 * hace falta la bandeja: aceptar es del sujeto, y hasta hoy no tenía dónde.
 */

import { Router, type Request, type Response } from 'express';
import { readAccountCredentials } from '../services/XrplCredentialVerifier';
import { composeCredentialAccept } from '../services/XrplCredentialCeremony';
import { composeAuthorizeCredentials, composeEnableDepositAuth, expandGateSets } from '../services/XrplAnchorGateService';
import { managerGateConfig, checkManagerCredential, verificationPartners as configuredVerificationPartners } from '../services/ManagerCredentialGate';
import { composeAccountSetDomain, runNotaryCheck, NotaryVerifierError } from '../services/ManagerNotaryVerifier';
import { withSourceTag, attributionForSigner } from '../config/xrplSourceTag';
import { createSlidingWindowLimiter } from '../middleware/slidingWindowRateLimit';
import { requireAdmin } from './adminPanel';

const router = Router();

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function guarded(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[xrpl-credentials] handler failed:', (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'CREDENTIALS_FAILED', detail: (err as Error).message });
    });
  };
}

/**
 * GET /?account=r… — lo que el ledger dice de esa cuenta. Sin allowlist, sin
 * juicio: cada credencial con su emisor, su tipo, su caducidad y su estado
 * (`valid` · `pending-acceptance` · `expiring-soon` · `expired` · `unreadable`).
 * Si no se puede leer, se dice — «no pude leer» no es «no tiene».
 */
router.get('/', guarded(async (req, res) => {
  const account = String(req.query.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) {
    return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'account debe ser una dirección XRPL (r…)' });
  }
  try {
    const summary = await readAccountCredentials(account);
    res.json({
      ...summary,
      pendingAcceptance: summary.credentials.filter((c) => c.state === 'pending-acceptance').length,
      note: 'Astryum no emite credenciales ni las acepta por ti: solo lee el ledger y compone la aceptación, que firmas tú.',
    });
  } catch (e) {
    res.status(502).json({ error: 'CREDENTIALS_READ_FAILED', detail: (e as Error).message });
  }
}));

/**
 * POST /accept/prepare { issuer, subject, credentialType? } — el
 * `CredentialAccept` SIN FIRMAR. Lo firma el sujeto en Xaman; Astryum no firma
 * y no puede aceptar por nadie (el ledger exige que `Account` sea el sujeto).
 */
router.post('/accept/prepare', guarded((req, res) => {
  const issuer = String(req.body?.issuer ?? '').trim();
  const subject = String(req.body?.subject ?? '').trim();
  const credentialType = req.body?.credentialType ? String(req.body.credentialType) : undefined;
  if (!XRPL_ADDRESS_RE.test(issuer)) return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'issuer debe ser una dirección XRPL (r…)' });
  if (!XRPL_ADDRESS_RE.test(subject)) return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'subject debe ser tu dirección XRPL (r…)' });
  try {
    // The SUBJECT signs it in Xaman: the project tag, attributed to that signer.
    const txjson = withSourceTag(composeCredentialAccept({ issuer, subject, credentialType }), attributionForSigner(subject));
    res.json({
      txjson,
      signer: 'subject',
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Aceptar la credencial en tu cuenta XRPL',
        lines: [
          `La emitió ${issuer}, no Astryum. Aceptarla es TU firma: sin ella la credencial existe pero no vale.`,
          'Al aceptarla, la reserva pasa a tu cuenta y las puertas del ledger que exijan este título te reconocerán.',
          'Queda pública y para siempre: cualquiera podrá ver que esta cuenta lleva este tipo de credencial de este emisor.',
        ],
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    res.status(code ? 400 : 500).json({ error: code ?? 'ACCEPT_PREPARE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * GET /manager-status?account=r… — ¿esta cuenta puede gobernar un pote agrupado?
 *
 * Lo que la UI del gestor lee para saber si su título le abre la puerta ANTES de
 * intentar nada. Enseña el tipo exigido y los emisores acreditados (para que
 * sepa a quién pedirla), nunca un juicio de Astryum. Con la puerta apagada,
 * `gate: 'disabled'` y todo el mundo pasa.
 */
router.get('/manager-status', guarded(async (req, res) => {
  const account = String(req.query.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) {
    return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'account debe ser una r-address (r…)' });
  }
  const cfg = managerGateConfig();
  if (!cfg.enabled) {
    return void res.json({ account, gate: 'disabled', ok: true, credentialTypes: cfg.credentialTypes });
  }
  const [{ partnerGateConfig }, { verificationPartners }] = [
    await import('../services/PartnerCredentialVerifier'),
    await import('../services/ManagerCredentialGate'),
  ];
  const partner = partnerGateConfig();
  const verdict = await checkManagerCredential(account);
  res.json({
    account,
    gate: 'enabled',
    ok: verdict.ok,
    source: verdict.ok ? verdict.source : undefined,
    credentialTypes: cfg.credentialTypes,
    acceptedIssuers: [...cfg.issuers],
    // La vía off-ledger (VC del partner presentada con la petición): la UI puede
    // ofrecerla aparte de la XLS-70 on-ledger.
    offLedgerPartners: partner.keys.map((k) => k.iss),
    // A dónde se manda al gestor a acreditarse (flujo alojado del partner). Astryum
    // no recoge documentos: solo abre el enlace con la r-address.
    verificationPartners: verificationPartners(),
    // ¿Está el robot emisor encendido? La UI enseña la emisión automática solo
    // cuando hay quien firme (X3: pegar la atestación → verificar → emitir).
    notaryIssuer: (await import('../services/ManagerNotaryIssuer')).notaryIssuerConfig().enabled,
    reason: verdict.ok === false ? verdict.code : undefined,
  });
}));

/**
 * POST /anchor/deposit-auth/prepare { anchor } — el paso 1 de la puerta: el
 * DUEÑO DEL ANCLA enciende `DepositAuth` (rechaza a extraños). Lo firma él, no
 * Astryum. Compositor puro (`XrplAnchorGateService`).
 */
router.post('/anchor/deposit-auth/prepare', guarded((req, res) => {
  const anchor = String(req.body?.anchor ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(anchor)) return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'anchor debe ser una r-address' });
  try {
    // The anchor OWNER signs. When the anchor is one Astryum operates, that is
    // our own account: operational, no project tag.
    const txjson = withSourceTag(composeEnableDepositAuth(anchor), attributionForSigner(anchor));
    res.json({
      txjson,
      signer: 'anchor-owner',
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Encender DepositAuth en el ancla',
        lines: [
          'Desde ahora el ancla rechaza cualquier pago que no venga de una cuenta preautorizada — el paso 2 preautoriza por credencial.',
          'Lo firma el dueño del ancla; Astryum no firma.',
        ],
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    res.status(code ? 400 : 500).json({ error: code ?? 'ANCHOR_PREPARE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * POST /anchor/authorize-credentials/prepare { anchor, credentials?, mode? } —
 * el paso 2: el ancla preautoriza por CREDENCIAL. Por defecto autoriza el título
 * de gestor configurado (tipo + cada emisor acreditado): a partir de aquí, una
 * orden de un gestor SIN ese título la tumba el consenso con `tecNO_PERMISSION`.
 * `mode: 'unauthorize'` la retira. Lo firma el dueño del ancla.
 */
router.post('/anchor/authorize-credentials/prepare', guarded((req, res) => {
  const anchor = String(req.body?.anchor ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(anchor)) return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'anchor debe ser una r-address' });
  const mode = req.body?.mode === 'unauthorize' ? 'unauthorize' : 'authorize';
  try {
    // Sin lista explícita, se autoriza el título de gestor. Un DepositPreauth
    // es UN conjunto que el firmante tiene que sostener ENTERO (regla de
    // conjunto exacto del ledger), así que los grupos OR de la config
    // (`AIFM|CASP,KYC|KYB`) se expanden a un objeto por combinación — antes se
    // componía un solo objeto con todos los pares, que exigía sostener los
    // cuatro títulos a la vez: lo contrario de la puerta del servidor.
    const explicit = req.body?.credentials as Array<{ issuer: string; credentialType: string }> | undefined;
    let sets: Array<Array<{ issuer: string; credentialType: string }>>;
    if (Array.isArray(explicit) && explicit.length > 0) {
      sets = [explicit];
    } else {
      const cfg = managerGateConfig();
      sets = expandGateSets(cfg.credentialTypes, cfg.issuers).map((set) =>
        set.map((c) => ({ issuer: c.issuer, credentialType: c.credentialTypeHex })),
      );
      if (sets.length === 0) {
        return void res.status(503).json({
          error: 'NO_ISSUERS_CONFIGURED',
          detail: 'No hay emisores de credencial de gestor configurados (MANAGER_CREDENTIAL_ISSUERS) ni lista explícita.',
        });
      }
    }
    // Same signer as deposit-auth: the anchor owner, operational when it is ours.
    const txjsons = sets.map((set) => withSourceTag(composeAuthorizeCredentials(anchor, set, mode), attributionForSigner(anchor)));
    res.json({
      /** El primero, por compatibilidad; `txjsons` lleva uno por conjunto — se firman TODOS. */
      txjson: txjsons[0],
      txjsons,
      signer: 'anchor-owner',
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: mode === 'authorize' ? 'Preautorizar por credencial de gestor' : 'Retirar la preautorización',
        lines: [
          mode === 'authorize'
            ? 'El ancla dejará pasar solo a quien sostenga una de estas credenciales, emitida por un tercero regulado. Astryum no la emite ni la verifica.'
            : 'El ancla deja de reconocer estas credenciales — el acceso se cierra en el acto.',
          'Lo firma el dueño del ancla; Astryum no firma.',
        ],
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    res.status(code ? 400 : 500).json({ error: code ?? 'ANCHOR_PREPARE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * GET /verification-partners — a qué certificadora(s) se manda al gestor
 * (`MANAGER_VERIFICATION_PARTNERS`, runtime). Sin cuenta, sin juicio: la MISMA
 * fuente para la card de certificación y para la puerta del título — elegir o
 * cambiar el partner es una variable de Railway, jamás un rebuild de Vercel.
 */
router.get('/verification-partners', guarded((_req, res) => {
  res.json({ partners: configuredVerificationPartners() });
}));

/**
 * GET /manager-issuers — los emisores acreditados que Astryum ACEPTA
 * (MANAGER_CREDENTIAL_ISSUERS), para que la ceremonia ofrezca un DESPLEGABLE en
 * vez de pedir teclear la r-address a mano: un typo mete un emisor no
 * acreditado y la credencial que emita NO cruzaría el gate. Astryum solo ELIGE
 * a quién acepta — sin ranking, es un filtro técnico como el registro de venues.
 */
router.get('/manager-issuers', guarded((_req, res) => {
  const cfg = managerGateConfig();
  res.json({ issuers: [...cfg.issuers], credentialTypes: cfg.credentialTypes });
}));

/**
 * GET /notary-check?account=r… — los checks reproducibles del bot-notario
 * (spec §7-§8): dominio declarado, binding toml en las dos direcciones, y
 * entrada en la lista del registro. PÚBLICO a propósito: cualquiera puede
 * re-comprobar lo que el emisor atestó. Un check fallido no es un juicio — el
 * veredicto lleva cada motivo, y «no pude leer» se dice como tal.
 */
router.get('/notary-check', guarded(async (req, res) => {
  const account = String(req.query.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) {
    return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'account debe ser una r-address (r…)' });
  }
  try {
    res.json(await runNotaryCheck(account));
  } catch (e) {
    if (e instanceof NotaryVerifierError) return void res.status(400).json({ error: e.code, detail: e.message });
    res.status(502).json({ error: 'NOTARY_CHECK_FAILED', detail: (e as Error).message });
  }
}));

/**
 * POST /domain/prepare { account, domain } — el `AccountSet{Domain}` SIN
 * FIRMAR: la mitad del binding que firma el GESTOR en su Xaman. La otra mitad
 * (servir el xrp-ledger.toml) la hace su web; Astryum no toca ninguna.
 */
router.post('/domain/prepare', guarded((req, res) => {
  const account = String(req.body?.account ?? '').trim();
  const domain = String(req.body?.domain ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void res.status(400).json({ error: 'INVALID_REQUEST', detail: 'account debe ser una r-address (r…)' });
  try {
    // The MANAGER signs it in Xaman: the project tag, attributed to that signer.
    const txjson = withSourceTag(composeAccountSetDomain(account, domain), attributionForSigner(account));
    res.json({
      txjson,
      signer: 'subject',
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Declarar tu dominio en la cuenta XRPL',
        lines: [
          'Es la mitad del binding: tu cuenta declara el dominio de tu firma. La otra mitad es que ESA web sirva /.well-known/xrp-ledger.toml con esta r-address.',
          'Solo el vínculo en las dos direcciones cuenta — cualquiera puede comprobarlo, sin confiar en nadie.',
          'Lo firmas tú; Astryum no firma.',
        ],
      },
    });
  } catch (e) {
    if (e instanceof NotaryVerifierError) return void res.status(400).json({ error: e.code, detail: e.message });
    res.status(500).json({ error: 'DOMAIN_PREPARE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * POST /notary/issue-kyc { subject, attestation, evmSignature } — el ROBOT:
 * verifica la atestación de Coinbase en Base (EAS) + el binding EVM firmado, y
 * EMITE la XLS-70 `KYC` al sujeto con `URI` → la atestación. La firma es de la
 * cuenta emisora de SERVICIO (X3); la aceptación sigue siendo del gestor.
 */
router.post('/notary/issue-kyc', guarded(async (req, res) => {
  const subject = String(req.body?.subject ?? '').trim();
  const attestation = String(req.body?.attestation ?? '').trim();
  const evmSignature = String(req.body?.evmSignature ?? '').trim();
  try {
    const { issueKycFromCoinbase, NotaryIssuerError } = await import('../services/ManagerNotaryIssuer');
    try {
      res.json(await issueKycFromCoinbase({ subject, attestation, evmSignature }));
    } catch (e) {
      if (e instanceof NotaryIssuerError) {
        const status = e.code === 'ISSUER_DISABLED' ? 503 : e.code === 'SUBMIT_FAILED' || e.code === 'ATTESTATION_READ_FAILED' ? 502 : 409;
        return void res.status(status).json({ error: e.code, detail: e.message });
      }
      throw e;
    }
  } catch (e) {
    res.status(500).json({ error: 'NOTARY_ISSUE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * GET /notary/discover?subject=r…&evmAddress=0x… — encuentra la atestación de
 * Coinbase de ESA wallet sin que el gestor pegue nada (9-sep). Solo lectura:
 * indexador de EAS como pista, la cadena como verdad. Devuelve el uid, la URL
 * canónica y el RETO ya compuesto para que la wallet lo firme — la emisión
 * sigue siendo POST /notary/renew con esa firma, como siempre.
 */
router.get('/notary/discover', guarded(async (req, res) => {
  const subject = String(req.query.subject ?? '').trim();
  const evmAddress = String(req.query.evmAddress ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(subject)) return void res.status(400).json({ error: 'INVALID_SUBJECT', detail: 'subject debe ser una r-address' });
  try {
    const { discoverCoinbaseAttestation, bindingMessage, NotaryIssuerError } = await import('../services/ManagerNotaryIssuer');
    try {
      const found = await discoverCoinbaseAttestation({ recipient: evmAddress });
      res.json({ subject, evmAddress: found.recipient, uid: found.uid, url: found.url, attestedAtISO: found.time ? new Date(found.time * 1000).toISOString() : null, challenge: bindingMessage(subject, found.uid) });
    } catch (e) {
      if (e instanceof NotaryIssuerError) {
        const status = e.code === 'ATTESTATION_NOT_FOUND' ? 404 : e.code === 'ATTESTATION_READ_FAILED' ? 502 : 400;
        return void res.status(status).json({ error: e.code, detail: e.message });
      }
      throw e;
    }
  } catch (e) {
    res.status(500).json({ error: 'NOTARY_DISCOVER_FAILED', detail: (e as Error).message });
  }
}));

/**
 * POST /notary/issue-aifm { subject } — el robot re-ejecuta los checks del
 * notario (Domain + toml + registro) y emite `AIFM` SOLO si todos pasan. El
 * veredicto fallido viaja entero: motivos, jamás juicios.
 */
router.post('/notary/issue-aifm', guarded(async (req, res) => {
  const subject = String(req.body?.subject ?? '').trim();
  try {
    const { issueAifmFromChecks, NotaryIssuerError } = await import('../services/ManagerNotaryIssuer');
    try {
      res.json(await issueAifmFromChecks({ subject }));
    } catch (e) {
      if (e instanceof NotaryIssuerError) {
        const status = e.code === 'ISSUER_DISABLED' ? 503 : e.code === 'SUBMIT_FAILED' || e.code === 'ATTESTATION_READ_FAILED' ? 502 : 409;
        return void res.status(status).json({ error: e.code, detail: e.message });
      }
      throw e;
    }
  } catch (e) {
    res.status(500).json({ error: 'NOTARY_ISSUE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * Tope del rodaje para la licencia de DEMO. Cada `CredentialCreate` sin aceptar
 * bloquea reserva en la cuenta del emisor (XLS-70: el objeto es del emisor hasta
 * que el sujeto lo acepta), así que un bucle contra esta ruta podría vaciarle la
 * cuenta y dejar sin notario a todos los demás. Por cuenta: una ventana
 * deslizante (AIFM + KYB + CASP + algún reintento caben de sobra). Global: un
 * tope por día UTC, `MANAGER_DEMO_AIFM_DAILY_MAX` (60 si no se define) — sube
 * si un día de jurado lo pide, y acota lo que el emisor puede llegar a bloquear.
 * En proceso, como el resto de limitadores (`auth.ts`): cada instancia cuenta
 * la suya.
 */
const DEMO_LICENSE_PER_ACCOUNT_MAX = 6;
const DEMO_LICENSE_WINDOW_MS = 60 * 60_000;
function demoLicenseDailyMax(): number {
  const n = Number((process.env.MANAGER_DEMO_AIFM_DAILY_MAX ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}
/** Exportado solo para que el test pueda vaciarlo entre casos (`_reset`). */
export const demoLicenseLimiter = createSlidingWindowLimiter({
  perKeyMax: DEMO_LICENSE_PER_ACCOUNT_MAX,
  windowMs: DEMO_LICENSE_WINDOW_MS,
  dailyMax: demoLicenseDailyMax(),
});

/**
 * POST /notary/issue-aifm-demo { subject, type?, uri? } — SOLO RODAJE, SOLO
 * FUNDADORES. El robot firma la LICENCIA (`type`: 'AIFM' por defecto, 'CASP' o
 * 'KYB' — lista cerrada, la KYC jamás) en el servidor SALTÁNDOSE los checks de
 * Domain (excepción consciente al guardarraíl, ver
 * ManagerNotaryIssuer.issueAifmDemo). La aceptación sigue siendo del sujeto en su
 * Xaman. Jamás es una atestación regulatoria real: el link viaja como URI y quien
 * confíe lo comprueba.
 *
 * QUIÉN PUEDE PEDIRLA (fundador 2026-09-20: «quitemos los botones de issue
 * credential demo para que la gente no pueda probarlo así como así … el producto
 * se podrá probar solo si tienes las credenciales»; y, al aprobar el cierre: «hay
 * que reubicar los issuing de credentials demo en la consola admin»).
 *
 * Del 15-sep al 20-sep esta puerta estuvo abierta a CUALQUIER cuenta con sesión
 * para que el jurado pudiera recorrer la mesa entera. Tenía dos problemas que el
 * tope por cuenta no resolvía: (1) este router NO va tras el interruptor del
 * módulo (`INSTITUTIONAL_POTES_ENABLED`), así que en producción lo único entre un
 * usuario cualquiera y una CASP firmada en mainnet era UNA variable de Railway;
 * (2) una credencial que cualquiera se emite a sí mismo deja de decir nada, y es
 * justo lo que abre la jaula. Vuelve la puerta de los fundadores, entera
 * (`requireAdmin`: sesión del panel, llave, o email de la allowlist verificado).
 *
 * Lo que queda en pie, y por qué:
 *   1. `requireAdmin` — 404 si el panel no está configurado, 403 `NOT_AN_ADMIN`
 *      para una cuenta corriente. La interfaz que la pedía desde el producto se
 *      retiró; vive en /app/admin.
 *   2. el flag `MANAGER_DEMO_AIFM_ENABLED` (kill-switch; lo comprueba el
 *      servicio) — en un entorno con el flag apagado nada de esto existe;
 *   3. el tope por cuenta y por día de arriba: protege la reserva del emisor
 *      también de un fundador con prisa.
 * El sujeto YA NO tiene que ser una wallet de la cuenta que pide: desde la
 * consola, el fundador emite para la cuenta que va a rodar (la suya, la del
 * socio, la de un jurado). Esa regla existía para que un extraño no gastara
 * reserva apuntando a r-addresses ajenas; con la puerta de admin, sobra.
 */
router.post('/notary/issue-aifm-demo', requireAdmin, guarded(async (req, res) => {
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'NO_SESSION', detail: 'Sign in to request the demo licence.' });

  const subject = String(req.body?.subject ?? '').trim();
  const credentialType = String(req.body?.type ?? 'AIFM').trim();
  const uri = typeof req.body?.uri === 'string' ? req.body.uri : undefined;
  if (!XRPL_ADDRESS_RE.test(subject)) return void res.status(400).json({ error: 'INVALID_SUBJECT', detail: 'subject debe ser una r-address' });

  const limit = demoLicenseLimiter.check(userId, Date.now());
  if (limit.limited) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return void res.status(429).json({
      error: 'RATE_LIMITED',
      detail: 'Demo licences are capped per account and per day so the notary cannot be drained. Nothing was issued. Try again later.',
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const { issueAifmDemo, NotaryIssuerError } = await import('../services/ManagerNotaryIssuer');
    try {
      res.json(await issueAifmDemo({ subject, credentialType, uri }));
    } catch (e) {
      if (e instanceof NotaryIssuerError) {
        const status = e.code === 'ISSUER_DISABLED' ? 503 : e.code === 'SUBMIT_FAILED' ? 502 : 409;
        return void res.status(status).json({ error: e.code, detail: e.message });
      }
      throw e;
    }
  } catch (e) {
    res.status(500).json({ error: 'NOTARY_ISSUE_FAILED', detail: (e as Error).message });
  }
}));

/**
 * POST /notary/renew { subject, attestation?, evmSignature? } — UN gesto, las
 * DOS credenciales: el robot re-verifica y (re)emite KYC (si viene la
 * atestación + binding) y AIFM (si los checks pasan), barriendo las caducadas.
 * Cada pata responde por separado — una puede emitir y la otra negarse con su
 * motivo. `ALREADY_VALID` cuenta como «nada que hacer», no como fallo.
 */
router.post('/notary/renew', guarded(async (req, res) => {
  const subject = String(req.body?.subject ?? '').trim();
  const attestation = String(req.body?.attestation ?? '').trim();
  const evmSignature = String(req.body?.evmSignature ?? '').trim();
  const { issueKycFromCoinbase, issueAifmFromChecks, NotaryIssuerError } = await import('../services/ManagerNotaryIssuer');

  type Leg =
    | { status: 'issued'; txHash: string; result: string }
    | { status: 'already-valid'; detail: string }
    | { status: 'refused'; code: string; detail: string }
    | { status: 'skipped'; detail: string };

  async function leg(run: () => Promise<{ txHash: string; result: string }>): Promise<Leg> {
    try {
      const r = await run();
      return { status: 'issued', txHash: r.txHash, result: r.result };
    } catch (e) {
      if (e instanceof NotaryIssuerError) {
        if (e.code === 'ALREADY_VALID') return { status: 'already-valid', detail: e.message };
        return { status: 'refused', code: e.code, detail: e.message };
      }
      return { status: 'refused', code: 'NOTARY_ISSUE_FAILED', detail: (e as Error).message };
    }
  }

  const kyc: Leg = attestation && evmSignature
    ? await leg(() => issueKycFromCoinbase({ subject, attestation, evmSignature }))
    : { status: 'skipped', detail: 'sin atestación/binding no hay pata KYC' };
  const aifm: Leg = await leg(() => issueAifmFromChecks({ subject }));

  res.json({ subject, kyc, aifm });
}));

export default router;
