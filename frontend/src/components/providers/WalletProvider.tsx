'use client';

import { createContext, useContext, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useWalletStore } from '../../stores/walletStore';
import { walletService } from '../../services/walletService';
import { WalletType, InjectedEthereumProvider } from '../../lib/types/wallet';
import { XamanQRModal } from '../wallet/XamanQRModal';

// Circuit breaker to prevent infinite update loops
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_COOLDOWN = 60000; // 1 minute
let lastReconnectAttempt = 0;

// Note: React Query client is provided at app level in src/providers.tsx

interface WalletContextType {
  // Unified wallet service methods
  connectWallet: (walletType: WalletType) => Promise<any>;
  disconnectWallet: (walletId: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshWalletBalance: (walletId: string) => Promise<void>;
  setActiveWallet: (walletId: string) => void;
  clearError: () => void;
  isWalletSupported: (walletType: WalletType) => boolean;
  isWalletAvailable: (walletType: WalletType) => Promise<boolean>;
  getWalletInfo: (walletType: WalletType) => any;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const useWalletContext = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within a WalletProvider');
  }
  return context;
};

interface WalletProviderProps {
  children: ReactNode;
}

function WalletProviderInner({ children }: WalletProviderProps) {
  // Stable service methods - no hooks or state dependencies to prevent loops
  const connectWallet = useCallback((walletType: WalletType) => {
    return walletService.connectWallet(walletType);
  }, []);

  const disconnectWallet = useCallback((walletId: string) => {
    return walletService.disconnectWallet(walletId);
  }, []);

  const refreshBalances = useCallback(() => {
    return walletService.refreshBalances();
  }, []);

  const refreshWalletBalance = useCallback((walletId: string) => {
    return walletService.refreshWalletBalance(walletId);
  }, []);

  const setActiveWallet = useCallback((walletId: string) => {
    walletService.setActiveWallet(walletId);
  }, []);

  const clearError = useCallback(() => {
    walletService.clearError();
  }, []);

  const isWalletSupported = useCallback((walletType: WalletType) => {
    return walletService.isWalletSupported(walletType);
  }, []);

  const isWalletAvailable = useCallback((walletType: WalletType) => {
    return walletService.isWalletAvailable(walletType);
  }, []);

  const getWalletInfo = useCallback((walletType: WalletType) => {
    return walletService.getWalletInfo(walletType);
  }, []);

  // Auto-refresh connected wallets - properly subscribed
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let isActive = true;

    const unsubscribe = useWalletStore.subscribe((state) => {
      if (!isActive) return;

      // Clear existing interval
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      const connectedCount = state.wallets.filter(w => w.isConnected).length;

      if (connectedCount === 0 || !state.autoRefresh) {
        return;
      }

      interval = setInterval(async () => {
        if (isActive) {
          try {
            await refreshBalances();
          } catch (error) {
            console.error('Auto-refresh failed:', error);
          }
        }
      }, state.refreshInterval * 1000);
    });

    return () => {
      isActive = false;
      unsubscribe();
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [refreshBalances]);

  // Set up wallet event listeners - simplified to prevent loops
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'defibro-wallet-store') {
        // Only reload on external storage changes, not internal ones
        console.log('External wallet state change detected');
      }
    };

    // Single auto-reconnect attempt on mount - no loops
    const attemptAutoReconnect = async () => {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn("Auto-reconnect disabled - too many attempts");
        return;
      }

      reconnectAttempts++;
      lastReconnectAttempt = Date.now();

      try {
        if (typeof window !== 'undefined' && window.ethereum?.isMetaMask) {
          const persistedData = localStorage.getItem('defibro-wallet-store');
          const metaMaskAutoConnected = localStorage.getItem('metamask-auto-connected');

          if (persistedData && metaMaskAutoConnected === 'true') {
            // @reown/appkit types Window.ethereum as Record<string, unknown>
            const accounts = await (window.ethereum as unknown as InjectedEthereumProvider).request({
              method: 'eth_accounts'
            });

            if (accounts && accounts.length > 0) {
              await connectWallet('metamask');
              console.log('Auto-reconnected to MetaMask');
            }
          }
        }
      } catch (error) {
        console.warn('Auto-reconnection failed:', error);
        localStorage.removeItem('metamask-auto-connected');
      }
    };

    // Single attempt after mount
    const timeoutId = setTimeout(attemptAutoReconnect, 1000);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [connectWallet]);

  // Stable context value - functions are already memoized
  const contextValue: WalletContextType = useMemo(() => ({
    connectWallet,
    disconnectWallet,
    refreshBalances,
    refreshWalletBalance,
    setActiveWallet,
    clearError,
    isWalletSupported,
    isWalletAvailable,
    getWalletInfo,
  }), [
    connectWallet,
    disconnectWallet,
    refreshBalances,
    refreshWalletBalance,
    setActiveWallet,
    clearError,
    isWalletSupported,
    isWalletAvailable,
    getWalletInfo,
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
      {/* Global Xaman QR — appears whenever a sign-in payload is created. */}
      <XamanQRModal />
    </WalletContext.Provider>
  );
}

export function WalletProvider({ children }: WalletProviderProps) {
  return (
    <WalletProviderInner>
      {children}
    </WalletProviderInner>
  );
}

// Custom hooks for wallet data with React Query
export const useWalletQuery = (walletId: string) => {
  const wallet = useWalletStore(state =>
    state.wallets.find(w => w.id === walletId)
  );

  return {
    data: wallet,
    isLoading: false,
    error: null,
  };
};

export const usePortfolioQuery = () => {
  return useWalletStore(state => ({
    data: state.portfolio,
    isLoading: state.isConnecting,
    error: state.error,
  }));
};

// Hook for wallet balance updates with React Query
export const useWalletBalance = (address: string, chainType: string) => {
  const { refreshBalances } = useWalletContext();
  const isRefetching = useWalletStore(state => state.isConnecting);

  return useMemo(() => ({
    refetch: refreshBalances,
    isRefetching,
  }), [refreshBalances, isRefetching]);
};

// No local QueryClient exported; use app-level provider
