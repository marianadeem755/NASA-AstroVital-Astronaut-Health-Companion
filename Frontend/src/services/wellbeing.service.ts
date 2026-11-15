import { http } from './http/client';
import { endpoints } from './http/endpoints';

export const getWellbeing = async (id: number) => (await http.get(endpoints.wellbeing(id))).data;
export const getWellbeingTrends = async (id: number, days = 30) =>
  (await http.get(endpoints.wellbeingTrends(id, days))).data;
export const submitWellbeing = async (payload: unknown) =>
  (await http.post(endpoints.wellbeingAssessment, payload)).data;
