/* eslint-disable */
// Read-only mainnet probe for the Flare DeFi protocols the Earn surface would
// draw from. Loads backend/.env, then for each protocol checks: (a) env address
// present, (b) on-chain code exists, (c) a representative view call responds.
// NO signing, NO broadcast.   node scripts/verify-flare-earn-pools.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ethers } = require('ethers');

const RPC = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
const provider = new ethers.JsonRpcProvider(RPC, { name: 'flare', chainId: 14 }, { staticNetwork: true });

const ERC20 = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];
const COMPTROLLER = ['function getAllMarkets() view returns (address[])'];
const KTOKEN = ['function symbol() view returns (string)', 'function underlying() view returns (address)'];
const NFPM = ['function factory() view returns (address)'];
const SFLR = ['function symbol() view returns (string)', 'function getPooledFlrByShares(uint256) view returns (uint256)'];

async function code(addr) {
  if (!addr) return false;
  const c = await provider.getCode(addr).catch(() => '0x');
  return c && c !== '0x' ? (c.length - 2) / 2 : 0;
}
async function tryCall(label, fn, fmt) {
  try { const v = await fn(); console.log(`      ${label}: ${fmt ? fmt(v) : v}`); return v; }
  catch (e) { console.log(`      ${label}: <fail: ${e.shortMessage || e.code || e.message}>`); }
}
function envAddr(k) {
  const v = process.env[k];
  return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? v : null;
}

async function probe(label, addr, abi, calls) {
  const bytes = await code(addr);
  const has = bytes && bytes > 0;
  console.log(`  ${label}: ${addr ?? '<env empty>'} → ${addr ? (has ? `contract (${bytes} bytes)` : 'NO CODE') : 'SKIP'}`);
  if (has && calls) {
    const c = new ethers.Contract(addr, abi, provider);
    await calls(c);
  }
  return has;
}

async function main() {
  console.log(`RPC: ${RPC}`);
  console.log(`FLARE_DEFI_ENABLED=${process.env.FLARE_DEFI_ENABLED}\n`);

  console.log('=== KINETIC (primary, Compound-v2 fork) ===');
  const kComp = envAddr('KINETIC_COMPTROLLER');
  await probe('Comptroller', kComp, COMPTROLLER, async (c) => {
    await tryCall('getAllMarkets().length', () => c.getAllMarkets(), (v) => v.length);
  });
  for (const k of ['KINETIC_KUSDCE', 'KINETIC_KSFLR', 'KINETIC_KWETH', 'KINETIC_KFLRETH', 'KINETIC_KFLR', 'KINETIC_KUSDT0']) {
    await probe(k, envAddr(k), KTOKEN, async (c) => {
      await tryCall('symbol', () => c.symbol());
      await tryCall('underlying', () => c.underlying());
    });
  }

  console.log('\n=== KINETIC ISO (FXRP collateral / USDT0 borrow — E1) ===');
  await probe('ISO Comptroller', envAddr('KINETIC_ISO_COMPTROLLER'), COMPTROLLER, async (c) => {
    await tryCall('getAllMarkets()', () => c.getAllMarkets(), (v) => v.join(', '));
  });
  await probe('kFXRP_ISO', envAddr('KINETIC_KFXRP_ISO'), KTOKEN, async (c) => {
    await tryCall('underlying', () => c.underlying());
  });
  await probe('kUSDT0_ISO', envAddr('KINETIC_KUSDT0_ISO'), KTOKEN, async (c) => {
    await tryCall('underlying', () => c.underlying());
  });

  console.log('\n=== SPARKDEX (Uniswap V3 fork) ===');
  await probe('NFPM', envAddr('SPARKDEX_NFPM'), NFPM, async (c) => {
    await tryCall('factory()', () => c.factory());
  });
  await probe('Factory', envAddr('SPARKDEX_FACTORY'), [], null);
  await probe('Router', envAddr('SPARKDEX_ROUTER'), [], null);

  console.log('\n=== FXRP (FAssets ERC-20) ===');
  await probe('FXRP_TOKEN', envAddr('FXRP_TOKEN'), ERC20, async (c) => {
    await tryCall('symbol', () => c.symbol());
    await tryCall('decimals', () => c.decimals());
  });

  console.log('\n=== SCEPTRE (sFLR liquid staking — hardcoded addr in adapter) ===');
  await probe('sFLR', '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', SFLR, async (c) => {
    await tryCall('symbol', () => c.symbol());
    await tryCall('getPooledFlrByShares(1e18)', () => c.getPooledFlrByShares(10n ** 18n));
  });

  console.log('\n=== WFLR / WNAT (wrap + delegate — E2, hardcoded) ===');
  await probe('WNAT', '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', ERC20, async (c) => {
    await tryCall('symbol', () => c.symbol());
  });

  console.log('\n=== ENOSYS / FIRELIGHT (env-gated) ===');
  console.log(`  ENOSYS_ROUTER:   ${envAddr('ENOSYS_ROUTER') ?? '<env empty → adapter inactive>'}`);
  console.log(`  ENOSYS_FARMING:  ${envAddr('ENOSYS_FARMING') ?? '<env empty → adapter inactive>'}`);
  console.log(`  FIRELIGHT_STAKING: ${envAddr('FIRELIGHT_STAKING') ?? '<env empty → adapter inactive>'}`);
  console.log(`  FIRELIGHT_STXRP:   ${envAddr('FIRELIGHT_STXRP') ?? '<env empty → adapter inactive>'}`);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
