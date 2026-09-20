'use client';

/**
 * FormalPositions — the deliberative record of a proposal (prompt §2.2).
 *
 * THE ACTA, NOT A CHAT: each councillor may fix ONE position — for / against /
 * abstain / request changes, plus an optional brief comment — signed with
 * their own wallet and immutable once set. Who thought what, and when.
 * Deliberation itself stays ephemeral and never touches the ledger; positions
 * are what IS eternal.
 *
 * Anchoring is BATCHED: each position's signature already makes forgery
 * impossible the moment it is filed; the SET is anchored on-chain in one
 * 1-drop personal Payment at emission (or on a terminal state). The batch
 * defers the public timestamp — never the integrity.
 */
import { useCallback, useMemo, useState } from 'react';
import { Anchor, Check, FileSignature, Loader2 } from 'lucide-react';
import { GhostButton, Pill, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import {
  councilProposalsApi,
  type CouncilProposalRecord,
  type FormalStance,
} from '../../services/v1Api';
import {
  POSITION_MEMO_PREFIX,
  XRPSCAN_TX,
  councilRedactionSentence,
  readCouncilRedaction,
  sha256Hex,
  shortAddr,
} from '../../lib/xrpl/councilSigning';
import { applyXrplSignFailure, confirmOnLedger } from '../../lib/xrpl/ledgerSignOutcome';
import type { UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import {
  describeServerRefusal,
  serverRefusalText,
  type ReadableRefusal,
} from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';

const STANCES: Array<{ value: FormalStance; label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' }> = [
  { value: 'for', label: 'In favour', tone: 'success' },
  { value: 'against', label: 'Against', tone: 'danger' },
  { value: 'abstain', label: 'Abstain', tone: 'neutral' },
  { value: 'request-changes', label: 'Request changes', tone: 'warning' },
];

function stanceMeta(v: string) {
  return STANCES.find((s) => s.value === v) ?? STANCES[2];
}

/**
 * G1-cadena (round 3, finding 2) — THE THIRD IMPOSSIBLE ACTION.
 *
 * WHAT FAILED IN SILENCE: this component decided "can a position still be
 * fixed?" from the STATUS alone, and the inbox rendered it outside every tray
 * condition. So on a row whose pinned seat the ledger says is spent — the very
 * row the new amber panel exists to stop people acting on — «Fix my position»
 * was still offered. The member signed a proof in their wallet, the server
 * refused it (the deadline closes positions too), and the refusal landed in
 * the panel as the bare code PROPOSAL_NOT_LIVE.
 *
 * The deadline is not visible from `status` any more (round 1: an unresolved
 * row KEEPS `collecting`/`ready`), so the caller passes the verdict in. Pure
 * and primitive-only on purpose: this is the piece a test can hold.
 */
export function canFixPosition(status: string, seatUnresolved: boolean): boolean {
  return (status === 'collecting' || status === 'ready') && !seatUnresolved;
}

/**
 * productizer it. 25 (4) — LA PANTALLA TAPIABA UNA PUERTA QUE EL SERVIDOR ABRE.
 *
 * it. 23 apagó «Fix my position» para el cosignatario REGISTRADO con un `&& !hidden`
 * en el sitio de llamada, dando por hecho que «el mismo piso cierra esa puerta». No
 * es verdad: `POST /:id/positions` (backend/src/routes/councilProposals.ts) NO tiene
 * piso de lectura. Comprueba que la dirección esté en la SignerList de ESTA
 * propuesta, que el JSON firmado diga lo mismo que los campos, y VERIFICA el blob
 * criptográficamente — una prueba bastante más fuerte que un registro. Y
 * `redactActaForRegistered` oculta `title` y `positions` pero MANTIENE txjson,
 * signerList, quorum y blobs: el material de firma llega entero, a propósito.
 *
 * Así que quitarle la acción no protegía a nadie: le quitaba lo único que podía
 * hacer sobre una propuesta cuyos bytes ya tiene delante. Nombrar la limitación es
 * honesto; tapiar una puerta que funciona no lo es, y en este carril se parece
 * demasiado a gatear una salida.
 *
 * `positionsHidden` viaja en la firma A PROPÓSITO aunque no decida nada: es el
 * parámetro que un test sujeta para que volver a conjugarlo aquí falle en rojo.
 */
export function mayFixPosition(status: string, seatUnresolved: boolean, positionsHidden: boolean): boolean {
  void positionsHidden;
  return canFixPosition(status, seatUnresolved);
}

/**
 * productizer it. 27 (4) — LA PUERTA QUE LA it. 25 REABRIÓ CONTESTABA CON EL
 * CÓDIGO CRUDO.
 *
 * `detail || message` era una de las seis casi-gemelas que `lib/errors/
 * serverRefusal` vino a sustituir — su propia cabecera nombra a
 * `positionErrorText` como una de ellas— y era la ÚNICA que seguía sin delegar
 * (`ProposalInbox.errText` ya lo hacía). Le faltaban las dos piezas que importan
 * justo en esta puerta, y las dos caen sobre el cosignatario REGISTRADO que la
 * it. 25 acaba de rehabilitar:
 *
 *   · `detailIsProse`. `POST /:id/positions` contesta 403 `NOT_A_COUNCIL_MEMBER`
 *     con `detail: memberAccount` — una r-address pelada. Esta pantalla la
 *     imprimía COMO LA EXPLICACIÓN ENTERA: «rNaFf…», y nada más.
 *   · La reserva de códigos. Como al registrado se le sirve `positions: []`, no
 *     puede saber que uno de sus asientos ya fijó postura: firma en Xaman y
 *     recibe un 409 `POSITION_ALREADY_SET` SIN `detail`. El slug era todo lo que
 *     leía, después de haber firmado.
 *
 * Delegar es el arreglo: el lector compartido tiene las dos mitades, y ahora
 * también las salidas y la puerta (`ways` / `door`), que es lo que el 403 de
 * aquí necesita. Se conserva la mitad de cadena para quien solo quiera la frase.
 */
export function positionErrorText(err: unknown, t: (s: string) => string): string {
  return serverRefusalText(err, t);
}

/** La mitad que la pantalla pinta: la frase MÁS las salidas y la puerta. */
export function positionRefusal(err: unknown, t: (s: string) => string): ReadableRefusal {
  return describeServerRefusal(err, t);
}

export default function FormalPositions({
  proposal,
  myAddrs,
  seatUnresolved,
  onChanged,
}: {
  proposal: CouncilProposalRecord;
  myAddrs: Set<string>;
  /** The inbox's verdict-aware tray: this row's pinned seat is not settled, so
   *  the server refuses positions on it (required, not optional — a caller that
   *  forgets it is the regression this prop exists to make impossible). */
  seatUnresolved: boolean;
  onChanged: () => void;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const positions = proposal.positions ?? [];
  /**
   * it. 23 (it. 22 §2.3) — AN EMPTY ACTA IS NOT AN EMPTY ACTA.
   *
   * A REGISTERED-only reader is served `positions: []` on purpose (the family's
   * deliberation is withheld from an address nobody has proven). This component
   * read that as «nobody has fixed a position» and rendered nothing. That half is
   * still right and still said out loud below.
   *
   * productizer it. 25 (4) — PERO LA PANTALLA TAPIABA UNA PUERTA QUE EL SERVIDOR ABRE.
   *
   * it. 23 dio por hecho que «el mismo piso cierra esa puerta» y apagó la acción con
   * `&& !hidden`. No es verdad: `POST /:id/positions`
   * (backend/src/routes/councilProposals.ts) NO tiene piso de lectura. Comprueba que
   * la dirección esté en la SignerList de la propuesta, que el JSON firmado diga lo
   * mismo que los campos, y VERIFICA el blob criptográficamente — que es una prueba
   * mucho más fuerte que un registro. Y `redactActaForRegistered` oculta `title` y
   * `positions` pero mantiene txjson, signerList, quorum y blobs: el material de
   * firma llega entero, a propósito.
   *
   * Así que quitarle la acción al cosignatario REGISTRADO no le protegía de nada: le
   * quitaba lo único que podía hacer, sobre una propuesta cuyos bytes ya tiene
   * delante. Nombrar la limitación es honesto; tapiar una puerta que funciona no lo
   * es, y en este carril se parece demasiado a gatear una salida. La acción vuelve; lo
   * que se añade es la frase que dice QUÉ ve y QUÉ no.
   */
  const redaction = readCouncilRedaction(proposal);
  const hidden = redaction.positionsHidden;
  const live = mayFixPosition(proposal.status, seatUnresolved, hidden);

  // My member addresses that have not fixed a position yet.
  const fixed = useMemo(() => new Set(positions.map((p) => p.memberAccount)), [positions]);
  const myPending = useMemo(
    () => proposal.signerList.filter((s) => myAddrs.has(s.account) && !fixed.has(s.account)).map((s) => s.account),
    [proposal.signerList, myAddrs, fixed],
  );

  const [open, setOpen] = useState(false);
  const [stance, setStance] = useState<FormalStance>('for');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  // it. 27 (4): el estado admite las dos formas — una frase nuestra (validación,
  // «conecta tu Xaman») y un rechazo LEÍDO del servidor, que trae sus salidas y
  // su puerta. Sin esto la prosa llegaba y el botón no.
  const [error, setError] = useState<string | ReadableRefusal | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  // The anchor went to Xaman and we could not confirm how it ended: «anchor
  // again» is not offered — it may already be on the ledger.
  const [anchorUnconfirmed, setAnchorUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  // Validated on the ledger but the server did not record it: the acta IS
  // anchored, so anchoring again would be a second anchor, not a retry.
  const [anchoredUnrecorded, setAnchoredUnrecorded] = useState<string | null>(null);

  const fixPosition = useCallback(
    async (member: string) => {
      setBusy(true);
      setError(null);
      try {
        const trimmed = comment.trim();
        const content = {
          kind: 'astryum-council-position/v1',
          proposalId: proposal.id,
          account: proposal.account,
          member,
          stance,
          ...(trimmed ? { comment: trimmed } : {}),
          at: new Date().toISOString(),
        };
        const contentJson = JSON.stringify(content);
        const contentHash = await sha256Hex(contentJson);
        // The member signs the hash commitment with their own wallet (an
        // AccountSet proof, submit:false — same rail as wallet binding).
        const { signedTxHex } = await xrpl.service.signOwnershipProof(
          member,
          `${POSITION_MEMO_PREFIX}${contentHash}`,
        );
        await councilProposalsApi.setPosition(proposal.id, {
          memberAccount: member,
          stance,
          ...(trimmed ? { comment: trimmed } : {}),
          contentJson,
          blobHex: signedTxHex,
        });
        setOpen(false);
        setComment('');
        onChanged();
      } catch (e) {
        // The server's refusals speak prose in `detail` (PROPOSAL_NOT_LIVE used
        // to reach the family as those two words, inside the amber panel).
        setError(positionRefusal(e, t));
      } finally {
        setBusy(false);
      }
    },
    [proposal, stance, comment, xrpl.service, onChanged, t],
  );

  const anchorActa = useCallback(async () => {
    if (anchorUnconfirmed || anchoredUnrecorded) return;
    if (!xrpl.address) {
      setError(t('Connect your Xaman to anchor the record.'));
      return;
    }
    setAnchoring(true);
    setError(null);
    let handedToPartner = false;
    let anchored: string | null = null;
    try {
      const prep = await councilProposalsApi.anchorPositionsPrepare(proposal.id, xrpl.address);
      handedToPartner = true;
      const { txHash } = await xrpl.sendIntent({ tx: prep.xrplTx as never });
      // Xaman reports "signed and submitted", not applied — only a VALIDATED
      // tesSUCCESS records the acta as anchored. A tec-failed anchor recorded
      // as done is the unearned-success disease, in the DB.
      anchored = await confirmOnLedger(txHash);
      await councilProposalsApi.anchorPositionsDone(proposal.id, anchored);
      onChanged();
    } catch (e) {
      if (anchored) {
        // On the ledger, not in our record: say so, never offer a second anchor.
        setAnchoredUnrecorded(anchored);
        setError(positionRefusal(e, t));
      } else if (!handedToPartner) {
        // The server refused to prepare: its prose lives in `detail`.
        setError(positionRefusal(e, t));
      } else {
        // After the hand-off: cancelled → the button stays; validated with a
        // failure → anchoring afresh is honest; anything we could not read →
        // amber, NOT «anchor again».
        applyXrplSignFailure(e, handedToPartner, t, {
          setError: (m) => setError(m || null),
          setUnconfirmed: setAnchorUnconfirmed,
          setPhase: () => {},
        });
      }
    } finally {
      setAnchoring(false);
    }
  }, [proposal.id, xrpl, onChanged, t, anchorUnconfirmed, anchoredUnrecorded]);

  // Anchor offer: emitted or terminal, with positions, not yet anchored.
  const anchorable =
    positions.length > 0 &&
    !proposal.positionsAnchor &&
    (proposal.status === 'submitted' || proposal.status === 'expired' || proposal.status === 'withdrawn');

  // A redacted read renders the SENTENCE even with nothing else to show: that is
  // the whole point — the silence was being read as «nobody spoke».
  if (!hidden && positions.length === 0 && (!live || myPending.length === 0)) return null;

  return (
    <div className="space-y-2 rounded-lg border border-ink/[0.07] bg-ink/[0.02] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature size={13} className="text-ink/45" />
        <span className="text-[12px] font-medium text-ink/70">{t('Formal positions')}</span>
        <span className="text-[11px] text-ink/35">{t('the record — not a chat')}</span>
        {proposal.positionsAnchor && (
          <a
            href={`${XRPSCAN_TX}${proposal.positionsAnchor}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-tone-success underline"
          >
            <Anchor size={10} /> {t('anchored on-chain')}
          </a>
        )}
      </div>

      {hidden && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>{councilRedactionSentence(redaction, t)}</p>
            {/* it. 25 (4): lo que SÍ puede hacer, dicho junto a lo que no puede ver.
                Una limitación nombrada; jamás una puerta apagada. */}
            {live && myPending.length > 0 && (
              <p>
                {t(
                  'Fixing your own position is still open to you: the server takes it from any address on this signer list and verifies your wallet’s proof cryptographically, which is a stronger thing than a registration. What it will not show you is the record itself — so it cannot tell you here whether one of your seats already fixed one. An entry is immutable once filed, so a second attempt on the same seat is refused, never overwritten.',
                )}
              </p>
            )}
          </div>
        </InlineNotice>
      )}

      {positions.length > 0 && (
        <ul className="space-y-1.5">
          {positions.map((p) => {
            const meta = stanceMeta(p.stance);
            return (
              <li key={p.memberAccount} className="flex flex-wrap items-start gap-2 text-[12px]">
                <span className="font-mono text-ink/70">{shortAddr(p.memberAccount)}</span>
                <Pill tone={meta.tone}>{t(meta.label)}</Pill>
                {p.comment && <span className="text-ink/55">“{p.comment}”</span>}
              </li>
            );
          })}
        </ul>
      )}

      {live &&
        myPending.map((member) =>
          open ? (
            <div key={member} className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {STANCES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStance(s.value)}
                    aria-pressed={stance === s.value}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      stance === s.value
                        ? 'border-volt/60 bg-volt/15 text-ink'
                        : 'border-ink/10 bg-ink/[0.03] text-ink/55 hover:text-ink/85'
                    }`}
                  >
                    {t(s.label)}
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t('Brief comment (optional) — it becomes part of the signed record')}
                className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25"
              />
              <div className="flex flex-wrap items-center gap-2">
                <PrimaryButton onClick={() => void fixPosition(member)} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {t('Sign my position')} · {shortAddr(member)}
                </PrimaryButton>
                <GhostButton onClick={() => setOpen(false)} disabled={busy}>
                  {t('Cancel')}
                </GhostButton>
              </div>
              <p className="text-[11px] text-ink/40">
                {t('Immutable once signed: who thought what, and when. Your wallet signs a proof — no funds are moved.')}
              </p>
            </div>
          ) : (
            <GhostButton key={member} onClick={() => setOpen(true)}>
              <FileSignature size={12} /> {t('Fix my position')}
            </GhostButton>
          ),
        )}

      {anchorable && !anchorUnconfirmed && !anchoredUnrecorded && (
        <GhostButton onClick={() => void anchorActa()} disabled={anchoring}>
          {anchoring ? <Loader2 size={12} className="animate-spin" /> : <Anchor size={12} />}
          {t('Anchor the record (1 drop)')}
        </GhostButton>
      )}
      {anchorUnconfirmed && (
        <UnconfirmedSignatureNotice
          rail="xrpl"
          xrplKind="payment"
          unconfirmed={anchorUnconfirmed}
          onClose={() => {
            setAnchorUnconfirmed(null);
            onChanged();
          }}
        />
      )}
      {anchoredUnrecorded && (
        <a
          href={`${XRPSCAN_TX}${anchoredUnrecorded}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-tone-success underline"
        >
          <Anchor size={10} /> {t('anchored on-chain')}
        </a>
      )}

      {error && (
        <InlineNotice tone="warning">
          {typeof error === 'string' ? error : <ServerRefusalBody refusal={error} t={t} />}
        </InlineNotice>
      )}
    </div>
  );
}
