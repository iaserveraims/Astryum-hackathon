/**
 * txResult — qué significa, para el dinero, el código que devuelve XRPL.
 *
 * DOS FALLOS QUE CIERRA.
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
 * veredicto: «no lo he leído» no es «ha fallado» (el bug del recibo,
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
