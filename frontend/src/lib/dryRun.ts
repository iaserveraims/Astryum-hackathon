/**
 * dryRun — el cliente del ensayo en seco (`/api/dry-run`).
 *
 * Solo existe para el usuario cuando `NEXT_PUBLIC_DRY_RUN=true` Y el backend
 * tiene el módulo montado (`DRY_RUN_MODE=true` + anvil local). Donde en vivo
 * firma Xaman o MetaMask, en seco estas funciones ejecutan LA MISMA calldata
 * impersonando al firmante en el fork. Nada de esto es real, y la banda lo dice.
 */

import { getApiBase } from './env';

const API_BASE = getApiBase();

export const DRY_RUN = process.env.NEXT_PUBLIC_DRY_RUN === 'true';

export interface DryRunActor {
  role: string;
  address: string;
  note: string;
  flr: string;
  fxrp: string | null;
}

export type DryRunResult<T> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

async function call<T>(path: string, init?: RequestInit): Promise<DryRunResult<T>> {
  try {
    const res = await fetch(`${API_BASE}/dry-run${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...init,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined };
    }
    return { ok: true, data: body as unknown as T };
  } catch (e) {
    return { ok: false, error: 'NETWORK', detail: e instanceof Error ? e.message : String(e) };
  }
}

export function dryRunActors(): Promise<DryRunResult<{ actors: DryRunActor[] }>> {
  return call('/actors');
}

export function dryRunFund(address: string, fxrpBase: string): Promise<DryRunResult<{ txHashes: string[]; fxrpBalance: string }>> {
  return call('/fund', { method: 'POST', body: JSON.stringify({ address, fxrpBase }) });
}

export function dryRunCageCreate(council: string): Promise<DryRunResult<{ bridge: string; cage: string; personalAccount: string }>> {
  return call('/cage-create', { method: 'POST', body: JSON.stringify({ council }) });
}

export function dryRunExecuteOrder(council: string, orderData: string): Promise<DryRunResult<{ txHashes: string[]; nonce: string }>> {
  return call('/order', { method: 'POST', body: JSON.stringify({ council, orderData }) });
}

export function dryRunExecuteCalls(
  from: string,
  calls: Array<{ to: string; data: string; value?: string }>,
): Promise<DryRunResult<{ txHashes: string[] }>> {
  return call('/execute', { method: 'POST', body: JSON.stringify({ from, calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? '0' })) }) });
}

export function dryRunDeployKycRegistry(admin: string): Promise<DryRunResult<{ registry: string; txHash: string }>> {
  return call('/kyc-registry', { method: 'POST', body: JSON.stringify({ admin }) });
}

export function dryRunKycStatus(registry: string, user: string): Promise<DryRunResult<{ approved: boolean }>> {
  return call(`/kyc-status?registry=${registry}&user=${user}`);
}

// ── El actor activo: «quién firma» en el ensayo ─────────────────────────────
// Conveniencia por navegador (localStorage): jamás estado de verdad. Sin actor
// elegido, cada botón del ensayo lo pide — nunca se firma «como nadie».

const ACTOR_KEY = 'astryum-dry-run-actor';

export function activeDryRunActor(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(ACTOR_KEY);
    return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function setActiveDryRunActor(address: string): void {
  try {
    window.localStorage.setItem(ACTOR_KEY, address);
  } catch {
    /* sin memoria: se volverá a pedir, y eso es lo correcto */
  }
}
