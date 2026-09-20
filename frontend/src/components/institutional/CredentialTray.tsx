/**
 * CredentialTray — la bandeja de credenciales XLS-70 de la cuenta XRPL conectada.
 *
 * Una credencial sin `Accepted` existe pero NO vale: la reserva la sostiene el
 * emisor y ninguna puerta del ledger la reconoce. Aceptar es del SUJETO, y hasta
 * hoy no tenía dónde. Esta bandeja hace exactamente tres cosas:
 *   1. lee del ledger lo que la cuenta sostiene (emisor, tipo, caducidad, estado),
 *   2. para las pendientes, compone sin firmar el `CredentialAccept`,
 *   3. lo firma el sujeto en su Xaman — esa firma ES el consentimiento.
 *
 * Astryum no emite y no firma. Aquí no hay botón de emitir a propósito: si lo
 * hubiera, esta pantalla se podría confundir con «Astryum verifica». El emisor
 * se nombra siempre («Verificado por X»), jamás Astryum.
 *
 * Y lo más serio, dicho antes de firmar: una credencial en el ledger ata una
 * identidad a una cuenta, en público y para siempre. Aceptar es irreversible en
 * la práctica. El disclosure del backend lo trae; aquí se enseña entero.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { refusalText, shortAddr } from '../../lib/institutional/format';
import { BadgeCheck, Clock, Loader2, PenLine, ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { XamanSignBlockedNote, XamanSingleSign } from '../xrpl/XamanSingleSign';
import {
  prepareCredentialAcceptance,
  readCredentialTray,
  type CredentialAcceptPrepared,
  type CredentialRead,
  type CredentialsTray,
} from '../../lib/xrpl/credentialsApi';

type Read = { kind: 'loading' } | { kind: 'unreadable' } | { kind: 'ok'; tray: CredentialsTray };


export function CredentialTray({
  account,
  refreshKey = 0,
  onAccepted,
  gateIssuers,
  tray: trayProp,
  onReload,
}: {
  account: string;
  /** Cambia cuando otro componente emitió algo: la bandeja relee sin recargar. */
  refreshKey?: number;
  /** La bandeja YA leída por el anfitrión (evita la doble lectura); undefined = leer aquí. */
  tray?: CredentialsTray | null;
  /** Con `tray` externo: pedirle al anfitrión que relea. */
  onReload?: () => void;
  /** Se firmó una aceptación: el anfitrión puede releer el estado de la puerta. */
  onAccepted?: () => void;
  /** Los emisores que la puerta del GESTOR acepta: cada fila dice si el suyo cuenta. */
  gateIssuers?: string[];
}) {
  const { t } = useT();
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  // Secuencia de lecturas + temporizador (revisión 10-sep): una respuesta
  // lenta de la cuenta ANTERIOR no puede pintarse bajo la nueva, y el
  // «relee en 6 s» tras aceptar muere con el componente.
  const seqRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // LA FIRMA, ARRIBA Y A LA VISTA (fundador 9-sep: «no me gusta que aparezca
  // abajo… que se pueda ver mejor la petición de firmar»): lo pendiente de
  // firmar se pinta PRIMERO como tarjeta destacada, y el QR de Xaman entra ahí
  // mismo y se trae a pantalla.
  const signRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<string>(''); // clave de la credencial en curso
  const [pending, setPending] = useState<{ cred: CredentialRead; prepared: CredentialAcceptPrepared } | null>(null);
  // The accept already reached Xaman and is not confirmed as done: dropping it
  // here would put «Accept in Xaman» back and let the same accept be signed twice.
  const [pendingBlocked, setPendingBlocked] = useState(false);
  const [refusal, setRefusal] = useState<{ error: string; detail?: string } | null>(null);
  const [notice, setNotice] = useState('');

  const external = trayProp !== undefined;
  const load = useCallback(async () => {
    if (external) { onReload?.(); return; }
    const mine = ++seqRef.current;
    try {
      const tray = await readCredentialTray(account);
      if (mine === seqRef.current) setRead({ kind: 'ok', tray });
    } catch {
      // «No pude leer» no es «no tienes credenciales».
      if (mine === seqRef.current) setRead({ kind: 'unreadable' });
    }
  }, [account, external, onReload]);

  useEffect(() => {
    if (external) return;
    setRead({ kind: 'loading' });
    setPending(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, refreshKey, external]);

  // Con bandeja externa, lo que llega del anfitrión ES el estado.
  useEffect(() => {
    if (!external) return;
    setRead(trayProp ? { kind: 'ok', tray: trayProp } : { kind: 'loading' });
  }, [external, trayProp]);

  useEffect(
    () => () => {
      seqRef.current += 1; // lo que llegue tarde ya no pinta nada
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (pending) signRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pending]);

  async function prepare(cred: CredentialRead) {
    const key = `${cred.issuer}:${cred.credentialTypeHex}`;
    setBusy(key);
    setRefusal(null);
    try {
      const res = await prepareCredentialAcceptance({
        issuer: cred.issuer,
        subject: account,
        credentialType: cred.credentialType,
      });
      if (!res.ok) return setRefusal(res.refusal);
      setPending({ cred, prepared: res.data });
    } catch (e) {
      // Red caída: el botón vuelve a estar vivo y se dice por qué.
      setRefusal({ error: t('Could not reach the server'), detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  }

  function onSettled() {
    setPending(null);
    setNotice(t('Accepted. The ledger now recognises this credential as yours; it will show as valid here in a moment.'));
    // El ledger tarda unos segundos en validar: se relee en 6 s, y otra vez a
    // los 15 por si la primera llegó pronto. El anfitrión se entera en cada una.
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      void load(); onAccepted?.();
      settleTimer.current = setTimeout(() => { void load(); onAccepted?.(); }, 9_000);
    }, 6_000);
  }

  const pendingCreds = read.kind === 'ok' ? read.tray.credentials.filter((c) => c.state === 'pending-acceptance') : [];
  const heldCreds = read.kind === 'ok' ? read.tray.credentials.filter((c) => c.state !== 'pending-acceptance') : [];

  return (
    <div className="space-y-3">
      {/* ── LO QUE ESPERA TU FIRMA — primero, destacado, con el QR aquí mismo ── */}
      {pendingCreds.length > 0 || pending ? (
        <div ref={signRef} className="space-y-3 rounded-xl border border-volt/40 bg-volt/[0.06] p-4 shadow-[0_0_0_4px_hsl(var(--volt)/0.06)]">
          <header className="flex items-center gap-2">
            <PenLine size={16} className="text-volt" />
            <h3 className="text-sm font-semibold text-ink">{t('Your signature is needed')}</h3>
            <span className="ml-auto rounded-full border border-volt/40 px-2 py-0.5 text-[10px] font-medium text-volt">
              {pending ? t('Sign in Xaman') : `${pendingCreds.length} ${pendingCreds.length === 1 ? t('credential to accept') : t('credentials to accept')}`}
            </span>
          </header>
          {!pending ? (
            <>
              <p className="text-[12px] leading-relaxed text-ink/60">
                {t('An issuer granted this account a credential. It only counts once YOU accept it — one signature in your Xaman, nothing else.')}
              </p>
              <ul className="space-y-2">
                {pendingCreds.map((c) => {
                  const key = `${c.issuer}:${c.credentialTypeHex}`;
                  return (
                    <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/10 bg-surface-1/60 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-ink">{c.credentialType || c.credentialTypeHex}</span>
                        <span className="block text-[11px] text-ink/50">
                          {t('Verified by')} <span className="font-mono text-ink/70">{shortAddr(c.issuer)}</span>
                          {c.expiresAtISO ? ` · ${t('expires')} ${new Date(c.expiresAtISO).toLocaleDateString()}` : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void prepare(c)}
                        disabled={busy === key}
                        className="inline-flex items-center gap-2 rounded-lg border border-volt/50 bg-volt px-3.5 py-2 text-[12px] font-semibold text-volt-ink disabled:opacity-50"
                      >
                        {busy === key ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
                        {t('Accept in Xaman')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-ink/60">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-tone-warning" />
                <span>
                  {t('Read before you sign: a credential on the ledger ties an identity to this account, publicly and permanently. Accepting is irreversible in practice.')}
                </span>
              </div>
              <ul className="space-y-1">
                {pending.prepared.disclosure.lines.map((l, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-ink/50">{l}</li>
                ))}
              </ul>
              {/* El sujeto es una cuenta normal (sin SignerList): firma single-sig
                  en SU Xaman. Las puertas del consejo son para consejos. */}
              <XamanSingleSign
                txjson={pending.prepared.txjson}
                title={`${t('Accept credential')} · ${pending.cred.credentialType || pending.cred.credentialTypeHex}`}
                onSettled={onSettled}
                onBlockedChange={setPendingBlocked}
                onCancelled={() => setPending(null)}
              />
              {pendingBlocked ? (
                <XamanSignBlockedNote />
              ) : (
                <button type="button" onClick={() => setPending(null)} className="text-[11px] text-ink/50">{t('Cancel')}</button>
              )}
            </div>
          )}
          {refusal ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5">
              <p className="text-[12px] leading-relaxed text-tone-warning">{refusalText(refusal)}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
      <header className="flex items-center gap-2">
        <BadgeCheck size={16} className="text-ink/60" />
        <h3 className="text-sm font-medium">{t('Your credentials on the ledger')}</h3>
        <span className="ml-auto truncate font-mono text-[11px] text-ink/40">{account}</span>
      </header>

      <p className="text-[12px] leading-relaxed text-ink/55">
        {t('What the XRP Ledger says this account holds. Astryum does not issue credentials and cannot accept them for you: accepting is your signature, and it is what makes a credential count.')}
      </p>

      {notice ? <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5 text-[11px] leading-relaxed text-emerald-500/90">{notice}</p> : null}

      {read.kind === 'loading' ? <Loader2 size={14} className="animate-spin text-ink/40" /> : null}

      {read.kind === 'unreadable' ? (
        <p className="text-[11px] leading-relaxed text-ink/55">
          {t('Could not read the ledger right now. This says nothing about your credentials — try again in a moment.')}
        </p>
      ) : null}

      {read.kind === 'ok' && read.tray.credentials.length === 0 ? (
        <p className="text-[12px] text-ink/50">{t('This account holds no credentials yet. When an issuer grants you one, it will appear here to accept.')}</p>
      ) : null}

      {read.kind === 'ok' && heldCreds.length > 0 ? (
        <ul className="space-y-2">
          {heldCreds.map((c) => {
            const key = `${c.issuer}:${c.credentialTypeHex}`;
            return (
              <li key={key} className="rounded-lg border border-ink/10 p-3">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium">{c.credentialType || c.credentialTypeHex}</span>
                  <StateBadge state={c.state} />
                </div>
                <p className="mt-1 text-[11px] text-ink/50">
                  {t('Verified by')} <span className="font-mono text-ink/70">{shortAddr(c.issuer)}</span>
                  {c.issuer === account ? ` (${t('this very account')})` : ''}
                  {c.expiresAtISO ? ` · ${t('expires')} ${new Date(c.expiresAtISO).toLocaleDateString()}` : ` · ${t('no expiry')}`}
                </p>
                {gateIssuers && gateIssuers.length > 0 ? (
                  <p className={`mt-1 text-[10px] ${gateIssuers.includes(c.issuer) ? 'text-tone-success/80' : 'text-tone-warning/90'}`}>
                    {gateIssuers.includes(c.issuer) ? t('Accepted issuer — this one counts for the manager gate.') : t('Not an accepted issuer — the manager gate ignores this one.')}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {read.kind === 'ok' && heldCreds.length === 0 && pendingCreds.length > 0 ? (
        <p className="text-[12px] text-ink/50">{t('Nothing accepted yet — the credentials above are waiting for your signature.')}</p>
      ) : null}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: CredentialRead['state'] }) {
  const { t } = useT();
  const label: Record<CredentialRead['state'], string> = {
    valid: t('valid'),
    'pending-acceptance': t('pending your acceptance'),
    'expiring-soon': t('expiring soon'),
    expired: t('expired'),
    unreadable: t('unreadable'),
  };
  const tone = state === 'valid' ? 'text-tone-success' : state === 'pending-acceptance' ? 'text-tone-warning' : 'text-ink/45';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] ${tone}`}>
      {state === 'pending-acceptance' ? <Clock size={11} /> : null}
      {label[state]}
    </span>
  );
}
