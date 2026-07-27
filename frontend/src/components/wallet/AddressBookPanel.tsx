'use client';

/**
 * AddressBookPanel — saved destination addresses for the Wallets page.
 *
 * The user saves any Flare (0x…) or XRPL (r…) address under a label; the Send
 * modal then offers these entries as one-tap destinations next to their own
 * wallets. Pure UX data (labels + public addresses, SIWE-scoped server-side):
 * saving an address never authorizes anything and moves no funds.
 */

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { BookMarked, Check, CheckCircle2, Copy, Loader2, Pencil, Plus, QrCode, Trash2, X } from 'lucide-react';
import { Card } from '../ui/primitives';
import { addressBookService, type AddressBookEntry } from '../../services/v1Api';
import { useT } from '../../i18n/LanguageProvider';

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function networkOf(address: string): { label: string; cls: string } | null {
  if (XRPL_CLASSIC_RE.test(address)) {
    return { label: 'XRPL', cls: 'text-sky-300 bg-sky-500/10 border-sky-500/20' };
  }
  if (EVM_ADDRESS_RE.test(address)) {
    return { label: 'Flare', cls: 'text-pink-300 bg-pink-500/10 border-pink-500/20' };
  }
  return null;
}

export function AddressBookPanel() {
  const { t } = useT();
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrEntry, setQrEntry] = useState<AddressBookEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    addressBookService
      .list()
      .then(({ entries: e }) => {
        if (!cancelled) setEntries(e);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add() {
    const trimmedLabel = label.trim();
    const trimmedAddress = address.trim();
    setError(null);
    if (!trimmedLabel) {
      setError(t('Give the address a name'));
      return;
    }
    if (!EVM_ADDRESS_RE.test(trimmedAddress) && !XRPL_CLASSIC_RE.test(trimmedAddress)) {
      setError(t('Enter a valid destination address (r… or 0x…)'));
      return;
    }
    setBusy(true);
    try {
      const { entry } = await addressBookService.add({ label: trimmedLabel, address: trimmedAddress });
      setEntries((prev) => [...prev, entry].sort((a, b) => a.label.localeCompare(b.label)));
      setLabel('');
      setAddress('');
      setShowForm(false);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError(
        err.status === 409 ? t('This address is already saved') : (err.message ?? String(e)),
      );
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    const next = labelDraft.trim();
    setEditingId(null);
    if (!next) return;
    const prev = entries;
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, label: next } : e)));
    try {
      await addressBookService.update(id, { label: next });
    } catch (e) {
      setEntries(prev);
      setError((e as Error).message ?? String(e));
    }
  }

  async function remove(id: string) {
    const prev = entries;
    setEntries((es) => es.filter((e) => e.id !== id));
    try {
      await addressBookService.remove(id);
    } catch (e) {
      setEntries(prev);
      setError((e as Error).message ?? String(e));
    }
  }

  function copy(entry: AddressBookEntry) {
    navigator.clipboard.writeText(entry.address).catch(() => {});
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-ink/40 font-medium flex items-center gap-1.5">
          <BookMarked className="w-3.5 h-3.5" />
          {t('Saved addresses')} ({entries.length})
        </h2>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setError(null);
          }}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-ink/10 bg-ink/5 text-ink/60 hover:text-ink hover:bg-ink/10 transition-colors"
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? t('Cancel') : t('Save address')}
        </button>
      </div>

      {showForm && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2">
            <input
              type="text"
              placeholder={t('Name — e.g. María (Xaman)')}
              value={label}
              maxLength={64}
              onChange={(e) => setLabel(e.target.value)}
              className="px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
            />
            <input
              type="text"
              placeholder="0x… / r…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
            />
            <button
              onClick={add}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t('Save')}
            </button>
          </div>
          <p className="text-[11px] text-ink/30 mt-2">
            {t('Flare (0x…) or XRPL (r…) address. Saved entries show up as destinations when you send — saving one never moves funds.')}
          </p>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </Card>
      )}

      {!showForm && error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {loading ? (
        <Card className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-ink/40" />
        </Card>
      ) : entries.length === 0 ? (
        !showForm && (
          <Card className="flex flex-col items-center justify-center py-8 text-center">
            <BookMarked className="w-6 h-6 text-ink/20 mb-2" />
            <p className="text-xs text-ink/40 max-w-sm">
              {t('Save the addresses you send to often — they appear as one-tap destinations in the Send flow.')}
            </p>
          </Card>
        )
      ) : (
        <Card className="divide-y divide-ink/5 p-0 overflow-hidden">
          {entries.map((entry) => {
            const net = networkOf(entry.address);
            return (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  {editingId === entry.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        type="text"
                        value={labelDraft}
                        maxLength={64}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') rename(entry.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="px-2 py-1 bg-ink/5 border border-ink/10 rounded-lg text-ink text-sm focus:outline-none focus:border-volt/50 w-40"
                      />
                      <button onClick={() => rename(entry.id)} className="text-emerald-300 hover:text-emerald-200">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-ink/40 hover:text-ink">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink truncate">{entry.label}</span>
                      {net && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${net.cls}`}>
                          {net.label}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(entry.id);
                          setLabelDraft(entry.label);
                        }}
                        className="text-ink/30 hover:text-ink transition-colors shrink-0"
                        title={t('Rename')}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <div className="text-[11px] font-mono text-ink/40 truncate mt-0.5">
                    {shortAddr(entry.address)}
                  </div>
                </div>
                <button
                  onClick={() => setQrEntry(entry)}
                  className="text-ink/40 hover:text-ink transition-colors shrink-0"
                  title={t('Show QR')}
                >
                  <QrCode className="w-4 h-4" />
                </button>
                <button
                  onClick={() => copy(entry)}
                  className="text-ink/40 hover:text-ink transition-colors shrink-0"
                  title={t('Copy address')}
                >
                  {copiedId === entry.id ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => remove(entry.id)}
                  className="text-ink/40 hover:text-red-400 transition-colors shrink-0"
                  title={t('Delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </Card>
      )}

      {qrEntry && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-volt shrink-0" />
                  <span className="truncate">{qrEntry.label}</span>
                  {(() => {
                    const net = networkOf(qrEntry.address);
                    return net ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${net.cls}`}>
                        {net.label}
                      </span>
                    ) : null;
                  })()}
                </h2>
                <p className="text-xs text-ink/40 mt-0.5 font-mono">{shortAddr(qrEntry.address)}</p>
              </div>
              <button
                onClick={() => setQrEntry(null)}
                className="text-ink/40 hover:text-ink transition-colors mt-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6 flex flex-col items-center gap-4">
              <div className="bg-white p-4 rounded-xl">
                <QRCode value={qrEntry.address} size={192} />
              </div>

              <button
                onClick={() => copy(qrEntry)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-ink/5 border border-ink/10 hover:bg-ink/10 transition-colors"
                title={t('Copy address')}
              >
                <span className="text-[11px] font-mono text-ink/80 break-all text-left">{qrEntry.address}</span>
                {copiedId === qrEntry.id ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-ink/40 shrink-0" />
                )}
              </button>

              {(() => {
                const net = networkOf(qrEntry.address);
                return net ? (
                  <p className="text-[11px] text-amber-200/70 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5 text-center">
                    {t('Send only assets on')} <span className="font-semibold">{net.label}</span>{' '}
                    {t('to this address. Assets sent from other networks would be lost.')}
                  </p>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
