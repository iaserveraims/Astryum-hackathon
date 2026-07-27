import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The four goals mirror the landing "paths" so the story is continuous from marketing
// into the product.
export type OnboardingGoal = 'protect' | 'control' | 'generate' | 'manage';

/** The interactive coachmark tours (ProductTour). Only two by design:
 *  Summary explains every sidebar destination once; Earn explains its doors.
 *  Anything more would be overwhelming (founder 2026-07-18). */
export type TourId = 'summary' | 'earn';

interface OnboardingState {
  /** The user has been through (or skipped) first-run setup. Persisted. */
  completed: boolean;
  /** What the user said they want to do here. Persisted. */
  goal: OnboardingGoal | null;
  /** Transient — re-opened on demand from Settings even after completion. */
  forceOpen: boolean;
  /** Tours already seen (or skipped). Persisted — each runs once. */
  toursDone: Partial<Record<TourId, boolean>>;

  finish: (goal: OnboardingGoal | null) => void;
  skip: () => void;
  reopen: () => void;
  close: () => void;
  markTourDone: (tour: TourId) => void;
  /** Settings "Run again": replays the wizard AND both tours. */
  resetTours: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      goal: null,
      forceOpen: false,
      toursDone: {},
      finish: (goal) => set({ completed: true, goal, forceOpen: false }),
      skip: () => set({ completed: true, forceOpen: false }),
      reopen: () => set({ forceOpen: true }),
      close: () => set({ forceOpen: false }),
      markTourDone: (tour) => set((s) => ({ toursDone: { ...s.toursDone, [tour]: true } })),
      resetTours: () => set({ toursDone: {} }),
    }),
    {
      name: 'defibro:onboarding',
      partialize: (s) => ({ completed: s.completed, goal: s.goal, toursDone: s.toursDone }),
    },
  ),
);
