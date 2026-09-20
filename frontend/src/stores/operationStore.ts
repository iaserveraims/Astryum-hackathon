import { create } from 'zustand';
import { toast } from 'sonner';
import type { DemoVault } from '@/components/earn/FlareDemoEarn';
import type { PaActionKind, PaLegs, PaHolder } from '@/components/positions/PaActionsModal';
import { getStoredLang } from '@/i18n/LanguageProvider';
import { useAuthStore } from './authStore';
import { invalidatePortfolioCache } from '@/lib/portfolioMerge';
import { translate } from '@/i18n/dict';

/**
 * operationStore v2 — HASTA TRES operaciones vivas a la vez (el Legacy cuenta como card).
 *
 * El modelo: una lista de operaciones montadas (cada una conserva TODO su
 * estado — importes, review, ceremonia) y UNA activa desplegada (flotante o
 * anclada — el dock sigue siendo un solo hueco). Las demás esperan como
 * píldoras en fila en el borde inferior, estilo barra de tareas. Abrir una
 * nueva despliega la nueva y manda la activa a su píldora; restaurar una
 * píldora intercambia. La CUARTA no entra: aviso amable (toast) y la lista
 * queda como está — jamás se cierra sola una operación con estado.
 *
 * Identidad: abrir la MISMA operación dos veces (misma estrategia, misma
 * posición, la constitución) no duplica — restaura la existente.
 */

export const MAX_OPS = 3;

/** Clave de siembra del agente — monótona por diseño (ver openAgentOp). */
let seedKeySeq = 0;
function nextSeedKey(): number {
  seedKeySeq += 1;
  return seedKeySeq;
}

export type HostedOp =
  | { id: string; kind: 'vault'; vault: DemoVault; initial?: { amount?: string; ratio?: string; targetHF?: string } }
  | { id: string; kind: 'pa'; owner: string; legs: PaLegs; holders?: PaHolder[]; action: PaActionKind; onChanged: () => void }
  | { id: string; kind: 'cage'; account: string; vaultTitle: string }
  | { id: string; kind: 'constitute' }
  | { id: string; kind: 'reinforce'; account: string }
  | { id: string; kind: 'govern'; account: string; label?: string | null; tab?: 'proposals' }
  /** La MESA DEL GESTOR como ventana anclable.
   */
  | { id: string; kind: 'manager' }
  /** El alta del gestor y la del exchange como ceremonias: la misma
   *  ventana que Constituir, una sola vez cada una. */
  /** `jump`: a one-shot order to land on a station (renew the title from
   *  Operate). Not persisted — a restored window lands where the ledger says. */
  | { id: string; kind: 'manager-setup'; jump?: { step: number; nonce: number } | null }
  | { id: string; kind: 'exchange-setup' }
  | { id: string; kind: 'agent'; seed?: string; seedKey?: number; restoreId?: string; restoreKey?: number };

/** Omit distributivo: conserva la discriminación por `kind` (el Omit plano
 *  sobre la unión la colapsa y `op.vault` deja de tipar). */
type OpInput = HostedOp extends infer O ? (O extends HostedOp ? Omit<O, 'id'> : never) : never;

/** La identidad natural de cada operación — lo que evita duplicados. */
function identityOf(op: OpInput): string {
  switch (op.kind) {
    case 'vault':
      return `vault:${op.vault.kind}`;
    case 'pa':
      return `pa:${op.action}:${op.owner}`;
    case 'cage':
      return `cage:${op.account}:${op.vaultTitle}`;
    case 'constitute':
      return 'constitute';
    case 'reinforce':
      return `reinforce:${op.account}`;
    case 'govern':
      return `govern:${op.account}`;
    case 'manager':
      return 'manager';
    case 'manager-setup':
      return 'manager-setup';
    case 'exchange-setup':
      return 'exchange-setup';
    case 'agent':
      return 'agent';
  }
}

function fullToast() {
  const t = (s: string) => translate(getStoredLang(), s);
  toast(t('Three operations are already open'), {
    description: t('Close one from its pill at the bottom and try again — none is closed for you, they all hold live state.'),
  });
}

interface OperationState {
  ops: HostedOp[];
  /** La desplegada; null = todas en píldora (o ninguna). */
  activeId: string | null;
  /** Abre (o restaura si ya existe). false = tope de tres alcanzado. */
  open: (op: OpInput) => boolean;
  close: (id: string) => void;
  activate: (id: string) => void;
  /** La activa se pliega a su píldora. */
  minimizeActive: () => void;
  openVaultOp: (vault: DemoVault, initial?: { amount?: string; ratio?: string; targetHF?: string }) => boolean;
  openPaOp: (op: { owner: string; legs: PaLegs; holders?: PaHolder[]; action: PaActionKind; onChanged: () => void }) => boolean;
  openCageOp: (op: { account: string; vaultTitle: string }) => boolean;
  openConstituteOp: () => boolean;
  openReinforceOp: (account: string) => boolean;
  /** Gobernar un Legacy en burbuja anclable. */
  openGovernOp: (account: string, label?: string | null, tab?: 'proposals') => boolean;
  /** La mesa del gestor en burbuja anclable. */
  openManagerOp: () => boolean;
  /** Las ceremonias de configuración: alta del gestor y del exchange. */
  openManagerSetupOp: (jump?: { step: number; nonce: number }) => boolean;
  openExchangeSetupOp: () => boolean;
  openAgentOp: (seed?: string) => boolean;
  /** Abre el agente restaurado a un chat del historial (botón del héroe). */
  openAgentRestore: (chatId: string) => boolean;
}

export const useOperationStore = create<OperationState>((set, get) => ({
  ops: [],
  activeId: null,
  open: (op) => {
    const id = identityOf(op);
    const existing = get().ops.find((o) => o.id === id);
    if (existing) {
      // Misma identidad: restaurar, pero con el payload NUEVO — así un
      // callback onChanged fresco sustituye al viejo y unos inputs
      // precompilados distintos reabren la estrategia limpia (contrato de
      // remount de siempre, vía la key interna del host).
      set((s2) => ({
        ops: s2.ops.map((o) => (o.id === id ? ({ ...op, id } as HostedOp) : o)),
        activeId: id,
      }));
      return true;
    }
    // El AGENTE no cuenta para el tope — el máximo real de píldoras es
    // tres estrategias más el agente.
    const strategyCount = get().ops.filter((o) => o.kind !== 'agent').length;
    if (op.kind !== 'agent' && strategyCount >= MAX_OPS) {
      fullToast();
      return false;
    }
    set((s) => ({ ops: [...s.ops, { ...op, id } as HostedOp], activeId: id }));
    return true;
  },
  close: (id) =>
    set((s) => ({
      ops: s.ops.filter((o) => o.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    })),
  activate: (id) => set({ activeId: id }),
  minimizeActive: () => set({ activeId: null }),

  /* ── La API que ya hablaban las páginas — mismas firmas, ahora multi-op.
     Métodos DEL store (no funciones sueltas) a propósito: los consumidores
     hacen useOperationStore((st) => st.openPaOp) y ninguno se toca. ── */
  openVaultOp: (vault, initial) => get().open({ kind: 'vault', vault, initial }),
  openPaOp: (op) => get().open({ kind: 'pa', ...op }),
  openCageOp: (op) => get().open({ kind: 'cage', ...op }),
  openConstituteOp: () => get().open({ kind: 'constitute' }),
  openReinforceOp: (account) => get().open({ kind: 'reinforce', account }),
  openGovernOp: (account, label, tab) => get().open({ kind: 'govern', account, label, tab }),
  openManagerOp: () => get().open({ kind: 'manager' }),
  openManagerSetupOp: (jump) => get().open({ kind: 'manager-setup', jump: jump ?? null }),
  openExchangeSetupOp: () => get().open({ kind: 'exchange-setup' }),
  // seedKey: cada frase nueva de la barra es un mensaje más en la MISMA
  // conversación (el open existente refresca el payload; el chat re-siembra
  // al cambiar la key, nunca al repetirse).
  //
  // CONTADOR, no reloj: con Date.now() dos envíos dentro del mismo
  // milisegundo compartían clave y el segundo se perdía en silencio — dos
  // clics rápidos en una idea de prompt bastaban. Un contador monótono no
  // repite jamás y además hace el comportamiento testeable.
  openAgentOp: (seed) => get().open({ kind: 'agent', seed, seedKey: seed ? nextSeedKey() : undefined }),
  // restoreKey con el mismo contador: el chat restaura cuando la key cambia,
  // aunque se toque dos veces la misma conversación del panel.
  openAgentRestore: (chatId) => get().open({ kind: 'agent', restoreId: chatId, restoreKey: nextSeedKey() }),
}));

/* ─────────────────────────────────────────────────────────────────────────
 * LAS VENTANAS SOBREVIVEN A LA RECARGA. */

const OPS_KEY_PREFIX = 'astryum:ops';

type PersistedOp =
  | { kind: 'vault'; vaultKind: string; initial?: { amount?: string; ratio?: string; targetHF?: string } }
  | { kind: 'pa'; owner: string; legs: PaLegs; holders?: PaHolder[]; action: PaActionKind }
  | { kind: 'cage'; account: string; vaultTitle: string }
  | { kind: 'constitute' }
  | { kind: 'reinforce'; account: string }
  | { kind: 'govern'; account: string; label?: string | null; tab?: 'proposals' }
  | { kind: 'manager' }
  | { kind: 'manager-setup' }
  | { kind: 'exchange-setup' }
  | { kind: 'agent' };

function opsStorageKey(): string {
  let scope = 'anon';
  try {
    const u = useAuthStore.getState().user as { id?: string; email?: string } | null;
    scope = u?.id || u?.email || 'anon';
  } catch {
    /* store sin hidratar: cubo anónimo */
  }
  return `${OPS_KEY_PREFIX}:${scope}`;
}

function toPersisted(op: HostedOp): PersistedOp {
  switch (op.kind) {
    case 'vault':
      return { kind: 'vault', vaultKind: op.vault.kind, initial: op.initial };
    case 'pa':
      return { kind: 'pa', owner: op.owner, legs: op.legs, holders: op.holders, action: op.action };
    case 'cage':
      return { kind: 'cage', account: op.account, vaultTitle: op.vaultTitle };
    case 'constitute':
      return { kind: 'constitute' };
    case 'reinforce':
      return { kind: 'reinforce', account: op.account };
    case 'govern':
      return { kind: 'govern', account: op.account, label: op.label, tab: op.tab };
    case 'manager':
      return { kind: 'manager' };
    case 'manager-setup':
      return { kind: 'manager-setup' };
    case 'exchange-setup':
      return { kind: 'exchange-setup' };
    case 'agent':
      return { kind: 'agent' };
  }
}

let persistPaused = false;
function persistOps(ops: HostedOp[], activeId: string | null): void {
  if (typeof window === 'undefined' || persistPaused) return;
  try {
    const key = opsStorageKey();
    if (ops.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify({ ops: ops.map(toPersisted), activeId }));
  } catch {
    /* storage lleno o bloqueado: la persistencia es cortesía, no contrato */
  }
}

if (typeof window !== 'undefined') {
  useOperationStore.subscribe((s) => persistOps(s.ops, s.activeId));
}

let rehydrated = false;
/** Rehidrata las ventanas de la cuenta actual — una vez por carga. */
export async function rehydrateOperations(): Promise<void> {
  if (rehydrated || typeof window === 'undefined') return;
  rehydrated = true;
  let stored: { ops: PersistedOp[]; activeId: string | null } | null = null;
  try {
    const raw = window.localStorage.getItem(opsStorageKey());
    stored = raw ? (JSON.parse(raw) as { ops: PersistedOp[]; activeId: string | null }) : null;
  } catch {
    stored = null;
  }
  if (!stored || !Array.isArray(stored.ops) || stored.ops.length === 0) return;

  const restored: OpInput[] = [];
  for (const p of stored.ops) {
    // Cada entrada por su cuenta (revisión): una que no se pueda
    // rehidratar (chunk que ya no existe tras un deploy, forma vieja) no
    // arrastra a las demás — antes un solo fallo perdía TODAS las ventanas.
    try {
      const kind = (p as { kind?: string } | null)?.kind;
      if (kind === 'vault') {
        // El DemoVault lleva JSX y vive en el catálogo: se resuelve por kind.
        // Import dinámico a propósito — el módulo de Earn es el más pesado y
        // no debe entrar en el chunk del store.
        const { DEMO_VAULTS } = await import('@/components/earn/FlareDemoEarn');
        const vault = DEMO_VAULTS.find((v) => v.kind === (p as { vaultKind: string }).vaultKind);
        if (vault) restored.push({ kind: 'vault', vault, initial: (p as { initial?: { amount?: string; ratio?: string; targetHF?: string } }).initial });
      } else if (kind === 'pa') {
        const q = p as Extract<PersistedOp, { kind: 'pa' }>;
        restored.push({ kind: 'pa', owner: q.owner, legs: q.legs, holders: q.holders, action: q.action, onChanged: () => invalidatePortfolioCache() });
      } else if (kind && ['cage', 'constitute', 'reinforce', 'govern', 'manager', 'manager-setup', 'exchange-setup', 'agent'].includes(kind)) {
        restored.push(p as OpInput);
      }
      // Un kind desconocido (storage de otra versión) se descarta en silencio:
      // rehidratar algo que este build no sabe pintar era una ventana fantasma.
    } catch (e) {
      console.warn('[operations] una ventana guardada no se pudo rehidratar y se descarta', e);
    }
  }

  // Las que ya estén abiertas (alguien abrió una antes de que el import
  // resolviera) mandan; las restauradas se añaden detrás sin duplicar.
  persistPaused = true;
  try {
    useOperationStore.setState((s) => {
      const present = new Set(s.ops.map((o) => o.id));
      const extra = restored
        .map((op) => ({ ...op, id: identityOf(op) }) as HostedOp)
        .filter((op) => !present.has(op.id));
      // El tope de TRES estrategias también vale al rehidratar: si alguien
      // abrió una antes de que resolviera el import, las restauradas que no
      // caben se quedan fuera (el agente no cuenta) — nunca cuatro píldoras.
      const ops = [...s.ops];
      for (const op of extra) {
        const strategies = ops.filter((o) => o.kind !== 'agent').length;
        if (op.kind !== 'agent' && strategies >= MAX_OPS) continue;
        ops.push(op);
      }
      const activeId = s.activeId ?? (stored!.activeId && ops.some((o) => o.id === stored!.activeId) ? stored!.activeId : null);
      return { ops, activeId };
    });
  } finally {
    persistPaused = false;
    const st = useOperationStore.getState();
    persistOps(st.ops, st.activeId);
  }
}

/** Borra las ventanas persistidas de TODAS las cuentas y vacía el store —
 *  se llama al cerrar sesión. */
export function clearPersistedOperations(): void {
  try {
    const dead: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(OPS_KEY_PREFIX)) dead.push(k);
    }
    dead.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* nada que borrar */
  }
  persistPaused = true;
  useOperationStore.setState({ ops: [], activeId: null });
  persistPaused = false;
}
