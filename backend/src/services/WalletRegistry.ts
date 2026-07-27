/**
 * Wallet Registry Service for Astryum Private Beta
 *
 * Manages the registration and monitoring of wallets.
 * ONLY registered wallets can be monitored by Astryum.
 *
 * Features:
 * - Register/unregister wallets
 * - Validate against allowlist
 * - Emit events for wallet changes
 * - Persist to database
 */

import { EventEmitter } from 'events';
import { isWalletAllowed, addWalletToAllowlist } from '../config/allowlist.config';
import { WalletRepository, PersistedWallet } from '../repositories/WalletRepository';

export interface RegisteredWallet {
  address: string;
  label?: string;
  registeredAt: Date;
  isActive: boolean;
  lastSyncedAt?: Date;
  lastBlockSynced?: number;
}

export interface WalletRegistryEvents {
  'wallet:registered': (wallet: RegisteredWallet) => void;
  'wallet:unregistered': (address: string) => void;
  'wallet:activated': (address: string) => void;
  'wallet:deactivated': (address: string) => void;
  'wallet:updated': (wallet: RegisteredWallet) => void;
}

export class WalletRegistry extends EventEmitter {
  private static instance: WalletRegistry;
  private wallets: Map<string, RegisteredWallet> = new Map();
  private initialized: boolean = false;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WalletRegistry {
    if (!WalletRegistry.instance) {
      WalletRegistry.instance = new WalletRegistry();
    }
    return WalletRegistry.instance;
  }

  /**
   * Initialize the registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[WalletRegistry] Initializing...');

    // Load wallets from database
    await this.load();

    this.initialized = true;
    console.log(`[WalletRegistry] Initialized with ${this.wallets.size} wallets`);
  }

  /**
   * Register a new wallet
   *
   * @param address - Wallet address to register
   * @param label - Optional human-readable label
   * @param addToAllowlist - Whether to also add to allowlist if not present
   */
  register(
    address: string,
    label?: string,
    addToAllowlist: boolean = false
  ): RegisteredWallet {
    const normalizedAddress = address.toLowerCase();

    // Check if already registered
    if (this.wallets.has(normalizedAddress)) {
      const existing = this.wallets.get(normalizedAddress)!;
      console.log(`[WalletRegistry] Wallet already registered: ${address}`);
      return existing;
    }

    // Check allowlist (unless we're adding to it)
    if (!addToAllowlist && !isWalletAllowed(address)) {
      throw new Error(
        `Wallet ${address} is not in the allowlist. ` +
        `Add it to the allowlist first or set addToAllowlist=true.`
      );
    }

    // Add to allowlist if requested
    if (addToAllowlist) {
      addWalletToAllowlist(address);
    }

    // Create registration
    const wallet: RegisteredWallet = {
      address: normalizedAddress,
      label,
      registeredAt: new Date(),
      isActive: true,
    };

    this.wallets.set(normalizedAddress, wallet);

    console.log(`[WalletRegistry] Wallet registered: ${address}${label ? ` (${label})` : ''}`);

    this.emit('wallet:registered', wallet);

    // Persist to database
    this.saveWallet(wallet).catch(err => {
      console.error('[WalletRegistry] Failed to persist wallet:', err);
    });

    return wallet;
  }

  /**
   * Unregister a wallet
   */
  unregister(address: string): boolean {
    const normalizedAddress = address.toLowerCase();

    if (!this.wallets.has(normalizedAddress)) {
      console.warn(`[WalletRegistry] Wallet not found: ${address}`);
      return false;
    }

    this.wallets.delete(normalizedAddress);

    console.log(`[WalletRegistry] Wallet unregistered: ${address}`);

    this.emit('wallet:unregistered', normalizedAddress);

    // Persist deletion
    this.deleteWallet(normalizedAddress).catch(err => {
      console.error('[WalletRegistry] Failed to delete wallet from DB:', err);
    });

    return true;
  }

  /**
   * Check if a wallet is registered
   */
  isRegistered(address: string): boolean {
    return this.wallets.has(address.toLowerCase());
  }

  /**
   * Get all registered wallets
   */
  getAll(): RegisteredWallet[] {
    return Array.from(this.wallets.values());
  }

  /**
   * Get only active wallets
   */
  getActive(): RegisteredWallet[] {
    return this.getAll().filter(w => w.isActive);
  }

  /**
   * Get a specific wallet
   */
  get(address: string): RegisteredWallet | undefined {
    return this.wallets.get(address.toLowerCase());
  }

  /**
   * Update wallet label
   */
  updateLabel(address: string, label: string): boolean {
    const wallet = this.wallets.get(address.toLowerCase());

    if (!wallet) {
      console.warn(`[WalletRegistry] Wallet not found: ${address}`);
      return false;
    }

    wallet.label = label;

    this.emit('wallet:updated', wallet);
    this.saveWallet(wallet).catch(console.error);

    return true;
  }

  /**
   * Set wallet active/inactive
   */
  setActive(address: string, active: boolean): boolean {
    const wallet = this.wallets.get(address.toLowerCase());

    if (!wallet) {
      console.warn(`[WalletRegistry] Wallet not found: ${address}`);
      return false;
    }

    wallet.isActive = active;

    this.emit(active ? 'wallet:activated' : 'wallet:deactivated', address.toLowerCase());
    this.emit('wallet:updated', wallet);
    this.saveWallet(wallet).catch(console.error);

    console.log(`[WalletRegistry] Wallet ${active ? 'activated' : 'deactivated'}: ${address}`);

    return true;
  }

  /**
   * Update last synced information
   */
  updateSyncInfo(address: string, blockNumber: number): boolean {
    const wallet = this.wallets.get(address.toLowerCase());

    if (!wallet) return false;

    wallet.lastSyncedAt = new Date();
    wallet.lastBlockSynced = blockNumber;

    this.saveWallet(wallet).catch(console.error);

    return true;
  }

  /**
   * Get all wallet addresses (for quick iteration)
   */
  getAddresses(): string[] {
    return Array.from(this.wallets.keys());
  }

  /**
   * Get active wallet addresses
   */
  getActiveAddresses(): string[] {
    return this.getActive().map(w => w.address);
  }

  /**
   * Count registered wallets
   */
  count(): number {
    return this.wallets.size;
  }

  /**
   * Count active wallets
   */
  countActive(): number {
    return this.getActive().length;
  }

  // ============================================
  // PERSISTENCE METHODS
  // ============================================

  /**
   * Load wallets from database
   */
  async load(): Promise<void> {
    try {
      const persisted = await WalletRepository.loadAll();
      for (const w of persisted) {
        this.wallets.set(w.address, this.fromPersisted(w));
      }

      // Bootstrap from REGISTERED_WALLETS env (only addresses not already in DB)
      const walletsEnv = process.env.REGISTERED_WALLETS;
      if (walletsEnv) {
        for (const raw of walletsEnv.split(',')) {
          const address = raw.trim().toLowerCase();
          if (!address || this.wallets.has(address)) continue;
          const wallet: RegisteredWallet = {
            address,
            registeredAt: new Date(),
            isActive: true,
          };
          this.wallets.set(address, wallet);
          await WalletRepository.save(this.toPersisted(wallet));
        }
      }

      console.log(`[WalletRegistry] Loaded ${this.wallets.size} wallets from DB`);
    } catch (error) {
      console.error('[WalletRegistry] Failed to load wallets:', error);
    }
  }

  /**
   * Persist all in-memory wallets (full sync)
   */
  async save(): Promise<void> {
    try {
      for (const wallet of this.wallets.values()) {
        await WalletRepository.save(this.toPersisted(wallet));
      }
      console.log(`[WalletRegistry] Saved ${this.wallets.size} wallets`);
    } catch (error) {
      console.error('[WalletRegistry] Failed to save wallets:', error);
      throw error;
    }
  }

  private async saveWallet(wallet: RegisteredWallet): Promise<void> {
    await WalletRepository.save(this.toPersisted(wallet));
  }

  private async deleteWallet(address: string): Promise<void> {
    await WalletRepository.delete(address);
  }

  private toPersisted(w: RegisteredWallet): PersistedWallet {
    return {
      address: w.address,
      label: w.label ?? null,
      registeredAt: w.registeredAt,
      isActive: w.isActive,
      lastSyncedAt: w.lastSyncedAt ?? null,
      lastBlockSynced: w.lastBlockSynced ?? null,
    };
  }

  private fromPersisted(p: PersistedWallet): RegisteredWallet {
    return {
      address: p.address,
      label: p.label ?? undefined,
      registeredAt: p.registeredAt,
      isActive: p.isActive,
      lastSyncedAt: p.lastSyncedAt ?? undefined,
      lastBlockSynced: p.lastBlockSynced ?? undefined,
    };
  }
}

// Export singleton getter
export const getWalletRegistry = (): WalletRegistry => {
  return WalletRegistry.getInstance();
};

export default WalletRegistry;
