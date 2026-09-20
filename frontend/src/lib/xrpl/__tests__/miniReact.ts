/**
 * miniReact — a hooks runtime small enough to read, for tests that must run a
 * component's EFFECTS and their CLEANUPS without a DOM.
 */
import type { ReactElement } from 'react';

type Cleanup = (() => void) | void;
interface EffectSlot {
  kind: 'effect';
  effect: () => Cleanup;
  deps: unknown[] | undefined;
  cleanup: Cleanup;
  pending: boolean;
}
interface StateSlot {
  kind: 'state';
  value: unknown;
  set: (v: unknown) => void;
}
interface RefSlot {
  kind: 'ref';
  ref: { current: unknown };
}
interface MemoSlot {
  kind: 'memo';
  has: boolean;
  deps: unknown[] | undefined;
  value: unknown;
}
type Slot = EffectSlot | StateSlot | RefSlot | MemoSlot;

function depsChanged(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  return a.some((x, i) => !Object.is(x, b[i]));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = (props: any) => ReactElement | null;

let rendering: MiniInstance | null = null;

function must(): MiniInstance {
  if (!rendering) throw new Error('miniReact: a hook was called outside a render');
  return rendering;
}

function slot<T extends Slot>(create: () => T): T {
  const inst = must();
  const idx = inst.cursor++;
  if (!inst.slots[idx]) inst.slots[idx] = create();
  return inst.slots[idx] as T;
}

export class MiniInstance {
  slots: Slot[] = [];
  cursor = 0;
  tree: ReactElement | null = null;
  scheduled = false;
  unmounted = false;
  children = new Map<string, MiniInstance>();
  renders = 0;

  constructor(
    public fn: AnyComponent,
    public props: Record<string, unknown>,
    public expand: AnyComponent[],
  ) {}

  render(): void {
    if (this.unmounted) return;
    const prev = rendering;
    rendering = this;
    this.cursor = 0;
    try {
      this.tree = this.fn(this.props) as ReactElement | null;
    } finally {
      rendering = prev;
    }
    this.renders += 1;
    this.reconcileChildren();
    this.runEffects();
  }

  private runEffects(): void {
    for (const s of this.slots) {
      if (s.kind !== 'effect' || !s.pending) continue;
      s.pending = false;
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = s.effect();
    }
  }

  private reconcileChildren(): void {
    const found = new Map<string, ReactElement>();
    const counts = new Map<AnyComponent, number>();
    walk(this.tree, (el) => {
      const type = el.type as AnyComponent;
      if (!this.expand.includes(type)) return;
      const n = counts.get(type) ?? 0;
      counts.set(type, n + 1);
      found.set(`${type.name}#${n}`, el);
    });
    for (const [key, el] of found) {
      const props = (el.props ?? {}) as Record<string, unknown>;
      const child = this.children.get(key);
      if (child) {
        child.props = props;
        child.render();
      } else {
        const fresh = new MiniInstance(el.type as AnyComponent, props, this.expand);
        this.children.set(key, fresh);
        fresh.render();
      }
    }
    for (const [key, child] of this.children) {
      if (!found.has(key)) {
        child.unmount();
        this.children.delete(key);
      }
    }
  }

  schedule(): void {
    if (this.unmounted || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.render();
    });
  }

  /** What React does when the element disappears: children first, then every cleanup. */
  unmount(): void {
    if (this.unmounted) return;
    this.unmounted = true;
    for (const s of this.slots) {
      if (s.kind === 'effect' && typeof s.cleanup === 'function') {
        s.cleanup();
        s.cleanup = undefined;
      }
    }
    for (const c of this.children.values()) c.unmount();
    this.children.clear();
  }

  /** The mounted child of that component type (first one), or null. */
  child(type: AnyComponent): MiniInstance | null {
    return this.children.get(`${type.name}#0`) ?? null;
  }
}

/** Depth-first over a React element tree (elements, arrays, fragments, strings). */
export function walk(node: unknown, visit: (el: ReactElement) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const el = node as ReactElement;
  if (typeof el.type === 'undefined' && !('props' in el)) return;
  visit(el);
  walk((el.props as { children?: unknown } | undefined)?.children, visit);
}

/** The first element satisfying `pick`, or null. */
export function findElement(node: unknown, pick: (el: ReactElement) => boolean): ReactElement | null {
  let hit: ReactElement | null = null;
  walk(node, (el) => {
    if (!hit && pick(el)) hit = el;
  });
  return hit;
}

/** All the text inside an element's children, concatenated. */
export function textOf(el: ReactElement | null): string {
  const out: string[] = [];
  const collect = (n: unknown): void => {
    if (n == null || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(collect);
      return;
    }
    if (typeof n === 'object') collect((n as ReactElement<{ children?: unknown }>).props?.children);
  };
  if (el) collect((el as ReactElement<{ children?: unknown }>).props?.children);
  return out.join('');
}

/** A button-like element whose text contains `label`. */
export function findButton(node: unknown, label: string): ReactElement | null {
  return findElement(
    node,
    (el) => typeof (el.props as { onClick?: unknown })?.onClick === 'function' && textOf(el).includes(label),
  );
}

export function press(el: ReactElement | null, what: string): void {
  if (!el) throw new Error(`miniReact: nothing to press for «${what}»`);
  (el.props as { onClick: () => void }).onClick();
}

/** Mount a component as a root, expanding the given child component types. */
export function mount(fn: AnyComponent, props: Record<string, unknown>, expand: AnyComponent[] = []): MiniInstance {
  const inst = new MiniInstance(fn, props, expand);
  inst.render();
  return inst;
}

/**
 * Let pending microtasks (state writes, awaited fetches) run. A few turns of
 * the microtask queue plus one macrotask — `setImmediate` is left real even
 * when a test fakes timers, so this never deadlocks against them.
 */
export async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

export const miniHooks = {
  useState<S>(init: S | (() => S)): [S, (v: S | ((prev: S) => S)) => void] {
    const inst = must();
    const s = slot<StateSlot>(() => {
      const st: StateSlot = {
        kind: 'state',
        value: typeof init === 'function' ? (init as () => S)() : init,
        set: (v) => {
          const next = typeof v === 'function' ? (v as (p: unknown) => unknown)(st.value) : v;
          if (Object.is(next, st.value)) return;
          st.value = next;
          inst.schedule();
        },
      };
      return st;
    });
    return [s.value as S, s.set as (v: S | ((prev: S) => S)) => void];
  },
  useRef<T>(init: T): { current: T } {
    return slot<RefSlot>(() => ({ kind: 'ref', ref: { current: init } })).ref as { current: T };
  },
  useMemo<T>(f: () => T, deps?: unknown[]): T {
    const s = slot<MemoSlot>(() => ({ kind: 'memo', has: false, deps: undefined, value: undefined }));
    if (!s.has || depsChanged(s.deps, deps)) {
      s.value = f();
      s.deps = deps;
      s.has = true;
    }
    return s.value as T;
  },
  useCallback<F>(fn: F, deps?: unknown[]): F {
    return miniHooks.useMemo(() => fn, deps);
  },
  useEffect(effect: () => Cleanup, deps?: unknown[]): void {
    const s = slot<EffectSlot>(() => ({ kind: 'effect', effect, deps, cleanup: undefined, pending: true }));
    if (s.pending) {
      s.effect = effect;
      s.deps = deps;
      return;
    }
    if (depsChanged(s.deps, deps)) {
      s.effect = effect;
      s.deps = deps;
      s.pending = true;
    }
  },
  useLayoutEffect(effect: () => Cleanup, deps?: unknown[]): void {
    miniHooks.useEffect(effect, deps);
  },
};
