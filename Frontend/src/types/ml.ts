// Types for the AstroVital ML backend (/api/v1/ml/*). They match the JSON the backend returns.

export type Level = 'green' | 'amber' | 'red' | 'unknown';
export type Language = 'en' | 'roman-urdu';

export interface BoneProfile {
  age?: number | null;
  sex_female?: 0 | 1 | null;
  bmi?: number | null;
  grip_max_kg?: number | null;
  vig_work_min_week?: number | null;
  mod_work_min_week?: number | null;
  vig_rec_min_week?: number | null;
  mod_rec_min_week?: number | null;
  sedentary_min_day?: number | null;
  sleep_hours?: number | null;
  trouble_sleeping?: 0 | 1 | null;
}

/** What the frontend sends. Everything is optional: the backend fills the rest from crew_map.json. */
export interface DayRequest {
  scenario_id?: string | null;
  subject_id?: string | null;
  mmash_user?: string | null;
  hrv_user?: string | null;
  blood_astronaut?: string | null;
  timepoint?: string | null;
  exercise_minutes?: number | null;
  steps?: number | null;
  bone_profile?: BoneProfile | null;
  language?: Language;
}

export interface Scores {
  P_poor_sleep?: number;
  predicted_daily_stress?: number;
  hrv_anomaly_frac?: number;
  hrv_windows_checked?: number;
  'P_R+1_like_insp4_blood'?: number;
  'P_R+1_like_osd571_blood'?: number;
}

export interface CheckDay {
  level: Level;
  flags: string[];
  n_strong_flags: number;
  n_weak_flags: number;
  missing: string[];
  recommendations: string[];
  note: string;
  scores?: Scores;
}

export interface BoneRisk {
  bone_risk: number;
  bone_risk_label: 'Low' | 'Medium' | 'High';
  probabilities: Record<string, number>;
  advice: string;
  inputs_missing: string[];
  population: string;
}

export interface BaselineChange {
  marker: string;
  baseline_mean: number;
  current: number;
  percent_change: number;
}

export interface Reliability {
  model: string;
  predicts: string | null;
  population: string | null;
  status: string | null;
  metrics: Record<string, unknown> | null;
}

export interface AiRecommendation {
  domain: string;
  action: string;
  priority: 'high' | 'medium' | 'low' | string;
  evidence: 'strong' | 'weak' | 'proxy' | 'screening' | string;
}

export interface AiResult {
  summary?: string;
  key_findings?: string[];
  recommendations?: AiRecommendation[];
  contact_medical_officer?: boolean;
  contact_reason?: string;
  data_gaps?: string[];
  disclaimer?: string;
}

export interface AiBlock {
  source: string;
  model: string | null;
  cached: boolean;
  attempts: { provider: string; ok: boolean; error: string | null }[];
  error?: string;
  result: AiResult | null;
}

export interface DayResult {
  level: Level;
  subject: { subject_id: string | null; display_name: string | null; scenario_id: string | null };
  inputs_used: {
    mmash_user: string | null;
    hrv_user: string | null;
    hrv_windows_checked: number | null;
    blood_astronaut: string | null;
    timepoint: string | null;
    exercise_minutes: number | null;
    steps: number | null;
  };
  check_day: CheckDay;
  bone_risk: BoneRisk | null;
  baseline_changes: BaselineChange[];
  model_reliability: Reliability[];
  not_measurable: string[];
  data_provenance: string[];
  warnings: string[];
  ai: AiBlock | null;
  disclaimer: string;
}

export interface ScenarioInfo {
  scenario_id: string;
  subject_id?: string;
  [key: string]: unknown;
}

export interface SubjectInfo {
  subject_id: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface SubjectsResponse {
  subjects: SubjectInfo[];
  scenarios: ScenarioInfo[];
  blood_astronauts: Record<string, string[]>;
  mmash_users: string[];
  hrv_users: string[];
  selectors: { mmash_user: string[]; hrv_user: string[] };
}

export interface ModelInfo {
  model: string;
  loaded: boolean;
  predicts: string | null;
  population: string | null;
  status: string | null;
  validation: string | null;
  metrics: Record<string, unknown> | null;
  warning: string | null;
  used_in_check_day: boolean;
  separate_call: boolean;
}

export interface MlStatus {
  models_dir: string;
  models_loaded: string[];
  models_missing: string[];
  data_dir: string;
  data_files: Record<string, string | null>;
  ai_providers: Record<string, unknown>[];
}
