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

export interface VitalsInsight {
  selection: { hrv_user: string | null; mmash_user: string | null; blood_astronaut: string | null; timepoint: string | null };
  hrv: any;
  blood: any;
  activity: any;
  time_ranges: { available: string[]; unavailable: string[]; reason: string };
  disclaimer: string;
}
