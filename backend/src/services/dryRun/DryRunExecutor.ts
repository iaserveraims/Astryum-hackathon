/**
 * DryRunExecutor — el ensayo en seco del producto de gestores, entero.
 *
 * Un fork de Flare mainnet en anvil (contratos REALES: FXRP, Kinetic, el
 * MasterAccountController, y la jaula v2 desplegada por el script del ensayo) y
 * un ejecutor que sustituye las FIRMAS: donde en vivo firma Xaman (XRPL → FDC →
 * bridge) o MetaMask, aquí se ejecuta LA MISMA calldata impersonando al
 * firmante con `anvil_impersonateAccount`. Lo que se ensaya es byte a byte lo
 * que se firmaría; lo único que se salta es la firma y la prueba FDC.
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

export class DryRunError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function dryRunEnabled(): boolean {
  return process.env.DRY_RUN_MODE === 'true';
}

export function dryRunRpcUrl(): string {
  return (process.env.DRY_RUN_RPC_URL ?? 'http://127.0.0.1:8545').trim();
}

/**
 * true ⇔ el rig del ensayo está ACTIVO Y APUNTA A LOCAL: el flag puesto y
 * además `FLARE_RPC_URL` (lo que leen y escriben los raíles) es localhost.
 * Es la condición para relajar protecciones pensadas para cadenas reales
 * (p. ej. el cap de la demo): el flag solo, jamás — si alguien lo pusiera en
 * prod con RPC real, nada se relaja.
 */
export function dryRunLocalRig(): boolean {
  if (!dryRunEnabled()) return false;
  try {
    const host = new URL((process.env.FLARE_RPC_URL ?? '').trim()).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** El ensayo HOSPEDADO (anvil en Railway, para probar desde el preview de
 *  Vercel): explícito por env Y con prueba de anvil — nunca solo el flag. */
function hostedForkAllowed(): boolean {
  return process.env.DRY_RUN_ALLOW_HOSTED_FORK === 'true';
}

const anvilProven = new Map<string, boolean>();

/**
 * La prueba que sustituye a «localhost» cuando el fork vive en Railway:
 * `anvil_nodeInfo` SOLO responde en anvil — un RPC real (Flare, un gateway,
 * lo que sea) lo rechaza. Fail-closed por otra vía: sin prueba, no se
 * impersona. Se cachea por URL: un anvil no deja de serlo en caliente.
 */
export async function verifyAnvilRpc(url: string): Promise<void> {
  if (anvilProven.get(url)) return;
  try {
    const p = new ethers.JsonRpcProvider(url);
    const info = (await p.send('anvil_nodeInfo', [])) as Record<string, unknown> | null;
    if (!info || typeof info !== 'object') throw new Error('sin nodeInfo');
    anvilProven.set(url, true);
  } catch (e) {
    throw new DryRunError('NOT_ANVIL', `el RPC del ensayo no demuestra ser anvil (${(e as Error).message}) — impersonar ahí está prohibido`);
  }
}

/**
 * ¿Está activo el rig del ensayo? La versión completa de `dryRunLocalRig` para
 * las guardas que relajan cosas (p. ej. el cap de la demo): flag + RPC local,
 * o flag + fork hospedado permitido Y DEMOSTRADO anvil. Un RPC real jamás pasa.
 */
export async function dryRunRigActive(): Promise<boolean> {
  if (dryRunLocalRig()) return true;
  if (!dryRunEnabled() || !hostedForkAllowed()) return false;
  try {
    await verifyAnvilRpc((process.env.FLARE_RPC_URL ?? '').trim());
    return true;
  } catch {
    return false;
  }
}

/** La guarda que no se negocia: el ensayo solo habla con un RPC LOCAL. */
export function assertLocalRpc(url: string): void {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new DryRunError('BAD_RPC', `DRY_RUN_RPC_URL no es una URL: ${url}`);
  }
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!local) {
    throw new DryRunError('NOT_LOCAL', `El ensayo solo ejecuta contra un RPC local (anvil). Recibido: ${host}`);
  }
}

/** Pura: `orderData` = abi.encode(uint64 nonce, bytes cageCalldata) — lo que firma el consejo. */
export function decodeOrderData(orderData: string): { nonce: bigint; calldata: string } {
  if (!/^0x[0-9a-fA-F]*$/.test(orderData ?? '')) throw new DryRunError('BAD_ORDER', 'orderData debe ser hex 0x…');
  try {
    const [nonce, calldata] = ethers.AbiCoder.defaultAbiCoder().decode(['uint64', 'bytes'], orderData);
    return { nonce: BigInt(nonce), calldata: String(calldata) };
  } catch {
    throw new DryRunError('BAD_ORDER', 'orderData no decodifica como (uint64, bytes)');
  }
}

// ── El reparto de papeles (las cuentas de desarrollo de anvil, públicas) ─────
//
// Derivadas del mnemónico de prueba estándar de anvil/hardhat. NO son secretos:
// son las cuentas de juguete que todo el mundo conoce — por eso mismo el módulo
// entero está tras las guardas de arriba.

export interface DryRunActor {
  role: 'deployer-governor' | 'treasury' | 'manager-director' | 'partner-kyc' | 'cliente-1' | 'cliente-2';
  address: string;
  note: string;
}

export const DRY_RUN_ACTORS: DryRunActor[] = [
  { role: 'deployer-governor', address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', note: 'Despliega el stack y gobierna el registro (alta de venues).' },
  { role: 'treasury', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', note: 'La tesorería del ensayo: cobra la fee del 4.º pote.' },
  { role: 'manager-director', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', note: 'La llave EVM que el gestor nombra director (dirige/recupera sin FDC).' },
  { role: 'partner-kyc', address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', note: 'El partner de KYC: admin de su ExchangeKycRegistry, aprueba clientes.' },
  { role: 'cliente-1', address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', note: 'Cliente aprobado: deposita, prueba el tope, sale.' },
  { role: 'cliente-2', address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', note: 'Cliente SIN aprobar: el gate lo rechaza antes de ejecutar.' },
];

/** El whale de FXRP del fork: el mercado kFXRP-ISO de Kinetic (mainnet real). */
export function fxrpWhale(): string {
  return (process.env.DRY_RUN_FXRP_WHALE ?? '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3').trim();
}

// ── El ejecutor ──────────────────────────────────────────────────────────────

const ERC20_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

export interface DryCall {
  to: string;
  data: string;
  value?: string;
}

export class DryRunExecutor {
  readonly provider: ethers.JsonRpcProvider;
  /** true = fork hospedado: la prueba de anvil se exige antes de actuar. */
  private mustProveAnvil = false;
  private readonly rpcUrl: string;

  constructor(rpcUrl: string = dryRunRpcUrl()) {
    if (!dryRunEnabled()) throw new DryRunError('DISABLED', 'DRY_RUN_MODE no está activo.');
    this.rpcUrl = rpcUrl;
    try {
      assertLocalRpc(rpcUrl);
    } catch (e) {
      // No-local: SOLO como fork hospedado explícito (DRY_RUN_ALLOW_HOSTED_FORK)
      // y con la prueba de anvil pendiente — cada método la exige al entrar.
      if (!hostedForkAllowed()) throw e;
      this.mustProveAnvil = true;
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /** La guarda perezosa del fork hospedado: anvil demostrado, o nada. */
  private async ready(): Promise<void> {
    if (this.mustProveAnvil) await verifyAnvilRpc(this.rpcUrl);
  }

  /** Gas para el impersonado: en el fork los FLR se imprimen. */
  private async ensureGas(address: string): Promise<void> {
    await this.provider.send('anvil_setBalance', [address, '0x21e19e0c9bab2400000']); // 10.000 FLR
  }

  /**
   * Ejecuta `calls` como si las firmara `from`. Antes de enviar, SIMULA cada
   * call (`eth_call` con from) para que un revert vuelva con su motivo íntegro
   * en vez de un recibo mudo — la lección de siempre: no ejecutar lo condenado.
   */
  async executeCalls(from: string, calls: DryCall[]): Promise<{ txHashes: string[] }> {
    await this.ready();
    const sender = ethers.getAddress(from);
    await this.provider.send('anvil_impersonateAccount', [sender]);
    await this.ensureGas(sender);
    const txHashes: string[] = [];
    try {
      for (const c of calls) {
        const tx: Record<string, unknown> = { from: sender, to: ethers.getAddress(c.to), data: c.data, value: c.value && c.value !== '0' ? ethers.toBeHex(BigInt(c.value)) : undefined };
        await this.provider.call(tx); // revienta aquí, con motivo, si está condenada
        // Gas = estimación ×2 (capada bajo el límite del bloque del fork): la
        // estimación pelada se queda CORTA en los caminos fríos de Compound —
        // visto, recall de Kinetic: OutOfGas dentro del transfer del FXRP
        // por la regla 63/64. Pedir un fijo enorme tampoco: «intrinsic gas too
        // high» (lección). Estimar y dar margen es el punto medio.
        try {
          const est = (await this.provider.send('eth_estimateGas', [tx])) as string;
          const withMargin = (BigInt(est) * 2n > 7_500_000n ? 7_500_000n : BigInt(est) * 2n);
          tx.gas = ethers.toBeHex(withMargin);
        } catch { /* sin estimación, que decida anvil como hasta ahora */ }
        const hash = (await this.provider.send('eth_sendTransaction', [tx])) as string;
        const receipt = await this.provider.waitForTransaction(hash);
        if (!receipt || receipt.status !== 1) throw new DryRunError('TX_FAILED', `la transacción ${hash} no ejecutó`);
        txHashes.push(hash);
      }
    } finally {
      await this.provider.send('anvil_stopImpersonatingAccount', [sender]).catch(() => undefined);
    }
    return { txHashes };
  }

  /**
   * Una orden de consejo YA COMPUESTA por `/cage-order/prepare`, ejecutada como
   * la ejecutaría el bridge tras la prueba FDC: misma calldata, contra la jaula,
   * con el BRIDGE como msg.sender. Lo único que se salta es la firma y la ronda.
   */
  async executeCageOrder(input: { cage: string; bridge: string; orderData: string }): Promise<{ txHashes: string[]; nonce: string }> {
    await this.ready();
    const { nonce, calldata } = decodeOrderData(input.orderData);
    const out = await this.executeCalls(input.bridge, [{ to: input.cage, data: calldata }]);
    return { ...out, nonce: nonce.toString() };
  }

  /** FXRP del whale del fork + gas. El capital del ensayo no existe fuera de él. */
  async fund(address: string, fxrpBase: bigint): Promise<{ txHashes: string[]; fxrpBalance: string }> {
    await this.ready();
    const token = (process.env.FXRP_TOKEN ?? '').trim();
    if (!ethers.isAddress(token)) throw new DryRunError('NO_FXRP', 'Falta FXRP_TOKEN en el env del ensayo.');
    const to = ethers.getAddress(address);
    await this.ensureGas(to);
    const out =
      fxrpBase > 0n
        ? await this.executeCalls(fxrpWhale(), [{ to: token, data: ERC20_IFACE.encodeFunctionData('transfer', [to, fxrpBase]) }])
        : { txHashes: [] };
    const erc20 = new ethers.Contract(token, ERC20_IFACE, this.provider);
    const bal = (await erc20.balanceOf(to)) as bigint;
    return { txHashes: out.txHashes, fxrpBalance: bal.toString() };
  }

  /**
   * El nacimiento de la jaula, en seco: la MISMA `factory.create` que llamaría
   * la Personal Account del consejo tras el 0xFE — impersonando esa PA. La
   * constitución del ensayo es una huella fija (en vivo la ancla el DIDSet).
   */
  async createCage(council: string): Promise<{ bridge: string; cage: string; personalAccount: string }> {
    await this.ready();
    const factoryAddr = (process.env.ASTRYUM_CAGE_FACTORY_ADDRESS ?? '').trim();
    const asset = (process.env.FXRP_TOKEN ?? '').trim();
    if (!ethers.isAddress(factoryAddr)) throw new DryRunError('NO_FACTORY', 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS (¿corriste el script de despliegue del ensayo?).');
    if (!ethers.isAddress(asset)) throw new DryRunError('NO_FXRP', 'Falta FXRP_TOKEN.');

    const { resolvePersonalAccount } = await import('../../connectors/protocols/flare/FlareSmartAccountService');
    const pa = await resolvePersonalAccount(this.provider, council);
    if (!pa || pa === ethers.ZeroAddress) {
      throw new DryRunError(
        'NO_PERSONAL_ACCOUNT',
        `La cuenta ${council} no tiene Personal Account en el fork. El ensayo usa una r-address que YA tenga PA en mainnet (DRY_RUN_COUNCIL).`,
      );
    }

    const iface = new ethers.Interface([
      'function create(string councilAddress, (address asset, bytes32 constitutionRef, (uint32 chainId, address target)[] allowedTargets) p) returns (address bridge, address cage)',
      'function cageOf(bytes32) view returns (address)',
      'function bridgeOf(bytes32) view returns (address)',
    ]);
    const params = {
      asset: ethers.getAddress(asset),
      constitutionRef: ethers.keccak256(ethers.toUtf8Bytes('astryum-dry-run-constitution')),
      allowedTargets: [] as Array<{ chainId: number; target: string }>, // sigue al registro del fork
    };
    await this.executeCalls(pa, [{ to: factoryAddr, data: iface.encodeFunctionData('create', [council, params]) }]);
    const factory = new ethers.Contract(factoryAddr, iface, this.provider);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(council));
    const cage = ethers.getAddress(await factory.cageOf(hash));
    const bridge = ethers.getAddress(await factory.bridgeOf(hash));
    return { bridge, cage, personalAccount: ethers.getAddress(pa) };
  }

  /** El registro KYC del partner, desplegado desde el artifact de forge (solo local). */
  async deployKycRegistry(admin: string): Promise<{ registry: string; txHash: string }> {
    await this.ready();
    const artifactPath =
      process.env.DRY_RUN_KYC_ARTIFACT ??
      path.resolve(process.cwd(), '..', 'contracts', 'out', 'ExchangeKycRegistry.sol', 'ExchangeKycRegistry.json');
    if (!fs.existsSync(artifactPath)) {
      throw new DryRunError('NO_ARTIFACT', `No está el artifact de forge en ${artifactPath} (corre \`forge build\` en contracts/).`);
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { bytecode?: { object?: string } };
    const bytecode = artifact.bytecode?.object;
    if (!bytecode || !bytecode.startsWith('0x')) throw new DryRunError('NO_ARTIFACT', 'El artifact no trae bytecode.');
    const initcode = bytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address'], [ethers.getAddress(admin)]).slice(2);

    const sender = ethers.getAddress(admin);
    await this.provider.send('anvil_impersonateAccount', [sender]);
    await this.ensureGas(sender);
    try {
      const hash = (await this.provider.send('eth_sendTransaction', [{ from: sender, data: initcode }])) as string;
      const receipt = await this.provider.waitForTransaction(hash);
      if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
        throw new DryRunError('TX_FAILED', 'El deploy del KycRegistry no ejecutó.');
      }
      return { registry: ethers.getAddress(receipt.contractAddress), txHash: hash };
    } finally {
      await this.provider.send('anvil_stopImpersonatingAccount', [sender]).catch(() => undefined);
    }
  }

  /** El reparto, con saldos vivos del fork. */
  async actors(): Promise<Array<DryRunActor & { flr: string; fxrp: string | null }>> {
    await this.ready();
    const token = (process.env.FXRP_TOKEN ?? '').trim();
    const erc20 = ethers.isAddress(token) ? new ethers.Contract(token, ERC20_IFACE, this.provider) : null;
    const out: Array<DryRunActor & { flr: string; fxrp: string | null }> = [];
    for (const a of DRY_RUN_ACTORS) {
      const flr = await this.provider.getBalance(a.address);
      let fxrp: string | null = null;
      try {
        fxrp = erc20 ? ((await erc20.balanceOf(a.address)) as bigint).toString() : null;
      } catch {
        fxrp = null;
      }
      out.push({ ...a, flr: flr.toString(), fxrp });
    }
    return out;
  }
}
