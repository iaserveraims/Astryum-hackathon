// Wallet Types and Interfaces for Astryum
export type WalletType =
  | 'metamask'
  | 'rabby'
  | 'okx'
  | 'walletconnect'
  | 'coinbase'
  | 'trust'
  | 'bifrost'
  | 'ledger'
  | 'xaman'
  | 'petra';

export type ChainType =
  | 'ethereum'
  | 'polygon'
  | 'arbitrum'
  | 'base'
  | 'avalanche'
  | 'optimism'
  | 'bsc'
  | 'flare'
  | 'xrpl'
  | 'aptos';
export type WalletStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  usdValue: number;
  logoUri?: string;
  verified?: boolean;
  currency?: string; // For XRPL IOUs
  issuer?: string; // For XRPL tokens
}

export interface NFTBalance {
  collection: string;
  tokenId: string;
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
  floorPrice?: number;
  creator?: string;
}

export interface WalletBalance {
  native: {
    symbol: string;
    balance: string;
    usdValue: number;
    currency?: string; // XRP, APT, ETH, etc.
  };
  tokens: TokenBalance[];
  nfts?: NFTBalance[];
  totalUsdValue: number;
  lastUpdated: Date;
}

export interface WalletAccount {
  id: string;
  address: string;
  walletType: WalletType;
  chainType: ChainType;
  nickname?: string;
  avatar?: string;
  isConnected: boolean;
  status: WalletStatus;
  balance: WalletBalance;
  network?: string; // mainnet, testnet
  publicKey?: string;
  capabilities?: {
    signMessage?: boolean;
    signTransaction?: boolean;
    signAndSubmit?: boolean;
    multiSign?: boolean;
  };
  metadata?: {
    walletName?: string;
    walletVersion?: string;
    connectedAt?: Date;
    lastActivity?: Date;
    accountIndex?: number;
    connectionId?: string;
    lastSyncedWithBackend?: Date;
  };
}

/**
 * EIP-1193 injected provider (MetaMask, Coinbase, …). @reown/appkit already
 * declares `Window.ethereum` as `Record<string, unknown>`, so wallet services
 * cast through this type instead of re-declaring the global (TS2717 conflict).
 */
export interface InjectedEthereumProvider {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  request(args: { method: string; params?: any[] }): Promise<any>;
  on(event: string, callback: (...args: any[]) => void): void;
  removeListener(event: string, callback: (...args: any[]) => void): void;
  selectedAddress: string | null;
  chainId: string | null;
  networkVersion: string | null;
}

export interface WalletConnection {
  account: WalletAccount;
  provider?: any; // Wallet provider instance
  signer?: any; // Wallet signer instance
}

export interface TransactionRequest {
  id: string;
  walletId: string;
  chainType: ChainType;
  type: TransactionType;
  payload: any;
  amount?: string;
  recipient?: string;
  gasLimit?: string;
  gasPrice?: string;
  deadline?: Date;
  status: 'pending' | 'signed' | 'submitted' | 'confirmed' | 'failed' | 'cancelled';
  txHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionType = 
  | 'payment' 
  | 'token_transfer' 
  | 'contract_call' 
  | 'nft_transfer'
  | 'trust_set' // XRPL
  | 'offer_create' // XRPL
  | 'offer_cancel' // XRPL
  | 'coin_transfer' // Aptos
  | 'coin_register' // Aptos
  | 'script_function'; // Aptos

export interface WalletError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  walletType?: WalletType;
}

// XRPL Specific Types
export interface XRPLTransaction {
  TransactionType: string;
  Account: string;
  Destination?: string;
  Amount?: string | {
    currency: string;
    value: string;
    issuer: string;
  };
  DestinationTag?: number;
  Fee?: string;
  Flags?: number;
  LastLedgerSequence?: number;
  Memos?: Array<{
    Memo: {
      MemoData?: string;
      MemoFormat?: string;
      MemoType?: string;
    };
  }>;
  Sequence?: number;
}

export interface XRPLAccountInfo {
  account_data: {
    Account: string;
    Balance: string;
    Flags: number;
    LedgerEntryType: string;
    OwnerCount: number;
    PreviousTxnID: string;
    PreviousTxnLgrSeq: number;
    Sequence: number;
    index: string;
  };
  ledger_current_index: number;
  validated: boolean;
}

// Aptos Specific Types
export interface AptosTransaction {
  sender: string;
  sequence_number: string;
  max_gas_amount: string;
  gas_unit_price: string;
  expiration_timestamp_secs: string;
  payload: {
    type: string;
    function?: string;
    arguments?: any[];
    type_arguments?: string[];
    code?: {
      bytecode: string;
    };
  };
}

export interface AptosAccountInfo {
  sequence_number: string;
  authentication_key: string;
}

export interface AptosCoinInfo {
  type: string;
  data: {
    decimals: number;
    name: string;
    symbol: string;
    supply?: {
      vec: Array<{
        aggregator: {
          vec: any[];
        };
        integer: {
          vec: any[];
        };
      }>;
    };
  };
}

// Ethereum Specific Types
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

export interface EthereumAccountInfo {
  address: string;
  balance: string;
  nonce: number;
  code?: string;
}

export interface ERC20TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
}

export interface EthereumNetwork {
  chainId: string;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}

// Portfolio Types
export interface Portfolio {
  totalValue: number;
  totalValueChange24h: number;
  /** Set by the store's merge path so repeated reads reuse the cached merge. */
  isMerged?: boolean;
  wallets: WalletAccount[];
  breakdown: {
    [chainType: string]: {
      value: number;
      percentage: number;
      tokens: TokenBalance[];
    };
  };
  topTokens: TokenBalance[];
  lastUpdated: Date;
}

export interface PriceData {
  [symbol: string]: {
    usd: number;
    usd_24h_change: number;
    last_updated_at: number;
  };
}

// Wallet Service Interface
export interface WalletService {
  connect(): Promise<WalletAccount>;
  disconnect(): Promise<void>;
  getAccount(): Promise<WalletAccount | null>;
  getBalance(address: string): Promise<WalletBalance>;
  signMessage(message: string): Promise<string>;
  signTransaction(transaction: any): Promise<string>;
  submitTransaction(transaction: any): Promise<string>;
  isConnected(): boolean;
  onAccountChange?(callback: (account: WalletAccount | null) => void): void;
  onDisconnect?(callback: () => void): void;
}

// State Types
export interface WalletState {
  wallets: WalletAccount[];
  activeWallet: WalletAccount | null;
  isConnecting: boolean;
  error: WalletError | null;
  transactions: TransactionRequest[];
  portfolio: Portfolio | null;
}

export interface WalletActions {
  connect: (walletType: WalletType) => Promise<WalletAccount | null>;
  disconnect: (walletId: string) => Promise<void>;
  setActiveWallet: (walletId: string) => void;
  refreshBalances: () => Promise<void>;
  submitTransaction: (transaction: TransactionRequest) => Promise<string>;
  clearError: () => void;
}

// Event Types
export type WalletEvent = 
  | { type: 'WALLET_CONNECTED'; payload: WalletAccount }
  | { type: 'WALLET_DISCONNECTED'; payload: { walletId: string } }
  | { type: 'WALLET_ERROR'; payload: WalletError }
  | { type: 'BALANCE_UPDATED'; payload: { walletId: string; balance: WalletBalance } }
  | { type: 'TRANSACTION_SIGNED'; payload: { txId: string; signature: string } }
  | { type: 'TRANSACTION_SUBMITTED'; payload: { txId: string; txHash: string } }
  | { type: 'TRANSACTION_CONFIRMED'; payload: { txId: string; txHash: string } };

// Utility Types
export type WalletConfig = {
  [K in WalletType]: {
    name: string;
    icon: string;
    chains: ChainType[];
    features: string[];
    deepLinkScheme?: string;
    downloadUrl?: string;
  };
};

export interface WalletConnectionOptions {
  autoConnect?: boolean;
  timeout?: number;
  network?: string;
  testnet?: boolean;
}

// Re-export common types from coordination for compatibility
// Note: These types are currently not available, commenting out to prevent compilation errors
// export type {
//   OperationPreview,
//   SimulationResult,
//   SignatureRequest,
//   PolicyRule,
//   Alert
// } from '../../../CODES META WALLET/metawallet.ts';