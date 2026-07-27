'use client';

// Astryum Personal → Wallets. The whole manager lives in a reusable component
// (components/wallet/WalletManager) so the SAME section — same wallet cards,
// same per-wallet functionality — also powers the Legacy governance "Wallets"
// tab, scoped to that Legacy. Here it runs in 'personal' scope: every linked
// wallet EXCEPT the ones a Legacy controls (its council + its Smart Account).
import WalletManager from '@/components/wallet/WalletManager';

export default function WalletsPage() {
  return <WalletManager scope="personal" variant="page" />;
}
