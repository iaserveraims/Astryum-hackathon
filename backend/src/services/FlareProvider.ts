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
  /** Ops kill-switch: false leaves every read on HTTP. Default true. */
  wsEnabled?: boolean;
}

/** Upper bound for the reconnect backoff — a rate-limited gateway needs air. */
const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

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
      wsEnabled: config?.wsEnabled ?? process.env.FLARE_RPC_WS_ENABLED !== 'false',
    };
  }

  /**
   * Emit 'error' ONLY when somebody is listening.
   *
   * Node throws whatever you pass to `emit('error', …)` when the emitter has no
   * 'error' listener, and nothing in the codebase listens on this singleton. A
   * 429 from the public Flare gateway (shared PaaS egress IP) therefore killed
   * the whole backend from inside a websocket callback — outside every
   * try/catch, since the callback runs on its own event-loop turn. A transport
   * hiccup on an OPTIONAL socket must never be fatal: reads fall back to HTTP.
   */
  private reportError(error: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
      return;
    }
    console.error('[FlareProvider] unobserved error (not fatal):', error.message);
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

    // batchMaxCount: ethers v6 agrupa las eth_call concurrentes en un solo lote
    // JSON-RPC (100 por defecto). Con TODOS los adaptadores de TODAS las
    // wallets del usuario compartiendo este proveedor, un lote de 100 contra el
    // RPC público volvía de golpe a los ~8 s y cada adaptador «tardaba» eso —
    // los registros los mostraban terminando al mismo milisegundo. 50 es el
    // tamaño que OnChainBalanceProvider ya usa con ese mismo RPC (14-sep).
    this.httpProvider = new JsonRpcProvider(
      this.config.rpcHttp,
      network,
      { staticNetwork: network, batchMaxCount: 50 }
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
    if (!this.config.wsEnabled) {
      console.log('[FlareProvider] WebSocket disabled (FLARE_RPC_WS_ENABLED=false) — reads stay on HTTP');
      return;
    }

    // A retry must not leave the previous socket alive: its listeners stay
    // armed, and each one is another error source aimed at a dead provider.
    await this.teardownWsProvider();

    try {
      const network = new Network('flare', this.config.chainId);

      const wsProvider = new WebSocketProvider(
        this.config.rpcWs,
        network,
        { staticNetwork: network, batchMaxCount: 50 }
      );
      this.wsProvider = wsProvider;

      // Handle WebSocket events — ethers v6 WebSocketLike does not declare `.on`
      // but the underlying ws/uws implementation does. Cast for compatibility.
      const ws = wsProvider.websocket as any;
      if (typeof ws?.on === 'function') {
        ws.on('close', () => {
          // Ignore the close that our own teardown provokes.
          if (this.wsProvider !== wsProvider) return;
          console.warn('[FlareProvider] WebSocket disconnected');
          this.handleWsDisconnect();
        });
        ws.on('error', (error: Error) => {
          if (this.wsProvider !== wsProvider) return;
          console.error('[FlareProvider] WebSocket error:', error.message);
          this.reportError(error);
        });
      }

      // Validate connection
      await wsProvider.getNetwork();

      this.reconnectAttempts = 0;
      console.log('[FlareProvider] WebSocket provider connected');

    } catch (error) {
      // The socket is optional — HTTP already serves every read. Say so plainly
      // instead of letting the caller read this as a dead provider.
      console.warn(
        '[FlareProvider] WebSocket connection failed, reads continue over HTTP:',
        (error as Error)?.message ?? error
      );
      await this.teardownWsProvider();
      this.scheduleWsReconnect();
    }
  }

  /** Close and forget the current socket without provoking a reconnect. */
  private async teardownWsProvider(): Promise<void> {
    const wsProvider = this.wsProvider;
    if (!wsProvider) return;
    this.wsProvider = null;
    try {
      const ws = wsProvider.websocket as any;
      if (typeof ws?.removeAllListeners === 'function') ws.removeAllListeners();
      wsProvider.removeAllListeners();
      await wsProvider.destroy();
    } catch {
      /* tearing down a broken socket must never throw */
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleWsDisconnect(): void {
    void this.teardownWsProvider();
    this.emit('wsDisconnected');
    this.scheduleWsReconnect();
  }

  /**
   * Schedule WebSocket reconnection.
   *
   * Backs off exponentially: a 429 means "you are asking too often", so a fixed
   * 5 s retry is the one thing guaranteed to keep the gateway angry.
   */
  private scheduleWsReconnect(): void {
    // A failed handshake fires BOTH 'error'/'close' and the catch below — one
    // queued retry is enough, and a second one must not burn an attempt.
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      console.error('[FlareProvider] Max reconnect attempts reached — staying on HTTP');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const base = this.config.reconnectInterval || 5000;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts++;

    console.log(
      `[FlareProvider] Scheduling WebSocket reconnect in ${delay}ms ` +
      `(attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.initializeWsProvider()
        .then(() => {
          if (this.wsProvider) this.emit('wsReconnected');
        })
        .catch((error) => {
          console.error('[FlareProvider] Reconnect failed:', (error as Error)?.message ?? error);
        });
    }, delay);
    // Never hold the event loop open just to retry an optional socket.
    this.reconnectTimer.unref?.();
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
   *   - docs §"Principios de ejecución — líneas rojas" (Astryum_Context_v2.md)
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
      // Leaving it set would make every future scheduleWsReconnect() a no-op.
      this.reconnectTimer = null;
    }

    await this.teardownWsProvider();

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
