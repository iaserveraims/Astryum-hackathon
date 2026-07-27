/**
 * Allowlist Configuration for Astryum Private Beta
 *
 * SECURITY CRITICAL:
 * - ONLY wallets listed here can be monitored
 * - ONLY contracts listed here can be interacted with
 * - ONLY actions listed here are permitted
 *
 * Any operation outside this allowlist will be REJECTED
 *
 * Protocol contracts from PROTOCOL_CONTRACTS registry are loaded at the bottom
 * of this file and added to the static allowlist automatically.
 */

export interface AllowlistConfig {
  // Wallets allowed to be monitored (owner's wallets)
  wallets: string[];

  // Contracts allowed to be called, organized by protocol
  contracts: {
    [protocol: string]: {
      [contractName: string]: string;
    };
  };

  // Actions that are permitted
  actions: string[];

  // Tokens that can be used
  tokens: {
    [symbol: string]: string;
  };
}

/**
 * Main Allowlist Configuration
 *
 * IMPORTANT: Add your wallet addresses here before using Astryum
 */
export const ALLOWLIST: AllowlistConfig = {
  // ============================================
  // WALLETS - Add your wallet addresses here
  // ============================================
  wallets: [
    '0xeabcd745598916b0131ece397c8d6a332088462c',
    '0xc8be83f3ab02b35ddb5e5856c687240aa32ee23f',
  ],

  // ============================================
  // CONTRACTS - Protocol contracts on Flare Mainnet
  // ============================================
  contracts: {
    // Flare System Contracts
    flareSystem: {
      priceSubmitter: '0x1000000000000000000000000000000000000003',
      ftsoManager: '0x1000000000000000000000000000000000000005',
      ftsoRegistry: '0x1000000000000000000000000000000000000006',
      wNat: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
    },

    // Flare Finance Protocol
    // TODO: Add real contract addresses when available
    flareFinance: {
      lendingPool: '',
      priceOracle: '',
      dataProvider: '',
    },

    // SparkDEX Protocol (Uniswap V3 fork on Flare) — verified 2026-05-23
    sparkdex: {
      nfpm:    process.env.SPARKDEX_NFPM    || '0xEE5FF5Bc5F852764b5584d92A4d592A53DC527da',
      factory: process.env.SPARKDEX_FACTORY || '0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652',
      router:  process.env.SPARKDEX_ROUTER  || '0x8a1E35F5c98C4E85B36B7B253222eE17773b2781',
      quoter:  process.env.SPARKDEX_QUOTER  || '0x5B5513c55fd06e2658010c121c37b07fC8e8B705',
      v2Factory: '0x16b619B04c961E8f4F06C10B42FDAbb328980A89',
      v2Router:  '0x4a1E5A90e9943467FAd1acea1E7F0e5e88472a1e',
    },

    // Kinetic Market (lending, Compound-V2 fork on Flare)
    // Populated at runtime from env vars: KINETIC_COMPTROLLER, KINETIC_LENS
    // See docs/protocols/KINETIC_FLARE.md
    kinetic: {
      comptroller: process.env.KINETIC_COMPTROLLER || '',
      lens: process.env.KINETIC_LENS || '',
    },

    // Firelight (XRP liquid staking on Flare)
    // Populated from env: FIRELIGHT_STAKING, FIRELIGHT_STXRP
    firelight: {
      staking: process.env.FIRELIGHT_STAKING || '',
      stXRP: process.env.FIRELIGHT_STXRP || '',
    },
  },

  // ============================================
  // ACTIONS - Permitted operations
  // ============================================
  actions: [
    // Lending actions
    'deposit',
    'withdraw',
    'borrow',
    'repay',

    // LP actions
    'addLiquidity',
    'removeLiquidity',

    // Trading actions
    'swap',

    // Token actions
    'approve',
    'transfer',

    // View actions (always allowed)
    'balanceOf',
    'allowance',
    'getReserves',
    'getAmountsOut',
  ],

  // ============================================
  // TOKENS - Allowed tokens on Flare Mainnet
  // ============================================
  tokens: {
    // Native wrapped token
    WFLR:  '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
    // Verified Flare token addresses (2026-05-23)
    USDCE: process.env.USDCE_TOKEN       || '0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6',
    USDT:  process.env.USDT_FLARE_TOKEN  || '0x0B38e83B86d491735fEaa0a791F65c2B99535396',
    SFLR:  process.env.SFLR_TOKEN        || '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
    WETH:  '0x1502FA4be69d526124D453619276FacCab275d3D',
    FLRETH:'0x26A1faB310bd080542DC864647d05985360B16A5',
    // Kinetic reward token
    JOULE: '0xE6505f92583103AF7ed9974DEC451A7Af4e3A3bE',
    // FAssets
    FXRP:  process.env.FXRP_TOKEN || '',  // pending — verify at flarescan.com
  },
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Check if a wallet address is in the allowlist
 */
export function isWalletAllowed(wallet: string): boolean {
  if (!wallet) return false;

  const normalizedWallet = wallet.toLowerCase();
  return ALLOWLIST.wallets.some(
    w => w.toLowerCase() === normalizedWallet
  );
}

/**
 * Runtime additions per protocol — populated by their `verify-<protocol>` script.
 * Each script writes a `<slug>.runtime.json` with a list of contract addresses.
 * Files are optional; if missing, that protocol contributes nothing to the
 * runtime allowlist and the corresponding adapter stays inactive.
 */
let RUNTIME_CONTRACTS: Set<string> | null = null;

function tryLoad(file: string): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(file);
  } catch {
    return null;
  }
}

function addAddressesFromKineticJson(set: Set<string>): void {
  const data = tryLoad('./kinetic.runtime.json');
  if (!data) return;
  if (typeof data.comptroller === 'string') set.add(data.comptroller.toLowerCase());
  // ISO market has its own comptroller (E1: supply FXRP + borrow USDT0).
  if (typeof data.isoComptroller === 'string') set.add(data.isoComptroller.toLowerCase());
  const cTokens = data.cTokens as { address: string; underlying?: string; isoComptroller?: string }[] | undefined;
  for (const t of cTokens ?? []) {
    set.add(t.address.toLowerCase());
    // Per-cToken ISO comptroller (belt-and-suspenders vs top-level field).
    if (typeof t.isoComptroller === 'string') set.add(t.isoComptroller.toLowerCase());
    // Underlying ERC-20 is a legitimate approve target for supply/repay (e.g.
    // FXRP for the E1 batch `approve(kFXRP_ISO, …)`). Skip the native sentinel.
    if (
      typeof t.underlying === 'string' &&
      t.underlying !== '0x0000000000000000000000000000000000000000'
    ) {
      set.add(t.underlying.toLowerCase());
    }
  }
}

function addAddressesFromSparkdexJson(set: Set<string>): void {
  const data = tryLoad('./sparkdex.runtime.json');
  if (!data) return;
  for (const k of ['nfpm', 'factory', 'router', 'quoter']) {
    const v = data[k];
    if (typeof v === 'string') set.add(v.toLowerCase());
  }
  const pools = data.pools as { address: string }[] | undefined;
  for (const p of pools ?? []) set.add(p.address.toLowerCase());
}

function addAddressesFromEnosysJson(set: Set<string>): void {
  const data = tryLoad('./enosys.runtime.json');
  if (!data) return;
  for (const k of ['router', 'factory', 'farming', 'poolManager', 'rewardContract', 'lendingPool']) {
    const v = data[k];
    if (typeof v === 'string') set.add(v.toLowerCase());
  }
  const pools = data.pools as { address: string }[] | undefined;
  for (const p of pools ?? []) set.add(p.address.toLowerCase());
}

function addAddressesFromFirelightJson(set: Set<string>): void {
  const data = tryLoad('./firelight.runtime.json');
  if (!data) return;
  for (const k of ['staking', 'stXRP']) {
    const v = data[k];
    if (typeof v === 'string') set.add(v.toLowerCase());
  }
}

function loadRuntimeContracts(): Set<string> {
  if (RUNTIME_CONTRACTS) return RUNTIME_CONTRACTS;
  const set = new Set<string>();
  addAddressesFromKineticJson(set);
  addAddressesFromSparkdexJson(set);
  addAddressesFromEnosysJson(set);
  addAddressesFromFirelightJson(set);
  RUNTIME_CONTRACTS = set;
  return set;
}

/** Force reload of runtime allowlist (e.g. after `verify-*` script runs). */
export function refreshRuntimeAllowlist(): void {
  RUNTIME_CONTRACTS = null;
  loadRuntimeContracts();
}

/** Add a single contract address to the runtime allowlist immediately (e.g. from ProtocolIntegrationService). */
export function addDynamicContractAddress(address: string): void {
  if (!address) return;
  const set = loadRuntimeContracts();
  set.add(address.toLowerCase());
}

/**
 * Check if a contract address is in the allowlist (static + runtime).
 */
export function isContractAllowed(address: string): boolean {
  if (!address) return false;

  const normalizedAddress = address.toLowerCase();

  for (const protocol of Object.values(ALLOWLIST.contracts)) {
    for (const contractAddress of Object.values(protocol)) {
      if (contractAddress && contractAddress.toLowerCase() === normalizedAddress) {
        return true;
      }
    }
  }

  // Runtime additions (e.g. Kinetic cTokens enumerated by verify-kinetic)
  if (loadRuntimeContracts().has(normalizedAddress)) return true;

  return false;
}

/**
 * Check if an action is in the allowlist
 */
export function isActionAllowed(action: string): boolean {
  if (!action) return false;
  return ALLOWLIST.actions.includes(action);
}

/**
 * Check if a token address is in the allowlist
 */
export function isTokenAllowed(address: string): boolean {
  if (!address) return false;

  const normalizedAddress = address.toLowerCase();
  return Object.values(ALLOWLIST.tokens).some(
    t => t && t.toLowerCase() === normalizedAddress
  );
}

/**
 * Get protocol name for a contract address
 */
export function getProtocolForContract(address: string): string | null {
  if (!address) return null;

  const normalizedAddress = address.toLowerCase();

  for (const [protocolName, contracts] of Object.entries(ALLOWLIST.contracts)) {
    for (const contractAddress of Object.values(contracts)) {
      if (contractAddress && contractAddress.toLowerCase() === normalizedAddress) {
        return protocolName;
      }
    }
  }

  return null;
}

/**
 * Validate a complete operation
 */
export interface OperationValidation {
  wallet: string;
  targetContract: string;
  action: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateOperation(operation: OperationValidation): ValidationResult {
  const errors: string[] = [];

  if (!isWalletAllowed(operation.wallet)) {
    errors.push(`Wallet ${operation.wallet} is not in the allowlist`);
  }

  if (!isContractAllowed(operation.targetContract)) {
    errors.push(`Contract ${operation.targetContract} is not in the allowlist`);
  }

  if (!isActionAllowed(operation.action)) {
    errors.push(`Action "${operation.action}" is not permitted`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Add a wallet to the allowlist (runtime only, not persisted)
 */
export function addWalletToAllowlist(wallet: string): boolean {
  if (!wallet || isWalletAllowed(wallet)) {
    return false;
  }

  ALLOWLIST.wallets.push(wallet.toLowerCase());
  console.log(`[Allowlist] Added wallet to allowlist: ${wallet}`);
  return true;
}

/**
 * Remove a wallet from the allowlist (runtime only)
 */
export function removeWalletFromAllowlist(wallet: string): boolean {
  const normalizedWallet = wallet.toLowerCase();
  const index = ALLOWLIST.wallets.findIndex(
    w => w.toLowerCase() === normalizedWallet
  );

  if (index === -1) {
    return false;
  }

  ALLOWLIST.wallets.splice(index, 1);
  console.log(`[Allowlist] Removed wallet from allowlist: ${wallet}`);
  return true;
}

// ============================================
// PROTOCOL REGISTRY CONTRACTS (V2 CalldataBuilder)
// Auto-populated from protocolContracts.ts — do not edit manually.
// To add a protocol: add it to protocolContracts.ts and it appears here.
// ============================================

(function seedProtocolRegistryContracts() {
  // Lazy import to avoid circular deps at module load time
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllStaticPoolAddresses } = require('./protocolContracts') as {
      getAllStaticPoolAddresses: () => string[];
    };
    const addresses = getAllStaticPoolAddresses();
    for (const addr of addresses) {
      if (!ALLOWLIST.contracts['protocolRegistry']) {
        ALLOWLIST.contracts['protocolRegistry'] = {};
      }
      // key by lowercased address so isContractAllowed loop finds it
      ALLOWLIST.contracts['protocolRegistry'][addr] = addr;
    }
  } catch {
    // protocolContracts not available (e.g. test environments)
  }
})();

export default {
  ALLOWLIST,
  isWalletAllowed,
  isContractAllowed,
  isActionAllowed,
  isTokenAllowed,
  getProtocolForContract,
  validateOperation,
  addWalletToAllowlist,
  removeWalletFromAllowlist,
};
