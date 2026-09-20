'use client';

/**
 * SigningWalletPicker — quién firma esta entrada, y por qué carril.
 *
 * EXTRAÍDO de `DemoVaultModal`. Vivía en línea dentro de
 * un componente de 2.300 líneas, y por eso las Bóvedas con gestor se habían
 * inventado su propio selector de carril — dos botones que hacían peor lo que
 * esto ya hacía bien.
 */

import { useEffect, useMemo, useState } from 'react';

import { useT } from '../../i18n/LanguageProvider';
import { listMyWallets, type BackendWallet } from '../../services/walletLinkService';
import { transferRailOf } from '../../lib/wallet/nativeBalance';
import { walletDisplayName } from '../../lib/walletIdentity';
import { WalletSelect } from '../wallet/WalletSelect';
import { originId, FLARE_CHAIN_ID, ETHEREUM_CHAIN_ID } from '../../lib/earn/fxrpOrigin';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useAuthorities } from '../../hooks/useAuthorities';

export type Rail = 'xrpl' | 'evm';

export interface SigningCandidate {
  record: BackendWallet;
  rail: Rail;
  chainId: number;
  /** (dirección, cadena): una wallet EVM ocupa dos filas cuando hay dos cadenas. */
  key: string;
}

export interface SigningWallets {
  /**
   * La lista SIN el filtro de autoridad. La necesita quien tiene que decir
   * «tienes wallets, pero no la que estas gobernando ahora»: con solo
   * `candidates` esa frase seria indistinguible de «no tienes ninguna».
   */
  allCandidates: SigningCandidate[];
  candidates: SigningCandidate[];
  selected: SigningCandidate | null;
  selectedKey: string;
  setSelectedKey: (k: string) => void;
  /** El carril del elegido — decide el cuerpo del prepare y el payload. */
  activeRail: Rail;
  /** Recarga la lista (tras enlazar una wallet nueva desde el propio modal). */
  reload: () => void;
}

export function useSigningWallets({
  defaultRail,
  evmOnly = false,
  multiChain = false,
  preferRail,
}: {
  /** El carril por defecto de esta entrada, si no hay ninguno conectado. */
  defaultRail: Rail;
  /**
   * El carril que MANDA si tiene candidata, por encima de la wallet conectada
   * por casualidad. La persona puede cambiarla en el desplegable.
   */
  preferRail?: Rail;
  /** La entrada solo se firma en EVM (p. ej. la de FLR). */
  evmOnly?: boolean;
  /** La entrada admite Flare y Ethereum: cada wallet EVM ocupa dos filas. */
  multiChain?: boolean;
}): SigningWallets {
  const evm = useWalletPartner();
  const xrpl = useXrplWalletPartner();
  const { active: activeAuthority, activeGoverned } = useAuthorities();

  const [myWallets, setMyWallets] = useState<BackendWallet[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listMyWallets()
      .then((ws) => { if (!cancelled) setMyWallets(ws); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nonce]);

  const allCandidates = useMemo<SigningCandidate[]>(() => {
    const rows = myWallets
      .filter((w) => w.walletType !== 'smart-account')
      .map((w) => ({ record: w, rail: transferRailOf(w) }))
      .filter(
        (c): c is { record: BackendWallet; rail: Rail } =>
          c.rail !== null && (!evmOnly || c.rail === 'evm'),
      );
    return rows.flatMap((c) => {
      if (!multiChain || c.rail !== 'evm') {
        return [{ ...c, chainId: c.record.chainId ?? FLARE_CHAIN_ID, key: c.record.address }];
      }
      return [ETHEREUM_CHAIN_ID, FLARE_CHAIN_ID].map((chainId) => ({
        ...c,
        chainId,
        key: originId(c.record.address, chainId),
      }));
    });
  }, [myWallets, evmOnly, multiChain]);

  // El ámbito de firma sigue al SELECTOR DE AUTORIDAD: una autoridad única
  // estrecha la lista a su wallet; una gobernada bloquea la firma personal —
  // el capital del consejo se mueve por orden con quórum, nunca por una firma
  // personal mientras la barra dice «Gobernando…».
  const candidates = useMemo(() => {
    if (activeGoverned) return [];
    if (activeAuthority.kind === 'single') {
      const key = activeAuthority.wallet.address.toLowerCase();
      return allCandidates.filter((c) => c.record.address.toLowerCase() === key);
    }
    return allCandidates;
  }, [allCandidates, activeAuthority, activeGoverned]);

  const [selectedKey, setSelectedKey] = useState('');
  useEffect(() => {
    if (candidates.length === 0) return;
    if (candidates.some((c) => c.key === selectedKey)) return;
    // Por defecto: la wallet YA conectada como firmante (mínima sorpresa),
    // luego el carril propio de la entrada, luego la primera.
    const connected = candidates.find(
      (c) =>
        (c.rail === 'xrpl' && xrpl.address && c.record.address.toLowerCase() === xrpl.address.toLowerCase()) ||
        (c.rail === 'evm' && evm.address && c.record.address.toLowerCase() === evm.address.toLowerCase()),
    );
    const byRail = candidates.find((c) => c.rail === defaultRail);
    const preferred = preferRail ? candidates.find((c) => c.rail === preferRail) : undefined;
    setSelectedKey((preferred ?? connected ?? byRail ?? candidates[0]).key);
  }, [candidates, selectedKey, xrpl.address, evm.address, defaultRail, preferRail]);

  const selected = candidates.find((c) => c.key === selectedKey) ?? null;

  return {
    allCandidates,
    candidates,
    selected,
    selectedKey,
    setSelectedKey,
    activeRail: selected?.rail ?? defaultRail,
    reload: () => setNonce((n) => n + 1),
  };
}

/**
 * El desplegable. La etiqueta de cadena nombra DÓNDE ESTÁ ese saldo, no dónde
 * se enlazó la wallet: todas las filas EVM decían «Flare» porque ese es el
 * carril de conexión, y con dos cadenas en juego eso hacía imposible elegir.
 *
 * El nombre sigue la regla canónica: apodo → marca propia → dirección corta. El
 * `walletType` crudo ('metamask', 'xrp_identity') jamás es un nombre de pantalla.
 */
export function SigningWalletPicker({
  wallets,
  disabled = false,
  hint,
}: {
  wallets: SigningWallets;
  disabled?: boolean;
  /** La frase que explica la ruta del carril elegido. La pone quien lo usa. */
  hint?: React.ReactNode;
}) {
  const { t } = useT();
  if (wallets.candidates.length === 0) return null;

  // CON LA CARA DE CADA WALLET: el `<select>` nativo no
  // podía pintar el color ni la marca —un `<option>` no admite estilo— y aquí
  // es justo donde hay que reconocer la tuya de un vistazo. WalletSelect trae
  // la misma receta de identidad que la tarjeta de Wallets.
  return (
    <div>
      <WalletSelect
        label={t('Signing wallet')}
        value={wallets.selectedKey}
        onChange={wallets.setSelectedKey}
        disabled={disabled}
        options={wallets.candidates.map((c) => ({
          key: c.key,
          record: c.record,
          name: walletDisplayName(c.record, t),
          detail: `${c.record.address.slice(0, 8)}…${c.record.address.slice(-6)}`,
          // La cadena nombra DÓNDE ESTÁ el saldo, no dónde se enlazó la
          // wallet (ver la cabecera de este fichero).
          badge: (
            <span className="shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[10px] text-ink/55">
              {c.rail === 'xrpl' ? 'XRPL' : c.chainId === ETHEREUM_CHAIN_ID ? 'Ethereum' : 'Flare'}
            </span>
          ),
        }))}
      />
      {hint}
    </div>
  );
}

export default SigningWalletPicker;
