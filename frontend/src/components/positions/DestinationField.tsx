'use client';

/**
 * DestinationField — where withdrawn capital goes, never a forced paste
 * (founder 2026-07-30): the user picks among their OWN linked wallets and
 * their saved address book (agenda); typing an address is just the third
 * option. When the caller passes the wallet the capital LEAVES FROM, it is
 * pinned first and marked with a dot — picking it means "take it out of the
 * vault but keep it in this same wallet".
 *
 * Pure selection UX: it resolves ONE address string for the parent's prepare.
 * It never validates business rules and never moves funds.
 */

import { useEffect, useMemo, useState } from 'react';
import { addressBookService, type AddressBookEntry } from '../../services/v1Api';
import type { WalletRecord } from '../../lib/portfolioMerge';
import { ecosystemOf, ECOSYSTEM_ACCENT } from '../../lib/ui/ecosystem';

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function shortAddr(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

interface RowOption {
  address: string;
  label: string;
  /** The wallet the funds leave from — dot + hint. */
  isSource?: boolean;
  /** One line under the row (e.g. "arrives as native XRP, minutes to hours"). */
  hint?: string;
}

export function DestinationField({
  kind,
  label,
  value,
  onChange,
  myWallets,
  source,
  sourceHint,
  extraOptions,
  t,
}: {
  /** Which address format this destination accepts. */
  kind: 'evm' | 'xrpl';
  label: string;
  value: string;
  onChange: (address: string) => void;
  myWallets: WalletRecord[];
  /** The wallet the capital LEAVES from — pinned first and dot-marked;
   *  picking it = keep the capital in that same wallet. */
  source?: { address: string; label: string } | null;
  /** One line under the source row saying what picking it means. */
  sourceHint?: string;
  /** Cross-rail destinations the PARENT vouches for (e.g. the owning XRPL
   *  wallet of a Smart Account, reached via the built unmint leg). They skip
   *  the kind regex — the parent routes them — and carry their own hint, so
   *  the picker can offer "arrives as native XRP" without opening arbitrary
   *  other-rail addresses (founder 2026-07-30: non-EVM wallets must show too). */
  extraOptions?: RowOption[];
  t: (s: string) => string;
}) {
  const re = kind === 'evm' ? EVM_ADDRESS_RE : XRPL_CLASSIC_RE;

  const mine = useMemo<RowOption[]>(() => {
    const seen = new Set<string>();
    const rows: RowOption[] = [];
    if (source && re.test(source.address)) {
      rows.push({ address: source.address, label: source.label, isSource: true });
      seen.add(source.address.toLowerCase());
    }
    for (const w of myWallets) {
      if (!re.test(w.address) || seen.has(w.address.toLowerCase())) continue;
      seen.add(w.address.toLowerCase());
      rows.push({ address: w.address, label: w.label ?? shortAddr(w.address) });
    }
    for (const o of extraOptions ?? []) {
      if (seen.has(o.address.toLowerCase())) continue;
      seen.add(o.address.toLowerCase());
      rows.push(o);
    }
    return rows;
  }, [myWallets, source, re, extraOptions]);

  // Agenda — fetched once; only entries on this rail.
  const [saved, setSaved] = useState<RowOption[]>([]);
  useEffect(() => {
    let alive = true;
    addressBookService
      .list()
      .then(({ entries }) => {
        if (!alive) return;
        setSaved(
          entries
            .filter((e: AddressBookEntry) => re.test(e.address))
            .map((e: AddressBookEntry) => ({ address: e.address, label: e.label })),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [re]);

  const inMine = (v: string) => mine.some((o) => o.address.toLowerCase() === v.toLowerCase());
  const inSaved = (v: string) => saved.some((o) => o.address.toLowerCase() === v.toLowerCase());

  const [mode, setMode] = useState<'mine' | 'saved' | 'external'>(() =>
    !value || inMine(value) || mine.length > 0 ? 'mine' : 'external',
  );
  const [externalDraft, setExternalDraft] = useState(() => (value && !inMine(value) ? value : ''));

  // The agenda arrives async — a prefilled value that turns out to be a saved
  // entry lands on its own tab (cosmetic only; the address is the same).
  useEffect(() => {
    if (mode === 'external' && value && inSaved(value)) setMode('saved');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.length]);

  // No valid default from the parent → adopt the first own-wallet option, so
  // the flow completes without typing anything (abstraction spec: every flow
  // completes on defaults).
  useEffect(() => {
    if (mode === 'mine' && !re.test(value) && mine.length > 0) onChange(mine[0].address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.length]);

  const tab = (active: boolean) =>
    `text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
      active ? 'border-volt/40 bg-volt/10 text-volt' : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
    }`;

  return (
    <div>
      <label className="text-xs text-ink/40 block mb-2">{label}</label>
      {(mine.length > 0 || saved.length > 0) && (
        <div className="flex gap-2 mb-2">
          {mine.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMode('mine');
                if (!inMine(value)) onChange(mine[0].address);
              }}
              className={tab(mode === 'mine')}
            >
              {t('My wallets')}
            </button>
          )}
          {saved.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMode('saved');
                if (!inSaved(value)) onChange(saved[0].address);
              }}
              className={tab(mode === 'saved')}
            >
              {t('Saved addresses')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMode('external');
              onChange(externalDraft);
            }}
            className={tab(mode === 'external')}
          >
            {t('External address')}
          </button>
        </div>
      )}
      {mode !== 'external' && (mode === 'mine' ? mine : saved).length > 0 ? (
        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
          {(mode === 'mine' ? mine : saved).map((o) => {
            const selected = value.toLowerCase() === o.address.toLowerCase();
            // The color IS the arrow (founder 2026-07-30): XRPL rows read
            // blue, Flare rows read rose — the destination is understood
            // before a single word is read. Identity never color-alone: the
            // ecosystem dot rides next to the label, the hint spells it out.
            const eco = ecosystemOf(o.address);
            const accent = eco ? ECOSYSTEM_ACCENT[eco] : null;
            return (
              <button
                key={o.address}
                type="button"
                onClick={() => onChange(o.address)}
                className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                  selected
                    ? (accent?.selected ?? 'border-volt/40 bg-volt/10')
                    : (accent?.idle ?? 'border-ink/10 bg-ink/5 hover:bg-ink/10')
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.isSource ? 'bg-volt' : (accent?.dot ?? 'bg-ink/30')}`}
                    aria-hidden
                  />
                  <span className={`truncate ${selected ? 'text-ink' : 'text-ink/70'}`}>{o.label}</span>
                  {eco && (
                    <span className={`text-[9px] uppercase tracking-wide shrink-0 ${accent?.text}`}>
                      {eco === 'xrpl' ? 'XRPL' : 'Flare'}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-ink/40 ml-auto shrink-0">{shortAddr(o.address)}</span>
                </div>
                {o.isSource && sourceHint && <div className="text-[10px] text-volt/80 mt-0.5">{sourceHint}</div>}
                {!o.isSource && o.hint && <div className="text-[10px] text-ink/45 mt-0.5">{o.hint}</div>}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          type="text"
          placeholder={kind === 'evm' ? '0x…' : 'r…'}
          value={externalDraft}
          onChange={(e) => {
            setExternalDraft(e.target.value);
            onChange(e.target.value);
          }}
          className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
        />
      )}
    </div>
  );
}
