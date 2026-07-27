import { ethers } from 'ethers';
import { WalletService, WalletAccount, WalletBalance, TokenBalance, ChainType, InjectedEthereumProvider } from '@/lib/types/wallet';

// Ethereum Transaction Type
export interface EthereumTransaction {
  to: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  data?: string;
  nonce?: number;
  type?: number; // 0: Legacy, 1: EIP-2930, 2: EIP-1559
}

// @reown/appkit types `Window.ethereum` as `Record<string, unknown>`; cast
// through the shared EIP-1193 shape instead of re-declaring the global.
const injectedEthereum = (): InjectedEthereumProvider =>
  (typeof window === 'undefined' ? undefined : (window as { ethereum?: unknown }).ethereum) as InjectedEthereumProvider;

export class MetaMaskWalletService implements WalletService {
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
  private maxConnections: number = 15; // Support up to 15 concurrent connections
  private balanceCache: Map<string, { balance: WalletBalance; timestamp: number }> = new Map();
  private readonly BALANCE_CACHE_TTL = 30000; // 30 seconds

  constructor() {
    this.setupEventListeners();
    this.attemptReconnection();
  }

  async connect(): Promise<WalletAccount> {
    try {
      // Check if MetaMask is installed
      if (!injectedEthereum()?.isMetaMask) {
        throw new Error('MetaMask not found. Please install MetaMask browser extension.');
      }

      // Request account access - gets all available accounts
      const accounts = await injectedEthereum().request({
        method: 'eth_requestAccounts'
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found in MetaMask');
      }

      // Create provider and signer for primary account
      this.provider = new ethers.BrowserProvider(injectedEthereum());
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
          console.warn(`Could not create signer for account ${accountAddress}:`, signerError);
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

      // Return primary account
      return this.currentAccount!;
    } catch (error) {
      console.error('Failed to connect to MetaMask:', error);
      throw new Error(`MetaMask connection failed: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.provider = null;
      this.signer = null;
      this._isConnected = false;
      this.currentAccount = null;

      // Clear persistence flags when manually disconnecting
      this.clearPersistence();

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(null));
      this.disconnectCallbacks.forEach(callback => callback());
    } catch (error) {
      console.error('Failed to disconnect from MetaMask:', error);
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
        this.currentAccount = await this.createAccountFromAddress(address);
      }
      
      return this.currentAccount;
    } catch (error) {
      console.error('Failed to get account info:', error);
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

      // Get ERC-20 token balances with enhanced token discovery
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
      console.error('Failed to get Ethereum balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  async signMessage(message: string): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('MetaMask not connected');
      }

      const signature = await this.signer.signMessage(message);
      return signature;
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw new Error(`Message signing failed: ${error.message}`);
    }
  }

  async signTransaction(transaction: EthereumTransaction): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('MetaMask not connected');
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

      // Sign the transaction
      const signedTx = await this.signer.signTransaction(tx);
      return signedTx;
    } catch (error) {
      console.error('Failed to sign transaction:', error);
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }

  async submitTransaction(transaction: EthereumTransaction): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('MetaMask not connected');
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

      // Send transaction
      const txResponse = await this.signer.sendTransaction(tx);
      
      // Wait for transaction to be mined
      const receipt = await txResponse.wait();
      
      if (receipt?.status === 1) {
        return txResponse.hash;
      } else {
        throw new Error('Transaction failed');
      }
    } catch (error) {
      console.error('Failed to submit transaction:', error);
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

  // Chain management methods
  async switchChain(chainId: string): Promise<void> {
    try {
      if (!injectedEthereum()) {
        throw new Error('MetaMask not found');
      }

      await injectedEthereum().request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      });

      this.currentChainId = chainId;
      
      // Update account with new chain
      if (this.currentAccount) {
        this.currentAccount.chainType = this.getChainType(chainId);
        this.currentAccount.network = this.getNetworkName(chainId);
        this.accountChangeCallbacks.forEach(callback => callback(this.currentAccount));
      }
    } catch (error) {
      console.error('Failed to switch chain:', error);
      throw new Error(`Chain switch failed: ${error.message}`);
    }
  }

  async addChain(chainConfig: {
    chainId: string;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls?: string[];
  }): Promise<void> {
    try {
      if (!injectedEthereum()) {
        throw new Error('MetaMask not found');
      }

      await injectedEthereum().request({
        method: 'wallet_addEthereumChain',
        params: [chainConfig],
      });
    } catch (error) {
      console.error('Failed to add chain:', error);
      throw new Error(`Add chain failed: ${error.message}`);
    }
  }

  // Private helper methods
  private async createAccountFromAddress(address: string, accountIndex: number = 0): Promise<WalletAccount> {
    const balance = await this.getBalance(address);
    const chainType = this.getChainType(this.currentChainId);
    const accountId = `metamask-${address.toLowerCase()}`;

    return {
      id: accountId,
      address,
      walletType: 'metamask',
      chainType,
      nickname: `MetaMask ${accountIndex + 1} (${address.slice(0, 6)}...${address.slice(-4)})`,
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
        walletName: 'MetaMask',
        walletVersion: await this.getMetaMaskVersion(),
        connectedAt: new Date(),
        lastActivity: new Date(),
        accountIndex,
        connectionId: accountId
      }
    };
  }

  private setupEventListeners(): void {
    if (!injectedEthereum()) return;

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
        // Update connected accounts to match MetaMask's current accounts
        const currentAddresses = Array.from(this.connectedAccounts.values()).map(acc => acc.address.toLowerCase());
        const metamaskAddresses = accounts.map((addr: string) => addr.toLowerCase());

        // Remove accounts no longer available in MetaMask
        for (const [accountId, account] of this.connectedAccounts.entries()) {
          if (!metamaskAddresses.includes(account.address.toLowerCase())) {
            this.connectedAccounts.delete(accountId);
            this.connectionPool.delete(accountId);
          }
        }

        // Add new accounts from MetaMask
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
              console.warn(`Failed to add new account ${address}:`, error);
            }
          }
        }

        // Update current account if it's no longer available
        if (!this.currentAccount || !metamaskAddresses.includes(this.currentAccount.address.toLowerCase())) {
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
          console.warn(`Failed to update account ${account.id} for chain change:`, error);
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

    injectedEthereum().on('accountsChanged', handleAccountsChanged);
    injectedEthereum().on('chainChanged', handleChainChanged);
    injectedEthereum().on('disconnect', handleDisconnect);
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
        return 'ethereum'; // Default to Ethereum
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

  private async getMetaMaskVersion(): Promise<string> {
    try {
      if (!injectedEthereum()) return 'unknown';
      
      // Try to get version from MetaMask
      const version = await injectedEthereum().request({
        method: 'web3_clientVersion'
      });
      
      return version || '11.0+';
    } catch (error) {
      return '11.0+';
    }
  }

  private async getETHPrice(): Promise<number> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      return data.ethereum?.usd || 2000; // Fallback price
    } catch (error) {
      console.warn('Failed to fetch ETH price:', error);
      return 2000; // Fallback price
    }
  }

  private async getERC20Balances(address: string): Promise<TokenBalance[]> {
    try {
      if (!this.provider) return [];

      // Only query ERC-20 balances on Flare Mainnet (chainId 14).
      // Ethereum-mainnet addresses (USDC/USDT/DAI) do not exist on Flare —
      // calling them returns 0x and pollutes the console with BAD_DATA errors.
      const network = await this.provider.getNetwork();
      if (Number(network.chainId) !== 14) return [];

      // Verified Flare Mainnet token addresses only.
      // WFLR: Wrapped Flare native token — address confirmed in CLAUDE.md §10.
      // Add USDC.e / USDT0 here once their Flare addresses are verified in Flarescan.
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
              logoUri: await this.getTokenLogo(tokenInfo.symbol),
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

  private async getTokenLogo(symbol: string): Promise<string | undefined> {
    const knownLogos: { [key: string]: string } = {
      'USDC': 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
      'USDT': 'https://cryptologos.cc/logos/tether-usdt-logo.png',
      'DAI': 'https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.png'
    };
    
    return knownLogos[symbol.toUpperCase()];
  }

  // Utility methods for Ethereum
  public static isValidEthereumAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  public static formatEthAmount(wei: string): string {
    return ethers.formatEther(wei);
  }

  public static parseEthAmount(eth: string): string {
    return ethers.parseEther(eth).toString();
  }

  // Check if MetaMask is installed
  public static async isMetaMaskInstalled(): Promise<boolean> {
    return typeof window !== 'undefined' && !!injectedEthereum()?.isMetaMask;
  }

  // Get MetaMask download URL
  public static getMetaMaskDownloadUrl(): string {
    return 'https://metamask.io/download/';
  }

  // Get current chain info
  public getCurrentChain(): { chainId: string; chainType: ChainType; network: string } {
    return {
      chainId: this.currentChainId,
      chainType: this.getChainType(this.currentChainId),
      network: this.getNetworkName(this.currentChainId)
    };
  }

  // Auto-reconnection functionality
  private async attemptReconnection(): Promise<void> {
    try {
      if (!injectedEthereum()?.isMetaMask) return;

      // Check if previously connected by looking at localStorage
      const persistedData = localStorage.getItem('defibro-wallet-store');
      if (!persistedData) return;

      const parsed = JSON.parse(persistedData);
      const hasMetaMaskWallet = parsed?.state?.wallets?.some((wallet: any) =>
        wallet.walletType === 'metamask' && wallet.isConnected
      );

      if (!hasMetaMaskWallet) return;

      // Check if MetaMask still has accounts connected
      const accounts = await injectedEthereum().request({
        method: 'eth_accounts'
      });

      if (accounts && accounts.length > 0) {
        // Silent reconnection - don't prompt user
        this.provider = new ethers.BrowserProvider(injectedEthereum());

        const network = await this.provider.getNetwork();
        this.currentChainId = `0x${network.chainId.toString(16)}`;

        // Restore all previously connected accounts
        await this.restoreConnectionState();

        // If no accounts were restored, reconnect the primary account
        if (this.connectedAccounts.size === 0) {
          const primaryAccount = await this.createAccountFromAddress(accounts[0], 0);
          this.currentAccount = primaryAccount;
          this.connectedAccounts.set(primaryAccount.id, primaryAccount);

          // Create signer for primary account
          this.signer = await this.provider.getSigner();
          this.connectionPool.set(primaryAccount.id, {
            provider: this.provider,
            signer: this.signer,
            lastActivity: new Date(),
            isActive: true
          });
        } else {
          // Set first restored account as primary
          const accounts = this.getConnectedAccounts();
          this.currentAccount = accounts[0];
          const primaryConnection = this.connectionPool.get(accounts[0].id);
          if (primaryConnection) {
            this.signer = primaryConnection.signer;
          }
        }

        this._isConnected = true;

        // Store connection persistence flag
        localStorage.setItem('metamask-auto-connected', 'true');

        // Notify listeners
        this.getConnectedAccounts().forEach(account => {
          this.accountChangeCallbacks.forEach(callback => callback(account));
        });

        console.log(`MetaMask auto-reconnected successfully with ${this.connectedAccounts.size} accounts`);
      }
    } catch (error) {
      console.warn('Auto-reconnection failed:', error);
      // Clear any stale connection state
      localStorage.removeItem('metamask-auto-connected');
      localStorage.removeItem('metamask-connected-accounts');
    }
  }

  // Enhanced connection method with persistence
  async connectWithPersistence(): Promise<WalletAccount> {
    const account = await this.connect();
    
    // Mark this connection as persistent
    localStorage.setItem('metamask-auto-connected', 'true');
    localStorage.setItem('metamask-last-connected', Date.now().toString());
    
    return account;
  }

  // Check if should auto-reconnect
  public shouldAutoReconnect(): boolean {
    const autoConnected = localStorage.getItem('metamask-auto-connected');
    const lastConnected = localStorage.getItem('metamask-last-connected');
    
    if (!autoConnected || !lastConnected) return false;
    
    // Auto-reconnect within 7 days of last connection
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    const timeSinceLastConnection = Date.now() - parseInt(lastConnected);
    
    return timeSinceLastConnection < sevenDaysInMs;
  }

  // Clear persistence flags
  public clearPersistence(): void {
    localStorage.removeItem('metamask-auto-connected');
    localStorage.removeItem('metamask-last-connected');
    localStorage.removeItem('metamask-connected-accounts');
    localStorage.removeItem('metamask-connection-pool');
  }

  // Enhanced multi-account methods
  public getConnectedAccounts(): WalletAccount[] {
    return Array.from(this.connectedAccounts.values());
  }

  public getAccountById(accountId: string): WalletAccount | null {
    return this.connectedAccounts.get(accountId) || null;
  }

  public async connectAdditionalAccount(): Promise<WalletAccount | null> {
    try {
      if (!injectedEthereum()?.isMetaMask) {
        throw new Error('MetaMask not found');
      }

      // Request additional accounts
      const accounts = await injectedEthereum().request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }]
      });

      const newAccounts = await injectedEthereum().request({
        method: 'eth_accounts'
      });

      // Find new accounts not in our current pool
      const existingAddresses = Array.from(this.connectedAccounts.values()).map(acc => acc.address.toLowerCase());
      const newAccount = newAccounts.find((addr: string) => !existingAddresses.includes(addr.toLowerCase()));

      if (newAccount) {
        const accountIndex = this.connectedAccounts.size;
        const account = await this.createAccountFromAddress(newAccount, accountIndex);

        this.connectedAccounts.set(account.id, account);

        // Create signer for new account
        try {
          const accountSigner = await this.provider!.getSigner(newAccount);
          this.connectionPool.set(account.id, {
            provider: this.provider!,
            signer: accountSigner,
            lastActivity: new Date(),
            isActive: true
          });
        } catch (error) {
          console.warn(`Could not create signer for new account ${newAccount}:`, error);
        }

        // Update persistence
        this.persistConnectionState(this.getConnectedAccounts());

        // Notify listeners
        this.accountChangeCallbacks.forEach(callback => callback(account));

        return account;
      }

      return null;
    } catch (error) {
      console.error('Failed to connect additional account:', error);
      return null;
    }
  }

  public async disconnectAccount(accountId: string): Promise<void> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) return;

    // Remove from pools
    this.connectedAccounts.delete(accountId);
    this.connectionPool.delete(accountId);

    // Clear from cache
    const cacheKeys = Array.from(this.balanceCache.keys()).filter(key => key.startsWith(account.address));
    cacheKeys.forEach(key => this.balanceCache.delete(key));

    // Update persistence
    this.persistConnectionState(this.getConnectedAccounts());

    // If this was the active account, switch to another one
    if (this.currentAccount?.id === accountId) {
      const remainingAccounts = this.getConnectedAccounts();
      this.currentAccount = remainingAccounts.length > 0 ? remainingAccounts[0] : null;
    }

    // Notify listeners
    this.accountChangeCallbacks.forEach(callback => callback(null));
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

      localStorage.setItem('metamask-connected-accounts', JSON.stringify(connectionData));
    } catch (error) {
      console.warn('Failed to persist connection state:', error);
    }
  }

  private async restoreConnectionState(): Promise<void> {
    try {
      const storedData = localStorage.getItem('metamask-connected-accounts');
      if (!storedData) return;

      const connectionData = JSON.parse(storedData);
      if (!connectionData.accounts || Date.now() - connectionData.timestamp > 7 * 24 * 60 * 60 * 1000) {
        // Data too old, clear it
        localStorage.removeItem('metamask-connected-accounts');
        return;
      }

      // Verify accounts are still accessible
      const currentAccounts = await injectedEthereum()?.request({ method: 'eth_accounts' }) || [];

      for (const storedAccount of connectionData.accounts) {
        if (currentAccounts.includes(storedAccount.address)) {
          try {
            const account = await this.createAccountFromAddress(storedAccount.address, storedAccount.accountIndex);
            account.nickname = storedAccount.nickname || account.nickname;

            this.connectedAccounts.set(account.id, account);

            // Restore signer
            const accountSigner = await this.provider!.getSigner(storedAccount.address);
            this.connectionPool.set(account.id, {
              provider: this.provider!,
              signer: accountSigner,
              lastActivity: new Date(),
              isActive: true
            });
          } catch (error) {
            console.warn(`Failed to restore account ${storedAccount.address}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to restore connection state:', error);
    }
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
        console.warn(`Failed to refresh balance for account ${account.id}:`, error);
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

  private getNativeSymbol(): string {
    const chainType = this.getChainType(this.currentChainId);
    switch (chainType) {
      case 'polygon': return 'MATIC';
      case 'arbitrum': return 'ETH';
      default: return 'ETH';
    }
  }

  public async signTransactionForAccount(accountId: string, transaction: EthereumTransaction): Promise<string> {
    const connection = this.connectionPool.get(accountId);
    if (!connection || !connection.signer) {
      throw new Error(`No active connection for account ${accountId}`);
    }

    try {
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

      const signedTx = await connection.signer.signTransaction(tx);

      // Update activity
      connection.lastActivity = new Date();

      return signedTx;
    } catch (error) {
      console.error(`Failed to sign transaction for account ${accountId}:`, error);
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }

  public async submitTransactionForAccount(accountId: string, transaction: EthereumTransaction): Promise<string> {
    const connection = this.connectionPool.get(accountId);
    if (!connection || !connection.signer) {
      throw new Error(`No active connection for account ${accountId}`);
    }

    try {
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

      const txResponse = await connection.signer.sendTransaction(tx);
      const receipt = await txResponse.wait();

      // Update activity
      connection.lastActivity = new Date();

      if (receipt?.status === 1) {
        return txResponse.hash;
      } else {
        throw new Error('Transaction failed');
      }
    } catch (error) {
      console.error(`Failed to submit transaction for account ${accountId}:`, error);
      throw new Error(`Transaction submission failed: ${error.message}`);
    }
  }
}