/**
 * prepareSentoraVault — the lend-only leg of W3 (la card «lend-only» de Earn).
 * Pins: asset()==RLUSD refusal, finite approve, withdraw pre-flight, honest
 * simulation semantics, and the binding curator-risk wording (barrido §2.3.3).
 */
import {
  prepareSentoraVault,
  SentoraVaultReader,
  SENTORA_CURATOR_NOTE,
} from '../EthMorphoPrepareService';
import { RLUSD_ETH } from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';
import {
  SENTORA_RLUSD_VAULT,
  buildVaultDepositLegs,
  buildVaultWithdrawLegs,
} from '../../connectors/protocols/adapters/SentoraRlusdVaultAdapter';
import { Interface, MaxUint256 } from 'ethers';

const E18 = 10n ** 18n;
const USER = '0x1111111111111111111111111111111111111111';

function stubVault(overrides: Partial<{
  asset: string; totalAssets: bigint; maxWithdraw: bigint;
}> = {}): SentoraVaultReader {
  return {
    async asset() { return overrides.asset ?? RLUSD_ETH; },
    async totalAssets() { return overrides.totalAssets ?? 318_000_000n * E18; },
    async maxWithdraw() { return overrides.maxWithdraw ?? 100n * E18; },
    async assetDecimals() { return 18; },
  };
}

const decodeIface = new Interface([
  'function approve(address spender, uint256 amount)',
  'function deposit(uint256 assets, address receiver)',
  'function withdraw(uint256 assets, address receiver, address owner)',
]);

describe('adapter legs', () => {
  it('deposit = finite approve to the vault + deposit(assets, user)', () => {
    const assets = 50n * E18;
    const legs = buildVaultDepositLegs(USER, assets);
    expect(legs).toHaveLength(2);
    const ap = decodeIface.decodeFunctionData('approve', legs[0].data);
    expect(ap.spender).toBe(SENTORA_RLUSD_VAULT);
    expect(ap.amount).toBe(assets);
    expect(ap.amount).not.toBe(MaxUint256);
    const dep = decodeIface.decodeFunctionData('deposit', legs[1].data);
    expect(dep.assets).toBe(assets);
    expect(dep.receiver).toBe(USER);
  });

  it('withdraw = single leg withdraw(assets, user, user) — own shares, no approve', () => {
    const [leg] = buildVaultWithdrawLegs(USER, 10n * E18);
    const w = decodeIface.decodeFunctionData('withdraw', leg.data);
    expect(w.receiver).toBe(USER);
    expect(w.owner).toBe(USER);
  });
});

describe('prepareSentoraVault', () => {
  it('refuses to build when vault.asset() is not RLUSD (invariant #3, on-chain)', async () => {
    await expect(prepareSentoraVault(
      stubVault({ asset: '0x000000000000000000000000000000000000dEaD' }),
      { action: 'vault_deposit', user: USER, amountBase: (1n * E18).toString() },
    )).rejects.toMatchObject({ code: 'VAULT_ASSET_MISMATCH' });
  });

  it('deposit: legs + curator note + honest no-simulator note', async () => {
    const r = await prepareSentoraVault(stubVault(), {
      action: 'vault_deposit', user: USER, amountBase: (50n * E18).toString(),
    });
    expect(r.legs).toHaveLength(2);
    expect(r.preflight.ok).toBe(true);
    expect(r.disclosure.curatorNote).toBe(SENTORA_CURATOR_NOTE);
    expect(r.disclosure.curatorNote).toContain('aggregate');
    expect(r.disclosure.approvals).toBe('finite');
    expect(r.simulation.attempted).toBe(false);
    expect(r.simulation.note).toContain('not configured');
    expect(JSON.stringify(r)).toBeTruthy();
  });

  /**
   * Este test fijaba el tope en `maxWithdraw` — y ERA EL QUE ENMASCARABA el
   * bug (auditoría 2026-08-17): con el stub a 100 RLUSD parecía correcto,
   * mientras en la bóveda REAL (Morpho Vault V2) `maxWithdraw` devuelve 0
   * para todo el mundo y dejaba la ÚNICA salida del lend-only deshabilitada.
   * La capacidad se lee ahora del valor de las shares y de la liquidez viva;
   * la cobertura de esos caminos vive en EthMorphoPreflightBalance.test.ts.
   */
  it('withdraw se permite contra el VALOR de las shares; por encima bloquea ANTES de la firma', async () => {
    const withClaim = (claim: bigint): SentoraVaultReader => ({
      ...stubVault(),
      async sharesOf() { return 1n * E18; },
      async previewRedeem() { return claim; },
      async idleAssets() { return 1_000_000n * E18; },
    });

    const ok = await prepareSentoraVault(withClaim(100n * E18), {
      action: 'vault_withdraw', user: USER, amountBase: (100n * E18).toString(),
    });
    expect(ok.preflight.ok).toBe(true);

    const blocked = await prepareSentoraVault(withClaim(100n * E18), {
      action: 'vault_withdraw', user: USER, amountBase: (101n * E18).toString(),
    });
    expect(blocked.preflight.ok).toBe(false);
    expect(blocked.preflight.checks[0]).toMatchObject({ ok: false, code: 'WITHDRAW_EXCEEDS_BALANCE' });
  });

  it('simulates leg 0 and marks the deposit leg depends_on_prior', async () => {
    const simulate = jest.fn(async () => ({ success: true, gasUsed: 90_000 }));
    const r = await prepareSentoraVault(stubVault(), {
      action: 'vault_deposit', user: USER, amountBase: (1n * E18).toString(),
    }, simulate);
    expect(r.simulation.legs[0].status).toBe('ok');
    expect(r.simulation.legs[1].status).toBe('depends_on_prior');
    expect(simulate).toHaveBeenCalledTimes(1);
  });
});
