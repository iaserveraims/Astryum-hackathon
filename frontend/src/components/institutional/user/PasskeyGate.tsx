'use client';

/**
 * PasskeyGate — el alta de la passkey del cliente (una vez). Face ID crea la
 * llave en el dispositivo (soberana, Z17); a partir de aquí el cliente firma
 * cualquier acción con la cara y nunca ve una wallet ni FLR.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import QRCode from 'react-qr-code';
import { Copy, KeyRound, Loader2, RotateCw, ScanFace, ShieldCheck, Smartphone } from 'lucide-react';
import { useT } from '../../../i18n/LanguageProvider';
import { usePasskeyActions } from '../../../lib/institutional/usePasskeyActions';
import { probePasskeyPlaces, type PasskeyPlaces } from '../../../lib/institutional/passkey';

export function PasskeyGate({ children }: { children: (account: string) => ReactNode }) {
  const { t } = useT();
  const { state, register, resolveAccount, forget } = usePasskeyActions();
  const [account, setAccount] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [resolving, setResolving] = useState(false);
  const [places, setPlaces] = useState<PasskeyPlaces | null>(null);
  const [onWindows, setOnWindows] = useState(false);

  // Qué puede hacer este navegador, sin abrir ninguna ventana.
  useEffect(() => {
    let cancelled = false;
    setOnWindows(/Windows/i.test(navigator.userAgent));
    void probePasskeyPlaces().then((p) => {
      if (!cancelled) setPlaces(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Si hay passkey (guardada o recién creada), resuelve su cuenta.
  useEffect(() => {
    if (!state.handle || account) return;
    let cancelled = false;
    setResolving(true);
    (async () => {
      try {
        const { address } = await resolveAccount();
        if (!cancelled) setAccount(address);
      } catch {
        /* el hook fija state.error */
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.handle, account, resolveAccount]);

  const retry = useCallback(async () => {
    setResolving(true);
    try {
      const { address } = await resolveAccount();
      setAccount(address);
    } catch {
      /* el hook fija state.error */
    } finally {
      setResolving(false);
    }
  }, [resolveAccount]);

  if (!state.supported) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-surface-1 p-6 text-sm text-ink/70">
        {t('This device does not support passkeys (Face ID / Touch ID). Open it on a phone or a modern browser.')}
      </div>
    );
  }

  if (account) {
    return (
      <div className="space-y-4">
        {children(account)}
        {/* Para grabar otra toma con una cuenta nueva (solo demo). */}
        <button
          onClick={() => {
            forget();
            setAccount(null);
          }}
          className="text-[11px] text-ink/40 hover:text-ink underline"
        >
          {t('Start over with a new account (demo)')}
        </button>
      </div>
    );
  }

  if (state.handle) {
    if (resolving || state.busy || !state.error) {
      return (
        <div className="rounded-2xl border border-ink/10 bg-surface-1 p-6 flex items-center gap-2 text-sm text-ink/70">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('Reading your account…')}
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-ink/10 bg-surface-1 p-6 space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-volt" />
          <h2 className="text-base font-semibold text-ink">{t('Your key is ready on this device')}</h2>
        </div>
        <p className="text-xs text-ink/60">
          {t('We could not read the account that belongs to it. Nothing is lost — the key stays on this device.')}
        </p>
        <p className="text-xs text-danger">{t(state.error)}</p>
        <button
          onClick={() => void retry()}
          className="w-full rounded-lg bg-volt text-black font-semibold py-2.5 text-sm inline-flex items-center justify-center gap-2"
        >
          <RotateCw className="w-4 h-4" /> {t('Try again')}
        </button>
        <button onClick={() => forget()} className="text-[11px] text-ink/40 hover:text-ink underline">
          {t('Start over with a new account (demo)')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 p-6 space-y-4 max-w-md">
      <div className="flex items-center gap-2">
        <ScanFace className="w-6 h-6 text-volt" />
        <h2 className="text-base font-semibold text-ink">{t('Set up Face ID')}</h2>
      </div>
      <p className="text-xs text-ink/60">
        {t('One tap creates your key on THIS device. From here you approve everything with your face — no wallet, no seed phrase, no gas. Only you can move your money; nobody else, ever.')}
      </p>
      <label className="block text-xs text-ink/60">
        {t('A name for this account')}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('e.g. my savings')}
          className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink"
        />
      </label>
      {state.error && <p className="text-xs text-danger">{t(state.error)}</p>}
      <button
        onClick={async () => {
          try {
            // La cuenta la resuelve el efecto en cuanto la llave queda guardada.
            await register(label.trim() || 'Astryum');
          } catch {
            /* el hook fija state.error */
          }
        }}
        disabled={state.busy}
        className="w-full rounded-lg bg-volt text-black font-semibold py-2.5 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {state.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        {t('Create my key with Face ID')}
      </button>
      <OpenOnPhone
        startOpen={places?.phoneNearby === false || places?.thisDevice === false || Boolean(state.error)}
        noBluetooth={places?.phoneNearby === false}
        onWindows={onWindows}
      />
    </div>
  );
}

/**
 * La llave creada EN el móvil. Desde un PC, el móvil solo se alcanza por el
 * transporte híbrido, que exige Bluetooth; abrir esta misma página en el móvil
 * no exige nada. La llave vive entonces en ese móvil y se aprueba desde él.
 */
function OpenOnPhone({ startOpen, noBluetooth, onWindows }: { startOpen: boolean; noBluetooth: boolean; onWindows: boolean }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.href);
  }, []);
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);

  if (!url) return null;
  return (
    <div className="rounded-xl border border-ink/10 bg-surface-2 p-3 space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left text-xs font-semibold text-ink inline-flex items-center gap-2"
      >
        <Smartphone className="w-4 h-4 text-volt" /> {t('Create it on your phone instead')}
      </button>
      {open && (
        <div className="space-y-3">
          {noBluetooth && (
            <p className="text-xs text-ink/70">
              {t('This computer cannot reach your phone — that needs Bluetooth. You do not need it: open this page on the phone itself.')}
            </p>
          )}
          {onWindows && (
            <p className="text-xs text-ink/60">
              {t('On Windows, Windows Hello often cannot make the kind of key this account needs (P-256), so it may not be offered. A phone can.')}
            </p>
          )}
          <p className="text-xs text-ink/70">
            {t('Scan this with your phone camera: it opens this same page. Sign in there and create the key with Face ID or your fingerprint.')}
          </p>
          <div className="mx-auto w-fit rounded-lg bg-white p-3">
            <QRCode value={url} size={148} />
          </div>
          <button
            onClick={() => {
              void navigator.clipboard
                ?.writeText(url)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
            className="w-full rounded-lg border border-ink/10 py-2 text-xs text-ink inline-flex items-center justify-center gap-2"
          >
            <Copy className="w-3.5 h-3.5" /> {copied ? t('Link copied') : t('Copy link')}
          </button>
          <p className="text-[11px] text-ink/50">
            {t('The key then lives on that phone, so from then on you approve from the phone.')}
          </p>
        </div>
      )}
    </div>
  );
}
