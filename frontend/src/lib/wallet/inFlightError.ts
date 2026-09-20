/**
 * inFlightError — «la mandaste, todavía no sé si entró» NO es un fallo, y
 * «entró a medias» tampoco es «no entró».
 */

import { XRPSCAN_TX } from '../xrpl/councilSigning';

export const RECEIPT_UNREAD = 'RECEIPT_UNREAD';

/**
 * metamask-parcial: unos pasos entraron y otro no. Distinto de RECEIPT_UNREAD
 * (allí NO se leyó nada; aquí se leyó, y la lectura dice «a medias»), idéntico
 * en la única conducta que importa: no se vuelve a ofrecer la firma.
 */
export const PARTIAL_EXECUTION = 'PARTIAL_EXECUTION';

export interface InFlightInfo {
  txHash?: string;
  stepIndex?: number;
  totalSteps?: number;
  /**
   * Qué se sabe. Ausente cuando es el caso histórico (recibo ilegible) o
   * cuando la puerta reconstruye un `{}` vacío porque el error llegó sin datos
   * (los modales del carril Ethereum hacen `inFlightInfo(e) ?? {}`).
   */
  kind?: 'partial';
  /** metamask-parcial: cuántos pasos ANTERIORES ya salieron. */
  completedSteps?: number;
  /**
   * metamask-parcial: `true` cuando de cada paso completado se LEYÓ un recibo
   * con éxito. `false` cuando no había lector de recibos para esa cadena: esos
   * pasos están mandados, no confirmados, y decir «en cadena» sería pintar
   * verde algo que nadie leyó.
   */
  completedConfirmed?: boolean;
}

/**
 * ¿Este error significa «algo salió y ya no puedo retirarlo»?
 *
 * metamask-parcial: cubre las DOS formas. El nombre es histórico y se conserva
 * porque es el que ya consultan `signOutcome` y los tres modales del carril de
 * Ethereum; lo que responde es la pregunta del superconjunto, y una operación
 * ejecutada a medias está tan «en vuelo» como una cuyo recibo no se leyó —
 * ninguna de las dos ha aterrizado, y ninguna de las dos se vuelve a firmar.
 */
export function isInFlight(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === RECEIPT_UNREAD || code === PARTIAL_EXECUTION;
}

/** Sólo la mitad «se mandó y no pude leer el recibo». */
export function isReceiptUnread(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === RECEIPT_UNREAD;
}

/** Sólo la mitad «unos pasos entraron y otro no». */
export function isPartialExecution(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === PARTIAL_EXECUTION;
}

/** Los datos que hacen útil el aviso: qué hash mirar y en qué paso se quedó. */
export function inFlightInfo(e: unknown): InFlightInfo | null {
  if (!isInFlight(e)) return null;
  const x = e as InFlightInfo;
  const base: InFlightInfo = {
    txHash: x.txHash,
    stepIndex: x.stepIndex,
    totalSteps: x.totalSteps,
  };
  if (!isPartialExecution(e)) return base;
  return {
    ...base,
    kind: 'partial',
    completedSteps: x.completedSteps,
    completedConfirmed: x.completedConfirmed,
  };
}

/**
 * Enlace al explorador de la cadena donde se mandó — para poder comprobarlo.
 *
 * `'xrpl'`: un hash de XRPL (lo que devuelve Xaman — un Payment plano
 * o el despacho 0xFE) enlazado a Flarescan es un «no encontrado» justo en la
 * pantalla que dice «comprueba el hash antes de firmar otra vez»: el usuario
 * lee «no existe» y firma de nuevo. Un hash XRPL va a XRPScan, siempre.
 */
export function explorerTxUrl(chainId: number | 'xrpl', hash: string): string {
  if (chainId === 'xrpl') return `${XRPSCAN_TX}${hash}`;
  return chainId === 1
    ? `https://etherscan.io/tx/${hash}`
    : `https://flarescan.com/tx/${hash}`;
}

/**
 * metamask-parcial — el error de «unos pasos ya salieron».
 *
 * El texto es DELIBERADAMENTE neutro y no lleva dentro las palabras de la
 * wallet. Aguas abajo, `signOutcome` clasifica por texto cuando no reconoce el
 * `code`, y su red de seguridad ante un texto que no reconoce es justamente
 * 'unconfirmed' (el final ámbar, sin botón de firmar). Con las palabras de la
 * wallet dentro, ese mismo clasificador leía «rejected» o «insufficient funds»
 * y ofrecía firmar otra vez el array entero. Así que la razón de la wallet
 * viaja en `cause` —que ni `errText` ni `traceText` de `signOutcome` miran— y
 * jamás en `.message`: si alguien pierde el `code` por el camino, el texto solo
 * sigue cayendo del lado seguro. Es cinturón y tirantes, y los dos se prueban.
 */
export function partialExecutionError(step: {
  /** Índice (0-based) del paso que no completó. */
  index: number;
  total: number;
  /** El último hash que conocemos: el del paso que no completó, o el anterior. */
  txHash?: string;
  /** ¿Se leyó un recibo con éxito de cada paso completado? */
  confirmed: boolean;
  /** El error original de la wallet — para la consola, jamás para la pantalla. */
  cause?: unknown;
}): Error & { code: string } {
  const done = step.index;
  const landed = step.confirmed
    ? `${done} earlier step${done > 1 ? 's are' : ' is'} already on the chain`
    : `${done} earlier step${done > 1 ? 's were' : ' was'} already sent to the network`;
  return Object.assign(
    new Error(
      `Step ${step.index + 1} of ${step.total} did not complete. ${landed} — ` +
        `do NOT sign this operation again, it would repeat what already went out.`,
    ),
    {
      code: PARTIAL_EXECUTION,
      txHash: step.txHash,
      stepIndex: step.index,
      totalSteps: step.total,
      completedSteps: done,
      completedConfirmed: step.confirmed,
      cause: step.cause,
    },
  );
}

/**
 * metamask-parcial — la decisión entera del `catch` del carril secuencial, en
 * una función pura que se puede EJECUTAR en un test.
 */
export function sequentialStepError(
  e: unknown,
  step: { index: number; total: number; lastTxHash?: string; receiptsReadable: boolean },
): unknown {
  if (isInFlight(e)) return e;
  if (step.index > 0) {
    return partialExecutionError({
      index: step.index,
      total: step.total,
      txHash: step.lastTxHash && step.lastTxHash !== '0x' ? step.lastTxHash : undefined,
      confirmed: step.receiptsReadable,
      cause: e,
    });
  }
  const msg = e as { shortMessage?: string; message?: string };
  return new Error(
    `Step ${step.index + 1}/${step.total} failed: ${msg.shortMessage ?? msg.message ?? String(e)}`,
  );
}

/**
 * La frase, EN EL IDIOMA DEL USUARIO.
 *
 * El hook que la lanza es la capa de wallet y no tiene `t()`, así que si el
 * texto se redactara allí se quedaría en inglés para siempre — y da la
 * casualidad de que es la frase más importante del producto: la única que evita
 * firmar dos veces lo que ya salió. El hook reporta el hecho; esto lo dice.
 *
 * `t` entra por parámetro para que este módulo siga siendo puro y testeable.
 */
export function inFlightMessage(
  info: InFlightInfo,
  t: (s: string) => string,
): string {
  // El «1/2» va crudo y la frase entera es UNA clave: `t()` en este repo es una
  // búsqueda literal, sin interpolación, así que trocear la frase en palabras
  // sueltas obliga a traducir «Step» por su cuenta — y esa palabra ya existe en
  // el diccionario con otro sentido («Escalón», de la escalera de autonomía).
  const step =
    info.stepIndex !== undefined && info.totalSteps !== undefined
      ? `${info.stepIndex + 1}/${info.totalSteps}`
      : null;
  if (info.kind === 'partial') {
    // metamask-parcial: aquí NO se dice «en vuelo» — de ESTE paso sí se sabe
    // que no completó. Lo que se dice es lo único que evita pagar dos veces:
    // lo anterior ya salió, así que la operación entera no se vuelve a firmar.
    // Y no se ofrece reintentar nada: esta ronda sólo puede RETIRAR ofertas de
    // reintento. Sin plural aparte: «everything before it» vale para uno y para
    // cinco, y `t()` no interpola.
    const landed = info.completedSteps ?? info.stepIndex ?? 0;
    const head =
      step && landed > 0
        ? `${step} · ${t('this step did not complete, and everything before it already went out.')}`
        : t('Part of this operation already went out, and the rest did not complete.');
    const tail =
      info.completedConfirmed === false
        ? t('Do NOT sign it again — signing the same operation would repeat steps that are already out of your hands. Check the explorer and reload your position before doing anything else.')
        : t('Do NOT sign it again — signing the same operation would repeat the steps that already landed. Check the explorer and reload your position before doing anything else.');
    return `${head} ${tail}`;
  }
  const head = step
    ? `${step} · ${t('this step is IN FLIGHT — sent, but not confirmed yet.')}`
    : t('It is IN FLIGHT — sent, but not confirmed yet.');
  // El imperativo va aparte y en mayúsculas a propósito: es la única
  // instrucción que importa cuando esto sale en pantalla.
  //
  // batch-evm: la cola decía «…y reintenta sólo los pasos que
  // falten cuando aterrice». NINGUNA de las once superficies que firman sabe
  // reenviar un subconjunto — todas mandan el array entero, así que era una
  // oferta imposible puesta justo donde el usuario ya sabe que hay dinero
  // fuera. La regla del carril es que un arreglo sólo puede RETIRAR ofertas de
  // reintento; se aplicó a la rama parcial y no a su gemela. Se retira.
  return `${head} ${t('Do NOT sign it again — it may already be on the chain. Check the explorer and reload your position before doing anything else.')}`;
}
