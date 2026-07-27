import { WalletType, WalletService } from '../../lib/types/wallet';
import { XamanWalletService } from './XamanWalletService';
import { PetraWalletService } from './PetraWalletService';
import { MetaMaskWalletService } from './MetaMaskWalletService';
import { WalletConnectService } from './WalletConnectService';
import { CoinbaseWalletService } from './CoinbaseWalletService';

// All EVM-compatible wallets that inject window.ethereum use the same service.
// Detection flags differ but the ethers.js BrowserProvider interface is identical.
const EVM_WALLETS: WalletType[] = ['metamask', 'rabby', 'okx', 'trust', 'bifrost', 'coinbase'];

export class WalletServiceFactory {
  private static instances: Map<WalletType, WalletService> = new Map();

  static getWalletService(walletType: WalletType): WalletService {
    if (this.instances.has(walletType)) {
      return this.instances.get(walletType)!;
    }

    let service: WalletService;

    switch (walletType) {
      // ── EVM wallets — all use the same BrowserProvider interface ──────────────
      case 'metamask':
      case 'rabby':
      case 'okx':
      case 'trust':
      case 'bifrost':
        service = new MetaMaskWalletService();
        break;

      case 'coinbase':
        service = new CoinbaseWalletService();
        break;

      // ── WalletConnect — covers Ledger Live, Ledger hardware, and 400+ wallets ─
      case 'walletconnect':
      case 'ledger':
        service = new WalletConnectService();
        break;

      // ── Non-EVM ──────────────────────────────────────────────────────────────
      case 'xaman':
        service = new XamanWalletService();
        break;

      case 'petra':
        service = new PetraWalletService();
        break;

      default:
        throw new Error(`Unsupported wallet type: ${walletType}`);
    }

    this.instances.set(walletType, service);
    return service;
  }

  static isWalletSupported(walletType: WalletType): boolean {
    const all: WalletType[] = [
      'metamask', 'rabby', 'okx', 'walletconnect', 'coinbase',
      'trust', 'bifrost', 'ledger', 'xaman', 'petra',
    ];
    return all.includes(walletType);
  }

  static getSupportedWallets(): WalletType[] {
    return ['metamask', 'rabby', 'okx', 'walletconnect', 'coinbase', 'trust', 'bifrost', 'ledger', 'xaman', 'petra'];
  }

  static async isWalletAvailable(walletType: WalletType): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const eth = window.ethereum as any;

    switch (walletType) {
      case 'metamask':
        return !!eth?.isMetaMask && !eth?.isRabby;

      case 'rabby':
        return !!eth?.isRabby;

      case 'okx':
        return !!(window as any).okxwallet || !!eth?.isOKExWallet;

      case 'trust':
        return !!eth?.isTrust;

      case 'bifrost':
        return !!eth?.isBifrost;

      case 'coinbase':
        return !!(window as any).coinbaseWalletExtension || !!eth?.isCoinbaseWallet || (
          eth?.providers && eth.providers.some((p: any) => p.isCoinbaseWallet)
        );

      case 'walletconnect':
      case 'ledger':
        return true; // QR / Ledger Live always available

      case 'xaman':
        return true; // Deep-link based, always available

      case 'petra':
        return !!(window as any).petra || !!(window as any).aptos;

      default:
        return false;
    }
  }

  static getWalletDownloadUrl(walletType: WalletType): string | null {
    const urls: Partial<Record<WalletType, string>> = {
      metamask:     'https://metamask.io/',
      rabby:        'https://rabby.io/',
      okx:          'https://www.okx.com/web3',
      walletconnect:'https://walletconnect.com/',
      coinbase:     'https://www.coinbase.com/wallet',
      trust:        'https://trustwallet.com/',
      bifrost:      'https://bifrostwallet.com/',
      ledger:       'https://www.ledger.com/ledger-live',
      xaman:        'https://xumm.app/',
      petra:        'https://petra.app/',
    };
    return urls[walletType] ?? null;
  }

  static getWalletInfo(walletType: WalletType) {
    const ALL_EVM = ['ethereum', 'polygon', 'arbitrum', 'base', 'avalanche', 'optimism', 'bsc', 'flare'];
    const info: Partial<Record<WalletType, {
      name: string; description: string; icon: string;
      chains: string[]; features: string[]; downloadUrl: string;
    }>> = {
      metamask: {
        name: 'MetaMask',
        description: 'The most popular EVM wallet',
        icon: '/icons/metamask.svg',
        chains: ALL_EVM,
        features: ['Browser Extension', 'Mobile App', 'Hardware Support'],
        downloadUrl: 'https://metamask.io/',
      },
      rabby: {
        name: 'Rabby',
        description: 'Security-focused EVM wallet by Debank',
        icon: '/icons/rabby.svg',
        chains: ALL_EVM,
        features: ['Browser Extension', 'Tx Simulation', 'Multi-chain', 'Risk Scanner'],
        downloadUrl: 'https://rabby.io/',
      },
      okx: {
        name: 'OKX Wallet',
        description: 'Multi-chain wallet from OKX exchange',
        icon: '/icons/okx.svg',
        chains: [...ALL_EVM, 'solana', 'xrpl'],
        features: ['Browser Extension', 'Mobile App', 'Multi-chain', 'DEX Built-in'],
        downloadUrl: 'https://www.okx.com/web3',
      },
      walletconnect: {
        name: 'WalletConnect',
        description: 'Connect via QR to 400+ wallets',
        icon: '/icons/walletconnect.svg',
        chains: ALL_EVM,
        features: ['QR Code', 'Mobile Wallets', 'Multi-chain'],
        downloadUrl: 'https://walletconnect.com/',
      },
      coinbase: {
        name: 'Coinbase Wallet',
        description: 'Self-custody wallet from Coinbase',
        icon: '/icons/coinbase.svg',
        chains: ALL_EVM,
        features: ['Browser Extension', 'Mobile App', 'Multi-chain', 'DApp Browser'],
        downloadUrl: 'https://www.coinbase.com/wallet',
      },
      trust: {
        name: 'Trust Wallet',
        description: 'Multi-chain mobile wallet',
        icon: '/icons/trust.svg',
        chains: ALL_EVM,
        features: ['Mobile App', 'DApp Browser', 'Staking', 'NFTs'],
        downloadUrl: 'https://trustwallet.com/',
      },
      bifrost: {
        name: 'Bifrost Wallet',
        description: 'Native Flare Network wallet',
        icon: '/icons/bifrost.svg',
        chains: ['flare', 'ethereum', 'arbitrum'],
        features: ['Browser Extension', 'FTSO Delegation', 'Flare-native'],
        downloadUrl: 'https://bifrostwallet.com/',
      },
      ledger: {
        name: 'Ledger',
        description: 'Hardware wallet via Ledger Live / WalletConnect',
        icon: '/icons/ledger.svg',
        chains: ALL_EVM,
        features: ['Hardware Security', 'WalletConnect', 'Cold Storage'],
        downloadUrl: 'https://www.ledger.com/ledger-live',
      },
      xaman: {
        name: 'Xaman',
        description: 'XRPL wallet with deep-link signing',
        icon: '/icons/xaman.svg',
        chains: ['xrpl'],
        features: ['Deep Links', 'Multi-signature', 'XRPL DApps'],
        downloadUrl: 'https://xumm.app/',
      },
      petra: {
        name: 'Petra',
        description: 'Aptos ecosystem wallet',
        icon: '/icons/petra.svg',
        chains: ['aptos'],
        features: ['Browser Extension', 'NFTs', 'Staking'],
        downloadUrl: 'https://petra.app/',
      },
    };
    return info[walletType] ?? null;
  }

  // Clear cached instances (useful for testing or logout)
  static clearInstances(): void {
    this.instances.clear();
  }

  // Disconnect all wallet instances
  static async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.instances.values()).map(service => 
      service.disconnect().catch(console.error)
    );
    
    await Promise.all(disconnectPromises);
    this.clearInstances();
  }
}

// Export singleton pattern for global access
export const walletServiceFactory = WalletServiceFactory;