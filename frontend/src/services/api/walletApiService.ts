import { WalletAccount, WalletBalance } from '../../lib/types/wallet';
import { getApiBase } from '../../lib/env';

// API response types
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ConnectWalletRequest {
  walletType: 'xaman' | 'petra' | 'metamask' | 'walletconnect';
  address: string;
  network?: string;
  signature?: string;
  metadata?: {
    walletName?: string;
    userAgent?: string;
    timestamp?: string;
  };
}

interface TransactionRequest {
  walletId: string;
  transaction: any;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

interface WalletStats {
  totalWallets: number;
  connectedWallets: number;
  totalTransactions: number;
  pendingTransactions: number;
  totalValue: number;
}

class WalletApiService {
  private baseUrl: string;
  private userId: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? `${getApiBase()}/wallets`;
    this.userId = this.getUserId();
  }

  private getUserId(): string {
    // In a real app, get from auth token or localStorage
    // Check if we're in browser environment to avoid SSR issues
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('userId') || 'demo-user';
    }
    return 'demo-user';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      // Auth is the SIWE Bearer token (same pattern as the rest of the app).
      // The old `user-id` header was NOT read by the backend AND was missing from
      // its CORS Access-Control-Allow-Headers → it broke the preflight on
      // POST /api/wallets/connect. `this.userId` is kept but no longer sent.
      const token =
        typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') : null;
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      };

      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`HTTP ${response.status}: ${error}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Connect a new wallet
  async connectWallet(request: ConnectWalletRequest): Promise<ApiResponse<{ walletId: string; message: string }>> {
    return this.request('/connect', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Disconnect wallet — walletId format is "{type}-{address}"; the backend
  // DELETE /:address endpoint accepts just the address part.
  async disconnectWallet(walletId: string): Promise<ApiResponse<{ message: string }>> {
    const address = walletId.includes('-') ? walletId.split('-').slice(1).join('-') : walletId;
    return this.request(`/${address}`, {
      method: 'DELETE',
    });
  }

  // Get wallet balance
  async getWalletBalance(address: string): Promise<ApiResponse<{ balance: WalletBalance }>> {
    return this.request(`/balance/${address}`);
  }

  // Get all connected wallets for current user
  async getConnectedWallets(): Promise<ApiResponse<{ wallets: WalletAccount[] }>> {
    return this.request(`/user/${this.userId}`);
  }

  // Submit transaction for signing
  async submitTransaction(request: TransactionRequest): Promise<ApiResponse<{ txHash: string; status: string; message: string }>> {
    return this.request('/submit-transaction', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Get pending transactions for user
  async getPendingTransactions(): Promise<ApiResponse<{ transactions: any[] }>> {
    return this.request(`/transactions/pending/${this.userId}`);
  }

  // Approve transaction
  async approveTransaction(txId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request('/transactions/approve', {
      method: 'POST',
      body: JSON.stringify({ txId }),
    });
  }

  // Reject transaction
  async rejectTransaction(txId: string, reason?: string): Promise<ApiResponse<{ message: string }>> {
    return this.request('/transactions/reject', {
      method: 'POST',
      body: JSON.stringify({ txId, reason }),
    });
  }

  // Get transaction history for wallet
  async getTransactionHistory(walletId: string, limit: number = 50): Promise<ApiResponse<{ history: any[] }>> {
    return this.request(`/history/${walletId}?limit=${limit}`);
  }

  // Update wallet permissions
  async updateWalletPermissions(walletId: string, permissions: any): Promise<ApiResponse<{ message: string }>> {
    return this.request(`/permissions/${walletId}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
  }

  // Enable emergency pre-approval
  async enableEmergencyPreApproval(walletId: string, duration?: number): Promise<ApiResponse<{ message: string; duration: number }>> {
    return this.request('/emergency/enable', {
      method: 'POST',
      body: JSON.stringify({ walletId, duration }),
    });
  }

  // Disable emergency pre-approval
  async disableEmergencyPreApproval(walletId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request('/emergency/disable', {
      method: 'POST',
      body: JSON.stringify({ walletId }),
    });
  }

  // Get wallet statistics
  async getWalletStats(): Promise<ApiResponse<WalletStats>> {
    return this.request('/stats');
  }

  // Health check
  async healthCheck(): Promise<ApiResponse<any>> {
    return this.request('/health');
  }

  // Freeze wallet (emergency function)
  async freezeWallet(walletId: string, reason: string): Promise<ApiResponse<{ message: string; reason: string }>> {
    return this.request('/freeze', {
      method: 'POST',
      body: JSON.stringify({ walletId, reason }),
    });
  }

  // Create wallet backup
  async createWalletBackup(walletId: string): Promise<ApiResponse<{ backupId: string; message: string }>> {
    return this.request('/backup/create', {
      method: 'POST',
      body: JSON.stringify({ walletId }),
    });
  }

  // Restore wallet from backup
  async restoreWalletFromBackup(backupId: string): Promise<ApiResponse<{ walletId: string; message: string }>> {
    return this.request('/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ backupId, userId: this.userId }),
    });
  }

  // Sync wallet data with backend (utility method)
  async syncWalletData(walletId: string): Promise<{
    balance: WalletBalance | null;
    history: any[];
    pendingTransactions: any[];
  }> {
    try {
      const wallet = await this.getConnectedWallets();
      if (!wallet.success || !wallet.data?.wallets) {
        throw new Error('Failed to get wallet data');
      }

      const targetWallet = wallet.data.wallets.find(w => w.id === walletId);
      if (!targetWallet) {
        throw new Error('Wallet not found');
      }

      const [balanceResult, historyResult, pendingResult] = await Promise.allSettled([
        this.getWalletBalance(targetWallet.address),
        this.getTransactionHistory(walletId),
        this.getPendingTransactions(),
      ]);

      return {
        balance: balanceResult.status === 'fulfilled' && balanceResult.value.success 
          ? balanceResult.value.data?.balance || null 
          : null,
        history: historyResult.status === 'fulfilled' && historyResult.value.success 
          ? historyResult.value.data?.history || [] 
          : [],
        pendingTransactions: pendingResult.status === 'fulfilled' && pendingResult.value.success 
          ? pendingResult.value.data?.transactions || [] 
          : [],
      };
    } catch (error) {
      console.error('Failed to sync wallet data:', error);
      return {
        balance: null,
        history: [],
        pendingTransactions: [],
      };
    }
  }

  // Batch operations for performance
  async batchSyncAllWallets(): Promise<{
    wallets: WalletAccount[];
    balances: { [walletId: string]: WalletBalance | null };
    pendingTransactions: any[];
  }> {
    try {
      const [walletsResult, pendingResult] = await Promise.allSettled([
        this.getConnectedWallets(),
        this.getPendingTransactions(),
      ]);

      const wallets = walletsResult.status === 'fulfilled' && walletsResult.value.success 
        ? walletsResult.value.data?.wallets || []
        : [];

      const pendingTransactions = pendingResult.status === 'fulfilled' && pendingResult.value.success 
        ? pendingResult.value.data?.transactions || []
        : [];

      // Get balances for all wallets
      const balancePromises = wallets.map(wallet => 
        this.getWalletBalance(wallet.address)
      );

      const balanceResults = await Promise.allSettled(balancePromises);
      const balances: { [walletId: string]: WalletBalance | null } = {};

      wallets.forEach((wallet, index) => {
        const balanceResult = balanceResults[index];
        balances[wallet.id] = balanceResult.status === 'fulfilled' && balanceResult.value.success
          ? balanceResult.value.data?.balance || null
          : null;
      });

      return {
        wallets,
        balances,
        pendingTransactions,
      };
    } catch (error) {
      console.error('Failed to batch sync wallets:', error);
      return {
        wallets: [],
        balances: {},
        pendingTransactions: [],
      };
    }
  }
}

// Export singleton instance
export const walletApiService = new WalletApiService();
export type { ConnectWalletRequest, TransactionRequest, WalletStats };