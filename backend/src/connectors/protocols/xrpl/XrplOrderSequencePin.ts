/**
 * XrplOrderSequencePin — UNA orden firmable por asiento de Sequence (2026-09-14).
 *
 * EL FALLO. Las órdenes de consejo que componen `/pote-council-order/prepare`,
 * `/cage-order/prepare` y el nacimiento `/cage-create/prepare` salían SIN Sequence
 * ni LastLedgerSequence: Xaman los autorrellena al abrir el payload. Cualquier
 * ancestro que desmonte el componente de firma (un enlace de navegación, un cambio
 * de lente, cerrar un modal) deja al usuario componer una SEGUNDA orden mientras la
 * primera sigue firmable en su móvil (un payload ALREADY_OPENED no se puede
 * cancelar). Sin Sequence fijada, las dos validan: dos `directTo`, dos recalls, dos
 * potes, dos nacimientos — y dos rondas FDC pagadas.
 *
 * LO QUE FIJA. La Sequence ACTUAL de la cuenta, leída del ledger VALIDADO en un nodo
 * FRESCO (`xrplJsonRpc(..., { requireFresh: true })`: el transporte que descarta un
 * rippled congelado, incidente 2026-07-31). Dos composiciones seguidas llevan la
 * MISMA Sequence, así que solo una puede entrar en el ledger: la otra muere
 * `tefPAST_SEQ`. Es el mismo patrón que ya usa el coordinador multisig
 * (`XrplMultisigCoordinator.prepareCouncilMultisig`).
 *
 * LastLedgerSequence — SOLO en la firma simple. La ventana es
 * `ORDER_LEDGER_WINDOW` ledgers sobre el validado. Una cuenta CON SignerList va por
 * las puertas del consejo (`CouncilSigningDoors` → `/multisign/prepare`), cuyo
 * coordinador re-lee y fija su propia Sequence y cuyos payloads por miembro viven
 * `expire: 1440` (y el buzón asíncrono, días): estampar ahí un LastLedgerSequence de
 * minutos mataría la ceremonia a mitad de firmas. En esa cuenta se fija la Sequence
 * (el coordinador la sobrescribe con la suya; el asiento lo guarda su arriendo) y
 * NO se estampa LastLedgerSequence.
 *
 * SIN LECTURA NO HAY ORDEN. Si `account_info` no se puede leer, se lanza
 * `OrderSequenceUnreadableError` y la ruta responde 503 ORDER_SEQUENCE_UNREADABLE:
 * jamás se compone una orden sin fijar. «No pude leer» no es «no hay asiento».
 *
 * Prepare-only: lee el ledger y fija bytes. No firma, no envía, no guarda clave.
 */

/**
 * Ledgers que una orden de firma simple sigue siendo firmable tras componerse.
 *
 * Xaman crea el payload con `expire` de 5 minutos (300 s). El XRPL cierra un ledger
 * cada ~3-5 s, así que 5 minutos son ~60-100 ledgers. 150 da margen para:
 *  · el rato entre componer y abrir el payload (leer la divulgación);
 *  · la tolerancia del transporte «fresco» (un nodo aceptado puede ir hasta
 *    `MAX_VALIDATED_LEDGER_AGE_S` por detrás, lo que acorta la ventana real);
 *  · una firma en el último segundo del payload, que aún debe caber.
 * Y es CORTO a propósito: pasado, la orden ya no puede entrar en ningún ledger, así
 * que un payload olvidado en un móvil muere solo (~7,5-12,5 min) en vez de quedar
 * firmable indefinidamente junto a la orden que la sustituyó.
 */
export const ORDER_LEDGER_WINDOW = 150;

export interface OrderSequencePin {
  account: string;
  /** Sequence actual de la cuenta en el ledger validado — la que se estampa. */
  sequence: number;
  /** El ledger validado sobre el que se leyó. */
  validatedLedgerIndex: number;
  /** validado + ORDER_LEDGER_WINDOW; null en una cuenta de consejo (SignerList). */
  lastLedgerSequence: number | null;
  /** La cuenta tiene SignerList: firma por el coordinador multisig. */
  multisigCouncil: boolean;
}

export class OrderSequenceUnreadableError extends Error {
  readonly code = 'ORDER_SEQUENCE_UNREADABLE';
  constructor(account: string, cause: string) {
    super(
      `No se pudo leer la Sequence de ${account} en el ledger validado (${cause}). No se compone una orden sin ` +
        'fijarla: sin Sequence, una segunda orden compuesta mientras la primera sigue firmable validaría también. ' +
        'Nada se ha preparado; vuelve a intentarlo (si la cuenta no está fondeada, no puede firmar ninguna orden).',
    );
    this.name = 'OrderSequenceUnreadableError';
  }
}

/** Lectura cruda de `account_info` — estructural para los tests. */
export type AccountInfoReader = (account: string) => Promise<Record<string, unknown>>;

const defaultAccountInfo: AccountInfoReader = async (account) => {
  const { xrplJsonRpc } = await import('../../../services/flare/DirectMintExecutorService');
  return (await xrplJsonRpc(
    'account_info',
    { account, ledger_index: 'validated', signer_lists: true },
    undefined,
    { requireFresh: true },
  )) as Record<string, unknown>;
};

/**
 * Lee la Sequence y el ledger validado de `account`. Lanza
 * `OrderSequenceUnreadableError` ante cualquier lectura que no dé las dos cifras.
 */
export async function readOrderSequencePin(
  account: string,
  reader: AccountInfoReader = defaultAccountInfo,
): Promise<OrderSequencePin> {
  let result: Record<string, unknown>;
  try {
    result = await reader(account);
  } catch (e) {
    throw new OrderSequenceUnreadableError(account, (e as Error)?.message?.slice(0, 120) ?? 'lectura fallida');
  }
  if (!result || typeof result !== 'object') throw new OrderSequenceUnreadableError(account, 'respuesta vacía');
  if (result.validated === false) throw new OrderSequenceUnreadableError(account, 'el nodo respondió un ledger no validado');

  const data = (result.account_data ?? {}) as { Sequence?: unknown; signer_lists?: unknown };
  const sequence = Number(data.Sequence);
  const validatedLedgerIndex = Number(result.ledger_index);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new OrderSequenceUnreadableError(account, 'account_info sin Sequence');
  }
  if (!Number.isSafeInteger(validatedLedgerIndex) || validatedLedgerIndex <= 0) {
    throw new OrderSequenceUnreadableError(account, 'account_info sin ledger_index validado');
  }

  // api_version: la v1 (JSON-RPC HTTP) anida `signer_lists` en account_data; la v2
  // (el WS de xrpl.js) lo devuelve en la raíz. Se leen los dos sitios (mismo criterio
  // que XRPLProvider.getSignerCouncil).
  const lists = (result.signer_lists ?? data.signer_lists ?? []) as unknown;
  const multisigCouncil =
    Array.isArray(lists) &&
    lists.some((l) => Array.isArray((l as { SignerEntries?: unknown })?.SignerEntries) && (l as { SignerEntries: unknown[] }).SignerEntries.length > 0);

  return {
    account,
    sequence,
    validatedLedgerIndex,
    lastLedgerSequence: multisigCouncil ? null : validatedLedgerIndex + ORDER_LEDGER_WINDOW,
    multisigCouncil,
  };
}

/**
 * Estampa el pin sobre el Payment sin firmar. Se niega si el pin se leyó para otra
 * cuenta (una Sequence ajena haría la orden infirmable). Un LastLedgerSequence que
 * trajera el tx se sustituye: la ventana la decide el pin, no quien compuso.
 */
export function pinOrderPayment<T extends object>(tx: T, pin: OrderSequencePin): T & { Sequence: number } {
  const account = (tx as { Account?: unknown }).Account;
  if (account !== pin.account) {
    throw new Error(`order pin was read for ${pin.account}, but the payment is from ${String(account)}`);
  }
  const { LastLedgerSequence: _dropped, ...rest } = tx as T & { LastLedgerSequence?: unknown };
  void _dropped;
  return {
    ...(rest as T),
    Sequence: pin.sequence,
    ...(pin.lastLedgerSequence !== null ? { LastLedgerSequence: pin.lastLedgerSequence } : {}),
  };
}
