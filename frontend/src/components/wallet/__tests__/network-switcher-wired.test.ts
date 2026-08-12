import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLARE_CHAIN_ID,
  FLARE_CHAIN_ID_HEX,
  FLARE_ADD_CHAIN_PARAMS,
  CHAINLIST_FLARE_URL,
  isUserRejection,
  isUnrecognizedChain,
} from '../../../lib/wallet/flareChain';
import { translate } from '../../../i18n/dict';

/**
 * Wiring guard for the "Switch to Flare" surfaces (2026-07-29 recon,
 * docs/context/Astryum_Recon_Boton_Cambiar_A_Flare_2026-07-29.md §4):
 * chain params had THREE sources of truth, the banner leaked raw wallet
 * errors + appeared for Xaman-only visitors, and the switch engine must stay
 * in ONE hook now that two surfaces render it (global banner + the active
 * wallet's card). Pinned here so none regress.
 */

const SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('flareChain.ts is the single source of chain params', () => {
  const CONSUMERS = [
    'components/wallet/NetworkSwitcher.tsx',
    'stores/authStore.ts',
    'lib/wallet/useSwitchToFlare.ts',
  ];

  for (const rel of CONSUMERS) {
    it(`${rel} imports the shared config and keeps no local copy`, () => {
      const src = read(rel);
      expect(src).toMatch(/from '(\.\/)?(\.\.\/)*(lib\/wallet\/)?flareChain'/);
      // The literals that used to diverge must not reappear inline:
      expect(src).not.toMatch(/flare-api\.flare\.network/);
      expect(src).not.toMatch(/'0xe'/);
      expect(src).not.toMatch(/flarescan\.com/);
    });
  }

  it('params match the values verified against dev.flare.network (2026-07-29)', () => {
    expect(FLARE_CHAIN_ID).toBe(14);
    expect(FLARE_CHAIN_ID_HEX).toBe('0xe');
    expect(parseInt(FLARE_ADD_CHAIN_PARAMS.chainId, 16)).toBe(FLARE_CHAIN_ID);
    expect(FLARE_ADD_CHAIN_PARAMS.rpcUrls).toEqual(['https://flare-api.flare.network/ext/C/rpc']);
    expect(FLARE_ADD_CHAIN_PARAMS.nativeCurrency).toEqual({ name: 'Flare', symbol: 'FLR', decimals: 18 });
    expect(CHAINLIST_FLARE_URL).toBe('https://chainlist.org/chain/14');
  });
});

describe('useSwitchToFlare is the ONE switch engine', () => {
  it('the engine gates on an ACTIVE EVM connection and never surfaces raw wallet errors', () => {
    const src = read('lib/wallet/useSwitchToFlare.ts');
    expect(src).toMatch(/eth_accounts/);
    expect(src).toMatch(/isUserRejection/);
    expect(src).toMatch(/wrongNetwork: connected &&/);
    expect(src).not.toMatch(/\.message/); // classification lives in flareChain
  });

  for (const rel of ['components/wallet/NetworkSwitcher.tsx', 'components/wallet/WalletManager.tsx']) {
    it(`${rel} consumes the shared engine instead of re-implementing it`, () => {
      const src = read(rel);
      expect(src).toMatch(/useSwitchToFlare/);
      expect(src).not.toMatch(/wallet_switchEthereumChain|wallet_addEthereumChain|eth_accounts/);
    });
  }

  it('the banner only renders on wrongNetwork and never renders raw error text', () => {
    const src = read('components/wallet/NetworkSwitcher.tsx');
    expect(src).toMatch(/if \(!flare\.wrongNetwork\) return null/);
    expect(src).toMatch(/CHAINLIST_FLARE_URL/); // honest manual fallback exists
    expect(src).not.toMatch(/\.message/);
  });

  it('the wallet card shows the CTA only on the ACTIVE connected EVM wallet', () => {
    const src = read('components/wallet/WalletManager.tsx');
    expect(src).toMatch(/isActiveConnected &&\s*\n?\s*wallet\.ecosystem\?\.toLowerCase\(\) === 'evm' &&\s*\n?\s*flareSwitch\?\.wrongNetwork/);
    expect(src).toMatch(/CHAINLIST_FLARE_URL/); // card keeps the honest way out too
  });

  it('login keeps requiring Flare but answers a decline in human words', () => {
    // The classification moved INTO the engine (ensureFlareNetwork) — the very
    // consolidation this suite demands ("classification lives in flareChain").
    // Login must delegate to it with its own prose, and the engine must be the
    // one answering a decline as a choice, in human words.
    const src = read('stores/authStore.ts');
    expect(src).toMatch(/ensureFlareNetwork\(eth, SIWE_FLARE_MESSAGES\)/);
    expect(src).toMatch(/declined in your wallet/);
    const chain = read('lib/wallet/flareChain.ts');
    expect(chain).toMatch(/isUserRejection\(err\)/);
    expect(chain).toMatch(/messages\?\.declined/);
  });

  it('classifies MetaMask 4001 as a user choice and 4902 as chain-not-added', () => {
    expect(isUserRejection({ code: 4001, message: 'User rejected the request.' })).toBe(true);
    expect(isUserRejection({ message: 'MetaMask Tx Signature: User denied' })).toBe(true);
    expect(isUserRejection({ code: 4902 })).toBe(false);
    expect(isUnrecognizedChain({ code: 4902 })).toBe(true);
    expect(isUnrecognizedChain({ message: 'Unrecognized chain ID "0xe"' })).toBe(true);
    expect(isUnrecognizedChain({ code: 4001 })).toBe(false);
  });
});

describe('banner copy is plain-words and translated', () => {
  const PAIRS: Array<[string, string]> = [
    ["You're on another network — this app runs on Flare.", 'Estás en otra red — la app funciona sobre Flare.'],
    ['Switch to Flare', 'Cambiar a Flare'],
    ["No problem — you can switch whenever you're ready.", 'Sin problema — puedes cambiar cuando quieras.'],
    [
      'Your wallet can’t add Flare automatically. Add it manually with these details, or open Chainlist:',
      'Tu wallet no puede añadir Flare automáticamente. Añádela a mano con estos datos, o abre Chainlist:',
    ],
  ];

  for (const [en, es] of PAIRS) {
    it(`«${en.slice(0, 40)}…» has its Spanish entry`, () => {
      expect(translate('es', en)).toBe(es);
      expect(translate('en', en)).toBe(en);
    });
  }

  it('both surfaces speak the SAME plain words (banner and card share copy keys)', () => {
    const banner = read('components/wallet/NetworkSwitcher.tsx');
    const card = read('components/wallet/WalletManager.tsx');
    for (const s of ["You're on another network", 'Switch to Flare', 'No problem']) {
      expect(banner).toContain(s);
      expect(card).toContain(s);
    }
    // The main sentence must not lean on jargon:
    expect("You're on another network — this app runs on Flare.").not.toMatch(/chain id|rpc/i);
  });
});
