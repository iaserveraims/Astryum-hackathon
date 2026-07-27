/**
 * Flare EVM Provider Service
 * Singleton provider for Flare Mainnet connections
 *
 * Features:
 * - HTTP and WebSocket providers
 * - Automatic reconnection for WebSocket
 * - Connection validation
 * - NO testnet fallback
 */

import { ethers, JsonRpcProvider, WebSocketProvider, Network } from 'ethers';
import { EventEmitter } from 'events';
import { ACTIVE_CHAIN, validateMainnetOnly } from '../config/chainConfigs';

export interface FlareProviderConfig {
  rpcHttp: string;
  rpcWs: string;
  chainId: number;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class FlareProvider extends EventEmitter {
  private static instance: FlareProvider;

  private httpProvider: JsonRpcProvider | null = null;
  private wsProvider: WebSocketProvider | null = null;
  private config: FlareProviderConfig;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private constructor(config?: Partial<FlareProviderConfig>) {
    super();

    // Validate mainnet only
    validateMainnetOnly();

    this.config = {
      rpcHttp: config?.rpcHttp || ACTIVE_CHAIN.rpcHttp,
      rpcWs: config?.rpcWs || ACTIVE_CHAIN.rpcWs,
      chainId: ACTIVE_CHAIN.chainId,
      reconnectInterval: config?.reconnectInterval || 5000,
      maxReconnectAttempts: config?.maxReconnectAttempts || 10,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<FlareProviderConfig>): FlareProvider {
    if (!FlareProvider.instance) {
      FlareProvider.instance = new FlareProvider(config);
    }
    return FlareProvider.instance;
  }

  /**
   * Initialize providers
   */
  async initialize(): Promise<void> {
    console.log('[FlareProvider] Initializing Flare Mainnet providers...');

    try {
      // Initialize HTTP provider
      await this.initializeHttpProvider();

      // Initialize WebSocket provider
      await this.initializeWsProvider();

      this.isConnected = true;
      this.emit('connected');

      console.log('[FlareProvider] Successfully connected to Flare Mainnet');
    } catch (error) {
      console.error('[FlareProvider] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Initialize HTTP provider
   */
  private async initializeHttpProvider(): Promise<void> {
    const network = new Network('flare', this.config.chainId);

    this.httpProvider = new JsonRpcProvider(
      this.config.rpcHttp,
      network,
      { staticNetwork: network }
    );

    // Validate connection
    const chainId = await this.httpProvider.getNetwork();
    if (Number(chainId.chainId) !== this.config.chainId) {
      throw new Error(
        `Chain ID mismatch. Expected ${this.config.chainId}, got ${chainId.chainId}`
      );
    }

    console.log('[FlareProvider] HTTP provider connected');
  }

  /**
   * Initialize WebSocket provider with auto-reconnect
   */
  private async initializeWsProvider(): Promise<void> {
    try {
      const network = new Network('flare', this.config.chainId);

      this.wsProvider = new WebSocketProvider(
        this.config.rpcWs,
        network,
        { staticNetwork: network }
      );

      // Handle WebSocket events — ethers v6 WebSocketLike does not declare `.on`
      // but the underlying ws/uws implementation does. Cast for compatibility.
      const ws = this.wsProvider.websocket as any;
      if (typeof ws?.on === 'function') {
        ws.on('close', () => {
          console.warn('[FlareProvider] WebSocket disconnected');
          this.handleWsDisconnect();
        });
        ws.on('error', (error: Error) => {
          console.error('[FlareProvider] WebSocket error:', error);
          this.emit('error', error);
        });
      }

      // Validate connection
      await this.wsProvider.getNetwork();

      this.reconnectAttempts = 0;
      console.log('[FlareProvider] WebSocket provider connected');

    } catch (error) {
      console.warn('[FlareProvider] WebSocket connection failed, will retry:', error);
      this.scheduleWsReconnect();
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleWsDisconnect(): void {
    this.wsProvider = null;
    this.emit('wsDisconnected');
    this.scheduleWsReconnect();
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleWsReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      console.error('[FlareProvider] Max reconnect attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval || 5000;

    console.log(
      `[FlareProvider] Scheduling WebSocket reconnect in ${delay}ms ` +
      `(attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.initializeWsProvider();
        this.emit('wsReconnected');
      } catch (error) {
        console.error('[FlareProvider] Reconnect failed:', error);
      }
    }, delay);
  }

  /**
   * Get HTTP provider
   */
  getHttpProvider(): JsonRpcProvider {
    if (!this.httpProvider) {
      throw new Error('HTTP provider not initialized. Call initialize() first.');
    }
    return this.httpProvider;
  }

  /**
   * Get WebSocket provider (may be null if disconnected)
   */
  getWsProvider(): WebSocketProvider | null {
    return this.wsProvider;
  }

  /**
   * Get the best available provider (prefers WS, falls back to HTTP)
   */
  getProvider(): JsonRpcProvider | WebSocketProvider {
    return this.wsProvider || this.getHttpProvider();
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && this.httpProvider !== null;
  }

  /**
   * Check if WebSocket is connected
   */
  isWsConnected(): boolean {
    return this.wsProvider !== null;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const provider = this.getProvider();
    return await provider.getBlockNumber();
  }

  /**
   * Get balance of an address
   */
  async getBalance(address: string): Promise<bigint> {
    const provider = this.getProvider();
    return await provider.getBalance(address);
  }

  /**
   * Get gas price
   */
  async getGasPrice(): Promise<bigint> {
    const provider = this.getProvider();
    const feeData = await provider.getFeeData();
    return feeData.gasPrice || BigInt(0);
  }

  /**
   * Subscribe to new blocks (requires WebSocket)
   */
  onBlock(callback: (blockNumber: number) => void): void {
    if (!this.wsProvider) {
      console.warn('[FlareProvider] WebSocket not available for block subscription');
      return;
    }
    this.wsProvider.on('block', callback);
  }

  /**
   * Subscribe to pending transactions (requires WebSocket)
   */
  onPendingTransaction(callback: (txHash: string) => void): void {
    if (!this.wsProvider) {
      console.warn('[FlareProvider] WebSocket not available for pending tx subscription');
      return;
    }
    this.wsProvider.on('pending', callback);
  }

  /**
   * Call a contract method (read-only)
   */
  async call(transaction: ethers.TransactionRequest): Promise<string> {
    const provider = this.getProvider();
    return await provider.call(transaction);
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(transaction: ethers.TransactionRequest): Promise<bigint> {
    const provider = this.getProvider();
    return await provider.estimateGas(transaction);
  }

  /**
   * BROADCAST_FORBIDDEN — Astryum never broadcasts.
   *
   * The previous `sendTransaction(signedTx)` method was removed in the
   * 2026-06-01 regulatory audit (Cat 1.1). The wallet partner (MetaMask /
   * WalletConnect / Bifrost / etc.) transmits the user-signed transaction;
   * Astryum only prepares unsigned calldata. See:
   *   - docs §"Principios de ejecución — líneas rojas" (Defibro_Context_v2.md)
   *   - control-plane/RegulatedRelayBoundary.ts
   *
   * Any code that needs to learn a tx outcome reads it via getTransaction()
   * or getTransactionReceipt() (read-only) — Astryum never owns broadcast.
   */

  /**
   * Wait for transaction confirmation (READ-ONLY observation only).
   * Used by audit-log tracking after the wallet partner has broadcast.
   */
  async waitForTransaction(
    txHash: string,
    confirmations: number = 1
  ): Promise<ethers.TransactionReceipt | null> {
    const provider = this.getProvider();
    return await provider.waitForTransaction(txHash, confirmations);
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
    const provider = this.getProvider();
    return await provider.getTransactionReceipt(txHash);
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }

    if (this.httpProvider) {
      this.httpProvider.removeAllListeners();
      this.httpProvider = null;
    }

    this.isConnected = false;
    this.emit('disconnected');

    console.log('[FlareProvider] Disconnected');
  }
}

// Export singleton getter
export const getFlareProvider = (config?: Partial<FlareProviderConfig>): FlareProvider => {
  return FlareProvider.getInstance(config);
};

export default FlareProvider;
