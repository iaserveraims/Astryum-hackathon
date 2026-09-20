'use client';

/**
 * WalletSelect — el selector de wallet con la CARA de cada wallet (fundador
 * 2026-08-30: «que el selector muestre la selección respetando el estilo que
 * tiene cada wallet... como está en la pantalla de wallets»).
 *
 * EL PROBLEMA: todos los selectores de la app eran `<select>` nativos, y un
 * `<option>` no admite estilo — ni color, ni marca, ni glifo. La lista salía
 * como texto plano («Xaman · rNyre…Ztg8 · XRPL»), justo donde hay que decidir
 * CON QUÉ WALLET SE FIRMA: el sitio donde más ayuda reconocer la tuya de un
 * vistazo. La identidad que el usuario se ha molestado en poner —su color, su
 * glifo, su apodo— existía en Wallets y se perdía aquí.
 *
 * LA PIEZA: un listbox propio con la MISMA receta de identidad que la tarjeta
 * de Wallets (chip 18%/33% + WalletGlyphIcon o WalletBrandIcon, el índigo del
 * consejo con su placa cuadrada). Una sola pieza para todas las pantallas: si
 * mañana cambia la cara de una wallet, cambia en todas a la vez.
 *
 * ACCESIBILIDAD: role=listbox/option con aria-selected, navegación con
 * flechas + Home/End, Enter/Espacio elige, Escape cierra, foco devuelto al
 * botón. Un `<select>` nativo daba esto gratis; sustituirlo obliga a
 * reponerlo — sin eso, el cambio sería una mejora estética que rompe a quien
 * navega con teclado.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Landmark } from 'lucide-react';
import WalletBrandIcon from './WalletBrandIcon';
import WalletGlyphIcon from './WalletGlyphIcon';
import XamanAvatar from './XamanAvatar';
import { useXamanHues } from '../../lib/wallet/xamanHues';
import { brandOf, isCouncilType, usesXamanAvatar, walletColor, walletIcon } from '../../lib/walletIdentity';
import type { WalletRecord } from '../../lib/portfolioMerge';
import { useT } from '../../i18n/LanguageProvider';

/** Lo mínimo que necesita una fila para tener cara. */
export type WalletFaceRecord = Pick<
  WalletRecord,
  'address' | 'color' | 'icon' | 'walletType' | 'ecosystem'
>;

export interface WalletOption {
  /** Clave única de la fila (una wallet EVM puede ocupar dos: dos cadenas). */
  key: string;
  /** La wallet, para su color/glifo/marca. */
  record: WalletFaceRecord;
  /** El nombre ya resuelto por la regla canónica (walletDisplayName). */
  name: string;
  /** La línea de debajo: dirección corta, carril, saldo… la pone quien llama. */
  detail?: React.ReactNode;
  /** Marca a la derecha (p. ej. «Ethereum»), opcional. */
  badge?: React.ReactNode;
  disabled?: boolean;
}

/** El chip de identidad — MISMA receta que la tarjeta de Wallets. */
export function WalletFace({ record, size = 34 }: { record: WalletFaceRecord; size?: number }) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const color = walletColor(record);
  const council = isCouncilType(record.walletType);
  const glyph = walletIcon(record);
  const inner = Math.round(size * 0.58);
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${council ? 'rounded-lg' : 'rounded-full'}`}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 33%, transparent)`,
      }}
      aria-hidden
    >
      {council ? (
        <Landmark style={{ width: inner, height: inner, color: 'hsl(var(--product-legacy))' }} strokeWidth={1.6} />
      ) : glyph ? (
        <WalletGlyphIcon icon={glyph} size={inner} color={color} />
      ) : (
        usesXamanAvatar(record) ? (
        <XamanAvatar address={record.address} size={inner} brand={brandOf(record.walletType, record.ecosystem)} />
      ) : (
        <WalletBrandIcon brand={brandOf(record.walletType, record.ecosystem)} size={inner} tint={color} />
      )
      )}
    </span>
  );
}

/** Una fila de wallet — la usan el botón cerrado y cada opción de la lista. */
function WalletRow({ option, compact = false }: { option: WalletOption; compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
      <WalletFace record={option.record} size={compact ? 30 : 34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{option.name}</span>
        {option.detail && (
          <span className="block truncate font-mono text-[11px] text-ink/40">{option.detail}</span>
        )}
      </span>
      {option.badge}
    </span>
  );
}

export function WalletSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  label?: string;
  options: WalletOption[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selectedIdx = useMemo(() => options.findIndex((o) => o.key === value), [options, value]);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  // Abrir posa el cursor sobre lo elegido — no en la primera fila.
  useEffect(() => {
    if (open) setActive(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // La fila activa siempre a la vista al navegar con flechas.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.key);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(active);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      {label && <label className="mb-2 block text-xs text-ink/40">{label}</label>}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`flex w-full items-center gap-2 rounded-xl border bg-ink/5 px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
          open ? 'border-volt/50' : 'border-ink/10 hover:border-ink/20'
        }`}
      >
        {selected ? (
          <WalletRow option={selected} />
        ) : (
          <span className="flex-1 text-[13px] text-ink/35">{placeholder ?? t('Choose a wallet')}</span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink/35 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label ?? t('Choose a wallet')}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-y-auto scrollbar-thin rounded-xl border border-ink/10 bg-surface-1 p-1 shadow-2xl"
        >
          {options.map((o, i) => {
            const isSel = o.key === value;
            return (
              <div
                key={o.key}
                data-idx={i}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors ${
                  o.disabled ? 'cursor-not-allowed opacity-40' : i === active ? 'bg-ink/[0.06]' : ''
                }`}
              >
                <WalletRow option={o} compact />
                {isSel && <Check className="h-4 w-4 shrink-0 text-volt" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WalletSelect;
