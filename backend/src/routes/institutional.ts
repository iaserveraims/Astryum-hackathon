/**
 * /api/institutional — la superficie HTTP del pote institucional (AstryumVault).
 *
 * Prepare-only de punta a punta: cada POST devuelve calls EVM sin firmar (o
 * txjson XRPL sin firmar en la ceremonia de credencial) + disclosure. Astryum
 * jamás firma, jamás custodia, jamás emite credenciales — compone.
 *
 * Gating (invariantes #10 y #5):
 *  - Los prepare van tras `INSTITUTIONAL_POTES_ENABLED` (ship OFF, 503).
 *  - Los prepare que MUEVEN CAPITAL van además tras el geofence de jurisdicción:
 *    `capitalGate()` = flag + `isDefiExecutionAllowed`, 451 GEOFENCE_BLOCKED fuera
 *    de región. Las ceremonias de identidad XRPL (credencial, ancla, dominio) NO
 *    lo llevan: no son ejecución DeFi y bloquearlas por región no protege nada.
 *  - Los prepare que ABREN POSICIÓN llevan además el cap off-chain compartido
 *    (`config/demoCap`) — protección mientras el contrato no está auditado.
 *  - Las lecturas (pote-state, credential-gate) quedan abiertas: es estado
 *    público de la cadena, igual que el criterio de xrpl-defi.
 *
 * La puerta de credencial (escena 2): un pote listado en
 * `POTE_CREDENTIAL_GATED` exige que la RAÍZ XRPL del depositante sostenga una
 * credencial válida de un emisor de `XRPL_CREDENTIAL_ISSUERS` — fail-closed
 * por las dos vías (sin allowlist configurada, nada desbloquea).
 *
 * Cada pre-flight espeja un revert real de AstryumVault: aquí no se invita a
 * firmar transacciones condenadas (patrón ORDER_WOULD_REVERT / CLAIM_NOT_READY).
 */

import { handoffPayloadExpiryMin, forwardedProofRefusalBody, forwardedProofRefusalStatus } from '../services/flare/handoffAuthority';
import { Router, type Request, type Response } from 'express';
import { requireAdmin } from './adminPanel';
import { ethers } from 'ethers';
import { swr } from '../services/flare/swrCache';
import { flareReadProvider } from '../services/flare/flareProvider';
import {
  checkClaimRedeem,
  checkPoteDirectTo,
  checkRequestRedeem,
  readPoteState,
  type AstryumPoteState,
} from '../services/flare/AstryumPoteStateService';
import { formatBaseUnits } from '../services/flare/LegacyVaultStateService';
import {
  composeCredentialAccept,
  composeCredentialCreate,
  CredentialCeremonyError,
} from '../services/XrplCredentialCeremony';
import { withSourceTag, attributionForSigner } from '../config/xrplSourceTag';
import { jurisdictionService } from '../services/JurisdictionService';
import { safeErrorDetail } from '../utils/safeError';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import {
  pinOrderPayment,
  readOrderSequencePin,
  type OrderSequencePin,
} from '../connectors/protocols/xrpl/XrplOrderSequencePin';
import { COUNCIL_ORDER_EXIT_ACTIONS } from '../services/councilExitToken';

/**
 * it. 23 (it. 22 §1.2) — THE SIGNING WINDOW TRAVELS WITH THE 0xFE.
 *
 * The seat's life is measured from the Xaman payload's expiry, and the client
 * used to invent that number (a hardcoded 5). One deployment changing the
 * server's value would then either free a seat while its payload was still
 * signable — the twin — or hold it long after. Same field and same shape as
 * `flareDemo`'s `zeroFeSigningWindow`, so every 0xFE answers alike.
 */
function zeroFeSigningWindow(h: {
  payloadExpiryMin?: number | null;
  payloadExpiresAt?: string | null;
  signerListRead?: string | null;
}): { payloadExpiryMin: number; payloadExpiresAt?: string; signerListRead?: 'single' | 'quorum' | 'unknown' } {
  const min = typeof h?.payloadExpiryMin === 'number' && h.payloadExpiryMin > 0 ? h.payloadExpiryMin : handoffPayloadExpiryMin();
  // it. 31 (§5): whether that window is a READ or a default travels beside it.
  // The browser only skips its own SignerList read on `'single'` — a window
  // alone never says why it is short.
  const read = h?.signerListRead;
  return {
    payloadExpiryMin: min,
    ...(typeof h?.payloadExpiresAt === 'string' && h.payloadExpiresAt ? { payloadExpiresAt: h.payloadExpiresAt } : {}),
    ...(read === 'single' || read === 'quorum' || read === 'unknown' ? { signerListRead: read } : {}),
  };
}

const router = Router();

// ── plumbing ─────────────────────────────────────────────────────────────────

/**
 * Express 4 no captura un throw dentro de un handler async: la petición se
 * queda COLGADA para siempre (lo cazó el test del invariante de aprobaciones
 * con un checksum EIP-55 inválido — spinner eterno en vez de un 400). Todo
 * handler de este router pasa por aquí: un throw es un 500 honesto, jamás un
 * silencio.
 */
type Handler = (req: Request, res: Response) => void | Promise<void>;
function guarded(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: 'INTERNAL', detail: safeErrorDetail(e) });
    }
  };
}

/**
 * Una dirección puede pasar el regex y aún así reventar al codificar (mezcla
 * de mayúsculas con checksum EIP-55 inválido). getAddress la normaliza o la
 * rechaza AQUÍ, con un 400 — nunca dentro del encode. DELIBERADAMENTE estricto:
 * minúsculas puras = «sin checksum», se aceptan; mixto con checksum malo = typo
 * probable en un destino de DINERO, se rechaza (no se blanquea con toLowerCase).
 */
function parseEvmAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !EVM_ADDRESS_RE.test(value.trim())) return null;
  try {
    return ethers.getAddress(value.trim());
  } catch {
    return null;
  }
}

const FLARE_CHAIN_ID = 14;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const BASE_AMOUNT_RE = /^[0-9]{1,30}$/;

const POTE_IFACE = new ethers.Interface([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function requestRedeem(uint256 shares, address receiver) returns (uint256)',
  'function claimRedeem(uint256 ticketId, (uint256 venueId, uint256 period)[] venueClaims)',
  'function directTo(uint256 venueId, uint256 amount, bytes32 ref)',
  'function recall(uint256 venueId, uint256 amount, bytes32 ref)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

/**
 * ⛔ INERTE desde 2026-08-24 — devuelve null siempre. NO se borra (regla del
 * repo: el código construido se deja inerte, no se elimina), pero NO se cobra.
 *
 * POR QUÉ. Esta fee muerde al CLIENTE, en participaciones, o sea sobre
 * principal + yield. El canon lo prohíbe sin matices
 * (`Institutional_Infraestructura_Final_2026-08-18`):
 *
 *   «Astryum cobra licencia al operador, jamás un corte del rendimiento del
 *    cliente. Cobrar de ahí nos convertiría de proveedor de software en
 *    prestador de servicio financiero.»
 *
 * …y lista «fee de Astryum = 0» entre los inmutables del pote. El fundador fijó
 * el 24-ago el modelo bueno (doc Producto A §15.1): el ingreso viene SIEMPRE del
 * lado del operador — corte de la fee del manager, fee de integrador del venue
 * (p. ej. Kinetic partner), y pago por creación de pote. El test es uno solo:
 * ¿el cliente recibe menos porque Astryum esté en medio? Aquí la respuesta era
 * sí, así que la puerta se cierra en el único sitio que la enciende.
 *
 * Con null, el fee-leg de más abajo produce feeShares=0 / feeCalls=[] /
 * feeInfo=null: cero efecto, cero rama muerta, y el redeem del user queda
 * intacto. Las envs `INSTITUTIONAL_FEE_COLLECTOR` /
 * `INSTITUTIONAL_REDEEM_FEE_BPS` ya no hacen nada — a propósito.
 *
 * Si algún día se cobra on-chain, tiene que ser DENTRO del cap del manager
 * (`PAYEE_BPS_CAP = 2000`) y sin subir el total, o vuelve a ser un corte al
 * cliente con otro nombre.
 */
function redeemServiceFee(): { bps: bigint; collector: string } | null {
  return null;

  // ── Cuerpo original, conservado inerte ────────────────────────────────────
  // const collector = parseEvmAddress(process.env.INSTITUTIONAL_FEE_COLLECTOR);
  // const bpsRaw = (process.env.INSTITUTIONAL_REDEEM_FEE_BPS ?? '').trim();
  // if (!collector || !/^[0-9]{1,4}$/.test(bpsRaw)) return null;
  // const bps = BigInt(bpsRaw);
  // if (bps <= 0n || bps > 500n) return null;
  // return { bps, collector };
}
const ERC20_IFACE = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);

interface UnsignedCall {
  to: string;
  data: string;
  value: string;
  chainId: number;
  label: string;
}

// El nodo público de Flare, CABLEADO. Es el fallback conocido-bueno: si el RPC
// configurado (FLARE_RPC_URL/ASTRYUM_CATALOG_RPC_URL) falla desde Railway —dRPC
// rechaza IPs de datacenter, o un 429 duro— las lecturas caen aquí antes de
// rendirse. NO se usa `rpcUrl()` como fallback: podría SER el endpoint roto.
const PUBLIC_FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';

function rpcUrl(): string {
  return process.env.FLARE_RPC_URL || PUBLIC_FLARE_RPC;
}

/**
 * LAS LECTURAS SE SIRVEN DE CACHÉ (2026-09-11, `swrCache`): fresco se sirve,
 * pasado se sirve YA y se recalcula por detrás, y N lectores concurrentes son
 * UNA lectura de cadena. Ventanas cortas a propósito — la UI que espera un
 * cambio (el creador esperando su pote, la consola tras una orden) relee cada
 * pocos segundos y lo ve en la siguiente vuelta; lo que NO vuelve a pasar es
 * que el shell, la estantería y la mesa se pisen contra el RPC público.
 */
const POTE_STATE_SWR = { freshMs: 10_000, staleMs: 10 * 60_000 };
const CAGE_OF_SWR = { freshMs: 10_000, staleMs: 10 * 60_000 };
const CATALOG_SWR = { freshMs: 45_000, staleMs: 30 * 60_000 };

/** Invariante #10: los prepare no existen sin el flag. */
function poteGate(): { status: number; body: { error: string; detail: string } } | null {
  if (process.env.INSTITUTIONAL_POTES_ENABLED !== 'true') {
    return {
      status: 503,
      body: {
        error: 'INSTITUTIONAL_DISABLED',
        detail: 'El módulo institucional está apagado (INSTITUTIONAL_POTES_ENABLED).',
      },
    };
  }
  return null;
}

function badRequest(res: Response, detail: string): void {
  res.status(400).json({ error: 'INVALID_REQUEST', detail });
}

async function loadState(res: Response, pote: string): Promise<AstryumPoteState | null> {
  if (!EVM_ADDRESS_RE.test(pote)) {
    badRequest(res, 'pote debe ser una dirección 0x válida');
    return null;
  }
  try {
    return await swr(`pote-state:${pote.toLowerCase()}`, POTE_STATE_SWR, () => readPoteStateAnyRpc(pote));
  } catch (e) {
    res.status(502).json({ error: 'POTE_READ_FAILED', detail: safeErrorDetail(e) });
    return null;
  }
}

/** El estado del pote por el RPC configurado y, si falla desde Railway, por el
 *  público CABLEADO antes de decir «no se pudo leer». Provider compartido. */
async function readPoteStateAnyRpc(pote: string): Promise<AstryumPoteState> {
  try {
    return await readPoteState({ rpcUrl: rpcUrl(), pote, provider: flareReadProvider(rpcUrl()) });
  } catch (e) {
    if (rpcUrl() === PUBLIC_FLARE_RPC) throw e;
    try {
      return await readPoteState({ rpcUrl: PUBLIC_FLARE_RPC, pote, provider: flareReadProvider(PUBLIC_FLARE_RPC) });
    } catch {
      throw e; // el público también falló: el error que cuenta es el primero
    }
  }
}

/** La región declarada por el cliente (mismo criterio que xrplDefi/ethMorpho). */
function regionOf(req: Request): string | null {
  const r = (req.body?.region ?? req.query?.region) as unknown;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

/**
 * Puerta de las rutas que MUEVEN CAPITAL: flag (#10) + geofence (#5).
 *
 * Hasta 2026-08-24 este router era el único carril DeFi sin geofence: sus
 * hermanos (xrplDefi, ethMorpho, flareDemo, walletTransfer, councilProposals)
 * ya llamaban a `isDefiExecutionAllowed` y este no. Un usuario no necesita
 * nuestra UI para llamar a un endpoint: le basta curl.
 *
 * NO se aplica a dos familias, y las dos por la misma razón — el geofence
 * existe para impedir que se ABRA exposición DeFi donde no toca, jamás para
 * atrapar capital que ya está dentro:
 *
 *  1. Las ceremonias de identidad XRPL (credencial, ancla, dominio): no son
 *     ejecución DeFi y bloquearlas por región no protege nada.
 *  2. Las salidas y las reducciones de exposición — redeem, claimRedeem,
 *     exit-xrp, creator-exit y recall. El propio contrato ya sienta el
 *     precedente: el `userGate` de AstryumVault es ENTRY-ONLY («la salida nunca
 *     lo llama»), y las redenciones pueden cruzar el suelo del colchón porque la
 *     salida del holder manda. Un 451 en el redeem convertiría un límite
 *     regulatorio en un secuestro de fondos ajenos.
 *
 * Si algún día hay que bloquear una salida, será una decisión de producto
 * explícita y documentada — nunca el efecto lateral de copiar una línea.
 */
function capitalGate(req: Request): { status: number; body: { error: string; detail: string } } | null {
  const flag = poteGate();
  if (flag) return flag;
  const geo = jurisdictionService.isDefiExecutionAllowed(regionOf(req));
  if (!geo.allowed) {
    return {
      status: 451,
      body: {
        error: 'GEOFENCE_BLOCKED',
        detail: geo.reason ?? 'La ejecución DeFi no está disponible en tu jurisdicción.',
      },
    };
  }
  return null;
}

/**
 * Puerta de las ÓRDENES que reducen exposición o devuelven capital al colchón:
 * SOLO el flag (#10), jamás el geofence — «LA SALIDA JAMÁS SE GATEA».
 *
 * Es la familia 2 del comentario de `capitalGate`, pero para las rutas que
 * comparten handler con órdenes que SÍ abren exposición (`/pote-council-order`,
 * `/cage-order`): ahí la puerta se elige POR ACCIÓN, no por ruta. Un recall es la
 * única manera de que el holder de un pote síncrono sin colchón pueda redimir
 * (`NOT_REDEEMABLE_NOW` en `/pote-exit`), y el frontend no manda región: con una
 * allowlist configurada, `capitalGate` rechazaba TODO recall, en cualquier sitio.
 *
 * No lleva a propósito un parámetro `req`: no hay nada de la petición que pueda
 * cerrar una salida. El flag se queda (kill-switch del módulo, decisión del fundador).
 */
function exitGate(): { status: number; body: { error: string; detail: string } } | null {
  return poteGate();
}

/**
 * UNA ORDEN FIRMABLE POR ASIENTO (2026-09-14) — el pin de Sequence de las órdenes
 * que firma una cuenta de consejo en Xaman (`XrplOrderSequencePin`).
 *
 * Sin él, desmontar el componente de firma dejaba componer una SEGUNDA orden con la
 * primera aún firmable en el móvil, y las dos validaban. Con la Sequence actual
 * fijada, dos composiciones seguidas comparten asiento y solo una entra en el ledger.
 * En firma simple lleva además LastLedgerSequence (ventana `ORDER_LEDGER_WINDOW`); en
 * una cuenta con SignerList no, porque la ceremonia multisig la fija su coordinador.
 *
 * Responde ÉL MISMO el 503 ORDER_SEQUENCE_UNREADABLE y devuelve null: jamás se
 * compone una orden sin fijar. Se llama DESPUÉS de las negativas deterministas y
 * ANTES de componer — en el nacimiento, antes de tomar el asiento de nonce del 0xFE,
 * para que un 503 no deje un asiento ocupado.
 */
async function readOrderPinOr503(res: Response, account: string): Promise<OrderSequencePin | null> {
  try {
    return await readOrderSequencePin(account);
  } catch (e) {
    res.status(503).json({ error: 'ORDER_SEQUENCE_UNREADABLE', detail: safeErrorDetail(e) });
    return null;
  }
}

/**
 * LA ORDEN FIRMADA SE ENTREGA SIN NAVEGADOR (2026-09-14) — cada orden de consejo
 * compuesta para firmar se RECUERDA en el servidor antes de entregarla
 * (`ComposedCouncilOrderStore`): memo, bytes, cuenta, Sequence/LastLedgerSequence
 * fijadas y ledger de composición. El vigía del relé (`sweepComposedCouncilOrders`)
 * la encuentra validada en el `account_tx` de la cuenta y lanza el relé aunque la
 * pantalla que la firmó se cerrara o se recargara mientras confirmaba.
 *
 * Con base de datos, la escritura se RELEE: si no se puede guardar, responde ÉL
 * MISMO 503 ORDER_RECOVERY_UNRECORDED y devuelve false — no se entrega una orden
 * firmable sin esa memoria. Se llama DESPUÉS de fijar el pin y ANTES de `res.json`.
 * (El nacimiento `/cage-create` no pasa por aquí: es un 0xFE que el executor
 * encuentra solo barriendo el Core Vault.)
 */
async function recordComposedOrderOr503(
  res: Response,
  input: Parameters<typeof import('../services/flare/ComposedCouncilOrderStore').recordComposedCouncilOrder>[0],
  opts: { exit?: boolean } = {},
): Promise<{ proceed: boolean; warning: string | null; serverDelivery: { recorded: boolean; executorEnabled: boolean } }> {
  // LA SALIDA JAMÁS SE GATEA (productizer it. 11): este registro es una RED DE
  // SEGURIDAD — el relé normal lo lanza la pantalla que firma (onSettled). Una base
  // de datos caída o la cola del consejo llena (it. 13, TOO_MANY_PENDING_ORDERS) no
  // pueden cerrar un recall/evacuate: la orden se entrega igual con un aviso. Las
  // demás acciones se niegan (503 / 429). La regla vive UNA vez, en el store: la
  // comparte con `/xrpl-defi/council-order/prepare`.
  const { recordComposedOrderForDelivery, recordComposedCouncilOrder } = await import('../services/flare/ComposedCouncilOrderStore');
  const verdict = await recordComposedOrderForDelivery(input, { exit: opts.exit === true, record: recordComposedCouncilOrder });
  if ('status' in verdict) {
    res.status(verdict.status).json(verdict.body);
    return { proceed: false, warning: null, serverDelivery: { recorded: false, executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' } };
  }
  return { proceed: true, warning: verdict.warning, serverDelivery: verdict.serverDelivery };
}

/**
 * EL TOKEN DE SALIDA TAMBIÉN SALE DE AQUÍ (productizer it. 13, simetría con el
 * Legacy). Una salida compuesta en este router que firma un consejo multifirma
 * pasa por `/xrpl-defi/multisign/prepare`; el token (MAC del servidor sobre la
 * cuenta + los bytes exactos + la acción, 15 min) le deja tomar la puerta de solo
 * flag sin depender de la clasificación por memo. Un token que no se puede emitir
 * no rompe la composición: la ceremonia cae en esa clasificación.
 */
async function exitTokenFor(
  account: string,
  xrplTx: unknown,
  action: string,
): Promise<{ exitToken?: string; exitTokenExpiresAt?: string }> {
  try {
    const { issueCouncilExitToken, isExitAction } = await import('../services/councilExitToken');
    if (!isExitAction(action) || !xrplTx || typeof xrplTx !== 'object' || Array.isArray(xrplTx)) return {};
    return issueCouncilExitToken({ account, xrplTx: xrplTx as Record<string, unknown>, action });
  } catch (e) {
    console.error('[institutional] exit token NOT issued:', (e as Error)?.message ?? e);
    return {};
  }
}

/**
 * ¿ESTA SESIÓN CONTROLA ESTA CUENTA XRPL? (productizer it. 13 J1, ampliado en it. 15).
 * Lo decide el servidor (`handoffAuthority`), jamás el body, y se pregunta UNA vez
 * por petición, cuenta Y PROPÓSITO: lo usan el `supersede` del 0xFE, la guarda de
 * cuenta operativa (`preparedByProven`) y el tope por preparador de las órdenes
 * compuestas.
 *
 * productizer it. 23 (hallazgo 1.1, CUATRO revisores) — EL PROPÓSITO ES PARTE DE LA
 * PREGUNTA, y esta puerta no lo pasaba. La clave de caché lo incluye porque `'entry'`
 * y `'exit'` son dos preguntas distintas sobre la misma cuenta: la primera falla
 * cerrada cuando la tienda no contesta, la segunda conserva el derecho y devuelve un
 * 503 reintentable.
 */
const authorityByRequest = new WeakMap<
  object,
  Map<string, Promise<import('../services/flare/handoffAuthority').XrplAccountAuthority>>
>();
async function authorityFor(
  req: Request,
  account: string,
  purpose: 'entry' | 'exit',
): Promise<import('../services/flare/handoffAuthority').XrplAccountAuthority> {
  const addr = typeof account === 'string' ? account.trim() : '';
  const key = `${purpose}:${addr}`;
  const cached = authorityByRequest.get(req as unknown as object);
  const hit = cached?.get(key);
  if (hit) return hit;
  const run = (async () => {
    const { sessionAuthorityOnXrplAccount } = await import('../services/flare/handoffAuthority');
    return sessionAuthorityOnXrplAccount(req, addr, purpose);
  })();
  const map = cached ?? new Map<string, Promise<import('../services/flare/handoffAuthority').XrplAccountAuthority>>();
  map.set(key, run);
  authorityByRequest.set(req as unknown as object, map);
  return run;
}

/**
 * productizer it. 23 (hallazgo 1.1) — LAS DOS MITADES DEL ASIENTO, POR UNA SOLA
 * PUERTA. **EL FALLO QUE ENCONTRARON CUATRO REVISORES POR SEPARADO, Y ESTÁ EN EL
 * CARRIL QUE MUEVE EL DINERO DEL CLIENTE.**
 *
 * QUÉ FALLABA EN SILENCIO: las seis puertas de 0xFE de este router preguntaban con
 * la forma BOOLEANA (`provenFor` → `sessionMayActOnXrplAccount`), que (a) usa el
 * propósito por defecto `'entry'` —así que en una SALIDA una tienda de pruebas caída
 * fallaba cerrada— y (b) tira el `refusal`, así que el 503 reintentable que el módulo
 * de identidad devuelve para una salida no llegaba a ninguna parte. Resultado con la
 * BD parpadeando: la fila del 0xFE nacía `preparedByProven:false` **y sin**
 * `preparedByProofUnreadable`, es decir, en la clase «borrador de quien no prueba» —
 * y esa clase la desplaza el propio dueño en su siguiente prepare, **mientras la
 * primera todavía puede firmarse en Xaman**. Eso es el GEMELO: dos Payments vivos
 * sobre el mismo asiento, uno de ellos ya en el móvil del cliente.
 *
 * Esta es la ÚNICA forma de rellenar esos dos campos en este router. Hace tres cosas
 * y las tres importan:
 *   · pregunta con el propósito real de la puerta (`'exit'` en una salida);
 *   · **propaga** el 503 reintentable en vez de un `false` mudo — nada se compone,
 *     nada se mueve, y no es un «no»: es «vuelve a intentarlo»;
 *   · persiste `preparedByProven` **y** `preparedByProofUnreadable`, para que ninguna
 *     regla de asiento aparte una fila por un `false` que en realidad era «no pude
 *     preguntar».
 *
 * SOLO el refusal REINTENTABLE se convierte en 503 (`refusal.retryable`, clasificado
 * por el agente E): `no-user-row` y `unreadable-floor` son deterministas y esperar no
 * los cura, así que la salida se compone igual con `preparedByProven:false` y el
 * constructor decide — la salida jamás se gatea por una lectura nuestra.
 *
 * Misma pieza que `seatClaimOf` en `flareDemo.ts`: `seatProofFromVerdict` (contrato
 * del agente E). Una sola manera de rellenar el par, sin copias que se separen.
 */
interface SeatProofFields {
  preparedByProven: boolean;
  preparedByProofUnreadable: boolean;
  supersedeAuthorized: boolean;
}
async function seatProofFieldsFor(
  req: Request,
  account: string,
  opts: { purpose: 'entry' | 'exit'; supersede?: boolean },
): Promise<SeatProofFields> {
  const authority = await authorityFor(req, account, opts.purpose);
  const { seatProofFromVerdict } = await import('../services/identity/provenAddresses');
  const claim = seatProofFromVerdict(
    {
      // La puerta del fundador vive DENTRO de `sessionAuthorityOnXrplAccount` y
      // cuenta como prueba: por eso el veredicto es el suyo, no el de `proveAddress`.
      proven: authority.mayAct,
      storeReadable: authority.outcome !== 'could-not-read',
      refusal: authority.refusal,
    },
    { supersede: opts.supersede === true },
  );
  // productizer it. 31 (agente D, 4.1) — EL REFUSAL VIAJA ENTERO. Esta rama
  // reescribía cualquier refusal reintentable como un `PROOF_STORE_UNREADABLE`
  // de frase fija («could not read … try again in a moment»). Desde it. 29
  // también entra por aquí `PROOF_FLOOR_AHEAD_OF_CLOCK` (la marca de toma de
  // posesión adelantada a nuestro reloj), para el que esa frase es falsa por
  // las dos mitades: la fila SE LEYÓ y el instante puede ser 2099. Se perdían el
  // código, `headline` y `ways` («re-linking will not help», «an administrator
  // can check that date»), y el cliente veía «try again in a moment» en bucle
  // sobre su propia salida del pote. `fromProofRefusal` guarda el refusal en el
  // error y `nonceSeatBody` lo reenvía tal cual. Gemelo de `seatClaimOf`.
  if (claim.refusal?.retryable === true) {
    const { SeatStateUnreadableError } = await import('../connectors/protocols/flare/FlareDirectMintService');
    throw SeatStateUnreadableError.fromProofRefusal(claim.refusal);
  }
  return {
    preparedByProven: claim.preparedByProven,
    preparedByProofUnreadable: claim.preparedByProofUnreadable,
    supersedeAuthorized: claim.supersedeAuthorized,
  };
}

/**
 * productizer it. 25 (§2.1) — ¿LA FIRMA ESTE 0xFE UN QUÓRUM? SE PREGUNTA AL LEDGER.
 *
 * Las siete puertas de 0xFE de este router componen para cuentas de las DOS clases:
 * un pote de consejo (SignerList, ceremonia multifirma de horas) y un pote PERSONAL
 * (`manager == user`, una firma y ya). La forma de la ruta no las distingue, así que
 * adivinar por ella estiraría el asiento de nonce de un usuario normal a 24 h. Se lee
 * el SignerList de la cuenta y se declara la ceremonia solo cuando lo hay
 * (`signingCeremonyFor`, que ya trae dentro las dos reglas: «no pude leer» no estira
 * nada, y una cuenta operativa tampoco).
 *
 * Se llama en el MISMO objeto que va al builder, junto a `seatProofFieldsFor`, para
 * que no pueda quedarse otra vez sin llamador.
 */
async function ceremonyWindowFor(
  account: string,
): Promise<{ signingCeremony?: true; signerListRead?: 'single' | 'quorum' | 'unknown' }> {
  try {
    const { signingCeremonyFor } = await import('../connectors/protocols/flare/FlareDirectMintService');
    // it. 31 (§5): `signerListRead` rides along — the builder stamps it on the
    // handoff and `zeroFeSigningWindow` answers it, so the browser can tell a
    // window that was READ from one that is merely the default.
    return await signingCeremonyFor(account);
  } catch {
    return {}; // una ventana que no se pudo decidir es la de siempre, nunca una más larga
  }
}

/**
 * @deprecated productizer it. 23 (1.1) — SUPERSEDIDA por `seatProofFieldsFor`, que es
 * la única puerta que rellena el par `preparedByProven` / `preparedByProofUnreadable`.
 * Se conserva viva (nunca se borra código construido) para cualquier lector que solo
 * necesite el booleano y NO decida asiento; delega en el mismo veredicto cacheado, así
 * que no puede separarse de él. No usarla en una ruta que componga un 0xFE.
 */
async function provenFor(req: Request, account: string): Promise<boolean> {
  const key = typeof account === 'string' ? account.trim() : '';
  if (!key) return false;
  return (await authorityFor(req, key, 'entry')).mayAct;
}

/**
 * `supersede` solo vale si la sesión puede actuar sobre esa cuenta XRPL
 * (productizer it. 13, J1 — lo decide `handoffAuthority`, del agente del 0xFE).
 *
 * @deprecated productizer it. 23 (1.1) — usa `seatProofFieldsFor(...).supersedeAuthorized`:
 * ahí el permiso sale del MISMO veredicto que los dos campos de prueba, y un «no pude
 * leer» jamás concede un desplazamiento. Inerte pero viva.
 */
async function supersedeAuthorizedFor(req: Request, account: string, supersede: boolean): Promise<boolean> {
  if (!supersede) return false;
  return provenFor(req, account);
}

/**
 * LA ORDEN DOBLE, POR CONTENIDO (productizer it. 15, hallazgo 2.2 — sustituye a la
 * guarda «en vuelo» de la it. 13, que miraba el estado del relé: bloqueaba lo
 * inofensivo —dos `direct-to` distintos, un relé en `error`— y se retiraba justo
 * cuando la orden ya `executed` hace posible el doble pago).
 *
 * Ahora la pregunta es la del usuario: «¿esta MISMA orden (misma cuenta, misma
 * acción, mismos parámetros) ya salió hace menos de 30 min?». Si sí y NO es salida,
 * 409 `SAME_ORDER_RECENTLY_LAUNCHED` salvo `confirmAnotherOrder: true`. Una SALIDA
 * jamás se para: sigue, con `duplicateWarning`.
 *
 * it. 17 (hallazgos 2.3 / 2.4): `content.params` son los params COMPUESTOS — los que
 * el builder va a usar, no `req.body.params` (un `feePayer` derivado o un campo de
 * más esquivaban la clave). Y antes de dar por bueno «no hay duplicado» se consulta
 * el LEDGER por lo que el barrido (cada 5 min) todavía no ha marcado, con la caché y
 * el presupuesto de la lectura de fate. Una lectura fallida sale como aviso, nunca
 * como negativa ni como silencio.
 */
async function councilDuplicateOr409(
  req: Request,
  res: Response,
  council: string,
  isExit: boolean,
  content: { action: string; params?: unknown },
): Promise<{ proceed: boolean; duplicateWarning: string | null; contentKey: string }> {
  const { councilOrderContentKey } = await import('../services/flare/ComposedCouncilOrderStore');
  const { councilDuplicateOrderVerdict, recentSameCouncilOrder } = await import('../services/flare/CouncilOrderRelayLauncher');
  const contentKey = councilOrderContentKey({ council, action: content.action, params: content.params });
  const verdict = await councilDuplicateOrderVerdict({
    council,
    contentKey,
    isExit,
    action: content.action,
    confirmAnotherOrder: req.body?.confirmAnotherOrder === true,
    find: recentSameCouncilOrder,
    sessionKey: req.siwe?.userId ?? req.ip ?? 'anonymous',
  });
  if (verdict.proceed === false) {
    res.status(verdict.status).json(verdict.body);
    return { proceed: false, duplicateWarning: null, contentKey };
  }
  return { proceed: true, duplicateWarning: verdict.duplicateWarning, contentKey };
}

/**
 * ¿ESTÁ ENCENDIDO EL VIGÍA QUE ENTREGA ESTE 0xFE? (productizer it. 16, hallazgo 3.2).
 *
 * El banner del frontend servía su frase prudente («no te prometo la entrega»)
 * sobre TODA salida institucional, porque ninguna ruta 0xFE devolvía
 * `executorEnabled` — solo lo mandaban las órdenes de consejo. El servidor lo sabe:
 * decirlo es la diferencia entre «espera, va en camino» y «nada va a llegar salvo
 * que lo relances tú».
 */
function handoffServerDelivery(): { serverDelivery: { executorEnabled: boolean } } {
  return { serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' } };
}

/**
 * EL CUERPO 409 DE UN ASIENTO OCUPADO, ENTERO (productizer it. 17 — encargo del
 * agente de los asientos 0xFE).
 *
 * Estas rutas construían el 409 a mano con `code` y `retryable` y tiraban el resto,
 * así que la pantalla recibía un código crudo: ni la cuenta atrás real
 * (`secondsLeft`, `lastLedgerSequence` de la fila que bloquea) ni el memo con el que
 * ofrecer «liberar ese asiento» — y el usuario se quedaba mirando
 * `NONCE_SEAT_TAKEN` sin salida. Mismo contrato que `nonceSeatBody` en
 * `flareDemo.ts`: el memo viaja SOLO cuando el constructor decidió que esta sesión
 * puede tocar esa fila (la preparó o prueba la cuenta); a un extraño no se le
 * confirma jamás que ese memo exista.
 */
/**
 * productizer it. 21 (P2, encargo del agente de los asientos) — EL ASIENTO OCUPADO
 * Y EL ASIENTO ILEGIBLE NO SON EL MISMO RECHAZO.
 *
 * QUÉ FALLABA EN SILENCIO: `SeatStateUnreadableError` hereda de `NonceSeatTakenError`
 * y CONSERVA su `name` a propósito (para que una ruta antigua conteste un 409 que la
 * pantalla ya conoce en vez de un 500 mudo). Estas rutas casan por nombre, así que un
 * «no pude leer el estado del asiento» salía como 409 definitivo — también sobre una
 * SALIDA, que es exactamente lo que el invariante prohíbe: una lectura fallida
 * nuestra no es ni permiso ni castigo, y menos un hecho.
 *
 * La clase trae su propia marca (`unreadableSeatState`), leída aquí sin importar el
 * módulo — estas rutas lo cargan perezosamente a propósito. 503 reintentable cuando
 * no pudimos leer; el 409 queda para el asiento que de verdad está ocupado.
 */
function seatRefusalStatus(e: unknown): number {
  // it. 31 (4.1): un refusal de la tienda de pruebas reenviado trae su status.
  return forwardedProofRefusalStatus(e) ?? ((e as { unreadableSeatState?: boolean })?.unreadableSeatState === true ? 503 : 409);
}

function nonceSeatBody(e: unknown): Record<string, unknown> {
  // it. 31 (4.1): la puerta del asiento reenvía el refusal de la tienda de
  // pruebas ENTERO (código, headline, ways, retryAfterSeconds, detail) — jamás
  // un `PROOF_STORE_UNREADABLE` reconstruido a partir del mensaje.
  const forwarded = forwardedProofRefusalBody(e);
  if (forwarded) return forwarded;
  const seat = e as {
    code?: string;
    retryable?: boolean;
    lastLedgerSequence?: number;
    secondsLeft?: number;
    memoHex?: string;
    seatWarning?: string;
  };
  return {
    error: seat.code ?? 'NONCE_SEAT_TAKEN',
    ...(typeof seat.retryable === 'boolean' ? { retryable: seat.retryable } : {}),
    ...(seat.lastLedgerSequence !== undefined ? { lastLedgerSequence: seat.lastLedgerSequence } : {}),
    ...(seat.secondsLeft !== undefined ? { secondsLeft: seat.secondsLeft } : {}),
    ...(seat.memoHex ? { memoHex: seat.memoHex } : {}),
    ...(seat.seatWarning ? { seatWarning: seat.seatWarning } : {}),
    detail: safeErrorDetail(e),
  };
}

/**
 * EL TOPE, DECIDIDO ANTES DE GASTAR LECTURAS (productizer it. 17, hallazgo 2.5).
 *
 * El 429 lo levantaba `recordComposedCouncilOrder`, que corre el ÚLTIMO: para
 * entonces la puerta ya se había gastado `isCageV2Council`, `resolveAstryumCage`,
 * `readPoteState` y el pin de Sequence. Quien tuviera la cola llena podía provocar
 * miles de lecturas RPC por minuto sin ocupar jamás una plaza.
 *
 * Esto es la misma cuenta con UNA lectura de BD y NINGUNA de cadena (una cota
 * INFERIOR: jamás rechaza una composición que el tope real dejaría pasar). Una
 * salida ni se pregunta. Devuelve true si ya respondió 429.
 */
async function councilQueueFull429(
  res: Response,
  council: string,
  proven: boolean,
  preparedByUserId: string | null,
  isExit: boolean,
): Promise<boolean> {
  const { councilQueuePrecheck, TooManyPendingOrdersError } = await import('../services/flare/ComposedCouncilOrderStore');
  const pre = await councilQueuePrecheck({ council, proven, preparedByUserId, exit: isExit });
  if (!pre?.full) return false;
  const e = new TooManyPendingOrdersError(council, pre.live, { bucket: pre.bucket, limit: pre.limit });
  res.status(429).json({ error: e.code, detail: e.message });
  return true;
}

/**
 * LA COMISIÓN DE REDENCIÓN sobre lo que DE VERDAD se desmintea (productizer it. 13,
 * hallazgo 4.2; invariantes #6/#9). Cifra viva de AssetManagerFXRP; ilegible → null
 * y una línea que lo dice: jamás 0. `netUBA` es la estimación neta que llega cuando
 * el agente de FAssets paga.
 */
async function redemptionFeeFor(
  provider: ethers.Provider,
  amountUBA: bigint,
): Promise<{ redemptionFeeBips: number | null; redemptionFeeFxrp: number | null; netUBA: bigint | null; line: string }> {
  const { readRedemptionFeeBips, estimateRedemptionFee } = await import('../connectors/protocols/flare/FlareDirectMintService');
  const bips = await readRedemptionFeeBips(provider).catch(() => null);
  const fee = estimateRedemptionFee(amountUBA, bips);
  const netUBA =
    fee.redemptionFeeBips != null ? amountUBA - (amountUBA * BigInt(fee.redemptionFeeBips)) / 10_000n : null;
  const line =
    fee.redemptionFeeBips != null
      ? `Comisión de redención de FAssets (parámetro actual del protocolo en AssetManagerFXRP): ${fee.redemptionFeeBips / 100}% de lo que se desmintea — unos ${fee.redemptionFeeFxrp} FXRP que el protocolo descuenta del XRP que paga el agente (estimación: si la redención se cumple solo en parte, se cobra sobre lo redimido).`
      : 'Comisión de redención de FAssets: ahora mismo no se ha podido leer la cifra de AssetManagerFXRP. NO es cero: el protocolo la descuenta del XRP que paga el agente.';
  return { ...fee, netUBA, line };
}

/**
 * El cap off-chain de la fase abierta, sobre la MISMA contabilidad que el resto
 * del carril (`config/demoCap`: tope por transacción + tope diario por dirección,
 * con reservas que expiran solas). Se retira cuando el contrato esté auditado.
 *
 * FXRP sigue a XRP 1:1, así que el importe del pote entra en el mismo contador
 * que el mint. Devuelve el error listo para responder, o null si puede pasar.
 *
 * `opts.exit` — LA SALIDA NUNCA SE GATEA. En una salida lo único que se capa es el
 * CARRIER 0xFE, y solo contra el tope POR TRANSACCIÓN (radio de explosión: mintea
 * de verdad). El presupuesto diario por dirección jamás rechaza ni reserva una
 * salida: quien depositó hoy puede salir hoy (`checkExitCarrierCap`, config/demoCap).
 */
async function capitalCap(
  amountXrpEquiv: number,
  address: string | null,
  req: Request,
  opts: { exit?: boolean } = {},
): Promise<{ status: number; body: unknown } | null> {
  // El cap de la demo protege CAPITAL REAL en la fase abierta. En el rig del
  // ensayo (RPC local, o fork HOSPEDADO en Railway que DEMUESTRA ser anvil vía
  // anvil_nodeInfo — para probar desde el preview de Vercel) no hay capital:
  // caparlo solo impediría ensayar el tope por cuenta y los importes reales.
  // Un RPC real jamás pasa la prueba: el flag suelto no relaja nada.
  const { dryRunRigActive } = await import('../services/dryRun/DryRunExecutor');
  if (await dryRunRigActive()) return null;
  const { checkDemoCap, checkExitCarrierCap, isDemoCapExemptUser } = await import('../config/demoCap');
  const userId = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
  if (await isDemoCapExemptUser(userId)) return null;
  if (opts.exit) return checkExitCarrierCap(amountXrpEquiv, address);
  return checkDemoCap(amountXrpEquiv, address);
}

/**
 * El carrier POR DEFECTO de una salida 0xFE (`/pote-exit`, `/pote-claim-exit`) cuando
 * el cliente no manda uno. Era 2 XRP fijos — por encima del tope por transacción por
 * defecto (1), así que una salida SIN carrier explícito se rechazaba sola. Ahora es
 * min(2, DEMO_MAX_XRP_PER_TX), truncado a 6 decimales: siempre cabe bajo el tope, y
 * 1 XRP sobra para las comisiones fijas (~0,35 XRP con margen; el resto mintea como
 * FXRP en la PA del holder). Un carrier que el cliente SÍ manda no se toca nunca: se
 * valida tal cual y, si excede el tope, se rechaza diciendo por qué.
 */
const EXIT_CARRIER_DEFAULT_XRP = 2;
async function defaultExitCarrierXrp(): Promise<string> {
  const { getDemoMaxXrpPerTx } = await import('../config/demoCap');
  const xrp = Math.min(EXIT_CARRIER_DEFAULT_XRP, getDemoMaxXrpPerTx());
  return String(Math.floor(xrp * 1e6) / 1e6);
}

/** Potes con puerta de credencial: lista separada por comas, comparada en minúsculas. */
function credentialGatedPotes(): Set<string> {
  return new Set(
    (process.env.POTE_CREDENTIAL_GATED ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * La puerta de la escena 2 — fail-closed por diseño. Devuelve null cuando el
 * depósito puede prepararse; si no, responde ella misma con el 409 honesto.
 */
async function enforceCredentialGate(res: Response, pote: string, xrplAccount: unknown): Promise<boolean> {
  if (!credentialGatedPotes().has(pote.toLowerCase())) return true;

  if (typeof xrplAccount !== 'string' || !XRPL_ADDRESS_RE.test(xrplAccount)) {
    res.status(409).json({
      error: 'CREDENTIAL_REQUIRED',
      detail: 'Este pote exige credencial: falta la cuenta raíz XRPL (xrplAccount) del depositante.',
    });
    return false;
  }
  const { readAccountCredentials } = await import('../services/XrplCredentialVerifier');
  const summary = await readAccountCredentials(xrplAccount);
  if (!summary.issuerAllowlistConfigured) {
    // Sin emisores configurados NADA desbloquea — y callarlo parecería un
    // fallo del usuario. Se dice (regla del propio verificador).
    res.status(409).json({
      error: 'CREDENTIAL_ISSUERS_UNCONFIGURED',
      detail: 'No hay emisores configurados (XRPL_CREDENTIAL_ISSUERS): la puerta está cerrada para todos.',
    });
    return false;
  }
  if (!summary.hasAcceptedValidCredential) {
    res.status(409).json({
      error: 'CREDENTIAL_REQUIRED',
      detail: 'La cuenta no sostiene ninguna credencial válida (aceptada y sin caducar) de un emisor configurado.',
      credentials: summary.credentials.map((c) => ({ issuer: c.issuer, type: c.credentialType, state: c.state })),
    });
    return false;
  }
  return true;
}

function cooldownHuman(seconds: number): string {
  if (seconds === 0) return 'salida inmediata';
  const hours = Math.round(seconds / 3600);
  return hours % 24 === 0 ? `salida en ${hours / 24} día(s)` : `salida en ${hours} h`;
}

// ── lecturas (abiertas — estado público de la cadena) ───────────────────────

/** GET /pote-state?pote=0x…[&account=0x…] — el estado completo del pote, cage
 *  inyectado; con `account`, además las participaciones de esa cuenta (el MAX
 *  honesto del formulario — jamás un tope inventado). */
router.get('/pote-state', guarded(async (req: Request, res: Response) => {
  const state = await loadState(res, String(req.query.pote ?? '').trim());
  if (!state) return;
  const account = String(req.query.account ?? '').trim();
  if (account) {
    if (!EVM_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una dirección 0x válida');
    try {
      const { readHolderShares } = await import('../services/flare/AstryumPoteStateService');
      let shares;
      try {
        shares = await readHolderShares({ rpcUrl: rpcUrl(), pote: state.pote, provider: flareReadProvider(rpcUrl()) }, account);
      } catch (inner) {
        if (rpcUrl() === PUBLIC_FLARE_RPC) throw inner;
        shares = await readHolderShares({ rpcUrl: PUBLIC_FLARE_RPC, pote: state.pote, provider: flareReadProvider(PUBLIC_FLARE_RPC) }, account);
      }
      return void res.json({ ...state, holder: { address: account, shares } });
    } catch (e) {
      return void res.status(502).json({ error: 'HOLDER_READ_FAILED', detail: safeErrorDetail(e) });
    }
  }
  res.json(state);
}));

/**
 * GET /potes — el catálogo, leído de la cadena.
 *
 * Sustituye a las dos direcciones de entorno que hacían de catálogo: con potes
 * que nacen bajo demanda, un pote creado por un gestor tiene que existir para
 * todo el mundo sin desplegar nada.
 *
 * Lectura abierta como `/pote-state`: es estado público de la cadena.
 *
 * ORDEN NEUTRO, y no es un detalle de implementación. Se devuelven en orden de
 * creación, sin ranking, sin destacados y sin ordenar por rendimiento. Ordenar
 * es elegir, y elegir por el usuario es lo que separa publicar un catálogo de
 * recomendar un producto. Cada pote lleva la marca de su operador, nunca la
 * nuestra.
 *
 * El tick de credencial (`?withCredentials=1`) se lee del LEDGER XRPL y dice
 * quién acreditó, jamás «verificado por Astryum»: no somos emisores, solo
 * enseñamos lo que el ledger ya publica. Un fallo de lectura deja el pote sin
 * tick — nunca lo marca como no verificado, porque no saberlo no es saber que no.
 */
router.get('/potes', guarded(async (req: Request, res: Response) => {
  // Dos generaciones, UN catálogo (27-ago): los potes sueltos de la factory v1
  // y los potes de las jaulas v2. Cualquiera de las dos factories puede faltar;
  // las dos a la vez es «no hay catálogo».
  const v1Raw = process.env.ASTRYUM_FACTORY_ADDRESS;
  const factoryAddress = v1Raw && ethers.isAddress(v1Raw) ? ethers.getAddress(v1Raw) : null;
  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const cageFactory = astryumCageFactoryAddress();
  if (!factoryAddress && !cageFactory) {
    return void res.status(503).json({ error: 'FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_FACTORY_ADDRESS o ASTRYUM_CAGE_FACTORY_ADDRESS.' });
  }

  try {
    // LA LECTURA VIVE EN PoteCatalogRead (12-sep): la misma que calienta el
    // arranque y relee cada 20 min — con su caché swr, su RPC propio del
    // catálogo y su fallback al público. Aquí solo se sirve.
    const { readFullPoteCatalog, peekPoteCatalog } = await import('../services/flare/PoteCatalogRead');
    const override = String(req.query.fromBlock ?? '');
    // SIN NADA SERVIBLE (arranque en frío), no se cuelga al cliente hasta su
    // tope (12-sep: «The catalogue could not be read»): se lanza la lectura
    // en segundo plano y se contesta 202 «calentando»; el cliente vuelve a
    // preguntar en unos segundos. Con algo servible (fresco o pasado) se
    // sirve al instante y la caché se recalcula por detrás.
    if (!peekPoteCatalog(override).potes) {
      void readFullPoteCatalog({ fromBlockOverride: override }).catch(() => undefined);
      res.setHeader('Retry-After', '5');
      return void res.status(202).json({
        warming: true,
        detail: 'Reading the catalogue from the chain (first read after a start) — ask again in a few seconds.',
      });
    }
    const potes = await readFullPoteCatalog({ fromBlockOverride: override });
    const factories = { v1: factoryAddress, v2: cageFactory ? ethers.getAddress(cageFactory) : null };

    // El tick de credencial es opcional y va aparte: consulta el ledger XRPL por
    // cada consejo, y no se debe pagar ese coste quien solo quiere la lista.
    if (String(req.query.withCredentials ?? '') === '1') {
      const { readAccountCredentials } = await import('../services/XrplCredentialVerifier');
      const withTicks = await Promise.all(
        potes.map(async (p) => {
          if (!p.councilXrplAddress) return { ...p, credential: null };
          try {
            const summary = await readAccountCredentials(p.councilXrplAddress);
            // Misma semántica que la puerta de credencial: activa es 'valid' o
            // 'expiring-soon' (sigue siendo válida, solo avisa de que caduca).
            const valid = summary.credentials.find((c) => c.state === 'valid' || c.state === 'expiring-soon');
            return {
              ...p,
              credential: valid
                ? { issuer: valid.issuer, type: valid.credentialType, state: valid.state }
                : null,
            };
          } catch {
            // «No pude leer el ledger» no es «este gestor no está acreditado».
            return { ...p, credential: null, credentialUnreadable: true };
          }
        }),
      );
      return void res.json({ factory: factories.v1 ?? factories.v2, factories, order: 'creation', potes: withTicks });
    }

    res.json({ factory: factories.v1 ?? factories.v2, factories, order: 'creation', potes });
  } catch (e) {
    res.status(502).json({ error: 'POTE_CATALOG_FAILED', detail: safeErrorDetail(e) });
  }
}));

/** GET /credential-gate?pote=0x…&account=r… — el chip de la puerta (F1). */
router.get('/credential-gate', guarded(async (req: Request, res: Response) => {
  const pote = String(req.query.pote ?? '').trim();
  const account = String(req.query.account ?? '').trim();
  if (!EVM_ADDRESS_RE.test(pote)) return void badRequest(res, 'pote debe ser una dirección 0x válida');
  const gated = credentialGatedPotes().has(pote.toLowerCase());
  if (!gated) return void res.json({ pote, gated: false });
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una r-address válida');
  try {
    const { readAccountCredentials } = await import('../services/XrplCredentialVerifier');
    const summary = await readAccountCredentials(account);
    res.json({
      pote,
      gated: true,
      account,
      open: summary.issuerAllowlistConfigured && summary.hasAcceptedValidCredential,
      issuerAllowlistConfigured: summary.issuerAllowlistConfigured,
      credentials: summary.credentials,
    });
  } catch (e) {
    res.status(502).json({ error: 'CREDENTIALS_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── prepares del cliente (flag + puerta de credencial donde toque) ──────────

/** POST /pote-deposit/prepare {pote, amountBase, receiver, xrplAccount?} */
router.post('/pote-deposit/prepare', guarded(async (req: Request, res: Response) => {
  const gate = capitalGate(req);
  if (gate) return void res.status(gate.status).json(gate.body);

  const { pote, amountBase, receiver: rawReceiver, xrplAccount } = req.body ?? {};
  if (typeof amountBase !== 'string' || !BASE_AMOUNT_RE.test(amountBase) || BigInt(amountBase) === 0n) {
    return void badRequest(res, 'amountBase debe ser un entero positivo en unidades base');
  }
  const receiver = parseEvmAddress(rawReceiver);
  if (!receiver) {
    return void badRequest(res, 'receiver debe ser una dirección 0x válida (la cuenta DEL CLIENTE)');
  }
  const state = await loadState(res, String(pote ?? '').trim());
  if (!state) return;
  if (!(await enforceCredentialGate(res, state.pote, xrplAccount))) return;

  const amount = BigInt(amountBase);

  // Tope por cuenta del pote (V2): lo que el ERC-4626 rechazaría DESPUÉS de
  // firmar la aprobación se dice aquí. Un pote v1 no tiene tope; si no se pudo
  // leer, no bloquea — el contrato decide.
  {
    const { readDepositHeadroom, checkDepositCap, depositCapRefusal } = await import('../services/flare/AstryumDepositCapService');
    const headroom = await readDepositHeadroom(new ethers.JsonRpcProvider(rpcUrl()), state.pote, receiver);
    const cap = checkDepositCap(headroom, amount);
    if (cap.ok === false) return void res.status(409).json(depositCapRefusal(cap, state.asset));
  }

  // Cap off-chain de la fase abierta (§15/§14.8 del doc Producto A): el pote
  // era el único carril que no lo aplicaba. FXRP sigue a XRP 1:1, así que el
  // depósito entra en el MISMO contador diario que el mint. La dirección que
  // cuenta es la raíz XRPL si viene, y si no la cuenta Flare que recibe.
  const capped = await capitalCap(
    Number(formatBaseUnits(amount, state.asset.decimals)),
    typeof xrplAccount === 'string' && xrplAccount.trim() ? xrplAccount.trim() : receiver,
    req,
  );
  if (capped) return void res.status(capped.status).json(capped.body);

  const human = formatBaseUnits(amount, state.asset.decimals);
  const calls: UnsignedCall[] = [
    {
      to: state.asset.address,
      data: ERC20_IFACE.encodeFunctionData('approve', [state.pote, amount]),
      value: '0',
      chainId: FLARE_CHAIN_ID,
      label: `Aprobar ${human} ${state.asset.symbol} al pote`,
    },
    {
      to: state.pote,
      data: POTE_IFACE.encodeFunctionData('deposit', [amount, receiver]),
      value: '0',
      chainId: FLARE_CHAIN_ID,
      label: `Depositar ${human} ${state.asset.symbol} — participaciones a ${receiver}`,
    },
  ];
  res.json({
    calls,
    disclosure: {
      disclosedToUser: true,
      title: `Depósito en ${state.name}`,
      lines: [
        `Política del pote: ${cooldownHuman(state.cooldownSeconds)} — lo eliges AHORA, no al querer salir.`,
        `Las participaciones son del receiver (${receiver}); solo su firma puede redimirlas.`,
        'Comisión de Astryum sobre el rendimiento: 0. El corte del operador es público (payees on-chain).',
        'El rendimiento es dato del protocolo de cada venue, nunca una promesa.',
      ],
    },
  });
}));

/** POST /pote-redeem/prepare {pote, sharesBase, receiver, owner} — la puerta
 *  correcta según la forma del pote: redeem síncrono o requestRedeem. */
router.post('/pote-redeem/prepare', guarded(async (req: Request, res: Response) => {
  const gate = poteGate();
  if (gate) return void res.status(gate.status).json(gate.body);

  const { pote, sharesBase, receiver: rawReceiver, owner: rawOwner } = req.body ?? {};
  if (typeof sharesBase !== 'string' || !BASE_AMOUNT_RE.test(sharesBase) || BigInt(sharesBase) === 0n) {
    return void badRequest(res, 'sharesBase debe ser un entero positivo en unidades base de participación');
  }
  const receiver = parseEvmAddress(rawReceiver);
  if (!receiver) {
    return void badRequest(res, 'receiver debe ser una dirección 0x válida');
  }
  const state = await loadState(res, String(pote ?? '').trim());
  if (!state) return;

  const shares = BigInt(sharesBase);

  // Fee-leg de Astryum (en participaciones), deducida en la misma firma: se
  // transfiere feeShares al colector ANTES de redimir; el user redime el resto.
  const fee = redeemServiceFee();
  const feeShares = fee ? (shares * fee.bps) / 10_000n : 0n;
  const redeemShares = shares - feeShares; // con bps ≤ 5% y feeShares < shares, siempre > 0
  const feeCalls: UnsignedCall[] =
    fee && feeShares > 0n
      ? [
          {
            to: state.pote,
            data: POTE_IFACE.encodeFunctionData('transfer', [fee.collector, feeShares]),
            value: '0',
            chainId: FLARE_CHAIN_ID,
            label: `Fee de servicio Astryum (${Number(fee.bps) / 100}%)`,
          },
        ]
      : [];
  const feeLine =
    fee && feeShares > 0n
      ? [`Fee de servicio de Astryum: ${feeShares.toString()} participaciones base (${Number(fee.bps) / 100}%), visible y deducida en esta misma firma.`]
      : [];
  const feeInfo = fee && feeShares > 0n ? { feeShares: feeShares.toString(), bps: Number(fee.bps), collector: fee.collector } : null;

  if (state.cooldownSeconds === 0) {
    const owner = parseEvmAddress(rawOwner);
    if (!owner) {
      return void badRequest(res, 'owner debe ser una dirección 0x válida');
    }
    return void res.json({
      mode: 'sync',
      calls: [
        ...feeCalls,
        {
          to: state.pote,
          data: POTE_IFACE.encodeFunctionData('redeem', [redeemShares, receiver, owner]),
          value: '0',
          chainId: FLARE_CHAIN_ID,
          label: 'Redimir participaciones (salida inmediata)',
        },
      ] satisfies UnsignedCall[],
      fee: feeInfo,
      disclosure: {
        disclosedToUser: true,
        title: `Salida de ${state.name}`,
        lines: [
          ...feeLine,
          'Salida inmediata: el pote desmonta los venues él solo dentro de tu misma transacción.',
          'Nadie autoriza esta salida — es tuya.',
        ],
      },
    });
  }

  const verdict = checkRequestRedeem(state, redeemShares, redeemShares); // el holder firma; su wallet cap el máximo
  if (verdict.ok === false) return void res.status(409).json({ error: verdict.code });
  const maturityISO = new Date(Date.now() + state.cooldownSeconds * 1000).toISOString();
  res.json({
    mode: 'request',
    calls: [
      ...feeCalls,
      {
        to: state.pote,
        data: POTE_IFACE.encodeFunctionData('requestRedeem', [redeemShares, receiver]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `Pedir salida — reclamable ≈ ${maturityISO}`,
      },
    ] satisfies UnsignedCall[],
    estAssetsBase: verdict.estAssets.toString(),
    maturityISO,
    fee: feeInfo,
    disclosure: {
      disclosedToUser: true,
      title: `Salida de ${state.name}`,
      lines: [
        ...feeLine,
        `Cooldown de la política: ${cooldownHuman(state.cooldownSeconds)} (lo aceptaste al entrar).`,
        'Tus participaciones se queman AHORA y el importe queda fijado al precio actual — deja de componer desde esta firma.',
        `El receiver (${receiver}) lo fijas tú en esta firma; después nadie puede cambiarlo.`,
        'Cualquiera puede completar el cobro al vencer — nadie puede impedirlo.',
      ],
    },
  });
}));


// ── it. 34 — las colas de venue del cobro: una lectura, jamás un cero ───────
//
// Las dos rutas de cobro (`/pote-claim-redeem` por EVM y `/pote-claim-exit` por
// 0xFE) componen `claimRedeem(ticket, venueClaims[])`. Dos lecturas deciden ese
// array y las dos se tragaban su fallo:
//   · `balanceOf(pote).catch(() => 0n)`: un colchón ILEGIBLE se leía como «el
//     pote no tiene nada», forzaba el escaneo y podía meter un venueClaim de un
//     periodo ya recogido — el revert del incidente del 10-sep, compuesto a
//     propósito por un 429.
//   · `readPendingWithdrawals` (it. 31) ya no lanza por un periodo caído: lo
//     marca en `unreadablePeriods`. Nadie lo miraba: el periodo no leído no
//     entraba en `venueClaims`, y con el colchón corto `claimRedeem` revierte
//     `UnwindShortfall` (AstryumVault.sol) — la persona firma una tx condenada.
//
// Regla: con periodos ilegibles y (colchón + colas legibles) que NO cubren el
// ticket, no se compone (502 reintentable: la salida no se gatea, se dice que
// no pudimos mirar). Si cubren, se compone y la nota dice qué periodos no se
// leyeron. Lo firmado sigue siendo del usuario; Astryum no firma.

interface FirelightClaimSweep {
  venueClaims: Array<{ venueId: number; period: number }>;
  /** Assets (base units) the readable claimable periods release into the pote. */
  claimableUBA: bigint;
  unreadablePeriods: number[];
  /** The sweep itself did not answer (its anchor `currentPeriod()` fell). */
  sweepFailed: boolean;
  notes: string[];
}

/** Pure: does what we could read cover the ticket, and should we compose? */
export function venueClaimCoverage(input: {
  cushionUBA: bigint;
  ticketUBA: bigint;
  claimableUBA: bigint;
  unreadablePeriods: number[];
  sweepFailed: boolean;
}): { covered: boolean; unread: boolean; shortfallUBA: bigint } {
  const covered = input.cushionUBA + input.claimableUBA >= input.ticketUBA;
  const unread = input.sweepFailed || input.unreadablePeriods.length > 0;
  const shortfallUBA = covered ? 0n : input.ticketUBA - (input.cushionUBA + input.claimableUBA);
  return { covered, unread, shortfallUBA };
}

/** The pote's own asset balance — a read that either answers or says it did not. */
async function readPoteCushion(
  provider: ethers.JsonRpcProvider,
  state: AstryumPoteState,
): Promise<{ ok: true; value: bigint } | { ok: false; detail: string }> {
  const erc = new ethers.Contract(state.asset.address, ['function balanceOf(address) view returns (uint256)'], provider);
  try {
    return { ok: true, value: BigInt(await erc.balanceOf(state.pote)) };
  } catch (e) {
    return { ok: false, detail: safeErrorDetail(e) };
  }
}

function cushionUnreadableBody(state: AstryumPoteState, detail: string) {
  return {
    error: 'VAULT_CLAIMS_UNREADABLE',
    retryable: true,
    unread: 'cushion' as const,
    vault: state.pote,
    detail:
      `We could not read the pote's own ${state.asset.symbol} balance just now (${detail}), and that balance decides ` +
      'whether your ticket is paid from the buffer or needs a venue queue collected in the same transaction. ' +
      'Composing without it could put a claim on a period already collected — a transaction that reverts after you ' +
      'paid gas. Nothing was prepared and nothing was signed; your ticket stays claimable. Try again in a moment.',
  };
}

function queueUnreadableBody(state: AstryumPoteState, sweep: FirelightClaimSweep, shortfallUBA: bigint) {
  const which = sweep.sweepFailed
    ? 'the Firelight withdrawal queue did not answer at all'
    : `${sweep.unreadablePeriods.length} withdrawal period(s) of Firelight did not answer (${sweep.unreadablePeriods.slice(0, 6).join(', ')}${sweep.unreadablePeriods.length > 6 ? ', …' : ''})`;
  return {
    error: 'VAULT_CLAIMS_UNREADABLE',
    retryable: true,
    unread: 'periods' as const,
    vault: state.pote,
    unreadablePeriods: sweep.unreadablePeriods,
    shortfallBase: shortfallUBA.toString(),
    detail:
      `We could not compose this claim: ${which}, and what we could read — the pote's buffer plus the queues that ` +
      `answered — is ${formatBaseUnits(shortfallUBA, state.asset.decimals)} ${state.asset.symbol} short of your ticket. ` +
      'A claim signed like this reverts (UnwindShortfall) after you paid gas. Nothing was prepared and nothing was ' +
      'signed; your ticket stays claimable. Try again in a moment.',
  };
}

/** The Firelight queue of the pote, as the claim needs it: claimable periods and what could not be read. */
async function sweepFirelightForClaim(state: AstryumPoteState, provider: ethers.JsonRpcProvider): Promise<FirelightClaimSweep> {
  const out: FirelightClaimSweep = { venueClaims: [], claimableUBA: 0n, unreadablePeriods: [], sweepFailed: false, notes: [] };
  const firelightTarget = (process.env.FIRELIGHT_STXRP ?? '').toLowerCase();
  for (const venue of state.venues) {
    if (venue.kind !== 'erc4626queued' || BigInt(venue.queuedTotal) === 0n) continue;
    if (venue.target.toLowerCase() !== firelightTarget) {
      out.notes.push(`El venue encolado ${venue.target} no es Firelight: sus colas se reclaman con claimVenue aparte.`);
      continue;
    }
    try {
      const { FirelightAdapter } = await import('../connectors/protocols/adapters/FirelightAdapter');
      // The route's own provider: the FlareProvider singleton needs initialize().
      const scan = await new FirelightAdapter().readPendingWithdrawals(state.pote, provider);
      for (const p of scan.pending) {
        if (p.claimable) {
          out.venueClaims.push({ venueId: venue.id, period: p.period });
          out.claimableUBA += BigInt(p.queuedFxrpBase);
        } else if (p.claimableAt) out.notes.push(`Cola del periodo ${p.period}: reclamable a partir de ${p.claimableAt}.`);
      }
      out.unreadablePeriods.push(...scan.unreadablePeriods);
    } catch (e) {
      out.sweepFailed = true;
      out.notes.push(`No se pudo escanear la cola de Firelight: ${safeErrorDetail(e)}`);
    }
  }
  return out;
}

function unreadPeriodsNote(sweep: FirelightClaimSweep): string {
  return (
    `Withdrawal period(s) ${sweep.unreadablePeriods.join(', ')} of Firelight did not answer this time; ` +
    'the buffer plus the queues that did answer cover this ticket, so nothing from them is needed for this claim.'
  );
}

/** POST /pote-claim-redeem/prepare {pote, ticketId} — el final del circuito. */
router.post('/pote-claim-redeem/prepare', guarded(async (req: Request, res: Response) => {
  const gate = poteGate();
  if (gate) return void res.status(gate.status).json(gate.body);

  const { pote, ticketId } = req.body ?? {};
  const id = Number(ticketId);
  if (!Number.isInteger(id) || id < 0) return void badRequest(res, 'ticketId debe ser un entero ≥ 0');
  const state = await loadState(res, String(pote ?? '').trim());
  if (!state) return;

  const verdict = checkClaimRedeem(state, id, Math.floor(Date.now() / 1000));
  if (verdict.ok === false) {
    // CLAIM_NOT_READY: nunca se invita a firmar una call condenada.
    return void res.status(409).json({ error: verdict.code, ...verdict });
  }

  // Las colas de venue maduras se cobran en la MISMA tx (VenueClaim[]). Hoy el
  // único venue encolado del rodaje es Firelight; el escaneo por periodos es
  // el del adapter (withdrawalsOf devuelve ASSETS, claimable = period < current).
  //
  // GUARDA (incidente 10-sep): si el colchón del pote ya cubre el ticket (el
  // gestor lo recuperó al buffer con un recall), se paga del colchón y
  // venueClaims queda VACÍO — meter un venueClaim de un periodo YA recogido hace
  // REVERTIR el claim. Solo se escanean colas si el colchón no llega al importe.
  const ticket = state.tickets[id];
  const claimProvider = new ethers.JsonRpcProvider(rpcUrl());
  // it. 34 — the cushion is a READ (see venueClaimCoverage above): unreadable
  // is a 502 to retry, never a zero that forces the scan.
  const cushionRead = await readPoteCushion(claimProvider, state);
  if (cushionRead.ok === false) return void res.status(502).json(cushionUnreadableBody(state, cushionRead.detail));
  const claimCushionUBA = cushionRead.value;
  let venueClaims: Array<{ venueId: number; period: number }> = [];
  const notes: string[] = [];
  if (claimCushionUBA < BigInt(ticket.assets)) {
    const sweep = await sweepFirelightForClaim(state, claimProvider);
    const coverage = venueClaimCoverage({
      cushionUBA: claimCushionUBA,
      ticketUBA: BigInt(ticket.assets),
      claimableUBA: sweep.claimableUBA,
      unreadablePeriods: sweep.unreadablePeriods,
      sweepFailed: sweep.sweepFailed,
    });
    // Unread periods AND what we read does not cover the ticket: the claim we
    // would compose reverts UnwindShortfall — say «we could not look», retry.
    if (coverage.unread && !coverage.covered) {
      return void res.status(502).json(queueUnreadableBody(state, sweep, coverage.shortfallUBA));
    }
    venueClaims = sweep.venueClaims;
    notes.push(...sweep.notes);
    if (coverage.unread) notes.push(unreadPeriodsNote(sweep));
  }
  res.json({
    calls: [
      {
        to: state.pote,
        data: POTE_IFACE.encodeFunctionData('claimRedeem', [
          BigInt(id),
          venueClaims.map((c) => [BigInt(c.venueId), BigInt(c.period)]),
        ]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `Cobrar el ticket #${id} (${formatBaseUnits(BigInt(ticket.assets), state.asset.decimals)} ${state.asset.symbol})`,
      },
    ] satisfies UnsignedCall[],
    venueClaims,
    notes,
    disclosure: {
      disclosedToUser: true,
      title: 'Cobro de la salida',
      lines: [
        `El pote paga exactamente lo fijado al pedir la salida: ${formatBaseUnits(BigInt(ticket.assets), state.asset.decimals)} ${state.asset.symbol} a ${ticket.receiver}.`,
        'Esta transacción la puede enviar cualquiera; el destino no lo puede cambiar nadie.',
      ],
    },
  });
}));

// ── prepares del director (la consola del operador — escena 3) ──────────────

/**
 * Estas dos rutas componen una firma EVM DEL DIRECTOR. Si el pote no tiene un
 * director cedido vigente, esa firma revierte con `NotDirectorOrCouncil` y el
 * firmante paga gas por una transacción condenada sin entender por qué — pasó en
 * vivo (23-ago-2026: `directTo` firmado con MetaMask sin cesión, revert
 * `0x16baed6b`, horas de diagnóstico). Sin cesión, el camino correcto es la
 * ORDEN DE CONSEJO por XRPL.
 *
 * En la generación v2 el director vive en la JAULA, no en el pote: el estado ya
 * trae el director EFECTIVO (el de la jaula, `governance.cage`), y estas rutas
 * componen entonces `cage.directTo(pote, …)` / `cage.recall(pote, …)` — la
 * misma firma EVM del director, contra la jaula, sin peaje FDC.
 */
const CAGE_DIRECTOR_IFACE = new ethers.Interface([
  'function directTo(address pote, uint256 venueId, uint256 amount, bytes32 ref)',
  'function recall(address pote, uint256 venueId, uint256 amount, bytes32 ref)',
]);

/** A quién va la firma del director y con qué bytes: al pote (v1) o a su jaula (v2). */
function directorCall(
  state: AstryumPoteState,
  fn: 'directTo' | 'recall',
  vid: number,
  amount: bigint,
): { to: string; data: string } {
  const ref = state.governance.constitutionRef;
  if (state.governance.cage) {
    return {
      to: state.governance.cage,
      data: CAGE_DIRECTOR_IFACE.encodeFunctionData(fn, [state.pote, BigInt(vid), amount, ref]),
    };
  }
  return { to: state.pote, data: POTE_IFACE.encodeFunctionData(fn, [BigInt(vid), amount, ref]) };
}

function directorSeatRefusal(
  state: AstryumPoteState,
): { status: number; body: { error: string; detail: string } } | null {
  const now = Math.floor(Date.now() / 1000);
  const seated =
    state.governance.director !== ethers.ZeroAddress && state.governance.directorUntil > now;
  if (seated) return null;
  return {
    status: 409,
    body: {
      error: 'NO_DIRECTOR_CEDED',
      detail:
        'Este pote no tiene director cedido vigente: una firma EVM revertiría con NotDirectorOrCouncil sin mover nada. ' +
        'Dirigir o recuperar es entonces una ORDEN DEL CONSEJO (XRPL) — /pote-council-order/prepare para un pote v1, ' +
        'y /cage-order/prepare si lo gobierna una jaula v2 (o `cede` desde la jaula para nombrar un director).',
    },
  };
}

/** POST /pote-direct/prepare {pote, venueId, amountBase} */
router.post('/pote-direct/prepare', guarded(async (req: Request, res: Response) => {
  const gate = capitalGate(req);
  if (gate) return void res.status(gate.status).json(gate.body);

  const { pote, venueId, amountBase } = req.body ?? {};
  const vid = Number(venueId);
  if (!Number.isInteger(vid) || vid < 0) return void badRequest(res, 'venueId debe ser un entero ≥ 0');
  if (typeof amountBase !== 'string' || !BASE_AMOUNT_RE.test(amountBase)) {
    return void badRequest(res, 'amountBase debe ser un entero positivo en unidades base');
  }
  const state = await loadState(res, String(pote ?? '').trim());
  if (!state) return;

  const seat = directorSeatRefusal(state);
  if (seat) return void res.status(seat.status).json(seat.body);

  const amount = BigInt(amountBase);
  const verdict = checkPoteDirectTo(state, vid, amount, Math.floor(Date.now() / 1000));
  if (verdict.ok === false) return void res.status(409).json({ error: verdict.code, detail: verdict.detail });

  res.json({
    calls: [
      {
        ...directorCall(state, 'directTo', vid, amount),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `Dirigir ${formatBaseUnits(amount, state.asset.decimals)} ${state.asset.symbol} al venue #${vid}${state.governance.cage ? ' (vía la jaula)' : ''}`,
      },
    ] satisfies UnsignedCall[],
    disclosure: {
      disclosedToUser: true,
      title: 'Dirección de capital (dentro de la allowlist)',
      lines: [
        `La orden viaja con la constitución vigente (${state.governance.constitutionRef.slice(0, 10)}…) — una constitución caducada revierte.`,
        'Este mando solo mueve capital entre los venues listados. No existe otra puerta.',
      ],
    },
  });
}));

/** POST /pote-recall/prepare {pote, venueId, amountBase} */
router.post('/pote-recall/prepare', guarded(async (req: Request, res: Response) => {
  const gate = poteGate();
  if (gate) return void res.status(gate.status).json(gate.body);

  const { pote, venueId, amountBase } = req.body ?? {};
  const vid = Number(venueId);
  if (!Number.isInteger(vid) || vid < 0) return void badRequest(res, 'venueId debe ser un entero ≥ 0');
  if (typeof amountBase !== 'string' || !BASE_AMOUNT_RE.test(amountBase)) {
    return void badRequest(res, 'amountBase debe ser un entero positivo en unidades base');
  }
  const state = await loadState(res, String(pote ?? '').trim());
  if (!state) return;

  const seat = directorSeatRefusal(state);
  if (seat) return void res.status(seat.status).json(seat.body);

  const venue = state.venues[vid];
  if (!venue) return void res.status(409).json({ error: 'VENUE_UNKNOWN' });
  const amount = BigInt(amountBase);
  const live = BigInt(venue.value) - BigInt(venue.queuedTotal);
  if (amount > live) {
    return void res.status(409).json({
      error: 'INSUFFICIENT_VENUE_VALUE',
      detail: `el venue sostiene ${formatBaseUnits(live > 0n ? live : 0n, state.asset.decimals)} vivos`,
    });
  }
  const queuedNote =
    venue.kind === 'erc4626queued'
      ? 'Venue encolado: esta orden INICIA la cola de salida; el capital llega al cerrar el periodo (claimVenue).'
      : 'Venue síncrono: el capital vuelve al colchón en la misma transacción.';

  res.json({
    calls: [
      {
        ...directorCall(state, 'recall', vid, amount),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `Retirar ${formatBaseUnits(amount, state.asset.decimals)} ${state.asset.symbol} del venue #${vid}${state.governance.cage ? ' (vía la jaula)' : ''}`,
      },
    ] satisfies UnsignedCall[],
    disclosure: { disclosedToUser: true, title: 'Retirada al colchón', lines: [queuedNote] },
  });
}));

// ── la ceremonia de credencial (escena 2 — Astryum compone, JAMÁS firma) ────

/** POST /credential-issue/prepare {issuer, subject, credentialType?, expirationDays?, uri?} */
router.post('/credential-issue/prepare', guarded((req: Request, res: Response) => {
  const gate = poteGate();
  if (gate) return void res.status(gate.status).json(gate.body);
  try {
    const { issuer, subject, credentialType, expirationDays, uri } = req.body ?? {};
    // The ISSUER signs in Xaman. A user's root designating its own account is a
    // user signer (tag); Astryum's notary issuer is ours (no tag). The composer
    // stays untagged because ManagerNotaryIssuer signs it with our seed.
    const txjson = withSourceTag(
      composeCredentialCreate({ issuer, subject, credentialType, expirationDays, uri }),
      attributionForSigner(String(issuer ?? '')),
    );
    res.json({
      txjson,
      signer: 'issuer',
      disclosure: {
        disclosedToUser: true,
        title: 'Emisión de credencial (firma el EMISOR)',
        lines: [
          'La credencial caduca SIEMPRE — la autoridad no se renueva sola (I5).',
          'En el ledger solo viaja el tipo, la fecha y —si se adjunta— un ENLACE a la credencial verificable del emisor: jamás datos personales.',
          'La reserva de 0,2 XRP cuelga del emisor hasta que el sujeto acepte.',
        ],
      },
    });
  } catch (e) {
    if (e instanceof CredentialCeremonyError) return void res.status(400).json({ error: e.code, detail: e.message });
    res.status(500).json({ error: 'CEREMONY_FAILED', detail: safeErrorDetail(e) });
  }
}));

/** POST /credential-accept/prepare {issuer, subject, credentialType?} */
router.post('/credential-accept/prepare', guarded((req: Request, res: Response) => {
  const gate = poteGate();
  if (gate) return void res.status(gate.status).json(gate.body);
  try {
    const { issuer, subject, credentialType } = req.body ?? {};
    // The SUBJECT signs it in Xaman: the project tag, attributed to that signer.
    const txjson = withSourceTag(
      composeCredentialAccept({ issuer, subject, credentialType }),
      attributionForSigner(String(subject ?? '')),
    );
    res.json({
      txjson,
      signer: 'subject',
      disclosure: {
        disclosedToUser: true,
        title: 'Aceptación de credencial (firma el SUJETO)',
        lines: [
          'Esta firma ES tu consentimiento — la misma llave que usarás para salir.',
          'La reserva de 0,2 XRP del objeto pasa a tu cuenta al aceptar.',
        ],
      },
    });
  } catch (e) {
    if (e instanceof CredentialCeremonyError) return void res.status(400).json({ error: e.code, detail: e.message });
    res.status(500).json({ error: 'CEREMONY_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── nacimiento del pote: una firma del consejo XRPL crea el vault (escena 1) ─

/**
 * POST /pote-create/prepare { account: "r…" (consejo XRPL), amountXrp, which: "A"|"B" }
 * Compone el nacimiento del pote como UN pago XRPL: mintea XRP→FXRP y ejecuta
 * create+approve+deposit(génesis→PA) vía 0xFE. El consejo firma; Astryum no.
 * Clon del /cage-create de Legacy, con AstryumStackFactory + AstryumVault.
 * Repetible: cada consejo XRPL distinto → un pote distinto (Z8). Ships tras flag.
 */
router.post('/pote-create/prepare', guarded(async (req: Request, res: Response) => {
  const g = capitalGate(req);
  if (g) return void res.status(g.status).json(g.body);

  const { account: rawAccount, amountXrp: rawAmount, which: rawWhich } = req.body ?? {};
  const account = String(rawAccount ?? '').trim();
  const amountXrp = String(rawAmount ?? '').trim();
  const which = rawWhich === 'B' ? 'B' : 'A';
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser la dirección XRPL del consejo');
  if (!amountXrp || !/^[0-9]+(\.[0-9]{1,6})?$/.test(amountXrp)) {
    return void badRequest(res, 'amountXrp es obligatorio (el principal génesis, XRP humano)');
  }

  const factoryAddress = process.env.ASTRYUM_FACTORY_ADDRESS;
  if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
    return void res.status(503).json({ error: 'FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_FACTORY_ADDRESS.' });
  }

  try {
    // Generación primero (mismo guard que /pote-council-order): un consejo v2 no
    // PARE potes con esta ceremonia v1 — su jaula los abre por orden de consejo
    // (`create-pote` en /cage-order/prepare). Componer aquí produciría un 0xFE
    // firmable que minta FXRP real para levantar un stack v1 paralelo al lado de
    // la jaula (el hazard multi-registro del 28-ago). Si la lectura falla, la
    // ruta falla entera: «no pude comprobar» no es «adelante».
    const { isCageV2Council } = await import('../services/flare/LegacyCageResolver');
    if (await isCageV2Council(account)) {
      return void res.status(409).json({
        error: 'COUNCIL_GOVERNS_A_CAGE',
        detail:
          'Este consejo gobierna una JAULA (generación v2): sus potes se abren por ORDEN DE CONSEJO ' +
          "(`create-pote` en /cage-order/prepare), no con el nacimiento v1. Componer aquí gastaría un 0xFE " +
          'real en levantar un stack v1 paralelo junto a la jaula.',
      });
    }

    const [
      { resolveAstryumPote, buildPoteCreationBatch, poteParamsFor, predictPoteAddresses },
      { readDirectMintParams, computeNetMint, buildDirectMintHandoff, mintFeeDisclosure },
      { resolvePersonalAccount },
      { formatBaseUnits, parseBaseUnits },
    ] = await Promise.all([
      import('../services/flare/AstryumPoteCreationService'),
      import('../connectors/protocols/flare/FlareDirectMintService'),
      import('../connectors/protocols/flare/FlareSmartAccountService'),
      import('../services/flare/LegacyVaultStateService'),
    ]);

    const provider = new ethers.JsonRpcProvider(rpcUrl());

    // Un consejo, un pote: si ya tiene, no repetir la ceremonia (el factory
    // revertiría CageAlreadyExists). Para otra toma, usa OTRO consejo XRPL.
    const existing = await resolveAstryumPote(provider, factoryAddress, account);
    if (existing) {
      return void res.status(409).json({
        error: 'POTE_ALREADY_EXISTS',
        detail: `Este consejo ya tiene su pote en ${existing.vault}. Un consejo, un pote — usa otra dirección XRPL para otra toma.`,
        vault: existing.vault,
      });
    }

    // La constitución precede al código: su SHA-256 (anclado en XRPL por DIDSet)
    // es un parámetro eterno del constructor del vault.
    const anchor = await xrplProvider.getDidObject(account).catch(() => null);
    const refHex = String(anchor?.dataHex ?? '');
    if (!/^[0-9a-fA-F]{64}$/.test(refHex)) {
      return void res.status(409).json({
        error: 'CONSTITUTION_NOT_ANCHORED',
        detail: 'Este consejo no ha anclado su constitución en XRPL (DIDSet). Áncla primero, luego crea el pote.',
      });
    }

    const personalAccount = await resolvePersonalAccount(provider, account);
    if (!personalAccount || personalAccount === ethers.ZeroAddress) {
      return void res.status(409).json({ error: 'NO_PERSONAL_ACCOUNT', detail: 'El consejo no tiene Personal Account resoluble.' });
    }

    const poteParams = poteParamsFor(which, ('0x' + refHex).toLowerCase());
    const predicted = await predictPoteAddresses(provider, factoryAddress, account, poteParams);

    const params = await readDirectMintParams(provider);
    const grossXrpDrops = parseBaseUnits(amountXrp, 6);
    const net = computeNetMint(grossXrpDrops, params, undefined);

    const innerCalls = buildPoteCreationBatch({
      factoryAddress,
      councilR: account,
      councilPersonalAccount: personalAccount,
      params: poteParams,
      predictedVault: predicted.vault,
      genesisUBA: net.supplyUBA,
    });

    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: 'astryum-pote-create',
        preparedByUserId: req.siwe?.userId ?? null,
        // it. 23 (1.1): una ENTRADA sigue fallando cerrada si no se puede leer la
        // prueba, pero la fila se marca `preparedByProofUnreadable` igual — así
        // ninguna regla de asiento la aparta por un `false` que era «no pude leer».
        ...(await seatProofFieldsFor(req, account, { purpose: 'entry' })),
        // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
        // compone con la ventana de su ceremonia; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
        supersedeAuthorized: false,
      },
      { params }
    );

    res.json({
      account,
      which,
      predicted,
      factory: factoryAddress,
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      ...handoffServerDelivery(),
      net: { grossXrp: amountXrp, supplyUBA: net.supplyUBA.toString(), firstPrincipalXrp: formatBaseUnits(net.supplyUBA, 6) },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: `Nacimiento del ${poteParams.name}`,
        lines: [
          `El consejo firma UN pago de ${amountXrp} XRP y nace su pote en Flare: un vault en ${predicted.vault} que obedece SOLO a este consejo (su dirección XRPL queda escrita en el bridge al nacer y nunca cambia).`,
          `Génesis ≈ ${formatBaseUnits(net.supplyUBA, 6)} FXRP como capital propio del operador (defensa de inflación); el receiver de esas participaciones es la Personal Account del consejo.`,
          'Astryum no firma nada; el relayer que porta la prueba tiene cero autoridad. Dirigir a un venue es una SEGUNDA orden del consejo.',
        ],
        facts: {
          ...mintFeeDisclosure(net),
          poteWillLiveAt: predicted.vault,
          bridgeWillLiveAt: predicted.bridge,
          obeysOnly: account,
          constitutionRef: poteParams.constitutionRef,
          cooldownSeconds: poteParams.cooldownSeconds,
          firstPrincipal: `${formatBaseUnits(net.supplyUBA, 6)} FXRP`,
        },
      },
    });
  } catch (e) {
    // it. 15: esta puerta también toma un asiento de nonce y también puede tocar una
    // cuenta operativa; devolvía 500 «falló» para las dos negativas que sí tienen
    // remedio (esperar / usar la cuenta correcta).
    const name = (e as { name?: string })?.name;
    if (name === 'OperationalAccountHandoffError') {
      return void res.status(403).json({ error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) });
    }
    if (name === 'NonceSeatTakenError') {
      // it. 17: el cuerpo ENTERO (cuenta atrás, ventana y, a quien puede tocarla, el
      // memo de la fila que bloquea) — un código a secas es un callejón.
      return void res.status(seatRefusalStatus(e)).json(nonceSeatBody(e));
    }
    res.status(500).json({ error: 'POTE_CREATE_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── entrada/salida atómicas XRP↔pote (0xFE) — el XRP del user directo al pote ─

/**
 * POST /pote-fund-xrp/prepare { account: "r…" (quien firma, XRPL), pote, amountXrp, receiver: "0x…" }
 * El XRP del usuario, atómico, dentro del pote: UN pago XRPL → mint XRP→FXRP →
 * approve + deposit(receiver) en el mismo batch (0xFE). El `receiver` de las
 * participaciones es la cuenta Flare del user; si el pote tiene puerta KYC,
 * debe estar aprobado (si no, el deposit revierte, dicho antes de firmar).
 */
router.post('/pote-fund-xrp/prepare', guarded(async (req: Request, res: Response) => {
  const g = capitalGate(req);
  if (g) return void res.status(g.status).json(g.body);
  const { account: rawAccount, pote: rawPote, amountXrp: rawAmount, receiver: rawReceiver,
          fromSmartAccount: rawFromSA, amountFxrp: rawAmountFxrp, carrierXrp: rawCarrier } = req.body ?? {};
  const account = String(rawAccount ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser la dirección XRPL que firma');
  // DOS carriles XRPL: mintear XRP fresco, o gastar el FXRP que la Personal
  // Account YA tiene (fromSmartAccount, sin mint — misma firma Xaman, solo el
  // carrier del 0xFE). Cada uno lee el importe distinto.
  const fromSmartAccount = rawFromSA === true || rawFromSA === 'true';
  const amountXrp = String(rawAmount ?? '').trim();
  const amountFxrp = String(rawAmountFxrp ?? '').trim();
  const carrierXrp = String(rawCarrier ?? '').trim();
  if (fromSmartAccount) {
    if (!amountFxrp || !/^[0-9]+(\.[0-9]{1,6})?$/.test(amountFxrp)) return void badRequest(res, 'amountFxrp es obligatorio (FXRP ya en la PA)');
    if (!carrierXrp || !/^[0-9]+(\.[0-9]{1,6})?$/.test(carrierXrp)) return void badRequest(res, 'carrierXrp es obligatorio (peaje del 0xFE)');
  } else {
    if (!amountXrp || !/^[0-9]+(\.[0-9]{1,6})?$/.test(amountXrp)) return void badRequest(res, 'amountXrp es obligatorio');
  }

  // El receiver es OPCIONAL desde 2026-08-24 (modo no-custodial, Producto A).
  //
  // Antes era obligatorio y se tecleaba: una dirección mal copiada mandaba las
  // participaciones de alguien a una cuenta ajena, sin vuelta atrás. En el modo
  // no-custodial no hay nada que teclear — quien firma con su cuenta XRPL YA
  // tiene una cuenta en Flare (su Personal Account) y es ahí donde van.
  //
  // El modo custodial (Producto B) sigue mandándolo explícito, porque el
  // receiver es la cuenta del cliente y no la de quien firma. Ese caso no
  // cambia; solo deja de ser el único.
  const explicitReceiver = rawReceiver !== undefined && rawReceiver !== null && String(rawReceiver).trim() !== '';
  let receiver = explicitReceiver ? parseEvmAddress(rawReceiver) : null;
  if (explicitReceiver && !receiver) {
    return void badRequest(res, 'receiver, si se pasa, debe ser una dirección Flare válida (0x…)');
  }

  // Cap off-chain: SOLO el carril que mintea capital NUEVO cuenta contra el
  // presupuesto. La entrada desde la PA gasta FXRP que ya existía — no mintea
  // (solo el carrier ínfimo del 0xFE), así que no consume presupuesto.
  if (!fromSmartAccount) {
    const cappedXrp = await capitalCap(Number(amountXrp), account, req);
    if (cappedXrp) return void res.status(cappedXrp.status).json(cappedXrp.body);
  }

  const state = await loadState(res, String(rawPote ?? '').trim());
  if (!state) return;

  try {
    const [
      { readDirectMintParams, computeNetMint, buildDirectMintHandoff, mintFeeDisclosure, readFxrpBalance },
      { formatBaseUnits, parseBaseUnits },
    ] = await Promise.all([
      import('../connectors/protocols/flare/FlareDirectMintService'),
      import('../services/flare/LegacyVaultStateService'),
    ]);
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    // Sin receiver explícito → su propia Personal Account, resuelta on-chain.
    let sharesToOwnAccount = false;
    if (!receiver) {
      const { resolvePersonalAccount } = await import('../connectors/protocols/flare/FlareSmartAccountService');
      const pa = await resolvePersonalAccount(provider, account);
      if (!pa || pa === ethers.ZeroAddress) {
        return void res.status(409).json({
          error: 'NO_PERSONAL_ACCOUNT',
          detail: 'Tu cuenta XRPL todavía no tiene Personal Account en Flare. Vuelve a intentarlo en un momento.',
        });
      }
      receiver = ethers.getAddress(pa);
      sharesToOwnAccount = true;
    }

    const params = await readDirectMintParams(provider);
    // Dos carriles convergen en UN supplyUBA: el que va al approve+deposit.
    //  · mint:   grossXrpDrops = amountXrp; supplyUBA = net.supplyUBA.
    //  · from-PA: grossXrpDrops = carrierXrp; supplyUBA = FXRP existente + el
    //             mint NETO del carrier (se une para no dejar nada suelto).
    let grossXrpDrops: bigint;
    let existingUBA = BigInt(0);
    if (fromSmartAccount) {
      grossXrpDrops = parseBaseUnits(carrierXrp, 6);
      existingUBA = parseBaseUnits(amountFxrp, 6);
      // El FXRP TIENE que estar en la PA de quien firma — se comprueba antes de
      // firmar, porque un deposit sin saldo revertiría tras gastar el carrier.
      const { resolvePersonalAccount } = await import('../connectors/protocols/flare/FlareSmartAccountService');
      const paHolder = await resolvePersonalAccount(provider, account);
      if (!paHolder || paHolder === ethers.ZeroAddress) {
        return void res.status(409).json({ error: 'NO_PERSONAL_ACCOUNT', detail: 'Tu cuenta XRPL todavía no tiene Personal Account en Flare.' });
      }
      const free = await readFxrpBalance(provider, paHolder);
      if (free < existingUBA) {
        return void res.status(409).json({
          error: 'INSUFFICIENT_FXRP',
          detail: `Tu Personal Account tiene ${formatBaseUnits(free, 6)} FXRP libre; pediste ${amountFxrp}.`,
        });
      }
    } else {
      grossXrpDrops = parseBaseUnits(amountXrp, 6);
    }
    const net = computeNetMint(grossXrpDrops, params, undefined);
    const supplyUBA = existingUBA + net.supplyUBA;

    // Si el pote tiene puerta KYC, avisamos ANTES de firmar (el deposit
    // revertiría tras gastar el XRP): leemos userGate() y su isApproved(receiver).
    // Va DESPUÉS de resolver el receiver — antes se comprobaba una dirección que
    // en el modo no-custodial todavía no existía.
    try {
      const vault = new ethers.Contract(state.pote, ['function userGate() view returns (address)'], provider);
      const gateAddr = (await vault.userGate()) as string;
      if (gateAddr && gateAddr !== ethers.ZeroAddress) {
        const gate = new ethers.Contract(gateAddr, ['function isApproved(address) view returns (bool)'], provider);
        if (!(await gate.isApproved(receiver))) {
          return void res.status(409).json({
            error: 'RECEIVER_NOT_APPROVED',
            detail: 'Esta cuenta no está aprobada en la puerta del pote — hace falta darla de alta primero.',
          });
        }
      }
    } catch {
      /* si no se puede leer la puerta, no bloqueamos aquí — el contrato decide */
    }

    // Tope por cuenta del pote (V2), sobre el FXRP NETO que entraría: aquí el
    // coste de descubrirlo tarde es el XRP gastado y la ronda FDC, así que se
    // dice antes. Un pote v1 no tiene tope; ilegible = no bloquea.
    {
      const { readDepositHeadroom, checkDepositCap, depositCapRefusal } = await import('../services/flare/AstryumDepositCapService');
      const headroom = await readDepositHeadroom(provider, state.pote, receiver);
      const cap = checkDepositCap(headroom, supplyUBA);
      if (cap.ok === false) return void res.status(409).json(depositCapRefusal(cap, state.asset));
    }

    const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
    const pote = new ethers.Interface(['function deposit(uint256 assets, address receiver) returns (uint256)']);
    const innerCalls = [
      { to: ethers.getAddress(state.asset.address), calldata: erc20.encodeFunctionData('approve', [state.pote, supplyUBA]), value: '0' },
      { to: ethers.getAddress(state.pote), calldata: pote.encodeFunctionData('deposit', [supplyUBA, receiver]), value: '0' },
    ];

    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: fromSmartAccount ? 'astryum-pote-fund-pa' : 'astryum-pote-fund',
        preparedByUserId: req.siwe?.userId ?? null,
        // it. 23 (1.1): ENTRADA — mismo par de campos, mismo sitio único.
        ...(await seatProofFieldsFor(req, account, { purpose: 'entry' })),
        // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
        // compone con la ventana de su ceremonia; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
        supersedeAuthorized: false,
        // The demo exchange desk funds the pote from the OMNIBUS through this
        // route: an account Astryum operates gets no project tag (list it in
        // ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS).
        attribution: attributionForSigner(account),
      },
      { params }
    );

    const fxrpHuman = formatBaseUnits(supplyUBA, 6);
    res.json({
      account,
      pote: state.pote,
      receiver,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      personalAccount: handoff.personalAccount,
      ...handoffServerDelivery(),
      net: { grossXrp: fromSmartAccount ? carrierXrp : amountXrp, supplyUBA: supplyUBA.toString(), fxrp: fxrpHuman },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: fromSmartAccount ? `Meter ${amountFxrp} FXRP (de tu cuenta) en ${state.name}` : `Meter ${amountXrp} XRP en ${state.name}`,
        lines: [
          fromSmartAccount
            ? `Usas el FXRP que tu Personal Account ya tiene: ≈ ${fxrpHuman} FXRP entran en el pote SIN mintear nada nuevo (solo el peaje ${carrierXrp} XRP del 0xFE).`
            : `Un pago XRPL: tu XRP se convierte en ≈ ${fxrpHuman} FXRP y entra en el pote, todo en la misma transacción.`,
          sharesToOwnAccount
            ? `Las participaciones van a TU cuenta de Flare (${receiver}), la que te corresponde por tu cuenta XRPL. Solo tu firma las mueve, y sales por donde entraste.`
            : `Las participaciones van a ${receiver} — una dirección distinta de la tuya, la que se ha indicado. Solo quien controle esa cuenta podrá redimirlas.`,
          'Astryum no firma; el executor solo transporta y paga el peaje FDC.',
        ],
        facts: { ...mintFeeDisclosure(net), poteAt: state.pote, sharesTo: receiver, sharesToOwnAccount },
      },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    // it. 13 (2.1): an XRPL account Astryum operates (the exchange omnibus) only takes
    // the exchange's own 0xFE — a stranger can no longer occupy its nonce seat from here.
    if (name === 'OperationalAccountHandoffError') {
      return void res.status(403).json({ error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) });
    }
    if (name === 'NonceSeatTakenError') {
      // it. 15: el CÓDIGO exacto del asiento (…_SIGNED / _REPORTED / _UNREADABLE) y si
      // reintentar puede servir — la pantalla ofrecía «Reintentar liberando el asiento»
      // en bucle porque todos llegaban como un NONCE_SEAT_TAKEN plano.
      // it. 17: el cuerpo ENTERO (cuenta atrás, ventana y, a quien puede tocarla, el
      // memo de la fila que bloquea) — un código a secas es un callejón.
      return void res.status(seatRefusalStatus(e)).json(nonceSeatBody(e));
    }
    res.status(500).json({ error: 'POTE_FUND_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /pote-exit-xrp/prepare { holder: "0x…" (cuenta Flare del user), amountFxrpBase, xrplDestination: "r…", destinationTag?: number }
 * La vuelta: el FXRP que el user tiene tras redimir se desmintea a XRP y va a
 * su dirección XRPL. Devuelve el call sin firmar (lo firma el user con su passkey
 * vía el relayer, o su wallet Flare). Redimir del pote es un paso previo aparte.
 *
 * SIMETRÍA con la entrada: si se pasa `destinationTag`, usa `redeemWithTag` — el
 * XRP llega al omnibus del exchange CON el tag del user (atribución automática),
 * igual que entró con tag. Sin tag → `redeemAmount` a una r-address soberana.
 */
router.post('/pote-exit-xrp/prepare', guarded(async (req: Request, res: Response) => {
  const g = poteGate();
  if (g) return void res.status(g.status).json(g.body);
  const { amountFxrpBase, xrplDestination, destinationTag } = req.body ?? {};
  if (typeof amountFxrpBase !== 'string' || !/^[0-9]{1,30}$/.test(amountFxrpBase) || BigInt(amountFxrpBase) === 0n) {
    return void badRequest(res, 'amountFxrpBase debe ser un entero positivo (unidades base FXRP)');
  }
  const dest = String(xrplDestination ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(dest)) return void badRequest(res, 'xrplDestination debe ser una r-address XRPL');

  // Tag opcional: uint32 (0 es válido). Solo se activa el carril con-tag si viene.
  let tag: number | undefined;
  let tagSource: 'registry' | 'client' | 'none' = 'none';
  if (destinationTag !== undefined && destinationTag !== null && destinationTag !== '') {
    const n = Number(destinationTag);
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
      return void badRequest(res, 'destinationTag debe ser un entero de 32 bits (0 … 4294967295)');
    }
    tag = n;
    tagSource = 'client';
  }

  try {
    const { buildRedeemToXrplCall, readMinimumRedeemAmountUBA, readRedemptionFeeBips, estimateRedemptionFee } = await import(
      '../connectors/protocols/flare/FlareDirectMintService'
    );
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    // Atadura ON-CHAIN (gap 3): si se da el pote y el holder, el tag sale del
    // REGISTRO del exchange (pote.userGate → tagOf(holder)), no de lo que el
    // cliente teclee. Así el XRP vuelve exactamente a la casilla que el exchange
    // asignó a esa passkey — acotado en cadena, no en los libros.
    const poteAddr = parseEvmAddress(req.body?.pote);
    const holder = parseEvmAddress(req.body?.holder);
    if (poteAddr && holder) {
      try {
        const vault = new ethers.Contract(poteAddr, ['function userGate() view returns (address)'], provider);
        const gateAddr = (await vault.userGate()) as string;
        if (gateAddr && gateAddr !== ethers.ZeroAddress) {
          const reg = new ethers.Contract(
            gateAddr,
            ['function approved(address) view returns (bool)', 'function tagOf(address) view returns (uint256)'],
            provider,
          );
          if (await reg.approved(holder)) {
            tag = Number(await reg.tagOf(holder));
            tagSource = 'registry';
          }
        }
      } catch {
        /* si no se puede leer el registro, cae al tag del cliente (o ninguno) */
      }
    }

    // Mínimo on-chain de redención (5 FXRP en mainnet) — avisar ANTES de firmar.
    // El lector degrada a null si no se puede leer; en ese caso no bloqueamos.
    const minUBA = await readMinimumRedeemAmountUBA(provider);
    if (minUBA != null && minUBA > 0n && BigInt(amountFxrpBase) < minUBA) {
      return void res.status(409).json({
        error: 'BELOW_MIN_REDEEM',
        detail: `El mínimo de redención es ${minUBA.toString()} unidades base FXRP.`,
        minimumUBA: minUBA.toString(),
      });
    }

    const call = await buildRedeemToXrplCall(provider, { amountUBA: BigInt(amountFxrpBase), xrplDestination: dest, destinationTag: tag });
    const target = tag !== undefined ? `${dest} (tag ${tag})` : dest;
    // productizer-it9 §3.4 — la comisión de redención, cifra VIVA del protocolo
    // (invariantes #6/#9). Ilegible → null y una línea que lo dice: jamás 0.
    const redemptionFee = estimateRedemptionFee(BigInt(amountFxrpBase), await readRedemptionFeeBips(provider));
    res.json({
      call: { to: call.to, data: call.calldata, value: call.value, chainId: FLARE_CHAIN_ID, label: `Desmintear FXRP → XRP a ${target}` },
      mode: tag !== undefined ? 'redeemWithTag' : 'redeemAmount',
      tag: tag ?? null,
      tagSource, // 'registry' = atado on-chain; 'client' = tecleado; 'none' = sin tag
      disclosure: {
        disclosedToUser: true,
        title: 'Sacar a tu dirección XRPL',
        redemptionFeeBips: redemptionFee.redemptionFeeBips,
        redemptionFeeFxrp: redemptionFee.redemptionFeeFxrp,
        lines: [
          tag !== undefined
            ? `El FXRP que redimiste se convierte en XRP y viaja a ${dest} con el tag ${tag}${tagSource === 'registry' ? ' (tu casilla en el exchange, atada on-chain)' : ' (tu cuenta en el exchange)'}.`
            : `El FXRP que redimiste se convierte en XRP y viaja a ${dest}.`,
          redemptionFee.redemptionFeeBips != null
            ? `Comisión de redención de FAssets (parámetro actual del protocolo en AssetManagerFXRP): ${redemptionFee.redemptionFeeBips / 100}% del importe — unos ${redemptionFee.redemptionFeeFxrp} FXRP que el protocolo descuenta del XRP que paga el agente (estimación: si la redención se cumple solo en parte, se cobra sobre lo redimido).`
            : 'Comisión de redención de FAssets: ahora mismo no se ha podido leer la cifra de AssetManagerFXRP. NO es cero: el protocolo la descuenta del XRP que paga el agente.',
          'Primero redime del pote (redeem/requestRedeem); esto es el segundo paso, el desminteo.',
        ],
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'POTE_EXIT_XRP_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── el PERFIL PÚBLICO del gestor (fundador 6-sep) ───────────────────────────
// Auto-declarado (nombre, foto, bio) + HECHOS del ledger (credenciales con su
// «verified», hasta cuándo, y el enlace a la prueba — el URI de la XLS-70).
// Lo escribe SOLO el dueño probado de la r-address: la wallet tiene que estar
// vinculada por firma a su usuario. Sin eso sería material de phishing.

/** GET /manager-profile?account=r… — lo que el cliente revisa antes de entrar. */
router.get('/manager-profile', guarded(async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una r-address');
  const viewerId = (req as unknown as { siwe?: { userId?: string } }).siwe?.userId ?? null;
  try {
    const { prisma } = await import('../database/prismaClient');
    const profile = await prisma.managerPublicProfile.findUnique({ where: { account } });
    // El apoyo de la comunidad: cuántos, y si el que mira ya apoya (anónimo = no).
    const [endorsements, mine] = await Promise.all([
      prisma.managerEndorsement.count({ where: { account } }),
      viewerId ? prisma.managerEndorsement.findUnique({ where: { userId_account: { userId: viewerId, account } } }) : Promise.resolve(null),
    ]);
    // Los hechos: credenciales vigentes del ledger, con caducidad y su prueba.
    let credentials: Array<{ type: string; issuer: string; expiresAtISO: string | null; uri: string | null }> = [];
    try {
      const { readAccountCredentials } = await import('../services/XrplCredentialVerifier');
      const held = await readAccountCredentials(account);
      credentials = held.credentials
        .filter((c) => c.state === 'valid' || c.state === 'expiring-soon')
        .map((c) => ({ type: c.credentialType, issuer: c.issuer, expiresAtISO: c.expiresAtISO, uri: c.uri }));
    } catch {
      // «No pude leer» ≠ «no tiene»: el perfil sale sin la sección de hechos.
      credentials = [];
    }
    res.json({
      account,
      profile: profile
        ? { displayName: profile.displayName, entity: profile.entity, bio: profile.bio, avatarUrl: profile.avatarUrl, website: profile.website, twitter: profile.twitter, actorKind: profile.actorKind, updatedAtISO: profile.updatedAt.toISOString() }
        : null,
      credentials,
      endorsements,
      endorsedByMe: Boolean(mine),
    });
  } catch (e) {
    res.status(502).json({ error: 'PROFILE_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

const HTTPS_RE = /^https:\/\/\S+$/;
// La foto puede ser un enlace https o la misma data-URL que guarda la cuenta
// (mismo regex y mismo tope que `profilePatchSchema` en routes/auth.ts).
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp);base64,/;
const AVATAR_DATA_URL_MAX = 150_000;
const ACTOR_KINDS = new Set(['human', 'agent']);

/**
 * POST /manager-profile { account, displayName, entity?, bio?, avatarUrl?,
 * website?, twitter?, actorKind?, useAccountAvatar? } — upsert del perfil.
 * SOLO el dueño probado: la cuenta tiene que ser una wallet Xaman VINCULADA
 * (por firma) al usuario autenticado. `useAccountAvatar: true` copia la foto
 * de la cuenta (Settings → Perfil) al perfil público, sin volver a subirla.
 */
router.post('/manager-profile', guarded(async (req: Request, res: Response) => {
  // El auth de la app pone `req.siwe.userId` (requireSiweAuth), NO `req.user`.
  const userId = (req as unknown as { siwe?: { userId?: string } }).siwe?.userId ?? null;
  if (!userId) return void res.status(401).json({ error: 'AUTH_REQUIRED', detail: 'Inicia sesión.' });
  const account = String(req.body?.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una r-address');
  const displayName = String(req.body?.displayName ?? '').trim();
  if (displayName.length < 2 || displayName.length > 60) return void badRequest(res, 'displayName: 2-60 caracteres');
  const opt = (v: unknown, max: number) => {
    const s = String(v ?? '').trim();
    return s.length === 0 ? null : s.slice(0, max);
  };
  let avatarUrl = opt(req.body?.avatarUrl, AVATAR_DATA_URL_MAX);
  const website = opt(req.body?.website, 200);
  if (avatarUrl) {
    const isHttps = HTTPS_RE.test(avatarUrl) && avatarUrl.length <= 500;
    const isDataImage = DATA_IMAGE_RE.test(avatarUrl);
    if (!isHttps && !isDataImage) return void badRequest(res, 'avatarUrl debe ser https://… (≤500) o una data:image png/jpeg/webp (≤150 KB)');
  }
  if (website && !HTTPS_RE.test(website)) return void badRequest(res, 'website debe ser https://…');
  // Quién opera la cuenta: persona o agente. Auto-declarado, como el resto del
  // perfil; ausente = se conserva lo guardado (o 'human' si es nuevo).
  const actorKindRaw = req.body?.actorKind;
  if (actorKindRaw !== undefined && actorKindRaw !== null && !ACTOR_KINDS.has(String(actorKindRaw))) {
    return void badRequest(res, "actorKind debe ser 'human' o 'agent'");
  }
  const actorKind = actorKindRaw === undefined || actorKindRaw === null ? undefined : String(actorKindRaw);
  const useAccountAvatar = req.body?.useAccountAvatar === true;
  try {
    const { prisma } = await import('../database/prismaClient');
    if (useAccountAvatar) {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { avatar: true } });
      if (!me?.avatar) {
        return void res.status(400).json({ error: 'NO_ACCOUNT_AVATAR', detail: 'Tu cuenta no tiene foto de perfil: ponla en Settings → Perfil y vuelve.' });
      }
      avatarUrl = me.avatar;
    }
    // Dueño PROBADO = firma XRPL verificada, NO una etiqueta declarada por el
    // cliente. Un `Wallet.walletType:'xaman'` lo crea POST /wallets/connect SIN
    // firma (cualquiera logueado podría reclamar una r-address ajena por curl y
    // sobrescribir su perfil público). El `WalletBinding` xrpl solo existe tras
    // verificar la firma Xaman de ESA cuenta (nonce + pubkey → r-address, en
    // /wallet-bindings/confirm). Es la prueba XRPL-nativa — sin ETH, la misma
    // identidad con la que el gestor gobierna.
    const proven = await prisma.walletBinding.findFirst({
      where: { userId, address: account, chainType: 'xrpl', isActive: true },
    });
    if (!proven) {
      return void res.status(403).json({
        error: 'NOT_YOUR_ACCOUNT',
        detail: 'Esa r-address aún no está probada como tuya. Pruébala firmando con Xaman en Wallets (una firma, sin gasto): el perfil público solo lo escribe el dueño que prueba la cuenta por firma.',
      });
    }
    const data = { userId, displayName, entity: opt(req.body?.entity, 120), bio: opt(req.body?.bio, 600), avatarUrl, website, twitter: opt(req.body?.twitter, 60) };
    const saved = await prisma.managerPublicProfile.upsert({
      where: { account },
      create: { account, ...data, actorKind: actorKind ?? 'human' },
      // `undefined` = Prisma no toca la columna: se conserva lo declarado antes.
      update: { ...data, actorKind },
    });
    res.json({ ok: true, account, actorKind: saved.actorKind, updatedAtISO: saved.updatedAt.toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'PROFILE_SAVE_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── la COMUNIDAD de gestores (fundador 8-sep) ───────────────────────────────
// Apoyos públicos («upvotes») por r-address y la imagen elegida por pote. Nada
// de esto mueve capital ni promete rendimiento: es reputación declarada por
// usuarios logueados, y el cliente la cruza con el catálogo que ya tiene.

/**
 * POST /manager-endorse { account, on } — apoyar (on:true) o retirar el apoyo
 * (on:false) a la r-address de un gestor. Un voto por usuario y cuenta (PK).
 */
router.post('/manager-endorse', guarded(async (req: Request, res: Response) => {
  const userId = (req as unknown as { siwe?: { userId?: string } }).siwe?.userId ?? null;
  if (!userId) return void res.status(401).json({ error: 'AUTH_REQUIRED', detail: 'Inicia sesión.' });
  const account = String(req.body?.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una r-address');
  if (typeof req.body?.on !== 'boolean') return void badRequest(res, 'on debe ser true o false');
  const on = req.body.on as boolean;
  try {
    const { prisma } = await import('../database/prismaClient');
    // Apoyarse a uno mismo inflaría el contador: si la cuenta está probada
    // como del usuario (firma XRPL), no cuenta.
    const own = await prisma.walletBinding.findFirst({
      where: { userId, address: account, chainType: 'xrpl', isActive: true },
    });
    if (own) return void res.status(409).json({ error: 'SELF_ENDORSE', detail: 'No puedes apoyar tu propia cuenta.' });
    if (on) {
      await prisma.managerEndorsement.upsert({
        where: { userId_account: { userId, account } },
        create: { userId, account },
        update: {},
      });
    } else {
      await prisma.managerEndorsement.deleteMany({ where: { userId, account } });
    }
    const endorsements = await prisma.managerEndorsement.count({ where: { account } });
    res.json({ ok: true, account, endorsements, endorsedByMe: on });
  } catch (e) {
    res.status(500).json({ error: 'ENDORSE_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * GET /community — lectura pública: todos los actores con perfil o con algún
 * apoyo, y las imágenes elegidas por pote. Sin lecturas de cadena: el cliente
 * lo cruza con el catálogo de potes que ya tiene. Tope de 500 actores.
 */
router.get('/community', guarded(async (req: Request, res: Response) => {
  const viewerId = (req as unknown as { siwe?: { userId?: string } }).siwe?.userId ?? null;
  try {
    const { prisma } = await import('../database/prismaClient');
    const [profiles, tallies, mine, images] = await Promise.all([
      prisma.managerPublicProfile.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 }),
      prisma.managerEndorsement.groupBy({ by: ['account'], _count: { _all: true } }),
      viewerId ? prisma.managerEndorsement.findMany({ where: { userId: viewerId }, select: { account: true } }) : Promise.resolve([] as Array<{ account: string }>),
      prisma.vaultImage.findMany({ take: 1000 }),
    ]);
    const countBy = new Map<string, number>(tallies.map((t) => [t.account, t._count._all]));
    const mineSet = new Set(mine.map((m) => m.account));
    const profileBy = new Map(profiles.map((p) => [p.account, p]));
    // Unión: cuentas con perfil ∪ cuentas apoyadas (puede haber apoyo sin perfil).
    const accounts = new Set<string>([...profileBy.keys(), ...countBy.keys()]);
    const actors = [...accounts].slice(0, 500).map((account) => {
      const p = profileBy.get(account);
      return {
        account,
        profile: p
          ? { displayName: p.displayName, entity: p.entity, bio: p.bio, avatarUrl: p.avatarUrl, website: p.website, twitter: p.twitter, actorKind: p.actorKind, updatedAtISO: p.updatedAt.toISOString() }
          : null,
        endorsements: countBy.get(account) ?? 0,
        endorsedByMe: mineSet.has(account),
      };
    });
    const vaultImages = images.map((i) => ({ pote: i.pote, account: i.account, kind: i.kind, emblem: i.emblem }));
    res.json({ actors, vaultImages });
  } catch (e) {
    res.status(502).json({ error: 'COMMUNITY_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

// Los emblemas de la casa. El frontend mantiene LA MISMA lista en
// `frontend/src/lib/institutional/vaultEmblems.tsx` — añadir uno = tocar las dos.
const VAULT_EMBLEMS = ['sprout', 'shield', 'anchor', 'compass', 'mountain', 'flame', 'gem', 'leaf', 'orbit', 'rocket', 'sun', 'waves'] as const;
const VAULT_IMAGE_KINDS = new Set(['emblem', 'profile', 'none']);

/**
 * POST /vault-image { account, pote, kind, emblem? } — la imagen elegida para
 * un pote, escrita por el dueño probado de `account`. NO se verifica on-chain
 * que el pote pertenezca a ese consejo: el cliente solo pinta una imagen cuya
 * `account` coincide con el `councilXrplAddress` del pote en el catálogo, así
 * que una fila escrita para el pote de otro es inerte (y una lectura de cadena
 * aquí solo añadiría un 502 más cuando el RPC tose).
 */
router.post('/vault-image', guarded(async (req: Request, res: Response) => {
  const userId = (req as unknown as { siwe?: { userId?: string } }).siwe?.userId ?? null;
  if (!userId) return void res.status(401).json({ error: 'AUTH_REQUIRED', detail: 'Inicia sesión.' });
  const account = String(req.body?.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una r-address');
  const poteRaw = String(req.body?.pote ?? '').trim();
  if (!ethers.isAddress(poteRaw)) return void badRequest(res, 'pote debe ser una dirección EVM');
  const pote = poteRaw.toLowerCase();
  const kind = String(req.body?.kind ?? '').trim();
  if (!VAULT_IMAGE_KINDS.has(kind)) return void badRequest(res, "kind debe ser 'emblem', 'profile' o 'none'");
  let emblem: string | null = null;
  if (kind === 'emblem') {
    const e = String(req.body?.emblem ?? '').trim();
    if (!(VAULT_EMBLEMS as readonly string[]).includes(e)) return void badRequest(res, `emblem debe ser uno de: ${VAULT_EMBLEMS.join(', ')}`);
    emblem = e;
  }
  try {
    const { prisma } = await import('../database/prismaClient');
    const proven = await prisma.walletBinding.findFirst({
      where: { userId, address: account, chainType: 'xrpl', isActive: true },
    });
    if (!proven) {
      return void res.status(403).json({
        error: 'NOT_YOUR_ACCOUNT',
        detail: 'Esa r-address aún no está probada como tuya. Pruébala firmando con Xaman en Wallets (una firma, sin gasto): el perfil público solo lo escribe el dueño que prueba la cuenta por firma.',
      });
    }
    const data = { account, kind, emblem };
    await prisma.vaultImage.upsert({ where: { pote }, create: { pote, ...data }, update: data });
    res.json({ ok: true, pote, kind, emblem });
  } catch (e) {
    res.status(500).json({ error: 'VAULT_IMAGE_SAVE_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * GET /council/anchor?account=r… — ¿está la constitución ANCLADA? Lee el DID
 * (XLS-40) de la cuenta y devuelve huella y URI si existen. Es lo que deja al
 * wizard marcar la estación como HECHA desde la realidad del ledger, jamás
 * desde un estado local (doctrina: el ledger manda, la UI re-detecta).
 */
router.get('/council/anchor', guarded(async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser una r-address');
  try {
    const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
    const did = await xrplProvider.getDidObject(account);
    if (!did || !did.dataHex) return void res.json({ account, anchored: false });
    let uri: string | undefined;
    if (did.uriHex) {
      try { uri = Buffer.from(did.uriHex, 'hex').toString('utf8'); } catch { uri = undefined; }
    }
    res.json({ account, anchored: true, sha256: did.dataHex.toLowerCase(), uri });
  } catch (e) {
    res.status(502).json({ error: 'ANCHOR_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── el REGISTRO DE VENUES de Astryum (X1 de la revisión 2-sep) ──────────────
// El scanner on-chain que todo pote v2 consulta en `_addVenue`. Sin entradas,
// todo pote nace con CERO destinos: era el primer bloqueante absoluto del
// deploy mainnet. Aquí: leerlo (público) y COMPONER las tres escrituras del
// governor — proponer (entra tras el timelock), activar (cualquiera, cuando
// madura) y retirar (inmediata; solo bloquea capital NUEVO). Astryum no firma:
// firma el GOVERNOR del registro con su wallet EVM.

const VENUE_KIND_CODES: Record<string, number> = { erc4626: 0, compoundv2: 1, erc4626queued: 2 };

async function resolveVenueRegistry(): Promise<{ registry: string; provider: ethers.JsonRpcProvider } | null> {
  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const factoryAddress = astryumCageFactoryAddress();
  if (!factoryAddress) return null;
  const provider = new ethers.JsonRpcProvider(rpcUrl());
  const factory = new ethers.Contract(factoryAddress, ['function ASTRYUM_REGISTRY() view returns (address)'], provider);
  const registry = (await factory.ASTRYUM_REGISTRY()) as string;
  return { registry, provider };
}

/** GET /venue-registry — la whitelist entera, con governor y timelock. Lectura pública. */
router.get('/venue-registry', guarded(async (_req: Request, res: Response) => {
  try {
    const resolved = await resolveVenueRegistry();
    if (!resolved) return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
    const { readRegistryVenues } = await import('../services/flare/AstryumRegistryReadService');
    res.json(await readRegistryVenues(resolved.provider, resolved.registry));
  } catch (e) {
    res.status(502).json({ error: 'REGISTRY_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /venue-registry/propose/prepare { target, kind, chainId? } — el alta.
 * kind: 'erc4626' | 'compoundv2' | 'erc4626queued' (o su código 0/1/2). Entra
 * en vigor cuando el TIMELOCK del registro madura y alguien la activa.
 */
router.post('/venue-registry/propose/prepare', guarded(async (req: Request, res: Response) => {
  const target = parseEvmAddress(req.body?.target);
  if (!target) return void badRequest(res, 'target debe ser una dirección 0x…');
  const rawKind = req.body?.kind;
  const kind = typeof rawKind === 'string' ? VENUE_KIND_CODES[rawKind.trim().toLowerCase()] : Number(rawKind);
  if (!Number.isInteger(kind) || kind < 0 || kind > 2) {
    return void badRequest(res, "kind debe ser 'erc4626' | 'compoundv2' | 'erc4626queued' (o 0/1/2)");
  }
  const chainId = Number(req.body?.chainId ?? FLARE_CHAIN_ID);
  try {
    const resolved = await resolveVenueRegistry();
    if (!resolved) return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
    const iface = new ethers.Interface(['function proposeVenue(uint32 chainId, address target, uint8 kind)']);
    res.json({
      call: {
        to: resolved.registry,
        data: iface.encodeFunctionData('proposeVenue', [chainId, target, kind]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `proposeVenue(${chainId}, ${target}, ${kind})`,
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Proponer venue al scanner de Astryum',
        lines: [
          `Alta de ${target} (chain ${chainId}) en el registro. NO entra en vigor ya: espera el timelock del registro y después cualquiera puede activarla.`,
          'Lo firma el GOVERNOR del registro con su wallet EVM; Astryum no firma.',
          'El registro es la whitelist que todo pote consulta: filtro técnico uniforme, jamás una recomendación.',
        ],
      },
    });
  } catch (e) {
    res.status(502).json({ error: 'REGISTRY_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /venue-registry/activate/prepare { target, chainId? } — activar un alta
 * madura. La firma CUALQUIERA (el contrato exige solo que el timelock pasó).
 */
router.post('/venue-registry/activate/prepare', guarded(async (req: Request, res: Response) => {
  const target = parseEvmAddress(req.body?.target);
  if (!target) return void badRequest(res, 'target debe ser una dirección 0x…');
  const chainId = Number(req.body?.chainId ?? FLARE_CHAIN_ID);
  try {
    const resolved = await resolveVenueRegistry();
    if (!resolved) return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
    const iface = new ethers.Interface(['function activateVenue(uint32 chainId, address target)']);
    res.json({
      call: {
        to: resolved.registry,
        data: iface.encodeFunctionData('activateVenue', [chainId, target]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `activateVenue(${chainId}, ${target})`,
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Activar el alta madura',
        lines: [
          `Activa ${target} en el registro — solo funciona si el timelock ya pasó (si no, el contrato revierte).`,
          'La puede firmar cualquiera: la espera la impuso el timelock, no una autoridad.',
        ],
      },
    });
  } catch (e) {
    res.status(502).json({ error: 'REGISTRY_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /venue-registry/remove/prepare { target, chainId? } — la baja, INMEDIATA.
 * Bloquea capital NUEVO hacia ese venue; las posiciones existentes no se tocan.
 */
router.post('/venue-registry/remove/prepare', guarded(async (req: Request, res: Response) => {
  const target = parseEvmAddress(req.body?.target);
  if (!target) return void badRequest(res, 'target debe ser una dirección 0x…');
  const chainId = Number(req.body?.chainId ?? FLARE_CHAIN_ID);
  try {
    const resolved = await resolveVenueRegistry();
    if (!resolved) return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
    const iface = new ethers.Interface(['function removeVenue(uint32 chainId, address target)']);
    res.json({
      call: {
        to: resolved.registry,
        data: iface.encodeFunctionData('removeVenue', [chainId, target]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `removeVenue(${chainId}, ${target})`,
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Retirar venue del scanner',
        lines: [
          `Baja inmediata de ${target}: ningún pote podrá dirigir capital NUEVO ahí. Las posiciones existentes no se tocan.`,
          'Lo firma el GOVERNOR del registro; Astryum no firma.',
        ],
      },
    });
  } catch (e) {
    res.status(502).json({ error: 'REGISTRY_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /kyc/register/prepare { registry, user, tag, approved? } — el exchange
 * registra (KYC) a un user y ATA su destination tag XRPL on-chain, en una firma.
 * Devuelve el call `setApprovedWithTag` sin firmar; lo firma el ADMIN del
 * registro con su wallet EVM (Astryum no firma). Es el gap 3 acotado en cadena:
 * a partir de aquí, el unmint saca el tag de aquí, no de lo tecleado.
 */
// SOLO FUNDADORES (2026-09-20): sus dos pantallas —la mesa del partner de KYC
// (/app/partner) y la del operador del exchange— van tras PreviewOnly, y una
// ruta que sirve a una sección tapada lleva requireAdmin (404: ni admite que
// existe). Compone sin firmar; el registro exige a su admin en cadena igual.
router.post('/kyc/register/prepare', requireAdmin, guarded((req: Request, res: Response) => {
  const g = capitalGate(req);
  if (g) return void res.status(g.status).json(g.body);
  const registry = parseEvmAddress(req.body?.registry);
  const user = parseEvmAddress(req.body?.user);
  const approved = req.body?.approved !== false; // default true
  if (!registry) return void badRequest(res, 'registry debe ser una dirección 0x…');
  if (!user) return void badRequest(res, 'user debe ser la cuenta passkey del user (0x…)');
  const n = Number(req.body?.tag);
  if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
    return void badRequest(res, 'tag debe ser un destination tag XRPL (uint32: 0 … 4294967295)');
  }
  const iface = new ethers.Interface(['function setApprovedWithTag(address user, uint256 tag, bool ok)']);
  res.json({
    call: {
      to: registry,
      data: iface.encodeFunctionData('setApprovedWithTag', [user, n, approved]),
      value: '0',
      chainId: FLARE_CHAIN_ID,
      label: `KYC + tag ${n} → ${user}`,
    },
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      title: 'Registrar cliente (KYC + tag) on-chain',
      lines: [
        `Aprueba a ${user} y ata su tag XRPL ${n} en el registro del exchange, on-chain.`,
        'Lo firma el admin del exchange con su wallet; Astryum no firma.',
        'Desde aquí, la salida del user llevará este tag sacado del registro, no tecleado.',
      ],
    },
  });
}));

/**
 * POST /pote-council-order/prepare { council (r-address), action: 'direct-to'|'recall', venueId, amount }
 * Compone la ORDEN DE CONSEJO XRPL para dirigir/recuperar capital del pote
 * institucional (firma el consejo en Xaman; FDC → bridge → directTo/recall). Es
 * el camino correcto cuando el pote NO tiene director cedido: lo autoriza el
 * consejo, no una firma EVM. Reutiliza la infra de órdenes (mismo bridge XLS).
 */
router.post('/pote-council-order/prepare', guarded(async (req: Request, res: Response) => {
  // LA PUERTA SE ELIGE POR ACCIÓN. `recall` trae capital de un venue al colchón
  // del pote — reduce exposición y es lo que deja redimir al holder de un pote
  // síncrono sin colchón —: solo flag (`exitGate`). `direct-to` abre exposición en
  // un venue: flag + geofence (`capitalGate`). Cualquier otra cosa cae en la puerta
  // ESTRICTA antes de que la validación la rechace: nunca se abre por un typo.
  const action = String(req.body?.action ?? '').trim();
  const g = action === 'recall' ? exitGate() : capitalGate(req);
  if (g) return void res.status(g.status).json(g.body);
  const council = String(req.body?.council ?? '').trim();
  const amount = String(req.body?.amount ?? '').trim();
  const venueId = Number(req.body?.venueId);
  if (!XRPL_ADDRESS_RE.test(council)) return void badRequest(res, 'council debe ser una r-address XRPL');
  if (action !== 'direct-to' && action !== 'recall') return void badRequest(res, "action debe ser 'direct-to' o 'recall'");
  if (!Number.isInteger(venueId) || venueId < 0) return void badRequest(res, 'venueId debe ser un entero >= 0');
  if (!/^[0-9]{1,30}$/.test(amount) || BigInt(amount) === 0n) return void badRequest(res, 'amount debe ser un entero positivo (unidades base)');
  const isExit = COUNCIL_ORDER_EXIT_ACTIONS.has(action);
  // Qué cola cuenta esta composición (it. 15, hallazgo 2.1): la del consejo si la
  // sesión lo controla, la suya propia si no — un extraño ya no llena la ajena.
  const preparedByProven = await (await import('../services/flare/ComposedCouncilOrderStore')).sessionProvesCouncil(req, council);
  // it. 17 (2.5): el tope ANTES de `isCageV2Council`, `readPoteState` y el pin.
  // it. 19 (2.6): y ANTES de la guarda de duplicado, que gasta lecturas DE CADENA
  // (hasta tres memos en `ledgerDuplicateCheck`). Preguntarla primero dejaba que
  // quien ya tiene la cola llena provocara lecturas de nodo en cada intento.
  if (await councilQueueFull429(res, council, preparedByProven, req.siwe?.userId ?? null, isExit)) return;
  const duplicate = await councilDuplicateOr409(req, res, council, isExit, { action, params: { venueId, amount } });
  if (!duplicate.proceed) return;
  try {
    const { cageForCouncil, isCageV2Council } = await import('../services/flare/LegacyCageResolver');
    const { buildCouncilOrderHandoff } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');

    // Generación primero: para un consejo v2 esta ruta compondría `directTo`
    // contra la JAULA (que no tiene ese selector) y se firmaría una orden
    // condenada — quórum gastado y prueba FDC pagada para nada. La jaula manda a
    // sus potes; sus órdenes se componen en /cage-order/prepare.
    if (await isCageV2Council(council)) {
      return void res.status(409).json({
        error: 'COUNCIL_GOVERNS_A_CAGE',
        detail:
          'Este consejo gobierna una JAULA (generación v2), no un pote suelto: sus órdenes se componen en ' +
          '/cage-order/prepare, que dirige `cage.directTo(pote, …)` nombrando el pote. Componer aquí sería ' +
          'llamar a un selector que la jaula no tiene: la orden se firmaría, se pagaría la prueba FDC y revertiría.',
      });
    }

    const cage = await cageForCouncil(council);
    if (!cage) {
      return void res.status(409).json({ error: 'NO_CAGE', detail: 'Este consejo no tiene pote resoluble en los factories.' });
    }
    // Pre-flight (el que FALTABA): simula el efecto en el vault ANTES de que el
    // consejo firme. Sin esto se podía firmar una orden condenada — dirigir por
    // encima del suelo de liquidez (BUFFER_FLOOR_BPS) revierte con
    // BufferFloorCrossed en `bridge.execute`, DESPUÉS de firmar y pagar el FDC.
    // Espejamos el revert del contrato como un 409 legible aquí. (El recall solo
    // AUMENTA el buffer, nunca cruza el suelo → no necesita este guard.)
    if (action === 'direct-to') {
      const state = await readPoteState({ rpcUrl: rpcUrl(), pote: cage.vault });
      const verdict = checkPoteDirectTo(state, venueId, BigInt(amount), Math.floor(Date.now() / 1000));
      if (verdict.ok === false) {
        return void res.status(409).json({ error: verdict.code, detail: verdict.detail });
      }
    }
    // Sequence fijada ANTES de componer (readOrderPinOr503): sin lectura, 503 y nada compuesto.
    const pin = await readOrderPinOr503(res, council);
    if (!pin) return;
    const handoff = await buildCouncilOrderHandoff({
      council,
      action: action as 'direct-to' | 'recall',
      params: { venueId, amount },
      cage,
    });
    const xrplTx = pinOrderPayment(handoff.xrplTx, pin);
    // Recordada ANTES de entregarla: si la pantalla que firma se va, el vigía la entrega igual.
    const recorded = await recordComposedOrderOr503(
      res,
      {
        route: 'pote-council-order',
        action,
        council,
        pinnedTx: xrplTx,
        order: handoff.order,
        pin,
        preparedByUserId: req.siwe?.userId ?? null,
        preparedByProven,
        contentKey: duplicate.contentKey,
      },
      { exit: isExit },
    );
    if (!recorded.proceed) return;
    res.json({
      account: council,
      xrplTx,
      order: handoff.order,
      disclosure: handoff.disclosure,
      serverDelivery: recorded.serverDelivery,
      ...(recorded.warning ? { recoveryWarning: recorded.warning } : {}),
      ...(duplicate.duplicateWarning ? { duplicateWarning: duplicate.duplicateWarning } : {}),
      ...(isExit ? await exitTokenFor(council, xrplTx, action) : {}),
    });
  } catch (e) {
    res.status(500).json({ error: 'COUNCIL_ORDER_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /pote-exit/prepare { account: "r…", pote, sharesBase?, amountXrpForMint?, marginBps?, supersede? }
 *
 * LA SALIDA POR DONDE SE ENTRÓ — el corazón del modo no-custodial (Producto A).
 *
 * Hasta ahora quien entraba con su cuenta XRPL no podía salir por ahí: sus
 * participaciones viven en su Personal Account, que no firma sola, y las dos
 * mitades del camino existían sueltas (`/pote-redeem/prepare` construye una call
 * EVM que la PA no puede enviar; `/pote-exit-xrp/prepare` desmintea FXRP que
 * todavía está dentro del pote). Esta ruta las encadena: UNA firma en Xaman y el
 * XRP aterriza en la r-address del usuario.
 *
 * El batch que ejecuta su PA:
 *   1. redeem(shares, PA, PA)            ← saca el FXRP del pote a su propia PA
 *   2. redeemAmount(uba, su r-address)   ← lo desmintea a XRP nativo, a su casa
 *
 * DESTINO. Siempre la MISMA cuenta XRPL que firma. No se acepta un destino
 * arbitrario a propósito: el capital vuelve por donde vino, y así esta ruta no
 * hereda el problema abierto de «acotar el receiver del redeem» que sí tiene el
 * carril custodial. Quien quiera mandarlo a otro sitio lo hace después, desde su
 * wallet, con una transferencia normal que él controla.
 *
 * IMPORTE. `redeem` entrega lo que valgan las participaciones EN EJECUCIÓN; el
 * unmint pide una cifra fija. Se dimensiona a la baja (ver
 * `AstryumPoteExitService.sizeUnmintConservatively`): pedir de más revertiría el
 * batch entero, pedir de menos deja FXRP en su propia PA. Solo uno de los dos
 * errores cuesta dinero.
 *
 * SIN geofence y SIN cap sobre lo que sale (es una salida — el geofence impide
 * abrir exposición, no atrapar capital). El CARRIER sí se capa, pero SOLO por
 * transacción (mintea de verdad): el presupuesto diario por dirección jamás
 * rechaza esta salida — quien depositó hoy puede salir hoy.
 */
router.post('/pote-exit/prepare', guarded(async (req: Request, res: Response) => {
  const g = poteGate();
  if (g) return void res.status(g.status).json(g.body);

  const account = String(req.body?.account ?? '').trim();
  const rawShares = req.body?.sharesBase;
  // Sin carrier explícito: el default que CABE bajo el tope por tx (defaultExitCarrierXrp).
  const amountXrpForMint = String(req.body?.amountXrpForMint ?? (await defaultExitCarrierXrp())).trim();
  const supersede = req.body?.supersede === true;
  // UNMINT OPCIONAL (fundador 8-sep): por defecto el FXRP se queda en la cuenta
  // Flare (la PA); solo si el user lo pide se desmintea a XRP nativo en la misma
  // firma. Solo afecta a la salida INMEDIATA (en cola no hay FXRP hasta el claim).
  const unmint = req.body?.unmint === true;

  if (!XRPL_ADDRESS_RE.test(account)) {
    return void badRequest(res, 'account debe ser tu r-address XRPL (la que firma y a la que vuelve el XRP)');
  }
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(amountXrpForMint) || Number(amountXrpForMint) <= 0) {
    return void badRequest(res, 'amountXrpForMint debe ser XRP positivo (el carrier del 0xFE)');
  }
  if (rawShares !== undefined && (typeof rawShares !== 'string' || !BASE_AMOUNT_RE.test(rawShares))) {
    return void badRequest(res, 'sharesBase, si se pasa, debe ser un entero en unidades base de participación');
  }
  let marginBps: number | undefined;
  if (req.body?.marginBps !== undefined && req.body?.marginBps !== null && req.body?.marginBps !== '') {
    const n = Number(req.body.marginBps);
    if (!Number.isInteger(n) || n < 0) return void badRequest(res, 'marginBps debe ser un entero >= 0');
    marginBps = n;
  }

  const state = await loadState(res, String(req.body?.pote ?? '').trim());
  if (!state) return;

  // El carrier mintea: se capa POR TRANSACCIÓN (radio de explosión). El presupuesto
  // diario por dirección NO aplica a una salida, y lo que SALE del pote no se capa nunca.
  const cappedCarrier = await capitalCap(Number(amountXrpForMint), account, req, { exit: true });
  if (cappedCarrier) return void res.status(cappedCarrier.status).json(cappedCarrier.body);

  try {
    const [
      { readDirectMintParams, computeNetMint, buildDirectMintHandoff, buildRedeemToXrplCall, readMinimumRedeemAmountUBA, mintFeeDisclosure },
      { resolvePersonalAccount },
      { parseBaseUnits },
      { buildPoteExitBatch, buildPoteRedeemCall, buildPoteRequestRedeemCall, sizeUnmintConservatively, PoteExitError },
    ] = await Promise.all([
      import('../connectors/protocols/flare/FlareDirectMintService'),
      import('../connectors/protocols/flare/FlareSmartAccountService'),
      import('../services/flare/LegacyVaultStateService'),
      import('../services/flare/AstryumPoteExitService'),
    ]);
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    // La cuenta que TIENE las participaciones: su Personal Account, derivada de
    // su r-address. Nadie la teclea — se resuelve on-chain vía el MAC.
    const pa = await resolvePersonalAccount(provider, account);
    if (!pa || pa === ethers.ZeroAddress) {
      return void res.status(409).json({
        error: 'NO_PERSONAL_ACCOUNT',
        detail: 'Tu cuenta XRPL todavía no tiene Personal Account en Flare. Entra una vez y se crea sola.',
      });
    }

    // Cuánto puede salir AHORA. `maxRedeem` ya capa por el colchón líquido del
    // pote: es el máximo honesto, no un tope inventado.
    const vault = new ethers.Contract(state.pote, [
      'function maxRedeem(address) view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
      'function previewRedeem(uint256) view returns (uint256)',
    ], provider);
    const [maxShares, balance] = await Promise.all([
      vault.maxRedeem(pa) as Promise<bigint>,
      vault.balanceOf(pa) as Promise<bigint>,
    ]);

    if (balance === 0n) {
      return void res.status(409).json({
        error: 'NO_SHARES',
        detail: 'Esta cuenta no tiene participaciones en este pote.',
        facts: { personalAccount: pa, pote: state.pote },
      });
    }

    // ── SALIDA DE COLA (cooldown > 0): requestRedeem, no redeem inmediato ──
    // Un pote con cooldown no entrega FXRP ahora: quema las participaciones y
    // abre un ticket que madura. `maxRedeem` no aplica (no depende del colchón
    // líquido). El unmint NO va aquí — el FXRP llega al COBRAR el ticket, en un
    // segundo 0xFE (`/pote-claim-exit/prepare`). Una firma Xaman abre la salida.
    if (state.cooldownSeconds > 0) {
      const reqShares = rawShares !== undefined ? BigInt(rawShares) : balance;
      if (reqShares <= 0n) {
        return void badRequest(res, 'No hay participaciones que pedir.');
      }
      if (reqShares > balance) {
        return void res.status(409).json({
          error: 'NOT_ENOUGH_SHARES',
          detail: `Pides ${reqShares} y tienes ${balance}.`,
          facts: { balance: balance.toString() },
        });
      }
      const previewedUBA = await (vault.previewRedeem(reqShares) as Promise<bigint>).catch(() => BigInt(0));
      const requestCall = buildPoteRequestRedeemCall({ pote: state.pote, sharesBase: reqShares, personalAccount: pa });
      const params = await readDirectMintParams(provider);
      const grossXrpDrops = parseBaseUnits(amountXrpForMint, 6);
      const net = computeNetMint(grossXrpDrops, params, undefined);
      const handoff = await buildDirectMintHandoff(
        provider,
        {
          xrplAddress: account,
          grossXrpDrops,
          innerCalls: [{ to: requestCall.to, calldata: requestCall.calldata, value: requestCall.value }],
          action: 'astryum-pote-request-exit',
          supersedePendingNonce: supersede,
          preparedByUserId: req.siwe?.userId ?? null,
          // it. 15 (3.4): una sesión autorizada sobre esta cuenta pasa la guarda de
          // cuenta operativa con una etiqueta de SALIDA — su propia salida jamás se
          // le cierra por estar la cuenta en la lista de Astryum.
          // it. 23 (1.1): y se pregunta con `'exit'`, así que una tienda de pruebas
          // caída sale como 503 REINTENTABLE (`SeatStateUnreadableError` → el catch
          // de abajo, `seatRefusalStatus`) en vez de nacer como fila desplazable.
          ...(await seatProofFieldsFor(req, account, { purpose: 'exit', supersede })),
          // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
          // compone con la ventana de su ceremonia; si no, con la de siempre.
          ...(await ceremonyWindowFor(account)),
        },
        { params },
      );
      const sharesHuman = formatBaseUnits(reqShares, state.shareDecimals);
      const fxrpHuman = formatBaseUnits(previewedUBA, state.asset.decimals);
      const maturityISO = new Date(Date.now() + state.cooldownSeconds * 1000).toISOString();
      return void res.json({
        account,
        pote: state.pote,
        personalAccount: pa,
        mode: 'request',
        maturityISO,
        xrplTx: handoff.xrplPayment,
        memoHex: handoff.memoHex,
        ...zeroFeSigningWindow(handoff),
      ...zeroFeSigningWindow(handoff),
        userOpData: handoff.userOpData,
        // it. 19 (3.4, encargo del agente D): la salida también dice si el vigía
        // entrega su 0xFE. Sin el campo la pantalla no puede distinguir «va en
        // camino» de «no llega nada salvo que lo relances», justo en una salida.
        ...handoffServerDelivery(),
        ...(await exitTokenFor(account, handoff.xrplPayment, 'astryum-pote-request-exit')),
        exit: {
          sharesBase: reqShares.toString(),
          sharesHuman,
          previewedUBA: previewedUBA.toString(),
          unmintUBA: '0',
          marginUBA: '0',
          marginBps: 0,
          // Lo que valdrá el ticket, en el asset del pote (aún no es XRP): BRUTO. La
          // comisión de redención no existe todavía — el FXRP llega al COBRAR el
          // ticket, y es esa ruta la que trae su neto (it. 15, 3.2).
          xrpOutHuman: fxrpHuman,
          xrpOutNetHuman: null,
          xrpOutNetOfRedemptionFee: false,
          partial: reqShares < balance,
        },
        disclosure: {
          disclosedToUser: true,
          astryumSigns: false,
          title: `Pedir la salida de ${sharesHuman} participaciones de ${state.name}`,
          lines: [
            `Este pote tiene una ventana de salida de ${cooldownHuman(state.cooldownSeconds)} (la aceptaste al entrar).`,
            `Firmas UN pago en Xaman: tus participaciones se queman AHORA y el importe queda fijado a ≈ ${fxrpHuman} ${state.asset.symbol}.`,
            `Reclamable a partir de ≈ ${maturityISO}. Al vencer, lo cobras (y se desmintea a XRP) desde aquí mismo — nadie puede impedirlo ni cambiar el destino.`,
            `Carrier del 0xFE: ${amountXrpForMint} XRP (la gasolina del transporte, no una comisión de Astryum).`,
            'Astryum no firma nada: el relayer que porta la prueba no tiene autoridad sobre tu capital.',
          ],
          facts: { ...mintFeeDisclosure(net), pote: state.pote, personalAccount: pa, sharesRequested: reqShares.toString(), maturityISO },
        },
      });
    }

    const shares = rawShares !== undefined ? BigInt(rawShares) : maxShares;
    if (shares === 0n) {
      return void res.status(409).json({
        error: 'NOT_REDEEMABLE_NOW',
        detail:
          state.cooldownSeconds === 0
            ? 'El pote no tiene liquidez para redimir ahora mismo: su capital está trabajando en un venue. El gestor tiene que traerlo al colchón (recall) para que puedas salir.'
            : 'Este pote tiene cooldown: la salida es en dos pasos (pedir ahora, cobrar al vencer).',
        facts: { balance: balance.toString(), maxRedeem: '0', cooldownSeconds: state.cooldownSeconds },
      });
    }
    if (shares > balance) {
      return void res.status(409).json({
        error: 'NOT_ENOUGH_SHARES',
        detail: `Pides ${shares} y tienes ${balance}.`,
        facts: { balance: balance.toString() },
      });
    }
    if (shares > maxShares) {
      return void res.status(409).json({
        error: 'ABOVE_MAX_REDEEM',
        detail:
          `Ahora mismo solo se pueden redimir ${maxShares} participaciones (el resto del capital está en un ` +
          'venue). Sal con esa cantidad, o espera a que el gestor lo traiga al colchón.',
        facts: { requested: shares.toString(), maxRedeem: maxShares.toString() },
      });
    }

    // Lo que el pote entrega por esas participaciones (FXRP a la PA).
    const previewedUBA = (await (vault.previewRedeem(shares) as Promise<bigint>));
    const poteExitCall = buildPoteRedeemCall({ pote: state.pote, sharesBase: shares, personalAccount: pa });

    // UNMINT OPCIONAL: por defecto el FXRP se queda en tu cuenta Flare (la PA);
    // si pides `unmint`, se encadena el desminteo a XRP nativo a tu r-address en
    // la MISMA firma. El destino del unmint es SIEMPRE la cuenta que firma.
    let innerCalls: Array<{ to: string; calldata: string; value: string }>;
    let sizing: { unmintUBA: bigint; marginUBA: bigint; marginBps: number } | null = null;
    if (unmint) {
      const minimumUBA = await readMinimumRedeemAmountUBA(provider).catch(() => BigInt(0));
      sizing = sizeUnmintConservatively({ previewedUBA, minimumUBA, marginBps });
      const unmintCall = await buildRedeemToXrplCall(provider, { amountUBA: sizing.unmintUBA, xrplDestination: account });
      innerCalls = buildPoteExitBatch({ pote: state.pote, poteExitCall, unmintCall });
    } else {
      innerCalls = [{ to: poteExitCall.to, calldata: poteExitCall.calldata, value: '0' }];
    }

    const params = await readDirectMintParams(provider);
    const grossXrpDrops = parseBaseUnits(amountXrpForMint, 6);
    const net = computeNetMint(grossXrpDrops, params, undefined);

    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: unmint ? 'astryum-pote-exit' : 'astryum-pote-exit-fxrp',
        supersedePendingNonce: supersede,
        preparedByUserId: req.siwe?.userId ?? null,
        // it. 23 (1.1): SALIDA — propósito `'exit'`, 503 propagado, y el par
        // `preparedByProven` / `preparedByProofUnreadable` escrito de una vez.
        ...(await seatProofFieldsFor(req, account, { purpose: 'exit', supersede })),
        // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
        // compone con la ventana de su ceremonia; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
      },
      { params },
    );

    const sharesHuman = formatBaseUnits(shares, state.shareDecimals);
    const fxrpHuman = formatBaseUnits(previewedUBA, state.asset.decimals);
    const outHuman = sizing ? formatBaseUnits(sizing.unmintUBA, state.asset.decimals) : fxrpHuman;
    const marginHuman = sizing ? formatBaseUnits(sizing.marginUBA, state.asset.decimals) : '0';
    const carrierMint = formatBaseUnits(net.netToPersonalAccountUBA, 6);
    // it. 13 (4.2): la comisión de redención sobre lo que DE VERDAD se desmintea.
    const redemption = sizing ? await redemptionFeeFor(provider, sizing.unmintUBA) : null;
    const netHuman = redemption?.netUBA != null ? formatBaseUnits(redemption.netUBA, state.asset.decimals) : null;
    const exitAction = unmint ? 'astryum-pote-exit' : 'astryum-pote-exit-fxrp';

    res.json({
      account,
      pote: state.pote,
      personalAccount: pa,
      mode: unmint ? 'sync' : 'sync-fxrp',
      unminted: unmint,
      xrplTx: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      // it. 19 (3.4, encargo del agente D): ver el comentario de la rama `request`.
      ...handoffServerDelivery(),
      ...(await exitTokenFor(account, handoff.xrplPayment, exitAction)),
      exit: {
        sharesBase: shares.toString(),
        sharesHuman,
        previewedUBA: previewedUBA.toString(),
        unmintUBA: sizing ? sizing.unmintUBA.toString() : '0',
        marginUBA: sizing ? sizing.marginUBA.toString() : '0',
        marginBps: sizing ? sizing.marginBps : 0,
        // it. 15 (hallazgo 3.2) — BRUTO Y NETO EN CAMPOS DISTINTOS. `xrpOutHuman`
        // vuelve a ser SIEMPRE el bruto (lo que se desmintea); el neto de la comisión
        // de redención viaja aparte y es null cuando la cifra no se pudo leer. Antes
        // se mandaba el neto en el campo del bruto y la pantalla le restaba la
        // comisión otra vez: dos netos distintos en la misma pantalla.
        xrpOutHuman: outHuman,
        xrpOutNetHuman: netHuman,
        xrpOutNetOfRedemptionFee: false,
        partial: shares < balance,
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        ...(redemption ? { redemptionFeeBips: redemption.redemptionFeeBips, redemptionFeeFxrp: redemption.redemptionFeeFxrp } : {}),
        title: unmint
          ? `Sacar ${sharesHuman} participaciones de ${state.name} a tu cuenta XRPL`
          : `Sacar ${sharesHuman} participaciones de ${state.name} a FXRP en tu cuenta Flare`,
        lines: unmint
          ? [
              netHuman != null
                ? `Firmas UN pago en Xaman; cuando el agente de FAssets pague la redención, tu XRP llega a ${account}: ≈ ${netHuman} XRP netos (se desmintean ${outHuman} ${state.asset.symbol}, menos la comisión de redención).`
                : `Firmas UN pago en Xaman; cuando el agente de FAssets pague la redención, tu XRP llega a ${account}: se desmintean ${outHuman} ${state.asset.symbol}, menos la comisión de redención de FAssets (su cifra no se ha podido leer ahora — NO es cero).`,
              `Sale del pote a tu cuenta Flare (${pa}) y se desmintea a XRP en la misma operación.`,
              `Se pide desmintear un poco menos de lo previsto (${marginHuman} ${state.asset.symbol} de margen): el precio de la participación puede moverse mientras la red prueba tu firma. Ese margen NO se pierde — se queda en ${state.asset.symbol} en tu propia cuenta y puedes sacarlo cuando quieras.`,
              (redemption as NonNullable<typeof redemption>).line,
              `Carrier del 0xFE: ${amountXrpForMint} XRP → ≈ ${carrierMint} ${state.asset.symbol} extra en tu cuenta Flare (es la gasolina del transporte, no una comisión de Astryum).`,
              'Astryum no firma nada: el relayer que porta la prueba no tiene autoridad sobre tu capital.',
            ]
          : [
              `Firmas UN pago en Xaman y tu FXRP vuelve a tu cuenta Flare (${pa}): ≈ ${fxrpHuman} ${state.asset.symbol}. Se queda ahí, listo para usar o desmintear a XRP cuando quieras.`,
              `Carrier del 0xFE: ${amountXrpForMint} XRP → ≈ ${carrierMint} ${state.asset.symbol} extra en tu cuenta Flare (la gasolina del transporte, no una comisión de Astryum).`,
              'Astryum no firma nada: el relayer que porta la prueba no tiene autoridad sobre tu capital.',
            ],
        facts: {
          ...mintFeeDisclosure(net),
          pote: state.pote,
          personalAccount: pa,
          xrplDestination: unmint ? account : null,
          sharesRedeemed: shares.toString(),
          // Estimación NETA de la comisión de redención; null si la cifra no se pudo leer (jamás el bruto como promesa).
          estXrpOut: unmint ? netHuman : null,
          unmintedFxrp: unmint ? outHuman : null,
        },
      },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'OperationalAccountHandoffError') {
      return void res.status(403).json({ error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) });
    }
    if (name === 'NonceSeatTakenError') {
      // it. 15: el CÓDIGO exacto del asiento (…_SIGNED / _REPORTED / _UNREADABLE) y si
      // reintentar puede servir — la pantalla ofrecía «Reintentar liberando el asiento»
      // en bucle porque todos llegaban como un NONCE_SEAT_TAKEN plano.
      // it. 17: el cuerpo ENTERO (cuenta atrás, ventana y, a quien puede tocarla, el
      // memo de la fila que bloquea) — un código a secas es un callejón.
      return void res.status(seatRefusalStatus(e)).json(nonceSeatBody(e));
    }
    if (name === 'PoteExitError') {
      const code = (e as { code?: string }).code ?? 'POTE_EXIT_INVALID';
      return void res.status(409).json({ error: code, detail: safeErrorDetail(e) });
    }
    res.status(500).json({ error: 'POTE_EXIT_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /pote-claim-exit/prepare { account: "r…", pote, ticketId, amountXrpForMint?, marginBps?, supersede? }
 *
 * EL COBRO de la salida de cola, por 0xFE — el segundo paso del exit no-custodial
 * (el primero es `/pote-exit/prepare` en su rama de cola). El ticket ya venció;
 * esta ruta encadena en UNA firma Xaman el batch que ejecuta la PA:
 *   1. claimRedeem(ticketId, venueClaims)  ← el pote paga a la PA el FXRP FIJADO
 *   2. redeemAmount(uba, su r-address)      ← lo desmintea a XRP nativo, a su casa
 *
 * El ticket TIENE que ser de la PA de quien firma (su receiver): esta es la
 * puerta no-custodial. El destino del XRP es su misma r-address (no se acepta
 * otro), igual que la salida inmediata. Astryum no firma; el relayer no manda.
 */
router.post('/pote-claim-exit/prepare', guarded(async (req: Request, res: Response) => {
  const g = poteGate();
  if (g) return void res.status(g.status).json(g.body);
  const account = String(req.body?.account ?? '').trim();
  const id = Number(req.body?.ticketId);
  // Sin carrier explícito: el default que CABE bajo el tope por tx (defaultExitCarrierXrp).
  const amountXrpForMint = String(req.body?.amountXrpForMint ?? (await defaultExitCarrierXrp())).trim();
  const supersede = req.body?.supersede === true;
  const unmint = req.body?.unmint === true; // por defecto el FXRP se queda en la PA
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser tu r-address XRPL');
  if (!Number.isInteger(id) || id < 0) return void badRequest(res, 'ticketId debe ser un entero ≥ 0');
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(amountXrpForMint) || Number(amountXrpForMint) <= 0) {
    return void badRequest(res, 'amountXrpForMint debe ser XRP positivo (el carrier del 0xFE)');
  }
  let marginBps: number | undefined;
  if (req.body?.marginBps !== undefined && req.body?.marginBps !== null && req.body?.marginBps !== '') {
    const n = Number(req.body.marginBps);
    if (!Number.isInteger(n) || n < 0) return void badRequest(res, 'marginBps debe ser un entero >= 0');
    marginBps = n;
  }
  const state = await loadState(res, String(req.body?.pote ?? '').trim());
  if (!state) return;

  const verdict = checkClaimRedeem(state, id, Math.floor(Date.now() / 1000));
  if (verdict.ok === false) return void res.status(409).json({ error: verdict.code, ...verdict });

  // Carrier: tope POR TRANSACCIÓN solamente — cobrar una salida vencida jamás lo
  // rechaza el presupuesto diario por dirección.
  const cappedCarrier = await capitalCap(Number(amountXrpForMint), account, req, { exit: true });
  if (cappedCarrier) return void res.status(cappedCarrier.status).json(cappedCarrier.body);

  try {
    const [
      { readDirectMintParams, computeNetMint, buildDirectMintHandoff, buildRedeemToXrplCall, readMinimumRedeemAmountUBA, mintFeeDisclosure },
      { resolvePersonalAccount },
      { parseBaseUnits, formatBaseUnits },
      { buildPoteExitBatch, buildPoteClaimRedeemCall, sizeUnmintConservatively },
    ] = await Promise.all([
      import('../connectors/protocols/flare/FlareDirectMintService'),
      import('../connectors/protocols/flare/FlareSmartAccountService'),
      import('../services/flare/LegacyVaultStateService'),
      import('../services/flare/AstryumPoteExitService'),
    ]);
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    const pa = await resolvePersonalAccount(provider, account);
    if (!pa || pa === ethers.ZeroAddress) {
      return void res.status(409).json({ error: 'NO_PERSONAL_ACCOUNT', detail: 'Tu cuenta XRPL todavía no tiene Personal Account en Flare.' });
    }
    const ticket = state.tickets[id];
    // El ticket tiene que ser de la PA de quien firma: esta ruta cobra por 0xFE
    // a esa PA. Si el receiver es otra cuenta, se cobra desde donde se pidió.
    if (ticket.receiver.toLowerCase() !== pa.toLowerCase()) {
      return void res.status(409).json({
        error: 'TICKET_NOT_PA',
        detail: 'Este ticket no es de tu Personal Account; cóbralo desde la wallet que pidió la salida.',
        facts: { ticketReceiver: ticket.receiver, personalAccount: pa },
      });
    }

    // Colas de venue maduras que se cobran en la MISMA tx (mismo escaneo que la
    // ruta EVM: hoy solo Firelight, por periodos ya reclamables).
    //
    // GUARDA (incidente 10-sep): si el COLCHÓN del pote ya cubre este ticket
    // —p. ej. el gestor recuperó el capital del venue al buffer con un recall—,
    // se paga del colchón y venueClaims queda VACÍO. Añadir un venueClaim de un
    // periodo YA recogido hace REVERTIR claimRedeem, y el claim se quedaba
    // aparcado reintentando (el escaneo del adapter seguía marcando ese periodo
    // «claimable» aunque el pote ya no lo tuviera). Solo se escanean colas si el
    // colchón NO llega al importe fijado del ticket.
    // it. 34 — same two reads, same rule as the EVM route (venueClaimCoverage):
    // an unreadable cushion is a 502, and unread periods with a short cover do
    // not compose (the 0xFE would carry a claimRedeem doomed to UnwindShortfall
    // — and on this rail the carrier XRP is spent too).
    const cushionRead = await readPoteCushion(provider, state);
    if (cushionRead.ok === false) return void res.status(502).json(cushionUnreadableBody(state, cushionRead.detail));
    const cushionUBA = cushionRead.value;
    let venueClaims: Array<{ venueId: bigint; period: bigint }> = [];
    const claimNotes: string[] = [];
    if (cushionUBA < BigInt(ticket.assets)) {
      const sweep = await sweepFirelightForClaim(state, provider);
      const coverage = venueClaimCoverage({
        cushionUBA,
        ticketUBA: BigInt(ticket.assets),
        claimableUBA: sweep.claimableUBA,
        unreadablePeriods: sweep.unreadablePeriods,
        sweepFailed: sweep.sweepFailed,
      });
      if (coverage.unread && !coverage.covered) {
        return void res.status(502).json(queueUnreadableBody(state, sweep, coverage.shortfallUBA));
      }
      venueClaims = sweep.venueClaims.map((c) => ({ venueId: BigInt(c.venueId), period: BigInt(c.period) }));
      if (coverage.unread) claimNotes.push(unreadPeriodsNote(sweep));
    }

    const claimCall = buildPoteClaimRedeemCall({ pote: state.pote, ticketId: BigInt(id), venueClaims });
    // UNMINT OPCIONAL: por defecto el FXRP cobrado se queda en tu cuenta Flare;
    // solo si lo pides se desmintea a XRP nativo en la misma firma.
    let innerCalls: Array<{ to: string; calldata: string; value: string }>;
    let sizing: { unmintUBA: bigint; marginUBA: bigint; marginBps: number } | null = null;
    if (unmint) {
      const minimumUBA = await readMinimumRedeemAmountUBA(provider).catch(() => BigInt(0));
      sizing = sizeUnmintConservatively({ previewedUBA: BigInt(ticket.assets), minimumUBA, marginBps });
      const unmintCall = await buildRedeemToXrplCall(provider, { amountUBA: sizing.unmintUBA, xrplDestination: account });
      innerCalls = buildPoteExitBatch({ pote: state.pote, poteExitCall: claimCall, unmintCall });
    } else {
      innerCalls = [{ to: claimCall.to, calldata: claimCall.calldata, value: '0' }];
    }

    const params = await readDirectMintParams(provider);
    const grossXrpDrops = parseBaseUnits(amountXrpForMint, 6);
    const net = computeNetMint(grossXrpDrops, params, undefined);
    const claimAction = unmint ? 'astryum-pote-claim-exit' : 'astryum-pote-claim-exit-fxrp';
    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: claimAction,
        supersedePendingNonce: supersede,
        preparedByUserId: req.siwe?.userId ?? null,
        // it. 23 (1.1): SALIDA (cobro del ticket) — propósito `'exit'`.
        ...(await seatProofFieldsFor(req, account, { purpose: 'exit', supersede })),
        // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
        // compone con la ventana de su ceremonia; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
      },
      { params },
    );

    const ticketHuman = formatBaseUnits(BigInt(ticket.assets), state.asset.decimals);
    const outHuman = sizing ? formatBaseUnits(sizing.unmintUBA, state.asset.decimals) : ticketHuman;
    // it. 13 (4.2): la comisión de redención sobre lo que DE VERDAD se desmintea.
    const redemption = sizing ? await redemptionFeeFor(provider, sizing.unmintUBA) : null;
    const netHuman = redemption?.netUBA != null ? formatBaseUnits(redemption.netUBA, state.asset.decimals) : null;
    res.json({
      account,
      pote: state.pote,
      personalAccount: pa,
      mode: 'claim',
      unminted: unmint,
      ticketId: id,
      // it. 34 — the venue queues this claim collects, and what could not be read
      // (same fields the EVM route answers; empty when the buffer paid alone).
      venueClaims: venueClaims.map((c) => ({ venueId: Number(c.venueId), period: Number(c.period) })),
      notes: claimNotes,
      xrplTx: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      // it. 19 (3.4, encargo del agente D): el cobro del ticket también es un 0xFE.
      ...handoffServerDelivery(),
      ...(await exitTokenFor(account, handoff.xrplPayment, claimAction)),
      exit: {
        sharesBase: '0',
        sharesHuman: '0',
        previewedUBA: ticket.assets,
        unmintUBA: sizing ? sizing.unmintUBA.toString() : '0',
        marginUBA: sizing ? sizing.marginUBA.toString() : '0',
        marginBps: sizing ? sizing.marginBps : 0,
        // it. 15 (3.2): bruto en `xrpOutHuman`, neto aparte (null si no se pudo leer).
        xrpOutHuman: outHuman,
        xrpOutNetHuman: netHuman,
        xrpOutNetOfRedemptionFee: false,
        partial: false,
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        ...(redemption ? { redemptionFeeBips: redemption.redemptionFeeBips, redemptionFeeFxrp: redemption.redemptionFeeFxrp } : {}),
        title: `Cobrar la salida del ticket #${id} de ${state.name}`,
        lines: unmint
          ? [
              `El pote paga lo fijado al pedir la salida: ${ticketHuman} ${state.asset.symbol}.`,
              netHuman != null
                ? `Firmas UN pago en Xaman; cuando el agente de FAssets pague la redención, tu XRP llega a ${account}: ≈ ${netHuman} XRP netos (se desmintean ${outHuman} ${state.asset.symbol}, menos la comisión de redención).`
                : `Firmas UN pago en Xaman; cuando el agente de FAssets pague la redención, tu XRP llega a ${account}: se desmintean ${outHuman} ${state.asset.symbol}, menos la comisión de redención de FAssets (su cifra no se ha podido leer ahora — NO es cero).`,
              (redemption as NonNullable<typeof redemption>).line,
              `Carrier del 0xFE: ${amountXrpForMint} XRP (la gasolina del transporte, no una comisión de Astryum).`,
              'Cualquiera puede completar este cobro; el destino no lo puede cambiar nadie. Astryum no firma.',
            ]
          : [
              `El pote paga lo fijado al pedir la salida: ${ticketHuman} ${state.asset.symbol}, y se queda en FXRP en tu cuenta Flare (${pa}).`,
              `Carrier del 0xFE: ${amountXrpForMint} XRP (la gasolina del transporte, no una comisión de Astryum).`,
              'Cualquiera puede completar este cobro; el destino no lo puede cambiar nadie. Astryum no firma.',
            ],
        facts: {
          ...mintFeeDisclosure(net),
          pote: state.pote,
          personalAccount: pa,
          ticketId: id,
          estXrpOut: unmint ? netHuman : null,
          unmintedFxrp: unmint ? outHuman : null,
        },
      },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'OperationalAccountHandoffError') return void res.status(403).json({ error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) });
    if (name === 'NonceSeatTakenError') {
      // it. 17: el cuerpo ENTERO (cuenta atrás, ventana y, a quien puede tocarla, el
      // memo de la fila que bloquea) — un código a secas es un callejón.
      return void res.status(seatRefusalStatus(e)).json(nonceSeatBody(e));
    }
    if (name === 'PoteExitError') return void res.status(409).json({ error: (e as { code?: string }).code ?? 'POTE_EXIT_INVALID', detail: safeErrorDetail(e) });
    res.status(500).json({ error: 'POTE_CLAIM_EXIT_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /pote-creator-exit/prepare { account: "r…" (consejo), pote?: "0x…", amountXrpForMint? }
 * Saca el capital GÉNESIS (las participaciones del creador) del pote. El génesis
 * vive en la Personal Account del consejo (Z10 anti-inflación) y NADIE más puede
 * moverlo: el batch de creación no aprobó a ningún tercero sobre esas shares. Así
 * que se compone UN `0xFE` cuyo innerCall es `redeem(shares, PA, PA)` → el FXRP
 * sale del pote a la PA del creador. El consejo firma (su quórum) en Xaman;
 * Astryum no firma y el relayer que porta la prueba tiene cero autoridad.
 * Mint-coupled como todo 0xFE: el carrier mintea un poco de FXRP extra en la PA
 * (nada se pierde). Redime TODO lo redimible AHORA (limitado por el buffer líquido).
 */
router.post('/pote-creator-exit/prepare', guarded(async (req: Request, res: Response) => {
  const g = poteGate();
  if (g) return void res.status(g.status).json(g.body);
  const account = String(req.body?.account ?? '').trim();
  const bodyPote = req.body?.pote ? String(req.body.pote).trim() : '';
  const amountXrpForMint = String(req.body?.amountXrpForMint ?? '2').trim();
  // Solo seguro si el 0xFE anterior en ese asiento NO llegó a firmarse (regla:
  // lo FIRMADO ni caduca ni se libera ni se supersede). Default off.
  const supersede = req.body?.supersede === true;
  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser la r-address del consejo');
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(amountXrpForMint) || Number(amountXrpForMint) <= 0) {
    return void badRequest(res, 'amountXrpForMint debe ser XRP positivo (el carrier del mint 0xFE)');
  }
  const factoryAddress = process.env.ASTRYUM_FACTORY_ADDRESS;
  if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
    return void res.status(503).json({ error: 'FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_FACTORY_ADDRESS.' });
  }
  try {
    const [
      { resolveAstryumPote },
      { readDirectMintParams, computeNetMint, buildDirectMintHandoff, mintFeeDisclosure },
      { resolvePersonalAccount },
      { parseBaseUnits },
    ] = await Promise.all([
      import('../services/flare/AstryumPoteCreationService'),
      import('../connectors/protocols/flare/FlareDirectMintService'),
      import('../connectors/protocols/flare/FlareSmartAccountService'),
      import('../services/flare/LegacyVaultStateService'),
    ]);
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    // El pote del consejo: del body si viene, si no lo resuelve el factory.
    let pote = parseEvmAddress(bodyPote);
    if (!pote) {
      const resolved = await resolveAstryumPote(provider, factoryAddress, account);
      if (!resolved) {
        return void res.status(409).json({ error: 'NO_POTE', detail: 'Este consejo no tiene pote resoluble en el factory.' });
      }
      pote = ethers.getAddress(resolved.vault);
    }

    const pa = await resolvePersonalAccount(provider, account);
    if (!pa || pa === ethers.ZeroAddress) {
      return void res.status(409).json({ error: 'NO_PERSONAL_ACCOUNT', detail: 'El consejo no tiene Personal Account resoluble.' });
    }

    // Cuánto sale: TODO lo redimible AHORA (maxRedeem capa por el buffer líquido).
    const vault = new ethers.Contract(pote, [
      'function maxRedeem(address) view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
      'function previewRedeem(uint256) view returns (uint256)',
    ], provider);
    const [shares, bal] = await Promise.all([
      vault.maxRedeem(pa) as Promise<bigint>,
      vault.balanceOf(pa) as Promise<bigint>,
    ]);
    if (bal === 0n) {
      return void res.status(409).json({ error: 'NO_GENESIS', detail: 'La cuenta creadora no tiene participaciones en este pote (nada que sacar).' });
    }
    if (shares === 0n) {
      return void res.status(409).json({
        error: 'NOT_REDEEMABLE_NOW',
        detail: 'El pote no tiene liquidez para redimir el génesis ahora (el capital está en un venue). Recupéralo al buffer primero (recall).',
      });
    }
    const estFxrp = (await vault.previewRedeem(shares)) as bigint;

    // La única pierna: la PA redime SUS propias shares (msg.sender == owner == PA,
    // sin allowance) y el FXRP va a la propia PA — fuera del pote, en el creador.
    const redeemLeg = {
      to: pote,
      calldata: POTE_IFACE.encodeFunctionData('redeem', [shares, pa, pa]),
      value: '0',
    };

    const params = await readDirectMintParams(provider);
    const grossXrpDrops = parseBaseUnits(amountXrpForMint, 6);
    const net = computeNetMint(grossXrpDrops, params, undefined);

    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls: [redeemLeg],
        action: 'astryum-creator-exit',
        supersedePendingNonce: supersede,
        preparedByUserId: req.siwe?.userId ?? null,
        // it. 23 (1.1): SALIDA del creador — propósito `'exit'`.
        ...(await seatProofFieldsFor(req, account, { purpose: 'exit', supersede })),
        // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
        // compone con la ventana de su ceremonia; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
      },
      { params },
    );

    const sharesHuman = formatBaseUnits(shares, 9);
    const fxrpHuman = formatBaseUnits(estFxrp, 6);
    const carrierMint = formatBaseUnits(net.netToPersonalAccountUBA, 6);
    res.json({
      account,
      pote,
      personalAccount: handoff.personalAccount,
      xrplTx: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      // it. 19 (3.4, encargo del agente D): la salida del creador también es un 0xFE.
      ...handoffServerDelivery(),
      // Simetría (it. 13): la salida del creador la firma un consejo multifirma por /multisign/prepare.
      ...(await exitTokenFor(account, handoff.xrplPayment, 'astryum-creator-exit')),
      redeem: { shares: shares.toString(), estFxrp: fxrpHuman },
      order: {
        summary: `Sacar el génesis del creador: redime ${sharesHuman} participaciones → ≈ ${fxrpHuman} FXRP del pote a la PA del consejo.`,
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Sacar el capital génesis del creador',
        note: `El consejo firma UN pago 0xFE (${amountXrpForMint} XRP de carrier) y su Personal Account (${handoff.personalAccount}) redime ${sharesHuman} participaciones → ≈ ${fxrpHuman} FXRP salen del pote a esa misma PA. Mint-coupled: el carrier mintea ≈ ${carrierMint} FXRP extra en la PA (nada se pierde). Astryum no firma; el relayer que porta la prueba tiene cero autoridad.`,
        lines: [
          `Redime ${sharesHuman} participaciones del génesis → ≈ ${fxrpHuman} FXRP a la PA del consejo.`,
          `Carrier del mint 0xFE: ${amountXrpForMint} XRP → ≈ ${carrierMint} FXRP extra en la PA.`,
          'Requiere el quórum del consejo (multisig) en Xaman — nadie más puede mover el capital del creador.',
        ],
        facts: {
          ...mintFeeDisclosure(net),
          pote,
          personalAccount: handoff.personalAccount,
          sharesRedeemed: shares.toString(),
          estFxrpOut: fxrpHuman,
        },
      },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'OperationalAccountHandoffError') {
      return void res.status(403).json({ error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) });
    }
    if (name === 'NonceSeatTakenError') {
      // it. 15: el CÓDIGO exacto del asiento (…_SIGNED / _REPORTED / _UNREADABLE) y si
      // reintentar puede servir — la pantalla ofrecía «Reintentar liberando el asiento»
      // en bucle porque todos llegaban como un NONCE_SEAT_TAKEN plano.
      // it. 17: el cuerpo ENTERO (cuenta atrás, ventana y, a quien puede tocarla, el
      // memo de la fila que bloquea) — un código a secas es un callejón.
      return void res.status(seatRefusalStatus(e)).json(nonceSeatBody(e));
    }
    res.status(500).json({ error: 'CREATOR_EXIT_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /council/anchor/prepare { account (r-address del consejo), documentSha256Hex, documentUri? }
 * Ancla la constitución del consejo del exchange en XRPL (DIDSet con el SHA-256
 * del documento en Data). REQUISITO para crear el pote: sin ancla, el nacimiento
 * se niega (CONSTITUTION_NOT_ANCHORED). El documento NUNCA viaja — solo su huella.
 * Lo firma el consejo (su quórum) en Xaman. Astryum no firma.
 */
router.post('/council/anchor/prepare', guarded(async (req: Request, res: Response) => {
  const g = poteGate();
  if (g) return void res.status(g.status).json(g.body);
  try {
    const { buildConstitutionAnchor } = await import('../connectors/protocols/xrpl/XrplDidService');
    const { account, documentSha256Hex, documentUri } = req.body ?? {};
    const handoff = buildConstitutionAnchor({
      account: String(account ?? '').trim(),
      documentSha256Hex: String(documentSha256Hex ?? '').trim(),
      documentUri: documentUri ? String(documentUri).trim() : undefined,
    });
    res.json({
      account: (handoff.xrplTx as { Account: string }).Account,
      xrplTx: handoff.xrplTx,
      disclosure: handoff.disclosure,
    });
  } catch (e) {
    res.status(400).json({ error: 'ANCHOR_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /domain/set/prepare { owner, issuer, credentialType?, domainID? } — el
 * exchange crea/actualiza su Permissioned Domain (XLS-80): el perímetro regulado
 * ON-LEDGER, gateado por su credencial KYC (XLS-70). Ser miembro del dominio =
 * tener KYC de este exchange, demostrable en el ledger. Devuelve el
 * `PermissionedDomainSet` sin firmar; lo firma el dueño (exchange). Astryum no firma.
 */
router.post('/domain/set/prepare', guarded(async (req: Request, res: Response) => {
  const g = poteGate();
  if (g) return void res.status(g.status).json(g.body);
  try {
    const { composePermissionedDomainSet } = await import('../services/XrplPermissionedDomainService');
    const { owner, issuer, credentialType, domainID } = req.body ?? {};
    // The domain OWNER (the exchange) signs it in Xaman: tagged to that signer.
    const tx = withSourceTag(
      composePermissionedDomainSet({
        owner: String(owner ?? '').trim(),
        acceptedCredentials: [{ issuer: String(issuer ?? '').trim(), credentialType }],
        domainID: domainID ? String(domainID).trim() : undefined,
      }),
      attributionForSigner(String(owner ?? '')),
    );
    res.json({
      xrplTx: tx,
      account: tx.Account,
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: domainID ? 'Actualizar el perímetro regulado' : 'Crear el perímetro regulado (Permissioned Domain)',
        lines: [
          'El dominio acepta tu credencial KYC: ser miembro = tener KYC de este exchange, demostrable en el ledger.',
          'Lo firma el exchange (dueño del dominio); Astryum no firma. Sin datos personales on-ledger.',
        ],
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    res.status(code ? 400 : 500).json({ error: code ?? 'DOMAIN_SET_FAILED', detail: safeErrorDetail(e) });
  }
}));

// ── LA JAULA v2 (AstryumCage): catálogo, nacimiento y órdenes ───────────────
//
// La jaula no custodia: manda. Sus rutas siguen el mismo patrón que las del
// pote — prepare-only, geofence en lo que abre exposición, cap en lo que mintea,
// y pre-flight de todo lo que reventaría en `bridge.execute` DESPUÉS de firmar
// y de pagar la ronda FDC. El relay que ejecuta las órdenes es el de siempre:
// resuelve de quién es la orden por el remitente, y la factory de jaulas es el
// cuarto registro que consulta (`LegacyCageResolver`).

/**
 * GET /cages[?council=r…] — las jaulas v2, leídas de su factory. Lectura
 * abierta (estado público). Orden de creación, sin ranking. Una jaula ilegible
 * se marca, no se esconde.
 */
/**
 * GET /registry/venues — la whitelist de Astryum (el scanner), leída de la cadena.
 *
 * Lo que un gestor ve al elegir dónde puede trabajar su pote, y contra lo que un
 * depositante puede comprobar la jaula. Pública, en orden de alta, con estado
 * (activa / pendiente de timelock / retirada). Sin ranking y sin juicio: está lo
 * que pasó el scanner. El registro se resuelve desde la factory configurada.
 */
router.get('/registry/venues', guarded(async (_req: Request, res: Response) => {
  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const factory = astryumCageFactoryAddress();
  if (!factory) {
    return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
  }
  try {
    const [{ readFactoryTerms }, { readRegistryVenues }] = await Promise.all([
      import('../services/flare/AstryumCageCreationService'),
      import('../services/flare/AstryumRegistryReadService'),
    ]);
    const provider = new ethers.JsonRpcProvider(rpcUrl());
    const terms = await readFactoryTerms(provider, factory);
    const list = await readRegistryVenues(provider, terms.registry);
    res.json({ factory, order: 'listing', ...list });
  } catch (e) {
    res.status(502).json({ error: 'REGISTRY_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * El nacimiento FIRMADO de una cuenta que aún no ha ejecutado, o null. Lectura
 * best-effort: si el registro no se puede leer, la mesa no se bloquea (null).
 */
async function birthInFlightFor(account: string): Promise<{ signedAt: string; signedTxHash: string | null; memoHex: string } | null> {
  try {
    const { findInFlightHandoffByXrplAddress } = await import('../services/flare/DirectMintHandoffStore');
    const found = await findInFlightHandoffByXrplAddress(account, 'astryum-cage-create');
    return found ? { signedAt: found.signedAt, signedTxHash: found.signedTxHash, memoHex: found.memoHex } : null;
  } catch {
    return null;
  }
}

router.get('/cages', guarded(async (req: Request, res: Response) => {
  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const factory = astryumCageFactoryAddress();
  if (!factory) {
    return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
  }
  try {
    const { listCages, readCageSummary, resolveAstryumCage, readFactoryTerms } = await import(
      '../services/flare/AstryumCageCreationService'
    );
    const provider = flareReadProvider(rpcUrl());
    const council = String(req.query.council ?? '').trim();

    if (council) {
      if (!XRPL_ADDRESS_RE.test(council)) return void badRequest(res, 'council debe ser una r-address');
      // La jaula de UNA cuenta, de caché (CAGE_OF_SWR): la mesa, el wizard y el
      // creador la piden varias veces por pantalla. «Sin jaula» también se
      // cachea (la ventana fresca es corta; el creador que espera la relee).
      const body = await swr(`cage-of:${factory.toLowerCase()}:${council}`, CAGE_OF_SWR, async () => {
        const found = await resolveAstryumCage(provider, factory, council);
        if (!found) return { factory, council, cage: null as null };
        const summary = await readCageSummary(provider, found.cage);
        return { factory, council, bridge: found.bridge, cage: summary ?? { cage: found.cage, unreadable: true } };
      });
      // El nacimiento en vuelo viaja FUERA de la caché: es lo que le dice a la
      // estación «ya firmaste, no hay nada que firmar» antes de que la factory
      // conozca la jaula (fundador 2026-09-15).
      const birthInFlight = body.cage ? null : await birthInFlightFor(council);
      return void res.json({ ...body, birthInFlight });
    }

    const { addresses, terms, cages } = await swr(`cages:${factory.toLowerCase()}`, CATALOG_SWR, async () => {
      const [addresses, terms] = await Promise.all([
        listCages(provider, factory),
        readFactoryTerms(provider, factory).catch(() => null),
      ]);
      // En serie: pocas jaulas, varias lecturas cada una — no comerse el RPC compartido.
      const cages: unknown[] = [];
      for (const a of addresses) {
        const s = await readCageSummary(provider, a);
        cages.push(s ?? { cage: a, unreadable: true });
      }
      return { addresses, terms, cages };
    });
    void addresses;
    res.json({
      factory,
      order: 'creation',
      terms: terms
        ? {
            creationFee: terms.creationFee.toString(),
            treasury: terms.treasury,
            registry: terms.registry,
            freePotesPerCage: terms.freePotesPerCage,
            maxPayeeBpsAllowed: terms.maxPayeeBpsAllowed,
          }
        : null,
      cages,
    });
  } catch (e) {
    res.status(502).json({ error: 'CAGE_CATALOG_FAILED', detail: safeErrorDetail(e) });
  }
}));

/**
 * POST /cage-create/prepare { account: "r…", amountXrp, allowedTargets: [{chainId, target}], asset? }
 *
 * Una jaula nace de UNA firma de su cuenta XRPL: su Personal Account llama a la
 * factory (0xFE). Sin génesis — la jaula no custodia. Lo que sí va en el mismo
 * batch es la aprobación de la fee de creación de potes: el FXRP que el carrier
 * mintea en la PA es exactamente la gasolina de los primeros `createPote`.
 *
 * La lista eterna la elige el consejo AQUÍ y no cambia jamás: cada destino tiene
 * que estar ya en el registro de Astryum, o la factory revierte al nacer.
 */
router.post('/cage-create/prepare', guarded(async (req: Request, res: Response) => {
  const g = capitalGate(req);
  if (g) return void res.status(g.status).json(g.body);

  const account = String(req.body?.account ?? '').trim();
  const amountXrp = String(req.body?.amountXrp ?? '').trim();
  const rawTargets = req.body?.allowedTargets;
  const asset = parseEvmAddress(req.body?.asset) ?? parseEvmAddress(process.env.FXRP_TOKEN);

  if (!XRPL_ADDRESS_RE.test(account)) return void badRequest(res, 'account debe ser la cuenta XRPL que gobernará la jaula');
  if (!amountXrp || !/^[0-9]+(\.[0-9]{1,6})?$/.test(amountXrp) || Number(amountXrp) <= 0) {
    return void badRequest(res, 'amountXrp es obligatorio (el carrier del 0xFE; lo que mintee queda en tu PA para las fees de creación)');
  }
  // La lista eterna es OPCIONAL (27-ago): ausente o vacía = la jaula sigue al
  // registro de Astryum tal y como esté cada día. Si viene, es para siempre.
  if (rawTargets !== undefined && rawTargets !== null && !Array.isArray(rawTargets)) {
    return void badRequest(res, 'allowedTargets, si viene, debe ser una lista [{chainId, target}] (vacía = sigue al registro)');
  }
  if (!asset) return void res.status(503).json({ error: 'ASSET_UNCONFIGURED', detail: 'Falta FXRP_TOKEN.' });
  // UN NACIMIENTO FIRMADO EN VUELO CIERRA LA PUERTA (fundador 2026-09-15: «me
  // chirría que te deje firmar dos veces el mismo tema»). Mientras el 0xFE
  // firmado espera su prueba, componer otro sería un segundo pago del carrier
  // por una jaula que la factory revertirá (CageAlreadyExists). 409, con la
  // misma salida explícita que las órdenes: `confirmAnotherOrder: true`.
  {
    const inFlight = await birthInFlightFor(account);
    if (inFlight && req.body?.confirmAnotherOrder !== true) {
      const minutes = Math.max(0, Math.round((Date.now() - new Date(inFlight.signedAt).getTime()) / 60_000));
      return void res.status(409).json({
        error: 'CAGE_BIRTH_IN_FLIGHT',
        detail: `This account already signed the birth of its cage ${minutes} min ago and it is being proven on Flare${inFlight.signedTxHash ? ` (${inFlight.signedTxHash})` : ''}. Nothing to sign again: the cage appears on its own once proven.`,
        launchedAt: inFlight.signedAt,
        minutesAgo: minutes,
        xrplTxHash: inFlight.signedTxHash,
        memoHex: inFlight.memoHex,
      });
    }
  }

  // El carrier mintea: cuenta contra el presupuesto como cualquier mint.
  const cappedCarrier = await capitalCap(Number(amountXrp), account, req);
  if (cappedCarrier) return void res.status(cappedCarrier.status).json(cappedCarrier.body);

  // La puerta del TÍTULO DE GESTOR (AIFMD): sin credencial vigente de un emisor
  // acreditado no se hace nacer una jaula. PUESTA EN CÓDIGO desde el 20-sep
  // (`managerGateEnforced`): en producción ninguna variable la apaga, y fuera solo
  // un `MANAGER_GATE_ENABLED=false` explícito. El ledger la hará cumplir de verdad; esto es el
  // pre-flight, para no firmar el 0xFE de una jaula condenada.
  {
    const { managerGateConfig, checkManagerCredential, managerGateRefusal } = await import('../services/ManagerCredentialGate');
    if (managerGateConfig().enabled) {
      // El gestor puede PRESENTAR su VC off-ledger del partner (opcional); si no,
      // vale la XLS-70 on-ledger. El gate prueba las dos.
      const verdict = await checkManagerCredential(account, typeof req.body?.managerCredentialJwt === 'string' ? req.body.managerCredentialJwt : undefined);
      if (verdict.ok === false) {
        const r = managerGateRefusal(verdict);
        return void res.status(r.status).json(r.body);
      }
    }
  }

  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const factoryAddress = astryumCageFactoryAddress();
  if (!factoryAddress) {
    return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
  }

  try {
    const [
      { resolveAstryumCage, predictCageAddresses, buildCageCreationBatch, readFactoryTerms, validateCageParams, CageCreationError },
      { readDirectMintParams, computeNetMint, buildDirectMintHandoff, mintFeeDisclosure },
      { resolvePersonalAccount },
      { formatBaseUnits, parseBaseUnits },
    ] = await Promise.all([
      import('../services/flare/AstryumCageCreationService'),
      import('../connectors/protocols/flare/FlareDirectMintService'),
      import('../connectors/protocols/flare/FlareSmartAccountService'),
      import('../services/flare/LegacyVaultStateService'),
    ]);
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    // Una cuenta, una jaula: la factory revertiría CageAlreadyExists.
    const existing = await resolveAstryumCage(provider, factoryAddress, account);
    if (existing) {
      return void res.status(409).json({
        error: 'CAGE_ALREADY_EXISTS',
        detail: `Esta cuenta ya tiene su jaula en ${existing.cage}. Una cuenta, una jaula — abre los potes que necesites desde ella.`,
        cage: existing.cage,
      });
    }

    // La constitución precede al código: su SHA-256 (DIDSet) es eterno en la jaula.
    const anchor = await xrplProvider.getDidObject(account).catch(() => null);
    const refHex = String(anchor?.dataHex ?? '');
    if (!/^[0-9a-fA-F]{64}$/.test(refHex)) {
      return void res.status(409).json({
        error: 'CONSTITUTION_NOT_ANCHORED',
        detail: 'Esta cuenta no ha anclado su constitución en XRPL (DIDSet). Áncla primero, luego crea la jaula.',
      });
    }

    const personalAccount = await resolvePersonalAccount(provider, account);
    if (!personalAccount || personalAccount === ethers.ZeroAddress) {
      return void res.status(409).json({ error: 'NO_PERSONAL_ACCOUNT', detail: 'La cuenta no tiene Personal Account resoluble.' });
    }

    const params = {
      asset,
      constitutionRef: ('0x' + refHex).toLowerCase(),
      allowedTargets: ((rawTargets ?? []) as Array<{ chainId: unknown; target: unknown }>).map((t) => ({
        chainId: Number(t?.chainId),
        target: String(t?.target ?? ''),
      })),
    };
    try {
      validateCageParams(params);
    } catch (e) {
      if (e instanceof CageCreationError) return void res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }

    const terms = await readFactoryTerms(provider, factoryAddress);
    const predicted = await predictCageAddresses(provider, factoryAddress, account, params);
    const mintParams = await readDirectMintParams(provider);
    const grossXrpDrops = parseBaseUnits(amountXrp, 6);
    const net = computeNetMint(grossXrpDrops, mintParams, undefined);

    // La aprobación de la fee: lo que lande en la PA con este carrier. La jaula
    // solo puede cobrar CREATION_FEE por pote, y solo por orden de la autoridad.
    const innerCalls = buildCageCreationBatch({
      factoryAddress,
      councilR: account,
      params,
      predictedCage: predicted.cage,
      feeAllowanceUBA: terms.creationFee > 0n ? net.supplyUBA : 0n,
    });

    // El nacimiento también es una orden firmable de la cuenta: Sequence fijada, y
    // leída ANTES de `buildDirectMintHandoff`, que persiste el asiento de nonce del
    // 0xFE — un 503 aquí no deja ese asiento ocupado (NONCE_SEAT_TAKEN al reintentar).
    const pin = await readOrderPinOr503(res, account);
    if (!pin) return;
    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: 'astryum-cage-create',
        preparedByUserId: req.siwe?.userId ?? null,
        // it. 23 (1.1): ENTRADA — mismo par de campos, mismo sitio único.
        ...(await seatProofFieldsFor(req, account, { purpose: 'entry' })),
        // it. 25 (§2.1): y si esa cuenta firma por QUÓRUM (SignerList), este 0xFE se
        // compone con la ventana de su ceremonia; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
        supersedeAuthorized: false,
      },
      { params: mintParams },
    );

    const feeHuman = formatBaseUnits(terms.creationFee, 6);
    const landsHuman = formatBaseUnits(net.supplyUBA, 6);
    res.json({
      account,
      predicted,
      factory: factoryAddress,
      terms: {
        creationFee: terms.creationFee.toString(),
        treasury: terms.treasury,
        registry: terms.registry,
        freePotesPerCage: terms.freePotesPerCage,
        maxPayeeBpsAllowed: terms.maxPayeeBpsAllowed,
      },
      personalAccount: handoff.personalAccount,
      xrplPayment: pinOrderPayment(handoff.xrplPayment, pin),
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      ...handoffServerDelivery(),
      net: { grossXrp: amountXrp, supplyUBA: net.supplyUBA.toString(), landsInPa: landsHuman },
      params,
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Nacimiento de tu jaula',
        lines: [
          `Firmas UN pago de ${amountXrp} XRP y nace tu jaula en Flare (${predicted.cage}): un contrato de mando que obedece SOLO a esta cuenta XRPL. No guarda capital — nunca.`,
          params.allowedTargets.length === 0
            ? 'Nace SIN lista propia: sus potes solo podrán trabajar en destinos que estén en el registro de Astryum (el scanner, sin liquidación), tal y como esté cada día — uno nuevo aprobado mañana queda disponible; uno retirado deja de estarlo en el acto.'
            : `Su lista de destinos queda escrita para siempre: ${params.allowedTargets.length} destino(s), todos ya aprobados por el scanner de Astryum. Ninguna función la amplía.`,
          `Los primeros ${terms.freePotesPerCage} potes solo cuestan el gas; del siguiente en adelante, ${feeHuman} FXRP por pote, directos a la tesorería de Astryum (la jaula no los toca). El carrier deja ≈ ${landsHuman} FXRP en tu Personal Account, aprobados a la jaula para eso.`,
          'Astryum no firma nada; el relayer que porta la prueba tiene cero autoridad. Abrir un pote es una SEGUNDA orden de esta cuenta.',
        ],
        facts: {
          ...mintFeeDisclosure(net),
          cageWillLiveAt: predicted.cage,
          bridgeWillLiveAt: predicted.bridge,
          obeysOnly: account,
          constitutionRef: params.constitutionRef,
          allowedTargets: params.allowedTargets,
          registryOnly: params.allowedTargets.length === 0,
          freePotesPerCage: terms.freePotesPerCage,
          creationFeePerPote: `${feeHuman} FXRP`,
          treasury: terms.treasury,
        },
      },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'OperationalAccountHandoffError') {
      return void res.status(403).json({ error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) });
    }
    if (name === 'NonceSeatTakenError') {
      // it. 15: el CÓDIGO exacto del asiento (…_SIGNED / _REPORTED / _UNREADABLE) y si
      // reintentar puede servir — la pantalla ofrecía «Reintentar liberando el asiento»
      // en bucle porque todos llegaban como un NONCE_SEAT_TAKEN plano.
      // it. 17: el cuerpo ENTERO (cuenta atrás, ventana y, a quien puede tocarla, el
      // memo de la fila que bloquea) — un código a secas es un callejón.
      return void res.status(seatRefusalStatus(e)).json(nonceSeatBody(e));
    }
    res.status(500).json({ error: 'CAGE_CREATE_FAILED', detail: safeErrorDetail(e) });
  }
}));

const CAGE_ACTIONS = new Set([
  'create-pote', 'accept-pote', 'propose-venue', 'retire-venue', 'evacuate', 'set-max-venue-bps', 'set-payees', 'set-user-gate',
  'set-max-deposit', 'direct-to', 'recall', 'move', 'cede', 'end-cession', 'set-constitution-ref', 'register-remote-wallet',
  'register-remote-pote', 'propose-successor', 'cancel-successor', 'execute-succession',
]);

/**
 * CLASIFICACIÓN DE LAS ÓRDENES DE JAULA — «LA SALIDA JAMÁS SE GATEA» (2026-09-14).
 *
 * Decidida leyendo lo que cada una ejecuta (`AstryumCageOrderService.ACTIONS` →
 * `AstryumCage.sol` → `AstryumVault.sol`), no por el nombre:
 *
 * SALIDA / REDUCE EXPOSICIÓN — `exitGate` (solo flag), SIN geofence y SIN la
 * puerta del título de gestor:
 *   · `recall`   → `AstryumVault.recall(venueId, amount)`: saca `amount` de un
 *                  venue y lo devuelve al colchón del pote (o lo encola en un venue
 *                  ERC4626Queued). Solo reduce exposición; es lo que deja redimir.
 *   · `evacuate` → `AstryumVault.evacuate(venueId)`: la emergencia del consejo,
 *                  TODO lo recuperable del venue de vuelta al colchón. No exige que
 *                  el venue esté retirado antes.
 *
 * ABRE EXPOSICIÓN o GOBIERNA — `capitalGate` (flag + geofence) + título de gestor:
 *   · `direct-to`, `move` (mete capital en un venue; `move` lo abre en OTRO),
 *     `create-pote`, `propose-venue`, `set-max-venue-bps` (sube o baja: el contrato
 *     no distingue), `set-payees`, `set-user-gate`, `set-max-deposit`, `cede`,
 *     `set-constitution-ref`, `register-remote-wallet`, `register-remote-pote`,
 *     `propose-successor`, `execute-succession`.
 *   · `retire-venue`, `end-cession` y `cancel-successor` NO mueven capital: quitan
 *     una puerta de entrada, una autoridad delegada o una sucesión pendiente. No son
 *     una salida de capital y se quedan donde estaban (candidatas a revisión del
 *     fundador: retirar poder de otro tampoco abre exposición).
 *
 * CONTINUIDAD — `accept-pote`: `capitalGate` y sin título de gestor, como antes.
 *
 * Una orden nueva nace en la puerta ESTRICTA: pasarla aquí es una decisión explícita.
 */
const CAGE_EXIT_ACTIONS: ReadonlySet<string> = COUNCIL_ORDER_EXIT_ACTIONS; // una sola clasificación (councilExitToken)

/**
 * POST /cage-order/prepare { council: "r…", action, params }
 *
 * Cualquier orden de una cuenta a SU jaula, por el raíl de siempre: un pago
 * XRPL con memo, FDC, `bridge.execute` contra la jaula. Tras firmar, el
 * frontend dispara `/xrpl-defi/council-order/relay` con `order.orderData`,
 * igual que con el pote (lección del 23-ago: firmar ≠ ejecutar).
 *
 * Pre-flight: lo que reventaría en la jaula o en el pote DESPUÉS de firmar y
 * de pagar la ronda FDC, se dice aquí como 409 — pote ajeno, jaula que ya pasó
 * el testigo, direct por encima del suelo del colchón.
 */
router.post('/cage-order/prepare', guarded(async (req: Request, res: Response) => {
  // LA PUERTA SE ELIGE POR ACCIÓN (clasificación completa en CAGE_EXIT_ACTIONS).
  // Una salida (`recall`, `evacuate`) es solo flag; el resto, flag + geofence. Una
  // acción desconocida cae en la ESTRICTA antes de que la validación la rechace.
  const action = String(req.body?.action ?? '').trim();
  const isExit = CAGE_EXIT_ACTIONS.has(action);
  const g = isExit ? exitGate() : capitalGate(req);
  if (g) return void res.status(g.status).json(g.body);

  const council = String(req.body?.council ?? '').trim();
  const params = (req.body?.params ?? {}) as Record<string, unknown>;
  if (!XRPL_ADDRESS_RE.test(council)) return void badRequest(res, 'council debe ser una r-address XRPL');
  if (!CAGE_ACTIONS.has(action)) return void badRequest(res, `action desconocida: ${action}`);
  const preparedByProven = await (await import('../services/flare/ComposedCouncilOrderStore')).sessionProvesCouncil(req, council);
  // it. 17 (2.5): el tope, ANTES de resolver la jaula, leer el pote y fijar el pin.
  if (await councilQueueFull429(res, council, preparedByProven, req.siwe?.userId ?? null, isExit)) return;
  // it. 17 (2.4): la guarda de duplicado se hace más abajo, sobre los params
  // COMPUESTOS (con el `feePayer` ya resuelto) — no sobre `req.body.params`, que un
  // campo de más bastaba para esquivar.

  // Puerta del título de gestor: solo sobre las órdenes que EL GESTOR firma para
  // GOBERNAR (abrir potes, dirigir, cobrar…). No sobre la sucesión/adopción, que
  // son continuidad, ni sobre nada si el flag está apagado. El ledger la hace
  // cumplir; esto avisa antes de firmar. (`create-pote` es la que de verdad
  // importa: es donde nace el vehículo agrupado.)
  //
  // Tampoco sobre una SALIDA: traer capital al colchón no es gobernar un vehículo,
  // y exigir un título para recuperar el dinero de los holders convertiría una
  // credencial caducada (o un emisor caído) en capital retenido en un venue.
  if (action !== 'accept-pote' && !isExit) {
    const { managerGateConfig, checkManagerCredential, managerGateRefusal } = await import('../services/ManagerCredentialGate');
    if (managerGateConfig().enabled) {
      const verdict = await checkManagerCredential(council, typeof req.body?.managerCredentialJwt === 'string' ? req.body.managerCredentialJwt : undefined);
      if (verdict.ok === false) {
        const r = managerGateRefusal(verdict);
        return void res.status(r.status).json(r.body);
      }
    }
  }

  const { astryumCageFactoryAddress } = await import('../services/flare/LegacyCageResolver');
  const factoryAddress = astryumCageFactoryAddress();
  if (!factoryAddress) {
    return void res.status(503).json({ error: 'CAGE_FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' });
  }

  try {
    const [{ resolveAstryumCage }, { buildCageOrderHandoff, isPoteScoped }, { legacyNetworkConfig }] = await Promise.all([
      import('../services/flare/AstryumCageCreationService'),
      import('../connectors/protocols/xrpl/AstryumCageOrderService'),
      import('../connectors/protocols/xrpl/XrplCouncilOrderService'),
    ]);
    type CageOrderAction = Parameters<typeof buildCageOrderHandoff>[0]['action'];
    const provider = new ethers.JsonRpcProvider(rpcUrl());

    const found = await resolveAstryumCage(provider, factoryAddress, council);
    if (!found) {
      return void res.status(409).json({ error: 'NO_CAGE', detail: 'Esta cuenta no tiene jaula en la factory. Créala primero.' });
    }

    // Quién paga la fee de creación: por defecto la Personal Account del propio
    // consejo — la que aprobó a la jaula al nacer. No se teclea: se resuelve.
    if (action === 'create-pote' && !params.feePayer) {
      const { resolvePersonalAccount } = await import('../connectors/protocols/flare/FlareSmartAccountService');
      const pa = await resolvePersonalAccount(provider, council);
      if (!pa || pa === ethers.ZeroAddress) {
        return void res.status(409).json({ error: 'NO_PERSONAL_ACCOUNT', detail: 'La cuenta no tiene Personal Account resoluble para pagar la fee.' });
      }
      params.feePayer = pa;
    }

    // LA ORDEN DOBLE, sobre lo que DE VERDAD se va a componer (it. 17, hallazgo 2.4):
    // aquí `params` ya es el objeto que recibe `buildCageOrderHandoff`. Va antes de
    // `readPoteState` y del pin para no gastar esas lecturas en una orden repetida.
    const duplicate = await councilDuplicateOr409(req, res, council, isExit, { action, params });
    if (!duplicate.proceed) return;

    // Pre-flight del pote (el mismo que salvó al direct del 23-ago).
    let summaryCtx: { decimals: number; symbol: string; venueLabels?: Record<number, string> } | undefined;
    if (isPoteScoped(action as CageOrderAction)) {
      const pote = parseEvmAddress(params.pote);
      if (!pote) return void badRequest(res, 'params.pote debe ser una dirección 0x válida');
      const state = await readPoteState({ rpcUrl: rpcUrl(), pote });
      summaryCtx = { decimals: state.asset.decimals, symbol: state.asset.symbol };
      if (action === 'direct-to') {
        const amount = String(params.amount ?? '');
        const venueId = Number(params.venueId);
        if (!BASE_AMOUNT_RE.test(amount) || BigInt(amount) === 0n) return void badRequest(res, 'params.amount debe ser un entero positivo');
        if (!Number.isInteger(venueId) || venueId < 0) return void badRequest(res, 'params.venueId debe ser un entero >= 0');
        const verdict = checkPoteDirectTo(state, venueId, BigInt(amount), Math.floor(Date.now() / 1000));
        if (verdict.ok === false) return void res.status(409).json({ error: verdict.code, detail: verdict.detail });
      }
    }

    // El ancla de la jaula v2 es DEDICADA y distinta de la del Legacy v1: cada
    // bridge lleva grabado el hash de SU ancla, así que la v2 compone hacia
    // `ASTRYUM_ORDER_ANCHOR` (nueva), no hacia `LEGACY_ORDER_ANCHOR` (la vieja,
    // que el v1 sigue usando). Sin la var dedicada, cae a la del Legacy — retro-
    // compatible con despliegues donde comparten ancla.
    const astryumAnchor = (process.env.ASTRYUM_ORDER_ANCHOR ?? '').trim();
    // Sequence fijada ANTES de componer (readOrderPinOr503): sin lectura, 503 y nada compuesto.
    const pin = await readOrderPinOr503(res, council);
    if (!pin) return;
    const handoff = await buildCageOrderHandoff({
      council,
      action: action as CageOrderAction,
      params,
      cage: {
        ...legacyNetworkConfig(),
        ...(astryumAnchor ? { orderAnchor: astryumAnchor } : {}),
        bridge: found.bridge,
        vault: found.cage,
      },
      summaryCtx,
    });
    const xrplTx = pinOrderPayment(handoff.xrplTx, pin);
    // Recordada ANTES de entregarla: si la pantalla que firma se va, el vigía la entrega igual.
    const recorded = await recordComposedOrderOr503(
      res,
      {
        route: 'cage-order',
        action,
        council,
        pinnedTx: xrplTx,
        order: handoff.order,
        pin,
        preparedByUserId: req.siwe?.userId ?? null,
        preparedByProven,
        contentKey: duplicate.contentKey,
      },
      { exit: isExit },
    );
    if (!recorded.proceed) return;
    res.json({
      account: council,
      xrplTx,
      order: handoff.order,
      disclosure: handoff.disclosure,
      serverDelivery: recorded.serverDelivery,
      ...(recorded.warning ? { recoveryWarning: recorded.warning } : {}),
      ...(duplicate.duplicateWarning ? { duplicateWarning: duplicate.duplicateWarning } : {}),
      ...(isExit ? await exitTokenFor(council, xrplTx, action) : {}),
    });
  } catch (e) {
    // Las negativas del pre-flight del servicio (pote ajeno, jaula sucedida, bridge
    // desatado) son 409 legibles, no 500: son el producto hablando.
    const msg = safeErrorDetail(e);
    // La puerta del ancla (DepositAuth + AuthorizeCredentials): el firmante no
    // cubre ningún conjunto que el ancla admita. Es el ledger el que diría que
    // no (tecNO_PERMISSION); aquí solo se evita hacerle firmar una orden condenada.
    if ((e as { code?: string })?.code === 'NO_MATCHING_TITLE') {
      return void res.status(409).json({ error: 'NO_MATCHING_TITLE', detail: msg });
    }
    if (/not born from this cage|already handed over|not to this cage|obeys/.test(msg)) {
      return void res.status(409).json({ error: 'CAGE_ORDER_REFUSED', detail: msg });
    }
    if (/must be|required|unknown|future date|non-negative/.test(msg)) {
      return void res.status(400).json({ error: 'CAGE_ORDER_INVALID', detail: msg });
    }
    res.status(500).json({ error: 'CAGE_ORDER_FAILED', detail: msg });
  }
}));

/**
 * GET /council-order/fate?memo=<64 hex> — ¿QUÉ FUE DE ESTA ORDEN? (productizer it. 13, hallazgo 3.1)
 *
 * Tras un veredicto 'stale' la pantalla ofrecía «prepárala otra vez» sin mirar si el
 * payload hermano (mismo asiento, mismo memo) ya había validado y viajaba a Flare:
 * así se movía el capital dos veces. Esta lectura contesta con lo que sabe el
 * servidor — el registro de la orden compuesta, el estado del relé y, si hace falta,
 * una lectura ACOTADA de `account_tx` —:
 *   { memo, state: 'unknown'|'composed'|'validated'|'relaying'|'executed'|'failed', xrplTxHash?, detail? }
 * «No pude leer» es 503, jamás 'unknown'. Solo lectura (autenticada por el router):
 * no lanza relés, no escribe nada; el memo es un hash público del ledger.
 */
router.get('/council-order/fate', guarded(async (req: Request, res: Response) => {
  const memo = String(req.query.memo ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(memo)) return void badRequest(res, 'memo debe ser el MemoData de la orden: 64 hex');
  const {
    readCouncilOrderFate,
    readCouncilOrderFateLimited,
    CouncilOrderFateUnreadableError,
    CouncilOrderFateRateLimitedError,
  } = await import('../services/flare/CouncilOrderRelayLauncher');
  try {
    // it. 15 (hallazgo 2.5): la lectura cuesta `account_info` + hasta 5 `account_tx`
    // en un nodo FRESCO y estaba abierta a cualquier ritmo — un bucle podía dejar el
    // nodo XRPL en 429 y tumbar con él los pins de todos. Una lectura de cadena por
    // memo cada 15 s (el resto, caché) y un presupuesto por sesión y minuto.
    const sessionKey = req.siwe?.userId ?? req.ip ?? 'anonymous';
    res.json(await readCouncilOrderFateLimited(memo, sessionKey, { read: readCouncilOrderFate }));
  } catch (e) {
    if (e instanceof CouncilOrderFateRateLimitedError) {
      res.setHeader('Retry-After', String(e.retryAfterSeconds));
      return void res.status(429).json({ error: e.code, retryAfterSeconds: e.retryAfterSeconds, detail: e.message });
    }
    if (e instanceof CouncilOrderFateUnreadableError) {
      return void res.status(503).json({ error: e.code, detail: e.message });
    }
    throw e;
  }
}));

// ── passkey del usuario: cuenta contrafactual + relay de la firma ───────────

/** GET /passkey/account?x=&y= — la dirección del usuario (contrafactual) y si
 *  está desplegada. Read-only: el frontend la necesita como `receiver`. */
router.get('/passkey/account', guarded(async (req: Request, res: Response) => {
  const factory = process.env.ASTRYUM_PASSKEY_FACTORY;
  if (!factory || !EVM_ADDRESS_RE.test(factory)) {
    return void res.status(503).json({ error: 'FACTORY_UNCONFIGURED' });
  }
  const x = String(req.query.x ?? '').trim();
  const y = String(req.query.y ?? '').trim();
  if (!/^([0-9]{1,78}|0x[0-9a-fA-F]+)$/.test(x) || !/^([0-9]{1,78}|0x[0-9a-fA-F]+)$/.test(y)) {
    return void badRequest(res, 'x e y deben ser la clave pública P256 (enteros o hex)');
  }
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl());
    const f = new ethers.Contract(factory, ['function accountFor(uint256,uint256) view returns (address,bool)'], provider);
    const [predicted, deployed] = await f.accountFor(BigInt(x), BigInt(y));
    res.json({ account: predicted, deployed: Boolean(deployed) });
  } catch (e) {
    res.status(502).json({ error: 'ACCOUNT_READ_FAILED', detail: safeErrorDetail(e) });
  }
}));

/** POST /passkey/relay — porta el lote firmado con la passkey y paga el gas
 *  (lo paga el OPERADOR, nunca el usuario). La firma compromete las calls, así
 *  que el relayer no puede alterarlas: cero custodia. */
router.post('/passkey/relay', guarded(async (req: Request, res: Response) => {
  const { passkeyRelayGate, relayPasskeyBatch, PasskeyRelayError, passkeyRelayErrorStatus } = await import(
    '../services/flare/PasskeyRelayService'
  );
  const gate = passkeyRelayGate();
  if (gate) return void res.status(gate.status).json(gate.body);
  // productizer-it3: los despliegues que paga el relayer se cuentan por usuario
  // SIWE (DEPLOY_LIMIT → 429). Montado tras requireSiweAuth; sin sesión, nada.
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  try {
    const result = await relayPasskeyBatch(req.body, userId);
    res.json(result);
  } catch (e) {
    if (e instanceof PasskeyRelayError) {
      // 400/409 = «nunca se emitió» para el navegador (passkeyRelayOutcome.ts);
      // la tabla completa vive junto a los códigos, en el servicio.
      return void res.status(passkeyRelayErrorStatus(e.code)).json({ error: e.code, detail: e.message });
    }
    res.status(500).json({ error: 'RELAY_FAILED', detail: safeErrorDetail(e) });
  }
}));

export default router;
