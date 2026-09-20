'use client';

/**
 * ScopeSelect — el filtro de alcance como UN BOTÓN, no como una fila entera
 * de chips.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

export interface ScopeOption {
  key: string;
  /** Lo que se lee en la lista. */
  label: React.ReactNode;
  /** Lo que se lee EN EL BOTÓN cuando está elegida (más corto). */
  short?: React.ReactNode;
  /** Punto/glifo de identidad a la izquierda. */
  mark?: React.ReactNode;
  /** Línea fina bajo la etiqueta (qué es esto, cuántas cosas tiene…). */
  detail?: React.ReactNode;
}

export function ScopeSelect({
  label,
  options,
  value,
  onChange,
  /** Encendido = hay filtro activo: el botón lo dice con el acento. */
  active = false,
  /** Tinte propio del elegido (el color de la wallet), si lo hay. */
  accent,
  align = 'left',
}: {
  label: string;
  options: ScopeOption[];
  value: string;
  onChange: (key: string) => void;
  active?: boolean;
  accent?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  /** Pulsado = anclado: el ratón puede irse sin que se cierre. */
  const [pinned, setPinned] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  /** El cierre por hover espera un instante: el hueco entre botón y panel no
   *  puede cerrarlo mientras el cursor lo cruza. */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIdx = options.findIndex((o) => o.key === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (open) setCursor(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.key);
    setOpen(false);
    setPinned(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        setPinned(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setPinned(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(cursor);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative shrink-0"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          // Pulsar ancla lo que el hover ya abrió; volver a pulsar cierra.
          if (open && pinned) {
            setOpen(false);
            setPinned(false);
          } else {
            setOpen(true);
            setPinned(true);
          }
        }}
        onKeyDown={onKeyDown}
        onFocus={cancelClose}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
          active ? 'text-ink' : 'border-ink/10 bg-ink/[0.03] text-ink/55 hover:border-ink/25 hover:text-ink'
        }`}
        style={
          active
            ? accent
              ? {
                  background: `color-mix(in srgb, ${accent} 7%, transparent)`,
                  borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`,
                }
              : { background: 'hsl(var(--volt) / 0.08)', borderColor: 'hsl(var(--volt) / 0.45)' }
            : undefined
        }
      >
        {/* La etiqueta, delante y tenue: dice a QUÉ se refiere el botón. */}
        <span className="text-ink/35">{label}</span>
        {selected?.mark}
        <span className="max-w-[11rem] truncate font-medium">{selected?.short ?? selected?.label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-ink/35 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            // z-40: por encima de las tarjetas y de la banda de estructuras,
            // por debajo de un modal (z-50) — un panel de filtro jamás debe
            // aparecer sobre algo que se está firmando.
            className={`absolute top-full z-40 mt-1.5 max-h-80 w-60 overflow-y-auto scrollbar-thin rounded-xl border border-ink/10 bg-surface-1 p-1 shadow-2xl ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {options.map((o, i) => {
              const on = o.key === value;
              return (
                <div
                  key={o.key}
                  data-idx={i}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => commit(i)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                    i === cursor ? 'bg-ink/[0.06]' : ''
                  }`}
                >
                  {o.mark}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink/85">{o.label}</span>
                    {o.detail && <span className="block truncate text-[10.5px] text-ink/35">{o.detail}</span>}
                  </span>
                  {on && <Check className="h-3.5 w-3.5 shrink-0 text-volt" />}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ScopeSelect;
