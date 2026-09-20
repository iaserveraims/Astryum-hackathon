/**
 * chatHistory — el historial del agente, SOLO en este navegador (fundador
 * 2026-08-29: «un historial de chats, que dure no sé 30 días en disco y
 * luego se borren»). localStorage a propósito, jamás el backend: una
 * conversación con el agente lleva información financiera de la persona, y
 * guardarla en servidor abriría superficie de protección de datos (aviso,
 * ROPA) que hoy no existe. En su disco, muere sola a los 30 días.
 *
 * Se guardan SOLO role+content (texto): las tarjetas estructuradas (tabla de
 * opciones, propuestas CMF/transfer) llevan números vivos y botones de
 * lanzamiento — restaurarlas días después ofrecería cifras muertas como si
 * fueran actuales. La prosa queda como registro; los números frescos se
 * piden de nuevo. El backend ya conversa solo sobre role+content, así que
 * retomar un chat restaurado funciona tal cual.
 */

// Import estático sin ciclo de inicialización: authStore solo llega a este
// lib por import() dinámico (en logout), así que aquí puede mirarse el user
// en el momento de la llamada.
import { useAuthStore } from '../../stores/authStore';

export interface StoredChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StoredChat {
  id: string;
  startedAt: number;
  updatedAt: number;
  /** El primer mensaje del usuario, recortado — el nombre natural del chat. */
  title: string;
  messages: StoredChatMessage[];
}

const KEY_PREFIX = 'astryum:agentChats';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CHATS = 30;

/**
 * Clave POR CUENTA (revisión 2026-08-29: la clave única global mezclaba las
 * conversaciones de dos cuentas del mismo navegador y sobrevivía al logout).
 * El id viene del authStore en el momento de la llamada — import perezoso
 * para no acoplar este lib puro al store en tiempo de módulo.
 */
function storageKey(): string {
  let scope = 'anon';
  try {
    const u = useAuthStore.getState().user as { id?: string; email?: string } | null;
    scope = u?.id || u?.email || 'anon';
  } catch {
    /* fuera del cliente o store aún sin hidratar: cubo anónimo */
  }
  return `${KEY_PREFIX}:${scope}`;
}

/** Borra TODAS las conversaciones del agente, de todas las cuentas — se
 *  llama desde logout: salir de la app deja este navegador sin chats. */
export function clearAgentChats(): void {
  try {
    const dead: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) dead.push(k);
    }
    dead.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage bloqueado: nada que borrar */
  }
}

function prune(chats: StoredChat[]): StoredChat[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return chats
    .filter((c) => c.updatedAt >= cutoff && c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS);
}

export function loadChats(): StoredChat[] {
  try {
    const key = storageKey();
    // Migración de la clave global previa (vivió unas horas el 2026-08-29):
    // se adopta en el cubo actual una sola vez y se retira.
    const legacy = window.localStorage.getItem(KEY_PREFIX);
    if (legacy && !window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, legacy);
    }
    if (legacy) window.localStorage.removeItem(KEY_PREFIX);
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return prune(parsed as StoredChat[]);
  } catch {
    return [];
  }
}

export function saveChat(chat: StoredChat): void {
  try {
    const rest = loadChats().filter((c) => c.id !== chat.id);
    window.localStorage.setItem(storageKey(), JSON.stringify(prune([chat, ...rest])));
  } catch {
    /* disco lleno o storage bloqueado: el historial es cortesía, no contrato */
  }
}

export function deleteChat(id: string): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(loadChats().filter((c) => c.id !== id)));
  } catch {
    /* ídem */
  }
}

export function newChatId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
