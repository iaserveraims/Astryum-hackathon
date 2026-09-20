import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useAuthStore } from './authStore';
import { MANAGER_VOLATILE_KEY, managerUserKey } from './managerStore';

/**
 * managerAccountStore — the XRPL account the manager desk and its setup
 * ceremony follow, chosen BY HAND.
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
