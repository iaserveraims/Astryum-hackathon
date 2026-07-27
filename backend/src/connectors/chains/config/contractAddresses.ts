/**
 * Protocol Contract Addresses Registry
 *
 * Centralized repository of all smart contract addresses for DeFi protocols
 * across different blockchain networks.
 *
 * ARCHIVED 2026-02-02: Non-Flare contract addresses archived during Flare-exclusive migration.
 * Full backup available in: _archived/2026-02-02-pre-flare-migration/config/contractAddresses.ts.full-backup
 *
 * IMPORTANT: These addresses MUST be verified before use in production!
 * All addresses marked with [USER_TO_PROVIDE] need to be filled in by the user.
 *
 * @module contractAddresses
 */

import { CHAIN_IDS } from './chainConfigs';

/**
 * Protocol identifier type
 * ARCHIVED 2026-02-02: Legacy protocols removed (strobe-finance, tapp-exchange, axelar, layerzero, etc.)
 */
export type ProtocolId =
  | 'flare-finance'
  | 'sparkdex'
  | 'squid-router';

/**
 * Contract address mapping for a protocol on a specific chain
 */
export interface ProtocolContracts {
  /** Main protocol contract or router */
  main?: string;

  /** Factory contract (for DEXs) */
  factory?: string;

  /** Router contract (for DEXs/aggregators) */
  router?: string;

  /** Lending pool contract */
  lendingPool?: string;

  /** LP staking/farming contract */
  farming?: string;

  /** Governance contract */
  governance?: string;

  /** Additional protocol-specific contracts */
  [key: string]: string | undefined;
}

/**
 * All protocol contract addresses organized by chain and protocol
 * FLARE-EXCLUSIVE: Only Flare and Songbird networks supported
 */
export const CONTRACT_ADDRESSES: Record<string, Record<ProtocolId, Partial<ProtocolContracts>>> = {

  // ============================================
  // FLARE NETWORK
  // ============================================
  [CHAIN_IDS.FLARE]: {
    'flare-finance': {
      main: '[USER_TO_PROVIDE]',
      lendingPool: '[USER_TO_PROVIDE - Flare Finance Lending Pool]',
      router: '[USER_TO_PROVIDE - Flare Finance Router if DEX features]'
    },
    'sparkdex': {
      router: '[USER_TO_PROVIDE - SparkDex Router]',
      factory: '[USER_TO_PROVIDE - SparkDex Factory]',
      farming: '[USER_TO_PROVIDE - SparkDex Farming Contract]'
    },
    'squid-router': {
      main: '[USER_TO_PROVIDE - Squid Flare Integration]'
    }
  },

  // ============================================
  // SONGBIRD NETWORK
  // ============================================
  [CHAIN_IDS.SONGBIRD]: {
    'flare-finance': {
      main: '[USER_TO_PROVIDE]',
      lendingPool: '[USER_TO_PROVIDE - Flare Finance Lending Pool]',
      router: '[USER_TO_PROVIDE - Flare Finance Router if DEX features]'
    },
    'sparkdex': {
      router: '[USER_TO_PROVIDE - SparkDex Router]',
      factory: '[USER_TO_PROVIDE - SparkDex Factory]',
      farming: '[USER_TO_PROVIDE - SparkDex Farming Contract]'
    },
    'squid-router': {
      main: '[USER_TO_PROVIDE - Squid Songbird Integration]'
    }
  }

};

/**
 * Get contract addresses for a protocol on a specific chain
 */
export function getProtocolContracts(chainId: string, protocolId: ProtocolId): Partial<ProtocolContracts> {
  return CONTRACT_ADDRESSES[chainId]?.[protocolId] || {};
}

/**
 * Get main contract address for a protocol on a specific chain
 */
export function getMainContractAddress(chainId: string, protocolId: ProtocolId): string | undefined {
  return CONTRACT_ADDRESSES[chainId]?.[protocolId]?.main;
}

/**
 * Check if a protocol has contract addresses on a chain
 */
export function hasProtocolContracts(chainId: string, protocolId: ProtocolId): boolean {
  const contracts = CONTRACT_ADDRESSES[chainId]?.[protocolId];
  return contracts !== undefined && Object.keys(contracts).length > 0;
}

/**
 * Get all protocols available on a chain
 */
export function getChainProtocols(chainId: string): ProtocolId[] {
  if (!CONTRACT_ADDRESSES[chainId]) return [];

  return (Object.keys(CONTRACT_ADDRESSES[chainId]) as ProtocolId[]).filter(
    protocolId => hasProtocolContracts(chainId, protocolId)
  );
}

/**
 * Validate contract address format (EVM address)
 */
export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if address is a placeholder
 */
export function isPlaceholderAddress(address: string | undefined): boolean {
  if (!address) return true;
  return address.includes('[USER_TO_PROVIDE]') || address === '';
}
