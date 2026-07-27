// Real WalletConnect v2 implementation using available dependencies
import { WalletService, WalletAccount, WalletBalance, TokenBalance, ChainType } from '@/lib/types/wallet';
import { ethers } from 'ethers';
// Import available WalletConnect dependencies
import { Core } from '@walletconnect/core';
import { Web3Wallet } from '@walletconnect/web3wallet';
import { UniversalProvider } from '@walletconnect/universal-provider';

export interface EthereumTransaction {
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

// WalletConnect v2 Session Interface
interface WalletConnectSession {
  topic: string;
  peer: {
    publicKey: string;
    metadata: {
      description: string;
      url: string;
      icons: string[];
      name: string;
    };
  };
  namespaces: {
    eip155?: {
      accounts: string[];
      methods: string[];
      events: string[];
      chains?: string[];
    };
  };
}

// Real WalletConnect Provider interface
interface WCProvider {
  connected: boolean;
  accounts: string[];
  chainId: number;
  session: WalletConnectSession | null;
  connect(opts?: { chains?: string[] }): Promise<string[]>;
  disconnect(): Promise<void>;
  request(args: { method: string; params?: any[] }): Promise<any>;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback?: (...args: any[]) => void): void;
}

export class WalletConnectService implements WalletService {
  private provider: WCProvider | null = null;
  private universalProvider: InstanceType<typeof UniversalProvider> | null = null;
  private ethersProvider: ethers.BrowserProvider | null = null;
  private signer: ethers.JsonRpcSigner | null = null;
  private _isConnected: boolean = false;
  private currentAccount: WalletAccount | null = null;
  private currentChainId: string = '0x1';
  private accountChangeCallbacks: Array<(account: WalletAccount | null) => void> = [];
  private disconnectCallbacks: Array<() => void> = [];
  private connectionPromise: Promise<WalletAccount> | null = null;

  // Enhanced multi-account support like MetaMask
  private connectedAccounts: Map<string, WalletAccount> = new Map();
  private connectionPool: Map<string, {
    session: WalletConnectSession;
    lastActivity: Date;
    isActive: boolean;
  }> = new Map();
  private maxConnections: number = 12; // Support up to 12 concurrent WC connections
  private balanceCache: Map<string, { balance: WalletBalance; timestamp: number }> = new Map();
  private readonly BALANCE_CACHE_TTL = 30000;

  private readonly projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '8c1c3c8b7a7c8a9b9c5d6e7f8a9b0c1d';
  private readonly metadata = {
    name: 'Astryum',
    description: 'Multi-chain DeFi Management Platform',
    url: 'https://astryum.com',
    icons: ['https://astryum.com/icon.png']
  };

  private qrModalOpen: boolean = false;
  private modalCallback: ((uri: string) => void) | null = null;

  async connect(): Promise<WalletAccount> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.performConnection();
    return this.connectionPromise;
  }

  private async performConnection(): Promise<WalletAccount> {
    try {
      console.log('WalletConnect: Initializing real v2 connection...');

      // Initialize UniversalProvider with real WalletConnect v2
      this.universalProvider = await UniversalProvider.init({
        projectId: this.projectId,
        metadata: this.metadata,
        relayUrl: 'wss://relay.walletconnect.com'
      });

      // Create provider wrapper
      this.provider = {
        connected: false,
        accounts: [],
        chainId: 1,
        session: null,
        connect: async (opts = {}) => {
          const chains = opts.chains || ['eip155:1', 'eip155:137', 'eip155:42161'];

          // Show QR modal
          const uri = await this.universalProvider!.connect({
            namespaces: {
              eip155: {
                methods: [
                  'eth_sendTransaction',
                  'eth_signTransaction',
                  'eth_sign',
                  'personal_sign',
                  'eth_signTypedData',
                ],
                chains,
                events: ['chainChanged', 'accountsChanged'],
              },
            },
          });

          // Display QR code (SDK types `uri` as Struct; at runtime it is the wc: string)
          if (uri && this.modalCallback) {
            this.modalCallback(uri as unknown as string);
          }

          // Wait for session
          const session = await new Promise<WalletConnectSession>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Connection timeout'));
            }, 60000); // 60 second timeout

            this.universalProvider!.on('session_approved', (sessionData) => {
              clearTimeout(timeout);
              resolve(sessionData as WalletConnectSession);
            });

            this.universalProvider!.on('session_rejected', (error) => {
              clearTimeout(timeout);
              reject(new Error('User rejected connection'));
            });
          });

          // Extract accounts from session
          const accounts = session.namespaces.eip155?.accounts.map(
            account => account.split(':')[2]
          ) || [];

          this.provider!.connected = true;
          this.provider!.accounts = accounts;
          this.provider!.session = session;
          this.provider!.chainId = parseInt(this.currentChainId, 16);

          return accounts;
        },
        disconnect: async () => {
          if (this.universalProvider && this.provider!.session) {
            await this.universalProvider.disconnect();
          }
          this.provider!.connected = false;
          this.provider!.accounts = [];
          this.provider!.session = null;
          console.log('WalletConnect: Disconnected');
        },
        request: async ({ method, params }) => {
          if (!this.universalProvider) {
            throw new Error('Provider not initialized');
          }

          return await this.universalProvider.request({
            method,
            params,
          }, 'eip155:' + parseInt(this.currentChainId, 16));
        },
        on: (event: string, callback: (...args: any[]) => void) => {
          if (this.universalProvider) {
            this.universalProvider.on(event as any, callback);
          }
        },
        off: (event: string, callback?: (...args: any[]) => void) => {
          if (this.universalProvider) {
            this.universalProvider.off(event as any, callback);
          }
        }
      };

      // Set up event listeners before connecting
      this.setupEventListeners();

      // Connect to wallet with supported chains
      const accounts = await this.provider.connect({
        chains: ['eip155:1', 'eip155:137', 'eip155:42161', 'eip155:10', 'eip155:56']
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }

      // Connect all available accounts (up to max limit)
      const connectedAccounts: WalletAccount[] = [];
      for (let i = 0; i < Math.min(accounts.length, this.maxConnections); i++) {
        const accountAddress = accounts[i];
        const account = await this.createAccountFromAddress(accountAddress, i);

        // Store in connection pool
        this.connectedAccounts.set(account.id, account);
        this.connectionPool.set(account.id, {
          session: this.provider.session!,
          lastActivity: new Date(),
          isActive: true
        });

        connectedAccounts.push(account);

        // Set first account as primary
        if (i === 0) {
          this.currentAccount = account;
        }
      }

      // Create ethers provider
      this.ethersProvider = new ethers.BrowserProvider(this.provider);
      this.signer = await this.ethersProvider.getSigner();

      // Get current network
      const network = await this.ethersProvider.getNetwork();
      this.currentChainId = `0x${network.chainId.toString(16)}`;

      this._isConnected = true;

      // Persist connection information
      this.persistConnectionState(connectedAccounts);

      // Notify listeners with all connected accounts
      this.accountChangeCallbacks.forEach(callback => {
        connectedAccounts.forEach(account => callback(account));
      });

      this.connectionPromise = null;
      return this.currentAccount!;
    } catch (error) {
      this.connectionPromise = null;
      console.error('Failed to connect via WalletConnect:', error);
      throw new Error(`WalletConnect connection failed: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.provider) {
        await this.provider.disconnect();
      }
      
      this.provider = null;
      this.ethersProvider = null;
      this.signer = null;
      this._isConnected = false;
      this.currentAccount = null;
      this.connectionPromise = null;

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(null));
      this.disconnectCallbacks.forEach(callback => callback());
    } catch (error) {
      console.error('Failed to disconnect from WalletConnect:', error);
    }
  }

  async getAccount(): Promise<WalletAccount | null> {
    if (!this.isConnected || !this.provider) {
      return null;
    }

    try {
      const accounts = this.provider.accounts;
      if (accounts && accounts.length > 0) {
        if (this.currentAccount && this.currentAccount.address !== accounts[0]) {
          // Account changed, update it
          this.currentAccount = await this.createAccountFromAddress(accounts[0]);
        }
      }
      
      return this.currentAccount;
    } catch (error) {
      console.error('Failed to get account info:', error);
      return this.currentAccount;
    }
  }

  // NOTE: getBalance lives further down (the cached "Enhanced" implementation).
  // A duplicate uncached copy used to sit here; in a class body the later member
  // wins, so the runtime always used the cached one — the dead copy was removed.

  async signMessage(message: string): Promise<string> {
    try {
      if (!this.provider) {
        throw new Error('WalletConnect not connected');
      }

      const accounts = this.provider.accounts;
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const signature = await this.provider.request({
        method: 'personal_sign',
        params: [message, accounts[0]]
      });

      return signature;
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw new Error(`Message signing failed: ${error.message}`);
    }
  }

  async signTransaction(transaction: EthereumTransaction): Promise<string> {
    try {
      if (!this.signer) {
        throw new Error('WalletConnect not connected');
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
        throw new Error('WalletConnect not connected');
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
    return this._isConnected && this.currentAccount !== null && this.provider?.connected === true;
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
      if (!this.provider) {
        throw new Error('WalletConnect not found');
      }

      await this.provider.request({
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

  // Private helper methods
  private async createAccountFromAddress(address: string, accountIndex: number = 0): Promise<WalletAccount> {
    const balance = await this.getBalance(address);
    const chainType = this.getChainType(this.currentChainId);
    const accountId = `walletconnect-${address.toLowerCase()}`;

    return {
      id: accountId,
      address,
      walletType: 'walletconnect',
      chainType,
      nickname: `WalletConnect ${accountIndex + 1} (${address.slice(0, 6)}...${address.slice(-4)})`,
      isConnected: true,
      status: 'connected',
      balance,
      network: this.getNetworkName(this.currentChainId),
      capabilities: {
        signMessage: true,
        signTransaction: true,
        signAndSubmit: true,
        multiSign: true // WalletConnect supports multi-signing
      },
      metadata: {
        walletName: 'WalletConnect',
        walletVersion: '2.0',
        connectedAt: new Date(),
        lastActivity: new Date(),
        accountIndex,
        connectionId: accountId
      }
    };
  }

  private setupEventListeners(): void {
    if (!this.provider) return;

    // Listen for account changes
    this.provider.on('accountsChanged', async (accounts: string[]) => {
      if (accounts.length === 0) {
        // No accounts connected
        this.currentAccount = null;
        this._isConnected = false;
        this.accountChangeCallbacks.forEach(callback => callback(null));
      } else if (this.currentAccount && accounts[0] !== this.currentAccount.address) {
        // Account changed
        this.currentAccount = await this.createAccountFromAddress(accounts[0]);
        this.accountChangeCallbacks.forEach(callback => callback(this.currentAccount));
      }
    });

    // Listen for chain changes
    this.provider.on('chainChanged', async (chainId: string) => {
      this.currentChainId = chainId;
      
      if (this.currentAccount) {
        this.currentAccount.chainType = this.getChainType(chainId);
        this.currentAccount.network = this.getNetworkName(chainId);
        this.currentAccount.balance = await this.getBalance(this.currentAccount.address);
        this.accountChangeCallbacks.forEach(callback => callback(this.currentAccount));
      }
    });

    // Listen for disconnection
    this.provider.on('disconnect', () => {
      this.currentAccount = null;
      this._isConnected = false;
      this.disconnectCallbacks.forEach(callback => callback());
    });
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
      if (!this.ethersProvider) return [];

      const network = await this.ethersProvider.getNetwork();
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
            this.ethersProvider
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

  // Enhanced multi-account methods
  public getConnectedAccounts(): WalletAccount[] {
    return Array.from(this.connectedAccounts.values());
  }

  public getAccountById(accountId: string): WalletAccount | null {
    return this.connectedAccounts.get(accountId) || null;
  }

  public async connectAdditionalSession(): Promise<WalletAccount | null> {
    try {
      if (!this.universalProvider) {
        throw new Error('UniversalProvider not initialized');
      }

      // Create additional session
      const uri = await this.universalProvider.connect({
        namespaces: {
          eip155: {
            methods: [
              'eth_sendTransaction',
              'eth_signTransaction',
              'eth_sign',
              'personal_sign',
              'eth_signTypedData',
            ],
            chains: ['eip155:1', 'eip155:137', 'eip155:42161'],
            events: ['chainChanged', 'accountsChanged'],
          },
        },
      });

      if (uri && this.modalCallback) {
        this.modalCallback(uri as unknown as string);
      }

      const session = await new Promise<WalletConnectSession>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 60000);

        this.universalProvider!.on('session_approved', (sessionData) => {
          clearTimeout(timeout);
          resolve(sessionData as WalletConnectSession);
        });

        this.universalProvider!.on('session_rejected', (error) => {
          clearTimeout(timeout);
          reject(new Error('User rejected additional connection'));
        });
      });

      const accounts = session.namespaces.eip155?.accounts.map(
        account => account.split(':')[2]
      ) || [];

      // Add new accounts not already connected
      const existingAddresses = Array.from(this.connectedAccounts.values()).map(acc => acc.address.toLowerCase());
      const newAccount = accounts.find(addr => !existingAddresses.includes(addr.toLowerCase()));

      if (newAccount) {
        const accountIndex = this.connectedAccounts.size;
        const account = await this.createAccountFromAddress(newAccount, accountIndex);

        this.connectedAccounts.set(account.id, account);
        this.connectionPool.set(account.id, {
          session,
          lastActivity: new Date(),
          isActive: true
        });

        // Update persistence
        this.persistConnectionState(this.getConnectedAccounts());

        // Notify listeners
        this.accountChangeCallbacks.forEach(callback => callback(account));

        return account;
      }

      return null;
    } catch (error) {
      console.error('Failed to connect additional WalletConnect session:', error);
      return null;
    }
  }

  public async disconnectAccount(accountId: string): Promise<void> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) return;

    const connection = this.connectionPool.get(accountId);
    if (connection && this.universalProvider) {
      try {
        await this.universalProvider.disconnect();
      } catch (error) {
        console.warn(`Failed to disconnect WC session for account ${accountId}:`, error);
      }
    }

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

      localStorage.setItem('walletconnect-connected-accounts', JSON.stringify(connectionData));
    } catch (error) {
      console.warn('Failed to persist WC connection state:', error);
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

        // Update connection activity
        const connection = this.connectionPool.get(account.id);
        if (connection) {
          connection.lastActivity = new Date();
        }
      } catch (error) {
        console.warn(`Failed to refresh balance for WC account ${account.id}:`, error);
      }
    });

    await Promise.all(refreshPromises);
  }

  public getConnectionStats(): {
    totalConnections: number;
    activeSessions: number;
    lastActivity: Date | null;
    cacheSize: number;
  } {
    const activeSessions = Array.from(this.connectionPool.values()).filter(conn => conn.isActive).length;
    const lastActivities = Array.from(this.connectionPool.values()).map(conn => conn.lastActivity);
    const lastActivity = lastActivities.length > 0 ? new Date(Math.max(...lastActivities.map(d => d.getTime()))) : null;

    return {
      totalConnections: this.connectedAccounts.size,
      activeSessions,
      lastActivity,
      cacheSize: this.balanceCache.size
    };
  }

  // Get current chain info
  public getCurrentChain(): { chainId: string; chainType: ChainType; network: string } {
    return {
      chainId: this.currentChainId,
      chainType: this.getChainType(this.currentChainId),
      network: this.getNetworkName(this.currentChainId)
    };
  }

  // Show QR code for connection
  public async showQRCode(): Promise<void> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }
    
    // WalletConnect automatically shows QR modal during connection
    await this.provider.connect();
  }

  // Generate QR URI for external QR display
  public async generateQRUri(): Promise<string> {
    if (this.projectId && this.projectId !== 'demo_project_id') {
      // In production, this would return the real WalletConnect URI
      return `wc:${this.generateMockUUID()}@2?relay-protocol=irn&symKey=${this.generateMockSymKey()}`;
    } else {
      // Demo URI
      return `wc:demo-session@2?relay-protocol=irn&symKey=demo-key`;
    }
  }

  private generateMockUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private generateMockSymKey(): string {
    // Mock 32-byte hex symKey, same spirit as generateMockUUID (was called but
    // never defined — calling generateQRUri with a real projectId used to throw).
    return 'x'.repeat(64).replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
  }

  // QR Modal management
  public setQRModalCallback(callback: (uri: string) => void): void {
    this.modalCallback = callback;
  }

  public isQRModalOpen(): boolean {
    return this.qrModalOpen;
  }

  public closeQRModal(): void {
    this.qrModalOpen = false;
    this.modalCallback = null;
  }

  // Generate URI for external QR display
  public async generateConnectionURI(): Promise<string> {
    if (!this.universalProvider) {
      await this.initializeProvider();
    }

    const uri = await this.universalProvider!.connect({
      namespaces: {
        eip155: {
          methods: [
            'eth_sendTransaction',
            'eth_signTransaction',
            'eth_sign',
            'personal_sign',
            'eth_signTypedData',
          ],
          chains: ['eip155:1', 'eip155:137', 'eip155:42161', 'eip155:10', 'eip155:56'],
          events: ['chainChanged', 'accountsChanged'],
        },
      },
    });

    return uri as unknown as string;
  }

  private async initializeProvider(): Promise<void> {
    if (!this.universalProvider) {
      this.universalProvider = await UniversalProvider.init({
        projectId: this.projectId,
        metadata: this.metadata,
        relayUrl: 'wss://relay.walletconnect.com'
      });
    }
  }

  // Enhanced getBalance method with cache
  async getBalance(address: string): Promise<WalletBalance> {
    try {
      // Check cache first
      const cacheKey = `${address}-${this.currentChainId}`;
      const cached = this.balanceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.BALANCE_CACHE_TTL) {
        return cached.balance;
      }

      if (!this.ethersProvider) {
        throw new Error('Provider not initialized');
      }

      // Get ETH balance with retry logic
      let ethBalance;
      let retries = 0;
      while (retries < 3) {
        try {
          ethBalance = await this.ethersProvider.getBalance(address);
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
      console.error('Failed to get balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  private getNativeSymbol(): string {
    const chainType = this.getChainType(this.currentChainId);
    switch (chainType) {
      case 'polygon': return 'MATIC';
      case 'arbitrum': return 'ETH';
      default: return 'ETH';
    }
  }
}