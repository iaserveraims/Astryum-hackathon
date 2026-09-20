'use client';

/**
 * CageBirthCard — this Legacy's cage, born from one quorum signature.
 *
 * Shown where the Legacy's cage would be, when it does not exist yet. Until
 * that state was invisible: every Legacy was shown THE configured
 * cage (the first one deployed), and funding it would have deposited a second
 * council's capital into the first council's vault — with no way back out.
 */

import { useCallback, useState } from 'react';
import { Landmark, Loader2, Lock, Sparkles } from 'lucide-react';
import { GhostButton, MicroLabel, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import CageDisclosureModal from './CageDisclosureModal';
import { CouncilSigningDoors } from './CouncilMultisigFlow';
import { DisclosureBlock } from './LegacyPanel';
import { useT } from '../../i18n/LanguageProvider';
import { getUserRegion } from '../../lib/region';
import { CAGE_ACK_CANNOT_CONFIRM_FALLBACK, cageAckRefusalOf } from '../../lib/legacy/cageAckRefusal';
import { xrplLegacy, type LegacyCageCreateHandoff } from '../../services/v1Api';

/** Backend refusals → copy a person can act on (each names its own fix). */
function birthError(err: unknown, t: (s: string) => string): string {
  const body = (err as { body?: { error?: string; detail?: string } })?.body;
  const status = (err as { status?: number })?.status;
  if (body?.detail) return body.detail;
  if (status === 451) {
    return t('DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.');
  }
  return (err as Error)?.message || t('Something went wrong.');
}

export default function CageBirthCard({
  account,
  onBorn,
}: {
  /** The council (multisig) XRPL account whose quorum will sign the birth. */
  account: string;
  /** Called once the signature settles — the parent re-reads the cage. */
  onBorn?: () => void;
}) {
  const { t } = useT();
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<LegacyCageCreateHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settledNote, setSettledNote] = useState<string | null>(null);
  const [ackOpen, setAckOpen] = useState(false);

  const prepare = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const h = await xrplLegacy.cageCreatePrepare({
        account,
        amountXrp: amount.trim(),
        region: getUserRegion() ?? undefined,
      });
      setPending(h);
    } catch (err) {
      // The server is the authority on whether this person has read the one-way
      // disclosure (a modal the client could skip would be a UI gate). Its
      // refusal IS the trigger: open the text, and retry once they confirm.
      //
      // …ONLY when confirming can clear it. The server says WHY
      // the ack is missing (`cause`) and this screen never read it: a
      // security record that does not parse, or is dated ahead of the server's
      // clock, or a database that did not answer, all reopened the modal, and
      // confirming brought the same 409 back — a loop with the honest sentence
      // written on the server and never shown. Those show the sentence instead.
      const ack = cageAckRefusalOf(err);
      if (ack) {
        if (ack.confirmHelps) {
          setAckOpen(true);
          return;
        }
        setError(ack.detail ?? t(CAGE_ACK_CANNOT_CONFIRM_FALLBACK));
        return;
      }
      setError(birthError(err, t));
    } finally {
      setBusy(false);
    }
  }, [account, amount, t]);

  /** Signing puts the payment on XRPL; the executor's own sweep mints and runs
   *  the committed batch (like funding — no relay of ours is needed). */
  const onSettled = useCallback(() => {
    setPending(null);
    setAmount('');
    setSettledNote(
      t(
        'Signed. The executor is minting the XRP and running the committed batch — the cage is usually born on Flare in about 2–5 minutes. This card becomes the vault the moment it exists.',
      ),
    );
    onBorn?.();
  }, [onBorn, t]);

  // ── The composed birth, awaiting the quorum ───────────────────────────────
  if (pending) {
    return (
      <div className="space-y-3">
        <DisclosureBlock handoff={pending as never} />
        <p className="text-[12px] text-ink/55">
          {t(
            'Your council signs this ONE payment — each member from their own device. It carries the whole birth: create this Legacy\'s own cage on Flare (a vault that obeys only this council, for ever), then deposit the minted FXRP as its first principal. Nobody holds it in between, and nobody else could have created it: the factory only obeys this council\'s own account.',
          )}
        </p>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[12px] text-tone-warning">
          {t(
            'The principal that enters a cage never comes back out to an address — only the yield it earns can be paid to people. And this signature does NOT choose where the capital works: that is a second, separate order of the quorum.',
          )}
        </p>
        {/* consejo-superficies 2: one element, one rule — the async door
            stays shut (and says why) while the ceremony holds the seat. */}
        <CouncilSigningDoors
          xrplTx={pending.xrplPayment}
          account={account}
          onSettled={onSettled}
          defaultTitle={t('Create this Legacy\'s cage')}
        />
        <GhostButton onClick={() => setPending(null)}>{t('Back')}</GhostButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
        <Landmark size={15} className="text-ink/30" />
        {t('This Legacy has no cage yet')}
      </p>
      <p className="text-[12px] leading-relaxed text-ink/50">
        {t(
          'A cage is a contract deployed for ONE council: its address is written into the bridge when it is born and can never point at another. This council governs perfectly well without one — and it can never use another Legacy\'s. When the family is ready to lock productive capital in code, the quorum creates its own here, with one signature.',
        )}
      </p>

      {settledNote && <InlineNotice tone="success">{settledNote}</InlineNotice>}

      {/* El aviso del tope, ANTES de la caja de importe:
          el principal enjaulado no vuelve a una dirección, y en beta nadie
          debe encerrar más de lo que puede permitirse dejar encerrado. */}
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[12px] text-tone-warning">
        {t(
          'Beta limit: a cage accepts at most 5 XRP in total through Astryum. The principal that enters NEVER comes back out to an address — only the yield it earns can be paid to people. Do not cage anything you cannot afford to leave locked.',
        )}{' '}
        {/* The full text, before composing anything — and the same dialog the
            server demands if someone reaches the button without it. */}
        <button
          type="button"
          onClick={() => setAckOpen(true)}
          className="underline underline-offset-2 transition-colors hover:text-ink"
        >
          {t('How a cage works')}
        </button>
      </p>

      <div>
        <MicroLabel>{t('First principal (XRP)')}</MicroLabel>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={t('e.g. 5')}
          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25"
        />
        <p className="mt-1 text-[11px] text-ink/40">
          {t(
            'One payment does both: it mints this XRP into FXRP and deposits it as the cage\'s first principal. Small fees apply (minting + executor) and are disclosed before anyone signs.',
          )}
        </p>
      </div>

      <PrimaryButton onClick={() => void prepare()} disabled={busy || !amount.trim()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{' '}
        {t('Compose the birth for the quorum')}
      </PrimaryButton>

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink/45">
        <Lock size={12} className="mt-0.5 shrink-0" />
        {t(
          'The constitution must be anchored on XRPL first — the cage is born pointing at that exact text, and its rules (the venues, the lineage cut, the one-way principal) are enforced by code from block one.',
        )}
      </p>

      {ackOpen && (
        <CageDisclosureModal
          account={account}
          mode="accept"
          confirmLabel={t('I understand — compose the birth')}
          onAccepted={() => void prepare()}
          onClose={() => setAckOpen(false)}
        />
      )}
    </div>
  );
}
