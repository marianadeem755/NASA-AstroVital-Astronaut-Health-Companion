import { http } from './http/client';
import { endpoints } from './http/endpoints';

export const getObservations = async (astronautId: number) =>
  (await http.get(endpoints.observationsForAstronaut(astronautId))).data;

export const getLatestObservation = async (astronautId: number) =>
  (await http.get(endpoints.latestObservation(astronautId))).data;

export const createObservation = async (payload: unknown) =>
  (await http.post(endpoints.observations, payload)).data;

export const createObservationsBulk = async (payload: unknown) =>
  (await http.post(endpoints.bulkObservations, payload)).data;
