import { http } from './http/client';
import { endpoints } from './http/endpoints';

export const listAstronauts = async () => (await http.get(endpoints.astronauts)).data;
export const getAstronaut = async (id: number) => (await http.get(endpoints.astronaut(id))).data;
export const createAstronaut = async (payload: unknown) => (await http.post(endpoints.astronauts, payload)).data;
export const updateAstronaut = async (id: number, payload: unknown) => (await http.put(endpoints.astronaut(id), payload)).data;
