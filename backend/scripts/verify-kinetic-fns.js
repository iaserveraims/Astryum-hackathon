/* eslint-disable */
// Read-only: does the Kinetic ISO kToken (Compound-v2 fork) expose the function
// selectors A1 would need from an EXTERNAL EOA — especially repayBorrowBehalf
// (repay another account's debt, e.g. the Personal Account's borrow)?
// Reads the CErc20Delegator implementation() and greps its runtime bytecode for
// each 4-byte selector. NO signing.
//   node scripts/verify-kinetic-fns.js
const { ethers } = require('ethers');
const RPC = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';

const kUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const kFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';

const DELEGATOR_ABI = ['function implementation() view returns (address)'];

const SIGS = [
  'mint(uint256)',
  'borrow(uint256)',
  'repayBorrow(uint256)',
  'repayBorrowBehalf(address,uint256)', // ← the crux: external EOA repays PA's debt
  'redeem(uint256)',
  'redeemUnderlying(uint256)',
  'liquidateBorrow(address,uint256,address)',
  'borrowBalanceCurrent(address)',
  'borrowBalanceStored(address)',
];

async function implOf(provider, addr) {
  try {
    const d = new ethers.Contract(addr, DELEGATOR_ABI, provider);
    return await d.implementation();
  } catch (e) {
    return null; // not a delegator / no implementation()
  }
}

async function checkSelectors(provider, label, addr) {
  const impl = await implOf(provider, addr);
  const codeAddr = impl && impl !== ethers.ZeroAddress ? impl : addr;
  const code = (await provider.getCode(codeAddr)).toLowerCase();
  console.log(`\n${label}: ${addr}`);
  console.log(`  implementation(): ${impl || '<none / not a delegator>'}`);
  console.log(`  bytecode scanned: ${codeAddr} (${(code.length - 2) / 2} bytes)`);
  for (const sig of SIGS) {
    const sel = ethers.id(sig).slice(2, 10); // 4-byte selector hex (no 0x)
    const present = code.includes(sel);
    console.log(`    ${present ? '✓' : '✗'} ${sig}  [0x${sel}]`);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, { name: 'flare', chainId: 14 }, { staticNetwork: true });
  await checkSelectors(provider, 'kUSDT0 ISO (borrow market — repay here)', kUSDT0_ISO);
  await checkSelectors(provider, 'kFXRP ISO (collateral market)', kFXRP_ISO);

  // Comptroller getAccountLiquidity = the HF read (4.5). Confirm it's a live view.
  console.log('\nISO comptroller getAccountLiquidity (HF read, 4.5):');
  const comp = new ethers.Contract(
    ISO_COMPTROLLER,
    ['function getAccountLiquidity(address) view returns (uint256,uint256,uint256)'],
    provider,
  );
  const dead = '0x000000000000000000000000000000000000dEaD';
  const r = await comp.getAccountLiquidity(dead);
  console.log(`  getAccountLiquidity(dead) → err=${r[0]} liquidity=${r[1]} shortfall=${r[2]} (selector live, anyone can read)`);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
