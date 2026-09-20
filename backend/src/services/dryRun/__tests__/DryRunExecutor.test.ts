/**
 * El ensayo en seco — las guardas y la parte pura. Lo que aquí se fija: el
 * módulo es FAIL-CLOSED (sin flag no arranca; con RPC remoto no arranca), y el
 * orderData se decodifica exactamente como lo compone el raíl de órdenes.
 */
import { ethers } from 'ethers';
import {
  DRY_RUN_ACTORS,
  DryRunError,
  DryRunExecutor,
  assertLocalRpc,
  decodeOrderData,
  dryRunEnabled,
  fxrpWhale,
} from '../DryRunExecutor';

const OLD_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('fail-closed', () => {
  it('sin DRY_RUN_MODE=true, ni el flag ni el ejecutor', () => {
    delete process.env.DRY_RUN_MODE;
    expect(dryRunEnabled()).toBe(false);
    expect(() => new DryRunExecutor()).toThrow(DryRunError);
  });

  it('solo el literal true enciende', () => {
    process.env.DRY_RUN_MODE = '1';
    expect(dryRunEnabled()).toBe(false);
    process.env.DRY_RUN_MODE = 'true';
    expect(dryRunEnabled()).toBe(true);
  });

  it('un RPC remoto se rechaza aunque el flag esté puesto — jamás impersonar fuera', () => {
    process.env.DRY_RUN_MODE = 'true';
    expect(() => new DryRunExecutor('https://flare-api.flare.network/ext/C/rpc')).toThrow(/local/);
    expect(() => assertLocalRpc('http://192.168.1.10:8545')).toThrow(DryRunError);
    expect(() => assertLocalRpc('no-es-url')).toThrow(/URL/);
    expect(() => assertLocalRpc('http://127.0.0.1:8545')).not.toThrow();
    expect(() => assertLocalRpc('http://localhost:8545')).not.toThrow();
  });
});

describe('decodeOrderData — lo mismo que compone el raíl', () => {
  it('ida y vuelta con un orderData real', () => {
    const calldata = '0x12345678deadbeef';
    const orderData = ethers.AbiCoder.defaultAbiCoder().encode(['uint64', 'bytes'], [7, calldata]);
    const out = decodeOrderData(orderData);
    expect(out.nonce).toBe(7n);
    expect(out.calldata).toBe(calldata);
  });

  it('lo que no es hex o no decodifica, se rechaza con motivo', () => {
    expect(() => decodeOrderData('nope')).toThrow(/hex/);
    expect(() => decodeOrderData('0x1234')).toThrow(/no decodifica/);
  });
});

describe('el reparto', () => {
  it('seis papeles, direcciones únicas y con checksum', () => {
    expect(DRY_RUN_ACTORS).toHaveLength(6);
    const addrs = DRY_RUN_ACTORS.map((a) => a.address);
    expect(new Set(addrs.map((a) => a.toLowerCase())).size).toBe(6);
    for (const a of addrs) expect(ethers.getAddress(a)).toBe(a);
  });

  it('el whale por defecto es el mercado kFXRP-ISO de Kinetic (mainnet real)', () => {
    delete process.env.DRY_RUN_FXRP_WHALE;
    expect(fxrpWhale()).toBe('0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3');
  });
});
