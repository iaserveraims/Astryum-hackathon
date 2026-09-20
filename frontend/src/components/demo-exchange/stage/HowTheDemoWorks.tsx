'use client';

/**
 * HowTheDemoWorks — la explicación del trato entero, en un solo sitio y
 * DETRÁS DE UN BOTÓN: sale sola la primera vez que
 * alguien entra en la mesa del exchange, y después solo cuando se pide.
 *
 * Gemelo de HowManagedVaultsWork: hechos con icono, afirmación y mecanismo.
 * Lo que dice sale del flujo canónico (Astryum_Flow_Exchange_Tenant_EndToEnd):
 * qué es simulado y qué real, quién firma qué, lo que el
 * exchange NO puede hacer (y es el producto), y lo que Astryum JAMÁS hace.
 */

import { useState } from 'react';
import { BookOpen, Building2, Eye, KeyRound, Landmark, Lock, ScanFace, ShieldCheck, Wallet, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GhostButton, MicroLabel } from '../../ui/primitives';
import { ModalOverlay } from '../../ui/ModalPortal';
import { useT } from '../../../i18n/LanguageProvider';

function Fact({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink/80">{title}</p>
        <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-ink/50">{body}</p>
      </div>
    </li>
  );
}

export function HowTheDemoWorksBody() {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <section>
        <MicroLabel>{t('Simulated exchange, real chain')}</MicroLabel>
        <ul className="mt-3 space-y-4">
          <Fact icon={Eye} title={t('What is simulated')} body={t('The exchange system — client accounts, deposit tags, the internal ledger, the KYC verdict — lives in our backend and is labelled so. It custodies no key and signs nothing. Astryum plays the operator; no exchange uses this yet.')} />
          <Fact icon={Landmark} title={t('What is real')} body={t('Everything that touches capital: the council account and its constitution on XRPL, the cage and the pote on Flare, the FAssets mint, the council orders through the FDC, the client\'s passkey account and every exit. Each leaves a receipt you read from the chain.')} />
        </ul>
      </section>

      <section>
        <MicroLabel>{t('Who signs what')}</MicroLabel>
        <ul className="mt-3 space-y-4">
          <Fact icon={Building2} title={t('The root (council) — in Xaman')} body={t('The exchange authority: anchors the constitution, births the cage, opens the pote, points the gate, directs and recalls capital. One root governs one cage, for ever.')} />
          <Fact icon={Wallet} title={t('The omnibus — in Xaman, or its hot key')} body={t('The deposit account the exchange already runs. It signs the put-to-work (a 0xFE payment) and every payout. With autopilot, its key on the exchange\'s own server does it — never on Astryum.')} />
          <Fact icon={ScanFace} title={t('The client — with Face ID')} body={t('A passkey account on Flare, theirs alone, where the shares live from the first block. One signature takes everything out. They never see a wallet, gas or FLR.')} />
          {/* XRPL-only: la identidad vive en XRPL; no hay registro Flare ni K4. */}
          <Fact icon={KeyRound} title={t('The credentials — on XRPL')} body={t('Identity lives on the ledger that governs: XLS-70 credentials on the root (its licence to operate) and on the client (their KYC, portable). The issuer signs, the subject accepts — the ledger carries the YES, never the NO.')} />
        </ul>
      </section>

      <section>
        <MicroLabel>{t('What the exchange cannot do — and is the product')}</MicroLabel>
        <ul className="mt-3 space-y-4">
          <Fact icon={Lock} title={t('Touch a client\'s shares')} body={t('They live in the client\'s passkey account. There is no approve from the client to the operator, ever — the shares inherit the standard, and only the client\'s signature redeems them.')} />
          <Fact icon={ShieldCheck} title={t('Take capital out of the mandate')} body={t('The cage only moves capital between listed venues, above the buffer floor, under the cap. Anything else reverts before it moves — the DENIED is recorded as proof. A new venue takes 30 days before a single token can go there.')} />
          <Fact icon={Building2} title={t('Operate without credentials in force')} body={t('A revoked or expired licence freezes NEW orders of the root. The clients\' exits are never frozen.')} />
        </ul>
      </section>

      <section>
        <MicroLabel>{t('What Astryum never does')}</MicroLabel>
        <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
          {t('It does not sign, custody, execute with discretion, issue the real title, administer any tenant\'s KYC registry, hold any omnibus, or decide who may be an exchange — an accredited issuer\'s credential decides, as a mechanical filter with zero discretion.')}
        </p>
      </section>

      <section>
        <MicroLabel>{t('The order of a take')}</MicroLabel>
        <ol className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-ink/55">
          {[
            t('Set up: root, credentials, constitution, cage, pote, desk — once.'),
            t('E3 · a client with a tag; the client sets up Face ID and deposits XRP (U0, U1).'),
            t('E4 · the omnibus is scanned; E5 · the exchange puts the XRP to work — shares to the client.'),
            t('E6 · capital directed by council order; E7 · the cage says no on purpose.'),
            t('U4 · the client leaves with one Face ID; E8 · the exchange pays out to their wallet.'),
            t('Evidence · every receipt read from the chain; the proof document.'),
          ].map((s, i) => (
            <li key={s} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function HowTheDemoWorksModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <ModalOverlay onEscape={onClose} lockScroll className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="my-auto flex max-h-[min(90dvh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{t('How the exchange desk works')}</h2>
            <p className="mt-1 text-[12px] text-ink/45">{t('Read once; the tour and the “?” of every step repeat what matters, where it matters.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="mt-1 shrink-0 text-ink/40 transition-colors hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
          <HowTheDemoWorksBody />
        </div>
      </div>
    </ModalOverlay>
  );
}

/** El botón que abre la explicación — arriba a la derecha de la mesa. */
export function HowTheDemoWorksButton({ className = '' }: { className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <GhostButton onClick={() => setOpen(true)} className={className}>
        <BookOpen className="mr-1.5 inline h-3.5 w-3.5" /> {t('How it works')}
      </GhostButton>
      {open ? <HowTheDemoWorksModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export default HowTheDemoWorksBody;
