/* eslint-disable */
// Read-only mainnet verification for the EVM rails (E2 wrap+delegate, A2 reward
// claim). Resolves WNat / RewardManager / FtsoRewardManager via the registry and
// probes view functions. NO signing, NO broadcast.
//   node scripts/verify-evm-rails.js
const { ethers } = require('ethers');

const REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';
const RPC = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
const OLD_REWARD = '0xc5738334b972745067fFa666040fdeADc66Cb925'; // memory: "dead" FtsoRewardManager?

const REGISTRY_ABI = ['function getContractAddressByName(string) view returns (address)'];
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];
// WNat surface (E2)
const WNAT_ABI = [
  'function delegate(address to, uint256 bips)',
  'function deposit() payable',
  'function delegatesOf(address owner) view returns (address[] delegateAddresses, uint256[] bips, uint256 count, uint256 delegationMode)',
];
// RewardManager surface (A2) — getStateOfRewards is the canonical view
const RM_ABI = [
  'function getStateOfRewards(address rewardOwner, uint24 rewardEpochId) view returns (tuple(uint24 rewardEpochId, bytes20 beneficiary, uint8 claimType, uint120 amount)[][] state)',
  'function getNextClaimableRewardEpochId(address rewardOwner) view returns (uint24)',
  'function active() view returns (bool)',
  'function rewardManagerId() view returns (uint256)',
];

async function probe(provider, label, addr) {
  const code = await provider.getCode(addr);
  const has = code && code !== '0x';
  console.log(`  ${label}: ${addr} → ${has ? `contract (${(code.length - 2) / 2} bytes)` : 'NO CODE'}`);
  return has;
}
async function tryCall(label, fn, fmt) {
  try { const v = await fn(); console.log(`    ${label}: ${fmt ? fmt(v) : v}`); return v; }
  catch (e) { console.log(`    ${label}: <fail: ${e.shortMessage || e.code || e.message}>`); }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, { name: 'flare', chainId: 14 }, { staticNetwork: true });
  const reg = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

  const names = ['WNat', 'RewardManager', 'FtsoRewardManager', 'FlareSystemsManager', 'ClaimSetupManager', 'FtsoManager'];
  console.log('--- registry resolution (mainnet) ---');
  const resolved = {};
  for (const n of names) {
    try { resolved[n] = await reg.getContractAddressByName(n); console.log(`  ${n}: ${resolved[n]}`); }
    catch (e) { console.log(`  ${n}: <not in registry: ${e.shortMessage || e.message}>`); }
  }

  console.log('\n--- WNat (E2 wrap + delegate) ---');
  if (resolved.WNat && resolved.WNat !== ethers.ZeroAddress) {
    await probe(provider, 'WNat', resolved.WNat);
    const w = new ethers.Contract(resolved.WNat, [...ERC20_ABI, ...WNAT_ABI], provider);
    await tryCall('name', () => w.name());
    await tryCall('symbol', () => w.symbol());
    await tryCall('decimals', () => w.decimals());
    // delegatesOf on a zero-ish address just to confirm the selector exists (view)
    await tryCall('delegatesOf(dead) [selector exists?]', () => w.delegatesOf('0x000000000000000000000000000000000000dEaD'),
      (v) => `count=${v.count} mode=${v.delegationMode}`);
  } else {
    console.log('  WNat NOT resolved');
  }

  console.log('\n--- RewardManager (A2 claim) ---');
  if (resolved.RewardManager && resolved.RewardManager !== ethers.ZeroAddress) {
    await probe(provider, 'RewardManager', resolved.RewardManager);
    const rm = new ethers.Contract(resolved.RewardManager, RM_ABI, provider);
    await tryCall('active', () => rm.active());
    await tryCall('rewardManagerId', () => rm.rewardManagerId());
    await tryCall('getNextClaimableRewardEpochId(dead)', () => rm.getNextClaimableRewardEpochId('0x000000000000000000000000000000000000dEaD'));
  } else {
    console.log('  RewardManager NOT resolved');
  }

  console.log('\n--- legacy FtsoRewardManager + the "dead" 0xc573… ---');
  if (resolved.FtsoRewardManager && resolved.FtsoRewardManager !== ethers.ZeroAddress) {
    await probe(provider, 'FtsoRewardManager (registry)', resolved.FtsoRewardManager);
  } else {
    console.log('  FtsoRewardManager: not in registry (expected if deprecated)');
  }
  await probe(provider, 'OLD 0xc573…(memory: dead)', OLD_REWARD);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
