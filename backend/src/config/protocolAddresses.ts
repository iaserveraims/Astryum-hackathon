import { z } from 'zod';

const evmAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be 0x-prefixed 40-char hex');

function readAddress(envKey: string): string | undefined {
  const raw = process.env[envKey];
  if (!raw) return undefined;
  const parsed = evmAddress.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(
      `[protocolAddresses] ${envKey}=${raw} invalid: ${parsed.error.issues[0]?.message}`
    );
    return undefined;
  }
  return parsed.data;
}

export interface KineticAddresses {
  comptroller?: string;
  lens?: string;
  /** ISO market FXRP-USDT0-STFXRP (isolated) — separate comptroller + kTokens.
   *  These are DISTINCT contracts from the primary market (e.g. kUSDT0 ISO ≠
   *  kUSDT0 primary). E1 supplies FXRP + borrows USDT0 here. */
  isoComptroller?: string;
  isoKFxrp?: string;
  isoKUsdt0?: string;
}

export interface SparkDexAddresses {
  nfpm?: string;
  factory?: string;
  router?: string;
}

export interface FirelightAddresses {
  staking?: string;
  stXRP?: string;
}

export interface EnosysAddresses {
  router?: string;
  factory?: string;
  farming?: string;
  poolManager?: string;
  rewardContract?: string;
  lendingPool?: string;
}

export interface FxrpAddresses {
  token?: string;
}

/** Upshift (August Digital) multiAssetVault v2 vaults on Flare. The vault
 *  contract is NOT the ERC-20 — each vault has a separate receipt (LP) token
 *  read via `lpTokenAddress()`. Both resolved+verified on-chain 2026-07-10:
 *  asset() == FXRP, sendersWhitelistAddress() == 0x0 (permissionless). */
export interface UpshiftAddresses {
  /** "Flare XRP Yield Vault" — receipt token earnXRP. Curated by Clearstar. */
  earnXrpVault?: string;
  earnXrpToken?: string;
  /** "Monarq XRP Yield Vault" — receipt token MXRPY. Off-chain strategies
   *  (CeDeFi risk profile) — deposit route additionally gated by
   *  UPSHIFT_MONARQ_ENABLED. */
  monarqVault?: string;
  monarqToken?: string;
}

export interface ProtocolAddresses {
  kinetic: KineticAddresses;
  sparkdex: SparkDexAddresses;
  firelight: FirelightAddresses;
  enosys: EnosysAddresses;
  fxrp: FxrpAddresses;
  upshift: UpshiftAddresses;
}

let cached: ProtocolAddresses | null = null;

export function getProtocolAddresses(): ProtocolAddresses {
  if (cached) return cached;
  cached = {
    kinetic: {
      comptroller: readAddress('KINETIC_COMPTROLLER'),
      lens: readAddress('KINETIC_LENS'),
      isoComptroller: readAddress('KINETIC_ISO_COMPTROLLER'),
      isoKFxrp: readAddress('KINETIC_KFXRP_ISO'),
      isoKUsdt0: readAddress('KINETIC_KUSDT0_ISO'),
    },
    sparkdex: {
      nfpm: readAddress('SPARKDEX_NFPM'),
      factory: readAddress('SPARKDEX_FACTORY'),
      router: readAddress('SPARKDEX_ROUTER'),
    },
    firelight: {
      staking: readAddress('FIRELIGHT_STAKING'),
      stXRP: readAddress('FIRELIGHT_STXRP'),
    },
    enosys: {
      router: readAddress('ENOSYS_ROUTER'),
      factory: readAddress('ENOSYS_FACTORY'),
      farming: readAddress('ENOSYS_FARMING'),
      poolManager: readAddress('ENOSYS_POOL_MANAGER'),
      rewardContract: readAddress('ENOSYS_REWARD_CONTRACT'),
      lendingPool: readAddress('ENOSYS_LENDING_POOL'),
    },
    fxrp: {
      token: readAddress('FXRP_TOKEN'),
    },
    upshift: {
      earnXrpVault: readAddress('UPSHIFT_EARNXRP_VAULT'),
      earnXrpToken: readAddress('UPSHIFT_EARNXRP_TOKEN'),
      monarqVault: readAddress('UPSHIFT_MONARQ_VAULT'),
      monarqToken: readAddress('UPSHIFT_MONARQ_TOKEN'),
    },
  };

  // Log inactive protocols once at boot
  for (const [slug, addrs] of Object.entries(cached)) {
    const allSet = Object.values(addrs).every((v) => !!v);
    if (!allSet) {
      // eslint-disable-next-line no-console
      console.log(
        `[protocolAddresses] protocol.${slug}.inactive — missing env addresses`
      );
    }
  }

  return cached;
}

export function resetAddressCache(): void {
  cached = null;
}
