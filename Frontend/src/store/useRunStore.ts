import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BoneProfile, DayRequest, Language } from '../types/ml';

/** Which backend data the whole app is looking at right now. No health values are stored here
 *  except the three optional inputs the backend accepts (exercise, steps, bone profile). */
export type Selection = Omit<DayRequest, 'language'>;

type RunState = {
  selection: Selection;
  language: Language;
  setSelection: (patch: Selection) => void;
  chooseScenario: (scenarioId: string) => void;
  setBoneProfile: (profile: BoneProfile | null) => void;
  setLanguage: (language: Language) => void;
  clear: () => void;
};

const EMPTY: Selection = {
  scenario_id: null,
  subject_id: null,
  mmash_user: null,
  hrv_user: null,
  blood_astronaut: null,
  timepoint: null,
  exercise_minutes: null,
  steps: null,
  bone_profile: null,
};

export const useRunStore = create<RunState>()(
  persist(
    (set) => ({
      selection: EMPTY,
      language: 'en',
      setSelection: (patch) => set((s) => ({ selection: { ...s.selection, ...patch } })),
      chooseScenario: (scenarioId) => set({ selection: { ...EMPTY, scenario_id: scenarioId } }),
      setBoneProfile: (bone_profile) => set((s) => ({ selection: { ...s.selection, bone_profile } })),
      setLanguage: (language) => set({ language }),
      clear: () => set({ selection: EMPTY }),
    }),
    { name: 'astrovital-run-v1' },
  ),
);

export const hasSelection = (s: Selection) =>
  Boolean(s.scenario_id || s.subject_id || s.mmash_user || s.hrv_user || s.blood_astronaut || s.exercise_minutes != null || s.steps != null);
