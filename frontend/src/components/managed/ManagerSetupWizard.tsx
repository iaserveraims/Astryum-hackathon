'use client';

/**
 * ManagerSetupWizard — «Configurar la cuenta» para managed vaults, EN UN SOLO
 * SITIO: el gemelo del Constitute del Legacy — el RAIL de
 * estaciones numeradas (check al completarse, DETECTADO del ledger, jamás un
 * estado local), la fracción «n / N», el propósito y el coste honesto de cada
 * estación — con los colores de managed («color no»).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, KeyRound, Landmark, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Card, GhostButton, MicroLabel, SegmentedControl } from '../ui/primitives';
import { StationProgress, StationRailLayout } from '../ui/StationProgress';
import { StationDoneStrip, useResumeToast } from '../ui/StationDoneNotice';
import { shortAddr } from '../../lib/institutional/format';
import { useAuthStore } from '../../stores/authStore';
import { invalidateCommunity } from '../../lib/institutional/useCommunity';
import { ActorKindBadge } from './managerIdentity';
import type { ActorKind } from '../../lib/institutional/api';
import { useT } from '../../i18n/LanguageProvider';
import { WalletSelect } from '../wallet/WalletSelect';
import { useManagerAccount } from '../../hooks/useManagerAccount';
import { CouncilOrderInFlightConfirm, XamanSignBlockedNote, XamanSingleSign } from '../xrpl/XamanSingleSign';
import { readManagerCredentialStatus } from '../../lib/xrpl/credentialsApi';
import {
  prepareCageCreate,
  prepareCouncilAnchor,
  readCouncilAnchor,
  readCouncilCage,
  readManagerProfile,
  saveManagerProfile,
  type CouncilAnchorPrepared,
  type CageBirthHandoff,
  mayConfirmAnotherOrder,
  sameOrderMinutesAgo,
} from '../../lib/institutional/api';
import { ManagerPublicProfile } from './ManagerPublicProfile';
import { buildConstitution } from '../../lib/institutional/constitutionTemplate';
import { notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { initiateBinding, confirmBinding } from '../../services/walletLinkService';
import { WalletServiceFactory } from '../../services/wallets/WalletServiceFactory';
import type { XamanWalletService } from '../../services/wallets/XamanWalletService';
import { ManagerAccountInXaman } from './ManagerAccountInXaman';
import { ManagerTitleStation } from './ManagerTitleStation';
import { VaultCreator } from './VaultCreator';


async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ── Estación 3: la constitución, FÁCIL — como el Legacy ────────────────────
 * Plantilla editable o documento propio pegado; el hash se calcula EN VIVO en
 * el navegador; la cuenta es la que se está configurando. Si el ledger ya
 * tiene el ancla, se enseña — la estación se re-detecta, no se re-pide. */
// Exportada: la mesa del exchange la reutiliza tal cual — una cuenta
// XRPL que ancla / pare es la misma ceremonia sea gestor o exchange.
export function ConstitutionStation({
  account,
  anchored,
  anchoredSha,
  onAnchored,
  template: templateOverride,
  onBlockedChange,
  settling = false,
}: {
  account: string;
  anchored: boolean;
  anchoredSha?: string;
  onAnchored: () => void;
  /** Plantilla del caller (el exchange trae la SUYA, con el omnibus
   *  como regla de designación). Sin ella, la del gestor de siempre. */
  template?: string;
  /** The DIDSet signature can no longer be dropped: the wizard must not leave
   *  this station (its rail would unmount it). `false` on unmount. */
  onBlockedChange?: (blocked: boolean) => void;
  /** Firmado y esperando al ledger (el wizard relee): nada que firmar mientras tanto. */
  settling?: boolean;
}) {
  const { t } = useT();
  // La constitución COMPLETA: doce artículos con huecos [ … ] que el
  // gestor rellena; sale en el idioma de la interfaz. Ver constitutionTemplate.
  const template = useMemo(() => templateOverride ?? buildConstitution(t, account), [t, account, templateOverride]);

  const [mode, setMode] = useState<'template' | 'own'>('template');
  const [text, setText] = useState('');
  const [uri, setUri] = useState('');
  const [hash, setHash] = useState('');
  const [pending, setPending] = useState<CouncilAnchorPrepared | null>(null);
  // The DIDSet request is live in Xaman (or signed): Cancel steps aside.
  const [pendingBlocked, setPendingBlocked] = useState(false);
  // …and so does the wizard's station rail.
  useEffect(() => { onBlockedChange?.(pendingBlocked); }, [pendingBlocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange?.(false), [onBlockedChange]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === 'template' && text.trim() === '') setText(template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // El hash, EN VIVO y solo: el user jamás lo teclea.
  useEffect(() => {
    let alive = true;
    const v = text.trim();
    if (!v) { setHash(''); return; }
    void sha256Hex(v).then((h) => { if (alive) setHash(h); });
    return () => { alive = false; };
  }, [text]);

  async function anchor() {
    setError('');
    if (!hash) return setError(t('Write or paste the document first — the fingerprint computes itself.'));
    if (uri.trim() && !/^(https|ipfs):\/\/\S+$/.test(uri.trim())) return setError(t('The link must be https:// or ipfs:// (optional).'));
    setBusy(true);
    const res = await prepareCouncilAnchor({ account, documentSha256Hex: hash, documentUri: uri.trim() || undefined });
    setBusy(false);
    if (!res.ok) return setError(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
    setPending(res.data);
  }

  if (pending) {
    return (
      <Card className="p-6">
        <XamanSingleSign
          txjson={pending.xrplTx as Record<string, unknown>}
          title={t('Anchor the constitution (DIDSet) — your signature')}
          onSettled={() => { setPending(null); onAnchored(); }}
          onBlockedChange={setPendingBlocked}
          onCancelled={() => setPending(null)}
        />
        {pendingBlocked ? (
          <XamanSignBlockedNote className="mt-3" />
        ) : (
          <button type="button" onClick={() => setPending(null)} className="mt-3 text-[11px] text-ink/50">{t('Cancel')}</button>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
        <div className="min-w-0 flex-1">
          <MicroLabel>{t('The constitution — template or your own')}</MicroLabel>

          {/* Lo ya HECHO se enseña primero: el ledger manda. */}
          {anchored ? (
            <p className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5 text-[12px] text-emerald-500/90">
              {t('Already anchored on the ledger')}{anchoredSha ? ` — SHA-256 ${anchoredSha.slice(0, 12)}…` : ''}. {t('Anchoring again replaces the fingerprint.')}
            </p>
          ) : null}

          <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
            {t('Nobody writes a constitution from a blank page: start from the template and edit freely, or paste your own document. Only its fingerprint is anchored — the text never leaves this browser.')}
          </p>

          <div className="mt-3 flex gap-1.5">
            <GhostButton onClick={() => setMode('template')} className={mode === 'template' ? 'border-volt/50 text-volt' : ''}>{t('Start from the template')}</GhostButton>
            <GhostButton onClick={() => { setMode('own'); setText(''); }} className={mode === 'own' ? 'border-volt/50 text-volt' : ''}>{t('Paste my own document')}</GhostButton>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={22}
            placeholder={mode === 'own' ? t('Paste the full text of your governance document…') : ''}
            className="mt-2 w-full rounded-lg border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-3 py-2 font-mono text-[11px] leading-relaxed"
          />

          <label className="mt-2 block text-[11px] text-ink/50">
            {t('Where the document lives (optional — https/ipfs)')}
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs://… · https://…" className="mt-1 w-full rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[12px]" />
          </label>

          {/* Los dos datos que el user NO teclea, a la vista: su cuenta y la huella. */}
          <div className="mt-3 space-y-1 rounded-lg border border-ink/10 p-2.5">
            <p className="text-[11px] text-ink/50">{t('Anchored to account')}: <span className="font-mono text-ink/75">{shortAddr(account)}</span> <span className="text-ink/35">({t('this one — set automatically')})</span></p>
            <p className="break-all text-[11px] text-ink/50">SHA-256: <span className="font-mono text-ink/75">{hash || t('(computes as you write)')}</span></p>
          </div>

          {error ? <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
          {/* FIRMADO, EN VALIDACIÓN: mientras el ledger valida y el wizard relee,
              el botón desaparece y se dice qué pasa — una firma es una. */}
          {settling ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-tone-success/20 bg-tone-success/[0.05] p-2.5 text-[11px] text-ink/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-tone-success" /> {t('Signed. The ledger is validating it and this station will turn green on its own — nothing to sign again.')}
            </p>
          ) : (
            <GhostButton onClick={() => void anchor()} disabled={busy || !hash} className="mt-3 border-volt/40 text-volt">
              <Landmark className="mr-1 inline h-3.5 w-3.5" /> {t('Anchor the fingerprint (DIDSet — 1 signature)')}
            </GhostButton>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Estación 4: la JAULA, con estación propia ─────────────
 * Una firma 0xFE hace nacer la jaula obedeciendo a esta cuenta. La estación
 * se marca hecha cuando la FACTORY dice que existe — no cuando se firmó. */
// Exportada: la mesa del exchange la reutiliza tal cual — una cuenta
// XRPL que ancla / pare es la misma ceremonia sea gestor o exchange.
export function CageBirthStation({
  account,
  cage,
  onBorn,
  titleMissing,
  onGoTitle,
  onBlockedChange,
  birthInFlight = null,
  settling = false,
}: {
  account: string;
  cage: string | null;
  onBorn: () => void;
  /** La puerta del ledger está encendida y el Título NO está completo: la jaula se negará. */
  titleMissing?: boolean;
  onGoTitle?: () => void;
  /** The 0xFE birth signature can no longer be dropped: the wizard must not
   *  leave this station (its rail would unmount it). `false` on unmount. */
  onBlockedChange?: (blocked: boolean) => void;
  /** El servidor recuerda un nacimiento FIRMADO que la factory aún no conoce. */
  birthInFlight?: { signedAt: string; signedTxHash: string | null } | null;
  /** Firmado en esta sesión y esperando la prueba (el wizard relee). */
  settling?: boolean;
}) {
  const { t } = useT();
  // PREDETERMINADO: la jaula no bloquea capital — el XRP de
  // la orden solo paga el cruce (FDC) y el gas de crear el contrato. Nada que
  // teclear: un botón.
  const AMOUNT_XRP = '0.5';
  const [birth, setBirth] = useState<CageBirthHandoff | null>(null);
  // The 0xFE birth request is live in Xaman (or signed): Cancel steps aside —
  // dropping it and composing again was a second birth beside a signable one.
  const [birthBlocked, setBirthBlocked] = useState(false);
  // …and so does the wizard's station rail.
  useEffect(() => { onBlockedChange?.(birthBlocked); }, [birthBlocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange?.(false), [onBlockedChange]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // FIRMADO EN ESTA SESIÓN: desde que Xaman firma, esta estación es «en vuelo» — sin botón
  // de componer — hasta que la factory conozca la jaula o el servidor diga que
  // el nacimiento ya no está en vuelo. El servidor lo recuerda entre recargas
  // (birthInFlight) y su prepare se niega con 409 CAGE_BIRTH_IN_FLIGHT.
  const [signedHere, setSignedHere] = useState<{ signedAt: string; signedTxHash: string | null } | null>(null);
  const [inFlight, setInFlight] = useState<{ detail?: string; code?: string; minutesAgo?: number | null } | null>(null);
  const flight = birthInFlight ?? signedHere;

  async function prepare(confirmAnotherOrder = false) {
    setError('');
    setInFlight(null);
    setBusy(true);
    // Nace SIEMPRE siguiendo el registro de Astryum; la lista eterna propia es
    // un caso avanzado y vive en la consola de Operar.
    const res = await prepareCageCreate({ account, amountXrp: AMOUNT_XRP, allowedTargets: [], ...(confirmAnotherOrder ? { confirmAnotherOrder } : {}) });
    setBusy(false);
    if (!res.ok) {
      // El servidor recuerda un nacimiento firmado en vuelo: la salida es una
      // decisión explícita, nunca un reintento silencioso (mismo patrón que
      // las órdenes del consejo).
      if (mayConfirmAnotherOrder(res.refusal) && !confirmAnotherOrder) {
        return setInFlight({ detail: res.refusal.detail, code: res.refusal.error, minutesAgo: sameOrderMinutesAgo(res.refusal) });
      }
      return setError(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
    }
    setBirth(res.data);
  }

  if (cage) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-500/90">
          <Check className="h-4 w-4" /> {t('Your cage is born and obeys this account')} — <span className="font-mono text-[12px]">{shortAddr(cage)}</span>
        </p>
        <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-ink/50">
          {t('One cage per XRPL account, for ever. Next station: the first vault opens inside it.')}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
        <div className="min-w-0 flex-1">
          <MicroLabel>{t('Birth your cage')}</MicroLabel>
          <ol className="mt-2 space-y-2">
            {[
              t('One signature (0xFE) from THIS account makes the cage exist on Flare, obeying only this account — no key of Astryum anywhere.'),
              t('The cage locks NO capital, ever: from now on every order of this account passes through it, and that is all it does.'),
              `${t('The order carries a fixed')} ${AMOUNT_XRP} XRP — ${t('it pays the crossing toll; whatever is left is minted as FXRP into YOUR Personal Account — your money, and the fuel for future costs — always paid FROM XRPL. The first 3 potes carry NO Astryum fee (the network always charges its own). The cage appears here on its own once proven.')}`,
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12px] leading-relaxed text-ink/55">
                <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 bg-ink/[0.04] font-mono text-[10px] text-ink/50">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>

          {/* Decirlo ANTES de pulsar: si el Título no está completo, la jaula se negará
              con MANAGER_CREDENTIAL_REQUIRED — mejor la puerta a la estación
              que un botón condenado. */}
          {titleMissing ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-tone-warning">
              <span className="min-w-0 flex-1">
                {t('The ledger will refuse this birth until the Title station is complete: every required credential, from an accepted issuer, accepted in your Xaman.')}
              </span>
              {onGoTitle ? (
                <button type="button" onClick={onGoTitle} className="shrink-0 rounded-md border border-tone-warning/40 px-2 py-1 text-[11px] font-medium">
                  {t('Go to the Title station')} →
                </button>
              ) : null}
            </div>
          ) : null}

          {birth ? (
            <div className="mt-3 space-y-2">
              <XamanSingleSign
                txjson={birth.xrplPayment}
                title={t('Birth the cage — your 0xFE signature')}
                // The REAL hash, the moment Xaman signs. This used to send
                // '' after validation: the backend answered 400 INVALID_TX_HASH and
                // never learned the hash, so the seat could expire under a signed 0xFE.
                onSigned={(hash) => notifyHandoffSigned(birth.memoHex, hash)}
                onSettled={(hash) => {
                  // Again with the validated hash: idempotent server-side (alreadySigned).
                  notifyHandoffSigned(birth.memoHex, hash);
                  setBirth(null);
                  setSignedHere({ signedAt: new Date().toISOString(), signedTxHash: hash });
                  onBorn();
                }}
                onBlockedChange={setBirthBlocked}
                onCancelled={() => setBirth(null)}
              />
              {birthBlocked ? (
                <XamanSignBlockedNote />
              ) : (
                <button type="button" onClick={() => setBirth(null)} className="text-[11px] text-ink/50">{t('Cancel')}</button>
              )}
            </div>
          ) : flight ? (
            // EN VUELO: ya está firmado; se dice y no se ofrece firmar de nuevo.
            <div className="mt-3 space-y-1.5 rounded-lg border border-tone-success/20 bg-tone-success/[0.05] p-3 text-[11px] leading-relaxed text-ink/65">
              <p className="flex items-center gap-2 font-medium text-tone-success">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Signed — the network is proving your cage on Flare.')}
              </p>
              <p>
                {t('One signature is one birth: nothing to sign again, and nothing more is charged. This station turns green on its own, usually within a couple of minutes.')}
                {flight.signedTxHash ? (
                  <>
                    {' '}
                    <a href={`https://xrpscan.com/tx/${flight.signedTxHash}`} target="_blank" rel="noreferrer" className="font-mono text-volt underline-offset-2 hover:underline">
                      {t('Your signature on the ledger')} ↗
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          ) : settling ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-tone-success/20 bg-tone-success/[0.05] p-2.5 text-[11px] text-ink/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-tone-success" /> {t('Signed. The ledger is validating it and this station will turn green on its own — nothing to sign again.')}
            </p>
          ) : inFlight ? (
            <CouncilOrderInFlightConfirm
              className="mt-3"
              detail={inFlight.detail}
              code={inFlight.code}
              minutesAgo={inFlight.minutesAgo}
              busy={busy}
              onConfirm={() => void prepare(true)}
              onDismiss={() => setInFlight(null)}
            />
          ) : (
            <GhostButton onClick={() => void prepare()} disabled={busy || !!titleMissing} className="mt-3 border-volt/40 text-volt">
              {t('Compose the birth (1 signature)')}
            </GhostButton>
          )}

          {notice ? <p className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] text-ink/60">{notice}</p> : null}
          {error ? <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
        </div>
      </div>
    </Card>
  );
}

/* ── Estación 6: el PERFIL PÚBLICO ─────────────────────────
 * Campos auto-declarados + foto; los clientes lo revisan ANTES de depositar.
 * Solo lo escribe el dueño PROBADO de la r-address (el backend lo exige).
 * Debajo, la vista EXACTA que verá el cliente — con las credenciales del
 * ledger («Verified», hasta cuándo, y el enlace a la prueba en Base). */
function ProfileStation({ account, onSaved }: { account: string; onSaved: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState({ displayName: '', entity: '', bio: '', avatarUrl: '', website: '', twitter: '' });
  // Persona o agente de IA: auto-declarado, y siempre visible después.
  const [actorKind, setActorKind] = useState<ActorKind>('human');
  // «Usar mi foto de cuenta» (Settings → Perfil): el servidor la copia al
  // perfil público al guardar — la misma cara en la app y en la comunidad.
  const accountAvatar = useAuthStore((st) => st.user?.avatar ?? '');
  const [useAccountPhoto, setUseAccountPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    let alive = true;
    readManagerProfile(account)
      .then((d) => {
        if (!alive || !d.profile) return;
        setForm({
          displayName: d.profile.displayName ?? '',
          entity: d.profile.entity ?? '',
          bio: d.profile.bio ?? '',
          // Una foto en data URL (copiada de la cuenta) no se enseña como texto.
          avatarUrl: (d.profile.avatarUrl ?? '').startsWith('data:') ? '' : (d.profile.avatarUrl ?? ''),
          website: d.profile.website ?? '',
          twitter: d.profile.twitter ?? '',
        });
        setActorKind(d.profile.actorKind ?? 'human');
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [account]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /**
   * Prueba XRPL-nativa de que ESTA r-address es tuya: una firma Xaman
   * (AccountSet submit:false, nonce en el memo — jamás se envía al ledger). Es
   * lo que el backend exige como «dueño probado» para escribir el perfil
   * público: la MISMA identidad con la que gobiernas, sin ETH. Astryum nunca
   * firma — el QR/deeplink lo resuelve el XamanQRModal global.
   */
  async function proveAccountOwnership(): Promise<void> {
    const { nonce, message } = await initiateBinding(account, 'xrpl');
    const xaman = WalletServiceFactory.getWalletService('xaman') as XamanWalletService;
    const { signedTxHex } = await xaman.signOwnershipProof(account, message);
    await confirmBinding({ nonce, message, signedTxHex, address: account, chainType: 'xrpl', mode: 'read_and_receive' });
  }

  async function save() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const payload = { account, ...form, actorKind, useAccountAvatar: useAccountPhoto || undefined };
      let res = await saveManagerProfile(payload);
      // El perfil público SOLO lo escribe el dueño probado. Si aún no hay prueba
      // de esta cuenta, se pide con UNA firma Xaman aquí mismo y se reintenta —
      // sin salir del wizard ni enumerar pasos (doctrina «flujo mecánico»).
      if (!res.ok && res.refusal.error === 'NOT_YOUR_ACCOUNT') {
        setNotice(t('Prove this account is yours: sign once in Xaman (nothing is sent to the ledger, no cost). Astryum never signs.'));
        await proveAccountOwnership();
        setNotice('');
        res = await saveManagerProfile(payload);
      }
      if (!res.ok) return setError(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
      setUseAccountPhoto(false);
      void invalidateCommunity();
      setNotice(t('Profile saved — clients will see it in your public card.'));
      setPreviewKey((p) => p + 1);
      onSaved();
    } catch (e) {
      // Firma cancelada en Xaman, o el proof falló: el perfil no se guarda, pero
      // no es un fallo del sistema — se puede reintentar sin más.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const input = 'mt-1 w-full rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 text-[12px]';
  return (
    <>
      <Card className="p-6">
        <MicroLabel>{t('Public profile')}</MicroLabel>
        <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
          {t('What clients read before putting capital in your vault. It is your word, clearly labelled as such — the verified part (credentials, expiry, the proof on Base) is read from the ledger and cannot be typed.')}
        </p>
        {/* Persona o agente: se declara aquí y se ve en todas partes. */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-ink/50">{t('This account is run by')}</span>
          <SegmentedControl<ActorKind>
            layoutId="manager-actor-kind"
            value={actorKind}
            onChange={setActorKind}
            options={[
              { key: 'human', label: t('A person') },
              { key: 'agent', label: t('An AI agent') },
            ]}
          />
          <ActorKindBadge kind={actorKind} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] text-ink/50">{t('Display name')}
            <input value={form.displayName} onChange={set('displayName')} className={input} />
          </label>
          <label className="block text-[11px] text-ink/50">{t('Entity / firm (optional)')}
            <input value={form.entity} onChange={set('entity')} className={input} />
          </label>
          <label className="block text-[11px] text-ink/50 sm:col-span-2">{t('Bio (optional)')}
            <textarea value={form.bio} onChange={set('bio')} rows={3} className={input} />
          </label>
          <div className="block text-[11px] text-ink/50">
            {t('Photo')}
            <div className="mt-1 flex items-center gap-2">
              {/* Tu foto de cuenta, a un clic: la misma en la app y en la comunidad. */}
              <button
                type="button"
                onClick={() => { setUseAccountPhoto(true); setForm((f) => ({ ...f, avatarUrl: '' })); }}
                disabled={!accountAvatar}
                aria-pressed={useAccountPhoto}
                title={accountAvatar ? t('Use my account photo') : t('Your account has no photo yet — add one in Settings → Profile.')}
                className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${useAccountPhoto ? 'border-volt/50 bg-volt/[0.08] text-volt' : 'border-ink/10 text-ink/60 hover:border-ink/25'}`}
              >
                {accountAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={accountAvatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                {t('Use my account photo')}
              </button>
              <input
                value={form.avatarUrl}
                onChange={(e) => { setUseAccountPhoto(false); set('avatarUrl')(e); }}
                placeholder={t('or an https:// link')}
                className={`${input} mt-0 flex-1 font-mono`}
              />
            </div>
          </div>
          <label className="block text-[11px] text-ink/50">{t('Website (optional — https)')}
            <input value={form.website} onChange={set('website')} placeholder="https://…" className={`${input} font-mono`} />
          </label>
          <label className="block text-[11px] text-ink/50">{t('X / Twitter handle (optional)')}
            <input value={form.twitter} onChange={set('twitter')} placeholder="@…" className={input} />
          </label>
        </div>
        {error ? <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] text-ink/60">{notice}</p> : null}
        <GhostButton onClick={() => void save()} disabled={busy || form.displayName.trim().length < 2} className="mt-3 border-volt/40 text-volt">
          {t('Save profile')}
        </GhostButton>
      </Card>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MicroLabel>{t('How clients will see it')}</MicroLabel>
          <Link href={`/app/community?actor=${encodeURIComponent(account)}`} className="text-[11px] text-volt hover:underline">
            {t('See your page in the community')} →
          </Link>
        </div>
        <div className="mt-2">
          <ManagerPublicProfile key={previewKey} account={account} />
        </div>
      </div>
    </>
  );
}

/* ── El wizard ──────────────────────────────────────────────────────────────*/

export function ManagerSetupWizard({
  account,
  hasVault,
  onOpened,
  jumpTo,
}: {
  account: string;
  hasVault: boolean;
  onOpened: () => void;
  /** Una orden externa de ir a una estación (p. ej. «renovar el título» desde
   *  Operar). El nonce permite repetir la misma estación dos veces seguidas. */
  jumpTo?: { step: number; nonce: number } | null;
}) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [credOk, setCredOk] = useState(false);
  // ¿Exige el ledger el título? Solo si la puerta está encendida: la estación
  // es obligatoria u opcional según ESO, no según lo que nos gustaría.
  const [gate, setGate] = useState<'unknown' | 'enabled' | 'disabled'>('unknown');
  const [anchor, setAnchor] = useState<{ anchored: boolean; sha256?: string }>({ anchored: false });
  const [cage, setCage] = useState<string | null>(null);
  const [birthInFlight, setBirthInFlight] = useState<{ signedAt: string; signedTxHash: string | null } | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  /** Una firma espera al ledger y el wizard relee: las estaciones no reofrecen firmar. */
  const [settling, setSettling] = useState(false);
  // RETOMAR DONDE ESTÁ LA REALIDAD: la primera lectura del ledger
  // decide la estación de aterrizaje — la primera obligatoria pendiente. Se
  // hace UNA vez; después manda el clic del usuario (o un jumpTo), nunca una
  // relectura. Antes cada visita empezaba en «Cuenta» aunque fueras por la 4ª.
  const landed = useRef(false);
  /** Dónde aterrizó la primera lectura real (para el aviso de «retomado»). */
  const [landedAt, setLandedAt] = useState<number | null>(null);
  // The active station has a Xaman signature that can no longer be dropped
  // (live QR, confirming, unconfirmed, validated failure). Leaving the station
  // unmounts it, and XamanSingleSign's unmount cancel is blind: a signature made
  // in that gap is followed by nobody and the station re-offers it.
  // The rail — and any jump — stays put until it resolves.
  const [stationBlocked, setStationBlocked] = useState(false);
  const go = (i: number) => { if (stationBlocked) return; landed.current = true; setStep(i); };

  // La elección de la cuenta gestora (jamás una elección silenciosa;
  // cuenta DEDICADA solo para esto). Las candidatas son las Xaman
  // conectadas en este navegador Y las XRPL enlazadas a la cuenta (
  // solo con las conectadas, en otro navegador la cuenta configurada no se
  // podía ni elegir). El apodo del DUEÑO en el selector.
  // La MISMA regla que sigue la mesa: useManagerAccount.
  const manager = useManagerAccount();

  // DETECCIÓN: cada verdad se relee del ledger al entrar y al cambiar de
  // estación. «No pude leer» deja el estado anterior — jamás pinta un check.
  // Devuelve lo leído para que el aterrizaje se calcule con la MISMA lectura.
  const detect = useCallback(async () => {
    if (!account) return null;
    const [cred, anc, cg, prof] = await Promise.allSettled([
      readManagerCredentialStatus(account),
      readCouncilAnchor(account),
      readCouncilCage(account),
      readManagerProfile(account),
    ]);
    const out = { credOk: false, gateOn: false, anchored: false, cage: false, profile: false };
    if (cred.status === 'fulfilled') {
      out.credOk = !!cred.value.ok;
      out.gateOn = cred.value.gate === 'enabled';
      setCredOk(out.credOk);
      setGate(out.gateOn ? 'enabled' : 'disabled');
    }
    if (anc.status === 'fulfilled') { setAnchor(anc.value); out.anchored = anc.value.anchored; }
    if (cg.status === 'fulfilled') { setCage(cg.value.cage); setBirthInFlight(cg.value.cage ? null : cg.value.birthInFlight ?? null); out.cage = !!cg.value.cage; }
    if (prof.status === 'fulfilled') { setHasProfile(!!prof.value.profile); out.profile = !!prof.value.profile; }
    return out;
  }, [account]);

  useEffect(() => {
    void detect().then((r) => {
      if (!r || landed.current) return;
      landed.current = true;
      // El orden del raíl, con lo que el ledger exige: título solo si la puerta
      // está encendida; constitución, jaula y vault siempre; perfil, nunca.
      const pending = [
        { i: 1, done: r.credOk, required: r.gateOn },
        { i: 2, done: r.anchored, required: true },
        { i: 3, done: r.cage, required: true },
        { i: 4, done: hasVault, required: true },
        { i: 5, done: r.profile, required: false },
      ];
      const first = pending.find((p) => p.required && !p.done) ?? pending.find((p) => !p.done);
      const target = first ? first.i : pending[pending.length - 1].i;
      setStep(target);
      setLandedAt(target);
    });
    // hasVault solo importa para el aterrizaje, que ocurre una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detect, step]);

  useEffect(() => {
    if (jumpTo) go(jumpTo.step);
  }, [jumpTo]);

  /**
   * TRAS UNA FIRMA, el ledger tarda unos segundos en validar y la primera
   * relectura suele llegar pronto: la estación seguía sin check y el gestor
   * volvía a firmar. Se relee
   * cada 4 s hasta que `done()` diga sí, con tope de 90 s.
   */
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Vivo mientras el wizard esté montado: un `detect` en vuelo al desmontar
  // (cambiar a Operar justo tras firmar) programaba el siguiente tick y el
  // sondeo seguía 90 s de fondo, cuatro lecturas cada 4 s, contra el mismo RPC
  // que la sala nueva estaba usando (revisión).
  const mounted = useRef(true);
  const settleThenDetect = useCallback(
    (done: (r: NonNullable<Awaited<ReturnType<typeof detect>>>) => boolean) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      const startedAt = Date.now();
      setSettling(true);
      const tick = async () => {
        const r = await detect();
        if (!mounted.current) return;
        if ((r && done(r)) || Date.now() - startedAt > 90_000) { setSettling(false); return; }
        pollTimer.current = setTimeout(() => void tick(), 4_000);
      };
      void tick();
    },
    [detect],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const stations = [
    { label: t('XRPL account'), purpose: t('A DEDICATED account, used for managing and nothing else — pick it or create it'), effort: t('~2 min · Xaman'), done: !!account, required: true, how: t('an XRPL wallet of yours — linked to your account or connected in this browser') },
    { label: t('Manager title'), purpose: t('The first-time verification: KYC and AIFM credentials, issued to THIS account'), effort: t('~10 min · partner + your signatures'), done: credOk, required: gate === 'enabled', how: t('the ledger gate: every required credential in force, from an accepted issuer') },
    { label: t('The constitution'), purpose: t('Template or your own document; the fingerprint computes itself and anchors with 1 signature'), effort: t('~5 min · 1 signature'), done: anchor.anchored, required: true, how: t('DID object of the account, read from XRPL') },
    { label: t('The cage'), purpose: t('Born with one 0xFE signature, obeying this account for ever'), effort: t('~3 min · 1 signature + toll'), done: !!cage, required: true, how: t('cageOf(account) on the factory, read from Flare') },
    { label: t('First vault'), purpose: t('The pote opens inside the cage, with your parameters'), effort: t('~5 min · 1 signature + FDC toll'), done: hasVault, required: true, how: t('potes of the cage, read from Flare') },
    { label: t('Public profile'), purpose: t('The card clients review before depositing — your word plus the ledger’s facts'), effort: t('~3 min · here'), done: hasProfile, required: false, how: t('your public profile, saved on the server') },
  ];
  const doneCount = stations.filter((s) => s.done).length;
  // La ceremonia contada entera solo la primera vez: con algo ya hecho, la
  // cabecera de estación orienta de sobra y el párrafo sería un peaje diario.
  const firstRun = doneCount <= 1;
  // «¿Por qué está hecha?» vive en la franja de la estación (StationDoneStrip);
  // el aterrizaje más allá de la primera estación se avisa UNA vez, en una
  // notificación temporal (sin popups).
  useResumeToast({ landed: landedAt, stations, key: account });
  const nextPendingIdx = stations.findIndex((s) => !s.done);

  // EL RAÍL LATERAL: la barra al lado del contenido, pegada arriba
  // mientras se hace scroll, con los nombres a la vista, Atrás/Siguiente y el
  // «¿Por qué hecha?». Los checks siguen viniendo del ledger. En la estación
  // del creador, el creador navega SUS pasos por dentro; las estaciones, aquí.
  const rail = (
    <StationProgress
      stations={stations.map((s) => ({ label: s.label, done: s.done }))}
      current={step}
      onSelect={go}
      ariaLabel={t('Setup stations')}
      doneWord={t('done')}
      // While the active station's signature blocks, Back/Next are not offered
      // (and `go` refuses a segment click): leaving would unmount the signature.
      onBack={stationBlocked ? undefined : () => go(Math.max(0, step - 1))}
      onNext={stationBlocked ? undefined : () => go(Math.min(stations.length - 1, step + 1))}
    />
  );

  return (
    <StationRailLayout rail={rail}>
    <div className="space-y-5">
      {/* La cabecera de estación: dónde estás, qué se responde y qué cuesta. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold tracking-tight text-ink">{stations[step].label}</span>
        <span className="text-[12px] text-ink/45">{stations[step].purpose}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {/* Obligatoria u opcional: dicho desde el ledger (el título solo si la
              puerta está encendida), para que nadie recorra una estación que
              no le hace falta hoy. */}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${stations[step].required ? 'border-volt/30 bg-volt/[0.06] text-volt/80' : 'border-ink/10 bg-ink/[0.03] text-ink/40'}`}>
            {stations[step].required ? t('Required') : t('Optional')}
          </span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink/40">
            {stations[step].effort}
          </span>
        </span>
      </div>
      <StationDoneStrip
        done={stations[step].done}
        how={stations[step].how}
        nextPendingLabel={nextPendingIdx >= 0 && nextPendingIdx !== step ? stations[nextPendingIdx].label : undefined}
        onNextPending={nextPendingIdx >= 0 && nextPendingIdx !== step ? () => go(nextPendingIdx) : undefined}
      />
      {stationBlocked ? (
        <div className="space-y-0.5">
          <p className="text-[11px] leading-relaxed text-tone-warning">{t('The other stations stay closed until this signature is resolved.')}</p>
          <XamanSignBlockedNote />
        </div>
      ) : null}

      {step === 0 && (
        <>
          {/* La ceremonia, contada antes de empezar — el gemelo del Legacy.
              Solo en la primera visita: después ya sabes cómo va. */}
          {firstRun ? (
          <Card className="p-6">
            <MicroLabel>{t('The setup')}</MicroLabel>
            <p className="mt-2 max-w-[66ch] text-[13px] leading-relaxed text-ink/60">
              {t('Six stations. You can leave at any station and come back: everything lives on the ledger, so the setup resumes exactly where reality is — each circle turns green when the chain says so, never before.')}
            </p>
            <p className="mt-2 max-w-[66ch] text-[12px] leading-relaxed text-ink/45">
              {t('What you need: your phone with Xaman, a DEDICATED new account (~5 XRP covers reserves and fees), and your Coinbase verification for the KYC leg.')}
            </p>
          </Card>
          ) : null}
          <Card className="p-6">
            <MicroLabel>{t('Which wallet is the manager?')}</MicroLabel>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
              {t('A vault obeys ONE XRPL account. Pick which of your XRPL wallets — linked to your account, or connected in this browser — acts as the manager; credentials, cage and orders on this desk all follow this choice.')}
            </p>
            <div className="mt-3 max-w-sm">
              <WalletSelect
                options={manager.options}
                value={account}
                onChange={(addr) => manager.choose(addr)}
              />
            </div>
            {!manager.liveConnected ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                {t('Linked to your account, not connected in this browser — Xaman will ask for this account when you sign.')}
              </p>
            ) : null}
          </Card>
          <ManagerAccountInXaman />
        </>
      )}

      {/* TÍTULO: una sola pieza, ordenada como se lee — qué es,
          la lista de credenciales con su estado, UNA acción, la firma, y lo
          demás plegado. Ver ManagerTitleStation. */}
      {step === 1 && <ManagerTitleStation account={account} onChanged={() => void detect()} />}

      {step === 2 && (
        <ConstitutionStation
          account={account}
          anchored={anchor.anchored}
          anchoredSha={anchor.sha256}
          onAnchored={() => settleThenDetect((r) => r.anchored)}
          onBlockedChange={setStationBlocked}
          settling={settling}
        />
      )}

      {step === 3 && (
        <CageBirthStation
          account={account}
          cage={cage}
          birthInFlight={birthInFlight}
          settling={settling}
          onBorn={() => settleThenDetect((r) => r.cage)}
          titleMissing={gate === 'enabled' && !credOk}
          onGoTitle={() => go(1)}
          onBlockedChange={setStationBlocked}
        />
      )}

      {/* El creador va EMBEBIDO: sin tarjeta-título propia y con sus bordes
          cosidos a este raíl — su primer «Atrás» es «← La jaula» y su último
          paso ofrece «Perfil público →». Un pie de navegación, no dos. */}
      {step === 4 && (
        <Card className="p-6">
          <VaultCreator
            account={account}
            onOpened={onOpened}
            embedded
            onBlockedChange={setStationBlocked}
          />
        </Card>
      )}

      {step === 5 && <ProfileStation account={account} onSaved={() => void detect()} />}

    </div>
    </StationRailLayout>
  );
}

export default ManagerSetupWizard;
