/**
 * El camino lo decide de dónde sale el FXRP — y el usuario tiene que poder
 * verlo ANTES de firmar nada.
 *
 * Hoy esa decisión está repartida: un selector que solo sabe de rails, un
 * enlace suelto al puente y un aviso del backend que se lee cuando ya es tarde.
 * El resultado es que alguien con su FXRP en la Personal Account empieza a
 * rellenar la entrada de Ethereum y se entera del desvío tres pantallas después.
 *
 * Estos tests fijan las dos cosas que la secuencia no puede equivocar: cuántas
 * confirmaciones va a pedir y cuántas esperas físicas hay en medio.
 */
import { describe, it, expect } from 'vitest';
import {
  fxrpOrigins, planBorrowRoute, originId, decideRoute,
  ETHEREUM_CHAIN_ID, FLARE_CHAIN_ID, type LinkedWallet,
} from '../fxrpOrigin';

const EOA = '0xDE1fAf781d98B3844c60e78D43b1E3c18Dd18135';
const PA = '0xc837aB1234567890AbcDef1234567890aBcDe3b1';
const XRPL = 'rNaFfVgbqWYotrR3Jz4RorirDUZgLfxhXt';

const metamask: LinkedWallet = { address: EOA, chainId: 14, ecosystem: 'evm', walletType: 'metamask' };
const personalAccount: LinkedWallet = { address: PA, chainId: 14, ecosystem: 'evm', walletType: 'smart-account' };
const xaman: LinkedWallet = { address: XRPL, chainId: null, ecosystem: 'xrpl', walletType: 'xaman' };

const owners = (pa: string) => (pa === PA ? XRPL : undefined);

describe('los orígenes elegibles', () => {
  it('una wallet EVM da DOS orígenes: su FXRP puede estar en cualquiera de las dos cadenas', () => {
    const origins = fxrpOrigins([metamask], owners);
    expect(origins.map((o) => o.kind)).toEqual(['evm-ethereum', 'evm-flare']);
    expect(origins.map((o) => o.chainId)).toEqual([ETHEREUM_CHAIN_ID, FLARE_CHAIN_ID]);
    // Misma dirección, misma clave, misma firma: lo que cambia es dónde mira.
    expect(new Set(origins.map((o) => o.address))).toEqual(new Set([EOA]));
    expect(origins.every((o) => o.signer === EOA)).toBe(true);
  });

  it('cada origen lleva id propio — sin él, un selector no puede distinguirlos', () => {
    const [ethereum, flare] = fxrpOrigins([metamask], owners);
    expect(ethereum.id).not.toBe(flare.id);
    expect(ethereum.id).toBe(originId(EOA, 1));
  });

  it('la Personal Account firma con su Xaman dueña, nunca por sí misma', () => {
    const [pa] = fxrpOrigins([personalAccount], owners);
    expect(pa.kind).toBe('smart-account');
    expect(pa.address).toBe(PA);
    expect(pa.signer).toBe(XRPL); // la PA no tiene clave propia
  });

  it('una PA sin dueña conocida NO se ofrece — sería un callejón sin salida', () => {
    expect(fxrpOrigins([personalAccount], () => undefined)).toEqual([]);
  });

  it('una wallet XRPL no es origen por sí misma: su FXRP vive en la PA', () => {
    expect(fxrpOrigins([xaman], owners)).toEqual([]);
  });
});

describe('el camino directo', () => {
  it('con el FXRP ya en Ethereum es UNA firma y ninguna espera', () => {
    const [ethereum] = fxrpOrigins([metamask], owners);
    const route = planBorrowRoute(ethereum, EOA);
    expect(route.steps.map((s) => s.kind)).toEqual(['enter-market']);
    expect(route.signatureCount).toBe(1);
    expect(route.waits).toEqual([]);
  });

  it('esa firma agrupa tres transacciones — o son tres seguidas si la wallet no agrupa', () => {
    const [ethereum] = fxrpOrigins([metamask], owners);
    const route = planBorrowRoute(ethereum, EOA);
    expect(route.steps[0].txCount).toBe(3);  // approve + colateral + préstamo
    expect(route.signatureCountWithoutBatching).toBe(3);
  });

  it('con el préstamo yendo a Sentora son CINCO transacciones — y sigue siendo UNA firma', () => {
    const [ethereum] = fxrpOrigins([metamask], owners);
    const route = planBorrowRoute(ethereum, EOA, { lendBorrowed: true });
    expect(route.steps.map((s) => s.kind)).toEqual(['enter-market']);
    expect(route.signatureCount).toBe(1);
    expect(route.steps[0].txCount).toBe(5);  // + approve RLUSD + deposit en la bóveda
    expect(route.signatureCountWithoutBatching).toBe(5);
  });
});

describe('el camino con puente', () => {
  it('desde Flare son DOS firmas y una espera de entrega', () => {
    const [, flare] = fxrpOrigins([metamask], owners);
    const route = planBorrowRoute(flare, EOA);
    expect(route.steps.map((s) => s.kind)).toEqual(['bridge', 'enter-market']);
    expect(route.signatureCount).toBe(2);
    expect(route.waits).toEqual(['layerzero-delivery']);
  });

  it('el puente se firma en Flare y la entrada en Ethereum — dos cadenas, no una', () => {
    const [, flare] = fxrpOrigins([metamask], owners);
    const [bridge, enter] = planBorrowRoute(flare, EOA).steps;
    expect(bridge.chainId).toBe(FLARE_CHAIN_ID);
    expect(enter.chainId).toBe(ETHEREUM_CHAIN_ID);
  });
});

describe('el camino pagando con XRP fresco (mint)', () => {
  const mintOrigin = {
    kind: 'xrpl-mint' as const, address: XRPL, chainId: FLARE_CHAIN_ID,
    signer: XRPL, id: `${XRPL}:mint`,
  };

  it('son TRES firmas: Xaman mintea al destino, luego puente y entrada', () => {
    const route = planBorrowRoute(mintOrigin, EOA);
    expect(route.steps.map((s) => s.kind)).toEqual(['mint-to-evm', 'bridge', 'enter-market']);
    expect(route.signatureCount).toBe(3);
  });

  it('la primera la firma Xaman en XRPL; las otras dos la wallet EVM de destino', () => {
    const [mint, bridge, enter] = planBorrowRoute(mintOrigin, EOA).steps;
    expect([mint.rail, mint.signer]).toEqual(['xrpl', XRPL]);
    expect([bridge.rail, bridge.signer, bridge.chainId]).toEqual(['evm', EOA, FLARE_CHAIN_ID]);
    expect([enter.rail, enter.signer, enter.chainId]).toEqual(['evm', EOA, ETHEREUM_CHAIN_ID]);
  });

  it('la espera del mint es la atestación FDC, y luego la entrega del puente', () => {
    expect(planBorrowRoute(mintOrigin, EOA).waits).toEqual(['fdc-attestation', 'layerzero-delivery']);
  });
});

describe('el camino desde la Smart Account', () => {
  it('son TRES firmas: Xaman saca el FXRP, y luego el puente y la entrada', () => {
    const [pa] = fxrpOrigins([personalAccount], owners);
    const route = planBorrowRoute(pa, EOA);
    expect(route.steps.map((s) => s.kind)).toEqual(['pa-withdraw', 'bridge', 'enter-market']);
    expect(route.signatureCount).toBe(3);
  });

  it('la primera la firma Xaman; las otras dos, la wallet EVM de destino', () => {
    const [pa] = fxrpOrigins([personalAccount], owners);
    const [withdraw, bridge, enter] = planBorrowRoute(pa, EOA).steps;
    expect([withdraw.rail, withdraw.signer]).toEqual(['xrpl', XRPL]);
    expect([bridge.rail, bridge.signer]).toEqual(['evm', EOA]);
    expect([enter.rail, enter.signer]).toEqual(['evm', EOA]);
  });

  it('hay DOS esperas físicas, y no son firmas: son tiempo', () => {
    const [pa] = fxrpOrigins([personalAccount], owners);
    // La ronda de atestación de Flare primero, la entrega de LayerZero después.
    expect(planBorrowRoute(pa, EOA).waits).toEqual(['fdc-attestation', 'layerzero-delivery']);
  });
});

describe('el camino lo decide el saldo, no el usuario', () => {
  // FXRP tiene 6 decimales: 10 FXRP = 10_000_000 en base units.
  const TEN = '10000000';
  const FOUR = '4000000';
  const SIX = '6000000';

  it('con bastante en Ethereum, va directo — sin cruzar cadenas', () => {
    expect(decideRoute(TEN, { ethereumBase: TEN, flareBase: '0' })).toEqual({
      kind: 'direct', reason: 'already-on-ethereum',
    });
  });

  it('con el dinero en Flare, hace falta el puente', () => {
    const d = decideRoute(TEN, { ethereumBase: '0', flareBase: TEN });
    expect(d.kind).toBe('bridge');
    expect(d).toMatchObject({ availableBase: TEN });
  });

  it('repartido entre las dos, también hace falta el puente', () => {
    expect(decideRoute(TEN, { ethereumBase: FOUR, flareBase: SIX }).kind).toBe('bridge');
  });

  it('si no llega ni sumando, lo dice — en vez de mandarte a puentear en balde', () => {
    const d = decideRoute(TEN, { ethereumBase: FOUR, flareBase: FOUR });
    expect(d.kind).toBe('insufficient');
    expect(d).toMatchObject({ totalBase: '8000000' });
  });

  it('un saldo ILEGIBLE no es un saldo cero', () => {
    // Las dos afirmaciones cuestan dinero: puentear de más, o firmar y revertir.
    expect(decideRoute(TEN, { ethereumBase: null, flareBase: TEN }).kind).toBe('unknown');
    expect(decideRoute(TEN, { ethereumBase: '0', flareBase: null }).kind).toBe('unknown');
  });

  it('pero si Ethereum ya cubre el importe, Flare ilegible da igual', () => {
    // No hay decisión que tomar: no se cruza nada, así que no hace falta saberlo.
    expect(decideRoute(TEN, { ethereumBase: TEN, flareBase: null }).kind).toBe('direct');
  });

  it('basura en la cifra no se interpreta como cero', () => {
    expect(decideRoute('mucho', { ethereumBase: TEN, flareBase: TEN }).kind).toBe('unknown');
    expect(decideRoute(TEN, { ethereumBase: '10.5', flareBase: TEN }).kind).toBe('unknown');
  });
});

describe('destino', () => {
  it('el destino puede ser una wallet EVM distinta de la de origen', () => {
    const otra = '0x1111111111111111111111111111111111111111';
    const [, flare] = fxrpOrigins([metamask], owners);
    const route = planBorrowRoute(flare, otra);
    expect(route.steps.every((s) => s.signer === otra)).toBe(true);
  });

  it('un destino que no es EVM no produce plan, produce un motivo', () => {
    const [ethereum] = fxrpOrigins([metamask], owners);
    const route = planBorrowRoute(ethereum, XRPL);
    expect(route.blocker).toBe('DESTINATION_NOT_EVM');
    expect(route.steps).toEqual([]);
  });
});
