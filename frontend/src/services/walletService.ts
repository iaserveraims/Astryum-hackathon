import { WalletType, WalletAccount, WalletError, WalletService, Portfolio } from '../lib/types/wallet';
import { WalletServiceFactory } from './wallets/WalletServiceFactory';
import { useWalletStore } from '../stores/walletStore';
import { walletApiService } from './api/walletApiService';

class UnifiedWalletService {
  private walletServices = new Map<string, WalletService>();
  private store = useWalletStore;

  async connectWallet(walletType: WalletType): Promise<WalletAccount | null> {
    const { setIsConnecting, setError, addWallet, setActiveWallet } = this.store.getState();
    
    setIsConnecting(true);
    setError(null);

    try {
      if (!WalletServiceFactory.isWalletSupported(walletType)) {
        throw new Error(`Wallet type ${walletType} is not supported`);
      }

      const isAvailable = await WalletServiceFactory.isWalletAvailable(walletType);
      if (!isAvailable) {
        const downloadUrl = WalletServiceFactory.getWalletDownloadUrl(walletType);
        throw new Error(
          `${walletType} wallet not found. Please install it first.${
            downloadUrl ? ` Download: ${downloadUrl}` : ''
          }`
        );
      }

      const service = WalletServiceFactory.getWalletService(walletType);
      const state = this.store.getState();
      const existingWallet = state.wallets.find(w => w.walletType === walletType && w.isConnected);

      // The persisted store says "connected" after every reload, but that's
      // only real if the SERVICE also holds a live session — returning the
      // stale wallet here was a phantom reconnect (no QR, no session) that
      // later broke signing. Xaman never short-circuits: pressing connect
      // must always run the sign-in flow and show the QR.
      if (existingWallet && walletType !== 'xaman' && service.isConnected?.()) {
        setActiveWallet(existingWallet);
        return existingWallet;
      }

      // Use enhanced persistence connection for MetaMask
      let account: WalletAccount;
      if (walletType === 'metamask' && 'connectWithPersistence' in service) {
        account = await (service as any).connectWithPersistence();
      } else {
        account = await service.connect();
      }

      service.onAccountChange?.((updatedAccount) => {
        if (updatedAccount) {
          addWallet(updatedAccount);
          const currentState = this.store.getState();
          if (currentState.activeWallet?.id === updatedAccount.id) {
            setActiveWallet(updatedAccount);
          }
        }
      });

      service.onDisconnect?.(() => {
        const currentState = this.store.getState();
        const updatedWallet = currentState.wallets.find(w => w.walletType === walletType);
        if (updatedWallet) {
          addWallet({ ...updatedWallet, isConnected: false, status: 'disconnected' });
        }
        if (currentState.activeWallet?.walletType === walletType) {
          setActiveWallet(null);
        }
        this.walletServices.delete(account.id);
      });

      addWallet(account);
      setActiveWallet(account);
      this.walletServices.set(account.id, service);

      // Sync with backend
      try {
        await walletApiService.connectWallet({
          walletType: walletType as 'xaman' | 'petra' | 'metamask' | 'walletconnect',
          address: account.address,
          network: account.network,
          metadata: {
            walletName: account.metadata?.walletName,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
          }
        });
      } catch (error) {
        console.warn('Failed to sync wallet connection with backend:', error);
        // Don't fail the connection if backend sync fails
      }

      return account;
    } catch (err: any) {
      const walletError: WalletError = {
        code: 'CONNECTION_FAILED',
        message: err.message || `Failed to connect to ${walletType}`,
        details: err,
        timestamp: new Date(),
        walletType
      };
      
      setError(walletError);
      console.error('Wallet connection failed:', err);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }

  async disconnectWallet(walletId: string): Promise<void> {
    const { removeWallet, setActiveWallet, setError } = this.store.getState();
    
    try {
      const state = this.store.getState();
      const wallet = state.wallets.find(w => w.id === walletId);
      
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const service = this.walletServices.get(walletId);
      if (service) {
        // Clear enhanced persistence flags for MetaMask
        if (wallet.walletType === 'metamask' && 'clearPersistence' in service) {
          (service as any).clearPersistence();
        }
        await service.disconnect();
        this.walletServices.delete(walletId);
      }

      removeWallet(walletId);
      
      if (state.activeWallet?.id === walletId) {
        setActiveWallet(null);
      }

      // Sync with backend
      try {
        await walletApiService.disconnectWallet(walletId);
      } catch (error) {
        console.warn('Failed to sync wallet disconnection with backend:', error);
      }
    } catch (err: any) {
      const walletError: WalletError = {
        code: 'DISCONNECTION_FAILED',
        message: err.message || 'Failed to disconnect wallet',
        details: err,
        timestamp: new Date()
      };
      
      setError(walletError);
      console.error('Wallet disconnection failed:', err);
    }
  }

  async refreshBalances(): Promise<void> {
    const { setError, updateWallet, setActiveWallet } = this.store.getState();
    const state = this.store.getState();

    try {
      const connectedWallets = state.wallets.filter(w => w.isConnected);

      const refreshPromises = connectedWallets.map(async (wallet) => {
        try {
          const service = this.walletServices.get(wallet.id);
          if (service) {
            const updatedBalance = await service.getBalance(wallet.address);
            const updatedWallet = {
              ...wallet,
              balance: updatedBalance,
              metadata: {
                ...wallet.metadata,
                lastActivity: new Date()
              }
            };

            updateWallet(wallet.id, updatedWallet);

            if (state.activeWallet?.id === wallet.id) {
              setActiveWallet(updatedWallet);
            }
          }
        } catch (error) {
          console.error(`Failed to refresh balance for ${wallet.id}:`, error);
        }
      });

      await Promise.all(refreshPromises);
      this.updatePortfolio();
    } catch (error) {
      console.error('Failed to refresh balances:', error);
      setError({
        code: 'BALANCE_REFRESH_FAILED',
        message: 'Failed to refresh wallet balances',
        details: error,
        timestamp: new Date()
      });
    }
  }

  async refreshWalletBalance(walletId: string): Promise<void> {
    const { setError, updateWallet, setActiveWallet } = this.store.getState();
    const state = this.store.getState();

    try {
      const wallet = state.wallets.find(w => w.id === walletId && w.isConnected);
      if (!wallet) {
        throw new Error('Wallet not found or not connected');
      }

      const service = this.walletServices.get(walletId);
      if (!service) {
        throw new Error('Wallet service not found');
      }

      const updatedBalance = await service.getBalance(wallet.address);
      const updatedWallet = {
        ...wallet,
        balance: updatedBalance,
        metadata: {
          ...wallet.metadata,
          lastActivity: new Date()
        }
      };

      updateWallet(walletId, updatedWallet);

      if (state.activeWallet?.id === walletId) {
        setActiveWallet(updatedWallet);
      }

      this.updatePortfolio();
    } catch (error) {
      console.error(`Failed to refresh balance for wallet ${walletId}:`, error);
      setError({
        code: 'BALANCE_REFRESH_FAILED',
        message: `Failed to refresh balance for wallet ${walletId}`,
        details: error,
        timestamp: new Date()
      });
    }
  }

  private updatePortfolio(): void {
    const { setPortfolio } = this.store.getState();
    const state = this.store.getState();
    const connectedWallets = state.wallets.filter(w => w.isConnected);
    
    if (connectedWallets.length === 0) {
      setPortfolio(null);
      return;
    }

    const totalValue = connectedWallets.reduce((sum, wallet) => 
      sum + wallet.balance.totalUsdValue, 0
    );

    const breakdown: { [chainType: string]: any } = {};
    const allTokens: any[] = [];

    connectedWallets.forEach(wallet => {
      const chainType = wallet.chainType;
      
      if (!breakdown[chainType]) {
        breakdown[chainType] = {
          value: 0,
          percentage: 0,
          tokens: []
        };
      }

      breakdown[chainType].value += wallet.balance.totalUsdValue;
      breakdown[chainType].tokens.push(...wallet.balance.tokens);
      
      allTokens.push({
        ...wallet.balance.native,
        address: 'native',
        name: `${wallet.balance.native.symbol} (${wallet.chainType})`,
        decimals: 6
      });
      
      allTokens.push(...wallet.balance.tokens);
    });

    Object.keys(breakdown).forEach(chainType => {
      breakdown[chainType].percentage = totalValue > 0 
        ? (breakdown[chainType].value / totalValue) * 100 
        : 0;
    });

    const topTokens = allTokens
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, 10);

    const portfolioData: Portfolio = {
      totalValue,
      totalValueChange24h: 0,
      wallets: connectedWallets,
      breakdown,
      topTokens,
      lastUpdated: new Date()
    };

    setPortfolio(portfolioData);
  }

  setActiveWallet(walletId: string): void {
    const { setActiveWallet } = this.store.getState();
    const state = this.store.getState();
    const wallet = state.wallets.find(w => w.id === walletId && w.isConnected);
    
    if (wallet) {
      setActiveWallet(wallet);
    }
  }

  clearError(): void {
    const { clearError } = this.store.getState();
    clearError();
  }

  isWalletSupported(walletType: WalletType): boolean {
    return WalletServiceFactory.isWalletSupported(walletType);
  }

  async isWalletAvailable(walletType: WalletType): Promise<boolean> {
    return WalletServiceFactory.isWalletAvailable(walletType);
  }

  getWalletInfo(walletType: WalletType) {
    return WalletServiceFactory.getWalletInfo(walletType);
  }

}

export const walletService = new UnifiedWalletService();