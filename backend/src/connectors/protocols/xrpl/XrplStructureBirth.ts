/**
 * XrplStructureBirth — el veredicto puro detrás de «sumar las wallets XRPL de
 * una persona bajo una sola cuenta»: qué hace falta para que nazca una cuenta
 * COMANDADA (la familiar, la de la empresa) y todas las negativas que tienen
 * que saltar ANTES de que nadie firme.
 *
 * EL ÁRBOL ES DEL USUARIO, NO DEL EXCHANGE (corrección del fundador, 18-sep).
 * La cuenta PERSONAL es la que manda: lleva las credenciales y se sienta en la
 * lista de firmantes de las demás — sola (quórum 1) o como uno de varios. Las
 * otras son comandadas. En el ledger no cambia nada de lo que ya tenemos: es
 * `SignerListSet` + multifirma, las primitivas que el repo ya usa. Lo único que
 * este módulo añade es decir que NO antes de que una firma cueste dinero.
 *
 * CUATRO HECHOS DEL PROTOCOLO QUE DECIDEN EL DISEÑO (xrpl.org, 18-sep-2026):
 *
 *  1. **Firmar por otra cuenta no consume el `Sequence` de quien firma.** El
 *     `Sequence` que avanza es el de la cuenta COMANDADA, que es el `Account`
 *     de la transacción. Una personal puede mandar en N cuentas sin colisión de
 *     nonce: el problema de «un 0xFE en vuelo por cuenta» (decisión 11-sep) es
 *     de las cuentas que ORIGINAN, no de las que firman por otras.
 *  2. ⚠ **La credencial la tiene que llevar quien ENVÍA, no quien firma.** Para
 *     cruzar una puerta `DepositAuth` + `AuthorizeCredentials`, los
 *     `CredentialIDs` del pago tienen que ser del *sender*: «The sender of this
 *     transaction must be the subject of each of the credentials». En una
 *     multifirma el sender es la COMANDADA. Así que la credencial de la
 *     personal NO le sirve a la comandada — y eso es una excepción real al
 *     principio del 9-sep, que valía porque allí los subordinados nunca
 *     iniciaban. Aquí sí inician. Ver `COMMANDED_PAYS_THROUGH_GATE`.
 *  3. **Cada comandada paga lo suyo**: reserva base (1 XRP) + su `SignerList`
 *     (0,2 XRP, un objeto sea cual sea su tamaño) + la comisión de multifirma,
 *     que escala con el número de firmas. El que se sienta no paga nada.
 *  4. **La puerta (`asfDisableMaster`) solo la firma la master.** Un multifirma
 *     recibe `tecNEED_MASTER_KEY`. Es el último acto de la llave de nacimiento:
 *     después de él NADIE tiene llave de esa cuenta — ni su titular, ni el
 *     operador, ni nosotros. Solo manda quien esté sentado.
 *  5. **Un asiento NO necesita ser una cuenta.** «It does not need to be a
 *     funded address in the ledger»: un firmante puede ser un simple par de
 *     llaves, y entonces **cuesta cero**. Solo pagan reserva las cuentas que
 *     tienen saldo. Contrapartida, y es dura: un firmante sin cuenta solo puede
 *     firmar con su MASTER — no admite regular key, así que **no se puede rotar**
 *     sin reformar la lista de cada cuenta en la que se siente; y no puede
 *     sostener credenciales (aceptar una es una transacción suya).
 *  6. **Fundar una cuenta no da ningún poder sobre ella.** «Funding an account
 *     does not give you any special privileges»: quien tiene la llave la
 *     controla. Así que el omnibus puede CREAR la cuenta (un Payment es lo
 *     único que crea cuentas en XRPL) pero **no puede configurarla**: el
 *     `SignerListSet` lo firma la cuenta nueva. «Creada y seteada por el
 *     omnibus» solo es posible si el omnibus sostiene la llave de nacimiento —
 *     y esa llave puede ser del EXCHANGE, jamás del backend de Astryum.
 *
 * EL TIPO ES SOLO EL CUADRO DE ASIENTOS. Una familiar, una de empresa y una
 * caja del operador corren la misma máquina; lo que cambia es quién se sienta.
 * Regla del kernel (mapa 15-sep): una pieza que tiene que preguntar «qué tipo de
 * cuenta eres» está mal puesta. Por eso los asientos son ENTRADA y este módulo
 * los juzga — jamás ramifica por el tipo para hacer un trabajo distinto.
 *
 * Puro: sin red, sin reloj, sin llaves. Toda cifra sale de las reservas que el
 * llamante leyó del ledger.
 */
import { quorumMargin } from './XrplLegacyRehearsal';

/**
 * Qué puede ser una cuenta colgada de una personal. Solo tres son CUENTAS: una
 * `box` es un destination tag sobre el omnibus, y planificar su nacimiento es
 * una negativa — una cuenta por cliente cuesta reserva, ceremonia y un quórum
 * que nadie convocará.
 */
export type StructureKind = 'box' | 'family' | 'enterprise' | 'agent';

/**
 * Cómo se gobierna la comandada:
 *  · 'sole'   — la personal manda sola (sus asientos alcanzan el quórum). Es la
 *    «subwallet» en el sentido llano: una cuenta más de la misma persona.
 *  · 'shared' — hace falta un quórum en el que la personal es UNO de varios (el
 *    consejo de la familia, el órgano de la sociedad).
 */
export type StructureGovernance = 'sole' | 'shared';

/**
 * De quién es cada asiento. Toda la cuestión de «¿quién puede mover esto?» vive
 * en este campo:
 *  · 'root'     — la cuenta personal del titular, la que manda.
 *  · 'member'   — otra persona de su círculo (familiar, co-administrador).
 *  · 'operator' — el exchange o cualquier tercero. Por defecto NO puede alcanzar
 *    el quórum: si lo alcanza, mueve el dinero del usuario sin el usuario.
 */
export type SeatHolder = 'root' | 'member' | 'operator';

export interface StructureSeat {
  account: string;
  /** SignerWeight — entero positivo (XRPL lo limita a 65535). */
  weight: number;
  holder: SeatHolder;
}

/** Reservas tal como las da el ledger (server_info), jamás cableadas. */
export interface ReserveFigures {
  /** Reserva base por cuenta — 1 XRP en mainnet (xrpl.org, verificado 18-sep-2026). */
  baseXrp: number;
  /**
   * Reserva por objeto — 0,2 XRP en mainnet. Un `SignerList` cuenta como UN
   * objeto sea cual sea su tamaño (MultiSignReserve, activa desde 2019-04-17).
   */
  incrementXrp: number;
}

export interface StructureBirthInput {
  kind: StructureKind;
  governance: StructureGovernance;
  /** La cuenta PERSONAL del titular: la que manda y la que lleva las credenciales. */
  rootAddress: string;
  /** La cuenta de caja que patrocina la reserva (el omnibus del exchange, o la propia personal). */
  funderAddress: string;
  /** La cuenta que nace. Se crea en la app de wallet de su titular — jamás aquí. */
  structureAddress: string;
  seats: StructureSeat[];
  /** SignerQuorum: el peso que tiene que firmar para que la comandada actúe. */
  quorum: number;
  reserve: ReserveFigures;
  /**
   * ¿Emitirá la personal una credencial de DESIGNACIÓN sobre esta comandada (la
   * clase del 12-sep: raíz→subordinada, la firma de la raíz hecha objeto)? Le
   * cuesta a la comandada una reserva de objeto una vez aceptada.
   */
  designation: boolean;
  /**
   * ¿Va a PAGAR esta comandada, por sí misma, a un destino con puerta de
   * credencial (el ancla de órdenes, un omnibus con `DepositAuth`)? Si sí,
   * necesita credenciales PROPIAS: en una multifirma el sender es ella, y el
   * ledger exige que el sender sea el sujeto de cada credencial.
   */
  paysThroughCredentialGate: boolean;
  /** ¿Se le van a emitir credenciales propias (KYC/KYB de un emisor externo)? */
  carriesOwnCredentials: boolean;
  /**
   * ¿Existe ya en el ledger la cuenta personal? Un firmante puede no ser una
   * cuenta (hecho 5), pero para EMITIR la designación tiene que existir: un
   * `CredentialCreate` es una transacción suya y necesita su `Sequence`.
   * `undefined` = no se pudo leer, y entonces no se afirma nada.
   */
  rootFunded?: boolean;
  /**
   * Por asiento: ¿es una cuenta del ledger o solo un par de llaves? Lo que no
   * esté aquí es «no se pudo leer», jamás «no existe».
   */
  seatsFunded?: Record<string, boolean>;
  /**
   * Declarado a propósito: un tercero (el operador) PUEDE alcanzar el quórum.
   * Es custodia, y hay que decirlo en voz alta. Solo tiene sentido para la caja
   * propia del operador, jamás para el patrimonio de un usuario.
   */
  operatorMayBind?: boolean;
  /**
   * ¿Se va a armar la puerta del ancla (`DepositAuth` + `AuthorizeCredentials`)
   * sobre esta cuenta? Aprendido en el runbook del ancla (17-sep): armarla sobre
   * una cuenta que cobra de un tercero mata ese cobro.
   */
  armAnchorGate: boolean;
  /**
   * ¿Le paga algo de FUERA del árbol — un agente de FAssets devolviendo una
   * redención, una contraparte liquidando? Entonces la puerta no se le arma.
   */
  receivesThirdPartyReturns: boolean;
}

export type BirthRefusalCode =
  | 'BOX_IS_NOT_AN_ACCOUNT'
  | 'NO_SEATS'
  | 'TOO_MANY_SEATS'
  | 'BAD_SEAT'
  | 'DUPLICATE_SEAT'
  | 'BAD_QUORUM'
  | 'QUORUM_UNREACHABLE'
  | 'ROOT_HAS_NO_SEAT'
  | 'ROOT_CANNOT_BIND_ALONE'
  | 'ROOT_BINDS_ALONE'
  | 'OPERATOR_REACHES_QUORUM'
  | 'COMMANDED_PAYS_THROUGH_GATE'
  | 'ROOT_NOT_ON_LEDGER'
  | 'COMPLIANCE_ON_CAPTIVE'
  | 'GATE_WOULD_BLOCK_RETURNS'
  | 'SEAT_IS_THE_STRUCTURE';

export interface BirthRefusal {
  code: BirthRefusalCode;
  /** En castellano llano, como lo dice la pantalla. */
  reason: string;
}

/**
 * Lo que es VERDAD y cuesta saberlo tarde, pero no impide firmar. Una negativa
 * para y un aviso acompaña: mezclarlos hace que se ignoren los dos.
 */
export type BirthNoteCode =
  | 'UNFUNDED_SEATS'
  | 'FUNDING_GIVES_NO_POWER'
  | 'BIRTH_KEY_WINDOW'
  | 'SOLE_SEAT_NO_DOOR';

export interface BirthNote {
  code: BirthNoteCode;
  text: string;
}

export type BirthStepId = 'fund' | 'constitute' | 'rehearse' | 'designate' | 'close-door';

export interface BirthStep {
  id: BirthStepId;
  /**
   * QUIÉN FIRMA, en las palabras de la pantalla. `structure-master` es la llave
   * de nacimiento: firma la constitución y luego su propia desactivación, y
   * después no vale nada. `structure-quorum` son los asientos multifirmando.
   */
  signer: 'funder' | 'structure-master' | 'structure-quorum' | 'root';
  tx: 'Payment' | 'SignerListSet' | 'EscrowCreate' | 'CredentialCreate' | 'CredentialAccept' | 'AccountSet';
  note: string;
  /** Pasos cuyo resultado tiene que estar VALIDADO en el ledger antes de ofrecer este. */
  after: BirthStepId[];
  /**
   * Cierto cuando saltarse la comprobación de `after` puede dejar la cuenta
   * muerta para siempre. Solo la puerta es así: ida la master, un quórum que no
   * se puede reunir es definitivo.
   */
  irreversible?: boolean;
}

export interface BirthReservePlan {
  baseXrp: number;
  incrementXrp: number;
  /** Objetos que la comandada sostiene al final: `SignerList` (+ designación). */
  standingObjects: number;
  /** Objetos que solo existen mientras corre la ceremonia: el escrow del ensayo. */
  transientObjects: number;
  /** El XRP simbólico que el escrow del ensayo inmoviliza hasta terminarlo. */
  rehearsalLockXrp: number;
  /** Holgura para las comisiones; el multifirma paga por firmante. */
  feeHeadroomXrp: number;
  /** Lo que la caja tiene que mandar ANTES de empezar. */
  fundingXrp: number;
  /** Lo que devuelve un `AccountDelete` del quórum si algún día se deshace. */
  recoverableXrp: number;
  /** Lo que deshacerla destruye para siempre (el coste especial del AccountDelete). */
  unrecoverableXrp: number;
}

export interface StructureAuthority {
  totalWeight: number;
  /** Peso que suman los asientos de la cuenta personal. */
  rootWeight: number;
  /** Peso de los demás miembros del círculo del titular. */
  memberWeight: number;
  /** Peso de terceros (operador). */
  operatorWeight: number;
  /** ¿Puede la personal obligar a esta cuenta sin nadie más? */
  rootAloneBinds: boolean;
  /** ¿Puede un tercero obligarla sin el titular? La línea de la custodia. */
  operatorAloneBinds: boolean;
  /** ¿Pueden los miembros obligarla sin la personal? (herencia, continuidad.) */
  membersBindWithoutRoot: boolean;
  /**
   * Pérdidas de asiento que el quórum sobrevive, peor caso (se pierde primero el
   * más pesado). 0 = perder uno congela el gobierno para siempre — y con la
   * master desactivada, «para siempre» es literal.
   */
  quorumMargin: number;
  /** La puerta solo se ofrece por encima de cero. */
  canCloseDoor: boolean;
}

export interface StructureBirthPlan {
  ok: boolean;
  refusals: BirthRefusal[];
  /** Verdades que hay que saber antes de firmar, aunque no paren nada. */
  notes: BirthNote[];
  /** Vacío cuando hay negativa: no se ofrece firmar nada mientras una esté en pie. */
  steps: BirthStep[];
  reserve: BirthReservePlan | null;
  authority: StructureAuthority;
}

const MAX_SEATS = 32; // límite del protocolo para un SignerList
const MAX_WEIGHT = 65535; // SignerWeight es UInt16
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** `AccountDelete` destruye al menos una reserva de objeto (xrpl.org, 18-sep-2026). */
export const ACCOUNT_DELETE_BURN_OBJECTS = 1;

/**
 * Reservas de objeto presupuestadas de más — la misma razón por la que
 * `ceremonyReserve.ts` lleva margen: el camino observado ha añadido
 * históricamente objetos que nosotros no componemos (el xApp de Multisign de
 * Xaman crea Tickets), y un preflight que se queda corto ES el bug que existe
 * para evitar.
 */
export const BIRTH_MARGIN_OBJECTS = 2;

/** El importe simbólico del escrow del ensayo, inmovilizado hasta terminarlo. */
export const REHEARSAL_LOCK_XRP = 1;

function seatWeight(seat: StructureSeat): number {
  const w = Number(seat?.weight);
  return Number.isFinite(w) && w > 0 ? Math.floor(w) : 0;
}

function weightOf(seats: StructureSeat[], holder: SeatHolder): number {
  return seats.filter((s) => s?.holder === holder).reduce((a, s) => a + seatWeight(s), 0);
}

/** Juzga el cuadro de asientos. Puro; aquí vive toda la cuestión de quién manda. */
export function assessStructureAuthority(seats: StructureSeat[], quorum: number): StructureAuthority {
  const list = Array.isArray(seats) ? seats : [];
  const weights = list.map(seatWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const rootWeight = weightOf(list, 'root');
  const memberWeight = weightOf(list, 'member');
  const operatorWeight = weightOf(list, 'operator');
  const q = Number.isInteger(quorum) && quorum > 0 ? quorum : 0;
  const margin = q > 0 ? quorumMargin(q, weights) : 0;
  return {
    totalWeight,
    rootWeight,
    memberWeight,
    operatorWeight,
    rootAloneBinds: q > 0 && rootWeight >= q,
    operatorAloneBinds: q > 0 && operatorWeight >= q,
    membersBindWithoutRoot: q > 0 && memberWeight + operatorWeight >= q,
    quorumMargin: margin,
    canCloseDoor: q > 0 && totalWeight >= q && margin > 0,
  };
}

/** La reserva que inmoviliza la ceremonia, y lo que devuelve deshacerla. */
export function planBirthReserve(input: {
  reserve: ReserveFigures;
  seatCount: number;
  designation: boolean;
}): BirthReservePlan {
  const baseXrp = Number(input.reserve?.baseXrp);
  const incrementXrp = Number(input.reserve?.incrementXrp);
  if (!Number.isFinite(baseXrp) || baseXrp <= 0 || !Number.isFinite(incrementXrp) || incrementXrp <= 0) {
    throw new Error('planBirthReserve needs the ledger reserve figures (baseXrp, incrementXrp) read fresh');
  }
  const standingObjects = 1 + (input.designation ? 1 : 0); // SignerList (+ credencial de designación)
  const transientObjects = 1; // el escrow del ensayo
  // La comisión de multifirma escala con los firmantes (base × (1 + firmas));
  // la ceremonia firma un puñado de transacciones, así que una asignación plana
  // por asiento con suelo es honesta y nunca optimista.
  const feeHeadroomXrp = Math.max(0.05, 0.04 * (input.seatCount + 1));
  const objectsBudgeted = standingObjects + transientObjects + BIRTH_MARGIN_OBJECTS;
  const fundingXrp = baseXrp + objectsBudgeted * incrementXrp + REHEARSAL_LOCK_XRP + feeHeadroomXrp;
  const unrecoverableXrp = ACCOUNT_DELETE_BURN_OBJECTS * incrementXrp;
  return {
    baseXrp,
    incrementXrp,
    standingObjects,
    transientObjects,
    rehearsalLockXrp: REHEARSAL_LOCK_XRP,
    feeHeadroomXrp: round6(feeHeadroomXrp),
    fundingXrp: round6(fundingXrp),
    recoverableXrp: round6(Math.max(0, fundingXrp - unrecoverableXrp - feeHeadroomXrp)),
    unrecoverableXrp: round6(unrecoverableXrp),
  };
}

/**
 * El plan, o las negativas. No se ofrece firmar nada mientras una esté en pie:
 * una ceremonia que empieza y no puede acabar deja una cuenta fondeada que nadie
 * puede mover.
 */
export function planStructureBirth(input: StructureBirthInput): StructureBirthPlan {
  const refusals: BirthRefusal[] = [];
  const notes: BirthNote[] = [];
  const seats = Array.isArray(input.seats) ? input.seats : [];
  const authority = assessStructureAuthority(seats, input.quorum);

  if (input.kind === 'box') {
    refusals.push({
      code: 'BOX_IS_NOT_AN_ACCOUNT',
      reason:
        'Una casilla es un destination tag sobre el omnibus, no una cuenta. Una cuenta por cliente cuesta reserva, ceremonia y un quórum que nadie convocará: las cuentas son para lo que es un vehículo, no para lo que es un apunte.',
    });
  }

  if (seats.length < 1) {
    refusals.push({ code: 'NO_SEATS', reason: 'Una cuenta comandada necesita al menos un asiento en su lista de firmantes.' });
  }
  if (seats.length > MAX_SEATS) {
    refusals.push({
      code: 'TOO_MANY_SEATS',
      reason: `Una lista de firmantes admite como mucho ${MAX_SEATS} asientos (hay ${seats.length}).`,
    });
  }

  const seen = new Set<string>();
  for (const s of seats) {
    const account = String(s?.account ?? '');
    if (!XRPL_ADDRESS_RE.test(account)) {
      refusals.push({ code: 'BAD_SEAT', reason: `No es una dirección XRPL válida para un asiento: ${account || '(vacío)'}` });
      continue;
    }
    const w = Number(s.weight);
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEIGHT) {
      refusals.push({
        code: 'BAD_SEAT',
        reason: `El peso de un asiento es un entero de 1 a ${MAX_WEIGHT} (llegó ${String(s.weight)}).`,
      });
    }
    if (s.holder !== 'root' && s.holder !== 'member' && s.holder !== 'operator') {
      refusals.push({ code: 'BAD_SEAT', reason: `Cada asiento dice de quién es — la personal, un miembro o un tercero (llegó ${String(s.holder)}).` });
    }
    if (account === input.structureAddress) {
      refusals.push({
        code: 'SEAT_IS_THE_STRUCTURE',
        reason:
          'Una cuenta no puede sentarse en su propia lista de firmantes: cerrada la puerta, ese asiento es justo la llave que ya no tiene nadie.',
      });
    }
    if (seen.has(account)) {
      refusals.push({ code: 'DUPLICATE_SEAT', reason: `La misma dirección se sienta dos veces: ${account}` });
    }
    seen.add(account);
  }

  if (!Number.isInteger(input.quorum) || input.quorum < 1) {
    refusals.push({ code: 'BAD_QUORUM', reason: 'El quórum es un número entero positivo de peso.' });
  } else if (authority.totalWeight < input.quorum) {
    refusals.push({
      code: 'QUORUM_UNREACHABLE',
      reason: `Los asientos suman ${authority.totalWeight} y el quórum pide ${input.quorum}: esta cuenta no podría actuar nunca.`,
    });
  }

  // La personal tiene que MANDAR: si no se sienta, no comanda nada.
  if (!seats.some((s) => s?.holder === 'root')) {
    refusals.push({
      code: 'ROOT_HAS_NO_SEAT',
      reason: 'La cuenta personal no se sienta aquí, así que no manda en esta cuenta. Una comandada sin su titular dentro es de otro.',
    });
  } else if (!seats.some((s) => s.account === input.rootAddress && s.holder === 'root')) {
    refusals.push({
      code: 'ROOT_HAS_NO_SEAT',
      reason: `El asiento marcado como personal no es ${input.rootAddress}, que es la cuenta que se declaró como raíz de este árbol.`,
    });
  }

  // Gobierno declarado contra gobierno real: el organigrama no puede mentir.
  if (input.governance === 'sole' && !authority.rootAloneBinds) {
    refusals.push({
      code: 'ROOT_CANNOT_BIND_ALONE',
      reason: `Se declaró que la personal manda sola, pero sus asientos suman ${authority.rootWeight} y el quórum pide ${input.quorum}. O le subes el peso, o esto es un gobierno compartido y hay que decirlo.`,
    });
  }
  if (input.governance === 'shared' && authority.rootAloneBinds) {
    refusals.push({
      code: 'ROOT_BINDS_ALONE',
      reason: 'Se declaró un gobierno compartido, pero la personal alcanza el quórum ella sola: los demás asientos no pintan nada. O bajas su peso, o es gobierno en solitario.',
    });
  }

  // La línea de la custodia, como aritmética sobre los asientos.
  if (authority.operatorAloneBinds && input.operatorMayBind !== true) {
    refusals.push({
      code: 'OPERATOR_REACHES_QUORUM',
      reason:
        'Los asientos de un tercero alcanzan el quórum por sí solos: ese tercero puede mover este dinero sin su titular. Eso es custodia, diga lo que diga el papel. Bájale el peso, o declara a propósito que esta cuenta es del operador.',
    });
  }

  // El hallazgo del 18-sep: en una multifirma el SENDER es la comandada, y el
  // ledger exige que el sender sea el sujeto de cada credencial que presente.
  if (input.paysThroughCredentialGate && !input.carriesOwnCredentials) {
    refusals.push({
      code: 'COMMANDED_PAYS_THROUGH_GATE',
      reason:
        'Esta cuenta va a pagar por sí misma a un destino con puerta de credencial, y no lleva credenciales propias. El ledger exige que el que envía sea el sujeto de cada credencial, así que su pago moriría con tecNO_PERMISSION: firmarlo desde la personal no lo arregla, porque el que envía sigue siendo ella. O le emites credenciales propias, o paga la personal, o el destino no lleva puerta.',
    });
  }

  // Hecho 6: crear no es mandar. Quien paga el nacimiento no gana nada sobre la
  // cuenta; lo que manda es la llave, y luego los asientos.
  if (input.funderAddress && !seats.some((x) => x?.account === input.funderAddress)) {
    notes.push({
      code: 'FUNDING_GIVES_NO_POWER',
      text: `Quien paga el nacimiento (${input.funderAddress}) no gana ningún poder sobre esta cuenta: en XRPL fundar no da privilegios. Queda como genealogía pública —el pago que la creó— y nada más.`,
    });
  }

  // Hecho 6, la otra cara: entre fundar y cerrar la puerta, la llave de
  // nacimiento lo puede todo. Quien la sostenga, sostiene el dinero ese rato.
  notes.push({
    code: 'BIRTH_KEY_WINDOW',
    text:
      'Desde que se funda hasta que se cierra la puerta, quien tenga la llave de nacimiento controla esta cuenta entera. Por eso la crea su titular en su propia wallet: si la generase el sistema, ese rato sería custodia. Cerrada la puerta, esa llave no vale nada.',
  });

  // Hecho 5: un asiento no necesita ser una cuenta — y eso tiene precio.
  if (input.seatsFunded) {
    const bare = seats
      .filter((x) => XRPL_ADDRESS_RE.test(String(x?.account ?? '')) && input.seatsFunded![x.account] === false)
      .map((x) => x.account);
    if (bare.length > 0) {
      notes.push({
        code: 'UNFUNDED_SEATS',
        text: `${bare.length === 1 ? 'Un asiento no es' : `${bare.length} asientos no son`} una cuenta del ledger (${bare.join(', ')}): son pares de llaves y no cuestan reserva. A cambio solo pueden firmar con su llave maestra, así que no se pueden rotar sin reformar la lista de firmantes de cada cuenta donde se sienten, y no pueden sostener credenciales.`,
      });
    }
  }

  // El aviso que el propio caso simple del fundador se gana.
  if (authority.quorumMargin === 0 && authority.totalWeight >= input.quorum && input.quorum > 0) {
    notes.push({
      code: 'SOLE_SEAT_NO_DOOR',
      text:
        'Este quórum no tiene margen, así que esta cuenta se puede constituir pero su puerta no se podrá cerrar: perder una sola llave la dejaría muerta con su dinero dentro. Siéntate un respaldo, o quédate con la llave maestra viva a propósito.',
    });
  }

  // Hecho 5 + 6: para EMITIR la designación, la personal tiene que existir.
  if (input.designation && input.rootFunded === false) {
    refusals.push({
      code: 'ROOT_NOT_ON_LEDGER',
      reason: `La cuenta personal ${input.rootAddress} todavía no existe en el ledger, y una designación es una transacción suya: necesita su propia cuenta (y su reserva). Puede sentarse como firmante sin existir, pero no puede emitir.`,
    });
  }

  // Principio 9-sep: la credencial vive en la raíz del árbol de autoridad.
  if (input.carriesOwnCredentials && (input.kind === 'agent' || input.kind === 'box')) {
    refusals.push({
      code: 'COMPLIANCE_ON_CAPTIVE',
      reason:
        'Una casilla y un agente no son vehículos legales: su condición la heredan de la raíz que los designó. Una credencial propia les añade un ciclo de renovación, una arista pública de privacidad y una redundancia que habrá que deshacer.',
    });
  }

  // Aprendido en el runbook del ancla: la puerta mata la vuelta de un tercero.
  if (input.armAnchorGate && input.receivesThirdPartyReturns) {
    refusals.push({
      code: 'GATE_WOULD_BLOCK_RETURNS',
      reason:
        'A esta cuenta le paga alguien de fuera del árbol (un agente de FAssets devolviendo una redención). Armarle la puerta de credencial hace que ese pago falle con tecNO_PERMISSION: el titular vería rebotar su propio dinero.',
    });
  }

  if (refusals.length > 0) {
    return { ok: false, refusals, notes, steps: [], reserve: null, authority };
  }

  const reserve = planBirthReserve({
    reserve: input.reserve,
    seatCount: seats.length,
    designation: input.designation,
  });

  const steps: BirthStep[] = [
    {
      id: 'fund',
      signer: 'funder',
      tx: 'Payment',
      note: `Se patrocina la reserva de la cuenta nueva: ${reserve.fundingXrp} XRP a ${input.structureAddress}. Patrocinado y cobrado después — jamás un saldo prepagado.`,
      after: [],
    },
    {
      id: 'constitute',
      signer: 'structure-master',
      tx: 'SignerListSet',
      note: `La llave de nacimiento sienta ${seats.length} firmante(s) con un quórum de ${input.quorum}. A partir de aquí manda quien está sentado — incluso para deshacer la cuenta y devolver la reserva.`,
      after: ['fund'],
    },
    {
      id: 'rehearse',
      signer: 'structure-quorum',
      tx: 'EscrowCreate',
      note: 'Cada asiento firma una vez, en cadena, antes de cerrar la puerta. Es la única prueba de que el quórum se puede reunir de verdad.',
      after: ['constitute'],
    },
  ];

  if (input.designation) {
    steps.push({
      id: 'designate',
      signer: 'root',
      tx: 'CredentialCreate',
      note:
        'La cuenta personal nombra suya a esta cuenta en el ledger — su firma hecha objeto, con caducidad corta para que haya que renovarla. La comandada la acepta con su quórum.',
      after: ['constitute'],
    });
  }

  steps.push({
    id: 'close-door',
    signer: 'structure-master',
    tx: 'AccountSet',
    note:
      'La llave de nacimiento se desactiva a sí misma (asfDisableMaster — el único acto que un quórum no puede hacer). Validado esto, ninguna llave controla esta cuenta: ni la de su titular, ni la del operador, ni la nuestra. Solo manda quien está sentado.',
    after: input.designation ? ['rehearse', 'designate'] : ['rehearse'],
    irreversible: true,
  });

  return { ok: true, refusals: [], notes, steps, reserve, authority };
}

/**
 * El candado de la puerta como veredicto propio, para que una pantalla apague el
 * botón con su razón en vez de descubrir `tecNEED_MASTER_KEY` o una cuenta
 * congelada.
 */
export function canCloseStructureDoor(input: {
  authority: StructureAuthority;
  /** ¿Pasó el ensayo en cadena (XrplLegacyRehearsal.rehearsalComplete)? */
  rehearsalComplete: boolean;
  /** ¿Está la lista de firmantes de verdad en el ledger? */
  hasSignerList: boolean;
}): { allowed: boolean; reason?: string } {
  if (!input.hasSignerList) {
    return {
      allowed: false,
      reason: 'La lista de firmantes todavía no está en el ledger: desactivar la llave ahora dejaría la cuenta muerta.',
    };
  }
  if (input.authority.quorumMargin <= 0) {
    return {
      allowed: false,
      reason:
        'El quórum no tiene margen: perder un asiento congelaría esta cuenta para siempre, y desactivar la master hace que «para siempre» sea literal. Añade un asiento o baja el quórum antes.',
    };
  }
  if (!input.rehearsalComplete) {
    return {
      allowed: false,
      reason: 'Antes tiene que firmar cada asiento una vez en cadena. Hasta entonces nadie ha probado que el quórum se pueda reunir.',
    };
  }
  return { allowed: true };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
