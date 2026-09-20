/**
 * txResult — qué significa, para el dinero, el código que devuelve XRPL.
 *
 * DOS FALLOS QUE CIERRA (incidente del fundador, 22-ago-2026: un recibo colgado
 * en «In progress» sobre una tx que no existe en el ledger).
 *
 *  1. **El fallo que no se reconocía.** `XamanWalletService.submitTransaction`
 *     pedía el payload con `options.submit: true` — Xaman envía la tx y guarda
 *     el veredicto del nodo en `response.dispatched_result` — y devolvía
 *     `response.txid` SIN MIRARLO. El txid es el hash del blob firmado y existe
 *     aunque el nodo la haya rechazado, así que el vigilante se quedaba
 *     esperando un hash que jamás iba a aparecer.
 *
 *  2. **El verde no ganado.** El vigilante daba por asentada cualquier tx con
 *     `validated === true`, sin leer `meta.TransactionResult`. Un `tec*` ESTÁ
 *     validado —ocupa ledger y cobra fee— y sin embargo NO hizo lo que se pedía.
 *     Se pintaba verde sobre un pago que no ocurrió.
 *
 * Las clases, tal y como XRPL las define:
 *
 *  · `tes` — la única que asienta.
 *  · `tec` — VALIDADA y fallida: está en el ledger, cobró fee, no hizo el trabajo.
 *            Terminal, y hay que decir que costó dinero.
 *  · `ter` — reintentable: el nodo la retiene y puede entrar en un ledger
 *            posterior. NO es terminal; seguir vigilando es lo correcto.
 *  · `tef` / `tem` / `tel` — jamás entrará: malformada, ya aplicada, secuencia
 *            pasada o rechazada localmente. Terminal, y sin coste.
 *
 * Puro a propósito: la regla se ejecuta en tests, no se lee en un `if` metido
 * en un componente. Es la lección que este repo lleva reaprendiendo.
 */

export type XrplResultClass =
  /** `tes*` — asentada. */
  | 'success'
  /** `ter*` — todavía puede entrar en un ledger posterior; seguir vigilando. */
  | 'retryable'
  /** `tec*` — validada, fallida, y cobró fee. Terminal. */
  | 'failed-onchain'
  /** `tef*`/`tem*`/`tel*` — nunca entrará en el ledger. Terminal, sin coste. */
  | 'failed-never'
  /** Sin código todavía (Xaman aún no ha despachado, o el campo no viene). */
  | 'unknown';

/**
 * Clasifica un código de resultado de XRPL (`tesSUCCESS`, `tecUNFUNDED_PAYMENT`,
 * `tefPAST_SEQ`…). Un código vacío/ausente es `unknown` — NUNCA se inventa un
 * veredicto: «no lo he leído» no es «ha fallado» (el bug del recibo del 17-ago,
 * donde anunciar el timeout como fallo empujaba al doble depósito).
 */
export function classifyXrplResult(code: string | null | undefined): XrplResultClass {
  const c = (code ?? '').trim();
  if (!c) return 'unknown';
  const prefix = c.slice(0, 3).toLowerCase();
  if (prefix === 'tes') return 'success';
  if (prefix === 'ter') return 'retryable';
  if (prefix === 'tec') return 'failed-onchain';
  if (prefix === 'tef' || prefix === 'tem' || prefix === 'tel') return 'failed-never';
  return 'unknown';
}

/** ¿Es terminal? Sólo lo son las dos formas de fallo — `ter` puede entrar aún. */
export function isTerminalFailure(cls: XrplResultClass): boolean {
  return cls === 'failed-onchain' || cls === 'failed-never';
}

/**
 * El veredicto de una lectura `tx` del ledger, en las cuatro respuestas que un
 * vigilante necesita distinguir. `pending` y `unreadable` se parecen en pantalla
 * y son opuestas por dentro: una es «aún no», la otra «no he podido mirar».
 */
export type XrplTxVerdict =
  | { kind: 'settled' }
  | { kind: 'failed'; code: string; onChain: boolean }
  | { kind: 'pending' }
  | { kind: 'unreadable' };

/** La forma de la respuesta `tx` del rippled que nos importa. */
export interface XrplTxReadLike {
  error?: string;
  validated?: boolean;
  meta?: { TransactionResult?: string } | string;
  metaData?: { TransactionResult?: string };
}

/**
 * Traduce una respuesta `tx` a veredicto.
 *
 * `validated !== true` es SIEMPRE `pending`, incluso con un resultado presente:
 * hasta que el ledger cierra validado, ese resultado es provisional y puede
 * cambiar. Y `txnNotFound` es `pending`, no fallo: probar el «nunca» exige el
 * `LastLedgerSequence` o la secuencia consumida, y ninguno de los dos está aquí.
 */
export function verdictFromTxRead(result: XrplTxReadLike | null | undefined): XrplTxVerdict {
  if (!result) return { kind: 'unreadable' };
  if (result.error) {
    // txnNotFound: todavía no está en el ledger (o este nodo no la tiene).
    return result.error === 'txnNotFound' ? { kind: 'pending' } : { kind: 'unreadable' };
  }
  if (result.validated !== true) return { kind: 'pending' };
  const meta = typeof result.meta === 'object' && result.meta ? result.meta : result.metaData;
  const code = meta?.TransactionResult ?? '';
  const cls = classifyXrplResult(code);
  if (cls === 'success') return { kind: 'settled' };
  // Validada y no-tes: el ledger ya dictó, y sólo un `tec` llega validado.
  if (cls === 'failed-onchain') return { kind: 'failed', code, onChain: true };
  if (cls === 'failed-never') return { kind: 'failed', code, onChain: false };
  // Validada con un código que no sabemos leer: no se inventa un verde.
  return { kind: 'unreadable' };
}
