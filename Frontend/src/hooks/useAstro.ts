import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { checkDay, getModels, getMlStatus, getRecommendations, getSubjects } from '../services/ml.service';
import { hasSelection, useRunStore } from '../store/useRunStore';
import type { AiRecommendation, DayResult } from '../types/ml';

export function useSubjects() {
  return useQuery({ queryKey: ['ml-subjects'], queryFn: getSubjects, retry: 1 });
}
export function useModels() {
  return useQuery({ queryKey: ['ml-models'], queryFn: getModels, retry: 1 });
}
export function useMlStatus() {
  return useQuery({ queryKey: ['ml-status'], queryFn: getMlStatus, retry: 1 });
}

/** Models + rule flag for whatever is selected (fast, no AI). */
export function useDay() {
  const selection = useRunStore((s) => s.selection);
  return useQuery({
    queryKey: ['ml-day', selection],
    queryFn: () => checkDay(selection),
    enabled: hasSelection(selection),
    retry: 0,
    staleTime: 5 * 60_000,
  });
}

/** Same day + AI recommendations. One call is shared by every page (React Query cache). */
export function useAI() {
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  return useQuery({
    queryKey: ['ml-ai', selection, language],
    queryFn: () => getRecommendations({ ...selection, language }),
    enabled: hasSelection(selection),
    retry: 0,
    staleTime: 60 * 60_000,
  });
}

/** First time the app opens: pick the first scenario / subject found in the backend data. */
export function useBootstrapSelection() {
  const subjects = useSubjects();
  const selection = useRunStore((s) => s.selection);
  const setSelection = useRunStore((s) => s.setSelection);
  const chooseScenario = useRunStore((s) => s.chooseScenario);
  const data = subjects.data;

  useEffect(() => {
    if (!data || hasSelection(selection)) return;
    if (data.scenarios.length) {
      chooseScenario(data.scenarios[0].scenario_id);
    } else if (data.subjects.length) {
      setSelection({ subject_id: data.subjects[0].subject_id });
    } else if (data.mmash_users.length || data.hrv_users.length || Object.keys(data.blood_astronauts).length) {
      const astronaut = Object.keys(data.blood_astronauts)[0];
      const timepoints = astronaut ? data.blood_astronauts[astronaut] : [];
      setSelection({
        mmash_user: data.mmash_users[0] ?? null,
        hrv_user: data.hrv_users[0] ?? null,
        blood_astronaut: astronaut ?? null,
        timepoint: timepoints.length ? timepoints[timepoints.length - 1] : null,
      });
    }
  }, [data, selection, setSelection, chooseScenario]);
}

// ---------------------------------------------------------------------------
// Recommendation helpers: which backend recommendation belongs to which page
// ---------------------------------------------------------------------------
export type Domain = 'sleep' | 'stress' | 'hrv' | 'blood' | 'bone' | 'exercise' | 'general';

const RULE_PREFIX: Record<Exclude<Domain, 'bone' | 'general'>, string> = {
  sleep: 'Sleep:',
  stress: 'Stress:',
  hrv: 'HRV:',
  blood: 'Blood:',
  exercise: 'Exercise:',
};

const AI_DOMAINS: Record<Domain, string[]> = {
  sleep: ['sleep'],
  stress: ['stress'],
  hrv: ['cardiovascular'],
  blood: ['blood'],
  bone: ['bone_muscle'],
  exercise: ['exercise', 'bone_muscle'],
  general: ['general'],
};

export function ruleRecsFor(day: DayResult | undefined, domains: Domain[]): string[] {
  if (!day) return [];
  const out: string[] = [];
  const all = day.check_day.recommendations ?? [];
  domains.forEach((d) => {
    if (d === 'general') {
      all.filter((r) => /^(RED|AMBER|No flag)/.test(r)).forEach((r) => out.push(r));
    } else if (d === 'bone') {
      if (day.bone_risk?.advice) out.push(`Bone: ${day.bone_risk.advice}`);
    } else {
      all.filter((r) => r.startsWith(RULE_PREFIX[d])).forEach((r) => out.push(r));
    }
  });
  return Array.from(new Set(out));
}

export function aiRecsFor(day: DayResult | undefined, domains: Domain[]): AiRecommendation[] {
  const list = day?.ai?.result?.recommendations ?? [];
  const wanted = new Set(domains.flatMap((d) => AI_DOMAINS[d]));
  return list.filter((r) => wanted.has(r.domain));
}
