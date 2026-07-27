'use client';

/**
 * EmbeddedWalletCreatePanel — D1 "create" gate (Turnkey embedded wallet).
 *
 * Creates a user-controlled wallet from a passkey. Astryum never holds the key;
 * keys live in Turnkey's TEE and are exportable by the user (sovereignty test).
 * The gate stays DISABLED until Turnkey is configured — we never fabricate a wallet.
 */

import { useEffect, useState } from 'react';
import { X, KeyRound, AlertTriangle, CheckCircle2, Loader2, Download, ShieldCheck } from 'lucide-react';

import {
  getEmbeddedStatus,
  clientSideConfigured,
  createEmbeddedWallet,
  exportEmbeddedKey,
  TurnkeySdkMissingError,
  type EmbeddedStatus,
  type CreatedEmbeddedWallet,
} from '../../lib/wallet/turnkeyEmbedded';

interface Props {
  onClose: () => void;
  onCreated?: (wallet: CreatedEmbeddedWallet) => void;
}

type Step = 'intro' | 'creating' | 'done';

export function EmbeddedWalletCreatePanel({ onClose, onCreated }: Props) {
  const [status, setStatus] = useState<EmbeddedStatus | null>(null);
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<CreatedEmbeddedWallet | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getEmbeddedStatus().then(setStatus).catch(() => setStatus({ available: false, provider: 'turnkey', custodyModel: 'user_controlled', exportable: true, reason: 'unreachable' }));
  }, []);

  const sdkReady = clientSideConfigured();
  const available = !!status?.available && sdkReady;

  const handleCreate = async () => {
    setError(null);
    setStep('creating');
    try {
      const w = await createEmbeddedWallet();
      setWallet(w);
      setStep('done');
      onCreated?.(w);
    } catch (err: any) {
      setStep('intro');
      setError(
        err instanceof TurnkeySdkMissingError
          ? 'Turnkey aún no está activado en este entorno (falta el SDK / NEXT_PUBLIC_TURNKEY_ORG_ID).'
          : err?.message ?? 'No se pudo crear la wallet',
      );
    }
  };

  const handleExport = async () => {
    if (!wallet) return;
    setExporting(true);
    setError(null);
    try {
      await exportEmbeddedKey(wallet.subOrgId);
    } catch (err: any) {
      const msg = err?.message;
      setError(
        err instanceof TurnkeySdkMissingError
          ? 'Exportación disponible al activar Turnkey. La clave seguirá siendo tuya y exportable.'
          : msg === 'EXPORT_IN_APP_PENDING'
            ? 'Tu clave es exportable (eres root del sub-org en Turnkey). La exportación in-app llega pronto; mientras, puedes exportar desde Turnkey directamente.'
            : msg ?? 'No se pudo exportar',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-ink/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink/10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-volt/10 border border-volt/20">
              <KeyRound className="w-4 h-4 text-volt" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink/90">Crear wallet</div>
              <div className="text-[10px] text-ink/40">Passkey · claves tuyas y exportables</div>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink/80 transition-colors">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Intro */}
          {step === 'intro' && (
            <>
              <p className="text-xs text-ink/60 leading-relaxed">
                Crea una wallet con tu <strong>passkey</strong> (huella / Face ID / PIN del dispositivo).
                La clave se genera en el enclave seguro de Turnkey y <strong>nunca la ve Astryum</strong>.
                Tú tienes el control exclusivo y puedes <strong>exportarla cuando quieras</strong>.
              </p>

              <div className="bg-ink/3 border border-ink/8 rounded-xl p-3 space-y-2 text-xs text-ink/60">
                <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={1.5} /> Astryum no custodia ni ve tu clave privada</div>
                <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={1.5} /> Control exclusivo con tu passkey</div>
                <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={1.5} /> Clave exportable: si Turnkey desaparece, recuperas tú solo</div>
              </div>

              {!available && (
                <div className="bg-amber-950/30 border border-amber-500/20 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" strokeWidth={1.5} />
                    <p className="text-[11px] text-amber-300/80 leading-relaxed">
                      La creación de wallet embebida no está activada en este entorno todavía
                      {status?.reason ? <> ({status.reason})</> : null}. Conecta o mira una wallet mientras tanto.
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                  {error}
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={!available}
                className="w-full py-2.5 rounded-xl bg-volt hover:bg-volt disabled:opacity-40 disabled:cursor-not-allowed text-volt-ink text-sm font-semibold transition-colors"
              >
                {available ? 'Crear wallet con passkey' : 'No disponible aún'}
              </button>
            </>
          )}

          {/* Creating */}
          {step === 'creating' && (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 text-volt animate-spin mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-ink/70">Confirma con tu passkey…</p>
            </div>
          )}

          {/* Done */}
          {step === 'done' && wallet && (
            <>
              <div className="text-center py-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" strokeWidth={1.5} />
                </div>
                <p className="text-sm text-ink/80 mb-1">Wallet creada</p>
              </div>

              <div>
                <label className="block text-xs text-ink/50 mb-1.5">Tu dirección</label>
                <div className="bg-ink/5 border border-ink/10 rounded-lg px-3 py-2.5 text-xs font-mono text-ink/70 break-all">
                  {wallet.address}
                </div>
              </div>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full py-2.5 rounded-xl border border-ink/15 text-ink/80 hover:bg-ink/5 disabled:opacity-50 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} /> : <Download className="w-3.5 h-3.5" strokeWidth={1.5} />}
                Exportar clave (solo en tu navegador)
              </button>

              {error && (
                <div className="flex items-center gap-2 text-xs text-amber-400/90">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                  {error}
                </div>
              )}

              <button onClick={onClose} className="w-full py-2 text-xs text-ink/40 hover:text-ink/60 transition-colors">
                Listo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
