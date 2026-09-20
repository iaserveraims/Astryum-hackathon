/**
 * La salida del pote por donde se entró — una firma XRPL, dos calls.
 *
 * Lo que se prueba aquí es la decisión que evita un batch condenado: el unmint
 * se dimensiona SIEMPRE por debajo de lo previsto, porque `redeem` entrega lo
 * que valgan las participaciones EN EJECUCIÓN y el unmint pide una cifra fija.
 * Pedir de más revierte el batch entero; pedir de menos deja FXRP en la propia
 * cuenta del usuario. Solo uno de los dos errores cuesta dinero.
 */
import { ethers } from 'ethers';
import {
  DEFAULT_EXIT_MARGIN_BPS,
  MAX_EXIT_MARGIN_BPS,
  PoteExitError,
  buildPoteClaimRedeemCall,
  buildPoteExitBatch,
  buildPoteRedeemCall,
  sizeUnmintConservatively,
} from '../AstryumPoteExitService';

const POTE = '0xb0b0000000000000000000000000000000000001';
const ASSET_MANAGER = '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8';
const PA = '0xeeee000000000000000000000000000000000001';

const REDEEM_IFACE = new ethers.Interface([
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
]);

describe('sizeUnmintConservatively — nunca pedir más de lo que llegará', () => {
  it('se queda por debajo de lo previsto, con el margen por defecto', () => {
    const s = sizeUnmintConservatively({ previewedUBA: 1_000_000n, minimumUBA: 0n });

    expect(s.marginBps).toBe(DEFAULT_EXIT_MARGIN_BPS);
    expect(s.marginUBA).toBe(2_500n); // 25 bps de 1.000.000
    expect(s.unmintUBA).toBe(997_500n);
    // La propiedad que importa, dicha como propiedad y no como número:
    expect(s.unmintUBA).toBeLessThan(s.previewedUBA);
  });

  it('con margen 0 pide exactamente lo previsto (el caso que hay que poder elegir, no el default)', () => {
    const s = sizeUnmintConservatively({ previewedUBA: 1_000_000n, minimumUBA: 0n, marginBps: 0 });
    expect(s.unmintUBA).toBe(1_000_000n);
    expect(s.marginUBA).toBe(0n);
  });

  it('el margen sale del importe del usuario y NO se pierde: previsto = unmint + margen', () => {
    const previewedUBA = 987_654_321n;
    const s = sizeUnmintConservatively({ previewedUBA, minimumUBA: 0n, marginBps: 100 });
    // Lo que no se desmintea sigue siendo suyo, en FXRP, en su propia PA.
    expect(s.unmintUBA + s.marginUBA).toBe(previewedUBA);
  });

  it('rechaza si tras el margen se queda por debajo del mínimo de FAssets', () => {
    expect(() =>
      sizeUnmintConservatively({ previewedUBA: 1_000_000n, minimumUBA: 999_000n }),
    ).toThrow(PoteExitError);

    try {
      sizeUnmintConservatively({ previewedUBA: 1_000_000n, minimumUBA: 999_000n });
    } catch (e) {
      expect((e as PoteExitError).code).toBe('BELOW_FASSETS_MINIMUM');
      // El error tiene que decir qué hacer, no solo que no se puede.
      expect((e as PoteExitError).message).toContain('desmintea después');
    }
  });

  it('justo en el mínimo, pasa', () => {
    const s = sizeUnmintConservatively({ previewedUBA: 1_000_000n, minimumUBA: 997_500n });
    expect(s.unmintUBA).toBe(997_500n);
  });

  it('rechaza importe cero o negativo, y márgenes fuera de rango', () => {
    expect(() => sizeUnmintConservatively({ previewedUBA: 0n, minimumUBA: 0n })).toThrow(/BAD_AMOUNT|> 0/);
    expect(() =>
      sizeUnmintConservatively({ previewedUBA: 1000n, minimumUBA: 0n, marginBps: MAX_EXIT_MARGIN_BPS + 1 }),
    ).toThrow(PoteExitError);
    expect(() =>
      sizeUnmintConservatively({ previewedUBA: 1000n, minimumUBA: 0n, marginBps: -1 }),
    ).toThrow(PoteExitError);
  });
});

describe('buildPoteRedeemCall — owner y receiver son la misma PA', () => {
  it('codifica redeem(shares, PA, PA)', () => {
    const call = buildPoteRedeemCall({ pote: POTE, sharesBase: 1_000_000n, personalAccount: PA });

    expect(call.to.toLowerCase()).toBe(POTE.toLowerCase());
    const [shares, receiver, owner] = REDEEM_IFACE.decodeFunctionData('redeem', call.calldata);
    expect(BigInt(shares)).toBe(1_000_000n);
    // receiver == owner == la PA: el FXRP tiene que aterrizar donde la siguiente
    // call lo va a gastar, y solo el owner puede sacar sus participaciones (#18).
    expect(String(receiver).toLowerCase()).toBe(PA.toLowerCase());
    expect(String(owner).toLowerCase()).toBe(PA.toLowerCase());
  });

  it('rechaza direcciones malas y shares cero', () => {
    expect(() => buildPoteRedeemCall({ pote: 'no', sharesBase: 1n, personalAccount: PA })).toThrow(PoteExitError);
    expect(() => buildPoteRedeemCall({ pote: POTE, sharesBase: 1n, personalAccount: 'no' })).toThrow(PoteExitError);
    expect(() => buildPoteRedeemCall({ pote: POTE, sharesBase: 0n, personalAccount: PA })).toThrow(PoteExitError);
  });
});

describe('buildPoteExitBatch — el orden y el destino de cada call', () => {
  const exitCall = () => buildPoteRedeemCall({ pote: POTE, sharesBase: 1_000_000n, personalAccount: PA });
  const unmintCall = () => ({ to: ASSET_MANAGER, value: '0', calldata: '0xdeadbeef' });

  it('sale del pote primero y desmintea después', () => {
    const batch = buildPoteExitBatch({ pote: POTE, poteExitCall: exitCall(), unmintCall: unmintCall() });

    expect(batch).toHaveLength(2);
    expect(batch[0].to.toLowerCase()).toBe(POTE.toLowerCase());
    expect(batch[1].to.toLowerCase()).toBe(ASSET_MANAGER.toLowerCase());
    // Ninguna call mueve nativo: el 0xFE paga el gas, el usuario solo firma XRPL.
    expect(batch.every((c) => c.value === '0')).toBe(true);
  });

  it('rechaza que la salida apunte a otro sitio que no sea el pote', () => {
    const impostor = { to: ASSET_MANAGER, value: '0', calldata: '0xabcd' };
    expect(() =>
      buildPoteExitBatch({ pote: POTE, poteExitCall: impostor, unmintCall: unmintCall() }),
    ).toThrow(/EXIT_CALL_NOT_TO_POTE|debe ir al pote/);
  });

  it('rechaza que el unmint vuelva al pote — dejaría de ser una salida', () => {
    const backToPote = { to: POTE, value: '0', calldata: '0xabcd' };
    expect(() =>
      buildPoteExitBatch({ pote: POTE, poteExitCall: exitCall(), unmintCall: backToPote }),
    ).toThrow(/UNMINT_CALL_TO_POTE|nunca de vuelta/);
  });

  it('rechaza calls incompletas en vez de componer un batch a medias', () => {
    expect(() =>
      buildPoteExitBatch({ pote: POTE, poteExitCall: exitCall(), unmintCall: { to: '', value: '0', calldata: '' } }),
    ).toThrow(PoteExitError);
  });
});

describe('buildPoteClaimRedeemCall — la salida del pote con cooldown', () => {
  it('codifica claimRedeem con sus venueClaims', () => {
    const call = buildPoteClaimRedeemCall({
      pote: POTE,
      ticketId: 3n,
      venueClaims: [{ venueId: 0n, period: 7n }],
    });

    expect(call.to.toLowerCase()).toBe(POTE.toLowerCase());
    const iface = new ethers.Interface([
      'function claimRedeem(uint256 ticketId, (uint256 venueId, uint256 period)[] venueClaims)',
    ]);
    const [ticketId, claims] = iface.decodeFunctionData('claimRedeem', call.calldata);
    expect(BigInt(ticketId)).toBe(3n);
    expect(BigInt(claims[0][0])).toBe(0n);
    expect(BigInt(claims[0][1])).toBe(7n);
  });

  it('acepta lista vacía de venueClaims (el pote puede tener el líquido ya en casa)', () => {
    const call = buildPoteClaimRedeemCall({ pote: POTE, ticketId: 1n, venueClaims: [] });
    expect(call.calldata.startsWith('0x')).toBe(true);
  });
});
