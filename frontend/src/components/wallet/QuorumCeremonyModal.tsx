'use client';

/**
 * QuorumCeremonyModal — la ceremonia multifirma, montada UNA vez para toda la
 * app (fundador, 22-ago-2026).
 *
 * Hermano de `XamanQRModal`: aquél atiende un payload suelto (una firma, un
 * QR); éste atiende una cuenta que firma POR QUÓRUM (un QR por llave, todos a
 * la vez). Los dos viven en `WalletProvider` y escuchan su bus, así que
 * cualquier superficie que llame a `sendIntent` los usa sin importarlos.
 *
 * Por qué global y no dentro de cada pantalla: hay diecisiete llamadas a
 * `sendIntent` (enviar, Kinetic lend, el vault, posiciones, moneyflows…) y
 * montar la ceremonia en cada una es cómo se acaba con diecisiete copias que
 * se desincronizan — que es exactamente lo que ya pasó.
 *
 * Cerrar es ABANDONAR, y se dice: la promesa de quien llamó se rechaza, para
 * que su pantalla vuelva a un estado honesto en vez de quedarse esperando una
 * firma que nadie va a dar. Los QRs vivos los retira la propia ceremonia.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import CouncilMultisigFlow from '../legacy/CouncilMultisigFlow';
import { ModalOverlay } from '../ui/ModalPortal';
import { useT } from '../../i18n/LanguageProvider';
import {
  abandonQuorumCeremony,
  onQuorumCeremony,
  reportQuorumCeremonyDispatch,
  type QuorumCeremonyRequest,
} from '../../lib/xrpl/quorumCeremonyBus';

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

export function QuorumCeremonyModal() {
  const { t } = useT();
  const [req, setReq] = useState<QuorumCeremonyRequest | null>(null);

  useEffect(() => onQuorumCeremony(setReq), []);

  if (!req) return null;

  return (
    <ModalOverlay
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onEscape={abandonQuorumCeremony}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) abandonQuorumCeremony();
      }}
    >
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-ink/10 bg-surface-1 p-5 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{t('This account signs by quorum')}</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink/50">
              {t(
                'Its keys each get their own request below — sign them from their own devices. Nothing goes out until the quorum is met.',
              )}
            </p>
            <p className="mt-1 font-mono text-[11px] text-ink/35">{shortAddr(req.account)}</p>
          </div>
          <button
            onClick={abandonQuorumCeremony}
            aria-label={t('Close')}
            className="shrink-0 rounded-lg p-1.5 text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          <CouncilMultisigFlow
            xrplTx={req.tx}
            account={req.account}
            // El hash emitido ES el resultado que esperaba quien llamó: se lo
            // devolvemos por su promesa, así su vigilante de settlement arranca
            // igual que con una firma única.
            onSettled={(hash) => req.resolve(hash)}
            // it. 31 (§1): lo que la ceremonia va haciendo con los bytes llega al
            // bus, que es quien decide qué significa CERRAR: antes de empezar,
            // devolver el asiento del dispatch; a medias, abandonar; una vez
            // emitido, jamás soltar el asiento — devolver el hash o decir que
            // puede estar fuera.
            onDispatch={(event) => reportQuorumCeremonyDispatch(req, event)}
          />
        </div>
      </div>
    </ModalOverlay>
  );
}

export default QuorumCeremonyModal;
