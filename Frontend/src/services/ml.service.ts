import { http } from './http/client';
import type { BoneProfile, DayRequest, DayResult, MlStatus, ModelInfo, SubjectsResponse } from '../types/ml';

/** Fields the backend declares as integers (DayRequest.steps). A decimal here gives a 422. */
const INTEGER_FIELDS = new Set<string>(['steps']);

/** True only for real, finite numbers (NaN / Infinity become null in JSON and break validation). */
const isUsable = (value: unknown) => typeof value !== 'number' || Number.isFinite(value);

/** Remove empty / invalid values so the backend only sees what was really chosen. */
export function cleanRequest(req: DayRequest): DayRequest {
  const out: Record<string, unknown> = {};
  Object.entries(req).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (!isUsable(value)) return;
    if (key === 'bone_profile') {
      const bone: Record<string, unknown> = {};
      Object.entries(value as BoneProfile).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== ('' as unknown) && isUsable(v)) bone[k] = v;
      });
      if (Object.keys(bone).length) out[key] = bone;
      return;
    }
    out[key] = INTEGER_FIELDS.has(key) && typeof value === 'number' ? Math.round(value) : value;
  });
  return out as DayRequest;
}

export const getSubjects = () => http.get<SubjectsResponse>('/ml/subjects').then((r) => r.data);
export const getMlStatus = () => http.get<MlStatus>('/ml/status').then((r) => r.data);
export const getModels = () => http.get<ModelInfo[]>('/ml/models').then((r) => r.data);

/** Models + rule flag. Fast, uses no AI quota. */
export const checkDay = (req: DayRequest) =>
  http.post<DayResult>('/ml/check-day', cleanRequest({ ...req, language: undefined })).then((r) => r.data);

/** Models + rule flag + AI recommendations (can take several seconds). */
export const getRecommendations = (req: DayRequest) =>
  http.post<DayResult>('/ml/recommendations', cleanRequest(req), { timeout: 90000 }).then((r) => r.data);

/** Detailed Vitals & Physical data; selectors only, all measurements come from backend files. */
export const getVitalsInsight = (req: DayRequest) =>
  http.post<VitalsInsight>('/ml/vitals-insight', cleanRequest(req)).then((r) => r.data);

/** Mental Wellbeing: questionnaire scores vs all volunteers, mind-body links, saved stress/sleep models vs what was reported. */
export const getWellbeingMindInsight = (req: DayRequest) =>
  http.post<WellbeingMindInsight>('/ml/wellbeing-insight', cleanRequest(req)).then((r) => r.data);

export interface WellbeingMindInsight {
  selection: { mmash_user: string | null };
  mind: any;
  disclaimer: string;
}

export interface VitalsInsight {
  selection: { hrv_user: string | null; mmash_user: string | null; blood_astronaut: string | null; timepoint: string | null };
  hrv: any;
  blood: any;
  activity: any;
  time_ranges: { available: string[]; unavailable: string[]; reason: string };
  disclaimer: string;
}

/** Radiation Monitor: the page sends a summary of its reference exposure model, the backend asks the AI providers. */
export interface RadiationAdviceRequest {
  mission: 'mars' | 'moon';
  mission_label: string;
  mission_day: number;
  mission_total_days: number;
  phase: string;
  phase_days_left: number;
  environment: string;
  dose_rate_msv_per_day: number;
  dose_to_date_msv: number;
  prior_career_dose_msv: number;
  career_dose_now_msv: number;
  career_dose_end_of_plan_msv: number;
  nasa_limit_msv: number;
  esa_limit_msv: number;
  share_of_nasa_limit_now_pct: number;
  share_of_nasa_limit_end_pct: number;
  plan_crosses_nasa_limit_on_day: number | null;
  shielding_scenario: string;
  shielding_factor: number;
  shielding_saving_msv: number;
  transit_dose_share_pct: number | null;
  uncertainty_pct: number;
  measured_dose_msv: number | null;
  measured_vs_expected_pct: number | null;
  phases: { label: string; environment: string; days: number; rate_msv_per_day: number; dose_msv: number }[];
  language?: 'en' | 'roman-urdu';
}

export interface RadiationAdvice {
  ai: {
    source: string;
    model: string | null;
    cached: boolean;
    attempts: { provider: string; ok: boolean; error: string | null }[];
    error?: string;
    result: {
      summary?: string;
      key_findings?: string[];
      recommendations?: { domain: string; action: string; priority: string; evidence: string }[];
      storm_shelter_steps?: string[];
      contact_medical_officer?: boolean | null;
      contact_reason?: string;
      data_gaps?: string[];
      disclaimer?: string;
    } | null;
  };
  disclaimer: string;
}

export const getRadiationAdvice = (req: RadiationAdviceRequest) =>
  http.post<RadiationAdvice>('/ml/radiation-recommendations', req, { timeout: 90000 }).then((r) => r.data);

/** Mental Wellbeing AI advice: the backend rebuilds the summary from the astronaut's check-ins and the selected volunteer. */
export interface WellbeingAdviceRequest {
  astronaut_id: number;
  scenario_id?: string | null;
  subject_id?: string | null;
  mmash_user?: string | null;
  days?: number;
  language?: 'en' | 'roman-urdu';
}

export interface WellbeingAdvice {
  ai: {
    source: string;
    model: string | null;
    cached: boolean;
    attempts: { provider: string; ok: boolean; error: string | null }[];
    error?: string;
    result: {
      summary?: string;
      key_findings?: string[];
      recommendations?: { domain: string; action: string; priority: string; evidence: string }[];
      contact_medical_officer?: boolean | null;
      contact_reason?: string;
      data_gaps?: string[];
      disclaimer?: string;
    } | null;
  };
  disclaimer: string;
}

export const getWellbeingAdvice = (req: WellbeingAdviceRequest) =>
  http.post<WellbeingAdvice>('/ml/wellbeing-recommendations', req, { timeout: 90000 }).then((r) => r.data);

/** Sleep Tracker: the astronaut's own logged nights and one MMASH volunteer's measured night, built on the backend. */
export interface SleepInsightRequest {
  astronaut_id: number;
  scenario_id?: string | null;
  subject_id?: string | null;
  mmash_user?: string | null;
  days?: number;
  language?: 'en' | 'roman-urdu';
}

export interface SleepInsight {
  selection: { mmash_user: string | null; astronaut_id: number };
  log: any | null;
  lab: any | null;
  disclaimer: string;
}

export const getSleepInsight = (req: SleepInsightRequest) =>
  http.post<SleepInsight>('/ml/sleep-insight', req, { timeout: 60000 }).then((r) => r.data);

/** Sleep Tracker AI advice (Gemini first, Groq fallback), written by the backend from the same data. */
export const getSleepAdvice = (req: SleepInsightRequest) =>
  http.post<WellbeingAdvice>('/ml/sleep-recommendations', req, { timeout: 90000 }).then((r) => r.data);

/** Bone & Muscle deep dive: the bone-risk model opened up, the astronaut's logged exercise, body-map MSK reports and published references. */
export type BoneMuscleRequest = DayRequest & { astronaut_id: number; days?: number };

export interface BoneMuscleInsight {
  selection: { astronaut_id: number };
  bone: any | null;
  backend_profile?: Record<string, number> | null;
  today: any | null;
  exercise: any | null;
  msk: any | null;
  reference: any;
  disclaimer: string;
}

export const getBoneMuscleInsight = (req: BoneMuscleRequest) =>
  http.post<BoneMuscleInsight>('/ml/bone-muscle-insight', { ...cleanRequest(req), astronaut_id: req.astronaut_id, days: req.days ?? 30 }, { timeout: 60000 }).then((r) => r.data);

/** One exercise session (idempotent on client_uuid). Kept in its own table so it never overwrites the latest check-in on other pages. */
export const logExercise = (payload: { astronaut_id: number; minutes: number; kind: 'aerobic' | 'resistive' | 'mixed' | 'other'; performed_at?: string; client_uuid?: string }) =>
  http.post('/exercise', payload).then((r) => r.data);

/** Bone & Muscle AI advice for the calculator (Gemini first, Groq fallback), written by the backend from the same numbers. */
export const getBoneAdvice = (req: BoneMuscleRequest) =>
  http.post<WellbeingAdvice>('/ml/bone-recommendations', { ...cleanRequest(req), astronaut_id: req.astronaut_id, days: req.days ?? 30 }, { timeout: 90000 }).then((r) => r.data);

/** Trends & Analytics deep dive: the astronaut's logged data, relations between measures, risk and alerts, blood across the crew, model scorecard. */
export interface AnalyticsInsightRequest { astronaut_id: number; days?: number }

export interface AnalyticsInsight {
  selection: { astronaut_id: number; days: number };
  logged: any | null;
  risk: any | null;
  blood: any | null;
  models: any | null;
  disclaimer: string;
}

export const getAnalyticsInsight = (req: AnalyticsInsightRequest) =>
  http.post<AnalyticsInsight>('/ml/analytics-insight', { astronaut_id: req.astronaut_id, days: req.days ?? 30 }, { timeout: 90000 }).then((r) => r.data);

/** Risk Alerts deep dive: alerts per factor from the astronaut's own logs, reports and the check-day models. */
export type AlertsInsightRequest = DayRequest & { astronaut_id: number; days?: number };

export interface AlertsInsight {
  selection: { astronaut_id: number; days: number };
  window: { start: string; end: string; days: number };
  kpis: any;
  alerts: any[];
  board: any[];
  timeline: any[] | null;
  heat: any[] | null;
  watch: any[] | null;
  stale: any[] | null;
  engine: any | null;
  reading: any[];
  rules: any[] | null;
  thresholds: { stale_days: number; persist_days: number };
  disclaimer: string;
}

export const getAlertsInsight = (req: AlertsInsightRequest) =>
  http.post<AlertsInsight>('/ml/alerts-insight', { ...cleanRequest(req), astronaut_id: req.astronaut_id, days: req.days ?? 30 }, { timeout: 60000 }).then((r) => r.data);

/** Risk Alerts AI advice (Gemini first, Groq fallback), written by the backend from the same alerts. */
export const getAlertsAdvice = (req: AlertsInsightRequest) =>
  http.post<WellbeingAdvice>('/ml/alerts-recommendations', { ...cleanRequest(req), astronaut_id: req.astronaut_id, days: req.days ?? 30 }, { timeout: 90000 }).then((r) => r.data);
