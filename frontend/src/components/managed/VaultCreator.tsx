'use client';

/**
 * VaultCreator — el creador de vaults como EXPERIENCIA (fundador 2026-08-30:
 * «tiene que ser muy interactivo y dinámico»), no como formulario de consola.
 *
 * CINCO ESTACIONES y una CARD VIVA. A la izquierda, cada paso decide una cosa
 * (identidad → las dos promesas inmutables → reglas → destinos → revisar y
 * abrir); a la derecha, LA MISMA card que los clientes verán en el catálogo de
 * Earn (CardFace + frameClass de StrategyFan — identidad de producto, no una
 * imitación) se va montando en vivo con cada tecla, y debajo la HOJA DE
 * PROMESAS crece línea a línea según decides. Diseñar mirando exactamente lo
 * que el cliente verá es la parte «dinámica» que un formulario no da.
 *
 * MISMOS RAÍLES, CERO BIFURCACIÓN. Esto no inventa rutas: compone con
 * `prepareCageCreate` (nacimiento, una firma 0xFE) y `prepareCageOrder`
 * (`create-pote`) — exactamente las llamadas de CageConsole, que sigue montada
 * debajo como consola avanzada (dirigir, recuperar, director, dry-run, lista
 * eterna). El backend compone, la wallet firma, la jaula acota (prepare-only).
 *
 * EL TÚNEL (fundador 2026-08-30: «no se puede acceder porque no hay cuentas
 * verificadas... hazme un túnel»): con `account === null` el creador es
 * PLENAMENTE interactivo pero SIN firma — cada control vivo, la card y las
 * promesas también, y el paso final dice en ámbar que el túnel no firma. Lo
 * monta /app/manager?tunnel=1 dentro de <PreviewOnly> (isAdmin del servidor,
 * fail-closed): los fundadores iteran el diseño sin flag, sin wallet y sin
 * chain; nadie más ve nada.
 *
 * LOS DOS INMUTABLES conservan el copy de VaultBirthPlanner palabra por
 * palabra (mismas claves del diccionario): ese texto ya decía lo difícil —
 * qué implica cada valor y que son promesas a clientes que aún no tienes.
 * El planner queda INERTE (absorbido aquí).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  HelpCircle,
  Landmark,
  Loader2,
  Lock,
  ShieldAlert,
  Waves,
} from 'lucide-react';

import { Card, GhostButton, MicroLabel, PrimaryButton } from '../ui/primitives';
import { TokenLogo } from '../ui/TokenLogo';
import { StationProgress } from '../ui/StationProgress';
import { fmtExitWindow, shortAddr } from '../../lib/institutional/format';
import { parseAmountToBase } from '../../lib/institutional/policyCatalog';
import { VAULT_EMBLEMS, VaultEmblemIcon, emblemByKey } from '../../lib/institutional/vaultEmblems';
import { useCommunity } from '../../lib/institutional/useCommunity';
import { setPendingVaultImage } from '../../lib/institutional/pendingVaultImage';
import { readManagerCredentialStatus } from '../../lib/xrpl/credentialsApi';
import { venueIdentity } from '../../lib/institutional/venueIdentity';

import { CardFace, frameClass } from '../earn/StrategyFan';
import { useT } from '../../i18n/LanguageProvider';
import {
  CouncilOrderInFlightConfirm,
  CouncilOrderServerWarnings,
  StaleOrderLockNote,
  XamanSignBlockedNote,
  XamanSingleSign,
  ReadFailureNotice,
  useStaleOrderLock,
} from '../xrpl/XamanSingleSign';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { startPending } from '../../lib/settlement/settlement';
import { notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { isRetryableReadFailure, refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { ManagerAvatar, managerOf, withProfile } from './managerIdentity';
import {
  getCageOf,
  mayConfirmAnotherOrder,
  listRegistryVenues,
  prepareCageCreate,
  prepareCageOrder,
  relayCouncilOrder,
  sameOrderMinutesAgo,
  type CageBirthHandoff,
  type CageOrderPrepared,
  type CageSummary,
  type RegistryVenue,
  type VaultImageKind,
} from '../../lib/institutional/api';

/** Los topes del contrato, los mismos que el planner declaraba. */
const MAX_COOLDOWN_H = 30 * 24;
const MAX_BUFFER_PCT = 50;
const MAX_PAYEE_BPS = 2000;
/** Toda jaula de esta factory trabaja en FXRP (6 decimales) — como la consola. */
const ASSET_DECIMALS = 6;
const ASSET_SYMBOL = 'FXRP';
/** El ejemplo con números redondos del planner: el porcentaje dicho como dinero. */
const EXAMPLE = 100000;

/**
 * EL SÍMBOLO SE DERIVA DEL NOMBRE, no se teclea (fundador 10-sep: «nada de
 * texto»). Tres variantes honestas a partir de las palabras del nombre, con
 * el activo detrás para que se lea qué hay dentro (WT + FXRP = WTFXRP), y se
 * eligen como fichas. Siempre A–Z0–9, de 2 a 8 caracteres — lo que admite el
 * token de participaciones.
 */
function deriveShareSymbols(name: string, asset: string): string[] {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const clamp = (x: string) => x.slice(0, 8);
  const initials = words.map((w) => w[0]).join('');
  const raw = [
    clamp(initials.slice(0, 8 - asset.length) + asset),
    clamp(words[0].slice(0, 8 - asset.length) + asset),
    clamp(words.join('').slice(0, 8 - asset.length) + asset),
    clamp(initials.length >= 2 ? initials : words[0].slice(0, 4)),
  ];
  return [...new Set(raw)].filter((x) => x.length >= 2);
}

/**
 * EL BORRADOR (fundador 11-sep: «parece que no se guarda el vault que estoy
 * creando»): el creador vive dentro de una estación que se desmonta al
 * cambiar de estación, plegar la ventana o recargar — y con él se iba todo
 * lo tecleado. El borrador se guarda por cuenta en localStorage a cada
 * cambio y se restaura al volver; se borra cuando la orden queda firmada.
 * Nunca guarda nada firmado ni ninguna clave: son preferencias de un formulario.
 */
interface CreatorDraft {
  step: number;
  name: string;
  symbolPick: number;
  cooldownH: number;
  bufferPct: number;
  capHuman: string;
  payeeCapBps: number;
  include: Record<string, boolean>;
  imageKind: VaultImageKind;
  imageEmblem: string | null;
}
const draftKey = (account: string) => `astryum:vault-draft:${account}`;
function readDraft(account: string | null): Partial<CreatorDraft> {
  if (!account || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(draftKey(account));
    return raw ? (JSON.parse(raw) as Partial<CreatorDraft>) : {};
  } catch {
    return {};
  }
}

type StepId = 'identity' | 'promises' | 'rules' | 'venues' | 'review';
const STEPS: StepId[] = ['identity', 'promises', 'rules', 'venues', 'review'];

type CageRead =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'unreadable' }
  | { kind: 'ok'; cage: CageSummary };



function kindLabel(kind: RegistryVenue['kind']): string {
  return kind === 'compoundv2' ? 'Compound v2' : kind === 'erc4626queued' ? 'ERC-4626 queued' : 'ERC-4626';
}

/** El deslizador de la casa, con su lectura al lado — heredado del planner. */
function Slider({
  value,
  onChange,
  max,
  step,
  label,
  reading,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
  step: number;
  label: string;
  reading: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-ink/45">{label}</span>
        <span className="font-mono text-sm text-ink">{reading}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[hsl(var(--volt))]"
      />
    </div>
  );
}

/**
 * Cuando el creador vive DENTRO de otro raíl (la estación «Primer vault» del
 * alta), sus bordes se cosen al raíl anfitrión: el «Atrás» del primer paso va a
 * la estación anterior y el último paso ofrece la siguiente. Así hay UN pie de
 * navegación en pantalla, no dos (fundador 8-sep: «el proceso es tedioso y
 * repetitivo» — dos wizards anidados, cada uno con su fila de botones, eran la
 * mitad de esa sensación).
 */
export interface VaultCreatorEdgeNav {
  prevLabel: string;
  onPrev: () => void;
  nextLabel: string;
  onNext: () => void;
}

export function VaultCreator({
  account,
  onOpened,
  embedded = false,
  edgeNav,
  onBlockedChange,
}: {
  /** La cuenta XRPL del gestor — o null: el TÚNEL (interactivo, sin firma). */
  account: string | null;
  /** El pote quedó abierto (orden relayada): el anfitrión puede recargar. */
  onOpened?: () => void;
  /** Sin tarjeta ni cabecera propias: el anfitrión ya dice dónde estás. */
  embedded?: boolean;
  /** Los bordes del raíl anfitrión (ver VaultCreatorEdgeNav). */
  edgeNav?: VaultCreatorEdgeNav;
  /**
   * `true` mientras una firma de Xaman de este creador no se puede soltar (QR
   * vivo, confirmando, sin confirmar): el anfitrión esconde su «Close», que
   * desmontaría el creador con la orden viva en el móvil.
   */
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const { t } = useT();
  const reduce = useReducedMotion() ?? false;
  const settlement = useSettlement();
  const tunnel = account === null;

  // Borrador por cuenta: se lee UNA vez al montar (lazy) y se escribe a cada cambio.
  const draft = useMemo(() => readDraft(account), [account]);
  const [step, setStep] = useState(draft.step ?? 0);
  // 1 · identidad
  const [name, setName] = useState(draft.name ?? '');
  // El símbolo: una de las variantes derivadas del nombre (índice), jamás texto libre.
  const symbolOptions = useMemo(() => deriveShareSymbols(name, ASSET_SYMBOL), [name]);
  const [symbolPick, setSymbolPick] = useState(draft.symbolPick ?? 0);
  const symbol = symbolOptions[Math.min(symbolPick, Math.max(0, symbolOptions.length - 1))] ?? '';
  // 2 · las dos promesas inmutables
  const [cooldownH, setCooldownH] = useState(draft.cooldownH ?? 72);
  const [bufferPct, setBufferPct] = useState(draft.bufferPct ?? 10);
  // 3 · reglas
  const [capHuman, setCapHuman] = useState(draft.capHuman ?? '');
  const [payeeCapBps, setPayeeCapBps] = useState(draft.payeeCapBps ?? MAX_PAYEE_BPS);
  // 4 · destinos
  const [include, setInclude] = useState<Record<string, boolean>>(draft.include ?? {});
  // 1b · LA IMAGEN de la carta (fundador 10-sep: «el panel tiene que ser mucho
  // más personalizable»): emblema de la casa, tu foto, o el interrogante. Se
  // enseña en la card viva ya, y se aplica al pote en cuanto exista (la mesa
  // la recoge de pendingVaultImage: la dirección no se conoce al elegir).
  const [imageKind, setImageKind] = useState<VaultImageKind>(draft.imageKind ?? 'profile');
  const [imageEmblem, setImageEmblem] = useState<string | null>(draft.imageEmblem ?? null);
  useEffect(() => {
    if (!account) return;
    try {
      const d: CreatorDraft = { step, name, symbolPick, cooldownH, bufferPct, capHuman, payeeCapBps, include, imageKind, imageEmblem };
      window.localStorage.setItem(draftKey(account), JSON.stringify(d));
    } catch { /* sin memoria no hay borrador — el formulario sigue */ }
  }, [account, step, name, symbolPick, cooldownH, bufferPct, capHuman, payeeCapBps, include, imageKind, imageEmblem]);
  // La puerta del ledger (título de gestor) — se lee ANTES de dejar componer la
  // orden: el backend la exige en create-pote igual que en la jaula.
  const [gateBlocked, setGateBlocked] = useState(false);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    readManagerCredentialStatus(account)
      .then((st) => { if (alive) setGateBlocked(st.gate === 'enabled' && !st.ok); })
      .catch(() => undefined); // sin lectura no se bloquea: el backend dirá que no si toca
    return () => { alive = false; };
  }, [account]);
  const { actors } = useCommunity();

  // Lecturas de chain — reales con cuenta; el túnel simula «sin jaula».
  const [cageRead, setCageRead] = useState<CageRead>(tunnel ? { kind: 'none' } : { kind: 'loading' });
  const [registry, setRegistry] = useState<RegistryVenue[] | null>(null);

  // 5 · abrir — los MISMOS handoffs que la consola.
  const [busy, setBusy] = useState(false);
  // it. 21 (§3.5): the refusal keeps the fields a WAIT needs — its code and the
  // seconds the server asked for — so «try again» can say when, and be a button.
  const [refusal, setRefusal] = useState<{ error: string; detail?: string; code?: string; retryAfterSeconds?: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [amountXrp, setAmountXrp] = useState('2');
  const [birth, setBirth] = useState<CageBirthHandoff | null>(null);
  const [order, setOrder] = useState<CageOrderPrepared | null>(null);
  // 409 COUNCIL_ORDER_IN_FLIGHT (it.13): componer al lado de una orden en vuelo
  // es una confirmación explícita, jamás un reintento mudo.
  const [inFlight, setInFlight] = useState<{ detail?: string; code?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);
  /**
   * it.14 (R2 2.3): la orden de create-pote quedó 'stale' y su destino dice que
   * una hermana ya salió (o no se pudo comprobar). «Prepare the order» se
   * apaga hasta que la persona confirma — decirlo dentro de la tarjeta de firma
   * no impedía que este creador compusiera la segunda bóveda.
   */
  const staleLock = useStaleOrderLock();
  // XamanSingleSign dice cuándo su petición ya no se puede soltar (QR vivo,
  // confirmando, sin confirmar). Mientras tanto el «Cancel», la navegación de
  // pasos y el «Close» del anfitrión se apartan: soltar la orden y prepararla
  // otra vez era la segunda create-pote (11-sep).
  const [birthBlocked, setBirthBlocked] = useState(false);
  const [orderBlocked, setOrderBlocked] = useState(false);
  const signBlocked = birthBlocked || orderBlocked;
  const onBlockedChangeRef = useRef(onBlockedChange);
  onBlockedChangeRef.current = onBlockedChange;
  useEffect(() => {
    onBlockedChangeRef.current?.(signBlocked);
  }, [signBlocked]);
  useEffect(() => () => onBlockedChangeRef.current?.(false), []);
  // La ESPERA del nacimiento (fundador 11-sep): la orden firmada tarda 2–5 min
  // (XRPL → FDC → jaula). Antes se releía UNA vez a los 30 s y nada más —
  // el pote nacía minutos después y la pantalla nunca se enteraba. Ahora se
  // relee cada 15 s hasta que la jaula tiene un pote más (tope 10 min), con
  // el tiempo a la vista.
  const [awaiting, setAwaiting] = useState<{ since: number; baseline: number } | null>(null);
  const [awaitSeconds, setAwaitSeconds] = useState(0);
  useEffect(() => {
    if (!awaiting || !account) return;
    let alive = true;
    const t0 = awaiting.since;
    const tickClock = setInterval(() => setAwaitSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    const check = async () => {
      try {
        const r = await getCageOf(account);
        const cage = r.cage && !('unreadable' in r.cage) ? r.cage : null;
        if (alive && cage && (cage.potes?.length ?? 0) > awaiting.baseline) {
          setAwaiting(null);
          setNotice(t('Your vault is born and listed. It appears in Operate now.'));
          try { window.localStorage.removeItem(draftKey(account)); } catch { /* nada */ }
          void loadCage();
          onOpened?.();
          return;
        }
      } catch { /* una lectura fallida no para la espera */ }
      if (alive && Date.now() - t0 > 10 * 60_000) {
        setAwaiting(null);
        setNotice(t('Still not visible after ten minutes. The order is signed and relayed; the proof can take longer — open Operate later and press Refresh. Do not sign it again.'));
      }
    };
    const poll = setInterval(() => void check(), 15_000);
    void check();
    return () => { alive = false; clearInterval(poll); clearInterval(tickClock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, account]);

  const loadCage = useCallback(async () => {
    if (!account) return;
    try {
      const r = await getCageOf(account);
      if (!r.cage) return setCageRead({ kind: 'none' });
      if ('unreadable' in r.cage) return setCageRead({ kind: 'unreadable' });
      setCageRead({ kind: 'ok', cage: r.cage });
    } catch {
      // «No pude leer» no es «no tienes jaula».
      setCageRead((prev) => (prev.kind === 'ok' ? prev : { kind: 'unreadable' }));
    }
  }, [account]);

  useEffect(() => {
    void loadCage();
  }, [loadCage]);

  useEffect(() => {
    listRegistryVenues()
      .then((r) => setRegistry(r.venues))
      .catch(() => setRegistry(null));
  }, []);

  /** Dónde puede nacer trabajando el pote: la whitelist activa de Flare (14) y,
   *  si la jaula tiene lista eterna propia, la intersección — la regla de la
   *  consola. Sin jaula todavía (o en el túnel) se enseña la whitelist entera. */
  const candidates = useMemo(() => {
    if (!registry) return [];
    const active = registry.filter((v) => v.status === 'active' && v.chainId === 14 && v.kind !== 'unknown');
    if (cageRead.kind !== 'ok' || cageRead.cage.registryOnly) return active;
    const own = new Set(cageRead.cage.allowedTargets.filter((x) => x.chainId === cageRead.cage.chainId).map((x) => x.target.toLowerCase()));
    return active.filter((v) => own.has(v.target.toLowerCase()));
  }, [registry, cageRead]);

  const chosenVenues = useMemo(
    () => candidates.filter((v) => include[v.target.toLowerCase()]),
    [candidates, include],
  );

  const deployable = Math.round(EXAMPLE * (1 - bufferPct / 100));
  const queuedUsable = cooldownH >= 24;
  const heavyBuffer = bufferPct >= 25;
  // '0' / vacío = sin tope; lo demás pasa por el parser de la casa, que se
  // niega a redondear dinero en silencio (más decimales que el activo = inválido).
  const capText = capHuman.trim();
  const capBase: string | null =
    capText === '' || /^0+(\.0+)?$/.test(capText)
      ? '0'
      : (() => { const u = parseAmountToBase(capText, ASSET_DECIMALS); return u === null ? null : u.toString(); })();
  const identityDone = name.trim().length >= 2 && symbol.trim().length >= 2;

  const mgr = managerOf({ pote: null, councilXrplAddress: account });
  const who = withProfile(mgr, account ? actors.get(account) : null);
  const emblem = emblemByKey(imageEmblem);
  /** La imagen elegida, al tamaño de la carta real (48, cuadrada). */
  const previewImage = (size: number) =>
    imageKind === 'emblem' && emblem ? (
      <VaultEmblemIcon emblem={emblem} size={size} square />
    ) : imageKind === 'none' ? (
      <span className="grid shrink-0 place-items-center rounded-xl border border-dashed border-ink/25 bg-ink/[0.03] text-ink/40" style={{ width: size, height: size }} aria-hidden>
        <HelpCircle style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={1.8} />
      </span>
    ) : who.photo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={who.photo} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
    ) : (
      <ManagerAvatar manager={who} size={size} photo={who.photo} actorKind={who.actorKind} />
    );
  const previewTile = (
    <div className="flex items-center gap-2.5">
      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-tone-warning/35">{previewImage(48)}</div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] py-0.5 pl-0.5 pr-2">
        <TokenLogo symbol={ASSET_SYMBOL} size="sm" />
        <span className="font-mono text-[11px] font-medium text-ink/80">{ASSET_SYMBOL}</span>
      </span>
    </div>
  );

  /** La card DEL CATÁLOGO, montándose en vivo — la misma cara que verá Earn. */
  const previewAction = [
    account ? `${t('Run by')} ${who.name}` : t('Run by you'),
    `${t('exit')} ${fmtExitWindow(cooldownH * 3600, t)}`,
    `${chosenVenues.length} ${chosenVenues.length === 1 ? t('destination') : t('destinations')}`,
  ].join(' · ');

  /** La hoja de promesas: cada línea aparece cuando su paso quedó decidido. */
  const promises: { key: string; text: string; reached: boolean }[] = [
    {
      key: 'exit',
      text: `${t('You would be promising every future client: ask to leave and you wait')} ${fmtExitWindow(cooldownH * 3600, t)}.`,
      reached: step >= 1,
    },
    {
      key: 'floor',
      text: `${t('And this much of the vault stays liquid for that exit, whatever I am doing with the rest:')} ${bufferPct}%.`,
      reached: step >= 1,
    },
    {
      key: 'cap',
      text:
        !capBase || capBase === '0'
          ? t('Any account may hold any size — no per-account cap.')
          : `${t('Max per account')}: ${capHuman.trim()} ${ASSET_SYMBOL}.`,
      reached: step >= 2,
    },
    {
      key: 'cut',
      text:
        payeeCapBps === 0
          ? t('Your cut is capped at zero for ever: every unit of yield capitalizes for depositors.')
          : `${t('Your cut can never exceed')} ${payeeCapBps / 100}% ${t('of the yield — never of the principal.')}`,
      reached: step >= 2,
    },
    {
      key: 'venues',
      text:
        chosenVenues.length === 0
          ? t('It opens with no destinations — each one you propose later waits 30 days before a single token can go there.')
          : `${t('It can only work in the')} ${chosenVenues.length} ${chosenVenues.length === 1 ? t('destination you chose — adding one later takes 30 days.') : t('destinations you chose — adding one later takes 30 days.')}`,
      reached: step >= 3,
    },
  ];

  // ── abrir: los mismos raíles que la consola ────────────────────────────────

  async function prepareBirth() {
    if (!account) return;
    setBusy(true);
    setRefusal(null);
    // El creador nace SIEMPRE siguiendo el registro de Astryum; la lista
    // eterna propia es un caso avanzado y vive en la consola de abajo.
    const res = await prepareCageCreate({ account, amountXrp, allowedTargets: [] });
    setBusy(false);
    if (!res.ok) return setRefusal(res.refusal);
    setBirth(res.data);
  }

  function onBirthSettled(hash: string) {
    if (!birth) return;
    notifyHandoffSigned(birth.memoHex, hash);
    settlement.track(startPending('xrpl-mint', hash));
    setBirth(null);
    setNotice(t('Signed. The network is proving it; your cage will appear here on its own in a couple of minutes.'));
    setTimeout(() => void loadCage(), 90_000);
  }

  async function prepareOpen(opts?: { confirmAnotherOrder?: boolean }) {
    // it.16 (R5 5.5): «Compose it again anyway» has to compose — it used to hit
    // this return and do nothing at all. Opening a pote is never an exit, so the
    // lock still pauses it otherwise (it.16, R3 3.1).
    if (!account || capBase === null) return;
    if (staleLock.blocks('other', { confirmed: opts?.confirmAnotherOrder })) return;
    setBusy(true);
    setRefusal(null);
    setInFlight(null);
    const res = await prepareCageOrder({
      ...(opts?.confirmAnotherOrder ? { confirmAnotherOrder: true } : {}),
      council: account,
      action: 'create-pote',
      params: {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        cooldownSeconds: cooldownH * 3600,
        bufferFloorBps: bufferPct * 100,
        maxPayeeBps: payeeCapBps,
        maxDepositPerUser: capBase,
        initialVenues: chosenVenues.map((v) => ({ target: v.target, kind: v.kind })),
      },
    });
    setBusy(false);
    if (!res.ok) {
      // it. 21 (§2.7): DUPLICATE_CHECK_UNREADABLE lands here too — «we could not
      // check», which is our failure, so it gets a retry beside the confirm.
      if (mayConfirmAnotherOrder(res.refusal) && !opts?.confirmAnotherOrder) {
        return setInFlight({ detail: res.refusal.detail, code: res.refusal.error, minutesAgo: sameOrderMinutesAgo(res.refusal), retryAfterSeconds: res.refusal.retryAfterSeconds ?? null });
      }
      return setRefusal(res.refusal);
    }
    setOrder(res.data);
  }

  function onOrderSettled(hash: string) {
    if (!order) return;
    // Firmada = el borrador muere YA: volver a este paso con el formulario
    // lleno invitaría a firmar la misma bóveda dos veces (11-sep: dos órdenes
    // de create-pote en doce horas).
    if (account) { try { window.localStorage.removeItem(draftKey(account)); } catch { /* nada */ } }
    // La imagen elegida espera al pote (su dirección aún no existe): la mesa la
    // aplica en cuanto lo vea aparecer con este nombre y símbolo.
    if (account) setPendingVaultImage(account, { name: name.trim(), symbol: symbol.trim().toUpperCase(), kind: imageKind, emblem: imageKind === 'emblem' ? imageEmblem ?? undefined : undefined });
    const { orderData } = order.order;
    setOrder(null);
    setNotice(t('Signed. Relaying the proof to Flare…'));
    // El relay contesta {ok:false} en un HTTP de error, no lanza (revisión
    // 10-sep): decir «relayada» sobre un 4xx/5xx era anunciar una bóveda que
    // nunca iba a nacer, con el peaje ya gastado. Se distingue.
    void relayCouncilOrder(hash, orderData).then(
      (r) => {
        if (!r.ok) {
          setRefusal({ error: t('Signed, but the relay refused'), detail: `HTTP ${r.status}${r.detail ? ` — ${r.detail}` : ''}` });
          setNotice('');
          return;
        }
        setNotice(t('Relayed. The cage will execute the order once the proof lands.'));
        setAwaiting({ since: Date.now(), baseline: cageRead.kind === 'ok' ? cageRead.cage.potes.length : 0 });
      },
      (e: unknown) => {
        setRefusal({ error: t('Signed, but the relay did not start'), detail: e instanceof Error ? e.message : String(e) });
        setNotice('');
      },
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const stepLabel: Record<StepId, string> = {
    identity: t('Identity'),
    promises: t('The two promises'),
    rules: t('Rules'),
    venues: t('Destinations'),
    review: t('Review & open'),
  };

  const canAdvance = step !== 0 || identityDone;

  const Shell: ElementType = embedded ? 'div' : Card;
  const shellProps = embedded ? {} : { className: 'p-6' };

  return (
    <Shell {...shellProps}>
      {/* Embebido, la cabecera es la de la estación anfitriona («5/6 · Primer
          vault»): repetirla aquí era un título dentro de un título. */}
      <div className={embedded ? 'hidden' : 'flex items-center gap-2'}>
        <Landmark className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
        <MicroLabel>{t('Create a vault')}</MicroLabel>
        {tunnel && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-tone-warning/40 bg-tone-warning/10 px-2 py-0.5 text-[10px] font-medium text-tone-warning">
            <ShieldAlert className="h-3 w-3" strokeWidth={2} /> {t('Founder tunnel — signing disabled')}
          </span>
        )}
      </div>

      {/* El progreso como BARRA (la regla de la casa desde el 8-sep: nunca
          círculos numerados): atrás libre; adelante solo con nombre y símbolo. */}
      {/* UNA sola barra en pantalla (fundador 11-sep: «se ven dos progress
          bar»): embebido en el alta, la barra de las seis estaciones ya está
          pegada arriba, así que el paso del creador se dice en una línea;
          suelto (el «+» de Operar) no hay otra barra y aquí va la suya. */}
      {embedded ? (
        <p className="flex items-baseline gap-2 text-[12px]" aria-live="polite">
          <span className="font-mono text-[11px] text-volt/80">{step + 1}/{STEPS.length}</span>
          <span className="font-medium text-ink">{stepLabel[STEPS[step]]}</span>
        </p>
      ) : (
        /* LA TIRA (12-sep): arriba, con Atrás/Siguiente dentro — Siguiente
           principal y apagado hasta que el paso vale (nombre y símbolo). */
        <StationProgress
          layout="strip"
          sticky={false}
          className="mt-4"
          stations={STEPS.map((sid, i) => ({ label: stepLabel[sid], done: i < step }))}
          current={step}
          onSelect={(i) => { if (signBlocked) return; if (i <= step || identityDone) setStep(i); }}
          ariaLabel={t('Vault stations')}
          doneWord={t('done')}
          onBack={() => { if (!signBlocked) setStep((s) => Math.max(0, s - 1)); }}
          onNext={step < STEPS.length - 1 ? () => setStep((s) => Math.min(STEPS.length - 1, s + 1)) : undefined}
          nextDisabled={!canAdvance}
          nextReason={t('Name and symbol first — station 1.')}
          nextPrimary
        />
      )}

      {notice ? (
        <p className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] leading-relaxed text-ink/60">{notice}</p>
      ) : null}
      {awaiting ? (
        <p className="mt-2 flex items-center gap-2 rounded-lg border border-volt/25 bg-volt/[0.05] p-2.5 text-[11px] leading-relaxed text-ink/70">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-volt" />
          {t('Waiting for the proof to land on Flare — usually 2 to 5 minutes. This screen checks every 15 seconds; you can leave and come back.')}{' '}
          <span className="font-mono text-ink/50">{Math.floor(awaitSeconds / 60)}:{String(awaitSeconds % 60).padStart(2, '0')}</span>
        </p>
      ) : null}
      {inFlight ? (
        <CouncilOrderInFlightConfirm
          className="mt-3"
          detail={inFlight.detail}
          code={inFlight.code}
          minutesAgo={inFlight.minutesAgo}
          retryAfterSeconds={inFlight.retryAfterSeconds}
          busy={busy}
          onConfirm={() => void prepareOpen({ confirmAnotherOrder: true })}
          onRetry={() => void prepareOpen()}
          onDismiss={() => setInFlight(null)}
        />
      ) : null}

      <StaleOrderLockNote className="mt-3" lock={staleLock.lock} onRelease={staleLock.release} pausing={staleLock.pausing} />
      {refusal ? (
        // it. 21 (§3.5): a read of ours that failed is a wait WITH a button, never
        // a verdict painted as a refusal.
        isRetryableReadFailure(refusal) ? (
          <ReadFailureNotice className="mt-3" refusal={refusal} busy={busy} onRetry={() => void prepareOpen()} />
        ) : (
        // it. 19: a raw server slug is never the headline, and a Spanish `detail`
        // is never quoted under an English one (see CageConsole for the whole note).
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5" role="alert">
          <p className="text-[12px] font-medium text-tone-warning">{refusalHeadline(refusal, t)}</p>
          {serverDetailIfEnglish(refusal.detail) ? (
            <p className="text-[11px] leading-relaxed text-ink/55">{serverDetailIfEnglish(refusal.detail)}</p>
          ) : null}
        </div>
        )
      ) : null}

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ── IZQUIERDA: el paso vivo ── */}
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={reduce ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -14 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {STEPS[step] === 'identity' && (
                <div className="space-y-4">
                  <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
                    {t('The name and the share symbol are what clients see first — on the card, in their wallet, on every receipt.')}
                  </p>
                  <label className="block text-[11px] text-ink/50">
                    {t('Name')}
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value.slice(0, 32))}
                      placeholder={t('e.g. Prudent FXRP yield')}
                      className="mt-1 w-full rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-3 py-2 text-[13px]"
                    />
                  </label>
                  <div>
                    <p className="text-[11px] text-ink/50">{t('Share symbol')}</p>
                    {symbolOptions.length === 0 ? (
                      <p className="mt-1 text-[11px] text-ink/40">{t('Type a name first — the symbol derives from it.')}</p>
                    ) : (
                      <>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {symbolOptions.map((opt, i) => {
                            const on = opt === symbol;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setSymbolPick(i)}
                                aria-pressed={on}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[13px] transition-colors ${on ? 'border-volt/60 bg-volt/[0.08] text-volt' : 'border-ink/10 text-ink/70 hover:border-ink/30'}`}
                              >
                                <TokenLogo symbol={ASSET_SYMBOL} size="xs" />
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[11px] text-ink/40">{t('Derived from the name — pick the one you prefer.')}</p>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink/40">
                    {t('Depositors receive shares under this symbol — standard tokens in their own wallet, never in yours.')}
                  </p>

                  {/* LA IMAGEN de la carta: emblema, tu foto o ninguna — con la
                      carta viva a la derecha reflejándola al instante. */}
                  <div>
                    <p className="text-[11px] text-ink/50">{t('Vault image')}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink/40">{t('Choose the image clients will see on the card — you can change it later from Operate.')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {VAULT_EMBLEMS.map((e) => {
                        const on = imageKind === 'emblem' && imageEmblem === e.key;
                        return (
                          <button key={e.key} type="button" onClick={() => { setImageKind('emblem'); setImageEmblem(e.key); }} aria-pressed={on} title={e.key} className={`relative grid h-11 w-11 place-items-center rounded-xl border transition-colors ${on ? 'border-volt/60 bg-volt/[0.08]' : 'border-ink/10 hover:border-ink/30'}`}>
                            <VaultEmblemIcon emblem={e} size={26} />
                            {on ? <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-volt p-0.5 text-volt-ink" strokeWidth={3} /> : null}
                          </button>
                        );
                      })}
                      <button type="button" onClick={() => setImageKind('profile')} aria-pressed={imageKind === 'profile'} title={t('My profile photo')} className={`relative grid h-11 w-11 place-items-center rounded-xl border transition-colors ${imageKind === 'profile' ? 'border-volt/60 bg-volt/[0.08]' : 'border-ink/10 hover:border-ink/30'}`}>
                        <ManagerAvatar manager={who} size={26} photo={who.photo} actorKind={who.actorKind} />
                        {imageKind === 'profile' ? <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-volt p-0.5 text-volt-ink" strokeWidth={3} /> : null}
                      </button>
                      <button type="button" onClick={() => setImageKind('none')} aria-pressed={imageKind === 'none'} title={t('No image')} className={`relative grid h-11 w-11 place-items-center rounded-xl border transition-colors ${imageKind === 'none' ? 'border-volt/60 bg-volt/[0.08]' : 'border-ink/10 hover:border-ink/30'}`}>
                        <HelpCircle className="h-5 w-5 text-ink/40" strokeWidth={1.6} />
                        {imageKind === 'none' ? <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-volt p-0.5 text-volt-ink" strokeWidth={3} /> : null}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {STEPS[step] === 'promises' && (
                <div className="space-y-6">
                  <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink/55">
                    {t('These two are set when the vault is born and nobody moves them afterwards — not you, not the council, not an amendment. Everything else about a vault can change; these cannot.')}
                  </p>
                  {/* AJUSTES RÁPIDOS: tres perfiles honestos como punto de partida;
                      los deslizadores siguen mandando. */}
                  <div>
                    <p className="text-[11px] text-ink/50">{t('Presets')}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {([
                        { key: 'liquid', label: t('Liquid'), hours: 0, buffer: 20, hint: t('Clients leave the moment they ask; a fifth stays liquid for that.') },
                        { key: 'balanced', label: t('Balanced'), hours: 72, buffer: 10, hint: t('Three days to leave; a tenth stays liquid.') },
                        { key: 'patient', label: t('Patient'), hours: 168, buffer: 5, hint: t('A week to leave; a twentieth stays liquid — room for slower venues.') },
                      ] as const).map((pz) => {
                        const on = cooldownH === pz.hours && bufferPct === pz.buffer;
                        return (
                          <button key={pz.key} type="button" onClick={() => { setCooldownH(pz.hours); setBufferPct(pz.buffer); }} aria-pressed={on} title={pz.hint} className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${on ? 'border-volt/50 bg-volt/[0.08] text-volt' : 'border-ink/10 text-ink/65 hover:border-ink/30'}`}>
                            {pz.label} <span className="font-mono text-[10px] text-ink/45">· {fmtExitWindow(pz.hours * 3600, t)} · {pz.buffer}%</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Slider
                      label={t('Exit window')}
                      value={cooldownH}
                      onChange={setCooldownH}
                      max={MAX_COOLDOWN_H}
                      step={12}
                      reading={fmtExitWindow(cooldownH * 3600, t)}
                    />
                    <div className="mt-2 flex items-start gap-2">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/30" strokeWidth={1.8} />
                      <p className="max-w-[62ch] text-[12px] leading-relaxed text-ink/45">
                        {cooldownH === 0
                          ? t('Clients leave the moment they ask. In exchange you can only use venues that give the capital back immediately — anything that exits through a queue is off your menu.')
                          : queuedUsable
                            ? t('Long enough to unwind a venue that exits through a queue, so those stay available to you. Your clients wait this long after asking to leave.')
                            : t('Under a day is an awkward middle: your clients still wait, and it is not enough to unwind a venue that exits through a queue.')}
                      </p>
                    </div>
                  </div>
                  <div>
                    <Slider
                      label={t('Untouchable floor')}
                      value={bufferPct}
                      onChange={setBufferPct}
                      max={MAX_BUFFER_PCT}
                      step={1}
                      reading={`${bufferPct}%`}
                    />
                    {/* LA BARRA DEL CAPITAL: el porcentaje visto como dinero,
                        moviéndose con el dedo — suelo líquido vs capital que
                        trabaja. layout de framer: el ancho cambia con muelle. */}
                    <div className="mt-3 flex h-9 w-full overflow-hidden rounded-lg border border-ink/10">
                      <motion.div
                        layout
                        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                        style={{ width: `${Math.max(bufferPct, 3)}%` }}
                        className="grid place-items-center bg-tone-warning/25 font-mono text-[10px] text-ink/70"
                      >
                        {bufferPct}%
                      </motion.div>
                      <motion.div
                        layout
                        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                        className="grid flex-1 place-items-center bg-volt/15 font-mono text-[10px] text-ink/70"
                      >
                        {t('works')} · {deployable.toLocaleString()}
                      </motion.div>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/30" strokeWidth={1.8} />
                      <p className="max-w-[62ch] text-[12px] leading-relaxed text-ink/45">
                        {`${t('Of every')} ${EXAMPLE.toLocaleString()} ${t('in the vault, you could put')} ${deployable.toLocaleString()} ${t('to work — the rest always stays liquid so a client leaving never waits on your timing.')}`}
                        {heavyBuffer ? ` ${t('At this level it stops being prudence and starts being a quarter of the vault that never works.')}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {STEPS[step] === 'rules' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-[11px] text-ink/50">
                      {t('Max per account')} ({ASSET_SYMBOL}, {t('0 = no cap')})
                      <input
                        value={capHuman}
                        onChange={(e) => setCapHuman(e.target.value)}
                        placeholder="0"
                        className="mt-1 w-full rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-3 py-2 font-mono text-[13px]"
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[['', t('No cap')], ['1000', '1 000'], ['10000', '10 000'], ['100000', '100 000']].map(([v, label]) => (
                        <button key={label} type="button" onClick={() => setCapHuman(v)} aria-pressed={capHuman.trim() === v} className={`rounded-lg border px-2 py-0.5 text-[11px] transition-colors ${capHuman.trim() === v ? 'border-volt/50 bg-volt/[0.08] text-volt' : 'border-ink/10 text-ink/60 hover:border-ink/30'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-ink/45">
                      {capBase === null
                        ? t('The per-account cap must be a number (0 = no cap).')
                        : capBase === '0'
                          ? t('No cap: one account could hold the whole vault. A cap keeps any single client from dominating your exits.')
                          : t('Entries only; exits are never blocked')}
                    </p>
                  </div>
                  <div>
                    <Slider
                      label={t('Ceiling of your cut (set at birth)')}
                      value={payeeCapBps}
                      onChange={setPayeeCapBps}
                      max={MAX_PAYEE_BPS}
                      step={50}
                      reading={`${payeeCapBps / 100}%`}
                    />
                    <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-ink/45">
                      {t('The actual cut is set later, in the console, and can move — but never above this ceiling, and only ever on the yield, not the principal. Zero here means zero for ever.')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[0, 500, 1000, 2000].map((bps) => (
                        <button key={bps} type="button" onClick={() => setPayeeCapBps(bps)} aria-pressed={payeeCapBps === bps} className={`rounded-lg border px-2 py-0.5 text-[11px] transition-colors ${payeeCapBps === bps ? 'border-volt/50 bg-volt/[0.08] text-volt' : 'border-ink/10 text-ink/60 hover:border-ink/30'}`}>
                          {bps / 100}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {STEPS[step] === 'venues' && (
                <div className="space-y-3">
                  <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink/55">
                    {t('Initial venues — from the Astryum registry (no-liquidation whitelist); more can be proposed later with a 30-day wait')}.
                  </p>
                  {registry === null ? (
                    <p className="text-[12px] leading-relaxed text-ink/50">
                      {t('Could not read the registry right now — you can still open the pote without venues and propose them later.')}
                    </p>
                  ) : candidates.length === 0 ? (
                    <p className="text-[12px] text-ink/50">{t('No active venue on this chain yet.')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {candidates.map((v) => {
                        const on = Boolean(include[v.target.toLowerCase()]);
                        const id = venueIdentity(v.target);
                        return (
                          <li key={v.target}>
                            <button
                              type="button"
                              onClick={() => setInclude({ ...include, [v.target.toLowerCase()]: !on })}
                              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                                on ? 'border-volt/40 bg-volt/[0.06]' : 'border-ink/10 hover:border-ink/25'
                              }`}
                            >
                              <span
                                className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                                  on ? 'border-volt bg-volt text-volt-ink' : 'border-ink/25'
                                }`}
                              >
                                {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                              </span>
                              {id.asset ? <TokenLogo symbol={id.asset} size="xs" /> : null}
                              {/* Formato Earn: nombre del protocolo · producto; la
                                  dirección abreviada debajo, discreta. */}
                              {id.known ? (
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-ink">
                                    {id.name}{id.product ? <span className="text-ink/50"> · {id.product}</span> : null}
                                  </span>
                                  <span className="block truncate font-mono text-[10px] text-ink/35">{shortAddr(v.target)}</span>
                                </span>
                              ) : (
                                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink/70">{shortAddr(v.target)}</span>
                              )}
                              <span className="ml-auto shrink-0 rounded-full border border-ink/10 px-1.5 py-0.5 text-[10px] text-ink/45">
                                {kindLabel(v.kind)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {STEPS[step] === 'review' && (
                <div className="space-y-4">
                  <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink/60">
                    {t('Read the promise sheet beside the card. Neither promise can be taken back.')}
                  </p>

                  {tunnel ? (
                    <div className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-4">
                      <p className="max-w-[62ch] text-[12px] leading-relaxed text-ink/65">
                        {t('Founder tunnel: this is exactly what a manager will sign, but the tunnel does not sign — connect a manager account on the desk to open it for real.')}
                      </p>
                    </div>
                  ) : cageRead.kind === 'loading' ? (
                    <p className="flex items-center gap-2 text-[12px] text-ink/45">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Reading your cage…')}
                    </p>
                  ) : cageRead.kind === 'unreadable' ? (
                    <p className="max-w-[62ch] text-[12px] leading-relaxed text-tone-warning/80">
                      {t('Could not read the cage right now. This says nothing about whether it exists — try again in a moment.')}
                    </p>
                  ) : cageRead.kind === 'none' && !birth ? (
                    <div className="space-y-3 rounded-xl border border-ink/10 p-4">
                      <p className="max-w-[62ch] text-[12px] leading-relaxed text-ink/55">
                        {t('First, one signature births your cage — a command contract that obeys only your account and never holds capital. It follows the Astryum registry; an eternal own-list is the advanced path in the console below.')}
                      </p>
                      <label className="block text-[11px] text-ink/50">
                        {t('Carrier (XRP) — what it mints stays in your Flare account to pay pote creation fees')}
                        <input
                          value={amountXrp}
                          onChange={(e) => setAmountXrp(e.target.value)}
                          className="mt-1 w-32 rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[12px]"
                        />
                      </label>
                      <PrimaryButton onClick={() => void prepareBirth()} disabled={busy}>
                        {busy ? <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> : null}
                        {t('Prepare the birth')}
                      </PrimaryButton>
                      <p className="text-[10px] leading-relaxed text-ink/40">
                        {t('If the birth refuses, anchor the council constitution first — the card above this creator does it.')}
                      </p>
                    </div>
                  ) : null}

                  {!tunnel && birth && account ? (
                    <div className="space-y-3">
                      <ul className="space-y-1">
                        {birth.disclosure.lines.map((l, i) => (
                          <li key={i} className="text-[11px] leading-relaxed text-ink/50">{l}</li>
                        ))}
                      </ul>
                      <XamanSingleSign
                        txjson={birth.xrplPayment}
                        title={t('Birth of the cage')}
                        // The hash the moment Xaman signs (it.13): the backend remembers it
                        // (202 PENDING_LEDGER) so the seat is not expired under a signed 0xFE.
                        onSigned={(hash) => notifyHandoffSigned(birth.memoHex, hash)}
                        onSettled={onBirthSettled}
                        onBlockedChange={setBirthBlocked}
                        onCancelled={() => setBirth(null)}
                      />
                      {birthBlocked ? (
                        <XamanSignBlockedNote />
                      ) : (
                        <button type="button" onClick={() => setBirth(null)} className="text-[11px] text-ink/50">
                          {t('Cancel')}
                        </button>
                      )}
                    </div>
                  ) : null}

                  {!tunnel && cageRead.kind === 'ok' && !order ? (
                    <div className="space-y-2">
                      {gateBlocked ? (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-tone-warning">
                          {t('The ledger gate requires your manager title before opening a vault — finish the Title station first.')}
                        </p>
                      ) : null}
                      <PrimaryButton
                        onClick={() => void prepareOpen()}
                        disabled={busy || !identityDone || capBase === null || gateBlocked || staleLock.blocks('other')}
                        disabledReason={!identityDone ? t('Name and symbol first — station 1.') : gateBlocked ? t('The ledger gate requires your manager title before opening a vault — finish the Title station first.') : undefined}
                      >
                        {busy ? <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> : null}
                        {t('Prepare the order')}
                      </PrimaryButton>
                      <p className="text-[10px] leading-relaxed text-ink/40">
                        {cageRead.cage.freePotesLeft > 0
                          ? t('This pote costs only gas.')
                          : t('The free potes are used up: this one pays the creation fee from your Flare account, straight to the Astryum treasury.')}
                      </p>
                    </div>
                  ) : null}

                  {!tunnel && order && account ? (
                    <div className="space-y-3">
                      <p className="text-[12px]">{order.order.summary}</p>
                      {order.disclosure.note ? (
                        <p className="text-[11px] leading-relaxed text-ink/50">{order.disclosure.note}</p>
                      ) : null}
                      <CouncilOrderServerWarnings
                        recoveryWarning={order.recoveryWarning}
                        inFlightWarning={order.inFlightWarning}
                        duplicateWarning={order.duplicateWarning}
                      />
                      <XamanSingleSign
                        txjson={order.xrplTx}
                        title={order.order.summary}
                        onSettled={onOrderSettled}
                        onBlockedChange={setOrderBlocked}
                        onCancelled={() => setOrder(null)}
                        // it.14: una hermana de esta orden ya salió → el creador
                        // deja de componer hasta que la persona lo confirme.
                        onStaleFate={staleLock.report}
                      />
                      {/* Cancelled in Xaman → the order is dropped; the form
                          draft stays, so «Prepare the order» is honest again. */}
                      {orderBlocked ? (
                        <XamanSignBlockedNote />
                      ) : (
                        <button type="button" onClick={() => setOrder(null)} className="text-[11px] text-ink/50">
                          {t('Cancel')}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {embedded ? (
            /* Embebido en la mesa del gestor: el creador navega SUS pasos por
               dentro (atrás libre; adelante cuando el paso vale) y las
               estaciones las lleva el pie del anfitrión. Los bordes cosidos
               (edgeNav) siguen disponibles si un anfitrión los pasa. */
            <div className="mt-6 flex items-center justify-between gap-2">
              {step === 0 && edgeNav ? (
                <GhostButton onClick={edgeNav.onPrev} disabled={signBlocked}>
                  <ArrowLeft className="mr-1 inline h-3.5 w-3.5" /> {edgeNav.prevLabel}
                </GhostButton>
              ) : (
                <GhostButton onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || signBlocked}>
                  <ArrowLeft className="mr-1 inline h-3.5 w-3.5" /> {t('Back')}
                </GhostButton>
              )}
              {step < STEPS.length - 1 ? (
                <PrimaryButton
                  onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                  disabled={!canAdvance}
                  disabledReason={t('Name and symbol first — station 1.')}
                >
                  {t('Next')} <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </PrimaryButton>
              ) : edgeNav ? (
                <GhostButton onClick={edgeNav.onNext} disabled={signBlocked}>
                  {edgeNav.nextLabel} <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </GhostButton>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── DERECHA: la card viva + la hoja de promesas ── */}
        <div className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72">
          <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.14em] text-ink/35">
            {t('What clients will see in Earn')}
          </p>
          <div className={`h-72 w-full max-w-[13rem] ${frameClass(true, false)}`}>
            <CardFace
              card={{
                asset: ASSET_SYMBOL,
                title: name.trim() || t('Your vault'),
                action: previewAction,
                icon: <ManagerAvatar manager={who} size={22} photo={who.photo} actorKind={who.actorKind} />,
                tile: previewTile,
                accent: 'border-tone-warning/35',
                blocked: false,
                market: undefined,
              }}
              chip={
                <span className="flex flex-wrap items-center gap-1">
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-0.5 text-[10px] text-ink/60">
                    <ManagerAvatar manager={who} size={14} photo={who.photo} actorKind={who.actorKind} />
                    <span className="truncate">{who.name}</span>
                  </span>
                  {symbol.trim() ? (
                    <span className="inline-flex items-center rounded-full border border-ink/10 px-1.5 py-0.5 font-mono text-[10px] text-ink/50">
                      {symbol.trim()}
                    </span>
                  ) : null}
                </span>
              }
              t={t}
              big={false}
            />
          </div>

          {/* La hoja de promesas, creciendo línea a línea. */}
          <div className="mt-4 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-ink/35">
              <Lock className="h-3 w-3" strokeWidth={2} /> {t('The promise sheet')}
            </p>
            <AnimatePresence initial={false}>
              {promises.filter((p) => p.reached).map((p) => (
                <motion.p
                  key={p.key}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-1.5 text-[11px] leading-relaxed text-ink/55"
                >
                  {p.text}
                </motion.p>
              ))}
            </AnimatePresence>
            {promises.every((p) => !p.reached) ? (
              <p className="text-[11px] leading-relaxed text-ink/35">
                {t('Each station you pass writes its promise here.')}
              </p>
            ) : null}
            {step >= 1 ? (
              <p className="mt-2 border-t border-ink/5 pt-2 text-[10px] leading-relaxed text-ink/40">
                {t('Neither promise can be taken back.')}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}

export default VaultCreator;
