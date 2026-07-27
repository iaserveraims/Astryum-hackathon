'use client';

/**
 * templateCatalog — the ONE source of the MoneyFlow template definitions
 * (PROTECT / HARVEST): fields, defaults and the trigger/action payload each
 * template builds. Moved out of DefiPositionsBoard (2026-07-25) so every
 * creation path renders the SAME manual card over the SAME payload shape —
 * the position board's template modal, the embedded entry card
 * (ProtectRuleCard), and whatever comes next. If these diverged, the entry
 * would arm a rule sized differently from what the board shows.
 *
 * Rules built here are AutomationRules (POST /api/rules): vigilance only —
 * the engine prepares on trigger and the USER signs (invariants #1/#8).
 */

import React from 'react';
import { ShieldCheck, Sprout } from 'lucide-react';

export type TemplateKind = 'PROTECT' | 'HARVEST';

/** USDT0 base-unit decimals (the borrowed asset the PROTECT repay targets). */
export const USDT0_DECIMALS = 6;

/** A single user-configurable variable in a template. */
export interface TemplateField {
  key: string;
  label: string;
  type: 'number' | 'toggle';
  default: string; // numbers as strings; toggles "true"/"false"
  hint?: string;
  unit?: string;
  min?: number;
  step?: number;
}

/** The position a template binds its rule to (decoupled from the board's type). */
export interface TemplateTarget {
  protocolId: string;
  /** Synthetic position id — optional: protocolId alone also binds (rulesForPosition). */
  positionId?: string;
}

export interface TemplateDef {
  label: string;
  icon: React.ReactNode;
  accent: string;
  blurb: string;
  /** User-editable variables (the user changes these as needed). */
  fields: TemplateField[];
  /** Build the rule payload from the field values. */
  build: (vals: Record<string, string>, target: TemplateTarget) => {
    trigger: Record<string, unknown>;
    action: Record<string, unknown>;
    cooldownMinutes: number;
  };
}

export const TEMPLATES: Record<TemplateKind, TemplateDef> = {
  PROTECT: {
    label: 'Protect',
    icon: <ShieldCheck className="w-5 h-5" />,
    accent: 'text-sky-300 border-sky-400/30 bg-sky-400/10',
    blurb: 'Defiende la posición: si el Health Factor baja del umbral, Astryum prepara un repay para que firmes.',
    fields: [
      { key: 'hf', label: 'Stop-loss Health Factor', type: 'number', default: '1.10', step: 0.05, min: 1.01, hint: 'Se dispara cuando HF cae por debajo de este valor.' },
      // A1's restore semantics, now also on the automated rail: at trigger time
      // the adapter computes the LIVE minimum repay that lifts HF back to the
      // signed target (deterministic math over the user's parameter — #8).
      { key: 'restore', label: 'Repagar solo lo justo para restaurar el HF', type: 'toggle', default: 'true', hint: 'Al saltar, calcula en vivo el repay mínimo que devuelve el HF a tu objetivo (la misma matemática que A1). Desactívalo para un importe fijo.' },
      // min = smallest USDT0 base unit: a 0 amount would pass validation, create
      // the rule, and then error at trigger time (repayBorrowBehalf needs > 0).
      { key: 'repay', label: 'Importe a repagar (modo fijo)', type: 'number', default: '1', step: 0.1, min: 0.000001, unit: 'USDT0', hint: 'Solo se usa con el modo restore desactivado.' },
      { key: 'cooldown', label: 'Cooldown', type: 'number', default: '60', step: 5, min: 0, unit: 'min', hint: 'Tiempo mínimo entre disparos.' },
    ],
    build: (v, target) => ({
      trigger: { type: 'HF_BELOW', threshold: parseFloat(v.hf) },
      action: {
        kind: 'repay',
        protocolId: target.protocolId,
        positionId: target.positionId,
        params:
          v.restore === 'true'
            ? { mode: 'restore', targetHF: parseFloat(v.hf) }
            : { mode: 'fixed', amount: String(BigInt(Math.round((parseFloat(v.repay) || 0) * 10 ** USDT0_DECIMALS))) },
      },
      cooldownMinutes: Math.round(parseFloat(v.cooldown) || 0),
    }),
  },
  HARVEST: {
    label: 'Harvest',
    icon: <Sprout className="w-5 h-5" />,
    accent: 'text-tone-success border-tone-success/30 bg-tone-success/10',
    blurb: 'Compone el rendimiento: cuando las recompensas superan el umbral, Astryum prepara el claim/compound.',
    fields: [
      { key: 'minUSD', label: 'Recompensas mínimas', type: 'number', default: '5', step: 1, min: 0, unit: 'USD', hint: 'Se dispara cuando las recompensas reclamables superan este valor.' },
      { key: 'cooldown', label: 'Cooldown', type: 'number', default: '720', step: 30, min: 0, unit: 'min', hint: 'Las recompensas FTSO se acumulan por época (~3,5 días).' },
      { key: 'wrap', label: 'Re-delegar al compoundear (wrap)', type: 'toggle', default: 'true', hint: 'claim(wrap=true) → las recompensas vuelven como WFLR ya delegado.' },
    ],
    build: (v, target) => ({
      trigger: { type: 'REWARD_THRESHOLD', minUSD: parseFloat(v.minUSD) },
      action: {
        kind: 'claimRewards',
        protocolId: target.protocolId,
        positionId: target.positionId,
        params: { wrap: v.wrap === 'true' },
      },
      cooldownMinutes: Math.round(parseFloat(v.cooldown) || 0),
    }),
  },
};
