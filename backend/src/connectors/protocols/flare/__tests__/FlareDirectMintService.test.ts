jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

const AM = '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8';
const MAC = '0x434936d47503353f06750db1a444dbdc5f0ad37c';
const FXRP = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const CORE_VAULT = 'rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj';
const PA = '0x1111111111111111111111111111111111111111';
const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class MockContract {
    constructor(public address: string) {}
    async getContractAddressByName(name: string): Promise<string> {
      return name === 'AssetManagerFXRP' ? AM : MAC;
    }
    async fAsset() { return FXRP; }
    async directMintingPaymentAddress() { return CORE_VAULT; }
    async getDirectMintingMinimumFeeUBA() { return 100000n; }
    async getDirectMintingFeeBIPS() { return 10n; }
    async getDirectMintingExecutorFeeUBA() { return 200000n; }
    async assetMintingGranularityUBA() { return 1n; }
    async getPersonalAccount(_xrpl: string) { return PA; }
    async getNonce(_pa: string) { return 7n; }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

import { ethers } from 'ethers';
import {
  computeNetMint,
  buildExecuteUserOpCallData,
  buildPackedUserOp,
  build0xFEMemo,
  buildDirectMintHandoff,
  buildE1Handoff,
  buildE3Handoff,
  buildRedeemToXrplCall,
  resolveRedemptionExecutor,
  findNonceSeatConflicts,
  classifySeatConflicts,
  _resetAssetManagerCache,
} from '../FlareDirectMintService';
import { _resetMacCache } from '../FlareSmartAccountService';
import { resetAddressCache } from '../../../../config/protocolAddresses';
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';

const fakeProvider = {} as any;
const KFXRP = '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3';
const KUSDT0 = '0xad7e7989796414c9572da9854deb1b920724fd09';
const EXEC_USEROP_IFACE = new ethers.Interface([
  'function executeUserOp((address target, uint256 value, bytes data)[] _calls) payable',
]);
const PUO_TUPLE =
  'tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)';

const FEES = { minFeeUBA: 100000n, feeBIPS: 10n, executorFeeUBA: 200000n, granularityUBA: 1n };

beforeEach(() => {
  _resetAssetManagerCache();
  _resetMacCache();
  delete process.env.XRPL_SOURCE_TAG;
  _resetXrplSourceTagCache();
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
  process.env.KINETIC_KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
  process.env.FXRP_TOKEN = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
  resetAddressCache();
});

describe('FlareDirectMintService — computeNetMint (post-fee accounting, #4)', () => {
  test('20 XRP gross: minFee floor applies, net = gross − mintFee − execFee, buffered', () => {
    const net = computeNetMint(20_000_000n, FEES, 10n);
    // pctFee = 20_000_000 * 10 / 10000 = 20_000 < minFee 100_000 → mintFee = 100_000
    expect(net.mintingFeeUBA).toBe(100_000n);
    expect(net.executorFeeUBA).toBe(200_000n);
    expect(net.netToPersonalAccountUBA).toBe(19_700_000n);
    expect(net.bufferUBA).toBe(19_700n); // 10 bips of net
    expect(net.supplyUBA).toBe(19_680_300n); // net − buffer, floored to granularity 1
    expect(net.supplyUBA).toBeLessThanOrEqual(net.netToPersonalAccountUBA);
  });

  test('large gross: percentage fee dominates the floor', () => {
    const net = computeNetMint(1_000_000_000n, FEES, 0n); // 1000 XRP, no buffer
    // pctFee = 1e9 * 10 / 10000 = 1_000_000 > minFee → mintFee = 1_000_000
    expect(net.mintingFeeUBA).toBe(1_000_000n);
    expect(net.netToPersonalAccountUBA).toBe(998_800_000n);
    expect(net.supplyUBA).toBe(998_800_000n);
  });

  test('floors to granularity', () => {
    const net = computeNetMint(20_000_000n, { ...FEES, granularityUBA: 10_000_000n }, 0n);
    // net = 19_700_000 → floor to 10_000_000 → 10_000_000
    expect(net.supplyUBA).toBe(10_000_000n);
  });

  test('throws when gross ≤ fees', () => {
    expect(() => computeNetMint(250_000n, FEES)).toThrow(/INSUFFICIENT/);
    expect(() => computeNetMint(0n, FEES)).toThrow(/BAD_AMOUNT/);
  });
});

describe('FlareDirectMintService — userOp + memo', () => {
  test('buildExecuteUserOpCallData encodes executeUserOp(Call[])', async () => {
    const cd = await buildExecuteUserOpCallData([
      { to: KFXRP, calldata: '0x095ea7b3', value: '0' },
      { to: KUSDT0, calldata: '0xc5ebeaec', value: '0' },
    ]);
    const decoded = EXEC_USEROP_IFACE.parseTransaction({ data: cd });
    expect(decoded?.name).toBe('executeUserOp');
    expect(decoded?.args[0]).toHaveLength(2);
    expect(decoded?.args[0][0][0].toLowerCase()).toBe(KFXRP);
  });

  test('buildPackedUserOp encodes the OZ tuple; hash = keccak256(data)', async () => {
    const callData = await buildExecuteUserOpCallData([{ to: KFXRP, calldata: '0x095ea7b3', value: '0' }]);
    const { dataHex, userOpHash } = await buildPackedUserOp({ sender: PA, nonce: 7n, callData });
    expect(userOpHash).toBe(ethers.keccak256(dataHex));
    const [op] = ethers.AbiCoder.defaultAbiCoder().decode([PUO_TUPLE], dataHex);
    expect(op.sender.toLowerCase()).toBe(PA);
    expect(op.nonce).toBe(7n);
    expect(op.callData).toBe(callData);
    expect(op.initCode).toBe('0x');
    expect(op.signature).toBe('0x');
  });

  test('build0xFEMemo (official encoder) → 42-byte memo, uppercase, no 0x, starts FE', async () => {
    const memo = await build0xFEMemo({
      walletId: 0,
      executorFeeUBA: 200000n,
      userOpHash: '0x' + 'ab'.repeat(32),
    });
    expect(memo).toBe(memo.toUpperCase());
    expect(memo.startsWith('0X')).toBe(false);
    expect(memo.slice(0, 2)).toBe('FE');
    expect(memo).toHaveLength(84); // 42 bytes
    expect(memo.endsWith('AB'.repeat(32))).toBe(true); // userOpHash committed verbatim
  });
});

describe('FlareDirectMintService — buildDirectMintHandoff (unsigned, end-to-end)', () => {
  test('assembles XRPL Payment to Core Vault + memo + post-fee supply, no DestinationTag', async () => {
    const handoff = await buildDirectMintHandoff(fakeProvider, {
      xrplAddress: 'rUserXrplAddr',
      grossXrpDrops: 20_000_000n,
      innerCalls: [
        { to: KFXRP, calldata: '0x095ea7b3', value: '0' }, // approve (stub)
        { to: KFXRP, calldata: '0xa0712d68', value: '0' }, // mint (stub)
      ],
      walletId: 0,
    });

    expect(handoff.personalAccount).toBe(ethers.getAddress(PA));
    expect(handoff.fxrpToken).toBe(ethers.getAddress(FXRP));
    expect(handoff.net.supplyUBA).toBe(19_680_300n);

    // XRPL Payment: destination = Core Vault (NOT operator wallet), amount = gross drops.
    // Account SIEMPRE pinnado al firmante del prepare (incidente 2026-07-14:
    // sin Account, Xaman firma con la cuenta activa — bytes inejecutables).
    expect(handoff.xrplPayment.Account).toBe('rUserXrplAddr');
    expect(handoff.xrplPayment.Destination).toBe(CORE_VAULT);
    expect(handoff.xrplPayment.Amount).toBe('20000000');
    expect((handoff.xrplPayment as any).DestinationTag).toBeUndefined();
    expect(handoff.xrplPayment.Memos[0].Memo.MemoData).toBe(handoff.memoHex);
    expect(handoff.memoHex.slice(0, 2)).toBe('FE');

    // memo commits keccak256 of the off-chain userOp bytes (by construction).
    expect(handoff.memoHex.endsWith(handoff.userOpHash.slice(2).toUpperCase())).toBe(true);
    expect(ethers.keccak256(handoff.userOpData)).toBe(handoff.userOpHash);

    // No XRPL_SOURCE_TAG configured → the Payment goes out untagged (no key at all).
    expect('SourceTag' in handoff.xrplPayment).toBe(false);
  });

  test('stamps the Make Waves SourceTag when XRPL_SOURCE_TAG is set — DestinationTag stays out', async () => {
    process.env.XRPL_SOURCE_TAG = '2606160020';
    _resetXrplSourceTagCache();

    const handoff = await buildDirectMintHandoff(fakeProvider, {
      xrplAddress: 'rUserXrplAddr',
      grossXrpDrops: 20_000_000n,
      innerCalls: [{ to: KFXRP, calldata: '0x095ea7b3', value: '0' }],
      walletId: 0,
    });

    // SourceTag labels the sender side; it must NEVER become a DestinationTag
    // (that would misroute the FAssets mint).
    expect(handoff.xrplPayment.SourceTag).toBe(2606160020);
    expect((handoff.xrplPayment as any).DestinationTag).toBeUndefined();
    // the rest of the Payment is untouched by the stamp
    expect(handoff.xrplPayment.Destination).toBe(CORE_VAULT);
    expect(handoff.xrplPayment.Amount).toBe('20000000');
    expect(handoff.xrplPayment.Memos[0].Memo.MemoData).toBe(handoff.memoHex);
  });
});

describe('buildE1Handoff — closes E1 (mint→supply→borrow) + A1 trigger', () => {
  test('composes net + borrow + ISO batch + hand-off + precomputed trigger', async () => {
    const e1 = await buildE1Handoff(fakeProvider, {
      xrplAddress: 'rUserXrplAddr',
      grossXrpDrops: 20_000_000n,
      borrowRatio: 0.3,
      targetHF: 1.1,
      fxrpPriceUSD: 2.84,
      collateralFactor: 0.7,
    });

    // post-fee supply (gross 20 XRP − 0.1 mint − 0.2 exec, 10bip buffer)
    expect(e1.handoff.net.supplyUBA).toBe(19_680_300n);
    // borrow sized from net·CF·ratio (shared math)
    expect(e1.borrow.borrowUsdt0Base).toBeGreaterThan(0n);
    // hand-off targets the Core Vault, unsigned, with the 0xFE memo
    expect(e1.handoff.xrplPayment.Destination).toBe(CORE_VAULT);
    expect(e1.handoff.xrplPayment.Amount).toBe('20000000');
    expect(e1.handoff.memoHex.slice(0, 2)).toBe('FE');

    // A1 inputs precomputed from the SAME (net, CF, ratio) → F4 reuses verbatim
    expect(e1.a1.triggerPriceUSD).toBeGreaterThan(0);
    expect(e1.a1.triggerPriceUSD).toBeLessThan(2.84); // price must fall to breach HF
    expect(e1.a1.supplyUBA).toBe('19680300');
    expect(e1.a1.borrowUsdt0Base).toBe(e1.borrow.borrowUsdt0Base.toString());
    expect(e1.a1.collateralFactor).toBe(0.7);
    expect(e1.a1.borrowRatio).toBe(0.3);

    // the userOp wraps the 4-call ISO batch (approve+mint+enterMarkets+borrow)
    const calls = ethers.AbiCoder.defaultAbiCoder().decode(
      ['tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)'],
      e1.handoff.userOpData,
    );
    expect(calls[0].sender.toLowerCase()).toBe(PA);
    expect(calls[0].callData.length).toBeGreaterThan(10);
  });
});

describe('buildE3Handoff — closes E3 (lend-only mint→supply, NO borrow)', () => {
  test('composes net + [approve, mint] ISO batch + hand-off; no borrow, no trigger', async () => {
    const e3 = await buildE3Handoff(fakeProvider, {
      xrplAddress: 'rUserXrplAddr',
      grossXrpDrops: 20_000_000n,
    });

    // post-fee supply — same net accounting as E1 (gross 20 − 0.1 mint − 0.2 exec, 10bip buffer)
    expect(e3.handoff.net.supplyUBA).toBe(19_680_300n);
    // hand-off targets the Core Vault, unsigned, with the 0xFE memo — no DestinationTag
    expect(e3.handoff.xrplPayment.Destination).toBe(CORE_VAULT);
    expect(e3.handoff.xrplPayment.Amount).toBe('20000000');
    expect((e3.handoff.xrplPayment as any).DestinationTag).toBeUndefined();
    expect(e3.handoff.memoHex.slice(0, 2)).toBe('FE');
    // memo commits keccak256 of the off-chain userOp bytes
    expect(ethers.keccak256(e3.handoff.userOpData)).toBe(e3.handoff.userOpHash);
    // lend-only exposes no borrow/A1 fields
    expect((e3 as any).borrow).toBeUndefined();
    expect((e3 as any).a1).toBeUndefined();

    // the userOp wraps EXACTLY a 2-call batch ([approve, mint]) — NO borrow, NO enterMarkets
    const packed = ethers.AbiCoder.defaultAbiCoder().decode(
      ['tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)'],
      e3.handoff.userOpData,
    );
    expect(packed[0].sender.toLowerCase()).toBe(PA);
    const EXEC = new ethers.Interface([
      'function executeUserOp((address target, uint256 value, bytes data)[] _calls) payable',
    ]);
    const inner = EXEC.parseTransaction({ data: packed[0].callData });
    expect(inner?.name).toBe('executeUserOp');
    expect(inner?.args[0]).toHaveLength(2); // exactly [approve, mint] — E1 has 4
  });
});

describe('buildVaultRotateHandoff — fuses exit + entry into ONE dispatch', () => {
  const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
  const EARNXRP_VAULT = '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28';
  const EARNXRP_TOKEN = '0xE533E447fD7720b2F8654da2B1953Efa06b60bfA';

  beforeEach(() => {
    process.env.FIRELIGHT_STXRP = STXRP;
    process.env.FIRELIGHT_STAKING = STXRP;
    process.env.UPSHIFT_EARNXRP_VAULT = EARNXRP_VAULT;
    process.env.UPSHIFT_EARNXRP_TOKEN = EARNXRP_TOKEN;
    resetAddressCache();
  });

  test('firelight → earnxrp: [redeem, approve, deposit] batch; deposit = redeemDeposit + net mint', async () => {
    const { buildVaultRotateHandoff } = await import('../FlareDirectMintService');
    const rot = await buildVaultRotateHandoff(fakeProvider, {
      xrplAddress: 'rUserXrplAddr',
      grossXrpDrops: 20_000_000n, // same fee fixture as E3 → net supply 19.6803
      fromVault: 'firelight',
      toVault: 'earnxrp',
      sharesUBA: 5_000_000n,
      redeemDepositUBA: 10_000_000n,
    });

    // The mint-coupled FXRP joins the deposit instead of sitting loose in the PA.
    expect(rot.handoff.net.supplyUBA).toBe(19_680_300n);
    expect(rot.depositUBA).toBe(10_000_000n + 19_680_300n);
    // Same 0xFE hand-off contract as every dispatch: Core Vault, memo commit, unsigned.
    expect(rot.handoff.xrplPayment.Destination).toBe(CORE_VAULT);
    expect((rot.handoff.xrplPayment as any).DestinationTag).toBeUndefined();
    expect(ethers.keccak256(rot.handoff.userOpData)).toBe(rot.handoff.userOpHash);

    // The userOp wraps EXACTLY the fused 3-call batch, in order:
    //   stXRP.redeem(shares, PA, PA) → FXRP.approve(vaultB) → vaultB.deposit(FXRP, amount, PA)
    const packed = ethers.AbiCoder.defaultAbiCoder().decode([PUO_TUPLE], rot.handoff.userOpData);
    expect(packed[0].sender.toLowerCase()).toBe(PA);
    const inner = EXEC_USEROP_IFACE.parseTransaction({ data: packed[0].callData });
    const calls = inner?.args[0] as Array<{ target: string; data: string }>;
    expect(calls).toHaveLength(3);
    expect(calls[0].target.toLowerCase()).toBe(STXRP.toLowerCase());
    const redeem = new ethers.Interface(['function redeem(uint256 shares, address receiver, address owner)'])
      .parseTransaction({ data: calls[0].data });
    expect(redeem?.args[0]).toBe(5_000_000n);
    expect((redeem?.args[1] as string).toLowerCase()).toBe(PA);
    expect((redeem?.args[2] as string).toLowerCase()).toBe(PA);
    expect(calls[1].target.toLowerCase()).toBe(FXRP);
    const approve = new ethers.Interface(['function approve(address spender, uint256 amount)'])
      .parseTransaction({ data: calls[1].data });
    expect((approve?.args[0] as string).toLowerCase()).toBe(EARNXRP_VAULT.toLowerCase());
    expect(approve?.args[1]).toBe(29_680_300n);
    expect(calls[2].target.toLowerCase()).toBe(EARNXRP_VAULT.toLowerCase());
    const deposit = new ethers.Interface(['function deposit(address token, uint256 amount, address receiver)'])
      .parseTransaction({ data: calls[2].data });
    expect((deposit?.args[0] as string).toLowerCase()).toBe(FXRP);
    expect(deposit?.args[1]).toBe(29_680_300n);
    expect((deposit?.args[2] as string).toLowerCase()).toBe(PA);
  });

  test('rejects a same-vault rotation', async () => {
    const { buildVaultRotateHandoff } = await import('../FlareDirectMintService');
    await expect(
      buildVaultRotateHandoff(fakeProvider, {
        xrplAddress: 'rUserXrplAddr',
        grossXrpDrops: 20_000_000n,
        fromVault: 'earnxrp',
        toVault: 'earnxrp',
        sharesUBA: 5_000_000n,
        redeemDepositUBA: 10_000_000n,
      }),
    ).rejects.toThrow('VAULT_ROTATE_SAME_VAULT');
  });
});


describe('findNonceSeatConflicts — el asiento de nonce es de UNO (incidente 2026-07-14/16)', () => {
  const PA_ADDR = '0x' + '11'.repeat(20);

  async function opRow(nonce: bigint, calldataStub: string) {
    const callData = await buildExecuteUserOpCallData([{ to: '0x' + '22'.repeat(20), calldata: calldataStub, value: '0' }]);
    const { dataHex, userOpHash } = await buildPackedUserOp({ sender: PA_ADDR, nonce, callData });
    return { userOpData: dataHex, userOpHash };
  }

  test('dos userOps distintos con el mismo nonce = conflicto (los gemelos del 14-jul)', async () => {
    const a = await opRow(2n, '0x095ea7b3');
    const b = await opRow(2n, '0xc5ebeaec');
    const conflicts = findNonceSeatConflicts([a], 2n, b.userOpHash);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].userOpHash).toBe(a.userOpHash);
  });

  test('el mismo userOpHash NO es conflicto (re-prepare idempotente)', async () => {
    const a = await opRow(2n, '0x095ea7b3');
    expect(findNonceSeatConflicts([a], 2n, a.userOpHash)).toHaveLength(0);
  });

  test('nonces distintos no chocan (op en cola legítima)', async () => {
    const a = await opRow(2n, '0x095ea7b3');
    const b = await opRow(3n, '0xc5ebeaec');
    expect(findNonceSeatConflicts([a], 3n, b.userOpHash)).toHaveLength(0);
  });

  test('una fila corrupta no reclama el asiento (ni revienta el prepare)', async () => {
    const b = await opRow(2n, '0xc5ebeaec');
    expect(findNonceSeatConflicts([{ userOpData: '0xdeadbeef', userOpHash: '0x' + 'aa'.repeat(32) }], 2n, b.userOpHash)).toHaveLength(0);
  });
});

describe('classifySeatConflicts — el asiento abandonado caduca solo (TTL, 2026-07)', () => {
  const now = 1_700_000_000_000; // ms fijo — el nowMs se pasa (Date.now vive en el caller)
  const ttl = 5 * 60_000;

  test('conflicto más viejo que el TTL = stale → se invalida solo, sin tapiar', () => {
    const { stale, fresh } = classifySeatConflicts([{ userOpHash: '0xaa', createdAt: new Date(now - ttl - 1) }], ttl, now);
    expect(stale).toHaveLength(1);
    expect(fresh).toHaveLength(0);
  });

  test('conflicto reciente = fresh → hace esperar (podría estar firmado y en vuelo)', () => {
    const { stale, fresh } = classifySeatConflicts([{ userOpHash: '0xbb', createdAt: new Date(now - 1000) }], ttl, now);
    expect(fresh).toHaveLength(1);
    expect(stale).toHaveLength(0);
  });

  test('sin createdAt = fresh (defecto seguro: preserva el guard)', () => {
    const { stale, fresh } = classifySeatConflicts([{ userOpHash: '0xcc' }], ttl, now);
    expect(fresh).toHaveLength(1);
    expect(stale).toHaveLength(0);
  });

  test('parte una mezcla en sus dos cubos', () => {
    const { stale, fresh } = classifySeatConflicts(
      [
        { userOpHash: '0x1', createdAt: new Date(now - ttl - 1) },
        { userOpHash: '0x2', createdAt: new Date(now - 10) },
      ],
      ttl,
      now,
    );
    expect(stale.map((c) => c.userOpHash)).toEqual(['0x1']);
    expect(fresh.map((c) => c.userOpHash)).toEqual(['0x2']);
  });
});

describe('buildRedeemToXrplCall — la vuelta a XRP nativo (unmint) del carril PA', () => {
  const REDEEM_IFACE = new ethers.Interface([
    'function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor) returns (uint256)',
  ]);
  const ORIGINAL_PK = process.env.FLARE_EXECUTOR_PK;
  afterEach(() => {
    if (ORIGINAL_PK === undefined) delete process.env.FLARE_EXECUTOR_PK;
    else process.env.FLARE_EXECUTOR_PK = ORIGINAL_PK;
  });

  test('encodea redeemAmount al AssetManager, value 0, destino = wallet XRPL dueña', async () => {
    delete process.env.FLARE_EXECUTOR_PK; // sin clave → executor = address(0), como el camino EVM
    const call = await buildRedeemToXrplCall(fakeProvider, { amountUBA: 5_000_000n, xrplDestination: CORE_VAULT });
    expect(call.to.toLowerCase()).toBe(AM.toLowerCase());
    expect(call.value).toBe('0');
    const decoded = REDEEM_IFACE.decodeFunctionData('redeemAmount', call.calldata);
    expect(decoded[0]).toBe(5_000_000n);
    expect(decoded[1]).toBe(CORE_VAULT); // el destino XRPL viaja tal cual
    expect(decoded[2]).toBe(ethers.ZeroAddress); // sin clave → sin executor de redención
  });

  test('con FLARE_EXECUTOR_PK, el executor de redención = la wallet del executor (rescate del default sin otra firma)', async () => {
    // clave de test conocida → dirección determinista
    process.env.FLARE_EXECUTOR_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    const expected = new ethers.Wallet(process.env.FLARE_EXECUTOR_PK).address;
    expect(await resolveRedemptionExecutor()).toBe(expected);
    const call = await buildRedeemToXrplCall(fakeProvider, { amountUBA: 5_000_000n, xrplDestination: CORE_VAULT });
    const decoded = REDEEM_IFACE.decodeFunctionData('redeemAmount', call.calldata);
    expect(decoded[2]).toBe(expected);
  });

  test('rechaza importe no positivo', async () => {
    await expect(buildRedeemToXrplCall(fakeProvider, { amountUBA: 0n, xrplDestination: CORE_VAULT })).rejects.toThrow(
      /REDEEM_BAD_AMOUNT/,
    );
  });
});
