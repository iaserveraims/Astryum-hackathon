/* eslint-disable */
// Read-only mainnet verification for the FXRP 0xFE direct-minting path (E1).
// Resolves AssetManagerFXRP via the FlareContractRegistry and reads the
// direct-minting settings that gate the demo (Core Vault address, fees, rate
// limits, granularity). NO signing, NO broadcast — pure view calls.
//
//   node scripts/verify-fxrp-directmint.js
const { ethers } = require('ethers');

const REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';
const RPC = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';

const REGISTRY_ABI = [
  'function getContractAddressByName(string) view returns (address)',
];
const AM_ABI = [
  'function fAsset() view returns (address)',
  'function assetMintingGranularityUBA() view returns (uint256)',
  'function directMintingPaymentAddress() view returns (string)',
  'function getDirectMintingMinimumFeeUBA() view returns (uint256)',
  'function getDirectMintingFeeBIPS() view returns (uint256)',
  'function getDirectMintingExecutorFeeUBA() view returns (uint256)',
  'function getDirectMintingHourlyLimitUBA() view returns (uint256)',
  'function getDirectMintingDailyLimitUBA() view returns (uint256)',
  'function getDirectMintingLargeMintingThresholdUBA() view returns (uint256)',
  'function getDirectMintingLargeMintingDelaySeconds() view returns (uint256)',
  'function getDirectMintingsUnblockUntilTimestamp() view returns (uint256)',
];
const MAC_ABI = [
  'function getXrplProviderWallets() view returns (string[])',
  'function getExecutorInfo() view returns (address,uint256)',
  'function getDefaultInstructionFee() view returns (uint256)',
];

const DROPS = 1e6; // 1 XRP = 1e6 drops (FXRP UBA == drops)

async function tryCall(label, fn, fmt) {
  try {
    const v = await fn();
    console.log(`  ${label}: ${fmt ? fmt(v) : v}`);
    return v;
  } catch (e) {
    console.log(`  ${label}: <call failed: ${e.shortMessage || e.message}>`);
    return undefined;
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, { name: 'flare', chainId: 14 }, { staticNetwork: true });
  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

  const am = await registry.getContractAddressByName('AssetManagerFXRP');
  console.log('AssetManagerFXRP:', am);
  const mac = await registry.getContractAddressByName('MasterAccountController').catch(() => '<not in registry>');
  console.log('MasterAccountController (registry):', mac);

  const a = new ethers.Contract(am, AM_ABI, provider);
  console.log('\n--- FXRP direct-minting settings (mainnet) ---');
  await tryCall('fAsset (FXRP token)', () => a.fAsset());
  const gran = await tryCall('assetMintingGranularityUBA', () => a.assetMintingGranularityUBA(), (v) => `${v} drops (${Number(v) / DROPS} XRP)`);
  await tryCall('directMintingPaymentAddress (Core Vault XRPL)', () => a.directMintingPaymentAddress());
  await tryCall('directMinting minFeeUBA', () => a.getDirectMintingMinimumFeeUBA(), (v) => `${v} drops (${Number(v) / DROPS} XRP)`);
  await tryCall('directMinting feeBIPS', () => a.getDirectMintingFeeBIPS(), (v) => `${v} bips (${Number(v) / 100}%)`);
  await tryCall('directMinting executorFeeUBA', () => a.getDirectMintingExecutorFeeUBA(), (v) => `${v} drops (${Number(v) / DROPS} XRP)`);
  await tryCall('directMinting hourlyLimitUBA', () => a.getDirectMintingHourlyLimitUBA(), (v) => `${v} drops (${Number(v) / DROPS} XRP)`);
  await tryCall('directMinting dailyLimitUBA', () => a.getDirectMintingDailyLimitUBA(), (v) => `${v} drops (${Number(v) / DROPS} XRP)`);
  await tryCall('directMinting largeMintThresholdUBA', () => a.getDirectMintingLargeMintingThresholdUBA(), (v) => `${v} drops (${Number(v) / DROPS} XRP)`);
  await tryCall('directMinting largeMintDelaySeconds', () => a.getDirectMintingLargeMintingDelaySeconds());
  await tryCall('directMinting unblockUntilTimestamp', () => a.getDirectMintingsUnblockUntilTimestamp());

  if (ethers.isAddress(mac)) {
    console.log('\n--- MasterAccountController (mainnet) ---');
    const m = new ethers.Contract(mac, MAC_ABI, provider);
    await tryCall('getXrplProviderWallets', () => m.getXrplProviderWallets());
    await tryCall('getExecutorInfo', () => m.getExecutorInfo(), (v) => `executor=${v[0]} fee=${v[1]} wei`);
    await tryCall('getDefaultInstructionFee', () => m.getDefaultInstructionFee(), (v) => `${v} drops`);
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
