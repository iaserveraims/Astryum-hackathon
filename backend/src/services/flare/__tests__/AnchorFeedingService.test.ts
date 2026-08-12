/**
 * AnchorFeedingService — B3: el feeding hop del anchor.
 *
 * Tests de la lógica PURA (el "cerebro" del gauge, igual que el umbral del
 * executor): la decisión de cuándo/cuánto convertir, el batch que transfiere el
 * FXRP al executor, y que la wallet del anchor se deriva de los dos formatos que
 * da Xaman (family seed / secret numbers). La orquestación (firmar+mandar) es
 * integración on-chain y no se unit-testea, como el gemelo del executor.
 */
import { ethers } from 'ethers';
import {
  computeAnchorFeed,
  buildAnchorFeedBatch,
  anchorWalletFromSeed,
  effectiveReserveXrp,
} from '../AnchorFeedingService';

const EXECUTOR = '0xD8767C3C4dC0A1E13F23368B172a5ff78B54CecE';
const ANCHOR = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';

describe('computeAnchorFeed — el umbral (misma forma que el refuel del executor)', () => {
  it('no dispara si el XRP libre (sobre la reserva) está por debajo del mínimo', () => {
    // 6 XRP total − 2 reserva = 4 libre < 5 mínimo → no.
    const d = computeAnchorFeed(6, 2, 5);
    expect(d.shouldFeed).toBe(false);
    expect(d.feedXrp).toBe(0);
    expect(d.freeXrp).toBe(4);
  });

  it('dispara y convierte TODO lo libre cuando el libre ≥ mínimo', () => {
    // 10 total − 2 reserva = 8 libre ≥ 5 → convierte 8.
    const d = computeAnchorFeed(10, 2, 5);
    expect(d.shouldFeed).toBe(true);
    expect(d.feedXrp).toBe(8);
    expect(d.freeXrp).toBe(8);
  });

  it('NUNCA deja el anchor por debajo de la reserva (solo convierte el excedente)', () => {
    const d = computeAnchorFeed(100, 2, 5);
    expect(d.feedXrp).toBe(98); // 100 − 2 reserva
  });

  it('saldo ≤ reserva → 0 libre, no dispara', () => {
    expect(computeAnchorFeed(2, 2, 5)).toEqual({ shouldFeed: false, feedXrp: 0, freeXrp: 0 });
    expect(computeAnchorFeed(1, 2, 5)).toEqual({ shouldFeed: false, feedXrp: 0, freeXrp: 0 });
  });

  it('con la reserva clavada en la del ledger, el hop mandaría una tx IMPOSIBLE', () => {
    // El caso real de mainnet (8-ago-2026): saldo 1,900006, base reserve 1 XRP,
    // LEGACY_ANCHOR_RESERVE_XRP=1. Sin suelo, feedXrp = 0,900006 y al descontar
    // la fee el anchor cae por debajo de su reserva → tecUNFUNDED_PAYMENT.
    const sinSuelo = computeAnchorFeed(1.900006, 1, 0.5);
    expect(sinSuelo.shouldFeed).toBe(true);
    expect(1.900006 - sinSuelo.feedXrp).toBeCloseTo(1, 6); // justo en la reserva: no cabe la fee
  });

  it('mínimo 0/negativo → nunca dispara (guarda contra una config vacía)', () => {
    expect(computeAnchorFeed(100, 2, 0).shouldFeed).toBe(false);
    expect(computeAnchorFeed(100, 2, -1).shouldFeed).toBe(false);
  });
});

describe('buildAnchorFeedBatch — el batch: transfer del FXRP acuñado → executor', () => {
  const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
  const IFACE = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);

  it('construye UNA call: FXRP.transfer(executor, supplyUBA), value 0', () => {
    const supply = 1_000_000n; // 1 FXRP
    const [call] = buildAnchorFeedBatch(EXECUTOR, supply);
    expect(call.to.toLowerCase()).toBe(FXRP.toLowerCase());
    expect(call.value).toBe('0');
    const decoded = IFACE.decodeFunctionData('transfer', call.calldata);
    expect(decoded[0]).toBe(EXECUTOR);
    expect(decoded[1]).toBe(supply);
  });

  it('rechaza un executor inválido y un supply ≤ 0 (no manda a la nada)', () => {
    expect(() => buildAnchorFeedBatch('no-es-address', 1n)).toThrow('ANCHOR_FEED_BAD_EXECUTOR');
    expect(() => buildAnchorFeedBatch(EXECUTOR, 0n)).toThrow('ANCHOR_FEED_BAD_SUPPLY');
  });
});

describe('effectiveReserveXrp — el suelo que hace que la tx pueda asentar', () => {
  it('sube la reserva del env cuando queda pegada a la del ledger', () => {
    // El env decía 1 y la base reserve son 1 XRP exactos → no cabía ni la fee.
    expect(effectiveReserveXrp(1, 1)).toBeCloseTo(1.01, 6);
    // Y con ese suelo el anchor conserva margen sobre la reserva del ledger.
    const d = computeAnchorFeed(1.900006, effectiveReserveXrp(1, 1), 0.5);
    expect(1.900006 - d.feedXrp).toBeGreaterThan(1);
  });

  it('respeta una reserva del env más alta — el suelo no la baja nunca', () => {
    expect(effectiveReserveXrp(2, 1)).toBe(2);
  });

  it('sigue a la reserva del ledger cuando el anchor tiene objetos propios', () => {
    // 1 base + 2 objetos × 0,2 = 1,4 → el env de 2 ya no basta.
    expect(effectiveReserveXrp(2, 1.4)).toBe(2);
    expect(effectiveReserveXrp(1, 2.4)).toBeCloseTo(2.41, 6);
  });

  it('una reserva del ledger ilegible cae al default de 1 XRP, no a NaN', () => {
    expect(effectiveReserveXrp(0, Number.NaN)).toBeCloseTo(1.01, 6);
  });
});

describe('anchorWalletFromSeed — los dos formatos que enseña Xaman', () => {
  /** Masterpassphrase: seed pública de la cuenta génesis, no es de nadie. */
  const GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
  const GENESIS_ADDRESS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
  /** Los mismos 128 bits, escritos como los enseña Xaman (8 grupos de 6). */
  const GENESIS_SECRET_NUMBERS = '570521 598543 265488 209520 212450 201006 286214 581400';

  it('deriva desde un family seed (s…) la cuenta CORRECTA, no la del default ed25519', async () => {
    const w = await anchorWalletFromSeed(GENESIS_SEED);
    expect(w.classicAddress).toBe(GENESIS_ADDRESS);
    // No deriva el anchor real → el guard del servicio abortaría (config mala).
    expect(w.classicAddress).not.toBe(ANCHOR);
  });

  it('deriva desde los "secret numbers" de Xaman — antes esto reventaba cada tick', async () => {
    const w = await anchorWalletFromSeed(GENESIS_SECRET_NUMBERS);
    expect(w.classicAddress).toBe(GENESIS_ADDRESS);
  });

  it('un dígito de control torcido falla claro, en vez de derivar otra cuenta', async () => {
    // Mismo grupo 1, dígito de control +1 → ya no cuadra.
    await expect(
      anchorWalletFromSeed('570522 598543 265488 209520 212450 201006 286214 581400', ANCHOR),
    ).rejects.toThrow(/CHECKSUM/);
  });
});
