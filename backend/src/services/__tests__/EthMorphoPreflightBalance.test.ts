/**
 * H7 — «la munición»: los pre-flights de saldo que faltaban.
 *
 * Todo el carril (el aviso del tick, el blurb de la plantilla, la disclosure)
 * repite que hace falta RLUSD alcanzable en Ethereum para repagar — y nadie
 * lo comprobaba: el approve + el repay se firmaban, se pagaba el gas y la
 * transacción revertía. Igual con el FXRP del supply y con el depósito en la
 * bóveda, que no tenía NINGÚN check.
 *
 * La otra mitad de la regla es tan importante como el bloqueo: cuando el
 * lector no sabe leer saldos, el check NO se añade — jamás se añade en verde
 * sin haber comprobado (familia «éxito no ganado»).
 */
import { prepareEthMorpho, prepareSentoraVault, type SentoraVaultReader } from '../EthMorphoPrepareService';
import { preflightTokenBalance, type MorphoChainReader } from '../EthMorphoMarketService';
import {
  FXRP_RLUSD_MARKET_PARAMS,
  RLUSD_ETH,
  FXRP_ETH,
} from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const USER = '0x1111111111111111111111111111111111111111';

/** Mercado sano: 1 FXRP de colateral, 1 RLUSD de deuda. */
function stubReader(balances?: Record<string, bigint>): MorphoChainReader {
  const reader: MorphoChainReader = {
    async idToMarketParams() { return FXRP_RLUSD_MARKET_PARAMS; },
    async market() {
      return {
        totalSupplyAssets: 1000n * E18, totalSupplyShares: 1000n * E18,
        totalBorrowAssets: 100n * E18, totalBorrowShares: 100n * E18,
        lastUpdate: 0n, fee: 0n,
      };
    },
    async position() { return { supplyShares: 0n, borrowShares: 1n * E18, collateral: 10n * E6 }; },
    // 1 FXRP ≈ 1 RLUSD, escala 1e36 ajustada por 10^(18-6)
    async oraclePrice() { return 10n ** 36n * 10n ** 12n; },
    async borrowRatePerSecond() { return 0n; },
    async erc20Decimals(token) { return token.toLowerCase() === FXRP_ETH.toLowerCase() ? 6 : 18; },
  };
  if (balances) {
    reader.erc20BalanceOf = async (token: string) => balances[token.toLowerCase()] ?? 0n;
  }
  return reader;
}

const balanceCheck = (r: { preflight: { checks: Array<{ name: string; ok: boolean; code?: string }> } }) =>
  r.preflight.checks.find((c) => c.name === 'balance');

describe('preflightTokenBalance — la regla, aislada', () => {
  it('bloquea cuando el saldo no llega, y dice cuánto falta', async () => {
    const reader = stubReader({ [RLUSD_ETH.toLowerCase()]: 1n });
    const v = await preflightTokenBalance(reader, RLUSD_ETH, USER, 5n * E18, 'RLUSD');
    expect(v?.ok).toBe(false);
    expect(v).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect((v as { data: Record<string, string> }).data).toMatchObject({ asset: 'RLUSD' });
  });

  it('pasa cuando el saldo cubre el importe', async () => {
    const reader = stubReader({ [RLUSD_ETH.toLowerCase()]: 10n * E18 });
    expect((await preflightTokenBalance(reader, RLUSD_ETH, USER, 5n * E18, 'RLUSD'))?.ok).toBe(true);
  });

  it('devuelve null —NO un ok— cuando el lector no sabe leer saldos', async () => {
    // Un check en verde sin haber comprobado es peor que no tenerlo.
    expect(await preflightTokenBalance(stubReader(), RLUSD_ETH, USER, 1n, 'RLUSD')).toBeNull();
  });
});

describe('el repay comprueba LA MUNICIÓN', () => {
  it('bloquea el repay parcial sin RLUSD suficiente', async () => {
    const r = await prepareEthMorpho(
      stubReader({ [RLUSD_ETH.toLowerCase()]: 0n }),
      { action: 'repay', user: USER, repayMode: 'partial', amountBase: (5n * 10n ** 17n).toString() },
    );
    expect(balanceCheck(r)?.ok).toBe(false);
    expect(r.preflight.ok).toBe(false);
  });

  it('bloquea el repay FULL cuando no cubre deuda + buffer del approve', async () => {
    const r = await prepareEthMorpho(
      stubReader({ [RLUSD_ETH.toLowerCase()]: 1n }),
      { action: 'repay', user: USER, repayMode: 'full' },
    );
    expect(balanceCheck(r)?.ok).toBe(false);
  });

  it('deja pasar el repay cuando la munición está', async () => {
    const r = await prepareEthMorpho(
      stubReader({ [RLUSD_ETH.toLowerCase()]: 100n * E18 }),
      { action: 'repay', user: USER, repayMode: 'partial', amountBase: (5n * 10n ** 17n).toString() },
    );
    expect(balanceCheck(r)?.ok).toBe(true);
    expect(r.preflight.ok).toBe(true);
  });
});

describe('el supply y el carry comprueban el FXRP en ETHEREUM', () => {
  it('bloquea supply_collateral sin FXRP en chain 1', async () => {
    const r = await prepareEthMorpho(
      stubReader({ [FXRP_ETH.toLowerCase()]: 0n }),
      { action: 'supply_collateral', user: USER, amountBase: (5n * E6).toString() },
    );
    expect(balanceCheck(r)?.ok).toBe(false);
  });

  it('bloquea open_carry sin FXRP, aunque la liquidez del mercado sobre', async () => {
    const r = await prepareEthMorpho(
      stubReader({ [FXRP_ETH.toLowerCase()]: 1n, [RLUSD_ETH.toLowerCase()]: 0n }),
      { action: 'open_carry', user: USER, amountBase: (5n * E6).toString(), borrowBase: (1n * E18).toString() },
    );
    expect(balanceCheck(r)?.ok).toBe(false);
    expect(r.preflight.checks.find((c) => c.name === 'liquidity')?.ok).toBe(true);
  });
});

describe('el depósito en la bóveda deja de firmarse a ciegas', () => {
  function stubVault(over: Partial<{ balance: bigint; cap: bigint }> = {}): SentoraVaultReader {
    return {
      async asset() { return RLUSD_ETH; },
      async totalAssets() { return 318_000_000n * E18; },
      async maxWithdraw() { return 100n * E18; },
      async assetDecimals() { return 18; },
      async assetBalanceOf() { return over.balance ?? 1000n * E18; },
      async maxDeposit() { return over.cap ?? 1_000_000n * E18; },
    };
  }

  // La bóveda REAL: Morpho Vault V2, cuyos max* son stubs a 0 aunque tenga
  // 319M de assets, el titular 2,17M de shares y las retiradas funcionen.
  // Valores leídos de mainnet el 2026-08-17.
  function vaultV2(over: Partial<{ shares: bigint; claim: bigint; idle: bigint }> = {}): SentoraVaultReader {
    return {
      async asset() { return RLUSD_ETH; },
      async totalAssets() { return 319_843_286n * E18; },
      async maxWithdraw() { return 0n; },  // ← el stub que rompía la salida
      async maxDeposit() { return 0n; },   // ← el stub que rompía la entrada
      async assetDecimals() { return 18; },
      async assetBalanceOf() { return 1000n * E18; },
      async sharesOf() { return over.shares ?? 2_172_228n * E18; },
      async previewRedeem() { return over.claim ?? 2_193_066n * E18; },
      async idleAssets() { return over.idle ?? 16_900_000n * E18; },
    };
  }

  it('VAULT V2: un depósito normal ya NO se bloquea con un cap falso', async () => {
    // maxDeposit()==0 en V2 significa «no implementado», no «llena». Tratarlo
    // como tope pintaba un rojo permanente en CADA depósito — y acostumbraba
    // a firmar por encima de un rojo, que es lo peor que puede enseñarse.
    const r = await prepareSentoraVault(vaultV2(), {
      action: 'vault_deposit', user: USER, amountBase: (10n * E18).toString(),
    });
    expect(r.preflight.checks.find((c) => c.name === 'cap')).toBeUndefined();
    expect(r.preflight.ok).toBe(true);
  });

  it('VAULT V2: la retirada se permite contra el VALOR de tus shares, no contra maxWithdraw', async () => {
    // Con el check viejo esto era imposible: maxWithdraw()=0 ⇒ cualquier
    // importe > 0 deshabilitaba el botón. El capital entraba y no salía.
    const r = await prepareSentoraVault(vaultV2(), {
      action: 'vault_withdraw', user: USER, amountBase: (1000n * E18).toString(),
    });
    expect(r.preflight.ok).toBe(true);
    expect(r.preflight.checks.find((c) => c.name === 'balance')?.ok).toBe(true);
  });

  it('VAULT V2: pedir más de lo que valen tus shares SÍ se bloquea', async () => {
    const r = await prepareSentoraVault(vaultV2({ claim: 5n * E18 }), {
      action: 'vault_withdraw', user: USER, amountBase: (10n * E18).toString(),
    });
    expect(r.preflight.checks.find((c) => c.name === 'balance')?.code).toBe('WITHDRAW_EXCEEDS_BALANCE');
  });

  it('VAULT V2: la liquidez VIVA de la bóveda manda — y ahora la promesa es cierta', async () => {
    // «Withdraw: anytime, against the vault's live liquidity» deja de ser una
    // frase de marketing: si no puede pagar hoy, se dice antes de firmar.
    const r = await prepareSentoraVault(vaultV2({ idle: 1n }), {
      action: 'vault_withdraw', user: USER, amountBase: (10n * E18).toString(),
    });
    const liq = r.preflight.checks.find((c) => c.name === 'liquidity');
    expect(liq?.ok).toBe(false);
    expect(liq?.code).toBe('WITHDRAW_EXCEEDS_VAULT_LIQUIDITY');
  });

  it('sin shares no hay nada que retirar, y se dice', async () => {
    const r = await prepareSentoraVault(vaultV2({ shares: 0n, claim: 0n }), {
      action: 'vault_withdraw', user: USER, amountBase: (1n * E18).toString(),
    });
    expect(r.preflight.checks.find((c) => c.name === 'balance')?.ok).toBe(false);
  });

  it('bloquea el depósito sin RLUSD', async () => {
    const r = await prepareSentoraVault(stubVault({ balance: 0n }), {
      action: 'vault_deposit', user: USER, amountBase: (10n * E18).toString(),
    });
    expect(r.preflight.checks.find((c) => c.name === 'balance')?.ok).toBe(false);
    expect(r.preflight.ok).toBe(false);
  });

  it('bloquea cuando la bóveda tiene el cupo lleno — manda su cap, no tu saldo', async () => {
    const r = await prepareSentoraVault(stubVault({ cap: 1n }), {
      action: 'vault_deposit', user: USER, amountBase: (10n * E18).toString(),
    });
    const cap = r.preflight.checks.find((c) => c.name === 'cap');
    expect(cap?.ok).toBe(false);
    expect(cap).toMatchObject({ code: 'DEPOSIT_EXCEEDS_CAP' });
  });

  it('pasa con saldo y cupo, y sigue sin inventar checks que no puede hacer', async () => {
    const ok = await prepareSentoraVault(stubVault(), {
      action: 'vault_deposit', user: USER, amountBase: (10n * E18).toString(),
    });
    expect(ok.preflight.ok).toBe(true);

    // Un lector viejo (sin las lecturas nuevas) no produce checks fantasma.
    const legacyReader: SentoraVaultReader = {
      async asset() { return RLUSD_ETH; },
      async totalAssets() { return 1n; },
      async maxWithdraw() { return 1n; },
      async assetDecimals() { return 18; },
    };
    const legacy = await prepareSentoraVault(legacyReader, {
      action: 'vault_deposit', user: USER, amountBase: (10n * E18).toString(),
    });
    expect(legacy.preflight.checks).toHaveLength(0);
  });
});
