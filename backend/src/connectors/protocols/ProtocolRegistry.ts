/**
 * Protocol Registry
 * Central registry for all protocol connectors with dynamic discovery
 *
 * ARCHIVED 2026-02-02: Non-Flare protocol imports removed during Flare-exclusive migration
 * Removed: StrobeFinanceConnector, TappExchangeConnector (and related bridge/multi-chain connectors)
 * Archived protocols can be found in: _archived/2026-02-02-pre-flare-migration/connectors/protocols/
 */

import { BaseProtocolConnector } from '../base/BaseProtocolConnector';
import type { IProtocolAdapter } from './IProtocolAdapter';
// TODO: Fix SparkDex and SquidRouter connector compatibility issues
// import { SparkDexConnector } from './SparkDexConnector';
// import { SquidRouterConnector } from './SquidRouterConnector';
import { getProtocolContracts, hasProtocolContracts } from '../chains/config/contractAddresses';
import { getChainConfig, ChainConfig } from '../chains/config/chainConfigs';

export interface ProtocolMetadata {
  id: string;
  name: string;
  description: string;
  chains: string[];
  operations: string[];
  connectorClass: new (...args: any[]) => BaseProtocolConnector;
  version: string;
  category: 'lending' | 'dex' | 'bridge' | 'yield' | 'staking' | 'derivatives' | 'other';
  tags: string[];
  requiresApiKey?: boolean;
  documentationUrl?: string;
}

/**
 * Protocol Registry Class
 * FLARE-EXCLUSIVE: Only registers Flare Network protocols
 */
export class ProtocolRegistry {
  private static instance: ProtocolRegistry;
  private protocols: Map<string, ProtocolMetadata> = new Map();
  private connectorCache: Map<string, BaseProtocolConnector> = new Map();
  private adapters: Map<string, IProtocolAdapter> = new Map();

  private constructor() {
    this.registerAllProtocols();
  }

  /**
   * Singleton instance
   */
  public static getInstance(): ProtocolRegistry {
    if (!ProtocolRegistry.instance) {
      ProtocolRegistry.instance = new ProtocolRegistry();
    }
    return ProtocolRegistry.instance;
  }

  /**
   * Register all available protocols
   * FLARE-EXCLUSIVE: Only Flare Network protocols are registered
   */
  private registerAllProtocols(): void {
    // Flare Finance (Flare Lending) — RELIC RETIRADO 2026-07-23 (R6): el conector se
    // archivó en docs/archive/FlareFinanceConnector.ts (getSigner custodial, muerto,
    // ya neutralizado por bootGuards). No se registra: no hay conector vivo para este id.

    // TODO: SparkDex and SquidRouter connectors disabled temporarily
    // Need to fix BaseProtocolConnector compatibility issues
    // SparkDex (Flare DEX)
    // this.register({
    //   id: 'sparkdex',
    //   name: 'SparkDex',
    //   description: 'AMM-based DEX on Flare Network',
    //   chains: ['flare', 'songbird'],
    //   operations: ['swap', 'addLiquidity', 'removeLiquidity', 'stakeLPTokens', 'unstakeLPTokens'],
    //   connectorClass: SparkDexConnector,
    //   version: '1.0.0',
    //   category: 'dex',
    //   tags: ['flare', 'dex', 'amm', 'farming'],
    //   documentationUrl: 'https://sparkdex.io'
    // });

    // Squid Router (Cross-chain Swap via Flare)
    // this.register({
    //   id: 'squid-router',
    //   name: 'Squid Router',
    //   description: 'Cross-chain swap aggregator integrated with Flare',
    //   chains: ['flare', 'songbird'],
    //   operations: ['crossChainSwap', 'getRoute', 'estimateFees', 'getBestRoute', 'getTransactionStatus'],
    //   connectorClass: SquidRouterConnector,
    //   version: '1.0.0',
    //   category: 'bridge',
    //   tags: ['cross-chain', 'swap', 'aggregator', 'flare'],
    //   requiresApiKey: true,
    //   documentationUrl: 'https://docs.squidrouter.com'
    // });

    // Archived 2026-02-02: The following protocols were removed:
    // - strobe-finance (XRPL direct, not via Flare)
    // - tapp-exchange (Aptos DEX)
    // - enosys (TBD protocol)
    // - kinetic (TBD protocol)
    // - firelight (TBD protocol)
  }

  /**
   * Register a protocol
   */
  public register(metadata: ProtocolMetadata): void {
    this.protocols.set(metadata.id, metadata);
  }

  /**
   * Unregister a protocol
   */
  public unregister(protocolId: string): boolean {
    // Clear from cache
    const cacheKeys = Array.from(this.connectorCache.keys()).filter(key => key.startsWith(`${protocolId}:`));
    cacheKeys.forEach(key => this.connectorCache.delete(key));

    return this.protocols.delete(protocolId);
  }

  /**
   * Get protocol metadata
   */
  public getProtocol(protocolId: string): ProtocolMetadata | undefined {
    return this.protocols.get(protocolId);
  }

  /**
   * Get all registered protocols
   */
  public getAllProtocols(): ProtocolMetadata[] {
    return Array.from(this.protocols.values());
  }

  /**
   * Get protocols by chain
   */
  public getProtocolsByChain(chainId: string): ProtocolMetadata[] {
    return Array.from(this.protocols.values()).filter(protocol =>
      protocol.chains.includes(chainId)
    );
  }

  /**
   * Get protocols by category
   */
  public getProtocolsByCategory(category: string): ProtocolMetadata[] {
    return Array.from(this.protocols.values()).filter(protocol =>
      protocol.category === category
    );
  }

  /**
   * Get protocols by operation
   */
  public getProtocolsByOperation(operation: string): ProtocolMetadata[] {
    return Array.from(this.protocols.values()).filter(protocol =>
      protocol.operations.includes(operation)
    );
  }

  /**
   * Check if protocol is deployed on chain
   */
  public isDeployed(protocolId: string, chainId: string): boolean {
    return hasProtocolContracts(chainId, protocolId as any);
  }

  /**
   * Get connector instance (cached)
   */
  public getConnector(protocolId: string, chainId: string): BaseProtocolConnector | null {
    const cacheKey = `${protocolId}:${chainId}`;

    // Check cache
    if (this.connectorCache.has(cacheKey)) {
      return this.connectorCache.get(cacheKey)!;
    }

    // Get protocol metadata
    const protocol = this.protocols.get(protocolId);
    if (!protocol) {
      console.error(`Protocol not found: ${protocolId}`);
      return null;
    }

    // Check if protocol supports this chain
    if (!protocol.chains.includes(chainId)) {
      console.error(`Protocol ${protocolId} not supported on chain ${chainId}`);
      return null;
    }

    // Get chain config
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      console.error(`Chain config not found: ${chainId}`);
      return null;
    }

    // Get contract addresses
    const addresses = getProtocolContracts(chainId, protocolId as any);
    if (!addresses || Object.keys(addresses).length === 0) {
      console.error(`Contract addresses not configured for ${protocolId} on ${chainId}`);
      return null;
    }

    // Create connector instance
    try {
      const connector = new protocol.connectorClass(protocolId, chainId);
      this.connectorCache.set(cacheKey, connector);
      return connector;
    } catch (error) {
      console.error(`Error creating connector for ${protocolId} on ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Get all available connectors for a chain
   */
  public getConnectorsForChain(chainId: string): BaseProtocolConnector[] {
    const protocols = this.getProtocolsByChain(chainId);
    const connectors: BaseProtocolConnector[] = [];

    for (const protocol of protocols) {
      const connector = this.getConnector(protocol.id, chainId);
      if (connector) {
        connectors.push(connector);
      }
    }

    return connectors;
  }

  /**
   * Search protocols by tag
   */
  public searchByTag(tag: string): ProtocolMetadata[] {
    return Array.from(this.protocols.values()).filter(protocol =>
      protocol.tags.includes(tag.toLowerCase())
    );
  }

  /**
   * Get protocol statistics
   */
  public getStats(): {
    totalProtocols: number;
    byCategory: Record<string, number>;
    byChain: Record<string, number>;
    implemented: number;
    pending: number;
  } {
    const protocols = this.getAllProtocols();

    const byCategory: Record<string, number> = {};
    const byChain: Record<string, number> = {};
    let implemented = 0;

    for (const protocol of protocols) {
      // Count by category
      byCategory[protocol.category] = (byCategory[protocol.category] || 0) + 1;

      // Count by chain
      for (const chain of protocol.chains) {
        byChain[chain] = (byChain[chain] || 0) + 1;
      }

      // Count implemented
      if (protocol.version !== '0.0.0') {
        implemented++;
      }
    }

    return {
      totalProtocols: protocols.length,
      byCategory,
      byChain,
      implemented,
      pending: protocols.length - implemented
    };
  }

  /**
   * Validate all protocols have required configuration
   */
  public validateConfiguration(): {
    valid: boolean;
    errors: Array<{ protocolId: string; chainId: string; message: string }>;
  } {
    const errors: Array<{ protocolId: string; chainId: string; message: string }> = [];

    for (const protocol of this.protocols.values()) {
      for (const chainId of protocol.chains) {
        // Check if chain config exists
        const chainConfig = getChainConfig(chainId);
        if (!chainConfig) {
          errors.push({
            protocolId: protocol.id,
            chainId,
            message: `Chain configuration missing for ${chainId}`
          });
          continue;
        }

        // Check if protocol is deployed
        if (!this.isDeployed(protocol.id, chainId)) {
          errors.push({
            protocolId: protocol.id,
            chainId,
            message: `Contract addresses not configured`
          });
          continue;
        }

        // Check API key requirement
        if (protocol.requiresApiKey) {
          const apiKeyVar = `${protocol.id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
          if (!process.env[apiKeyVar]) {
            errors.push({
              protocolId: protocol.id,
              chainId,
              message: `Required API key ${apiKeyVar} not configured`
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Clear connector cache
   */
  public clearCache(): void {
    this.connectorCache.clear();
  }

  // ============================================================
  // Engine-facing IProtocolAdapter registry (Bloque 2)
  // ============================================================

  public registerAdapter(adapter: IProtocolAdapter): void {
    const key = `${adapter.chainId}:${adapter.protocolId}`;
    this.adapters.set(key, adapter);
  }

  public getAdapter(protocolId: string, chainId: number): IProtocolAdapter | null {
    return this.adapters.get(`${chainId}:${protocolId}`) ?? null;
  }

  public getAllAdapters(chainId: number): IProtocolAdapter[] {
    const out: IProtocolAdapter[] = [];
    for (const [key, adapter] of this.adapters.entries()) {
      if (key.startsWith(`${chainId}:`)) out.push(adapter);
    }
    return out;
  }

  public getActiveAdapters(chainId: number): IProtocolAdapter[] {
    return this.getAllAdapters(chainId).filter((a) => a.isActive);
  }

  /**
   * Clear cache for specific protocol
   */
  public clearProtocolCache(protocolId: string): void {
    const keys = Array.from(this.connectorCache.keys()).filter(key =>
      key.startsWith(`${protocolId}:`)
    );
    keys.forEach(key => this.connectorCache.delete(key));
  }
}

// Export singleton instance
export const protocolRegistry = ProtocolRegistry.getInstance();

// Export convenience functions
export function getProtocol(protocolId: string) {
  return protocolRegistry.getProtocol(protocolId);
}

export function getProtocolConnector(protocolId: string, chainId: string) {
  return protocolRegistry.getConnector(protocolId, chainId);
}

export function getProtocolsByChain(chainId: string) {
  return protocolRegistry.getProtocolsByChain(chainId);
}

export function getProtocolsByCategory(category: string) {
  return protocolRegistry.getProtocolsByCategory(category);
}

export default protocolRegistry;
