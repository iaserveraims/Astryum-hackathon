/**
 * DemoExchangeSigner — THE KEY OF THE SIMULATED EXCHANGE. Read before touching.
 *
 * ── What this key is, and is not ───────────────────────────────────────────
 * This module signs and submits XRPL transactions with the seed of the
 * omnibus account of the DEMO EXCHANGE — the exchange whose "backend" this
 * repo simulates so the custodial (mode B) flow can run end to end with no
 * human clicks: the client deposits with a tag, the exchange backend mints
 * FXRP into the pote naming the client account as receiver, and pays clients
 * out to their own wallets. A real exchange has exactly this hot key; here it
 * is ours because we play the exchange (decision of the founder, 2026-08-26).
 *
 *   · It is NEVER a user key (invariant #1 intact): no client of the demo
 *     ever hands a seed to this backend. Clients sign with their own Xaman
 *     (deposits) or their passkey (exits); their shares live in THEIR account.
 *   · It is NOT Astryum's product key either: the product (prepare-only,
 *     `/api/institutional/*`) keeps signing nothing. This key exists only
 *     behind `DEMO_EXCHANGE_AUTOSIGN_ENABLED` for the demo surface, like the
 *     keeper's seed (`XrplEscrowKeeper`) or the executor's gas key on Flare.
 *   · MICA_BOUNDARIES §2: this is the simulated counterparty's own operation,
 *     not "execution of orders on behalf of clients" by Astryum.
 *
 * ── What the key refuses, by construction ──────────────────────────────────
 *   · to sign from any account other than its own, or for a run whose omnibus
 *     is not that account;
 *   · to pay anywhere but the FAssets Core Vault (0xFE mint + deposit) or the
 *     registered own wallet of a client of the run (payout);
 *   · to mint shares to any address that is not the account of a CLIENT OF
 *     THIS RUN. KYC is the exchange's own business (a real exchange verified
 *     its client long before this point and does not publish it on-chain —
 *     founder, 2026-08-26), so what this key enforces is the binding it does
 *     own: tag ↔ client ↔ account, in the exchange's books. If the pote does
 *     carry an on-chain gate (`userGate`) or the run names a registry, that
 *     gate must ALSO approve — otherwise the deposit would revert after the
 *     XRP is already spent;
 *   · a mint payment carrying a DestinationTag (FAssets would misroute it);
 *   · above DEMO_EXCHANGE_MAX_TX_XRP per payment, or past
 *     DEMO_EXCHANGE_DAILY_CAP_XRP per UTC day (spend ledger persisted) — ON AN
 *     ENTRY OR ANY OWN OPERATION. Those two caps protect THIS KEY; they are
 *     never a gate on anybody's exit, so a client's payout does not meet them
 *     (it. 25, `capApplies`).
 * Every refusal is a receipt with its reason. The seed never appears in a log.
 *
 * Config (staging):
 *   DEMO_EXCHANGE_AUTOSIGN_ENABLED=true
 *   DEMO_EXCHANGE_OMNIBUS_SEED=s… | Xaman secret numbers   (the demo exchange omnibus)
 *   DEMO_EXCHANGE_MAX_TX_XRP=50           DEMO_EXCHANGE_DAILY_CAP_XRP=200
 *   (the Make Waves SourceTag is ALWAYS stripped from what this key signs — see
 *     omnibusTxForSigning; the old DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION switch is
 *     no longer read)
 *   XRPL_WS_URL (submit endpoint; default wss://s1.ripple.com — NOT xrplcluster.com,
 *     which answers the WebSocket upgrade with 402 Payment Required to datacenter
 *     IPs: on Railway every submission died as «Unexpected server response: 402»)
 */

import { kvCompareAndSet, kvGetStrict } from '../persistence/backgroundJobKv';
import type { DemoRun } from './DemoExchangeStore';

export const SPEND_JOB_TYPE = 'demo-exchange-spend';

export interface SignerConfig {
  enabled: boolean;
  seedPresent: boolean;
  address: string | null;
  maxTxDrops: bigint;
  dailyCapDrops: bigint;
  attribution: 'user' | 'operational';
  /**
   * Firmar hacia un pote SIN puerta on-chain es una decisión consciente, no un
   * default. Sin esto, un `run` sin `registryAddress` cuyo pote no tenga
   * `userGate()` deja al firmante desatendido acuñando participaciones a
   * cualquier dirección EVM que una sesión de admin ponga en `run.clients` —
   * la única barrera restante desaparece sin que nadie lo haya elegido.
   * `DEMO_EXCHANGE_ALLOW_UNGATED_POTE=true` para permitirlo a propósito.
   */
  allowUngatedPote: boolean;
  /**
   * La DESIGNACIÓN (Enmienda §10, 12-sep): con esto encendido, la llave solo
   * firma si el CONSEJO del run la ha NOMBRADO en el ledger — una XLS-70 de
   * tipo `OMNIBUS` emitida por esa raíz a esta cuenta, aceptada y vigente.
   * Verificación RELACIONAL (issuer == el consejo del run), jamás allowlist.
   * Revocarla (o dejarla caducar) descabeza la caja sin tocar la salida de
   * ningún cliente. `DEMO_EXCHANGE_REQUIRE_APPOINTMENT=true` para exigirla.
   */
  requireAppointment: boolean;
  error?: string;
}

function xrpEnvToDrops(name: string, fallbackXrp: number): bigint {
  const raw = Number(process.env[name] ?? fallbackXrp);
  const xrp = Number.isFinite(raw) && raw >= 0 ? raw : fallbackXrp;
  return BigInt(Math.round(xrp * 1_000_000));
}

let cachedAddress: { seed: string; address: string | null; error?: string } | null = null;

/** Never throws; never logs the seed. */
export function readSignerConfig(): SignerConfig {
  const enabled = process.env.DEMO_EXCHANGE_AUTOSIGN_ENABLED === 'true';
  const seed = process.env.DEMO_EXCHANGE_OMNIBUS_SEED ?? '';
  let address: string | null = null;
  let error: string | undefined;
  if (seed) {
    if (!cachedAddress || cachedAddress.seed !== seed) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { diagnoseXrplSecret } = require('../../utils/xrplSecret') as typeof import('../../utils/xrplSecret');
        const d = diagnoseXrplSecret(seed);
        cachedAddress = { seed, address: d.address ?? null, error: d.address ? undefined : `seed unusable (format ${d.format})` };
      } catch (e) {
        cachedAddress = { seed, address: null, error: (e as Error).message.slice(0, 80) };
      }
    }
    address = cachedAddress.address;
    error = cachedAddress.error;
  }
  // The omnibus seed is held by this backend: whatever it signs is OURS and
  // scripted. It never carries the Make Waves project tag, whatever an env var
  // says — T&C §7 forbids counting our own scripted account as activity. The
  // old DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION switch defaulted to 'user' and is
  // no longer read.
  const attribution = 'operational' as const;
  return {
    enabled,
    seedPresent: Boolean(seed),
    address,
    maxTxDrops: xrpEnvToDrops('DEMO_EXCHANGE_MAX_TX_XRP', 50),
    dailyCapDrops: xrpEnvToDrops('DEMO_EXCHANGE_DAILY_CAP_XRP', 200),
    attribution,
    allowUngatedPote: process.env.DEMO_EXCHANGE_ALLOW_UNGATED_POTE === 'true',
    requireAppointment: process.env.DEMO_EXCHANGE_REQUIRE_APPOINTMENT === 'true',
    error,
  };
}

/* ── policy (pure) ───────────────────────────────────────────────────────── */

export type Purpose = 'put-to-work' | 'payout';

export interface PaymentAssessment {
  ok: boolean;
  code?:
    | 'SIGNER_DISABLED'
    | 'WRONG_SIGNER'
    | 'DESTINATION_NOT_ALLOWED'
    | 'RECEIVER_NOT_A_CLIENT'
    | 'RECEIVER_NOT_APPROVED'
    | 'GATE_UNREADABLE'
    | 'POTE_NOT_GATED'
    | 'OMNIBUS_NOT_APPOINTED'
    | 'APPOINTMENT_UNREADABLE'
    | 'SPEND_LEDGER_NOT_PERSISTED'
    | 'SPEND_TODAY_UNKNOWN'
    | 'TAG_ON_MINT'
    | 'ABOVE_MAX_TX'
    | 'ABOVE_DAILY_CAP'
    | 'BAD_AMOUNT';
  reason?: string;
}

/**
 * it. 25 (B.1) — ¿A QUIÉN ACOTA EL TOPE? EL TOPE DIARIO Y EL TOPE POR
 * TRANSACCIÓN SON PROTECCIONES DE LA LLAVE OPERATIVA DE ASTRYUM, ES DECIR
 * APLICAN A ENTRADAS Y OPERATIVA PROPIA; EL PAYOUT DEL CLIENTE ES SU DINERO Y
 * SALE.
 *
 * La it. 23 movió la LECTURA del tope debajo de la bifurcación por propósito
 * para que un parpadeo de base de datos no matara una retirada — pero dejó la
 * APLICACIÓN arriba, común a los dos caminos. `ABOVE_DAILY_CAP`, `ABOVE_MAX_TX`
 * y `SPEND_LEDGER_NOT_PERSISTED` seguían cayendo sobre el payout: un cliente que
 * retiraba por encima del tope MEDIDO quedaba `refused` y su dinero retenido
 * hasta la medianoche UTC. El mensaje de aquel commit afirmaba lo contrario de
 * lo que hacía el código.
 *
 * Un número nuestro jamás es motivo para quedarnos con el dinero de nadie. Si la
 * caja no tiene saldo para pagar, eso lo dice el ledger (`tecUNFUNDED_PAYMENT`),
 * no una regla de esta casa; y si la caja está gastando de más, eso se corta
 * donde se gasta —las ENTRADAS y la operativa propia—, nunca en la puerta de
 * salida de un cliente.
 */
export function capApplies(purpose: Purpose): boolean {
  return purpose !== 'payout';
}

/*
 * it. 27 — Y EL CONTADOR TAMPOCO. Esto decía la verdad sobre la APLICACIÓN del
 * tope, pero el payout seguía sumando al total del día (`reserveSpend` →
 * `spentDrops` → `spentToday()`), que es el número con el que esta misma función
 * mide las ENTRADAS. La cárcel se había mudado un piso más abajo: la salida no
 * se negaba a sí misma, se las negaba a todos los demás. La regla vive ahora
 * también en la escritura: `countsAgainstCap`, más abajo.
 */

/**
 * LA DESIGNACIÓN TAMPOCO SE COBRA SOBRE EL CLIENTE (productizer it. 25, cabo).
 *
 * The council's OMNIBUS appointment is what says this desk may OPERATE that
 * account: take money in, put it to work, spend the ledger's reserve. It is
 * ours, it is off-chain policy read from a credential, and the key can still
 * sign without it — so refusing on its absence is a decision of this house,
 * not physics.
 *
 * The comment that used to sit on that check claimed client payouts «van por
 * passkey y no pasan por aquí». They do: a payout is signed by this very key,
 * with `purpose: 'payout'`, and the pinned test asserted the refusal covered
 * it. Comment and test contradicted each other, and the test was winning: a
 * council that let its appointment lapse froze every client's withdrawal —
 * people who did nothing, punished for OUR paperwork.
 *
 * Nothing is bought by that refusal. A payout's Destination is already pinned
 * to `client.xrplAddress`, the registered own wallet of a client of this run:
 * the only thing this key can do on the exit leg is hand a person their own
 * money back. An unappointed desk should stop TAKING money in — and it does,
 * because entries still fail closed here — never stop giving it back.
 *
 * Same shape as `capApplies`, and the same rule: what protects the house is
 * enforced where the house spends, never at somebody's way out.
 */
export function appointmentApplies(purpose: Purpose): boolean {
  return purpose !== 'payout';
}

/**
 * Decide whether the exchange key may sign this Payment. Pure: every fact it
 * needs (who the clients are, what an on-chain gate says, today's spend) is
 * passed in — nothing is read here.
 */
export function assessPayment(input: {
  tx: Record<string, unknown>;
  purpose: Purpose;
  run: Pick<DemoRun, 'omnibusAddress' | 'clients'>;
  signer: Pick<SignerConfig, 'enabled' | 'address' | 'maxTxDrops' | 'dailyCapDrops'> &
    Partial<Pick<SignerConfig, 'allowUngatedPote'>>;
  coreVaultAddress: string;
  /** put-to-work: the Flare account the shares are minted to (inside the userOp). */
  receiver?: string;
  /**
   * put-to-work: the pote's on-chain gate. `configured:true, approved:false` = el
   * depósito REVERTIRÍA — negarse antes de gastar el XRP. `configured:false` = el
   * pote es abierto, y entonces la única barrera que queda es `run.clients`, que
   * es estado que escribe una sesión de admin: se exige el opt-in explícito
   * `allowUngatedPote`. `readFailed` = no se pudo leer, que NO es «no hay
   * puerta»: no poder probar la aprobación nunca puede abrir la puerta.
   */
  onChainGate?: { configured: boolean; approved: boolean; readFailed?: boolean };
  /**
   * Lo gastado hoy por ESTA llave, en drops. Opcional porque solo lo lee un
   * propósito de OPERATIVA PROPIA (ver `capApplies`): la salida de un cliente
   * ni lo consulta, y por eso nunca la detiene. En una entrada, AUSENTE no es
   * cero — es `SPEND_TODAY_UNKNOWN`, y sin el número no se firma.
   */
  spentTodayDrops?: bigint;
  /**
   * ¿El libro de gasto de hoy está PERSISTIDO? Si no lo está, el tope diario vive
   * en memoria del proceso y **cada reinicio lo pone a cero**: un firmante
   * desatendido en crash-loop no tendría tope diario ninguno. Sin persistencia no
   * se firma. (Opcional por compatibilidad: `undefined` = no se comprueba.)
   */
  spendLedgerPersisted?: boolean;
  /**
   * La DESIGNACIÓN del omnibus, leída del ledger por el caller (relacional:
   * ¿sostiene esta cuenta una XLS-70 `OMNIBUS` vigente EMITIDA POR el consejo
   * de este run?). `required:false` = el flag está apagado y no se comprueba.
   * `readFailed` = no se pudo leer, que con el flag encendido NUNCA es estar
   * nombrado: no poder probar el nombramiento no es un nombramiento.
   */
  appointment?: { required: boolean; held: boolean; readFailed?: boolean };
}): PaymentAssessment {
  const { tx, purpose, run, signer } = input;
  if (!signer.enabled || !signer.address) return { ok: false, code: 'SIGNER_DISABLED', reason: 'the exchange key is not enabled on this environment' };
  if (tx.Account !== signer.address || run.omnibusAddress !== signer.address) {
    return { ok: false, code: 'WRONG_SIGNER', reason: `the key opens ${signer.address}, the run omnibus is ${run.omnibusAddress}` };
  }
  // La jerarquía hecha ledger (Enmienda §10): la caja solo opera NOMBRADA por
  // su raíz. Revocarla congela la OPERATIVA —entradas, puesta a trabajar, gasto
  // propio— y jamás la salida de un cliente, que va a su propia wallet
  // registrada y solo le devuelve lo suyo (it. 25, ver `appointmentApplies`).
  if (appointmentApplies(purpose) && input.appointment?.required) {
    if (input.appointment.readFailed) {
      return { ok: false, code: 'APPOINTMENT_UNREADABLE', reason: 'the omnibus appointment could not be read from the ledger — not being able to prove the appointment is not an appointment' };
    }
    if (!input.appointment.held) {
      return {
        ok: false,
        code: 'OMNIBUS_NOT_APPOINTED',
        reason:
          'the run council has not appointed this omnibus on the ledger (no live OMNIBUS credential issued by the council to this account, accepted) — run the designation ceremony, or unset DEMO_EXCHANGE_REQUIRE_APPOINTMENT',
      };
    }
  }
  const amount = typeof tx.Amount === 'string' && /^\d+$/.test(tx.Amount) ? BigInt(tx.Amount) : null;
  if (amount === null || amount <= BigInt(0)) return { ok: false, code: 'BAD_AMOUNT', reason: 'Amount must be a positive drops string' };
  const dest = String(tx.Destination ?? '');
  if (purpose === 'put-to-work') {
    if (dest !== input.coreVaultAddress) return { ok: false, code: 'DESTINATION_NOT_ALLOWED', reason: `a mint payment may only go to the Core Vault ${input.coreVaultAddress}` };
    if (tx.DestinationTag !== undefined) return { ok: false, code: 'TAG_ON_MINT', reason: 'a destination tag on the mint payment would misroute it (FAssets rule)' };
    // The binding the exchange DOES own: the shares may only be minted to the
    // account of one of its own clients (tag ↔ client ↔ account, its books).
    const receiver = (input.receiver ?? '').toLowerCase();
    const isClient = receiver !== '' && run.clients.some((c) => c.passkeyAccount && c.passkeyAccount.toLowerCase() === receiver);
    if (!isClient) return { ok: false, code: 'RECEIVER_NOT_A_CLIENT', reason: 'the shares would be minted to an address that is not the account of a client of this run' };
    // And if the pote has an on-chain gate, it has the last word (the deposit
    // would revert AFTER the XRP is spent).
    if (input.onChainGate?.readFailed) {
      return { ok: false, code: 'GATE_UNREADABLE', reason: "the pote's on-chain gate could not be read — not being able to prove approval is not approval" };
    }
    if (input.onChainGate?.configured && !input.onChainGate.approved) {
      return { ok: false, code: 'RECEIVER_NOT_APPROVED', reason: "the pote's on-chain gate does not approve this account — the deposit would revert" };
    }
    // Pote SIN puerta: la única barrera que queda es `run.clients`, que la
    // escribe una sesión de admin. Puede ser lo que se quiere (el KYC es del
    // exchange, off-chain), pero tiene que ser una decisión dicha en voz alta.
    if (input.onChainGate && !input.onChainGate.configured && !input.signer.allowUngatedPote) {
      return {
        ok: false,
        code: 'POTE_NOT_GATED',
        reason:
          'this pote has no on-chain gate, so nothing on chain says this account is a client — set DEMO_EXCHANGE_ALLOW_UNGATED_POTE=true to sign for an open pote on purpose',
      };
    }
  } else {
    const client = run.clients.find((c) => c.xrplAddress && c.xrplAddress === dest);
    if (!client) return { ok: false, code: 'DESTINATION_NOT_ALLOWED', reason: 'a payout may only go to the registered own wallet of a client of this run' };
  }
  // ── Los TOPES. Debajo de esta línea no se decide nada sobre la salida de un
  // cliente: el tope diario y el tope por transacción son protecciones de la
  // llave operativa de Astryum, es decir aplican a ENTRADAS y operativa propia;
  // el payout del cliente es su dinero y sale (it. 25, B.1 — ver `capApplies`).
  if (capApplies(purpose)) {
    // Un tope que se borra al reiniciar no es un tope.
    if (input.spendLedgerPersisted === false) {
      return {
        ok: false,
        code: 'SPEND_LEDGER_NOT_PERSISTED',
        reason: "today's spend is not persisted (no database), so the daily cap would reset on every restart — an unattended key without a real daily cap does not sign",
      };
    }
    // «No pude leer» no es «0 gastado hoy». Sin el número no hay tope que
    // honrar, y una entrada sin tope no se firma. (Antes el caller mandaba un
    // 0 de mentira al fallar la lectura y el tope quedaba suspendido entero.)
    if (input.spentTodayDrops === undefined) {
      return {
        ok: false,
        code: 'SPEND_TODAY_UNKNOWN',
        reason: "today's spend of this key is unknown, so its daily cap cannot be honoured — an entry does not sign without it (a client's payout never needs it)",
      };
    }
    if (amount > signer.maxTxDrops) return { ok: false, code: 'ABOVE_MAX_TX', reason: `${Number(amount) / 1e6} XRP is above the per-payment cap ${Number(signer.maxTxDrops) / 1e6} XRP` };
    if (input.spentTodayDrops + amount > signer.dailyCapDrops) {
      return { ok: false, code: 'ABOVE_DAILY_CAP', reason: `today's spend ${Number(input.spentTodayDrops) / 1e6} + ${Number(amount) / 1e6} XRP exceeds the daily cap ${Number(signer.dailyCapDrops) / 1e6} XRP` };
    }
  }
  return { ok: true };
}

/* ── CredentialAccept: the omnibus accepting the KYC its root issued ─────── */

export interface CredentialAcceptAssessment {
  ok: boolean;
  code?: 'SIGNER_DISABLED' | 'WRONG_SIGNER' | 'NOT_A_CREDENTIAL_ACCEPT' | 'UNEXPECTED_FIELD' | 'ISSUER_NOT_THE_COUNCIL' | 'TYPE_NOT_A_CLIENT_SLOT';
  reason?: string;
}

/** Everything a CredentialAccept of this door may carry before autofill. */
const CREDENTIAL_ACCEPT_FIELDS = new Set(['TransactionType', 'Account', 'Issuer', 'CredentialType']);

/**
 * El KYC por casilla (diseño B, 14-sep) son DOS firmas del exchange: la raíz
 * EMITE `KYC-<tag>` sobre el omnibus y el omnibus la ACEPTA. La raíz nunca vive
 * en caliente, así que su firma sigue siendo humana (Xaman). La aceptación, en
 * cambio, es un acto de la propia caja — y la llave de la caja ya la tiene este
 * backend. Lo que esta puerta deja firmar, y NADA más:
 *   · un `CredentialAccept`, sin ningún campo extra (ni pagos, ni borrados);
 *   · desde el omnibus del run, que es la cuenta que abre la llave;
 *   · de una credencial EMITIDA POR la raíz de ese run;
 *   · cuyo tipo es el de una casilla de un cliente de ese run (`KYC-<tag>`).
 * Aceptar no mueve dinero: solo pasa al omnibus la reserva de 0,2 XRP del objeto.
 */
export function assessCredentialAccept(input: {
  tx: Record<string, unknown>;
  run: Pick<DemoRun, 'omnibusAddress' | 'councilAddress'>;
  signer: Pick<SignerConfig, 'enabled' | 'address'>;
  /** The slot types of THIS run's clients, as the gate names them (`KYC-<tag>`). */
  slotTypes: string[];
}): CredentialAcceptAssessment {
  const { tx, run, signer } = input;
  if (!signer.enabled || !signer.address) return { ok: false, code: 'SIGNER_DISABLED', reason: 'the exchange key is not enabled on this environment' };
  if (tx.TransactionType !== 'CredentialAccept') {
    return { ok: false, code: 'NOT_A_CREDENTIAL_ACCEPT', reason: 'this door only accepts credentials — it never issues, deletes or pays' };
  }
  const extra = Object.keys(tx).filter((k) => !CREDENTIAL_ACCEPT_FIELDS.has(k));
  if (extra.length) return { ok: false, code: 'UNEXPECTED_FIELD', reason: `a CredentialAccept of this door carries only ${[...CREDENTIAL_ACCEPT_FIELDS].join(', ')} — got ${extra.join(', ')}` };
  if (tx.Account !== signer.address || run.omnibusAddress !== signer.address) {
    return { ok: false, code: 'WRONG_SIGNER', reason: `the key opens ${signer.address}, the run omnibus is ${run.omnibusAddress}` };
  }
  if (tx.Issuer !== run.councilAddress) {
    return { ok: false, code: 'ISSUER_NOT_THE_COUNCIL', reason: `only a credential issued by the run root ${run.councilAddress} is accepted here` };
  }
  const hex = typeof tx.CredentialType === 'string' ? tx.CredentialType : '';
  const text = hex.length > 0 && hex.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(hex) ? Buffer.from(hex, 'hex').toString('utf8') : '';
  if (!text || !input.slotTypes.includes(text)) {
    return { ok: false, code: 'TYPE_NOT_A_CLIENT_SLOT', reason: `the credential type ${text || hex || '(empty)'} is not the KYC of a client slot of this run` };
  }
  return { ok: true };
}

/* ── the appointment read (relational, never an allowlist) ───────────────── */

/**
 * ¿El consejo de este run ha NOMBRADO a este omnibus en el ledger? Lee las
 * XLS-70 de la cuenta omnibus y busca una de tipo `OMNIBUS` cuyo EMISOR sea el
 * consejo, aceptada y vigente. Es la verificación RELACIONAL de la Enmienda
 * §10: el emisor ES la relación — las allowlists globales de emisores no
 * pintan nada aquí. Con el flag apagado devuelve held:true sin leer nada.
 */
export async function readOmnibusAppointment(
  omnibus: string,
  council: string,
): Promise<{ required: boolean; held: boolean; readFailed?: boolean }> {
  const required = process.env.DEMO_EXCHANGE_REQUIRE_APPOINTMENT === 'true';
  if (!required) return { required, held: true };
  try {
    const { readAccountCredentials } = await import('../XrplCredentialVerifier');
    const held = (await readAccountCredentials(omnibus)).credentials.some(
      (c) =>
        c.issuer === council &&
        c.credentialType.toUpperCase() === 'OMNIBUS' &&
        (c.state === 'valid' || c.state === 'expiring-soon'),
    );
    return { required, held };
  } catch {
    return { required, held: false, readFailed: true };
  }
}

/* ── spend ledger (per UTC day; persisted, STRICT both ways) ─────────────── */

/**
 * Where a payment is in its life against the cap. A RESERVATION is written
 * BEFORE the blob leaves this process; it becomes SETTLED when the ledger says
 * the payment entered, and it is GIVEN BACK (deleted) when the ledger proves it
 * never did. Nothing is ever counted twice: the txHash is the key.
 */
export type SpendPhase = 'reserved' | 'settled';

interface SpendEntry {
  at: string;
  drops: string;
  txHash: string;
  purpose: Purpose;
  /** Absent on rows written before it. 23: read as 'settled' (they were). */
  phase?: SpendPhase;
}

interface SpendDay {
  day: string;
  spentDrops: string;
  entries: SpendEntry[];
  /** Compare-and-set version; absent (legacy rows) = 0. */
  version?: number;
}

const spendMemory = new Map<string, SpendDay>();

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function emptyDay(day: string): SpendDay {
  return { day, spentDrops: '0', entries: [], version: 0 };
}

function normaliseDay(raw: Record<string, unknown> | null, day: string): SpendDay | null {
  if (!raw) return null;
  const spent = typeof raw.spentDrops === 'string' && /^\d+$/.test(raw.spentDrops) ? raw.spentDrops : '0';
  const entries = Array.isArray(raw.entries) ? (raw.entries as SpendEntry[]) : [];
  const version = Number(raw.version ?? 0);
  return { day, spentDrops: spent, entries, version: Number.isFinite(version) ? version : 0 };
}

/** STRICT read of a day's WHOLE record — the total and the entries. Throws when the database cannot answer. */
async function readSpendDay(day: string): Promise<SpendDay | null> {
  return normaliseDay((await kvGetStrict(SPEND_JOB_TYPE, 'day', day)) as Record<string, unknown> | null, day);
}

/**
 * it. 25 (B.4) — LA MEDIANOCHE UTC DESCUADRABA LA CONTABILIDAD.
 *
 * `reserveSpend` escribe en el día de la RESERVA, pero `recordSpend` y
 * `releaseSpend` volvían a evaluar `todayKey(now)` cuando el ledger hablaba. Una
 * reserva hecha a las 23:59:59 y liquidada un segundo después caía en D+1: su
 * importe se contaba DOS veces (reservado en D, asentado otra vez en D+1) y la
 * reserva de D quedaba huérfana comiéndose el tope de aquel día; y `releaseSpend`
 * no encontraba nada que devolver, así que un pago muerto seguía gastado.
 *
 * La liquidación y la devolución buscan el hash en el día en que se RESERVÓ.
 * Dos días de ventana bastan de sobra: un pago de este bucle vive ~80 s
 * (LastLedgerSequence + 20 ledgers), y lo que no aparece ahí lo barre
 * `sweepStaleReservations`.
 */
const SPEND_LOOKBACK_DAYS = 2;

function dayKeysBack(now: Date, days = SPEND_LOOKBACK_DAYS): string[] {
  const keys: string[] = [];
  for (let i = 0; i < days; i++) keys.push(todayKey(new Date(now.getTime() - i * 86_400_000)));
  return keys;
}

/** A day's record as it stands: the database when there is one, the in-process map when there is not. */
async function currentSpendDay(day: string): Promise<SpendDay | null> {
  return (await readSpendDay(day)) ?? spendMemory.get(day) ?? null;
}

/** The day whose record already carries this hash — the day of the RESERVATION, never the day of `now`. */
async function dayOfEntry(txHash: string, now: Date): Promise<string | null> {
  for (const day of dayKeysBack(now)) {
    const record = await currentSpendDay(day);
    if (record?.entries.some((e) => e.txHash === txHash)) return day;
  }
  return null;
}

/**
 * it. 21 (it. 20, agent B's note) — «I COULD NOT READ» WAS READING AS «NOTHING
 * SPENT YET», AND THAT REOPENS A CAP ON A KEY THAT SIGNS.
 *
 * This is the daily ceiling of the omnibus seed: the one number that bounds how
 * much Astryum's own key can move in a day. It was read with the soft `kvGet`,
 * which turns a database error into `null`, and the fallback is the in-process
 * memory — empty after every restart. A blink of Postgres therefore answered
 * «0 spent today» and handed the signer its whole cap again, silently.
 *
 * Read strictly and LET THE CALLER DECIDE.
 *
 * it. 23 (1.7) — THE COMMENT THAT USED TO SIT HERE SAID «NOBODY'S WAY OUT
 * DEPENDS ON THIS». IT WAS WRONG, AND IT STOPPED A CLIENT'S WITHDRAWAL.
 * The autopilot read this ONCE, before it knew whether the request in its hand
 * was a put-to-work (an entry: our key spending) or a PAYOUT (a client's money
 * going home). A blink therefore threw on the way OUT too, the exception died in
 * the tick's `errors.push`, and the withdrawal sat pending with no refusal and no
 * sentence — dragging every other client of that run with it. The cap protects
 * OUR key; it is not a gate on anybody's exit. The caller now branches BEFORE it
 * needs this number: the entry fails closed, the exit proceeds and the fact that
 * we could not read our own ledger is recorded (`DemoExchangeAutopilot.fulfil`).
 */
export async function spentToday(now = new Date()): Promise<bigint> {
  const day = todayKey(now);
  const stored = await readSpendDay(day);
  if (stored) return BigInt(stored.spentDrops);
  return BigInt(spendMemory.get(day)?.spentDrops ?? '0');
}

/** How many times a compare-and-set of the day record is retried before it gives up. */
const SPEND_CAS_ATTEMPTS = 4;

/**
 * it. 23 (1.4) — THE OTHER HALF OF THE CAP: THE WRITE.
 *
 * `kvUpsert` SWALLOWS a failed write (best-effort by design), and the spend was
 * written AFTER the blob had been submitted. So a key at 150 of 200 that loses
 * the write of its 150 is read as 150 by nobody: the next tick reads the OLD
 * total and hands the whole cap back — 230 XRP signed under a cap of 200, with
 * nothing in any log.
 *
 * Every mutation of the day record now goes through here: STRICT read, mutate,
 * `kvCompareAndSet` (one atomic conditional UPDATE under an advisory lock), and
 * a failure THROWS. The CAS also closes the older hole this had — two ticks (or
 * two instances during an overlapping deploy) read-modify-writing the same row
 * and one erasing the other's payment.
 *
 * Without `DATABASE_URL` there is no ledger to write: the in-process map is all
 * there is, and `assessPayment` already refuses to sign against it
 * (`SPEND_LEDGER_NOT_PERSISTED`).
 */
async function mutateSpendDay(day: string, mutate: (current: SpendDay) => SpendDay | null): Promise<SpendDay> {
  if (!process.env.DATABASE_URL) {
    const current = spendMemory.get(day) ?? emptyDay(day);
    const next = mutate(current);
    if (next) spendMemory.set(day, next);
    return next ?? current;
  }
  for (let attempt = 0; attempt < SPEND_CAS_ATTEMPTS; attempt++) {
    const stored = (await readSpendDay(day)) ?? emptyDay(day);
    const next = mutate(stored);
    if (!next) {
      // Nothing to write: the record already says what this call wanted it to say.
      spendMemory.set(day, stored);
      return stored;
    }
    const expectedVersion = stored.version ?? 0;
    next.version = expectedVersion + 1;
    const outcome = await kvCompareAndSet(SPEND_JOB_TYPE, 'day', day, next as unknown as Record<string, unknown>, {
      versionField: 'version',
      expectedVersion,
    });
    if (outcome === 'written') {
      spendMemory.set(day, next);
      return next;
    }
    // Somebody else wrote between the read and the write: read again and redo
    // the mutation on top of THEIR record, never on top of ours.
  }
  throw new Error(`the daily spend ledger of ${day} could not be written after ${SPEND_CAS_ATTEMPTS} attempts (another writer kept winning)`);
}

/**
 * it. 27 — EL TOTAL DEL DÍA SOLO CUENTA LO QUE EL TOPE ACOTA.
 *
 * `capApplies` dice desde la it. 25 que el tope diario no se aplica a la salida
 * de un cliente… pero el payout SEGUÍA SUMANDO a `spentDrops`, que es
 * exactamente el número que `spentToday()` devuelve y que la política compara
 * con el tope en las ENTRADAS. Una retirada de 120 XRP con el tope por defecto
 * de 200 dejaba a TODOS los clientes de TODAS las tomas sin poder entrar hasta
 * la medianoche UTC: el dinero de un cliente volviendo a su casa estrangulaba la
 * operativa de la casa, cuando no es gasto nuestro en ningún sentido.
 *
 * El apunte se escribe igual —con su hash, su importe, su propósito y su fase—
 * porque la auditoría del ómnibus necesita ver TODO lo que esta llave PAGÓ. Lo
 * que no hace es engordar el contador que acota a los demás.
 *
 * it. 29 — Y EL CONTADOR SE LLAMA POR SU NOMBRE. Decía que `spentDrops` es «lo
 * gastado por la casa hoy», y no lo es: lo que esta llave firma sin pagar a
 * nadie no pasa por aquí (un `CredentialAccept` consume reserva de propietario y
 * comisión, y no deja apunte — ver `acceptIssuedSlotCredentials`). `spentDrops`
 * es «lo que esta llave ha PAGADO hoy y el tope acota»: ni todo lo que ha salido
 * de la cuenta, ni todo lo que le ha costado a la casa.
 *
 * Toda mutación del total pasa por aquí: reservar, asentar, devolver y barrer
 * usan la MISMA regla, o el contador se descuadraría al devolver algo que nunca
 * sumó.
 */
function countsAgainstCap(purpose: Purpose | undefined): boolean {
  // `undefined` = apunte de un build anterior a la it. 23, que sí sumó: se
  // devuelve igual que se contó.
  return purpose === undefined || capApplies(purpose);
}

/**
 * RESERVE these drops against today's cap, BEFORE the signed blob is submitted.
 * Idempotent per hash. THROWS when the ledger could not be written — the caller
 * decides what that means for the payment in its hand (an entry does not go; an
 * exit does, and says so).
 *
 * Un payout deja su apunte pero NO suma al total (it. 27, `countsAgainstCap`).
 */
export async function reserveSpend(drops: bigint, txHash: string, purpose: Purpose, now = new Date()): Promise<void> {
  await mutateSpendDay(todayKey(now), (record) => {
    if (txHash && record.entries.some((e) => e.txHash === txHash)) return null;
    const add = countsAgainstCap(purpose) ? drops : BigInt(0);
    return {
      ...record,
      spentDrops: (BigInt(record.spentDrops) + add).toString(),
      entries: [...record.entries, { at: now.toISOString(), drops: drops.toString(), txHash, purpose, phase: 'reserved' }],
    };
  });
}

/**
 * The payment entered a ledger: the reservation becomes a settled spend. When
 * there is no reservation (a submission replayed from the journal of an older
 * build, or a hash this process never reserved) it is counted here — still once
 * per hash, so a replay never counts its XRP twice.
 */
export async function recordSpend(drops: bigint, txHash: string, purpose: Purpose, now = new Date()): Promise<void> {
  // El día de la RESERVA, no el de ahora (it. 25, B.4): una reserva de las
  // 23:59 que asienta a las 00:00 se marca donde está, y así no se cuenta dos
  // veces. Sin reserva previa (un replay del journal de otro build) se cuenta
  // hoy — una vez por hash, como siempre.
  const day = (txHash ? await dayOfEntry(txHash, now) : null) ?? todayKey(now);
  await mutateSpendDay(day, (record) => {
    const idx = txHash ? record.entries.findIndex((e) => e.txHash === txHash) : -1;
    if (idx >= 0) {
      if ((record.entries[idx].phase ?? 'settled') === 'settled') return null;
      const entries = record.entries.slice();
      entries[idx] = { ...entries[idx], phase: 'settled' };
      return { ...record, entries };
    }
    const add = countsAgainstCap(purpose) ? drops : BigInt(0);
    return {
      ...record,
      spentDrops: (BigInt(record.spentDrops) + add).toString(),
      entries: [...record.entries, { at: now.toISOString(), drops: drops.toString(), txHash, purpose, phase: 'settled' }],
    };
  });
}

/**
 * THE RECONCILIATION of a reservation the ledger proved wrong: the payment never
 * entered (searched in full, past its LastLedgerSequence) or entered with a
 * failure, so its drops never left the omnibus and the cap gets them back.
 *
 * Only a RESERVED entry is given back. A settled one moved real XRP, and «the
 * database is slow» is not a reason to un-spend it.
 */
export async function releaseSpend(txHash: string, now = new Date()): Promise<void> {
  if (!txHash) return;
  // El día de la RESERVA (it. 25, B.4). Buscándolo en `todayKey(now)`, una
  // reserva de ayer no se devolvía nunca: el pago estaba muerto y su importe
  // seguía gastado.
  const day = await dayOfEntry(txHash, now);
  if (!day) return; // nada reservado bajo este hash en la ventana: no hay qué devolver
  await mutateSpendDay(day, (record) => {
    const idx = record.entries.findIndex((e) => e.txHash === txHash);
    if (idx < 0) return null;
    const entry = record.entries[idx];
    if ((entry.phase ?? 'settled') === 'settled') return null;
    const entries = record.entries.slice();
    entries.splice(idx, 1);
    // Se devuelve lo que se contó, no lo que se movió (it. 27): un payout nunca
    // sumó al total, así que devolverlo lo dejaría por debajo de lo gastado.
    const back = countsAgainstCap(entry.purpose) ? BigInt(entry.drops) : BigInt(0);
    const total = BigInt(record.spentDrops);
    return { ...record, spentDrops: (total > back ? total - back : BigInt(0)).toString(), entries };
  });
}

/**
 * Cuánto vive una RESERVA sin noticia del ledger antes de considerarse huérfana.
 * Un pago de este bucle entra o muere en ~80 s (LastLedgerSequence + 20
 * ledgers), así que una hora es una eternidad a esa escala: lo único que
 * sobrevive tanto es una reserva cuya suerte NADIE llegó a escribir — el
 * reinicio a medio vuelo. `DEMO_EXCHANGE_SPEND_RESERVATION_TTL_MIN` para
 * afinarlo.
 */
function reservationTtlMs(): number {
  const min = Number(process.env.DEMO_EXCHANGE_SPEND_RESERVATION_TTL_MIN ?? 60);
  return (Number.isFinite(min) && min > 0 ? min : 60) * 60_000;
}

export interface SweptReservation {
  day: string;
  txHash: string;
  drops: string;
  purpose: Purpose;
  ageMs: number;
}

/**
 * it. 25 (B.4) — BARRIDO DE RESERVAS HUÉRFANAS.
 *
 * Una reserva que no se liquidó ni se devolvió (el proceso murió entre
 * `reserveSpend` y el veredicto del ledger, y con él la petición que lo iba a
 * resolver) se queda comiendo tope para siempre: al día siguiente la operativa
 * propia arranca estrangulada por un pago que nunca existió. Este barrido se la
 * devuelve y dice cuál era, para que un humano reconcilie contra el historial
 * del ómnibus.
 *
 * SOLO PUEDE ABRIR, JAMÁS CERRAR: devuelve importe al tope, y el tope solo
 * acota ENTRADAS y operativa propia (`capApplies`). Ninguna salida de ningún
 * cliente depende de esto, ni puede ser negada por esto.
 *
 * Devuelve lo barrido (vacío = nada que barrer) para que el caller lo avise por
 * el canal de ops: un barrido es siempre la huella de un vuelo interrumpido.
 */
export async function sweepStaleReservations(now = new Date()): Promise<SweptReservation[]> {
  const ttl = reservationTtlMs();
  const isStale = (e: SpendEntry) => (e.phase ?? 'settled') === 'reserved' && now.getTime() - Date.parse(e.at) > ttl;
  const swept: SweptReservation[] = [];
  for (const day of dayKeysBack(now)) {
    const record = await currentSpendDay(day);
    const stale = (record?.entries ?? []).filter(isStale);
    if (!stale.length) continue;
    const staleHashes = new Set(stale.map((e) => e.txHash));
    await mutateSpendDay(day, (current) => {
      // Se relee dentro del CAS: entre la lectura de arriba y esta escritura el
      // ledger puede haber hablado, y un asentado jamás se des-gasta.
      const give = current.entries.filter((e) => staleHashes.has(e.txHash) && isStale(e));
      if (!give.length) return null;
      // Igual que `releaseSpend`: solo vuelve lo que llegó a contar (it. 27).
      const back = give.reduce((acc, e) => acc + (countsAgainstCap(e.purpose) ? BigInt(e.drops) : BigInt(0)), BigInt(0));
      const total = BigInt(current.spentDrops);
      return {
        ...current,
        spentDrops: (total > back ? total - back : BigInt(0)).toString(),
        entries: current.entries.filter((e) => !give.includes(e)),
      };
    });
    for (const e of stale) swept.push({ day, txHash: e.txHash, drops: e.drops, purpose: e.purpose, ageMs: now.getTime() - Date.parse(e.at) });
  }
  return swept;
}

/** Tests only: forget the in-process spend ledger. */
export function __resetSpendMemory(): void {
  spendMemory.clear();
}

/* ── sign + submit (the only place the seed is used) ─────────────────────── */

export interface SubmitResult {
  txHash: string;
  result: string;
  validated: boolean;
}

/**
 * The exact txjson the omnibus seed signs: pinned to the omnibus account and
 * WITHOUT the project SourceTag. Pure, so the no-tag rule is testable offline.
 */
export function omnibusTxForSigning(txjson: Record<string, unknown>, omnibusAddress: string): Record<string, unknown> {
  const tx: Record<string, unknown> = { ...txjson, Account: omnibusAddress };
  // A seed this backend holds signs it ⇒ operational ⇒ never the project tag
  // (xrplSourceTag.ts carve-out; Make Waves T&C §7). Stripped here, at the only
  // place the seed signs, so no caller can smuggle it back in.
  delete tx.SourceTag;
  return tx;
}

/** A payment the omnibus key has signed but not necessarily submitted. */
export interface SignedSubmission {
  txBlob: string;
  hash: string;
  lastLedgerSequence: number;
  /** Last validated ledger when it was signed — the lower bound of any later search. */
  submittedAtLedger: number;
}

function omnibusClient(Client: typeof import('xrpl').Client) {
  // s1, no xrplcluster: xrplcluster devuelve 402 al upgrade del WebSocket desde IPs
  // de datacenter (Railway), y el autopilot moría en «SIGN_FAILED: … 402» (14-sep).
  return new Client(process.env.XRPL_WS_URL || 'wss://s1.ripple.com', { connectionTimeout: 10_000 });
}

/**
 * Step 1 of a reliable submission (xrpl.org): SIGN, with a LastLedgerSequence,
 * and hand the hash back so the caller persists it BEFORE anything reaches the
 * network. Sign and submit used to be one call: a submit that threw after the
 * payment left skipped the caller's save, and the next tick signed a second,
 * different payment.
 */
export async function signForSubmission(txjson: Record<string, unknown>): Promise<SignedSubmission> {
  const seed = process.env.DEMO_EXCHANGE_OMNIBUS_SEED;
  if (!seed) throw new Error('DEMO_EXCHANGE_OMNIBUS_SEED is not set');
  const { Client } = await import('xrpl');
  const { xrplWalletFromSecret } = await import('../../utils/xrplSecret');
  const wallet = xrplWalletFromSecret(seed);
  const tx = omnibusTxForSigning(txjson, wallet.classicAddress);
  const client = omnibusClient(Client);
  try {
    await client.connect();
    const submittedAtLedger = await client.getLedgerIndex();
    // A caller that already carries a LastLedgerSequence (a 0xFE whose nonce seat
    // RECORDED that window) has its window honoured, never re-stamped: the seat
    // and the payment must bound the same ledgers (it. 14, R1 1.1).
    const pinned = typeof tx.LastLedgerSequence === 'number' ? (tx.LastLedgerSequence as number) : null;
    if (pinned !== null && submittedAtLedger >= pinned) {
      throw new Error(`LastLedgerSequence ${pinned} is already past (validated ledger ${submittedAtLedger}): this payment can never enter a ledger — compose it again`);
    }
    const prepared = (await client.autofill(tx as never)) as unknown as Record<string, unknown>;
    // autofill sets it; never sign without one — without it a lost payment can
    // land at any future time and nothing can ever prove it dead.
    if (typeof prepared.LastLedgerSequence !== 'number') prepared.LastLedgerSequence = submittedAtLedger + 20;
    if (pinned !== null && prepared.LastLedgerSequence !== pinned) {
      throw new Error(`the prepared payment carries LastLedgerSequence ${String(prepared.LastLedgerSequence)}, not the ${pinned} it was composed with — nothing was signed`);
    }
    const signed = wallet.sign(prepared as never);
    return {
      txBlob: signed.tx_blob,
      hash: signed.hash,
      lastLedgerSequence: prepared.LastLedgerSequence as number,
      submittedAtLedger,
    };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

/** Step 2: submit an already-signed blob and wait for its validated result. May throw after it left. */
export async function submitSignedBlob(txBlob: string): Promise<SubmitResult> {
  const { Client } = await import('xrpl');
  const client = omnibusClient(Client);
  try {
    await client.connect();
    const res = await client.submitAndWait(txBlob);
    const result = (res.result.meta as { TransactionResult?: string } | undefined)?.TransactionResult ?? '?';
    return { txHash: res.result.hash, result, validated: res.result.validated === true };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

async function rawXrplRpc(url: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`xrpl_http_${res.status}`);
  const body = (await res.json().catch(() => null)) as { result?: unknown } | null;
  return body?.result;
}

/**
 * Step 3, on a later tick: what became of a persisted submission. Reads the
 * validated ledger index FIRST and then `tx` with [min, max] on the SAME node,
 * so «not found, fully searched, and the ledger is past LastLedgerSequence» is
 * a proof, not a race. Not `xrplJsonRpc`: it treats `txnNotFound` as a
 * transport error and never shows `searched_all`.
 */
export async function lookupSubmission(
  hash: string,
  submittedAtLedger: number | undefined,
  lastLedgerSequence: number,
): Promise<{ lookup: import('./submissionVerdict').TxLookup; validatedLedgerIndex: number | null }> {
  const { xrplHttpEndpoints } = await import('../flare/DirectMintExecutorService');
  const { parseTxLookup, searchWindow } = await import('./submissionVerdict');
  const { min, max } = searchWindow(submittedAtLedger, lastLedgerSequence);
  // A node without the full range answers searched_all:false — keep that as a
  // fallback and ask the next node, instead of waiting forever on one node's
  // missing history (iteration 3).
  let partial: { lookup: import('./submissionVerdict').TxLookup; validatedLedgerIndex: number | null } | null = null;
  for (const url of xrplHttpEndpoints()) {
    try {
      const ledger = (await rawXrplRpc(url, 'ledger', { ledger_index: 'validated' })) as
        | { ledger_index?: unknown; ledger?: { ledger_index?: unknown } }
        | undefined;
      const idx = Number(ledger?.ledger_index ?? ledger?.ledger?.ledger_index);
      const lookup = parseTxLookup(await rawXrplRpc(url, 'tx', { transaction: hash, binary: false, min_ledger: min, max_ledger: max }));
      if (lookup.kind === 'unreadable') continue;
      const answer = { lookup, validatedLedgerIndex: Number.isFinite(idx) ? idx : null };
      if (lookup.kind === 'not-found' && !lookup.searchedAll) {
        partial = answer;
        continue;
      }
      return answer;
    } catch {
      /* next node */
    }
  }
  return partial ?? { lookup: { kind: 'unreadable' }, validatedLedgerIndex: null };
}

// `_attribution` is kept for call-site compatibility only: the omnibus is
// always operational (see readSignerConfig). New code uses the three steps.
export async function signAndSubmit(txjson: Record<string, unknown>, _attribution?: 'user' | 'operational'): Promise<SubmitResult> {
  const signed = await signForSubmission(txjson);
  return submitSignedBlob(signed.txBlob);
}
