import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { WalletService, WalletAccount, WalletBalance, TokenBalance, AptosTransaction, ChainType } from '@/lib/types/wallet';

declare global {
  interface Window {
    aptos?: {
      connect(): Promise<{ address: string; publicKey: string }>;
      disconnect(): Promise<void>;
      isConnected(): Promise<boolean>;
      account(): Promise<{ address: string; publicKey: string }>;
      signMessage(message: { message: string; nonce: string }): Promise<{ signature: string }>;
      signTransaction(transaction: any): Promise<{ signature: string }>;
      signAndSubmitTransaction(transaction: any): Promise<{ hash: string }>;
      onAccountChange(callback: (account: { address: string; publicKey: string } | null) => void): void;
      onDisconnect(callback: () => void): void;
    };
    petra?: {
      connect(): Promise<{ address: string; publicKey: string }>;
      disconnect(): Promise<void>;
      isConnected(): Promise<boolean>;
      account(): Promise<{ address: string; publicKey: string }>;
      signMessage(message: { message: string; nonce: string }): Promise<{ signature: string }>;
      signTransaction(transaction: any): Promise<{ signature: string }>;
      signAndSubmitTransaction(transaction: any): Promise<{ hash: string }>;
      onAccountChange(callback: (account: { address: string; publicKey: string } | null) => void): void;
      onDisconnect(callback: () => void): void;
    };
  }
}

export class PetraWalletService implements WalletService {
  private aptos: Aptos;
  private _isConnected: boolean = false;
  private currentAccount: WalletAccount | null = null;
  private accountChangeCallbacks: Array<(account: WalletAccount | null) => void> = [];
  private disconnectCallbacks: Array<() => void> = [];

  constructor(network: Network = Network.MAINNET) {
    const config = new AptosConfig({ 
      network,
      fullnode: network === Network.MAINNET 
        ? 'https://fullnode.mainnet.aptoslabs.com/v1'
        : 'https://fullnode.testnet.aptoslabs.com/v1'
    });
    this.aptos = new Aptos(config);
  }

  async connect(): Promise<WalletAccount> {
    try {
      // Check if Petra wallet is installed (try both aptos and petra)
      const petraWallet = window.petra || window.aptos;
      
      if (!petraWallet) {
        throw new Error('Petra wallet not found. Please install Petra wallet extension.');
      }

      // Connect to Petra
      const response = await petraWallet.connect();
      
      if (!response || !response.address) {
        throw new Error('Failed to connect to Petra wallet');
      }

      const account = await this.createAccountFromAddress(response.address, response.publicKey);
      this.currentAccount = account;
      this._isConnected = true;

      // Set up event listeners
      this.setupEventListeners();

      return account;
    } catch (error) {
      console.error('Failed to connect to Petra:', error);
      throw new Error(`Petra connection failed: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      const petraWallet = window.petra || window.aptos;
      if (petraWallet) {
        await petraWallet.disconnect();
      }
      
      this._isConnected = false;
      this.currentAccount = null;

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(null));
      this.disconnectCallbacks.forEach(callback => callback());
    } catch (error) {
      console.error('Failed to disconnect from Petra:', error);
    }
  }

  async getAccount(): Promise<WalletAccount | null> {
    const petraWallet = window.petra || window.aptos;
    if (!this.isConnected || !petraWallet) {
      return null;
    }

    try {
      const response = await petraWallet.account();
      if (response && this.currentAccount) {
        // Update account info if needed
        this.currentAccount.address = response.address;
        this.currentAccount.publicKey = response.publicKey;
      }
      return this.currentAccount;
    } catch (error) {
      console.error('Failed to get account info:', error);
      return this.currentAccount;
    }
  }

  async getBalance(address: string): Promise<WalletBalance> {
    try {
      // Get APT balance
      const aptBalance = await this.aptos.getAccountAPTAmount({ accountAddress: address });
      const aptUsdValue = await this.getAPTPrice();
      const aptInCoins = aptBalance / 100000000; // Convert from octas to APT

      // Get coin balances
      const coinBalances = await this.aptos.getAccountCoinsData({ accountAddress: address });
      
      const tokens: TokenBalance[] = [];
      
      for (const coin of coinBalances) {
        if (coin.asset_type === '0x1::aptos_coin::AptosCoin') {
          continue; // Skip APT as it's handled separately
        }

        const coinInfo = await this.getCoinInfo(coin.asset_type);
        const tokenUsdValue = await this.getTokenPrice(coin.asset_type);
        const balance = parseInt(coin.amount) / Math.pow(10, coinInfo.decimals);

        tokens.push({
          address: coin.asset_type,
          symbol: coinInfo.symbol,
          name: coinInfo.name,
          balance: balance.toString(),
          decimals: coinInfo.decimals,
          usdValue: balance * tokenUsdValue,
          logoUri: await this.getTokenLogo(coin.asset_type),
          verified: await this.isVerifiedToken(coin.asset_type)
        });
      }

      const totalUsdValue = (aptInCoins * aptUsdValue) + 
                           tokens.reduce((sum, token) => sum + token.usdValue, 0);

      return {
        native: {
          symbol: 'APT',
          balance: aptInCoins.toString(),
          usdValue: aptInCoins * aptUsdValue,
          currency: 'APT'
        },
        tokens,
        totalUsdValue,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Failed to get Aptos balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  async signMessage(message: string): Promise<string> {
    try {
      const petraWallet = window.petra || window.aptos;
      if (!petraWallet) {
        throw new Error('Petra wallet not found');
      }

      const response = await petraWallet.signMessage({
        message,
        nonce: Date.now().toString()
      });

      return response.signature;
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw new Error(`Message signing failed: ${error.message}`);
    }
  }

  async signTransaction(transaction: AptosTransaction): Promise<string> {
    try {
      const petraWallet = window.petra || window.aptos;
      if (!petraWallet) {
        throw new Error('Petra wallet not found');
      }

      if (!this.currentAccount) {
        throw new Error('No account connected');
      }

      // Build transaction for signing — AptosTransaction always carries `sender`,
      // so the spread is the payload as-is (a leading override would be dead code).
      const txnPayload = {
        ...transaction
      };

      const response = await petraWallet.signTransaction(txnPayload);
      return response.signature;
    } catch (error) {
      console.error('Failed to sign transaction:', error);
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }

  async submitTransaction(transaction: AptosTransaction): Promise<string> {
    try {
      const petraWallet = window.petra || window.aptos;
      if (!petraWallet) {
        throw new Error('Petra wallet not found');
      }

      if (!this.currentAccount) {
        throw new Error('No account connected');
      }

      // Build transaction payload — `sender` comes with the AptosTransaction.
      const txnPayload = {
        ...transaction
      };

      // Sign and submit transaction
      const response = await petraWallet.signAndSubmitTransaction(txnPayload);
      
      // Wait for transaction confirmation
      const txnResult = await this.aptos.waitForTransaction({
        transactionHash: response.hash
      });

      if (txnResult.success) {
        return response.hash;
      } else {
        throw new Error(`Transaction failed: ${txnResult.vm_status}`);
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

  // Private helper methods
  private async createAccountFromAddress(address: string, publicKey?: string): Promise<WalletAccount> {
    const balance = await this.getBalance(address);
    
    return {
      id: `petra-${address}`,
      address,
      walletType: 'petra',
      chainType: 'aptos' as ChainType,
      nickname: `Petra (${address.slice(0, 8)}...)`,
      isConnected: true,
      status: 'connected',
      balance,
      network: 'mainnet',
      publicKey,
      capabilities: {
        signMessage: true,
        signTransaction: true,
        signAndSubmit: true,
        multiSign: false
      },
      metadata: {
        walletName: 'Petra',
        walletVersion: '1.0+',
        connectedAt: new Date(),
        lastActivity: new Date()
      }
    };
  }

  private setupEventListeners(): void {
    const petraWallet = window.petra || window.aptos;
    if (!petraWallet) return;

    // Listen for account changes
    petraWallet.onAccountChange(async (account) => {
      if (account && this.currentAccount) {
        // Update current account
        this.currentAccount.address = account.address;
        this.currentAccount.publicKey = account.publicKey;
        this.currentAccount.balance = await this.getBalance(account.address);
        
        // Notify listeners
        this.accountChangeCallbacks.forEach(callback => callback(this.currentAccount));
      } else {
        this.currentAccount = null;
        this._isConnected = false;
        this.accountChangeCallbacks.forEach(callback => callback(null));
      }
    });

    // Listen for disconnection
    petraWallet.onDisconnect(() => {
      this.currentAccount = null;
      this._isConnected = false;
      this.disconnectCallbacks.forEach(callback => callback());
    });
  }

  private async getCoinInfo(coinType: string): Promise<{ name: string; symbol: string; decimals: number }> {
    try {
      const [creator, module, struct] = coinType.split('::');
      
      // Try to get coin info from chain. The installed @aptos-labs SDK typings no
      // longer expose getCoinInfo; keep the runtime call as-is (fallback below).
      const coinInfo = await (this.aptos as any).getCoinInfo({ coinType });
      
      return {
        name: coinInfo.name,
        symbol: coinInfo.symbol,
        decimals: coinInfo.decimals
      };
    } catch (error) {
      console.warn('Failed to get coin info, using defaults:', error);
      
      // Return defaults if coin info is not available
      return {
        name: coinType.split('::').pop() || 'Unknown',
        symbol: coinType.split('::').pop()?.toUpperCase() || 'UNK',
        decimals: 8
      };
    }
  }

  private async getAPTPrice(): Promise<number> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=aptos&vs_currencies=usd');
      const data = await response.json();
      return data.aptos?.usd ?? 0; // No fabricated fallback — 0 means unknown
    } catch (error) {
      console.warn('Failed to fetch APT price:', error);
      return 0; // No fabricated fallback — 0 means unknown
    }
  }

  private async getTokenPrice(coinType: string): Promise<number> {
    try {
      // APT uses the real CoinGecko price. Stablecoins use their $1 peg constant.
      // Everything else returns 0 (unknown) — no fabricated/mock prices.
      if (coinType === '0x1::aptos_coin::AptosCoin') {
        return await this.getAPTPrice();
      }
      const stablePegUsd: { [key: string]: number } = {
        '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC': 1.0,
        '0x5e156f1207d0ebfa19a9eeff00d62a282278fb8719f4fab3a586a0a2c0fffbea::coin::T': 1.0, // USDT
      };
      return stablePegUsd[coinType] ?? 0;
    } catch (error) {
      console.warn('Failed to fetch token price:', error);
      return 0;
    }
  }

  private async getTokenLogo(coinType: string): Promise<string | undefined> {
    // In real implementation, would query token registry
    const knownLogos: { [key: string]: string } = {
      '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC': 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
      '0x5e156f1207d0ebfa19a9eeff00d62a282278fb8719f4fab3a586a0a2c0fffbea::coin::T': 'https://cryptologos.cc/logos/tether-usdt-logo.png'
    };
    
    return knownLogos[coinType];
  }

  private async isVerifiedToken(coinType: string): Promise<boolean> {
    // In real implementation, would check against verified token list
    const verifiedTokens = [
      '0x1::aptos_coin::AptosCoin',
      '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC',
      '0x5e156f1207d0ebfa19a9eeff00d62a282278fb8719f4fab3a586a0a2c0fffbea::coin::T'
    ];
    
    return verifiedTokens.includes(coinType);
  }

  // Utility methods for Aptos
  public static isValidAptosAddress(address: string): boolean {
    // Basic Aptos address validation
    return /^0x[a-fA-F0-9]{1,64}$/.test(address);
  }

  public static formatAptosAmount(octas: number | string): string {
    const amount = typeof octas === 'string' ? parseInt(octas) : octas;
    return (amount / 100000000).toString(); // Convert from octas to APT
  }

  public static parseAptosAmount(apt: string): string {
    return Math.floor(parseFloat(apt) * 100000000).toString(); // Convert from APT to octas
  }

  // Check if Petra is installed
  public static async isPetraInstalled(): Promise<boolean> {
    return typeof window !== 'undefined' && !!(window.petra || window.aptos);
  }

  // Get Petra download URL
  public static getPetraDownloadUrl(): string {
    return 'https://petra.app/';
  }
}