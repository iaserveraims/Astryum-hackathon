/**
 * ManagerNotaryIssuer — el ROBOT del notario: verifica y EMITE, sin juicio.
 *
 * El X3 de la revisión 2-sep («al PASS, un servicio firma la CredentialCreate
 * con la llave emisora»), aplicado al carril del gestor. Dos emisiones:
 *
 *  · KYC  — el gestor pega su atestación de Coinbase (EAS en Base) y firma un
 *    reto con la wallet EVM atestada. El robot LEE la atestación on-chain
 *    (emisor Coinbase, schema, no revocada), verifica la firma del reto
 *    (binding EVM↔r-address) y firma la XLS-70 con el `URI` apuntando a la
 *    atestación. Cero documentos, cero juicio: hechos verificables.
 *  · AIFM — el robot re-ejecuta los checks del notario (Domain + toml +
 *    registro, `ManagerNotaryVerifier`) y solo emite si TODOS pasan.
 *
 * La llave emisora es de SERVICIO (como el ómnibus/executor — jamás una llave
 * de usuario): vive en `MANAGER_ISSUER_SEED`, se usa en UN solo sitio, nunca
 * se loguea, y el robot se niega tipado a firmar nada que no sea una
 * CredentialCreate de los tipos configurados. La ACEPTACIÓN sigue siendo del
 * gestor en su Xaman — es su consentimiento y no se automatiza jamás.
 *
 * Feature-flag: `MANAGER_NOTARY_ISSUER_ENABLED` (apagado por defecto).
 */

import { ethers } from 'ethers';
import { composeCredentialCreate } from './XrplCredentialCeremony';

/** EAS es un predeploy del OP-stack: la misma dirección en Base. */
const DEFAULT_EAS_BASE = '0x4200000000000000000000000000000000000021';
/** El attester publicado de Coinbase Verifications (Base mainnet). */
const DEFAULT_COINBASE_ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';
/** Schema «Verified Account» de Coinbase (la prueba de KYC sin PII). */
const DEFAULT_KYC_SCHEMAS = '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
/** El indexador público de EAS para Base (el mismo que sirve easscan). */
const DEFAULT_EAS_GRAPHQL_BASE = 'https://base.easscan.org/graphql';

const EAS_ABI = [
  'function getAttestation(bytes32 uid) view returns (tuple(bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
];

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const UID_RE = /0x[0-9a-fA-F]{64}/;

export class NotaryIssuerError extends Error {
  constructor(
    public readonly code:
      | 'ISSUER_DISABLED'
      | 'ISSUER_MISCONFIGURED'
      | 'INVALID_SUBJECT'
      | 'INVALID_ATTESTATION_REF'
      | 'ATTESTATION_READ_FAILED'
      | 'ATTESTATION_NOT_FOUND'
      | 'ATTESTATION_REJECTED'
      | 'BINDING_REJECTED'
      | 'CHECKS_FAILED'
      | 'ALREADY_VALID'
      | 'SUBMIT_FAILED',
    detail: string,
  ) {
    super(detail);
    this.name = 'NotaryIssuerError';
  }
}

export interface NotaryIssuerConfig {
  enabled: boolean;
  seed: string;
  baseRpcUrl: string;
  easAddress: string;
  /** El indexador GraphQL de EAS en Base — solo para DESCUBRIR el uid; la verdad se relee on-chain. */
  easGraphqlUrl: string;
  attester: string;
  /** Schemas EAS aceptados como prueba de KYC (allowlist, minúsculas). */
  kycSchemas: Set<string>;
}

export function notaryIssuerConfig(): NotaryIssuerConfig {
  const seed = (process.env.MANAGER_ISSUER_SEED ?? '').trim();
  return {
    enabled: process.env.MANAGER_NOTARY_ISSUER_ENABLED === 'true' && seed.length > 0,
    seed,
    baseRpcUrl: (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org').trim(),
    easAddress: (process.env.EAS_CONTRACT_BASE ?? DEFAULT_EAS_BASE).trim(),
    easGraphqlUrl: (process.env.EAS_GRAPHQL_BASE ?? DEFAULT_EAS_GRAPHQL_BASE).trim(),
    attester: (process.env.COINBASE_ATTESTER ?? DEFAULT_COINBASE_ATTESTER).trim(),
    kycSchemas: new Set(
      (process.env.COINBASE_KYC_SCHEMAS ?? DEFAULT_KYC_SCHEMAS)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    ),
  };
}

/** URL de easscan o UID crudo → el UID (y la URL canónica para el `URI`). */
export function parseAttestationRef(input: string): { uid: string; url: string } {
  const m = String(input ?? '').match(UID_RE);
  if (!m) throw new NotaryIssuerError('INVALID_ATTESTATION_REF', 'attestation debe ser una URL de easscan o un UID 0x…64hex');
  const uid = m[0].toLowerCase();
  return { uid, url: `https://base.easscan.org/attestation/view/${uid}` };
}

/**
 * El reto que firma la wallet EVM atestada. DETERMINISTA y atado a (sujeto,
 * atestación): reutilizar la firma solo re-emitiría la misma credencial al
 * mismo sujeto — no hay nada que robar.
 */
export function bindingMessage(subject: string, uid: string): string {
  return `Astryum notary binding\nsubject: ${subject}\nattestation: ${uid}`;
}

export interface EasAttestation {
  uid: string;
  schema: string;
  attester: string;
  recipient: string;
  revocationTime: number;
  expirationTime: number;
}

/** PURA: ¿esta atestación vale como prueba de KYC según la config? */
export function evaluateAttestation(
  att: EasAttestation,
  cfg: Pick<NotaryIssuerConfig, 'attester' | 'kycSchemas'>,
  nowSec: number,
): { ok: true } | { ok: false; detail: string } {
  if (att.attester.toLowerCase() !== cfg.attester.toLowerCase()) {
    return { ok: false, detail: `el attester ${att.attester} no es el configurado (${cfg.attester})` };
  }
  if (!cfg.kycSchemas.has(att.schema.toLowerCase())) {
    return { ok: false, detail: `el schema ${att.schema} no está en la allowlist de schemas KYC` };
  }
  if (att.revocationTime !== 0) {
    return { ok: false, detail: 'la atestación está REVOCADA' };
  }
  if (att.expirationTime !== 0 && att.expirationTime <= nowSec) {
    return { ok: false, detail: 'la atestación está caducada' };
  }
  return { ok: true };
}

export async function readEasAttestation(uid: string, cfg: NotaryIssuerConfig): Promise<EasAttestation> {
  try {
    const provider = new ethers.JsonRpcProvider(cfg.baseRpcUrl);
    const eas = new ethers.Contract(cfg.easAddress, EAS_ABI, provider);
    const a = (await eas.getAttestation(uid)) as {
      uid: string; schema: string; expirationTime: bigint; revocationTime: bigint; recipient: string; attester: string;
    };
    if (!a || a.attester === ethers.ZeroAddress) {
      throw new NotaryIssuerError('ATTESTATION_READ_FAILED', 'la atestación no existe en EAS (Base)');
    }
    return {
      uid,
      schema: String(a.schema),
      attester: ethers.getAddress(a.attester),
      recipient: ethers.getAddress(a.recipient),
      revocationTime: Number(a.revocationTime),
      expirationTime: Number(a.expirationTime),
    };
  } catch (e) {
    if (e instanceof NotaryIssuerError) throw e;
    throw new NotaryIssuerError('ATTESTATION_READ_FAILED', `no se pudo leer EAS en Base: ${(e as Error).message}`);
  }
}

/* ── DESCUBRIR la atestación sin pegar nada (fundador 9-sep: «siempre que se
 * pueda reducir el proceso, hacerlo, mientras no afecte a lo legal») ────────
 *
 * Antes el gestor tenía que buscar su atestación en easscan y pegar la URL.
 * Ahora se pregunta al indexador de EAS por la wallet EVM que tiene conectada:
 * atestaciones de Coinbase, de un schema de la allowlist, a su nombre. El
 * indexador es una PISTA — cada candidata se relee ON-CHAIN (readEasAttestation)
 * y pasa por el mismo evaluateAttestation que la vía manual. Nada cambia en lo
 * legal: se leen hechos públicos de la cadena por la propia dirección del
 * usuario, el binding EVM↔r-address sigue siendo SU firma, y aceptar la
 * credencial sigue siendo SU Xaman. La vía manual se conserva por si el
 * indexador no responde. */

export interface DiscoveredAttestation {
  uid: string;
  url: string;
  recipient: string;
  /** Epoch (s) de la atestación, para enseñar «verificado el …». */
  time: number;
}

interface IndexedAttestation {
  id: string;
  time: number;
}

/** PURA: de las candidatas (más reciente primero), la primera que la cadena confirma válida. */
export async function pickValidAttestation(
  candidates: IndexedAttestation[],
  read: (uid: string) => Promise<EasAttestation>,
  cfg: Pick<NotaryIssuerConfig, 'attester' | 'kycSchemas'>,
  nowSec: number,
): Promise<{ att: EasAttestation; time: number } | null> {
  const sorted = [...candidates].sort((a, b) => b.time - a.time);
  for (const c of sorted) {
    if (!UID_RE.test(c.id)) continue;
    try {
      const att = await read(c.id.toLowerCase());
      if (evaluateAttestation(att, cfg, nowSec).ok) return { att, time: c.time };
    } catch {
      // Una candidata ilegible no invalida las demás: se sigue.
    }
  }
  return null;
}

export async function discoverCoinbaseAttestation(
  input: { recipient: string },
  deps: {
    cfg?: NotaryIssuerConfig;
    fetchFn?: typeof fetch;
    read?: (uid: string, cfg: NotaryIssuerConfig) => Promise<EasAttestation>;
    nowSec?: number;
  } = {},
): Promise<DiscoveredAttestation> {
  const cfg = deps.cfg ?? notaryIssuerConfig();
  const fetchFn = deps.fetchFn ?? fetch;
  const read = deps.read ?? readEasAttestation;
  if (!ethers.isAddress(input.recipient)) {
    throw new NotaryIssuerError('BINDING_REJECTED', 'recipient debe ser una dirección EVM (la wallet que conectaste en Coinbase)');
  }
  const recipient = ethers.getAddress(input.recipient);
  const attester = ethers.getAddress(cfg.attester);

  // Los filtros llevan las dos grafías (checksum y minúsculas): el indexador
  // guarda las direcciones tal y como llegaron y no queremos perder una
  // atestación por una mayúscula.
  const query = `query Discover($where: AttestationWhereInput!) {
    attestations(where: $where, orderBy: [{ time: desc }], take: 10) { id time }
  }`;
  const variables = {
    where: {
      attester: { in: [attester, attester.toLowerCase()] },
      recipient: { in: [recipient, recipient.toLowerCase()] },
      schemaId: { in: [...cfg.kycSchemas] },
      revoked: { equals: false },
    },
  };

  let candidates: IndexedAttestation[] = [];
  try {
    const res = await fetchFn(cfg.easGraphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { attestations?: Array<{ id: string; time: number | string }> }; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join(' · '));
    candidates = (body.data?.attestations ?? []).map((a) => ({ id: String(a.id), time: Number(a.time) }));
  } catch (e) {
    throw new NotaryIssuerError('ATTESTATION_READ_FAILED', `no se pudo consultar el indexador de EAS (Base): ${(e as Error).message}`);
  }

  const picked = await pickValidAttestation(candidates, (uid) => read(uid, cfg), cfg, deps.nowSec ?? Math.floor(Date.now() / 1000));
  if (!picked) {
    throw new NotaryIssuerError(
      'ATTESTATION_NOT_FOUND',
      `no hay ninguna atestación «Verified Account» de Coinbase vigente para ${recipient}. En Coinbase, termina la verificación de identidad y, en su página de verificación onchain, conecta EXACTAMENTE esta wallet y mintea la atestación (gratis). Si la minteaste con otra wallet, conecta esa aquí.`,
    );
  }
  return { uid: picked.att.uid, url: `https://base.easscan.org/attestation/view/${picked.att.uid}`, recipient: picked.att.recipient, time: picked.time };
}

/** La firma del reto debe venir de la MISMA wallet que la atestación señala. */
export function verifyEvmBinding(input: { subject: string; uid: string; signature: string; recipient: string }): void {
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(bindingMessage(input.subject, input.uid), input.signature);
  } catch {
    throw new NotaryIssuerError('BINDING_REJECTED', 'la firma EVM del reto no es válida');
  }
  if (recovered.toLowerCase() !== input.recipient.toLowerCase()) {
    throw new NotaryIssuerError(
      'BINDING_REJECTED',
      `el reto lo firmó ${recovered}, pero la atestación pertenece a ${input.recipient} — el binding solo vale si son la misma wallet`,
    );
  }
}

/* ── firmar + enviar (el ÚNICO sitio donde se usa la seed emisora) ────────── */

export interface IssueResult {
  txHash: string;
  result: string;
  validated: boolean;
  issuer: string;
  subject: string;
  credentialType: string;
  uri?: string;
}

/**
 * Envío por HTTPS JSON-RPC, JAMÁS por websocket: la lección que el provider de
 * lectura ya aprendió (Railway no sostiene el WS; xrplcluster responde 402 al
 * upgrade desde IPs de datacenter). Se firma en local y se pasea la misma
 * lista de endpoints HTTPS que las lecturas ya usan con éxito.
 */
const XRPL_HTTP_ENDPOINTS = ['https://s1.ripple.com:51234', 'https://s2.ripple.com:51234', 'https://xrplcluster.com'];

async function xrplHttpRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  let lastErr = '';
  for (const endpoint of XRPL_HTTP_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) { lastErr = `${endpoint}: HTTP ${res.status}`; continue; }
      const body = (await res.json()) as { result?: T & { error?: string; error_message?: string; status?: string } };
      if (!body.result) { lastErr = `${endpoint}: respuesta sin result`; continue; }
      if (body.result.error) throw new NotaryIssuerError('SUBMIT_FAILED', `${method}: ${body.result.error_message ?? body.result.error}`);
      return body.result;
    } catch (e) {
      if (e instanceof NotaryIssuerError) throw e;
      lastErr = `${endpoint}: ${(e as Error).message}`;
    }
  }
  throw new NotaryIssuerError('SUBMIT_FAILED', `ningún endpoint XRPL respondió (${lastErr})`);
}

async function signAndSubmitAsIssuer(txjson: Record<string, unknown>, cfg: NotaryIssuerConfig): Promise<{ txHash: string; result: string; validated: boolean; issuer: string }> {
  const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
  const wallet = xrplWalletFromSecret(cfg.seed);

  // Sanidad: el robot solo firma como un emisor ACREDITADO en la config del
  // gate — si la seed no corresponde a la allowlist, negativa tipada.
  const { managerGateConfig } = await import('./ManagerCredentialGate');
  const gate = managerGateConfig();
  if (gate.issuers.size > 0 && !gate.issuers.has(wallet.classicAddress)) {
    throw new NotaryIssuerError(
      'ISSUER_MISCONFIGURED',
      `la seed emisora corresponde a ${wallet.classicAddress}, que NO está en MANAGER_CREDENTIAL_ISSUERS`,
    );
  }

  // Autofill manual por HTTP: Sequence de la cuenta + ventana de validez.
  const [acct, ledger] = await Promise.all([
    xrplHttpRpc<{ account_data?: { Sequence?: number } }>('account_info', { account: wallet.classicAddress, ledger_index: 'current' }),
    xrplHttpRpc<{ ledger_current_index?: number }>('ledger_current', {}),
  ]);
  const sequence = acct.account_data?.Sequence;
  const ledgerIndex = ledger.ledger_current_index;
  if (!Number.isInteger(sequence) || !Number.isInteger(ledgerIndex)) {
    throw new NotaryIssuerError('SUBMIT_FAILED', 'no se pudo leer Sequence/ledger de la cuenta emisora (¿existe y está fondeada?)');
  }

  const tx = {
    ...txjson,
    Account: wallet.classicAddress,
    Sequence: sequence,
    Fee: '12',
    LastLedgerSequence: (ledgerIndex as number) + 40,
  };
  const signed = wallet.sign(tx as never);

  const submitted = await xrplHttpRpc<{ engine_result?: string }>('submit', { tx_blob: signed.tx_blob });
  const engine = submitted.engine_result ?? '?';
  if (!engine.startsWith('tes') && !engine.startsWith('ter')) {
    // tec/tem/tef: la tx no va a validar — se relata el código tal cual.
    throw new NotaryIssuerError('SUBMIT_FAILED', `el ledger la rechazó: ${engine}`);
  }

  // Esperar la validación (poll de `tx` por hash, ~20 s).
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const seen = await xrplHttpRpc<{ validated?: boolean; meta?: { TransactionResult?: string } }>('tx', { transaction: signed.hash, binary: false });
      if (seen.validated) {
        return { txHash: signed.hash, result: seen.meta?.TransactionResult ?? engine, validated: true, issuer: wallet.classicAddress };
      }
    } catch {
      // txnNotFound mientras propaga: seguir esperando.
    }
  }
  // Enviada y aceptada por el nodo, aún sin validar cuando dejamos de mirar:
  // se dice tal cual — la bandeja la enseñará en cuanto el ledger la cierre.
  return { txHash: signed.hash, result: `${engine} (pendiente de validación)`, validated: false, issuer: wallet.classicAddress };
}

/**
 * RENOVACIÓN (fundador 5-sep: «cuando el KYC se revoque, poder volverlo a
 * establecer con una firma»). El mismo triple (emisor, sujeto, tipo) no puede
 * re-emitirse mientras el objeto viejo exista (`tecDUPLICATE`): si el sujeto
 * sostiene una del MISMO emisor y tipo caducada / a punto / sin aceptar, el
 * robot la BORRA primero (CredentialDelete, firma del emisor) y emite fresca.
 * Una credencial vigente y lejos de caducar NO se pisa: `ALREADY_VALID`.
 * La revocación de verdad vive aguas arriba: si Coinbase revocó la atestación,
 * `evaluateAttestation` ya se negó antes de llegar aquí.
 */
async function clearStaleCredential(
  subject: string,
  credentialType: string,
  issuerAddress: string,
  cfg: NotaryIssuerConfig,
): Promise<void> {
  const { readAccountCredentials } = await import('./XrplCredentialVerifier');
  let held;
  try {
    held = await readAccountCredentials(subject);
  } catch {
    return; // «no pude leer» no bloquea la emisión: el ledger dirá tecDUPLICATE si toca
  }
  const same = held.credentials.find(
    (c) => c.issuer === issuerAddress && c.credentialType.toUpperCase() === credentialType.toUpperCase(),
  );
  if (!same) return;
  if (same.state === 'valid') {
    throw new NotaryIssuerError(
      'ALREADY_VALID',
      `ya sostienes una credencial ${credentialType} vigente de este emisor (caduca ${same.expiresAtISO ?? '—'}) — no hay nada que renovar todavía`,
    );
  }
  // Caducada, a punto de caducar o nunca aceptada: fuera la vieja, entra la nueva.
  const del = {
    TransactionType: 'CredentialDelete' as const,
    Subject: subject,
    CredentialType: same.credentialTypeHex,
  };
  await signAndSubmitAsIssuer(del as unknown as Record<string, unknown>, cfg);
}

/**
 * KYC desde Coinbase: atestación EAS verificada + binding EVM firmado →
 * CredentialCreate(KYC) al sujeto, con `URI` → la atestación. `tesSUCCESS` o
 * negativa tipada. Renovar es el MISMO camino: el robot barre la caducada.
 */
export async function issueKycFromCoinbase(input: {
  subject: string;
  attestation: string;
  evmSignature: string;
  expirationDays?: number;
}): Promise<IssueResult> {
  const cfg = notaryIssuerConfig();
  if (!cfg.enabled) throw new NotaryIssuerError('ISSUER_DISABLED', 'el notario-emisor está apagado (MANAGER_NOTARY_ISSUER_ENABLED / MANAGER_ISSUER_SEED)');
  if (!XRPL_ADDRESS_RE.test(input.subject)) throw new NotaryIssuerError('INVALID_SUBJECT', 'subject debe ser una r-address');

  const ref = parseAttestationRef(input.attestation);
  const att = await readEasAttestation(ref.uid, cfg);
  const verdict = evaluateAttestation(att, cfg, Math.floor(Date.now() / 1000));
  if (verdict.ok === false) throw new NotaryIssuerError('ATTESTATION_REJECTED', verdict.detail);
  verifyEvmBinding({ subject: input.subject, uid: ref.uid, signature: input.evmSignature, recipient: att.recipient });

  // Renovación: si hay una KYC del mismo emisor caducada/a punto, se barre.
  {
    const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
    await clearStaleCredential(input.subject, 'KYC', xrplWalletFromSecret(cfg.seed).classicAddress, cfg);
  }

  // El issuer real lo fija la seed en signAndSubmitAsIssuer; aquí un placeholder
  // válido solo para pasar la composición (Account se sobreescribe al firmar).
  const txjson = composeCredentialCreate({
    issuer: 'rrrrrrrrrrrrrrrrrrrrrhoLvTp',
    subject: input.subject,
    credentialType: 'KYC',
    expirationDays: input.expirationDays ?? 90,
    uri: ref.url,
  }) as unknown as Record<string, unknown>;

  const sent = await signAndSubmitAsIssuer(txjson, cfg);
  return { ...sent, subject: input.subject, credentialType: 'KYC', uri: ref.url };
}

/**
 * AIFM desde los checks del notario: SOLO si Domain + toml + registro pasan.
 * El veredicto fallido viaja entero (cada motivo) — el robot no opina.
 */
export async function issueAifmFromChecks(input: { subject: string; expirationDays?: number }): Promise<IssueResult> {
  const cfg = notaryIssuerConfig();
  if (!cfg.enabled) throw new NotaryIssuerError('ISSUER_DISABLED', 'el notario-emisor está apagado (MANAGER_NOTARY_ISSUER_ENABLED / MANAGER_ISSUER_SEED)');
  if (!XRPL_ADDRESS_RE.test(input.subject)) throw new NotaryIssuerError('INVALID_SUBJECT', 'subject debe ser una r-address');

  const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
  const issuerAddress = xrplWalletFromSecret(cfg.seed).classicAddress;

  // TENER no es EMITIR (fundador 9-sep: el panel decía «falta Domain» a un
  // gestor que YA sostiene la AIFM). Los checks del notario (Domain + toml +
  // registro) son la prueba para EMITIR una nueva; una credencial ya aceptada y
  // vigente vale por sí misma — la lee el gate del ledger, no necesita nada más.
  // Así que si el sujeto ya la sostiene vigente de ESTE emisor, no hay nada que
  // hacer y NO se corren los checks (que fallarían por un Domain que ya no hace
  // falta). Caducada / a punto / sin aceptar SÍ cae al camino de re-emisión.
  {
    const { readAccountCredentials } = await import('./XrplCredentialVerifier');
    try {
      const held = await readAccountCredentials(input.subject);
      const already = held.credentials.find(
        (c) => c.issuer === issuerAddress && c.credentialType.toUpperCase() === 'AIFM' && c.state === 'valid',
      );
      if (already) {
        throw new NotaryIssuerError(
          'ALREADY_VALID',
          `ya sostienes una credencial AIFM vigente de este emisor (caduca ${already.expiresAtISO ?? '—'}) — no hay nada que emitir; los checks de Domain/registro son para EMITIRLA, no para tenerla`,
        );
      }
    } catch (e) {
      // «No pude leer» NO bloquea la emisión (el ledger dirá tecDUPLICATE si toca);
      // pero un ALREADY_VALID sí sube tal cual.
      if (e instanceof NotaryIssuerError) throw e;
    }
  }

  const { runNotaryCheck } = await import('./ManagerNotaryVerifier');
  const verdict = await runNotaryCheck(input.subject);
  if (!verdict.ok) {
    const failing = verdict.checks.filter((c) => !c.ok).map((c) => c.detail).join(' · ');
    throw new NotaryIssuerError('CHECKS_FAILED', failing || 'los checks del notario no pasan');
  }

  // Renovación simétrica a la KYC: la AIFM caducada se barre antes de re-emitir.
  await clearStaleCredential(input.subject, 'AIFM', issuerAddress, cfg);

  const txjson = composeCredentialCreate({
    issuer: 'rrrrrrrrrrrrrrrrrrrrrhoLvTp',
    subject: input.subject,
    credentialType: 'AIFM',
    expirationDays: input.expirationDays ?? 90,
    uri: verdict.firm?.url,
  }) as unknown as Record<string, unknown>;

  const sent = await signAndSubmitAsIssuer(txjson, cfg);
  return { ...sent, subject: input.subject, credentialType: 'AIFM', uri: verdict.firm?.url };
}

/**
 * Licencia de DEMO (AIFM o CASP) — el robot firma en el servidor con la MISMA
 * seed que ya usa para la KYC, SALTÁNDOSE los checks del notario (Domain + toml
 * + registro). Cada raíz recibe la de su sector: AIFM el gestor, CASP el
 * exchange — el gate lee `AIFM|CASP,KYC` como (una de las dos) y (identidad).
 *
 * Es una excepción CONSCIENTE al guardarraíl «el robot no emite licencias sin
 * checks», acotada a: (1) su propio flag, apagado por defecto
 * (`MANAGER_DEMO_AIFM_ENABLED`); (2) la ruta ata el sujeto a una wallet de la
 * PROPIA cuenta y pone tope por cuenta y por día — desde el 15-sep ya NO exige
 * admin: el jurado tiene que poder recorrer la mesa entera con su cuenta
 * (fundador); (3) la lista cerrada `DEMO_LICENSE_TYPES` — la KYC jamás sale de
 * aquí. Existe SOLO para el rodaje: probar los carriles sin que la cuenta demo
 * declare un Domain real (que no tiene). JAMÁS es una atestación regulatoria — en producción el
 * AIFM sale únicamente de `issueAifmFromChecks`. La aceptación sigue siendo del
 * sujeto en su Xaman (su consentimiento no se automatiza).
 */
/**
 * Lo que la emisión de DEMO puede firmar con el modelo paste-link→URI — cada
 * raíz la licencia de SU sector, y la identidad de su VEHÍCULO:
 *  · AIFM — gestor de vehículos agrupados
 *  · CASP — exchange (MiCA)
 *  · KYB  — el registro del vehículo legal (el asiento de la SL en el registro
 *    mercantil; fundador 13-sep: la raíz de un exchange es una SOCIEDAD — su
 *    identidad es el registro público, no un KYC personal). El link al asiento
 *    viaja como URI y se enseña: quien confíe, lo comprueba.
 * Lista CERRADA a propósito: la KYC PERSONAL jamás sale de aquí (esa exige la
 * atestación real de Coinbase, `issueKycFromCoinbase`).
 */
const DEMO_LICENSE_TYPES = ['AIFM', 'CASP', 'KYB'] as const;
export type DemoLicenseType = (typeof DEMO_LICENSE_TYPES)[number];

export async function issueAifmDemo(input: { subject: string; expirationDays?: number; credentialType?: string; uri?: string }): Promise<IssueResult> {
  const cfg = notaryIssuerConfig();
  if (!cfg.enabled) throw new NotaryIssuerError('ISSUER_DISABLED', 'el notario-emisor está apagado (MANAGER_NOTARY_ISSUER_ENABLED / MANAGER_ISSUER_SEED)');
  if (process.env.MANAGER_DEMO_AIFM_ENABLED !== 'true') {
    throw new NotaryIssuerError('ISSUER_DISABLED', 'la emisión de licencia de DEMO está apagada (MANAGER_DEMO_AIFM_ENABLED) — es solo para el rodaje.');
  }
  if (!XRPL_ADDRESS_RE.test(input.subject)) throw new NotaryIssuerError('INVALID_SUBJECT', 'subject debe ser una r-address');
  const licenseType = (input.credentialType ?? 'AIFM').trim().toUpperCase() as DemoLicenseType;
  if (!DEMO_LICENSE_TYPES.includes(licenseType)) {
    throw new NotaryIssuerError('INVALID_SUBJECT', `credentialType debe ser una licencia de la lista cerrada (${DEMO_LICENSE_TYPES.join(', ')}) — la KYC no sale de aquí`);
  }
  // V1 del link (fundador, 13-sep): el user pega el enlace de su licencia y la
  // credencial lo lleva como URI — el LINK ES la credencial. Astryum no lo
  // verifica: por eso el link tiene que enseñarse siempre al depositante
  // («compruébalo tú»). Solo https, y con el tope de la XLS-70 (256 bytes).
  const uri = (input.uri ?? '').trim() || undefined;
  if (uri !== undefined) {
    if (!/^https:\/\/\S+$/.test(uri)) throw new NotaryIssuerError('INVALID_SUBJECT', 'uri debe ser un enlace https:// (el puntero público a la licencia)');
    if (Buffer.byteLength(uri, 'utf8') > 256) throw new NotaryIssuerError('INVALID_SUBJECT', 'uri demasiado larga (máx 256 bytes en la XLS-70)');
  }

  const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
  const issuerAddress = xrplWalletFromSecret(cfg.seed).classicAddress;

  // TENER no es EMITIR: si ya sostiene la licencia vigente de ESTE emisor, nada
  // que hacer (una auto-emitida de otra cuenta no cuenta — su issuer no casa).
  {
    const { readAccountCredentials } = await import('./XrplCredentialVerifier');
    try {
      const held = await readAccountCredentials(input.subject);
      const already = held.credentials.find(
        (c) => c.issuer === issuerAddress && c.credentialType.toUpperCase() === licenseType && c.state === 'valid',
      );
      if (already) {
        throw new NotaryIssuerError(
          'ALREADY_VALID',
          `ya sostienes una credencial ${licenseType} vigente de este emisor (caduca ${already.expiresAtISO ?? '—'})`,
        );
      }
    } catch (e) {
      if (e instanceof NotaryIssuerError) throw e;
    }
  }

  // Renovación simétrica: la licencia caducada/sin aceptar de este emisor se barre.
  await clearStaleCredential(input.subject, licenseType, issuerAddress, cfg);

  const txjson = composeCredentialCreate({
    issuer: 'rrrrrrrrrrrrrrrrrrrrrhoLvTp',
    subject: input.subject,
    credentialType: licenseType,
    expirationDays: input.expirationDays ?? 90,
    uri,
  }) as unknown as Record<string, unknown>;

  const sent = await signAndSubmitAsIssuer(txjson, cfg);
  return { ...sent, subject: input.subject, credentialType: licenseType, uri };
}
