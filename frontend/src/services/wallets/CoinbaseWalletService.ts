// Real Coinbase Wallet integration
import { WalletService, WalletAccount, WalletBalance, TokenBalance, ChainType, InjectedEthereumProvider } from '@/lib/types/wallet';
import { ethers } from 'ethers';

// Coinbase Wallet types. `Window.ethereum` is NOT re-declared here — @reown/appkit
// already declares it as `Record<string, unknown>` (TS2717); cast via the shared shape.
declare global {
  interface Window {
    // Coinbase Wallet specific provider
    coinbaseWalletExtension?: {
      request(args: { method: string; params?: any[] }): Promise<any>;
      on(event: string, callback: (...args: any[]) => void): void;
      removeListener(event: string, callback: (...args: any[]) => void): void;
      selectedAddress: string | null;
      chainId: string | null;
    };
  }
}

const injectedEthereum = (): InjectedEthereumProvider =>
  (typeof window === 'undefined' ? undefined : (window as { ethereum?: unknown }).ethereum) as InjectedEthereumProvider;

export interface CoinbaseTransaction {
  to: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  data?: string;
  nonce?: number;
  type?: number;
}

export class CoinbaseWalletService implements WalletService {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.JsonRpcSigner | null = null;
  private _isConnected: boolean = false;
  private currentAccount: WalletAccount | null = null;
  private currentChainId: string = '0x1'; // Default to Ethereum mainnet
  private accountChangeCallbacks: Array<(account: WalletAccount | null) => void> = [];
  private disconnectCallbacks: Array<() => void> = [];

  // Enhanced multi-account support
  private connectedAccounts: Map<string, WalletAccount> = new Map();
  private connectionPool: Map<string, {
    provider: ethers.BrowserProvider;
    signer: ethers.JsonRpcSigner;
    lastActivity: Date;
    isActive: boolean;
  }> = new Map();
  private maxConnections: number = 10; // Support up to 10 concurrent connections
  private balanceCache: Map<string, { balance: WalletBalance; timestamp: number }> = new Map();
  private readonly BALANCE_CACHE_TTL = 30000; // 30 seconds

  constructor() {
    this.setupEventListeners();
    this.attemptReconnection();
  }

  async connect(): Promise<WalletAccount> {
    try {
      // Check if Coinbase Wallet is available
      const coinbaseProvider = this.getCoinbaseProvider();
      if (!coinbaseProvider) {
        throw new Error('Coinbase Wallet not found. Please install Coinbase Wallet extension or use Coinbase Wallet mobile app.');
      }

      // Request account access
      const accounts = await coinbaseProvider.request({
        method: 'eth_requestAccounts'
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found in Coinbase Wallet');
      }

      // Create provider and signer for primary account
      this.provider = new ethers.BrowserProvider(coinbaseProvider);
      this.signer = await this.provider.getSigner();

      // Get current network
      const network = await this.provider.getNetwork();
      this.currentChainId = `0x${network.chainId.toString(16)}`;

      // Connect all available accounts
      const connectedAccounts: WalletAccount[] = [];
      for (let i = 0; i < Math.min(accounts.length, this.maxConnections); i++) {
        const accountAddress = accounts[i];
        const account = await this.createAccountFromAddress(accountAddress, i);

        // Store in connection pool
        this.connectedAccounts.set(account.id, account);

        // Create dedicated connection for this account
        try {
          const accountSigner = await this.provider.getSigner(accountAddress);
          this.connectionPool.set(account.id, {
            provider: this.provider,
            signer: accountSigner,
            lastActivity: new Date(),
            isActive: true
          });
        } catch (signerError) {
          console.warn(`Could not create signer for Coinbase account ${accountAddress}:`, signerError);
        }

        connectedAccounts.push(account);

        // Set first account as primary
        if (i === 0) {
          this.currentAccount = account;
        }
      }

      this._isConnected = true;

      // Persist connection information
      this.persistConnectionState(connectedAccounts);

      // Notify listeners with all connected accounts
      this.accountChangeCallbacks.forEach(callback => {
        connectedAccounts.forEach(account => callback(account));
      });

      return this.currentAccount!;
    } catch (error) {
      console.error('Failed to connect to Coinbase Wallet:', error);
      throw new Error(`Coinbase Wallet connection failed: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      // Coinbase Wallet doesn't have a disconnect method, just clear local state
      this.provider = null;
      this.signer = null;
      this._isConnected = false;
      this.currentAccount = null;
      this.connectedAccounts.clear();
      this.connectionPool.clear();
      this.balanceCache.clear();

      // Clear persistence flags when manually disconnecting
      this.clearPersistence();

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(null));
      this.disconnectCallbacks.forEach(callback => callback());
    } catch (error) {
      console.error('Failed to disconnect from Coinbase Wallet:', error);
    }
  }

  async getAccount(): Promise<WalletAccount | null> {
    if (!this.isConnected || !this.provider) {
      return null;
    }

    try {
      const signer = await this.provider.getSigner();
      const address = await signer.getAddress();

      if (this.currentAccount && this.currentAccount.address !== address) {
        // Account changed, update it
        this.currentAccount = await this.createAccountFromAddress(address, 0);
      }

      return this.currentAccount;
    } catch (error) {
      console.error('Failed to get Coinbase account info:', error);
      return this.currentAccount;
    }
  }

  async getBalance(address: string): Promise<WalletBalance> {
    try {
      // Check cache first
      const cacheKey = `${address}-${this.currentChainId}`;
      const cached = this.balanceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.BALANCE_CACHE_TTL) {
        return cached.balance;
      }

      if (!this.provider) {
        throw new Error('Provider not initialized');
      }

      // Get ETH balance with retry logic
      let ethBalance;
      let retries = 0;
      while (retries < 3) {
        try {
          ethBalance = await this.provider.getBalance(address);
          break;
        } catch (error) {
          retries++;
          if (retries === 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }

      const ethBalanceFormatted = ethers.formatEther(ethBalance);
      const ethUsdValue = await this.getETHPrice();
      const ethValue = parseFloat(ethBalanceFormatted) * ethUsdValue;

      // Get ERC-20 token balances
      const tokens: TokenBalance[] = await this.getERC20Balances(address);

      const totalUsdValue = ethValue + tokens.reduce((sum, token) => sum + token.usdValue, 0);

      const balance = {
        native: {
          symbol: this.getNativeSymbol(),
          balance: ethBalanceFormatted,
          usdValue: ethValue,
          currency: this.getNativeSymbol()
        },
        tokens,
        totalUsdValue,
        lastUpdated: new Date()
      };

      // Cache the result
      this.balanceCache.set(cacheKey, { balance, timestamp: Date.now() });

      return balance;
    } catch (error) {
      console.error('Failed to get Coinbase Wallet balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  async signMessage(message: string): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('Coinbase Wallet not connected');
      }

      const signature = await this.signer.signMessage(message);
      return signature;
    } catch (error) {
      console.error('Failed to sign message with Coinbase Wallet:', error);
      throw new Error(`Message signing failed: ${error.message}`);
    }
  }

  async signTransaction(transaction: CoinbaseTransaction): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('Coinbase Wallet not connected');
      }

      // Prepare transaction
      const tx = {
        to: transaction.to,
        value: transaction.value ? ethers.parseEther(transaction.value) : undefined,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        data: transaction.data,
        nonce: transaction.nonce,
        type: transaction.type
      };

      const signedTx = await this.signer.signTransaction(tx);
      return signedTx;
    } catch (error) {
      console.error('Failed to sign transaction with Coinbase Wallet:', error);
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }

  async submitTransaction(transaction: CoinbaseTransaction): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('Coinbase Wallet not connected');
      }

      const tx = {
        to: transaction.to,
        value: transaction.value ? ethers.parseEther(transaction.value) : undefined,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        data: transaction.data,
        nonce: transaction.nonce,
        type: transaction.type
      };

      const txResponse = await this.signer.sendTransaction(tx);
      const receipt = await txResponse.wait();

      if (receipt?.status === 1) {
        return txResponse.hash;
      } else {
        throw new Error('Transaction failed');
      }
    } catch (error) {
      console.error('Failed to submit transaction with Coinbase Wallet:', error);
      throw new Error(`Transaction submission failed: ${error.message}`);
    }
  }

  isConnected(): boolean {
    return this._isConnected && this.currentAccount !== null;
  }

  onAccountChange(callback: (account: WalletAccount | null) => void): void {
    this.accountChangeCallbacks.push(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  // Enhanced multi-account methods
  public getConnectedAccounts(): WalletAccount[] {
    return Array.from(this.connectedAccounts.values());
  }

  public getAccountById(accountId: string): WalletAccount | null {
    return this.connectedAccounts.get(accountId) || null;
  }

  public async refreshAllBalances(): Promise<void> {
    const accounts = this.getConnectedAccounts();
    const refreshPromises = accounts.map(async (account) => {
      try {
        const balance = await this.getBalance(account.address);
        account.balance = balance;
        account.metadata!.lastActivity = new Date();
        this.connectedAccounts.set(account.id, account);
      } catch (error) {
        console.warn(`Failed to refresh balance for Coinbase account ${account.id}:`, error);
      }
    });

    await Promise.all(refreshPromises);
  }

  public getConnectionStats(): {
    totalConnections: number;
    activeConnections: number;
    lastActivity: Date | null;
    cacheSize: number;
  } {
    const activeConnections = Array.from(this.connectionPool.values()).filter(conn => conn.isActive).length;
    const lastActivities = Array.from(this.connectionPool.values()).map(conn => conn.lastActivity);
    const lastActivity = lastActivities.length > 0 ? new Date(Math.max(...lastActivities.map(d => d.getTime()))) : null;

    return {
      totalConnections: this.connectedAccounts.size,
      activeConnections,
      lastActivity,
      cacheSize: this.balanceCache.size
    };
  }

  // Private helper methods
  private getCoinbaseProvider() {
    // First check for Coinbase Wallet specific provider
    if (window.coinbaseWalletExtension) {
      return window.coinbaseWalletExtension;
    }

    // Check if the default ethereum provider is Coinbase Wallet
    if (injectedEthereum()?.isCoinbaseWallet) {
      return injectedEthereum();
    }

    // Check for multiple providers (when both MetaMask and Coinbase are installed)
    if (injectedEthereum() && (injectedEthereum() as any).providers) {
      const providers = (injectedEthereum() as any).providers;
      return providers.find((provider: any) => provider.isCoinbaseWallet);
    }

    return null;
  }

  private async createAccountFromAddress(address: string, accountIndex: number = 0): Promise<WalletAccount> {
    const balance = await this.getBalance(address);
    const chainType = this.getChainType(this.currentChainId);
    const accountId = `coinbase-${address.toLowerCase()}`;

    return {
      id: accountId,
      address,
      walletType: 'coinbase' as any, // We need to add this to WalletType
      chainType,
      nickname: `Coinbase ${accountIndex + 1} (${address.slice(0, 6)}...${address.slice(-4)})`,
      isConnected: true,
      status: 'connected',
      balance,
      network: this.getNetworkName(this.currentChainId),
      capabilities: {
        signMessage: true,
        signTransaction: true,
        signAndSubmit: true,
        multiSign: false
      },
      metadata: {
        walletName: 'Coinbase Wallet',
        walletVersion: await this.getCoinbaseVersion(),
        connectedAt: new Date(),
        lastActivity: new Date(),
        accountIndex,
        connectionId: accountId
      }
    };
  }

  private setupEventListeners(): void {
    const coinbaseProvider = this.getCoinbaseProvider();
    if (!coinbaseProvider) return;

    // Listen for account changes
    const handleAccountsChanged = async (accounts: string[]) => {
      if (accounts.length === 0) {
        // No accounts connected - disconnect all
        this.connectedAccounts.clear();
        this.connectionPool.clear();
        this.balanceCache.clear();
        this.currentAccount = null;
        this._isConnected = false;
        this.accountChangeCallbacks.forEach(callback => callback(null));
      } else {
        // Update connected accounts to match Coinbase's current accounts
        const currentAddresses = Array.from(this.connectedAccounts.values()).map(acc => acc.address.toLowerCase());
        const coinbaseAddresses = accounts.map((addr: string) => addr.toLowerCase());

        // Remove accounts no longer available
        for (const [accountId, account] of this.connectedAccounts.entries()) {
          if (!coinbaseAddresses.includes(account.address.toLowerCase())) {
            this.connectedAccounts.delete(accountId);
            this.connectionPool.delete(accountId);
          }
        }

        // Add new accounts
        for (let i = 0; i < Math.min(accounts.length, this.maxConnections); i++) {
          const address = accounts[i];
          if (!currentAddresses.includes(address.toLowerCase())) {
            try {
              const newAccount = await this.createAccountFromAddress(address, i);
              this.connectedAccounts.set(newAccount.id, newAccount);

              // Create signer for new account
              const accountSigner = await this.provider!.getSigner(address);
              this.connectionPool.set(newAccount.id, {
                provider: this.provider!,
                signer: accountSigner,
                lastActivity: new Date(),
                isActive: true
              });

              // Notify listeners
              this.accountChangeCallbacks.forEach(callback => callback(newAccount));
            } catch (error) {
              console.warn(`Failed to add new Coinbase account ${address}:`, error);
            }
          }
        }

        // Update current account if needed
        if (!this.currentAccount || !coinbaseAddresses.includes(this.currentAccount.address.toLowerCase())) {
          const availableAccounts = this.getConnectedAccounts();
          this.currentAccount = availableAccounts.length > 0 ? availableAccounts[0] : null;
        }

        // Update persistence
        this.persistConnectionState(this.getConnectedAccounts());
      }
    };

    // Listen for chain changes
    const handleChainChanged = async (chainId: string) => {
      this.currentChainId = chainId;

      // Update all connected accounts with new chain info
      const accounts = this.getConnectedAccounts();
      for (const account of accounts) {
        try {
          account.chainType = this.getChainType(chainId);
          account.network = this.getNetworkName(chainId);
          account.balance = await this.getBalance(account.address);
          this.connectedAccounts.set(account.id, account);
          this.accountChangeCallbacks.forEach(callback => callback(account));
        } catch (error) {
          console.warn(`Failed to update Coinbase account ${account.id} for chain change:`, error);
        }
      }

      // Clear balance cache on chain change
      this.balanceCache.clear();
    };

    // Listen for disconnection
    const handleDisconnect = () => {
      this.connectedAccounts.clear();
      this.connectionPool.clear();
      this.balanceCache.clear();
      this.currentAccount = null;
      this._isConnected = false;
      this.disconnectCallbacks.forEach(callback => callback());
    };

    coinbaseProvider.on('accountsChanged', handleAccountsChanged);
    coinbaseProvider.on('chainChanged', handleChainChanged);
    coinbaseProvider.on('disconnect', handleDisconnect);
  }

  private getChainType(chainId: string): ChainType {
    const chainIdNum = parseInt(chainId, 16);

    switch (chainIdNum) {
      case 1: // Ethereum Mainnet
      case 5: // Goerli
      case 11155111: // Sepolia
        return 'ethereum';
      case 137: // Polygon Mainnet
      case 80001: // Polygon Mumbai
        return 'polygon';
      case 42161: // Arbitrum One
      case 421613: // Arbitrum Goerli
        return 'arbitrum';
      default:
        return 'ethereum';
    }
  }

  private getNetworkName(chainId: string): string {
    const chainIdNum = parseInt(chainId, 16);

    const networks: { [key: number]: string } = {
      1: 'mainnet',
      5: 'goerli',
      11155111: 'sepolia',
      137: 'polygon',
      80001: 'mumbai',
      42161: 'arbitrum',
      421613: 'arbitrum-goerli'
    };

    return networks[chainIdNum] || 'unknown';
  }

  private async getCoinbaseVersion(): Promise<string> {
    try {
      const coinbaseProvider = this.getCoinbaseProvider();
      if (!coinbaseProvider) return 'unknown';

      // Try to get version info
      return '1.0+'; // Coinbase doesn't expose version easily
    } catch (error) {
      return '1.0+';
    }
  }

  private async getETHPrice(): Promise<number> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      return data.ethereum?.usd || 2000;
    } catch (error) {
      console.warn('Failed to fetch ETH price:', error);
      return 2000;
    }
  }

  private async getERC20Balances(address: string): Promise<TokenBalance[]> {
    try {
      if (!this.provider) return [];

      const network = await this.provider.getNetwork();
      if (Number(network.chainId) !== 14) return [];

      // Verified Flare Mainnet token addresses only.
      // Add USDC.e / USDT0 once their Flare addresses are verified in Flarescan.
      const popularTokens = [
        {
          address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', // WFLR (Flare Mainnet verified)
          symbol: 'WFLR',
          name: 'Wrapped Flare',
          decimals: 18
        }
      ];

      const tokens: TokenBalance[] = [];

      for (const tokenInfo of popularTokens) {
        try {
          const contract = new ethers.Contract(
            tokenInfo.address,
            [
              'function balanceOf(address) view returns (uint256)',
              'function symbol() view returns (string)',
              'function name() view returns (string)',
              'function decimals() view returns (uint8)'
            ],
            this.provider
          );

          const balance = await contract.balanceOf(address);
          const balanceFormatted = ethers.formatUnits(balance, tokenInfo.decimals);

          if (parseFloat(balanceFormatted) > 0) {
            const tokenUsdValue = await this.getTokenPrice(tokenInfo.symbol);

            tokens.push({
              address: tokenInfo.address,
              symbol: tokenInfo.symbol,
              name: tokenInfo.name,
              balance: balanceFormatted,
              decimals: tokenInfo.decimals,
              usdValue: parseFloat(balanceFormatted) * tokenUsdValue,
              logoUri: this.getTokenLogo(tokenInfo.symbol),
              verified: true
            });
          }
        } catch (error) {
          console.warn(`Failed to get balance for ${tokenInfo.symbol}:`, error);
        }
      }

      return tokens;
    } catch (error) {
      console.error('Failed to get ERC-20 balances:', error);
      return [];
    }
  }

  private async getTokenPrice(symbol: string): Promise<number> {
    try {
      const symbolMap: { [key: string]: string } = {
        'USDC': 'usd-coin',
        'USDT': 'tether',
        'DAI': 'dai'
      };

      const coinId = symbolMap[symbol.toUpperCase()];
      if (!coinId) return 0;

      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
      const data = await response.json();
      return data[coinId]?.usd || 0;
    } catch (error) {
      console.warn('Failed to fetch token price:', error);
      return 0;
    }
  }

  private getTokenLogo(symbol: string): string | undefined {
    const knownLogos: { [key: string]: string } = {
      'USDC': 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
      'USDT': 'https://cryptologos.cc/logos/tether-usdt-logo.png',
      'DAI': 'https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.png'
    };

    return knownLogos[symbol.toUpperCase()];
  }

  private getNativeSymbol(): string {
    const chainType = this.getChainType(this.currentChainId);
    switch (chainType) {
      case 'polygon': return 'MATIC';
      case 'arbitrum': return 'ETH';
      default: return 'ETH';
    }
  }

  // Auto-reconnection functionality
  private async attemptReconnection(): Promise<void> {
    try {
      const coinbaseProvider = this.getCoinbaseProvider();
      if (!coinbaseProvider) return;

      // Check if previously connected
      const persistedData = localStorage.getItem('astryum-wallet-store');
      if (!persistedData) return;

      const parsed = JSON.parse(persistedData);
      const hasCoinbaseWallet = parsed?.state?.wallets?.some((wallet: any) =>
        wallet.walletType === 'coinbase' && wallet.isConnected
      );

      if (!hasCoinbaseWallet) return;

      // Check if Coinbase still has accounts connected
      const accounts = await coinbaseProvider.request({
        method: 'eth_accounts'
      });

      if (accounts && accounts.length > 0) {
        // Silent reconnection
        this.provider = new ethers.BrowserProvider(coinbaseProvider);

        const network = await this.provider.getNetwork();
        this.currentChainId = `0x${network.chainId.toString(16)}`;

        // Restore connection state
        await this.restoreConnectionState();

        if (this.connectedAccounts.size === 0) {
          const primaryAccount = await this.createAccountFromAddress(accounts[0], 0);
          this.currentAccount = primaryAccount;
          this.connectedAccounts.set(primaryAccount.id, primaryAccount);

          this.signer = await this.provider.getSigner();
          this.connectionPool.set(primaryAccount.id, {
            provider: this.provider,
            signer: this.signer,
            lastActivity: new Date(),
            isActive: true
          });
        } else {
          const accounts = this.getConnectedAccounts();
          this.currentAccount = accounts[0];
          const primaryConnection = this.connectionPool.get(accounts[0].id);
          if (primaryConnection) {
            this.signer = primaryConnection.signer;
          }
        }

        this._isConnected = true;

        // Store connection persistence flag
        localStorage.setItem('coinbase-auto-connected', 'true');

        // Notify listeners
        this.getConnectedAccounts().forEach(account => {
          this.accountChangeCallbacks.forEach(callback => callback(account));
        });

        console.log(`Coinbase Wallet auto-reconnected with ${this.connectedAccounts.size} accounts`);
      }
    } catch (error) {
      console.warn('Coinbase auto-reconnection failed:', error);
      localStorage.removeItem('coinbase-auto-connected');
    }
  }

  private async restoreConnectionState(): Promise<void> {
    try {
      const storedData = localStorage.getItem('coinbase-connected-accounts');
      if (!storedData) return;

      const connectionData = JSON.parse(storedData);
      if (!connectionData.accounts || Date.now() - connectionData.timestamp > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem('coinbase-connected-accounts');
        return;
      }

      const coinbaseProvider = this.getCoinbaseProvider();
      const currentAccounts = await coinbaseProvider?.request({ method: 'eth_accounts' }) || [];

      for (const storedAccount of connectionData.accounts) {
        if (currentAccounts.includes(storedAccount.address)) {
          try {
            const account = await this.createAccountFromAddress(storedAccount.address, storedAccount.accountIndex);
            account.nickname = storedAccount.nickname || account.nickname;

            this.connectedAccounts.set(account.id, account);

            const accountSigner = await this.provider!.getSigner(storedAccount.address);
            this.connectionPool.set(account.id, {
              provider: this.provider!,
              signer: accountSigner,
              lastActivity: new Date(),
              isActive: true
            });
          } catch (error) {
            console.warn(`Failed to restore Coinbase account ${storedAccount.address}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to restore Coinbase connection state:', error);
    }
  }

  private persistConnectionState(accounts: WalletAccount[]): void {
    try {
      const connectionData = {
        accounts: accounts.map(acc => ({
          id: acc.id,
          address: acc.address,
          nickname: acc.nickname,
          chainType: acc.chainType,
          network: acc.network,
          connectedAt: acc.metadata?.connectedAt,
          accountIndex: acc.metadata?.accountIndex
        })),
        chainId: this.currentChainId,
        timestamp: Date.now()
      };

      localStorage.setItem('coinbase-connected-accounts', JSON.stringify(connectionData));
    } catch (error) {
      console.warn('Failed to persist Coinbase connection state:', error);
    }
  }

  public clearPersistence(): void {
    localStorage.removeItem('coinbase-auto-connected');
    localStorage.removeItem('coinbase-connected-accounts');
  }

  // Check if Coinbase Wallet is installed
  public static async isCoinbaseWalletInstalled(): Promise<boolean> {
    return typeof window !== 'undefined' && (
      !!window.coinbaseWalletExtension ||
      !!injectedEthereum()?.isCoinbaseWallet ||
      (injectedEthereum() && (injectedEthereum() as any).providers &&
        (injectedEthereum() as any).providers.some((provider: any) => provider.isCoinbaseWallet))
    );
  }

  // Get Coinbase Wallet download URL
  public static getCoinbaseWalletDownloadUrl(): string {
    return 'https://www.coinbase.com/wallet';
  }
}