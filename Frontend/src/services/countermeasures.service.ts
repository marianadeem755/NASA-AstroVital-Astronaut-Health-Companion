import { http } from './http/client';
import { endpoints } from './http/endpoints';

export const getProtocols = async () => (await http.get(endpoints.protocols)).data;
