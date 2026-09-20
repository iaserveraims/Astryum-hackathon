import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useAuthStore } from './authStore';
import { MANAGER_VOLATILE_KEY, managerUserKey } from './managerStore';

/**
 * managerAccountStore — the XRPL account the manager desk and its setup
 * ceremony follow, chosen BY HAND (founder 2026-09-13: «debe haber un botón
 * para hacer el switch»).
 *
 * Shared, not local: the desk (/app/manager) and the ceremony window
 * (ManagerSetupOperation, hosted globally) are different trees, and both must
 * agree on the account or the ceremony would open on a different one than the
 * desk shows.
 *
 * REMEMBERED PER USER (founder 2026-09-15: «no me reconoce la cuenta»): the
 * choice used to live for one tab only, so every reload fell back to whatever
 * Xaman session happened to be live — a client account, an exchange root —
 * and the manager had to pick their governing account again each visit. Now
 * the pick is kept under the signed-in user's key (email / address, the same
 * key managerStore uses), never under the browser: the second email to sign in
 * on this machine does not inherit the first one's desk. The value is only a
 * POINTER into the wallets of that account — `useManagerAccount` ignores it
 * the moment it stops being a candidate (the wallet was removed, another
 * account signed in), so a stale pick can never point the desk anywhere the
 * account cannot go. A session with no stable anchor (XRP Identity brings
 * neither email nor address) lands in the volatile bucket, which is never
 * written to disk.
 */
interface ManagerAccountState {
  /** userKey → the address picked by hand (absent = no pick, follow the rule). */
  chosenBy: Record<string, string>;
  choose: (address: string | null) => void;
}

function omitVolatile(rec: Record<string, string>): Record<string, string> {
  if (!(MANAGER_VOLATILE_KEY in rec)) return rec;
  const { [MANAGER_VOLATILE_KEY]: _drop, ...rest } = rec;
  return rest;
}

export const useManagerAccountStore = create<ManagerAccountState>()(
  persist(
    (set) => ({
      chosenBy: {},
      choose: (address) =>
        set((s) => {
          const key = managerUserKey(useAuthStore.getState().user);
          if (address === null) {
            if (!(key in s.chosenBy)) return s;
            const { [key]: _drop, ...rest } = s.chosenBy;
            return { chosenBy: rest };
          }
          return { chosenBy: { ...s.chosenBy, [key]: address } };
        }),
    }),
    {
      name: 'astryum:manager-account',
      // The volatile bucket never touches the disk — it would be the shared
      // browser bucket the per-user key exists to avoid.
      partialize: (s) => ({ chosenBy: omitVolatile(s.chosenBy) }),
    },
  ),
);

/** The address the CURRENT user picked by hand, reactive to login/logout; null = no pick. */
export function useChosenManagerAccount(): string | null {
  const user = useAuthStore((s) => s.user);
  const chosenBy = useManagerAccountStore((s) => s.chosenBy);
  return chosenBy[managerUserKey(user)] ?? null;
}
