/**
 * fxrpOrigin — de dónde sale el FXRP, y qué camino impone esa elección.
 *
 * La entrada al mercado FXRP/RLUSD ocurre SIEMPRE en Ethereum, pero el FXRP del
 * usuario puede estar en tres sitios, y cada uno impone un camino distinto. Hoy
 * esa decisión está repartida entre un selector que solo sabe de «rails», un
 * enlace suelto al puente y un aviso del backend; el usuario tiene que
 * ensamblar el plan mentalmente. Este módulo lo hace explícito y testeable.
 *
 * Los tres orígenes, y por qué son tres y no dos:
 *
 *   · `evm-ethereum`  — el FXRP ya está donde se usa. Camino directo.
 *   · `evm-flare`     — misma wallet, otra cadena: hace falta el puente.
 *   · `smart-account` — el FXRP vive en la Personal Account. La PA NO firma en
 *                       EVM: solo ejecuta userOps firmados desde XRPL, así que
 *                       quien firma es la wallet Xaman dueña, y hace falta
 *                       sacarlo a una wallet EVM antes de poder puentear.
 *
 * Sobre la misma dirección en dos cadenas: una wallet EVM enlazada es UNA fila
 * (la conexión fija Flare), pero la misma clave firma en ambas — el cambio de
 * cadena lo hace la propia firma, leyendo la calldata. Por eso los orígenes se
 * DERIVAN aquí en vez de registrarse: una segunda fila no desbloquearía ninguna
 * lectura (lo de Ethereum se lee por dirección) y sí traería duplicados, con dos
 * trampas reales — borrar la fila de Ethereum revoca la firma de la de Flare, y
 * hacerla primaria puede sacar la dirección del escaneo de Flare.
 */

/** La cadena donde el mercado FXRP/RLUSD vive. */
export const ETHEREUM_CHAIN_ID = 1;
/** La cadena donde el FXRP se mintea y donde vive la Personal Account. */
export const FLARE_CHAIN_ID = 14;

export type OriginKind =
  | 'evm-ethereum'
  | 'evm-flare'
  | 'smart-account'
  /**
   * Pagar con XRP fresco: un Payment de Xaman al Core Vault mintea FXRP
   * DIRECTAMENTE en la wallet EVM de destino, en Flare (el memo lleva el
   * destinatario). Es el mismo raíl del movimiento XRPL→EVM que ya está vivo;
   * las comisiones de mint y executor salen del propio pago, así que el FXRP
   * que llega es el NETO.
   */
  | 'xrpl-mint';

export interface FxrpOrigin {
  kind: OriginKind;
  /** Dónde está el FXRP. Para `smart-account`, la dirección de la PA. */
  address: string;
  /** La cadena en la que ese saldo vive. */
  chainId: number;
  /** Quién firma para moverlo. Para `smart-account`, la Xaman dueña. */
  signer: string;
  /** Etiqueta estable para la key/value de un selector: dirección + cadena. */
  id: string;
}

export interface LinkedWallet {
  address: string;
  chainId?: number | null;
  ecosystem?: string | null;
  walletType?: string | null;
}

/** Las dos grafías que los escritores del registro usan para una PA. */
function isSmartAccount(walletType?: string | null): boolean {
  const wt = (walletType ?? '').trim().toLowerCase();
  return wt === 'smart-account' || wt === 'flare smart account';
}

function isEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function originId(address: string, chainId: number): string {
  return `${address.toLowerCase()}:${chainId}`;
}

/**
 * Los orígenes elegibles a partir de las wallets enlazadas.
 *
 * Una wallet EVM produce DOS orígenes (Ethereum y Flare) porque su FXRP puede
 * estar en cualquiera de las dos y solo el usuario sabe en cuál — preguntárselo
 * es más honesto que adivinar, y el saldo real se lee después por dirección.
 *
 * Una PA produce UN origen, con su Xaman dueña como firmante. Sin dueña
 * conocida no se produce nada: un origen que nadie puede firmar es un callejón
 * sin salida presentado como opción.
 */
export function fxrpOrigins(
  wallets: LinkedWallet[],
  ownerOfPa: (paAddress: string) => string | undefined,
): FxrpOrigin[] {
  const origins: FxrpOrigin[] = [];
  for (const w of wallets) {
    if (isSmartAccount(w.walletType)) {
      const signer = ownerOfPa(w.address);
      if (!signer) continue;
      origins.push({
        kind: 'smart-account',
        address: w.address,
        chainId: FLARE_CHAIN_ID,
        signer,
        id: originId(w.address, FLARE_CHAIN_ID),
      });
      continue;
    }
    if (!isEvmAddress(w.address)) continue; // XRPL: su FXRP vive en la PA, no aquí
    for (const chainId of [ETHEREUM_CHAIN_ID, FLARE_CHAIN_ID]) {
      origins.push({
        kind: chainId === ETHEREUM_CHAIN_ID ? 'evm-ethereum' : 'evm-flare',
        address: w.address,
        chainId,
        signer: w.address,
        id: originId(w.address, chainId),
      });
    }
  }
  return origins;
}

/* ── Decidir el camino por el saldo, no preguntándolo ───────────────────── */

export interface FxrpBalances {
  /** Base units, o null = NO SE PUDO LEER (nunca 0, que significa otra cosa). */
  ethereumBase: string | null;
  flareBase: string | null;
}

export type RouteDecision =
  | { kind: 'direct'; reason: 'already-on-ethereum' }
  | { kind: 'bridge'; reason: 'funds-on-flare'; availableBase: string }
  | { kind: 'insufficient'; reason: 'not-enough-anywhere'; totalBase: string }
  | { kind: 'unknown'; reason: 'balance-unreadable' };

/**
 * Qué camino hace falta para entrar con `amountBase`, mirando dónde está el
 * dinero. El usuario elige cuánto; de si eso cruza cadenas o no se encarga esto.
 *
 * `unknown` cuando alguna lectura falló: con un saldo ilegible no se puede
 * afirmar ni que haga falta puente ni que no — y las dos afirmaciones cuestan
 * dinero (puentear de más, o firmar una entrada que revierte). Decir «no lo sé»
 * es la única respuesta honesta y la que deja al usuario reintentar.
 */
export function decideRoute(amountBase: string, balances: FxrpBalances): RouteDecision {
  const amount = safeBig(amountBase);
  if (amount == null) return { kind: 'unknown', reason: 'balance-unreadable' };

  const onEthereum = safeBig(balances.ethereumBase);
  const onFlare = safeBig(balances.flareBase);
  if (onEthereum == null) return { kind: 'unknown', reason: 'balance-unreadable' };

  if (onEthereum >= amount) return { kind: 'direct', reason: 'already-on-ethereum' };

  // Falta en Ethereum: solo Flare puede completar, y solo si se pudo leer.
  if (onFlare == null) return { kind: 'unknown', reason: 'balance-unreadable' };
  if (onEthereum + onFlare >= amount) {
    return { kind: 'bridge', reason: 'funds-on-flare', availableBase: onFlare.toString() };
  }
  return { kind: 'insufficient', reason: 'not-enough-anywhere', totalBase: (onEthereum + onFlare).toString() };
}

function safeBig(v: string | null | undefined): bigint | null {
  if (v == null || !/^\d+$/.test(v)) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/* ── El camino ──────────────────────────────────────────────────────────── */

export type StepKind = 'pa-withdraw' | 'mint-to-evm' | 'bridge' | 'enter-market';
/** Esperas físicas: no son pasos que el usuario haga, son tiempo real. */
export type WaitKind = 'fdc-attestation' | 'layerzero-delivery';

export interface RouteStep {
  kind: StepKind;
  /** Quién firma este paso. */
  signer: string;
  /** El rail de firma: Xaman (XRPL) o una wallet EVM. */
  rail: 'xrpl' | 'evm';
  /** Para pasos EVM, la cadena en la que se firma. */
  chainId?: number;
  /**
   * Transacciones que componen el paso. Se agrupan en UNA confirmación cuando
   * la wallet habla EIP-5792; si no, son esta cantidad de firmas seguidas.
   */
  txCount: number;
  /** La espera que sigue a este paso, si la hay. */
  waitAfter?: WaitKind;
}

export interface BorrowRoute {
  steps: RouteStep[];
  /** Confirmaciones con agrupación disponible — una por paso. */
  signatureCount: number;
  /** Confirmaciones si ninguna wallet agrupa: el peor caso honesto. */
  signatureCountWithoutBatching: number;
  waits: WaitKind[];
  /** Por qué este camino no se puede recorrer, si es el caso. */
  blocker?: 'DESTINATION_NOT_EVM' | 'NO_EVM_WALLET_FOR_PA';
}

/**
 * El plan completo desde un origen hasta la entrada al mercado.
 *
 * `destination` es la wallet EVM que recibe el FXRP en Ethereum, aporta el
 * colateral y cobra el RLUSD. Puede ser la misma del origen o no.
 *
 * Las esperas NO son pasos: son tiempo físico entre firmas (la ronda de
 * atestación de Flare y la entrega de LayerZero). Van en el plan porque una
 * secuencia que las esconde obliga al usuario a adivinar si algo se ha colgado.
 */
export interface BorrowRouteOptions {
  /**
   * El RLUSD prestado entra en la bóveda de Sentora en la MISMA firma de la
   * entrada (dos transacciones más: approve + deposit). Misma cadena y ninguna
   * espera física entre patas, así que no es un paso: es el mismo paso, más
   * largo. Lo que el usuario marcó decide la calldata, no un texto.
   */
  lendBorrowed?: boolean;
}

export function planBorrowRoute(
  origin: FxrpOrigin,
  destination: string,
  opts: BorrowRouteOptions = {},
): BorrowRoute {
  if (!isEvmAddress(destination)) {
    return {
      steps: [], signatureCount: 0, signatureCountWithoutBatching: 0, waits: [],
      blocker: 'DESTINATION_NOT_EVM',
    };
  }

  const steps: RouteStep[] = [];

  if (origin.kind === 'smart-account') {
    // El FXRP sale de la PA a una wallet EVM en Flare. Firma la Xaman dueña, y
    // el dispatch va acoplado a un mint (el peaje del carril 0xFE), de ahí la
    // espera de la ronda FDC antes de poder seguir.
    steps.push({
      kind: 'pa-withdraw', signer: origin.signer, rail: 'xrpl',
      txCount: 1, waitAfter: 'fdc-attestation',
    });
  }

  if (origin.kind === 'xrpl-mint') {
    // XRP fresco → FXRP minteado directo EN la wallet de destino, en Flare.
    // Una firma de Xaman; la atestación FDC decide cuándo aparece el FXRP.
    steps.push({
      kind: 'mint-to-evm', signer: origin.signer, rail: 'xrpl',
      txCount: 1, waitAfter: 'fdc-attestation',
    });
  }

  // El puente solo sobra cuando el FXRP ya está en Ethereum.
  if (origin.kind !== 'evm-ethereum') {
    steps.push({
      kind: 'bridge', signer: destination, rail: 'evm', chainId: FLARE_CHAIN_ID,
      // approve + send: el approve es finito, por el importe exacto.
      txCount: 2, waitAfter: 'layerzero-delivery',
    });
  }

  steps.push({
    kind: 'enter-market', signer: destination, rail: 'evm', chainId: ETHEREUM_CHAIN_ID,
    // approve + supplyCollateral + borrow, compuestos en una sola preparación;
    // con el préstamo yendo a Sentora, + approve RLUSD + deposit — misma firma.
    txCount: opts.lendBorrowed ? 5 : 3,
  });

  return {
    steps,
    signatureCount: steps.length,
    signatureCountWithoutBatching: steps.reduce((n, s) => n + s.txCount, 0),
    waits: steps.map((s) => s.waitAfter).filter((w): w is WaitKind => !!w),
  };
}
