/**
 * ProtocolIntegrationService
 *
 * Integrates a new protocol into the CalldataBuilder execution registry.
 * Admin provides: DefiLlama slug + contract address + chainId.
 * Everything else is automatic: ABI fetch → action detection → DB persist → allowlist.
 *
 * INVARIANTS:
 *   - Astryum never calls sendTransaction — only builds calldata
 *   - authorization.defibroRelays: false on all resulting IntentPayloads
 *   - Detected actions use arg names matching CalldataBuilder._resolveArgs()
 */

import { prisma } from '../database/prismaClient';
import { addDynamicContractAddress } from '../config/allowlist.config';

// DefiLlama chain slug → Etherscan V2 chain name
const CHAIN_ID_TO_LLAMA: Record<number, string> = {
  1:      'ethereum',
  8453:   'base',
  42161:  'arbitrum',
  137:    'polygon',
  10:     'optimism',
  56:     'bsc',
  43114:  'avax',
  250:    'fantom',
  100:    'xdai',
  14:     'flare',
  296:    'hedera',
  50:     'xdc',
};

// Function name → actionType mapping (in priority order — more specific first)
// Args use the canonical CalldataBuilder resolver names
const FUNCTION_ACTION_MAP: Record<string, { actionType: string; defaultArgs: string[]; isPayable?: boolean }> = {
  'supply':                    { actionType: 'supply',         defaultArgs: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
  'borrow':                    { actionType: 'borrow',         defaultArgs: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
  'repay':                     { actionType: 'repay',          defaultArgs: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
  'withdraw':                  { actionType: 'withdraw',       defaultArgs: ['asset', 'amount', 'to'] },
  'redeem':                    { actionType: 'vault_withdraw', defaultArgs: ['shares', 'receiver', 'owner'] },
  'deposit':                   { actionType: 'vault_deposit',  defaultArgs: ['amount', 'receiver'] },
  'mint':                      { actionType: 'vault_deposit',  defaultArgs: ['amount', 'receiver'] },
  'stake':                     { actionType: 'stake',          defaultArgs: ['amount'] },
  'unstake':                   { actionType: 'unstake',        defaultArgs: ['amount'] },
  'submitForWithdrawal':       { actionType: 'unstake',        defaultArgs: ['_amounts', '_owner'] },
  'requestWithdrawals':        { actionType: 'unstake',        defaultArgs: ['_amounts', '_owner'] },
};

// Resolver names that CalldataBuilder._resolveArgs knows how to handle
const KNOWN_RESOLVER_NAMES = new Set([
  'asset', 'amount', 'assets', 'shares', 'onBehalfOf', 'onBehalf',
  'receiver', 'owner', 'to', 'referralCode', '_referral', '_amounts',
  '_owner', 'interestRateMode', 'data', 'marketParams',
]);

export interface AbiItem {
  type: string;
  name?: string;
  inputs?: Array<{ name: string; type: string; internalType?: string }>;
  outputs?: Array<{ name: string; type: string }>;
  stateMutability?: string;
}

export interface DetectedAction {
  actionType: string;
  fn: string;
  args: string[];
  isPayable: boolean;
}

export interface IntegrationResult {
  slug: string;
  chainId: number;
  address: string;
  abiSource: 'defillama' | 'etherscan' | 'none';
  detectedActions: Record<string, DetectedAction>;
  message: string;
}

export class ProtocolIntegrationService {

  async integrateProtocol(params: {
    defiLlamaSlug: string;
    contractAddress: string;
    chainId: number;
    feeType: 'referral_code' | 'referrer_address' | 'revenue_share' | 'none';
    referralValue?: string;
    cooldownDays?: number;
    addedBy?: string;
  }): Promise<IntegrationResult> {
    const { defiLlamaSlug, contractAddress, chainId, feeType, referralValue, cooldownDays, addedBy } = params;

    const chainName = CHAIN_ID_TO_LLAMA[chainId];

    // Step 1: Fetch ABI
    let abi: AbiItem[] = [];
    let abiSource: 'defillama' | 'etherscan' | 'none' = 'none';

    if (chainName) {
      const llamaAbi = await this.fetchABIFromDefiLlama(chainName, contractAddress);
      if (llamaAbi) {
        abi = llamaAbi;
        abiSource = 'defillama';
      }
    }

    if (!abi.length) {
      const esAbi = await this.fetchABIFromEtherscan(contractAddress, chainId);
      if (esAbi) {
        abi = esAbi;
        abiSource = 'etherscan';
      }
    }

    // Step 2: Detect actions
    const detectedActions = this.detectActions(abi);

    // Step 3: Persist + allowlist
    await this.persistAndAllowlist({
      slug: defiLlamaSlug,
      chainId,
      address: contractAddress,
      abi,
      actions: detectedActions,
      feeType,
      referralValue,
      cooldownDays,
      source: abiSource === 'none' ? 'manual' : abiSource,
      addedBy,
    });

    return {
      slug: defiLlamaSlug,
      chainId,
      address: contractAddress,
      abiSource,
      detectedActions,
      message: `Integrated "${defiLlamaSlug}" on chainId=${chainId}. Actions: ${Object.keys(detectedActions).join(', ') || 'none detected'}. ABI source: ${abiSource}.`,
    };
  }

  private async fetchABIFromDefiLlama(chainName: string, address: string): Promise<AbiItem[] | null> {
    try {
      const url = `https://api.llama.fi/fetch/contract/${chainName}/${address}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json() as { abi?: AbiItem[] };
      if (!Array.isArray(data.abi) || data.abi.length === 0) return null;
      return data.abi;
    } catch {
      return null;
    }
  }

  private async fetchABIFromEtherscan(address: string, chainId: number): Promise<AbiItem[] | null> {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) return null;
    try {
      const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getabi&address=${address}&apikey=${apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json() as { status: string; result: string };
      if (data.status !== '1' || !data.result) return null;
      const parsed = JSON.parse(data.result) as AbiItem[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  detectActions(abi: AbiItem[]): Record<string, DetectedAction> {
    const result: Record<string, DetectedAction> = {};

    for (const item of abi) {
      if (item.type !== 'function' || !item.name) continue;

      const mapping = FUNCTION_ACTION_MAP[item.name];
      if (!mapping) continue;

      // Build args: use actual ABI param names if they match known resolver names,
      // otherwise fall back to defaultArgs from the mapping.
      const actualParamNames = (item.inputs ?? []).map(i => i.name);
      const args = actualParamNames.length > 0 && actualParamNames.every(n => KNOWN_RESOLVER_NAMES.has(n))
        ? actualParamNames
        : mapping.defaultArgs;

      const isPayable = item.stateMutability === 'payable' || (mapping.isPayable ?? false);

      // Only add if this actionType is not already present (first match wins)
      if (!result[mapping.actionType]) {
        result[mapping.actionType] = {
          actionType: mapping.actionType,
          fn: item.name,
          args,
          isPayable,
        };
      }
    }

    return result;
  }

  private async persistAndAllowlist(params: {
    slug: string;
    chainId: number;
    address: string;
    abi: AbiItem[];
    actions: Record<string, DetectedAction>;
    feeType: string;
    referralValue?: string;
    cooldownDays?: number;
    source: string;
    addedBy?: string;
  }): Promise<void> {
    const { slug, chainId, address, abi, actions, feeType, referralValue, cooldownDays, source, addedBy } = params;

    await prisma.protocolContractRecord.upsert({
      where: { slug_chainId: { slug, chainId } },
      create: {
        id: `${slug}-${chainId}`,
        slug,
        chainId,
        address,
        abi: abi as never,
        actions: actions as never,
        feeType,
        referralValue: referralValue ?? null,
        cooldownDays: cooldownDays ?? null,
        source,
      },
      update: {
        address,
        abi: abi as never,
        actions: actions as never,
        feeType,
        referralValue: referralValue ?? null,
        cooldownDays: cooldownDays ?? null,
        source,
      },
    });

    // Immediately add to runtime allowlist so CalldataBuilder can use it
    addDynamicContractAddress(address);
  }

  async listIntegratedProtocols(): Promise<Array<{
    slug: string;
    chainId: number;
    address: string;
    actions: string[];
    feeType: string;
    source: string;
    addedAt: Date;
  }>> {
    const records = await prisma.protocolContractRecord.findMany({
      orderBy: { addedAt: 'desc' },
    });

    return records.map(r => ({
      slug: r.slug,
      chainId: r.chainId,
      address: r.address,
      actions: Object.keys((r.actions as Record<string, unknown>) ?? {}),
      feeType: r.feeType,
      source: r.source,
      addedAt: r.addedAt,
    }));
  }
}

export const protocolIntegrationService = new ProtocolIntegrationService();
