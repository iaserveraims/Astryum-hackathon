import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { WalletAccount, WalletError, Portfolio, TransactionRequest } from '../lib/types/wallet';

interface WalletState {
  // Core state
  wallets: WalletAccount[];
  activeWallet: WalletAccount | null;
  isConnecting: boolean;
  error: WalletError | null;
  portfolio: Portfolio | null;
  transactions: TransactionRequest[];

  // UI state
  showWalletModal: boolean;
  hideBalances: boolean;
  autoRefresh: boolean;
  refreshInterval: number; // seconds
  mergeWallets: boolean; // Whether to merge wallet balances in portfolio view
  walletGrouping: 'individual' | 'merged' | 'chain'; // How to group wallets

  // Actions
  setWallets: (wallets: WalletAccount[]) => void;
  addWallet: (wallet: WalletAccount) => void;
  removeWallet: (walletId: string) => void;
  updateWallet: (walletId: string, updates: Partial<WalletAccount>) => void;
  setActiveWallet: (wallet: WalletAccount | null) => void;
  setIsConnecting: (isConnecting: boolean) => void;
  setError: (error: WalletError | null) => void;
  setPortfolio: (portfolio: Portfolio | null) => void;
  addTransaction: (transaction: TransactionRequest) => void;
  updateTransaction: (txId: string, updates: Partial<TransactionRequest>) => void;
  removeTransaction: (txId: string) => void;

  // UI actions
  setShowWalletModal: (show: boolean) => void;
  setHideBalances: (hide: boolean) => void;
  setAutoRefresh: (enabled: boolean) => void;
  setRefreshInterval: (seconds: number) => void;
  setMergeWallets: (merge: boolean) => void;
  setWalletGrouping: (grouping: 'individual' | 'merged' | 'chain') => void;

  // Utility actions
  clearError: () => void;
  clearAll: () => void;
  getWalletById: (walletId: string) => WalletAccount | undefined;
  getWalletsByChain: (chainType: string) => WalletAccount[];
  getTotalPortfolioValue: () => number;
  getConnectedWallets: () => WalletAccount[];
  getMergedPortfolio: () => Portfolio | null;
  getGroupedWallets: () => { [key: string]: WalletAccount[] };
}

export const useWalletStore = create<WalletState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        wallets: [],
        activeWallet: null,
        isConnecting: false,
        error: null,
        portfolio: null,
        transactions: [],
        showWalletModal: false,
        hideBalances: false,
        autoRefresh: true,
        refreshInterval: 30,
        mergeWallets: true,
        walletGrouping: 'merged',

        // Wallet actions
        setWallets: (wallets) => 
          set({ wallets }, false, 'setWallets'),

        addWallet: (wallet) =>
          set((state) => {
            const existingIndex = state.wallets.findIndex(w => w.id === wallet.id);
            if (existingIndex >= 0) {
              // Update existing wallet
              const updatedWallets = [...state.wallets];
              updatedWallets[existingIndex] = wallet;
              return { wallets: updatedWallets };
            } else {
              // Add new wallet
              return { wallets: [...state.wallets, wallet] };
            }
          }, false, 'addWallet'),

        removeWallet: (walletId) =>
          set((state) => {
            const newWallets = state.wallets.filter(w => w.id !== walletId);
            const newActiveWallet = state.activeWallet?.id === walletId ? null : state.activeWallet;
            return {
              wallets: newWallets,
              activeWallet: newActiveWallet
            };
          }, false, 'removeWallet'),

        updateWallet: (walletId, updates) =>
          set((state) => {
            const walletIndex = state.wallets.findIndex(w => w.id === walletId);
            if (walletIndex === -1) return state;

            const updatedWallets = [...state.wallets];
            updatedWallets[walletIndex] = { ...updatedWallets[walletIndex], ...updates };

            // Update active wallet if it's the one being updated
            const newActiveWallet = state.activeWallet?.id === walletId 
              ? updatedWallets[walletIndex] 
              : state.activeWallet;

            return {
              wallets: updatedWallets,
              activeWallet: newActiveWallet
            };
          }, false, 'updateWallet'),

        setActiveWallet: (wallet) =>
          set({ activeWallet: wallet }, false, 'setActiveWallet'),

        setIsConnecting: (isConnecting) =>
          set({ isConnecting }, false, 'setIsConnecting'),

        setError: (error) =>
          set({ error }, false, 'setError'),

        setPortfolio: (portfolio) =>
          set({ portfolio }, false, 'setPortfolio'),

        // Transaction actions
        addTransaction: (transaction) =>
          set((state) => ({
            transactions: [...state.transactions, transaction]
          }), false, 'addTransaction'),

        updateTransaction: (txId, updates) =>
          set((state) => {
            const txIndex = state.transactions.findIndex(tx => tx.id === txId);
            if (txIndex === -1) return state;

            const updatedTransactions = [...state.transactions];
            updatedTransactions[txIndex] = { ...updatedTransactions[txIndex], ...updates };

            return { transactions: updatedTransactions };
          }, false, 'updateTransaction'),

        removeTransaction: (txId) =>
          set((state) => ({
            transactions: state.transactions.filter(tx => tx.id !== txId)
          }), false, 'removeTransaction'),

        // UI actions
        setShowWalletModal: (show) =>
          set({ showWalletModal: show }, false, 'setShowWalletModal'),

        setHideBalances: (hide) =>
          set({ hideBalances: hide }, false, 'setHideBalances'),

        setAutoRefresh: (enabled) =>
          set({ autoRefresh: enabled }, false, 'setAutoRefresh'),

        setRefreshInterval: (seconds) =>
          set({ refreshInterval: Math.max(10, seconds) }, false, 'setRefreshInterval'),

        setMergeWallets: (merge) =>
          set({ mergeWallets: merge }, false, 'setMergeWallets'),

        setWalletGrouping: (grouping) =>
          set({ walletGrouping: grouping }, false, 'setWalletGrouping'),

        // Utility actions
        clearError: () =>
          set({ error: null }, false, 'clearError'),

        clearAll: () =>
          set({
            wallets: [],
            activeWallet: null,
            isConnecting: false,
            error: null,
            portfolio: null,
            transactions: [],
            showWalletModal: false
          }, false, 'clearAll'),

        getWalletById: (walletId) => {
          const state = get();
          return state.wallets.find(w => w.id === walletId);
        },

        getWalletsByChain: (chainType) => {
          const state = get();
          return state.wallets.filter(w => w.chainType === chainType);
        },

        getTotalPortfolioValue: () => {
          const state = get();
          if (state.portfolio) {
            return state.portfolio.totalValue;
          }
          return state.wallets.reduce((total, wallet) => 
            total + (wallet.balance?.totalUsdValue || 0), 0
          );
        },

        getConnectedWallets: () => {
          const state = get();
          return state.wallets.filter(w => w.isConnected);
        },

        getMergedPortfolio: () => {
          const state = get();
          const connectedWallets = state.wallets.filter(w => w.isConnected);

          if (connectedWallets.length === 0) return null;
          if (state.portfolio && state.portfolio.isMerged) return state.portfolio;

          // Merge all wallet balances - Return cached result if no changes
          const allTokens: any[] = [];
          const chainBreakdown: { [chainType: string]: any } = {};
          let totalValue = 0;

          connectedWallets.forEach(wallet => {
            if (!wallet.balance) return;

            totalValue += wallet.balance.totalUsdValue;

            // Add native token
            allTokens.push({
              ...wallet.balance.native,
              address: 'native',
              name: `${wallet.balance.native.symbol} (${wallet.chainType})`,
              decimals: 6,
              walletId: wallet.id
            });

            // Add ERC-20/token balances
            allTokens.push(...wallet.balance.tokens.map(token => ({
              ...token,
              walletId: wallet.id
            })));

            // Chain breakdown
            const chainType = wallet.chainType;
            if (!chainBreakdown[chainType]) {
              chainBreakdown[chainType] = {
                value: 0,
                percentage: 0,
                tokens: []
              };
            }

            chainBreakdown[chainType].value += wallet.balance.totalUsdValue;
            chainBreakdown[chainType].tokens.push(...wallet.balance.tokens);
          });

          // Calculate percentages
          Object.keys(chainBreakdown).forEach(chainType => {
            chainBreakdown[chainType].percentage = totalValue > 0
              ? (chainBreakdown[chainType].value / totalValue) * 100
              : 0;
          });

          // Merge duplicate tokens by symbol and sum balances
          const tokenMap = new Map();
          allTokens.forEach(token => {
            const key = `${token.symbol}_${token.address}`;
            if (tokenMap.has(key)) {
              const existing = tokenMap.get(key);
              existing.balance = (parseFloat(existing.balance) + parseFloat(token.balance)).toString();
              existing.usdValue += token.usdValue;
              existing.wallets = existing.wallets ? [...existing.wallets, token.walletId] : [token.walletId];
            } else {
              tokenMap.set(key, {
                ...token,
                wallets: [token.walletId]
              });
            }
          });

          const mergedTokens = Array.from(tokenMap.values());
          const topTokens = mergedTokens
            .sort((a, b) => b.usdValue - a.usdValue)
            .slice(0, 10);

          return {
            totalValue,
            totalValueChange24h: 0,
            wallets: connectedWallets,
            breakdown: chainBreakdown,
            topTokens,
            lastUpdated: new Date(),
            isMerged: true
          };
        },

        getGroupedWallets: () => {
          const state = get();
          const connectedWallets = state.wallets.filter(w => w.isConnected);
          const groups: { [key: string]: WalletAccount[] } = {};

          switch (state.walletGrouping) {
            case 'chain':
              connectedWallets.forEach(wallet => {
                const chainType = wallet.chainType;
                if (!groups[chainType]) {
                  groups[chainType] = [];
                }
                groups[chainType].push(wallet);
              });
              return groups;

            case 'merged':
              groups['All Wallets'] = connectedWallets;
              return groups;

            case 'individual':
            default:
              connectedWallets.forEach(wallet => {
                groups[wallet.id] = [wallet];
              });
              return groups;
          }
        }
      }),
      {
        name: 'defibro-wallet-store',
        partialize: (state) => ({
          // Only persist these fields, excluding temporary data that causes object recreation
          wallets: state.wallets.map(wallet => ({
            ...wallet,
            balance: {
              ...wallet.balance,
              // Don't reset lastUpdated in persist to avoid new objects
              lastUpdated: wallet.balance.lastUpdated
            }
          })),
          activeWallet: state.activeWallet ? {
            ...state.activeWallet,
            balance: {
              ...state.activeWallet.balance,
              lastUpdated: state.activeWallet.balance.lastUpdated
            }
          } : null,
          hideBalances: state.hideBalances,
          autoRefresh: state.autoRefresh,
          refreshInterval: state.refreshInterval,
          mergeWallets: state.mergeWallets,
          walletGrouping: state.walletGrouping
        }),
        version: 1,
        // Migration function for future versions
        migrate: (persistedState: any, version: number) => {
          if (version === 0) {
            // Migration from version 0 to 1
            return {
              ...persistedState,
              autoRefresh: true,
              refreshInterval: 30
            };
          }
          return persistedState;
        }
      }
    ),
    { name: 'wallet-store' }
  )
);

// Fixed selectors section for walletStore.ts
// This section replaces lines 370-453 to fix infinite loop issues

// ===== STABLE SELECTORS - CACHED OUTSIDE COMPONENTS =====

// Pre-defined stable selector functions to prevent recreation
const connectedWalletsSelector = (state: WalletState): WalletAccount[] => {
  // Handle case when no wallets exist or state.wallets is undefined
  if (!state.wallets || !Array.isArray(state.wallets)) {
    return [];
  }
  return state.wallets.filter(w => w && w.isConnected);
};

const walletActionsSelector = (state: WalletState) => ({
  setWallets: state.setWallets,
  addWallet: state.addWallet,
  removeWallet: state.removeWallet,
  updateWallet: state.updateWallet,
  setActiveWallet: state.setActiveWallet,
  setIsConnecting: state.setIsConnecting,
  setError: state.setError,
  setPortfolio: state.setPortfolio,
  clearError: state.clearError
});

const transactionActionsSelector = (state: WalletState) => ({
  addTransaction: state.addTransaction,
  updateTransaction: state.updateTransaction,
  removeTransaction: state.removeTransaction
});

const uiActionsSelector = (state: WalletState) => ({
  setShowWalletModal: state.setShowWalletModal,
  setHideBalances: state.setHideBalances,
  setAutoRefresh: state.setAutoRefresh,
  setRefreshInterval: state.setRefreshInterval,
  setMergeWallets: state.setMergeWallets,
  setWalletGrouping: state.setWalletGrouping
});

const walletUtilsSelector = (state: WalletState) => ({
  getWalletById: state.getWalletById,
  getWalletsByChain: state.getWalletsByChain,
  getTotalPortfolioValue: state.getTotalPortfolioValue,
  getConnectedWallets: state.getConnectedWallets,
  getMergedPortfolio: state.getMergedPortfolio,
  getGroupedWallets: state.getGroupedWallets
});

// ===== FIXED SELECTOR HOOKS =====

// Simple selectors for single values (no array recreation issues)
export const useActiveWallet = () => useWalletStore(state => state.activeWallet);
export const usePortfolioValue = () => useWalletStore(state => 
  state.portfolio?.totalValue || 0
);
export const useWalletError = () => useWalletStore(state => state.error);
export const useIsConnecting = () => useWalletStore(state => state.isConnecting);

// FIXED: useConnectedWallets - cache results with useMemo to prevent infinite loops
export const useConnectedWallets = (): WalletAccount[] => {
  const wallets = useWalletStore((s) => s.wallets);
  return useMemo(
    () => (Array.isArray(wallets) ? wallets.filter((w) => w?.isConnected) : []),
    [wallets]
  );
};

// FIXED: Action hooks - use useShallow to prevent object recreation issues
export const useWalletActions = () =>
  useWalletStore(
    useShallow((state) => ({
      setWallets: state.setWallets,
      addWallet: state.addWallet,
      removeWallet: state.removeWallet,
      updateWallet: state.updateWallet,
      setActiveWallet: state.setActiveWallet,
      setIsConnecting: state.setIsConnecting,
      setError: state.setError,
      setPortfolio: state.setPortfolio,
      clearError: state.clearError,
    }))
  );

export const useTransactionActions = () =>
  useWalletStore(
    useShallow((state) => ({
      addTransaction: state.addTransaction,
      updateTransaction: state.updateTransaction,
      removeTransaction: state.removeTransaction,
    }))
  );

export const useUIActions = () =>
  useWalletStore(
    useShallow((state) => ({
      setShowWalletModal: state.setShowWalletModal,
      setHideBalances: state.setHideBalances,
      setAutoRefresh: state.setAutoRefresh,
      setRefreshInterval: state.setRefreshInterval,
      setMergeWallets: state.setMergeWallets,
      setWalletGrouping: state.setWalletGrouping,
    }))
  );

export const useWalletUtils = () =>
  useWalletStore(
    useShallow((state) => ({
      getWalletById: state.getWalletById,
      getWalletsByChain: state.getWalletsByChain,
      getTotalPortfolioValue: state.getTotalPortfolioValue,
      getConnectedWallets: state.getConnectedWallets,
      getMergedPortfolio: state.getMergedPortfolio,
      getGroupedWallets: state.getGroupedWallets,
    }))
  );
