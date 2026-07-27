/**
 * Strategy drafts — the strategies a user composes with the AI agent.
 *
 * Device-local (localStorage), keyed per identity like profileStore, and NEVER
 * executed from here: a draft is presentation + parameters. Execution always
 * goes through the same prepare→review→sign rail as the ready-made packs
 * (Astryum never signs — invariant #1); custom drafts can't execute in the
 * beta at all and say so.
 */

const STORAGE_KEY = 'astryum:strategy-drafts';

export type DraftKind = 'e1' | 'e2' | 'custom';

export interface StrategyDraft {
  id: string;
  /** Short human name, editable ("25 XRP — carry protegido"). */
  name: string;
  /** Which execution rail it maps to; 'custom' = not executable in the beta. */
  kind: DraftKind;
  asset?: string;
  amount?: string;
  /** E1 only */
  ratio?: string;
  targetHF?: string;
  /** The user's own wording, kept verbatim. */
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

function readAll(): Record<string, StrategyDraft[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StrategyDraft[]>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StrategyDraft[]>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota failures are non-fatal — drafts just won't persist */
  }
}

export function listDrafts(identity: string): StrategyDraft[] {
  const list = readAll()[identity];
  return Array.isArray(list) ? list : [];
}

/** Upsert by id; returns the stored draft. */
export function saveDraft(
  identity: string,
  draft: Omit<StrategyDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): StrategyDraft {
  const all = readAll();
  const list = Array.isArray(all[identity]) ? all[identity] : [];
  const now = new Date().toISOString();
  const existing = draft.id ? list.find((d) => d.id === draft.id) : undefined;
  const stored: StrategyDraft = existing
    ? { ...existing, ...draft, id: existing.id, updatedAt: now }
    : {
        ...draft,
        id: draft.id ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
      };
  all[identity] = existing ? list.map((d) => (d.id === stored.id ? stored : d)) : [stored, ...list];
  writeAll(all);
  return stored;
}

export function deleteDraft(identity: string, id: string): void {
  const all = readAll();
  const list = Array.isArray(all[identity]) ? all[identity] : [];
  all[identity] = list.filter((d) => d.id !== id);
  writeAll(all);
}
