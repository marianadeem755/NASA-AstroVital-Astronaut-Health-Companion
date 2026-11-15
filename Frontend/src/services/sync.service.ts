import { http } from './http/client';
import { endpoints } from './http/endpoints';

export const getSyncStatus = async (deviceId?: string) =>
  (await http.get(endpoints.syncStatus, { params: { device_id: deviceId } })).data;
export const pushSyncEvents = async (payload: unknown) => (await http.post(endpoints.syncPush, payload)).data;
export const resolveSyncConflict = async (id: number, resolution: 'keep_server' | 'accept_client') =>
  (await http.post(endpoints.resolveSyncConflict(id), { resolution })).data;
