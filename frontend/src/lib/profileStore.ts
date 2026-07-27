/**
 * Device-local profile persistence (display name + avatar), keyed by identity.
 *
 * The auth store wipes `defibro-auth-storage` on logout and every login path
 * rebuilds `user` from scratch (username = short address), so anything the
 * user typed in Settings → Profile evaporated between sessions. This store
 * lives under its OWN localStorage key that logout never touches; login paths
 * rehydrate from it, updateProfile writes through to it.
 *
 * Presentation only — no keys, no funds, nothing custodial. Never uploaded.
 */

const STORAGE_KEY = 'astryum:profiles';

export interface StoredProfile {
  username?: string;
  avatar?: string;
}

/** Stable identity for a user: wallet address first, then email. */
export function profileIdentity(u: { address?: string; email?: string } | null | undefined): string | null {
  if (!u) return null;
  if (u.address) return `addr:${u.address.toLowerCase()}`;
  if (u.email) return `email:${u.email.toLowerCase()}`;
  return null;
}

function readAll(): Record<string, StoredProfile> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredProfile>) : {};
  } catch {
    return {};
  }
}

export function loadProfile(identity: string | null): StoredProfile | null {
  if (!identity) return null;
  const p = readAll()[identity];
  return p && typeof p === 'object' ? p : null;
}

export function saveProfile(identity: string | null, patch: StoredProfile): void {
  if (!identity || typeof window === 'undefined') return;
  try {
    const all = readAll();
    const next: StoredProfile = { ...all[identity] };
    if (patch.username !== undefined) next.username = patch.username || undefined;
    if (patch.avatar !== undefined) next.avatar = patch.avatar || undefined;
    all[identity] = next;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota/serialization failures are non-fatal — profile just won't persist */
  }
}

/** Merge a stored profile over a freshly-built login user (stored wins). */
export function withStoredProfile<T extends { address?: string; email?: string; username?: string; avatar?: string }>(
  user: T,
): T {
  const stored = loadProfile(profileIdentity(user));
  if (!stored) return user;
  return {
    ...user,
    username: stored.username ?? user.username,
    avatar: stored.avatar ?? user.avatar,
  };
}
