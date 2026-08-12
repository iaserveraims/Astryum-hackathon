'use client';

/**
 * PaActionsModal — the missing rails of the Kinetic ISO position, driven from
 * the Positions board:
 *
 *   RESUPPLY — carry step 2: re-supply borrowed USDT0 into the ISO market
 *              (POST /flare-demo/supply-usdt0/prepare → sign in Xaman).
 *   WITHDRAW — move USDT0/FXRP from the ISO market + Personal Account to the
 *              user's EVM wallet (POST /flare-demo/pa-withdraw-transfer/prepare
 *              → sign in Xaman).
 *   REPAY    — A1 protection: repay the PA's USDT0 debt from the EVM wallet
 *              (POST /flare-demo/a1/prepare → sign approve+repay in EVM wallet).
 *   DERISK   — the guided unwind, in the ONLY safe order:
 *              1. withdraw USDT0 → 2. repay in FULL → 3. withdraw FXRP.
 *              On a Smart-Account position the whole unwind runs on the XRPL
 *              rail (founder 2026-07-31): step 1 folds into the PA-native
 *              repay (it redeems the re-supplied USDT0 itself) and step 3
 *              offers keep-in-PA / native XRP — no EVM wallet needed.
 *
 * Every flow is prepare → review (full disclosure, invariant #6) → the USER
 * signs in their own wallet → done. Astryum never signs, never broadcasts
 * (invariants #1/#8). The 0xFE userOp actions are mint-coupled: the XRP paid
 * also mints a small FXRP into the PA — always disclosed before signing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Recycle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ListOrdered,
} from 'lucide-react';
import { ModalOverlay } from '../ui/ModalPortal';
import { useT } from '../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useOwningXrpl } from '../../lib/wallet/paOwnership';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { DispatchXrpField } from './DispatchXrpField';
import { translateError } from '../../lib/errors/translateError';
import { fmtQtyActive } from '../../lib/format';
import { DestinationField } from './DestinationField';
import { AmountSliderUsd } from './AmountSliderUsd';
import { useXrpUsdPrice } from '../../hooks/useXrpUsdPrice';
import type { WalletRecord } from '../../lib/portfolioMerge';

const API_BASE = getApiBase();
const USDT0_DECIMALS = 6;
const FXRP_DECIMALS = 6;

export type PaActionKind = 'resupply' | 'withdraw' | 'repay' | 'derisk' | 'unmint';

/** The Kinetic ISO legs of ONE Personal Account, in base units (6 dec). */
export interface PaLegs {
  /** FXRP supplied as collateral. */
  supplyFxrpBase?: string;
  /** USDT0 borrowed (the debt A1 repays). */
  debtUsdt0Base?: string;
  /** USDT0 re-supplied (carry step 2), when present. */
  suppliedUsdt0Base?: string;
}

/** One account holding a Kinetic ISO position — feeds the modal's selector
 *  when the SAME market is open from more than one wallet. */
export interface PaHolder {
  owner: string;
  legs: PaLegs;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function toBase(human: string, decimals: number): string {
  const n = parseFloat(human);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(BigInt(Math.round(n * 10 ** decimals)));
}

function fromBase(base: string | undefined, decimals: number): number {
  if (!base) return 0;
  const n = Number(base);
  return Number.isFinite(n) ? n / 10 ** decimals : 0;
}

function fmt(n: number, digits = 4): string {
  return fmtQtyActive(n, digits); // app-locale aware (Fase 3)
}


/* ---------------------------------------------------------------- */
/* Prepared-response shapes (mirror flareDemo.ts responses)          */
/* ---------------------------------------------------------------- */

/** SWAP-FILL (doc 2026-07-26): una opción cotizada para comprar el hueco de
 *  USDT0 con un activo del PROPIO usuario, swapeado dentro del mismo batch. */
interface FillOptionJson {
  asset: 'FLR' | 'FXRP';
  feeTier: number;
  amountInQuoted: number;
  amountInMax: number;
  balance: number | null;
  sufficient: boolean;
}
interface FillInfo {
  enabled: boolean;
  needed: boolean;
  /** true = sin fill no hay nada que firmar (wallet/PA a cero de USDT0). */
  required: boolean;
  gapUsdt0: number;
  slippagePct: number;
  applied: FillOptionJson | null;
  options: FillOptionJson[];
}

interface XrplPrepared {
  rail: 'xrpl';
  personalAccount: string;
  xrplPayment?: unknown;
  /** 0xFE memo — identifica el asiento de nonce para liberarlo si se cancela. */
  memoHex?: string;
  /** Invariant #11 — the prepare's dry-run verdict (pa-repay today). */
  preflight?: PreflightInfo;
  fill?: FillInfo;
  disclosure: Record<string, unknown> & { note?: string };
}

interface A1Prepared {
  rail: 'evm';
  chainId: number;
  personalAccount?: string;
  preflight?: PreflightInfo;
  fill?: FillInfo;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  disclosure: Record<string, unknown> & {
    needed?: boolean;
    currentHF?: number;
    targetHF?: number;
    repayUsdt0?: number;
    remainingDebtUsdt0?: number;
    shortfallUsdt0?: number;
    coveredByWithdraw?: boolean;
    note?: string;
  };
}

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1.5">
      <span className="text-ink/40">{label}</span>
      <span className="text-ink/80 font-mono text-right">{value}</span>
    </div>
  );
}

/** ANTES → DESPUÉS (§4b del doc swap-fill): el diff real calculado server-side
 *  en el prepare — deuda, HF, saldos — con "después" al peor caso del fill. */
interface BaPair {
  before: number | null;
  after: number | null;
}
function BeforeAfterPanel({ ba }: { ba: Record<string, unknown> }) {
  const { t } = useT();
  const row = (label: string, pair: unknown, digits = 6, infinityWhenNull = false) => {
    const p = pair as BaPair | undefined;
    if (p == null || (p.before == null && p.after == null)) return null;
    return (
      <div className="flex items-center justify-between gap-3 text-xs py-1.5">
        <span className="text-ink/40">{label}</span>
        <span className="font-mono text-ink/80">
          {p.before == null ? '—' : fmt(Number(p.before), digits)}
          <span className="text-ink/30 px-1.5">→</span>
          {p.after == null ? (infinityWhenNull ? '∞' : '—') : fmt(Number(p.after), digits)}
        </span>
      </div>
    );
  };
  const fill = ba.fillAsset as { asset?: string; before?: number | null; after?: number | null; spendMax?: number } | undefined;
  return (
    <div className="bg-ink/5 border border-ink/10 rounded-xl px-4 py-2 divide-y divide-ink/5">
      <div className="text-[10px] uppercase tracking-wider text-ink/35 py-1.5">{t('Before → after signing')}</div>
      {row(t('Debt (USDT0)'), ba.debtUsdt0)}
      {row(t('Health Factor'), ba.healthFactor, 3, true)}
      {row(t('USDT0 in your wallet'), ba.walletUsdt0)}
      {row(t('USDT0 in the PA (free + supplied)'), ba.paUsdt0FreePlusSupplied)}
      {fill != null &&
        row(
          `${String(fill.asset ?? '')} · ${t('fill spend (worst case)')}`,
          { before: fill.before ?? null, after: fill.after ?? null },
          fill.asset === 'FLR' ? 4 : 6,
        )}
      {typeof ba.note === 'string' && <p className="text-[10px] text-ink/35 py-1.5 leading-relaxed">{ba.note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* MODAL                                                              */
/* ---------------------------------------------------------------- */

export function PaActionsModal({
  owner: ownerProp,
  legs: legsProp,
  holders,
  action,
  onClose,
  onChanged,
}: {
  /** The account that holds the position (Personal Account or EVM wallet). */
  owner: string;
  legs: PaLegs;
  /** Every account with an open ISO position — shown as a selector when >1;
   *  switching also switches the rail and the form's fields. */
  holders?: PaHolder[];
  action: PaActionKind;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const { wallets: myWallets } = useMyWallets();

  // The account being acted on — selectable when the same market is open
  // from more than one wallet. Everything below derives from the SELECTED
  // holder, so a wallet switch also switches legs, rail and fields.
  const allHolders = useMemo<PaHolder[]>(() => {
    const list = holders && holders.length > 0 ? holders : [{ owner: ownerProp, legs: legsProp }];
    return list.some((h) => h.owner.toLowerCase() === ownerProp.toLowerCase())
      ? list
      : [{ owner: ownerProp, legs: legsProp }, ...list];
  }, [holders, ownerProp, legsProp]);
  const [ownerSel, setOwnerSel] = useState(ownerProp);
  const sel =
    allHolders.find((h) => h.owner.toLowerCase() === ownerSel.toLowerCase()) ??
    { owner: ownerProp, legs: legsProp };
  const owner = sel.owner;

  // LIVE legs — the chain's truth, fetched on open/holder change. The props
  // can come from a stale portfolio snapshot (one without the iso flag made a
  // real supply read as empty legs → "In the vault: 0 FXRP" over withdrawable
  // assets, 2026-07-14). The number the user came to see is never a cache.
  const [liveLegs, setLiveLegs] = useState<PaLegs | null>(null);
  const [legsLoading, setLegsLoading] = useState(false);
  useEffect(() => {
    setLiveLegs(null);
    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) return;
    let alive = true;
    setLegsLoading(true);
    fetch(`${API_BASE}/flare-demo/iso-legs/${owner}`, { headers: authHeaders(), credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { supplyFxrpBase?: string | null; suppliedUsdt0Base?: string | null; debtUsdt0Base?: string | null } | null) => {
        if (!alive || !b) return;
        setLiveLegs({
          supplyFxrpBase: b.supplyFxrpBase ?? undefined,
          suppliedUsdt0Base: b.suppliedUsdt0Base ?? undefined,
          debtUsdt0Base: b.debtUsdt0Base ?? undefined,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLegsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [owner]);
  const legs = liveLegs ?? sel.legs;

  // WHO holds this position decides every rail: an EVM-direct entry lives on
  // the user's own Flare wallet (plain unsigned calls, no Xaman, no PA); the
  // Xaman entry lives on the Personal Account (0xFE userOps).
  const ownerIsEvmWallet = !!evm.address && evm.address.toLowerCase() === owner.toLowerCase();

  // The rail must NOT depend on what happens to be connected right now: with
  // MetaMask disconnected, a wallet-held position used to fall silently onto
  // the XRPL rail — whose Personal Account holds nothing — and looked
  // unwithdrawable. The owner IS the PA when ANY of my linked XRPL accounts
  // controls it (not just the connected one — with a different Xaman active
  // this used to demote the Smart Account to "connect MetaMask", 2026-07-19);
  // otherwise a 0x owner registered among my wallets is wallet-held, and
  // signing it just needs THAT wallet connected.
  const xrplCandidates = useMemo(
    () => [
      ...myWallets.map((w) => w.address),
      ...(xrpl.address ? [xrpl.address] : []),
    ],
    [myWallets, xrpl.address],
  );
  const { owningXrpl } = useOwningXrpl(owner, xrplCandidates);
  const ownerIsPa = !!owningXrpl;
  const connectedIsOwner =
    !!owningXrpl && !!xrpl.address && owningXrpl.toLowerCase() === xrpl.address.toLowerCase();
  const ownerIsMyEvmWallet = myWallets.some((w) => w.address.toLowerCase() === owner.toLowerCase());
  const railIsEvm = !ownerIsPa && (ownerIsEvmWallet || ownerIsMyEvmWallet);
  /** EVM rail but the owning wallet isn't the connected signer → block prepare. */
  const needsWalletConnect = railIsEvm && !ownerIsEvmWallet;
  const aliasOf = (addr: string) =>
    myWallets.find((w) => w.address.toLowerCase() === addr.toLowerCase())?.label ??
    `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const ownerAlias = myWallets.find((w) => w.address.toLowerCase() === owner.toLowerCase())?.label;

  // XRPL destinations for the EVM-wallet redeem: my linked XRPL wallets, plus
  // the connected Xaman when it isn't linked — a picker, never a bare input.
  const xrplDestWallets = useMemo<WalletRecord[]>(() => {
    if (!xrpl.address) return myWallets;
    const listed = myWallets.some((w) => w.address.toLowerCase() === xrpl.address!.toLowerCase());
    return listed ? myWallets : [{ address: xrpl.address, label: t('Connected Xaman') }, ...myWallets];
  }, [myWallets, xrpl.address, t]);

  // Switching the account restarts the form: its legs, its balance, its rail.
  function selectHolder(addr: string) {
    releaseSeatIfUnsigned();
    setOwnerSel(addr);
    setAmount('');
    setUseMax(false);
    setPrepared(null);
    setFillAsset(null);
    setNoFillChosen(false);
    settlement.reset();
    setError('');
    setPhase('form');
  }

  /** Option line: alias · addr · what the account holds in the ISO market. */
  function holderLabel(h: PaHolder): string {
    const supply = fromBase(h.legs.supplyFxrpBase, FXRP_DECIMALS);
    const debt = fromBase(h.legs.debtUsdt0Base, USDT0_DECIMALS);
    const bits = [
      aliasOf(h.owner),
      `${h.owner.slice(0, 8)}…${h.owner.slice(-6)}`,
      supply > 0 ? `${fmt(supply)} FXRP` : null,
      debt > 0 ? `${t('Debt')} ${fmt(debt)} USDT0` : null,
    ].filter(Boolean);
    return bits.join(' · ');
  }

  // DERISK is a guided sequence over the other three actions.
  const [deriskStep, setDeriskStep] = useState<1 | 2 | 3>(1);
  const [deriskDone, setDeriskDone] = useState<Set<number>>(new Set());
  // Step-1 withdrawal, forwarded to the repay prepare so the carry-spread
  // shortfall (audit M7) is disclosed before signing.
  const [withdrawnUsdt0Base, setWithdrawnUsdt0Base] = useState<string | null>(null);

  const effective: Exclude<PaActionKind, 'derisk'> =
    action !== 'derisk' ? action : deriskStep === 1 ? 'withdraw' : deriskStep === 2 ? 'repay' : 'withdraw';
  const deriskAsset: 'usdt0' | 'fxrp' = deriskStep === 3 ? 'fxrp' : 'usdt0';

  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<XrplPrepared | A1Prepared | null>(null);

  // Abandonar una orden 0xFE preparada y NO firmada libera su asiento de nonce
  // al instante (el usuario no queda tapiado por NONCE_SEAT_TAKEN). Un ref
  // guarda el último estado para el cleanup de desmontaje (X, Escape, el padre
  // que quita el modal) sin re-suscribir en cada cambio. Nunca tras firmar
  // (phase 'signing'/'done'): el executor debe poder ejecutar lo firmado.
  const seatRef = useRef<{ memoHex?: string; abandonable: boolean }>({ abandonable: false });
  seatRef.current = {
    memoHex: prepared?.rail === 'xrpl' ? prepared.memoHex : undefined,
    abandonable: prepared?.rail === 'xrpl' && phase === 'review',
  };
  useEffect(() => {
    return () => {
      if (seatRef.current.abandonable) releaseHandoffSeat(seatRef.current.memoHex);
    };
  }, []);
  function releaseSeatIfUnsigned() {
    if (prepared?.rail === 'xrpl' && phase === 'review') releaseHandoffSeat(prepared.memoHex);
  }

  // Form state (per flow)
  const [amount, setAmount] = useState('');
  // MAX on the EVM rail = exact full exit (redeem by kToken shares, interest
  // included). Typing any amount by hand switches back to the normal path.
  const [useMax, setUseMax] = useState(false);
  const [xrpForMint, setXrpForMint] = useState('1');
  // USDT0 only exists in the CARRY (the one strategy that lends AND borrows).
  // A lend-only position withdraws FXRP, full stop — no USDT0 tab, no 0-USDT0
  // default staring at the user (founder 2026-07-30).
  const propsHasUsdt0 =
    fromBase(legsProp.debtUsdt0Base, USDT0_DECIMALS) > 0 ||
    fromBase(legsProp.suppliedUsdt0Base, USDT0_DECIMALS) > 0;
  const [withdrawAsset, setWithdrawAsset] = useState<'usdt0' | 'fxrp'>(
    action === 'derisk' ? deriskAsset : propsHasUsdt0 ? 'usdt0' : 'fxrp',
  );
  const [evmDest, setEvmDest] = useState(evm.address ?? '');
  const [repayMode, setRepayMode] = useState<'restore' | 'full'>(action === 'derisk' ? 'full' : 'restore');
  const [targetHF, setTargetHF] = useState('1.10');
  // PA-native repay (pieza 1, 2026-07-25): a Smart-Account position can repay
  // entirely INSIDE the PA — one 0xFE userOp signed in Xaman, executor-paid
  // gas, funded from the PA's free USDT0 then its carry supply. The walletless
  // default. 'evm' keeps the A1 path (repay from the user's Flare wallet).
  // DERISK on a PA position uses this rail too (founder 2026-07-31): the XRPL
  // wallet that opened the position closes it — no EVM wallet in the loop.
  const [repayRail, setRepayRail] = useState<'pa' | 'evm'>('pa');
  const repayViaPa = effective === 'repay' && ownerIsPa && (action === 'derisk' || repayRail === 'pa');
  // SWAP-FILL: el activo elegido para comprar el hueco de USDT0 (null = sin
  // fill; el prepare responde las opciones cotizadas y el usuario elige aquí).
  const [fillAsset, setFillAsset] = useState<'FXRP' | 'FLR' | null>(null);
  // Founder 2026-07-31: con hueco de USDT0, "sin swap" es una DECISIÓN, no un
  // default silencioso — el usuario marca swap-fill o "no pagar con swap"
  // (entonces el hueco lo cubre él) y hasta que no elige, la firma no existe.
  const [noFillChosen, setNoFillChosen] = useState(false);

  // UNMINT (2026-07-26): FXRP LIBRE del PA — lo redimible a XRP nativo — y el
  // mínimo on-chain del protocolo, leídos en vivo. También alimenta el toggle
  // de destino del withdraw FXRP (transfer a EVM vs unmint a XRPL).
  const [paFreeFxrp, setPaFreeFxrp] = useState<number | null>(null);
  const [redeemMinXrp, setRedeemMinXrp] = useState<number | null>(null);
  useEffect(() => {
    if ((action !== 'unmint' && action !== 'withdraw') || !/^0x[a-fA-F0-9]{40}$/.test(owner)) return;
    let alive = true;
    fetch(`${API_BASE}/flare-demo/pa-fxrp/${owner}`, { headers: authHeaders(), credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { freeFxrp?: number; redeemMinimumXrp?: number | null } | null) => {
        if (!alive || !b) return;
        setPaFreeFxrp(typeof b.freeFxrp === 'number' ? b.freeFxrp : null);
        setRedeemMinXrp(b.redeemMinimumXrp ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [action, owner]);
  // Redeem desde una wallet EVM (no PA): la wallet firma el redeem directo y el
  // usuario ELIGE a qué XRPL enviar el XRP (no hay "XRPL dueña"). Por defecto,
  // su Xaman conectada.
  const [unmintXrplDest, setUnmintXrplDest] = useState('');
  useEffect(() => {
    if (!unmintXrplDest && xrpl.address) setUnmintXrplDest(xrpl.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrpl.address]);

  const debtHuman = fromBase(legs.debtUsdt0Base, USDT0_DECIMALS);
  const supplyFxrpHuman = fromBase(legs.supplyFxrpBase, FXRP_DECIMALS);
  const suppliedUsdt0Human = fromBase(legs.suppliedUsdt0Base, USDT0_DECIMALS);

  // Live XRP/USD (FTSO) — values FXRP amounts in dollars beside the inputs.
  const xrpUsd = useXrpUsdPrice();

  // CARRY = the only strategy with USDT0 legs (lend+borrow). The live legs are
  // the truth: a lend-only position snaps the withdraw asset back to FXRP even
  // if a stale prop suggested a carry.
  const isCarry = debtHuman > 0 || suppliedUsdt0Human > 0;
  useEffect(() => {
    if (action !== 'derisk' && liveLegs && !legsLoading && !isCarry && withdrawAsset === 'usdt0') {
      setWithdrawAsset('fxrp');
    }
  }, [action, liveLegs, legsLoading, isCarry, withdrawAsset]);

  // DERISK con pierna vacía (founder 2026-07-26): sin USDT0 suppliado el paso 1
  // no tiene nada que retirar (ni botón MAX, porque no hay saldo) y dejaba el
  // unwind ATASCADO en un formulario sin salida. Un paso vacío se salta.
  const deriskStepEmpty =
    action === 'derisk' &&
    !legsLoading &&
    ((deriskStep === 1 && suppliedUsdt0Human <= 0) ||
      (deriskStep === 2 && debtHuman <= 0) ||
      (deriskStep === 3 && supplyFxrpHuman <= 0));

  // DERISK on the PA rail (founder 2026-07-31): step 1 never signs apart — the
  // PA-native repay redeems the re-supplied USDT0 INSIDE its own 0xFE userOp
  // (free balance first, then carry supply), so a separate withdraw would cost
  // the user one extra mint-coupled dispatch for nothing. With no debt there is
  // nothing to fold into, and step 1 stays a normal (walletless) PA withdraw.
  const deriskStep1InsideRepay =
    action === 'derisk' && deriskStep === 1 && ownerIsPa && !legsLoading && debtHuman > 0 && !deriskStepEmpty;

  // R0.1: the modal opens for ONE intention — the heading says it in the
  // user's words, not in opcodes (DERISK / carry / redeem are internal names).
  const heading = useMemo(() => {
    if (action === 'derisk') return t('Close this position, step by step');
    if (action === 'resupply') return t('Put the borrowed dollars back to work');
    if (action === 'repay') return t('Repay your loan');
    if (action === 'unmint') return t('Convert to XRP');
    return t('Withdraw funds');
  }, [action, t]);

  function friendlyHttpError(
    status: number,
    body: { error?: string; detail?: string; available?: number; requested?: number; minimumXrp?: number; availableFxrp?: number },
  ): string {
    const codeEarly = String(body.error ?? '');
    if (codeEarly === 'AMOUNT_BELOW_MINIMUM_REDEEM') {
      return `${t('Below the protocol minimum per redemption')} (${body.minimumXrp ?? 5} XRP).`;
    }
    if (codeEarly === 'INSUFFICIENT_FXRP') {
      return `${t('More FXRP than the Smart Account holds — available:')} ${fmt(body.availableFxrp ?? 0)} FXRP`;
    }
    const code = String(body.error ?? '');
    if (status === 401) return t('Your session expired — sign in again to continue.');
    if (status === 451 || code.startsWith('GEOFENCE')) return t('This action is not available in your region yet.');
    if (code === 'FLARE_DEFI_DISABLED') return t('Flare DeFi execution is disabled on this server (feature flag).');
    if (code === 'INSUFFICIENT_SUPPLY') {
      return `${t('More than the vault holds for this wallet — in the vault right now:')} ${fmt(body.available ?? 0)}`;
    }
    if (code === 'NO_SUPPLY_TO_WITHDRAW') {
      return t('This wallet has no supply of that asset in the Kinetic ISO market — check the selected wallet and asset.');
    }
    return body.detail || body.error || `HTTP ${status}`;
  }

  async function prepare(fillOverride?: 'FXRP' | 'FLR' | null) {
    // El picker re-prepara con el activo recién elegido sin esperar al setState;
    // cualquier otra cosa (el MouseEvent del botón Prepare) usa el estado.
    const fillSel = fillOverride === null || fillOverride === 'FXRP' || fillOverride === 'FLR' ? fillOverride : fillAsset;
    // Un prepare nuevo desde el formulario re-abre la decisión del fill; los
    // re-prepares del propio selector (elegir activo / quitar el swap) la
    // conservan — vienen con fillOverride explícito.
    if (!(fillOverride === null || fillOverride === 'FXRP' || fillOverride === 'FLR')) setNoFillChosen(false);
    setError('');
    setPhase('preparing');
    try {
      if (needsWalletConnect) {
        throw new Error(
          `${t('This position lives in wallet')} ${owner.slice(0, 8)}…${owner.slice(-4)} — ${t('connect that wallet (MetaMask) to sign. The XRPL rail cannot move it.')}`,
        );
      }
      if (effective === 'repay') {
        if (!legs.supplyFxrpBase || !legs.debtUsdt0Base) {
          throw new Error(t('This account has no FXRP collateral + USDT0 debt legs to repay.'));
        }
        if (repayViaPa) {
          // PA-native rail: everything happens inside the Smart Account, one
          // Xaman signature, executor-paid gas. The route reads the live state
          // and funds from free USDT0 → carry supply (pieza 1).
          if (!(parseFloat(xrpForMint) > 0)) {
            throw new Error(t('The XRP for the mint-coupled dispatch must be greater than 0'));
          }
          // Pin the XRPL account that OWNS this Smart Account — never the
          // merely-connected Xaman (2026-07-19 mismatch incident).
          const signerXrpl = owningXrpl ?? xrpl.address;
          if (!signerXrpl) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
          const res = await fetch(`${API_BASE}/flare-demo/pa-repay/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              xrplAddress: signerXrpl,
              mode: repayMode,
              targetHF: parseFloat(targetHF) || 1.1,
              amountXrpForMint: parseFloat(xrpForMint) || 0,
              // SWAP-FILL: si el PA no llega, compra el hueco con su propio
              // FXRP libre — la Call de swap va dentro del mismo userOp.
              ...(fillSel ? { fill: { asset: fillSel } } : {}),
              region: getUserRegion(),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          if (body.needed === false) {
            throw new Error(String((body.disclosure as { note?: string } | undefined)?.note ?? t('Nothing to repay right now.')));
          }
          if (String(body.personalAccount ?? '').toLowerCase() !== owner.toLowerCase()) {
            throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
          }
          setPrepared(body as XrplPrepared);
        } else {
          const res = await fetch(`${API_BASE}/flare-demo/a1/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              personalAccount: owner,
              supplyUBA: legs.supplyFxrpBase,
              debtUsdt0Base: legs.debtUsdt0Base,
              targetHF: parseFloat(targetHF) || 1.1,
              mode: repayMode,
              // La wallet que FIRMARÁ: el prepare capa el repay a su saldo
              // USDT0 real — sin esto, el repay full con el interés devengado
              // superaba el saldo por polvo y revertía on-chain (2026-07-26).
              ...(evm.address ? { signerAddress: evm.address } : {}),
              // SWAP-FILL: comprar el hueco con FXRP/FLR de la propia wallet,
              // swapeado dentro del mismo batch que se firma.
              ...(fillSel ? { fill: { asset: fillSel } } : {}),
              region: getUserRegion(),
              // DERISK: what step 1 actually withdrew, so the shortfall is disclosed.
              ...(action === 'derisk' && withdrawnUsdt0Base
                ? { withdrawableUsdt0Base: withdrawnUsdt0Base }
                : {}),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          setPrepared(body as A1Prepared);
        }
      } else if (effective === 'resupply') {
        const base = toBase(amount, USDT0_DECIMALS);
        if (base === '0') throw new Error(t('Amount must be greater than 0'));
        if (railIsEvm) {
          // EVM-direct position: the wallet signs [approve, supply] itself.
          const res = await fetch(`${API_BASE}/flare-demo/supply-usdt0/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ evmAddress: owner, amountUsdt0Base: base, region: getUserRegion() }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          setPrepared(body as A1Prepared);
        } else {
          if (!(parseFloat(xrpForMint) > 0)) {
            throw new Error(t('The XRP for the mint-coupled dispatch must be greater than 0'));
          }
          // Pin the XRPL account that OWNS this Smart Account — never the
          // merely-connected Xaman (2026-07-19 mismatch incident).
          const signerXrpl = owningXrpl ?? xrpl.address;
          if (!signerXrpl) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
          const res = await fetch(`${API_BASE}/flare-demo/supply-usdt0/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              xrplAddress: signerXrpl,
              amountUsdt0Base: base,
              amountXrpForMint: parseFloat(xrpForMint) || 0,
              region: getUserRegion(),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          if (String(body.personalAccount ?? '').toLowerCase() !== owner.toLowerCase()) {
            throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
          }
          setPrepared(body as XrplPrepared);
        }
      } else if (effective === 'unmint') {
        // Redeem = SACAR el FXRP de ESTA posición (retirarlo de Kinetic) y
        // redimirlo a XRP nativo. MAX = posición sola, o posición + saldo libre
        // (drena la posición primero, luego el libre). En el PA el libre suele
        // ser 0, así que allí el techo es la posición.
        const freeExtra = ownerIsPa ? 0 : paFreeFxrp ?? 0;
        const maxRedeemable = supplyFxrpHuman + freeExtra;
        const wantHuman = parseFloat(amount);
        if (!(wantHuman > 0)) throw new Error(t('Amount must be greater than 0'));
        if (wantHuman > maxRedeemable + 1e-9) {
          throw new Error(`${t('More than you can redeem:')} ${fmt(maxRedeemable)} FXRP`);
        }
        const base = toBase(String(wantHuman), FXRP_DECIMALS);
        if (ownerIsPa) {
          // PA: retira de Kinetic Y redime a la XRPL DUEÑA en UN dispatch 0xFE
          // atómico (pa-withdraw-transfer + unmintToXrpl). Firmante pinneado.
          if (!(parseFloat(xrpForMint) > 0)) {
            throw new Error(t('The XRP for the mint-coupled dispatch must be greater than 0'));
          }
          const signerXrpl = owningXrpl ?? xrpl.address;
          if (!signerXrpl) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
          const res = await fetch(`${API_BASE}/flare-demo/pa-withdraw-transfer/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              xrplAddress: signerXrpl,
              asset: 'fxrp',
              amountBase: base,
              amountXrpForMint: parseFloat(xrpForMint) || 0,
              unmintToXrpl: true,
              region: getUserRegion(),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          if (String(body.personalAccount ?? '').toLowerCase() !== owner.toLowerCase()) {
            throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
          }
          setPrepared(body as XrplPrepared);
        } else {
          // Wallet EVM: retira de Kinetic + redime en UNA firma de la propia
          // wallet (sin 0xFE, sin executor). El usuario ELIGE la dirección XRPL.
          if (needsWalletConnect) {
            throw new Error(
              `${t('This position lives in wallet')} ${owner.slice(0, 8)}…${owner.slice(-4)} — ${t('connect that wallet (MetaMask) to sign. The XRPL rail cannot move it.')}`,
            );
          }
          const dest = (unmintXrplDest || xrpl.address || '').trim();
          if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(dest)) {
            throw new Error(t('Enter the XRPL address (r…) to receive the XRP'));
          }
          // 1) retirar de la posición SOLO lo que haga falta (drena posición
          //    primero; si want > posición, el resto ya está en el saldo libre).
          const withdrawHuman = Math.min(wantHuman, supplyFxrpHuman);
          const wBody = withdrawHuman > 1e-9
            ? await (async () => {
                const wRes = await fetch(`${API_BASE}/flare-demo/iso-withdraw/prepare`, {
                  method: 'POST',
                  headers: authHeaders(),
                  credentials: 'include',
                  body: JSON.stringify({ evmAddress: owner, asset: 'fxrp', amountBase: toBase(String(withdrawHuman), FXRP_DECIMALS), region: getUserRegion() }),
                });
                const b = await wRes.json().catch(() => ({}));
                if (!wRes.ok) throw new Error(friendlyHttpError(wRes.status, b));
                return b;
              })()
            : { calls: [] };
          // 2) redimir ese FXRP a XRP nativo
          const rRes = await fetch(`${API_BASE}/wallet-transfer/bridge/flare-to-xrpl/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ evmWallet: owner, xrplDestination: dest, amountXrp: String(wantHuman), region: getUserRegion() }),
          });
          const rBody = await rRes.json().catch(() => ({}));
          if (!rRes.ok) throw new Error(friendlyHttpError(rRes.status, rBody));
          // Firmar retirada + redención juntas (una sola confirmación en la wallet).
          const calls = [
            ...((wBody as { calls?: A1Prepared['calls'] }).calls ?? []),
            ...((rBody as { calls?: A1Prepared['calls'] }).calls ?? []),
          ];
          setPrepared({
            rail: 'evm',
            chainId: 14,
            calls,
            disclosure: {
              action: 'unmint-position',
              asset: 'FXRP → XRP',
              amount: wantHuman,
              to: dest,
              note: t('Withdraws this position from Kinetic and redeems it to native XRP — one signature in your wallet. The FAssets agent pays the XRP to your XRPL address (minutes to hours), minus the protocol redemption fee.'),
            },
          } as A1Prepared);
        }
      } else {
        const asset = action === 'derisk' ? deriskAsset : withdrawAsset;
        // MAX también en DERISK (founder 2026-07-26): los pasos 1 y 3 son
        // withdraws normales — la salida exacta por SHARES es justo lo que el
        // unwind quiere (paso 3 tras el repay uint(-1) con deuda a cero = MAX
        // limpio; con polvo de deuda el preflight lo canta antes de firmar).
        const maxExit = useMax && railIsEvm;
        const base = toBase(amount, asset === 'usdt0' ? USDT0_DECIMALS : FXRP_DECIMALS);
        if (!maxExit && base === '0') throw new Error(t('Amount must be greater than 0'));
        if (railIsEvm) {
          // EVM-direct position: one redeem signed by the wallet — the funds
          // land in that same wallet, no Xaman, no mint-coupling. MAX sends
          // all:true → the backend redeems by kToken SHARES (exact full exit,
          // interest included) instead of an amount snapshot that leaves dust.
          const res = await fetch(`${API_BASE}/flare-demo/iso-withdraw/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              evmAddress: owner,
              asset,
              ...(maxExit ? { all: true } : { amountBase: base }),
              region: getUserRegion(),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          setPrepared(body as A1Prepared);
        } else {
          if (!(parseFloat(xrpForMint) > 0)) {
            throw new Error(t('The XRP for the mint-coupled dispatch must be greater than 0'));
          }
          // Pin the XRPL account that OWNS this Smart Account — never the
          // merely-connected Xaman (2026-07-19 mismatch incident).
          const signerXrpl = owningXrpl ?? xrpl.address;
          if (!signerXrpl) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
          // Withdraw = a una wallet Flare (sigue siendo FXRP), QUEDARSE en la
          // propia Smart Account como saldo libre (destino = la wallet de
          // origen), o — founder 2026-07-30 — la XRPL DUEÑA como XRP nativo,
          // por el camino atómico ya construido (unmintToXrpl, 26-jul).
          // También en DERISK (founder 2026-07-31): el cierre guiado de un PA
          // es walletless de punta a punta — jamás exige una wallet EVM.
          const dest = evmDest.trim();
          const keep = dest.toLowerCase() === owner.toLowerCase();
          const toXrpl = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(dest);
          if (toXrpl && dest !== signerXrpl) {
            // The built rail redeems to the OWNING wallet only — never a
            // silent redirect to a different account than the one picked.
            throw new Error(t('Native XRP can only go to the XRPL wallet that owns this account.'));
          }
          if (!keep && !toXrpl && !/^0x[a-fA-F0-9]{40}$/.test(dest)) throw new Error(t('Enter a valid destination EVM address (0x…)'));
          const res = await fetch(`${API_BASE}/flare-demo/pa-withdraw-transfer/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              xrplAddress: signerXrpl,
              ...(toXrpl ? { unmintToXrpl: true } : keep ? { keepInPa: true } : { evmWallet: dest }),
              asset,
              amountBase: base,
              amountXrpForMint: parseFloat(xrpForMint) || 0,
              region: getUserRegion(),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          if (String(body.personalAccount ?? '').toLowerCase() !== owner.toLowerCase()) {
            throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
          }
          setPrepared(body as XrplPrepared);
        }
      }
      setPhase('review');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('form');
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setPhase('signing');
    try {
      if (prepared.rail === 'xrpl') {
        if (!xrpl.isConnected) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        const { txHash: hash } = await xrpl.sendIntent({ tx: prepared.xrplPayment as never });
        // 0xFE userOp: signed ≠ settled — follow the mint on Flare (executor).
        settlement.track(startPending('xrpl-mint', hash), { onSettled: onChanged });
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        if (prepared.calls.length === 0) throw new Error(t('Nothing to sign — the position is already at/above the target.'));
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        settlement.track(handle, { onSettled: onChanged });
      }
      // DERISK bookkeeping: remember what each step did, advance the guide.
      if (action === 'derisk') {
        if (deriskStep === 1) setWithdrawnUsdt0Base(toBase(amount, USDT0_DECIMALS));
        setDeriskDone((s) => new Set(s).add(deriskStep));
      }
      // Signed ≠ done: the parent refresh now waits for onSettled (a premature
      // onChanged() dropped the "in flight" row while the op was still live).
      setPhase('done');
    } catch (e) {
      setError(translateError(e, t).message);
      // Keep the review — the prepared payload is still valid, retry the signature.
      setPhase('review');
    }
  }

  function nextDeriskStep() {
    setPrepared(null);
    settlement.reset();
    setAmount('');
    // El MAX no se hereda entre pasos: con el input vacío, un useMax pegajoso
    // mandaría all:true sin que el usuario lo haya pedido en ESTE paso.
    setUseMax(false);
    // La decisión del swap-fill tampoco: cada paso re-pregunta si hace falta.
    setFillAsset(null);
    setNoFillChosen(false);
    setError('');
    setRepayMode('full');
    setDeriskStep((s) => (s === 1 ? 2 : 3));
    setPhase('form');
  }

  const disclosure = prepared?.disclosure as Record<string, unknown> | undefined;

  // Founder 2026-07-31: con hueco de USDT0 la firma queda BLOQUEADA hasta que
  // el usuario marca una de las dos opciones (swap-fill o "sin swap"). Elegir
  // construye la tx de una forma o de otra; no elegir no firma nada.
  const fillChoicePending =
    prepared?.fill != null &&
    (prepared.fill.needed || prepared.fill.required) &&
    !prepared.fill.applied &&
    !noFillChosen;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center border text-sky-300 border-sky-400/30 bg-sky-400/10">
              {action === 'repay' ? <ShieldCheck className="w-5 h-5" /> : action === 'resupply' ? <Recycle className="w-5 h-5" /> : action === 'derisk' ? <ListOrdered className="w-5 h-5" /> : action === 'unmint' ? <ArrowUpFromLine className="w-5 h-5" /> : <ArrowDownToLine className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{heading}</h2>
              <p className="text-xs text-ink/40 mt-0.5">
                {ownerAlias && <span className="text-ink/60">{ownerAlias} · </span>}
                <span className="font-mono">{owner.slice(0, 10)}…{owner.slice(-6)}</span>
                <span className="text-ink/30"> · {railIsEvm ? t('your Flare wallet — signs directly') : t('your Astryum account — you sign in Xaman')}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {/* DERISK guide — the ONLY safe order; steps unlock in sequence so the
              debt is never left uncovered (withdraw FXRP before repaying would). */}
          {action === 'derisk' && (
            <ol className="space-y-1.5 text-xs">
              {[
                t('Get back the dollars you had re-deposited'),
                t('Pay off the whole loan'),
                t('Recover the XRP backing your position'),
              ].map((label, i) => {
                const n = (i + 1) as 1 | 2 | 3;
                const done = deriskDone.has(n);
                const current = deriskStep === n;
                return (
                  <li
                    key={n}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
                      current ? 'border-volt/30 bg-volt/5 text-ink' : done ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-ink/5 text-ink/35'
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5 text-center font-mono">{n}</span>}
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {error && (
            <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* FORM */}
          {phase === 'form' && (
            <>
              {/* Same market open from more than one wallet → pick the account.
                  Switching also switches legs, balances, rail and fields.
                  Locked during DERISK: the guided unwind is one account's story. */}
              {allHolders.length > 1 && action !== 'derisk' && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('Wallet of the position')}</label>
                  <select
                    value={owner}
                    onChange={(e) => selectHolder(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                  >
                    {allHolders.map((h) => (
                      <option key={h.owner} value={h.owner}>
                        {holderLabel(h)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Who signs the 0xFE order: the XRPL account that CONTROLS this
                  Smart Account, pinned in the payload (2026-07-19 incident). */}
              {ownerIsPa && owningXrpl && !connectedIsOwner && (
                <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 text-xs text-sky-200 leading-relaxed">
                  {t('This Smart Account is controlled by your XRPL account')}{' '}
                  <span className="font-mono text-sky-100">{aliasOf(owningXrpl)} · {owningXrpl.slice(0, 8)}…{owningXrpl.slice(-4)}</span>.{' '}
                  {t('The order is pinned to it — when Xaman opens, approve with that account (no need to reconnect).')}
                </div>
              )}

              {/* DERISK: un paso sin pierna no es un muro — se salta con un
                  botón. Sin esto, con 0 USDT0 suppliado el paso 1 no mostraba
                  ni MAX ni forma de avanzar (founder 2026-07-26). */}
              {deriskStepEmpty && (
                <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-sky-200 leading-relaxed">
                    {deriskStep === 1
                      ? t('No USDT0 supplied — nothing to withdraw in this step.')
                      : deriskStep === 2
                        ? t('No outstanding debt — nothing to repay in this step.')
                        : t('No FXRP collateral left — the unwind is complete.')}
                  </p>
                  {deriskStep < 3 ? (
                    <button
                      onClick={nextDeriskStep}
                      className="w-full bg-volt text-volt-ink text-xs font-medium py-2 rounded-xl hover:brightness-95 transition-all"
                    >
                      {t('Skip to step')} {deriskStep + 1}
                    </button>
                  ) : (
                    <button
                      onClick={onClose}
                      className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-xs py-2 rounded-xl hover:bg-ink/10 transition-colors"
                    >
                      {t('Done')}
                    </button>
                  )}
                </div>
              )}
              {/* PA rail: step 1 travels inside step 2's repay userOp — one
                  dispatch less to pay; the banner says so and hands over. */}
              {deriskStep1InsideRepay && (
                <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-sky-200 leading-relaxed">
                    {t('In your Astryum account this step signs together with step 2: the repay takes back the re-deposited dollars by itself, inside the same Xaman signature.')}
                  </p>
                  <button
                    onClick={nextDeriskStep}
                    className="w-full bg-volt text-volt-ink text-xs font-medium py-2 rounded-xl hover:brightness-95 transition-all"
                  >
                    {t('Skip to step')} 2
                  </button>
                </div>
              )}
              {effective === 'repay' ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-ink/5 border border-ink/10 rounded-xl p-3">
                      <div className="text-ink/40">{t('FXRP collateral')}</div>
                      <div className="font-mono text-ink/80 mt-1">{fmt(supplyFxrpHuman)}</div>
                    </div>
                    <div className="bg-ink/5 border border-ink/10 rounded-xl p-3">
                      <div className="text-ink/40">{t('USDT0 debt')}</div>
                      <div className="font-mono text-ink/80 mt-1">{fmt(debtHuman)}</div>
                    </div>
                  </div>
                  {/* Who executes the repay: inside the PA (Xaman, executor gas —
                      the walletless path) or from the user's own Flare wallet (A1). */}
                  {ownerIsPa && action !== 'derisk' && (
                    <div className="flex gap-2">
                      {(['pa', 'evm'] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => { setRepayRail(r); setFillAsset(null); }}
                          className={`flex-1 text-xs py-2 rounded-xl border transition-colors ${
                            repayRail === r ? 'border-volt/40 bg-volt/10 text-ink' : 'border-ink/10 bg-ink/5 text-ink/50'
                          }`}
                        >
                          {r === 'pa' ? t('From the PA (Xaman)') : t('From your Flare wallet')}
                        </button>
                      ))}
                    </div>
                  )}
                  {action !== 'derisk' && (
                    <div className="flex gap-2">
                      {(['restore', 'full'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => { setRepayMode(m); setFillAsset(null); }}
                          className={`flex-1 text-xs py-2 rounded-xl border transition-colors ${
                            repayMode === m ? 'border-volt/40 bg-volt/10 text-ink' : 'border-ink/10 bg-ink/5 text-ink/50'
                          }`}
                        >
                          {m === 'restore' ? t('Restore target HF') : t('Repay in full')}
                        </button>
                      ))}
                    </div>
                  )}
                  {repayMode === 'restore' && (
                    <div>
                      <label className="text-xs text-ink/40 block mb-2">{t('Target Health Factor')}</label>
                      <input
                        type="number"
                        min={1.01}
                        step={0.05}
                        value={targetHF}
                        onChange={(e) => setTargetHF(e.target.value)}
                        className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                      />
                    </div>
                  )}
                  {repayViaPa ? (
                    <>
                      <p className="text-[11px] text-ink/40 leading-relaxed">
                        {t("Runs entirely inside your Smart Account — one Xaman signature, the executor pays the Flare gas. Funded from the PA's free USDT0 first, then your carry supply. No EVM wallet needed.")}
                      </p>
                      <DispatchXrpField value={xrpForMint} onChange={setXrpForMint} t={t} />
                    </>
                  ) : (
                    <p className="text-[11px] text-ink/40 leading-relaxed">
                      {t('The USDT0 must already sit in your EVM wallet — withdraw it from the Personal Account first if needed.')}
                    </p>
                  )}
                </>
              ) : effective === 'unmint' ? (
                <>
                  <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs">
                    <div className="text-ink/40">{t('FXRP in this position')}</div>
                    <div className="font-mono text-ink/85 mt-1 text-sm">
                      {legsLoading ? '…' : `${fmt(supplyFxrpHuman)} FXRP`}
                      {!legsLoading && xrpUsd != null && supplyFxrpHuman > 0 && (
                        <span className="text-ink/40 text-xs"> ≈ ${fmt(supplyFxrpHuman * xrpUsd, 2)}</span>
                      )}
                    </div>
                    {!ownerIsPa && (paFreeFxrp ?? 0) > 0 && (
                      <div className="text-[10px] text-ink/40 mt-1">
                        {t('Free in this wallet')}: <span className="font-mono">{fmt(paFreeFxrp ?? 0)} FXRP</span>
                      </div>
                    )}
                    {redeemMinXrp != null && (
                      <div className="text-[10px] text-ink/35 mt-1">
                        {t('Protocol minimum per redemption')}: {redeemMinXrp} XRP
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-ink/40 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{t('Amount')} · FXRP</span>
                      {supplyFxrpHuman > 0 && (
                        <button
                          onClick={() => {
                            setAmount(String(supplyFxrpHuman));
                            setUseMax(true);
                          }}
                          className="text-volt hover:underline font-medium"
                        >
                          {t('Position')} ({fmt(supplyFxrpHuman)})
                        </button>
                      )}
                      {!ownerIsPa && (paFreeFxrp ?? 0) > 0 && supplyFxrpHuman > 0 && (
                        <button
                          onClick={() => {
                            setAmount(String(supplyFxrpHuman + (paFreeFxrp ?? 0)));
                            setUseMax(true);
                          }}
                          className="text-volt hover:underline font-medium"
                        >
                          {t('Position + wallet')} ({fmt(supplyFxrpHuman + (paFreeFxrp ?? 0))})
                        </button>
                      )}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setUseMax(false);
                      }}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                    />
                    <AmountSliderUsd
                      max={supplyFxrpHuman + (ownerIsPa ? 0 : paFreeFxrp ?? 0)}
                      amount={amount}
                      usdPrice={xrpUsd}
                      onAmount={(v, atMax) => {
                        setAmount(v);
                        setUseMax(atMax);
                      }}
                    />
                    {useMax && (
                      <p className="text-[10px] text-volt/80 mt-1.5">
                        {t('MAX = the full position, withdrawn from Kinetic and redeemed to native XRP.')}
                      </p>
                    )}
                  </div>
                  {ownerIsPa ? (
                    <>
                      <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 text-xs text-sky-200 leading-relaxed">
                        {t('The XRP arrives at the XRPL wallet that OWNS this Smart Account')}
                        {owningXrpl && (
                          <>
                            {' '}
                            <span className="font-mono text-sky-100">
                              {owningXrpl.slice(0, 8)}…{owningXrpl.slice(-4)}
                            </span>
                          </>
                        )}
                        {' — '}
                        {t('the burn happens at execution; the FAssets agent pays the XRP after (minutes to hours), minus the protocol redemption fee.')}
                      </div>
                      <DispatchXrpField value={xrpForMint} onChange={setXrpForMint} t={t} />
                    </>
                  ) : (
                    <>
                      {/* Wallet EVM: sin 0xFE, sin dispatch. Firma la propia wallet
                          y el usuario ELIGE la XRPL que recibe el XRP — entre sus
                          wallets y su agenda; escribir es la tercera opción. */}
                      <DestinationField
                        kind="xrpl"
                        label={t('XRPL wallet to receive the XRP')}
                        value={unmintXrplDest}
                        onChange={setUnmintXrplDest}
                        myWallets={xrplDestWallets}
                        t={t}
                      />
                      <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 text-xs text-sky-200 leading-relaxed">
                        {t('Withdraws this position from Kinetic and redeems it to native XRP, in one signature in your wallet. The FAssets agent pays the XRP to that XRPL address (minutes to hours), minus the protocol redemption fee. No Xaman, no dispatch.')}
                      </div>
                    </>
                  )}
                </>
              ) : deriskStep1InsideRepay ? null : (
                <>
                  {/* The USDT0 tab belongs to the CARRY (the only lend+borrow
                      strategy). Lend-only vaults withdraw FXRP, no toggle. */}
                  {effective === 'withdraw' && action !== 'derisk' && isCarry && (
                    <div className="flex gap-2">
                      {(['usdt0', 'fxrp'] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => setWithdrawAsset(a)}
                          className={`flex-1 text-xs py-2 rounded-xl border transition-colors ${
                            withdrawAsset === a ? 'border-volt/40 bg-volt/10 text-ink' : 'border-ink/10 bg-ink/5 text-ink/50'
                          }`}
                        >
                          {a.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Rediseño B: Withdraw = SIEMPRE FXRP a una wallet Flare.
                      La salida a XRP nativo vive en "Redeem" (a wallet XRPL). */}
                  {/* What the vault holds for the selected asset — the number
                      the user came to see; MAX fills it into the amount. */}
                  {effective === 'withdraw' && action !== 'derisk' && (
                    <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs">
                      <div className="text-ink/40">
                        {t('In the vault')}
                        {liveLegs && <span className="text-ink/25"> · {t('live on-chain')}</span>}
                      </div>
                      <div className="font-mono text-ink/85 mt-1 text-sm">
                        {legsLoading
                          ? '…'
                          : withdrawAsset === 'usdt0'
                            ? `${fmt(suppliedUsdt0Human)} USDT0`
                            : `${fmt(supplyFxrpHuman)} FXRP`}
                        {!legsLoading && withdrawAsset === 'fxrp' && xrpUsd != null && supplyFxrpHuman > 0 && (
                          <span className="text-ink/40 text-xs"> ≈ ${fmt(supplyFxrpHuman * xrpUsd, 2)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-ink/40 block mb-2">
                      {t('Amount')} · {effective === 'resupply' ? 'USDT0' : (action === 'derisk' ? deriskAsset : withdrawAsset).toUpperCase()}
                      {effective === 'resupply' && debtHuman > 0 && (
                        <button onClick={() => setAmount(String(debtHuman))} className="ml-2 text-volt hover:underline">
                          {t('use borrowed')} ({fmt(debtHuman)})
                        </button>
                      )}
                      {effective === 'withdraw' &&
                        action !== 'derisk' &&
                        (withdrawAsset === 'usdt0' ? suppliedUsdt0Human : supplyFxrpHuman) > 0 && (
                          <button
                            onClick={() => {
                              setAmount(String(withdrawAsset === 'usdt0' ? suppliedUsdt0Human : supplyFxrpHuman));
                              setUseMax(true);
                            }}
                            className="ml-2 text-volt hover:underline font-medium"
                          >
                            MAX ({fmt(withdrawAsset === 'usdt0' ? suppliedUsdt0Human : supplyFxrpHuman)})
                          </button>
                        )}
                      {action === 'derisk' && deriskStep === 1 && suppliedUsdt0Human > 0 && (
                        <button
                          onClick={() => { setAmount(String(suppliedUsdt0Human)); setUseMax(true); }}
                          className="ml-2 text-volt hover:underline font-medium"
                        >
                          MAX ({fmt(suppliedUsdt0Human)})
                        </button>
                      )}
                      {action === 'derisk' && deriskStep === 3 && supplyFxrpHuman > 0 && (
                        <button
                          onClick={() => { setAmount(String(supplyFxrpHuman)); setUseMax(true); }}
                          className="ml-2 text-volt hover:underline font-medium"
                        >
                          MAX ({fmt(supplyFxrpHuman)})
                        </button>
                      )}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setUseMax(false);
                      }}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                    />
                    {effective === 'withdraw' && (
                      <AmountSliderUsd
                        max={(action === 'derisk' ? deriskAsset : withdrawAsset) === 'usdt0' ? suppliedUsdt0Human : supplyFxrpHuman}
                        amount={amount}
                        usdPrice={(action === 'derisk' ? deriskAsset : withdrawAsset) === 'fxrp' ? xrpUsd : null}
                        onAmount={(v, atMax) => {
                          setAmount(v);
                          setUseMax(atMax);
                        }}
                      />
                    )}
                    {useMax && railIsEvm && effective === 'withdraw' && (
                      <p className="text-[10px] text-volt/80 mt-1.5">
                        {t('MAX = exact full exit: redeems ALL your kToken shares, interest included — the final amount can only be slightly higher than shown.')}
                      </p>
                    )}
                  </div>
                  {effective === 'withdraw' && !railIsEvm && (
                    <div>
                      {/* Adónde va: mis wallets / agenda / escribir — nunca un
                          paste obligado. La wallet de ORIGEN va primera con su
                          punto: elegirla = sacar del vault y dejarlo en la
                          misma Smart Account (keepInPa). También en DERISK
                          (founder 2026-07-31): el paso 3 de un PA recupera el
                          capital sin exigir una wallet EVM — quedarse en la
                          Smart Account o XRP nativo a la XRPL dueña. */}
                      <DestinationField
                        kind="evm"
                        label={t('Where the capital goes')}
                        value={evmDest}
                        onChange={setEvmDest}
                        myWallets={myWallets}
                        source={{ address: owner, label: `${ownerAlias ?? 'Smart Account'}` }}
                        sourceHint={t('The funds leave from here — pick it to keep the capital in this same wallet.')}
                        // Founder 2026-07-30: the non-EVM wallet must show too.
                        // The one XRPL destination the built rail reaches is the
                        // OWNING wallet (atomic withdraw+redeem, unmintToXrpl) —
                        // offered here; arbitrary XRPL addresses stay out.
                        extraOptions={
                          (action === 'derisk' ? deriskAsset : withdrawAsset) === 'fxrp' && owningXrpl
                            ? [
                                {
                                  address: owningXrpl,
                                  label:
                                    myWallets.find((w) => w.address === owningXrpl)?.label ??
                                    `XRPL · ${owningXrpl.slice(0, 8)}…`,
                                  hint: t('Arrives as NATIVE XRP (minutes to hours) — 5 XRP minimum.'),
                                },
                              ]
                            : undefined
                        }
                        t={t}
                      />
                      <p className="text-[10px] text-ink/35 mt-1.5">
                        {evmDest.trim().toLowerCase() === owner.toLowerCase()
                          ? t('Leaves the vault and stays as free balance in this Smart Account.')
                          : /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(evmDest.trim())
                            ? t('Withdraws and converts in ONE signature — the XRP arrives at your XRPL wallet in minutes to hours.')
                            : t('Stays as FXRP on Flare. To get native XRP back to an XRPL wallet, use Redeem.')}
                      </p>
                    </div>
                  )}
                  {railIsEvm ? (
                    <p className="text-[11px] text-ink/40 leading-relaxed">
                      {effective === 'withdraw'
                        ? t('This position lives in your own Flare wallet — you sign one call and the funds land right there. No Xaman, no mint.')
                        : t('This position lives in your own Flare wallet — you sign the approve + supply calls directly. No Xaman, no mint.')}
                    </p>
                  ) : (
                    <DispatchXrpField value={xrpForMint} onChange={setXrpForMint} t={t} />
                  )}
                </>
              )}

              {needsWalletConnect && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {t('This position lives in wallet')}{' '}
                    <span className="font-mono">{owner.slice(0, 8)}…{owner.slice(-4)}</span> —{' '}
                    {t('connect that wallet (MetaMask) to sign. The XRPL rail cannot move it.')}
                  </span>
                </div>
              )}
              <button
                onClick={() => void prepare()}
                disabled={needsWalletConnect || deriskStepEmpty || deriskStep1InsideRepay}
                className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('Review before signing')}
              </button>
            </>
          )}

          {phase === 'preparing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">{t('Preparing the unsigned payload…')}</p>
            </div>
          )}

          {/* REVIEW — full disclosure before the signature (invariant #6) */}
          {phase === 'review' && prepared && (
            <>
              {/* R2 tier 1 — the headline: what happens to the money, one
                  sentence, before any table. */}
              <p className="text-sm text-ink/85 leading-relaxed">
                {(() => {
                  const n = (v: unknown) =>
                    v != null && Number.isFinite(Number(v)) ? fmt(Number(v)) : amount || '—';
                  if (effective === 'repay')
                    return `${t('You are about to repay')} ${n(disclosure?.repayUsdt0)} USDT0 ${t('of your loan on Kinetic.')}`;
                  if (effective === 'resupply')
                    return `${t('You are about to deposit')} ${n(disclosure?.amount)} USDT0 ${t('back into Kinetic.')}`;
                  if (effective === 'unmint')
                    return `${t('You are about to convert')} ${amount || '—'} FXRP ${t('into XRP, on its way to your XRPL wallet.')}`;
                  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(evmDest.trim()))
                    return `${t('You are about to convert')} ${n(disclosure?.amount)} FXRP ${t('into XRP, on its way to your XRPL wallet.')}`;
                  return `${t('You are about to withdraw')} ${n(disclosure?.amount)} ${(action === 'derisk' ? deriskAsset : withdrawAsset).toUpperCase()} ${t('from Kinetic to your wallet.')}`;
                })()}
              </p>
              {/* Wide format: disclosure on the left, outcome/verdict on the
                  right; below `sm` it stacks back to the original order. */}
              <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
              <div className="space-y-4">
              <div className="bg-ink/5 border border-ink/10 rounded-xl px-4 py-2 divide-y divide-ink/5">
                {prepared.rail === 'evm' ? (
                  <>
                    {disclosure?.amount != null && (
                      <Row label={t('Amount')} value={`${fmt(Number(disclosure.amount))} ${String(disclosure.asset ?? '').toUpperCase()}`} />
                    )}
                    {disclosure?.usdt0Supplied != null && (
                      <Row label={t('Supplied')} value={`${fmt(Number(disclosure.usdt0Supplied))} USDT0`} />
                    )}
                    {disclosure?.currentHF != null && <Row label={t('Current HF')} value={fmt(Number(disclosure.currentHF), 3)} />}
                    {disclosure?.targetHF != null && <Row label={t('Target HF')} value={fmt(Number(disclosure.targetHF), 2)} />}
                    {disclosure?.repayUsdt0 != null && <Row label={t('Repay')} value={`${fmt(Number(disclosure.repayUsdt0))} USDT0`} />}
                    {disclosure?.remainingDebtUsdt0 != null && <Row label={t('Debt after')} value={`${fmt(Number(disclosure.remainingDebtUsdt0))} USDT0`} />}
                    {disclosure?.shortfallUsdt0 != null && Number(disclosure.shortfallUsdt0) > 0 && (
                      <Row label={t('Top-up needed')} value={`${fmt(Number(disclosure.shortfallUsdt0))} USDT0`} />
                    )}
                    <Row label={t('Calls to sign')} value={`${(prepared as A1Prepared).calls.length}`} />
                    {/* R5 — every charge is enumerated BEFORE the wallet opens.
                        This rail has no server-side gas estimate yet, so the row
                        says where the exact figure appears instead of hiding. */}
                    <Row label={t('Astryum fee')} value={`0 · ${t('we charge nothing')}`} />
                    <Row label={t('Network fee (gas)')} value={t('your wallet shows the exact figure before signing')} />
                  </>
                ) : (
                  <>
                    {/* Invariante #6 — los costes reales del dispatch, SIEMPRE explícitos
                        antes de la firma (el dump genérico de abajo los recortaba). */}
                    {disclosure?.mintCoupledXrp != null && (
                      <Row label={t('Dispatch XRP (comes back to you as FXRP)')} value={`${fmt(Number(disclosure.mintCoupledXrp))} XRP`} />
                    )}
                    {disclosure?.mintingFeeXrp != null && (
                      <Row label={t('Minting fee')} value={`${fmt(Number(disclosure.mintingFeeXrp), 2)} XRP`} />
                    )}
                    {disclosure?.executorFeeXrp != null && (
                      <Row label={t('Executor fee')} value={`${fmt(Number(disclosure.executorFeeXrp), 2)} XRP`} />
                    )}
                    {disclosure?.fxrpMintedSideEffect != null && (
                      <Row label={t('…returns to your Smart Account as')} value={`${fmt(Number(disclosure.fxrpMintedSideEffect), 4)} FXRP`} />
                    )}
                    {/* R2: the generic Object.entries dump died here — it printed
                        raw backend JSON keys (paUsdt0FreePlusSupplied…) as user
                        labels on the LAST screen before a signature, and its
                        .slice(0,6) made the rows change with backend versions.
                        Every fact a person needs is in the explicit rows above;
                        anything else is technical detail, not disclosure. */}
                  </>
                )}
              </div>
              {/* SWAP-FILL (§4b): el usuario ELIGE el activo que compra el hueco;
                  con fill activo, se muestra y se puede quitar. Todo re-prepara
                  con números frescos — jamás un fill silencioso. */}
              {prepared.fill && (prepared.fill.needed || prepared.fill.applied) && (
                <div className={`rounded-xl p-3 space-y-2 border ${prepared.fill.applied ? 'bg-volt/5 border-volt/25' : 'bg-amber-500/5 border-amber-500/25'}`}>
                  {prepared.fill.applied ? (
                    <>
                      <p className="text-xs text-ink/70 leading-relaxed">
                        <span className="font-medium">{t('Fill active')}:</span>{' '}
                        {t('buys exactly')}{' '}
                        <span className="font-mono">{fmt(prepared.fill.gapUsdt0, 6)} USDT0</span> {t('with')} ≤{' '}
                        <span className="font-mono">
                          {fmt(prepared.fill.applied.amountInMax, prepared.fill.applied.asset === 'FLR' ? 4 : 6)}{' '}
                          {prepared.fill.applied.asset}
                        </span>{' '}
                        {t('from your own balance, swapped on SparkDEX inside this same batch. Unspent max stays with you. Slippage cap')}{' '}
                        {prepared.fill.slippagePct}%.
                      </p>
                      <button
                        // Quitar el swap = la elección explícita de "sin swap":
                        // el re-prepare vuelve sin fill y ya se puede firmar.
                        onClick={() => { setFillAsset(null); setNoFillChosen(true); void prepare(null); }}
                        className="text-[11px] text-ink/45 hover:text-ink/70 underline"
                      >
                        {t('Remove the fill (repay only what you hold)')}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Founder 2026-07-31: elegir es OBLIGATORIO. O el swap
                          compra el hueco dentro del mismo lote, o "sin swap" y
                          el hueco lo cubre el usuario — cada botón construye la
                          tx de una forma, y sin elegir no hay firma. */}
                      <p className="text-xs text-amber-200 leading-relaxed">
                        {t('You are short')}{' '}
                        <span className="font-mono">{fmt(prepared.fill.gapUsdt0, 6)} USDT0</span>
                        {' — '}
                        {t('choose how to cover it: swap YOUR own asset inside the same batch you sign (wallet → pool → wallet; Astryum only compiles), or repay without the swap and cover the rest yourself. The transaction is built one way or the other — the signature unlocks when you pick:')}
                      </p>
                      <div className="flex gap-2">
                        {prepared.fill.options.map((o) => (
                          <button
                            key={o.asset}
                            disabled={!o.sufficient}
                            onClick={() => { setNoFillChosen(false); setFillAsset(o.asset); void prepare(o.asset); }}
                            className={`flex-1 rounded-xl border p-2 text-left transition-colors ${
                              o.sufficient
                                ? 'border-volt/40 bg-volt/10 hover:bg-volt/15 text-ink'
                                : 'border-ink/10 bg-ink/5 text-ink/35 cursor-not-allowed'
                            }`}
                          >
                            <div className="text-xs font-medium">{t('Pay with swapped')} {o.asset}</div>
                            <div className="font-mono text-[10px] mt-0.5">≤ {fmt(o.amountInMax, o.asset === 'FLR' ? 4 : 6)}</div>
                            <div className="text-[10px] mt-0.5">
                              {o.sufficient
                                ? `${t('you hold')} ${o.balance == null ? '—' : fmt(o.balance, o.asset === 'FLR' ? 2 : 4)}`
                                : t('not enough balance')}
                            </div>
                          </button>
                        ))}
                        <button
                          onClick={() => setNoFillChosen(true)}
                          className={`flex-1 rounded-xl border p-2 text-left transition-colors ${
                            noFillChosen
                              ? 'border-amber-400/50 bg-amber-400/10 text-ink'
                              : 'border-ink/15 bg-ink/5 hover:bg-ink/10 text-ink/70'
                          }`}
                        >
                          <div className="text-xs font-medium">{t('Do not pay with a swap')}</div>
                          <div className="text-[10px] mt-0.5">{t('repay only what you already hold')}</div>
                        </button>
                      </div>
                      {noFillChosen && (
                        <p className="text-[11px] text-amber-200/90 leading-relaxed">
                          {prepared.fill.required
                            ? t('Right now this account holds no USDT0 — without the swap there is nothing to repay. Bring USDT0 to it (or repay from your Flare wallet) and come back.')
                            : t('The missing USDT0 stays as YOUR debt after signing: you cover it later with USDT0 you bring yourself, and the FXRP collateral cannot leave until the whole debt is at zero.')}
                        </p>
                      )}
                      {prepared.fill.options.length === 0 && (
                        <p className="text-[11px] text-ink/40">{t('No SparkDEX route quotes this amount right now.')}</p>
                      )}
                    </>
                  )}
                </div>
              )}
              </div>
              <div className="space-y-4">
              {disclosure?.beforeAfter != null && <BeforeAfterPanel ba={disclosure.beforeAfter as Record<string, unknown>} />}
              {typeof disclosure?.note === 'string' && (
                <p className="text-[11px] text-ink/45 leading-relaxed">{disclosure.note}</p>
              )}
              {/* Invariant #11 — the dry-run verdict BEFORE the wallet opens. */}
              <PreflightNotice preflight={prepared.preflight} />
              {/* Rescue path for the drained-steering trap (founder hit it
                  live, 2026-07-30): name the account to refund and reassure —
                  the funds on Flare are untouched, this is only fuel. */}
              {prepared.rail === 'xrpl' && preflightSaysFail(prepared.preflight) && owningXrpl && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('The account that signs is your XRPL wallet')}{' '}
                  <span className="font-mono">{owningXrpl.slice(0, 8)}…{owningXrpl.slice(-4)}</span> —{' '}
                  {t('send it ~2 XRP (from an exchange or another wallet) and come back. Your money on Flare is untouched.')}
                </div>
              )}
              </div>
              </div>
            </>
          )}

          {phase === 'signing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">
                {prepared?.rail === 'xrpl' ? t('Approve the Payment in Xaman…') : t('Confirm in your wallet…')}
              </p>
            </div>
          )}

          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                // R8.1: the success line says what happened to the MONEY, per
                // action — the generic "Settled on Flare" told a repaying user
                // nothing about their loan.
                settledText={
                  action === 'repay'
                    ? t('Done. Your debt is paid down.')
                    : action === 'withdraw'
                      ? t('Done. The funds are back in your account.')
                      : action === 'unmint'
                        ? t('Done. Your XRP is on its way to your XRPL wallet (minutes to hours).')
                        : undefined
                }
              />
              {action === 'derisk' && deriskStep < 3 ? (
                <button
                  onClick={nextDeriskStep}
                  className="mt-1 w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all"
                >
                  {t('Continue to step')} {deriskStep + 1}
                </button>
              ) : action === 'repay' ? (
                <Link
                  href="/app/portfolio#position-health"
                  className="mt-1 w-full inline-flex items-center justify-center gap-2 text-ink/55 text-sm py-1 hover:text-ink/80 transition-colors"
                >
                  {t('See how your position looks now')} →
                </Link>
              ) : null}
              <button
                onClick={onClose}
                className="mt-1 w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {settlement.state.status === 'settled' ? t('Done') : t('Keep waiting in the background')}
              </button>
            </div>
          )}

        </div>

        {/* Fixed footer — the signing controls and the custody note never
            scroll out of reach, however long the disclosure above grows. */}
        <div className="shrink-0 border-t border-ink/5 px-6 py-4 space-y-2">
          {phase === 'review' && prepared && (
            <>
              {fillChoicePending ? (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200">
                  {t('First choose how to cover the missing USDT0 — pick one of the options above and the signature unlocks.')}
                </div>
              ) : prepared.fill?.required && !prepared.fill?.applied ? null : prepared.rail === 'evm' &&
                ((prepared as A1Prepared).calls ?? []).length === 0 ? (
                <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-xl p-3 text-xs text-emerald-300">
                  {t('Nothing to sign — the position is already at/above the target.')}
                </div>
              ) : (
                <button
                  onClick={sign}
                  className={`w-full flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl transition-all ${
                    preflightSaysFail(prepared.preflight)
                      ? 'bg-ink/10 text-tone-danger border border-tone-danger/30 hover:bg-ink/15'
                      : 'bg-volt text-volt-ink hover:brightness-95 shadow-lg shadow-volt/20'
                  }`}
                >
                  {preflightSaysFail(prepared.preflight)
                    ? t('Sign anyway — the dry-run says it will fail')
                    : prepared.rail === 'xrpl'
                      ? t('Sign in Xaman')
                      : t('Sign in wallet')}
                </button>
              )}
              <button
                onClick={() => { releaseSeatIfUnsigned(); setPrepared(null); setNoFillChosen(false); setPhase('form'); }}
                className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Back')}
              </button>
            </>
          )}
          <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
            {t('Astryum prepares unsigned payloads and discloses every number; you sign in your own wallet. It never signs or executes on its own.')}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
