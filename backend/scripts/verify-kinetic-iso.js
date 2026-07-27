/* eslint-disable */
// Read-only mainnet verification for the Kinetic ISO market FXRP-USDT0 (F3).
// Confirms the three "reality" risks before wiring the borrow batch:
//   1. USDT0 borrow liquidity available (getCash on kUSDT0 ISO)
//   2. collateralFactorMantissa of kFXRP ISO (live, for the borrow/trigger math)
//   3. borrow cap / pause guardians (a cap near its ceiling reverts the borrow)
// NO signing, NO broadcast — pure view calls.
//
//   node backend/scripts/verify-kinetic-iso.js
const { ethers } = require('ethers');

const RPC = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const USDT0_EXPECTED = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D';
const FXRP_EXPECTED = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';

const CTOKEN_ABI = [
  'function getCash() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function totalReserves() view returns (uint256)',
  'function underlying() view returns (address)',
  'function symbol() view returns (string)',
];
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const COMPTROLLER_ABI = [
  'function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)',
  'function borrowCaps(address) view returns (uint256)',
  'function borrowGuardianPaused(address) view returns (bool)',
  'function mintGuardianPaused(address) view returns (bool)',
];

const MANTISSA = 1e18;

async function tryCall(label, fn, fmt) {
  try {
    const v = await fn();
    console.log(`  ${label}: ${fmt ? fmt(v) : v}`);
    return v;
  } catch (e) {
    console.log(`  ${label}: <n/a: ${e.shortMessage || e.message}>`);
    return undefined;
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, { name: 'flare', chainId: 14 }, { staticNetwork: true });
  const comptroller = new ethers.Contract(ISO_COMPTROLLER, COMPTROLLER_ABI, provider);
  const kUsdt0 = new ethers.Contract(KUSDT0_ISO, CTOKEN_ABI, provider);
  const kFxrp = new ethers.Contract(KFXRP_ISO, CTOKEN_ABI, provider);

  console.log('ISO comptroller:', ISO_COMPTROLLER);

  // --- underlying sanity ---
  console.log('\n--- underlying cross-check ---');
  const usdt0Underlying = await tryCall('kUSDT0_ISO.underlying()', () => kUsdt0.underlying());
  const fxrpUnderlying = await tryCall('kFXRP_ISO.underlying()', () => kFxrp.underlying());
  if (usdt0Underlying) console.log(`    USDT0 match: ${usdt0Underlying.toLowerCase() === USDT0_EXPECTED.toLowerCase()}`);
  if (fxrpUnderlying) console.log(`    FXRP match:  ${fxrpUnderlying && fxrpUnderlying.toLowerCase() === FXRP_EXPECTED.toLowerCase()}`);

  let usdt0Dec = 6;
  if (usdt0Underlying) {
    const erc = new ethers.Contract(usdt0Underlying, ERC20_ABI, provider);
    usdt0Dec = Number(await erc.decimals().catch(() => 6));
    console.log(`    USDT0 decimals: ${usdt0Dec}`);
  }
  const U = 10 ** usdt0Dec;

  // --- (1) USDT0 borrow liquidity ---
  console.log('\n--- (1) USDT0 borrow liquidity (kUSDT0 ISO) ---');
  const cash = await tryCall('getCash() [available to borrow]', () => kUsdt0.getCash(), (v) => `${v} (${Number(v) / U} USDT0)`);
  await tryCall('totalBorrows()', () => kUsdt0.totalBorrows(), (v) => `${v} (${Number(v) / U} USDT0)`);
  await tryCall('totalReserves()', () => kUsdt0.totalReserves(), (v) => `${v} (${Number(v) / U} USDT0)`);

  // --- (2) collateral factor of kFXRP ISO ---
  console.log('\n--- (2) kFXRP ISO collateral factor ---');
  await tryCall('markets(kFXRP_ISO)', () => comptroller.markets(KFXRP_ISO), (v) => `isListed=${v[0]} CF=${Number(v[1]) / MANTISSA}`);
  await tryCall('markets(kUSDT0_ISO)', () => comptroller.markets(KUSDT0_ISO), (v) => `isListed=${v[0]} CF=${Number(v[1]) / MANTISSA}`);

  // --- (3) caps + pause guardians ---
  console.log('\n--- (3) caps + pause guardians (kUSDT0 ISO borrow) ---');
  const cap = await tryCall('borrowCaps(kUSDT0_ISO)', () => comptroller.borrowCaps(KUSDT0_ISO), (v) => `${v}${v === 0n ? ' (0 = no cap)' : ` (${Number(v) / U} USDT0)`}`);
  await tryCall('borrowGuardianPaused(kUSDT0_ISO)', () => comptroller.borrowGuardianPaused(KUSDT0_ISO));
  await tryCall('mintGuardianPaused(kFXRP_ISO)', () => comptroller.mintGuardianPaused(KFXRP_ISO));

  // --- headroom summary ---
  if (cash !== undefined) {
    let headroom = Number(cash) / U;
    if (cap !== undefined && cap > 0n) {
      // borrowable ≈ min(cash, cap - totalBorrows); approximate with cash vs cap
      headroom = Math.min(headroom, Number(cap) / U);
    }
    console.log(`\n>>> Borrowable USDT0 headroom (approx): ${headroom} USDT0`);
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
