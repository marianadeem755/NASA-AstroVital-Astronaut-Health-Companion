import { http } from './http/client';
import { endpoints } from './http/endpoints';

export const getAlerts = async (id: number) => (await http.get(endpoints.alerts(id))).data;
export const acknowledgeAlert = async (id: number, payload: { acknowledged_by?: string } = {}) =>
  (await http.post(endpoints.acknowledgeAlert(id), payload)).data;
